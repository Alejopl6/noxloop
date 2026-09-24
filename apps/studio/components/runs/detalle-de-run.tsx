'use client'

import type { ReactNode } from 'react'
import { ArrowLeft, ArrowUpRight, GitPullRequest } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/insignia'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { EsqueletoDeLista, FalloDeLectura } from '@/components/pantalla'
import { formatearGasto } from '@/components/board/detalle-de-tarjeta'
import { PuntoDeProyecto } from '@/components/board/tarjeta'
import { VisorDeDiff, totalesDelDiff } from '@/components/runs/visor-de-diff'
import { etiquetaDeTarea, tonoDeTarea } from '@/components/vista-runs'
import { tonoDeEstadoDeRun } from '@/components/runs/estado-de-run'
import { VistaDeTranscript } from '@/components/runs/transcript-de-tarea'
import { RUTAS, type ErrorDelServicio } from '@/lib/daemon'
import { useLectura } from '@/lib/lectura'
import {
  referenciaDeProyecto,
  type DiffDeTarea,
  type Run,
  type RunListado,
  type TareaDeRun,
} from '@/lib/tipos'
import { cn } from '@/lib/utils'

/**
 * EL DETALLE DE UN RUN: a donde lleva «Abrir run» (US6).
 *
 * Tres alturas, de lo general a lo exacto:
 *
 *   1. la cabecera   que ticket, de que proyecto, en que estado, su PR y su gasto
 *   2. las tareas    cada una con su estado, su agente y cuanto toco (+/−)
 *   3. el diff       al abrir una tarea: sus commits, test e implementacion
 *                    por separado, y lo que lleva sin commitear
 *
 * La tarea abierta viaja en la direccion (`?tarea=`), igual que el run: un
 * diff que se estaba leyendo sigue abierto al recargar.
 *
 * EL RESUMEN DE CADA FILA SALE DEL DIFF DE ESA TAREA, una peticion por fila.
 * `GET /v1/runs/:itemId` trae las tareas pero no su agente ni sus lineas; las
 * trae el diff. Es una lectura por tarea —un run tiene pocas— y es de solo
 * lectura sobre git: mas barato que inventar un resumen que no cuadre con el
 * diff que se abre al pulsar.
 */

export interface PropsDeDetalleDeRun {
  itemId: string
  run: Run | null
  /** La fila de `GET /v1/runs` de este run, si se tiene: estado, gasto, proyecto. */
  resumen: RunListado | null
  cargando: boolean
  error: ErrorDelServicio | null
  tareaAbierta: string | null
  alAbrirTarea: (tareaId: string | null) => void
  alVolver: () => void
  alAbrirExterno: (url: string) => void
  /** Lo que va en la fila de cada tarea: agente y +/−. */
  resumenDeTarea: (tarea: TareaDeRun) => ReactNode
  /** El diff de la tarea abierta. */
  diff: { datos: DiffDeTarea | null; error: ErrorDelServicio | null }
  /**
   * Lo que el agente dijo e hizo en cada fase de la tarea abierta (spec 004,
   * US2). Una funcion y no datos: la vista viva lo lee y lo sigue por el canal,
   * y el catalogo pinta un ejemplo quieto. Sin ella, la seccion no se pinta.
   */
  transcript?: (tarea: TareaDeRun) => ReactNode
}

