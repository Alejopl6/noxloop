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

import { ErrorDelServicio } from '@/lib/daemon'
import { TIPOS_DE_EVENTO, type EventoServicio } from '@/lib/tipos'
import { useServicio } from '@/components/proveedor-servicio'

/**
 * T038 · UNA SOLA conexion SSE para toda la aplicacion.
 *
 * Por que una y no una por pantalla, que seria mas simple de escribir:
 *
 * En Linux el webview es WebKitGTK, y hay un tope de conexiones simultaneas por
 * host (reporte comunitario, no documentacion — `research.md` §1 lo declara
 * como no verificado). Un stream SSE es una conexion que no se cierra nunca.
 * Con una por componente, seis pantallas abiertas agotan el cupo y la septima
 * peticion —un `fetch` normal, no otro stream— se queda colgada sin error. El
 * sintoma es "la app se congela a veces", que es el peor sintoma posible.
 *
 * Asi que: un canal, un contexto, y los componentes se suscriben por tipo.
 *
 * El token va en el QUERY STRING porque `EventSource` no manda cabeceras. No
 * hay opcion: la API no las acepta. Ver `ClienteServicio.urlDeEventos`.
 */

type Manejador = (evento: EventoServicio) => void

interface ValorDelContexto {
  /** Se suscribe a un tipo. Devuelve la funcion para darse de baja. */
  suscribir: (tipo: string, manejador: Manejador) => () => void
  canalAbierto: boolean
}

const ContextoEventos = createContext<ValorDelContexto | null>(null)

const ESPERAS_DE_RECONEXION_MS = [1_000, 2_000, 4_000, 8_000, 15_000]
const MAXIMO_IDS_RECORDADOS = 256

/** Guarda contra el error que este modulo existe para evitar. */
let canalesMontados = 0

