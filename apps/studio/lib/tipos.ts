/**
 * Tipos del contrato `specs/002-control-plane/contracts/control-api.md`.
 *
 * Son la forma de lo que el servicio DEVUELVE, no de lo que la interfaz guarda:
 * esta aplicacion no tiene estado propio de proyecto (constitution, principio
 * VIII). Todo lo de aqui es material de lectura.
 */

/** `GET /v1/health`. Es lo primero que se pide y lo que decide si hay pantalla. */
export interface Salud {
  version: string
  esquema: string
  home: string
  escritorUnico: true
  arranque: string
}

/** `GET /v1/capabilities`. Que sabe hacer ESTE servicio, declarado, nunca supuesto. */
export interface Capacidades {
  runtimes?: string[]
  boveda?: { backend: string; degradado?: boolean }
  conexiones?: { proveedor: string }
  motor?: { presente: boolean }
}

/** `GET /v1/dashboard` (FR-060). Indicadores agregados de todos los proyectos. */
export interface Indicadores {
  tareas_completadas: number
  hus_completadas: number
  prs_esperando_decision: number
  fallos_criticos: number
  entradas_requieren_atencion: number
  proyectos_registrados: number
}

/** Los indicadores en cero. Es lo que se pinta antes del primer dato y lo que
 *  el sistema vale de verdad recien instalado: no es un placeholder. */
export const INDICADORES_EN_CERO: Indicadores = {
  tareas_completadas: 0,
  hus_completadas: 0,
  prs_esperando_decision: 0,
  fallos_criticos: 0,
  entradas_requieren_atencion: 0,
  proyectos_registrados: 0,
}

export type TipoEntradaBandeja =
  | 'pregunta_agente'
  | 'autorizacion_credencial'
  | 'permiso_tool'
  | 'gate_rojo'
  | 'conflicto_integracion'
  | 'hallazgo_revision'
  | 'decision_merge'
  | 'decision_despliegue'

export type EstadoEntradaBandeja =
  | 'esperando'
  | 'aprobada'
  | 'rechazada'
  | 'cambios_solicitados'
  | 'caducada'

/** `GET /v1/inbox`. */
export interface EntradaBandeja {
  id: string
  project_id: string | null
  tipo: TipoEntradaBandeja
  /**
   * Texto COMPLETO (FR-062). No un resumen, no una primera linea, no algo
   * generado a partir de la causa: la causa. Si esta pantalla la trunca, el
   * operador decide con menos informacion de la que el sistema tenia.
   */
  causa: string
  contexto?: Record<string, unknown>
  decisiones_posibles?: string[]
  estado: EstadoEntradaBandeja
  creada: string
  resuelta?: string | null
  resuelta_por?: string | null
}

/** Etiquetas de los tipos de entrada, en el idioma del producto. */
export const ETIQUETA_TIPO_ENTRADA: Record<TipoEntradaBandeja, string> = {
  pregunta_agente: 'Pregunta de un agente',
  autorizacion_credencial: 'Autorizacion de credencial',
  permiso_tool: 'Permiso de tool',
  gate_rojo: 'Gate en rojo',
  conflicto_integracion: 'Conflicto de integracion',
  hallazgo_revision: 'Hallazgo de revision',
  decision_merge: 'Decision de merge',
  decision_despliegue: 'Decision de despliegue',
}

/** Los tipos de evento del canal SSE unico, tal cual los nombra el contrato. */
export type TipoEvento =
  | 'scan.progreso'
  | 'scan.hallazgo'
  | 'scan.terminado'
  | 'scan.cancelado'
  | 'proyecto.estado'
  | 'recomendacion.aplicada'
  | 'conexion.estado'
  | 'credencial.por_expirar'
  | 'bandeja.entrada'
  | 'bandeja.resuelta'
  | 'run.estado'
  | 'servicio.parando'
  | 'sincronizar_completo'
  | 'run.cambio'
  | 'board.invalidado'

export const TIPOS_DE_EVENTO: readonly TipoEvento[] = [
  'scan.progreso',
  'scan.hallazgo',
  'scan.terminado',
  'scan.cancelado',
  'proyecto.estado',
  'recomendacion.aplicada',
  'conexion.estado',
  'credencial.por_expirar',
  'bandeja.entrada',
  'bandeja.resuelta',
  'run.estado',
  'servicio.parando',
  'sincronizar_completo',
  // Los dos de la spec 003 (`contracts/board-api.md` §2). Sin ellos en esta
  // lista el canal los recibe y nadie los escucha: `EventSource` solo entrega
  // los tipos por los que alguien se suscribio con nombre.
  'run.cambio',
  'board.invalidado',
] as const

export interface EventoServicio<D = unknown> {
  id: string | null
  tipo: TipoEvento | string
  project_id?: string | null
  datos: D
}

/* ==========================================================================
   Etapas 00-07. Todo lo de aqui es la forma de lo que el servicio DEVUELVE.
   --------------------------------------------------------------------------
   Estos tipos se escriben contra `contracts/control-api.md` y
   `data-model.md`, NO contra lo que el servicio responde hoy: hoy solo
   contesta `/v1/health`, `/v1/capabilities` y `/v1/events`. Construir contra
   el contrato es lo unico que permite que los dos frentes avancen a la vez
   sin que uno espere al otro, y lo unico que convierte una discrepancia en un
   fallo localizable: si el servicio manda otra cosa, la diferencia esta entre
   estos tipos y el contrato, no repartida por doce pantallas.

   Casi todo lo opcional lo es a proposito. Un campo que el contrato no
   promete y esta pantalla exige se convierte en una pantalla en blanco el dia
   que el servicio no lo manda.
   ========================================================================== */

/* --- Etapa 00 · Proyectos ------------------------------------------------ */

/** La maquina de estados de `data-model.md`. No retrocede nunca. */
export type EstadoProyecto =
  | 'CREATED'
  | 'DISCOVERED'
  | 'CONSTITUTED'
  | 'BOOTSTRAPPED'
  | 'CONNECTED'
  | 'ACTIVE'

export type OrigenProyecto = 'nuevo' | 'local' | 'remoto'

export interface Proyecto {
  id: string
  nombre: string
  slug?: string
  origen: OrigenProyecto
  ruta_local?: string | null
  remoto?: string | null
  estado: EstadoProyecto
  creado: string
  actualizado?: string | null
  /**
   * `L0`, `L1` o `L2`. Opcional porque la lista de proyectos no siempre la
   * trae; el detalle si. Decide que hace `Run` en el board: en L2 planifica y
   * ejecuta, en L0 y L1 planifica y para a esperar la aprobacion del plan.
   */
  autonomia?: string | null
  /** Lo que el contrato llama "contadores". Todo opcional: son agregados. */
  contadores?: {
    entradas_bandeja?: number
    agentes?: number
    conexiones?: number
    credenciales?: number
    runs_en_curso?: number
  }
}

export const ETIQUETA_ESTADO_PROYECTO: Record<EstadoProyecto, string> = {
  CREATED: 'Creado',
  DISCOVERED: 'Analizado',
  CONSTITUTED: 'Con constitution',
  BOOTSTRAPPED: 'Con setup resuelto',
  CONNECTED: 'Conectado',
  ACTIVE: 'Activo',
}

/**
 * Que etapa le falta a un proyecto para poder lanzar un ciclo (FR-064).
 *
 * Vive aqui y no en cada pantalla porque es la misma respuesta en tres sitios
 * —la lista, el detalle y el rechazo al lanzar— y tres copias de esta frase
 * divergen a la primera.
 */
