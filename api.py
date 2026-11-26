"""API web del sistema biométrico (FastAPI).

Arranque en local:  .venv/bin/uvicorn api:app --reload
"""
import base64
import hmac
import os
import threading
from typing import Annotated

# OpenCV rechaza decodificar imágenes con más píxeles que este límite antes de
# reservar memoria. Sin él, un PNG de pocos KB pero 15000x15000 tumbaba la API.
MAX_PIXELES = 50_000_000
os.environ.setdefault("OPENCV_IO_MAX_IMAGE_PIXELS", str(MAX_PIXELES))

import cv2  # noqa: E402  (después de fijar el límite de píxeles)
import numpy as np
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from biometria import (BDComprometida, LIMITE_REPLAY, SistemaBiometrico, UMBRAL,
                       UsuarioBloqueado)
from biometria.detector import alinear
from biometria.sistema import RUTA_BD

sistema = SistemaBiometrico(ruta_bd=os.environ.get("BD_RUTA", RUTA_BD))
# Avatar de cada usuario (su primera cara alineada), junto al CSV.
DIR_CARAS = os.path.join(os.path.dirname(os.path.abspath(sistema.bd.ruta)), "caras")
# La base de datos en memoria y el CSV no son seguros entre hilos.
cerrojo = threading.Lock()

# Roles. Con la clave de administración (cabecera "Authorization: Bearer <clave>")
# se puede inscribir y borrar, ver las caras inscritas, los scores y el ranking
# de la identificación, y elegir el umbral; las verificaciones no cuentan para el
# bloqueo. Sin ella, el usuario solo ve la decisión con el umbral del sistema. Si
# el servidor no tiene CLAVE_ADMIN, la inscripción y el borrado están
# deshabilitados.
CLAVE_ADMIN = os.environ.get("CLAVE_ADMIN", "")

app = FastAPI(title="Sistema biométrico facial")


@app.exception_handler(BDComprometida)
def bd_comprometida(_: Request, e: BDComprometida):
    return JSONResponse(status_code=409, content={"detail": str(e)})


@app.exception_handler(UsuarioBloqueado)
def usuario_bloqueado(_: Request, e: UsuarioBloqueado):
    return JSONResponse(status_code=429, content={"detail": str(e)})


def es_admin(authorization: Annotated[str | None, Header()] = None) -> bool:
    if not CLAVE_ADMIN or not authorization or not authorization.startswith("Bearer "):
        return False
    return hmac.compare_digest(authorization[len("Bearer "):].encode(), CLAVE_ADMIN.encode())


def requiere_admin(authorization: Annotated[str | None, Header()] = None):
    if not CLAVE_ADMIN:
        raise HTTPException(403, "La inscripción y el borrado están deshabilitados: "
                                 "el servidor no tiene CLAVE_ADMIN")
    if not authorization:
        raise HTTPException(401, "Falta la clave de administración")
    if not es_admin(authorization):
        raise HTTPException(401, "Clave de administración incorrecta")


Admin = Annotated[bool, Depends(es_admin)]


# --- Utilidades ------------------------------------------------------------

async def decodificar(fichero: UploadFile):
    """Devuelve la imagen o None si no es una imagen válida de tamaño aceptable."""
    datos = np.frombuffer(await fichero.read(), dtype=np.uint8)
    try:
        return cv2.imdecode(datos, cv2.IMREAD_COLOR)
    except cv2.error:
        return None


async def leer(fichero: UploadFile):
    img = await decodificar(fichero)
    if img is None:
        raise HTTPException(400, f"No se pudo leer la imagen {fichero.filename}: no es "
                                 f"una imagen válida o supera {MAX_PIXELES // 10**6} Mpx")
    return img


def cara_json(cara):
    return {
        "caja": [float(v) for v in cara[:4]],
        "puntos": cara[4:14].reshape(5, 2).tolist(),
        "confianza": float(cara[14]),
    }


def png_base64(img):
    ok, buf = cv2.imencode(".png", img)
    return "data:image/png;base64," + base64.b64encode(buf).decode()


def cara_principal(img):
    cara = sistema.detector.cara_principal(img)
    if cara is None:
        raise HTTPException(422, "No se ha detectado ninguna cara en la imagen")
    return cara


