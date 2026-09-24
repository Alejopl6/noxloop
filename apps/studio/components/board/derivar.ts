import type {
  IdDeColumna,
  ProyectoDelBoard,
  ReferenciaDeProyecto,
  ResumenDelBoard,
  Tarjeta,
  TipoDeChip,
} from '@/lib/tipos'

/**
 * LO UNICO QUE EL BOARD CALCULA EN EL CLIENTE, y por que es esto y nada mas.
 *
 * La columna, el chip, la accion y el avance de cada tarjeta los decide el
 * servicio (`contracts/board-api.md`): son derivaciones del ticket y del run,
 * y hacerlas aqui seria una segunda copia de la precedencia de FR-003 que se
 * separa de la primera a la tercera semana. Lo que el servicio NO puede
 * decidir es lo que depende de lo que el operador esta mirando: los filtros
 * que tiene puestos, los contadores de lo filtrado (FR-007) y el resumen de lo
 * que queda a la vista.
 *
 * SIN IMPORTS DE EJECUCION A PROPOSITO. Solo tipos, que se borran al compilar:
 * asi este archivo se prueba con `node --test` tal cual, sin bundler y sin
 * resolver el alias `@/` (`apps/studio/test/board.test.mjs`). Lo que tiene
 * logica que pueda estar mal se prueba; lo que es pintura se mira en el
 * catalogo.
 */

/* -------------------------------------------------------------------------- */
/* Filtros                                                                    */
/* -------------------------------------------------------------------------- */

/** Valor de `asignado` que significa «sin asignar». No es un nombre posible. */
export const SIN_ASIGNAR = '\u0000sin-asignar'

export type FiltroDeRepo = 'todos' | 'con' | 'sin'

export interface FiltrosDelBoard {
  /** Busqueda libre sobre clave, titulo, proyecto, equipo y etiquetas. */
  texto: string
  /** Identificador de proyecto. Vive en la DIRECCION, no en este estado. */
  proyecto: string | null
  /** Nombre del asignado, o `SIN_ASIGNAR`. */
  asignado: string | null
  repo: FiltroDeRepo
  etiqueta: string | null
}

export const FILTROS_VACIOS: FiltrosDelBoard = {
  texto: '',
  proyecto: null,
  asignado: null,
  repo: 'todos',
  etiqueta: null,
}

/**
 * Sin acentos y en minusculas, igual que el menu de comandos: quien busca
 * «revision» tiene que encontrar «revisión», y quien teclea rapido no escribe
 * tildes.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

function textoDeLaTarjeta(tarjeta: Tarjeta): string {
  const { ticket, proyecto } = tarjeta
  return normalizar(
    [
      ticket.key ?? '',
      ticket.id,
      ticket.titulo,
      ticket.equipo ?? '',
      proyecto.nombre,
      ticket.asignado?.nombre ?? '',
      ...(ticket.etiquetas ?? []),
      tarjeta.chip?.texto ?? '',
    ].join(' '),
  )
}

/** ¿Hay algun filtro puesto, aparte del proyecto? El proyecto es navegacion. */
export function hayFiltros(filtros: FiltrosDelBoard): boolean {
  return (
    filtros.texto.trim().length > 0 ||
    filtros.asignado !== null ||
    filtros.repo !== 'todos' ||
    filtros.etiqueta !== null
  )
}

/**
 * Las tarjetas que cumplen TODOS los filtros activos (US1, escenario 6).
 *
 * El texto se parte en palabras y cada una tiene que aparecer: «api 142»
 * encuentra CORE-142 con la etiqueta api, que es como se busca en un kanban.
 */
export function filtrarTarjetas(tarjetas: readonly Tarjeta[], filtros: FiltrosDelBoard): Tarjeta[] {
  const palabras = normalizar(filtros.texto).split(/\s+/).filter(Boolean)

  return tarjetas.filter((tarjeta) => {
    if (filtros.proyecto && tarjeta.proyecto.id !== filtros.proyecto) return false

    if (filtros.asignado !== null) {
      const nombre = tarjeta.ticket.asignado?.nombre ?? null
      if (filtros.asignado === SIN_ASIGNAR ? nombre !== null : nombre !== filtros.asignado) {
        return false
      }
    }

    if (filtros.repo === 'con' && !tarjeta.tieneRepo) return false
    if (filtros.repo === 'sin' && tarjeta.tieneRepo) return false

    if (filtros.etiqueta !== null && !(tarjeta.ticket.etiquetas ?? []).includes(filtros.etiqueta)) {
      return false
    }

    if (palabras.length > 0) {
      const texto = textoDeLaTarjeta(tarjeta)
      if (!palabras.every((palabra) => texto.includes(palabra))) return false
    }

    return true
  })
}

