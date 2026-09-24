'use client'

import { useCallback, useRef, useState } from 'react'

import { abrirExterno } from '@/lib/enlace'
import type { Mutacion } from '@/lib/mutacion'
import type { AutorizacionDeConexion, Conexion } from '@/lib/tipos'

/**
 * Lo que pasa DESPUES de que el servicio devuelva la URL de autorizacion.
 *
 * -------------------------------------------------------------------------
 * EL BOTON QUE NO HACIA NADA, Y ES EL MOTIVO DE QUE ESTO EXISTA
 * -------------------------------------------------------------------------
 *
 * `POST /v1/connections/authorize` devolvia la URL, la pantalla la pintaba, y
 * ahi se acababa. El aviso decia «Esta pantalla se entera sola cuando el
 * proveedor conteste» y NO era verdad: la pantalla solo relee al recibir un
 * evento `conexion.estado`, y ese evento lo emite el callback del servicio —
 * que nadie llamaba nunca. El operador autorizaba en su navegador y se quedaba
 * mirando un aviso que no iba a cambiar.
 *
 * Como el adaptador que abria flujos de autorizacion era un hueco declarado,
 * ese camino no se podia recorrer y el agujero no se veia. Con el adaptador
 * lleno, es el camino principal.
 *
 * -------------------------------------------------------------------------
 * POR QUE VIVE EN UN SOLO SITIO
 * -------------------------------------------------------------------------
 *
 * Dos pantallas conectan cuentas: la de conexiones y el alta de proyecto. Con
 * una copia en cada una, la segunda se queda sin el sondeo el dia que alguien
 * toque la primera — que es exactamente como nacio el agujero de arriba.
 *
 * -------------------------------------------------------------------------
 * POR QUE SONDEO Y NO UN AVISO DEL SERVIDOR
 * -------------------------------------------------------------------------
 *
 * Los avisos no estan garantizados en la edicion gratuita del servidor de
 * integraciones, y ademas exigirian un servidor escuchando en la maquina del
 * operador: justo el puerto que ya ocupa el callback, que no se puede mover
 * porque esta registrado como direccion de retorno en cada proveedor.
 *
 * -------------------------------------------------------------------------
 * POR QUE EL NAVEGADOR DEL SISTEMA Y NO ESTA VENTANA
 * -------------------------------------------------------------------------
 *
 * Varios proveedores bloquean los navegadores embebidos por politica. Y aunque
 * no lo hicieran: dentro del webview no hay barra de direcciones, asi que al
 * operador se le pediria que escriba sus credenciales en una pagina cuyo
 * dominio no puede comprobar.
 */

/** Cuanto se sonda antes de rendirse. Un sondeo sin limite gira para siempre. */
export const LIMITE_DE_ESPERA_MS = 5 * 60 * 1000

/** Cada cuanto se pregunta. */
export const INTERVALO_DE_SONDEO_MS = 1000

export interface Autorizacion {
  /** Hay un flujo abierto y esta pantalla lo esta sondeando. */
  esperando: boolean
  /**
   * Abre el navegador y sondea hasta que la conexion aparece.
   *
   * Devuelve la conexion cuando el proveedor contesta; `null` si se agoto la
   * espera, si se cancelo, o si la respuesta no traia URL —en los modos sin
   * autorizacion no hay nada que completar—. El error de la ultima llamada
   * queda en la mutacion que se le paso, con causa y accion.
   */
  completar: (respuesta: AutorizacionDeConexion) => Promise<Conexion | null>
  /** Corta el sondeo en curso. Se llama al desmontar o al cambiar de proveedor. */
  cancelar: () => void
}

/**
 * @param mutacion la misma mutacion con la que se pidio autorizar: su error es
 *   el que la pantalla ya esta pintando, y usar otra partiria el mensaje en dos
 *   sitios distintos de la pantalla.
 */
export function useAutorizacion(mutacion: Mutacion): Autorizacion {
  const [esperando, setEsperando] = useState(false)
  const vigente = useRef(0)

  const cancelar = useCallback(() => {
    vigente.current += 1
    setEsperando(false)
  }, [])

  const completar = useCallback(
    async (respuesta: AutorizacionDeConexion): Promise<Conexion | null> => {
      // SIN URL NO HAY NADA QUE COMPLETAR, y devolver aqui la conexion que ya
      // trae la respuesta seria mentir sobre lo que hizo este hook: en los
      // modos sin autorizacion la conexion nace lista en el `authorize`, y es
      // esa respuesta —no esta— la que la pantalla tiene que leer.
      if (!respuesta.url_autorizacion) return null
      const mio = ++vigente.current
      setEsperando(true)
      try {
        try {
          await abrirExterno(respuesta.url_autorizacion)
        } catch {
          // EL SONDEO SIGUE AUNQUE EL NAVEGADOR NO SE ABRA. El operador tiene
          // la direccion delante y un boton para copiarla: si la pega a mano,
          // esta pantalla tiene que enterarse igual. Abortar aqui lo castigaria
          // por una politica de bloqueo de ventanas que no eligio.
        }

        const hasta = Date.now() + LIMITE_DE_ESPERA_MS
        while (Date.now() < hasta) {
          if (vigente.current !== mio) return null
          // EL SERVICIO DISTINGUE «TODAVIA NO» DE «ALGO SE ROMPIO», y por eso
          // aqui no hay ningun codigo de error que ignorar: mientras el
          // operador autoriza, la respuesta es 200 con `esperando: true`. Un
          // `null` es un error de verdad —un handle que ya no existe, una
          // conexion revocada— y entonces se corta: seguir sondeando dejaria la
          // pantalla girando cinco minutos sobre algo que no va a llegar.
          const lista = await mutacion.enviar<{ conexion?: Conexion | null; esperando?: boolean }>(
            'POST',
            `/v1/connections/${encodeURIComponent(respuesta.session_token)}/callback`,
          )
          if (lista === null) return null
          if (lista.conexion) return lista.conexion
          await new Promise((listo) => window.setTimeout(listo, INTERVALO_DE_SONDEO_MS))
        }
        return null
      } finally {
        if (vigente.current === mio) setEsperando(false)
      }
    },
    [mutacion],
  )

  return { esperando, completar, cancelar }
}
