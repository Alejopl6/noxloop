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
import { abrirExterno } from '@/lib/enlace'
import { comoErrorDelServicio, type ErrorDelServicio } from '@/lib/daemon'
import { useLectura } from '@/lib/lectura'
import { useMutacion } from '@/lib/mutacion'
import {
  ETIQUETA_CLASE_CONEXION,
  ETIQUETA_ESTADO_CONEXION,
  type AutorizacionDeConexion,
  type CampoDeProveedor,
  type CapacidadesDelServicio,
  type ClaseDeConexion,
  type Conexion,
  type EntradaDeCatalogoDeConexiones,
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

/** Lo que hay que hacer para que el adaptador de los flujos delegados exista. */
const LO_QUE_FALTA_PARA_OAUTH = [
  'Levantar el servidor de integraciones en esta maquina, con su base de datos y su cache.',
  'Registrar una aplicacion OAuth PROPIA con el proveedor y declarar su direccion de retorno. Con una aplicacion compartida los permisos son fijos, autorizas a un tercero y no a noxloop, y no hay forma de llevarse los tokens despues.',
  'Arrancar el servicio con ese adaptador montado en lugar del que guarda tokens personales.',
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
  proyectoId: string
  conexiones: Conexion[]
  /** Lo que se puede conectar, tal como lo publica el servicio. */
  catalogo: EntradaDeCatalogoDeConexiones[]
  cargandoCatalogo: boolean
  errorDeCatalogo: ErrorDelServicio | null
  /** Que adaptador esta montado AQUI Y AHORA, o `null` si ninguno. */
  adaptadorMontado: string | null
  /** Por que no hay adaptador y como conseguirlo, cuando no lo hay. */
  ausenciaDeConexiones: { porque: string; comoConseguirlo: string } | null
  cargando: boolean
  error: ErrorDelServicio | null
  errorDeMutacion: ErrorDelServicio | null
  trabajando: boolean
  /** Lo que devolvio el ultimo `authorize`, mientras el flujo sigue abierto. */
  autorizacion: AutorizacionDeConexion | null
  alAutorizar: (proveedor: string, valores: Record<string, string>) => void
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
   * Se puede conectar AQUI Y AHORA si el catalogo trae sus campos y el
   * adaptador que lo atenderia es el que esta montado. Las dos condiciones
   * hacen falta: una entrada sin campos no tiene formulario que dibujar, y una
   * que va por un adaptador que no esta montado falla al pulsar, con un 404
   * que dice "el adaptador no conoce ese proveedor" y que no explica nada.
   */
  const conectableAhora = (entrada: EntradaDeCatalogoDeConexiones) =>
    entrada.curado &&
    entrada.soportado &&
    entrada.adaptador !== null &&
    entrada.adaptador === adaptadorMontado &&
    Array.isArray(entrada.campos) &&
    entrada.campos.length > 0

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
        titulo="Conexiones"
        identificador={proyectoId}
        descripcion="Con que habla este proyecto. Cada conexion queda registrada con su proveedor, su estado y la credencial que la habilita; el valor de esa credencial no pasa por esta interfaz."
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

      {conexiones.length > 0 ? (
        <ListaDeEntidades etiqueta="Conexiones del proyecto">
          {conexiones.map((conexion) => {
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
      ) : null}

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

            {elegido && !conectableAhora(elegido) ? (
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
                        adaptadorMontado
                          ? `Este servicio tiene montado el adaptador ${adaptadorMontado}.`
                          : 'Este servicio no tiene ningun adaptador montado.'
                      }`}
                  </p>
                  {elegido.modo === 'oauth2' ? (
                    <>
                      <p className="text-label-13 text-ds-gray-1000">Que falta, en orden:</p>
                      <ol className="ml-4 flex list-decimal flex-col gap-1 text-copy-13 text-ds-gray-900">
                        {LO_QUE_FALTA_PARA_OAUTH.map((paso) => (
                          <li key={paso}>{paso}</li>
                        ))}
                      </ol>
                      <p className="text-label-12 text-ds-gray-700">
                        Ninguna de las tres se puede hacer desde esta pantalla, y por eso no hay
                        aqui un boton que las prometa.
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
                  <p>
                    Termina la autorizacion en el navegador. Esta pantalla se entera sola
                    cuando el proveedor conteste: no hace falta recargar.
                  </p>
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
                : 'Al conectar, la credencial entra al inventario con su huella. El valor va al deposito de secretos del sistema operativo y no vuelve por esta pantalla.'
          }
        >
          <Button
            onClick={() => (elegido ? alAutorizar(elegido.slug, valores) : undefined)}
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
            El proyecto deja de alcanzar {porRevocar?.proveedor ?? 'este proveedor'} de
            inmediato. Un run en marcha que dependa de esta conexion se bloquea en su
            proximo paso y entra en la bandeja con la causa escrita; no falla en
            silencio. La revocacion queda en el registro de auditoria, que no se puede
            editar ni borrar desde aqui.
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
  proyectoId: string
  navegar: Navegar
}) {
  const [busqueda, setBusqueda] = useState('')

  const lectura = useLectura<Conexion[]>(`/v1/projects/${proyectoId}/connections`, {
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

  const conexiones = capacidades.datos?.conexiones
  const adaptadorMontado = conexiones?.valor?.adaptador ?? null

  const autorizar = async (proveedor: string, valores: Record<string, string>) => {
    // `clase` NO viaja, y ese campo de mas era una fuente de verdad duplicada:
    // la clase de una conexion sale del catalogo del adaptador —es lo que
    // decide en que columna de la guarda cae— y que la mandara la pantalla
    // invitaba a que algun dia ganara la de quien llama, que es la que no sabe.
    const respuesta = await mutacion.enviar<AutorizacionDeConexion>(
      'POST',
      `/v1/projects/${proyectoId}/connections/authorize`,
      { proveedor, ...(Object.keys(valores).length > 0 ? { valores } : {}) },
    )
    if (respuesta) {
      setAutorizacion(respuesta)
      lectura.releer()
    }
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
      alAutorizar={(proveedor, valores) => void autorizar(proveedor, valores)}
      alRevocar={(conexion) => void revocar(conexion)}
      busqueda={busqueda}
      alBuscar={setBusqueda}
      navegar={navegar}
    />
  )
}
