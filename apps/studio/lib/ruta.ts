'use client'

import { useCallback, useEffect, useState } from 'react'

import type { EstadoProyecto } from '@/lib/tipos'

/**
 * Enrutado en cliente (T011).
 *
 * POR QUE SOBRE EL QUERY STRING Y NO SOBRE EL PATH — esto no es una preferencia
 * de estilo, es lo unico que sobrevive a una recarga:
 *
 * `generateStaticParams()` devuelve `[{ slug: [] }]`, asi que el export produce
 * UN solo archivo: `out/index.html`. No hay `out/bandeja/index.html`. Con
 * `pushState` sobre paths, la navegacion dentro de la app funciona —el HTML ya
 * esta cargado— pero en cuanto el operador recarga estando en `/bandeja/`, el
 * webview pide un archivo que no existe y ensena una pantalla en blanco bajo
 * `tauri://`, o un 404 en cualquier servidor de estaticos. El sintoma es
 * identico al de la trampa del `assetPrefix`, y la causa es distinta: por eso
 * conviene no tener ninguna de las dos.
 *
 * Y no se puede arreglar anadiendo rutas a `generateStaticParams()`, porque las
 * que importan llevan identificadores que el servicio inventa en runtime
 * (`/bandeja/inb_4f2a/`): en build no existen y no hay forma de enumerarlas.
 *
 * Sobre el query string, TODA url es `index.html` y todo recarga bien. El
 * precio es una direccion menos bonita. Es un precio barato.
 */

/**
 * `catalogo` no es una seccion de producto: es el catalogo de componentes de
 * consola, la pantalla donde se revisan en sus estados sin inventarse una
 * pantalla de producto para ello. Por eso no aparece en la navegacion y solo
 * se alcanza escribiendo `?vista=catalogo` (o desde ⌘K).
 *
 * LO QUE CAMBIO CON LA SPEC 003, dicho entero porque cambia el eje. La
 * navegacion principal son cuatro destinos —`board`, `runs`, `costos` y
 * `settings`— y las pantallas de establecimiento de la 002 NO SE BORRARON: se
 * movieron dentro de Settings (las del proyecto como pestanas de «Settings del
 * proyecto», las del espacio de trabajo como pestanas de Settings general) y
 * siguen todas en ⌘K. Siguen siendo secciones con su direccion propia: por eso
 * un enlace viejo a `?vista=constitution&proyecto=x` sigue abriendo lo mismo,
 * ahora con las pestanas de Settings alrededor.
 *
 * `runs` CAMBIO DE SIGNIFICADO, y a proposito. En la 002 era «los ciclos de un
 * proyecto» y exigia proyecto. En la 003 es la lista de runs de TODOS los
 * proyectos (FR-027), que es lo que el operador espera encontrar detras de la
 * palabra «Runs» de la navegacion. La pantalla vieja no se perdio: se llama
 * `ciclos`, que es como ya la titulaba la miga.
 */
export type Seccion =
  | 'board'
  | 'runs'
  | 'costos'
  | 'settings'
  | 'modelos'
  | 'diagnostico'
  | 'flota-por-defecto'
  | 'inicio'
  | 'asistente'
  | 'bandeja'
  | 'proyectos'
  | 'proyecto-nuevo'
  | 'ajustes'
  | 'snapshot'
  | 'constitution'
  | 'guidelines'
  | 'diseno'
  | 'bootstrap'
  | 'conexiones'
  | 'flota'
  | 'ciclos'
  | 'credenciales'
  | 'auditoria'
  | 'catalogo'

