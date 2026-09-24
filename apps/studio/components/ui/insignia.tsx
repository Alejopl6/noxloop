import type { ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * `Badge` — el estado de una cosa, en una palabra.
 *
 * POR QUE EL ARCHIVO SE LLAMA `insignia.tsx` Y NO `badge.tsx`. shadcn tiene su
 * propio `badge` en el registro, con otras variantes (`default`, `secondary`,
 * `destructive`, `outline`) y sin semantica de estado. Si este archivo se
 * llamara `badge.tsx`, un `npx shadcn add badge` lo sobrescribiria sin avisar y
 * la consola se quedaria con cuatro variantes de estilo donde tenia cinco
 * significados — y nadie lo notaria, porque compila y se ve bien. Con otro
 * nombre, ese comando crea un archivo nuevo al lado y el conflicto se ve.
 *
 * SEMANTICA, que es lo unico que no se negocia (research.md §2):
 *
 *   exito        verde    la cosa esta sana
 *   error        rojo     la cosa fallo
 *   advertencia  ambar    la cosa necesita atencion pero no fallo
 *   informativo  azul     la cosa esta en marcha o es una nota de sistema
 *   neutral      gris     la cosa no tiene estado, o el estado no importa aqui
 *
 * SIN CHECKMARKS NI EQUIS. La tentacion es meter un icono para "ayudar", y el
 * resultado es un badge que dice dos veces lo mismo y ocupa el doble. El texto
 * del badge YA es la senal no cromatica: "Activa", "Caducada", "Revocada" se
 * leen igual en escala de grises. El color solo acelera el barrido visual.
 *
 * Geist define mas tonos (purple, pink, teal). Aqui hay cinco porque esta
 * consola tiene cinco significados. Anadir un tono es anadir un significado, y
 * eso se decide, no se estira.
 */

/**
 * EL CAMBIO DE TONO SE FUNDE, y no por estetica. Un badge cambia de tono solo
 * cuando la cosa cambio de estado —un run que pasa de "En marcha" a "Fallido"—
 * y eso ocurre mientras el operador mira OTRA parte de la pantalla, en una
 * tabla donde hay quince badges mas. Un cambio instantaneo no deja rastro: la
 * tabla simplemente es distinta a la siguiente vez que se mira. El fundido
 * corto es lo que hace que el ojo lo cace de refilon y sepa QUE fila cambio.
 *
 * Con `prefers-reduced-motion` el cambio es instantaneo otra vez, y por eso el
 * texto del badge nunca es opcional: "Fallido" sigue escrito. Lo que se pierde
 * es el aviso de refilon, no la informacion.
 *
 * La duracion y la curva salen del defecto reapuntado en `globals.css`
 * (`--ds-motion-popover-*`); `transition-colors` NO incluye `box-shadow`, asi
 * que el anillo de foco sigue apareciendo instantaneo.
 */
const variantesDeBadge = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full text-label-12 transition-colors',
  {
    variants: {
      tono: {
        neutral: 'bg-ds-gray-100 text-ds-gray-900',
        exito: 'bg-ds-green-100 text-ds-green-900',
        error: 'bg-ds-red-100 text-ds-red-900',
        advertencia: 'bg-ds-amber-100 text-ds-amber-900',
        informativo: 'bg-ds-blue-100 text-ds-blue-900',
      },
      tamano: {
        sm: 'h-5 px-1.5',
        md: 'h-6 px-2',
      },
    },
    defaultVariants: {
      tono: 'neutral',
      tamano: 'sm',
    },
  },
)

export type TonoDeBadge = NonNullable<VariantProps<typeof variantesDeBadge>['tono']>

export interface PropsDeBadge extends VariantProps<typeof variantesDeBadge> {
  children: ReactNode
  className?: string
}

export function Badge({ tono, tamano, className, children }: PropsDeBadge) {
  return <span className={cn(variantesDeBadge({ tono, tamano, className }))}>{children}</span>
}

export { variantesDeBadge }
