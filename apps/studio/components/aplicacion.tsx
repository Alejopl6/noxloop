'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Boxes,
  Compass,
  FileSearch,
  Inbox,
  KeyRound,
  Plus,
  ScrollText,
  Wrench,
} from 'lucide-react'

import { esSeccionDeProyecto, useRuta, type Navegar, type Ruta } from '@/lib/ruta'
import { useServicio } from '@/components/proveedor-servicio'
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
import { ETIQUETA_DE_SECCION, SECCIONES_DE_LA_ETAPA } from '@/components/marco/secciones'
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
    // El asistente es LA unica seccion que no exige identificador de proyecto
    // aun llevandolo: su primer paso es conseguirlo. Por eso no pasa por
    // `FaltaElProyecto` como las seis etapas.
    case 'asistente':
      return <Asistente ruta={ruta} navegar={navegar} />
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
 * LAS ETAPAS DEL PROYECTO YA SI ESTAN, y antes no. La razon por la que no
 * estaban era buena mientras duro: sin contexto de proyecto persistente, un
 * comando "Abrir constitution" no sabia de que proyecto y habria llevado a la
 * pantalla que dice que falta el identificador. Con el proyecto abierto en el
 * marco, el identificador se conoce, y las seis etapas entran al menu ATADAS A
 * EL. Sin proyecto abierto siguen sin aparecer, por el mismo motivo de antes.
 */
function comandosDeNavegacion(navegar: Navegar, proyectoId: string | null): Comando[] {
  const ir = (destino: Ruta) => () => navegar(destino)

  const deEtapa: Comando[] = proyectoId
    ? SECCIONES_DE_LA_ETAPA.map((seccion) => ({
        id: `ir-${seccion}`,
        etiqueta: `Abrir ${ETIQUETA_DE_SECCION[seccion].toLowerCase()}`,
        descripcion: 'Del proyecto que tienes abierto',
        grupo: 'Proyecto abierto',
        ejecutar: ir({ seccion, id: proyectoId }),
      }))
    : []

  return [
    // EL RECORRIDO GUIADO VA EL PRIMERO, y no por cortesia: es el camino por
    // defecto del producto. Con proyecto abierto lleva a SU recorrido, y sin
    // el lleva al primer paso, que es elegir o crear uno — la misma entrada
    // significando lo mismo en los dos casos.
    {
      id: 'ir-asistente',
      etiqueta: proyectoId ? 'Continuar el asistente' : 'Abrir el asistente',
      descripcion: proyectoId
        ? 'Retoma el recorrido del proyecto abierto en la etapa que le falta'
        : 'El recorrido guiado: crear el proyecto y establecerlo paso a paso',
      grupo: 'Navegacion',
      palabrasClave: ['guiado', 'recorrido', 'wizard', 'establecer', 'empezar'],
      icono: <Compass />,
      ejecutar: ir({ seccion: 'asistente', id: proyectoId }),
    },
    ...deEtapa,
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

export function Aplicacion() {
  const { ruta, navegar } = useRuta()
  const { estado } = useServicio()
  const menu = useMenuDeComandos()

  const proyectoAbierto = esSeccionDeProyecto(ruta.seccion) ? ruta.id : null
  const comandos = useMemo(
    () => comandosDeNavegacion(navegar, proyectoAbierto),
    [navegar, proyectoAbierto],
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
  if (estado === 'sin_servicio') return <PantallaServicioCaido />

  return (
    <>
      <Marco
        ruta={ruta}
        navegar={navegar}
        aviso={estado === 'sin_conexion' ? <BannerSinConexion /> : null}
        acciones={
          <>
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
          </>
        }
      >
        <Contenido ruta={ruta} navegar={navegar} />
      </Marco>

      {/* Fuera del marco, y no dentro de `<main>`: un dialogo global no
          pertenece al landmark del contenido de la pantalla abierta. */}
      <MenuDeComandos comandos={comandos} abierto={menu.abierto} alCerrar={menu.cerrar} />
    </>
  )
}
