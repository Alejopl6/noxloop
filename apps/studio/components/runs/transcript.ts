import type {
  EventoDeTranscript,
  FaseDeTranscript,
  TokensDeFase,
  TranscriptDeTarea,
} from '@/lib/tipos'

/**
 * LO QUE EL DETALLE DE UN RUN CALCULA DEL TRANSCRIPT, y nada mas (spec 004, US2).
 *
 * El transcript lo escribe el motor —redactado— y lo pagina el servicio. Lo
 * que queda aqui es lo que depende de lo que el operador esta mirando: como
 * se DICEN los tokens («sin medir» no es cero), como se junta una herramienta
 * con su resultado para plegarlas juntas, y como se AÑADE lo que llega en vivo
 * sin duplicar ni perder lineas. Sin JSX a proposito: se prueba con `node
 * --test` importando el `.ts` tal cual (`test/transcript.test.mjs`).
 */

const SIN_MEDIR: TokensDeFase = { medido: false, entrada: null, salida: null, cacheLectura: null, cacheEscritura: null }

/** `REVIEW·seguridad`, `GREEN`: la identidad de una fase dentro de una tarea. */
export function claveDeFase(fase: Pick<FaseDeTranscript, 'fase' | 'lente'>): string {
  return fase.lente ? `${fase.fase}·${fase.lente}` : fase.fase
}

/** 1200 -> «1,2 k». Un numero de tokens se lee por su orden de magnitud. */
function compacto(n: number): string {
  if (n < 1000) return String(n)
  const k = n / 1000
  if (k < 1000) return `${k < 10 ? k.toFixed(1).replace('.', ',').replace(/,0$/, '') : Math.round(k)} k`
  const m = k / 1000
  return `${m < 10 ? m.toFixed(1).replace('.', ',').replace(/,0$/, '') : Math.round(m)} M`
}

/**
 * Los tokens, en palabras. «sin medir» cuando el runtime no los reporto: pintar
 * `0` ahi seria inventar un gasto que nadie midio (FR-006).
 */
export function formatearTokens(tokens: TokensDeFase | null | undefined): string {
  if (!tokens || !tokens.medido || tokens.entrada == null || tokens.salida == null) return 'sin medir'
  const partes = [`${compacto(tokens.entrada)} entrada`, `${compacto(tokens.salida)} salida`]
  if (tokens.cacheLectura) partes.push(`${compacto(tokens.cacheLectura)} de cache`)
  return partes.join(' · ')
}

/** Suma de dos cantidades que pueden faltar: si faltan las dos, falta la suma. */
const sumar = (a: number | null, b: number | null): number | null => (a == null && b == null ? null : (a ?? 0) + (b ?? 0))

/**
 * El total de varias fases. UNA SIN MEDIR LO DEJA SIN MEDIR: un total con una
 * parte sin contar se lee como el gasto entero y es menos. La misma regla que
 * el servicio aplica en `total` y en `/v1/usage`.
 */
export function totalDeTokens(lista: readonly TokensDeFase[]): TokensDeFase {
  if (lista.length === 0 || lista.some((t) => !t.medido)) return { ...SIN_MEDIR }
  return lista.reduce<TokensDeFase>(
    (acc, t) => ({
      medido: true,
      entrada: sumar(acc.entrada, t.entrada),
      salida: sumar(acc.salida, t.salida),
      cacheLectura: sumar(acc.cacheLectura, t.cacheLectura),
      cacheEscritura: sumar(acc.cacheEscritura, t.cacheEscritura),
    }),
    { ...SIN_MEDIR, medido: true },
  )
}

/** Lo que se pinta: un bloque por mensaje, y la herramienta con su resultado dentro. */
export type BloqueDeTranscript =
  | { tipo: 'texto'; clave: string; evento: EventoDeTranscript }
  | { tipo: 'resultado'; clave: string; evento: EventoDeTranscript }
  | { tipo: 'error'; clave: string; evento: EventoDeTranscript }
  | {
      tipo: 'herramienta'
      clave: string
      nombre: string
      llamada: EventoDeTranscript | null
      resultado: EventoDeTranscript | null
    }

