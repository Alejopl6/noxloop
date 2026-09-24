'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowUpRight, GitPullRequest } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/estado-vacio'
import { Badge } from '@/components/ui/insignia'
import { Instante, Tabla, type ColumnaDeTabla } from '@/components/ui/tabla'
import { Encabezado, EsqueletoDeLista, FalloDeLectura } from '@/components/pantalla'
import { FiltroDesplegable } from '@/components/board/filtros'
import { PuntoDeProyecto } from '@/components/board/tarjeta'
import { useBoard } from '@/components/board/contexto-board'
import { tonoDeEstadoDeRun } from '@/components/runs/estado-de-run'
import { VistaDeDetalleDeRun } from '@/components/runs/detalle-de-run'
import { SeccionDeCola } from '@/components/cola-de-runs'
import { RUTAS, comoErrorDelServicio, type ErrorDelServicio } from '@/lib/daemon'
import { abrirExterno } from '@/lib/enlace'
import { useLectura } from '@/lib/lectura'
import type { Navegar, Ruta } from '@/lib/ruta'
import { referenciaDeProyecto, type RunListado } from '@/lib/tipos'

/**
 * RUNS: TODOS LOS RUNS DE TODOS LOS PROYECTOS (FR-027).
 *
 * Es el destino «Runs» de la navegacion, y no hay que confundirlo con la
 * pantalla de ciclos de la 002 (`?vista=ciclos`), que era la lista de UN
 * proyecto con el formulario de lanzamiento. Lanzar ahora se hace desde el
 * board; aqui se mira lo que corrio y lo que corre, se filtra por proyecto y
 * por estado, y se abre el detalle de cada uno.
 *
 * EL FILTRO DE PROYECTO VIVE EN LA DIRECCION y viaja al servicio
 * (`?project=`), igual que en el board. El de estado se aplica en el cliente
 * sobre lo que llego: el contrato no enumera los estados de un run, asi que
 * las opciones del filtro salen de los runs que hay, no de una lista escrita
 * aqui.
 */

const EVENTOS_DE_RUNS = ['run.cambio', 'run.estado', 'sincronizar_completo'] as const

export interface PropsDePanelDeListaDeRuns {
  runs: RunListado[] | null
  cargando: boolean
  error: ErrorDelServicio | null
  proyectoId: string | null
  proyectos: Array<{ id: string; nombre: string; color?: string | null }>
  ahora: number
  navegar: Navegar
  alAbrirExterno: (url: string) => void
  /**
   * La cola global (spec 005, FR-006), encima de la lista. Un hueco y no la
   * seccion importada aqui: el panel es puro y se pinta en el catalogo sin
   * servicio, y la cola lee del servicio.
   */
  cola?: ReactNode
}

