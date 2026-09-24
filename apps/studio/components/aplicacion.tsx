'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Boxes,
  ChartColumn,
  Compass,
  Cpu,
  FileSearch,
  Inbox,
  Kanban,
  KeyRound,
  Plug,
  Plus,
  ScrollText,
  Settings2,
  SquareActivity,
  Stethoscope,
  Users,
  Wrench,
} from 'lucide-react'

import {
  esAjusteDeProyecto,
  esAjusteGeneral,
  esSeccionDeProyecto,
  SECCIONES_DE_AJUSTES_DE_PROYECTO,
  useRuta,
  type Navegar,
  type Ruta,
} from '@/lib/ruta'
import { useLectura } from '@/lib/lectura'
import type { Proyecto } from '@/lib/tipos'
import { useServicio } from '@/components/proveedor-servicio'
import { PedirToken } from '@/components/pedir-token'
import { tokenDeSesion } from '@/lib/daemon'
import {
  BannerSinConexion,
  PantallaIniciando,
  PantallaServicioCaido,
} from '@/components/estado-servicio'
import { Button } from '@/components/ui/button'
import { MenuDeComandos, useMenuDeComandos, type Comando } from '@/components/ui/menu-de-comandos'
import { SelectorDeTema } from '@/components/selector-tema'
import { Marco } from '@/components/marco/marco'
import { anchoDelLienzo } from '@/components/marco/lienzo'
import { etiquetaDePestana } from '@/components/marco/secciones'
import { AjustesDelProyecto, AjustesGenerales } from '@/components/ajustes/marco-de-ajustes'
import { VistaDeAjustesDeProyecto } from '@/components/ajustes/vista-ajustes-de-proyecto'
import { VistaDelGestor } from '@/components/ajustes/vista-gestor'
import { VistaDeModelos } from '@/components/ajustes/vista-modelos'
import { VistaDeDiagnostico } from '@/components/ajustes/vista-diagnostico'
import { VistaDeFlotaPorDefecto } from '@/components/ajustes/vista-flota-por-defecto'
import { VistaDeBoard } from '@/components/vista-board'
import { VistaDeListaDeRuns } from '@/components/vista-lista-de-runs'
import { VistaDeCostos } from '@/components/vista-costos'
import { VistaDeGuidelines } from '@/components/vista-guidelines'
import { PasoDeDiseno } from '@/components/asistente/paso-de-diseno'
import { Asistente } from '@/components/asistente/asistente'
import { VistaDeInicio } from '@/components/vista-inicio'
import { VistaDeBandeja } from '@/components/vista-bandeja'
import { VistaDeCatalogo } from '@/components/vista-catalogo'
import { VistaDeProyectos } from '@/components/vista-proyectos'
import { VistaDeAltaDeProyecto } from '@/components/vista-alta-de-proyecto'
import { VistaDeSnapshot } from '@/components/vista-snapshot'
import { VistaDeConstitution } from '@/components/vista-constitution'
import { VistaDeBootstrap } from '@/components/vista-bootstrap'
import { VistaDeConexiones } from '@/components/vista-conexiones'
import { VistaDeFlota } from '@/components/vista-flota'
import { VistaDeRuns } from '@/components/vista-runs'
import { VistaDeCredenciales } from '@/components/vista-credenciales'
import { VistaDeAuditoria } from '@/components/vista-auditoria'
import { formatearRelativo } from '@/lib/tiempo'
import { cn } from '@/lib/utils'

/**
 * El cascaron de la aplicacion y el enrutado en cliente.
 *
 * Es un componente de cliente entero a proposito: en un export estatico el
 * prerender produce HTML sin datos, y todo lo que se pinta depende de lo que
 * diga el servicio. Fingir contenido en el servidor aqui seria fingir datos.
 *
 * LO QUE ESTE ARCHIVO YA NO HACE. La forma del marco —migas, los dos niveles
 * de navegacion, el contexto de proyecto y el ancho del lienzo— vive en
 * `components/marco/`. Aqui quedan las tres cosas que son del cascaron y de
 * nadie mas: que pantalla corresponde a la ruta, el estado del servicio, y los
 * comandos de ⌘K.
 */

