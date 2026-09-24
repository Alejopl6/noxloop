'use client'

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

import { RUTAS } from '@/lib/daemon'
import { useLectura, type Lectura } from '@/lib/lectura'
import type { Board } from '@/lib/tipos'

/**
 * UNA SOLA LECTURA DEL BOARD PARA TODA LA CONSOLA.
 *
 * Tres piezas la necesitan a la vez: el board, los contadores de la
 * navegacion lateral y la lista «Runs activos». Con una lectura cada una son
 * tres `GET /v1/board` por cada evento del canal —y el board es la respuesta
 * mas cara del servicio: lista tickets en el gestor de cada proyecto—, y peor,
 * tres respuestas que pueden contestar cosas distintas: el lateral diciendo
 * «3 te necesitan» junto a un board que ya muestra dos.
 *
 * SE PIDE EL BOARD GENERAL Y EL PROYECTO SE FILTRA EN EL CLIENTE. El general
 * ya trae las tarjetas de todos los proyectos `ACTIVE`, y el board de un
 * proyecto es exactamente ese subconjunto (spec: «el board general es el mismo
 * board con el filtro de proyecto en Todos»). Pedir `?project=` al cambiar de
 * proyecto seria otra lectura para datos que ya estan en pantalla, y el
 * lateral seguiria necesitando la general.
 *
 * SE RELEE SOLA con `run.cambio` y `board.invalidado` (FR-009), y con los dos
 * eventos de la 002 que tambien la cambian: un proyecto que llega a `ACTIVE`
 * entra al board, y `sincronizar_completo` es el «perdi eventos, relee todo»
 * del canal.
 */

const EVENTOS_DEL_BOARD = [
  'run.cambio',
  'board.invalidado',
  'run.estado',
  'proyecto.estado',
  'sincronizar_completo',
] as const

export interface ValorDelBoard {
  lectura: Lectura<Board>
  /** Edge case «ticket terminado»: los cerrados solo con este filtro. */
  incluirTerminados: boolean
  alCambiarIncluirTerminados: (incluir: boolean) => void
}

const ContextoDeBoard = createContext<ValorDelBoard | null>(null)

export function ProveedorDeBoard({ children }: { children: ReactNode }) {
  const [incluirTerminados, setIncluirTerminados] = useState(false)
  const lectura = useLectura<Board>(RUTAS.board({ incluirTerminados }), {
    relerEn: EVENTOS_DEL_BOARD,
  })

  const valor = useMemo<ValorDelBoard>(
    () => ({
      lectura,
      incluirTerminados,
      alCambiarIncluirTerminados: setIncluirTerminados,
    }),
    [lectura, incluirTerminados],
  )

  return <ContextoDeBoard.Provider value={valor}>{children}</ContextoDeBoard.Provider>
}

/**
 * La lectura compartida, o `null` fuera del marco. Quien la use tiene que
 * saber pintarse sin ella: el catalogo de componentes monta las piezas sin
 * servicio y sin proveedor.
 */
export function useBoard(): ValorDelBoard | null {
  return useContext(ContextoDeBoard)
}
