'use client'

import { useCallback, useMemo, useState } from 'react'
import { RotateCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/estado-vacio'
import { Note } from '@/components/ui/nota'
import { FalloDeLectura } from '@/components/pantalla'
import { useServicio } from '@/components/proveedor-servicio'
import { useBoard } from '@/components/board/contexto-board'
import { ColumnaDeTarjetas } from '@/components/board/columna'
import { DetalleDeTarjeta } from '@/components/board/detalle-de-tarjeta'
import { BarraDelBoard, FiltroDesplegable } from '@/components/board/filtros'
import { DialogoDeTareaNueva } from '@/components/board/tarea-nueva'
import { PuntoDeProyecto, TarjetaDelBoard } from '@/components/board/tarjeta'
import {
  FILTROS_VACIOS,
  SIN_ASIGNAR,
  agruparPorColumna,
  etiquetaDeGestor,
  filtrarTarjetas,
  hayFiltros as hayFiltrosPuestos,
  opcionesDeFiltro,
  resumirTarjetas,
  type FiltroDeRepo,
  type FiltrosDelBoard,
} from '@/components/board/derivar'
import { comoErrorDelServicio, RUTAS, type ErrorDelServicio } from '@/lib/daemon'
import { abrirExterno } from '@/lib/enlace'
import { useLectura, type Lectura } from '@/lib/lectura'
import type { Navegar } from '@/lib/ruta'
import {
  ETAPA_PENDIENTE,
  ETIQUETA_ESTADO_PROYECTO,
  ORDEN_DE_COLUMNAS,
  type Board,
  type ColumnaDelBoard,
  type EstadoDeRuntime,
  type Tarjeta,
  type TareaNueva,
} from '@/lib/tipos'

/**
 * EL BOARD: la pantalla de inicio y el eje del producto (spec 003).
 *
 * «Un proyecto es su board. El board general es el mismo board con el filtro
 * de proyecto en Todos.» Esta pantalla es las dos cosas: `proyectoId` sale de
 * la direccion (FR-002) y todo lo demas es el mismo panel.
 *
 * COMO SE PARTE, igual que el resto de la consola: `PanelDeBoard` es una
 * funcion pura que recibe la lectura ya hecha y las acciones como callbacks,
 * y `VistaDeBoard` es la cascara que habla con el servicio. Es lo que deja
 * pintar el board en el catalogo sin servicio, con sus diez tarjetas de
 * ejemplo, y que `next build` lo renderice de verdad.
 *
 * LO QUE ESTA PANTALLA NO HACE: mover ni editar tickets de un gestor externo.
 * El gestor es la fuente de verdad de su backlog (principio VI) y un kanban
 * que arrastra tarjetas seria un segundo escritor. Las acciones que hay —Run,
 * Aprobar plan, Retry y «Nueva tarea», que crea una tarea en el gestor LOCAL
 * de noxloop (US7)— son peticiones al servicio (principio VIII).
 */

/* -------------------------------------------------------------------------- */
/* El panel                                                                   */
/* -------------------------------------------------------------------------- */

export interface PropsDePanelDeBoard {
  lectura: Pick<Lectura<Board>, 'datos' | 'error' | 'releer'>
  /** El proyecto elegido, de la direccion. `null` es «Todos los proyectos». */
  proyectoId: string | null
  navegar: Navegar
  incluirTerminados: boolean
  alCambiarIncluirTerminados: (incluir: boolean) => void
  alAccionar: (tarjeta: Tarjeta) => void
  /** Que tarjeta tiene una peticion en vuelo. */
  trabajandoEn: string | null
  /** El ultimo fallo de cada tarjeta, por su `id`. */
  errores: Readonly<Record<string, ErrorDelServicio>>
  alAbrirExterno: (url: string) => void
  /** Abre el dialogo de tarea nueva. */
  alNuevaTarea: () => void
  /** Filtros iniciales. Solo para el catalogo: ensenar el board ya filtrado. */
  filtrosIniciales?: Partial<FiltrosDelBoard>
}

const COLUMNAS_POR_DEFECTO: ColumnaDelBoard[] = ORDEN_DE_COLUMNAS.map((id) => ({
  id,
  titulo: '',
  total: 0,
  nota: null,
}))

const OPCIONES_DE_REPO: Array<{ valor: FiltroDeRepo; etiqueta: string }> = [
  { valor: 'con', etiqueta: 'Con repo' },
  { valor: 'sin', etiqueta: 'Sin repo' },
]

export function PanelDeBoard({
  lectura,
  proyectoId,
  navegar,
  incluirTerminados,
  alCambiarIncluirTerminados,
  alAccionar,
  trabajandoEn,
  errores,
  alAbrirExterno,
  alNuevaTarea,
  filtrosIniciales,
}: PropsDePanelDeBoard) {
  const [filtros, setFiltros] = useState<Omit<FiltrosDelBoard, 'proyecto'>>({
    ...FILTROS_VACIOS,
    ...filtrosIniciales,
  })
  const [abierta, setAbierta] = useState<string | null>(null)
  // Backlog empieza plegado: ver `ColumnaDeTarjetas`.
  const [backlogAbierto, setBacklogAbierto] = useState(false)

  const board = lectura.datos
  const cargando = board === null && lectura.error === null
  const todas = board?.tarjetas ?? []
  const proyectos = board?.proyectos ?? []
  const activos = proyectos.filter((proyecto) => proyecto.estado === 'ACTIVE')
  const elegido = proyectoId ? (proyectos.find((proyecto) => proyecto.id === proyectoId) ?? null) : null

  // Dos pasadas y no una, porque los contadores las necesitan por separado:
  // «base» es lo que hay con el proyecto elegido, «visibles» lo que queda
  // despues de los filtros del operador. «3 de 11» se dice con las dos.
  const delProyecto = useMemo(
    () => (proyectoId ? todas.filter((tarjeta) => tarjeta.proyecto.id === proyectoId) : todas),
    [todas, proyectoId],
  )
  const visibles = useMemo(
    () => filtrarTarjetas(delProyecto, { ...filtros, proyecto: null }),
    [delProyecto, filtros],
  )
  const porColumna = useMemo(() => agruparPorColumna(visibles), [visibles])
  const basePorColumna = useMemo(() => agruparPorColumna(delProyecto), [delProyecto])
  const opciones = useMemo(() => opcionesDeFiltro(delProyecto), [delProyecto])
  const hayFiltros = hayFiltrosPuestos({ ...filtros, proyecto: null })

  // El general usa la cuenta del servicio; un proyecto se cuenta aqui. El
  // porque, entero, en `resumirTarjetas`.
  const resumen = board ? (proyectoId ? resumirTarjetas(delProyecto) : board.resumen) : null

  const gestorDe = useCallback(
    (id: string) => etiquetaDeGestor(proyectos.find((proyecto) => proyecto.id === id)?.gestor ?? null),
    [proyectos],
  )
  // Una tarea propia se lee «Local» aunque su proyecto tenga un gestor
  // externo conectado: la tarjeta dice de donde salio ESE ticket.
  const origenDe = (tarjeta: Tarjeta) =>
    tarjeta.origen === 'local' ? 'Local' : gestorDe(tarjeta.proyecto.id)

  const columnas = board?.columnas?.length ? board.columnas : COLUMNAS_POR_DEFECTO
  const ordenadas = ORDEN_DE_COLUMNAS.map(
    (id) => columnas.find((columna) => columna.id === id) ?? { id, titulo: '', total: 0, nota: null },
  )

  const avisos = (board?.avisos ?? []).filter(
    (aviso) => !proyectoId || aviso.proyecto === null || aviso.proyecto === proyectoId,
  )

  const motivoSinTareaNueva =
    board === null
      ? 'El board todavia no llego del servicio.'
      : activos.length === 0
        ? 'No hay ningun proyecto activo: una tarea pertenece a un proyecto establecido.'
        : null

  const tarjetaAbierta = abierta ? (todas.find((tarjeta) => tarjeta.id === abierta) ?? null) : null

  const cambiar = <K extends keyof typeof filtros>(clave: K, valor: (typeof filtros)[K]) =>
    setFiltros((previos) => ({ ...previos, [clave]: valor }))

  const titulo = proyectoId ? (elegido?.nombre ?? proyectoId) : 'Todos los proyectos'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <BarraDelBoard
        titulo={titulo}
        prefijoDelTitulo={
          proyectoId ? <PuntoDeProyecto proyecto={elegido ?? { id: proyectoId }} className="size-2.5" /> : null
        }
        resumen={resumen}
        texto={filtros.texto}
        alCambiarTexto={(texto) => cambiar('texto', texto)}
        motivoSinTareaNueva={motivoSinTareaNueva}
        alNuevaTarea={alNuevaTarea}
        filtros={
          <>
            <FiltroDesplegable
              etiqueta="Proyecto"
              valor={proyectoId}
              alCambiar={(id) => navegar({ seccion: 'board', id })}
              opciones={[
                { valor: null, etiqueta: 'Todos los proyectos' },
                ...activos.map((proyecto) => ({
                  valor: proyecto.id,
                  etiqueta: proyecto.nombre,
                  prefijo: <PuntoDeProyecto proyecto={proyecto} />,
                })),
              ]}
            />
            <FiltroDesplegable
              etiqueta="Asignado"
              valor={filtros.asignado}
              alCambiar={(valor) => cambiar('asignado', valor)}
              opciones={[
                { valor: null, etiqueta: 'Cualquiera' },
                ...(opciones.haySinAsignar ? [{ valor: SIN_ASIGNAR, etiqueta: 'Sin asignar' }] : []),
                ...opciones.asignados.map((nombre) => ({ valor: nombre, etiqueta: nombre })),
              ]}
            />
            <FiltroDesplegable
              etiqueta="Tiene repo"
              valor={filtros.repo === 'todos' ? null : filtros.repo}
              alCambiar={(valor) => cambiar('repo', (valor ?? 'todos') as FiltroDeRepo)}
              opciones={[{ valor: null, etiqueta: 'Todos' }, ...OPCIONES_DE_REPO]}
            />
            <FiltroDesplegable
              etiqueta="Etiqueta"
              valor={filtros.etiqueta}
              alCambiar={(valor) => cambiar('etiqueta', valor)}
              deshabilitado={opciones.etiquetas.length === 0}
              opciones={[
                { valor: null, etiqueta: 'Cualquiera' },
                ...opciones.etiquetas.map((etiqueta) => ({ valor: etiqueta, etiqueta })),
              ]}
            />
          </>
        }
        extremo={
          <>
            {hayFiltros ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                onClick={() => setFiltros({ ...FILTROS_VACIOS })}
              >
                Limpiar filtros
              </Button>
            ) : null}
            <button
              type="button"
              aria-pressed={incluirTerminados}
              onClick={() => alCambiarIncluirTerminados(!incluirTerminados)}
              className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-label-13 transition-colors ${
                incluirTerminados
                  ? 'bg-ds-gray-alpha-200 text-ds-gray-1000'
                  : 'text-ds-gray-900 hover:bg-ds-gray-alpha-100 hover:text-ds-gray-1000'
              }`}
            >
              <span
                aria-hidden="true"
                className={`size-3 rounded-[3px] shadow-ds-border ${incluirTerminados ? 'bg-ds-gray-1000' : ''}`}
              />
              Incluir terminados
            </button>
          </>
        }
      />

      {/* LO QUE AVISA EL SERVICIO, SIN TUMBAR EL BOARD (FR-013). Un gestor
          caido deja sus columnas incompletas —la nota lo dice en cada una—
          pero las tarjetas que vienen de runs en disco siguen ahi. */}
      {avisos.length > 0 || (lectura.error && board) || (proyectoId && board && elegido?.estado !== 'ACTIVE') ? (
        <div className="flex shrink-0 flex-col gap-2 px-4 pt-3 sm:px-6">
          {proyectoId && board && elegido?.estado !== 'ACTIVE' ? (
            <ProyectoSinBoard
              proyectoId={proyectoId}
              nombre={elegido?.nombre ?? null}
              estado={elegido?.estado ?? null}
              navegar={navegar}
            />
          ) : null}
          {avisos.map((aviso, indice) => {
            const nombre = aviso.proyecto
              ? (proyectos.find((proyecto) => proyecto.id === aviso.proyecto)?.nombre ?? aviso.proyecto)
              : null
            return (
              <Note
                key={`${aviso.proyecto ?? 'general'}-${indice}`}
                tipo={aviso.nivel === 'error' ? 'error' : 'advertencia'}
                className="py-2"
              >
                <p>
                  {nombre ? <span className="text-ds-gray-1000">{nombre}: </span> : null}
                  {aviso.causa}
                </p>
                <p className="text-ds-gray-900">{aviso.accion}</p>
              </Note>
            )
          })}
          {lectura.error && board ? <FalloDeLectura error={lectura.error} /> : null}
        </div>
      ) : null}

      {board === null && lectura.error ? (
        <div className="px-4 sm:px-6">
          <EmptyState
            modo="error"
            titulo="No Se Pudo Leer El Board"
            descripcion={
              <div className="flex flex-col gap-1">
                <p>{lectura.error.causa}</p>
                <p className="text-ds-gray-1000">{lectura.error.accion}</p>
                <p className="fuente-operativa text-label-12 text-ds-gray-700">
                  codigo: {lectura.error.codigo}
                  {lectura.error.recurso ? ` · ${lectura.error.recurso}` : null}
                </p>
              </div>
            }
            accion={
              <Button variant="secondary" size="sm" onClick={lectura.releer}>
                <RotateCw aria-hidden="true" />
                Reintentar
              </Button>
            }
          />
        </div>
      ) : board && activos.length === 0 && todas.length === 0 ? (
        <div className="px-4 sm:px-6">
          <EmptyState
            titulo="Todavia No Hay Proyectos Activos"
            descripcion="El board ensena los tickets de los proyectos que ya terminaron de establecerse. Crea uno —el asistente lo lleva de la carpeta al primer run— o termina de configurar uno de la lista de la izquierda."
            accion={
              <Button size="sm" onClick={() => navegar({ seccion: 'asistente', id: null })}>
                Crear proyecto
              </Button>
            }
          />
        </div>
      ) : (
        <div
          role="region"
          aria-label="Columnas del board"
          // Desplazamiento horizontal del board entero y vertical por columna.
          // `tabIndex` para que el teclado pueda desplazarlo: una region con
          // scroll que no recibe foco no se puede mover sin raton.
          tabIndex={0}
          className="flex min-h-0 flex-1 gap-4 overflow-x-auto px-4 pt-4 focus-visible:shadow-none sm:px-6"
        >
          {ordenadas.map((columna) => (
            <ColumnaDeTarjetas
              key={columna.id}
              columna={columna}
              visibles={porColumna[columna.id].length}
              base={basePorColumna[columna.id].length}
              hayFiltros={hayFiltros}
              cargando={cargando}
              plegada={columna.id === 'backlog' && !backlogAbierto}
              alAlternar={
                columna.id === 'backlog' ? () => setBacklogAbierto((abierto) => !abierto) : undefined
              }
            >
              {porColumna[columna.id].map((tarjeta) => (
                <TarjetaDelBoard
                  key={tarjeta.id}
                  tarjeta={tarjeta}
                  gestor={origenDe(tarjeta)}
                  trabajando={trabajandoEn === tarjeta.id}
                  error={errores[tarjeta.id] ?? null}
                  alAccionar={alAccionar}
                  alAbrir={(elegida) => setAbierta(elegida.id)}
                />
              ))}
            </ColumnaDeTarjetas>
          ))}
          {/* El ultimo hueco a la derecha: sin el, la ultima columna queda
              pegada al borde al desplazar y parece cortada. */}
          <span aria-hidden="true" className="w-px shrink-0" />
        </div>
      )}

      <DetalleDeTarjeta
        tarjeta={tarjetaAbierta}
        gestor={tarjetaAbierta ? origenDe(tarjetaAbierta) : ''}
        trabajando={tarjetaAbierta !== null && trabajandoEn === tarjetaAbierta.id}
        error={tarjetaAbierta ? (errores[tarjetaAbierta.id] ?? null) : null}
        alCerrar={() => setAbierta(null)}
        alAccionar={alAccionar}
        alAbrirExterno={alAbrirExterno}
      />
    </div>
  )
}

/**
 * Un proyecto elegido que NO ESTA EN EL BOARD, dicho con su salida (US1,
 * escenario 5). Un board vacio sin explicacion se lee como «no hay tickets»,
 * y lo que pasa es que el proyecto no termino de establecerse.
 */
function ProyectoSinBoard({
  proyectoId,
  nombre,
  estado,
  navegar,
}: {
  proyectoId: string
  nombre: string | null
  estado: keyof typeof ETAPA_PENDIENTE | null
  navegar: Navegar
}) {
  const pendiente = estado ? ETAPA_PENDIENTE[estado] : null
  return (
    <Note
      tipo="advertencia"
      titulo={
        estado
          ? `${nombre ?? proyectoId} todavia no esta activo (${ETIQUETA_ESTADO_PROYECTO[estado]})`
          : `${proyectoId} no esta entre los proyectos del board`
      }
      accion={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navegar({ seccion: 'asistente', id: proyectoId })}
        >
          Terminar de configurarlo
        </Button>
      }
    >
      {pendiente
        ? `${pendiente.causa} ${pendiente.accion}`
        : 'Un proyecto entra al board cuando esta ACTIVE. Si lo acabas de crear, el asistente te lleva a la etapa que le falta; si lo borraste, elige otro en el filtro de proyecto.'}
    </Note>
  )
}

/* -------------------------------------------------------------------------- */
/* El contenedor                                                              */
/* -------------------------------------------------------------------------- */

/**
 * La cascara: la lectura compartida del marco y las tres peticiones.
 *
 * LAS PETICIONES VAN POR EL CLIENTE Y NO POR `useMutacion`, y el motivo es
 * concreto: `useMutacion` tiene UN error y UN «trabajando» para toda la
 * pantalla, y aqui cada tarjeta necesita el suyo — el 409 de «sin gate» de una
 * tarjeta no puede pintarse en las otras cuarenta. El contrato de siempre se
 * mantiene: todo fallo sale con causa y accion (`comoErrorDelServicio`), y
 * nada se escribe aqui; se le pide al servicio.
 */
export function VistaDeBoard({ proyectoId, navegar }: { proyectoId: string | null; navegar: Navegar }) {
  const compartido = useBoard()
  const { cliente } = useServicio()
  const [trabajandoEn, setTrabajandoEn] = useState<string | null>(null)
  const [errores, setErrores] = useState<Record<string, ErrorDelServicio>>({})

  const lectura = compartido?.lectura ?? null

  const alAccionar = useCallback(
    async (tarjeta: Tarjeta) => {
      const { accion, run, ticket, proyecto } = tarjeta
      if (accion.tipo === 'open_run') {
        navegar({ seccion: 'runs', id: proyecto.id, run: run?.itemId ?? ticket.id })
        return
      }
      if (accion.tipo === 'ninguna' || !accion.habilitada) return
      if (!cliente) {
        setErrores((previos) => ({
          ...previos,
          [tarjeta.id]: comoErrorDelServicio(
            new Error('esta interfaz no tiene conexion con el servicio de control'),
            'el board',
          ),
        }))
        return
      }

      setTrabajandoEn(tarjeta.id)
      setErrores((previos) => {
        const { [tarjeta.id]: _descartado, ...resto } = previos
        return resto
      })
      try {
        const itemId = run?.itemId ?? ticket.id
        if (accion.tipo === 'run') await cliente.lanzarRun(proyecto.id, ticket.id)
        else if (accion.tipo === 'approve') await cliente.aprobarRun(itemId)
        else if (accion.tipo === 'retry') await cliente.reintentarRun(itemId)
        // No se espera al evento para repintar: SC-003 pide ver la tarjeta en
        // En curso en menos de 3 s, y el `run.cambio` puede llegar despues de
        // la respuesta. Releer ya es lo que lo garantiza.
        lectura?.releer()
      } catch (fallo) {
        setErrores((previos) => ({ ...previos, [tarjeta.id]: comoErrorDelServicio(fallo, 'el board') }))
      } finally {
        setTrabajandoEn(null)
      }
    },
    [cliente, lectura, navegar],
  )

  // LA TAREA NUEVA. Los modelos se leen solo con el dialogo abierto: son el
  // desplegable de ejecutor, y pedirlos con cada visita al board seria una
  // lectura para una pantalla que casi nunca se abre.
  const [tareaNuevaAbierta, setTareaNuevaAbierta] = useState(false)
  const [creando, setCreando] = useState(false)
  const [errorDeTarea, setErrorDeTarea] = useState<ErrorDelServicio | null>(null)
  const runtimes = useLectura<EstadoDeRuntime[]>(tareaNuevaAbierta ? RUTAS.runtimes() : null)

  const crearTarea = useCallback(
    async (proyecto: string, tarea: TareaNueva): Promise<boolean> => {
      if (!cliente) return false
      setCreando(true)
      setErrorDeTarea(null)
      try {
        await cliente.crearTarea(proyecto, tarea)
        setTareaNuevaAbierta(false)
        lectura?.releer()
        return true
      } catch (fallo) {
        setErrorDeTarea(comoErrorDelServicio(fallo, RUTAS.tareas(proyecto)))
        return false
      } finally {
        setCreando(false)
      }
    },
    [cliente, lectura],
  )

  const [errorDeEnlace, setErrorDeEnlace] = useState<ErrorDelServicio | null>(null)
  const alAbrirExterno = useCallback(async (url: string) => {
    setErrorDeEnlace(null)
    try {
      await abrirExterno(url)
    } catch (fallo) {
      setErrorDeEnlace(comoErrorDelServicio(fallo, url))
    }
  }, [])

  if (!compartido || !lectura) {
    // Fuera del marco no hay lectura compartida. No pasa en la aplicacion —el
    // marco siempre monta el proveedor— y si pasa se dice, en vez de un board
    // vacio que parece un board sin tickets.
    return (
      <p className="p-6 text-copy-14 text-ds-gray-900">
        El board necesita el marco de la consola para leer del servicio.
      </p>
    )
  }

  return (
    <>
      {errorDeEnlace ? <FalloDeLectura error={errorDeEnlace} className="px-6 pt-3" /> : null}
      <PanelDeBoard
        lectura={lectura}
        proyectoId={proyectoId}
        navegar={navegar}
        incluirTerminados={compartido.incluirTerminados}
        alCambiarIncluirTerminados={compartido.alCambiarIncluirTerminados}
        alAccionar={(tarjeta) => void alAccionar(tarjeta)}
        trabajandoEn={trabajandoEn}
        errores={errores}
        alAbrirExterno={(url) => void alAbrirExterno(url)}
        alNuevaTarea={() => {
          setErrorDeTarea(null)
          setTareaNuevaAbierta(true)
        }}
      />
      <DialogoDeTareaNueva
        abierto={tareaNuevaAbierta}
        alCerrar={() => setTareaNuevaAbierta(false)}
        proyectos={(lectura.datos?.proyectos ?? []).filter((proyecto) => proyecto.estado === 'ACTIVE')}
        proyectoInicial={proyectoId}
        runtimes={runtimes.datos}
        enviando={creando}
        error={errorDeTarea}
        alEnviar={crearTarea}
      />
    </>
  )
}