export interface EtapaPendiente {
  /** La seccion a la que lleva el boton. */
  etapa: string
  /** Que falta, dicho entero. */
  causa: string
  /** Que hacer. Siempre. */
  accion: string
  /**
   * El artefacto que exige la guarda del almacen, con su nombre exacto.
   *
   * Opcional por compatibilidad con quien ya leia esta tabla, y presente en
   * todas las entradas: es la clave que permite cruzar esta frase escrita en
   * el cliente con el veredicto que el servicio devuelve en
   * `GET /v1/projects/:id`, y sin ella el cruce se haria por el nombre visible
   * de la etapa —"Bootstrap"— que es texto de pantalla y cambia.
   */
  artefacto?: NombreDeArtefacto
}

export const ETAPA_PENDIENTE: Record<EstadoProyecto, EtapaPendiente | null> = {
  CREATED: {
    etapa: 'Discovery',
    artefacto: 'snapshot_aceptado',
    causa: 'El proyecto esta en CREATED: todavia no tiene un snapshot aceptado, asi que no hay lectura tecnica de la que derivar su constitution.',
    accion: 'Corre el analisis del proyecto y acepta el snapshot, o declaralo proyecto nuevo si no hay codigo que escanear.',
  },
  DISCOVERED: {
    etapa: 'Constitution',
    artefacto: 'constitution_vigente',
    causa: 'El proyecto tiene snapshot aceptado pero no tiene constitution fijada: el runtime no tiene reglas que consultar cuando una decision sea ambigua.',
    accion: 'Revisa la constitution propuesta y fijala.',
  },
  CONSTITUTED: {
    etapa: 'Bootstrap',
    artefacto: 'bootstrap_resuelto',
    causa: 'La constitution esta fijada pero el bootstrap no se ha resuelto: hay recomendaciones sin decidir, y ninguna se escribe sin tu decision.',
    accion: 'Resuelve cada recomendacion (aplicar, personalizar u omitir) y cierra el bootstrap.',
  },
  BOOTSTRAPPED: {
    etapa: 'Conexiones',
    artefacto: 'conexion_viva',
    causa: 'El setup esta resuelto pero el proyecto no tiene ninguna conexion viva: sin tracker ni SCM, un ciclo no tiene de donde sacar el work item ni donde abrir el pull request.',
    accion: 'Conecta al menos un proveedor desde Conexiones.',
  },
  CONNECTED: {
    etapa: 'Flota',
    artefacto: 'flota_declarada',
    causa: 'El proyecto esta conectado pero no tiene flota declarada: no hay ningun agente con rol, runtime y presupuesto definidos.',
    accion: 'Declara al menos un implementador y un revisor con runtimes distintos.',
  },
  ACTIVE: null,
}

/* --- El recorrido del ciclo de vida -------------------------------------- */

/**
 * Las etapas EN ORDEN.
 *
 * Es `ESTADOS` de `packages/store/src/proyecto.mjs`, transcrita: alli el
 * indice es lo que distingue avanzar de retroceder, y aqui es lo que
 * distingue una etapa cerrada de una que todavia no ha pasado.
 *
 * NO se deriva de `Object.keys(ETIQUETA_ESTADO_PROYECTO)`. El orden de las
 * claves de un objeto es un detalle del motor que nadie promete, y este orden
 * es la columna vertebral del producto: si un dia se reordena la tabla de
 * etiquetas por comodidad, el indicador pinta el recorrido en otro orden y
 * sigue compilando.
 */
export const ETAPAS_DEL_PROYECTO: readonly EstadoProyecto[] = [
  'CREATED',
  'DISCOVERED',
  'CONSTITUTED',
  'BOOTSTRAPPED',
  'CONNECTED',
  'ACTIVE',
] as const

/**
 * Los artefactos que exigen las guardas, con el nombre EXACTO con el que el
 * almacen los devuelve (`GUARDAS` en `packages/store/src/proyecto.mjs`).
 */
export type NombreDeArtefacto =
  | 'snapshot_aceptado'
  | 'constitution_vigente'
  | 'bootstrap_resuelto'
  | 'conexion_viva'
  | 'flota_declarada'

/**
 * Lo que devuelve una guarda, y son TRES campos, no uno.
 *
 * `hallado` es el que no se puede perder por el camino. Una tabla escrita en
 * el cliente solo sabe decir "falta el snapshot"; la guarda sabe decir "el
 * snapshot esta completo pero tiene 12 hallazgos con decision pendiente", y
 * las dos frases mandan al operador a sitios distintos. `comoConseguirlo` es
 * la otra mitad: que hacer, que es lo que NFR-006 exige de todo "no".
 */
export interface VeredictoDeArtefacto {
  listo: boolean
  hallado: string
  comoConseguirlo: string
}

/**
 * `GET /v1/projects/:id` devuelve `{ proyecto, artefactos, snapshots }`, y
 * `artefactos` es el estado de CADA guarda, no solo el de la que bloquea.
 *
 * PARCIAL A PROPOSITO. El contrato (`control-api.md`) describe esta ruta como
 * "detalle completo" y no enumera las claves de `artefactos`: quien las
 * enumera es el almacen. Exigirlas todas aqui convierte un servicio con una
 * guarda mas —o una menos— en una pantalla en blanco.
 *
 * LA LISTA NO LAS TRAE. `GET /v1/projects` responde con la vista de inicio
 * (una sola consulta, NFR-002) y ahi no caben cinco guardas por proyecto. Por
 * eso el indicador de la fila funciona sin esto y solo lo aprovecha cuando
 * quien lo pinta tiene el detalle delante.
 */
export type ArtefactosDeProyecto = Partial<Record<NombreDeArtefacto, VeredictoDeArtefacto>>

/**
 * El recorrido REAL de un proyecto, que no siempre son seis pasos.
 *
 * EL ATAJO ESTA DECLARADO EN LA MAQUINA DE ESTADOS, no es una suposicion de
 * esta pantalla: `TRANSICIONES` tiene la arista
 * `CREATED -> CONSTITUTED` con `soloOrigen: "nuevo"`, porque en un proyecto
 * nuevo no hay codigo que escanear y `DISCOVERED` no tendria sobre que
 * decidir. Un indicador que pinta seis pasos siempre miente sobre la mitad de
 * los proyectos: ensena una etapa que ese proyecto no va a pisar nunca y deja
 * al operador esperando un snapshot que nadie va a correr.
 *
 * EL HUECO, declarado como hueco (principio X): la lista de proyectos dice
 * DONDE esta el proyecto, no POR DONDE paso. Un proyecto `nuevo` puede tomar
 * igualmente `CREATED -> DISCOVERED` —esa arista no lleva `soloOrigen`— y
 * desde `CONSTITUTED` ya no hay forma de saber cual de los dos caminos siguio.
 * Se pinta el atajo, que es el camino declarado para ese origen, salvo cuando
 * el proyecto esta PARADO en `DISCOVERED`: eso es prueba de que no lo tomo, y
 * esconder la etapa en la que el proyecto esta de pie seria el peor error
 * posible de los dos.
 */
export function recorridoDelProyecto(
  proyecto: Pick<Proyecto, 'estado' | 'origen'>,
): readonly EstadoProyecto[] {
  if (proyecto.origen !== 'nuevo') return ETAPAS_DEL_PROYECTO
  if (proyecto.estado === 'DISCOVERED') return ETAPAS_DEL_PROYECTO
  return ETAPAS_DEL_PROYECTO.filter((etapa) => etapa !== 'DISCOVERED')
}

/**
 * La etapa que falta segun el ESTADO y el ORIGEN.
 *
 * `ETAPA_PENDIENTE` sola se equivoca con los proyectos nuevos y el fallo es
 * concreto: a un proyecto `nuevo` en `CREATED` le dice "corre el analisis y
 * acepta el snapshot", y ese proyecto no tiene nada que analizar — la carpeta
 * esta vacia porque la creo el propio servicio. El operador corre un scan que
 * no puede encontrar nada, y el estado no se mueve.
 */