export function PanelDeDetalleDeRun({
  itemId,
  run,
  resumen,
  cargando,
  error,
  tareaAbierta,
  alAbrirTarea,
  alVolver,
  alAbrirExterno,
  resumenDeTarea,
  diff,
  transcript,
}: PropsDeDetalleDeRun) {
  const proyecto = referenciaDeProyecto(resumen?.proyecto ?? run?.project_id ?? null)
  const titulo = resumen?.titulo ?? run?.item.title ?? itemId
  const pr = resumen?.pr ?? run?.item.pr ?? null
  const gasto =
    resumen?.gasto ??
    (run?.spent ? { usd: run.spent.usd ?? null, calls: run.spent.calls ?? null, medido: run.spent.usd !== undefined } : null)
  const tareas = run?.tasks ?? []
  const abierta = tareas.find((tarea) => tarea.id === tareaAbierta) ?? null

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Button variant="ghost" size="sm" className="-ml-2 self-start" onClick={alVolver}>
          <ArrowLeft aria-hidden="true" />
          Todos los runs
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="flex flex-wrap items-center gap-2 text-label-13 text-ds-gray-900">
              {proyecto ? (
                <>
                  <PuntoDeProyecto proyecto={proyecto} />
                  <span>{proyecto.nombre}</span>
                  <span className="text-ds-gray-700">·</span>
                </>
              ) : null}
              <span className="fuente-operativa text-ds-gray-1000">{itemId}</span>
              {resumen?.estado ? <Badge tono={tonoDeEstadoDeRun(resumen.estado)}>{resumen.estado}</Badge> : null}
            </p>
            <h1 className="text-heading-24 text-ds-gray-1000">{titulo}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {run?.item.url ? (
              <Button variant="secondary" size="sm" onClick={() => alAbrirExterno(run.item.url!)}>
                <ArrowUpRight aria-hidden="true" />
                Ticket
              </Button>
            ) : null}
            {pr ? (
              // Enlace al PR, nunca un boton de merge (principio IV).
              <Button variant="secondary" size="sm" onClick={() => alAbrirExterno(pr)}>
                <GitPullRequest aria-hidden="true" />
                Pull request
              </Button>
            ) : null}
          </div>
        </div>
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-label-13">
          <div className="flex flex-col gap-0.5">
            <dt className="text-ds-gray-900">Avance</dt>
            <dd className="fuente-operativa text-ds-gray-1000">
              {resumen?.avance
                ? `${resumen.avance.hechas}/${resumen.avance.total}${resumen.avance.fase ? ` · ${resumen.avance.fase}` : ''}`
                : `${tareas.filter((tarea) => tarea.status === 'integrated').length}/${tareas.length}`}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-ds-gray-900">Gasto</dt>
            <dd className="text-ds-gray-1000">{formatearGasto(gasto)}</dd>
          </div>
          {run?.item.branch ? (
            <div className="flex flex-col gap-0.5">
              <dt className="text-ds-gray-900">Rama</dt>
              <dd className="fuente-operativa text-ds-gray-1000">{run.item.branch}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      <FalloDeLectura error={error} />
      {cargando ? <EsqueletoDeLista filas={3} /> : null}

      {run ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-heading-16 text-ds-gray-1000">Tareas</h2>
          {tareas.length === 0 ? (
            <p className="text-copy-14 text-ds-gray-900">
              El run todavia no tiene plan: las tareas aparecen cuando el planificador lo parte.
            </p>
          ) : (
            <ul aria-label="Tareas del run" className="flex flex-col divide-y divide-ds-gray-400 rounded-lg shadow-ds-border">
              {tareas.map((tarea) => {
                const esEsta = tarea.id === tareaAbierta
                return (
                  <li key={tarea.id}>
                    <button
                      type="button"
                      aria-expanded={esEsta}
                      onClick={() => alAbrirTarea(esEsta ? null : tarea.id)}
                      className={cn(
                        'flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors',
                        esEsta ? 'bg-ds-gray-alpha-100' : 'hover:bg-ds-gray-alpha-100',
                      )}
                    >
                      <span className="fuente-operativa w-16 shrink-0 text-label-13 text-ds-gray-900">{tarea.id}</span>
                      <span className="min-w-0 flex-1 truncate text-label-14 text-ds-gray-1000">
                        {tarea.title ?? 'Sin titulo'}
                      </span>
                      <Badge tono={tonoDeTarea(tarea.status)}>{etiquetaDeTarea(tarea.status)}</Badge>
                      <span className="flex min-w-40 shrink-0 items-center justify-end gap-3">{resumenDeTarea(tarea)}</span>
                    </button>
                    {tarea.lastFailure && esEsta ? (
                      <p className="whitespace-pre-wrap px-4 pb-3 text-copy-13 text-ds-red-900">{tarea.lastFailure}</p>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      ) : null}

      {abierta && transcript ? (
        <section className="flex flex-col gap-4" aria-label={`Transcript de ${abierta.id}`}>
          {transcript(abierta)}
        </section>
      ) : null}

      {abierta ? (
        <section className="flex flex-col gap-4" aria-label={`Cambios de ${abierta.id}`}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-heading-16 text-ds-gray-1000">Cambios de {abierta.id}</h2>
            {diff.datos?.tarea.agente ? (
              <span className="text-label-13 text-ds-gray-900">
                por <span className="fuente-operativa text-ds-gray-1000">{diff.datos.tarea.agente}</span>
              </span>
            ) : null}
            {diff.datos?.tarea.rama ? (
              <span className="fuente-operativa text-label-12 text-ds-gray-700">{diff.datos.tarea.rama}</span>
            ) : null}
          </div>
          <FalloDeLectura error={diff.error} />
          {diff.datos ? (
            <VisorDeDiff diff={diff.datos} worktree={abierta.worktree} />
          ) : diff.error ? null : (
            <Spinner etiqueta="Leyendo el diff de la tarea" conTexto />
          )}
        </section>
      ) : null}
    </div>
  )
}

/** Agente y +/− de una tarea, leidos de su diff. */
export function ResumenDeDiff({ diff }: { diff: DiffDeTarea | null }) {
  if (!diff) return <span className="text-label-12 text-ds-gray-700">—</span>
  const { mas, menos, archivos } = totalesDelDiff(diff)
  return (
    <>
      {diff.tarea.agente ? (
        <span className="fuente-operativa truncate text-label-12 text-ds-gray-900">{diff.tarea.agente}</span>
      ) : null}
      <span className="fuente-operativa text-label-12">
        <span className="text-ds-green-900">+{mas}</span> <span className="text-ds-red-900">−{menos}</span>
        <span className="text-ds-gray-700"> · {archivos}</span>
      </span>
    </>
  )
}

function ResumenDeDiffLeido({ itemId, tareaId }: { itemId: string; tareaId: string }) {
  const lectura = useLectura<DiffDeTarea>(RUTAS.diffDeTarea(itemId, tareaId))
  if (lectura.error) {
    return (
      <span title={lectura.error.causa} className="text-label-12 text-ds-gray-700">
        sin diff
      </span>
    )
  }
  return <ResumenDeDiff diff={lectura.datos} />
}

const EVENTOS_DEL_RUN = ['run.cambio', 'run.estado', 'sincronizar_completo'] as const

export function VistaDeDetalleDeRun({
  itemId,
  resumen,
  tareaAbierta,
  alAbrirTarea,
  alVolver,
  alAbrirExterno,
}: {
  itemId: string
  resumen: RunListado | null
  tareaAbierta: string | null
  alAbrirTarea: (tareaId: string | null) => void
  alVolver: () => void
  alAbrirExterno: (url: string) => void
}) {
  const lectura = useLectura<Run>(RUTAS.run(itemId), { relerEn: EVENTOS_DEL_RUN })
  const diff = useLectura<DiffDeTarea>(tareaAbierta ? RUTAS.diffDeTarea(itemId, tareaAbierta) : null)

  return (
    <PanelDeDetalleDeRun
      itemId={itemId}
      run={lectura.datos}
      resumen={resumen}
      cargando={lectura.datos === null && lectura.error === null}
      error={lectura.error}
      tareaAbierta={tareaAbierta}
      alAbrirTarea={alAbrirTarea}
      alVolver={alVolver}
      alAbrirExterno={alAbrirExterno}
      resumenDeTarea={(tarea) => <ResumenDeDiffLeido itemId={itemId} tareaId={tarea.id} />}
      // `key` por tarea: cambiar de tarea es otro transcript, no una fusion con el anterior.
      transcript={(tarea) => <VistaDeTranscript key={tarea.id} itemId={itemId} tareaId={tarea.id} />}
      // El diff de la tarea ANTERIOR se descarta mientras llega el de la nueva:
      // `useLectura` conserva los datos al cambiar de ruta, y pintar los
      // cambios de T002 bajo el titulo de T003 es peor que un segundo de
      // espera.
      diff={{
        datos: diff.datos && diff.datos.tarea.id === tareaAbierta ? diff.datos : null,
        error: diff.error,
      }}
    />
  )
}
