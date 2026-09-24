'use client'

import { useEffect, useMemo, useState } from 'react'

import { EmptyState } from '@/components/ui/estado-vacio'
import { Badge } from '@/components/ui/insignia'
import { Segmentado } from '@/components/ui/segmentado'
import { Tabla, type ColumnaDeTabla } from '@/components/ui/tabla'
import { Encabezado, EsqueletoDeLista, FalloDeLectura } from '@/components/pantalla'
import { PuntoDeProyecto } from '@/components/board/tarjeta'
import { RUTAS, type ErrorDelServicio } from '@/lib/daemon'
import { useLectura } from '@/lib/lectura'
import type { Navegar } from '@/lib/ruta'
import { referenciaDeProyecto, type Uso, type UsoAgregado } from '@/lib/tipos'

/**
 * COSTOS: CUANTO SE GASTO, POR PROYECTO Y POR RUN (US5, FR-028).
 *
 * No es una pantalla de graficos, y a proposito: lo que el operador pregunta
 * aqui son tres numeros —cuanto en total, en que proyecto, en que run— y la
 * respuesta a tres numeros es escribirlos grandes. Las dos tablas de debajo
 * llevan una barra de proporcion de UN solo tono en la columna del gasto, que
 * es lo unico que una tabla no dice de un vistazo: cuanto pesa cada fila sobre
 * el total.
 *
 * «SIN MEDIR» NO ES CERO, y es la regla que decide media pantalla. Un runtime
 * que no reporta gasto produce runs sin cifra; sumarlos como 0 diria que
 * fueron gratis. Se cuentan aparte, en el total y en cada fila, y el total en
 * dinero dice que no los incluye.
 *
 * El dato ya existe en el disco (lo registra cada run); esta pantalla solo lo
 * junta, a traves del servicio.
 */

type Periodo = '7' | '30' | 'todo'

const PERIODOS: Array<{ valor: Periodo; etiqueta: string }> = [
  { valor: '7', etiqueta: '7 dias' },
  { valor: '30', etiqueta: '30 dias' },
  { valor: 'todo', etiqueta: 'Todo' },
]