export function etapaPendienteDeclarada(
  proyecto: Pick<Proyecto, 'estado' | 'origen'>,
): EtapaPendiente | null {
  if (proyecto.estado === 'CREATED' && proyecto.origen === 'nuevo') {
    return {
      etapa: 'Constitution',
      artefacto: 'constitution_vigente',
      causa:
        'El proyecto es nuevo y esta en CREATED: no hay codigo que escanear, asi que no pasa por Discovery. Lo que le falta es la constitution, que es el unico artefacto que la guarda del atajo exige.',
      accion:
        'Redacta y fija la constitution del proyecto. Con ella, el proyecto salta de CREATED a CONSTITUTED sin snapshot.',
    }
  }
  return ETAPA_PENDIENTE[proyecto.estado]
}

/**
 * La etapa que falta, prefiriendo lo que el servicio HALLO a lo que esta
 * pantalla supone.
 *
 * Cuando llegan los `artefactos` del detalle, la frase que se lee es la de la
 * guarda, que fue a buscar. Cuando no llegan —la lista no los trae— se lee la
 * declarada, que es correcta pero generica.
 *
 * EL TERCER CASO ES EL QUE NADIE ESCRIBE Y SE VE FEO EN PANTALLA: la guarda
 * dice que el artefacto YA ESTA y el estado sigue sin moverse, porque el
 * estado solo cambia cuando alguien pide la transicion. Sin este caso, la
 * pantalla pone "fija la constitution" al lado de una constitution fijada, y
 * el operador la vuelve a fijar.
 */
export function etapaQueFalta(
  proyecto: Pick<Proyecto, 'estado' | 'origen'>,
  artefactos?: ArtefactosDeProyecto | null,
): EtapaPendiente | null {
  const declarada = etapaPendienteDeclarada(proyecto)
  if (!declarada) return null

  const veredicto = declarada.artefacto ? artefactos?.[declarada.artefacto] : undefined
  if (!veredicto) return declarada

  if (veredicto.listo) {
    return {
      ...declarada,
      causa: `La guarda ya da por bueno el artefacto de esta etapa: ${veredicto.hallado}. Lo que falta no es producirlo, es avanzar la etapa — el estado del proyecto solo cambia cuando alguien pide la transicion.`,
      accion: `Avanza el proyecto a la etapa siguiente desde ${declarada.etapa}. Retroceder no existe, asi que la transicion se pide una vez y no se deshace.`,
    }
  }

  return { ...declarada, causa: veredicto.hallado, accion: veredicto.comoConseguirlo }
}

/** `POST /v1/projects`. Lo que la pantalla de alta envia al servicio. */
export interface AltaDeProyecto {
  origen: OrigenProyecto
  nombre: string
  ruta_local?: string
  remoto?: string
  plantilla?: string
  /**
   * El nivel de autonomia con el que nace el proyecto.
   *
   * `POST /v1/projects` lo aceptaba desde el principio y NINGUNA pantalla lo
   * pedia, asi que todo proyecto nacia en L0 y los otros dos niveles no
   * existian para quien usa el producto. Un ajuste sin superficie no es un
   * valor por defecto: es una funcion escondida.
   */
  autonomia?: string
}

/**
 * `GET /v1/templates`.
 *
 * NO ESTA EN EL CONTRATO. El contrato declara que `POST /v1/projects` acepta
 * `plantilla`, pero no declara donde se enumeran las plantillas disponibles.
 * Esta interfaz la pide aqui y, si el servicio no la conoce, lo dice y deja
 * declarar el identificador a mano — que es lo honesto: una lista inventada
 * en el cliente seria la interfaz decidiendo producto.
 */
export interface Plantilla {
  id: string
  nombre: string
  descripcion: string
  stack?: string
  arquitectura?: string
  testing?: string
  etiquetas?: string[]
}

/* --- Etapa 01 · Snapshot ------------------------------------------------- */

export type CategoriaDeHallazgo =
  | 'stack'
  | 'arquitectura'
  | 'patrones'
  | 'testing'
  | 'ci'
  | 'dependencias'
  | 'guidelines'
  | 'agentes'
  | 'riesgos'

export const ETIQUETA_CATEGORIA: Record<CategoriaDeHallazgo, string> = {
  stack: 'Stack',
  arquitectura: 'Arquitectura',
  patrones: 'Patrones',
  testing: 'Testing',
  ci: 'CI/CD',
  dependencias: 'Dependencias',
  guidelines: 'Guidelines existentes',
  agentes: 'Configuracion de agentes',
  riesgos: 'Riesgos',
}

/** El orden en que se pintan los grupos. Riesgos al final: se lee despues. */
export const ORDEN_DE_CATEGORIAS: readonly CategoriaDeHallazgo[] = [
  'stack',
  'arquitectura',
  'patrones',
  'testing',
  'ci',
  'dependencias',
  'guidelines',
  'agentes',
  'riesgos',
] as const

/** `declarado` no sale del scanner: lo produce el operador al corregir. */
export type OrigenDeHallazgo = 'detectado' | 'inferido' | 'declarado'
export type ConfianzaDeHallazgo = 'alta' | 'media' | 'baja'
export type DecisionDeHallazgo = 'pendiente' | 'aceptado' | 'corregido' | 'descartado'

export interface EvidenciaDeHallazgo {
  ruta: string
  linea?: number
  /**
   * Fragmento del archivo. NUNCA el valor de un secreto: el contrato del
   * scanner prohibe copiarlo ni truncado ni ofuscado, y un hallazgo de
   * `riesgos` llega con ruta y linea y sin extracto.
   */
  extracto?: string
}

export interface Hallazgo {
  id: string
  snapshot_id?: string
  categoria: CategoriaDeHallazgo
  /** `runtime.node`, `testing.runner`, `ci.workflow`. Identificador operativo. */
  clave: string
  valor: unknown
  origen: OrigenDeHallazgo
  /** Obligatoria cuando `origen === 'detectado'` (FR-013). */
  evidencia?: EvidenciaDeHallazgo[]
  confianza: ConfianzaDeHallazgo
  decision: DecisionDeHallazgo
  valor_corregido?: unknown
}

export type EstadoDeSnapshot = 'en_curso' | 'completo' | 'cancelado'

export interface Snapshot {
  id: string
  project_id: string
  commit?: string | null
  creado: string
  estado: EstadoDeSnapshot
  duracion_ms?: number | null
  hallazgos: Hallazgo[]
}

export type FaseDeScan =
  | 'inventario'
  | 'manifiestos'
  | 'estructura'
  | 'testing'
  | 'ci'
  | 'agentes'
  | 'guidelines'
  | 'riesgos'

export const ETIQUETA_FASE: Record<FaseDeScan, string> = {
  inventario: 'Inventariando archivos',
  manifiestos: 'Leyendo manifiestos',
  estructura: 'Reconociendo la estructura',
  testing: 'Buscando como prueba',
  ci: 'Buscando que corre en CI',
  agentes: 'Buscando configuracion de agentes',
  guidelines: 'Buscando guidelines',
  riesgos: 'Buscando riesgos',
}

/** Datos del evento `scan.progreso`. */
export interface ProgresoDeScan {
  fase: FaseDeScan | string
  archivos_vistos: number
  total_estimado: number
}

/* --- Etapas 02-04 · Constitution y guidelines ---------------------------- */

/** Como en el snapshot, pero con `vacio`: el hueco declarado como hueco. */
export type OrigenDeApartado = 'detectado' | 'inferido' | 'vacio'

export interface ApartadoDeConstitution {
  id: string
  titulo: string
  /** Vacio de verdad cuando `origen === 'vacio'`. No se rellena con lo probable. */
  contenido: string
  origen: OrigenDeApartado
  evidencia?: EvidenciaDeHallazgo[]
  confianza?: ConfianzaDeHallazgo
}

export interface Enmienda {
  id: string
  version_anterior: string
  version_nueva: string
  principio: string
  fallo_que_motiva: string
  que_se_rompe_si_no: string
  fecha: string
}