export function PanelDeListaDeRuns({
  runs,
  cargando,
  error,
  proyectoId,
  proyectos,
  ahora,
  navegar,
  alAbrirExterno,
  cola,
}: PropsDePanelDeListaDeRuns) {
  const [estado, setEstado] = useState<string | null>(null)

  const estados = useMemo(
    () => [...new Set((runs ?? []).map((run) => run.estado))].sort((a, b) => a.localeCompare(b, 'es')),
    [runs],
  )
  const filtrados = useMemo(
    () =>
      (runs ?? []).filter(
        (run) =>
          (!estado || run.estado === estado) &&
          (!proyectoId || referenciaDeProyecto(run.proyecto)?.id === proyectoId),
      ),
    [runs, estado, proyectoId],
  )

  const abrir = (run: RunListado) =>
    navegar({ seccion: 'runs', id: proyectoId, run: run.itemId })

  const columnas: ColumnaDeTabla<RunListado>[] = [
    {
      clave: 'ticket',
      encabezado: 'Ticket',
      celda: (run) => (
        <button type="button" onClick={() => abrir(run)} className="flex min-w-0 flex-col items-start text-left">
          <span className="truncate text-label-14 text-ds-gray-1000 hover:underline">{run.titulo}</span>
          <span className="fuente-operativa text-label-12 text-ds-gray-700">{run.itemId}</span>
        </button>
      ),
    },
    {
      clave: 'proyecto',
      encabezado: 'Proyecto',
      celda: (run) => {
        const proyecto = referenciaDeProyecto(run.proyecto)
        const conColor = proyectos.find((candidato) => candidato.id === proyecto?.id) ?? proyecto
        return proyecto ? (
          <span className="flex items-center gap-2 text-label-13 text-ds-gray-1000">
            <PuntoDeProyecto proyecto={conColor ?? proyecto} />
            {conColor?.nombre ?? proyecto.nombre}
          </span>
        ) : (
          '—'
        )
      },
    },
    {
      clave: 'estado',
      encabezado: 'Estado',
      celda: (run) => <Badge tono={tonoDeEstadoDeRun(run.estado)}>{run.estado}</Badge>,
    },
    {
      clave: 'avance',
      encabezado: 'Avance',
      alineacion: 'operativo',
      celda: (run) =>
        run.avance ? `${run.avance.hechas}/${run.avance.total}${run.avance.fase ? ` · ${run.avance.fase}` : ''}` : '—',
    },
    {
      clave: 'pr',
      encabezado: 'PR',
      celda: (run) =>
        run.pr ? (
          <Button variant="ghost" size="sm" onClick={() => alAbrirExterno(run.pr!)} aria-label={`Abrir el pull request de ${run.itemId}`}>
            <GitPullRequest aria-hidden="true" />
            PR
          </Button>
        ) : (
          '—'
        ),
    },
    {
      clave: 'gasto',
      encabezado: 'Gasto',
      alineacion: 'numero',
      // «sin medir» y no 0: un runtime que no reporta gasto no es gratis.
      celda: (run) =>
        run.gasto && !run.gasto.medido ? (
          <Badge>sin medir</Badge>
        ) : run.gasto?.usd != null ? (
          run.gasto.usd.toLocaleString('es', { style: 'currency', currency: 'USD' })
        ) : (
          '—'
        ),
    },
    {
      clave: 'actualizado',
      encabezado: 'Actualizado',
      alineacion: 'operativo',
      celda: (run) => <Instante valor={run.actualizado ?? run.creado} ahora={ahora} />,
    },
    {
      clave: 'abrir',
      encabezado: '',
      celda: (run) => (
        <Button variant="secondary" size="sm" onClick={() => abrir(run)} aria-label={`Abrir el run ${run.itemId}`}>
          <ArrowUpRight aria-hidden="true" />
          Abrir
        </Button>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <Encabezado
        titulo="Runs"
        descripcion="Lo que el motor corrio y lo que esta corriendo, de todos los proyectos. Se lanza desde el board; aqui se sigue."
      />

      {cola}

      <div className="flex flex-wrap items-center gap-2">
        <FiltroDesplegable
          etiqueta="Proyecto"
          valor={proyectoId}
          alCambiar={(id) => navegar({ seccion: 'runs', id })}
          opciones={[
            { valor: null, etiqueta: 'Todos los proyectos' },
            ...proyectos.map((proyecto) => ({
              valor: proyecto.id,
              etiqueta: proyecto.nombre,
              prefijo: <PuntoDeProyecto proyecto={proyecto} />,
            })),
          ]}
        />
        <FiltroDesplegable
          etiqueta="Estado"
          valor={estado}
          alCambiar={setEstado}
          deshabilitado={estados.length === 0}
          opciones={[{ valor: null, etiqueta: 'Cualquiera' }, ...estados.map((valor) => ({ valor, etiqueta: valor }))]}
        />
        {runs ? (
          <span className="ml-auto text-label-13 text-ds-gray-900">
            {filtrados.length} de {runs.length}
          </span>
        ) : null}
      </div>

      <FalloDeLectura error={runs ? error : null} />
      {cargando ? <EsqueletoDeLista filas={4} /> : null}

      {!cargando && filtrados.length === 0 ? (
        <EmptyState
          modo={error && !runs ? 'error' : estado || proyectoId ? 'filtrado' : 'primero'}
          titulo={
            error && !runs
              ? 'No Se Pudieron Leer Los Runs'
              : estado || proyectoId
                ? 'Ningun Run Con Esos Filtros'
                : 'Todavia No Hay Runs'
          }
          consulta={estado ?? undefined}
          descripcion={
            error && !runs ? (
              <FalloDeLectura error={error} />
            ) : estado || proyectoId ? (
              'Quita un filtro para ver el resto.'
            ) : (
              'Un run empieza al pulsar Run en una tarjeta del board. Aparece aqui en cuanto el motor lo registra.'
            )
          }
          accion={
            !error && !estado && !proyectoId ? (
              <Button size="sm" onClick={() => navegar({ seccion: 'board', id: null })}>
                Ir al board
              </Button>
            ) : undefined
          }
        />
      ) : null}

      <div className="overflow-x-auto">
        <Tabla columnas={columnas} filas={filtrados} claveDeFila={(run) => run.itemId} etiqueta="Runs" />
      </div>
    </div>
  )
}

export function VistaDeListaDeRuns({ ruta, navegar }: { ruta: Ruta; navegar: Navegar }) {
  const proyectoId = ruta.id
  const lectura = useLectura<RunListado[]>(RUTAS.runs({ proyecto: proyectoId }), {
    relerEn: EVENTOS_DE_RUNS,
  })
  const board = useBoard()
  const proyectos = board?.lectura.datos?.proyectos ?? []

  const [ahora, setAhora] = useState(0)
  useEffect(() => {
    setAhora(Date.now())
  }, [lectura.datos])

  const [errorDeEnlace, setErrorDeEnlace] = useState<ErrorDelServicio | null>(null)
  const alAbrirExterno = async (url: string) => {
    setErrorDeEnlace(null)
    try {
      await abrirExterno(url)
    } catch (fallo) {
      setErrorDeEnlace(comoErrorDelServicio(fallo, url))
    }
  }

  return (
    <>
      <FalloDeLectura error={errorDeEnlace} className="pb-4" />
      {ruta.run ? (
        <VistaDeDetalleDeRun
          itemId={ruta.run}
          resumen={lectura.datos?.find((run) => run.itemId === ruta.run) ?? null}
          tareaAbierta={ruta.tarea ?? null}
          alAbrirTarea={(tarea) =>
            navegar({ seccion: 'runs', id: proyectoId, run: ruta.run, tarea })
          }
          alVolver={() => navegar({ seccion: 'runs', id: proyectoId })}
          alAbrirExterno={(url) => void alAbrirExterno(url)}
        />
      ) : (
        <PanelDeListaDeRuns
          runs={lectura.datos}
          cargando={lectura.datos === null && lectura.error === null}
          error={lectura.error}
          proyectoId={proyectoId}
          proyectos={proyectos}
          ahora={ahora}
          navegar={navegar}
          alAbrirExterno={(url) => void alAbrirExterno(url)}
          cola={<SeccionDeCola />}
        />
      )}
    </>
  )
}
