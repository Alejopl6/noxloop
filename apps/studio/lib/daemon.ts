/**
 * T037 · El origen del servicio de control y el cliente que habla con el.
 *
 * Reglas que este modulo existe para sostener:
 *
 * 1. NADA de aqui toca `window` al importarse. En el prerender de `next build`
 *    no hay `window`, y `isTauri()` de `@tauri-apps/api/core` lo lee sin
 *    protegerse: llamarlo fuera de un `useEffect` revienta el build. Por eso
 *    `@tauri-apps/api` se carga con `import()` dinamico DENTRO de la funcion, y
 *    `resolverOrigen()` se niega a correr si no hay ventana.
 * 2. Todo error que sale de aqui tiene `causa` y `accion`. Sin excepcion, y
 *    tambien cuando el servicio no contesto nada (NFR-006). Un error sin accion
 *    es un callejon sin salida pintado en pantalla.
 * 3. El token de sesion no se persiste. Ver `establecerTokenDeSesion`.
 */

import type {
  AltaDeProyecto,
  Board,
  DiffDeTarea,
  EstadoDeRuntime,
  RespuestaDeDecisionDeMovida,
  RespuestaDeLanzamiento,
  ResultadoDelModoRapido,
  RunListado,
  Salud,
  TareaCreada,
  TareaNueva,
  Uso,
} from '@/lib/tipos'

export type ModoDeOrigen = 'escritorio' | 'web'

export interface OrigenServicio {
  modo: ModoDeOrigen
  /** Base sin barra final, p. ej. `http://127.0.0.1:54321`. */
  url: string
  /** `null` en web mientras el operador no lo haya pegado. */
  token: string | null
}

export interface ObjetoDelError {
  tipo: string
  id: string
}

interface DatosDelError {
  codigo: string
  causa: string
  accion: string
  objeto?: ObjetoDelError
  estadoHttp?: number
  recurso?: string
}

/**
 * La forma en que el resto de la aplicacion ve un fallo.
 *
 * Normaliza `{ error: { codigo, causa, accion } }` del contrato SIN perder la
 * accion, que es justo lo que una interfaz pierde cuando aplana los errores a
 * un string.
 */
export class ErrorDelServicio extends Error {
  readonly codigo: string
  readonly causa: string
  readonly accion: string
  readonly objeto?: ObjetoDelError
  readonly estadoHttp?: number
  readonly recurso?: string

  constructor(datos: DatosDelError) {
    super(datos.causa)
    this.name = 'ErrorDelServicio'
    this.codigo = datos.codigo
    this.causa = datos.causa
    this.accion = datos.accion
    this.objeto = datos.objeto
    this.estadoHttp = datos.estadoHttp
    this.recurso = datos.recurso
  }
}

export function esErrorDelServicio(valor: unknown): valor is ErrorDelServicio {
  return valor instanceof ErrorDelServicio
}

/**
 * Convierte cualquier cosa que pueda fallar en un `ErrorDelServicio`.
 * Existe para que ningun `catch` de la interfaz tenga que adivinar.
 */
export function comoErrorDelServicio(valor: unknown, recurso?: string): ErrorDelServicio {
  if (esErrorDelServicio(valor)) return valor
  const detalle = valor instanceof Error ? valor.message : String(valor)
  return new ErrorDelServicio({
    codigo: 'fallo_inesperado',
    causa: `Fallo una operacion contra el servicio de control${
      recurso ? ` (${recurso})` : ''
    }: ${detalle}`,
    accion:
      'Reintenta. Si se repite, revisa la salida del servicio en la consola desde la que arrancaste noxloop.',
    recurso,
  })
}

/* -------------------------------------------------------------------------- */
/* Token de sesion en web                                                     */
/* -------------------------------------------------------------------------- */

let tokenDeSesionEnMemoria: string | null = null

/**
 * Guarda el token que el operador pega en la app web.
 *
 * SOLO en memoria, a proposito. `localStorage` y `sessionStorage` son legibles
 * por cualquier script de la pagina y sobreviven al cierre: un token de sesion
 * ahi es un secreto en reposo sin boveda, justo lo que prohibe el principio IX
 * ("el secreto vive en la boveda y en el subproceso; en ningun otro sitio").
 * El coste es volver a pegarlo tras recargar. Es el coste correcto.
 *
 * En escritorio esto no se usa: el token lo entrega Tauri por `invoke`.
 */
export function establecerTokenDeSesion(token: string | null): void {
  tokenDeSesionEnMemoria = token && token.length > 0 ? token : null
}

export function tokenDeSesion(): string | null {
  return tokenDeSesionEnMemoria
}

