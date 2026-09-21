'use client'

import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * T083 · `Entity` — la fila de contenido descriptivo con uno o dos controles.
 *
 * Es la forma que repiten el inventario de credenciales, la lista de agentes y
 * las filas de conexiones: a la izquierda quien es la cosa, a la derecha que se
 * puede hacer con ella. Geist la publica como componente propio precisamente
 * porque la alternativa —una tabla de dos columnas con un boton metido en una
 * celda— se lee peor y se opera peor.
 *
 * Doctrina de `research.md` §2 aplicada aqui:
 *
 *   - Espaciado y alineacion antes que bordes y cajas. La fila NO tiene marco.
 *     Lo que la separa de la de arriba es el aire; lo que la resalta al pasar
 *     por encima es un fondo translucido (`gray-alpha`, no `gray`, porque la
 *     lista puede vivir sobre un material y el gris opaco lo cortaria).
 *   - La descripcion no se trunca. Si el texto es largo ocupa lo que ocupe,
 *     por la misma razon que FR-062 en la bandeja: una fila alta es mejor que
 *     una decision tomada con media frase.
 *   - `identificador` va en Geist Mono porque es un identificador operativo.
 *     El titulo y la descripcion van en Sans porque son prosa.
 *
 * EL DETALLE QUE HACE QUE ESTO SEA OPERABLE, y la razon de que `alPulsar` no
 * envuelva la fila entera en un `<button>`: una fila pulsable que ademas
 * contiene botones seria un boton dentro de otro boton. El HTML lo prohibe, el
 * navegador lo "arregla" cerrando el primero antes de tiempo, y el lector de
 * pantalla anuncia una estructura que no existe. La solucion es la de siempre:
 * el boton es el TITULO, y se estira sobre la fila con un pseudoelemento
 * (`after:absolute after:inset-0`); los controles van encima con `relative`.
 * Asi hay una sola zona pulsable por accion, el foco cae donde esta el nombre,
 * y el raton puede pulsar en cualquier hueco de la fila.
 */

export interface PropsDeEntity {
  /** Quien es la cosa. Prosa: Sans. */
  titulo: ReactNode
  /** Identificador operativo (id, huella, ruta). Geist Mono, y solo esto. */
  identificador?: string
  /** Texto completo. No se trunca nunca. */
  descripcion?: ReactNode
  /** Icono o avatar. Decorativo: no aporta texto, va `aria-hidden`. */
  miniatura?: ReactNode
  /** Metadatos cortos bajo la descripcion: `Badge`, instantes, alcances. */
  metadatos?: ReactNode
  /** Uno o dos controles. Tres ya no es una fila, es un menu. */
  acciones?: ReactNode
  /** Si se pasa, el titulo se vuelve pulsable y cubre toda la fila. */
  alPulsar?: () => void
  seleccionada?: boolean
  /**
   * `li` cuando la fila vive dentro de `ListaDeEntidades`; `div` suelta. Se
   * declara en vez de deducirse para que el marcado sea valido a la vista:
   * un `div` dentro de un `ul` no lo es, y nadie lo nota hasta la auditoria.
   */
  contenedor?: 'div' | 'li'
  className?: string
}

export function Entity({
  titulo,
  identificador,
  descripcion,
  miniatura,
  metadatos,
  acciones,
  alPulsar,
  seleccionada = false,
  contenedor = 'div',
  className,
}: PropsDeEntity) {
  const Contenedor = contenedor

  return (
    <Contenedor
      aria-current={seleccionada ? 'true' : undefined}
      className={cn(
        'group relative flex items-start gap-3 rounded-md px-3 py-3 transition-colors',
        alPulsar ? 'hover:bg-ds-gray-alpha-100' : null,
        seleccionada ? 'bg-ds-gray-alpha-100' : null,
        className,
      )}
    >
      {miniatura ? (
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-ds-gray-700 [&_svg]:size-4"
        >
          {miniatura}
        </span>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {alPulsar ? (
            <button
              type="button"
              onClick={alPulsar}
              className="rounded-sm text-label-14 text-ds-gray-1000 after:absolute after:inset-0 after:rounded-md"
            >
              {titulo}
            </button>
          ) : (
            <span className="text-label-14 text-ds-gray-1000">{titulo}</span>
          )}

          {identificador ? (
            <span className="fuente-operativa text-label-12 text-ds-gray-700">
              {identificador}
            </span>
          ) : null}
        </div>

        {descripcion ? (
          <p className="text-copy-14 text-ds-gray-900">{descripcion}</p>
        ) : null}

        {metadatos ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">{metadatos}</div>
        ) : null}
      </div>

      {acciones ? (
        // `relative` para quedar por encima del pseudoelemento del titulo. Sin
        // esto, el boton de la derecha seria inalcanzable con el raton: la zona
        // estirada del titulo se lo comeria entero.
        <div className="relative flex shrink-0 items-center gap-2">{acciones}</div>
      ) : null}
    </Contenedor>
  )
}

/**
 * El contenedor de una lista de entidades.
 *
 * El margen negativo alinea el texto de las filas con el del resto de la
 * pagina: el `px-3` de cada fila existe solo para que el resaltado de hover
 * tenga aire, y sin compensarlo la lista entera aparece indentada respecto al
 * titulo que la encabeza.
 */
export function ListaDeEntidades({
  etiqueta,
  children,
  className,
}: {
  /** Obligatoria: una lista sin nombre es una lista que el lector de pantalla anuncia como "lista, 12 elementos" y nada mas. */
  etiqueta: string
  children: ReactNode
  className?: string
}) {
  return (
    <ul aria-label={etiqueta} className={cn('-mx-3 flex flex-col', className)}>
      {children}
    </ul>
  )
}