function dinero(usd: number): string {
  return usd.toLocaleString('es', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

function Cifra({ titulo, valor, nota }: { titulo: string; valor: string; nota?: string }) {
  return (
    <div className="flex min-w-40 flex-col gap-1">
      <dt className="text-label-13 text-ds-gray-900">{titulo}</dt>
      <dd className="fuente-operativa text-heading-32 text-ds-gray-1000">{valor}</dd>
      {nota ? <dd className="text-label-12 text-ds-gray-700">{nota}</dd> : null}
    </div>
  )
}

/** La barra de proporcion: un tono, sin leyenda, el numero escrito al lado. */
function Proporcion({ valor, maximo }: { valor: number; maximo: number }) {
  const ancho = maximo > 0 ? Math.max(2, (valor / maximo) * 100) : 0
  return (
    <span aria-hidden="true" className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-ds-gray-alpha-200 sm:inline-block">
      <span className="block h-full rounded-full bg-ds-blue-700" style={{ width: `${ancho}%` }} />
    </span>
  )
}

function SinMedir({ cantidad }: { cantidad: number }) {
  if (cantidad <= 0) return null
  return <Badge>{cantidad} sin medir</Badge>
}

type FilaDeProyecto = UsoAgregado & { id: string; nombre: string; color: string | null }
type FilaDeRun = Uso['runs'][number] & { nombreDeProyecto: string; idDeProyecto: string; color: string | null }

export function PanelDeCostos({
  uso,
  cargando,
  error,
  periodo,
  alCambiarPeriodo,
  navegar,
}: {
  uso: Uso | null
  cargando: boolean
  error: ErrorDelServicio | null
  periodo: Periodo
  alCambiarPeriodo: (periodo: Periodo) => void
  navegar: Navegar
}) {
  const porProyecto: FilaDeProyecto[] = useMemo(
    () =>
      (uso?.porProyecto ?? [])
        .map((fila) => {
          const proyecto = referenciaDeProyecto(fila.proyecto)
          return {
            ...fila,
            id: proyecto?.id ?? '—',
            nombre: proyecto?.nombre ?? '—',
            color: proyecto?.color ?? null,
          }
        })
        .sort((a, b) => b.usd - a.usd),
    [uso],
  )

  // Los runs mas caros: los medidos por importe; los sin medir al final, que
  // no son «los mas baratos» sino los que no se sabe.
  const runs: FilaDeRun[] = useMemo(
    () =>
      (uso?.runs ?? [])
        .map((run) => {
          const proyecto = referenciaDeProyecto(run.proyecto)
          return {
            ...run,
            idDeProyecto: proyecto?.id ?? '—',
            nombreDeProyecto: proyecto?.nombre ?? '—',
            color: proyecto?.color ?? null,
          }
        })
        .sort((a, b) => {
          if (a.medido !== b.medido) return a.medido ? -1 : 1
          return (b.usd ?? 0) - (a.usd ?? 0)
        })
        .slice(0, 15),
    [uso],
  )

  const maximoProyecto = Math.max(0, ...porProyecto.map((fila) => fila.usd))
  const maximoRun = Math.max(0, ...runs.map((run) => (run.medido ? (run.usd ?? 0) : 0)))

  const columnasDeProyecto: ColumnaDeTabla<FilaDeProyecto>[] = [
    {
      clave: 'proyecto',
      encabezado: 'Proyecto',
      celda: (fila) => (
        <button
          type="button"
          onClick={() => navegar({ seccion: 'runs', id: fila.id })}
          className="flex items-center gap-2 text-label-14 text-ds-gray-1000 hover:underline"
        >
          <PuntoDeProyecto proyecto={fila} />
          {fila.nombre}
        </button>
      ),
    },
    {
      clave: 'usd',
      encabezado: 'Gasto',
      alineacion: 'numero',
      celda: (fila) => (
        <span className="inline-flex items-center justify-end gap-3">
          <Proporcion valor={fila.usd} maximo={maximoProyecto} />
          {dinero(fila.usd)}
        </span>
      ),
    },
    { clave: 'calls', encabezado: 'Invocaciones', alineacion: 'numero', celda: (fila) => fila.calls.toLocaleString('es') },
    {
      clave: 'sinMedir',
      encabezado: 'Sin medir',
      alineacion: 'numero',
      celda: (fila) => (fila.sinMedir > 0 ? <SinMedir cantidad={fila.sinMedir} /> : '—'),
    },
  ]

  const columnasDeRun: ColumnaDeTabla<FilaDeRun>[] = [
    {
      clave: 'run',
      encabezado: 'Run',
      celda: (run) => (
        <button
          type="button"
          onClick={() => navegar({ seccion: 'runs', id: null, run: run.itemId })}
          className="flex min-w-0 flex-col items-start text-left"
        >
          <span className="truncate text-label-14 text-ds-gray-1000 hover:underline">{run.titulo}</span>
          <span className="fuente-operativa text-label-12 text-ds-gray-700">{run.itemId}</span>
        </button>
      ),
    },
    {
      clave: 'proyecto',
      encabezado: 'Proyecto',
      celda: (run) => (
        <span className="flex items-center gap-2 text-label-13 text-ds-gray-1000">
          <PuntoDeProyecto proyecto={{ id: run.idDeProyecto, color: run.color }} />
          {run.nombreDeProyecto}
        </span>
      ),
    },
    {
      clave: 'usd',
      encabezado: 'Gasto',
      alineacion: 'numero',
      celda: (run) =>
        run.medido ? (
          <span className="inline-flex items-center justify-end gap-3">
            <Proporcion valor={run.usd ?? 0} maximo={maximoRun} />
            {dinero(run.usd ?? 0)}
          </span>
        ) : (
          <Badge>sin medir</Badge>
        ),
    },
    {
      clave: 'calls',
      encabezado: 'Invocaciones',
      alineacion: 'numero',
      celda: (run) => (run.medido && run.calls != null ? run.calls.toLocaleString('es') : '—'),
    },
  ]

  const vacio = uso !== null && uso.runs.length === 0 && uso.porProyecto.length === 0

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Encabezado
          titulo="Costos"
          descripcion="Lo gastado por proyecto y por run, dinero e invocaciones, a partir de lo que cada run registra."
        />
        <Segmentado etiqueta="Periodo" opciones={PERIODOS} valor={periodo} alCambiar={alCambiarPeriodo} />
      </div>

      <FalloDeLectura error={uso ? error : null} />
      {cargando ? <EsqueletoDeLista filas={3} /> : null}

      {!uso && error ? (
        <EmptyState
          modo="error"
          titulo="No Se Pudo Leer El Gasto"
          descripcion={<FalloDeLectura error={error} />}
        />
      ) : null}

      {uso ? (
        <dl className="flex flex-wrap gap-x-12 gap-y-6">
          <Cifra
            titulo="Total del periodo"
            valor={dinero(uso.total.usd)}
            nota={
              uso.total.sinMedir > 0
                ? `No incluye ${uso.total.sinMedir} ${uso.total.sinMedir === 1 ? 'run sin medir' : 'runs sin medir'}.`
                : undefined
            }
          />
          <Cifra titulo="Invocaciones" valor={uso.total.calls.toLocaleString('es')} />
          <Cifra
            titulo="Runs sin medir"
            valor={String(uso.total.sinMedir)}
            nota={uso.total.sinMedir > 0 ? 'Su runtime no reporta gasto: no son cero, no se sabe.' : 'Todos los runs del periodo tienen gasto medido.'}
          />
        </dl>
      ) : null}

      {vacio ? (
        <EmptyState
          titulo="Sin Gasto En Este Periodo"
          descripcion="Ningun run registro gasto en el periodo elegido. Amplia el periodo o lanza un run desde el board."
        />
      ) : null}

      {porProyecto.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-heading-16 text-ds-gray-1000">Por proyecto</h2>
          <div className="overflow-x-auto">
            <Tabla columnas={columnasDeProyecto} filas={porProyecto} claveDeFila={(fila) => fila.id} etiqueta="Gasto por proyecto" />
          </div>
        </section>
      ) : null}

      {runs.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-heading-16 text-ds-gray-1000">Los runs mas caros</h2>
          <div className="overflow-x-auto">
            <Tabla columnas={columnasDeRun} filas={runs} claveDeFila={(run) => run.itemId} etiqueta="Runs mas caros" />
          </div>
        </section>
      ) : null}
    </div>
  )
}

const EVENTOS = ['run.cambio', 'sincronizar_completo'] as const

export function VistaDeCostos({ navegar }: { navegar: Navegar }) {
  const [periodo, setPeriodo] = useState<Periodo>('30')
  // `desde` depende de «ahora», que solo se lee despues de hidratar: leerlo en
  // el render haria que el HTML prerenderizado y el cliente no coincidan.
  const [desde, setDesde] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    setDesde(periodo === 'todo' ? null : new Date(Date.now() - Number(periodo) * 86_400_000).toISOString())
  }, [periodo])

  const lectura = useLectura<Uso>(desde === undefined ? null : RUTAS.uso({ desde }), { relerEn: EVENTOS })

  return (
    <PanelDeCostos
      uso={lectura.datos}
      cargando={lectura.datos === null && lectura.error === null}
      error={lectura.error}
      periodo={periodo}
      alCambiarPeriodo={setPeriodo}
      navegar={navegar}
    />
  )
}