/**
 * Junta cada `herramienta` con el `resultado_herramienta` que le corresponde.
 *
 * SE CASAN POR NOMBRE Y EN ORDEN: el primer resultado de `Read` es de la
 * primera llamada a `Read` que todavia no tenia. El runtime puede lanzar varias
 * antes de recibir ninguna, y casar «con la anterior» pegaria el resultado de
 * `Read` a la llamada de `Bash`. Un resultado sin llamada (se pagino antes) se
 * muestra igual, solo: perderlo seria peor.
 */
export function agruparEventos(eventos: readonly EventoDeTranscript[]): BloqueDeTranscript[] {
  const bloques: BloqueDeTranscript[] = []
  const pendientes = new Map<string, Array<Extract<BloqueDeTranscript, { tipo: 'herramienta' }>>>()
  eventos.forEach((evento, i) => {
    const clave = `${i}-${evento.t}`
    if (evento.tipo === 'herramienta') {
      const nombre = evento.herramienta ?? 'herramienta'
      const bloque = { tipo: 'herramienta' as const, clave, nombre, llamada: evento, resultado: null }
      bloques.push(bloque)
      const cola = pendientes.get(nombre) ?? []
      cola.push(bloque)
      pendientes.set(nombre, cola)
      return
    }
    if (evento.tipo === 'resultado_herramienta') {
      const nombre = evento.herramienta ?? 'herramienta'
      const esperando = pendientes.get(nombre)?.shift()
      if (esperando) esperando.resultado = evento
      else bloques.push({ tipo: 'herramienta', clave, nombre, llamada: null, resultado: evento })
      return
    }
    bloques.push({ tipo: evento.tipo, clave, evento })
  })
  return bloques
}

/** Los campos que dicen QUE hace una llamada, en el orden en que se buscan. */
const CAMPOS_QUE_DICEN = ['command', 'file_path', 'pattern', 'query', 'url', 'path', 'description', 'prompt']
const RESUMEN_MAXIMO = 120

const recortar = (texto: string) =>
  texto.length > RESUMEN_MAXIMO ? `${texto.slice(0, RESUMEN_MAXIMO - 1)}…` : texto

/**
 * La entrada de una herramienta en UNA linea, para la cabecera plegada.
 *
 * Del JSON se toma el campo que dice que hace —el comando, el archivo, el
 * patron— y no el primero que venga: en `Write` el primero puede ser el
 * contenido entero del archivo. Lo que no es JSON se muestra tal cual,
 * recortado.
 */
export function resumirEntrada(contenido: string): string {
  const limpio = contenido.trim()
  if (limpio.startsWith('{')) {
    try {
      const objeto = JSON.parse(limpio) as Record<string, unknown>
      for (const campo of CAMPOS_QUE_DICEN) {
        const valor = objeto[campo]
        if (typeof valor === 'string' && valor.trim()) return recortar(valor.trim().split('\n')[0])
      }
      return recortar(JSON.stringify(objeto))
    } catch {
      /* no era JSON: se muestra como texto */
    }
  }
  return recortar(limpio.split('\n')[0] ?? '')
}

/**
 * Añade a lo que ya se tiene el tramo NUEVO que trajo el servicio.
 *
 * Por fase: los eventos nuevos se pegan desde la linea en que empieza el tramo
 * (`desde`), cortando lo que ya se tenia a partir de ahi —asi dos avisos
 * seguidos que traen lo mismo no lo duplican—. Los tokens y los contadores son
 * los del servidor, nunca una suma local. Una fase que no vino en el tramo se
 * queda como estaba; una fase nueva se añade al final, que es cuando empezo.
 */
export function fusionarTranscript(actual: TranscriptDeTarea | null, nuevo: TranscriptDeTarea): TranscriptDeTarea {
  if (!actual || actual.tareaId !== nuevo.tareaId || actual.itemId !== nuevo.itemId) return nuevo
  const porClave = new Map(nuevo.fases.map((f) => [claveDeFase(f), f]))
  const fases = actual.fases.map((f) => {
    const llegada = porClave.get(claveDeFase(f))
    if (!llegada) return f
    porClave.delete(claveDeFase(f))
    const base = f.eventos.slice(0, Math.max(0, llegada.desde - f.desde))
    return { ...llegada, desde: f.desde, eventos: [...base, ...llegada.eventos] }
  })
  return {
    ...nuevo,
    fases: [...fases, ...porClave.values()],
    total: totalDeTokens([...fases, ...porClave.values()].map((f) => f.tokens)),
  }
}
