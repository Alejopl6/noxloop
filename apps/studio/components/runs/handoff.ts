import type { EstadoDeRuntime, EventoDeTranscript, TareaDeRun } from '@/lib/tipos'

/**
 * LO QUE LA INTERFAZ DECIDE DEL HAND-OFF ANTES DE PEDIRLO (spec 005, US3).
 *
 * La regla la aplican el servicio y el motor —este ultimo al escribir—; aqui
 * solo se evita OFRECER lo que se va a rechazar: el runtime del revisor
 * (FR-034), el que ya implementa la tarea, y uno sin sesion. Sin JSX: se prueba
 * con `node --test` (`test/handoff.test.mjs`).
 */

/**
 * Los estados con implementacion pendiente. Es `TRASPASABLES` del motor; una
 * tarea `gated` o despues ya paso su GREEN, y una integrada ya esta en la rama.
 */
export const ESTADOS_TRASPASABLES: readonly string[] = ['pending', 'in_progress', 'red', 'green', 'blocked']

export function tareasTraspasables<T extends Pick<TareaDeRun, 'status'>>(tareas: readonly T[]): T[] {
  return tareas.filter((tarea) => ESTADOS_TRASPASABLES.includes(String(tarea.status)))
}

/** Quien implementa hoy la tarea: su override de un hand-off anterior, o el del run. */
export function implementadorDeTarea(
  tarea: Pick<TareaDeRun, 'implementador'>,
  delRun: string | null,
): string | null {
  return tarea.implementador?.runtime ?? delRun
}

export interface DestinoDeHandoff {
  runtime: string
  nombre: string
  habilitado: boolean
  /** Por que no se puede elegir, en una frase. `null` si se puede. */
  motivo: string | null
}

/**
 * Los runtimes a los que se puede pasar la tarea, TODOS y con su motivo: un
 * selector que esconde opciones no dice por que no estan, y el operador se
 * queda buscando el runtime que conecto ayer.
 */
export function destinosDeHandoff({
  runtimes,
  revisor,
  actual,
}: {
  runtimes: readonly Pick<EstadoDeRuntime, 'runtime' | 'nombre' | 'conectado' | 'detalle' | 'accion'>[]
  revisor: string | null
  actual: string | null
}): DestinoDeHandoff[] {
  return runtimes.map((r) => {
    let motivo: string | null = null
    if (r.runtime === actual) motivo = 'Ya es quien implementa la tarea: para otro intento del mismo, Retry.'
    else if (revisor && r.runtime === revisor)
      motivo = 'Es el runtime del revisor: se revisaria a si mismo (FR-034).'
    else if (!r.conectado) motivo = r.accion ?? `${r.nombre} no tiene sesion ni API key: conectalo en Settings → Modelos.`
    return { runtime: r.runtime, nombre: r.nombre, habilitado: motivo === null, motivo }
  })
}

/** Que runtimes escribieron una fase, en orden de aparicion (el motor los estampa en cada evento). */
export function runtimesDeLosEventos(eventos: readonly Pick<EventoDeTranscript, 'runtime'>[]): string[] {
  const vistos: string[] = []
  for (const e of eventos) {
    if (typeof e.runtime === 'string' && e.runtime && !vistos.includes(e.runtime)) vistos.push(e.runtime)
  }
  return vistos
}
