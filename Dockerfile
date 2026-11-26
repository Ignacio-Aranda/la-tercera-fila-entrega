# API del sistema biométrico (FastAPI + YuNet + LVFace)
FROM python:3.14-slim

WORKDIR /app
COPY requirements-api.txt .
RUN pip install --no-cache-dir -r requirements-api.txt

# El modelo LVFace (77 MB) no está en git: se descarga al construir la imagen.
COPY descargar_modelos.py .
COPY modelos/face_detection_yunet_2023mar.onnx modelos/
RUN python descargar_modelos.py

COPY biometria/ biometria/
COPY api.py main.py ./

ENV BD_RUTA=/datos/base_datos.csv
VOLUME /datos
EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/estado')"

# Un solo proceso: la base de datos vive en memoria y se protege con un cerrojo.
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]
