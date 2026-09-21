'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Boxes,
  FileSearch,
  Inbox,
  KeyRound,
  Plus,
  ScrollText,
  Wrench,
} from 'lucide-react'

import { useRuta, type Navegar, type Ruta } from '@/lib/ruta'
import { useServicio } from '@/components/proveedor-servicio'
import {
  BannerSinConexion,
  PantallaIniciando,
  PantallaServicioCaido,
} from '@/components/estado-servicio'
import { Button } from '@/components/ui/button'
import { MenuDeComandos, useMenuDeComandos, type Comando } from '@/components/ui/menu-de-comandos'
import { SelectorDeTema } from '@/components/selector-tema'
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
      <span className="text-label-12 text-ds-gray-900">
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
        Elige un proyecto de la lista y vuelve a entrar desde ahi.
      </p>
      <Button onClick={() => navegar({ seccion: 'proyectos', id: null })}>
        Ver los proyectos
      </Button>
    </div>
  )
}

/** Que pantalla corresponde a la ruta. Un solo sitio donde mirarlo. */
function Contenido({ ruta, navegar }: { ruta: Ruta; navegar: Navegar }) {
  switch (ruta.seccion) {
    case 'bandeja':
      return <VistaDeBandeja entradaAbierta={ruta.id} navegar={navegar} />
    case 'proyectos':
      return <VistaDeProyectos navegar={navegar} />
    case 'proyecto-nuevo':
      return <VistaDeAltaDeProyecto navegar={navegar} />
    case 'snapshot':
      return ruta.id ? (
        <VistaDeSnapshot proyectoId={ruta.id} navegar={navegar} />
      ) : (
        <FaltaElProyecto seccion="el snapshot" navegar={navegar} />
      )
    case 'constitution':
      return ruta.id ? (
        <VistaDeConstitution proyectoId={ruta.id} navegar={navegar} />
      ) : (
        <FaltaElProyecto seccion="la constitution" navegar={navegar} />
      )
    case 'bootstrap':
      return ruta.id ? (
        <VistaDeBootstrap proyectoId={ruta.id} navegar={navegar} />
      ) : (
        <FaltaElProyecto seccion="el bootstrap" navegar={navegar} />
      )
    case 'conexiones':
      return ruta.id ? (
        <VistaDeConexiones proyectoId={ruta.id} navegar={navegar} />
      ) : (
        <FaltaElProyecto seccion="las conexiones" navegar={navegar} />
      )
    case 'flota':
      return ruta.id ? (
        <VistaDeFlota proyectoId={ruta.id} navegar={navegar} />
      ) : (
        <FaltaElProyecto seccion="la flota" navegar={navegar} />
      )
    case 'runs':
      return ruta.id ? (
        <VistaDeRuns proyectoId={ruta.id} navegar={navegar} />
      ) : (
        <FaltaElProyecto seccion="los ciclos" navegar={navegar} />
      )
    case 'credenciales':
      return <VistaDeCredenciales credencialAbierta={ruta.id} navegar={navegar} />
    case 'auditoria':
      return <VistaDeAuditoria navegar={navegar} />
    default:
      return <VistaDeInicio navegar={navegar} />
  }
}

/**
 * Los comandos del menu ⌘K (NFR-005).
 *
 * VIVEN EN LA CASCARA Y NO EN CADA PANTALLA, que es lo que los hace utiles:
 * el valor del menu es llegar a cualquier sitio desde cualquier sitio sin
 * levantar las manos del teclado. Un menu que solo conoce los comandos de la
 * pantalla abierta es una barra de herramientas con otro aspecto.
 *
 * Las pantallas que cuelgan de un proyecto no estan aqui a proposito: sin
 * saber de que proyecto, el comando llevaria a la pantalla que dice que falta
 * el identificador. Se llega a ellas desde la lista, que es donde se elige.
 */
