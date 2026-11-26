import { useState } from "react"
import { AnimatePresence } from "motion/react"
import {
  CameraIcon,
  CheckCircle2Icon,
  ImageUpIcon,
  ImagesIcon,
  Loader2Icon,
  LockIcon,
  TriangleAlertIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Nacimiento, type DatosAnimacion } from "@/components/animaciones"
import { SuperposicionCaras } from "@/components/caras"
import { crearImagen, VistaWebcam, ZonaArchivos, type Imagen } from "@/components/fuente-imagen"
import { SinResultado } from "@/components/resultado"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useWebcam } from "@/hooks/use-webcam"
import { api, useClaveAdmin, type Cara, type ResultadoDeteccion, type Usuario } from "@/lib/api"
import { plural } from "@/lib/utils"

type Muestra = {
  clave: number
  imagen: Imagen
  deteccion?: ResultadoDeteccion
  error?: boolean
}

let siguienteClave = 0

function estadoMuestra(m: Muestra) {
  if (m.error) return { texto: "Error", ok: false }
  if (!m.deteccion) return null
  const n = m.deteccion.caras.length
  if (n === 0) return { texto: "Sin cara", ok: false }
  if (n > 1) return { texto: `${n} caras · se usa la mayor`, ok: true }
  return { texto: "Cara detectada", ok: true }
}

function caraMayor(caras: Cara[]) {
  return caras.reduce((a, b) => (b.caja[2] * b.caja[3] > a.caja[2] * a.caja[3] ? b : a))
}

