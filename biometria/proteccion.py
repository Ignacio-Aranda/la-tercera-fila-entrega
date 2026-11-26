"""Protección de las plantillas con una rotación secreta (cancelable biometrics)
y clave para las firmas HMAC de la base de datos.

Cada vector se multiplica por una matriz ortogonal aleatoria antes de guardarlo
o compararlo. Una rotación conserva el producto escalar, así que las
similitudes coseno, y con ellas la precisión, no cambian. En cambio, una
plantilla leída del CSV ya está rotada: si se inyecta en el comparador, se rota
otra vez y deja de parecerse a la guardada. Cambiar la clave y volver a
inscribir revoca todas las plantillas.

Cada usuario tiene su propia rotación, derivada de la clave y de su id. Con una
sola rotación para todos, quien conociera el vector sin proteger de algunos
usuarios (por ejemplo, a partir de fotos públicas) podría estimarla a partir de
sus plantillas y deshacer la de los demás.

La clave se lee de la variable de entorno CLAVE_PLANTILLAS y no se guarda en
el repositorio. De ella se deriva también la clave de las firmas de la base de
datos (base_datos.py), distinta de la que genera la rotación.

Cada fila del CSV lleva su firma, así que quien lea el CSV puede comprobar
claves candidatas sin conexión, y cada comprobación cuesta dos HMAC. Por eso la
clave tiene que ser aleatoria y de al menos 256 bits (64 caracteres
hexadecimales): una contraseña elegida por una persona caería con un
diccionario.
"""
import hashlib
import hmac
import os
import re

import numpy as np

VARIABLE_CLAVE = "CLAVE_PLANTILLAS"
CARACTERES_HEX_MINIMOS = 64  # 256 bits


def clave_de_entorno():
    clave = os.environ.get(VARIABLE_CLAVE, "")
    if not clave:
        raise RuntimeError(
            f"Falta la clave de las plantillas: define la variable de entorno "
            f"{VARIABLE_CLAVE} (por ejemplo, en el fichero .env; ver README).")
    return clave


def comprobar_clave(clave):
    """Exige una clave de al menos 256 bits en hexadecimal."""
    if not re.fullmatch(rf"[0-9a-fA-F]{{{CARACTERES_HEX_MINIMOS},}}", clave):
        raise RuntimeError(
            f"La clave de las plantillas debe tener al menos {CARACTERES_HEX_MINIMOS} "
            f"caracteres hexadecimales (256 bits) aleatorios. Genera una con: "
            f"python -c 'import secrets; print(secrets.token_hex(32))'")


def clave_firmas(clave):
    """Clave de las firmas HMAC, derivada de la clave principal."""
    return hmac.new(clave.encode(), b"firmas-base-datos", hashlib.sha256).digest()


def rotacion_usuario(clave, id_usuario, dim):
    """Matriz ortogonal (dim, dim) determinista para una clave y un usuario."""
    # Semilla de 256 bits a partir de la clave y el id; numpy está fijado en
    # requirements, así que la secuencia aleatoria es reproducible.
    semilla = int.from_bytes(hmac.new(clave.encode(), b"rotacion:" + id_usuario.encode(),
                                      hashlib.sha256).digest(), "big")
    aleatoria = np.random.default_rng(semilla).standard_normal((dim, dim))
    q, r = np.linalg.qr(aleatoria)
    # Fijar los signos hace la descomposición única (y la rotación uniforme).
    return (q * np.sign(np.diag(r))).astype(np.float32)
