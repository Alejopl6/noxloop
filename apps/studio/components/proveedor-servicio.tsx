'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  comoErrorDelServicio,
  crearCliente,
  resolverOrigen,
  type ClienteServicio,
  type ErrorDelServicio,
} from '@/lib/daemon'
import type { Salud } from '@/lib/tipos'

/**
 * T039 · El estado de la conexion con el servicio, para toda la aplicacion.
 *
 * Cuatro estados, y la diferencia entre dos de ellos es lo que FR-005 pide:
 *
 * - `iniciando`     todavia no sabemos nada. No se afirma nada en pantalla.
 * - `conectado`     hay contacto reciente. Lo que se ve es fresco.
 * - `sin_servicio`  nunca hubo contacto. No hay datos que mostrar: pantalla
 *                   completa que lo dice, con causa y accion.
 * - `sin_conexion`  lo hubo y se perdio. Los datos siguen en pantalla pero
 *                   estan RANCIOS, y la aplicacion lo declara con un banner
 *                   permanente. Nunca se pintan como frescos.
 */
export type EstadoDeConexion = 'iniciando' | 'conectado' | 'sin_servicio' | 'sin_conexion'

interface ValorDelContexto {
  estado: EstadoDeConexion
  cliente: ClienteServicio | null
  salud: Salud | null
  error: ErrorDelServicio | null
  /** Instante del ultimo contacto con exito, o `null` si nunca lo hubo. */
  ultimoContacto: number | null
  /** Atajo honesto: `false` significa "lo que estas viendo puede estar viejo". */
  datosFrescos: boolean
  /** Fuerza un intento inmediato. Es lo que cuelga del boton de la pantalla. */
  reintentar: () => void
  /** Lo llama el canal de eventos cuando recibe algo: es contacto con el servicio. */
  marcarContacto: () => void
  /** Lo llama el canal de eventos cuando el stream se cae. */
  marcarCaida: (fallo: ErrorDelServicio) => void
}

const ContextoServicio = createContext<ValorDelContexto | null>(null)

const ESPERAS_DE_REINTENTO_MS = [1_000, 2_000, 4_000, 8_000, 15_000]
const INTERVALO_DE_LATIDO_MS = 15_000

export function ProveedorDeServicio({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoDeConexion>('iniciando')
  const [cliente, setCliente] = useState<ClienteServicio | null>(null)
  const [salud, setSalud] = useState<Salud | null>(null)
  const [error, setError] = useState<ErrorDelServicio | null>(null)
  const [ultimoContacto, setUltimoContacto] = useState<number | null>(null)
  const [intento, setIntento] = useState(0)

  // `useRef` y no estado: saber si alguna vez hubo contacto decide entre
  // "pantalla completa" y "banner", y no debe provocar un render por si solo.
  const huboContactoAlgunaVez = useRef(false)
  const fallosSeguidos = useRef(0)
  const instanteDeContacto = useRef<number | null>(null)
  const codigoDelUltimoFallo = useRef<string | null>(null)

  // El cliente se conserva entre latidos. Si se creara uno nuevo cada vez, su
  // identidad cambiaria, y el efecto del canal SSE —que depende de ella—
  // cerraria y reabriria el stream cada 15 segundos. Una conexion de larga
  // vida que se reinicia sola no es una conexion de larga vida.
  const clienteVigente = useRef<ClienteServicio | null>(null)

  const reintentar = useCallback(() => {
    setIntento((valor) => valor + 1)
  }, [])

  const marcarContacto = useCallback(() => {
    huboContactoAlgunaVez.current = true
    fallosSeguidos.current = 0
    codigoDelUltimoFallo.current = null

    // Esto lo llama el canal de eventos en CADA evento recibido. Durante un
    // scan son cientos por segundo: publicar el instante exacto de cada uno
    // repintaria la aplicacion entera con cada archivo escaneado, para mover un
    // texto que dice "hace un momento". Se publica como mucho cada 2 segundos.
    const ahora = Date.now()
    const previo = instanteDeContacto.current
    instanteDeContacto.current = ahora
    if (previo === null || ahora - previo > 2_000) setUltimoContacto(ahora)

    setEstado((anterior) => (anterior === 'conectado' ? anterior : 'conectado'))
    setError((anterior) => (anterior === null ? anterior : null))
  }, [])

  const marcarCaida = useCallback((fallo: ErrorDelServicio) => {
    // Un stream que no levanta dispara `onerror` en cada reintento. Publicar un
    // error nuevo cada vez es el mismo repintado inutil, y el texto en pantalla
    // no cambia: es el mismo fallo.
    if (codigoDelUltimoFallo.current !== fallo.codigo) {
      codigoDelUltimoFallo.current = fallo.codigo
      setError(fallo)
    }
    setEstado(huboContactoAlgunaVez.current ? 'sin_conexion' : 'sin_servicio')
  }, [])

  useEffect(() => {
    // TODO el acceso a `window`, a `isTauri()` y a los plugins de Tauri vive
    // aqui dentro. En el prerender de `next build` no hay `window`, y llamar a
    // `isTauri()` fuera de un efecto rompe el build (research.md §1).
    let vigente = true
    let temporizador: ReturnType<typeof setTimeout> | null = null

    const programarReintento = () => {
      if (!vigente) return
      const indice = Math.min(fallosSeguidos.current, ESPERAS_DE_REINTENTO_MS.length - 1)
      const espera = ESPERAS_DE_REINTENTO_MS[indice] ?? 15_000
      temporizador = setTimeout(() => {
        if (vigente) setIntento((valor) => valor + 1)
      }, espera)
    }

    const conectar = async () => {
      try {
        const origen = await resolverOrigen()

        let elCliente = clienteVigente.current
        if (
          !elCliente ||
          elCliente.origen.url !== origen.url ||
          elCliente.origen.token !== origen.token ||
          elCliente.origen.modo !== origen.modo
        ) {
          elCliente = crearCliente(origen)
          clienteVigente.current = elCliente
          setCliente(elCliente)
        }

        const saludLeida = await elCliente.salud()
        if (!vigente) return

        setSalud(saludLeida)
        marcarContacto()

        // Latido. El canal SSE es la senal principal de vida, pero no se puede
        // depender solo de el: un stream puede quedarse abierto y mudo.
        temporizador = setTimeout(() => {
          if (vigente) setIntento((valor) => valor + 1)
        }, INTERVALO_DE_LATIDO_MS)
      } catch (fallo) {
        if (!vigente) return
        fallosSeguidos.current += 1
        marcarCaida(comoErrorDelServicio(fallo, 'GET /v1/health'))
        programarReintento()
      }
    }

    void conectar()

    return () => {
      vigente = false
      if (temporizador) clearTimeout(temporizador)
    }
  }, [intento, marcarCaida, marcarContacto])

  const valor = useMemo<ValorDelContexto>(
    () => ({
      estado,
      cliente,
      salud,
      error,
      ultimoContacto,
      datosFrescos: estado === 'conectado',
      reintentar,
      marcarContacto,
      marcarCaida,
    }),
    [estado, cliente, salud, error, ultimoContacto, reintentar, marcarContacto, marcarCaida],
  )

  return <ContextoServicio.Provider value={valor}>{children}</ContextoServicio.Provider>
}

export function useServicio(): ValorDelContexto {
  const valor = useContext(ContextoServicio)
  if (!valor) {
    throw new Error(
      'useServicio() se llamo fuera de <ProveedorDeServicio>. Envuelve el arbol en app/layout.tsx.',
    )
  }
  return valor
}
