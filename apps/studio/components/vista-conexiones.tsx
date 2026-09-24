'use client'

import { useEffect, useMemo, useState } from 'react'
import { Copy, ExternalLink, GitBranch, Plug, Search, Server, Ticket } from 'lucide-react'

import { Badge, type TonoDeBadge } from '@/components/ui/insignia'
import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { EmptyState } from '@/components/ui/estado-vacio'
import { Entity, ListaDeEntidades } from '@/components/ui/entidad'
import { ErrorText, Fieldset, FieldsetContent, FieldsetFooter } from '@/components/ui/fieldset'
import { ModalDeAccionDestructiva } from '@/components/ui/modal-de-accion-destructiva'
import { Note } from '@/components/ui/nota'
import { Segmentado } from '@/components/ui/segmentado'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { Encabezado, EsqueletoDeLista, FalloDeLectura } from '@/components/pantalla'
import { RegistroDeAplicacionOauth } from '@/components/registro-de-aplicacion-oauth'
import { abrirExterno } from '@/lib/enlace'
import { comoErrorDelServicio, type ErrorDelServicio } from '@/lib/daemon'
import { useLectura } from '@/lib/lectura'
import { useAutorizacion } from '@/lib/autorizacion'
import { useMutacion } from '@/lib/mutacion'
import {
  alcanceDe,
  ETIQUETA_CLASE_CONEXION,
  ETIQUETA_ESTADO_CONEXION,
  type AlcanceDeConexion,
  type AutorizacionDeConexion,
  type CampoDeProveedor,
  type CapacidadesDelServicio,
  type ClaseDeConexion,
  type Conexion,
  type AplicacionOauth,
  type EntradaDeCatalogoDeConexiones,
  type EstadoDeAplicacionesOauth,
  type EstadoDeLaConexion,
} from '@/lib/tipos'
import type { Navegar } from '@/lib/ruta'

/**
 * T163 (1/2) · Conexiones del proyecto.
 *
 * LO QUE ESTA PANTALLA HACIA Y NO SERVIA PARA NADA, dicho sin rodeos porque es
 * el motivo de la reescritura. Pedia el identificador del proveedor en una
 * casilla de texto libre —"escribe el slug que publique el servicio de
 * integraciones"— y no pedia NADA mas. Para un proveedor que se conecta
 * pegando un token, el servicio contestaba `campos_incompletos` y no habia
 * ninguna casilla donde poner el token. O sea: el boton "Conectar" no podia
 * funcionar para ningun proveedor de los que se pueden conectar hoy.
 *
 * Ahora el catalogo del servicio ES la lista, y los campos que dibuja el
 * formulario salen de esa misma entrada. No hay nada escrito aqui sobre ningun
 * proveedor concreto: el catalogo dice como se conecta cada uno, y esta
 * pantalla lo pinta.
 *
 * LA SEPARACION QUE ESTA PANTALLA SOSTIENE (FR-032): el gestor de repositorios
 * NO es una integracion mas. Git se habla directo y la capa de integracion no
 * se interpone. Por eso `scm` aparece aqui con su propia clase y no dentro del
 * saco de "integraciones": confundirlos lleva a enrutar `git push` por un
 * proveedor externo, y ese dia el producto depende de un tercero para algo que
 * sabia hacer solo.
 *
 * EL FLUJO DE AUTORIZACION ABRE EL NAVEGADOR DEL SISTEMA, no el webview. La
 * razon esta en `lib/enlace.ts` y es de seguridad, no de comodidad: en una
 * pagina donde el operador va a escribir credenciales, quitarle la barra de
 * direcciones le quita la unica forma de comprobar el dominio.
 *
 * NINGUNA CREDENCIAL VUELVE POR AQUI. El valor se escribe una vez, en un campo
 * en modo contrasena, y viaja al servicio, que lo mete en la boveda. Lo que la
 * respuesta trae es la conexion y la huella de su credencial: no hay ninguna
 * ruta por la que el valor pueda volver, y hay pruebas de centinela que lo
 * miden endpoint por endpoint.
 */

const ICONO_DE_CLASE = {
  tracker: Ticket,
  scm: GitBranch,
  infra: Server,
  integracion: Plug,
} as const

const TONO_DEL_ESTADO: Record<EstadoDeLaConexion, TonoDeBadge> = {
  pendiente: 'advertencia',
  viva: 'exito',
  expirada: 'advertencia',
  revocada: 'neutral',
  fallida: 'error',
}

const CLASES: Array<{ valor: ClaseDeConexion; etiqueta: string; descripcion: string }> = [
  {
    valor: 'tracker',
    etiqueta: 'Gestor de tickets',
    descripcion:
      'De donde salen los work items. La descripcion de un ticket entra como DATO y nunca como instruccion ejecutable: lo que escriba un tercero en un ticket no manda sobre los agentes.',
  },
  {
    valor: 'scm',
    etiqueta: 'Gestor de repositorios',
    descripcion:
      'Donde se abren los pull requests. Git se habla directo; la capa de integracion no se interpone entre noxloop y tu repositorio.',
  },
  {
    valor: 'infra',
    etiqueta: 'Infraestructura',
    descripcion:
      'Accesos de infraestructura. Las capacidades de alto impacto llegan desactivadas por defecto y solo se elevan con politica explicita y auditada.',
  },
  {
    valor: 'integracion',
    etiqueta: 'Otra integracion',
    descripcion:
      'Cualquier otro servicio externo detras de la capa de integracion. Sustituir el proveedor no deberia tocar nada fuera de su adaptador.',
  },
]

