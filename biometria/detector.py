"""Detección de caras con OpenCV YuNet y alineación a 112x112."""
import cv2
import numpy as np

# El motor DNN nuevo de OpenCV 5 avisa de que ignora el target; no aporta nada.
cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR)

# Posiciones canónicas de los 5 puntos clave en una cara de 112x112
# (plantilla estándar de ArcFace/InsightFace, la que espera LVFace).
# Orden: ojo dcho, ojo izdo, nariz, comisura dcha, comisura izda
# (el mismo orden en que los devuelve YuNet).
PLANTILLA_112 = np.array([
    [38.2946, 51.6963],
    [73.5318, 51.5014],
    [56.0252, 71.7366],
    [41.5493, 92.3655],
    [70.7299, 92.2041],
], dtype=np.float32)

# YuNet no encuentra caras de más de ~500 px de ancho, así que las imágenes
# grandes se reducen antes de detectar para que su lado mayor no pase de
# 640 px. Si así no aparece ninguna cara (una foto muy cerrada en la que la
# cara ocupa casi todo el encuadre), se reintenta con la imagen a 320 px.
LADOS_MAX_DETECCION = (640, 320)


class DetectorCaras:
    def __init__(self, ruta_modelo, umbral=0.8):
        self.detector = cv2.FaceDetectorYN.create(ruta_modelo, "", (320, 320),
                                                  score_threshold=umbral)

    def detectar(self, img):
        """Devuelve un array (N, 15): x, y, w, h, 5 puntos (x, y), confianza,
        con las coordenadas referidas a la imagen original."""
        for lado_max in LADOS_MAX_DETECCION:
            caras = self._detectar_reducida(img, lado_max)
            if len(caras):
                return caras
        return caras

    def _detectar_reducida(self, img, lado_max):
        alto, ancho = img.shape[:2]
        escala = min(1.0, lado_max / max(alto, ancho))
        if escala < 1:
            ancho, alto = round(ancho * escala), round(alto * escala)
            img = cv2.resize(img, (ancho, alto), interpolation=cv2.INTER_AREA)
        self.detector.setInputSize((ancho, alto))
        _, caras = self.detector.detect(img)
        if caras is None:
            return np.empty((0, 15), dtype=np.float32)
        caras[:, :14] /= escala
        return caras

    def cara_principal(self, img):
        """Devuelve la cara de mayor área o None si no hay ninguna."""
        caras = self.detectar(img)
        if len(caras) == 0:
            return None
        return max(caras, key=lambda c: c[2] * c[3])


def alinear(img, cara, tam=112):
    """Recorta y alinea la cara con una transformación de similitud que lleva
    sus 5 puntos clave a la plantilla canónica."""
    puntos = cara[4:14].reshape(5, 2).astype(np.float32)
    destino = PLANTILLA_112 * (tam / 112.0)
    matriz, _ = cv2.estimateAffinePartial2D(puntos, destino, method=cv2.LMEDS)
    return cv2.warpAffine(img, matriz, (tam, tam), borderValue=0)


def dibujar(img, caras, etiquetas=None, color=(0, 255, 0)):
    """Dibuja recuadros, puntos clave y una etiqueta por cara."""
    for i, cara in enumerate(caras):
        x, y, w, h = cara[:4].astype(int)
        texto = etiquetas[i] if etiquetas else f"{cara[-1]:.2f}"
        cv2.rectangle(img, (x, y), (x + w, y + h), color, 2)
        cv2.putText(img, texto, (x, y - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
        for j in range(5):
            px, py = cara[4 + 2 * j:6 + 2 * j].astype(int)
            cv2.circle(img, (px, py), 3, (0, 0, 255), -1)
    return img