export interface Constitution {
  id?: string
  project_id: string
  version: string
  ruta_en_repo: string
  /** Markdown completo. Es lo que se escribe en el repositorio. */
  contenido?: string
  apartados?: ApartadoDeConstitution[]
  ratificada?: string | null
  enmendada?: string | null
  vigente?: boolean
  enmiendas?: Enmienda[]
}

/** `POST /v1/projects/:id/constitution/amend`. Sin los tres campos, 400. */
export interface PeticionDeEnmienda {
  principio: string
  fallo_que_motiva: string
  que_se_rompe_si_no: string
}

export type AreaDeGuideline =
  | 'frontend'
  | 'backend'
  | 'testing'
  | 'git'
  | 'seguridad'
  | 'agentes'
  | 'diseno'

/**
 * LA LISTA DE AREAS YA NO VIVE AQUI. Estaba escrita en este archivo —las siete,
 * con sus etiquetas— copiada del `CHECK` de la tabla `guideline`. Mientras las
 * dos copias coincidieran no se notaba nada; el dia que el enum creciera, la
 * pantalla habria seguido ofreciendo siete y la octava no habria existido para
 * el operador, sin un solo error por ningun lado.
 *
 * Ahora sale de `GET /v1/options`, que las deriva de `ENUMS` del almacen y
 * ademas trae lo que significa cada una. Ver `lib/opciones.ts`.
 *
 * El TIPO se queda: describe la forma de un `Guideline` que llega del servicio,
 * y eso no es una lista de opciones que nadie mantiene — es lo que el contrato
 * dice que puede venir en ese campo.
 */

export interface Guideline {
  project_id?: string
  area: AreaDeGuideline
  ruta_en_repo?: string
  contenido: string
  reglas_aplicables?: string[]
}

/* --- Etapa 05 · Bootstrap ------------------------------------------------ */

export type TipoDeRecomendacion =
  | 'hook'
  | 'skill'
  | 'mcp'
  | 'tool'
  | 'subagente'
  | 'validacion'
  | 'ci'
  | 'instrucciones'
  | 'documentacion'

export const ETIQUETA_TIPO_RECOMENDACION: Record<TipoDeRecomendacion, string> = {
  hook: 'Hook',
  skill: 'Skill',
  mcp: 'Servidor MCP',
  tool: 'Tool',
  subagente: 'Subagente',
  validacion: 'Validacion',
  ci: 'CI',
  instrucciones: 'Instrucciones',
  documentacion: 'Documentacion',
}

export type DecisionDeRecomendacion = 'pendiente' | 'aplicada' | 'personalizada' | 'omitida'

/** Un archivo del diff, con su contenido exacto. */
export interface ArchivoDeRecomendacion {
  ruta: string
  estado: 'anadido' | 'modificado' | 'eliminado'
  /** El diff unificado de ESTE archivo. */
  diff?: string
  /** El contenido resultante, cuando el servicio lo manda estructurado. */
  contenido?: unknown
}

export interface Recomendacion {
  id: string
  project_id?: string
  tipo: TipoDeRecomendacion
  titulo: string
  justificacion: string
  /**
   * El diff EXACTO que se escribira (FR-026). `apply` no recalcula: si el
   * arbol cambio, falla con `diff_obsoleto`. Por eso esta pantalla no
   * reconstruye nada a partir de el, solo lo ensena.
   */
  diff: string
  /** Desglose por archivo, cuando el servicio lo manda. Alimenta el arbol. */
  archivos?: ArchivoDeRecomendacion[]
  /** Con valor, la recomendacion se propone MARCADA con el conflicto (FR-028). */
  conflicto_constitution?: string | null
  decision: DecisionDeRecomendacion
  motivo_decision?: string | null
  decidida?: string | null
}

/* --- Etapa 06 · Conexiones, credenciales y grants ------------------------ */

export type ClaseDeConexion = 'tracker' | 'scm' | 'infra' | 'integracion'

export const ETIQUETA_CLASE_CONEXION: Record<ClaseDeConexion, string> = {
  tracker: 'Gestor de tickets',
  scm: 'Gestor de repositorios',
  infra: 'Infraestructura',
  integracion: 'Integracion',
}

export type EstadoDeLaConexion = 'pendiente' | 'viva' | 'expirada' | 'revocada' | 'fallida'

export const ETIQUETA_ESTADO_CONEXION: Record<EstadoDeLaConexion, string> = {
  pendiente: 'Pendiente de autorizar',
  viva: 'Viva',
  expirada: 'Expirada',
  revocada: 'Revocada',
  fallida: 'Fallida',
}

/**
 * De quien es una conexion.
 *
 * `espacio_de_trabajo` es la cuenta que comparten TODOS los proyectos —la
 * cuenta de codigo del operador es una sola, con muchos repositorios— y
 * `proyecto` es la que solo alcanza a uno, como un gestor de tickets que puede
 * ser distinto por proyecto.
 *
 * EL CAMPO LO MANDA EL SERVICIO Y NO SE DEDUCE AQUI de que `project_id` sea
 * nulo. Deducirlo pondria en esta pantalla una regla del modelo de datos, y el
 * dia que cambie habria dos verdades. Viaja explicito por la misma razon por la
 * que viaja `clase`.
 */
export type AlcanceDeConexion = 'espacio_de_trabajo' | 'proyecto'

export const ETIQUETA_ALCANCE_CONEXION: Record<AlcanceDeConexion, string> = {
  espacio_de_trabajo: 'Del espacio de trabajo',
  proyecto: 'De este proyecto',
}

export interface Conexion {
  id: string
  /** `null` = del espacio de trabajo. Ver `alcance`, que es lo que hay que leer. */
  project_id: string | null
  workspace_id?: string | null
  alcance?: AlcanceDeConexion
  clase: ClaseDeConexion
  proveedor: string
  id_externo?: string | null
  estado: EstadoDeLaConexion
  credential_id?: string | null
  capacidades?: Record<string, unknown>
  /** Por que fallo, cuando `estado === 'fallida'`. Texto completo. */
  causa?: string | null
}

/** El alcance de una fila, con el valor por defecto para un servicio que todavia no lo mande. */
export function alcanceDe(conexion: Conexion): AlcanceDeConexion {
  return conexion.alcance ?? (conexion.project_id ? 'proyecto' : 'espacio_de_trabajo')
}

/** `POST /v1/projects/:id/connections/authorize`. */
/**
 * `POST /v1/projects/:id/connections/authorize`.
 *
 * LOS DOS MODOS VIENEN EN LA MISMA RESPUESTA Y SON EXCLUYENTES, y ese es el
 * dato que este tipo tenia mal. Solo declaraba `url_autorizacion`, que es la
 * forma del modo `oauth2`; en los modos que se conectan pegando un valor el
 * servicio NO manda ninguna URL —no la manda a `null`, es que no esta— y manda
 * la conexion ya lista. Con el tipo anterior, la pantalla esperaba una URL que
 * nunca llegaba y ensenaba "el flujo de autorizacion esta abierto" para un
 * token que ya estaba guardado.
 */
export interface AutorizacionDeConexion {
  session_token: string
  /** Solo en `oauth2`. Se abre en el navegador del sistema, no en el webview. */
  url_autorizacion?: string
  abrir_en?: string
  expira?: string | null
  /** Solo en los modos sin flujo de autorizacion: la conexion queda lista de inmediato. */
  conexion?: {
    id: string
    /** `null` cuando la conexion es del espacio de trabajo: no hay proyecto todavia. */
    project_id: string | null
    slug: string
    modo: string
    estado: string
    handle: string
  }
  /** Solo si esta conexion hizo avanzar de etapa al proyecto. */
  proyecto?: Proyecto
}

/**
 * Una capacidad tal como la DECLARA `/v1/capabilities`.
 *
 * POR QUE EXISTE ESTE SOBRE Y POR QUE NO SE PUEDE APLANAR. El servicio no
 * contesta el valor a secas: contesta el valor y de donde salio. `detectado`
 * trae la evidencia que lo respalda; `vacio` trae el motivo de que no haya
 * nada. Es el principio X aplicado al propio servicio, y la pantalla lo
 * necesita entero: sin el `motivo`, una capacidad ausente se dibuja como una
 * linea en gris y el operador no sabe si le falta configurar algo o si el
 * producto no lo hace.
 */
