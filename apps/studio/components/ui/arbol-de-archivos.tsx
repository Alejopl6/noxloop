'use client'

import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronRight, File, Folder } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * T115 · `ArbolDeArchivos` — que ficheros toca una recomendacion.
 *
 * SE ESCRIBE ENTERO PORQUE UN ARBOL ACCESIBLE NO ES UNA LISTA CON SANGRIA. El
 * patron `tree` de ARIA exige navegacion con flechas y UN SOLO tabulador para
 * el arbol completo: con `tabindex="0"` en cada fila, un arbol de ochenta
 * ficheros mete ochenta paradas en el recorrido de teclado de la pagina y
 * atravesarlo cuesta ochenta pulsaciones. El "roving tabindex" de aqui —una
 * sola fila alcanzable, las flechas mueven cual— lo deja en una.
 *
 * El arbol se aplana a una lista de nodos VISIBLES y se pinta plano, con
 * `aria-level`, `aria-posinset` y `aria-setsize` diciendo la jerarquia. Es
 * marcado valido para `role="tree"` y evita el otro camino —`<ul role="group">`
 * anidados— que obliga a recorrer el DOM hacia arriba para responder "cual es
 * el siguiente visible", que es justamente lo que hace cada flecha.
 *
 * EL ESTADO DE CADA FICHERO LLEVA LETRA, NO SOLO COLOR: `A`, `M`, `D`. El color
 * acelera, la letra informa, y en un diff el color es lo primero que se pierde
 * en una captura de pantalla en blanco y negro o para quien no distingue rojo
 * de verde.
 *
 * LO QUE TRAERIA RADIX: nada. No publica un `Tree`. Lo que si simplificaria
 * esto es `@tanstack/react-virtual` el dia que un snapshot traiga miles de
 * ficheros; hasta entonces, pintarlos todos es mas simple y mas correcto.
 */

export type EstadoDeArchivo = 'sin_cambios' | 'anadido' | 'modificado' | 'eliminado'

export interface NodoDeArchivo {
  nombre: string
  tipo: 'directorio' | 'archivo'
  estado?: EstadoDeArchivo
  hijos?: NodoDeArchivo[]
}

const MARCA: Record<Exclude<EstadoDeArchivo, 'sin_cambios'>, { letra: string; clase: string; nombre: string }> = {
  anadido: { letra: 'A', clase: 'text-ds-green-900', nombre: 'anadido' },
  modificado: { letra: 'M', clase: 'text-ds-amber-900', nombre: 'modificado' },
  eliminado: { letra: 'D', clase: 'text-ds-red-900', nombre: 'eliminado' },
}

interface Visible {
  ruta: string
  nodo: NodoDeArchivo
  nivel: number
  rutaPadre: string | null
  posicion: number
  hermanos: number
}

function aplanar(
  nodos: NodoDeArchivo[],
  abiertos: Set<string>,
  prefijo: string,
  nivel: number,
  rutaPadre: string | null,
  acumulado: Visible[],
): Visible[] {
  nodos.forEach((nodo, indice) => {
    const ruta = prefijo ? `${prefijo}/${nodo.nombre}` : nodo.nombre
    acumulado.push({
      ruta,
      nodo,
      nivel,
      rutaPadre,
      posicion: indice + 1,
      hermanos: nodos.length,
    })
    if (nodo.tipo === 'directorio' && nodo.hijos && abiertos.has(ruta)) {
      aplanar(nodo.hijos, abiertos, ruta, nivel + 1, ruta, acumulado)
    }
  })
  return acumulado
}

export interface PropsDeArbolDeArchivos {
  nodos: NodoDeArchivo[]
  /** Que arbol es. Obligatoria: es lo que anuncia el lector de pantalla al entrar. */
  etiqueta: string
  /** Ruta seleccionada (`dir/sub/fichero.ts`). */
  seleccionada?: string | null
  alSeleccionar?: (ruta: string, nodo: NodoDeArchivo) => void
  className?: string
}

