import { useEffect, useState } from "react"
import { ShieldCheckIcon, ShieldQuestionIcon, ShieldXIcon } from "lucide-react"

import { FuenteImagen, type Imagen } from "@/components/fuente-imagen"
import { AvisoReplay, BarraScore, CaraAlineada, SinResultado } from "@/components/resultado"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { api, useClaveAdmin, type ResultadoVerificacion, type Usuario } from "@/lib/api"
import { cn } from "@/lib/utils"

export function Verificar({ usuarios, umbral }: { usuarios: Usuario[]; umbral: number }) {
  const [id, setId] = useState("")
  const [imagen, setImagen] = useState<Imagen | null>(null)
  const [resultado, setResultado] = useState<ResultadoVerificacion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const clave = useClaveAdmin()

  // Con un único usuario no hay nada que elegir; y si el elegido se ha
  // borrado, la selección deja de valer.
  const idValido = usuarios.some((u) => u.id === id)
    ? id
    : usuarios.length === 1
      ? usuarios[0].id
      : ""
  // Sin usuarios no hay identidad que elegir: el aviso es otro.
  const faltaIdentidad = !!imagen && !idValido && usuarios.length > 0

  // Se verifica en cuanto hay identidad e imagen, y se repite si cambia el
  // umbral o la clave de administración (con ella la respuesta trae el score).
  useEffect(() => {
    setResultado(null)
    setError(null)
    if (!idValido || !imagen) return
    let vigente = true
    setCargando(true)
    api
      .verificar(idValido, imagen.blob, umbral)
      .then((r) => vigente && setResultado(r))
      .catch((e: Error) => vigente && setError(e.message))
      .finally(() => vigente && setCargando(false))
    return () => {
      vigente = false
    }
  }, [idValido, imagen, umbral, clave])

  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <Card>
        <CardHeader>
          <CardTitle>Verificación 1:1</CardTitle>
          <CardDescription>
            ¿Es esta persona quien dice ser? Se compara su cara solo con la plantilla de la
            identidad reclamada.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Identidad reclamada</Label>
            <Select value={idValido} onValueChange={setId} disabled={usuarios.length === 0}>
              <SelectTrigger className="w-full" aria-invalid={faltaIdentidad}>
                <SelectValue
                  placeholder={usuarios.length ? "Elige un usuario…" : "No hay usuarios inscritos"}
                />
              </SelectTrigger>
              <SelectContent>
                {usuarios.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    <span className="font-mono text-xs text-muted-foreground">{u.id}</span>
                    {u.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <FuenteImagen
            imagen={imagen}
            onImagen={setImagen}
            cargando={cargando}
            marcas={
              resultado
                ? [
                    {
                      cara: resultado.cara,
                      etiqueta:
                        resultado.score !== undefined
                          ? resultado.score.toFixed(2)
                          : resultado.aceptado
                            ? "Aceptado"
                            : "Rechazado",
                      tono: resultado.aceptado ? "ok" : "mal",
                    },
                  ]
                : []
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resultado</CardTitle>
          <CardDescription>
            Decisión según el umbral. La similitud coseno solo se muestra con la clave de
            administración.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <Alert variant="destructive">
              <ShieldXIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : resultado ? (
            <div className="space-y-6">
              <div
                className={cn(
                  "flex items-center gap-4 rounded-lg p-4",
                  resultado.aceptado
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "bg-red-500/10 text-red-700 dark:text-red-400"
                )}
              >
                {resultado.aceptado ? (
                  <ShieldCheckIcon className="size-10 shrink-0" />
                ) : (
                  <ShieldXIcon className="size-10 shrink-0" />
                )}
                <div>
                  <div className="text-xl font-semibold tracking-tight">
                    {resultado.aceptado ? "ACEPTADO" : "RECHAZADO"}
                  </div>
                  <div className="text-sm opacity-80">
                    {resultado.aceptado ? "Es" : "No es"} {resultado.nombre} ({resultado.id})
                  </div>
                </div>
              </div>
              {resultado.sospecha_replay && <AvisoReplay />}
              {resultado.score !== undefined && (
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-muted-foreground">Score</span>
                    <span className="font-mono text-2xl font-semibold tabular-nums">
                      {resultado.score.toFixed(4)}
                    </span>
                  </div>
                  <BarraScore score={resultado.score} umbral={resultado.umbral} />
                  <div className="relative h-4 text-xs text-muted-foreground">
                    <span className="absolute left-0">0</span>
                    <span
                      className="absolute -translate-x-1/2 whitespace-nowrap"
                      style={{ left: `${Math.min(85, Math.max(15, resultado.umbral * 100))}%` }}
                    >
                      umbral {resultado.umbral.toFixed(2)}
                    </span>
                    <span className="absolute right-0">1</span>
                  </div>
                </div>
              )}
              <CaraAlineada src={resultado.alineada} />
            </div>
          ) : (
            <SinResultado icono={<ShieldQuestionIcon />}>
              {cargando
                ? "Verificando…"
                : faltaIdentidad
                  ? "Ahora elige arriba la identidad que reclama la persona de la foto."
                  : usuarios.length === 0
                    ? "No hay nadie inscrito: inscribe a alguien primero."
                    : "Elige una identidad y una imagen para verificar."}
            </SinResultado>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