export interface CapacidadDeclarada<V> {
  valor: V | null
  origen: 'detectado' | 'vacio'
  motivo?: string
  evidencia?: string
}

/**
 * `GET /v1/capabilities`, con la forma que el servicio devuelve HOY.
 *
 * SE DECLARA APARTE DE `Capacidades` A PROPOSITO. `Capacidades` describe una
 * forma aplanada —`conexiones.proveedor`, `boveda.backend`— que el servicio no
 * manda: el efecto medido en la pantalla de conexiones era que
 * `capacidades.conexiones.proveedor` siempre era `undefined` y el aviso "no hay
 * proveedor de integraciones declarado" salia SIEMPRE, incluido con el
 * adaptador montado y funcionando. Tres pantallas leen la forma vieja y no son
 * de esta tarea; este tipo es el correcto y va ganando terreno por donde se
 * toca.
 */
export interface CapacidadesDelServicio {
  esquema?: number
  runtimes?: CapacidadDeclarada<string[]>
  boveda?: CapacidadDeclarada<{ tipo: string; motivo?: string }>
  conexiones?: CapacidadDeclarada<{
    /** El adaptador principal. Se conserva porque es lo que ya se leia. */
    adaptador: string
    /**
     * TODOS los montados, y hace falta desde que son dos.
     *
     * Con el alojado y el local a la vez, un solo nombre esconde la mitad de lo
     * que se puede conectar: esta pantalla compara `entrada.adaptador` contra
     * esto, y con un nombre solo apagaria las filas del otro diciendo que las
     * atiende un adaptador que no esta montado, sobre uno que si lo esta.
     */
    adaptadores?: string[]
  }>
  motor?: CapacidadDeclarada<{ presente: boolean; version: string | null }>
  almacen?: CapacidadDeclarada<{ version_esquema: number; workspace: string }>
}

/**
 * Una entrada del catalogo de `GET /v1/connections/catalog`.
 *
 * `adaptador` es el dato que decide QUE tiene que hacer el operador, y por eso
 * viaja: uno de ellos significa levantar contenedores y registrar una
 * aplicacion propia con el proveedor; el otro, pegar un token en una casilla.
 */
export interface EntradaDeCatalogoDeConexiones {
  slug: string
  nombre: string
  modo: ModoDeAutenticacion | null
  clase: ClaseDeConexion
  adaptador: string | null
  soportado: boolean
  /** Hay entrada propia: trae sus campos y se puede conectar hoy. */
  curado: boolean
  /** Por que no se atiende, cuando no se atiende. */
  motivo?: string | null
  campos?: CampoDeProveedor[] | null
  url_docs?: string | null
  categorias?: string[]
}

export type ModoDeAutenticacion = 'oauth2' | 'api_key' | 'basic' | 'pat' | 'app'

/** Lo que hay que pedirle al operador para conectar un proveedor sin OAuth. */
export interface CampoDeProveedor {
  nombre: string
  etiqueta: string
  /** Si va al deposito de secretos en vez de a la fila de la conexion. */
  secreto: boolean
  requerido?: boolean
  ayuda?: string
  alcance?: string
}

/**
 * Un repositorio que una conexion alcanza — `GET /v1/connections/:id/repos`.
 *
 * SON LOS NOMBRES DEL CONTRATO Y NO LOS DE NINGUNA FORJA. La capa de conexiones
 * traduce; si esta pantalla leyera `full_name` o `clone_url`, estaria escrita
 * contra una forja concreta y el segundo proveedor obligaria a tocarla.
 */
export interface RepositorioRemoto {
  id: string | number | null
  nombre: string | null
  nombre_completo: string | null
  descripcion: string | null
  privado: boolean | null
  rama_por_defecto: string | null
  url_clon: string | null
  url_ssh: string | null
  url_web: string | null
  actualizado: string | null
}

export type TipoDeCredencial = 'api_token' | 'tracker' | 'scm' | 'modelo' | 'ssh'
export type AmbitoDeCredencial = 'global' | 'proyecto'
export type EstadoDeCredencial = 'activa' | 'por_expirar' | 'expirada' | 'revocada'

export const ETIQUETA_ESTADO_CREDENCIAL: Record<EstadoDeCredencial, string> = {
  activa: 'Activa',
  por_expirar: 'Por expirar',
  expirada: 'Expirada',
  revocada: 'Revocada',
}

/**
 * El inventario. NO TIENE CAMPO PARA EL VALOR, y no es un olvido: el contrato
 * prohibe que ningun endpoint lo devuelva, asi que un campo `valor` aqui seria
 * una promesa que el servicio no puede cumplir y una invitacion a rellenarla.
 */
export interface Credencial {
  id: string
  nombre: string
  proveedor: string
  tipo: TipoDeCredencial
  ambito: AmbitoDeCredencial
  project_id?: string | null
  alcance_declarado: string
  /** Lo unico que la boveda entrega sobre el secreto. */
  huella: string
  /** `keychain_so` o `archivo_cifrado`. Se declara, nunca se supone. */
  backend?: string
  creada: string
  expira?: string | null
  aviso_dias_antes?: number | null
  estado: EstadoDeCredencial
}

export interface Grant {
  id: string
  project_id: string
  agent_id: string
  credential_id: string
  vigencia_desde?: string | null
  vigencia_hasta?: string | null
  concedido_por: string
  concedido_en: string
  revocado_en?: string | null
}

/**
 * `GET /v1/credentials/:id/reach` — la vista inversa (FR-045).
 *
 * Contesta "que agentes y proyectos alcanzan esta credencial HOY", no "que
 * filas de grant existen": un grant revocado o fuera de vigencia no alcanza
 * nada, y mostrarlo aqui seria la respuesta a otra pregunta.
 */
export interface AlcanceDeCredencial {
  credential_id: string
  agentes: Array<{
    agent_id: string
    nombre: string
    rol?: string
    runtime?: string
    project_id: string
    proyecto: string
    grant_id: string
    vigencia_hasta?: string | null
  }>
  proyectos: Array<{
    project_id: string
    nombre: string
    agentes: number
  }>
  /** Cuando el servicio lo calcula: cuando se evaluo esta respuesta. */
  calculado?: string
}

/* --- Etapa 07 · Flota ---------------------------------------------------- */

export type RolDeAgente = 'implementador' | 'revisor' | 'planificador' | 'verificador'

export interface Agente {
  id: string
  project_id: string
  nombre: string
  rol: RolDeAgente
  runtime: string
  modelo?: string
  skills?: string[]
  tools?: string[]
  mcps?: string[]
  permisos?: Record<string, unknown>
  presupuesto?: Record<string, unknown>
  contexto?: Record<string, unknown>
}

/**
 * LOS CUATRO ROLES, SU ORDEN Y LO QUE DECIDE CADA UNO YA NO VIVEN AQUI.
 *
 * Estaban en este archivo como tres constantes: la lista, sus etiquetas y el
 * parrafo que explica que hace cada rol. El parrafo es la parte que hace obvio
 * por que tenia que mudarse: el rol decide contra que regla se valida la flota
 * (FR-034 solo mira `implementador` y `revisor`) y que contexto se le compila
 * al agente — o sea, es una decision del dominio, y quien la sostiene es el
 * servicio, que es ademas quien rechaza al guardar. Con el texto aqui, cambiar
 * la regla alla dejaba esta pantalla explicando la de ayer.
 *
 * Ahora salen de `GET /v1/options`, con los valores derivados de `ENUMS` y el
 * orden del ciclo declarado como producto. Ver `lib/opciones.ts`.
 */