export function ArbolDeArchivos({
  nodos,
  etiqueta,
  seleccionada = null,
  alSeleccionar,
  className,
}: PropsDeArbolDeArchivos) {
  // Los directorios de primer nivel arrancan abiertos: un arbol enteramente
  // plegado obliga a un clic antes de ver nada, y la primera pregunta siempre
  // es "que hay aqui".
  const [abiertos, setAbiertos] = useState<Set<string>>(
    () => new Set(nodos.filter((n) => n.tipo === 'directorio').map((n) => n.nombre)),
  )
  const [rutaActiva, setRutaActiva] = useState<string | null>(null)
  const filas = useRef(new Map<string, HTMLLIElement | null>())

  const visibles = useMemo(
    () => aplanar(nodos, abiertos, '', 1, null, []),
    [nodos, abiertos],
  )

  // La fila alcanzable con tabulador: la activa si sigue visible, si no la
  // primera. Un arbol cuyo unico `tabindex="0"` se ha plegado queda fuera del
  // recorrido de teclado y no hay forma de volver a entrar.
  const activa =
    rutaActiva && visibles.some((v) => v.ruta === rutaActiva)
      ? rutaActiva
      : (visibles[0]?.ruta ?? null)

  const irA = (ruta: string) => {
    setRutaActiva(ruta)
    filas.current.get(ruta)?.focus()
  }

  const alternar = (ruta: string, abrir: boolean) => {
    setAbiertos((antes) => {
      const siguiente = new Set(antes)
      if (abrir) siguiente.add(ruta)
      else siguiente.delete(ruta)
      return siguiente
    })
  }

  const alPulsarTecla = (evento: KeyboardEvent<HTMLUListElement>) => {
    if (!activa) return
    const indice = visibles.findIndex((v) => v.ruta === activa)
    if (indice < 0) return
    const actual = visibles[indice]
    const esDirectorio = actual.nodo.tipo === 'directorio'
    const estaAbierto = abiertos.has(actual.ruta)

    switch (evento.key) {
      case 'ArrowDown':
        evento.preventDefault()
        if (indice + 1 < visibles.length) irA(visibles[indice + 1].ruta)
        break
      case 'ArrowUp':
        evento.preventDefault()
        if (indice > 0) irA(visibles[indice - 1].ruta)
        break
      case 'ArrowRight':
        evento.preventDefault()
        // Cerrado abre; abierto baja al primer hijo. Es el comportamiento que
        // el patron ARIA describe y el que tiene cualquier explorador.
        if (esDirectorio && !estaAbierto) alternar(actual.ruta, true)
        else if (esDirectorio && indice + 1 < visibles.length) irA(visibles[indice + 1].ruta)
        break
      case 'ArrowLeft':
        evento.preventDefault()
        if (esDirectorio && estaAbierto) alternar(actual.ruta, false)
        else if (actual.rutaPadre) irA(actual.rutaPadre)
        break
      case 'Home':
        evento.preventDefault()
        if (visibles.length > 0) irA(visibles[0].ruta)
        break
      case 'End':
        evento.preventDefault()
        if (visibles.length > 0) irA(visibles[visibles.length - 1].ruta)
        break
      case 'Enter':
      case ' ':
        evento.preventDefault()
        if (esDirectorio) alternar(actual.ruta, !estaAbierto)
        else alSeleccionar?.(actual.ruta, actual.nodo)
        break
      default:
        break
    }
  }

  return (
    <ul
      role="tree"
      aria-label={etiqueta}
      onKeyDown={alPulsarTecla}
      className={cn('fuente-operativa flex flex-col text-label-13', className)}
    >
      {visibles.map((visible) => {
        const esDirectorio = visible.nodo.tipo === 'directorio'
        const estaAbierto = abiertos.has(visible.ruta)
        const estado = visible.nodo.estado
        const marca = estado && estado !== 'sin_cambios' ? MARCA[estado] : null
        const esLaSeleccionada = seleccionada === visible.ruta

        return (
          <li
            key={visible.ruta}
            ref={(elemento) => {
              filas.current.set(visible.ruta, elemento)
            }}
            role="treeitem"
            aria-level={visible.nivel}
            aria-posinset={visible.posicion}
            aria-setsize={visible.hermanos}
            aria-expanded={esDirectorio ? estaAbierto : undefined}
            aria-selected={esLaSeleccionada}
            tabIndex={visible.ruta === activa ? 0 : -1}
            onFocus={() => setRutaActiva(visible.ruta)}
            onClick={() => {
              setRutaActiva(visible.ruta)
              if (esDirectorio) alternar(visible.ruta, !estaAbierto)
              else alSeleccionar?.(visible.ruta, visible.nodo)
            }}
            // La sangria va en linea porque depende del nivel: Tailwind escanea
            // nombres de clase completos y `pl-${nivel*4}` no existiria en el
            // CSS generado. Es espaciado, no color; los colores siguen saliendo
            // todos de los tokens.
            style={{ paddingLeft: `${(visible.nivel - 1) * 14 + 6}px` }}
            className={cn(
              'flex cursor-default items-center gap-1.5 rounded-md py-1 pr-2 transition-colors',
              esLaSeleccionada ? 'bg-ds-gray-alpha-100 text-ds-gray-1000' : 'text-ds-gray-900',
              'hover:bg-ds-gray-alpha-100',
            )}
          >
            {esDirectorio ? (
              estaAbierto ? (
                <ChevronDown className="size-3 shrink-0 text-ds-gray-700" aria-hidden="true" />
              ) : (
                <ChevronRight className="size-3 shrink-0 text-ds-gray-700" aria-hidden="true" />
              )
            ) : (
              <span className="size-3 shrink-0" aria-hidden="true" />
            )}

            {esDirectorio ? (
              <Folder className="size-3.5 shrink-0 text-ds-gray-700" aria-hidden="true" />
            ) : (
              <File className="size-3.5 shrink-0 text-ds-gray-700" aria-hidden="true" />
            )}

            <span className="min-w-0 truncate">{visible.nodo.nombre}</span>

            {marca ? (
              <>
                <span className={cn('ml-auto shrink-0', marca.clase)} aria-hidden="true">
                  {marca.letra}
                </span>
                <span className="sr-only">{marca.nombre}</span>
              </>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
