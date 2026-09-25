'use client'

import type { KeyboardEvent } from 'react'
import { ChevronDown, ChevronUp, ChevronsUp, Minus, Plus } from 'lucide-react'

import { Badge } from '@/components/ui/insignia'
import { FalloDeLectura } from '@/components/pantalla'
import { tonoDeEstadoDeRun } from '@/components/runs/estado-de-run'
import { EVENTOS_DE_LA_COLA, RUTAS_DE_ORDEN_Y_COLA, type ErrorDelServicio } from '@/lib/daemon'
import { useLectura } from '@/lib/lectura'
import { reordenarEspera } from '@/lib/orden-de-cola'
import { useMutacion } from '@/lib/mutacion'
import type { AjustesDelServicio, ColaDeRuns, RunCorriendoEnCola, RunEsperandoEnCola } from '@/lib/tipos'

/**
 * LA COLA GLOBAL DE RUNS (spec 005, FR-006): cuantos pueden correr a la vez en
 * esta maquina, quien corre, quien espera y en que puesto.
 *
 * ES GLOBAL, NO DEL PROYECTO. Lo que se agota es la maquina y la cuota del
 * modelo, no el proyecto: por eso esta seccion no se filtra con el proyecto
 * elegido en Runs. Filtrarla ensenaria «#3 en cola» sin los dos que van
 * delante, y el operador no entenderia por que no arranca.
 *
 * REORDENAR ES PEDIR (principio VIII). Subir, bajar o «el siguiente» mandan
 * la fila ENTERA de espera al servicio (`PUT /v1/queue`), que es quien la
 * tiene. Con teclado: `Alt+↑`/`Alt+↓` sobre la fila. El limite se cambia igual,
 * con `PATCH /v1/settings`, y subirlo arranca ya lo que cabe.
 */

/** El tope que acepta el servicio (`packages/service/src/ajustes.mjs`). */
const LIMITE_MAXIMO = 16

function nombreDe(run: RunCorriendoEnCola | RunEsperandoEnCola): string {
  return run.key ?? run.titulo ?? run.itemId
}

export interface PropsDePanelDeCola {
  cola: ColaDeRuns | null
  error: ErrorDelServicio | null
  /** El error de la ULTIMA peticion (reordenar o cambiar el limite). */
  errorDeEnvio: ErrorDelServicio | null
  trabajando: boolean
  alReordenar: (orden: string[]) => void
  alCambiarLimite: (limite: number) => void
}