/**
 * `GET /v1/grants?agent_id=:id` — la vista inversa de la inversa (FR-045).
 *
 * NO ESTA DECLARADA EN EL CONTRATO, y se declara aqui igual que se declaro el
 * hueco de `/v1/templates`. El contrato publica `GET /v1/grants` como "la
 * tripleta" y `GET /v1/credentials/:id/reach` como la vista inversa, que
 * contesta "quien alcanza esta credencial". La pantalla de flota necesita la
 * pregunta girada —"que alcanza este agente"— y esa no tiene endpoint propio
 * en el contrato.
 *
 * Se modela con la forma simetrica de `AlcanceDeCredencial` a proposito: es la
 * misma consulta con el criterio cambiado, y darle otra forma obligaria a
 * escribir dos lectores para una sola pregunta. Si el servicio publica otra,
 * la diferencia esta aqui y no repartida por la pantalla.
 *
 * Como en la vista inversa: son los grants VIGENTES HOY, no las filas de la
 * tabla. Un grant revocado no alcanza nada.
 */
export interface AlcanceDeAgente {
  agent_id: string
  credenciales: Array<{
    credential_id: string
    nombre: string
    proveedor?: string
    alcance_declarado?: string
    huella?: string
    estado?: EstadoDeCredencial
    grant_id: string
    project_id: string
    vigencia_hasta?: string | null
    concedido_por?: string
  }>
  /** Cuando el servicio lo calcula: cuando se evaluo esta respuesta. */
  calculado?: string
}

/* --- Handoff al motor · runs --------------------------------------------- */

/**
 * Los estados de una tarea dentro de un run, tal como los declara el motor.
 *
 * ESTA LISTA NO SE INVENTA NI SE ORDENA A OJO: es `STATUSES` de
 * `packages/engine/src/state.mjs`, en su orden, que es el orden de las aristas
 * permitidas. `blocked` va al final porque no es un paso del recorrido, es su
 * interrupcion.
 */
export type EstadoDeTarea =
  | 'pending'
  | 'in_progress'
  | 'red'
  | 'green'
  | 'gated'
  | 'reviewed'
  | 'queued'
  | 'integrated'
  | 'blocked'

export const ETIQUETA_ESTADO_TAREA: Record<EstadoDeTarea, string> = {
  pending: 'Sin empezar',
  in_progress: 'Worktree listo',
  red: 'Prueba en rojo',
  green: 'Prueba en verde',
  gated: 'Gate en verde',
  reviewed: 'Revisada',
  queued: 'En la cola de integracion',
  integrated: 'Integrada',
  blocked: 'Bloqueada',
}

export interface TareaDeRun {
  id: string
  title?: string
  status: EstadoDeTarea | string
  /** Cuantas vueltas lleva cada lazo. El motor lo escribe; aqui solo se lee. */
  attempts?: { red?: number; green?: number; gate?: number; review?: number }
  redVerified?: boolean
  branch?: string | null
  worktree?: string | null
  /** El ultimo fallo, con su texto completo. Nunca un resumen. */
  lastFailure?: string | null
  integratedAt?: string | null
}

/**
 * `GET /v1/projects/:id/runs` y `GET /v1/runs/:id`.
 *
 * ES LA PROYECCION DE UN ARCHIVO QUE ESCRIBE EL MOTOR (FR-002, principio VIII).
 * Por eso casi todo es opcional: un run de la v1 no trae `project_id`, y uno
 * recien creado no trae ni rama ni PR. Exigir aqui un campo que el archivo no
 * tiene convierte un run antiguo en una pantalla en blanco.
 */
export interface Run {
  item: {
    id: string
    title?: string
    url?: string | null
    branch?: string | null
    pr?: string | null
  }
  project_id?: string | null
  tasks?: TareaDeRun[]
  createdAt?: string | null
  updatedAt?: string | null
  milestoneId?: string | null
  spent?: { usd?: number; calls?: number }
  /**
   * El archivo existe y no se pudo leer. El motor lo marca asi en vez de
   * omitirlo: un run que desaparece de la lista se lee como un run que nunca
   * existio, y es justo al reves — existe y esta roto.
   */
  corrupto?: boolean
}

/* --- Auditoria ----------------------------------------------------------- */

export type ResultadoDeAuditoria = 'permitido' | 'denegado' | 'error'

export const ETIQUETA_RESULTADO_AUDITORIA: Record<ResultadoDeAuditoria, string> = {
  permitido: 'Permitido',
  denegado: 'Denegado',
  error: 'Error',
}

export interface EventoDeAuditoria {
  id: number | string
  instante: string
  actor: string
  /** `grant.concedido`, `credencial.rotada`, `ssh.comando`. */
  accion: string
  objeto_tipo?: string | null
  objeto_id?: string | null
  resultado: ResultadoDeAuditoria
  /** Ya redactado contra la boveda antes de escribirse (FR-050). */
  detalle?: Record<string, unknown> | null
  hash?: string | null
  hash_anterior?: string | null
}

export interface PaginaDeAuditoria {
  eventos: EventoDeAuditoria[]
  total?: number
  siguiente_cursor?: string | null
}

/* --- Lo que el servicio ya sabe y esta pantalla no tiene por que pedir ---- */

/**
 * De donde sale un valor, con el vocabulario del snapshot.
 *
 * ES EL MISMO QUE YA LEE EL OPERADOR en la pantalla de analisis y en la flota
 * sugerida, y por eso no se inventa uno nuevo: `detectado` trae la evidencia
 * que lo respalda, `por_defecto` sale de una regla del dominio y no de leer
 * nada, `vacio` es el hueco declarado con su motivo, y `declarado` es el
 * contrato mismo. Un segundo vocabulario para la misma idea es densidad que se
 * paga dos veces: al aprenderlo y al traducirlo.
 */
export type OrigenDeUnValor = 'declarado' | 'detectado' | 'por_defecto' | 'vacio'

export interface Procedencia {
  origen: OrigenDeUnValor
  porque: string
  evidencia?: Array<{ ruta: string; linea?: number }>
}

/** `GET /v1/folders`. Una subcarpeta de la que se esta mirando. */
export interface Carpeta {
  nombre: string
  ruta: string
  oculta: boolean
  enlace: boolean
  es_repositorio: boolean
  procedencia: Procedencia
  /** El proyecto que YA gestiona esta carpeta, si lo hay. */
  proyecto: { id: string; nombre: string } | null
}

/** `GET /v1/folders`, el sobre entero. Todo menos `items`, que `useLectura` desenvuelve. */
export interface ListadoDeCarpetas {
  ruta: string
  /** `null` en una raiz: no hay a donde subir, y el boton no se pinta. */
  padre: string | null
  es_raiz: boolean
  raiz: RaizDeExploracion
  raices: RaizDeExploracion[]
  es_repositorio: boolean
  procedencia: Procedencia
  proyecto: { id: string; nombre: string } | null
  archivos: number
  omitidas: { ocultas: number; enlaces_fuera: number; ilegibles: number }
  total: number
  hay_mas: boolean
  ocultas_incluidas: boolean
}

export interface RaizDeExploracion {
  ruta: string
  motivo: string
  proyecto?: { id: string; nombre: string }
}

/**
 * Una opcion del catalogo del servicio.
 *
 * `capacidades`, `modelos` y `nota` solo vienen en los runtimes. Se declaran
 * opcionales aqui en vez de partir el tipo en dos porque el componente que las
 * pinta es UNO: un `Seleccion` que tuviera que saber de que grupo viene su
 * opcion seria un `Seleccion` con un `switch` por grupo dentro.
 */
export interface Opcion {
  valor: string
  etiqueta: string
  descripcion?: string
  nota?: string
  capacidades?: Record<string, unknown>
  modelos?: string[]
  modelos_enumerados?: boolean
}