function comandosDeNavegacion(navegar: Navegar): Comando[] {
  const ir = (destino: Ruta) => () => navegar(destino)

  return [
    {
      id: 'ir-inicio',
      etiqueta: 'Abrir inicio',
      descripcion: 'Indicadores agregados y la bandeja',
      grupo: 'Navegacion',
      icono: <Boxes />,
      ejecutar: ir({ seccion: 'inicio', id: null }),
    },
    {
      id: 'ir-bandeja',
      etiqueta: 'Abrir bandeja',
      descripcion: 'Lo que requiere una decision tuya',
      grupo: 'Navegacion',
      palabrasClave: ['pendiente', 'decidir', 'atencion'],
      icono: <Inbox />,
      ejecutar: ir({ seccion: 'bandeja', id: null }),
    },
    {
      id: 'ir-proyectos',
      etiqueta: 'Abrir proyectos',
      grupo: 'Navegacion',
      icono: <FileSearch />,
      ejecutar: ir({ seccion: 'proyectos', id: null }),
    },
    {
      id: 'anadir-proyecto',
      etiqueta: 'Anadir proyecto',
      descripcion: 'Carpeta local, repositorio remoto o proyecto nuevo',
      grupo: 'Proyectos',
      palabrasClave: ['nuevo', 'clonar', 'adoptar', 'alta'],
      icono: <Plus />,
      ejecutar: ir({ seccion: 'proyecto-nuevo', id: null }),
    },
    {
      id: 'ir-credenciales',
      etiqueta: 'Abrir credenciales',
      descripcion: 'Inventario, grants y vista inversa',
      grupo: 'Gobernanza',
      palabrasClave: ['secreto', 'token', 'grant', 'boveda'],
      icono: <KeyRound />,
      ejecutar: ir({ seccion: 'credenciales', id: null }),
    },
    {
      id: 'ir-auditoria',
      etiqueta: 'Abrir auditoria',
      descripcion: 'Registro append-only, solo lectura',
      grupo: 'Gobernanza',
      palabrasClave: ['registro', 'bitacora', 'append'],
      icono: <ScrollText />,
      ejecutar: ir({ seccion: 'auditoria', id: null }),
    },
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

/**
 * La navegacion visible. Cinco entradas y no once.
 *
 * Las pantallas de etapa —snapshot, constitution, bootstrap, conexiones— NO
 * estan aqui: pertenecen a un proyecto, y una barra con cuatro entradas que
 * la mitad del tiempo no llevan a ninguna parte ensena a no mirarla. Se llega
 * a ellas desde la fila del proyecto, que es donde el operador ya esta
 * decidiendo cual.
 */
const SECCIONES_VISIBLES = [
  { seccion: 'inicio' as const, etiqueta: 'Inicio' },
  { seccion: 'proyectos' as const, etiqueta: 'Proyectos' },
  { seccion: 'bandeja' as const, etiqueta: 'Bandeja' },
  { seccion: 'credenciales' as const, etiqueta: 'Credenciales' },
  { seccion: 'auditoria' as const, etiqueta: 'Auditoria' },
]

/** Que entrada de la navegacion queda marcada segun donde se esta. */
const SECCION_PADRE: Partial<Record<Ruta['seccion'], Ruta['seccion']>> = {
  'proyecto-nuevo': 'proyectos',
  snapshot: 'proyectos',
  constitution: 'proyectos',
  bootstrap: 'proyectos',
  conexiones: 'proyectos',
  flota: 'proyectos',
  runs: 'proyectos',
}

export function Aplicacion() {
  const { ruta, navegar } = useRuta()
  const { estado } = useServicio()
  const menu = useMenuDeComandos()

  const comandos = useMemo(() => comandosDeNavegacion(navegar), [navegar])

  // El catalogo de componentes va ANTES de la comprobacion del servicio, y a
  // proposito: no lee nada del servicio, asi que exigir el daemon para revisar
  // el contraste de un `Badge` seria una barrera sin motivo. De paso, montarlo
  // desde aqui es lo que hace que el build ejercite los componentes en vez de
  // dejarlos como codigo que compila y nadie ha renderizado nunca.
  if (ruta.seccion === 'catalogo') {
    return (
      <main className="mx-auto w-full max-w-5xl px-6 py-10">
        <VistaDeCatalogo navegar={navegar} />
      </main>
    )
  }

  if (estado === 'iniciando') return <PantallaIniciando />

  // Nunca hubo contacto: no hay datos que ensenar, asi que se ensena el
  // problema. Lo que no se hace, jamas, es dejar la pantalla en blanco.
  if (estado === 'sin_servicio') return <PantallaServicioCaido />

  const activa = SECCION_PADRE[ruta.seccion] ?? ruta.seccion

  return (
    <div className="flex min-h-dvh flex-col">
      {/* NFR-005: lo primero que recibe el foco es la forma de saltarse el
          encabezado. Sin esto, llegar al contenido con teclado cuesta seis
          tabulaciones en cada carga. */}
      <a
        href="#contenido"
        className="sr-only rounded-md bg-ds-background-100 px-3 py-2 text-label-14 text-ds-gray-1000 focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
      >
        Saltar al contenido
      </a>

      <header className="border-b border-ds-gray-400">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
          <span className="text-heading-16 text-ds-gray-1000">noxloop</span>

          <nav aria-label="Secciones" className="flex flex-wrap items-center gap-1">
            {SECCIONES_VISIBLES.map(({ seccion, etiqueta }) => {
              const esLaActiva = activa === seccion
              return (
                <button
                  key={seccion}
                  type="button"
                  aria-current={esLaActiva ? 'page' : undefined}
                  onClick={() => navegar({ seccion, id: null })}
                  className={cn(
                    'rounded-md px-2 py-1 text-button-14 transition-colors',
                    esLaActiva
                      ? 'bg-ds-gray-alpha-100 text-ds-gray-1000'
                      : 'text-ds-gray-900 hover:text-ds-gray-1000',
                  )}
                >
                  {etiqueta}
                </button>
              )
            })}
          </nav>

          <div className="ml-auto flex items-center gap-4">
            {/* El menu de comandos tiene su atajo global, y ademas un boton:
                un atajo sin nada que lo anuncie solo lo usa quien ya sabia que
                existe. */}
            <Button variant="ghost" size="sm" onClick={menu.abrir}>
              Comandos
              <span aria-hidden="true" className="fuente-operativa text-ds-gray-700">
                ⌘K
              </span>
            </Button>
            <IndicadorDeFrescura />
            <SelectorDeTema />
          </div>
        </div>
      </header>

      {estado === 'sin_conexion' ? <BannerSinConexion /> : null}

      <main id="contenido" className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <Contenido ruta={ruta} navegar={navegar} />
      </main>

      <MenuDeComandos comandos={comandos} abierto={menu.abierto} alCerrar={menu.cerrar} />
    </div>
  )
}
