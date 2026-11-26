"""Sistema biométrico facial: inscripción, verificación e identificación.

Cada operación existe en tres variantes, según cuánto del sistema se omite:
- normal: detector -> alineación -> extractor -> comparador.
- _sd (sin detector): la imagen se trata como una cara ya recortada y alineada,
  y va directa al extractor.
- _t (template): se recibe directamente el vector de 512 dimensiones, tal como
  lo produce el extractor; se omiten el detector y el extractor.

Las firmas siguen las del enunciado de la práctica: inscribir(id, foto),
verificar(id, foto), identificar(foto) y sus variantes _sd y _t. La foto puede
ser una imagen BGR (array de numpy) o la ruta de un fichero.

Los vectores se guardan y se comparan protegidos con una rotación secreta por
usuario (ver proteccion.py), así que el sistema necesita la clave
CLAVE_PLANTILLAS.

Tras MAX_FALLOS verificaciones fallidas seguidas contra una misma identidad,
esa identidad se bloquea durante BLOQUEO_SEGUNDOS.
El estado del bloqueo se guarda en RUTA_BLOQUEOS, así que se conserva aunque se
reinicie el proceso.
"""
import json
import os
import time

import cv2
import numpy as np

from .base_datos import DIM, BaseDatosCSV
from .detector import DetectorCaras, alinear
from .extractor import ExtractorLVFace
from .proteccion import clave_de_entorno, clave_firmas, comprobar_clave, rotacion_usuario

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELO_DETECTOR = os.path.join(RAIZ, "modelos", "face_detection_yunet_2023mar.onnx")
MODELO_LVFACE = os.path.join(RAIZ, "modelos", "LVFace-T_Glint360K.onnx")
# En Docker, la base de datos está en el volumen /datos (variable BD_RUTA).
RUTA_BD = os.environ.get("BD_RUTA", os.path.join(RAIZ, "datos", "base_datos.csv"))
# Última versión de la base de datos que ha visto el sistema, fuera de datos/
# para que quien pueda escribir allí no pueda restaurar una copia antigua.
RUTA_VERSION_BD = os.environ.get("RUTA_VERSION_BD",
                                 os.path.join(RAIZ, "estado", "version_bd"))
# Fallos seguidos y bloqueos de cada identidad, también fuera de datos/.
RUTA_BLOQUEOS = os.environ.get("RUTA_BLOQUEOS",
                               os.path.join(RAIZ, "estado", "bloqueos.json"))

# Umbral de similitud coseno para aceptar.
UMBRAL = 0.35

# Dos capturas reales de una cara nunca dan el mismo vector, así que un score
# igual o superior a este límite se trata como un posible replay de un template
# robado y se rechaza.
LIMITE_REPLAY = 0.99

MAX_FALLOS = 5
BLOQUEO_SEGUNDOS = 300


class SinCara(Exception):
    pass


class UsuarioBloqueado(Exception):
    pass


