"""Extractor de características con LVFace (ONNX)."""
import cv2
import numpy as np
import onnxruntime


class ExtractorLVFace:
    """Convierte una cara alineada de 112x112 (BGR) en un vector de 512
    dimensiones normalizado (norma L2 = 1)."""

    def __init__(self, ruta_modelo):
        proveedores = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider")
                       if p in onnxruntime.get_available_providers()]
        self.sesion = onnxruntime.InferenceSession(ruta_modelo,
                                                   providers=proveedores)
        self.entrada = self.sesion.get_inputs()[0].name

    @staticmethod
    def _preprocesar(cara):
        # Mismo preprocesado que inference_onnx.py del repo oficial de LVFace:
        # 112x112, RGB, CHW y normalización a [-1, 1].
        cara = cv2.resize(cara, (112, 112))
        cara = cv2.cvtColor(cara, cv2.COLOR_BGR2RGB)
        cara = np.transpose(cara, (2, 0, 1)).astype(np.float32)
        return (cara / 255.0 - 0.5) / 0.5

    def extraer(self, cara):
        lote = self._preprocesar(cara)[np.newaxis]
        emb = self.sesion.run(None, {self.entrada: lote})[0][0]
        return emb / np.linalg.norm(emb)
