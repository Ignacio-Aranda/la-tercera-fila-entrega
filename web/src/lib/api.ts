import { useSyncExternalStore } from "react"

export type Cara = {
  caja: [number, number, number, number]
  puntos: [number, number][]
  confianza: number
}

// La API solo devuelve los scores a quien envía la clave de administración;
// a un usuario normal le da únicamente la decisión, para que no pueda guiar
// un ataque de optimización con ellos.
export type Candidato = { id: string; nombre: string; score?: number }

export type Estado = {
  detector: string
  extractor: string
  dimension: number
  umbral_defecto: number
  usuarios: number
  muestras: number
  // false si el servidor no tiene clave de administración: inscribir y borrar
  // están deshabilitados.
  escritura_habilitada: boolean
  // true si la petición llevaba la clave de administración correcta.
  admin: boolean
}

export type Usuario = {
  id: string
  nombre: string
  muestras: string[]
  fecha: string
  cara: boolean
}

export type ResultadoInscripcion = {
  id: string
  nombre: string
  validas: number
  descartadas: string[]
  cara: string
}

export type ResultadoVerificacion = {
  id: string
  nombre: string
  score?: number
  umbral: number
  aceptado: boolean
  sospecha_replay: boolean
  cara: Cara
  alineada: string
}

export type ResultadoIdentificacion = {
  umbral: number
  resultados: {
    cara: Cara
    identificado: Candidato | null
    ranking: Candidato[]
    sospecha_replay: boolean
    alineada: string | null
  }[]
}

export type ResultadoDeteccion = { ancho: number; alto: number; caras: Cara[] }

export class ErrorApi extends Error {}

// Aviso para el indicador de la cabecera cuando una petición no llega a la API
// o esta responde con un 5xx (el proxy devuelve 5xx si la API está caída).
let alCaer = () => {}
export function avisarSiCae(f: () => void) {
  alCaer = f
}

// Clave de administración del operador. Se guarda en sessionStorage para que
// no sobreviva al cierre del navegador; los componentes la leen con
// useClaveAdmin y se re-renderizan cuando cambia.
const CLAVE = "clave_admin"
let claveAdmin: string | null = (() => {
  try {
    return sessionStorage.getItem(CLAVE)
  } catch {
    return null
  }
})()
const oyentesClave = new Set<() => void>()

export function guardarClaveAdmin(clave: string | null) {
  claveAdmin = clave || null
  try {
    if (claveAdmin) sessionStorage.setItem(CLAVE, claveAdmin)
    else sessionStorage.removeItem(CLAVE)
  } catch {
    // Sin almacenamiento de sesión: la clave solo dura hasta recargar.
  }
  oyentesClave.forEach((f) => f())
}

export function useClaveAdmin() {
  return useSyncExternalStore(
    (f) => {
      oyentesClave.add(f)
      return () => oyentesClave.delete(f)
    },
    () => claveAdmin
  )
}

function conClave(init: RequestInit): RequestInit {
  return claveAdmin
    ? { ...init, headers: { Authorization: `Bearer ${claveAdmin}` } }
    : init
}

async function peticion<T>(ruta: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${ruta}`, init)
  } catch {
    alCaer()
    throw new ErrorApi("No se puede conectar con la API")
  }
  if (res.status >= 500) alCaer()
  // 401 solo llega en escrituras con una clave ausente o incorrecta: se olvida
  // para que la cabecera deje de mostrar el rol de administrador.
  if (res.status === 401) guardarClaveAdmin(null)
  const cuerpo = await res.json().catch(() => null)
  if (!res.ok) {
    const detalle = cuerpo?.detail
    throw new ErrorApi(
      typeof detalle === "string" ? detalle : `Error ${res.status} en la API`
    )
  }
  return cuerpo as T
}

function formulario(campos: Record<string, string | Blob | Blob[]>) {
  const fd = new FormData()
  for (const [clave, valor] of Object.entries(campos)) {
    for (const v of Array.isArray(valor) ? valor : [valor]) {
      if (v instanceof File) fd.append(clave, v, v.name)
      else if (v instanceof Blob) fd.append(clave, v, `${clave}.jpg`)
      else fd.append(clave, v)
    }
  }
  return { method: "POST", body: fd }
}

export const api = {
  estado: () => peticion<Estado>("/estado", conClave({})),
  // Comprueba una clave antes de guardarla, sin usar la guardada.
  esClaveAdmin: (clave: string) =>
    peticion<Estado>("/estado", {
      headers: { Authorization: `Bearer ${clave}` },
    }).then((e) => e.admin),
  usuarios: () => peticion<Usuario[]>("/usuarios"),
  // La API solo sirve la cara inscrita al administrador. Devuelve una URL local
  // de la imagen (hay que liberarla con URL.revokeObjectURL) o null.
  cara: (id: string) =>
    fetch(`/api/usuarios/${encodeURIComponent(id)}/cara`, conClave({}))
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => (b ? URL.createObjectURL(b) : null))
      .catch(() => null),
  eliminar: (id: string) =>
    peticion<{ id: string; borradas: number }>(
      `/usuarios/${encodeURIComponent(id)}`,
      conClave({ method: "DELETE" })
    ),
  inscribir: (id: string, nombre: string, imagenes: File[]) =>
    peticion<ResultadoInscripcion>(
      "/inscribir",
      conClave(formulario({ id, nombre, imagenes }))
    ),
  verificar: (id: string, imagen: Blob, umbral: number) =>
    peticion<ResultadoVerificacion>(
      "/verificar",
      conClave(formulario({ id, imagen, umbral: String(umbral) }))
    ),
  identificar: (imagen: Blob, umbral: number, todas = false, top = 5) =>
    peticion<ResultadoIdentificacion>(
      "/identificar",
      conClave(
        formulario({
          imagen,
          umbral: String(umbral),
          todas: String(todas),
          top: String(top),
        })
      )
    ),
  detectar: (imagen: Blob) =>
    peticion<ResultadoDeteccion>("/detectar", formulario({ imagen })),
}