/**
 * Las tarjetas repartidas en sus columnas, en el orden en que llegaron.
 *
 * EL ORDEN ES EL DEL SERVICIO, que es el del gestor (Edge case «muchos
 * tickets»). Reordenar aqui por prioridad o por fecha seria decidir por el
 * gestor que va primero.
 */
export function agruparPorColumna(tarjetas: readonly Tarjeta[]): Record<IdDeColumna, Tarjeta[]> {
  const grupos: Record<IdDeColumna, Tarjeta[]> = {
    backlog: [],
    todo: [],
    in_progress: [],
    in_review: [],
    blocked: [],
    done: [],
  }
  for (const tarjeta of tarjetas) {
    // Una columna desconocida no desaparece: cae en «En curso», que es donde
    // el operador mira lo que esta vivo. Tirarla seria una tarjeta que existe
    // en el servicio y no en la pantalla.
    ;(grupos[tarjeta.columna] ?? grupos.in_progress).push(tarjeta)
  }
  return grupos
}

/* -------------------------------------------------------------------------- */
/* El resumen: que corre y que te necesita                                    */
/* -------------------------------------------------------------------------- */

/**
 * Los chips que PIDEN AL OPERADOR (US3): una credencial sin permiso, un plan
 * esperando aprobacion, un ticket sin criterios verificables y una tarea
 * bloqueada que espera una decision. Fallido e interrumpido no estan: se
 * resuelven con Retry, que es una accion, no una decision.
 */
export const CHIPS_QUE_TE_NECESITAN: readonly TipoDeChip[] = [
  'necesita_permiso',
  'plan_listo',
  'necesita_criterios',
  'bloqueado',
]

export function teNecesita(tarjeta: Tarjeta): boolean {
  return tarjeta.chip !== null && CHIPS_QUE_TE_NECESITAN.includes(tarjeta.chip.tipo)
}

/**
 * El resumen de la barra superior, contado sobre las tarjetas que se le pasan.
 *
 * El board general usa el `resumen` del servicio, que es la cuenta canonica.
 * Con un proyecto elegido se cuenta aqui, sobre las tarjetas de ese proyecto:
 * el servicio no manda un resumen por proyecto en el board general, y pedir un
 * segundo board solo para tres numeros es una segunda lectura que puede
 * contestar otra cosa que la primera.
 */
export function resumirTarjetas(tarjetas: readonly Tarjeta[]): ResumenDelBoard {
  let enCurso = 0
  let teNecesitan = 0
  let enCola = 0
  for (const tarjeta of tarjetas) {
    if (!tarjeta.chip) continue
    if (tarjeta.chip.tipo === 'fase') enCurso += 1
    else if (tarjeta.chip.tipo === 'en_cola') enCola += 1
    else if (CHIPS_QUE_TE_NECESITAN.includes(tarjeta.chip.tipo)) teNecesitan += 1
  }
  return { enCurso, teNecesitan, enCola }
}

/**
 * EL ORDEN DE LOS RUNS ACTIVOS en la lista lateral: primero lo que te espera,
 * despues lo que se rompio, despues lo que corre y al final lo que espera
 * turno. Es el orden en que el operador los atenderia.
 */
const URGENCIA: Partial<Record<TipoDeChip, number>> = {
  necesita_permiso: 0,
  plan_listo: 1,
  necesita_criterios: 2,
  bloqueado: 3,
  // Una movida (spec 005, FR-004) es un run vivo que espera una decision del
  // operador —seguir aqui o soltarla—; sin entrada aqui desapareceria de
  // «Runs activos» justo cuando pide algo.
  movida: 4,
  fallido: 5,
  interrumpido: 6,
  fase: 7,
  en_cola: 8,
}

/**
 * Las tarjetas con un run vivo o parado, para la lista «Runs activos».
 *
 * `pr_listo` sale: el run termino y lo que queda es revisar el PR, que se hace
 * en el gestor de repositorios. Un run sin chip tambien: no hay nada que decir
 * de el.
 */
