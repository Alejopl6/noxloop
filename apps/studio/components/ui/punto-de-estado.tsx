import { cn } from '@/lib/utils'

/**
 * `StatusDot` — ⚠️ SOLO CICLO DE VIDA DE DESPLIEGUE.
 *
 * ESTO NO ES UN INDICADOR DE ESTADO GENERICO, aunque lo parezca y aunque quepa
 * en cualquier hueco. Geist lo restringe explicitamente al ciclo de vida de un
 * despliegue: preparado, construyendo, en cola, error, cancelado. Esa es la
 * lista entera y no crece.
 *
 * PARA UN RUN, PARA UNA COLA, PARA UNA CREDENCIAL O PARA UNA CONEXION VA
 * `Badge`. La diferencia no es estetica: un punto de color sin texto obliga a
 * aprenderse una leyenda, y en una tabla de veinte runs eso es veinte
 * traducciones mentales por pantalla. El badge lleva la palabra escrita.
 *
 * Por eso aqui la etiqueta tampoco es opcional: el punto acompana al texto,
 * nunca lo sustituye. El punto va `aria-hidden` — ya lo dice la palabra.
 */

export type EstadoDeDespliegue =
  | 'listo'
  | 'construyendo'
  | 'en_cola'
  | 'error'
  | 'cancelado'

const ESTILO: Record<EstadoDeDespliegue, { punto: string; etiqueta: string }> = {
  listo: { punto: 'bg-ds-green-700', etiqueta: 'Listo' },
  construyendo: { punto: 'bg-ds-amber-700', etiqueta: 'Construyendo' },
  en_cola: { punto: 'bg-ds-gray-600', etiqueta: 'En cola' },
  error: { punto: 'bg-ds-red-700', etiqueta: 'Error' },
  cancelado: { punto: 'bg-ds-gray-500', etiqueta: 'Cancelado' },
}

export interface PropsDeStatusDot {
  estado: EstadoDeDespliegue
  /** Sobrescribe la etiqueta por defecto. No la quita: no hay forma de quitarla. */
  etiqueta?: string
  className?: string
}

export function StatusDot({ estado, etiqueta, className }: PropsDeStatusDot) {
  const estilo = ESTILO[estado]

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        aria-hidden="true"
        className={cn('size-2 shrink-0 rounded-full', estilo.punto)}
      />
      <span className="text-label-13 text-ds-gray-1000">{etiqueta ?? estilo.etiqueta}</span>
    </span>
  )
}