export function Inscribir({
  usuarios,
  refrescar,
  escritura,
}: {
  usuarios: Usuario[]
  refrescar: () => void
  escritura: boolean | undefined
}) {
  const [id, setId] = useState("")
  const [nombre, setNombre] = useState("")
  const [muestras, setMuestras] = useState<Muestra[]>([])
  const [pestana, setPestana] = useState("archivo")
  const [enviando, setEnviando] = useState(false)
  const [nacimiento, setNacimiento] = useState<DatosAnimacion | null>(null)
  const webcam = useWebcam(pestana === "webcam")
  const clave = useClaveAdmin()

  const existente = usuarios.find((u) => u.id === id.trim())
  // Si el ID ya existe se usa su nombre; lo escrito a mano se conserva para
  // cuando el ID vuelva a ser nuevo.
  const nombreFinal = (existente?.nombre ?? nombre).trim()
  const validas = muestras.filter((m) => estadoMuestra(m)?.ok)
  const comprobando = muestras.some((m) => !m.deteccion && !m.error)
  const puedeEnviar =
    id.trim() &&
    nombreFinal &&
    validas.length > 0 &&
    !comprobando &&
    !enviando &&
    escritura !== false

  const anadir = (imagenes: Imagen[]) => {
    const nuevas = imagenes.map((imagen) => ({ clave: siguienteClave++, imagen }))
    setMuestras((prev) => [...prev, ...nuevas])
    // Se detecta la cara de cada muestra para avisar antes de inscribir.
    for (const m of nuevas) {
      api
        .detectar(m.imagen.blob)
        .then((deteccion) =>
          setMuestras((prev) => prev.map((x) => (x.clave === m.clave ? { ...x, deteccion } : x)))
        )
        .catch(() =>
          setMuestras((prev) => prev.map((x) => (x.clave === m.clave ? { ...x, error: true } : x)))
        )
    }
  }

  const quitar = (clave: number) =>
    setMuestras((prev) => prev.filter((m) => m.clave !== clave))

  const capturar = async () => {
    const blob = await webcam.capturar()
    if (blob) anadir([crearImagen(blob, `webcam_${muestras.length + 1}.jpg`)])
  }

  const enviar = async () => {
    setEnviando(true)
    try {
      const archivos = validas.map(
        (m) => new File([m.imagen.blob], m.imagen.nombre, { type: m.imagen.blob.type })
      )
      const r = await api.inscribir(id.trim(), nombreFinal, archivos)
      setNacimiento({ id: r.id, nombre: r.nombre, cara: r.cara, muestras: r.validas })
      toast.success(`${r.nombre} inscrito con ${plural(r.validas, "muestra")}`, {
        description: r.descartadas.length
          ? `Descartadas: ${r.descartadas.join(", ")}`
          : existente
            ? "Se han añadido a las muestras que ya tenía"
            : undefined,
      })
      setMuestras([])
      setId("")
      setNombre("")
      refrescar()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <AnimatePresence>
        {nacimiento && <Nacimiento datos={nacimiento} onFin={() => setNacimiento(null)} />}
      </AnimatePresence>
      <Card>
        <CardHeader>
          <CardTitle>Nueva inscripción</CardTitle>
          <CardDescription>
            Se detecta la cara de cada muestra, se alinea y LVFace extrae su vector. Varias muestras
            por persona dan una plantilla más robusta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <div className="space-y-2">
              <Label htmlFor="id">ID</Label>
              <Input
                id="id"
                placeholder="01"
                value={id}
                onChange={(e) => setId(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nombre">Nombre</Label>
              <Input
                id="nombre"
                placeholder="Nombre y apellidos"
                value={existente?.nombre ?? nombre}
                disabled={!!existente}
                onChange={(e) => setNombre(e.target.value)}
              />
            </div>
          </div>
          {existente && (
            <p className="text-xs text-muted-foreground">
              El ID <b>{existente.id}</b> ya existe ({existente.nombre},{" "}
              {plural(existente.muestras.length, "muestra")}): las nuevas muestras se añadirán a su
              plantilla.
            </p>
          )}

          <Tabs value={pestana} onValueChange={setPestana}>
            <TabsList className="w-full">
              <TabsTrigger value="archivo">
                <ImageUpIcon /> Subir imágenes
              </TabsTrigger>
              <TabsTrigger value="webcam">
                <CameraIcon /> Webcam
              </TabsTrigger>
            </TabsList>
            <TabsContent value="archivo">
              <ZonaArchivos multiple onArchivos={(fs) => anadir(fs.map((f) => crearImagen(f)))} />
            </TabsContent>
            <TabsContent value="webcam">
              <VistaWebcam webcam={webcam}>
                <Button className="w-full" disabled={!webcam.lista} onClick={capturar}>
                  <CameraIcon /> Capturar muestra
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Consejo: captura 3–5 muestras variando un poco la pose y la expresión.
                </p>
              </VistaWebcam>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Muestras
            {muestras.length > 0 && (
              <Badge variant="secondary">
                {validas.length}/{muestras.length} válidas
              </Badge>
            )}
          </CardTitle>
          <CardDescription>Las imágenes sin cara se descartan.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {muestras.length === 0 ? (
            <SinResultado icono={<ImagesIcon />}>
              Añade imágenes o capturas de la webcam.
            </SinResultado>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {muestras.map((m) => {
                const estado = estadoMuestra(m)
                const caras = m.deteccion?.caras ?? []
                return (
                  <div key={m.clave} className="group relative overflow-hidden rounded-lg border">
                    <img src={m.imagen.url} alt="" className="block aspect-square w-full object-cover" />
                    {m.deteccion && caras.length > 0 && (
                      <MiniaturaCara src={m.imagen.url} cara={caraMayor(caras)} ancho={m.deteccion.ancho} alto={m.deteccion.alto} />
                    )}
                    <div className="flex items-center gap-1.5 p-2 text-xs">
                      {!estado ? (
                        <Loader2Icon className="size-3.5 animate-spin" />
                      ) : estado.ok ? (
                        <CheckCircle2Icon className="size-3.5 text-emerald-500" />
                      ) : (
                        <TriangleAlertIcon className="size-3.5 text-red-500" />
                      )}
                      <span className="truncate">{estado?.texto ?? "Detectando…"}</span>
                    </div>
                    <Button
                      variant="secondary"
                      size="icon-xs"
                      className="absolute top-1.5 right-1.5 opacity-80 hover:opacity-100"
                      aria-label="Quitar muestra"
                      onClick={() => quitar(m.clave)}
                    >
                      <XIcon />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
          {escritura === false ? (
            <Alert variant="destructive">
              <LockIcon />
              <AlertDescription>
                El servidor no tiene clave de administración: la inscripción está deshabilitada.
              </AlertDescription>
            </Alert>
          ) : (
            !clave && (
              <p className="text-xs text-muted-foreground">
                Inscribir requiere la clave de administración (botón de la llave en la cabecera).
              </p>
            )
          )}
          <Button className="w-full" disabled={!puedeEnviar} onClick={enviar}>
            {enviando ? <Loader2Icon className="animate-spin" /> : <UserPlusIcon />}
            {existente ? "Añadir muestras" : "Inscribir"}
            {validas.length > 0 && ` (${validas.length})`}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

/** Imagen completa con la cara marcada, superpuesta a la miniatura cuadrada. */
function MiniaturaCara({
  src,
  cara,
  ancho,
  alto,
}: {
  src: string
  cara: Cara
  ancho: number
  alto: number
}) {
  return (
    <div className="absolute inset-x-0 top-0 aspect-square bg-muted">
      <div
        className="relative top-1/2 left-1/2 max-h-full max-w-full -translate-x-1/2 -translate-y-1/2"
        style={
          ancho >= alto
            ? { width: "100%", aspectRatio: `${ancho} / ${alto}` }
            : { height: "100%", aspectRatio: `${ancho} / ${alto}` }
        }
      >
        <img src={src} alt="" className="block size-full" />
        <SuperposicionCaras ancho={ancho} alto={alto} marcas={[{ cara, etiqueta: "", tono: "ok" }]} />
      </div>
    </div>
  )
}