/**
 * LOS DOS ALCANCES, Y POR QUE ESTA PANTALLA LOS SEPARA EN VEZ DE MEZCLARLOS.
 *
 * Una conexion del ESPACIO DE TRABAJO la comparten todos los proyectos: es la
 * cuenta de codigo del operador, que es una sola y alcanza muchos
 * repositorios. Una conexion DEL PROYECTO alcanza a uno, que es lo correcto
 * para un gestor de tickets —dos proyectos pueden vivir en dos Jira distintos—.
 *
 * Pintarlas en la misma lista confunde sobre QUE ALCANZA QUE, y eso tiene dos
 * consecuencias concretas: revocar la del espacio creyendo que se toca solo
 * este proyecto corta a todos los demas, y buscar aqui «la conexion de este
 * proyecto» encuentra una que no lo es. Son dos grupos con su titulo y su
 * insignia.
 */
const ALCANCES: Array<{
  valor: AlcanceDeConexion
  titulo: string
  descripcion: string
}> = [
  {
    valor: 'espacio_de_trabajo',
    titulo: 'Del espacio de trabajo',
    descripcion:
      'Las comparten TODOS los proyectos. Es donde vive la cuenta de codigo: se conecta una vez y cualquier proyecto elige de ahi su repositorio. Revocar una aqui corta a todos los proyectos a la vez, no solo a este.',
  },
  {
    valor: 'proyecto',
    titulo: 'De este proyecto',
    descripcion:
      'Solo las alcanza este proyecto. Es lo que corresponde a un gestor de tickets: dos proyectos pueden vivir en dos instalaciones distintas, y su credencial no tiene por que ser la misma.',
  },
]

/**
 * Lo que falta cuando el adaptador de los flujos delegados NO esta montado.
 *
 * LO QUE HABIA AQUI Y POR QUE CAMBIO. Habia tres frases que terminaban en
 * «Ninguna de las tres se puede hacer desde esta pantalla, y por eso no hay
 * aqui un boton que las prometa». Era honesto y era un callejon sin salida: el
 * operador leia lo que le faltaba y seguia igual de lejos.
 *
 * Ahora son DOS, no tres, y las dos son comandos que se copian. La tercera
 * —registrar la aplicacion OAuth— dejo de estar en esta lista porque, con el
 * adaptador montado, tiene su propio recorrido dentro del producto.
 */
const LO_QUE_FALTA_PARA_OAUTH = [
  {
    titulo: 'Levanta el servidor de integraciones',
    detalle:
      'Son tres contenedores —servidor, base de datos y cache— y un archivo de entorno. El puerto 3003 tiene que estar libre: es la direccion de retorno que queda registrada en cada proveedor y no se puede reasignar sobre la marcha.',
    copiar: 'cd packages/connections/nango && cp .env.ejemplo .env && docker compose up -d',
  },
  {
    titulo: 'Arranca el servicio con su direccion y su clave',
    detalle:
      'La clave secreta sale del panel del servidor. Va por entorno y no por bandera: los argumentos quedan a la vista en la tabla de procesos de la maquina entera.',
    copiar: 'NOXLOOP_NANGO_SECRET_KEY=... npm run service',
  },
]

/* -------------------------------------------------------------------------- */
/* El formulario de un proveedor concreto                                     */
/* -------------------------------------------------------------------------- */

/**
 * Los campos que declara la entrada del catalogo, dibujados.
 *
 * POR QUE SE DIBUJAN DESDE EL CATALOGO Y NO ESTAN ESCRITOS AQUI. Porque quien
 * sabe que pide cada proveedor es el catalogo, y porque un formulario escrito
 * en la interfaz se queda viejo en silencio: el proveedor agrega un campo
 * obligatorio, el servicio lo exige, y la pantalla sigue mandando lo de antes
 * con un error que habla de un campo que no existe en ninguna casilla.
 *
 * `secreto` decide el tipo del campo, y no es cosmetico: pone el navegador en
 * modo contrasena —sin autocompletado, sin corrector, sin quedar en el
 * historial de formularios—. Lo que NO hace es sacar el valor del DOM mientras
 * se escribe; eso no existe. Por eso el unico momento legitimo de este campo es
 * el instante entre que se pega y se guarda.
 */
