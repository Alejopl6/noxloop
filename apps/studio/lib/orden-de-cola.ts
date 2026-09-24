/**
 * REORDENAR LA FILA DE ESPERA DE LA COLA GLOBAL (spec 005, FR-006).
 *
 * Se manda la fila ENTERA (`PUT /v1/queue {orden}`) y no «mueve X al puesto
 * 2»: con dos ventanas abiertas, un movimiento relativo se aplicaria sobre una
 * fila que la otra ya cambio. El servicio pone primero lo nombrado y deja
 * detras, en su orden, lo que no se nombro (lo que llego mientras tanto).
 *
 * Sin imports de ejecucion: se prueba con `node --test` tal cual
 * (`apps/studio/test/orden-del-board.test.mjs`).
 */

/** La fila con `itemId` movido `delta` puestos (acotado a los bordes). `null` si no cambia nada. */
export function reordenarEspera(ids: readonly string[], itemId: string, delta: number): string[] | null {
  const i = ids.indexOf(itemId)
  if (i === -1) return null
  const j = Math.max(0, Math.min(ids.length - 1, i + delta))
  if (i === j) return null
  const nueva = ids.filter((id) => id !== itemId)
  nueva.splice(j, 0, itemId)
  return nueva
}
