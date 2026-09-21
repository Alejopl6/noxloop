'use client'

import { useId } from 'react'

import { cn } from '@/lib/utils'
import { esSeccionDeProyecto, type Navegar, type Ruta, type Seccion } from '@/lib/ruta'
import {
  ETIQUETA_DE_SECCION,
  SECCIONES_DEL_WORKSPACE,
  SECCIONES_DE_LA_ETAPA,
  seccionActiva,
} from '@/components/marco/secciones'

/**
 * La navegacion, con sus dos niveles a la vista al mismo tiempo.
 *
 * LO QUE FALTABA. La barra horizontal tenia cinco entradas y las seis etapas
 * del proyecto no estaban en ninguna parte del marco: existian como pantallas
 * y se alcanzaban desde la fila del proyecto, y una vez dentro no habia forma
 * de pasar de la constitution al bootstrap sin volver a la lista. Meterlas en
 * la misma barra horizontal tampoco servia: la mitad del tiempo no hay
 * proyecto abierto, y once pestanas de las que seis no llevan a ningun sitio
 * ensenan a no mirar la barra.
 *
 * La solucion es que sean DOS GRUPOS y que el segundo aparezca solo cuando hay
 * proyecto: entonces cada entrada visible lleva siempre a algo.
 *
 * FORMA. Texto, sin iconos. Un icono al lado de una etiqueta que ya esta
 * escrita no anade informacion; con once entradas siempre visibles, anade once
 * manchas que compiten con la unica senal que importa aqui, que es cual esta
 * seleccionada. La seleccion SI se gana una superficie —`gray-alpha-100`—
 * porque comunica exactamente eso.
 *
 * DEBAJO DE `lg` la misma lista se convierte en una tira horizontal
 * desplazable en vez de desaparecer detras de un boton de hamburguesa. Un rail
 * fijo de 240px en una ventana de 900px se come un cuarto del lienzo, y esta
 * aplicacion tambien corre en una ventana de escritorio que el operador
 * redimensiona.
 */

interface GrupoDeNavegacion {
  etiqueta: string
  secciones: readonly Seccion[]
  /** El identificador que acompana a cada destino del grupo. */
  id: string | null
}

export function NavegacionLateral({
  ruta,
  navegar,
  className,
}: {
  ruta: Ruta
  navegar: Navegar
  className?: string
}) {
  const base = useId()
  const activa = seccionActiva(ruta.seccion)

  // El nivel dos solo existe con proyecto abierto Y con identificador. Sin
  // identificador la ruta ya esta rota (el contenido lo dice), y ofrecer seis
  // destinos que heredarian el mismo hueco seria ofrecer seis veces el mismo
  // fallo.
  const proyectoId = esSeccionDeProyecto(ruta.seccion) ? ruta.id : null

  const grupos: GrupoDeNavegacion[] = [
    { etiqueta: 'Espacio de trabajo', secciones: SECCIONES_DEL_WORKSPACE, id: null },
    ...(proyectoId
      ? [{ etiqueta: 'Proyecto abierto', secciones: SECCIONES_DE_LA_ETAPA, id: proyectoId }]
      : []),
  ]

  return (
    <nav
      aria-label="Navegacion principal"
      className={cn(
        'shrink-0 border-b border-ds-gray-400',
        // A partir de `lg` es un rail: pegado bajo la cabecera (que mide
        // `h-14` = 3.5rem) y con su propio desplazamiento, para que una tabla
        // de auditoria de trescientas filas no se lleve la navegacion consigo.
        'lg:sticky lg:top-14 lg:h-[calc(100dvh-3.5rem)] lg:w-60 lg:overflow-y-auto lg:border-b-0 lg:border-r',
        className,
      )}
    >
      <div className="flex gap-8 overflow-x-auto px-4 py-3 lg:flex-col lg:gap-7 lg:overflow-x-visible lg:px-3 lg:py-6">
        {grupos.map((grupo, indice) => {
          // El identificador sale del INDICE y no de la etiqueta. Con la
          // etiqueta dentro, "Espacio de trabajo" producia el id
          // `...-Espacio de trabajo`, y `aria-labelledby` es una lista de
          // identificadores SEPARADA POR ESPACIOS: el lector de pantalla
          // buscaba tres elementos —`...-Espacio`, `de`, `trabajo`—, no
          // encontraba ninguno, y los dos grupos se quedaban sin nombre. Se
          // veia perfecto y no se oia nada.
          const idGrupo = `${base}-grupo-${indice}`
          return (
            <div key={grupo.etiqueta} className="shrink-0">
              {/* Etiqueta de grupo en caja baja: un "ESPACIO DE TRABAJO" en
                  versales es el eyebrow que Geist descarta. */}
              <p id={idGrupo} className="px-2 pb-1 text-label-12 text-ds-gray-700">
                {grupo.etiqueta}
              </p>

              <ul
                aria-labelledby={idGrupo}
                className="flex items-center gap-0.5 lg:flex-col lg:items-stretch"
              >
                {grupo.secciones.map((seccion) => {
                  const esLaActiva = activa === seccion
                  return (
                    <li key={seccion} className="shrink-0 lg:w-full">
                      <button
                        type="button"
                        aria-current={esLaActiva ? 'page' : undefined}
                        onClick={() => navegar({ seccion, id: grupo.id })}
                        // Sin `cn()`: `twMerge` no conoce `text-button-14` y la
                        // borra al ver el `text-ds-gray-*` que viene detras.
                        // Comprobado en el HTML generado — las once entradas
                        // salian con el cuerpo por defecto en vez del de boton.
                        // La explicacion larga esta en `migas.tsx`.
                        className={`flex h-8 w-full items-center whitespace-nowrap rounded-md px-2 text-left text-button-14 transition-colors ${
                          esLaActiva
                            ? 'bg-ds-gray-alpha-100 text-ds-gray-1000'
                            : 'text-ds-gray-900 hover:bg-ds-gray-alpha-100 hover:text-ds-gray-1000'
                        }`}
                      >
                        {ETIQUETA_DE_SECCION[seccion]}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </nav>
  )
}