/**
 * Las etapas del establecimiento, EN EL ORDEN DE LA MAQUINA DE ESTADOS.
 *
 * Existe como lista propia porque de ella se deriva `PARAMETRO_DE_ID` justo
 * debajo, y porque el orden de sus entradas ES el recorrido: `DESTINO_DE_ETAPA`
 * y el asistente lo recorren en este orden.
 *
 * EL FALLO QUE EVITA DERIVARLO: el dia que se anada una septima etapa, quien
 * la anada la escribe en `Seccion` y se olvida de darle entrada en
 * `PARAMETRO_DE_ID`. Entonces `construirRuta` descarta el identificador en
 * silencio, la direccion queda sin `?proyecto=`, todo parece funcionar
 * mientras no se recargue, y al recargar la pantalla dice que falta el
 * proyecto. Con la tabla derivada de esta lista ese olvido no se puede
 * cometer.
 */
export const SECCIONES_DE_PROYECTO = [
  'snapshot',
  'constitution',
  'bootstrap',
  'conexiones',
  'flota',
  'ciclos',
] as const satisfies readonly Seccion[]

export type SeccionDeProyecto = (typeof SECCIONES_DE_PROYECTO)[number]

/**
 * Las pestanas de «Settings del proyecto», en el orden en que se pintan.
 *
 * El orden NO es el de la maquina de estados, y la diferencia es deliberada:
 * aqui no se recorre nada, se ajusta algo que ya esta establecido. Primero lo
 * que decide como trabaja el proyecto (autonomia, constitution, guidelines,
 * diseno), despues con que (bootstrap, conexiones, flota) y al final lo que
 * es historia (el snapshot que se acepto, los ciclos de la 002).
 */
export const SECCIONES_DE_AJUSTES_DE_PROYECTO = [
  'ajustes',
  'constitution',
  'guidelines',
  'diseno',
  'bootstrap',
  'conexiones',
  'flota',
  'snapshot',
  'ciclos',
] as const satisfies readonly Seccion[]

export type SeccionDeAjustesDeProyecto = (typeof SECCIONES_DE_AJUSTES_DE_PROYECTO)[number]

export function esAjusteDeProyecto(seccion: Seccion): seccion is SeccionDeAjustesDeProyecto {
  return (SECCIONES_DE_AJUSTES_DE_PROYECTO as readonly Seccion[]).includes(seccion)
}

/**
 * Las pestanas de Settings general: el «portal de tools» del operador.
 *
 * `settings` es la primera pestana —herramientas y conexiones— y no una
 * portada con enlaces: una portada es una pantalla mas entre el operador y lo
 * que vino a tocar.
 */
export const SECCIONES_DE_AJUSTES_GENERALES = [
  'settings',
  'modelos',
  'diagnostico',
  'credenciales',
  'flota-por-defecto',
  'auditoria',
] as const satisfies readonly Seccion[]

export type SeccionDeAjustesGenerales = (typeof SECCIONES_DE_AJUSTES_GENERALES)[number]

export function esAjusteGeneral(seccion: Seccion): seccion is SeccionDeAjustesGenerales {
  return (SECCIONES_DE_AJUSTES_GENERALES as readonly Seccion[]).includes(seccion)
}

/**
 * Todo lo que VIAJA CON UN IDENTIFICADOR DE PROYECTO.
 *
 * Tres familias con tres significados del mismo parametro:
 *
 *   - `asistente`: el recorrido de ESE proyecto. Sin el es legitimo —su
 *     primer paso es crear uno—.
 *   - `board` y `runs`: un FILTRO. Sin proyecto son el board general y la
 *     lista de todos los runs (FR-002: el proyecto elegido queda en la
 *     direccion para poder volver a el).
 *   - las pestanas de Settings del proyecto: exigen proyecto.
 *
 * Aqui se declara que el parametro EXISTE, no que sea obligatorio.
 */
export const SECCIONES_CON_PROYECTO = [
  'asistente',
  'board',
  'runs',
  ...SECCIONES_DE_AJUSTES_DE_PROYECTO,
] as const satisfies readonly Seccion[]

export type SeccionConProyecto = (typeof SECCIONES_CON_PROYECTO)[number]

export function esSeccionDeProyecto(seccion: Seccion): seccion is SeccionConProyecto {
  return (SECCIONES_CON_PROYECTO as readonly Seccion[]).includes(seccion)
}

