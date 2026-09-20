import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Combina clases resolviendo conflictos de Tailwind (la ultima gana).
 *
 * Vive exactamente aqui y se llama exactamente asi porque es lo que
 * `npx shadcn add` espera encontrar: si el nombre o la ruta cambian, cada
 * componente traido del registro hay que editarlo a mano.
 */
export function cn(...entradas: ClassValue[]): string {
  return twMerge(clsx(entradas))
}
