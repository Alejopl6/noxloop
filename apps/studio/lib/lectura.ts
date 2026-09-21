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
  /**
   * Los avisos que vinieron con una coleccion. Vacio en todo lo demas.
   *
   * NO se descartan al desenvolver, y esa es media razon de que el sobre
   * exista: cuando el servicio lee runs y un archivo de estado esta ilegible,
   * eso tiene que VERSE. Tirarlos aqui dejaria una lista a la que le faltan
   * elementos sin decirlo, que es peor que un error.
   */
  avisos: readonly Aviso[]
  /** El cursor de la siguiente pagina, o `null` si no hay mas. */
  cursor: string | null
}

export interface Aviso {
  codigo: string
  causa: string
  accion: string
}

/** La forma que el contrato da a toda respuesta con varios elementos. */
interface Sobre {
  items: unknown[]
  cursor?: string | null
  avisos?: Aviso[]
}

/**
 * Distingue una coleccion de un objeto suelto.
 *
 * Se comprueba que `items` sea un ARRAY y no solo que exista: un recurso que
 * algun dia tenga un campo llamado `items` seguiria siendo un objeto, y
 * desenvolverlo lo destruiria.
 */
function esSobre(cuerpo: unknown): cuerpo is Sobre {
  return typeof cuerpo === 'object' && cuerpo !== null && Array.isArray((cuerpo as Sobre).items)
}

export function useLectura<T>(
  ruta: string | null,
  opciones: { relerEn?: readonly string[] } = {},
): Lectura<T> {
  const { cliente, estado } = useServicio()
  const { suscribir } = useEventos()
  const [datos, setDatos] = useState<T | null>(null)
  const [avisos, setAvisos] = useState<readonly Aviso[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
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
        // SE DESENVUELVE AQUI, UNA VEZ, Y NO EN TRECE PANTALLAS.
        //
        // EL FALLO QUE ESTO ARREGLA, y llego a produccion local: el contrato
        // declara que toda coleccion viaja en un sobre `{items, cursor,
        // avisos}`, el servicio lo implemento, y la interfaz seguia esperando
        // arrays desnudos. `bandeja.datos.filter(...)` reventaba con
        // "filter is not a function" en cuanto habia servicio de verdad
        // detras — los catalogos con datos de ejemplo no lo veian porque ahi
        // los arrays si son arrays.
        //
        // La decision del sobre se comunico al lado del servicio y NO al de la
        // interfaz. Es el coste de decidir un contrato con dos frentes
        // trabajando en paralelo, y el sitio correcto de pagarlo es este: un
        // punto, no trece.
        if (esSobre(resultado)) {
          setDatos(resultado.items as T)
          setAvisos(resultado.avisos ?? [])
          setCursor(resultado.cursor ?? null)
        } else {
          setDatos(resultado)
          setAvisos([])
          setCursor(null)
        }
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

  return { datos, error, cargando, releer, avisos, cursor }
}