/** FR-005 llevado al encabezado: en todo momento se sabe si esto es de ahora. */
function IndicadorDeFrescura() {
  const { estado, ultimoContacto } = useServicio()
  const [ahora, setAhora] = useState<number | null>(null)

  useEffect(() => {
    setAhora(Date.now())
    const intervalo = setInterval(() => setAhora(Date.now()), 10_000)
    return () => clearInterval(intervalo)
  }, [])

  const fresco = estado === 'conectado'

  return (
    <span className="flex items-center gap-2" role="status" aria-live="polite">
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 rounded-full',
          fresco ? 'bg-ds-green-700' : 'bg-ds-amber-700',
        )}
      />
      {/* `sr-only` y no `hidden` en ventana estrecha: la cabecera es de altura
          fija y no envuelve, asi que algo tiene que ceder, pero ocultarlo del
          todo se lleva por delante el anuncio de `aria-live` — que es
          precisamente lo unico que tiene quien no ve el punto de color. */}
      <span className="sr-only text-label-12 text-ds-gray-900 md:not-sr-only">
        {fresco
          ? 'En vivo'
          : ultimoContacto && ahora
            ? `Sin conexion · datos de ${formatearRelativo(ultimoContacto, ahora)}`
            : 'Sin conexion'}
      </span>
    </span>
  )
}

/**
 * Las pantallas que cuelgan de un proyecto necesitan su identificador en la
 * direccion. Si falta —una direccion pegada a medias, un proyecto borrado— se
 * dice que falta y se ofrece la salida, en vez de pintar una pantalla vacia
 * que parece rota.
 */
function FaltaElProyecto({ seccion, navegar }: { seccion: string; navegar: Navegar }) {
  return (
    <div className="flex max-w-xl flex-col items-start gap-4">
      <h1 className="text-heading-20 text-ds-gray-1000">
        No se pudo abrir {seccion}: la direccion no dice de que proyecto
      </h1>
      <p className="text-copy-14 text-ds-gray-900">
        Esta pantalla pertenece a un proyecto concreto y la direccion llego sin su
        identificador, asi que no hay nada que leer todavia.
      </p>
      <p className="text-copy-14 text-ds-gray-1000">
        Elige un proyecto en la lista de la izquierda y abre su Settings.
      </p>
      <Button onClick={() => navegar({ seccion: 'board', id: null })}>Ir al board</Button>
    </div>
  )
}

/** La pestana de Settings del proyecto que corresponde a la seccion. */
function PestanaDeProyecto({
  seccion,
  proyectoId,
  navegar,
}: {
  seccion: Ruta['seccion']
  proyectoId: string
  navegar: Navegar
}) {
  switch (seccion) {
    case 'ajustes':
      return <VistaDeAjustesDeProyecto proyectoId={proyectoId} navegar={navegar} />
    case 'snapshot':
      return <VistaDeSnapshot proyectoId={proyectoId} navegar={navegar} />
    case 'constitution':
      return <VistaDeConstitution proyectoId={proyectoId} navegar={navegar} />
    case 'guidelines':
      return <VistaDeGuidelines proyectoId={proyectoId} />
    case 'diseno':
      // El paso del asistente, montado como pestana. `alTerminar` no navega:
      // aqui no hay paso siguiente, se ajusta y se queda.
      return <PasoDeDiseno proyectoId={proyectoId} alTerminar={() => undefined} />
    case 'bootstrap':
      return <VistaDeBootstrap proyectoId={proyectoId} navegar={navegar} />
    case 'conexiones':
      return <VistaDeConexiones proyectoId={proyectoId} navegar={navegar} />
    case 'gestor':
      return <VistaDelGestor proyectoId={proyectoId} />
    case 'flota':
      return <VistaDeFlota proyectoId={proyectoId} navegar={navegar} />
    case 'ciclos':
      return <VistaDeRuns proyectoId={proyectoId} navegar={navegar} />
    default:
      return null
  }
}

