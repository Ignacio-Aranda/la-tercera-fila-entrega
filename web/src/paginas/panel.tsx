import { useEffect, useState } from "react"
import { AnimatePresence } from "motion/react"
import { LockIcon, RefreshCwIcon, Trash2Icon, UserPlusIcon, UsersIcon } from "lucide-react"
import { toast } from "sonner"

import { Disparo, type DatosAnimacion } from "@/components/animaciones"
import { SinResultado } from "@/components/resultado"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api, useClaveAdmin, type Estado, type Usuario } from "@/lib/api"
import { plural } from "@/lib/utils"

function Dato({ titulo, valor, detalle }: { titulo: string; valor: string | number; detalle: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{titulo}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{valor}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{detalle}</CardContent>
    </Card>
  )
}

/** Cara inscrita del usuario, que solo ve el administrador; si no, sus iniciales. */
function Avatar({ usuario, admin }: { usuario: Usuario; admin: boolean }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!admin || !usuario.cara) return
    let vigente = true
    let creada: string | null = null
    api.cara(usuario.id).then((u) => {
      if (vigente) {
        creada = u
        setUrl(u)
      } else if (u) URL.revokeObjectURL(u)
    })
    return () => {
      vigente = false
      if (creada) URL.revokeObjectURL(creada)
      setUrl(null)
    }
  }, [usuario.id, usuario.cara, admin])

  return url ? (
    <img
      src={url}
      alt=""
      className="size-7 shrink-0 rounded-full object-cover ring-1 ring-border"
    />
  ) : (
    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
      {usuario.nombre.slice(0, 2).toUpperCase()}
    </div>
  )
}

export function Panel({
  estado,
  usuarios,
  refrescar,
  irA,
}: {
  estado: Estado | null
  usuarios: Usuario[]
  refrescar: () => void
  irA: (pagina: string) => void
}) {
  const [filtro, setFiltro] = useState("")
  const [aBorrar, setABorrar] = useState<Usuario | null>(null)
  const [disparo, setDisparo] = useState<DatosAnimacion | null>(null)
  const clave = useClaveAdmin()
  const sinEscritura = estado?.escritura_habilitada === false
  const admin = estado?.admin === true

  const visibles = usuarios.filter((u) =>
    `${u.id} ${u.nombre}`.toLowerCase().includes(filtro.toLowerCase())
  )

  const eliminar = async (u: Usuario) => {
    try {
      // La cara se descarga antes de borrar: la API la elimina con el usuario.
      const cara = u.cara ? await api.cara(u.id) : null
      await api.eliminar(u.id)
      setDisparo({ id: u.id, nombre: u.nombre, cara, muestras: u.muestras.length })
      refrescar()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="space-y-6">
      <AnimatePresence>
        {disparo && (
          <Disparo
            datos={disparo}
            onFin={() => {
              if (disparo.cara) URL.revokeObjectURL(disparo.cara)
              setDisparo(null)
              toast.success(`${disparo.nombre} eliminado de la base de datos`)
            }}
          />
        )}
      </AnimatePresence>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Dato titulo="Usuarios inscritos" valor={estado?.usuarios ?? "—"} detalle="Identidades en la base de datos" />
        <Dato titulo="Muestras" valor={estado?.muestras ?? "—"} detalle="Filas del CSV (una por imagen)" />
        <Dato titulo="Detector" valor="YuNet" detalle="OpenCV · 5 puntos clave" />
        <Dato
          titulo="Extractor"
          valor="LVFace-T"
          detalle={`ViT · ${estado?.dimension ?? 512} dimensiones`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Base de datos</CardTitle>
          <CardDescription>
            Plantillas guardadas en <code className="text-xs">datos/base_datos.csv</code>. La
            plantilla de cada usuario es la media de sus muestras.
          </CardDescription>
          <CardAction className="flex gap-2">
            <Button variant="outline" size="icon" onClick={refrescar} aria-label="Recargar">
              <RefreshCwIcon />
            </Button>
            <Button onClick={() => irA("inscribir")}>
              <UserPlusIcon /> Inscribir
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          {usuarios.length === 0 ? (
            <SinResultado icono={<UsersIcon />}>
              Todavía no hay nadie inscrito.
              <Button variant="outline" size="sm" onClick={() => irA("inscribir")}>
                Inscribir al primer usuario
              </Button>
            </SinResultado>
          ) : (
            <>
              {sinEscritura && (
                <Alert>
                  <LockIcon />
                  <AlertDescription>
                    El servidor no tiene clave de administración: no se puede borrar ni inscribir.
                  </AlertDescription>
                </Alert>
              )}
              <Input
                placeholder="Buscar por id o nombre…"
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                className="max-w-xs"
              />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">ID</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Muestras</TableHead>
                    <TableHead className="hidden md:table-cell">Última inscripción</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibles.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-mono text-xs">{u.id}</TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2.5">
                          <Avatar usuario={u} admin={admin} />
                          {u.nombre}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" title={u.muestras.join("\n")}>
                          {u.muestras.length}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {new Date(u.fecha).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Eliminar ${u.nombre}`}
                          title={sinEscritura ? "Borrado deshabilitado en el servidor" : undefined}
                          disabled={sinEscritura}
                          onClick={() => setABorrar(u)}
                        >
                          <Trash2Icon />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {visibles.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        Ningún usuario coincide con «{filtro}»
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!aBorrar} onOpenChange={(abierto) => !abierto && setABorrar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar a {aBorrar?.nombre}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borrará{aBorrar?.muestras.length === 1 ? " su" : "n sus"}{" "}
              {plural(aBorrar?.muestras.length ?? 0, "muestra")} de la base de datos. Habrá que
              volver a inscribirle para reconocerle.
              {!clave && " Hace falta la clave de administración (botón de la llave en la cabecera)."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => aBorrar && eliminar(aBorrar)}>
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
