"""Base de datos de plantillas biométricas en CSV, firmada con HMAC.

Una fila por muestra inscrita:
    id_usuario, nombre, origen, fecha, e0, e1, ..., e511, firma
Un usuario puede tener varias muestras; su plantilla es la media de todas.

Integridad:
- Cada fila lleva en `firma` un HMAC-SHA256 de todo su contenido, así que no se
  puede cambiar el id de una fila ni copiarla a otro usuario sin la clave.
- El fichero `<nombre>.firma`, junto al CSV, guarda el número de versión de la
  base de datos y un HMAC de esa versión y del conjunto de las firmas de las
  filas, en orden, que detecta las filas borradas o añadidas. Cada vez que se
  guarda, la versión aumenta.
- La última versión vista se guarda en otro fichero, fuera de la carpeta de
  datos (`ruta_version`). Una base de datos con una versión anterior es una
  versión antigua restaurada (rollback). La primera vez, o si el fichero no
  existe, se confía en la versión encontrada.
Al cargar, las filas mal formadas o con la firma incorrecta se descartan con un
aviso. Si algo no cuadra, la base de datos queda marcada como comprometida: se
puede seguir consultando con las filas válidas, pero no se escribe en ella,
porque guardar volvería a firmarla y ocultaría la manipulación. Un fichero
ilegible (bytes que no son UTF-8, un CSV mal formado, una versión que no es un
número) cuenta también como manipulación: nunca detiene la carga ni deja la base
de datos a medio leer y dada por íntegra.

Si otro proceso (la línea de órdenes y la API, por ejemplo) modifica los
ficheros, actualizar() los vuelve a cargar, con todas las comprobaciones, antes
de usarlos. Así un proceso no trabaja con una copia antigua ni la escribe encima
de la nueva.
"""
import csv
import hashlib
import hmac
import json
import os
import sys
from datetime import datetime

import numpy as np

DIM = 512
CABECERA = (["id_usuario", "nombre", "origen", "fecha"]
            + [f"e{i}" for i in range(DIM)] + ["firma"])


class BDComprometida(Exception):
    pass


def _entero(texto):
    """El número escrito en `texto`, o None si no es un entero válido. Solo admite
    cifras ASCII: isdigit() también acepta otras, como «²», que int() rechaza, e
    int() no convierte números de más de 4300 cifras."""
    if texto.isascii() and texto.isdigit() and len(texto) <= 18:
        return int(texto)
    return None


def _firmas_iguales(a, b):
    """Compara dos firmas en tiempo constante. compare_digest no admite texto con
    caracteres no ASCII, que pueden venir de un fichero manipulado, así que se
    comparan sus bytes."""
    return hmac.compare_digest(a.encode(), b.encode())


