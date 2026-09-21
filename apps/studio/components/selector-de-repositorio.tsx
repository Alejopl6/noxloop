'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GitBranch, Lock, Plug, Search, Unlock } from 'lucide-react'

import { Badge } from '@/components/ui/insignia'
import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { EmptyState } from '@/components/ui/estado-vacio'
import { Entity, ListaDeEntidades } from '@/components/ui/entidad'
import { ErrorText } from '@/components/ui/fieldset'
import { Note } from '@/components/ui/nota'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { EsqueletoDeLista } from '@/components/pantalla'
import { useServicio } from '@/components/proveedor-servicio'
import { comoErrorDelServicio, type ErrorDelServicio } from '@/lib/daemon'
import { formatearRelativo } from '@/lib/tiempo'
import {
  alcanceDe,
  ETIQUETA_ALCANCE_CONEXION,
  type CampoDeProveedor,
  type Conexion,
  type EntradaDeCatalogoDeConexiones,
  type RepositorioRemoto,
} from '@/lib/tipos'

/**
 * Elegir el repositorio de una lista.
 *
 * LO QUE ESTE COMPONENTE REEMPLAZA, Y POR QUE ERA UN AGUJERO. El alta de
 * proyecto con origen remoto pedia la direccion del repositorio en una casilla
 * de texto libre — teniendo el producto la credencial del operador guardada en
 * la boveda, con su grant. O sea: el sistema podia preguntarle a la forja cuales
 * son tus repositorios y no lo hacia; el operador abria el navegador, copiaba
 * una URL y la pegaba. Una letra de mas y el fallo aparecia despues, al clonar,
 * con un mensaje de git que no menciona ninguna pantalla.
 *
 * NO HABLA CON NINGUNA FORJA. Le pregunta al servicio por los repositorios que
 * alcanza UNA CONEXION, y el servicio se lo pregunta a la capa de conexiones,
 * que sabe por su catalogo como se le pregunta a cada proveedor. Son dos
 * consecuencias, las dos importantes:
 *
 *   1. El valor del token no pasa por aqui. Viaja en la cabecera de la llamada
 *      que hace el servicio, y lo que vuelve son fichas de repositorio. Esta
 *      pantalla no podria enseñar el token aunque quisiera: no lo recibe.
 *   2. El dia que entre el adaptador alojado —con OAuth de verdad— esta
 *      pantalla no cambia. Lo que cambia es quien guarda la credencial.
 *
 * POR QUE LA BUSQUEDA FILTRA EN EL CLIENTE. La lista ya vino entera —el
 * servicio manda hasta su limite y avisa si recorto— y una peticion por tecla
 * pulsada convierte escribir en una cola de peticiones contra la API de un
 * tercero con cuota. Si el aviso de recorte aparece, se dice y se ofrece
 * escribir mas para acotar del lado del servicio.
 */

/* -------------------------------------------------------------------------- */
/* Las cuentas de codigo del espacio de trabajo                               */
/* -------------------------------------------------------------------------- */

/**
 * Las conexiones de clase `scm` vivas del espacio de trabajo, y con que
 * conectar una si no hay ninguna.
 *
 * LO QUE HACIA ANTES, Y POR QUE NO PODIA FUNCIONAR. Recorria TODOS los
 * proyectos pidiendo las conexiones de cada uno, porque una conexion era de un
 * proyecto y no habia otra forma de saber que cuentas hay. El problema no era
 * el numero de viajes: en el alta de un proyecto NO HAY PROYECTO todavia, asi
 * que ese recorrido nunca podia encontrar la cuenta que el operador acabara de
 * conectar ahi mismo — no habia donde guardarla. La pantalla remataba en «Sin
 * cuenta de codigo conectada» con un boton a otra pantalla.
 *
 * AHORA ES UNA SOLA PETICION a `GET /v1/connections`, que es la ruta que la
 * cabecera anterior pedia con todas las letras. Y la cuenta de codigo se
 * conecta a nivel de espacio de trabajo: una cuenta, muchos repositorios,
 * todos los proyectos eligiendo de ahi.
 *
 * EL CATALOGO VIAJA CON LA LISTA, y no es un extra: quien ve «no hay ninguna
 * cuenta» necesita, EN EL MISMO SITIO, con que conectarla. Pedirlo en otra
 * ruta es lo que convierte un estado vacio en un boton que lleva a otro lado.
 */
