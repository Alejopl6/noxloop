'use client'

import { useCallback, useRef, useState } from 'react'

// `ErrorDelServicio` es una clase: sirve de tipo y de constructor a la vez.
import { comoErrorDelServicio, ErrorDelServicio } from '@/lib/daemon'
import { useServicio } from '@/components/proveedor-servicio'

/**
 * Una mutacion contra el servicio.
 *
 * POR QUE ESTO EXISTE Y POR QUE NO ES UN `useLectura` CON METODO. `lectura.ts`
 * dice, con todas las letras, que esta interfaz LEE. Sigue siendo verdad: lo
 * que este modulo hace NO es escribir estado, es PEDIRLE al servicio que lo
 * escriba el. La diferencia no es retorica y es justo el principio VIII de la
 * constitution: el servicio es el unico escritor, y la unica forma que tiene
 * esta aplicacion de cambiar algo es una peticion HTTP que el servicio puede
 * rechazar. No hay aqui `node:fs`, ni ruta de servidor, ni acceso al home del
 * estado — y hay guardas en `npm run guard` que lo comprueban archivo a
 * archivo, no que confian en este comentario.
 *
 * Lo que el hook aporta sobre llamar a `cliente.enviar` a pelo:
 *
 *   1. `trabajando`, para que el boton se apague mientras el servicio decide.
 *      Sin esto, el doble clic manda dos POST y el segundo falla con un
 *      conflicto que el operador no provoco.
 *   2. El error normalizado a `causa` + `accion`, SIEMPRE. Tambien cuando no
 *      hay cliente porque el servicio no esta: ese caso tambien necesita
 *      decir que hacer (NFR-006).
 *   3. Descarte de respuestas de una mutacion que ya no es la vigente: si el
 *      operador pulsa dos veces, gana la ultima y la primera no repinta un
 *      error viejo encima.
 */
export interface Mutacion {
  /** Lanza la peticion. Devuelve `null` si fallo; el error queda en `error`. */
  enviar: <T>(
    metodo: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    ruta: string,
    cuerpo?: unknown,
  ) => Promise<T | null>
  trabajando: boolean
  error: ErrorDelServicio | null
  /** Borra el error. Se llama al reabrir un formulario. */
  limpiar: () => void
}

export function useMutacion(): Mutacion {
  const { cliente } = useServicio()
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState<ErrorDelServicio | null>(null)
  const turno = useRef(0)

  const enviar = useCallback(
    async <T,>(
      metodo: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      ruta: string,
      cuerpo?: unknown,
    ): Promise<T | null> => {
      const mio = ++turno.current
      setTrabajando(true)
      setError(null)

      if (!cliente) {
        // No es un caso raro: en web, hasta que el operador pega el token no
        // hay cliente. Callarse aqui deja un boton que no hace nada.
        if (mio === turno.current) {
          setError(
            new ErrorDelServicio({
              codigo: 'sin_servicio',
              causa: `No se pudo completar ${metodo} ${ruta}: esta interfaz no tiene conexion con el servicio de control, y es el servicio quien escribe el estado — esta pantalla no lo toca nunca.`,
              accion:
                'Comprueba que el servicio de control esta corriendo y vuelve a intentarlo. En escritorio arranca con la aplicacion; en web se arranca con `npm run service`.',
              recurso: `${metodo} ${ruta}`,
            }),
          )
          setTrabajando(false)
        }
        return null
      }

      try {
        const resultado = await cliente.enviar<T>(metodo, ruta, cuerpo)
        if (mio === turno.current) setTrabajando(false)
        return resultado
      } catch (fallo: unknown) {
        if (mio === turno.current) {
          setError(comoErrorDelServicio(fallo, `${metodo} ${ruta}`))
          setTrabajando(false)
        }
        return null
      }
    },
    [cliente],
  )

  const limpiar = useCallback(() => setError(null), [])

  return { enviar, trabajando, error, limpiar }
}
