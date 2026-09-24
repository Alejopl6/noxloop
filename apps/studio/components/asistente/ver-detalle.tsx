'use client'

import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * «Ver detalle» — lo denso, escondido hasta que alguien lo pida.
 *
 * QUE PROBLEMA RESUELVE. El diagnostico del operador era "mucha vaina con una
 * UX muy densa": las pantallas pintan a la vez la decision y toda la evidencia
 * que la respalda. La evidencia tiene que estar —sin ella la decision es un
 * ritual— pero no tiene que estar ABIERTA.
 *
 * POR QUE `<details>` NATIVO Y NO UN ESTADO PROPIO. Sin `@radix-ui/*`, un
 * plegable escrito a mano son cuatro cosas que se olvidan: `aria-expanded`, el
 * foco, que Enter y Espacio abran, y que el contenido plegado no siga siendo
 * alcanzable con el tabulador. `<details>` trae las cuatro del navegador,
 * anuncia su estado a los lectores de pantalla sin que nadie lo declare, y se
 * puede buscar con la busqueda del navegador en los que implementan
 * `hidden="until-found"`. Cero codigo de teclado es cero codigo de teclado con
 * fallos.
 *
 * EL MARCADOR PROPIO Y EL TRIANGULO DE FABRICA. `list-none` y
 * `[&::-webkit-details-marker]:hidden` quitan el triangulo del navegador —son
 * dos selectores porque Safari usa el pseudo-elemento de WebKit y no
 * `list-style`— y el chevron que se pinta en su lugar gira con
 * `--ds-motion-popover-*`, que es el defecto reapuntado en `globals.css`: en
 * este archivo no hay ni un numero de duracion.
 */
export function VerDetalle({
  etiqueta,
  children,
  abiertoPorDefecto = false,
  className,
}: {
  /** Que hay dentro, nombrado. Nunca "Ver mas": eso no dice que se ve. */
  etiqueta: string
  children: ReactNode
  /**
   * Abierto de entrada. Solo para cuando el detalle ES la decision — un diff
   * que hay que leer antes de aprobar no se esconde, FR-026 lo prohibe.
   */
  abiertoPorDefecto?: boolean
  className?: string
}) {
  return (
    <details open={abiertoPorDefecto} className={cn('group flex flex-col', className)}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md py-1 text-ds-gray-900 transition-colors hover:text-ds-gray-1000 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform group-open:rotate-90"
        />
        {/* Sin `cn()`: `twMerge` no conoce `text-label-13` y la borraria al
            ver el `text-ds-gray-*` del contenedor. La explicacion entera esta
            en `components/marco/migas.tsx`. */}
        <span className="text-label-13">{etiqueta}</span>
      </summary>

      <div className="pt-2">{children}</div>
    </details>
  )
}