export interface GrupoDeOpciones {
  opciones: Opcion[]
  /** Lo calcula el servicio: un select con una sola opcion no es un select. */
  unica: boolean
  origen: OrigenDeUnValor
  porque?: string
  evidencia?: string
  como_conseguirlo?: string
  preseleccion: (Procedencia & { valor: string }) | null
}

/** `GET /v1/options?project_id=`. */
export interface CatalogoDeOpciones {
  proyecto: { id: string; nombre: string } | null
  grupos: Record<string, GrupoDeOpciones>
}

/**
 * Las claves de grupo que esta interfaz pide.
 *
 * Se escriben como constantes y no como literales sueltos por un motivo que ya
 * se pago una vez con `recurso_inexistente` en las guidelines: un literal mal
 * escrito en un sitio no falla, devuelve `undefined`, y el componente pinta el
 * estado de "todavia cargando" para siempre sin que nadie vea un error.
 */
export const GRUPO = {
  origenDeProyecto: 'project.origen',
  autonomia: 'project.autonomia',
  areaDeGuideline: 'guideline.area',
  tipoDeCredencial: 'credential.tipo',
  ambitoDeCredencial: 'credential.ambito',
  rolDeAgente: 'agent.rol',
  runtime: 'agent.runtime',
  claseDeConexion: 'connection.clase',
} as const

/* -------------------------------------------------------------------------- */
/* Las aplicaciones OAuth: el unico paso que el producto no puede dar solo     */
/* -------------------------------------------------------------------------- */

/**
 * Un paso del recorrido para registrar la aplicacion OAuth de un proveedor.
 *
 * `pegar` VIAJA APARTE Y NO DENTRO DE `detalle` a proposito: es el valor exacto
 * que hay que copiar —la redirect URI de ESTA instancia— y una instruccion que
 * lo mencione dentro de una frase obliga a transcribirlo a mano. Detras de un
 * boton de copiar, no hay nada que transcribir.
 */
export interface PasoDeRegistro {
  titulo: string
  detalle: string
  /** El valor exacto que hay que copiar, cuando el paso pide copiar algo. */
  pegar?: string
  /** La direccion que hay que abrir, cuando el paso pide abrir algo. */
  abrir?: string
}

export interface RecorridoDeRegistro {
  slug: string
  nombre?: string
  url_de_registro: string
  redirect_uri: string
  campos_que_devuelve: string[]
  pasos: PasoDeRegistro[]
}

export interface AplicacionOauth {
  slug: string
  nombre: string
  clase?: ClaseDeConexion
  registrada: boolean
  recorrido: RecorridoDeRegistro | null
}

/**
 * Lo que devuelve `GET /v1/connections/oauth-apps`.
 *
 * `aplicaciones_compartidas` CONTESTA LA PREGUNTA QUE LLEGO PRIMERO —«¿por que
 * debo poner token? ¿no sirven las integraciones con OAuth?»— y viaja con su
 * evidencia. Sin la evidencia es una afirmacion, y una afirmacion sin pruebas
 * se vuelve a discutir dentro de seis meses.
 */
export interface EstadoDeAplicacionesOauth {
  servidor: string
  redirect_uri: string
  items: AplicacionOauth[]
  aplicaciones_compartidas: {
    hay: boolean
    version?: string
    medido_el?: string
    porque: string
    evidencia: { comprobacion: string; resultado: string }[]
  }
}

/* ==========================================================================
   Spec 003 · El board de control.
   --------------------------------------------------------------------------
   Transcrito de `specs/003-board-de-control/contracts/board-api.md` §2, que es
   lo unico que comparten los tres frentes. Si el servicio manda otra cosa, la
   diferencia esta entre estos tipos y el contrato, no repartida por el board.

   Una TARJETA no se guarda en ningun sitio: el servicio la deriva cada vez de
   un ticket del gestor y, si existe, del run del motor sobre ese ticket. Esta
   interfaz la pinta tal cual; la columna, el chip y la accion vienen
   decididos. Lo unico que se calcula aqui es lo que depende de los filtros del
   operador (contadores y resumen de lo filtrado), y eso vive en
   `components/board/derivar.ts`.
   ========================================================================== */

/**
 * Las columnas de FR-001, revisado el 2026-09-24 sobre el referente Nodal:
 * Todo, En curso, En revision, Bloqueado y Hecho, mas Backlog plegable a la
 * izquierda. Los identificadores son los del `canonicalState` del contrato de
 * proveedor, que ya tenia `blocked` y `done`: una columna nueva no inventa un
 * nombre que el resto del sistema no conoce.
 */
export type IdDeColumna = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'blocked' | 'done'

/** El orden en pantalla. Backlog va primero porque se pinta plegado a la izquierda. */
export const ORDEN_DE_COLUMNAS: readonly IdDeColumna[] = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'blocked',
  'done',
] as const

export interface ColumnaDelBoard {
  id: IdDeColumna
  titulo: string
  /** Lo que el servicio conoce de la columna, sin los filtros del operador. */
  total: number
  /**
   * Texto cuando la columna esta INCOMPLETA: proveedor sin `listItems`, gestor
   * caido, mas tickets de los mostrados. Se pinta siempre: una columna corta
   * sin explicacion se lee como «no hay mas».
   */
  nota: string | null
}

/**
 * Los estados que son chip y nunca columna (FR-004).
 *
 * `fase` es el run en marcha; `pr_listo` es el final feliz. Los demas son el
 * run parado por algo, y cuatro de ellos piden al operador (ver
 * `CHIPS_QUE_TE_NECESITAN` en `derivar.ts`).
 */
export type TipoDeChip =
  | 'en_cola'
  | 'necesita_permiso'
  | 'necesita_criterios'
  | 'plan_listo'
  | 'fase'
  | 'bloqueado'
  | 'fallido'
  | 'interrumpido'
  | 'pr_listo'
  | 'sin_repo'

export interface ChipDeTarjeta {
  tipo: TipoDeChip
  /** Lo que se lee en el chip. Lo redacta el servicio. */
  texto: string
  /** La causa textual COMPLETA, o `null`. Nunca un resumen (FR-062 de la 002). */
  detalle: string | null
  /** Solo en `en_cola`: la posicion en la cola del proyecto. */
  posicion?: number | null
}

export interface AvanceDeTarjeta {
  /** Tareas integradas. */
  hechas: number
  /** Tareas del plan. */
  total: number
  /** La fase de la tarea en curso: Leer, Test, Implementar, Gate, Revision. */
  fase: string | null
}

export type TipoDeAccionDeTarjeta = 'run' | 'open_run' | 'retry' | 'approve' | 'ninguna'

export interface AccionDeTarjeta {
  tipo: TipoDeAccionDeTarjeta
  habilitada: boolean
  /**
   * Por que no se puede, escrito entero. Lo manda el servicio —«Sin repo»,
   * «Conecta un modelo en Settings → Modelos»— y aqui se pinta tal cual: un
   * boton apagado sin motivo es un boton roto.
   */
  motivo: string | null
}

/**
 * El gasto de un run. `medido: false` NO es cero: es un runtime que no
 * reporta gasto, y pintarlo como 0 diria que fue gratis (US5, escenario 2).
 */
export interface GastoDeRun {
  usd: number | null
  calls: number | null
  medido: boolean
}

export interface RunDeTarjeta {
  itemId: string
  estado: string
  /** URL del pull request abierto por el motor, o `null`. */
  pr: string | null
  gasto?: GastoDeRun | null
}

/** Como viaja un proyecto dentro de otra cosa: tarjeta, run, fila de costos. */
export interface ReferenciaDeProyecto {
  id: string
  nombre: string
  color?: string | null
}

export interface AsignadoDeTicket {
  nombre: string
  iniciales?: string | null
  /**
   * Se acepta y NO se pinta. Cargar una imagen de un host del gestor es una
   * peticion de red por tarjeta, y esta aplicacion funciona sin internet
   * (FR-003 de la 002). Las iniciales dicen lo mismo sin salir de la maquina.
   */
  avatarUrl?: string | null
}

