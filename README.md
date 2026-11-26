# Sistema biométrico facial

Reconocimiento facial con detección **OpenCV YuNet**, alineación a 112×112 con
los 5 puntos clave de la cara, extracción de características con **LVFace**
(ByteDance, ViT, 512 dimensiones) y comparación por similitud coseno contra una
base de datos **CSV**.

El repositorio incluye la base de datos con las 50 personas inscritas, sus
caras recortadas y las fotos con las que se inscribieron (`Dataset/`).

## Puesta en marcha con Docker

Hace falta Docker con Compose y conexión a internet la primera vez: al
construir las imágenes se descargan las dependencias y el modelo LVFace (77 MB).

1. Crea el fichero `.env` a partir del ejemplo y pon las claves, que se entregan
   aparte:

   ```bash
   cp .env.example .env
   ```

   - `CLAVE_PLANTILLAS`: clave de la base de datos. Sin ella el sistema no
     arranca, y la base de datos incluida solo funciona con la clave con la que
     se creó.
   - `CLAVE_ADMIN`: clave de administración de la web y la API (ver
     [Roles](#roles)).

2. Arranca el sistema:

   ```bash
   docker compose up --build
   ```

3. Abre <http://localhost:8080>.

Si el puerto 8080 está ocupado, pon otro en `PUERTO` dentro de `.env`. Con
`docker compose up --build -d` el sistema queda en segundo plano, y
`docker compose down` lo detiene. En Linux, si tu usuario no está en el grupo
`docker`, antepón `sudo`; los ficheros que escriba el sistema en `datos/` y
`estado/` serán entonces de root.

## Interfaz web

Tiene una pestaña por operación (inscribir, verificar, identificar y detectar)
y un panel con las personas inscritas. Todas aceptan subir imágenes o usar la
webcam del navegador, e Identificar tiene un modo en vivo que reconoce de forma
continua.

## Roles

Con la clave de administración (en la web, con el botón de la llave de la
cabecera; en la API, en la cabecera `Authorization: Bearer <clave>`) se puede:

- Inscribir y borrar personas.
- Ver las caras inscritas.
- Ver los scores y la lista de candidatos de la identificación.
- Cambiar el umbral.

Sin ella solo se puede verificar, identificar y detectar, y solo se ve la
decisión con el umbral del sistema. Si `CLAVE_ADMIN` está vacía, nadie puede
inscribir ni borrar desde la web o la API.

Tras 5 verificaciones fallidas seguidas contra una misma persona, esa identidad
queda bloqueada durante 5 minutos (las verificaciones del administrador no
cuentan). El bloqueo se guarda en `estado/`, así que se conserva al reiniciar.

## Uso desde Python

El paquete `biometria` ofrece los métodos del enunciado en la clase
`SistemaBiometrico`. Cada operación tiene tres variantes, según la parte del
sistema que se omite:

| Operación | Normal | Sin detector (`_sd`) | Con template (`_t`) |
|---|---|---|---|
| Inscripción | `inscribir(id, foto)` | `inscribir_sd(id, foto)` | `inscribir_t(id, template)` |
| Verificación | `verificar(id, foto)` | `verificar_sd(id, foto)` | `verificar_t(id, template)` |
| Identificación | `identificar(foto)` | `identificar_sd(foto)` | `identificar_t(template)` |

- **Normal**: detector, alineación, extractor y comparador.
- **`_sd`**: la imagen se toma como una cara ya recortada y alineada, y va
  directa al extractor, que la redimensiona a 112×112.
- **`_t`**: se pasa directamente un vector de 512 valores, que se normaliza
  (norma L2 = 1) como los que produce el extractor.

`foto` puede ser una imagen BGR (array de numpy) o la ruta de un fichero. La
verificación devuelve `(aceptado, score)` y la identificación
`(mejor, ranking)`, donde `mejor` es `(id, nombre, score)` o `None`. La
identificación admite `top=n` para el tamaño del ranking (5 por defecto). Las
inscripciones admiten un `nombre` opcional (por defecto, el id); si la persona
ya existe, la nueva muestra se añade a las que tenía. `embedding(foto)` y
`embedding_sd(foto)` devuelven el template de una imagen.

Con el sistema en marcha, desde la carpeta del repositorio:

```bash
docker compose exec api python
```

```python
from biometria import SistemaBiometrico

s = SistemaBiometrico()
foto = "Dataset/ryan_gosling_2018.jpg"
s.identificar(foto)
s.verificar("ryan_gosling_2018", foto)
s.verificar_t("ryan_gosling_2018", s.embedding(foto))
```

Las fotos de `Dataset/` son las mismas con las que se inscribió a cada persona,
así que verificarlas contra su propia identidad da un score de 1,000 y se
rechaza como posible replay (ver [Decisión](#decisión)). La de Ryan Gosling es
otra versión de la misma fotografía y da 0,965.

## Línea de órdenes

Con el sistema en marcha, cada orden se ejecuta con
`docker compose exec api python main.py <orden>`:

| Operación | Orden |
|---|---|
| Inscripción | `inscribir --id ana --nombre "Ana" foto1.jpg foto2.jpg` |
| Inscripción de una carpeta (una subcarpeta por persona) | `inscribir-carpeta carpeta/` |
| Verificación (1:1) | `verificar --id ryan_gosling_2018 Dataset/ryan_gosling_2018.jpg` |
| Identificación (1:N) | `identificar --top 5 Dataset/ryan_gosling_2018.jpg` |
| Listado y baja | `listar` · `eliminar --id ana` |
| Solo detección | `detectar foto.jpg --salida caras.jpg` |

Opciones globales, antes de la orden: `--umbral 0.35` y `--bd ruta.csv`. La
línea de órdenes es la herramienta del operador: como el administrador, ve los
scores y sus verificaciones no cuentan para el bloqueo. Dentro del contenedor
solo se ven `Dataset/` y la base de datos; para usar otras fotos, cópialas con
`docker compose cp foto.jpg api:/app/`.

## Sin Docker

Requiere Python 3.12 o superior. En Mac con procesador Intel, `onnxruntime` no
publica versiones: usa Docker.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python descargar_modelos.py
set -a; source .env; set +a      # carga las claves en la terminal
.venv/bin/python main.py identificar Dataset/ryan_gosling_2018.jpg
.venv/bin/uvicorn api:app        # API en http://localhost:8000
```

Sin Docker, las órdenes aceptan `cam` en lugar de una imagen para usar la
webcam (`q` para salir).

## Decisión

Una cara se acepta si su similitud coseno con la plantilla de la persona llega
al umbral, 0,35, y no llega a 0,99. Dos capturas reales de una cara nunca son
idénticas, así que una coincidencia casi perfecta se rechaza como posible replay
de un template robado. En la identificación se elige a la persona con el score
más alto, si se acepta.

## Base de datos

`datos/base_datos.csv` tiene una fila por muestra:
`id_usuario, nombre, origen, fecha, e0 … e511, firma`. La plantilla de cada
persona es la media normalizada de sus muestras. El id y el nombre de cada
persona inscrita son el nombre de su foto en `Dataset/`, sin la extensión: los
49 famosos del dataset de la asignatura y Ryan Gosling, el elegido por el grupo.

- Las plantillas se guardan protegidas con una rotación secreta por persona,
  derivada de `CLAVE_PLANTILLAS`.
- Cada fila lleva una firma HMAC, y `datos/base_datos.firma` guarda la versión
  de la base de datos y una firma del conjunto de filas.
- La última versión vista se guarda en `estado/version_bd`. Una base de datos
  con una versión anterior se considera restaurada desde una copia antigua.

Al arrancar, las filas mal formadas o con la firma incorrecta se descartan con
un aviso. Si se detecta cualquier manipulación, el sistema sigue verificando e
identificando con las filas válidas, pero no permite inscribir ni borrar hasta
que se restaure una copia de confianza. Para empezar con una base de datos
vacía y una clave propia, borra `datos/base_datos.csv`, `datos/base_datos.firma`,
`datos/caras/` y `estado/`.

`datos/caras/` guarda la cara recortada de cada persona inscrita, que el panel
solo muestra al administrador.

## Estructura

- `biometria/detector.py`: YuNet y alineación facial.
- `biometria/extractor.py`: LVFace (onnxruntime).
- `biometria/proteccion.py`: rotación secreta de las plantillas y claves.
- `biometria/base_datos.py`: base de datos CSV firmada.
- `biometria/sistema.py`: inscripción, verificación e identificación.
- `main.py`: línea de órdenes.
- `api.py`: API web (FastAPI).
- `web/`: interfaz web (React, Vite y Tailwind), servida con nginx.
- `Dataset/`: fotos de las personas inscritas.
- `datos/`: base de datos y caras recortadas.
- `modelos/`: detector YuNet; el modelo LVFace se descarga al construir.
- `Dockerfile`, `web/Dockerfile`, `docker-compose.yml`: despliegue.