export function runsActivos(tarjetas: readonly Tarjeta[]): Tarjeta[] {
  return tarjetas
    .filter((tarjeta) => tarjeta.run !== null && tarjeta.chip !== null)
    .filter((tarjeta) => URGENCIA[tarjeta.chip!.tipo] !== undefined)
    .map((tarjeta, indice) => ({ tarjeta, indice }))
    .sort(
      (a, b) =>
        (URGENCIA[a.tarjeta.chip!.tipo] ?? 99) - (URGENCIA[b.tarjeta.chip!.tipo] ?? 99) ||
        a.indice - b.indice,
    )
    .map(({ tarjeta }) => tarjeta)
}

/* -------------------------------------------------------------------------- */
/* Opciones de los filtros                                                    */
/* -------------------------------------------------------------------------- */

export interface OpcionesDeFiltro {
  asignados: string[]
  haySinAsignar: boolean
  etiquetas: string[]
}

/**
 * Las opciones salen de LAS TARJETAS QUE HAY, no de una lista escrita aqui.
 * Un filtro de asignado con nombres que no estan en el board devuelve un board
 * vacio y parece un fallo.
 */
export function opcionesDeFiltro(tarjetas: readonly Tarjeta[]): OpcionesDeFiltro {
  const asignados = new Set<string>()
  const etiquetas = new Set<string>()
  let haySinAsignar = false
  for (const tarjeta of tarjetas) {
    const nombre = tarjeta.ticket.asignado?.nombre
    if (nombre) asignados.add(nombre)
    else haySinAsignar = true
    for (const etiqueta of tarjeta.ticket.etiquetas ?? []) etiquetas.add(etiqueta)
  }
  const orden = (a: string, b: string) => a.localeCompare(b, 'es')
  return {
    asignados: [...asignados].sort(orden),
    haySinAsignar,
    etiquetas: [...etiquetas].sort(orden),
  }
}

/* -------------------------------------------------------------------------- */
/* Pequenas derivaciones de pintura                                           */
/* -------------------------------------------------------------------------- */

/** Las iniciales de un nombre, si el servicio no las manda. «Ana Ruiz» → «AR». */
export function iniciales(nombre: string): string {
  const partes = nombre
    .replace(/[@._-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (partes.length === 0) return '?'
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}

/**
 * La paleta de los puntos de proyecto cuando el servicio no da color.
 *
 * Tokens de Geist y no hex sueltos, para que el punto cambie con el tema. El
 * indice sale de un hash del identificador: el mismo proyecto tiene el mismo
 * color en el board, en la lista lateral y en costos, y no cambia al recargar.
 */
const PALETA_DE_PROYECTOS = [
  'var(--ds-blue-700)',
  'var(--ds-purple-700)',
  'var(--ds-pink-700)',
  'var(--ds-amber-700)',
  'var(--ds-green-700)',
  'var(--ds-teal-700)',
  'var(--ds-red-700)',
] as const

export function colorDeProyecto(
  proyecto: Pick<ReferenciaDeProyecto, 'id'> & { color?: string | null },
): string {
  if (proyecto.color && /^#[0-9a-f]{3,8}$/i.test(proyecto.color)) return proyecto.color
  let hash = 0
  for (const letra of proyecto.id) hash = (hash * 31 + letra.charCodeAt(0)) >>> 0
  return PALETA_DE_PROYECTOS[hash % PALETA_DE_PROYECTOS.length]
}

/**
 * De donde vienen los tickets de un proyecto, en la palabra que el operador
 * reconoce. `local` son las tareas propias de noxloop (FR-030) y `fake` el
 * gestor de desarrollo: los dos se leen «Local».
 */
export function etiquetaDeGestor(gestor: ProyectoDelBoard['gestor']): string {
  switch (gestor) {
    case 'github':
      return 'GitHub'
    case 'linear':
      return 'Linear'
    case 'azure-devops':
      return 'ADO'
    case 'local':
    case 'fake':
    case null:
    case undefined:
      return 'Local'
    default:
      return gestor
  }
}

/**
 * «4 corriendo», «1 en cola»: plural bien puesto. Un «1 corriendos» en la
 * barra superior es el tipo de descuido que hace dudar del resto del numero.
 */
export function plural(cantidad: number, singular: string, varios: string): string {
  return `${cantidad} ${cantidad === 1 ? singular : varios}`
}

/**
 * Las iniciales de un ejecutor: las del agente si hay, y si no las del
 * runtime. `claude-agent-sdk` → «CL», `codex` → «CO». Son dos letras en un
 * cuadrado, y el nombre entero va en el `title`: no se inventa un logo.
 */
export function inicialesDeEjecutor(ejecutor: { runtime: string; agente?: string | null }): string {
  if (ejecutor.agente?.trim()) return iniciales(ejecutor.agente)
  return ejecutor.runtime.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?'
}
