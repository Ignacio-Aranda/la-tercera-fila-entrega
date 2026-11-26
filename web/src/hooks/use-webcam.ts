import { useCallback, useEffect, useRef, useState } from "react"

/** Abre la webcam mientras `activa` sea true y permite capturar fotogramas. */
export function useWebcam(activa: boolean) {
  const elemento = useRef<HTMLVideoElement | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  // Resolución real del vídeo; null hasta que la cámara está lista.
  const [dims, setDims] = useState<[number, number] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!activa) return
    let cancelado = false
    let abierto: MediaStream | null = null

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "El navegador no permite usar la cámara aquí (hace falta localhost o HTTPS)"
      )
      return
    }

    navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then((s) => {
        if (cancelado) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        abierto = s
        setStream(s)
      })
      .catch((e: Error) => {
        if (cancelado) return
        setError(
          e.name === "NotAllowedError"
            ? "Permiso de cámara denegado"
            : e.name === "NotFoundError"
              ? "No se ha encontrado ninguna cámara"
              : `No se pudo abrir la cámara: ${e.message}`
        )
      })

    return () => {
      cancelado = true
      abierto?.getTracks().forEach((t) => t.stop())
      setStream(null)
      setDims(null)
      setError(null)
    }
  }, [activa])

  // Callback ref: engancha el stream al <video> en cuanto ambos existen, sin
  // importar cuál llega antes.
  const videoRef = useCallback(
    (video: HTMLVideoElement | null) => {
      elemento.current = video
      if (!video || !stream || video.srcObject === stream) return
      video.srcObject = stream
      video.onloadedmetadata = () => {
        video.play()
        setDims([video.videoWidth, video.videoHeight])
      }
    },
    [stream]
  )

  /** Captura el fotograma actual como JPEG (sin el efecto espejo de la vista). */
  const capturar = useCallback(async (): Promise<Blob | null> => {
    const video = elemento.current
    if (!video || !video.videoWidth) return null
    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext("2d")!.drawImage(video, 0, 0)
    return new Promise((ok) => canvas.toBlob(ok, "image/jpeg", 0.92))
  }, [])

  return { videoRef, dims, lista: dims !== null, error, capturar }
}
