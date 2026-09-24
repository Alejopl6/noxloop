import { SECCIONES_DE_PROYECTO, type Seccion } from '@/lib/ruta'

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
  inicio: 'Inicio',
  asistente: 'Asistente',
  bandeja: 'Bandeja',
  proyectos: 'Proyectos',
  'proyecto-nuevo': 'Anadir proyecto',
  snapshot: 'Snapshot',
  constitution: 'Constitution',
  bootstrap: 'Bootstrap',
  conexiones: 'Conexiones',
  flota: 'Flota',
  runs: 'Ciclos',
  credenciales: 'Credenciales',
  auditoria: 'Auditoria',
  catalogo: 'Catalogo de componentes',
}

/**
 * Nivel uno: lo que es del espacio de trabajo y existe siempre.
 *
 * `proyecto-nuevo` NO esta aqui aunque sea de este nivel: es una accion, no un
 * destino permanente, y ya tiene su boton en la pantalla de proyectos y su
 * comando en ⌘K. Una entrada fija en la navegacion para un formulario de alta
 * gasta una linea del nivel uno en algo que se usa una vez por proyecto.
 */
export const SECCIONES_DEL_WORKSPACE: readonly Seccion[] = [
  'inicio',
  'asistente',
  'bandeja',
  'proyectos',
  'credenciales',
  'auditoria',
]

/**
 * Las secciones que se pintan SIN el rail de navegacion.
 *
 * EL FALLO CONCRETO: el asistente existe para que haya UNA decision en
 * pantalla. Con el rail montado al lado hay once destinos compitiendo con
 * ella, y el paso que dice "decide estos 57 hallazgos" queda a la misma
 * distancia visual que "Auditoria". Lo que se corrige no es el ancho: es que
 * la pantalla siga ofreciendo salida por once sitios cuando lo que pide es
 * atencion en uno.
 *
 * NO ES UNA CARCEL. La cabecera se queda entera —migas, conmutador de
 * proyecto, ⌘K— y el asistente pinta su propia salida al modo consola en cada
 * paso. Lo que desaparece es el menu permanente, no la puerta.
 */
export const SECCIONES_SIN_RAIL: readonly Seccion[] = ['asistente']

export function pintaRail(seccion: Seccion): boolean {
  return !SECCIONES_SIN_RAIL.includes(seccion)
}

/**
 * Nivel dos: las etapas del proyecto abierto, en el orden en que se recorren.
 *
 * ESTE ORDEN NO ES ALFABETICO NI CASUAL: es el mismo recorrido que declara
 * `DESTINO_DE_ETAPA` en `lib/ruta.ts` (CREATED -> snapshot, DISCOVERED ->
 * constitution, ...). Que la navegacion lo liste en otro orden que el que la
 * maquina de estados impone ensena un recorrido que el sistema no permite.
 */
export const SECCIONES_DE_LA_ETAPA = SECCIONES_DE_PROYECTO

/**
 * Que entrada de la navegacion queda marcada cuando la ruta no es ninguna.
 *
 * Solo queda una pareja: las seis etapas ya se marcan a si mismas desde que
 * existe el nivel dos. Antes estaban todas aqui apuntando a `proyectos`, que
 * era la unica forma de que el marco no se quedara sin nada resaltado — y el
 * sintoma era el que motiva esta feature: estar dentro de la constitution de
 * un proyecto y que el marco marcara "Proyectos", sin decir de cual.
 */
export const SECCION_PADRE: Partial<Record<Seccion, Seccion>> = {
  'proyecto-nuevo': 'proyectos',
}

/** Que entrada se marca como activa estando donde se esta. */
export function seccionActiva(seccion: Seccion): Seccion {
  return SECCION_PADRE[seccion] ?? seccion
}
