'use client'

import type { ReactNode } from 'react'
import { Kanban } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/insignia'
import { ProveedorDeAjustes } from '@/components/marco/contexto'
import { anchoDelLienzo } from '@/components/marco/lienzo'
import { etiquetaDePestana } from '@/components/marco/secciones'
import { PuntoDeProyecto } from '@/components/board/tarjeta'
import { useBoard } from '@/components/board/contexto-board'
import {
  SECCIONES_DE_AJUSTES_DE_PROYECTO,
  SECCIONES_DE_AJUSTES_GENERALES,
  type Navegar,
  type Seccion,
  type SeccionDeAjustesDeProyecto,
  type SeccionDeAjustesGenerales,
} from '@/lib/ruta'
import { ETIQUETA_ESTADO_PROYECTO, type Proyecto } from '@/lib/tipos'
import { cn } from '@/lib/utils'

/**
 * SETTINGS: DONDE VIVE AHORA TODO LO QUE SE HACE UNA VEZ.
 *
 * La decision 1 del operador (spec 003): las etapas del alta salen de la
 * navegacion. Se hacen una vez con el asistente, y despues lo que eran etapas
 * se ajusta aqui. NO SON PANTALLAS NUEVAS: cada pestana monta la vista de la
 * 002 tal cual —mismas lecturas, mismas guardas, mismos tests—, con un
 * encabezado un nivel mas abajo (`ProveedorDeAjustes`) porque el `<h1>` de la
 * pagina es el de Settings.
 *
 * LAS PESTANAS SON NAVEGACION, NO UN `tablist`. Cada una es una direccion
 * propia (`?vista=constitution&proyecto=x`) que se recarga y se comparte; el
 * patron ARIA de pestanas promete que el contenido cambia sin navegar y que
 * las flechas mueven la seleccion, y aqui ninguna de las dos cosas es verdad.
 * Asi que es un `<nav>` con `aria-current`, que es lo que es.
 *
 * EL ANCHO LO PONE LA PESTANA, NO EL MARCO: cada vista conserva la clase de
 * lienzo que ya tenia (la constitution a ancho de lectura, la flota a ancho de
 * inventario), y la cabecera con las pestanas queda fija encima. Si el ancho
 * lo pusiera el marco, las pestanas saltarian de sitio al cambiar de una a
 * otra.
 */

