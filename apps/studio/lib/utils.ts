import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * EL FALLO QUE ESTE ARCHIVO EVITA, y estuvo activo en toda la interfaz.
 *
 * `twMerge` resuelve conflictos entre clases de Tailwind quedandose con la
 * ultima de cada grupo. Para saber a que grupo pertenece una clase usa su
 * prefijo, y ahi esta el problema: las utilidades tipograficas de Geist
 * —`text-label-14`, `text-heading-16`, `text-copy-14`, `text-button-14`—
 * empiezan por `text-`, igual que los colores de texto. `twMerge` no las
 * conoce, las mete en el grupo "color de texto", y al encontrarse dos en la
 * misma llamada BORRA UNA:
 *
 *     cn("text-ds-gray-1000 text-label-14")  ->  "text-label-14"     (sin color)
 *     cn("text-button-14 text-ds-gray-900")  ->  "text-ds-gray-900"  (sin tamano)
 *     cn("text-heading-16 text-ds-gray-1000") -> "text-ds-gray-1000" (sin encabezado)
 *
 * No da ningun error. El componente compila, se renderiza, y sale con la
 * tipografia del padre o sin color — y como casi siempre hereda algo
 * parecido, se ve "casi bien". Es la version tipografica del fallo de la
 * paleta: se veia bien y era otra cosa.
 *
 * Lo encontro quien construia el armazon, leyendo el HTML generado: la miga
 * activa salia con `text-label-14` y sin color, y las once entradas de
 * navegacion con color y sin `text-button-14`.
 *
 * ARREGLARLO EN CADA SITIO DE LLAMADA NO ES ARREGLARLO. La primera reaccion
 * —sacar las clases del `cn()` donde se detecte— deja la trampa puesta para el
 * siguiente componente, y el siguiente no va a tener a nadie leyendo el HTML.
 * Se enseña aqui, una vez, y deja de existir.
 */
const TIPOGRAFIA_DE_GEIST = [
  'heading-14', 'heading-16', 'heading-20', 'heading-24', 'heading-32',
  'heading-40', 'heading-48', 'heading-56', 'heading-64', 'heading-72',
  'button-12', 'button-14', 'button-16',
  'label-12', 'label-13', 'label-14', 'label-16', 'label-18', 'label-20',
  'copy-13', 'copy-14', 'copy-16', 'copy-18', 'copy-20', 'copy-24',
] as const

// Los identificadores de grupo propios van como parametro de tipo: sin ellos,
// `extendTailwindMerge` solo admite los grupos que trae de serie y rechaza
// estos dos. Es la forma que la libreria pide para extenderla de verdad.
const mezclar = extendTailwindMerge<'tipografia-geist' | 'movimiento-geist'>({
  extend: {
    classGroups: {
      // Grupo propio, separado del color: dos utilidades de ESTE grupo si
      // entran en conflicto entre si —un `text-copy-14` despues de un
      // `text-heading-16` debe ganar— pero ninguna compite ya con un color.
      'tipografia-geist': [{ text: [...TIPOGRAFIA_DE_GEIST] }],
      // `fuente-operativa` cambia la familia (Geist Mono para identificadores,
      // timestamps y huellas). Va con las familias de fuente para que declarar
      // las dos en la misma llamada resuelva en vez de aplicar las dos.
      'font-family': ['fuente-operativa'],
      // Las utilidades de movimiento: una superficie entra de UNA forma.
      // Declarar dos es un error que conviene que resuelva la ultima en vez de
      // dejar las dos animaciones peleandose.
      'movimiento-geist': ['movimiento-overlay', 'movimiento-popover', 'movimiento-velo', 'movimiento-contenido-cargado'],
    },
    conflictingClassGroups: {
      // El tamano tipografico NO entra en conflicto con el color, que es
      // justamente lo que `twMerge` creia. Se declara vacio a proposito: es la
      // linea que apaga el comportamiento que rompia.
      'tipografia-geist': [],
    },
  },
})

/**
 * Combina clases resolviendo conflictos de Tailwind (la ultima gana).
 *
 * Vive exactamente aqui y se llama exactamente asi porque es lo que
 * `npx shadcn add` espera encontrar: si el nombre o la ruta cambian, cada
 * componente traido del registro hay que editarlo a mano.
 */
export function cn(...entradas: ClassValue[]): string {
  return mezclar(clsx(entradas))
}