/** El panel, puro: la cola y los callbacks. Se pinta igual en el catalogo. */
export function PanelDeCola({ cola, error, errorDeEnvio, trabajando, alReordenar, alCambiarLimite }: PropsDePanelDeCola) {
  const esperando = cola?.esperando ?? []
  const corriendo = cola?.corriendo ?? []
  const ids = esperando.map((run) => run.itemId)
  const limite = cola?.limite ?? null

  const mover = (itemId: string, delta: number) => {
    const orden = reordenarEspera(ids, itemId, delta)
    if (orden) alReordenar(orden)
  }
  const alTeclear = (itemId: string) => (evento: KeyboardEvent<HTMLLIElement>) => {
    if (!evento.altKey || trabajando) return
    if (evento.key === 'ArrowUp') {
      evento.preventDefault()
      mover(itemId, -1)
    } else if (evento.key === 'ArrowDown') {
      evento.preventDefault()
      mover(itemId, 1)
    }
  }

  const botonPequeno =
    'flex size-7 items-center justify-center rounded-md text-ds-gray-900 hover:bg-ds-gray-alpha-100 hover:text-ds-gray-1000 disabled:pointer-events-none disabled:opacity-40'

  return (
    <section aria-labelledby="titulo-cola" className="flex flex-col gap-3 rounded-lg p-4 shadow-ds-border">
      <header className="flex flex-wrap items-center gap-3">
        <h2 id="titulo-cola" className="text-heading-16 text-ds-gray-1000">
          Cola
        </h2>
        <span className="text-label-13 text-ds-gray-900">
          {cola ? `${corriendo.length} corriendo · ${esperando.length} esperando` : '—'}
        </span>
        <div role="group" aria-label="Runs simultaneos" className="ml-auto flex items-center gap-1">
          <span className="mr-1 text-label-13 text-ds-gray-900">A la vez</span>
          <button
            type="button"
            className={botonPequeno}
            aria-label="Uno menos a la vez"
            disabled={trabajando || limite === null || limite <= 1}
            onClick={() => limite !== null && alCambiarLimite(limite - 1)}
          >
            <Minus aria-hidden="true" className="size-3.5" />
          </button>
          <output aria-live="polite" className="fuente-operativa w-6 text-center text-label-14 text-ds-gray-1000">
            {limite ?? '—'}
          </output>
          <button
            type="button"
            className={botonPequeno}
            aria-label="Uno mas a la vez"
            disabled={trabajando || limite === null || limite >= LIMITE_MAXIMO}
            onClick={() => limite !== null && alCambiarLimite(limite + 1)}
          >
            <Plus aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      </header>

      <FalloDeLectura error={error} />
      <FalloDeLectura error={errorDeEnvio} />

      {cola && corriendo.length === 0 && esperando.length === 0 ? (
        <p className="text-copy-13 text-ds-gray-900">
          Nada corre ni espera. Un run pedido desde el board entra aqui si ya hay {limite} corriendo.
        </p>
      ) : null}

      {corriendo.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-label-12 uppercase tracking-wide text-ds-gray-700">Corriendo</h3>
          <ul className="flex flex-col gap-1">
            {corriendo.map((run) => (
              <li key={run.itemId} className="flex min-w-0 items-center gap-2 text-label-13">
                <Badge tono={tonoDeEstadoDeRun(run.estado)}>{run.estado}</Badge>
                <span className="min-w-0 truncate text-ds-gray-1000">{nombreDe(run)}</span>
                <span className="ml-auto shrink-0 text-ds-gray-900">{run.proyecto ?? run.projectId}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {esperando.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-label-12 uppercase tracking-wide text-ds-gray-700">
            Esperando <span className="normal-case tracking-normal">· Alt+↑/↓ para reordenar</span>
          </h3>
          <ol className="flex flex-col gap-1" aria-label="Runs esperando, en el orden en que arrancan">
            {esperando.map((run, i) => (
              <li
                key={run.itemId}
                tabIndex={0}
                onKeyDown={alTeclear(run.itemId)}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                aria-label={`#${run.posicion} ${nombreDe(run)}, ${run.proyecto ?? run.projectId}`}
                className="flex min-w-0 items-center gap-2 rounded-md px-1 text-label-13 hover:bg-ds-gray-alpha-100"
              >
                <span className="fuente-operativa w-7 shrink-0 text-ds-gray-900">#{run.posicion}</span>
                <span className="min-w-0 truncate text-ds-gray-1000">{nombreDe(run)}</span>
                <span className="ml-auto shrink-0 text-ds-gray-900">{run.proyecto ?? run.projectId}</span>
                <span className="flex shrink-0 items-center">
                  <button
                    type="button"
                    className={botonPequeno}
                    aria-label={`Que ${nombreDe(run)} sea el siguiente`}
                    title="El siguiente"
                    disabled={trabajando || i === 0}
                    onClick={() => mover(run.itemId, -i)}
                  >
                    <ChevronsUp aria-hidden="true" className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className={botonPequeno}
                    aria-label={`Subir ${nombreDe(run)}`}
                    title="Subir (Alt+↑)"
                    disabled={trabajando || i === 0}
                    onClick={() => mover(run.itemId, -1)}
                  >
                    <ChevronUp aria-hidden="true" className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className={botonPequeno}
                    aria-label={`Bajar ${nombreDe(run)}`}
                    title="Bajar (Alt+↓)"
                    disabled={trabajando || i === esperando.length - 1}
                    onClick={() => mover(run.itemId, 1)}
                  >
                    <ChevronDown aria-hidden="true" className="size-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  )
}

/** La cascara: lee la cola (se relee sola con los eventos de run) y pide los cambios. */
export function SeccionDeCola() {
  const cola = useLectura<ColaDeRuns>(RUTAS_DE_ORDEN_Y_COLA.cola(), { relerEn: EVENTOS_DE_LA_COLA })
  const mutacion = useMutacion()

  return (
    <PanelDeCola
      cola={cola.datos}
      error={cola.error}
      errorDeEnvio={mutacion.error}
      trabajando={mutacion.trabajando}
      alReordenar={async (orden) => {
        if (await mutacion.enviar<ColaDeRuns>('PUT', RUTAS_DE_ORDEN_Y_COLA.cola(), { orden })) cola.releer()
      }}
      alCambiarLimite={async (limite) => {
        const hecho = await mutacion.enviar<AjustesDelServicio>('PATCH', RUTAS_DE_ORDEN_Y_COLA.ajustes(), {
          runsSimultaneos: limite,
        })
        if (hecho) cola.releer()
      }}
    />
  )
}
