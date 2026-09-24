'use client'

import type { ReactNode } from 'react'
import { Search } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { Proyecto } from '@/lib/tipos'
import {
  esAjusteDeProyecto,
  esAjusteGeneral,
  type Navegar,
  type Ruta,
} from '@/lib/ruta'
import {
  DESTINOS_PRINCIPALES,
  ETIQUETA_DE_SECCION,
  destinoActivo,
  etiquetaDePestana,
  pintaRail,
} from '@/components/marco/secciones'
import { CLASE_DE_VISTA, alineacionDelLienzo, anchoDelLienzo } from '@/components/marco/lienzo'
import { Migas, type Miga } from '@/components/marco/migas'
import { NavegacionLateral } from '@/components/marco/navegacion-lateral'
import { ConmutadorDeProyecto } from '@/components/marco/conmutador-de-proyecto'
import { ProveedorDeMarco } from '@/components/marco/contexto'
import { ProveedorDeBoard } from '@/components/board/contexto-board'

/**
 * El armazon de la consola: navegacion lateral, cabecera con migas y lienzo.
 *
 * LA FORMA CAMBIO CON LA SPEC 003. En la 002 habia una cabecera de ancho
 * completo y debajo un rail de dos niveles. Ahora la navegacion es una columna
 * de altura completa a la izquierda —logo, buscador, cuatro destinos,
 * proyectos, runs activos y, al pie, el estado del servicio y del gestor— y la
 * cabecera vive solo sobre el contenido. Es la forma de un kanban de trabajo:
 * el board necesita todo el alto que se le pueda dar, y una cabecera de ancho
 * completo encima de la navegacion le quita 56 pixeles a cada columna.
 *
 * LAS MIGAS SE QUEDAN, porque siguen contestando lo que contestaban: donde se
 * esta y de que proyecto. En Settings del proyecto son las que dicen «de cual»
 * mientras las pestanas dicen «que».
 *
 * EL BOARD SE LEE AQUI Y NO EN LA PANTALLA del board: el lateral lo necesita
 * en todas las pantallas —contadores y runs activos— y una lectura por pieza
 * seria tres respuestas que pueden no coincidir. La explicacion entera en
 * `board/contexto-board.tsx`.
 */

/** La cabecera mide `h-12`. El board resta esto de la altura de la ventana. */
const ALTO_DE_CABECERA = 'h-12'

/** Las migas de cada ruta. Un solo sitio que lo decide. */
function migasDe(
  ruta: Ruta,
  navegar: Navegar,
  proyectos: Proyecto[] | null,
): Miga[] {
  const conmutador = (id: string): Miga => ({
    etiqueta: id,
    contenido: (
      <ConmutadorDeProyecto
        proyectoId={id}
        seccion={ruta.seccion}
        proyectos={proyectos ?? []}
        cargando={proyectos === null}
        navegar={navegar}
      />
    ),
  })

  const { seccion, id } = ruta

  if (seccion === 'board' || seccion === 'runs') {
    const migas: Miga[] = [
      id ? { etiqueta: ETIQUETA_DE_SECCION[seccion], ruta: { seccion, id: null } } : { etiqueta: ETIQUETA_DE_SECCION[seccion] },
    ]
    if (id) migas.push(conmutador(id))
    return migas
  }

  if (esAjusteDeProyecto(seccion)) {
    if (!id) return [{ etiqueta: 'Settings del proyecto' }]
    return [
      conmutador(id),
      { etiqueta: 'Settings', ruta: { seccion: 'ajustes', id } },
      { etiqueta: etiquetaDePestana(seccion) },
    ]
  }

  if (seccion === 'asistente') {
    return id ? [conmutador(id), { etiqueta: 'Asistente' }] : [{ etiqueta: 'Asistente' }]
  }

  if (esAjusteGeneral(seccion)) {
    return [
      { etiqueta: 'Settings', ruta: { seccion: 'settings', id: null } },
      { etiqueta: etiquetaDePestana(seccion) },
    ]
  }

  // Las pantallas de la 002 que no son pestanas —indicadores, bandeja, la
  // lista de proyectos, el alta— cuelgan de Settings, que es donde estan
  // enlazadas. La miga dice por donde se vuelve.
  if (['inicio', 'bandeja', 'proyectos', 'proyecto-nuevo'].includes(seccion)) {
    return [
      { etiqueta: 'Settings', ruta: { seccion: 'settings', id: null } },
      { etiqueta: ETIQUETA_DE_SECCION[seccion] },
    ]
  }

  return [{ etiqueta: ETIQUETA_DE_SECCION[seccion] }]
}

