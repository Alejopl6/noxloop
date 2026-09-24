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
 * se alcanza escribiendo `?vista=catalogo`.
 */
export type Seccion =
  | 'inicio'
  | 'asistente'
  | 'bandeja'
  | 'proyectos'
  | 'proyecto-nuevo'
  | 'snapshot'
  | 'constitution'
  | 'bootstrap'
  | 'conexiones'
  | 'flota'
  | 'runs'
  | 'credenciales'
  | 'auditoria'
  | 'catalogo'

/**
 * Las secciones que NO SE PUEDEN ABRIR SIN UN PROYECTO.
 *
 * Existe como lista propia porque el marco pregunta esto tres veces —para
 * saber si pinta el conmutador de proyecto, para saber que grupo de la
 * navegacion se despliega, y para decidir la miga del medio— y porque de ella
 * se deriva `PARAMETRO_DE_ID` justo debajo.
 *
 * EL FALLO QUE EVITA DERIVARLO: el dia que se anada una septima etapa, quien
 * la anada la escribe en `Seccion` y en la navegacion, y se olvida de darle
 * entrada en `PARAMETRO_DE_ID`. Entonces `construirRuta` descarta el
 * identificador en silencio, la direccion queda sin `?proyecto=`, todo parece
 * funcionar mientras no se recargue, y al recargar la pantalla dice que falta
 * el proyecto. Con la tabla derivada de esta lista ese olvido no se puede
 * cometer.
 */
export const SECCIONES_DE_PROYECTO = [
  'snapshot',
  'constitution',
  'bootstrap',
  'conexiones',
  'flota',
  'runs',
] as const satisfies readonly Seccion[]

export type SeccionDeProyecto = (typeof SECCIONES_DE_PROYECTO)[number]

/**
 * Todo lo que VIAJA CON UN IDENTIFICADOR DE PROYECTO, que ya no es lo mismo
 * que las seis etapas.
 *
 * `asistente` no es una etapa: es el recorrido entero, y por eso no entra en
 * `SECCIONES_DE_PROYECTO` —esa lista la consume la navegacion de segundo nivel
 * y el orden de sus seis entradas ES la maquina de estados—. Pero si lleva
 * `?proyecto=`, y el fallo que separar las dos listas evita es exactamente el
 * que ya describe la cabecera de `PARAMETRO_DE_ID`: sin entrada ahi, la
 * direccion del asistente se construye sin el proyecto, todo funciona hasta
 * que el operador recarga, y al recargar el asistente dice que no sabe de que
 * proyecto habla.
 *
 * El asistente SIN proyecto es legitimo —es su primer paso, elegir o crear
 * uno— asi que aqui lo que se declara es que el parametro EXISTE, no que sea
 * obligatorio.
 */
export const SECCIONES_CON_PROYECTO = [
  'asistente',
  ...SECCIONES_DE_PROYECTO,
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
  'inicio',
  'asistente',
  'bandeja',
  'proyectos',
  'proyecto-nuevo',
  'snapshot',
  'constitution',
  'bootstrap',
  'conexiones',
  'flota',
  'runs',
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
}

export const RUTA_INICIAL: Ruta = { seccion: 'inicio', id: null }

/** Como se llama el paso del asistente en la direccion. */
const PARAMETRO_DE_PASO = 'paso'

export function analizarRuta(busqueda: string): Ruta {
  const parametros = new URLSearchParams(busqueda)
  const vista = parametros.get('vista')
  if (!esSeccion(vista) || vista === 'inicio') return RUTA_INICIAL

  const nombre = PARAMETRO_DE_ID[vista]
  return {
    seccion: vista,
    id: nombre ? parametros.get(nombre) : null,
    paso: vista === 'asistente' ? parametros.get(PARAMETRO_DE_PASO) : null,
  }
}

export function construirRuta(ruta: Ruta): string {
  if (ruta.seccion === 'inicio') return '/'
  const parametros = new URLSearchParams({ vista: ruta.seccion })
  const nombre = PARAMETRO_DE_ID[ruta.seccion]
  if (nombre && ruta.id) parametros.set(nombre, ruta.id)
  if (ruta.seccion === 'asistente' && ruta.paso) {
    parametros.set(PARAMETRO_DE_PASO, ruta.paso)
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
 * `ACTIVE` lleva a `runs` y no es una excepcion al patron: un proyecto activo
 * no tiene etapa pendiente, tiene un sitio al que ir — lanzar. Antes de que
 * existiera esa pantalla, `CONNECTED` y `ACTIVE` valian `null` y la fila se
 * quedaba sin boton, que es lo correcto mientras el destino no existe: un
 * boton que no lleva a ningun sitio hace creer al operador que el camino esta
 * y que el no lo encuentra.
 */
export const DESTINO_DE_ETAPA: Record<EstadoProyecto, Seccion> = {
  CREATED: 'snapshot',
  DISCOVERED: 'constitution',
  CONSTITUTED: 'bootstrap',
  BOOTSTRAPPED: 'conexiones',
  CONNECTED: 'flota',
  ACTIVE: 'runs',
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
