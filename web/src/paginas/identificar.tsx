import { useEffect, useState } from "react"
import { RadioIcon, ScanSearchIcon, UserCheckIcon, UserXIcon } from "lucide-react"

import type { Marca } from "@/components/caras"
import { FuenteImagen, VistaWebcam, type Imagen } from "@/components/fuente-imagen"
import { AvisoReplay, BarraScore, CaraAlineada, SinResultado } from "@/components/resultado"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useWebcam } from "@/hooks/use-webcam"
import { api, ErrorApi, useClaveAdmin, type ResultadoIdentificacion } from "@/lib/api"
import { cn } from "@/lib/utils"

// El score solo llega con la clave de administración.
const conScore = (nombre: string, score?: number) =>
  score === undefined ? nombre : `${nombre} ${score.toFixed(2)}`

function marcasDe(r: ResultadoIdentificacion | null): Marca[] {
  return (r?.resultados ?? []).map((x) => ({
    cara: x.cara,
    etiqueta: x.identificado
      ? conScore(x.identificado.nombre, x.identificado.score)
      : conScore("Desconocido", x.ranking[0]?.score),
    tono: x.identificado ? "ok" : "mal",
  }))
}

export function Identificar({ umbral, hayUsuarios }: { umbral: number; hayUsuarios: boolean }) {
  const [vivo, setVivo] = useState(false)
  const [imagen, setImagen] = useState<Imagen | null>(null)
  const [resultado, setResultado] = useState<ResultadoIdentificacion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const webcam = useWebcam(vivo)
  const { lista, capturar } = webcam
  const clave = useClaveAdmin()

  // Modo imagen: se identifica cada vez que cambia la imagen, el umbral o la
  // clave de administración (con ella la respuesta trae los scores).
  useEffect(() => {
    if (vivo) return
    setResultado(null)
    setError(null)
    if (!imagen) return
    let vigente = true
    setCargando(true)
    api
      .identificar(imagen.blob, umbral, true)
      .then((r) => vigente && setResultado(r))
      .catch((e: Error) => vigente && setError(e.message))
      .finally(() => vigente && setCargando(false))
    return () => {
      vigente = false
    }
  }, [imagen, umbral, vivo, clave])

  // Modo en vivo: bucle captura → identificación mientras la cámara esté abierta.
  useEffect(() => {
    if (!vivo || !lista) return
    let activo = true
    setError(null)
    ;(async () => {
      while (activo) {
        const blob = await capturar()
        if (!blob) break
        try {
          const r = await api.identificar(blob, umbral, true)
          if (activo) setResultado(r)
        } catch (e) {
          if (!activo) break
          if (e instanceof ErrorApi && e.message.includes("ninguna cara")) {
            setResultado(null)
          } else {
            setError((e as Error).message)
            break
          }
        }
        await new Promise((ok) => setTimeout(ok, 100))
      }
    })()
    return () => {
      activo = false
    }
  }, [vivo, lista, capturar, umbral, clave])

  const principal = resultado?.resultados[0]
  const marcas = marcasDe(resultado)

  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <Card>
        <CardHeader>
          <CardTitle>Identificación 1:N</CardTitle>
          <CardDescription>
            ¿Quién es? Se compara la cara con todas las plantillas y se devuelve la más parecida si
            supera el umbral.
          </CardDescription>
          <CardAction className="flex items-center gap-2">
            <Switch
              id="vivo"
              checked={vivo}
              onCheckedChange={(v) => {
                setVivo(v)
                setResultado(null)
                setError(null)
              }}
            />
            <Label htmlFor="vivo" className="flex items-center gap-1.5">
              <RadioIcon className={cn("size-4", vivo && "animate-pulse text-red-500")} />
              En vivo
            </Label>
          </CardAction>
        </CardHeader>
        <CardContent>
          {!hayUsuarios && (
            <Alert className="mb-4">
              <AlertDescription>La base de datos está vacía: inscribe a alguien primero.</AlertDescription>
            </Alert>
          )}
          {vivo ? (
            <VistaWebcam webcam={webcam} marcas={marcas}>
              <p className="text-center text-xs text-muted-foreground">
                Se reconocen todas las caras del encuadre de forma continua.
              </p>
            </VistaWebcam>
          ) : (
            <FuenteImagen imagen={imagen} onImagen={setImagen} marcas={marcas} cargando={cargando} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resultado</CardTitle>
          <CardDescription>
            Candidatos más parecidos a la cara principal, en orden
            {resultado && resultado.resultados.length > 1 &&
              ` (${resultado.resultados.length} caras en la imagen)`}
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <Alert variant="destructive">
              <UserXIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : principal ? (
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                {principal.alineada && <CaraAlineada src={principal.alineada} />}
                <div
                  className={cn(
                    "flex flex-1 items-center gap-3 rounded-lg p-4",
                    principal.identificado
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-red-500/10 text-red-700 dark:text-red-400"
                  )}
                >
                  {principal.identificado ? (
                    <UserCheckIcon className="size-8 shrink-0" />
                  ) : (
                    <UserXIcon className="size-8 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-medium uppercase opacity-80">
                      {principal.identificado ? "Identificado" : "No identificado"}
                    </div>
                    <div className="truncate text-lg font-semibold">
                      {principal.identificado?.nombre ?? "Desconocido"}
                    </div>
                    {principal.identificado && (
                      <div className="font-mono text-xs opacity-80">id {principal.identificado.id}</div>
                    )}
                  </div>
                </div>
              </div>

              {principal.sospecha_replay && <AvisoReplay />}

              <ol className="space-y-3">
                {principal.ranking.map((c, i) => (
                  <li key={c.id} className="space-y-1.5">
                    <div className="flex items-center gap-2 text-sm">
                      <Badge variant={i === 0 && principal.identificado ? "default" : "outline"} className="w-6 justify-center">
                        {i + 1}
                      </Badge>
                      <span className="truncate font-medium">{c.nombre}</span>
                      <span className="font-mono text-xs text-muted-foreground">{c.id}</span>
                      {c.score !== undefined && (
                        <span className="ml-auto font-mono tabular-nums">{c.score.toFixed(4)}</span>
                      )}
                    </div>
                    {c.score !== undefined && (
                      <BarraScore score={c.score} umbral={resultado!.umbral} />
                    )}
                  </li>
                ))}
              </ol>
              {principal.ranking.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  La lista de candidatos solo la ve la administración.
                </p>
              )}
            </div>
          ) : (
            <SinResultado icono={<ScanSearchIcon />}>
              {cargando
                ? "Identificando…"
                : vivo
                  ? webcam.error
                    ? "Sin cámara no hay modo en vivo: desactívalo para subir una imagen."
                    : "Ponte delante de la cámara."
                  : "Sube una imagen o captura con la webcam."}
            </SinResultado>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