def ranking_json(ranking, admin):
    """Solo el administrador ve los scores."""
    return [{"id": u, "nombre": n, **({"score": s} if admin else {})} for u, n, s in ranking]


def bd_actual():
    """Base de datos al día: si otro proceso (la línea de órdenes, por ejemplo)
    ha cambiado los ficheros, se vuelven a cargar antes de usarlos."""
    sistema.bd.actualizar()
    return sistema.bd


def ruta_cara(id_usuario):
    # El id va codificado para que no pueda salirse del directorio.
    nombre = base64.urlsafe_b64encode(id_usuario.encode()).decode()
    return os.path.join(DIR_CARAS, f"{nombre}.png")


def comprobar_usuario(id_usuario):
    if not bd_actual().existe(id_usuario):
        raise HTTPException(404, f"El usuario {id_usuario} no está inscrito")


# --- Endpoints -------------------------------------------------------------

@app.get("/api/estado")
def estado(admin: Admin):
    with cerrojo:
        bd_actual()
        return {
            "detector": "YuNet (OpenCV)",
            "extractor": "LVFace-T (Glint360K)",
            "dimension": int(sistema.bd.embeddings.shape[1]),
            "umbral_defecto": UMBRAL,
            "usuarios": len(sistema.bd.usuarios()),
            "muestras": len(sistema.bd.ids),
            "integridad": {"correcta": sistema.bd.integra,
                           "problemas": sistema.bd.problemas},
            "escritura_habilitada": bool(CLAVE_ADMIN),
            # Si la clave enviada es la de administración; la interfaz web lo
            # usa para comprobar la clave antes de mostrar el rol.
            "admin": admin,
        }


@app.get("/api/usuarios")
def usuarios():
    with cerrojo:
        bd = bd_actual()
        res = {}
        for u, n, o, f in zip(bd.ids, bd.nombres, bd.origenes, bd.fechas):
            if u not in res:
                res[u] = {"id": u, "nombre": n, "muestras": [], "fecha": f}
            res[u]["muestras"].append(o)
            res[u]["fecha"] = max(res[u]["fecha"], f)
        for u in res.values():
            u["cara"] = os.path.exists(ruta_cara(u["id"]))
        return list(res.values())


# La cara inscrita basta para suplantar al usuario, así que solo la ve el
# administrador.
@app.get("/api/usuarios/{id_usuario}/cara", dependencies=[Depends(requiere_admin)])
def cara_usuario(id_usuario: str):
    ruta = ruta_cara(id_usuario)
    if not os.path.exists(ruta):
        raise HTTPException(404, "Este usuario no tiene cara guardada")
    return FileResponse(ruta, media_type="image/png",
                        headers={"Cache-Control": "no-cache"})


@app.delete("/api/usuarios/{id_usuario}", dependencies=[Depends(requiere_admin)])
def eliminar(id_usuario: str):
    with cerrojo:
        comprobar_usuario(id_usuario)
        borradas = sistema.eliminar(id_usuario)
        if os.path.exists(ruta_cara(id_usuario)):
            os.remove(ruta_cara(id_usuario))
        return {"id": id_usuario, "borradas": borradas}


@app.post("/api/inscribir", dependencies=[Depends(requiere_admin)])
async def inscribir(imagenes: Annotated[list[UploadFile], File()],
                    id: Annotated[str, Form()] = "", nombre: Annotated[str, Form()] = ""):
    id, nombre = id.strip(), nombre.strip()
    if not id or not nombre:
        raise HTTPException(400, "El id y el nombre son obligatorios")
    # El id va en las rutas /api/usuarios/{id}: con "/" o como "." o ".." no
    # podría consultarse ni borrarse después.
    if "/" in id or id in (".", ".."):
        raise HTTPException(400, "El id no puede contener '/' ni ser '.' o '..'")
    # Las imágenes ilegibles se descartan igual que las que no tienen cara.
    lista, ilegibles = [], []
    for i, f in enumerate(imagenes):
        origen = f.filename or f"muestra_{i + 1}"
        img = await decodificar(f)
        if img is None:
            ilegibles.append(origen)
        else:
            lista.append((origen, img))
    with cerrojo:
        try:
            validas, sin_cara = sistema.inscribir_varias(id, nombre, lista)
        except ValueError as e:
            raise HTTPException(409, str(e))
    if not validas:
        raise HTTPException(422, "Ninguna imagen era legible y tenía una cara detectable")
    descartadas = ilegibles + sin_cara

    # Cara alineada de la primera muestra con cara, como avatar del usuario.
    # Se busca por imagen y no por nombre de fichero, que puede repetirse.
    alineada = None
    for _, img in lista:
        cara = sistema.detector.cara_principal(img)
        if cara is not None:
            alineada = alinear(img, cara, tam=256)
            break
    with cerrojo:
        if not os.path.exists(ruta_cara(id)):
            os.makedirs(DIR_CARAS, exist_ok=True)
            cv2.imwrite(ruta_cara(id), alineada)
    return {"id": id, "nombre": nombre, "validas": validas,
            "descartadas": descartadas, "cara": png_base64(alineada)}


