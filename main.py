"""Sistema biométrico facial (YuNet + LVFace + base de datos CSV).

Uso:
  python main.py detectar foto.jpg [--salida caras.jpg] | cam
  python main.py inscribir --id 01 --nombre "Ana" foto1.jpg foto2.jpg | cam
  python main.py inscribir-carpeta dataset/
  python main.py verificar --id 01 foto.jpg | cam
  python main.py identificar foto.jpg | cam
  python main.py listar
  python main.py eliminar --id 01

La línea de órdenes es la herramienta del operador: necesita la clave de las
plantillas y acceso directo a los ficheros de la base de datos, más de lo que
da la clave de administración de la API. Por eso, como la administración,
muestra los scores y sus verificaciones no cuentan para el bloqueo.
"""
import argparse
import glob
import os
import sys

import cv2
import numpy as np

from biometria import BDComprometida, LIMITE_REPLAY, SistemaBiometrico, SinCara, UMBRAL
from biometria.detector import dibujar

EXTENSIONES = (".jpg", ".jpeg", ".png", ".bmp", ".pgm", ".tif", ".tiff")
VERDE, ROJO = (0, 255, 0), (0, 0, 255)


def leer_imagen(ruta):
    if not os.path.isfile(ruta):
        sys.exit(f"No existe el fichero {ruta}")
    # imdecode en lugar de imread para soportar rutas con tildes/ñ.
    img = cv2.imdecode(np.fromfile(ruta, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        sys.exit(f"No se pudo abrir {ruta}")
    return img


def abrir_camara():
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        sys.exit("No se pudo abrir la webcam")
    return cap


def bucle_camara(procesar, titulo):
    """Muestra la webcam aplicando procesar(frame) -> frame anotado.
    procesar puede devolver None para terminar. 'q' sale."""
    cap = abrir_camara()
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            tecla = cv2.waitKey(1) & 0xFF
            if tecla == ord("q"):
                break
            salida = procesar(frame, tecla)
            if salida is None:
                break
            cv2.imshow(titulo, salida)
    finally:
        cap.release()
        cv2.destroyAllWindows()


# --- Comandos --------------------------------------------------------------

def cmd_detectar(sistema, args):
    det = sistema.detector
    if args.fuente != "cam":
        img = leer_imagen(args.fuente)
        caras = det.detectar(img)
        print(f"Caras detectadas: {len(caras)}")
        dibujar(img, caras)
        if args.salida:
            cv2.imwrite(args.salida, img)
            print(f"Imagen con las detecciones guardada en {args.salida}")
        try:
            cv2.imshow("Deteccion de caras", img)
            cv2.waitKey(0)
            cv2.destroyAllWindows()
        except cv2.error:
            # Sin interfaz gráfica (p. ej. dentro de Docker) no hay ventana.
            if not args.salida:
                print("No se puede abrir una ventana; usa --salida para guardar la imagen")
    else:
        bucle_camara(lambda f, _: dibujar(f, det.detectar(f)),
                     "Deteccion de caras (q para salir)")


def cmd_inscribir(sistema, args):
    if args.fuentes == ["cam"]:
        capturas = []

        def procesar(frame, tecla):
            cara = sistema.detector.cara_principal(frame)
            if tecla == ord(" ") and cara is not None:
                capturas.append((f"webcam_{len(capturas) + 1}", frame.copy()))
                print(f"  captura {len(capturas)}/{args.muestras}")
                if len(capturas) >= args.muestras:
                    return None
            vista = frame.copy()
            if cara is not None:
                dibujar(vista, [cara], [f"{len(capturas)}/{args.muestras}"])
            return vista

        print(f"Pulsa ESPACIO para capturar {args.muestras} muestras (q cancela)")
        bucle_camara(procesar, "Inscripcion")
        imagenes = capturas
    else:
        imagenes = [(os.path.basename(r), leer_imagen(r)) for r in args.fuentes]

    try:
        n, descartadas = sistema.inscribir_varias(args.id, args.nombre, imagenes)
    except ValueError as e:
        sys.exit(str(e))
    for origen in descartadas:
        print(f"  [aviso] sin cara en {origen}, se descarta")
    if n:
        print(f"Inscrito {args.nombre} (id {args.id}) con {n} muestra(s)")
    else:
        sys.exit("No se ha inscrito nada: ninguna imagen tenía cara")


def cmd_inscribir_carpeta(sistema, args):
    """Una subcarpeta por persona; su nombre se usa como id y como nombre.
    Las fotos que ya estaban inscritas para esa persona no se repiten."""
    if not os.path.isdir(args.carpeta):
        sys.exit(f"No existe la carpeta {args.carpeta}")
    carpetas = sorted(d for d in os.listdir(args.carpeta)
                      if os.path.isdir(os.path.join(args.carpeta, d)))
    if not carpetas:
        sys.exit(f"No hay subcarpetas en {args.carpeta}")
    usuarios, total = 0, 0
    for id_usuario in carpetas:
        ya_inscritas = {o for u, o in zip(sistema.bd.ids, sistema.bd.origenes)
                        if u == id_usuario}
        rutas = sorted(r for r in glob.glob(os.path.join(args.carpeta, id_usuario, "*"))
                       if r.lower().endswith(EXTENSIONES)
                       and os.path.relpath(r, args.carpeta) not in ya_inscritas)
        imagenes = [(os.path.relpath(r, args.carpeta), leer_imagen(r)) for r in rutas]
        try:
            n, descartadas = sistema.inscribir_varias(id_usuario, id_usuario, imagenes,
                                                      guardar=False)
        except ValueError as e:
            print(f"  [aviso] {e}, se omite la carpeta")
            continue
        for origen in descartadas:
            print(f"  [aviso] sin cara en {origen}, se descarta")
        usuarios += n > 0
        total += n
        print(f"{id_usuario:<30} {n}/{len(rutas)} muestras nuevas")
    sistema.bd.guardar()
    print(f"\n{usuarios} usuarios con muestras nuevas, {total} muestras -> {sistema.bd.ruta}")


def cmd_verificar(sistema, args):
    if not sistema.bd.existe(args.id):
        sys.exit(f"El usuario {args.id} no está inscrito")
    nombre = sistema.bd.nombre(args.id)

    if args.fuente != "cam":
        try:
            aceptado, score = sistema.verificar(args.id, leer_imagen(args.fuente),
                                                contar_fallos=False)
        except SinCara as e:
            sys.exit(str(e))
        veredicto = "ACEPTADO" if aceptado else "RECHAZADO"
        print(f"{veredicto}: ¿es {nombre} ({args.id})? "
              f"score = {score:.4f} (umbral {sistema.umbral})")
        if score >= LIMITE_REPLAY:
            print(f"  coincidencia casi perfecta (≥ {LIMITE_REPLAY}): posible replay")
        sys.exit(0 if aceptado else 1)

    def procesar(frame, _):
        cara = sistema.detector.cara_principal(frame)
        if cara is not None:
            score = sistema.comparar(sistema.embedding_de_cara(frame, cara), args.id)
            ok = sistema.aceptar(score)
            texto = f"{nombre} {'OK' if ok else 'NO'} {score:.2f}"
            dibujar(frame, [cara], [texto], VERDE if ok else ROJO)
        return frame

    bucle_camara(procesar, f"Verificacion de {nombre} (q para salir)")


def cmd_identificar(sistema, args):
    if not sistema.bd.ids:
        sys.exit("La base de datos está vacía")

    if args.fuente != "cam":
        try:
            mejor, ranking = sistema.identificar(leer_imagen(args.fuente), args.top)
        except SinCara as e:
            sys.exit(str(e))
        for i, (u, n, s) in enumerate(ranking, 1):
            print(f"  {i}. {n:<25} (id {u})  score = {s:.4f}")
        if mejor:
            print(f"IDENTIFICADO: {mejor[1]} (id {mejor[0]})")
        elif ranking and ranking[0][2] >= LIMITE_REPLAY:
            print(f"NO IDENTIFICADO: coincidencia casi perfecta (≥ {LIMITE_REPLAY}), "
                  f"posible replay")
        else:
            print(f"NO IDENTIFICADO: ningún score supera el umbral {sistema.umbral}")
        return

    def procesar(frame, _):
        caras = sistema.detector.detectar(frame)
        for cara in caras:
            emb = sistema.embedding_de_cara(frame, cara)
            mejor, ranking = sistema.identificar_embedding(emb, top=1)
            if mejor:
                dibujar(frame, [cara], [f"{mejor[1]} {mejor[2]:.2f}"], VERDE)
            else:
                dibujar(frame, [cara], [f"desconocido {ranking[0][2]:.2f}"], ROJO)
        return frame

    bucle_camara(procesar, "Identificacion (q para salir)")


def cmd_listar(sistema, args):
    usuarios = sistema.bd.usuarios()
    if not usuarios:
        print("La base de datos está vacía")
        return
    for u, (n, m) in usuarios.items():
        print(f"{u:>8}  {n:<25} {m} muestra(s)")
    print(f"\nTotal: {len(usuarios)} usuarios")


def cmd_eliminar(sistema, args):
    n = sistema.eliminar(args.id)
    print(f"Eliminadas {n} muestras de {args.id}" if n
          else f"El usuario {args.id} no existe")


def main():
    p = argparse.ArgumentParser(description="Sistema biométrico facial con LVFace")
    p.add_argument("--umbral", type=float, default=UMBRAL,
                   help=f"umbral de similitud coseno (por defecto {UMBRAL})")
    p.add_argument("--bd", help="ruta del CSV de la base de datos")
    sub = p.add_subparsers(dest="comando", required=True)

    s = sub.add_parser("detectar", help="solo detección de caras")
    s.add_argument("fuente", nargs="?", default="cam", help="imagen o 'cam'")
    s.add_argument("--salida", help="guarda la imagen con las detecciones aquí")
    s.set_defaults(func=cmd_detectar)

    s = sub.add_parser("inscribir", help="inscribe a un usuario")
    s.add_argument("--id", required=True)
    s.add_argument("--nombre", required=True)
    s.add_argument("--muestras", type=int, default=3,
                   help="nº de capturas con webcam")
    s.add_argument("fuentes", nargs="+", help="imágenes o 'cam'")
    s.set_defaults(func=cmd_inscribir)

    s = sub.add_parser("inscribir-carpeta",
                       help="inscribe un dataset (una subcarpeta por persona)")
    s.add_argument("carpeta")
    s.set_defaults(func=cmd_inscribir_carpeta)

    s = sub.add_parser("verificar", help="verificación 1:1")
    s.add_argument("--id", required=True)
    s.add_argument("fuente", nargs="?", default="cam", help="imagen o 'cam'")
    s.set_defaults(func=cmd_verificar)

    s = sub.add_parser("identificar", help="identificación 1:N")
    s.add_argument("--top", type=int, default=5)
    s.add_argument("fuente", nargs="?", default="cam", help="imagen o 'cam'")
    s.set_defaults(func=cmd_identificar)

    s = sub.add_parser("listar", help="lista los usuarios inscritos")
    s.set_defaults(func=cmd_listar)

    s = sub.add_parser("eliminar", help="elimina un usuario")
    s.add_argument("--id", required=True)
    s.set_defaults(func=cmd_eliminar)

    args = p.parse_args()
    opciones = {"umbral": args.umbral}
    if args.bd:
        opciones["ruta_bd"] = args.bd
    try:
        args.func(SistemaBiometrico(**opciones), args)
    except BDComprometida as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
