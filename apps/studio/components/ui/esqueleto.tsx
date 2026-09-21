import { cn } from '@/lib/utils'

/**
 * `Skeleton` — el hueco de algo cuya FORMA ya se conoce.
 *
 * Se llama `esqueleto.tsx` por lo mismo que `insignia.tsx`: shadcn publica un
 * `skeleton` en su registro y un `npx shadcn add skeleton` machacaria este sin
 * avisar.
 *
 * REGLA DE USO, que importa mas que el componente: un esqueleto solo es honesto
 * cuando se sabe que va a aparecer y con que forma — una fila de una tabla que
 * ya tiene columnas, un bloque de texto de altura conocida. Para "puede que
 * haya datos o puede que no" el esqueleto MIENTE: promete contenido que quiza
 * no llegue nunca. Ese caso es `Spinner` si es corto, o directamente el valor
 * real. En `vista-inicio.tsx` los indicadores arrancan en cero por eso mismo:
 * cero es la verdad recien instalado, no un placeholder.
 *
 * `aria-hidden` porque no hay nada que anunciar. Quien espera algo debe oirlo
 * del `role="status"` que lo envuelve, no de doce rectangulos grises.
 *
 * Con `prefers-reduced-motion` el pulso se detiene (regla global de
 * `globals.css`) y queda un bloque gris estatico, que sigue comunicando.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-ds-gray-200', className)}
    />
  )
}
