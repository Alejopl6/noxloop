'use client'

import { ErrorDelServicio } from '@/lib/daemon'

/**
 * Abrir una direccion externa, en las dos superficies.
 *
 * POR QUE NO BASTA UN `<a target="_blank">`. En el navegador si basta. En el
 * webview de escritorio, ese enlace navega DENTRO de la ventana de la
 * aplicacion: el operador acaba con la pagina de autorizacion del proveedor
 * ocupando la consola, sin barra de direcciones, sin poder comprobar el
 * dominio y sin poder volver. Para un flujo donde lo que se pide es que
 * escriba credenciales en el sitio correcto, eso no es un detalle de comodidad:
 * es quitarle la unica forma que tiene de verificar donde esta.
 *
 * Por eso en escritorio se delega en el navegador del sistema.
 *
 * Como en `lib/daemon.ts` y `lib/carpeta.ts`: import dinamico dentro de la
 * funcion —nada toca `window` al importarse, que es lo que revienta el
 * prerender— y todo error sale con causa y accion.
 */
export async function abrirExterno(url: string): Promise<void> {
  if (typeof window === 'undefined') {
    throw new ErrorDelServicio({
      codigo: 'sin_ventana',
      causa: 'Se intento abrir una direccion externa durante el prerender, donde no hay navegador.',
      accion: 'Mueve la llamada a un manejador de evento.',
    })
  }

  let enTauri = false
  try {
    const nucleo = await import('@tauri-apps/api/core')
    enTauri = nucleo.isTauri()
  } catch {
    enTauri = false
  }

  if (enTauri) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(url)
      return
    } catch (fallo) {
      const detalle = fallo instanceof Error ? fallo.message : String(fallo)
      throw new ErrorDelServicio({
        codigo: 'no_se_pudo_abrir',
        causa: `No se pudo abrir ${url} en el navegador del sistema desde la aplicacion de escritorio (${detalle}).`,
        accion: 'Copia la direccion y pegala a mano en tu navegador. Comprueba el dominio antes de escribir nada en esa pagina.',
        recurso: url,
      })
    }
  }

  const abierta = window.open(url, '_blank', 'noopener,noreferrer')
  if (!abierta) {
    throw new ErrorDelServicio({
      codigo: 'ventana_bloqueada',
      causa: `El navegador bloqueo la ventana emergente hacia ${url}.`,
      accion: 'Permite las ventanas emergentes para esta pagina, o copia la direccion y pegala en una pestana nueva.',
      recurso: url,
    })
  }
}
