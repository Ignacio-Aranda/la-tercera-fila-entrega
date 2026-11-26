import { useEffect, useRef, useState, type ReactNode } from "react"
import { motion, useReducedMotion } from "motion/react"

import { cn, plural } from "@/lib/utils"

/* Animaciones de inscripción (nacimiento) y eliminación (disparo).
   Las caras son las alineadas de 256×256 que guarda la API: con la plantilla
   de ArcFace los ojos caen siempre en (34 %, 46 %) y (66 %, 46 %). */

export type DatosAnimacion = {
  id: string
  nombre: string
  cara: string | null
  muestras: number
}

function Cara({ src, nombre, className }: { src: string | null; nombre: string; className?: string }) {
  const iniciales = nombre
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-full border-4 border-white bg-amber-200 shadow-xl",
        className
      )}
    >
      {src ? (
        <img src={src} alt={nombre} className="size-full object-cover" draggable={false} />
      ) : (
        <div className="flex size-full items-center justify-center text-3xl font-bold text-amber-900">
          {iniciales}
        </div>
      )}
    </div>
  )
}

/** Capa a pantalla completa que se cierra sola, con clic o con Escape. */
function Escena({
  children,
  duracion,
  onFin,
  etiqueta,
}: {
  children: ReactNode
  duracion: number
  onFin: () => void
  etiqueta: string
}) {
  // En una ref para que los renders del padre no reinicien el temporizador.
  const fin = useRef(onFin)
  useEffect(() => {
    fin.current = onFin
  })
  useEffect(() => {
    const t = setTimeout(() => fin.current(), duracion)
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && fin.current()
    window.addEventListener("keydown", tecla)
    return () => {
      clearTimeout(t)
      window.removeEventListener("keydown", tecla)
    }
  }, [duracion])

  return (
    <motion.div
      role="dialog"
      aria-label={etiqueta}
      className="fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onFin}
    >
      {children}
      <p className="mt-4 text-xs text-white/40">Clic o Esc para cerrar</p>
    </motion.div>
  )
}

