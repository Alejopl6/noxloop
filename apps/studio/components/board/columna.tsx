'use client'

import type { ReactNode } from 'react'
import {
  ChevronsLeft,
  Circle,
  CircleCheckBig,
  CircleDashed,
  CircleDot,
  GitPullRequest,
  OctagonAlert,
} from 'lucide-react'

import { EsqueletoDeTarjeta } from '@/components/board/tarjeta'
import type { ColumnaDelBoard, IdDeColumna } from '@/lib/tipos'

/**
 * UNA COLUMNA DEL BOARD: icono, titulo, contador, nota y sus tarjetas.
 *
 * SIN CAJA ALREDEDOR. La doctrina de la consola es aire y alineacion antes que
 * bordes, y aqui ademas tiene un porque practico: las tarjetas ya son
 * superficies, y una columna-caja con tarjetas-caja dentro son dos niveles de
 * borde para decir una sola agrupacion. La columna la forman su cabecera y su
 * ancho fijo.
 *
 * EL CONTADOR ES DE LO FILTRADO (FR-007). Cuando el filtro deja fuera
 * tarjetas, se dice cuantas habia —«3 de 11»—: un contador que baja sin
 * explicacion parece un board que perdio datos.
 *
 * LOS ICONOS son los que el operador ya conoce de su gestor de tickets: circulo
 * punteado para lo que aun no se decidio, circulo para lo decidido, circulo
 * con centro para lo que esta en marcha, la rama de PR para la revision, el
 * octogono de alto para lo bloqueado y el circulo cerrado para lo hecho. Son
 * la senal no cromatica de la columna; el color no hace falta.
 *
 * BACKLOG SE PLIEGA (FR-001 revisado sobre el referente Nodal). Es lo que
 * todavia no se decidio hacer, y abierto de serie se come la primera columna
 * de la pantalla con tickets que nadie va a lanzar hoy. Plegado queda como una
 * tira a la izquierda con su contador: se sabe que esta y cuanto pesa.
 */

const ICONO_DE_COLUMNA: Record<IdDeColumna, typeof Circle> = {
  backlog: CircleDashed,
  todo: Circle,
  in_progress: CircleDot,
  in_review: GitPullRequest,
  blocked: OctagonAlert,
  done: CircleCheckBig,
}

const TITULO_POR_DEFECTO: Record<IdDeColumna, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'En curso',
  in_review: 'En revision',
  blocked: 'Bloqueado',
  done: 'Hecho',
}

export function tituloDeColumna(columna: Pick<ColumnaDelBoard, 'id' | 'titulo'>): string {
  return columna.titulo?.trim() || TITULO_POR_DEFECTO[columna.id] || columna.id
}

export function ColumnaDeTarjetas({
  columna,
  visibles,
  base,
  hayFiltros,
  cargando = false,
  plegada = false,
  alAlternar,
  children,
}: {
  columna: ColumnaDelBoard
  /** Cuantas tarjetas quedan a la vista con los filtros puestos. */
  visibles: number
  /**
   * Cuantas habia ANTES de los filtros del operador, ya con el proyecto
   * elegido. No es `columna.total`: ese cuenta el board que pidio el servicio,
   * y con un proyecto elegido diria «3 de 11» contando tarjetas de otros
   * proyectos que nadie filtro.
   */
  base: number
  hayFiltros: boolean
  cargando?: boolean
  /** Solo Backlog: se pinta como una tira estrecha. */
  plegada?: boolean
  /** Presente = la columna se puede plegar y desplegar. */
  alAlternar?: () => void
  children?: ReactNode
}) {
  const Icono = ICONO_DE_COLUMNA[columna.id] ?? Circle
  const titulo = tituloDeColumna(columna)
  const idTitulo = `columna-${columna.id}`
  const cuenta = cargando ? '—' : hayFiltros && visibles !== base ? `${visibles} de ${base}` : String(visibles)

  if (plegada && alAlternar) {
    return (
      <section aria-labelledby={idTitulo} className="flex h-full shrink-0 flex-col">
        <button
          type="button"
          aria-expanded={false}
          onClick={alAlternar}
          title={`Desplegar ${titulo}`}
          className="flex h-full w-10 flex-col items-center gap-2 rounded-lg py-2 text-ds-gray-900 transition-colors hover:bg-ds-gray-alpha-100 hover:text-ds-gray-1000"
        >
          <Icono aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="fuente-operativa text-label-12 text-ds-gray-700">{cuenta}</span>
          <h2
            id={idTitulo}
            className="text-button-14 text-ds-gray-1000 [writing-mode:vertical-rl]"
          >
            {titulo}
          </h2>
        </button>
      </section>
    )
  }

  return (
    <section
      aria-labelledby={idTitulo}
      className="flex h-full w-[19rem] shrink-0 flex-col gap-2 sm:w-80"
    >
      <header className="flex h-8 shrink-0 items-center gap-2 px-1">
        <Icono aria-hidden="true" className="size-3.5 shrink-0 text-ds-gray-900" />
        <h2 id={idTitulo} className="text-button-14 text-ds-gray-1000">
          {titulo}
        </h2>
        <span className="fuente-operativa text-label-13 text-ds-gray-700">{cuenta}</span>
        {alAlternar ? (
          <button
            type="button"
            aria-expanded={true}
            aria-label={`Plegar ${titulo}`}
            title={`Plegar ${titulo}`}
            onClick={alAlternar}
            className="ml-auto flex size-6 items-center justify-center rounded-md text-ds-gray-700 transition-colors hover:bg-ds-gray-alpha-100 hover:text-ds-gray-1000"
          >
            <ChevronsLeft aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
      </header>

      {columna.nota ? (
        // La nota va ARRIBA, antes de las tarjetas: explica por que la columna
        // tiene las que tiene, y leida despues de la ultima tarjeta ya no
        // cambia como se leyo la columna.
        <p className="mx-1 shrink-0 rounded-md bg-ds-gray-alpha-100 px-2 py-1.5 text-copy-13 text-ds-gray-900">
          {columna.nota}
        </p>
      ) : null}

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 pb-4 pt-0.5">
        {cargando ? (
          <div role="status" aria-live="polite" className="flex flex-col gap-2">
            <span className="sr-only">Cargando {titulo}</span>
            <EsqueletoDeTarjeta />
            <EsqueletoDeTarjeta />
            {columna.id === 'todo' || columna.id === 'in_progress' ? <EsqueletoDeTarjeta /> : null}
          </div>
        ) : visibles === 0 ? (
          <p className="rounded-lg border border-dashed border-ds-gray-400 px-3 py-6 text-center text-label-13 text-ds-gray-700">
            {hayFiltros && base > 0 ? 'Ninguna cumple los filtros' : 'Sin tarjetas'}
          </p>
        ) : (
          children
        )}
      </div>
    </section>
  )
}