export function ProveedorDeEventos({ children }: { children: ReactNode }) {
  const { cliente, marcarContacto, marcarCaida } = useServicio()
  const [canalAbierto, setCanalAbierto] = useState(false)

  // El id del ultimo evento vive SOLO en una ref. Como estado publicaria un
  // render por evento recibido, y nadie lo pinta: su unico uso es viajar en la
  // reconexion como `Last-Event-ID`.
  const suscriptores = useRef<Map<string, Set<Manejador>>>(new Map())
  const ultimoId = useRef<string | null>(null)
  const idsVistos = useRef<string[]>([])
  const fallosSeguidos = useRef(0)

  const suscribir = useCallback((tipo: string, manejador: Manejador) => {
    const mapa = suscriptores.current
    let conjunto = mapa.get(tipo)
    if (!conjunto) {
      conjunto = new Set()
      mapa.set(tipo, conjunto)
    }
    conjunto.add(manejador)
    return () => {
      conjunto.delete(manejador)
      if (conjunto.size === 0) mapa.delete(tipo)
    }
  }, [])

  useEffect(() => {
    canalesMontados += 1
    if (canalesMontados > 1) {
      console.error(
        '[noxloop] Hay mas de un <ProveedorDeEventos> montado. El canal SSE debe ser unico para toda la aplicacion: varias conexiones de larga vida agotan el tope de conexiones por host del webview de Linux.',
      )
    }
    return () => {
      canalesMontados -= 1
    }
  }, [])

  useEffect(() => {
    if (!cliente) return

    let vigente = true
    let fuente: EventSource | null = null
    let temporizador: ReturnType<typeof setTimeout> | null = null

    const yaVisto = (id: string | null): boolean => {
      if (!id) return false
      if (idsVistos.current.includes(id)) return true
      idsVistos.current.push(id)
      if (idsVistos.current.length > MAXIMO_IDS_RECORDADOS) idsVistos.current.shift()
      return false
    }

    const repartir = (tipo: string, evento: EventoServicio) => {
      const conjunto = suscriptores.current.get(tipo)
      if (!conjunto) return
      for (const manejador of conjunto) {
        try {
          manejador(evento)
        } catch (fallo) {
          console.error(`[noxloop] Un suscriptor de "${tipo}" lanzo:`, fallo)
        }
      }
    }

    /**
     * El contrato dice que cada evento lleva `id`, `tipo` y `datos`, pero no
     * fija si el tipo viaja en el campo `event:` de SSE o dentro del JSON. Se
     * aceptan las dos formas y se deduplica por id, que es lo unico que no
     * cambia entre ellas. Un cliente que solo entiende una de las dos se rompe
     * el dia que el servicio cambia de estilo, y el sintoma es "dejaron de
     * llegar eventos", sin error en ningun sitio.
     */
    const procesar = (mensaje: MessageEvent<string>, tipoDelCampoEvent?: string) => {
      marcarContacto()

      let cargaUtil: Partial<EventoServicio> = {}
      try {
        cargaUtil = JSON.parse(mensaje.data) as Partial<EventoServicio>
      } catch {
        // Un evento que no es JSON no es interpretable, pero SI es contacto:
        // el servicio esta vivo. Se descarta el contenido, no la senal.
        return
      }

      const id = mensaje.lastEventId || (typeof cargaUtil.id === 'string' ? cargaUtil.id : null)
      if (yaVisto(id)) return

      const tipo = tipoDelCampoEvent ?? (typeof cargaUtil.tipo === 'string' ? cargaUtil.tipo : null)
      if (!tipo) return

      if (id) ultimoId.current = id

      const evento: EventoServicio = {
        id,
        tipo,
        project_id: (cargaUtil.project_id as string | null | undefined) ?? null,
        datos: cargaUtil.datos ?? cargaUtil,
      }

      repartir(tipo, evento)
      // Canal comodin, para quien quiera verlo todo (trazas, depuracion).
      repartir('*', evento)
    }

    const programarReconexion = () => {
      if (!vigente) return
      const indice = Math.min(fallosSeguidos.current, ESPERAS_DE_RECONEXION_MS.length - 1)
      const espera = ESPERAS_DE_RECONEXION_MS[indice] ?? 15_000
      fallosSeguidos.current += 1
      temporizador = setTimeout(() => {
        if (vigente) abrir()
      }, espera)
    }

    const abrir = () => {
      if (!vigente) return
      // `Last-Event-ID` va tambien en el query: el navegador solo manda la
      // cabecera en SUS reconexiones automaticas, no cuando somos nosotros los
      // que abrimos un `EventSource` nuevo. Sin esto, cada reconexion nuestra
      // perderia el hueco (el contrato responde `sincronizar_completo` si el
      // hueco excede su buffer, pero solo si sabe desde donde).
      fuente = new EventSource(cliente.urlDeEventos(ultimoId.current))

      fuente.onopen = () => {
        fallosSeguidos.current = 0
        setCanalAbierto(true)
        marcarContacto()
      }

      fuente.onmessage = (mensaje) => procesar(mensaje as MessageEvent<string>)

      for (const tipo of TIPOS_DE_EVENTO) {
        fuente.addEventListener(tipo, (mensaje) =>
          procesar(mensaje as MessageEvent<string>, tipo),
        )
      }

      fuente.onerror = () => {
        setCanalAbierto(false)
        if (!vigente) return

        marcarCaida(
          new ErrorDelServicio({
            codigo: 'canal_de_eventos_caido',
            causa: `Se perdio el canal de eventos con el servicio de control en ${cliente.origen.url}. Lo que hay en pantalla es lo ultimo que se supo, y puede estar desactualizado.`,
            accion:
              'No hace falta hacer nada: la aplicacion reintenta sola y recupera lo que se perdio. Si el aviso no desaparece, comprueba que el servicio sigue corriendo.',
            recurso: 'GET /v1/events',
          }),
        )

        // `EventSource` reintenta solo mientras el estado sea CONNECTING. Si
        // paso a CLOSED, no volvera por si mismo: hay que reabrirlo.
        if (fuente && fuente.readyState === EventSource.CLOSED) {
          fuente.close()
          fuente = null
          programarReconexion()
        }
      }
    }

    abrir()

    return () => {
      vigente = false
      if (temporizador) clearTimeout(temporizador)
      fuente?.close()
      fuente = null
      setCanalAbierto(false)
    }
  }, [cliente, marcarContacto, marcarCaida])

  const valor = useMemo<ValorDelContexto>(
    () => ({ suscribir, canalAbierto }),
    [suscribir, canalAbierto],
  )

  return <ContextoEventos.Provider value={valor}>{children}</ContextoEventos.Provider>
}

export function useEventos(): ValorDelContexto {
  const valor = useContext(ContextoEventos)
  if (!valor) {
    throw new Error(
      'useEventos() se llamo fuera de <ProveedorDeEventos>. Envuelve el arbol en app/layout.tsx.',
    )
  }
  return valor
}

/** Suscribe un manejador a un tipo de evento durante la vida del componente. */
export function useEventoDelServicio(tipo: string, manejador: Manejador): void {
  const { suscribir } = useEventos()
  const referencia = useRef(manejador)
  referencia.current = manejador

  useEffect(() => {
    return suscribir(tipo, (evento) => referencia.current(evento))
  }, [suscribir, tipo])
}
