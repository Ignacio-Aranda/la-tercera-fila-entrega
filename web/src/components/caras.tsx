import { useState } from "react"

import type { Cara } from "@/lib/api"
import { cn } from "@/lib/utils"

export type Tono = "ok" | "mal" | "neutro"

export type Marca = { cara: Cara; etiqueta?: string; tono?: Tono }

const COLORES: Record<Tono, string> = {
  ok: "#10b981",
  mal: "#ef4444",
  neutro: "#0ea5e9",
}

/** Capa SVG con recuadros, puntos clave y etiquetas, en coordenadas de la imagen. */
export function SuperposicionCaras({
  ancho,
  alto,
  marcas,
  espejo = false,
}: {
  ancho: number
  alto: number
  marcas: Marca[]
  espejo?: boolean
}) {
  const fuente = Math.max(12, ancho / 45)
  const fx = (x: number) => (espejo ? ancho - x : x)

  return (
    <svg
      viewBox={`0 0 ${ancho} ${alto}`}
      className="pointer-events-none absolute inset-0 size-full"
      preserveAspectRatio="none"
    >
      {marcas.map(({ cara, etiqueta, tono = "neutro" }, i) => {
        const [x, y, w, h] = cara.caja
        const color = COLORES[tono]
        const izq = espejo ? ancho - x - w : x
        const texto = etiqueta ?? `${(cara.confianza * 100).toFixed(0)}%`
        const anchoTexto = texto.length * fuente * 0.6 + fuente
        const altoTexto = fuente * 1.6
        // La etiqueta va encima de la caja (o debajo si no cabe) y se desplaza
        // hacia dentro para no salirse de la imagen.
        const ex = Math.max(0, Math.min(izq, ancho - anchoTexto))
        const ey = y - altoTexto >= 0 ? y - altoTexto : Math.min(y + h, alto - altoTexto)
        return (
          <g key={i}>
            <rect
              x={izq}
              y={y}
              width={w}
              height={h}
              fill="none"
              stroke={color}
              strokeWidth={3}
              vectorEffect="non-scaling-stroke"
              rx={4}
            />
            {cara.puntos.map(([px, py], j) => (
              <circle
                key={j}
                cx={fx(px)}
                cy={py}
                r={Math.max(2, w / 45)}
                fill={color}
                stroke="white"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {texto && (
              <>
            <rect
              x={ex}
              y={ey}
              width={anchoTexto}
              height={altoTexto}
              fill={color}
              rx={3}
            />
            <text
              x={ex + fuente / 2}
              y={ey + fuente * 1.15}
              fontSize={fuente}
              fontFamily="ui-monospace, monospace"
              fontWeight={600}
              fill="white"
            >
              {texto}
            </text>
              </>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** Imagen con las caras marcadas encima. */
export function ImagenConCaras({
  src,
  marcas,
  className,
}: {
  src: string
  marcas: Marca[]
  className?: string
}) {
  const [dims, setDims] = useState<[number, number] | null>(null)
  return (
    <div className={cn("flex justify-center overflow-hidden rounded-lg bg-muted", className)}>
      {/* El envoltorio se ajusta a la imagen para que la capa SVG coincida. */}
      <div className="relative">
        <img
          src={src}
          alt=""
          className="block max-h-[65vh] w-auto max-w-full"
          onLoad={(e) =>
            setDims([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])
          }
        />
        {dims && <SuperposicionCaras ancho={dims[0]} alto={dims[1]} marcas={marcas} />}
      </div>
    </div>
  )
}
