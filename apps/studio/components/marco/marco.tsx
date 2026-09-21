'use client'

import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { useLectura } from '@/lib/lectura'
import type { Proyecto } from '@/lib/tipos'
import { esSeccionDeProyecto, type Navegar, type Ruta } from '@/lib/ruta'
import { ETIQUETA_DE_SECCION, SECCION_PADRE } from '@/components/marco/secciones'
import { anchoDelLienzo } from '@/components/marco/lienzo'
import { Migas, type Miga } from '@/components/marco/migas'
import { NavegacionLateral } from '@/components/marco/navegacion-lateral'
import { ConmutadorDeProyecto } from '@/components/marco/conmutador-de-proyecto'
import { ProveedorDeMarco } from '@/components/marco/contexto'

/**
 * El armazon de la consola: cabecera, navegacion de dos niveles y lienzo.
 *
 * QUE PROBLEMA RESUELVE, dicho entero. Habia trece pantallas y un cascaron que
 * solo conocia cinco: una barra horizontal y un `main` a 1024px para todas. El
 * resultado no era feo, era desorientador — dentro del snapshot de un proyecto
 * el marco marcaba "Proyectos" y no decia de cual, las seis etapas no
 * aparecian en ningun sitio, y una tabla de auditoria de seis columnas vivia
 * en el mismo ancho que un formulario de cuatro campos.
 *
 * Las cuatro piezas de aqui se corresponden una a una con esos cuatro huecos:
 * las migas dicen donde se esta, el conmutador dice de que proyecto y deja
 * cambiarlo, la navegacion publica los dos niveles, y `lienzo.ts` da a cada
 * clase de pantalla el ancho que pide.
 *
 * LA LECTURA DE PROYECTOS SOLO SE PIDE CUANDO HAY PROYECTO ABIERTO. Montada
 * siempre, esta cabecera anadiria un `GET /v1/projects` a cada pantalla del
 * espacio de trabajo —incluida la que ya lo pide para pintarse— para no usar
 * la respuesta. `useLectura(null)` no pide nada, y es lo que se le pasa.
 */

const EVENTOS_DEL_MARCO = ['proyecto.estado', 'sincronizar_completo'] as const

/**
 * El nivel raiz de las migas: el espacio de trabajo.
 *
 * Las clases van en texto plano y NO por `cn()`: `twMerge` no conoce
 * `text-heading-14` y la borraria al ver el `text-ds-gray-1000` de al lado.
 * La explicacion entera, con la comprobacion, esta en `migas.tsx`.
 */
function Marca({ enInicio, navegar }: { enInicio: boolean; navegar: Navegar }) {
  if (enInicio) {
    return (
      <span aria-current="page" className="text-heading-14 text-ds-gray-1000">
        noxloop
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={() => navegar({ seccion: 'inicio', id: null })}
      className="-mx-1.5 rounded-md px-1.5 py-0.5 text-heading-14 text-ds-gray-1000 transition-colors hover:bg-ds-gray-alpha-100"
    >
      noxloop
    </button>
  )
}

export function Marco({
  ruta,
  navegar,
  acciones,
  aviso,
  children,
}: {
  ruta: Ruta
  navegar: Navegar
  /** Los controles del extremo derecho de la cabecera. */
  acciones?: ReactNode
  /** Avisos de ancho completo entre la cabecera y el lienzo. */
  aviso?: ReactNode
  children: ReactNode
}) {
  const enProyecto = esSeccionDeProyecto(ruta.seccion)
  const proyectoId = enProyecto ? ruta.id : null

  const lectura = useLectura<Proyecto[]>(proyectoId ? '/v1/projects' : null, {
    relerEn: EVENTOS_DEL_MARCO,
  })
  const proyectos = lectura.datos ?? []
  const cargandoProyectos = lectura.datos === null && lectura.error === null

  const migas: Miga[] = [
    {
      etiqueta: 'noxloop',
      contenido: <Marca enInicio={ruta.seccion === 'inicio'} navegar={navegar} />,
    },
  ]

  if (enProyecto) {
    if (proyectoId) {
      migas.push({
        etiqueta: proyectoId,
        contenido: (
          <ConmutadorDeProyecto
            proyectoId={proyectoId}
            seccion={ruta.seccion}
            proyectos={proyectos}
            cargando={cargandoProyectos}
            navegar={navegar}
          />
        ),
      })
    } else {
      // La direccion llego sin proyecto. El nivel del medio no se puede
      // rellenar con nada verdadero, asi que se sustituye por el camino para
      // elegirlo — que es lo mismo que dice el contenido. Un conmutador vacio
      // aqui seria un control que promete cambiar algo que no existe.
      migas.push({
        etiqueta: ETIQUETA_DE_SECCION.proyectos,
        ruta: { seccion: 'proyectos', id: null },
      })
    }
    migas.push({ etiqueta: ETIQUETA_DE_SECCION[ruta.seccion] })
  } else if (ruta.seccion !== 'inicio') {
    const padre = SECCION_PADRE[ruta.seccion]
    if (padre) {
      migas.push({ etiqueta: ETIQUETA_DE_SECCION[padre], ruta: { seccion: padre, id: null } })
    }
    migas.push({ etiqueta: ETIQUETA_DE_SECCION[ruta.seccion] })
  }

  return (
    <div className="flex min-h-dvh flex-col">
      {/* NFR-005: lo primero que recibe el foco es la forma de saltarse el
          marco. Sin esto, llegar al contenido con teclado cuesta ahora mas que
          antes, no menos: la navegacion de dos niveles son hasta once paradas
          de tabulador por delante del contenido. */}
      <a
        href="#contenido"
        className="sr-only rounded-md bg-ds-background-100 px-3 py-2 text-label-14 text-ds-gray-1000 focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
      >
        Saltar al contenido
      </a>

      {/* Altura fija y sin envolver: la navegacion se pega a `top-14` y una
          cabecera que crece al envolver dejaria el rail desplazado justo esa
          diferencia. Lo que se encoge son las migas, que para eso truncan. */}
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-ds-gray-400 bg-ds-background-200 px-4 sm:px-6">
        <Migas migas={migas} navegar={navegar} className="flex-1" />
        {acciones ? <div className="flex shrink-0 items-center gap-3">{acciones}</div> : null}
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        <NavegacionLateral ruta={ruta} navegar={navegar} />

        <div className="flex min-w-0 flex-1 flex-col">
          {aviso}

          {/* Sin `mx-auto`: ver `lienzo.ts`. Todas las pantallas arrancan en la
              misma columna vertical, sea cual sea su ancho maximo. */}
          <main
            id="contenido"
            className={cn(
              'w-full flex-1 px-4 py-8 sm:px-6 lg:px-8',
              anchoDelLienzo(ruta.seccion),
            )}
          >
            <ProveedorDeMarco>{children}</ProveedorDeMarco>
          </main>
        </div>
      </div>
    </div>
  )
}