/** Fase actual de una secuencia: cambia a la fase i en el instante tiempos[i] (ms). */
function useFases(tiempos: number[]) {
  const [fase, setFase] = useState(0)
  useEffect(() => {
    const ts = tiempos.map((t, i) => setTimeout(() => setFase(i + 1), t))
    return () => ts.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return fase
}

function Bocadillo({ visible, children, className }: { visible: boolean; children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={cn(
        "absolute rounded-2xl border-2 border-slate-800 bg-white px-3 py-1 text-sm font-black whitespace-nowrap text-slate-900 shadow-md",
        className
      )}
      initial={{ scale: 0, opacity: 0 }}
      animate={visible ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 18 }}
    >
      {children}
    </motion.div>
  )
}

/* ------------------------------------------------------------------------ */
/* Nacimiento                                                                */
/* ------------------------------------------------------------------------ */

const COLORES_CONFETI = ["#f472b6", "#60a5fa", "#facc15", "#34d399", "#a78bfa", "#fb923c"]

export function Nacimiento({ datos, onFin }: { datos: DatosAnimacion; onFin: () => void }) {
  const reducido = useReducedMotion()
  // 1: «¡Empuja!»  2: «¡Ya sale!»  3: nace  4: llora y confeti
  const fase = useFases([300, 1300, 2300, 3000])
  const [confeti] = useState(() =>
    Array.from({ length: 36 }, (_, i) => ({
      angulo: (i / 36) * Math.PI * 2 + Math.random() * 0.3,
      distancia: 120 + Math.random() * 120,
      color: COLORES_CONFETI[i % COLORES_CONFETI.length],
      giro: Math.random() * 720 - 360,
    }))
  )
  const empujando = fase >= 1 && fase < 3

  return (
    <Escena duracion={reducido ? 3000 : 7000} onFin={onFin} etiqueta={`Ha nacido ${datos.nombre}`}>
      <div className="relative aspect-[4/3] w-full max-w-lg overflow-hidden rounded-2xl bg-sky-100 shadow-2xl">
        <svg viewBox="0 0 400 300" className="absolute inset-0 size-full">
          {/* Habitación */}
          <rect width="400" height="300" fill="#e0f2fe" />
          <rect y="236" width="400" height="64" fill="#cbd5e1" />
          <line x1="0" y1="236" x2="400" y2="236" stroke="#94a3b8" strokeWidth="2" />
          {/* Monitor de constantes */}
          <rect x="300" y="30" width="80" height="54" rx="6" fill="#1e293b" />
          <motion.polyline
            points="306,60 320,60 326,46 332,72 338,60 352,60 358,50 364,66 370,60 376,60"
            fill="none"
            stroke="#4ade80"
            strokeWidth="2"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: empujando ? 0.4 : 0.9, repeat: Infinity, ease: "linear" }}
          />
          <line x1="340" y1="84" x2="340" y2="120" stroke="#475569" strokeWidth="3" />
          {/* Cama */}
          <rect x="48" y="130" width="14" height="100" rx="4" fill="#64748b" />
          <rect x="60" y="192" width="290" height="16" rx="4" fill="#94a3b8" />
          <rect x="70" y="208" width="8" height="28" fill="#64748b" />
          <rect x="332" y="208" width="8" height="28" fill="#64748b" />
          <ellipse cx="96" cy="182" rx="32" ry="12" fill="#fff" />
          {/* Madre: cabeza */}
          <motion.g
            animate={empujando ? { rotate: [0, -6, 6, -6, 0] } : { rotate: 0 }}
            transition={{ duration: 0.5, repeat: empujando ? Infinity : 0 }}
            style={{ originX: "100px", originY: "165px" }}
          >
            <path d="M74 160 Q 78 128 104 132 Q 128 136 124 162 Z" fill="#7c2d12" />
            <circle cx="100" cy="162" r="21" fill="#fcd5b5" />
            {fase >= 3 ? (
              <>
                {/* Alivio: ojos cerrados felices y sonrisa */}
                <path d="M88 158 q 4 -4 8 0 M104 158 q 4 -4 8 0" stroke="#7c2d12" strokeWidth="2" fill="none" />
                <path d="M92 168 q 8 7 16 0" stroke="#7c2d12" strokeWidth="2" fill="none" />
              </>
            ) : (
              <>
                {/* Esfuerzo: > <  y boca abierta */}
                <path d="M87 154 l7 4 l-7 4 M113 154 l-7 4 l7 4" stroke="#7c2d12" strokeWidth="2" fill="none" />
                <ellipse cx="100" cy="171" rx="5" ry="6" fill="#7c2d12" />
              </>
            )}
            <circle cx="88" cy="166" r="3" fill="#fb7185" opacity="0.6" />
            <circle cx="112" cy="166" r="3" fill="#fb7185" opacity="0.6" />
          </motion.g>
          {/* Gotas de sudor */}
          {empujando &&
            [0, 1].map((i) => (
              <motion.path
                key={i}
                d={`M${124 + i * 8} 146 q 3 6 0 8 q -3 -2 0 -8`}
                fill="#38bdf8"
                initial={{ y: 0, opacity: 1 }}
                animate={{ y: 18, opacity: 0 }}
                transition={{ duration: 0.7, delay: i * 0.35, repeat: Infinity }}
              />
            ))}
          {/* Sábana sobre el cuerpo, con las rodillas levantadas */}
          <motion.path
            d="M118 194 Q 140 170 200 172 Q 250 174 262 134 Q 282 108 304 134 Q 322 160 338 194 Z"
            fill="#f9a8d4"
            stroke="#ec4899"
            strokeWidth="2"
            animate={empujando ? { x: [0, -2, 2, -2, 2, 0] } : { x: 0 }}
            transition={{ duration: 0.35, repeat: empujando ? Infinity : 0 }}
          />
        </svg>

        <Bocadillo visible={fase === 1} className="top-[22%] left-[6%]">
          ¡Empuja!
        </Bocadillo>
        <Bocadillo visible={fase === 2} className="top-[22%] left-[6%]">
          ¡Ya sale, ya sale!
        </Bocadillo>

        {/* Confeti */}
        {fase >= 4 &&
          confeti.map((c, i) => (
            <motion.div
              key={i}
              className="absolute top-[38%] left-1/2 size-2.5 rounded-sm"
              style={{ backgroundColor: c.color }}
              initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
              animate={{
                x: Math.cos(c.angulo) * c.distancia,
                y: Math.sin(c.angulo) * c.distancia + 120,
                opacity: 0,
                rotate: c.giro,
              }}
              transition={{ duration: 2, ease: "easeOut" }}
            />
          ))}

        {/* El bebé: sale de debajo de la sábana y sube al centro */}
        <motion.div
          className="absolute"
          initial={{ left: "82%", top: "60%", scale: 0, rotate: 30 }}
          animate={
            fase >= 3
              ? { left: "50%", top: "40%", scale: 1, rotate: [30, -12, 6, 0] }
              : { left: "82%", top: "60%", scale: 0, rotate: 30 }
          }
          transition={{ type: "spring", stiffness: 140, damping: 12 }}
        >
          <div className="-translate-x-1/2 -translate-y-1/2">
          <motion.div
            animate={fase >= 4 ? { rotate: [0, -4, 4, -4, 0] } : {}}
            transition={{ duration: 0.6, repeat: Infinity, repeatDelay: 0.4 }}
          >
            <div className="relative flex flex-col items-center">
              <Cara src={datos.cara} nombre={datos.nombre} className="z-10 size-24" />
              {/* Arrullo */}
              <svg viewBox="0 0 120 110" className="-mt-6 w-28">
                <ellipse cx="60" cy="58" rx="46" ry="50" fill="#bfdbfe" stroke="#3b82f6" strokeWidth="3" />
                <path d="M18 40 Q 60 80 102 40" fill="none" stroke="#3b82f6" strokeWidth="3" />
                <path d="M24 70 Q 60 100 96 70" fill="none" stroke="#93c5fd" strokeWidth="3" />
                <circle cx="30" cy="44" r="9" fill="#fcd5b5" />
                <circle cx="90" cy="44" r="9" fill="#fcd5b5" />
              </svg>
            </div>
          </motion.div>
          </div>
        </motion.div>

        <Bocadillo visible={fase >= 4} className="top-[8%] right-[18%] rotate-6">
          ¡BUAAAA! 😭
        </Bocadillo>
      </div>

      <motion.div
        className="mt-5 text-center text-white"
        initial={{ opacity: 0, y: 12 }}
        animate={fase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
      >
        <div className="text-2xl font-bold">¡Ha nacido {datos.nombre}! 🍼</div>
        <div className="mt-1 text-sm text-white/70">
          ID {datos.id} · {plural(datos.muestras, "muestra")} · 512 dimensiones de pura belleza
        </div>
      </motion.div>
    </Escena>
  )
}

