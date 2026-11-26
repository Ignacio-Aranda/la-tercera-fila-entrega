import { useCallback, useEffect, useRef, useState } from "react"
import {
  FingerprintIcon,
  LayoutDashboardIcon,
  ScanFaceIcon,
  ScanSearchIcon,
  ShieldCheckIcon,
  UserPlusIcon,
} from "lucide-react"

import { ClaveAdmin } from "@/components/clave-admin"
import { Badge } from "@/components/ui/badge"
import { Slider } from "@/components/ui/slider"
import { Toaster } from "@/components/ui/sonner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { api, avisarSiCae, useClaveAdmin, type Estado, type Usuario } from "@/lib/api"
import { Detectar } from "@/paginas/detectar"
import { Identificar } from "@/paginas/identificar"
import { Inscribir } from "@/paginas/inscribir"
import { Panel } from "@/paginas/panel"
import { Verificar } from "@/paginas/verificar"

const PAGINAS = [
  { valor: "panel", titulo: "Panel", icono: LayoutDashboardIcon },
  { valor: "inscribir", titulo: "Inscribir", icono: UserPlusIcon },
  { valor: "verificar", titulo: "Verificar", icono: ShieldCheckIcon },
  { valor: "identificar", titulo: "Identificar", icono: ScanSearchIcon },
  { valor: "detectar", titulo: "Detectar", icono: ScanFaceIcon },
]

function leerUmbral() {
  try {
    const v = parseFloat(localStorage.getItem("umbral") ?? "")
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

export default function App() {
  const [pagina, setPagina] = useState("panel")
  const [estado, setEstado] = useState<Estado | null>(null)
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [conectada, setConectada] = useState<boolean | null>(null)
  const [umbral, setUmbral] = useState<number | null>(leerUmbral)
  // Valor que muestra el slider mientras se mueve; el umbral se aplica 300 ms
  // después del último cambio confirmado para no lanzar una petición por paso.
  const [umbralVista, setUmbralVista] = useState<number | null>(null)
  const pendiente = useRef<ReturnType<typeof setTimeout>>(undefined)

  const refrescar = useCallback(async () => {
    try {
      const [e, u] = await Promise.all([api.estado(), api.usuarios()])
      setEstado(e)
      setUsuarios(u)
      setConectada(true)
      setUmbral((actual) => actual ?? e.umbral_defecto)
    } catch {
      setConectada(false)
    }
  }, [])

  // Se repite cada 10 s para que el indicador de la API no se quede desfasado;
  // un fallo de red o 5xx en cualquier petición la marca caída al momento. La
  // primera carga la hace el efecto de la clave, más abajo.
  useEffect(() => {
    avisarSiCae(() => setConectada(false))
    const intervalo = setInterval(refrescar, 10_000)
    return () => clearInterval(intervalo)
  }, [refrescar])

  const cambiarUmbral = (v: number) => {
    setUmbral(v)
    setUmbralVista(null)
    try {
      localStorage.setItem("umbral", String(v))
    } catch {
      // Sin almacenamiento local: el umbral solo dura esta sesión.
    }
  }

  const clave = useClaveAdmin()
  // El rol lo decide la API: /api/estado indica si la clave enviada es válida.
  // Se pide al montar y cada vez que cambia la clave.
  useEffect(() => {
    refrescar()
  }, [clave, refrescar])
  const admin = !!clave && estado?.admin === true
  // La API solo atiende el umbral de la petición si viene de administración;
  // a un usuario normal se le muestra (y se envía) el del servidor.
  const u = admin ? (umbral ?? 0.35) : (estado?.umbral_defecto ?? umbral ?? 0.35)

  return (
    <TooltipProvider>
      <div className="min-h-svh bg-background">
        <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <FingerprintIcon className="size-5" />
              </div>
              <div className="leading-tight">
                <div className="font-semibold">Sistema biométrico facial</div>
                <div className="text-xs text-muted-foreground">YuNet · LVFace · CSV</div>
              </div>
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className={`flex w-48 items-center gap-3 sm:w-60 ${admin ? "" : "opacity-60"}`}
                  >
                    <span className="text-xs whitespace-nowrap text-muted-foreground">Umbral</span>
                    <Slider
                      value={[umbralVista ?? u]}
                      min={0}
                      max={1}
                      step={0.01}
                      disabled={!admin}
                      onValueChange={([v]) => setUmbralVista(v)}
                      onValueCommit={([v]) => {
                        clearTimeout(pendiente.current)
                        pendiente.current = setTimeout(() => cambiarUmbral(v), 300)
                      }}
                    />
                    <span className="w-9 font-mono text-sm tabular-nums">
                      {(umbralVista ?? u).toFixed(2)}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  Similitud coseno mínima para aceptar (verificación) o identificar.
                  {admin
                    ? estado && ` Por defecto ${estado.umbral_defecto}.`
                    : " Solo la administración puede cambiarlo; se usa el del servidor."}
                </TooltipContent>
              </Tooltip>
              <ClaveAdmin admin={admin} escritura={estado?.escritura_habilitada} />
              <Badge
                variant="outline"
                className={
                  conectada === false ? "border-red-500/50 text-red-600 dark:text-red-400" : ""
                }
              >
                <span
                  className={`size-1.5 rounded-full ${
                    conectada === null
                      ? "bg-muted-foreground"
                      : conectada
                        ? "bg-emerald-500"
                        : "bg-red-500"
                  }`}
                />
                {conectada === null ? "Conectando" : conectada ? "API" : "API caída"}
              </Badge>
            </div>
          </div>
        </header>

        <Tabs value={pagina} onValueChange={setPagina} className="mx-auto max-w-6xl gap-6 px-4 py-6">
          <TabsList className="w-full sm:w-fit">
            {PAGINAS.map(({ valor, titulo, icono: Icono }) => (
              <TabsTrigger key={valor} value={valor} aria-label={titulo}>
                <Icono /> <span className="hidden sm:inline">{titulo}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="panel">
            <Panel estado={estado} usuarios={usuarios} refrescar={refrescar} irA={setPagina} />
          </TabsContent>
          <TabsContent value="inscribir">
            <Inscribir
              usuarios={usuarios}
              refrescar={refrescar}
              escritura={estado?.escritura_habilitada}
            />
          </TabsContent>
          <TabsContent value="verificar">
            <Verificar usuarios={usuarios} umbral={u} />
          </TabsContent>
          <TabsContent value="identificar">
            <Identificar umbral={u} hayUsuarios={usuarios.length > 0} />
          </TabsContent>
          <TabsContent value="detectar">
            <Detectar />
          </TabsContent>
        </Tabs>
      </div>
      <Toaster position="bottom-right" richColors />
    </TooltipProvider>
  )
}