export interface TicketDeTarjeta {
  id: string
  key: string | null
  titulo: string
  url?: string | null
  /** 0 urgente … 4 baja. `null` cuando el gestor no la da: no se inventa. */
  prioridad?: number | null
  equipo?: string | null
  etiquetas?: string[]
  asignado?: AsignadoDeTicket | null
}

/**
 * Quien ejecuta la tarea: un runtime conectado y, si se eligio, un agente.
 * Agnostico a proposito (FR-031): `claude-agent-sdk`, `codex` o el que el
 * servicio registre manana. Sin ejecutor propio, la tarea hereda en cascada
 * del repo, del proyecto y del general; el servicio manda el ya resuelto.
 */
export interface EjecutorDeTarea {
  runtime: string
  agente?: string | null
}

export interface Tarjeta {
  /** `<projectId>:<itemId>`. Un ticket de dos proyectos son dos tarjetas. */
  id: string
  proyecto: ReferenciaDeProyecto
  /**
   * `local` es una tarea creada en noxloop (FR-030), no un ticket de un gestor
   * externo. Se pinta con el chip «Local». Opcional: un servicio anterior a
   * las tareas propias no lo manda, y entonces el chip sale del gestor.
   */
  origen?: 'local' | 'gestor' | null
  ticket: TicketDeTarjeta
  /** El ejecutor resuelto, si el servicio lo sabe. */
  ejecutor?: EjecutorDeTarea | null
  columna: IdDeColumna
  chip: ChipDeTarjeta | null
  avance: AvanceDeTarjeta | null
  accion: AccionDeTarjeta
  run: RunDeTarjeta | null
  tieneRepo: boolean
}

export interface ResumenDelBoard {
  enCurso: number
  teNecesitan: number
  enCola: number
}

/** Los gestores que el contrato nombra. `string` para no romper con uno nuevo. */
export type GestorDeTickets = 'github' | 'linear' | 'azure-devops' | 'fake' | (string & {})

export interface ProyectoDelBoard {
  id: string
  nombre: string
  estado: EstadoProyecto
  color: string | null
  gestor: GestorDeTickets | null
  /** Si su gestor sabe listar tickets. Sin la capacidad, el board degrada. */
  listItems: boolean
}

export interface AvisoDelBoard {
  proyecto: string | null
  nivel: 'error' | 'aviso'
  causa: string
  accion: string
}

/** `GET /v1/board?project=<id>&includeDone=0|1`. */
export interface Board {
  columnas: ColumnaDelBoard[]
  tarjetas: Tarjeta[]
  resumen: ResumenDelBoard
  proyectos: ProyectoDelBoard[]
  avisos: AvisoDelBoard[]
}

/** Respuesta de lanzar, aprobar y reintentar: `202`, o `200` si ya existia. */
export interface RespuestaDeLanzamiento {
  run: {
    itemId: string
    estado: string
    posicion: number | null
  }
}

/** Una fila de `GET /v1/runs`. */
export interface RunListado {
  itemId: string
  /**
   * El contrato no fija si viaja la referencia o solo el identificador; se
   * aceptan las dos y `referenciaDeProyecto()` las iguala.
   */
  proyecto: ReferenciaDeProyecto | string
  titulo: string
  estado: string
  avance: AvanceDeTarjeta | null
  pr: string | null
  gasto: GastoDeRun | null
  creado: string | null
  actualizado: string | null
}

export function referenciaDeProyecto(
  valor: ReferenciaDeProyecto | string | null | undefined,
): ReferenciaDeProyecto | null {
  if (!valor) return null
  if (typeof valor === 'string') return { id: valor, nombre: valor, color: null }
  return valor
}

export interface UsoAgregado {
  usd: number
  calls: number
  /** Runs cuyo runtime no mide gasto. Se cuentan aparte, nunca como cero. */
  sinMedir: number
}

/** `GET /v1/usage?desde=<ISO>&hasta=<ISO>`. */
export interface Uso {
  total: UsoAgregado
  porProyecto: Array<UsoAgregado & { proyecto: ReferenciaDeProyecto | string }>
  runs: Array<{
    itemId: string
    proyecto: ReferenciaDeProyecto | string
    titulo: string
    usd: number | null
    calls: number | null
    medido: boolean
  }>
}

/* --- Modelos: los runtimes de agente ------------------------------------ */

/**
 * Como esta conectado un runtime. `null` es «no conectado».
 *
 * Son metodos de AUTENTICACION, no marcas: el mismo runtime puede estar con la
 * suscripcion del operador o con una clave de API, y la diferencia importa
 * porque la clave se factura aparte.
 */
export type MetodoDeRuntime = 'suscripcion_claude' | 'cuenta_chatgpt' | 'api_key'

/** Una fila de `GET /v1/runtimes`. */
export interface EstadoDeRuntime {
  runtime: string
  nombre: string
  conectado: boolean
  metodo: MetodoDeRuntime | null
  /** Lo que el servicio sabe decir del estado, en una frase. */
  detalle: string
  /** Solo cuando no esta conectado: por que, y que hacer. */
  causa?: string
  accion?: string
}

/* --- El diff de una tarea (US6) ----------------------------------------- */

/** `A` anadido, `M` modificado, `D` borrado, `R` renombrado: lo de `git`. */
export type EstadoDeArchivoEnDiff = 'A' | 'M' | 'D' | 'R'

export interface ArchivoDeDiff {
  ruta: string
  estado: EstadoDeArchivoEnDiff | string
  mas: number
  menos: number
  /** El parche unificado del archivo, desde el primer `@@`. */
  parche: string
  /**
   * EL PARCHE SE CORTO. El contrato dice que los de mas de 200 KB se cortan
   * «y lo dicen»; no fija con que campo, asi que se aceptan los dos nombres
   * razonables y ademas se mira el texto (ver `parcheCortado` en el visor).
   * Un parche cortado pintado como entero haria creer que el archivo termina
   * donde termina lo que llego.
   */
  cortado?: boolean
  truncado?: boolean
}

export type TipoDeCommit = 'test' | 'impl' | 'otro'

export interface CommitDeTarea {
  sha: string
  mensaje: string
  tipo: TipoDeCommit | string
  archivos: ArchivoDeDiff[]
}

/** `GET /v1/runs/:itemId/tasks/:taskId/diff`. Solo lectura: `git log`/`git diff`. */
export interface DiffDeTarea {
  tarea: {
    id: string
    titulo?: string | null
    estado?: string | null
    /** El runtime que la trabajo: `claude-agent-sdk`, `codex`… */
    agente?: string | null
    rama?: string | null
  }
  commits: CommitDeTarea[]
  /** Lo que la tarea lleva hecho en su worktree respecto a su base. */
  sinCommitear: { archivos: ArchivoDeDiff[] } | null
}

/* --- Tareas propias (FR-030 a FR-032) ----------------------------------- */

/** Como termina una tarea. Ninguno mergea: la autonomia acaba en el PR. */
export type TerminoDeTarea = 'changes' | 'commit' | 'pr'

/**
 * `POST /v1/projects/:id/tasks` y `PATCH /v1/tasks/:id`.
 *
 * El servicio es el unico escritor del gestor local (principio VIII): esta
 * interfaz manda el formulario y no guarda nada de el.
 */
export interface TareaNueva {
  repo?: string | null
  titulo: string
  /** Markdown. */
  plan: string
  criterios: string[]
  /** 0 urgente … 3 baja, `null` sin prioridad: la misma escala que las tarjetas. */
  prioridad: number | null
  etiquetas: string[]
  /** Sin ejecutor, hereda en cascada: repo → proyecto → general (FR-031). */
  ejecutor?: EjecutorDeTarea | null
  termino?: TerminoDeTarea
}

export interface TareaCreada {
  tarea: {
    id: string
    /** `<PREFIJO>-<n>`, p. ej. `PAY-12`. */
    key: string
    [campo: string]: unknown
  }
}