/** Que pantalla corresponde a la ruta. Un solo sitio donde mirarlo. */
function Contenido({
  ruta,
  navegar,
  proyectos,
}: {
  ruta: Ruta
  navegar: Navegar
  proyectos: Proyecto[] | null
}) {
  const { seccion } = ruta

  // SETTINGS GENERAL: las pestanas del portal de tools.
  if (esAjusteGeneral(seccion)) {
    return (
      <AjustesGenerales seccion={seccion} navegar={navegar}>
        {seccion === 'settings' ? (
          <VistaDeConexiones proyectoId={null} navegar={navegar} />
        ) : seccion === 'modelos' ? (
          <VistaDeModelos />
        ) : seccion === 'diagnostico' ? (
          <VistaDeDiagnostico />
        ) : seccion === 'credenciales' ? (
          <VistaDeCredenciales credencialAbierta={ruta.id} navegar={navegar} />
        ) : seccion === 'flota-por-defecto' ? (
          <VistaDeFlotaPorDefecto navegar={navegar} />
        ) : (
          <VistaDeAuditoria navegar={navegar} />
        )}
      </AjustesGenerales>
    )
  }

  // SETTINGS DEL PROYECTO: las pantallas de la 002, como pestanas.
  if (esAjusteDeProyecto(seccion)) {
    if (!ruta.id) {
      return <FaltaElProyecto seccion={etiquetaDePestana(seccion).toLowerCase()} navegar={navegar} />
    }
    return (
      <AjustesDelProyecto
        seccion={seccion}
        proyectoId={ruta.id}
        proyecto={proyectos?.find((proyecto) => proyecto.id === ruta.id) ?? null}
        navegar={navegar}
      >
        <PestanaDeProyecto seccion={seccion} proyectoId={ruta.id} navegar={navegar} />
      </AjustesDelProyecto>
    )
  }

  switch (seccion) {
    case 'board':
      return <VistaDeBoard proyectoId={ruta.id} navegar={navegar} />
    case 'runs':
      return <VistaDeListaDeRuns ruta={ruta} navegar={navegar} />
    case 'costos':
      return <VistaDeCostos navegar={navegar} />
    // El asistente es LA unica seccion que no exige identificador de proyecto
    // aun llevandolo: su primer paso es conseguirlo.
    case 'asistente':
      return <Asistente ruta={ruta} navegar={navegar} />
    case 'inicio':
      return <VistaDeInicio navegar={navegar} />
    case 'bandeja':
      return <VistaDeBandeja entradaAbierta={ruta.id} navegar={navegar} />
    case 'proyectos':
      return <VistaDeProyectos navegar={navegar} />
    case 'proyecto-nuevo':
      return <VistaDeAltaDeProyecto navegar={navegar} />
    default:
      return <VistaDeBoard proyectoId={null} navegar={navegar} />
  }
}

/**
 * Los comandos del menu ⌘K (NFR-005).
 *
 * VIVEN EN LA CASCARA Y NO EN CADA PANTALLA, que es lo que los hace utiles:
 * el valor del menu es llegar a cualquier sitio desde cualquier sitio sin
 * levantar las manos del teclado.
 *
 * CON LA 003 EL MENU CARGA CON LO QUE SALIO DE LA NAVEGACION. La navegacion
 * lateral tiene cuatro destinos; todo lo demas —las pantallas de
 * establecimiento de cada proyecto, la bandeja, los indicadores, la lista de
 * proyectos— se alcanza desde Settings y DESDE AQUI (FR-025). Por eso cada
 * pantalla de la 002 tiene su comando, y las de proyecto salen atadas a cada
 * proyecto: «Constitution de pagos» y no «Abrir constitution» a secas, que sin
 * proyecto abierto no sabria de cual.
 */
