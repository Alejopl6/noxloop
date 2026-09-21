'use client'

import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import type { Navegar, Ruta } from '@/lib/ruta'

/**
 * Las migas: espacio de trabajo › proyecto › etapa.
 *
 * NO SON DECORACION, y la diferencia se mide asi: cada nivel navega. Una miga
 * que solo se lee es un titulo partido en trozos con barras en medio, y ocupa
 * una linea de la cabecera para no hacer nada.
 *
 * QUE PROBLEMA RESUELVEN AQUI. Estando dentro de la constitution de un
 * proyecto, el marco anterior marcaba "Proyectos" en la barra y no decia de
 * cual: el operador sabia en que etapa estaba y no en que proyecto, que es
 * justo al reves de lo que necesita para decidir. Las migas dicen las dos
 * cosas en una linea y, de paso, devuelven el camino de vuelta a cada nivel
 * sin pasar por la lista.
 *
 * LA FORMA ES LA DE GEIST: texto, separadores en gris y nada mas. Ni fondo, ni
 * caja, ni chevrons como iconos. El separador es una barra `/` marcada como
 * decorativa para que un lector de pantalla lea la ruta como una lista y no
 * como "inicio barra proyectos barra".
 */

export interface Miga {
  /** El texto del nivel. Tambien es el nombre accesible cuando navega. */
  etiqueta: string
  /**
   * A donde lleva. Sin ruta, este nivel es donde se esta: se pinta como texto
   * con `aria-current` y no se puede pulsar.
   */
  ruta?: Ruta
  /**
   * Un control propio en lugar del texto. Lo usa el conmutador de proyecto,
   * que en este nivel no es un enlace sino un selector.
   */
  contenido?: ReactNode
  /**
   * Identificador operativo en vez de nombre: se pinta en Geist Mono. Es el
   * caso del proyecto cuyo nombre todavia no ha llegado del servicio — se
   * ensena el identificador que SI se conoce, en vez de un hueco o un nombre
   * inventado.
   */
  operativo?: boolean
}

/**
 * LAS CLASES DE ESTE ARCHIVO NO PASAN POR `cn()`, Y ESO NO ES UN DESCUIDO.
 *
 * `cn()` termina en `twMerge`, que resuelve conflictos de Tailwind quedandose
 * con la ultima clase de cada grupo. Las utilidades tipograficas de Geist
 * (`text-label-14`, `text-heading-14`, `text-button-14`, `text-copy-13`) son
 * nuestras: `tailwind-merge` no las conoce, las clasifica como color de texto
 * por el prefijo `text-`, y al juntarlas con un `text-ds-gray-*` en la MISMA
 * llamada BORRA UNA DE LAS DOS. Comprobado leyendo el HTML generado: la miga
 * activa salia con `text-label-14` y sin color, y las entradas de la
 * navegacion salian con color y sin tamano.
 *
 * Es el modo de fallo mas incomodo de esta capa, igual que el de la paleta:
 * compila, pasa el typecheck, y el resultado se ve casi bien porque el color o
 * el tamano se heredan del padre. Mientras `cn()` no sepa de estas utilidades,
 * la regla es: tipografia de Geist y color `--ds-*` no viajan juntos por
 * `twMerge`.
 */
function tipografia(miga: Miga): string {
  return miga.operativo ? 'fuente-operativa text-label-13' : 'text-label-14'
}

export function Migas({
  migas,
  navegar,
  className,
}: {
  migas: Miga[]
  navegar: Navegar
  className?: string
}) {
  return (
    <nav aria-label="Ruta actual" className={cn('min-w-0', className)}>
      <ol className="flex min-w-0 items-center gap-1.5">
        {migas.map((miga, indice) => {
          const ultima = indice === migas.length - 1

          return (
            <li key={`${miga.etiqueta}-${indice}`} className="flex min-w-0 items-center gap-1.5">
              {indice > 0 ? (
                <span aria-hidden="true" className="select-none text-ds-gray-700">
                  /
                </span>
              ) : null}

              {miga.contenido ? (
                miga.contenido
              ) : miga.ruta ? (
                <button
                  type="button"
                  onClick={() => navegar(miga.ruta as Ruta)}
                  // El `-mx-1 px-1` deja que el anillo de foco rodee el texto
                  // sin separar las migas entre si: sin el, el anillo corta
                  // justo en las letras de los extremos.
                  className={`-mx-1 min-w-0 truncate rounded-sm px-1 transition-colors ${tipografia(miga)} text-ds-gray-900 hover:text-ds-gray-1000`}
                >
                  {miga.etiqueta}
                </button>
              ) : (
                <span
                  aria-current={ultima ? 'page' : undefined}
                  className={`min-w-0 truncate ${tipografia(miga)} text-ds-gray-1000`}
                >
                  {miga.etiqueta}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
