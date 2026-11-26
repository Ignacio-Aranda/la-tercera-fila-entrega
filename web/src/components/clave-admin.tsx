import { useState } from "react"
import { KeyRoundIcon, LockIcon } from "lucide-react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, guardarClaveAdmin, useClaveAdmin } from "@/lib/api"

/** Botón de la cabecera con el rol activo y el diálogo para la clave de administración. */
export function ClaveAdmin({
  admin,
  escritura,
}: {
  admin: boolean
  escritura: boolean | undefined
}) {
  const clave = useClaveAdmin()
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [comprobando, setComprobando] = useState(false)

  const abrir = (v: boolean) => {
    setAbierto(v)
    setTexto("")
    setError(null)
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => abrir(true)} aria-label="Clave de administración">
        {admin ? <KeyRoundIcon /> : <LockIcon />}
        <Badge variant={admin ? "default" : "secondary"}>{admin ? "Admin" : "Usuario"}</Badge>
      </Button>

      <AlertDialog open={abierto} onOpenChange={abrir}>
        <AlertDialogContent>
          <form
            className="contents"
            onSubmit={async (e) => {
              e.preventDefault()
              // La clave solo se guarda si la API la acepta como de administración.
              setComprobando(true)
              try {
                if (await api.esClaveAdmin(texto.trim())) {
                  guardarClaveAdmin(texto.trim())
                  abrir(false)
                } else {
                  setError("Clave incorrecta")
                }
              } catch (err) {
                setError(err instanceof Error ? err.message : "No se pudo comprobar la clave")
              } finally {
                setComprobando(false)
              }
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>Clave de administración</AlertDialogTitle>
              <AlertDialogDescription>
                {escritura === false
                  ? "El servidor no tiene clave de administración: inscribir y borrar están deshabilitados."
                  : "Necesaria para inscribir y borrar usuarios; con ella también se ven los scores y se puede cambiar el umbral. Se guarda solo durante esta sesión del navegador."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <Label htmlFor="clave-admin">
                {clave ? "Hay una clave guardada. Nueva clave" : "Clave"}
              </Label>
              <Input
                id="clave-admin"
                type="password"
                autoComplete="off"
                value={texto}
                onChange={(e) => {
                  setTexto(e.target.value)
                  setError(null)
                }}
                aria-invalid={!!error}
                autoFocus
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <AlertDialogFooter>
              {clave && (
                <Button
                  type="button"
                  variant="destructive"
                  className="sm:mr-auto"
                  onClick={() => {
                    guardarClaveAdmin(null)
                    abrir(false)
                  }}
                >
                  Quitar clave
                </Button>
              )}
              <AlertDialogCancel type="button">Cancelar</AlertDialogCancel>
              <Button type="submit" disabled={!texto.trim() || comprobando}>
                Guardar
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