# La similitud coseno va de -1 a 1; NaN o infinito no son umbrales válidos.
Umbral = Annotated[float, Form(ge=-1, le=1, allow_inf_nan=False)]


@app.post("/api/verificar")
async def verificar(id: Annotated[str, Form()],
                    imagen: Annotated[UploadFile, File()],
                    admin: Admin, umbral: Umbral = UMBRAL):
    # Solo el administrador elige el umbral: si no, cualquiera podría pedir
    # umbral=-1 y ser aceptado como cualquier usuario.
    umbral = umbral if admin else UMBRAL
    img = await leer(imagen)
    with cerrojo:
        comprobar_usuario(id)
        if not admin:
            sistema.comprobar_bloqueo(id)
        cara = cara_principal(img)
        alineada = alinear(img, cara)
        score = sistema.comparar(sistema.extractor.extraer(alineada), id)
        aceptado = sistema.aceptar(score, umbral)
        if not admin:
            sistema.registrar_intento(id, aceptado)
        nombre = sistema.bd.nombre(id)
    return {
        "id": id, "nombre": nombre, "umbral": umbral, "aceptado": aceptado,
        **({"score": score} if admin else {}),
        "sospecha_replay": score >= LIMITE_REPLAY,
        "cara": cara_json(cara), "alineada": png_base64(alineada),
    }


@app.post("/api/identificar")
async def identificar(imagen: Annotated[UploadFile, File()],
                      admin: Admin, umbral: Umbral = UMBRAL,
                      top: Annotated[int, Form(ge=1)] = 5,
                      todas: Annotated[bool, Form()] = False):
    """Identifica la cara principal o, con todas=true, cada cara de la imagen.
    Sin la clave de administración solo se devuelve la persona identificada."""
    umbral = umbral if admin else UMBRAL
    img = await leer(imagen)
    with cerrojo:
        if not bd_actual().ids:
            raise HTTPException(409, "La base de datos está vacía")
        caras = sistema.detector.detectar(img)
        if len(caras) == 0:
            raise HTTPException(422, "No se ha detectado ninguna cara en la imagen")
        caras = sorted(caras, key=lambda c: -c[2] * c[3])
        if not todas:
            caras = caras[:1]
        resultados = []
        for i, cara in enumerate(caras):
            alineada = alinear(img, cara)
            ranking = sistema.ranking(sistema.extractor.extraer(alineada),
                                      top if admin else 1)
            mejor = ranking[0] if sistema.aceptar(ranking[0][2], umbral) else None
            resultados.append({
                "cara": cara_json(cara),
                "identificado": ranking_json([mejor], admin)[0] if mejor else None,
                "sospecha_replay": ranking[0][2] >= LIMITE_REPLAY,
                # El orden de los candidatos guía una búsqueda de caja negra
                # aunque no lleve scores: solo lo ve el administrador.
                "ranking": ranking_json(ranking, admin) if admin else [],
                # Solo se devuelve el recorte de la cara principal.
                "alineada": png_base64(alineada) if i == 0 else None,
            })
    return {"umbral": umbral, "resultados": resultados}


@app.post("/api/detectar")
async def detectar(imagen: Annotated[UploadFile, File()]):
    img = await leer(imagen)
    with cerrojo:
        caras = sistema.detector.detectar(img)
    alto, ancho = img.shape[:2]
    return {"ancho": ancho, "alto": alto, "caras": [cara_json(c) for c in caras]}
