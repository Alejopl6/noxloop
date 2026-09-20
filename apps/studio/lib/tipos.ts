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
] as const

export interface EventoServicio<D = unknown> {
  id: string | null
  tipo: TipoEvento | string
  project_id?: string | null
  datos: D
}
