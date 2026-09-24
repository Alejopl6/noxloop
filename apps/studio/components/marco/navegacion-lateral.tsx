'use client'

import { useId, type ReactNode } from 'react'
import { ChartColumn, Kanban, Plus, Search, Settings2, SquareActivity } from 'lucide-react'

import { cn } from '@/lib/utils'
import { esAjusteDeProyecto, type Navegar, type Ruta } from '@/lib/ruta'
import { ETAPA_PENDIENTE, type Board, type Proyecto } from '@/lib/tipos'
import {
  DESTINOS_PRINCIPALES,
  ETIQUETA_DE_SECCION,
  destinoActivo,
  type DestinoPrincipal,
} from '@/components/marco/secciones'
import { COLOR_DE_TONO, textoDelChip, tonoDeChip } from '@/components/board/chip'
import { colorDeProyecto, runsActivos } from '@/components/board/derivar'
import { useBoard } from '@/components/board/contexto-board'

/**
 * LA NAVEGACION LATERAL DE LA 003: cuatro destinos, los proyectos y lo que
 * esta corriendo.
 *
 * QUE CAMBIO Y POR QUE. En la 002 el rail tenia dos niveles —seis destinos
 * del espacio de trabajo y seis etapas del proyecto abierto— y era correcto
 * pantalla por pantalla; el conjunto obligaba a saber cual tocaba, que es la
 * misma densidad que el producto existe para quitar. El operador lo dijo asi:
 * «un proyecto tiene un board de control y listo». Ahora hay tres bloques y
 * cada uno contesta una pregunta:
 *
 *   - Board · Runs · Costos · Settings   ¿a donde voy? (FR-022, exactamente cuatro)
 *   - Proyectos                           ¿de cual?
 *   - Runs activos                        ¿que me necesita ahora? (US3)
 *
 * ICONOS EN LOS CUATRO DESTINOS, y es un cambio consciente respecto al rail de
 * la 002, que los prohibia con buen motivo: once entradas con icono eran once
 * manchas compitiendo con la seleccion. Cuatro no compiten, y el icono es lo
 * que deja reconocerlas de un vistazo cuando el lateral se lee de refilon
 * mientras se mira el board.
 *
 * UN PROYECTO A MEDIO ESTABLECER NO LLEVA A UN BOARD VACIO (US4, escenario
 * 3): lleva al asistente, que retoma en la etapa que le falta. Un board vacio
 * de un proyecto que no puede tener tarjetas se lee como «no hay tickets».
 */

const ICONO_DE_DESTINO: Record<DestinoPrincipal, typeof Kanban> = {
  board: Kanban,
  runs: SquareActivity,
  costos: ChartColumn,
  settings: Settings2,
}

/** Cuantos runs activos caben antes del «ver todos». */
const RUNS_A_LA_VISTA = 8

export interface PropsDePanelLateral {
  ruta: Ruta
  navegar: Navegar
  alAbrirComandos: () => void
  /** `GET /v1/projects`: todos, tambien los que no estan `ACTIVE`. */
  proyectos: Proyecto[] | null
  /** El board compartido, para contadores, colores y runs activos. */
  board: Board | null
  /** Lo que va al pie: el estado del servicio y del gestor, el tema. */
  pie?: ReactNode
  className?: string
}

/** El logotipo: un lazo, porque es lo que el producto hace. */
function Logo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0 text-ds-gray-1000">
      <rect width="24" height="24" rx="6" fill="currentColor" />
      <path
        d="M7.5 15.5V8.5l9 7V8.5"
        fill="none"
        stroke="var(--ds-background-100)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Titulo de un bloque, en caja baja: el eyebrow en versales lo descarta Geist. */
function TituloDeBloque({ id, children, accion }: { id: string; children: ReactNode; accion?: ReactNode }) {
  return (
    <div className="flex h-7 items-center justify-between px-2">
      <p id={id} className="text-label-12 text-ds-gray-700">
        {children}
      </p>
      {accion}
    </div>
  )
}

