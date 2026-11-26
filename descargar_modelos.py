"""Descarga el modelo LVFace-T (ONNX) desde el HuggingFace oficial de ByteDance."""
import os
import urllib.request

URL = ("https://huggingface.co/bytedance-research/LVFace/resolve/main/"
       "LVFace-T_Glint360K/LVFace-T_Glint360K.onnx")
DESTINO = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "modelos", "LVFace-T_Glint360K.onnx")

if os.path.exists(DESTINO):
    print(f"Ya existe {DESTINO}")
else:
    print(f"Descargando {URL} ...")
    urllib.request.urlretrieve(URL, DESTINO)
    print(f"Guardado en {DESTINO}")