/* ------------------------------------------------------------------------ */
/* Disparo                                                                   */
/* ------------------------------------------------------------------------ */

function Revolver() {
  return (
    <svg viewBox="0 0 200 120" className="w-full">
      {/* Cañón apuntando a la izquierda */}
      <rect x="10" y="30" width="110" height="20" rx="4" fill="#475569" />
      <rect x="10" y="26" width="10" height="8" fill="#334155" />
      {/* Tambor */}
      <rect x="110" y="24" width="44" height="36" rx="8" fill="#334155" />
      <circle cx="122" cy="42" r="5" fill="#1e293b" />
      <circle cx="140" cy="42" r="5" fill="#1e293b" />
      {/* Martillo, guardamonte y gatillo */}
      <path d="M150 24 L 166 12 L 170 18 L 158 30 Z" fill="#334155" />
      <path d="M112 60 Q 112 82 134 82 L 140 82 L 140 74 L 132 74 Q 122 74 122 60 Z" fill="#334155" />
      <path d="M128 60 L 126 72" stroke="#1e293b" strokeWidth="4" strokeLinecap="round" />
      {/* Culata de madera */}
      <path d="M146 56 L 178 56 Q 196 92 186 112 L 160 112 Q 162 86 146 70 Z" fill="#92400e" stroke="#78350f" strokeWidth="3" />
    </svg>
  )
}

