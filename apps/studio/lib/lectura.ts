'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { comoErrorDelServicio, type ErrorDelServicio } from '@/lib/daemon'
import { useServicio } from '@/components/proveedor-servicio'
import { useEventos } from '@/components/proveedor-eventos'

/**
 * Una lectura del servicio.
 *
 * Se llama `useLectura` y no `useRecurso` a proposito: esta interfaz LEE. No
 * hay aqui ninguna funcion que escriba nada — las mutaciones, cuando existan,
 * iran por `cliente.enviar` y seran explicitas en la pantalla que las hace
 * (constitution, principio VIII).
 *
 * Al fallar, NO se borran los datos que ya habia: se conservan y el error se
 * expone al lado. Vaciar la pantalla ante un corte de red castiga al operador
 * por algo que no hizo. Lo que no se puede hacer es pintarlos como frescos, y
 * de eso se encarga el banner de `estado-servicio`.
 */
export interface Lectura<T> {
  datos: T | null
  error: ErrorDelServicio | null
  cargando: boolean
  releer: () => void
}

export function useLectura<T>(
  ruta: string | null,
  opciones: { relerEn?: readonly string[] } = {},
): Lectura<T> {
  const { cliente, estado } = useServicio()
  const { suscribir } = useEventos()
  const [datos, setDatos] = useState<T | null>(null)
  const [error, setError] = useState<ErrorDelServicio | null>(null)
  const [cargando, setCargando] = useState(false)
  const [revision, setRevision] = useState(0)

  const releer = useCallback(() => setRevision((valor) => valor + 1), [])

  useEffect(() => {
    if (!cliente || !ruta) return
    if (estado !== 'conectado') return

    const abortador = new AbortController()
    let vigente = true

    setCargando(true)
    cliente
      .obtener<T>(ruta, { senal: abortador.signal })
      .then((resultado) => {
        if (!vigente) return
        setDatos(resultado)
        setError(null)
      })
      .catch((fallo: unknown) => {
        if (!vigente) return
        setError(comoErrorDelServicio(fallo, `GET ${ruta}`))
      })
      .finally(() => {
        if (vigente) setCargando(false)
      })

    return () => {
      vigente = false
      abortador.abort()
    }
  }, [cliente, ruta, estado, revision])

  // Releer cuando el servicio avisa de que esto cambio. Es el canal SSE unico
  // haciendo su trabajo: sin el, la bandeja solo se actualizaria recargando.
  const relerEn = opciones.relerEn
  const releerRef = useRef(releer)
  releerRef.current = releer

  useEffect(() => {
    if (!relerEn || relerEn.length === 0) return
    const bajas = relerEn.map((tipo) => suscribir(tipo, () => releerRef.current()))
    return () => bajas.forEach((baja) => baja())
  }, [suscribir, relerEn])

  return { datos, error, cargando, releer }
}
