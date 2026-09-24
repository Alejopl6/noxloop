import type { IdDeColumna, Tarjeta } from '@/lib/tipos'

/**
 * EL ORDEN A MANO DE UNA COLUMNA, EN EL CLIENTE (spec 005, FR-005).
 *
 * El servicio guarda el orden POR PROYECTO y REEMPLAZA la columna entera con
 * la lista que llega (`PUT /v1/projects/:id/board/orden`). De ahi salen las
 * dos reglas de este archivo:
 *
 * 1. LA LISTA ES LA DEL PROYECTO DE LA TARJETA, no la de la columna. En
 *    «Todos los proyectos» una columna mezcla proyectos; subir una tarjeta la
 *    cambia con la anterior de SU proyecto, y lo que se manda son los ids de
 *    ese proyecto y ningun otro.
 * 2. LA LISTA LLEVA TAMBIEN LO QUE EL FILTRO OCULTA. El vecino se elige entre
 *    lo visible —subir tiene que mover la tarjeta en pantalla, no cambiarla
 *    con una oculta—, pero la lista que se manda es la completa: sin lo oculto,
 *    reemplazar le borraria la posicion.
 *
 * Solo tipos importados, como `derivar.ts`: se prueba con `node --test` tal
 * cual (`apps/studio/test/orden-del-board.test.mjs`).
 */

type Ordenable = Pick<Tarjeta, 'id'> & { proyecto: { id: string }; ticket: { id: string } }

/** Lo que se le pide al servicio: la columna entera de un proyecto. */
export interface NuevoOrden {
  proyectoId: string
  itemIds: string[]
  /** La pone quien sabe en que columna se movio (la pantalla); este archivo no la necesita. */
  columna?: IdDeColumna
}

function delProyecto<T extends Ordenable>(tarjetas: readonly T[], proyectoId: string): T[] {
  return tarjetas.filter((tarjeta) => tarjeta.proyecto.id === proyectoId)
}

/** Si la tarjeta tiene a quien adelantar (`-1`) o por delante de quien ponerse (`1`). */
export function puedeMover(visibles: readonly Ordenable[], id: string, delta: -1 | 1): boolean {
  const tarjeta = visibles.find((candidata) => candidata.id === id)
  if (!tarjeta) return false
  const suyas = delProyecto(visibles, tarjeta.proyecto.id)
  const i = suyas.findIndex((candidata) => candidata.id === id)
  return i + delta >= 0 && i + delta < suyas.length
}

/**
 * Sube (`-1`) o baja (`1`) una tarjeta un puesto entre las VISIBLES de su
 * proyecto. `null` si no se puede mover (ya esta en el borde).
 *
 * @param base la columna sin los filtros del operador (con el proyecto elegido)
 * @param visibles la columna tal como se ve
 */
export function moverTarjeta(
  base: readonly Ordenable[],
  visibles: readonly Ordenable[],
  id: string,
  delta: -1 | 1,
): NuevoOrden | null {
  const tarjeta = visibles.find((candidata) => candidata.id === id)
  if (!tarjeta) return null
  const proyectoId = tarjeta.proyecto.id
  const suyasVisibles = delProyecto(visibles, proyectoId)
  const i = suyasVisibles.findIndex((candidata) => candidata.id === id)
  const vecino = suyasVisibles[i + delta]
  if (!vecino) return null

  const completa = delProyecto(base, proyectoId).filter((candidata) => candidata.id !== id)
  const j = completa.findIndex((candidata) => candidata.id === vecino.id)
  if (j === -1) return null
  completa.splice(delta === -1 ? j : j + 1, 0, tarjeta)
  return { proyectoId, itemIds: completa.map((candidata) => candidata.ticket.id) }
}

/**
 * Soltar una tarjeta arrastrada ANTES de otra (o al final, con `null`). Solo
 * dentro de su proyecto: soltarla sobre una de otro proyecto no significa
 * nada que el servicio pueda guardar, y se ignora. `null` tambien si no cambia
 * nada.
 */
export function soltarAntesDe(
  base: readonly Ordenable[],
  id: string,
  antesDeId: string | null,
): NuevoOrden | null {
  const tarjeta = base.find((candidata) => candidata.id === id)
  if (!tarjeta || antesDeId === id) return null
  const proyectoId = tarjeta.proyecto.id
  const suyas = delProyecto(base, proyectoId)
  const sin = suyas.filter((candidata) => candidata.id !== id)
  let destino = sin.length
  if (antesDeId !== null) {
    destino = sin.findIndex((candidata) => candidata.id === antesDeId)
    if (destino === -1) return null
  }
  sin.splice(destino, 0, tarjeta)
  const itemIds = sin.map((candidata) => candidata.ticket.id)
  const antes = suyas.map((candidata) => candidata.ticket.id)
  if (itemIds.every((itemId, k) => itemId === antes[k])) return null
  return { proyectoId, itemIds }
}
