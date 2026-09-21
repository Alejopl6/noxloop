'use client'

import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/esqueleto'
import { cn } from '@/lib/utils'
import type { ErrorDelServicio } from '@/lib/daemon'
import type { Lectura } from '@/lib/lectura'
import type { Navegar, Ruta } from '@/lib/ruta'

/**
 * Las tres piezas que repiten TODAS las pantallas de establecimiento.
 *
 * Existen aqui y no copiadas en cada vista por un motivo concreto de cada una:
 *
 *   - `Encabezado`: el enlace de vuelta tiene que ser lo primero que recibe el
 *     foco dentro del contenido, y en once pantallas eso se olvida una vez.
 *   - `FalloDeLectura`: un error que pierde la `accion` por el camino es el
 *     fallo que `daemon.ts` existe para evitar; si cada pantalla lo pinta a su
 *     manera, la decima pinta solo la causa.
 *   - `EsqueletoDeLista`: un esqueleto solo es honesto cuando la forma de lo
 *     que viene ya se conoce. Este se usa unicamente para listas de filas, que
 *     es el unico sitio donde eso es cierto.
 *
 * Nada de esto es una caja. Son titulos, aire y alineacion — la doctrina de
 * Geist de `research.md` §2 aplicada al esqueleto de la pagina.
 */

export function Encabezado({
  titulo,
  descripcion,
  volver,
  navegar,
  acciones,
  identificador,
}: {
  titulo: string
  descripcion?: ReactNode
  /** A donde lleva el enlace de vuelta. Sin esto no se pinta. */
  volver?: { ruta: Ruta; etiqueta: string }
  navegar?: Navegar
  /** Controles de la pantalla. A la derecha del titulo. */
  acciones?: ReactNode
  /** Identificador operativo del objeto que se mira. Geist Mono. */
  identificador?: string
}) {
  return (
    <div className="flex flex-col gap-2">
      {volver && navegar ? (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 self-start"
          onClick={() => navegar(volver.ruta)}
        >
          <ArrowLeft />
          {volver.etiqueta}
        </Button>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-heading-24 text-ds-gray-1000">{titulo}</h1>
            {identificador ? (
              <span className="fuente-operativa text-label-12 text-ds-gray-700">
                {identificador}
              </span>
            ) : null}
          </div>
          {descripcion ? (
            <p className="max-w-2xl text-copy-14 text-ds-gray-900">{descripcion}</p>
          ) : null}
        </div>

        {acciones ? <div className="flex flex-wrap items-center gap-2">{acciones}</div> : null}
      </div>
    </div>
  )
}

/**
 * Un fallo de lectura, junto a lo que no se pudo leer.
 *
 * NO BORRA LO QUE YA HABIA: `useLectura` conserva los datos viejos al fallar y
 * esta pieza se pinta AL LADO, nunca en su lugar. Vaciar la pantalla ante un
 * corte de red castiga al operador por algo que no hizo.
 *
 * Y va en ese orden —causa, despues accion— porque una accion leida antes de
 * la causa es un ritual: el operador pulsa lo que le dicen sin saber que
 * estaba roto.
 */
export function FalloDeLectura({
  error,
  className,
}: {
  error: ErrorDelServicio | null
  className?: string
}) {
  if (!error) return null

  return (
    <div className={cn('flex flex-col gap-1', className)} role="status" aria-live="polite">
      <p className="text-copy-13 text-ds-gray-900">{error.causa}</p>
      <p className="text-copy-13 text-ds-gray-1000">{error.accion}</p>
      <p className="fuente-operativa text-label-12 text-ds-gray-700">
        codigo: {error.codigo}
        {error.recurso ? ` · ${error.recurso}` : null}
      </p>
    </div>
  )
}

/** Filas de altura conocida mientras llega una lista. Ver la cabecera. */
export function EsqueletoDeLista({ filas = 3 }: { filas?: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4 py-2">
      <span className="sr-only">Cargando</span>
      {Array.from({ length: filas }, (_, indice) => (
        <div key={indice} className="flex flex-col gap-2">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-4 w-full max-w-xl" />
        </div>
      ))}
    </div>
  )
}

/**
 * `true` mientras una lectura no tiene NI datos NI error.
 *
 * Es el unico momento en que un esqueleto es honesto: despues, o hay datos
 * (y se pintan) o hay un fallo (y se nombra). Un esqueleto que convive con
 * datos viejos dice que no hay nada, y si lo hay.
 */
export function estaCargandoPorPrimeraVez<T>(lectura: Lectura<T>): boolean {
  return lectura.datos === null && lectura.error === null
}
