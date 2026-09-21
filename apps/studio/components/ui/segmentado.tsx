'use client'

import { useRef, type KeyboardEvent, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * `Segmentado` — elegir UNA opcion entre pocas, con todas a la vista.
 *
 * ES LO QUE GEIST LLAMA `Switch`, y ese nombre es una trampa catalogada en
 * `research.md` §2: en Geist el `Switch` es este control segmentado, no un
 * booleano (el booleano es `Toggle`). Aqui se llama `Segmentado` para que
 * nadie lo confunda al leerlo, y el archivo no se llama `switch.tsx` por lo
 * mismo que `insignia.tsx` no se llama `badge.tsx`: un `npx shadcn add switch`
 * traeria otra cosa con el mismo nombre.
 *
 * CUANDO SE USA ESTO Y CUANDO UN DESPLEGABLE: aqui, dos o tres opciones que
 * CAMBIAN LA PANTALLA (el origen de un proyecto: nuevo, carpeta local,
 * repositorio remoto). Un desplegable esconde las opciones detras de un clic
 * y obliga a abrirlo para saber que hay; con tres opciones eso es esconder
 * media pantalla para ahorrar dos centimetros.
 *
 * EL TECLADO SIGUE EL PATRON `radiogroup` DE ARIA, que no es el mismo que el
 * de una fila de botones: las flechas mueven la seleccion (no solo el foco) y
 * el grupo entero es UNA parada de tabulador. Un grupo de tres botones con
 * `tabindex` propio mete tres paradas en el recorrido y obliga a tabular por
 * las opciones que no se quieren.
 */

export interface OpcionSegmentada<T extends string> {
  valor: T
  etiqueta: string
  /** Que significa elegir esto. Se pinta bajo el grupo, solo la de la activa. */
  descripcion?: ReactNode
  icono?: ReactNode
}

export interface PropsDeSegmentado<T extends string> {
  /** Que se esta eligiendo. Obligatoria: nombra el grupo al lector de pantalla. */
  etiqueta: string
  opciones: OpcionSegmentada<T>[]
  valor: T
  alCambiar: (valor: T) => void
  className?: string
}

export function Segmentado<T extends string>({
  etiqueta,
  opciones,
  valor,
  alCambiar,
  className,
}: PropsDeSegmentado<T>) {
  const botones = useRef(new Map<string, HTMLButtonElement | null>())

  const mover = (paso: number) => {
    if (opciones.length === 0) return
    // Con un `valor` que no esta en la lista se arranca desde la primera, que
    // es donde el anclaje de tabulacion dejo el foco. Rendirse aqui dejaria un
    // grupo alcanzable con el tabulador y sordo a las flechas.
    const actual = opciones.findIndex((opcion) => opcion.valor === valor)
    const indice = actual < 0 ? 0 : actual
    const siguiente = opciones[(indice + paso + opciones.length) % opciones.length]
    alCambiar(siguiente.valor)
    botones.current.get(siguiente.valor)?.focus()
  }

  const alPulsarTecla = (evento: KeyboardEvent<HTMLDivElement>) => {
    switch (evento.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        evento.preventDefault()
        mover(1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        evento.preventDefault()
        mover(-1)
        break
      default:
        break
    }
  }

  const activa = opciones.find((opcion) => opcion.valor === valor)

  // Si `valor` no coincide con ninguna opcion —un estado inicial vacio, un
  // valor que llego del servicio y ya no existe— NINGUN boton tendria
  // `tabIndex={0}` y el grupo entero quedaria fuera del recorrido de teclado,
  // sin forma de volver a entrar. Es el mismo fallo que el arbol de archivos
  // evita cuando la fila activa se pliega. La primera opcion hace de ancla.
  const anclaje = activa ? valor : (opciones[0]?.valor ?? valor)

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        role="radiogroup"
        aria-label={etiqueta}
        onKeyDown={alPulsarTecla}
        className="inline-flex w-fit max-w-full flex-wrap items-center gap-1 rounded-md bg-ds-gray-100 p-1"
      >
        {opciones.map((opcion) => {
          const elegida = opcion.valor === valor
          return (
            <button
              key={opcion.valor}
              ref={(elemento) => {
                botones.current.set(opcion.valor, elemento)
              }}
              type="button"
              role="radio"
              aria-checked={elegida}
              // Roving tabindex: una sola parada para el grupo entero.
              tabIndex={opcion.valor === anclaje ? 0 : -1}
              onClick={() => alCambiar(opcion.valor)}
              className={cn(
                'inline-flex items-center gap-2 rounded-sm px-3 py-1 text-button-14 transition-colors [&_svg]:size-4',
                elegida
                  ? 'bg-ds-background-100 text-ds-gray-1000 shadow-ds-border'
                  : 'text-ds-gray-900 hover:text-ds-gray-1000',
              )}
            >
              {opcion.icono ? (
                <span aria-hidden="true" className="flex items-center">
                  {opcion.icono}
                </span>
              ) : null}
              {opcion.etiqueta}
            </button>
          )
        })}
      </div>

      {/* Solo la descripcion de la opcion activa. Las tres a la vez son tres
          parrafos que el operador tiene que descartar a mano. */}
      {activa?.descripcion ? (
        <p className="text-copy-13 text-ds-gray-900">{activa.descripcion}</p>
      ) : null}
    </div>
  )
}