function comandosDeNavegacion(
  navegar: Navegar,
  proyectoAbierto: string | null,
  proyectos: Proyecto[],
): Comando[] {
  const ir = (destino: Ruta) => () => navegar(destino)

  const principales: Comando[] = [
    {
      id: 'ir-board',
      etiqueta: 'Board',
      descripcion: 'Todos los proyectos en columnas: lo que corre y lo que te necesita',
      grupo: 'Navegacion',
      palabrasClave: ['kanban', 'tablero', 'inicio', 'tickets'],
      icono: <Kanban />,
      ejecutar: ir({ seccion: 'board', id: null }),
    },
    {
      id: 'ir-runs',
      etiqueta: 'Runs',
      descripcion: 'Los runs de todos los proyectos, con su estado y su diff',
      grupo: 'Navegacion',
      palabrasClave: ['ejecuciones', 'ciclos', 'motor'],
      icono: <SquareActivity />,
      ejecutar: ir({ seccion: 'runs', id: null }),
    },
    {
      id: 'ir-costos',
      etiqueta: 'Costos',
      descripcion: 'Gasto por proyecto y por run',
      grupo: 'Navegacion',
      palabrasClave: ['gasto', 'dinero', 'usd', 'uso'],
      icono: <ChartColumn />,
      ejecutar: ir({ seccion: 'costos', id: null }),
    },
    {
      id: 'ir-settings',
      etiqueta: 'Settings',
      descripcion: 'Herramientas y conexiones, modelos, credenciales, flota, auditoria',
      grupo: 'Navegacion',
      palabrasClave: ['ajustes', 'configuracion', 'tools', 'herramientas'],
      icono: <Settings2 />,
      ejecutar: ir({ seccion: 'settings', id: null }),
    },
  ]

  const deSettings: Comando[] = [
    { id: 'ir-herramientas', etiqueta: 'Herramientas y conexiones', grupo: 'Settings', palabrasClave: ['conexiones', 'github', 'linear', 'gestor'], icono: <Plug />, ejecutar: ir({ seccion: 'settings', id: null }) },
    { id: 'ir-modelos', etiqueta: 'Modelos', descripcion: 'Runtimes de agente: iniciar sesion o API key', grupo: 'Settings', palabrasClave: ['runtime', 'claude', 'codex', 'openai', 'api key'], icono: <Cpu />, ejecutar: ir({ seccion: 'modelos', id: null }) },
    { id: 'ir-diagnostico', etiqueta: 'Diagnostico', descripcion: 'Por que un run no va a arrancar: binarios, confianza de Claude Code, gate y runtimes', grupo: 'Settings', palabrasClave: ['doctor', 'git', 'claude', 'codex', 'confianza', 'trust'], icono: <Stethoscope />, ejecutar: ir({ seccion: 'diagnostico', id: null }) },
    { id: 'ir-credenciales', etiqueta: 'Credenciales', descripcion: 'Inventario, grants y vista inversa', grupo: 'Settings', palabrasClave: ['secreto', 'token', 'grant', 'boveda'], icono: <KeyRound />, ejecutar: ir({ seccion: 'credenciales', id: null }) },
    { id: 'ir-flota-por-defecto', etiqueta: 'Flota por defecto', grupo: 'Settings', palabrasClave: ['agentes', 'flota'], icono: <Users />, ejecutar: ir({ seccion: 'flota-por-defecto', id: null }) },
    { id: 'ir-auditoria', etiqueta: 'Auditoria', descripcion: 'Registro append-only, solo lectura', grupo: 'Settings', palabrasClave: ['registro', 'bitacora', 'append'], icono: <ScrollText />, ejecutar: ir({ seccion: 'auditoria', id: null }) },
    { id: 'ir-inicio', etiqueta: 'Indicadores', descripcion: 'Indicadores agregados y la bandeja', grupo: 'Settings', palabrasClave: ['inicio', 'dashboard'], icono: <Boxes />, ejecutar: ir({ seccion: 'inicio', id: null }) },
    { id: 'ir-bandeja', etiqueta: 'Bandeja', descripcion: 'Lo que requiere una decision tuya', grupo: 'Settings', palabrasClave: ['pendiente', 'decidir', 'atencion'], icono: <Inbox />, ejecutar: ir({ seccion: 'bandeja', id: null }) },
    { id: 'ir-proyectos', etiqueta: 'Lista de proyectos', grupo: 'Settings', icono: <FileSearch />, ejecutar: ir({ seccion: 'proyectos', id: null }) },
  ]

  const deProyectos: Comando[] = [
    {
      id: 'crear-proyecto',
      etiqueta: 'Crear proyecto',
      descripcion: 'El asistente: de la carpeta al primer run',
      grupo: 'Proyectos',
      palabrasClave: ['nuevo', 'alta', 'asistente', 'wizard'],
      icono: <Plus />,
      ejecutar: ir({ seccion: 'asistente', id: null }),
    },
    {
      id: 'anadir-proyecto',
      etiqueta: 'Anadir proyecto sin asistente',
      descripcion: 'Carpeta local, repositorio remoto o proyecto nuevo',
      grupo: 'Proyectos',
      palabrasClave: ['clonar', 'adoptar'],
      icono: <Plus />,
      ejecutar: ir({ seccion: 'proyecto-nuevo', id: null }),
    },
    ...proyectos.flatMap<Comando>((proyecto) =>
      proyecto.estado === 'ACTIVE'
        ? [
            {
              id: `board-${proyecto.id}`,
              etiqueta: `Board de ${proyecto.nombre}`,
              grupo: 'Proyectos',
              palabrasClave: [proyecto.id],
              icono: <Kanban />,
              ejecutar: ir({ seccion: 'board', id: proyecto.id }),
            },
            {
              id: `settings-${proyecto.id}`,
              etiqueta: `Settings de ${proyecto.nombre}`,
              grupo: 'Proyectos',
              palabrasClave: [proyecto.id, 'ajustes', 'autonomia'],
              icono: <Settings2 />,
              ejecutar: ir({ seccion: 'ajustes', id: proyecto.id }),
            },
          ]
        : [
            {
              id: `asistente-${proyecto.id}`,
              etiqueta: `Terminar de configurar ${proyecto.nombre}`,
              descripcion: 'Retoma el asistente en la etapa que le falta',
              grupo: 'Proyectos',
              palabrasClave: [proyecto.id, 'asistente'],
              icono: <Compass />,
              ejecutar: ir({ seccion: 'asistente', id: proyecto.id }),
            },
          ],
    ),
  ]

  // Las pestanas de Settings del proyecto abierto, atadas a el.
  const abierto = proyectoAbierto ? proyectos.find((proyecto) => proyecto.id === proyectoAbierto) : null
  const delAbierto: Comando[] = proyectoAbierto
    ? [
        {
          id: 'continuar-asistente',
          etiqueta: 'Continuar el asistente',
          descripcion: 'Retoma el recorrido del proyecto abierto',
          grupo: 'Proyecto abierto',
          icono: <Compass />,
          ejecutar: ir({ seccion: 'asistente', id: proyectoAbierto }),
        },
        ...SECCIONES_DE_AJUSTES_DE_PROYECTO.map<Comando>((seccion) => ({
          id: `abrir-${seccion}`,
          etiqueta: `${etiquetaDePestana(seccion)} de ${abierto?.nombre ?? proyectoAbierto}`,
          descripcion: 'Settings del proyecto abierto',
          grupo: 'Proyecto abierto',
          ejecutar: ir({ seccion, id: proyectoAbierto }),
        })),
      ]
    : []

  return [
    ...principales,
    ...delAbierto,
    ...deProyectos,
    ...deSettings,
    {
      id: 'ir-catalogo',
      etiqueta: 'Abrir el catalogo de componentes',
      descripcion: 'No es superficie de producto: es donde se revisan los componentes',
      grupo: 'Herramientas',
      icono: <Wrench />,
      ejecutar: ir({ seccion: 'catalogo', id: null }),
    },
  ]
}