export function Marco({
  ruta,
  navegar,
  proyectos,
  alAbrirComandos,
  acciones,
  pie,
  aviso,
  children,
}: {
  ruta: Ruta
  navegar: Navegar
  /** `GET /v1/projects`, leido una vez en la cascara. `null` mientras llega. */
  proyectos: Proyecto[] | null
  alAbrirComandos: () => void
  /** Controles del extremo derecho de la cabecera. */
  acciones?: ReactNode
  /** Lo que va al pie de la navegacion: estado del servicio, tema. */
  pie?: ReactNode
  /** Avisos de ancho completo entre la cabecera y el lienzo. */
  aviso?: ReactNode
  children: ReactNode
}) {
  const clase = CLASE_DE_VISTA[ruta.seccion]
  const aSangre = clase === 'tablero'
  // Settings pinta sus pestanas y pone el ancho de cada una por dentro: si el
  // lienzo lo pusiera por fuera, las pestanas cambiarian de ancho —y de
  // sitio— al pasar de la constitution (768px) a la flota (1152px).
  const enSettings = esAjusteGeneral(ruta.seccion) || esAjusteDeProyecto(ruta.seccion)
  const destino = destinoActivo(ruta.seccion)

  return (
    <ProveedorDeBoard>
      <div className="flex min-h-dvh">
        {/* NFR-005: lo primero que recibe el foco es la forma de saltarse la
            navegacion. Con proyectos y runs activos en el lateral son
            fácilmente veinte paradas de tabulador antes del contenido. */}
        <a
          href="#contenido"
          className="sr-only rounded-md bg-ds-background-100 px-3 py-2 text-label-14 text-ds-gray-1000 focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
        >
          Saltar al contenido
        </a>

        {/* El lateral desaparece en el recorrido guiado, y solo ahi. El motivo
            esta en `SECCIONES_SIN_RAIL`. Debajo de `lg` tampoco: en su lugar
            va la tira de destinos de la cabecera. */}
        {pintaRail(ruta.seccion) ? (
          <div className="sticky top-0 hidden h-dvh shrink-0 border-r border-ds-gray-400 lg:block">
            <NavegacionLateral
              ruta={ruta}
              navegar={navegar}
              alAbrirComandos={alAbrirComandos}
              proyectos={proyectos}
              pie={pie}
            />
          </div>
        ) : null}

        <div
          className={cn(
            'flex min-w-0 flex-1 flex-col bg-ds-background-100',
            aSangre ? 'h-dvh overflow-hidden' : null,
          )}
        >
          <header
            className={cn(
              'sticky top-0 z-30 flex shrink-0 items-center gap-3 border-b border-ds-gray-400 bg-ds-background-100 px-4 sm:px-6',
              ALTO_DE_CABECERA,
            )}
          >
            <Migas migas={migasDe(ruta, navegar, proyectos)} navegar={navegar} className="flex-1" />
            {acciones ? <div className="flex shrink-0 items-center gap-3">{acciones}</div> : null}
          </header>

          {/* Debajo de `lg` no hay lateral, y los cuatro destinos no pueden
              desaparecer detras de una hamburguesa: esta aplicacion corre en
              una ventana de escritorio que el operador estrecha, y ahi un
              menu escondido es un menu que no existe. Proyectos y runs
              activos quedan en ⌘K y en el filtro del board. */}
          {pintaRail(ruta.seccion) ? (
            <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-ds-gray-400 px-3 py-1.5 lg:hidden">
              {DESTINOS_PRINCIPALES.map((principal) => (
                <button
                  key={principal}
                  type="button"
                  aria-current={destino === principal ? 'page' : undefined}
                  onClick={() => navegar({ seccion: principal, id: null })}
                  className={`h-7 shrink-0 rounded-md px-2 text-button-12 transition-colors ${
                    destino === principal
                      ? 'bg-ds-gray-alpha-200 text-ds-gray-1000'
                      : 'text-ds-gray-900 hover:bg-ds-gray-alpha-100 hover:text-ds-gray-1000'
                  }`}
                >
                  {ETIQUETA_DE_SECCION[principal]}
                </button>
              ))}
              <button
                type="button"
                onClick={alAbrirComandos}
                aria-label="Buscar o ejecutar"
                className="ml-auto flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-label-12 text-ds-gray-900 shadow-ds-border"
              >
                <Search aria-hidden="true" className="size-3.5" />
                ⌘K
              </button>
            </div>
          ) : null}

          {aviso}

          <main
            id="contenido"
            className={cn(
              'w-full',
              aSangre
                ? 'flex min-h-0 flex-1 flex-col'
                : enSettings
                  ? 'flex-1 px-4 py-6 sm:px-6 lg:px-8'
                  : cn(
                      'flex-1 px-4 py-8 sm:px-6 lg:px-8',
                      anchoDelLienzo(ruta.seccion),
                      alineacionDelLienzo(ruta.seccion),
                    ),
            )}
          >
            <ProveedorDeMarco>{children}</ProveedorDeMarco>
          </main>
        </div>
      </div>
    </ProveedorDeBoard>
  )
}
