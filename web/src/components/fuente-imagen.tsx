import { useRef, useState, type ReactNode } from "react"
import { CameraIcon, CameraOffIcon, ImageUpIcon, Loader2Icon, RotateCcwIcon } from "lucide-react"
import { toast } from "sonner"

import { ImagenConCaras, SuperposicionCaras, type Marca } from "@/components/caras"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useWebcam } from "@/hooks/use-webcam"
import { cn } from "@/lib/utils"

export type Imagen = { blob: Blob; url: string; nombre: string }

export function crearImagen(blob: Blob, nombre?: string): Imagen {
  return {
    blob,
    url: URL.createObjectURL(blob),
    nombre: nombre ?? (blob instanceof File ? blob.name : "webcam.jpg"),
  }
}

/** Zona para arrastrar o elegir imágenes del disco. */
export function ZonaArchivos({
  multiple = false,
  onArchivos,
  className,
}: {
  multiple?: boolean
  onArchivos: (archivos: File[]) => void
  className?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [encima, setEncima] = useState(false)

  const recibir = (lista: FileList | null) => {
    const todos = Array.from(lista ?? [])
    const archivos = todos.filter((f) => f.type.startsWith("image/"))
    const ignorados = todos.filter((f) => !f.type.startsWith("image/"))
    if (ignorados.length) {
      toast.warning(
        ignorados.length === 1
          ? "Se ha ignorado un archivo que no es una imagen"
          : `Se han ignorado ${ignorados.length} archivos que no son imágenes`,
        { description: ignorados.map((f) => f.name).join(", ") }
      )
    }
    if (archivos.length) onArchivos(multiple ? archivos : archivos.slice(0, 1))
  }

  return (
    <button
      type="button"
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setEncima(true)
      }}
      onDragLeave={() => setEncima(false)}
      onDrop={(e) => {
        e.preventDefault()
        setEncima(false)
        recibir(e.dataTransfer.files)
      }}
      className={cn(
        "flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/50",
        encima && "border-primary bg-muted",
        className
      )}
    >
      <ImageUpIcon className="size-8" />
      <span className="text-sm font-medium text-foreground">
        {multiple ? "Arrastra imágenes o haz clic" : "Arrastra una imagen o haz clic"}
      </span>
      <span className="text-xs">JPG, PNG, BMP…</span>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          recibir(e.target.files)
          e.target.value = ""
        }}
      />
    </button>
  )
}

/** Vista de la webcam en espejo, con marcas opcionales encima. */
export function VistaWebcam({
  webcam,
  marcas = [],
  children,
}: {
  webcam: ReturnType<typeof useWebcam>
  marcas?: Marca[]
  children?: ReactNode
}) {
  if (webcam.error) {
    return (
      <Alert variant="destructive">
        <CameraOffIcon />
        <AlertTitle>Cámara no disponible</AlertTitle>
        <AlertDescription>{webcam.error}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-3">
      {/* El contenedor toma la proporción del vídeo para que la capa de
          marcas coincida exactamente con la imagen. */}
      <div
        className="relative overflow-hidden rounded-lg bg-black"
        style={{
          aspectRatio: webcam.dims ? `${webcam.dims[0]} / ${webcam.dims[1]}` : "16 / 9",
        }}
      >
        <video
          ref={webcam.videoRef}
          muted
          playsInline
          className="size-full -scale-x-100 object-cover"
        />
        {!webcam.lista && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/70">
            <Loader2Icon className="size-4 animate-spin" /> Abriendo cámara…
          </div>
        )}
        {webcam.dims && (
          <SuperposicionCaras
            ancho={webcam.dims[0]}
            alto={webcam.dims[1]}
            marcas={marcas}
            espejo
          />
        )}
      </div>
      {children}
    </div>
  )
}

/** Selector de una imagen (archivo o webcam) que, una vez elegida, la muestra
 *  con las caras marcadas. */
export function FuenteImagen({
  imagen,
  onImagen,
  marcas = [],
  cargando = false,
}: {
  imagen: Imagen | null
  onImagen: (imagen: Imagen | null) => void
  marcas?: Marca[]
  cargando?: boolean
}) {
  const [pestana, setPestana] = useState("archivo")
  const webcam = useWebcam(pestana === "webcam" && !imagen)

  if (imagen) {
    return (
      <div className="space-y-3">
        <div className="relative">
          <ImagenConCaras src={imagen.url} marcas={marcas} />
          {cargando && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/60 backdrop-blur-[1px]">
              <Loader2Icon className="size-6 animate-spin" />
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-muted-foreground">{imagen.nombre}</span>
          <Button variant="outline" size="sm" onClick={() => onImagen(null)}>
            <RotateCcwIcon /> Otra imagen
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Tabs value={pestana} onValueChange={setPestana}>
      <TabsList className="w-full">
        <TabsTrigger value="archivo">
          <ImageUpIcon /> Subir imagen
        </TabsTrigger>
        <TabsTrigger value="webcam">
          <CameraIcon /> Webcam
        </TabsTrigger>
      </TabsList>
      <TabsContent value="archivo">
        <ZonaArchivos onArchivos={([f]) => onImagen(crearImagen(f))} />
      </TabsContent>
      <TabsContent value="webcam">
        <VistaWebcam webcam={webcam}>
          <Button
            className="w-full"
            disabled={!webcam.lista}
            onClick={async () => {
              const blob = await webcam.capturar()
              if (blob) onImagen(crearImagen(blob))
            }}
          >
            <CameraIcon /> Capturar
          </Button>
        </VistaWebcam>
      </TabsContent>
    </Tabs>
  )
}