const EVENTOS_DE_PROYECTOS = ['proyecto.estado', 'sincronizar_completo'] as const

export function Aplicacion() {
  const { ruta, navegar } = useRuta()
  const { estado, reintentar } = useServicio()
  const menu = useMenuDeComandos()

  // LA LISTA DE PROYECTOS SE LEE UNA VEZ, AQUI. La usan el lateral (todos,
  // tambien los que no estan activos), las migas (el nombre del conmutador),
  // Settings del proyecto (el titulo) y ⌘K (un comando por proyecto). Cuatro
  // lecturas serian cuatro `GET /v1/projects` por cada evento del canal.
  const lecturaDeProyectos = useLectura<Proyecto[]>(
    estado === 'conectado' || estado === 'sin_conexion' ? '/v1/projects' : null,
    { relerEn: EVENTOS_DE_PROYECTOS },
  )
  const proyectos = lecturaDeProyectos.datos

  const proyectoAbierto = esSeccionDeProyecto(ruta.seccion) ? ruta.id : null
  const comandos = useMemo(
    () => comandosDeNavegacion(navegar, proyectoAbierto, proyectos ?? []),
    [navegar, proyectoAbierto, proyectos],
  )

  // El catalogo de componentes va ANTES de la comprobacion del servicio, y a
  // proposito: no lee nada del servicio, asi que exigir el daemon para revisar
  // el contraste de un `Badge` seria una barrera sin motivo. De paso, montarlo
  // desde aqui es lo que hace que el build ejercite los componentes en vez de
  // dejarlos como codigo que compila y nadie ha renderizado nunca.
  //
  // Va SIN el marco: no es superficie de producto, y pintarle migas y
  // navegacion de proyecto alrededor diria que lo es. El ancho si sale de
  // `lienzo.ts`, para que los componentes se revisen en el mismo espacio en el
  // que despues viven.
  if (ruta.seccion === 'catalogo') {
    return (
      <main className={cn('w-full px-4 py-8 sm:px-6 lg:px-8', anchoDelLienzo('catalogo'))}>
        <VistaDeCatalogo navegar={navegar} />
      </main>
    )
  }

  if (estado === 'iniciando') return <PantallaIniciando />

  // Nunca hubo contacto: no hay datos que ensenar, asi que se ensena el
  // problema. Lo que no se hace, jamas, es dejar la pantalla en blanco.
  //
  // Tampoco se pinta el marco alrededor: una navegacion de once entradas que
  // no lleva a ningun sitio porque no hay servicio es once promesas falsas.
  if (estado === 'sin_servicio') {
    // SIN TOKEN NO ES "EL SERVICIO NO ESTA", y confundirlos daba un diagnostico
    // falso. En modo web el token vive solo en memoria y se toma de `?token=`,
    // que se borra de la direccion en cuanto se lee: a la primera recarga no
    // hay token, cada peticion vuelve 401, y la aplicacion entera caia a "el
    // servicio no esta corriendo" — mandando al operador a arrancar algo que ya
    // estaba arrancado, con todas las acciones muertas.
    //
    // Dos decisiones correctas por separado que juntas rompian el producto. La
    // pantalla de token era el hueco declarado en la fase A, y esto lo cierra.
    if (tokenDeSesion() === null) return <PedirToken alEntrar={reintentar} />
    return <PantallaServicioCaido />
  }

  return (
    <>
      <Marco
        ruta={ruta}
        navegar={navegar}
        proyectos={proyectos}
        alAbrirComandos={menu.abrir}
        aviso={estado === 'sin_conexion' ? <BannerSinConexion /> : null}
        // Frescura y tema van AL PIE DEL LATERAL, y la cabecera se queda con
        // las migas: es lo que deja al board todo el alto. El menu de comandos
        // ya tiene su boton —el buscador del lateral— y su atajo.
        pie={
          <div className="flex items-center justify-between gap-2">
            <IndicadorDeFrescura />
            <SelectorDeTema />
          </div>
        }
        // Debajo de `lg` no hay lateral: la frescura y el tema suben a la
        // cabecera para no desaparecer.
        acciones={
          <div className="flex items-center gap-3 lg:hidden">
            <IndicadorDeFrescura />
            <SelectorDeTema />
          </div>
        }
      >
        <Contenido ruta={ruta} navegar={navegar} proyectos={proyectos} />
      </Marco>

      {/* Fuera del marco, y no dentro de `<main>`: un dialogo global no
          pertenece al landmark del contenido de la pantalla abierta. */}
      <MenuDeComandos comandos={comandos} abierto={menu.abierto} alCerrar={menu.cerrar} />
    </>
  )
}