function CamposDelProveedor({
  campos,
  valores,
  alCambiar,
  deshabilitado,
}: {
  campos: CampoDeProveedor[]
  valores: Record<string, string>
  alCambiar: (nombre: string, valor: string) => void
  deshabilitado: boolean
}) {
  return (
    <>
      {campos.map((campo) => (
        <Campo
          key={campo.nombre}
          etiqueta={campo.etiqueta || campo.nombre}
          valor={valores[campo.nombre] ?? ''}
          alCambiar={(valor) => alCambiar(campo.nombre, valor)}
          requerido={campo.requerido !== false}
          secreto={campo.secreto}
          operativo={!campo.secreto}
          deshabilitado={deshabilitado}
          ayuda={
            campo.secreto
              ? `${campo.ayuda ?? 'Se guarda en el deposito de secretos del sistema.'} El valor no vuelve a salir de ahi: esta pantalla solo vera su huella.`
              : campo.ayuda
          }
          className="max-w-md"
        />
      ))}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* El panel                                                                   */
/* -------------------------------------------------------------------------- */

export interface PropsDePanelDeConexiones {
  /**
   * `null` es Settings general: las conexiones DEL ESPACIO DE TRABAJO, el
   * «portal de tools» de la spec 003. Con proyecto, las de ese proyecto y las
   * compartidas, como en la 002.
   */
  proyectoId: string | null
  conexiones: Conexion[]
  /** Lo que se puede conectar, tal como lo publica el servicio. */
  catalogo: EntradaDeCatalogoDeConexiones[]
  cargandoCatalogo: boolean
  errorDeCatalogo: ErrorDelServicio | null
  /** Que adaptador esta montado AQUI Y AHORA, o `null` si ninguno. */
  adaptadorMontado: string | null
  /**
   * TODOS los adaptadores montados.
   *
   * HACE FALTA DESDE QUE SON DOS. Comparar contra el principal apagaba las
   * filas del otro —las de token personal— diciendo «lo atiende un adaptador
   * que no esta montado» sobre uno que si lo estaba. El operador que levantaba
   * los contenedores para usar OAuth perdia de la pantalla los tres
   * proveedores que hasta entonces eran los unicos que funcionaban.
   */
  adaptadoresMontados: string[]
  /** Que aplicaciones OAuth estan registradas, y el recorrido de las que no. */
  aplicaciones: EstadoDeAplicacionesOauth | null
  /** Registrar la aplicacion OAuth de un proveedor. */
  alRegistrarAplicacion: (proveedor: string, datos: { client_id: string; client_secret: string }) => void
  /** Lo que esta pasando mientras se espera la autorizacion en el navegador. */
  esperandoAutorizacion: boolean
  /** Por que no hay adaptador y como conseguirlo, cuando no lo hay. */
  ausenciaDeConexiones: { porque: string; comoConseguirlo: string } | null
  cargando: boolean
  error: ErrorDelServicio | null
  errorDeMutacion: ErrorDelServicio | null
  trabajando: boolean
  /** Lo que devolvio el ultimo `authorize`, mientras el flujo sigue abierto. */
  autorizacion: AutorizacionDeConexion | null
  alAutorizar: (
    proveedor: string,
    valores: Record<string, string>,
    alcance: AlcanceDeConexion,
  ) => void
  alRevocar: (conexion: Conexion) => void
  /** El texto de busqueda del catalogo, que el contenedor traduce a `?q=`. */
  busqueda: string
  alBuscar: (texto: string) => void
  navegar: Navegar
}

export function PanelDeConexiones({
  proyectoId,
  conexiones,
  catalogo,
  cargandoCatalogo,
  errorDeCatalogo,
  adaptadorMontado,
  adaptadoresMontados,
  aplicaciones,
  alRegistrarAplicacion,
  esperandoAutorizacion,
  ausenciaDeConexiones,
  cargando,
  error,
  errorDeMutacion,
  trabajando,
  autorizacion,
  alAutorizar,
  alRevocar,
  busqueda,
  alBuscar,
  navegar,
}: PropsDePanelDeConexiones) {
  const [clase, setClase] = useState<ClaseDeConexion>('scm')
  // A QUE VA A PERTENECER LA CONEXION NUEVA, Y SE PREGUNTA EN VEZ DE DECIDIRLO
  // EN SILENCIO. Hasta ahora solo existia un alcance —el proyecto— y por eso no
  // habia nada que preguntar. Ahora hay dos y no son intercambiables: la cuenta
  // de codigo es una sola para todo el espacio de trabajo y un gestor de
  // tickets puede ser distinto en cada proyecto. `null` mientras el operador no
  // elige proveedor: el valor por defecto sale de la CLASE del que elija.
  const [alcance, setAlcance] = useState<AlcanceDeConexion | null>(null)
  const [slug, setSlug] = useState<string | null>(null)
  const [valores, setValores] = useState<Record<string, string>>({})
  const [porRevocar, setPorRevocar] = useState<Conexion | null>(null)
  const [errorDeEnlace, setErrorDeEnlace] = useState<ErrorDelServicio | null>(null)

  const deLaClase = useMemo(
    () => catalogo.filter((entrada) => entrada.clase === clase),
    [catalogo, clase],
  )

  // Cambiar de clase o de busqueda deja fuera al proveedor elegido: se suelta,
  // en vez de quedarse seleccionado uno que ya no se ve. Un formulario abierto
  // para algo invisible es como se manda un token al proveedor equivocado.
  useEffect(() => {
    if (slug && !deLaClase.some((entrada) => entrada.slug === slug)) {
      setSlug(null)
      setValores({})
    }
  }, [deLaClase, slug])

  const elegido = useMemo(
    () => (slug ? (catalogo.find((entrada) => entrada.slug === slug) ?? null) : null),
    [catalogo, slug],
  )

  /**
   * El alcance que se va a usar: el que el operador eligio, o el que le
   * corresponde por defecto a la clase del proveedor.
   *
   * EL DEFECTO NO ES UNA PREFERENCIA, ES LO QUE ES CADA COSA. La cuenta de
   * codigo de un operador es UNA y alcanza todos sus repositorios: conectarla
   * por proyecto obliga a reconectarla N veces y guarda N copias del mismo
   * token en la boveda. Un gestor de tickets no: dos proyectos pueden vivir en
   * dos instalaciones distintas, y compartir esa credencial daria a un proyecto
   * acceso a los tickets de otro.
   *
   * Se puede cambiar, porque hay casos legitimos en las dos direcciones —una
   * cuenta de codigo de servicio solo para un proyecto, un tracker compartido—
   * y decidirlo aqui sin dejarlo cambiar seria el mismo error de doblar al
   * operador para que encaje en lo que el codigo supuso.
   */
  const alcancePorDefecto: AlcanceDeConexion =
    elegido?.clase === 'scm' ? 'espacio_de_trabajo' : 'proyecto'
  // Sin proyecto no hay alcance que elegir: desde Settings general solo se
  // conecta lo que comparten todos. Un gestor de tickets de UN proyecto se
  // conecta desde las conexiones de ese proyecto.
  const alcanceElegido: AlcanceDeConexion = proyectoId
    ? (alcance ?? alcancePorDefecto)
    : 'espacio_de_trabajo'

  /**
   * Se puede conectar AQUI Y AHORA si el catalogo trae sus campos y el
   * adaptador que lo atenderia es el que esta montado. Las dos condiciones
   * hacen falta: una entrada sin campos no tiene formulario que dibujar, y una
   * que va por un adaptador que no esta montado falla al pulsar, con un 404
   * que dice "el adaptador no conoce ese proveedor" y que no explica nada.
   */
  /** ¿Ya esta registrada la aplicacion OAuth de este proveedor? */
  const aplicacionDe = (slug: string) => aplicaciones?.items.find((a) => a.slug === slug) ?? null

  /**
   * Su adaptador esta montado AQUI Y AHORA.
   *
   * SE COMPARA CONTRA LA LISTA Y NO CONTRA EL PRINCIPAL, y esa es la
   * diferencia que costaba tres proveedores: con el alojado y el local
   * montados a la vez, comparar contra el nombre del principal apagaba todas
   * las filas del otro.
   */
  const conAdaptador = (entrada: EntradaDeCatalogoDeConexiones) =>
    entrada.adaptador !== null && adaptadoresMontados.includes(entrada.adaptador)

  /**
   * Se puede conectar pulsando, aqui y ahora.
   *
   * LAS DOS RAMAS SON DISTINTAS Y ANTES NO LO ERAN. Un proveedor de token
   * personal necesita campos que rellenar; uno de OAuth no tiene NINGUNO —el
   * valor lo devuelve el proveedor al terminar la autorizacion— y exigirle
   * `campos.length > 0` lo dejaba fuera para siempre. Esa condicion era
   * correcta mientras oauth2 no tuviera adaptador; con adaptador, es lo que
   * impide conectar justo por el camino que el operador pidio.
   *
   * Lo que OAuth si necesita es su aplicacion registrada, y eso no apaga la
   * fila: abre el recorrido que la registra.
   */
  const conectableAhora = (entrada: EntradaDeCatalogoDeConexiones) => {
    if (!entrada.curado || !entrada.soportado || !conAdaptador(entrada)) return false
    if (entrada.modo === 'oauth2') return aplicacionDe(entrada.slug)?.registrada === true
    return Array.isArray(entrada.campos) && entrada.campos.length > 0
  }

  /** Falta registrar su aplicacion, y eso SI se puede hacer desde aqui. */
  const registrableAhora = (entrada: EntradaDeCatalogoDeConexiones) =>
    entrada.modo === 'oauth2' &&
    entrada.curado &&
    conAdaptador(entrada) &&
    aplicacionDe(entrada.slug)?.registrada === false

  /** Lo que SI se puede conectar en la clase elegida, para ofrecerlo como salida. */
  const alternativas = deLaClase.filter(conectableAhora)

  const campos = elegido?.campos ?? []
  const faltantes = campos
    .filter((campo) => campo.requerido !== false)
    .filter((campo) => (valores[campo.nombre] ?? '').trim().length === 0)

  const puedeConectar = Boolean(elegido) && conectableAhora(elegido!) && faltantes.length === 0

  const abrir = async (url: string) => {
    setErrorDeEnlace(null)
    try {
      await abrirExterno(url)
    } catch (fallo: unknown) {
      setErrorDeEnlace(comoErrorDelServicio(fallo, url))
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <Encabezado
        titulo={proyectoId ? 'Conexiones' : 'Herramientas y conexiones'}
        identificador={proyectoId ?? undefined}
        descripcion={
          proyectoId
            ? 'Con que habla este proyecto. Cada conexion queda registrada con su proveedor, su estado y la credencial que la habilita; el valor de esa credencial no pasa por esta interfaz.'
            : 'Los gestores de tickets, de repositorios y de infraestructura con los que trabaja noxloop, y su estado. Lo que se conecta aqui lo comparten todos los proyectos; el gestor de tickets de un proyecto concreto se conecta desde su Settings.'
        }
        volver={{ ruta: { seccion: 'proyectos', id: null }, etiqueta: 'Proyectos' }}
        navegar={navegar}
        acciones={
          <Button
            variant="secondary"
            onClick={() => navegar({ seccion: 'credenciales', id: null })}
          >
            Ver el inventario de credenciales
          </Button>
        }
      />

      {ausenciaDeConexiones ? (
        <Note tipo="advertencia" titulo="Este servicio no tiene ningun adaptador de conexiones montado">
          <div className="flex flex-col gap-2">
            <p>{ausenciaDeConexiones.porque}</p>
            <p>{ausenciaDeConexiones.comoConseguirlo}</p>
            <p className="text-label-12 text-ds-gray-700">
              Las conexiones que ya existen siguen en el inventario y se siguen viendo; las
              nuevas van a fallar hasta que haya adaptador.
            </p>
          </div>
        </Note>
      ) : null}

      {cargando ? <EsqueletoDeLista filas={2} /> : null}

      {!cargando && conexiones.length === 0 ? (
        <EmptyState
          modo={error ? 'error' : 'primero'}
          titulo={error ? 'No Se Pudieron Cargar Las Conexiones' : 'Sin Conexiones Todavia'}
          descripcion={
            error
              ? error.causa
              : 'Sin gestor de tickets no hay de donde sacar el work item, y sin gestor de repositorios no hay donde abrir el pull request. Un ciclo lanzado sin ninguna de las dos se bloquea y entra en la bandeja en vez de fallar a medias.'
          }
        />
      ) : null}

      {/* DOS GRUPOS Y NO UNA LISTA. Ver el comentario de `ALCANCES`: mezclar
          lo que comparten todos los proyectos con lo que es de este esconde
          justo el dato que hace falta antes de revocar nada. */}
      {ALCANCES.map((alcance) => {
        const delAlcance = conexiones.filter((c) => alcanceDe(c) === alcance.valor)
        if (delAlcance.length === 0) return null
        return (
          <div key={alcance.valor} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-heading-16 text-ds-gray-1000">{alcance.titulo}</h2>
              <p className="text-copy-13 text-ds-gray-900">{alcance.descripcion}</p>
            </div>
            <ListaDeEntidades etiqueta={`Conexiones ${alcance.titulo.toLowerCase()}`}>
              {delAlcance.map((conexion) => {
                const Icono = ICONO_DE_CLASE[conexion.clase] ?? Plug
                return (
                  <Entity
                    key={conexion.id}
                    contenedor="li"
                    miniatura={<Icono />}
                    titulo={conexion.proveedor}
                    identificador={conexion.id}
                    descripcion={
                      conexion.causa
                        ? conexion.causa
                        : `${ETIQUETA_CLASE_CONEXION[conexion.clase]}. ${
                            conexion.clase === 'scm'
                              ? 'Git se habla directo: la capa de integracion no se interpone entre noxloop y el repositorio.'
                              : 'Lo que devuelva este proveedor entra como dato, nunca como instruccion ejecutable.'
                          }`
                    }
                    metadatos={
                      <>
                        <Badge tono={TONO_DEL_ESTADO[conexion.estado]}>
                          {ETIQUETA_ESTADO_CONEXION[conexion.estado]}
                        </Badge>
                        <Badge tono={alcance.valor === 'espacio_de_trabajo' ? 'informativo' : 'neutral'}>
                          {alcance.titulo}
                        </Badge>
                        {conexion.credential_id ? (
                          <span className="fuente-operativa text-label-12 text-ds-gray-700">
                            {conexion.credential_id}
                          </span>
                        ) : (
                          <span className="text-label-12 text-ds-gray-700">
                            Sin credencial asociada
                          </span>
                        )}
                      </>
                    }
                    acciones={
                      conexion.estado !== 'revocada' ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setPorRevocar(conexion)}
                        >
                          Revocar
                        </Button>
                      ) : null
                    }
                  />
                )
              })}
            </ListaDeEntidades>
          </div>
        )
      })}

      {conexiones.length > 0 ? <FalloDeLectura error={error} /> : null}

      <Fieldset>
        <FieldsetContent
          titulo="Conectar un proveedor"
          descripcion="Elige el proveedor de la lista y rellena lo que pida. Como se conecta cada uno lo dice el catalogo del servicio, no esta pantalla: hay proveedores que se autorizan en el navegador y otros que solo piden un token personal."
        >
          <div className="flex flex-col gap-5">
            <Segmentado
              etiqueta="Clase de conexion"
              opciones={CLASES}
              valor={clase}
              alCambiar={setClase}
            />

            <Campo
              etiqueta="Buscar en el catalogo"
              valor={busqueda}
              alCambiar={alBuscar}
              operativo
              marcador="parte del nombre del proveedor"
              ayuda="El catalogo trae mas de mil proveedores. Sin buscar se enseñan los que este producto necesita para su ciclo; escribiendo se alcanza el resto."
              accion={
                cargandoCatalogo ? (
                  <Spinner tamano="sm" etiqueta="Buscando en el catalogo" />
                ) : (
                  <Search className="size-4 text-ds-gray-700" />
                )
              }
              className="max-w-md"
            />

            {errorDeCatalogo ? (
              <ErrorText causa={errorDeCatalogo.causa} accion={errorDeCatalogo.accion} />
            ) : null}

            {cargandoCatalogo && deLaClase.length === 0 ? <EsqueletoDeLista filas={3} /> : null}

            {!cargandoCatalogo && deLaClase.length === 0 ? (
              <EmptyState
                modo={busqueda ? 'filtrado' : 'primero'}
                tamano="compacto"
                titulo="Ningun Proveedor De Esta Clase"
                descripcion="El catalogo del servicio no publica ningun proveedor de esta clase con ese texto."
                consulta={busqueda || undefined}
              />
            ) : null}

            {deLaClase.length > 0 ? (
              <ListaDeEntidades etiqueta="Proveedores del catalogo">
                {deLaClase.map((entrada) => {
                  const listo = conectableAhora(entrada)
                  return (
                    <Entity
                      key={entrada.slug}
                      contenedor="li"
                      titulo={entrada.nombre}
                      identificador={entrada.slug}
                      descripcion={
                        listo
                          ? 'Se conecta aqui mismo: rellena lo que pide y queda lista.'
                          : (entrada.motivo ??
                            (entrada.adaptador && entrada.adaptador !== adaptadorMontado
                              ? 'Este proveedor lo atenderia un adaptador que no esta montado en este servicio.'
                              : 'Este servicio todavia no sabe pedirle sus datos: el catalogo no declara que campos hacen falta.'))
                      }
                      metadatos={
                        <>
                          <Badge tono={listo ? 'exito' : 'neutral'}>
                            {listo ? 'Conectable ahora' : 'No conectable aqui'}
                          </Badge>
                          {entrada.modo ? (
                            <span className="fuente-operativa text-label-12 text-ds-gray-700">
                              {entrada.modo}
                            </span>
                          ) : null}
                        </>
                      }
                      alPulsar={() => {
                        setSlug(entrada.slug === slug ? null : entrada.slug)
                        setValores({})
                      }}
                      seleccionada={slug === entrada.slug}
                    />
                  )
                })}
              </ListaDeEntidades>
            ) : null}

            {/* EL RECORRIDO QUE REGISTRA LA APLICACION. Va ANTES del aviso
                de «todavia no se puede conectar» porque, cuando aparece, ya
                no es verdad que no se pueda hacer nada: es lo que hay que
                hacer, y se hace aqui. */}
            {elegido && registrableAhora(elegido) ? (
              <RegistroDeAplicacionOauth
                recorrido={
                  aplicacionDe(elegido.slug)!.recorrido ?? {
                    slug: elegido.slug,
                    nombre: elegido.nombre,
                    url_de_registro: elegido.url_docs ?? '',
                    redirect_uri: aplicaciones?.redirect_uri ?? '',
                    campos_que_devuelve: ['client_id', 'client_secret'],
                    pasos: [],
                  }
                }
                compartidas={aplicaciones?.aplicaciones_compartidas ?? null}
                trabajando={trabajando}
                error={errorDeMutacion}
                alRegistrar={(datos) => alRegistrarAplicacion(elegido.slug, datos)}
              />
            ) : null}

            {elegido && !conectableAhora(elegido) && !registrableAhora(elegido) ? (
              <Note
                tipo="informativo"
                titulo={`Todavia no se puede conectar ${elegido.nombre} desde aqui`}
              >
                <div className="flex flex-col gap-3">
                  <p>
                    {elegido.motivo ??
                      `Este proveedor se conecta por ${elegido.modo ?? 'un modo'}, que lo atiende el adaptador ${
                        elegido.adaptador ?? 'que corresponda'
                      }. ${
                        adaptadoresMontados.length > 0
                          ? `Este servicio tiene montado ${adaptadoresMontados.join(' y ')}.`
                          : 'Este servicio no tiene ningun adaptador montado.'
                      }`}
                  </p>
                  {elegido.modo === 'oauth2' ? (
                    <>
                      <p className="text-label-13 text-ds-gray-1000">Que falta, en orden:</p>
                      <ol className="ml-4 flex list-decimal flex-col gap-3 text-copy-13 text-ds-gray-900">
                        {LO_QUE_FALTA_PARA_OAUTH.map((paso) => (
                          <li key={paso.titulo} className="flex flex-col gap-1">
                            <span className="text-label-13 text-ds-gray-1000">{paso.titulo}</span>
                            <span>{paso.detalle}</span>
                            <div className="flex flex-wrap items-center gap-2">
                              <code className="fuente-operativa rounded-md border border-ds-gray-400 bg-ds-gray-100 px-2 py-1 text-label-12 text-ds-gray-1000">
                                {paso.copiar}
                              </code>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => void navigator.clipboard?.writeText(paso.copiar)}
                              >
                                <Copy />
                                Copiar
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ol>
                      <p className="text-label-12 text-ds-gray-700">
                        Las dos se hacen en una terminal, una sola vez. El tercer paso —registrar
                        tu aplicacion OAuth con el proveedor— aparece aqui mismo en cuanto el
                        servidor este levantado, con la direccion de retorno ya calculada.
                      </p>
                    </>
                  ) : null}
                  {alternativas.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      <p>
                        Mientras tanto, lo mismo se consigue con un token personal, que no
                        necesita registrar ninguna aplicacion:
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {alternativas.map((alternativa) => (
                          <Button
                            key={alternativa.slug}
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setSlug(alternativa.slug)
                              setValores({})
                            }}
                          >
                            Conectar {alternativa.nombre}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {elegido.url_docs ? (
                    <div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void abrir(elegido.url_docs as string)}
                      >
                        <ExternalLink />
                        Ver la documentacion del proveedor
                      </Button>
                    </div>
                  ) : null}
                </div>
              </Note>
            ) : null}

            {elegido && conectableAhora(elegido) ? (
              <div className="flex flex-col gap-4">
                {/* A QUE VA A PERTENECER, ANTES DE PEDIR EL TOKEN. Se pregunta
                    aqui y no despues porque decide DONDE queda la credencial:
                    una del espacio de trabajo entra a la boveda con ambito
                    `global` y la comparten todos los proyectos. Cambiarlo
                    despues seria volver a pegar el valor. */}
                {proyectoId ? (
                  <Segmentado
                    etiqueta="A que pertenece esta conexion"
                    opciones={ALCANCES.map((a) => ({
                      valor: a.valor,
                      etiqueta: a.titulo,
                      descripcion: a.descripcion,
                    }))}
                    valor={alcanceElegido}
                    alCambiar={setAlcance}
                  />
                ) : null}

                <p className="text-label-13 text-ds-gray-1000">
                  Lo que {elegido.nombre} necesita
                </p>
                <CamposDelProveedor
                  campos={campos}
                  valores={valores}
                  alCambiar={(nombre, valor) =>
                    setValores((previos) => ({ ...previos, [nombre]: valor }))
                  }
                  deshabilitado={trabajando}
                />
              </div>
            ) : null}

            {autorizacion?.url_autorizacion ? (
              <Note tipo="informativo" titulo="El flujo de autorizacion esta abierto">
                <div className="flex flex-col gap-2">
                  <p className="flex items-center gap-2">
                    {esperandoAutorizacion ? <Spinner tamano="sm" etiqueta="Esperando" /> : null}
                    {esperandoAutorizacion
                      ? 'Se abrio tu navegador del sistema. Termina la autorizacion ahi: esta pantalla esta preguntando al servicio cada segundo y se entera sola cuando el proveedor conteste.'
                      : 'Termina la autorizacion en el navegador. Si la pestana no se abrio, abrela con el boton de abajo.'}
                  </p>
                  {/* POR QUE EL NAVEGADOR DEL SISTEMA Y NO ESTA VENTANA. Varios
                      proveedores bloquean los webviews embebidos por politica, y
                      ademas dentro del webview no hay barra de direcciones: al
                      operador se le pide que escriba sus credenciales en una
                      pagina cuyo dominio no puede comprobar. */}
                  <p className="fuente-operativa break-all text-label-12 text-ds-gray-900">
                    {autorizacion.url_autorizacion}
                  </p>
                  {autorizacion.expira ? (
                    <p className="text-label-12 text-ds-gray-700">
                      Caduca el{' '}
                      <span className="fuente-operativa">{autorizacion.expira}</span>. Si
                      caduca, vuelve a pulsar conectar: no se queda a medias.
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void abrir(autorizacion.url_autorizacion as string)}
                    >
                      <ExternalLink />
                      Abrir en el navegador
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        void navigator.clipboard?.writeText(
                          autorizacion.url_autorizacion as string,
                        )
                      }
                    >
                      <Copy />
                      Copiar la direccion
                    </Button>
                  </div>
                </div>
              </Note>
            ) : null}

            {autorizacion && !autorizacion.url_autorizacion && autorizacion.conexion ? (
              <Note tipo="exito" titulo="Conexion lista">
                Este proveedor no tiene nada que autorizar en un navegador: el valor quedo en
                el deposito de secretos y la conexion ya figura arriba. Su credencial esta en
                el inventario, con su huella.
              </Note>
            ) : null}

            {errorDeEnlace ? (
              <ErrorText causa={errorDeEnlace.causa} accion={errorDeEnlace.accion} />
            ) : null}
            {errorDeMutacion ? (
              <ErrorText causa={errorDeMutacion.causa} accion={errorDeMutacion.accion} />
            ) : null}
          </div>
        </FieldsetContent>

        <FieldsetFooter
          nota={
            !elegido
              ? 'Elige un proveedor de la lista. Nada se envia hasta entonces.'
              : faltantes.length > 0
                ? `Faltan datos obligatorios: ${faltantes.map((campo) => campo.etiqueta || campo.nombre).join(', ')}. Nada se envia hasta que esten.`
                : `Al conectar, la credencial entra al inventario con su huella y queda ${
                    alcanceElegido === 'espacio_de_trabajo'
                      ? 'al alcance de TODOS los proyectos de este espacio de trabajo'
                      : 'al alcance de este proyecto y de ninguno mas'
                  }. El valor va al deposito de secretos del sistema operativo y no vuelve por esta pantalla.`
          }
        >
          <Button
            onClick={() =>
              elegido ? alAutorizar(elegido.slug, valores, alcanceElegido) : undefined
            }
            disabled={trabajando || !puedeConectar}
          >
            {trabajando ? <Spinner tamano="sm" etiqueta="Conectando" /> : null}
            <Plug />
            Conectar
          </Button>
        </FieldsetFooter>
      </Fieldset>

      <ModalDeAccionDestructiva
        abierto={porRevocar !== null}
        alCerrar={() => setPorRevocar(null)}
        titulo="Revocar conexion"
        recurso={porRevocar?.proveedor ?? ''}
        claseDeRecurso="la conexion"
        consecuencias={
          <>
            {/* A QUIEN AFECTA, Y ESTO TENIA QUE DECIRSE. Revocar una conexion
                del espacio de trabajo corta a TODOS los proyectos, no solo a
                este. Con el texto anterior —«el proyecto deja de alcanzar»— el
                operador confirmaba creyendo que tocaba uno y dejaba sin cuenta
                de codigo a los veinte. */}
            {porRevocar && alcanceDe(porRevocar) === 'espacio_de_trabajo'
              ? `Esta conexion es del espacio de trabajo: TODOS los proyectos dejan de alcanzar ${porRevocar.proveedor} de inmediato, no solo este.`
              : `Este proyecto deja de alcanzar ${porRevocar?.proveedor ?? 'este proveedor'} de inmediato.`}{' '}
            Un run en marcha que dependa de esta conexion se bloquea en su proximo paso y
            entra en la bandeja con la causa escrita; no falla en silencio. La revocacion
            queda en el registro de auditoria, que no se puede editar ni borrar desde aqui.
          </>
        }
        etiquetaDeConfirmacion="Revocar conexion"
        trabajando={trabajando}
        alConfirmar={() => {
          if (porRevocar) alRevocar(porRevocar)
          setPorRevocar(null)
        }}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* El contenedor                                                              */
/* -------------------------------------------------------------------------- */

const EVENTOS_DE_CONEXIONES = ['conexion.estado', 'sincronizar_completo'] as const

export function VistaDeConexiones({
  proyectoId,
  navegar,
}: {
  /** `null` es el espacio de trabajo: ver `PropsDePanelDeConexiones`. */
  proyectoId: string | null
  navegar: Navegar
}) {
  const [busqueda, setBusqueda] = useState('')

  const lectura = useLectura<Conexion[]>(
    proyectoId ? `/v1/projects/${proyectoId}/connections` : '/v1/connections',
    {
    relerEn: EVENTOS_DE_CONEXIONES,
  })

  // El catalogo se pide al servicio con la busqueda dentro. Es la unica forma
  // de alcanzar los proveedores que la vista por defecto recorta: son mas de
  // mil, el servicio devuelve los del ciclo y avisa de que recorto, y `?q=`
  // levanta esa regla. Filtrar en el cliente solo encontraria lo que ya vino.
  const catalogo = useLectura<EntradaDeCatalogoDeConexiones[]>(
    `/v1/connections/catalog?limite=200${busqueda.trim() ? `&q=${encodeURIComponent(busqueda.trim())}` : ''}`,
  )

  const capacidades = useLectura<CapacidadesDelServicio>('/v1/capabilities')
  const mutacion = useMutacion()
  const [autorizacion, setAutorizacion] = useState<AutorizacionDeConexion | null>(null)
  // Abrir el navegador y sondear vive en `lib/autorizacion.ts`: el alta de
  // proyecto hace exactamente lo mismo, y con una copia en cada pantalla la
  // segunda se queda sin sondeo el dia que alguien toque la primera.
  const flujo = useAutorizacion(mutacion)

  const conexiones = capacidades.datos?.conexiones
  const adaptadorMontado = conexiones?.valor?.adaptador ?? null
  // LA LISTA, CON EL PRINCIPAL COMO RESPALDO. Un servicio anterior a este
  // cambio devuelve solo `adaptador`; tratar su ausencia como «ninguno»
  // apagaria la pantalla entera contra un servicio que funciona.
  const adaptadoresMontados =
    conexiones?.valor?.adaptadores ?? (adaptadorMontado ? [adaptadorMontado] : [])

  /**
   * Las aplicaciones OAuth registradas.
   *
   * SE PIDE SOLO SI HAY UN ADAPTADOR QUE LAS TENGA. Contra un servicio con
   * solo el adaptador de tokens personales, esta ruta contesta 503 con su
   * causa —correctamente: ese camino no es suyo— y pedirla igual pintaria un
   * error en una pantalla donde no hay nada roto.
   */
  const aplicaciones = useLectura<AplicacionOauth[]>(
    adaptadoresMontados.includes('nango') ? '/v1/connections/oauth-apps' : null,
    { relerEn: EVENTOS_DE_CONEXIONES },
  )

  /**
   * El sobre, rearmado.
   *
   * `useLectura` desenvuelve `items` y deja el resto en `sobre` — la direccion
   * de retorno y la constancia de que no hay aplicaciones compartidas viven
   * ahi. Se junta AQUI y no en el panel para que el panel reciba una sola
   * cosa con una sola forma.
   */
  const estadoDeAplicaciones: EstadoDeAplicacionesOauth | null = aplicaciones.datos
    ? ({
        items: aplicaciones.datos,
        ...(aplicaciones.sobre ?? {}),
      } as EstadoDeAplicacionesOauth)
    : null

  const registrarAplicacion = async (
    proveedor: string,
    datos: { client_id: string; client_secret: string },
  ) => {
    const hecho = await mutacion.enviar('POST', '/v1/connections/oauth-apps', {
      proveedor,
      ...datos,
    })
    // EL CUERPO DE LA RESPUESTA NO SE GUARDA EN NINGUN ESTADO. Lo unico que
    // hace falta saber es que quedo registrada, y eso se relee: el estado de
    // React se serializa en las herramientas del navegador, y ahi no tiene
    // nada que hacer nada que haya venido de un formulario con un secreto.
    if (hecho) aplicaciones.releer()
  }

  const autorizar = async (
    proveedor: string,
    valores: Record<string, string>,
    alcance: AlcanceDeConexion,
  ) => {
    // `clase` NO viaja, y ese campo de mas era una fuente de verdad duplicada:
    // la clase de una conexion sale del catalogo del adaptador —es lo que
    // decide en que columna de la guarda cae— y que la mandara la pantalla
    // invitaba a que algun dia ganara la de quien llama, que es la que no sabe.
    //
    // EL ALCANCE TAMPOCO VIAJA EN EL CUERPO, y por el mismo motivo: lo decide
    // POR QUE RUTA entra. Un campo `alcance` en el cuerpo seria un valor que
    // quien llama puede poner mal y que el servicio tendria que validar contra
    // la presencia del `:id`; con dos rutas, la peticion no puede contradecirse
    // a si misma.
    const respuesta = await mutacion.enviar<AutorizacionDeConexion>(
      'POST',
      alcance === 'espacio_de_trabajo' || !proyectoId
        ? '/v1/connections/authorize'
        : `/v1/projects/${proyectoId}/connections/authorize`,
      { proveedor, ...(Object.keys(valores).length > 0 ? { valores } : {}) },
    )
    if (!respuesta) return
    setAutorizacion(respuesta)
    lectura.releer()
    if (!respuesta.url_autorizacion) return

    const conectada = await flujo.completar(respuesta)
    if (conectada) setAutorizacion(null)
    lectura.releer()
  }

  const revocar = async (conexion: Conexion) => {
    await mutacion.enviar('DELETE', `/v1/connections/${conexion.id}`)
    lectura.releer()
  }

  return (
    <PanelDeConexiones
      proyectoId={proyectoId}
      conexiones={lectura.datos ?? []}
      catalogo={catalogo.datos ?? []}
      cargandoCatalogo={catalogo.datos === null && catalogo.error === null}
      errorDeCatalogo={catalogo.error}
      adaptadorMontado={adaptadorMontado}
      adaptadoresMontados={adaptadoresMontados}
      aplicaciones={estadoDeAplicaciones}
      alRegistrarAplicacion={(proveedor, datos) => void registrarAplicacion(proveedor, datos)}
      esperandoAutorizacion={flujo.esperando}
      ausenciaDeConexiones={
        // La ausencia se pinta SOLO cuando el servicio la declara. Antes se
        // deducia de un campo que el servicio no manda nunca —`conexiones.proveedor`
        // contra una respuesta que trae `conexiones.valor.adaptador`— y el
        // resultado medido era que el aviso "no hay proveedor de integraciones
        // declarado" salia SIEMPRE, tambien con el adaptador montado y
        // funcionando. Un aviso que siempre esta deja de leerse.
        capacidades.datos && !adaptadorMontado
          ? {
              porque: conexiones?.motivo ?? 'El servicio no declara ningun adaptador de conexiones.',
              comoConseguirlo:
                'Arranca el servicio con un adaptador de conexiones montado. Sin el, el catalogo se sigue pudiendo mirar, pero ninguna conexion nueva se puede crear.',
            }
          : null
      }
      cargando={lectura.datos === null && lectura.error === null}
      error={lectura.error}
      errorDeMutacion={mutacion.error}
      trabajando={mutacion.trabajando}
      autorizacion={autorizacion}
      alAutorizar={(proveedor, valores, alcance) =>
        void autorizar(proveedor, valores, alcance)
      }
      alRevocar={(conexion) => void revocar(conexion)}
      busqueda={busqueda}
      alBuscar={setBusqueda}
      navegar={navegar}
    />
  )
}