class BaseDatosCSV:
    def __init__(self, ruta, clave_firmas, ruta_version=None):
        self.ruta = ruta
        self.ruta_firma = os.path.splitext(ruta)[0] + ".firma"
        self.clave = clave_firmas
        self.ruta_version = ruta_version
        self._leer()

    def _leer(self):
        self._vaciar()
        self.problemas = []
        self._sello = self._sello_ficheros()
        try:
            self._cargar()
        except Exception as e:
            # Un fichero manipulado no puede interrumpir la carga: la API seguiría
            # con la base de datos a medio leer, sin problemas anotados y, como el
            # sello ya es el nuevo, sin volver a leerla. Se descarta lo leído.
            self._vaciar()
            self.problemas.append(f"no se puede leer ({type(e).__name__}: {e})")
        self._comprobar_version()
        for problema in self.problemas:
            print(f"[integridad] {self.ruta}: {problema}", file=sys.stderr)

    def _vaciar(self):
        self.version = 0
        self.ids, self.nombres, self.origenes, self.fechas = [], [], [], []
        self.embeddings = np.empty((0, DIM), dtype=np.float32)

    def _sello_ficheros(self):
        """Instante de modificación y tamaño del CSV y de su firma."""
        return tuple((os.stat(r).st_mtime_ns, os.stat(r).st_size) if os.path.exists(r)
                     else None for r in (self.ruta, self.ruta_firma))

    def actualizar(self):
        """Vuelve a cargar los ficheros si han cambiado desde que se leyeron."""
        if self._sello_ficheros() != self._sello:
            self._leer()

    # --- Firmas ------------------------------------------------------------

    def _hmac(self, datos):
        return hmac.new(self.clave, datos.encode(), hashlib.sha256).hexdigest()

    def _firmar_fila(self, campos):
        # La lista se codifica en JSON, que delimita y escapa cada campo: dos
        # filas distintas no pueden dar el mismo texto firmado, contengan lo
        # que contengan sus campos.
        return self._hmac(json.dumps(campos, ensure_ascii=False))

    def _firmar_bd(self, firmas_filas, version):
        return self._hmac("\n".join([str(version)] + firmas_filas))

    @property
    def integra(self):
        return not self.problemas

    def comprobar_escritura(self):
        if self.problemas:
            raise BDComprometida(
                "La base de datos no ha superado la comprobación de integridad ("
                + "; ".join(self.problemas) + "). No se escribe en ella para no "
                "ocultar la manipulación: restaura una copia de confianza.")

    # --- Carga y guardado --------------------------------------------------

    def _cargar(self):
        if not os.path.exists(self.ruta):
            if os.path.exists(self.ruta_firma):
                self.problemas.append("falta el CSV, pero existe su firma")
            return
        # Con errors="replace", un byte que no es UTF-8 cambia el texto de su fila,
        # que deja de coincidir con su firma, en vez de impedir leer el fichero.
        with open(self.ruta, newline="", encoding="utf-8", errors="replace") as f:
            lector = csv.reader(f)
            cabecera, lineas = None, []
            try:
                cabecera = next(lector, None)
                for fila in lector:
                    lineas.append(fila)
            except csv.Error as e:
                # Se conservan las filas anteriores; las siguientes se pierden.
                self.problemas.append(f"línea {lector.line_num}: CSV mal formado ({e})")
        if cabecera != CABECERA:
            self.problemas.append("la cabecera no es la esperada")

        firmas, vectores = [], []
        for n, fila in enumerate(lineas, start=2):
            if len(fila) != len(CABECERA):
                self.problemas.append(f"fila {n}: número de columnas incorrecto")
                continue
            firmas.append(fila[-1])
            if not _firmas_iguales(self._firmar_fila(fila[:-1]), fila[-1]):
                self.problemas.append(f"fila {n}: firma no válida")
                continue
            try:
                vector = [float(v) for v in fila[4:-1]]
            except ValueError:
                self.problemas.append(f"fila {n}: valores no numéricos")
                continue
            self.ids.append(fila[0])
            self.nombres.append(fila[1])
            self.origenes.append(fila[2])
            self.fechas.append(fila[3])
            vectores.append(vector)
        if vectores:
            self.embeddings = np.array(vectores, dtype=np.float32)

        if not os.path.exists(self.ruta_firma):
            if lineas:
                self.problemas.append("falta la firma de la base de datos")
            return
        with open(self.ruta_firma, encoding="utf-8", errors="replace") as f:
            partes = f.read().split()
        version = _entero(partes[0]) if len(partes) == 2 else None
        if version is None:
            self.problemas.append("la firma de la base de datos no tiene el formato esperado")
            return
        self.version = version
        if not _firmas_iguales(self._firmar_bd(firmas, self.version), partes[1]):
            self.problemas.append("la firma de la base de datos no coincide "
                                  "(filas borradas, añadidas o reordenadas)")

    def _comprobar_version(self):
        if not self.ruta_version:
            return
        vista = None
        if os.path.exists(self.ruta_version):
            with open(self.ruta_version, encoding="utf-8", errors="replace") as f:
                vista = _entero(f.read().strip())
        if vista is not None and self.version < vista:
            self.problemas.append(f"la versión {self.version} es anterior a la última "
                                  f"vista ({vista}): posible rollback")
        elif not self.problemas and self.version != vista:
            self._guardar_version()

    def _guardar_version(self):
        if not self.ruta_version:
            return
        os.makedirs(os.path.dirname(os.path.abspath(self.ruta_version)), exist_ok=True)
        with open(self.ruta_version, "w", encoding="utf-8") as f:
            f.write(f"{self.version}\n")

    def guardar(self):
        self.comprobar_escritura()
        os.makedirs(os.path.dirname(os.path.abspath(self.ruta)), exist_ok=True)
        firmas = []
        with open(self.ruta, "w", newline="", encoding="utf-8") as f:
            escritor = csv.writer(f)
            escritor.writerow(CABECERA)
            for i in range(len(self.ids)):
                campos = ([self.ids[i], self.nombres[i], self.origenes[i], self.fechas[i]]
                          + [f"{v:.7f}" for v in self.embeddings[i]])
                firmas.append(self._firmar_fila(campos))
                escritor.writerow(campos + [firmas[-1]])
        self.version += 1
        with open(self.ruta_firma, "w", encoding="utf-8") as f:
            f.write(f"{self.version}\n{self._firmar_bd(firmas, self.version)}\n")
        self._sello = self._sello_ficheros()
        self._guardar_version()

    # --- Operaciones -------------------------------------------------------

    def anadir(self, id_usuario, nombre, origen, embedding):
        self.ids.append(id_usuario)
        self.nombres.append(nombre)
        self.origenes.append(origen)
        self.fechas.append(datetime.now().isoformat(timespec="seconds"))
        self.embeddings = np.vstack([self.embeddings, embedding[np.newaxis]])

    def eliminar(self, id_usuario):
        """Borra todas las muestras de un usuario. Devuelve cuántas borró."""
        mantener = [i for i, u in enumerate(self.ids) if u != id_usuario]
        borradas = len(self.ids) - len(mantener)
        self.ids = [self.ids[i] for i in mantener]
        self.nombres = [self.nombres[i] for i in mantener]
        self.origenes = [self.origenes[i] for i in mantener]
        self.fechas = [self.fechas[i] for i in mantener]
        self.embeddings = self.embeddings[mantener]
        return borradas

    def existe(self, id_usuario):
        return id_usuario in self.ids

    def nombre(self, id_usuario):
        return self.nombres[self.ids.index(id_usuario)]

    def usuarios(self):
        """Devuelve {id_usuario: (nombre, nº de muestras)}."""
        res = {}
        for u, n in zip(self.ids, self.nombres):
            res[u] = (n, res.get(u, (n, 0))[1] + 1)
        return res

    def plantilla(self, id_usuario):
        """Media normalizada de las muestras de un usuario. Si las muestras se
        anulan entre sí, el vector nulo, que da score 0 contra cualquier cara."""
        mascara = np.array(self.ids) == id_usuario
        media = self.embeddings[mascara].mean(axis=0)
        norma = np.linalg.norm(media)
        return media / norma if norma > 0 else media

    def plantillas(self):
        """Devuelve (lista de ids, matriz (U, 512) de plantillas)."""
        ids = list(self.usuarios())
        if not ids:
            return [], np.empty((0, DIM), dtype=np.float32)
        return ids, np.stack([self.plantilla(u) for u in ids])
