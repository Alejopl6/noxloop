import type { ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * `Note` — el aviso en linea, junto a lo que explica.
 *
 * SE LLAMA `Note`, NO `Callout`. En Geist no existe ningun `Callout`; el nombre
 * viene de otros sistemas y quien lo busque en la documentacion de Geist no
 * encuentra nada. La trampa de nombres esta catalogada en `research.md` §2
 * junto a `Switch` (que alli es un control segmentado, no un booleano) y a
 * `Stack` y `Popover` (que no existen).
 *
 * Cuando usar esto y cuando no: `Note` es para lo que el operador necesita
 * saber MIENTRAS mira algo concreto — va pegada a ese algo. Lo que ocurrio
 * como consecuencia de una accion suya va en un toast (`sonner`). Y lo que
 * invalida un campo va junto al campo, nunca en un toast: "elige el canal por
 * como el usuario vivio el evento, no por el codigo HTTP".
 *
 * El icono es la senal no cromatica. Sin el, una nota de error y una de exito
 * son el mismo rectangulo para quien no distingue rojo de verde.
 */

export type TipoDeNota = 'neutral' | 'informativo' | 'exito' | 'advertencia' | 'error'

const ESTILO: Record<TipoDeNota, { caja: string; icono: string; Icono: typeof Info }> = {
  neutral: {
    caja: 'bg-ds-gray-100 text-ds-gray-900',
    icono: 'text-ds-gray-700',
    Icono: Info,
  },
  informativo: {
    caja: 'bg-ds-blue-100 text-ds-gray-1000',
    icono: 'text-ds-blue-900',
    Icono: Info,
  },
  exito: {
    caja: 'bg-ds-green-100 text-ds-gray-1000',
    icono: 'text-ds-green-900',
    Icono: CircleCheck,
  },
  advertencia: {
    caja: 'bg-ds-amber-100 text-ds-gray-1000',
    icono: 'text-ds-amber-900',
    Icono: TriangleAlert,
  },
  error: {
    caja: 'bg-ds-red-100 text-ds-gray-1000',
    icono: 'text-ds-red-900',
    Icono: CircleAlert,
  },
}

export interface PropsDeNote {
  tipo?: TipoDeNota
  /** Opcional. Si va, es la frase corta; `children` es el desarrollo. */
  titulo?: string
  children: ReactNode
  /** Un control, como mucho. Una nota con tres botones es un formulario. */
  accion?: ReactNode
  className?: string
}

export function Note({ tipo = 'neutral', titulo, children, accion, className }: PropsDeNote) {
  const { caja, icono, Icono } = ESTILO[tipo]

  return (
    <div
      // Solo el error interrumpe al lector de pantalla. Una nota informativa
      // que se anuncia sola es una interrupcion que nadie pidio.
      role={tipo === 'error' ? 'alert' : undefined}
      className={cn('flex items-start gap-2.5 rounded-md px-3 py-2.5', caja, className)}
    >
      <Icono className={cn('mt-0.5 size-4 shrink-0', icono)} aria-hidden="true" />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {titulo ? <p className="text-label-14 text-ds-gray-1000">{titulo}</p> : null}
        <div className="text-copy-13">{children}</div>
      </div>

      {accion ? <div className="shrink-0">{accion}</div> : null}
    </div>
  )
}
