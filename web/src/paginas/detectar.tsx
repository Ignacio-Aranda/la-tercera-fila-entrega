import { useEffect, useState } from "react"
import { ScanFaceIcon } from "lucide-react"

import { FuenteImagen, type Imagen } from "@/components/fuente-imagen"
import { SinResultado } from "@/components/resultado"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { api, type ResultadoDeteccion } from "@/lib/api"
import { plural } from "@/lib/utils"

export function Detectar() {
  const [imagen, setImagen] = useState<Imagen | null>(null)
  const [resultado, setResultado] = useState<ResultadoDeteccion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    setResultado(null)
    setError(null)
    if (!imagen) return
    let vigente = true
    setCargando(true)
    api
      .detectar(imagen.blob)
      .then((r) => vigente && setResultado(r))
      .catch((e: Error) => vigente && setError(e.message))
      .finally(() => vigente && setCargando(false))
    return () => {
      vigente = false
    }
  }, [imagen])

  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <Card>
        <CardHeader>
          <CardTitle>Detección de caras</CardTitle>
          <CardDescription>
            Solo la primera etapa: YuNet localiza las caras y sus 5 puntos clave (ojos, nariz y
            comisuras), que luego se usan para alinear.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FuenteImagen
            imagen={imagen}
            onImagen={setImagen}
            cargando={cargando}
            marcas={(resultado?.caras ?? []).map((cara) => ({ cara }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {resultado ? plural(resultado.caras.length, "cara detectada", "caras detectadas") : "Resultado"}
          </CardTitle>
          {resultado && (
            <CardDescription>
              Imagen de {resultado.ancho}×{resultado.alto} px
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : resultado && resultado.caras.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Posición</TableHead>
                  <TableHead>Tamaño</TableHead>
                  <TableHead className="text-right">Confianza</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resultado.caras.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell className="font-mono text-xs">
                      ({c.caja[0].toFixed(0)}, {c.caja[1].toFixed(0)})
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {c.caja[2].toFixed(0)}×{c.caja[3].toFixed(0)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {(c.confianza * 100).toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <SinResultado icono={<ScanFaceIcon />}>
              {cargando
                ? "Detectando…"
                : resultado
                  ? "No se ha detectado ninguna cara."
                  : "Sube una imagen o captura con la webcam."}
            </SinResultado>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