class SistemaBiometrico:
    def __init__(self, ruta_bd=RUTA_BD, umbral=UMBRAL,
                 modelo_detector=MODELO_DETECTOR, modelo_lvface=MODELO_LVFACE,
                 clave=None, ruta_version=RUTA_VERSION_BD, max_fallos=MAX_FALLOS,
                 ruta_bloqueos=RUTA_BLOQUEOS):
        """ruta_version=None desactiva la comprobación de rollback,
        max_fallos=None el bloqueo y ruta_bloqueos=None guarda el bloqueo solo
        en memoria; los scripts de evaluación los usan así para no tocar el
        estado real."""
        for ruta in (modelo_detector, modelo_lvface):
            if not os.path.exists(ruta):
                raise FileNotFoundError(f"Falta el modelo {ruta}")
        self.detector = DetectorCaras(modelo_detector)
        self.extractor = ExtractorLVFace(modelo_lvface)
        self._clave = clave or clave_de_entorno()
        comprobar_clave(self._clave)
        self._rotaciones = {}
        self.bd = BaseDatosCSV(ruta_bd, clave_firmas(self._clave), ruta_version)
        self.umbral = umbral
        self.max_fallos = max_fallos
        self.ruta_bloqueos = ruta_bloqueos
        # id -> (fallos seguidos, instante Unix hasta el que está bloqueado)
        self.fallos = self._leer_bloqueos()

    # --- Extracción --------------------------------------------------------

    @staticmethod
    def imagen(foto):
        """Devuelve la imagen BGR de foto, que puede ser ya una imagen o una ruta."""
        if not isinstance(foto, (str, os.PathLike)):
            return foto
        if not os.path.isfile(foto):
            raise FileNotFoundError(f"No existe el fichero {foto}")
        # imdecode en lugar de imread para admitir rutas con tildes o ñ.
        img = cv2.imdecode(np.fromfile(foto, dtype=np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError(f"No se pudo leer la imagen {foto}")
        return img

    def embedding_de_cara(self, img, cara):
        return self.extractor.extraer(alinear(img, cara))

    def embedding(self, img):
        """Detecta la cara principal de la imagen y extrae su vector."""
        img = self.imagen(img)
        cara = self.detector.cara_principal(img)
        if cara is None:
            raise SinCara("No se ha detectado ninguna cara")
        return self.embedding_de_cara(img, cara)

    def embedding_sd(self, img):
        """Extrae el vector sin detector: la imagen entera se toma como una cara
        ya recortada y alineada (el extractor la redimensiona a 112x112)."""
        return self.extractor.extraer(self.imagen(img))

    def rotacion(self, id_usuario):
        """Rotación secreta de un usuario (se calcula una vez por usuario)."""
        if id_usuario not in self._rotaciones:
            self._rotaciones[id_usuario] = rotacion_usuario(self._clave, id_usuario, DIM)
        return self._rotaciones[id_usuario]

    def proteger(self, emb, id_usuario):
        """Rota un vector del extractor al espacio en el que se guarda y compara
        la plantilla de id_usuario."""
        return self.rotacion(id_usuario) @ emb

    @staticmethod
    def template(vector):
        """Valida un template recibido desde fuera y lo normaliza (norma L2 = 1),
        igual que los vectores que produce el extractor."""
        t = np.asarray(vector, dtype=np.float32).reshape(-1)
        if t.shape != (DIM,):
            raise ValueError(f"El template debe tener {DIM} valores, no {t.size}")
        if not np.all(np.isfinite(t)):
            raise ValueError("El template contiene valores no finitos")
        norma = np.linalg.norm(t)
        if norma == 0:
            raise ValueError("El template es el vector nulo")
        return t / norma

    # --- Inscripción -------------------------------------------------------

    def _inscribir(self, id_usuario, nombre, muestras, a_embedding, guardar):
        """Inscribe [(origen, muestra)] convirtiendo cada muestra con a_embedding.
        Devuelve (nº de muestras válidas, orígenes descartados por no tener cara)."""
        self.bd.actualizar()
        # Antes de tocar nada en memoria: con la base de datos comprometida no se escribe.
        self.bd.comprobar_escritura()
        if self.bd.existe(id_usuario) and self.bd.nombre(id_usuario) != nombre:
            raise ValueError(f"El id {id_usuario} ya pertenece a "
                             f"{self.bd.nombre(id_usuario)}")
        nuevas, descartadas = [], []
        for origen, muestra in muestras:
            try:
                emb = a_embedding(muestra)
            except SinCara:
                descartadas.append(origen)
                continue
            nuevas.append((origen, self.proteger(emb, id_usuario)))
        # Muestras que se anulan entre sí (un template y su opuesto, por ejemplo)
        # darían una plantilla nula, sin dirección con la que comparar.
        previas = [i for i, u in enumerate(self.bd.ids) if u == id_usuario]
        suma = (self.bd.embeddings[previas].sum(axis=0)
                + sum((v for _, v in nuevas), np.zeros(DIM, np.float32)))
        if nuevas and np.linalg.norm(suma) < 1e-6 * (len(previas) + len(nuevas)):
            raise ValueError("Las muestras se anulan entre sí: la plantilla sería el "
                             "vector nulo")
        for origen, emb in nuevas:
            self.bd.anadir(id_usuario, nombre, origen, emb)
        if guardar and nuevas:
            self.bd.guardar()
        return len(nuevas), descartadas

    def inscribir_varias(self, id_usuario, nombre, imagenes, guardar=True):
        """Inscribe a un usuario con una o varias imágenes [(origen, foto)].
        Si ya existe, las muestras se añaden a las que tenía. Devuelve
        (nº de muestras válidas, orígenes descartados por no tener cara)."""
        return self._inscribir(id_usuario, nombre, imagenes, self.embedding, guardar)

    @staticmethod
    def _origen(foto, por_defecto):
        return os.path.basename(foto) if isinstance(foto, (str, os.PathLike)) else por_defecto

    def inscribir(self, id_usuario, foto, nombre=None, guardar=True):
        """Inscribe a una persona con una foto; el nombre es el id si no se da.
        Si ya existe, la muestra se añade a las que tenía."""
        validas, _ = self.inscribir_varias(id_usuario, nombre or id_usuario,
                                           [(self._origen(foto, "foto"), foto)], guardar)
        if not validas:
            raise SinCara("No se ha detectado ninguna cara")

    def inscribir_sd(self, id_usuario, foto, nombre=None, guardar=True):
        """Como inscribir, pero la foto es ya una cara recortada y alineada."""
        self._inscribir(id_usuario, nombre or id_usuario,
                        [(self._origen(foto, "foto"), foto)], self.embedding_sd, guardar)

    def inscribir_t(self, id_usuario, template, nombre=None, guardar=True):
        """Como inscribir, pero con un template de 512 valores."""
        self._inscribir(id_usuario, nombre or id_usuario, [("template", template)],
                        self.template, guardar)

    def eliminar(self, id_usuario):
        self.bd.actualizar()
        self.bd.comprobar_escritura()
        borradas = self.bd.eliminar(id_usuario)
        if borradas:
            self.bd.guardar()
        return borradas

    # --- Verificación (1:1) ------------------------------------------------

    def comparar(self, emb, id_usuario):
        """Similitud coseno entre un vector del extractor y la plantilla guardada."""
        self.bd.actualizar()
        return float(self.bd.plantilla(id_usuario) @ self.proteger(emb, id_usuario))

    def aceptar(self, score, umbral=None):
        """Decisión para un score: supera el umbral sin ser sospechoso de replay."""
        umbral = self.umbral if umbral is None else umbral
        return umbral <= score < LIMITE_REPLAY

    def _leer_bloqueos(self):
        if not self.ruta_bloqueos or not os.path.exists(self.ruta_bloqueos):
            return {}
        try:
            with open(self.ruta_bloqueos, encoding="utf-8") as f:
                return {u: (int(n), float(h)) for u, (n, h) in json.load(f).items()}
        except (ValueError, TypeError, AttributeError):
            return {}

    def _guardar_bloqueos(self):
        if not self.ruta_bloqueos:
            return
        os.makedirs(os.path.dirname(os.path.abspath(self.ruta_bloqueos)), exist_ok=True)
        temporal = self.ruta_bloqueos + ".tmp"
        with open(temporal, "w", encoding="utf-8") as f:
            json.dump(self.fallos, f)
        os.replace(temporal, self.ruta_bloqueos)

    def comprobar_bloqueo(self, id_usuario):
        if not self.max_fallos:
            return
        _, hasta = self.fallos.get(id_usuario, (0, 0.0))
        restante = hasta - time.time()
        if restante > 0:
            raise UsuarioBloqueado(
                f"Demasiados intentos fallidos para {id_usuario}: "
                f"inténtalo de nuevo en {int(restante) + 1} s")

    def registrar_intento(self, id_usuario, aceptado):
        if not self.max_fallos:
            return
        if aceptado:
            if self.fallos.pop(id_usuario, None) is not None:
                self._guardar_bloqueos()
            return
        seguidos = self.fallos.get(id_usuario, (0, 0.0))[0] + 1
        if seguidos >= self.max_fallos:
            self.fallos[id_usuario] = (0, time.time() + BLOQUEO_SEGUNDOS)
        else:
            self.fallos[id_usuario] = (seguidos, 0.0)
        self._guardar_bloqueos()

    def verificar_embedding(self, emb, id_usuario, contar_fallos=True):
        """¿Es este vector de quien dice ser? -> (aceptado, score).
        Con contar_fallos=False (administración) no se aplica el bloqueo."""
        self.bd.actualizar()
        if not self.bd.existe(id_usuario):
            raise KeyError(f"El usuario {id_usuario} no está inscrito")
        if contar_fallos:
            self.comprobar_bloqueo(id_usuario)
        score = self.comparar(emb, id_usuario)
        aceptado = self.aceptar(score)
        if contar_fallos:
            self.registrar_intento(id_usuario, aceptado)
        return aceptado, score

    def verificar(self, id_usuario, foto, contar_fallos=True):
        """¿Es la persona de la foto quien dice ser? -> (aceptado, score)."""
        return self.verificar_embedding(self.embedding(foto), id_usuario, contar_fallos)

    def verificar_sd(self, id_usuario, foto, contar_fallos=True):
        """Como verificar, pero la foto es ya una cara recortada y alineada."""
        return self.verificar_embedding(self.embedding_sd(foto), id_usuario, contar_fallos)

    def verificar_t(self, id_usuario, template, contar_fallos=True):
        """Como verificar, pero con un template de 512 valores."""
        return self.verificar_embedding(self.template(template), id_usuario, contar_fallos)

    # --- Identificación (1:N) ----------------------------------------------

    def ranking(self, emb, top=5):
        """Lista [(id, nombre, score)] ordenada de mayor a menor similitud."""
        self.bd.actualizar()
        ids, plantillas = self.bd.plantillas()
        if not ids:
            return []
        # Cada plantilla está rotada con la rotación de su usuario.
        scores = np.array([p @ self.proteger(emb, u) for u, p in zip(ids, plantillas)])
        orden = scores.argsort()[::-1][:top]
        return [(ids[i], self.bd.nombre(ids[i]), float(scores[i])) for i in orden]

    def identificar_embedding(self, emb, top=5):
        """Devuelve (mejor candidato o None si no se acepta, ranking)."""
        ranking = self.ranking(emb, top)
        if ranking and self.aceptar(ranking[0][2]):
            return ranking[0], ranking
        return None, ranking

    def identificar(self, foto, top=5):
        return self.identificar_embedding(self.embedding(foto), top)

    def identificar_sd(self, foto, top=5):
        """Como identificar, pero la foto es ya una cara recortada y alineada."""
        return self.identificar_embedding(self.embedding_sd(foto), top)

    def identificar_t(self, template, top=5):
        """Como identificar, pero con un template de 512 valores."""
        return self.identificar_embedding(self.template(template), top)
