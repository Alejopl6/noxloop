import type { ReactNode } from 'react'
import { FileQuestion, Inbox, Lock, TriangleAlert } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * T083 · `EmptyState` — lo que se ve cuando no hay nada que ver.
 *
 * LOS MODOS EXISTEN PORQUE "NO HAY NADA" SIGNIFICA CUATRO COSAS DISTINTAS, y
 * confundirlas es el fallo clasico de este componente. "Todavia no has creado
 * ninguna" pide una accion; "tu busqueda no encontro nada" pide cambiar la
 * busqueda; "no se pudo cargar" pide reintentar; "no tienes permiso" no pide
 * nada al operador, pide pedirselo a otro. Un unico estado vacio generico
 * ("No hay elementos") manda al operador a probar las cuatro salidas.
 *
 * NO VERIFICADO, y se declara aqui en vez de fingir que esta comprobado
 * (principio X): `research.md` §2 dice que Geist documenta "los modos" del
 * EmptyState, pero no los enumera, y los docs publicos de Geist no son
 * accesibles para contrastarlos. Los cuatro de abajo salen de los casos reales
 * de esta consola, no de una transcripcion. Si alguien consigue la lista
 * original y no coincide, la lista original manda.
 *
 * REGLAS DE REDACCION, que son la mitad del componente:
 *
 *   - Titulo en Title Case y SIN punto final. Es un rotulo, no una frase.
 *   - La descripcion APORTA INFORMACION NUEVA. Si dice lo mismo que el titulo
 *     con otras palabras, sobra: el operador la lee, no aprende nada y aprende
 *     a no leerlas. "No hay credenciales" / "Aun no has anadido credenciales"
 *     es el antipatron exacto.
 *   - UN CTA PRIMARIO COMO MAXIMO. Por eso `accion` es singular y no un array:
 *     el tipo es la guarda. Si hacen falta dos caminos, uno es un enlace en la
 *     descripcion.
 *   - El CTA es VERBO + SUSTANTIVO: "Registrar proyecto", "Anadir credencial".
 *     Prohibido "Empezar", "Comenzar" y cualquier variante: no dicen que va a
 *     pasar al pulsarlas, y el operador tiene que pulsarlas para averiguarlo.
 *   - En modo `filtrado` la consulta se cita VERBATIM entre comillas y en
 *     Geist Mono. Verbatim de verdad: si el operador escribio dos espacios o
 *     una mayuscula de mas, eso es justamente lo que necesita ver, y una
 *     version "limpiada" le esconde la causa.
 *
 * `aria-live="polite"` porque este bloque aparece DESPUES de una accion del
 * operador (filtrar, cargar). Sin el, quien usa lector de pantalla filtra y no
 * recibe ninguna senal de que el resultado ya esta.
 */

export type ModoDeEstadoVacio = 'primero' | 'filtrado' | 'error' | 'sin_permiso'

const ICONO: Record<ModoDeEstadoVacio, typeof Inbox> = {
  primero: Inbox,
  filtrado: FileQuestion,
  error: TriangleAlert,
  sin_permiso: Lock,
}

const COLOR_DEL_ICONO: Record<ModoDeEstadoVacio, string> = {
  primero: 'text-ds-gray-600',
  filtrado: 'text-ds-gray-600',
  // El unico modo con color, y lo lleva porque es el unico que reporta un
  // fallo. Va acompanado del triangulo, que es la senal no cromatica.
  error: 'text-ds-amber-900',
  sin_permiso: 'text-ds-gray-600',
}

export interface PropsDeEmptyState {
  modo?: ModoDeEstadoVacio
  /** Title Case, sin punto final. */
  titulo: string
  /** Informacion NUEVA. Nunca el titulo reformulado. */
  descripcion: ReactNode
  /**
   * La consulta del operador, tal cual la escribio. Solo tiene sentido en modo
   * `filtrado`, y se pinta citada antes de la descripcion.
   */
  consulta?: string
  /** Uno. Verbo + sustantivo. Nunca "Empezar". */
  accion?: ReactNode
  /**
   * `compacto` para un hueco dentro de una pagina que ya tiene contenido;
   * `normal` cuando el estado vacio ES la pagina.
   */
  tamano?: 'compacto' | 'normal'
  className?: string
}

export function EmptyState({
  modo = 'primero',
  titulo,
  descripcion,
  consulta,
  accion,
  tamano = 'normal',
  className,
}: PropsDeEmptyState) {
  const Icono = ICONO[modo]
  const compacto = tamano === 'compacto'

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        // Ni caja ni borde: solo aire y alineacion. Un estado vacio dentro de
        // un recuadro punteado convierte la ausencia de datos en un objeto.
        'flex items-start gap-3',
        compacto ? 'py-6' : 'py-12',
        className,
      )}
    >
      <Icono
        aria-hidden="true"
        className={cn('mt-0.5 size-4 shrink-0', COLOR_DEL_ICONO[modo])}
      />

      <div className="flex max-w-xl flex-col items-start gap-2">
        <p className={cn('text-ds-gray-1000', compacto ? 'text-label-14' : 'text-heading-16')}>
          {titulo}
        </p>

        {consulta !== undefined ? (
          <p className="text-copy-14 text-ds-gray-900">
            Ningun resultado para{' '}
            <span className="fuente-operativa text-ds-gray-1000">«{consulta}»</span>.
          </p>
        ) : null}

        <div className="text-copy-14 text-ds-gray-900">{descripcion}</div>

        {accion ? <div className="pt-1">{accion}</div> : null}
      </div>
    </div>
  )
}