/**
 * Toma el token de `?token=` si viene en la direccion, y LO BORRA DE LA URL.
 *
 * POR QUE EXISTE. En modo web el token no se persiste —ver arriba, y es la
 * decision correcta— pero no habia ninguna forma de introducirlo: la pantalla
 * que lo pide quedo como hueco declarado, asi que la app web solo sabia
 * ensenar "el servicio no esta corriendo" aunque estuviera corriendo. Esto es
 * el camino minimo que la hace utilizable, no la pantalla definitiva.
 *
 * POR QUE SE BORRA DE LA URL EN CUANTO SE LEE. Un token en la barra de
 * direcciones sobrevive en el historial, se copia al compartir el enlace y lo
 * ve cualquiera que mire la pantalla. `replaceState` lo quita sin anadir una
 * entrada al historial, asi que el "atras" del navegador tampoco lo recupera.
 * Vive en memoria desde ese instante, como el que se pega a mano.
 *
 * Lo que esto NO es: una forma de recordar la sesion. Al recargar hay que
 * volver a traerlo. Es el coste de no guardarlo en ningun sitio legible.
 */
export function tomarTokenDeLaDireccion(): boolean {
  if (typeof window === 'undefined') return false

  const direccion = new URL(window.location.href)
  const token = direccion.searchParams.get('token')
  if (!token) return false

  establecerTokenDeSesion(token)
  direccion.searchParams.delete('token')
  window.history.replaceState(null, '', `${direccion.pathname}${direccion.search}${direccion.hash}`)
  return true
}

/* -------------------------------------------------------------------------- */
/* Resolucion del origen                                                      */
/* -------------------------------------------------------------------------- */