export function useConexionesDeCodigo(): {
  conexiones: Conexion[]
  /** Los proveedores de codigo que el adaptador montado sabe conectar aqui y ahora. */
  catalogo: EntradaDeCatalogoDeConexiones[]
  cargando: boolean
  error: ErrorDelServicio | null
  releer: () => void
} {
  const { cliente, estado } = useServicio()
  const [conexiones, setConexiones] = useState<Conexion[]>([])
  const [catalogo, setCatalogo] = useState<EntradaDeCatalogoDeConexiones[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<ErrorDelServicio | null>(null)
  const [revision, setRevision] = useState(0)

  const releer = useCallback(() => setRevision((n) => n + 1), [])

  useEffect(() => {
    if (!cliente || estado !== 'conectado') return
    const abortador = new AbortController()
    let vigente = true

    setCargando(true)
    cliente
      .obtener<{ items: Conexion[]; catalogo?: EntradaDeCatalogoDeConexiones[] }>(
        '/v1/connections',
        { senal: abortador.signal },
      )
      .then((respuesta) => {
        if (!vigente) return
        setConexiones(
          (respuesta.items ?? []).filter((c) => c.clase === 'scm' && c.estado === 'viva'),
        )
        // El catalogo que llega por aqui es el del adaptador MONTADO, asi que
        // todo lo que trae se puede conectar en este servicio. Lo unico que se
        // descarta es lo que no tiene campos que pedir: sin campos no hay
        // formulario que dibujar, y un boton sin formulario es el mismo fallo
        // de antes con otro nombre.
        setCatalogo(
          (respuesta.catalogo ?? []).filter(
            (e) => e.clase === 'scm' && Array.isArray(e.campos) && e.campos.length > 0,
          ),
        )
        setError(null)
      })
      .catch((fallo: unknown) => {
        if (vigente) setError(comoErrorDelServicio(fallo, 'GET /v1/connections'))
      })
      .finally(() => {
        if (vigente) setCargando(false)
      })

    return () => {
      vigente = false
      abortador.abort()
    }
  }, [cliente, estado, revision])

  return { conexiones, catalogo, cargando, error, releer }
}

/* -------------------------------------------------------------------------- */
/* Los repositorios de una conexion                                           */
/* -------------------------------------------------------------------------- */

interface Aviso {
  codigo: string
  causa: string
  accion: string
}

function useRepositorios(conexionId: string | null): {
  repositorios: RepositorioRemoto[]
  avisos: Aviso[]
  cargando: boolean
  error: ErrorDelServicio | null
  /**
   * No se le pregunto a nadie: no hay servicio, o no hay conexion elegida.
   *
   * TRES ESTADOS Y NO DOS, Y ESTO SALIO DE LEER EL HTML GENERADO. Sin servicio,
   * este hook no pide nada —ni datos, ni error, ni peticion en vuelo— y la
   * pantalla pintaba «Esta conexion no alcanza ningun repositorio. La conexion
   * responde y la lista viene vacia». Las dos frases eran falsas: la conexion no
   * respondio nada porque nunca se le pregunto. El operador leeria que su token
   * no tiene permisos cuando lo que pasa es que el servicio no esta.
   *
   * Es el mismo fallo que `ExploradorDeCarpetas` ya tenia documentado unas
   * pantallas mas alla, y por el mismo motivo: «no hay datos» y «no se pidio»
   * se ven igual desde el estado.
   */
  sinPedir: boolean
} {
  const { cliente, estado } = useServicio()
  const [repositorios, setRepositorios] = useState<RepositorioRemoto[]>([])
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<ErrorDelServicio | null>(null)

  const sinPedir = !cliente || estado !== 'conectado' || !conexionId

  useEffect(() => {
    if (!cliente || estado !== 'conectado' || !conexionId) {
      setRepositorios([])
      setAvisos([])
      setError(null)
      return
    }
    const abortador = new AbortController()
    let vigente = true

    setCargando(true)
    cliente
      .obtener<{ items: RepositorioRemoto[]; avisos?: Aviso[] }>(
        `/v1/connections/${conexionId}/repos`,
        { senal: abortador.signal },
      )
      .then((respuesta) => {
        if (!vigente) return
        setRepositorios(respuesta.items ?? [])
        setAvisos(respuesta.avisos ?? [])
        setError(null)
      })
      .catch((fallo: unknown) => {
        if (!vigente) return
        // La lista NO se vacia al fallar por la misma regla que `useLectura`:
        // castigar al operador borrandole lo que ya tenia por un corte que no
        // provoco. Lo que no se puede es pintarlo como fresco, y para eso esta
        // el error al lado.
        setError(comoErrorDelServicio(fallo, `GET /v1/connections/${conexionId}/repos`))
      })
      .finally(() => {
        if (vigente) setCargando(false)
      })

    return () => {
      vigente = false
      abortador.abort()
    }
  }, [cliente, estado, conexionId])

  return { repositorios, avisos, cargando, error, sinPedir }
}

/** Texto comparable: sin mayusculas y sin acentos, igual que en el servicio. */
function normalizar(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/* -------------------------------------------------------------------------- */
/* Conectar la cuenta de codigo AQUI MISMO                                    */
/* -------------------------------------------------------------------------- */

/**
 * El formulario que conecta la cuenta de codigo sin salir del alta.
 *
 * ESTE COMPONENTE ES EL ARREGLO ENTERO. Lo que habia en su lugar era un boton:
 * «Ir a un proyecto y conectar». El operador lo dijo asi: "me dice ir a
 * conectar, me deberia aparecer conectar la cuenta de GitHub, y que me muestre
 * los repos, es decir ir integrado a Git desde aca". Tenia razon: el producto
 * lo mandaba a otro sitio a hacer algo que tiene que pasar aqui.
 *
 * NO HAY NINGUN NOMBRE PROPIO ESCRITO AQUI. Los proveedores salen del catalogo
 * del servicio y los campos de cada entrada del catalogo. Una casilla escrita
 * en esta pantalla se queda vieja en silencio: el proveedor agrega un campo
 * obligatorio, el servicio lo exige, y la pantalla sigue mandando lo de antes.
 *
 * EL VALOR NO VUELVE POR AQUI. Se escribe una vez en un campo en modo
 * contrasena y viaja al servicio, que lo mete en la boveda como credencial de
 * ambito `global` —la del espacio de trabajo— y devuelve la conexion, nunca el
 * valor. Hay pruebas de centinela que lo miden endpoint por endpoint.
 */
function ConectarCuentaDeCodigo({
  catalogo,
  alConectar,
  conectando,
  error,
}: {
  catalogo: EntradaDeCatalogoDeConexiones[]
  alConectar: (proveedor: string, valores: Record<string, string>) => void
  conectando: boolean
  error: ErrorDelServicio | null
}) {
  // Con un solo proveedor de codigo conectable —que es el caso normal— queda
  // elegido y el operador ve directamente donde pegar el token. Obligarlo a
  // pulsar antes es un clic que no decide nada.
  const [slug, setSlug] = useState<string | null>(catalogo.length === 1 ? catalogo[0].slug : null)
  const [valores, setValores] = useState<Record<string, string>>({})

  const elegido = useMemo(
    () => (slug ? (catalogo.find((e) => e.slug === slug) ?? null) : null),
    [catalogo, slug],
  )
  const campos: CampoDeProveedor[] = elegido?.campos ?? []
  const faltantes = campos
    .filter((campo) => campo.requerido !== false)
    .filter((campo) => (valores[campo.nombre] ?? '').trim().length === 0)

  if (catalogo.length === 0) {
    // No se finge un formulario que no se puede mandar. Este servicio no tiene
    // ningun proveedor de codigo que sepa conectar, y eso NO lo arregla el
    // operador desde ninguna pantalla: lo decide con que adaptador se arranco.
    return (
      <Note tipo="advertencia" titulo="Este servicio no sabe conectar ninguna cuenta de codigo">
        El catalogo del adaptador montado no declara ningun proveedor de clase `Gestor de
        repositorios` con campos que pedir. Mientras tanto se puede escribir la direccion del
        repositorio a mano en el campo de abajo; el clon necesitara despues una credencial con
        grant vigente.
      </Note>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {catalogo.length > 1 ? (
        <ListaDeEntidades etiqueta="Proveedores de codigo que se pueden conectar aqui">
          {catalogo.map((entrada) => (
            <Entity
              key={entrada.slug}
              contenedor="li"
              miniatura={<GitBranch />}
              titulo={entrada.nombre}
              identificador={entrada.slug}
              metadatos={
                entrada.modo ? (
                  <span className="fuente-operativa text-label-12 text-ds-gray-700">
                    {entrada.modo}
                  </span>
                ) : null
              }
              alPulsar={() => {
                setSlug(entrada.slug === slug ? null : entrada.slug)
                setValores({})
              }}
              seleccionada={slug === entrada.slug}
            />
          ))}
        </ListaDeEntidades>
      ) : null}

      {elegido ? (
        <div className="flex flex-col gap-4">
          <p className="text-label-13 text-ds-gray-1000">Lo que {elegido.nombre} necesita</p>
          {campos.map((campo) => (
            <Campo
              key={campo.nombre}
              etiqueta={campo.etiqueta || campo.nombre}
              valor={valores[campo.nombre] ?? ''}
              alCambiar={(valor) =>
                setValores((previos) => ({ ...previos, [campo.nombre]: valor }))
              }
              requerido={campo.requerido !== false}
              secreto={campo.secreto}
              operativo={!campo.secreto}
              deshabilitado={conectando}
              ayuda={
                campo.secreto
                  ? `${campo.ayuda ?? 'Se guarda en el deposito de secretos del sistema.'} El valor no vuelve a salir de ahi: esta pantalla solo vera su huella.`
                  : campo.ayuda
              }
              className="max-w-md"
            />
          ))}

          {error ? <ErrorText causa={error.causa} accion={error.accion} /> : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => alConectar(elegido.slug, valores)}
              disabled={conectando || faltantes.length > 0}
            >
              {conectando ? <Spinner tamano="sm" etiqueta="Conectando la cuenta" /> : <Plug />}
              Conectar cuenta
            </Button>
            <span className="text-label-12 text-ds-gray-700">
              {faltantes.length > 0
                ? `Falta ${faltantes.map((c) => c.etiqueta || c.nombre).join(', ')}. Nada se envia hasta que este.`
                : 'La cuenta queda conectada para todo el espacio de trabajo, y los repositorios aparecen aqui mismo.'}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* El selector                                                                */
/* -------------------------------------------------------------------------- */

export interface PropsDeSelectorDeRepositorio {
  /** Las conexiones de codigo entre las que elegir. */
  conexiones: Conexion[]
  cargandoConexiones: boolean
  errorDeConexiones: ErrorDelServicio | null
  /** Los proveedores de codigo conectables, para conectar sin salir de aqui. */
  catalogoDeCodigo: EntradaDeCatalogoDeConexiones[]
  alConectar: (proveedor: string, valores: Record<string, string>) => void
  conectando: boolean
  errorDeConectar: ErrorDelServicio | null
  /** El repositorio elegido, por su direccion de clonado. */
  elegido: RepositorioRemoto | null
  alElegir: (repositorio: RepositorioRemoto | null) => void
}

export function SelectorDeRepositorio({
  conexiones,
  cargandoConexiones,
  errorDeConexiones,
  catalogoDeCodigo,
  alConectar,
  conectando,
  errorDeConectar,
  elegido,
  alElegir,
}: PropsDeSelectorDeRepositorio) {
  const [conexionId, setConexionId] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  // Conectar OTRA cuenta con una ya conectada: el formulario se despliega aqui
  // mismo. Es la misma regla que en el estado vacio — nada que lleve a otra
  // pantalla— aplicada al caso de quien tiene dos cuentas.
  const [conectandoOtra, setConectandoOtra] = useState(false)

  // La primera conexion queda elegida sola, y solo la primera vez: con una
  // sola cuenta conectada —que es el caso normal— obligar a elegirla es un
  // clic que no decide nada. `useRef` y no una dependencia, para que cambiar
  // de conexion a mano no se deshaga en el siguiente repintado.
  const yaElegida = useRef(false)
  useEffect(() => {
    if (yaElegida.current || conexiones.length === 0) return
    yaElegida.current = true
    setConexionId(conexiones[0].id)
  }, [conexiones])

  const { repositorios, avisos, cargando, error, sinPedir } = useRepositorios(conexionId)

  const visibles = useMemo(() => {
    const buscado = normalizar(busqueda).trim()
    if (!buscado) return repositorios
    return repositorios.filter(
      (r) =>
        normalizar(r.nombre_completo).includes(buscado) ||
        normalizar(r.nombre).includes(buscado) ||
        normalizar(r.descripcion).includes(buscado),
    )
  }, [repositorios, busqueda])

  if (cargandoConexiones) return <EsqueletoDeLista filas={2} />

  if (conexiones.length === 0) {
    // AQUI ESTABA EL FALLO: un `EmptyState` cuya unica accion era un boton
    // «Ir a un proyecto y conectar», es decir, salir de esta pantalla para
    // poder volver a ella. Ahora el formulario de conectar ESTA aqui. No hay
    // ningun boton que lleve a otro sitio, a proposito: esa era la falla.
    return (
      <div className="flex flex-col gap-5">
        {errorDeConexiones ? (
          <EmptyState
            modo="error"
            tamano="compacto"
            titulo="No Se Pudieron Leer Las Cuentas De Codigo"
            descripcion={errorDeConexiones.causa}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <span className="text-label-13 text-ds-gray-1000">Conecta tu cuenta de codigo</span>
            <p className="text-copy-13 text-ds-gray-900">
              Se conecta una vez para todo el espacio de trabajo: pegas un token personal y a
              partir de ahi eliges el repositorio de una lista en vez de escribir su direccion.
              La credencial va al deposito de secretos del sistema y no vuelve a salir de ahi.
            </p>
          </div>
        )}

        <ConectarCuentaDeCodigo
          catalogo={catalogoDeCodigo}
          alConectar={alConectar}
          conectando={conectando}
          error={errorDeConectar}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* LA LISTA DE CUENTAS SE ENSEÑA SIEMPRE, TAMBIEN CON UNA SOLA, y antes
          se ocultaba cuando habia una. El razonamiento de entonces era que con
          una cuenta no hay nada que elegir, y es cierto — pero tampoco habia
          forma de ver CUAL esta conectada ni de conectar otra sin irse a otra
          pantalla, que es el fallo que se esta arreglando. Lo que no se pinta
          con una sola es la seleccion: queda elegida y basta. */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-label-13 text-ds-gray-1000">
            {conexiones.length > 1 ? 'Cuenta de codigo' : 'Cuenta de codigo conectada'}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setConectandoOtra((abierto) => !abierto)}
          >
            <Plug />
            {conectandoOtra ? 'Dejarlo asi' : 'Conectar otra cuenta'}
          </Button>
        </div>
        <ListaDeEntidades etiqueta="Conexiones de codigo disponibles">
            {conexiones.map((conexion) => (
              <Entity
                key={conexion.id}
                contenedor="li"
                miniatura={<GitBranch />}
                titulo={conexion.proveedor}
                identificador={conexion.id}
                descripcion={
                  alcanceDe(conexion) === 'espacio_de_trabajo'
                    ? 'Cuenta del espacio de trabajo: la comparten todos los proyectos.'
                    : 'Conectada dentro de un proyecto. La credencial es suya; se puede elegir su repositorio igual.'
                }
                metadatos={
                  <Badge tono={alcanceDe(conexion) === 'espacio_de_trabajo' ? 'informativo' : 'neutral'}>
                    {ETIQUETA_ALCANCE_CONEXION[alcanceDe(conexion)]}
                  </Badge>
                }
                alPulsar={
                  conexiones.length > 1
                    ? () => {
                        setConexionId(conexion.id)
                        alElegir(null)
                      }
                    : undefined
                }
                seleccionada={conexiones.length > 1 && conexionId === conexion.id}
              />
            ))}
        </ListaDeEntidades>
      </div>

      {conectandoOtra ? (
        <ConectarCuentaDeCodigo
          catalogo={catalogoDeCodigo}
          alConectar={alConectar}
          conectando={conectando}
          error={errorDeConectar}
        />
      ) : null}

      <Campo
        etiqueta="Buscar repositorio"
        valor={busqueda}
        alCambiar={setBusqueda}
        operativo
        marcador="parte del nombre o de la cuenta"
        ayuda="Busca por el nombre del repositorio y por la cuenta a la que pertenece: con el mismo nombre en dos cuentas, escribir la cuenta es lo unico que los distingue."
        accion={cargando ? <Spinner tamano="sm" etiqueta="Leyendo repositorios" /> : <Search className="size-4 text-ds-gray-700" />}
        className="max-w-md"
      />

      {avisos.map((aviso) => (
        <Note key={aviso.codigo} tipo="informativo" titulo="La lista se recorto">
          {aviso.causa} {aviso.accion}
        </Note>
      ))}

      {error ? <ErrorText causa={error.causa} accion={error.accion} /> : null}

      {cargando && repositorios.length === 0 ? <EsqueletoDeLista filas={3} /> : null}

      {/* SIN PEDIR NO SE AFIRMA NADA SOBRE LA CONEXION. Ver `sinPedir`: decir
          «la conexion responde y la lista viene vacia» cuando no se le
          pregunto manda a revisar el alcance de un token que esta bien. */}
      {sinPedir && !cargando ? (
        <EmptyState
          modo="primero"
          tamano="compacto"
          titulo="Todavia No Se Han Pedido Los Repositorios"
          descripcion="Esta lista la sirve el servicio de control, que es quien tiene la credencial: esta pantalla no habla con ninguna forja. Mientras no haya servicio no se le pregunta nada, y la direccion del repositorio se puede escribir a mano en el campo de abajo."
        />
      ) : null}

      {!sinPedir && !cargando && repositorios.length === 0 && !error ? (
        <EmptyState
          modo="primero"
          tamano="compacto"
          titulo="Esta Conexion No Alcanza Ningun Repositorio"
          descripcion="La conexion responde y la lista viene vacia. Suele ser el alcance del token: uno sin permiso de lectura de repositorios contesta bien y no ve ninguno."
        />
      ) : null}

      {repositorios.length > 0 && visibles.length === 0 ? (
        <EmptyState
          modo="filtrado"
          tamano="compacto"
          titulo="Ningun Repositorio Coincide"
          descripcion="Ninguno de los repositorios que alcanza esta conexion contiene ese texto en su nombre, su cuenta o su descripcion."
          consulta={busqueda}
        />
      ) : null}

      {visibles.length > 0 ? (
        <ListaDeEntidades etiqueta="Repositorios que alcanza esta conexion">
          {visibles.map((repo) => (
            <Entity
              key={String(repo.id ?? repo.nombre_completo)}
              contenedor="li"
              miniatura={repo.privado ? <Lock /> : <Unlock />}
              titulo={repo.nombre_completo ?? repo.nombre ?? 'sin nombre'}
              identificador={repo.url_clon ?? undefined}
              descripcion={repo.descripcion ?? undefined}
              metadatos={
                <>
                  <Badge tono={repo.privado ? 'neutral' : 'informativo'}>
                    {repo.privado ? 'Privado' : 'Publico'}
                  </Badge>
                  {repo.rama_por_defecto ? (
                    <span className="fuente-operativa text-label-12 text-ds-gray-700">
                      {repo.rama_por_defecto}
                    </span>
                  ) : null}
                  {repo.actualizado ? (
                    <span className="text-label-12 text-ds-gray-700">
                      Actualizado {formatearRelativo(Date.parse(repo.actualizado))}
                    </span>
                  ) : null}
                </>
              }
              alPulsar={() => alElegir(elegido?.url_clon === repo.url_clon ? null : repo)}
              seleccionada={elegido?.url_clon === repo.url_clon}
            />
          ))}
        </ListaDeEntidades>
      ) : null}
    </div>
  )
}