function Pestanas<S extends Seccion>({
  secciones,
  activa,
  alElegir,
  etiqueta,
}: {
  secciones: readonly S[]
  activa: S
  alElegir: (seccion: S) => void
  etiqueta: string
}) {
  return (
    <nav aria-label={etiqueta} className="-mb-px overflow-x-auto">
      <ul className="flex min-w-max items-center gap-1">
        {secciones.map((seccion) => {
          const esEsta = seccion === activa
          return (
            <li key={seccion}>
              <button
                type="button"
                aria-current={esEsta ? 'page' : undefined}
                onClick={() => alElegir(seccion)}
                className={`relative flex h-9 items-center rounded-t-md px-2.5 text-button-14 transition-colors ${
                  esEsta
                    ? 'text-ds-gray-1000 after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-ds-gray-1000'
                    : 'text-ds-gray-900 hover:text-ds-gray-1000'
                }`}
              >
                {etiquetaDePestana(seccion)}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function Cuerpo({ seccion, children }: { seccion: Seccion; children: ReactNode }) {
  return (
    <div className={cn('w-full pt-6', anchoDelLienzo(seccion))}>
      <ProveedorDeAjustes>{children}</ProveedorDeAjustes>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Settings general: el portal de tools                                       */
/* -------------------------------------------------------------------------- */

/**
 * Las pantallas de la 002 que no son pestanas de nadie. Siguen existiendo y
 * siguen en ⌘K; aqui se enlazan para que ninguna quede alcanzable solo por
 * direccion (FR-025).
 */
const OTRAS_PANTALLAS: Array<{ seccion: Seccion; etiqueta: string }> = [
  { seccion: 'inicio', etiqueta: 'Indicadores' },
  { seccion: 'bandeja', etiqueta: 'Bandeja' },
  { seccion: 'proyectos', etiqueta: 'Lista de proyectos' },
  { seccion: 'proyecto-nuevo', etiqueta: 'Anadir proyecto sin asistente' },
  { seccion: 'catalogo', etiqueta: 'Catalogo de componentes' },
]

export function AjustesGenerales({
  seccion,
  navegar,
  children,
}: {
  seccion: SeccionDeAjustesGenerales
  navegar: Navegar
  children: ReactNode
}) {
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-4 border-b border-ds-gray-400">
        <div className="flex flex-col gap-1">
          <h1 className="text-heading-24 text-ds-gray-1000">Settings</h1>
          <p className="max-w-2xl text-copy-14 text-ds-gray-900">
            Las herramientas con las que trabaja noxloop, los modelos que ejecutan a los agentes,
            las credenciales, la flota y el registro de todo lo que se hizo. Lo de cada proyecto
            esta en su propio Settings, desde la lista de proyectos.
          </p>
          <p className="flex flex-wrap items-center gap-x-1 text-label-12 text-ds-gray-700">
            <span>Tambien:</span>
            {OTRAS_PANTALLAS.map((otra, indice) => (
              <span key={otra.seccion} className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => navegar({ seccion: otra.seccion, id: null })}
                  className="rounded-sm text-ds-gray-900 underline-offset-2 hover:text-ds-gray-1000 hover:underline"
                >
                  {otra.etiqueta}
                </button>
                {indice < OTRAS_PANTALLAS.length - 1 ? <span aria-hidden="true">·</span> : null}
              </span>
            ))}
          </p>
        </div>
        <Pestanas
          etiqueta="Secciones de Settings"
          secciones={SECCIONES_DE_AJUSTES_GENERALES}
          activa={seccion}
          alElegir={(destino) => navegar({ seccion: destino, id: null })}
        />
      </div>
      <Cuerpo seccion={seccion}>{children}</Cuerpo>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Settings del proyecto                                                      */
/* -------------------------------------------------------------------------- */

export function AjustesDelProyecto({
  seccion,
  proyectoId,
  proyecto,
  navegar,
  children,
}: {
  seccion: SeccionDeAjustesDeProyecto
  proyectoId: string
  /** Lo que se sabe del proyecto, de la lista de la cascara. */
  proyecto: Proyecto | null
  navegar: Navegar
  children: ReactNode
}) {
  const activo = proyecto?.estado === 'ACTIVE'
  // El color del punto es el del board, para que el proyecto se reconozca
  // igual aqui que en sus tarjetas y en la lista lateral.
  const color = useBoard()?.lectura.datos?.proyectos.find((candidato) => candidato.id === proyectoId)?.color ?? null
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-4 border-b border-ds-gray-400">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="flex min-w-0 items-center gap-2 text-heading-24 text-ds-gray-1000">
              <PuntoDeProyecto proyecto={{ id: proyectoId, color }} className="size-2.5" />
              <span className="truncate">{proyecto?.nombre ?? proyectoId}</span>
              <span className="text-ds-gray-700">· Settings</span>
            </h1>
            <p className="flex flex-wrap items-center gap-2 text-label-13 text-ds-gray-900">
              {proyecto ? (
                <Badge tono={activo ? 'exito' : 'advertencia'}>
                  {ETIQUETA_ESTADO_PROYECTO[proyecto.estado]}
                </Badge>
              ) : null}
              <span className="fuente-operativa text-label-12 text-ds-gray-700">{proyectoId}</span>
            </p>
          </div>
          {activo ? (
            <Button variant="secondary" size="sm" onClick={() => navegar({ seccion: 'board', id: proyectoId })}>
              <Kanban aria-hidden="true" />
              Ir al board
            </Button>
          ) : proyecto ? (
            <Button size="sm" onClick={() => navegar({ seccion: 'asistente', id: proyectoId })}>
              Terminar de configurarlo
            </Button>
          ) : null}
        </div>
        <Pestanas
          etiqueta={`Settings de ${proyecto?.nombre ?? proyectoId}`}
          secciones={SECCIONES_DE_AJUSTES_DE_PROYECTO}
          activa={seccion}
          alElegir={(destino) => navegar({ seccion: destino, id: proyectoId })}
        />
      </div>
      <Cuerpo seccion={seccion}>{children}</Cuerpo>
    </div>
  )
}
