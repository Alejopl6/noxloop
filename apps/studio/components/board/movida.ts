import type { DecisionSobreMovida, Tarjeta } from '@/lib/tipos'

/**
 * «SEGUIR AQUI» O «SOLTARLA»: LAS DOS RESPUESTAS A UNA TARJETA MOVIDA (spec
 * 005, US1 esc. 4, FR-004).
 *
 * Una movida es un run de este proyecto cuya issue ya no cumple sus reglas (la
 * movieron de proyecto en el gestor). El chip lo dice; aqui se decide que
 * botones ofrece el detalle y que dice cada uno.
 *
 * EL TEXTO DICE LO QUE NO SE TOCA. «Soltarla» saca la tarjeta del board, y sin
 * decir que la issue sigue en el gestor y el run en disco, el operador cree que
 * esta borrando trabajo. Y dice el DESTINO: decidir sin saber adonde fue la
 * issue es decidir a ciegas.
 *
 * PURO, SIN REACT: lo prueba `test/movida.test.mjs` con `node --test`.
 */

export interface OpcionDeMovida {
  decision: DecisionSobreMovida
  etiqueta: string
  /** Una frase: que pasa al pulsarlo. */
  explicacion: string
}

/** Si la tarjeta es una movida que espera respuesta. */
export function esMovida(tarjeta: Pick<Tarjeta, 'movida' | 'chip'>): boolean {
  return Boolean(tarjeta.movida) && tarjeta.chip?.tipo === 'movida'
}

/** Las dos opciones, «Seguir aqui» primero, o ninguna si no es una movida. */
export function decisionesDeMovida(tarjeta: Pick<Tarjeta, 'movida' | 'chip' | 'proyecto'>): OpcionDeMovida[] {
  if (!esMovida(tarjeta)) return []
  const destino = tarjeta.movida?.destino ?? null
  const donde = destino ? `en «${destino}»` : 'fuera de las reglas de este proyecto'
  return [
    {
      decision: 'seguir',
      etiqueta: 'Seguir aqui',
      explicacion: `La tarjeta se queda en el board de «${tarjeta.proyecto.nombre}» sin este aviso, aunque la issue este ${donde}. El run sigue hasta su PR.`,
    },
    {
      decision: 'soltar',
      etiqueta: 'Soltarla',
      explicacion: `Deja de verse en este board. La issue sigue ${donde} en el gestor y el run en disco no se toca: noxloop no le escribe nada al gestor.`,
    },
  ]
}
