export { cn } from "cn"

/** Número con su sustantivo concordado: «1 muestra», «3 muestras». */
export function plural(n: number, uno: string, varios = `${uno}s`) {
  return `${n} ${n === 1 ? uno : varios}`
}
