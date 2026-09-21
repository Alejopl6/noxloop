'use client'

import { useCallback, useEffect, useState } from 'react'

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
export type Seccion = 'inicio' | 'bandeja' | 'catalogo'

export interface Ruta {
  seccion: Seccion
  /** Identificador dentro de la seccion, cuando lo hay. */
  id: string | null
}

export const RUTA_INICIAL: Ruta = { seccion: 'inicio', id: null }

export function analizarRuta(busqueda: string): Ruta {
  const parametros = new URLSearchParams(busqueda)
  const vista = parametros.get('vista')
  if (vista === 'bandeja') {
    return { seccion: 'bandeja', id: parametros.get('entrada') }
  }
  if (vista === 'catalogo') {
    return { seccion: 'catalogo', id: null }
  }
  return RUTA_INICIAL
}

export function construirRuta(ruta: Ruta): string {
  if (ruta.seccion === 'inicio') return '/'
  const parametros = new URLSearchParams({ vista: ruta.seccion })
  // El identificador solo significa algo dentro de la bandeja. Arrastrarlo a
  // otra seccion produciria una direccion que recarga a un sitio distinto del
  // que se estaba mirando.
  if (ruta.seccion === 'bandeja' && ruta.id) parametros.set('entrada', ruta.id)
  return `/?${parametros.toString()}`
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