/**
 * Como se llama el identificador de cada seccion en la direccion.
 *
 * NO ES COSMETICA. El identificador significa cosas distintas segun la
 * seccion —una entrada de bandeja, un proyecto, una credencial— y un
 * `?id=` generico produce direcciones que se pueden pegar de una seccion a
 * otra y recargan en un sitio que no tiene nada que ver con lo que se estaba
 * mirando. Con el nombre puesto, esa direccion sencillamente no analiza.
 *
 * Una seccion sin entrada aqui no lleva identificador, y el que traiga se
 * descarta al construir la direccion.
 */
const PARAMETRO_DE_ID: Partial<Record<Seccion, string>> = {
  bandeja: 'entrada',
  credenciales: 'credencial',
  ...Object.fromEntries(SECCIONES_CON_PROYECTO.map((seccion) => [seccion, 'proyecto'])),
}

const SECCIONES: readonly Seccion[] = [
  'board',
  'runs',
  'costos',
  'settings',
  'modelos',
  'diagnostico',
  'flota-por-defecto',
  'inicio',
  'asistente',
  'bandeja',
  'proyectos',
  'proyecto-nuevo',
  'ajustes',
  'snapshot',
  'constitution',
  'guidelines',
  'diseno',
  'bootstrap',
  'conexiones',
  'flota',
  'ciclos',
  'credenciales',
  'auditoria',
  'catalogo',
] as const

function esSeccion(valor: string | null): valor is Seccion {
  return valor !== null && (SECCIONES as readonly string[]).includes(valor)
}

export interface Ruta {
  seccion: Seccion
  /** Identificador dentro de la seccion, cuando la seccion tiene uno. */
  id: string | null
  /**
   * EN QUE PASO DEL ASISTENTE. Solo lo lleva `asistente`; en cualquier otra
   * seccion se descarta al construir la direccion, igual que el `id`.
   *
   * POR QUE ES UN CAMPO APARTE Y NO EL `id`. El `id` de `asistente` ya es el
   * proyecto, y meter los dos en el mismo hueco obliga a inventar una sintaxis
   * (`proyecto:paso`) que hay que analizar y de la que nadie se acuerda.
   *
   * POR QUE EXISTE, SI EL PASO SE DEDUCE DEL ESTADO DEL PROYECTO. Porque hay
   * pasos que el servicio NO publica: guidelines y diseno viven los tres
   * dentro de `CONSTITUTED`, asi que la deduccion no puede distinguirlos. Sin
   * este parametro, el operador que esta editando las guidelines recarga y
   * aparece en el bootstrap. `null` significa "deducelo", que es lo correcto
   * al entrar de nuevas y lo correcto tras crear un proyecto.
   */
  paso?: string | null
  /**
   * EL RUN ABIERTO en la lista de runs. Solo lo lleva `runs`, por el mismo
   * motivo que `paso` es un campo aparte: el `id` de `runs` ya es el filtro de
   * proyecto, y «Abrir run» desde una tarjeta tiene que poder recargarse y
   * seguir abierto.
   */
  run?: string | null
  /** LA TAREA ABIERTA dentro del run abierto: su diff. Solo con `run`. */
  tarea?: string | null
}

/**
 * La pantalla de inicio es el BOARD GENERAL (FR-001).
 *
 * La vieja pantalla de inicio —indicadores agregados y la bandeja— sigue
 * existiendo en `?vista=inicio` y en ⌘K: su contenido no era falso, era la
 * puerta equivocada.
 */
export const RUTA_INICIAL: Ruta = { seccion: 'board', id: null }

/** Como se llama el paso del asistente en la direccion. */
const PARAMETRO_DE_PASO = 'paso'
/** Como se llama el run abierto en la direccion. */
const PARAMETRO_DE_RUN = 'run'
/** Como se llama la tarea abierta del run en la direccion. */
const PARAMETRO_DE_TAREA = 'tarea'

