import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * T015 · Primitiva base, en la forma exacta de shadcn/ui.
 *
 * La forma importa mas que el contenido: `components/ui/`, `cva` para las
 * variantes, `cn()` desde `@/lib/utils`, `buttonVariants` exportado. Eso es lo
 * que `npx shadcn add <componente>` espera encontrar. Si se escribe "parecido
 * pero a mi manera", cada componente que se traiga del registro hay que
 * reescribirlo a mano, y a la tercera vez nadie lo trae.
 *
 * Diferencia consciente con el original: NO hay `asChild`. El de shadcn usa
 * `@radix-ui/react-slot`, que no es dependencia en la fase A. El dia que se
 * instale Radix, `npx shadcn add button` sobrescribe este archivo y recupera
 * `asChild` sin que se pierda nada: los nombres de variante son los mismos.
 *
 * Los colores salen de los tokens de Geist, no de valores sueltos.
 *
 * MOVIMIENTO: `transition-colors` y nada mas, y las dos partes de esa frase
 * importan.
 *
 * El hover se funde porque dice "esto responde": un boton `ghost` no tiene
 * fondo ni borde, y sin la transicion el unico aviso de que es pulsable es un
 * rectangulo gris que aparece de golpe. La duracion y la curva ya no son el
 * `150ms` de fabrica de Tailwind — `globals.css` reapunta el defecto a
 * `--ds-motion-popover-*`, asi que este archivo no lleva ningun numero.
 *
 * EL ANILLO DE FOCO NO SE ANIMA, y es deliberado: `transition-colors` no
 * incluye `box-shadow`, que es donde vive `--ds-focus-ring`. Quien navega con
 * el tabulador necesita saber DONDE esta, no verlo llegar; fundir el anillo
 * pone 200ms entre la tecla y la respuesta, y al tercer tabulador el operador
 * va por delante de la interfaz. Es NFR-005 y es la razon de que `transition`
 * aqui sea la variante estrecha y no `transition-all`.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-button-14 transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-ds-gray-1000 text-ds-background-100 hover:bg-ds-gray-900',
        secondary:
          'bg-ds-background-100 text-ds-gray-1000 shadow-ds-border hover:bg-ds-gray-100',
        outline:
          'border border-input bg-ds-background-100 text-ds-gray-1000 hover:bg-ds-gray-100',
        ghost: 'text-ds-gray-1000 hover:bg-ds-gray-alpha-100',
        destructive: 'bg-ds-red-700 text-white hover:bg-ds-red-900',
        link: 'text-ds-blue-900 underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 px-3',
        sm: 'h-6 rounded-sm px-2 text-button-12',
        lg: 'h-10 px-4 text-button-16',
        icon: 'size-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

function Button({ className, variant, size, type, ...props }: ButtonProps) {
  return (
    <button
      // Por defecto `submit`, que dentro de un formulario lo envia sin que
      // nadie lo haya pedido. En una consola de solo lectura eso es siempre un
      // accidente.
      type={type ?? 'button'}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