function sinBarraFinal(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Escucha `daemon://ready` una vez, con tope de espera. */
async function esperarDaemonListo(esperaMaximaMs: number): Promise<boolean> {
  const { listen } = await import('@tauri-apps/api/event')
  return new Promise<boolean>((resolver) => {
    let cerrado = false
    let desuscribir: (() => void) | null = null

    const terminar = (listo: boolean) => {
      if (cerrado) return
      cerrado = true
      clearTimeout(temporizador)
      desuscribir?.()
      resolver(listo)
    }

    const temporizador = setTimeout(() => terminar(false), esperaMaximaMs)

    listen('daemon://ready', () => terminar(true)).then(
      (fn) => {
        // El evento puede haber llegado antes de que `listen` resolviera.
        if (cerrado) fn()
        else desuscribir = fn
      },
      () => terminar(false),
    )
  })
}

export interface OpcionesDeOrigen {
  /** Cuanto se espera al `daemon://ready` antes de rendirse. */
  esperaMaximaMs?: number
}

/**
 * Averigua donde vive el servicio.
 *
 * LLAMAR SOLO DESDE UN `useEffect` (o desde un manejador de evento). Fuera del
 * navegador lanza en vez de devolver un origen inventado.
 */
export async function resolverOrigen(opciones: OpcionesDeOrigen = {}): Promise<OrigenServicio> {
  const esperaMaximaMs = opciones.esperaMaximaMs ?? 10_000

  if (typeof window === 'undefined') {
    throw new ErrorDelServicio({
      codigo: 'sin_ventana',
      causa:
        'Se intento resolver el origen del servicio de control durante el prerender, donde no existe `window`.',
      accion:
        'Mueve la llamada dentro de un `useEffect`: el origen solo se conoce en el navegador.',
    })
  }

  const nucleo = await import('@tauri-apps/api/core')

  if (!nucleo.isTauri()) {
    // Web. El servicio se sirve desde el mismo origen salvo que se declare otro
    // en build. `process.env.NEXT_PUBLIC_*` lo sustituye Next literalmente, no
    // se lee en runtime: no hace falta protegerlo.
    const url = process.env.NEXT_PUBLIC_DAEMON_URL ?? window.location.origin
    return { modo: 'web', url: sinBarraFinal(url), token: tokenDeSesionEnMemoria }
  }

  // Escritorio. El shell de Tauri arranca el sidecar, le pasa un token de
  // sesion aleatorio y lo entrega por `invoke`.
  const pedirInfo = () => nucleo.invoke<[string, string]>('daemon_info')

  let info: [string, string]
  try {
    info = await pedirInfo()
  } catch {
    // Todavia no arranco: el comando existe pero no tiene que contestar. Se
    // espera al evento y se reintenta UNA vez. Si tampoco, se reporta con
    // causa y accion en vez de dejar la pantalla girando para siempre.
    const listo = await esperarDaemonListo(esperaMaximaMs)
    if (!listo) {
      throw new ErrorDelServicio({
        codigo: 'servicio_no_arranco',
        causa: `El servicio de control no anuncio estar listo en ${Math.round(
          esperaMaximaMs / 1000,
        )} segundos. noxloop arranca su propio servicio al abrirse, asi que esto significa que el proceso no llego a levantar.`,
        accion:
          'Cierra noxloop y vuelve a abrirlo. Si se repite, arranca el servicio a mano con `npm run service` y mira que imprime.',
      })
    }
    try {
      info = await pedirInfo()
    } catch (fallo) {
      throw comoErrorDelServicio(fallo, 'daemon_info')
    }
  }

  const [url, token] = info
  if (!url || !token) {
    throw new ErrorDelServicio({
      codigo: 'daemon_info_incompleto',
      causa:
        'El shell de escritorio devolvio la informacion del servicio sin url o sin token de sesion. Sin token, toda peticion se rechazaria con 401.',
      accion: 'Cierra noxloop y vuelve a abrirlo para que genere una sesion nueva.',
    })
  }

  return { modo: 'escritorio', url: sinBarraFinal(url), token }
}

/* -------------------------------------------------------------------------- */
/* Cliente HTTP                                                               */
/* -------------------------------------------------------------------------- */

interface CuerpoDeErrorDelContrato {
  error?: {
    codigo?: unknown
    causa?: unknown
    accion?: unknown
    objeto?: unknown
  }
}

function extraerObjeto(valor: unknown): ObjetoDelError | undefined {
  if (!valor || typeof valor !== 'object') return undefined
  const candidato = valor as Record<string, unknown>
  if (typeof candidato.tipo !== 'string' || typeof candidato.id !== 'string') return undefined
  return { tipo: candidato.tipo, id: candidato.id }
}

/**
 * Traduce una respuesta con fallo al error de la interfaz.
 *
 * Si el servicio mando el formato del contrato, se respeta LETRA POR LETRA: la
 * `causa` del servicio es texto completo y la `accion` nombra una pantalla
 * concreta; recortarlas aqui seria tirar la unica informacion util.
 *
 * Si no lo mando (un proxy, un 502, un servicio viejo), se fabrica uno que
 * cumple las mismas reglas de redaccion de Geist: que paso y que hacer, en ese
 * orden; "no se pudo" cuando el bloqueo es de estado del operador, "fallo"
 * cuando es del sistema; y siempre con el recurso nombrado — nunca "algo salio
 * mal".
 */
async function errorDesdeRespuesta(
  respuesta: Response,
  recurso: string,
): Promise<ErrorDelServicio> {
  let cuerpo: CuerpoDeErrorDelContrato | null = null
  try {
    cuerpo = (await respuesta.json()) as CuerpoDeErrorDelContrato
  } catch {
    cuerpo = null
  }

  const delContrato = cuerpo?.error
  if (
    delContrato &&
    typeof delContrato.codigo === 'string' &&
    typeof delContrato.causa === 'string' &&
    typeof delContrato.accion === 'string'
  ) {
    return new ErrorDelServicio({
      codigo: delContrato.codigo,
      causa: delContrato.causa,
      accion: delContrato.accion,
      objeto: extraerObjeto(delContrato.objeto),
      estadoHttp: respuesta.status,
      recurso,
    })
  }

  const estado = respuesta.status

  if (estado === 401 || estado === 403) {
    return new ErrorDelServicio({
      codigo: 'sesion_no_valida',
      causa: `El servicio de control rechazo la peticion a ${recurso}: el token de esta sesion no es valido o ya caduco.`,
      accion:
        'En escritorio, cierra noxloop y vuelve a abrirlo para generar una sesion nueva. En web, vuelve a pegar el token que imprimio el servicio al arrancar.',
      estadoHttp: estado,
      recurso,
    })
  }

  if (estado === 404) {
    return new ErrorDelServicio({
      codigo: 'recurso_inexistente',
      causa: `El servicio de control no conoce ${recurso}. O el recurso ya no existe, o este servicio habla una version distinta de la API.`,
      accion:
        'Vuelve a la vista de inicio y recarga los datos. Si persiste, comprueba en /v1/health que el servicio y la interfaz son de la misma version.',
      estadoHttp: estado,
      recurso,
    })
  }

  if (estado === 409 || estado === 412) {
    return new ErrorDelServicio({
      codigo: estado === 412 ? 'estado_obsoleto' : 'conflicto_de_estado',
      causa: `No se pudo completar la operacion sobre ${recurso}: el estado cambio por debajo desde que esta pantalla lo leyo.`,
      accion: 'Recarga los datos de esta pantalla y repite la operacion sobre el estado actual.',
      estadoHttp: estado,
      recurso,
    })
  }

  if (estado >= 500) {
    return new ErrorDelServicio({
      codigo: 'fallo_del_servicio',
      causa: `Fallo el servicio de control al atender ${recurso} (HTTP ${estado}).`,
      accion:
        'Reintenta. Si se repite, mira la salida del servicio: el error completo queda ahi, no en esta pantalla.',
      estadoHttp: estado,
      recurso,
    })
  }

  return new ErrorDelServicio({
    codigo: 'respuesta_no_interpretable',
    causa: `El servicio de control respondio a ${recurso} con HTTP ${estado} y un cuerpo que no sigue el formato de error del contrato.`,
    accion:
      'Comprueba que no hay un proxy entre la interfaz y el servicio, y que la URL apunta al servicio de noxloop.',
    estadoHttp: estado,
    recurso,
  })
}

function errorDeRed(recurso: string, origen: OrigenServicio, fallo: unknown): ErrorDelServicio {
  const detalle = fallo instanceof Error ? fallo.message : String(fallo)
  return new ErrorDelServicio({
    codigo: 'servicio_inalcanzable',
    causa: `No se pudo alcanzar el servicio de control en ${origen.url} al pedir ${recurso}. La peticion no llego a obtener respuesta (${detalle}).`,
    accion:
      origen.modo === 'escritorio'
        ? 'Cierra noxloop y vuelve a abrirlo: el servicio arranca con la aplicacion. Si se repite, arrancalo a mano con `npm run service` y mira que imprime.'
        : `Arranca el servicio con \`npm run service\` y comprueba que escucha en ${origen.url}.`,
    recurso,
  })
}

export interface OpcionesDePeticion {
  senal?: AbortSignal
  /** Tope de espera. 0 lo desactiva. */
  esperaMaximaMs?: number
}

export interface ClienteServicio {
  readonly origen: OrigenServicio
  obtener<T>(ruta: string, opciones?: OpcionesDePeticion): Promise<T>
  enviar<T>(
    metodo: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    ruta: string,
    cuerpo?: unknown,
    opciones?: OpcionesDePeticion,
  ): Promise<T>
  salud(opciones?: OpcionesDePeticion): Promise<Salud>
  /**
   * URL del canal de eventos, con el token en el query string.
   *
   * `EventSource` NO manda cabeceras — no es una limitacion nuestra, es la API:
   * no hay forma de anadirle un `Authorization`. El contrato lo contempla y el
   * servicio valida el token tambien por query. Queda registrado aqui para que
   * nadie "arregle" esto moviendolo a una cabecera y rompa el stream.
   */
  urlDeEventos(ultimoEventoId?: string | null): string

  /* --- Spec 003 · el board (`contracts/board-api.md` §2) ---------------- */

  /** `GET /v1/board`. Sin proyecto, el board general. */
  getBoard(filtro?: FiltroDelBoard, opciones?: OpcionesDePeticion): Promise<Board>
  /** `POST /v1/projects/:id/runs`. Idempotente: si ya hay run, devuelve ese. */
  lanzarRun(proyectoId: string, itemId: string): Promise<RespuestaDeLanzamiento>
  /** `POST /v1/runs/:itemId/approve`. Solo sobre un run con el plan listo. */
  aprobarRun(itemId: string): Promise<RespuestaDeLanzamiento>
  /** `POST /v1/runs/:itemId/retry`. Retoma desde el disco, sin perder lo integrado. */
  reintentarRun(itemId: string): Promise<RespuestaDeLanzamiento>
  /** `GET /v1/runs`, desenvuelto del sobre. */
  getRuns(filtro?: FiltroDeRuns, opciones?: OpcionesDePeticion): Promise<RunListado[]>
  /** `GET /v1/runs/:itemId/tasks/:taskId/diff`. Lo que cambio cada agente (US6). */
  getDiffDeTarea(itemId: string, taskId: string, opciones?: OpcionesDePeticion): Promise<DiffDeTarea>
  /** `GET /v1/usage`. */
  getUsage(periodo?: PeriodoDeUso, opciones?: OpcionesDePeticion): Promise<Uso>

  /** `POST /v1/projects/:id/tasks`. Una tarea propia, sin gestor externo (US7). */
  crearTarea(proyectoId: string, tarea: TareaNueva): Promise<TareaCreada>
  /** `PATCH /v1/tasks/:id`. Los mismos campos. */
  editarTarea(tareaId: string, cambios: Partial<TareaNueva>): Promise<TareaCreada>

  /* --- Spec 003 · US8 · el modo rapido ---------------------------------- */

  /**
   * `POST /v1/projects/:id/quickstart`. Lleva el proyecto a ACTIVE por sus
   * guardas sin preguntar nada mas. Sin tope de espera corto: escanea el repo.
   */
  activarRapido(proyectoId: string): Promise<ResultadoDelModoRapido>
  /** `POST /v1/projects` con `rapido: true`: alta y activacion en una peticion. */
  crearProyectoRapido(alta: Omit<AltaDeProyecto, 'rapido'>): Promise<ResultadoDelModoRapido>

  /* --- Modelos: los runtimes de agente ---------------------------------- */

  /** `GET /v1/runtimes`, desenvuelto del sobre. */
  getRuntimes(opciones?: OpcionesDePeticion): Promise<EstadoDeRuntime[]>
  /** `POST /v1/runtimes/:runtime/login`. El servicio abre el navegador del sistema. */
  iniciarSesionDeRuntime(runtime: string): Promise<{ iniciado: boolean }>
  /** `POST /v1/runtimes/:runtime/api-key`. El valor va al servicio y no vuelve. */
  guardarClaveDeRuntime(runtime: string, valor: string): Promise<EstadoDeRuntime>
  /** `DELETE /v1/runtimes/:runtime/api-key`. */
  quitarClaveDeRuntime(runtime: string): Promise<void>
}

export interface FiltroDelBoard {
  proyecto?: string | null
  incluirTerminados?: boolean
}

export interface FiltroDeRuns {
  proyecto?: string | null
  estado?: string | null
}

export interface PeriodoDeUso {
  /** ISO 8601. */
  desde?: string | null
  hasta?: string | null
}

/**
 * LAS RUTAS DEL BOARD, CONSTRUIDAS EN UN SOLO SITIO.
 *
 * Existen aparte de los metodos del cliente por una razon concreta: las
 * pantallas LEEN con `useLectura`, que necesita la ruta como texto para
 * releer cuando llega un evento del canal (`run.cambio`, `board.invalidado`),
 * y ESCRIBEN con `useMutacion`, que ya normaliza el error y apaga el boton
 * mientras el servicio decide. Si cada pantalla armara su `?project=` a mano,
 * la primera que se equivoque de nombre de parametro pide el board general
 * creyendo pedir el de un proyecto, y nadie lo ve porque el general tambien
 * trae esas tarjetas.
 *
 * Los metodos `getBoard`, `lanzarRun`… del cliente usan estas mismas rutas:
 * dos caminos, una sola forma de escribir la direccion.
 */
export const RUTAS = {
  board(filtro: FiltroDelBoard = {}): string {
    const parametros = new URLSearchParams()
    if (filtro.proyecto) parametros.set('project', filtro.proyecto)
    if (filtro.incluirTerminados) parametros.set('includeDone', '1')
    const consulta = parametros.toString()
    return consulta ? `/v1/board?${consulta}` : '/v1/board'
  },
  lanzar(proyectoId: string): string {
    return `/v1/projects/${encodeURIComponent(proyectoId)}/runs`
  },
  aprobar(itemId: string): string {
    return `/v1/runs/${encodeURIComponent(itemId)}/approve`
  },
  reintentar(itemId: string): string {
    return `/v1/runs/${encodeURIComponent(itemId)}/retry`
  },
  runs(filtro: FiltroDeRuns = {}): string {
    const parametros = new URLSearchParams()
    if (filtro.proyecto) parametros.set('project', filtro.proyecto)
    if (filtro.estado) parametros.set('estado', filtro.estado)
    const consulta = parametros.toString()
    return consulta ? `/v1/runs?${consulta}` : '/v1/runs'
  },
  run(itemId: string): string {
    return `/v1/runs/${encodeURIComponent(itemId)}`
  },
  diffDeTarea(itemId: string, taskId: string): string {
    return `/v1/runs/${encodeURIComponent(itemId)}/tasks/${encodeURIComponent(taskId)}/diff`
  },
  uso(periodo: PeriodoDeUso = {}): string {
    const parametros = new URLSearchParams()
    if (periodo.desde) parametros.set('desde', periodo.desde)
    if (periodo.hasta) parametros.set('hasta', periodo.hasta)
    const consulta = parametros.toString()
    return consulta ? `/v1/usage?${consulta}` : '/v1/usage'
  },
  tareas(proyectoId: string): string {
    return `/v1/projects/${encodeURIComponent(proyectoId)}/tasks`
  },
  tarea(tareaId: string): string {
    return `/v1/tasks/${encodeURIComponent(tareaId)}`
  },
  runtimes(): string {
    return '/v1/runtimes'
  },
  loginDeRuntime(runtime: string): string {
    return `/v1/runtimes/${encodeURIComponent(runtime)}/login`
  },
  claveDeRuntime(runtime: string): string {
    return `/v1/runtimes/${encodeURIComponent(runtime)}/api-key`
  },
  proyectos(): string {
    return '/v1/projects'
  },
  quickstart(proyectoId: string): string {
    return `/v1/projects/${encodeURIComponent(proyectoId)}/quickstart`
  },
} as const

/**
 * Cuanto se espera al modo rapido. Escanea el repositorio entero en un hilo del
 * servicio: con el tope general de 15 s, un repo grande daria «el servicio no
 * contesto» mientras el servicio sigue trabajando y termina bien.
 */
export const ESPERA_DEL_MODO_RAPIDO_MS = 10 * 60_000

/** Saca `items` de un sobre de coleccion, o deja pasar un array desnudo. */
function desenvolver<T>(cuerpo: unknown): T[] {
  if (Array.isArray(cuerpo)) return cuerpo as T[]
  if (cuerpo && typeof cuerpo === 'object' && Array.isArray((cuerpo as { items?: unknown }).items)) {
    return (cuerpo as { items: T[] }).items
  }
  return []
}

export function crearCliente(origen: OrigenServicio): ClienteServicio {
  async function pedir<T>(
    metodo: string,
    ruta: string,
    cuerpo: unknown,
    opciones: OpcionesDePeticion,
  ): Promise<T> {
    const recurso = `${metodo} ${ruta}`
    const cabeceras: Record<string, string> = { Accept: 'application/json' }
    if (origen.token) cabeceras.Authorization = `Bearer ${origen.token}`
    if (cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json'

    const esperaMaximaMs = opciones.esperaMaximaMs ?? 15_000
    const abortador = new AbortController()
    const temporizador =
      esperaMaximaMs > 0 ? setTimeout(() => abortador.abort(), esperaMaximaMs) : null
    if (opciones.senal) {
      if (opciones.senal.aborted) abortador.abort()
      else opciones.senal.addEventListener('abort', () => abortador.abort(), { once: true })
    }

    let respuesta: Response
    try {
      respuesta = await fetch(`${origen.url}${ruta}`, {
        method: metodo,
        headers: cabeceras,
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        signal: abortador.signal,
        // Sin cookies: la sesion es el token, no una cookie. Asi el CORS del
        // servicio no necesita `credentials` y no hay superficie CSRF.
        credentials: 'omit',
        cache: 'no-store',
      })
    } catch (fallo) {
      throw errorDeRed(recurso, origen, fallo)
    } finally {
      if (temporizador) clearTimeout(temporizador)
    }

    if (!respuesta.ok) throw await errorDesdeRespuesta(respuesta, recurso)

    if (respuesta.status === 204) return undefined as T
    const texto = await respuesta.text()
    if (texto.length === 0) return undefined as T

    try {
      return JSON.parse(texto) as T
    } catch {
      throw new ErrorDelServicio({
        codigo: 'respuesta_no_json',
        causa: `El servicio de control respondio a ${recurso} con algo que no es JSON. Probablemente la URL no apunta al servicio de noxloop.`,
        accion: `Comprueba que ${origen.url} es la direccion que el servicio imprimio al arrancar.`,
        recurso,
      })
    }
  }

  const obtener = <T,>(ruta: string, opciones: OpcionesDePeticion = {}) =>
    pedir<T>('GET', ruta, undefined, opciones)
  const enviar = <T,>(metodo: 'POST' | 'PUT' | 'PATCH' | 'DELETE', ruta: string, cuerpo?: unknown) =>
    pedir<T>(metodo, ruta, cuerpo, {})

  return {
    origen,
    getBoard: (filtro = {}, opciones = {}) => obtener<Board>(RUTAS.board(filtro), opciones),
    lanzarRun: (proyectoId, itemId) =>
      enviar<RespuestaDeLanzamiento>('POST', RUTAS.lanzar(proyectoId), { itemId }),
    aprobarRun: (itemId) => enviar<RespuestaDeLanzamiento>('POST', RUTAS.aprobar(itemId)),
    reintentarRun: (itemId) => enviar<RespuestaDeLanzamiento>('POST', RUTAS.reintentar(itemId)),
    getRuns: async (filtro = {}, opciones = {}) =>
      desenvolver<RunListado>(await obtener<unknown>(RUTAS.runs(filtro), opciones)),
    getDiffDeTarea: (itemId, taskId, opciones = {}) =>
      obtener<DiffDeTarea>(RUTAS.diffDeTarea(itemId, taskId), opciones),
    getUsage: (periodo = {}, opciones = {}) => obtener<Uso>(RUTAS.uso(periodo), opciones),
    crearTarea: (proyectoId, tarea) => enviar<TareaCreada>('POST', RUTAS.tareas(proyectoId), tarea),
    editarTarea: (tareaId, cambios) => enviar<TareaCreada>('PATCH', RUTAS.tarea(tareaId), cambios),
    activarRapido: (proyectoId) =>
      pedir<ResultadoDelModoRapido>('POST', RUTAS.quickstart(proyectoId), {}, {
        esperaMaximaMs: ESPERA_DEL_MODO_RAPIDO_MS,
      }),
    crearProyectoRapido: (alta) =>
      pedir<ResultadoDelModoRapido>('POST', RUTAS.proyectos(), { ...alta, rapido: true }, {
        esperaMaximaMs: ESPERA_DEL_MODO_RAPIDO_MS,
      }),
    getRuntimes: async (opciones = {}) =>
      desenvolver<EstadoDeRuntime>(await obtener<unknown>(RUTAS.runtimes(), opciones)),
    iniciarSesionDeRuntime: (runtime) =>
      enviar<{ iniciado: boolean }>('POST', RUTAS.loginDeRuntime(runtime)),
    guardarClaveDeRuntime: (runtime, valor) =>
      enviar<EstadoDeRuntime>('POST', RUTAS.claveDeRuntime(runtime), { valor }),
    quitarClaveDeRuntime: async (runtime) => {
      await enviar<unknown>('DELETE', RUTAS.claveDeRuntime(runtime))
    },
    obtener: <T,>(ruta: string, opciones: OpcionesDePeticion = {}) =>
      pedir<T>('GET', ruta, undefined, opciones),
    enviar: <T,>(
      metodo: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      ruta: string,
      cuerpo?: unknown,
      opciones: OpcionesDePeticion = {},
    ) => pedir<T>(metodo, ruta, cuerpo, opciones),
    salud: (opciones: OpcionesDePeticion = {}) =>
      pedir<Salud>('GET', '/v1/health', undefined, {
        // La salud responde o no responde. Esperar 15s a saber si el servicio
        // esta vivo es 15s de pantalla girando.
        esperaMaximaMs: 4_000,
        ...opciones,
      }),
    urlDeEventos(ultimoEventoId?: string | null) {
      const url = new URL(`${origen.url}/v1/events`)
      if (origen.token) url.searchParams.set('token', origen.token)
      if (ultimoEventoId) url.searchParams.set('last_event_id', ultimoEventoId)
      return url.toString()
    },
  }
}

/* -------------------------------------------------------------------------- */
/* Spec 004 · Diagnostico                                                     */
/* -------------------------------------------------------------------------- */

/**
 * La ruta del diagnostico, aparte de `RUTAS` y sin metodo en el cliente: la
 * pantalla la LEE con `useLectura` (necesita la ruta como texto) y «Volver a
 * comprobar» pide la misma con `fresh=1`, que salta la cache de 30 s del
 * servicio. Solo lectura: diagnosticar no escribe nada (FR-002).
 */
export const RUTAS_DE_DIAGNOSTICO = {
  diagnostico(filtro: { proyecto?: string | null; fresco?: boolean } = {}): string {
    const parametros = new URLSearchParams()
    if (filtro.proyecto) parametros.set('project', filtro.proyecto)
    if (filtro.fresco) parametros.set('fresh', '1')
    const consulta = parametros.toString()
    return consulta ? `/v1/diagnostics?${consulta}` : '/v1/diagnostics'
  },
}

/* -------------------------------------------------------------------------- */
/* Spec 004 · Run en vivo: el transcript de cada fase                         */
/* -------------------------------------------------------------------------- */

/** El evento del canal que avisa de que un transcript crecio. */
export const EVENTO_DE_TRANSCRIPT = 'run.transcript'

/**
 * La ruta del transcript de una tarea, aparte de `RUTAS` por lo mismo que el
 * diagnostico: la pantalla la LEE (con `cliente.obtener`) y la vuelve a pedir
 * con `desde` cuando llega `run.transcript`, para traer solo lo nuevo. Solo
 * lectura: el transcript lo escribe el motor, redactado.
 */
export const RUTAS_DEL_TRANSCRIPT = {
  transcript(
    itemId: string,
    taskId: string,
    filtro: { fase?: string | null; lente?: string | null; desde?: number | null; limite?: number | null } = {},
  ): string {
    const parametros = new URLSearchParams()
    if (filtro.fase) parametros.set('fase', filtro.fase)
    if (filtro.lente) parametros.set('lente', filtro.lente)
    if (filtro.desde != null && filtro.desde > 0) parametros.set('desde', String(filtro.desde))
    if (filtro.limite != null) parametros.set('limite', String(filtro.limite))
    const consulta = parametros.toString()
    const base = `/v1/runs/${encodeURIComponent(itemId)}/tasks/${encodeURIComponent(taskId)}/transcript`
    return consulta ? `${base}?${consulta}` : base
  },
}

/* -------------------------------------------------------------------------- */
/* Spec 005 · Orden a mano del board y cola global (FR-005..006)              */
/* -------------------------------------------------------------------------- */

/**
 * Las rutas del orden, la cola y los ajustes, aparte de `RUTAS` por lo mismo
 * que el diagnostico: se LEEN con `useLectura` (necesita la ruta como texto) y
 * se escriben con `cliente.enviar`/`useMutacion`. La interfaz pide; el
 * servicio guarda (principio VIII).
 */
export const RUTAS_DE_ORDEN_Y_COLA = {
  /** `PUT {columna, itemIds}`: la columna entera de ESE proyecto, de arriba abajo. */
  ordenDelBoard(proyectoId: string): string {
    return `/v1/projects/${encodeURIComponent(proyectoId)}/board/orden`
  },
  /** `GET` la cola; `PUT {orden: [itemId...]}` reordena lo que espera. */
  cola(): string {
    return '/v1/queue'
  },
  /** `GET` y `PATCH {runsSimultaneos}`. */
  ajustes(): string {
    return '/v1/settings'
  },
}

/** Los eventos que cambian la cola: cada run que arranca, termina o cambia de puesto. */
export const EVENTOS_DE_LA_COLA = ['run.cambio', 'board.invalidado', 'sincronizar_completo'] as const

/* -------------------------------------------------------------------------- */
/* Spec 005 · Linear completo: el gestor del proyecto (FR-001..004)            */
/* -------------------------------------------------------------------------- */

/**
 * Las rutas del gestor de un proyecto, aparte de `RUTAS` por lo mismo que el
 * diagnostico: la pestana «Gestor» LEE los estados con `useLectura` y GUARDA
 * con `useMutacion` por el PATCH de siempre, que valida contra el esquema del
 * proveedor. La interfaz no escribe nada por su cuenta (principio VIII).
 */
export const RUTAS_DEL_GESTOR = {
  /** `PATCH {opciones?, stateMap?}` (`CambioDelTracker` → `TrackerGuardado`). */
  tracker(proyectoId: string): string {
    return `/v1/projects/${encodeURIComponent(proyectoId)}/tracker`
  },
  /** `GET` → `EstadosDelTracker`: los estados reales del gestor y el mapa vigente. */
  estados(proyectoId: string): string {
    return `/v1/projects/${encodeURIComponent(proyectoId)}/tracker/estados`
  },
}

/**
 * Cuando releer la pestana: `board.invalidado` lo emite el PATCH del tracker
 * (y cualquier otra ventana que lo guarde), `sincronizar_completo` la
 * reconexion del canal.
 */
export const EVENTOS_DEL_GESTOR = ['board.invalidado', 'sincronizar_completo'] as const

/* -------------------------------------------------------------------------- */
/* Spec 005 · El hand-off: pasar una tarea a otro agente (FR-007)             */
/* -------------------------------------------------------------------------- */

/**
 * La ruta del hand-off, aparte de `RUTAS` por lo mismo que el diagnostico. Se
 * ESCRIBE con `useMutacion` (`POST` con `PedidoDeHandoff` → `RespuestaDeHandoff`):
 * la interfaz pide, el servicio valida y lanza el motor, y el motor escribe el
 * override en el estado del run (principio VIII).
 */
export const RUTAS_DEL_HANDOFF = {
  handoff(itemId: string, taskId: string): string {
    return `/v1/runs/${encodeURIComponent(itemId)}/tasks/${encodeURIComponent(taskId)}/handoff`
  },
  /** La flota del proyecto: de ahi sale el revisor que el selector excluye. */
  agentes(proyectoId: string): string {
    return `/v1/projects/${encodeURIComponent(proyectoId)}/agents`
  },
}

/** Cuando releer lo que el selector del hand-off muestra: el run cambio, o la sesion de un runtime. */
export const EVENTOS_DEL_HANDOFF = ['run.cambio', 'board.invalidado', 'sincronizar_completo'] as const

/* -------------------------------------------------------------------------- */
/* Spec 005 · «Seguir aqui» o «Soltarla» sobre una tarjeta movida (FR-004)     */
/* -------------------------------------------------------------------------- */

/**
 * La ruta de la decision sobre una movida, aparte de `RUTAS` por lo mismo que
 * el orden del board: la guarda el servicio en su almacen, y ni el gestor ni el
 * run en disco se enteran (principios VI y VIII).
 */
export const RUTAS_DE_MOVIDAS = {
  /** `POST {decision, destino?}` (`PedidoDeDecisionDeMovida` → `RespuestaDeDecisionDeMovida`). */
  decision(proyectoId: string, itemId: string): string {
    return `/v1/projects/${encodeURIComponent(proyectoId)}/board/movidas/${encodeURIComponent(itemId)}`
  },
}

/**
 * Que se le pide al servicio al pulsar «Seguir aqui» o «Soltarla». Va al
 * proyecto de la TARJETA (en «Todos» hay varios) con el id del TICKET —no el
 * `id` compuesto de la tarjeta—, y lleva el destino que el operador vio.
 */
export function pedidoDeDecision(
  tarjeta: { proyecto: { id: string }; ticket: { id: string }; movida?: { destino: string | null } | null },
  decision: 'seguir' | 'soltar',
): { ruta: string; cuerpo: { decision: 'seguir' | 'soltar'; destino: string | null } } {
  return {
    ruta: RUTAS_DE_MOVIDAS.decision(tarjeta.proyecto.id, tarjeta.ticket.id),
    cuerpo: { decision, destino: tarjeta.movida?.destino ?? null },
  }
}

/** Pide la decision al servicio. La interfaz no guarda nada: repinta al volver. */
export function decidirMovida(
  cliente: Pick<ClienteServicio, 'enviar'>,
  tarjeta: Parameters<typeof pedidoDeDecision>[0],
  decision: 'seguir' | 'soltar',
): Promise<RespuestaDeDecisionDeMovida> {
  const { ruta, cuerpo } = pedidoDeDecision(tarjeta, decision)
  return cliente.enviar<RespuestaDeDecisionDeMovida>('POST', ruta, cuerpo)
}