export function analizarRuta(busqueda: string): Ruta {
  const parametros = new URLSearchParams(busqueda)
  const vista = parametros.get('vista')
  if (!esSeccion(vista)) return RUTA_INICIAL

  const nombre = PARAMETRO_DE_ID[vista]
  return {
    seccion: vista,
    id: nombre ? parametros.get(nombre) : null,
    paso: vista === 'asistente' ? parametros.get(PARAMETRO_DE_PASO) : null,
    run: vista === 'runs' ? parametros.get(PARAMETRO_DE_RUN) : null,
    tarea: vista === 'runs' ? parametros.get(PARAMETRO_DE_TAREA) : null,
  }
}

export function construirRuta(ruta: Ruta): string {
  // El board general es la raiz. Con proyecto no: el filtro tiene que quedar
  // escrito para que recargar devuelva el mismo board (FR-002).
  if (ruta.seccion === 'board' && !ruta.id) return '/'
  const parametros = new URLSearchParams({ vista: ruta.seccion })
  const nombre = PARAMETRO_DE_ID[ruta.seccion]
  if (nombre && ruta.id) parametros.set(nombre, ruta.id)
  if (ruta.seccion === 'asistente' && ruta.paso) {
    parametros.set(PARAMETRO_DE_PASO, ruta.paso)
  }
  if (ruta.seccion === 'runs' && ruta.run) {
    parametros.set(PARAMETRO_DE_RUN, ruta.run)
    if (ruta.tarea) parametros.set(PARAMETRO_DE_TAREA, ruta.tarea)
  }
  return `/?${parametros.toString()}`
}

/** Navegador: lo que recibe toda pantalla para moverse. Un solo tipo, un solo nombre. */
export type Navegar = (destino: Ruta) => void

/**
 * A que pantalla lleva la etapa que le falta a un proyecto.
 *
 * ESTA TABLA VIVE AQUI Y NO EN LA PANTALLA DE PROYECTOS porque ya se usa en
 * tres sitios —la fila de la lista, el rechazo al lanzar un ciclo, y el aviso
 * de la flota sin activar— y la cabecera de `ETAPA_PENDIENTE` en `tipos.ts`
 * dice exactamente eso: tres copias de esta respuesta divergen a la primera.
 * `tipos.ts` no la puede tener porque no conoce `Seccion`; `ruta.ts` si.
 *
 * `ACTIVE` lleva al BOARD del proyecto y no es una excepcion al patron: un
 * proyecto activo no tiene etapa pendiente, tiene un sitio al que ir — su
 * board, que es donde se lanza el trabajo (spec 003: un proyecto es su board).
 * En la 002 llevaba a la pantalla de ciclos, que era el unico sitio desde el
 * que se lanzaba algo.
 */
export const DESTINO_DE_ETAPA: Record<EstadoProyecto, Seccion> = {
  CREATED: 'snapshot',
  DISCOVERED: 'constitution',
  CONSTITUTED: 'bootstrap',
  BOOTSTRAPPED: 'conexiones',
  CONNECTED: 'flota',
  ACTIVE: 'board',
}

export function useRuta(): { ruta: Ruta; navegar: (destino: Ruta) => void } {
  // Se arranca siempre en la ruta inicial para que el HTML prerenderizado y el
  // primer render en el cliente coincidan. La ruta real se lee en el efecto:
  // leer `window.location` durante el render es una discrepancia de hidratacion
  // garantizada.
  const [ruta, setRuta] = useState<Ruta>(RUTA_INICIAL)

  useEffect(() => {
    const sincronizar = () => setRuta(analizarRuta(window.location.search))
    sincronizar()
    window.addEventListener('popstate', sincronizar)
    return () => window.removeEventListener('popstate', sincronizar)
  }, [])

  const navegar = useCallback((destino: Ruta) => {
    window.history.pushState(null, '', construirRuta(destino))
    setRuta(destino)
  }, [])

  return { ruta, navegar }
}