function OjoX({ x }: { x: string }) {
  return (
    <svg viewBox="0 0 20 20" className="absolute size-[18%] -translate-x-1/2 -translate-y-1/2" style={{ left: x, top: "46%" }}>
      <path d="M3 3 L17 17 M17 3 L3 17" stroke="#111" strokeWidth="5" strokeLinecap="round" />
      <path d="M3 3 L17 17 M17 3 L3 17" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function Disparo({ datos, onFin }: { datos: DatosAnimacion; onFin: () => void }) {
  const reducido = useReducedMotion()
  // 1: BANG  2: cae  3: lápida
  const fase = useFases([1700, 2700, 3400])

  return (
    <Escena duracion={reducido ? 3000 : 6500} onFin={onFin} etiqueta={`${datos.nombre} eliminado`}>
      <motion.div
        className="relative aspect-[4/3] w-full max-w-lg overflow-hidden rounded-2xl shadow-2xl"
        style={{ background: "radial-gradient(circle at 50% 40%, #475569 0%, #0f172a 70%)" }}
        animate={fase === 1 ? { x: [0, -14, 12, -8, 6, 0], y: [0, 8, -6, 4, 0] } : {}}
        transition={{ duration: 0.4 }}
      >
        {/* Suelo */}
        <div className="absolute inset-x-0 bottom-0 h-[18%] bg-stone-800" />

        {/* La víctima */}
        <motion.div
          className="absolute top-[38%] left-[36%]"
          initial={{ scale: 0 }}
          animate={
            fase >= 2
              ? { scale: 1, rotate: 95, y: 420, filter: "grayscale(1)" }
              : fase === 1
                ? { scale: 1, filter: "grayscale(0.85)" }
                : { scale: 1 }
          }
          transition={
            fase >= 2
              ? { duration: 0.7, ease: "easeIn" }
              : { type: "spring", stiffness: 260, damping: 16 }
          }
        >
          <div className="relative size-36 -translate-x-1/2 -translate-y-1/2">
            <Cara src={datos.cara} nombre={datos.nombre} className="size-full" />
            {fase >= 1 && (
              <>
                <OjoX x="34%" />
                <OjoX x="66%" />
                {/* Agujero de bala con grietas */}
                <div className="absolute top-[22%] left-1/2 size-12 -translate-x-1/2 -translate-y-1/2">
                <motion.svg
                  viewBox="0 0 40 40"
                  className="size-full"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                >
                  <path d="M20 20 L4 10 M20 20 L36 6 M20 20 L38 26 M20 20 L10 38 M20 20 L26 38" stroke="#1f2937" strokeWidth="1.5" />
                  <circle cx="20" cy="20" r="6" fill="#111" stroke="#374151" strokeWidth="2" />
                </motion.svg>
                </div>
              </>
            )}
          </div>
        </motion.div>

        {/* Mira telescópica */}
        <div className="pointer-events-none absolute top-[38%] left-[36%] size-48 -translate-x-1/2 -translate-y-1/2">
        <motion.svg
          viewBox="0 0 100 100"
          className="size-full"
          initial={{ scale: 3, opacity: 0, rotate: 90, x: 40, y: -30 }}
          animate={
            fase >= 1
              ? { opacity: 0, scale: 0.6 }
              : { scale: 1, opacity: 1, rotate: 0, x: [40, -10, 6, 0], y: [-30, 10, -4, 0] }
          }
          transition={{ duration: fase >= 1 ? 0.2 : 1.5, ease: "easeOut" }}
        >
          <circle cx="50" cy="50" r="40" fill="none" stroke="#ef4444" strokeWidth="2.5" />
          <circle cx="50" cy="50" r="22" fill="none" stroke="#ef4444" strokeWidth="1.5" />
          <path d="M50 2 V 34 M50 66 V 98 M2 50 H 34 M66 50 H 98" stroke="#ef4444" strokeWidth="2.5" />
          <circle cx="50" cy="50" r="2" fill="#ef4444" />
        </motion.svg>
        </div>

        {/* Revólver */}
        <motion.div
          className="absolute top-[30%] right-[-4%] w-[46%]"
          initial={{ x: 260, rotate: 0 }}
          animate={
            fase >= 1
              ? { x: 0, rotate: [0, -28, -6, 0] }
              : { x: 0, rotate: 0 }
          }
          transition={fase >= 1 ? { duration: 0.6 } : { delay: 0.4, type: "spring", stiffness: 120, damping: 15 }}
          style={{ originX: 0.9, originY: 0.9 }}
        >
          <Revolver />
          {/* Fogonazo */}
          {fase === 1 && (
            <motion.svg
              viewBox="0 0 60 60"
              className="absolute top-[-14%] left-[-22%] w-[34%]"
              initial={{ scale: 0.2, opacity: 1 }}
              animate={{ scale: 1.4, opacity: 0 }}
              transition={{ duration: 0.35 }}
            >
              <path d="M30 0 L36 22 L60 18 L40 32 L56 52 L32 40 L22 60 L22 38 L0 40 L18 28 L6 8 L26 20 Z" fill="#facc15" stroke="#f97316" strokeWidth="2" />
            </motion.svg>
          )}
          {/* Humo del cañón */}
          {fase >= 2 &&
            [0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="absolute top-[18%] left-[2%] size-5 rounded-full bg-slate-300/60 blur-[2px]"
                initial={{ y: 0, x: 0, opacity: 0.8, scale: 0.6 }}
                animate={{ y: -70, x: -10 + i * 8, opacity: 0, scale: 2.2 }}
                transition={{ duration: 1.6, delay: i * 0.3, repeat: Infinity }}
              />
            ))}
        </motion.div>

        {/* ¡BANG! */}
        <motion.div
          className="absolute top-[8%] left-[44%] text-5xl font-black text-yellow-300 italic"
          style={{ WebkitTextStroke: "2px #7c2d12", textShadow: "4px 4px 0 #7c2d12" }}
          initial={{ scale: 0, rotate: -15 }}
          animate={fase === 1 || fase === 2 ? { scale: [0, 1.4, 1], rotate: -12 } : { scale: 0 }}
          transition={{ duration: 0.3 }}
        >
          ¡BANG!
        </motion.div>

        {/* Destello blanco */}
        <motion.div
          className="pointer-events-none absolute inset-0 bg-white"
          initial={{ opacity: 0 }}
          animate={fase === 1 ? { opacity: [0.95, 0] } : { opacity: 0 }}
          transition={{ duration: 0.35 }}
        />

        {/* Lápida */}
        <motion.div
          className="absolute bottom-[10%] left-[31%] w-[38%]"
          initial={{ y: 300 }}
          animate={fase >= 3 ? { y: 0 } : { y: 300 }}
          transition={{ type: "spring", stiffness: 90, damping: 14 }}
        >
          <div className="rounded-t-full border-4 border-stone-600 bg-stone-400 px-3 pt-6 pb-4 text-center text-stone-800 shadow-xl">
            <div className="text-2xl font-black tracking-widest">R.I.P.</div>
            <div className="mt-1 truncate font-bold">{datos.nombre}</div>
            <div className="font-mono text-xs">ID {datos.id}</div>
            <div className="mt-1 text-[10px] leading-tight">
              {plural(datos.muestras, "muestra")}
              <br />
              {datos.muestras === 1 ? "borrada" : "borradas"} del CSV
            </div>
          </div>
        </motion.div>
      </motion.div>

      <motion.div
        className="mt-5 text-center text-white"
        initial={{ opacity: 0 }}
        animate={{ opacity: fase >= 3 ? 1 : 0 }}
      >
        <div className="text-2xl font-bold">{datos.nombre} ha sido eliminado 💀</div>
        <div className="mt-1 text-sm text-white/70">Sus datos biométricos ya no existen</div>
      </motion.div>
    </Escena>
  )
}
