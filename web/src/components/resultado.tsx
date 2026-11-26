import type { ReactNode } from "react"
import { TriangleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { cn } from "@/lib/utils"

/** Barra de similitud coseno (0–1) con la marca del umbral (solo para administración). */
export function BarraScore({
  score,
  umbral,
  className,
}: {
  score: number
  umbral: number
  className?: string
}) {
  const pct = (v: number) => `${Math.min(100, Math.max(0, v * 100))}%`
  const supera = score >= umbral
  return (
    <div className={cn("relative h-2 w-full rounded-full bg-muted", className)}>
      <div
        className={cn(
          "h-full rounded-full transition-all",
          supera ? "bg-emerald-500" : "bg-red-500"
        )}
        style={{ width: pct(score) }}
      />
      <div
        className="absolute -top-1 h-4 w-0.5 rounded bg-foreground"
        style={{ left: pct(umbral) }}
        title={`Umbral ${umbral.toFixed(2)}`}
      />
    </div>
  )
}

/** Aviso de una coincidencia casi perfecta, que el sistema rechaza como posible replay. */
export function AvisoReplay() {
  return (
    <Alert className="border-amber-500/50 text-amber-700 dark:text-amber-400">
      <TriangleAlertIcon />
      <AlertTitle>Coincidencia casi perfecta: posible replay</AlertTitle>
      <AlertDescription>
        Dos capturas reales de una cara nunca son idénticas; una similitud tan alta indica que se ha
        enviado la propia plantilla o una copia, así que se rechaza.
      </AlertDescription>
    </Alert>
  )
}

/** Recorte alineado de 112×112 que recibe LVFace. */
export function CaraAlineada({ src }: { src: string }) {
  return (
    <figure className="flex flex-col items-center gap-1.5">
      <img
        src={src}
        alt="Cara alineada"
        className="size-28 rounded-md border object-cover [image-rendering:pixelated]"
      />
      <figcaption className="text-center text-[11px] leading-tight text-muted-foreground">
        Entrada de LVFace
        <br />
        112×112 alineada
      </figcaption>
    </figure>
  )
}

/** Mensaje vacío para la columna de resultados. */
export function SinResultado({ icono, children }: { icono: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground [&>svg]:size-8 [&>svg]:opacity-60">
      {icono}
      {children}
    </div>
  )
}
