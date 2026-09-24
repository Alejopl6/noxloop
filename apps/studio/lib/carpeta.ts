'use client'

import { ErrorDelServicio } from '@/lib/daemon'

/**
 * El selector de carpetas, con sus dos superficies (T085).
 *
 * LA ASIMETRIA ES REAL Y NO SE PUEDE TAPAR. En escritorio existe un dialogo
 * nativo de carpeta y devuelve una ruta absoluta del sistema de archivos. En
 * el navegador NO existe: `<input type="file" webkitdirectory>` entrega los
 * archivos de la carpeta, no su ruta —el navegador la oculta a proposito— y
 * `showDirectoryPicker()` entrega un manejador que solo sirve dentro de esa
 * pestana. Ninguno de los dos produce lo que el servicio necesita, que es una
 * ruta que EL pueda abrir en su propio proceso.
 *
 * Asi que el camino alternativo en web no es un selector peor: es otro
 * mecanismo. El operador escribe la ruta. Y la pantalla lo dice con esas
 * palabras, porque un boton "Elegir carpeta" que en web no hace nada es peor
 * que no tener boton.
 *
 * EL PRECEDENTE ES `lib/daemon.ts`, y se sigue al pie de la letra:
 *
 *   1. Nada de este modulo toca `window` al importarse. `isTauri()` de
 *      `@tauri-apps/api/core` lee `window` sin protegerse, asi que en el
 *      prerender de `next build` revienta. Por eso el import es dinamico y
 *      esta DENTRO de la funcion.
 *   2. Todo error que sale de aqui tiene `causa` y `accion` (NFR-006).
 *   3. `@tauri-apps/plugin-dialog` se importa solo cuando ya se sabe que hay
 *      Tauri. En web ese modulo no tiene a quien hablarle.
 */

export type SuperficieDeSeleccion = 'escritorio' | 'web' | 'desconocida'

/**
 * Si esta superficie tiene selector nativo de carpetas.
 *
 * LLAMAR SOLO DESDE UN `useEffect` o desde un manejador de evento. Fuera del
 * navegador devuelve `desconocida` en vez de suponer una de las dos.
 */
export async function superficieDeSeleccion(): Promise<SuperficieDeSeleccion> {
  if (typeof window === 'undefined') return 'desconocida'
  try {
    const nucleo = await import('@tauri-apps/api/core')
    return nucleo.isTauri() ? 'escritorio' : 'web'
  } catch {
    // Si el modulo de Tauri no carga, esto es web. No es un fallo: es la
    // respuesta.
    return 'web'
  }
}

export interface OpcionesDeSeleccion {
  /** Titulo del dialogo nativo. */
  titulo?: string
  /** Donde abrirlo. Una ruta absoluta, si se conoce alguna util. */
  desde?: string
}

/**
 * Abre el selector nativo de carpetas.
 *
 * Devuelve la ruta elegida, o `null` si el operador cerro el dialogo sin
 * elegir —que no es un error y no debe pintarse como uno—.
 *
 * Lanza `ErrorDelServicio` cuando no hay selector que abrir (web) o cuando el
 * dialogo falla: en los dos casos con la accion concreta, que en web es
 * "escribe la ruta absoluta en el campo de al lado".
 */
export async function elegirCarpeta(
  opciones: OpcionesDeSeleccion = {},
): Promise<string | null> {
  const superficie = await superficieDeSeleccion()

  if (superficie !== 'escritorio') {
    throw new ErrorDelServicio({
      codigo: 'sin_selector_de_carpetas',
      causa:
        'No se pudo abrir el selector de carpetas: el navegador no entrega la ruta de una carpeta del disco a una pagina web, ni siquiera despues de que la elijas. Es una restriccion del navegador, no de noxloop, y no tiene rodeo.',
      accion:
        'Escribe la ruta absoluta de la carpeta en el campo. El servicio de control corre en tu maquina y la abre el; esta pantalla solo se la nombra.',
      recurso: 'selector de carpetas',
    })
  }

  let abrir: typeof import('@tauri-apps/plugin-dialog').open
  try {
    ;({ open: abrir } = await import('@tauri-apps/plugin-dialog'))
  } catch (fallo) {
    const detalle = fallo instanceof Error ? fallo.message : String(fallo)
    throw new ErrorDelServicio({
      codigo: 'selector_no_disponible',
      causa: `Fallo la carga del dialogo de archivos del sistema en la aplicacion de escritorio (${detalle}).`,
      accion:
        'Escribe la ruta absoluta de la carpeta en el campo. Si el dialogo no vuelve a abrirse nunca, reinstala la aplicacion de escritorio: le falta el plugin de dialogos.',
      recurso: 'selector de carpetas',
    })
  }

  try {
    const elegida = await abrir({
      directory: true,
      multiple: false,
      title: opciones.titulo ?? 'Elige la carpeta del proyecto',
      defaultPath: opciones.desde,
    })
    // `open` devuelve `null` al cancelar, y con `multiple: false` nunca un
    // array. La comprobacion esta igualmente: si un dia cambia, aqui se ve.
    if (elegida === null || elegida === undefined) return null
    return Array.isArray(elegida) ? (elegida[0] ?? null) : elegida
  } catch (fallo) {
    const detalle = fallo instanceof Error ? fallo.message : String(fallo)
    throw new ErrorDelServicio({
      codigo: 'seleccion_rechazada',
      causa: `Fallo el dialogo de carpetas del sistema al abrirse (${detalle}).`,
      accion: 'Escribe la ruta absoluta de la carpeta en el campo y continua sin el dialogo.',
      recurso: 'selector de carpetas',
    })
  }
}
