'use client'

import { useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * UNA TARJETA QUE SE PUEDE ORDENAR A MANO DENTRO DE SU COLUMNA (spec 005,
 * FR-005). Envuelve la tarjeta sin tocarla: la tarjeta sigue siendo la misma
 * pieza del catalogo, y esto le agrega tres formas de moverla.
 *
 * 1. TECLADO, lo primero: con el foco en cualquier sitio de la tarjeta,
 *    `Alt+↑` la sube y `Alt+↓` la baja. Un orden que solo se consigue
 *    arrastrando deja fuera a quien no usa raton.
 * 2. BOTONES subir/bajar, que aparecen al pasar o al enfocar la tarjeta: el
 *    mismo movimiento, descubrible sin conocer el atajo. Deshabilitados en el
 *    borde, en vez de no hacer nada.
 * 3. ARRASTRAR Y SOLTAR con la API nativa del navegador: soltar sobre otra
 *    tarjeta la deja justo antes. Sin libreria: es un kanban de una columna a
 *    la vez, y lo que se ordena es una lista.
 *
 * SOLO DENTRO DE LA COLUMNA Y DEL PROYECTO. Mover una tarjeta de columna seria
 * cambiarle el estado en el gestor, y eso no lo hace esta pantalla (principio
 * VI): el orden es del servicio, el estado del gestor. Quien decide si un
 * movimiento vale es `orden.ts`; aqui solo se traducen gestos.
 */

/** El tipo MIME propio del arrastre: asi soltar texto o un archivo no se confunde con una tarjeta. */
const TIPO_DE_ARRASTRE = 'application/x-noxloop-tarjeta'

export interface PropsDeTarjetaOrdenable {
  /** El `id` de la tarjeta (`proyecto:ticket`). */
  id: string
  /** Para los nombres accesibles de los botones. */
  nombre: string
  puedeSubir: boolean
  puedeBajar: boolean
  alMover: (delta: -1 | 1) => void
  /** Se solto `arrastrada` justo antes de esta. */
  alSoltarAntes: (arrastrada: string) => void
  /** Hay una peticion de orden en vuelo: no se aceptan mas gestos hasta que vuelva. */
  ocupada?: boolean
  children: ReactNode
}

export function TarjetaOrdenable({
  id,
  nombre,
  puedeSubir,
  puedeBajar,
  alMover,
  alSoltarAntes,
  ocupada = false,
  children,
}: PropsDeTarjetaOrdenable) {
  const [encima, setEncima] = useState(false)

  const alTeclear = (evento: KeyboardEvent<HTMLDivElement>) => {
    if (!evento.altKey || ocupada) return
    if (evento.key === 'ArrowUp' && puedeSubir) {
      evento.preventDefault()
      alMover(-1)
    } else if (evento.key === 'ArrowDown' && puedeBajar) {
      evento.preventDefault()
      alMover(1)
    }
  }

  const alEmpezar = (evento: DragEvent<HTMLDivElement>) => {
    evento.dataTransfer.setData(TIPO_DE_ARRASTRE, id)
    evento.dataTransfer.effectAllowed = 'move'
  }
  const acepta = (evento: DragEvent<HTMLDivElement>) => evento.dataTransfer.types.includes(TIPO_DE_ARRASTRE)

  return (
    <div
      draggable={!ocupada}
      onDragStart={alEmpezar}
      onDragOver={(evento) => {
        if (!acepta(evento)) return
        evento.preventDefault()
        evento.dataTransfer.dropEffect = 'move'
        setEncima(true)
      }}
      onDragLeave={() => setEncima(false)}
      onDrop={(evento) => {
        setEncima(false)
        const arrastrada = evento.dataTransfer.getData(TIPO_DE_ARRASTRE)
        if (!arrastrada || arrastrada === id) return
        evento.preventDefault()
        alSoltarAntes(arrastrada)
      }}
      onKeyDown={alTeclear}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      className={cn(
        'group/orden relative rounded-lg',
        // La linea de «va aqui» encima de la tarjeta sobre la que se suelta.
        encima && 'before:absolute before:-top-1.5 before:inset-x-1 before:h-0.5 before:rounded-full before:bg-ds-blue-700',
        ocupada && 'opacity-70',
      )}
    >
      {children}
      <div
        role="group"
        aria-label={`Orden de ${nombre}`}
        className="absolute right-1.5 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-0.5 rounded-md bg-ds-background-100 opacity-0 shadow-ds-border transition-opacity focus-within:opacity-100 group-hover/orden:opacity-100"
      >
        <button
          type="button"
          disabled={!puedeSubir || ocupada}
          onClick={() => alMover(-1)}
          aria-label={`Subir ${nombre}`}
          title="Subir (Alt+↑)"
          className="flex size-6 items-center justify-center rounded-md text-ds-gray-900 hover:bg-ds-gray-alpha-100 hover:text-ds-gray-1000 disabled:opacity-40"
        >
          <ChevronUp aria-hidden="true" className="size-3.5" />
        </button>
        <button
          type="button"
          disabled={!puedeBajar || ocupada}
          onClick={() => alMover(1)}
          aria-label={`Bajar ${nombre}`}
          title="Bajar (Alt+↓)"
          className="flex size-6 items-center justify-center rounded-md text-ds-gray-900 hover:bg-ds-gray-alpha-100 hover:text-ds-gray-1000 disabled:opacity-40"
        >
          <ChevronDown aria-hidden="true" className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
