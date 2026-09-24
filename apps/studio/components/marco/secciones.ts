import { SECCIONES_DE_PROYECTO, esAjusteGeneral, type Seccion } from '@/lib/ruta'

/**
 * El modelo de la navegacion, en un solo sitio.
 *
 * POR QUE NO VIVE EN `aplicacion.tsx`. Antes habia una sola lista de cinco
 * entradas ahi dentro y bastaba. Ahora la misma informacion la consumen cuatro
 * piezas —la navegacion lateral, las migas, el conmutador de proyecto y los
 * comandos de ⌘K— y cada una necesita una parte distinta: el nombre de la
 * seccion, a que nivel pertenece, y quien la marca como activa. Con la lista
 * repartida, anadir una pantalla obliga a acordarse de cuatro archivos y el
 * resultado tipico es una pantalla que existe, se alcanza por direccion, y no
 * aparece en la navegacion ni en el menu de comandos.
 */

/**
 * El nombre de cada seccion, tal como lo lee el operador.
 *
 * `Record<Seccion, string>` y no `Partial`: una seccion nueva sin nombre no
 * compila. Es la unica forma de que una pantalla no llegue a produccion
 * llamandose por su identificador interno en la miga.
 */
export const ETIQUETA_DE_SECCION: Record<Seccion, string> = {
  board: 'Board',
  runs: 'Runs',
  costos: 'Costos',
  settings: 'Settings',
  modelos: 'Modelos',
  diagnostico: 'Diagnostico',
  'flota-por-defecto': 'Flota por defecto',
  inicio: 'Indicadores',
  asistente: 'Asistente',
  bandeja: 'Bandeja',
  proyectos: 'Proyectos',
  'proyecto-nuevo': 'Anadir proyecto',
  ajustes: 'General',
  snapshot: 'Snapshot',
  constitution: 'Constitution',
  guidelines: 'Guidelines',
  diseno: 'Diseno',
  bootstrap: 'Bootstrap',
  conexiones: 'Conexiones',
  gestor: 'Gestor',
  flota: 'Flota',
  ciclos: 'Ciclos',
  credenciales: 'Credenciales',
  auditoria: 'Auditoria',
  catalogo: 'Catalogo de componentes',
}

/**
 * El nombre de la pestana cuando no coincide con el de la seccion.
 *
 * `settings` como seccion se llama «Settings» en la navegacion —es el destino—
 * y como pestana se llama por lo que contiene. Sin esta tabla la primera
 * pestana de Settings diria «Settings», que no dice nada.
 */
export const ETIQUETA_DE_PESTANA: Partial<Record<Seccion, string>> = {
  settings: 'Herramientas y conexiones',
  conexiones: 'Conexiones del proyecto',
}

export function etiquetaDePestana(seccion: Seccion): string {
  return ETIQUETA_DE_PESTANA[seccion] ?? ETIQUETA_DE_SECCION[seccion]
}

/**
 * LOS CUATRO DESTINOS PRINCIPALES, y son exactamente cuatro (FR-022).
 *
 * Es la simplificacion que pidio el operador: «un proyecto tiene un board de
 * control y listo». En la 002 el nivel principal tenia seis destinos del
 * espacio de trabajo y seis mas por proyecto, y el conjunto obligaba a saber
 * cual tocaba. Todo lo que salio de aqui sigue en Settings y en ⌘K; la guarda
 * de que ninguna pantalla quedo solo por direccion es `aplicacion.tsx`.
 */
export const DESTINOS_PRINCIPALES = ['board', 'runs', 'costos', 'settings'] as const satisfies readonly Seccion[]

export type DestinoPrincipal = (typeof DESTINOS_PRINCIPALES)[number]

/**
 * Las secciones que se pintan SIN la navegacion lateral.
 *
 * EL FALLO CONCRETO: el asistente existe para que haya UNA decision en
 * pantalla. Con la navegacion montada al lado hay destinos compitiendo con
 * ella, y el paso que dice "decide estos 57 hallazgos" queda a la misma
 * distancia visual que "Costos". Lo que se corrige no es el ancho: es que la
 * pantalla siga ofreciendo salida por muchos sitios cuando lo que pide es
 * atencion en uno.
 *
 * NO ES UNA CARCEL. La cabecera se queda entera —migas y ⌘K— y el asistente
 * pinta su propia salida en cada paso. Lo que desaparece es el menu
 * permanente, no la puerta.
 */
export const SECCIONES_SIN_RAIL: readonly Seccion[] = ['asistente']

export function pintaRail(seccion: Seccion): boolean {
  return !SECCIONES_SIN_RAIL.includes(seccion)
}

/**
 * Nivel dos del recorrido: las etapas del proyecto, en el orden en que se
 * recorren. Lo consume el menu de comandos para ofrecerlas atadas al proyecto
 * abierto.
 */
export const SECCIONES_DE_LA_ETAPA = SECCIONES_DE_PROYECTO

/**
 * Que destino principal queda marcado estando donde se esta.
 *
 * Las pestanas de Settings general marcan «Settings». Las de Settings DEL
 * PROYECTO no marcan ningun destino: las marca el proyecto en la lista
 * lateral, que es lo que el operador eligio para llegar ahi. Marcar «Settings»
 * estando en la constitution de un proyecto repetiria el fallo que motivo el
 * marco de la 002 — decir en que etapa se esta y no de que proyecto.
 */
export function destinoActivo(seccion: Seccion): DestinoPrincipal | null {
  if ((DESTINOS_PRINCIPALES as readonly Seccion[]).includes(seccion)) {
    return seccion as DestinoPrincipal
  }
  if (esAjusteGeneral(seccion)) return 'settings'
  // Las pantallas de la 002 que no son de proyecto ni pestanas de Settings
  // —inicio, bandeja, proyectos, alta— se alcanzan desde Settings y desde
  // ⌘K. Marcar Settings es decir por donde se vuelve a ellas.
  if (['inicio', 'bandeja', 'proyectos', 'proyecto-nuevo'].includes(seccion)) return 'settings'
  return null
}
