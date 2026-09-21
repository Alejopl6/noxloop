import { LoaderCircle } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * `Spinner` — algo esta en marcha y no se sabe cuanto falta.
 *
 * La etiqueta NO es opcional y no es decorativa: es lo unico que queda cuando
 * la animacion no corre. `globals.css` respeta `prefers-reduced-motion`
 * apagando las animaciones, asi que con esa preferencia activada esto es un
 * anillo quieto — y un anillo quieto no dice nada. El `role="status"` con el
 * texto dentro es lo que mantiene el componente comprensible en ese caso, y de
 * paso lo que lo hace anunciable por un lector de pantalla.
 *
 * Si se sabe cuanto falta, esto es el componente equivocado: una barra de
 * progreso con porcentaje informa; un spinner eterno solo acompana.
 */

const TAMANOS = {
  sm: 'size-3.5',
  md: 'size-4',
  lg: 'size-5',
} as const

export interface PropsDeSpinner {
  /** Que esta pasando. Verbo + sustantivo, en presente. */
  etiqueta?: string
  tamano?: keyof typeof TAMANOS
  /** Muestra la etiqueta al lado en vez de solo para lectores de pantalla. */
  conTexto?: boolean
  className?: string
}

export function Spinner({
  etiqueta = 'Cargando',
  tamano = 'md',
  conTexto = false,
  className,
}: PropsDeSpinner) {
  return (
    <span
      role="status"
      className={cn('inline-flex items-center gap-2 text-ds-gray-900', className)}
    >
      <LoaderCircle
        aria-hidden="true"
        className={cn('animate-spin motion-reduce:animate-none', TAMANOS[tamano])}
      />
      <span className={conTexto ? 'text-label-13' : 'sr-only'}>{etiqueta}</span>
    </span>
  )
}