export function PanelLateral({
  ruta,
  navegar,
  alAbrirComandos,
  proyectos,
  board,
  pie,
  className,
}: PropsDePanelLateral) {
  const base = useId()
  const activo = destinoActivo(ruta.seccion)

  // Los colores y el estado del board mandan sobre la lista si llegan: el
  // board sabe el color de cada proyecto; la lista sabe los que no estan
  // activos. Sin lista todavia, se pintan los del board.
  const delBoard = new Map((board?.proyectos ?? []).map((proyecto) => [proyecto.id, proyecto]))
  const lista: Array<Pick<Proyecto, 'id' | 'nombre' | 'estado'> & { color: string | null }> = (
    proyectos ??
    (board?.proyectos as Array<Pick<Proyecto, 'id' | 'nombre' | 'estado'>> | undefined) ??
    []
  ).map((proyecto) => ({
    id: proyecto.id,
    nombre: proyecto.nombre,
    estado: proyecto.estado,
    color: delBoard.get(proyecto.id)?.color ?? null,
  }))

  const activos = runsActivos(board?.tarjetas ?? [])
  const contador: Partial<Record<DestinoPrincipal, number>> = board
    ? { board: board.tarjetas.length, runs: activos.length }
    : {}

  const proyectoMarcado =
    ruta.seccion === 'board' || ruta.seccion === 'asistente' || esAjusteDeProyecto(ruta.seccion)
      ? ruta.id
      : null

  return (
    <nav
      aria-label="Navegacion principal"
      className={cn('flex h-full w-60 flex-col bg-ds-background-200', className)}
    >
      <div className="flex flex-col gap-3 px-3 pb-2 pt-3">
        <button
          type="button"
          onClick={() => navegar({ seccion: 'board', id: null })}
          className="flex h-8 items-center gap-2 rounded-md px-2 text-heading-14 text-ds-gray-1000 transition-colors hover:bg-ds-gray-alpha-100"
        >
          <Logo />
          noxloop
        </button>

        {/* EL BUSCADOR ES EL MENU DE COMANDOS, no un campo que filtre el
            lateral: «buscar o ejecutar» es llegar a cualquier pantalla o
            lanzar cualquier accion, y eso ya lo hace ⌘K. Un segundo buscador
            que solo encuentra proyectos ensenaria a no usar el primero. */}
        <button
          type="button"
          onClick={alAbrirComandos}
          aria-keyshortcuts="Meta+K Control+K"
          className="flex h-8 items-center gap-2 rounded-md bg-ds-background-100 px-2 text-label-13 text-ds-gray-900 shadow-ds-border transition-colors hover:text-ds-gray-1000"
        >
          <Search aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="flex-1 text-left">Buscar o ejecutar…</span>
          <kbd className="fuente-operativa rounded-[4px] px-1 text-label-12 text-ds-gray-700 shadow-ds-border">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pb-3">
        <ul className="flex flex-col gap-px">
          {DESTINOS_PRINCIPALES.map((destino) => {
            const Icono = ICONO_DE_DESTINO[destino]
            const esEste = activo === destino
            const cuenta = contador[destino]
            return (
              <li key={destino}>
                <button
                  type="button"
                  aria-current={esEste ? 'page' : undefined}
                  onClick={() => navegar({ seccion: destino, id: null })}
                  className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-button-14 transition-colors ${
                    esEste
                      ? 'bg-ds-gray-alpha-200 text-ds-gray-1000'
                      : 'text-ds-gray-900 hover:bg-ds-gray-alpha-100 hover:text-ds-gray-1000'
                  }`}
                >
                  <Icono aria-hidden="true" className="size-4 shrink-0" />
                  <span className="flex-1">{ETIQUETA_DE_SECCION[destino]}</span>
                  {cuenta !== undefined ? (
                    <span className="fuente-operativa text-label-12 text-ds-gray-700">{cuenta}</span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>

        <div>
          <TituloDeBloque
            id={`${base}-proyectos`}
            accion={
              // CREAR ES ABRIR EL ASISTENTE (FR-023). No hay un formulario de
              // alta suelto en el lateral: el asistente ya es el alta, y al
              // llegar a ACTIVE deja al operador en el board del proyecto.
              <button
                type="button"
                aria-label="Crear proyecto"
                title="Crear proyecto"
                onClick={() => navegar({ seccion: 'asistente', id: null })}
                className="flex size-6 items-center justify-center rounded-md text-ds-gray-900 transition-colors hover:bg-ds-gray-alpha-100 hover:text-ds-gray-1000"
              >
                <Plus aria-hidden="true" className="size-3.5" />
              </button>
            }
          >
            Proyectos
          </TituloDeBloque>

          {lista.length === 0 ? (
            <p className="px-2 py-1 text-label-12 text-ds-gray-700">
              {proyectos === null && board === null ? 'Cargando…' : 'Ninguno todavia'}
            </p>
          ) : (
            <ul aria-labelledby={`${base}-proyectos`} className="flex flex-col gap-px">
              {lista.map((proyecto) => {
                const activoEnElBoard = proyecto.estado === 'ACTIVE'
                const pendiente = ETAPA_PENDIENTE[proyecto.estado]
                const esEste = proyectoMarcado === proyecto.id
                return (
                  <li key={proyecto.id} className="group/proyecto relative">
                    <button
                      type="button"
                      aria-current={esEste ? 'page' : undefined}
                      title={
                        activoEnElBoard
                          ? `Board de ${proyecto.nombre}`
                          : `${proyecto.nombre}: le falta ${pendiente?.etapa ?? 'terminar el establecimiento'}. Abre el asistente donde quedo.`
                      }
                      onClick={() =>
                        navegar(
                          activoEnElBoard
                            ? { seccion: 'board', id: proyecto.id }
                            : { seccion: 'asistente', id: proyecto.id },
                        )
                      }
                      className={`flex h-8 w-full items-center gap-2 rounded-md pl-2.5 pr-8 text-left text-label-13 transition-colors ${
                        esEste
                          ? 'bg-ds-gray-alpha-200 text-ds-gray-1000'
                          : 'text-ds-gray-900 hover:bg-ds-gray-alpha-100 hover:text-ds-gray-1000'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: colorDeProyecto(proyecto) }}
                      />
                      <span className="min-w-0 flex-1 truncate">{proyecto.nombre}</span>
                      {activoEnElBoard ? null : (
                        <span className="shrink-0 text-label-12 text-ds-amber-900">Configurar</span>
                      )}
                    </button>
                    {activoEnElBoard ? (
                      // Settings del proyecto, a un clic y sin ocupar sitio: el
                      // engranaje aparece al pasar por la fila o al llegarle el
                      // foco, que es cuando se esta pensando en ESE proyecto.
                      <button
                        type="button"
                        aria-label={`Settings de ${proyecto.nombre}`}
                        title={`Settings de ${proyecto.nombre}`}
                        onClick={() => navegar({ seccion: 'ajustes', id: proyecto.id })}
                        className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-md text-ds-gray-700 opacity-0 transition-opacity hover:bg-ds-gray-alpha-200 hover:text-ds-gray-1000 focus-visible:opacity-100 group-hover/proyecto:opacity-100"
                      >
                        <Settings2 aria-hidden="true" className="size-3.5" />
                      </button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div>
          <TituloDeBloque id={`${base}-runs`}>Runs activos</TituloDeBloque>
          {activos.length === 0 ? (
            <p className="px-2 py-1 text-label-12 text-ds-gray-700">
              {board ? 'Nada corriendo ni esperandote' : 'Sin datos del board'}
            </p>
          ) : (
            <ul aria-labelledby={`${base}-runs`} className="flex flex-col gap-px">
              {activos.slice(0, RUNS_A_LA_VISTA).map((tarjeta) => {
                const chip = tarjeta.chip!
                const color = COLOR_DE_TONO[tonoDeChip(chip.tipo)]
                const clave = tarjeta.ticket.key ?? tarjeta.ticket.id
                return (
                  <li key={tarjeta.id}>
                    <button
                      type="button"
                      title={chip.detalle ?? `${clave}: ${tarjeta.ticket.titulo}`}
                      onClick={() =>
                        navegar({
                          seccion: 'runs',
                          id: tarjeta.proyecto.id,
                          run: tarjeta.run?.itemId ?? tarjeta.ticket.id,
                        })
                      }
                      className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left transition-colors hover:bg-ds-gray-alpha-100"
                    >
                      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                      <span className="fuente-operativa shrink-0 text-label-12 text-ds-gray-1000">{clave}</span>
                      <span className="min-w-0 flex-1 truncate text-right text-label-12" style={{ color }}>
                        {textoDelChip(chip)}
                      </span>
                    </button>
                  </li>
                )
              })}
              {activos.length > RUNS_A_LA_VISTA ? (
                <li>
                  <button
                    type="button"
                    onClick={() => navegar({ seccion: 'runs', id: null })}
                    className="flex h-7 w-full items-center rounded-md px-2.5 text-label-12 text-ds-gray-900 hover:bg-ds-gray-alpha-100 hover:text-ds-gray-1000"
                  >
                    Ver los {activos.length}
                  </button>
                </li>
              ) : null}
            </ul>
          )}
        </div>
      </div>

      {pie ? <div className="shrink-0 border-t border-ds-gray-400 px-3 py-2.5">{pie}</div> : null}
    </nav>
  )
}

/**
 * El pie: con que habla el board.
 *
 * «El estado del gestor conectado» del referente, dicho sin inventar: los
 * gestores que el servicio declara para los proyectos del board, y si alguno
 * NO sabe listar tickets —en cuyo caso sus columnas Backlog y Todo van
 * incompletas, y eso se dice aqui ademas de en la columna.
 */
export function EstadoDeGestores({ board }: { board: Board | null }) {
  if (!board) return null
  const porGestor = new Map<string, { nombre: string; sinListado: boolean }>()
  for (const proyecto of board.proyectos) {
    if (!proyecto.gestor) continue
    const previo = porGestor.get(proyecto.gestor)
    porGestor.set(proyecto.gestor, {
      nombre: proyecto.gestor,
      sinListado: (previo?.sinListado ?? false) || !proyecto.listItems,
    })
  }
  if (porGestor.size === 0) {
    return <p className="text-label-12 text-ds-gray-700">Ningun gestor de tickets conectado</p>
  }
  return (
    <ul className="flex flex-wrap gap-x-2 gap-y-0.5 text-label-12 text-ds-gray-900">
      {[...porGestor.values()].map((gestor) => (
        <li key={gestor.nombre} className="inline-flex items-center gap-1">
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${gestor.sinListado ? 'bg-ds-amber-700' : 'bg-ds-green-700'}`}
          />
          {gestor.nombre}
          {gestor.sinListado ? <span className="text-ds-gray-700">(sin listado)</span> : null}
        </li>
      ))}
    </ul>
  )
}

/** La cascara: el board compartido del marco y la lista de proyectos. */
export function NavegacionLateral({
  ruta,
  navegar,
  alAbrirComandos,
  proyectos,
  pie,
  className,
}: Omit<PropsDePanelLateral, 'board'>) {
  const compartido = useBoard()
  const board = compartido?.lectura.datos ?? null
  return (
    <PanelLateral
      ruta={ruta}
      navegar={navegar}
      alAbrirComandos={alAbrirComandos}
      proyectos={proyectos}
      board={board}
      pie={
        <div className="flex flex-col gap-2">
          <EstadoDeGestores board={board} />
          {pie}
        </div>
      }
      className={className}
    />
  )
}
