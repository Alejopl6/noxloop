'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlertTriangle, ChevronRight, CircleCheck, Wrench } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { Markdown } from '@/components/ui/markdown'
import { FalloDeLectura } from '@/components/pantalla'
import { useServicio } from '@/components/proveedor-servicio'
import { useEventoDelServicio } from '@/components/proveedor-eventos'
import {
  agruparEventos,
  claveDeFase,
  formatearTokens,
  fusionarTranscript,
  resumirEntrada,
  type BloqueDeTranscript,
} from '@/components/runs/transcript'
import { runtimesDeLosEventos } from '@/components/runs/handoff'
import {
  EVENTO_DE_TRANSCRIPT,
  RUTAS_DEL_TRANSCRIPT,
  comoErrorDelServicio,
  type ErrorDelServicio,
} from '@/lib/daemon'
import type { AvisoDeTranscript, EventoServicio, FaseDeTranscript, TranscriptDeTarea } from '@/lib/tipos'
import { cn } from '@/lib/utils'

/**
 * LO QUE EL AGENTE FUE DICIENDO Y HACIENDO, por fase (spec 004, US2, FR-006).
 *
 * Una pestaña por fase —RED, GREEN, cada lente de REVIEW— con sus tokens, y el
 * total de la tarea arriba. Dentro, en orden: lo que el agente dijo (markdown,
 * SIN inyectar HTML: `Markdown` convierte cada bloque en un elemento de React
 * y React escapa el texto), cada herramienta PLEGADA con su nombre, su entrada
 * en una linea y su resultado dentro, y el final de la fase.
 *
 * «SIN MEDIR» NO ES CERO. Un runtime que no reporta tokens se dice asi; un `0`
 * ahi inventaria un gasto que nadie midio.
 *
 * EN VIVO. El servicio avisa por el canal (`run.transcript`) cuando un archivo
 * crece; se pide SOLO lo nuevo (`?desde=`) de esa fase y se añade. Si el
 * operador esta al final del transcript, la vista le sigue; si subio a leer
 * algo, no se le mueve.
 */

/** Cuantos eventos se piden por tramo. El servicio acota a 1000. */
const TRAMO = 200

export interface PropsDePanelDeTranscript {
  transcript: TranscriptDeTarea | null
  error: ErrorDelServicio | null
  cargando: boolean
  /** Pedir lo que falta de una fase cortada. Sin esto, el boton no se pinta. */
  alCargarMas?: (fase: FaseDeTranscript) => void
  /** La fase abierta al montar; sin ella, la ultima (la que esta corriendo). */
  faseInicial?: string | null
}

export function PanelDeTranscript({ transcript, error, cargando, alCargarMas, faseInicial }: PropsDePanelDeTranscript) {
  const fases = transcript?.fases ?? []
  const [elegida, setElegida] = useState<string | null>(faseInicial ?? null)
  // Sin eleccion del operador se sigue a la fase mas reciente: es la que esta
  // corriendo. En cuanto elige una, se respeta aunque aparezcan otras.
  const clave = elegida && fases.some((f) => claveDeFase(f) === elegida) ? elegida : fases.at(-1) ? claveDeFase(fases.at(-1)!) : null
  const abierta = fases.find((f) => claveDeFase(f) === clave) ?? null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-heading-14 text-ds-gray-1000">Lo que hizo el agente</h3>
        {transcript ? (
          <p className="text-label-12 text-ds-gray-900">
            Total de la tarea:{' '}
            <span className={cn('fuente-operativa', transcript.total.medido ? 'text-ds-gray-1000' : 'text-ds-gray-700')}>
              {formatearTokens(transcript.total)}
            </span>
          </p>
        ) : null}
      </div>

      <FalloDeLectura error={error} />

      {!transcript && !error ? (
        <Spinner etiqueta="Leyendo el transcript de la tarea" conTexto />
      ) : fases.length === 0 && transcript ? (
        <p className="text-copy-13 text-ds-gray-900">
          Todavia no hay transcript: aparece en cuanto el agente empieza la primera fase de esta tarea.
        </p>
      ) : null}

      {fases.length > 0 ? (
        <>
          <div role="tablist" aria-label="Fases de la tarea" className="flex flex-wrap gap-1 border-b border-ds-gray-400">
            {fases.map((fase) => {
              const k = claveDeFase(fase)
              const activa = k === clave
              return (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={activa}
                  onClick={() => setElegida(k)}
                  className={cn(
                    '-mb-px flex flex-col items-start gap-0.5 border-b-2 px-3 py-2 text-left transition-colors',
                    activa
                      ? 'border-ds-gray-1000 text-ds-gray-1000'
                      : 'border-transparent text-ds-gray-900 hover:text-ds-gray-1000',
                  )}
                >
                  <span className="fuente-operativa text-label-13">
                    {fase.fase}
                    {fase.lente ? <span className="text-ds-gray-900"> · {fase.lente}</span> : null}
                  </span>
                  <span className={cn('text-label-12', fase.tokens.medido ? 'text-ds-gray-900' : 'text-ds-gray-700')}>
                    {formatearTokens(fase.tokens)}
                  </span>
                  {/* QUIEN LA HIZO (spec 005, FR-007): el motor estampa el
                      runtime en cada evento, y tras un hand-off una fase la
                      hicieron dos. Con uno solo tambien se dice. */}
                  {runtimesDeLosEventos(fase.eventos).length > 0 ? (
                    <span className="fuente-operativa text-label-12 text-ds-gray-700">
                      por {runtimesDeLosEventos(fase.eventos).join(' → ')}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
          {abierta ? (
            <FaseAbierta
              fase={abierta}
              cargando={cargando}
              alCargarMas={alCargarMas ? () => alCargarMas(abierta) : undefined}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}

/** Si el contenedor esta (casi) al final: solo entonces se le sigue al crecer. */
const alFinal = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 48

function FaseAbierta({
  fase,
  cargando,
  alCargarMas,
}: {
  fase: FaseDeTranscript
  cargando: boolean
  alCargarMas?: () => void
}) {
  const contenedor = useRef<HTMLDivElement | null>(null)
  const seguir = useRef(true)
  const bloques = agruparEventos(fase.eventos)

  // AUTO-SCROLL QUE NO PELEA CON EL OPERADOR. Se mira si estaba al final ANTES
  // de que llegue lo nuevo (en cada scroll), y solo entonces se baja al final
  // despues de pintar. Bajarlo siempre le arrancaria de lo que estaba leyendo.
  useLayoutEffect(() => {
    const el = contenedor.current
    if (el && seguir.current) el.scrollTop = el.scrollHeight
  }, [fase.eventos.length, fase.fase, fase.lente])

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={contenedor}
        onScroll={(e) => {
          seguir.current = alFinal(e.currentTarget)
        }}
        aria-live="polite"
        aria-label={`Transcript de ${fase.fase}${fase.lente ? ` · ${fase.lente}` : ''}`}
        className="flex max-h-[32rem] flex-col gap-3 overflow-y-auto rounded-lg p-4 shadow-ds-border"
      >
        {fase.desde > 0 ? (
          <p className="text-label-12 text-ds-gray-700">
            Se muestran los eventos desde el {fase.desde + 1}; los anteriores no se cargaron.
          </p>
        ) : null}
        {bloques.map((bloque) => (
          <Bloque key={bloque.clave} bloque={bloque} />
        ))}
        {fase.eventos.length === 0 ? (
          <p className="text-copy-13 text-ds-gray-900">Esta fase todavia no dijo nada.</p>
        ) : null}
      </div>
      {fase.cortado ? (
        // LO CORTADO SE DICE: cuantos se ven y cuantos hay.
        <div className="flex flex-wrap items-center gap-3 text-label-12 text-ds-gray-900">
          <span>
            Se muestran {fase.siguiente - fase.desde} de {fase.total - fase.desde} eventos de esta fase.
          </span>
          {alCargarMas ? (
            <Button variant="secondary" size="sm" onClick={alCargarMas} disabled={cargando}>
              Cargar mas
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function Bloque({ bloque }: { bloque: BloqueDeTranscript }) {
  if (bloque.tipo === 'texto') return <Markdown texto={bloque.evento.contenido} className="text-ds-gray-1000" />

  if (bloque.tipo === 'herramienta') {
    const entrada = bloque.llamada?.contenido ?? ''
    return (
      // `<details>` y no un estado de React: plegar no cambia nada que haya
      // que recordar, y el navegador lo hace accesible de serie.
      <details className="group rounded-md bg-ds-gray-alpha-100">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-label-13 [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-ds-gray-900 transition-transform group-open:rotate-90" />
          <Wrench aria-hidden="true" className="size-3.5 shrink-0 text-ds-gray-900" />
          <span className="fuente-operativa shrink-0 text-ds-gray-1000">{bloque.nombre}</span>
          <span className="fuente-operativa min-w-0 truncate text-ds-gray-900">{entrada ? resumirEntrada(entrada) : ''}</span>
          {!bloque.resultado ? <span className="ml-auto shrink-0 text-label-12 text-ds-gray-700">sin resultado aun</span> : null}
        </summary>
        <div className="flex flex-col gap-2 px-3 pb-3">
          {bloque.llamada ? (
            <Crudo titulo="Entrada" texto={entrada} />
          ) : (
            <p className="text-label-12 text-ds-gray-700">La llamada quedo antes del tramo cargado.</p>
          )}
          {bloque.resultado ? <Crudo titulo="Resultado" texto={bloque.resultado.contenido} /> : null}
        </div>
      </details>
    )
  }

  if (bloque.tipo === 'error') {
    return (
      <div role="alert" className="flex gap-2 rounded-md bg-ds-red-100 px-3 py-2 text-copy-13 text-ds-red-900">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <p className="whitespace-pre-wrap break-words">{bloque.evento.contenido}</p>
      </div>
    )
  }

  // El final de la fase: lo ultimo que el agente dijo, y los tokens de esa invocacion.
  return (
    <div className="flex flex-col gap-2 rounded-md border border-ds-gray-400 px-3 py-2">
      <p className="flex items-center gap-2 text-label-12 text-ds-gray-900">
        <CircleCheck aria-hidden="true" className="size-3.5 text-ds-green-900" />
        Fin de la invocacion
        <span className="fuente-operativa ml-auto">
          {formatearTokens(bloque.evento.tokens ? { medido: true, ...bloque.evento.tokens } : null)}
        </span>
      </p>
      {bloque.evento.contenido ? <Markdown texto={bloque.evento.contenido} className="text-ds-gray-1000" /> : null}
    </div>
  )
}

function Crudo({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-label-12 text-ds-gray-900">{titulo}</span>
      <pre className="fuente-operativa max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-ds-background-100 px-3 py-2 text-label-12 text-ds-gray-1000">
        {texto || '(vacio)'}
      </pre>
    </div>
  )
}

/**
 * El transcript de una tarea, leido del servicio y vivo por el canal.
 *
 * No usa `useLectura` a proposito: esa relee la ruta ENTERA en cada evento, y
 * un transcript que crece cada segundo se pediria entero cada segundo. Aqui se
 * pide entero una vez y despues solo lo nuevo de la fase que aviso.
 */
export function VistaDeTranscript({ itemId, tareaId }: { itemId: string; tareaId: string }) {
  const { cliente, estado } = useServicio()
  const [transcript, setTranscript] = useState<TranscriptDeTarea | null>(null)
  const [error, setError] = useState<ErrorDelServicio | null>(null)
  const [cargando, setCargando] = useState(false)
  const actual = useRef<TranscriptDeTarea | null>(null)
  actual.current = transcript
  // Una peticion por fase a la vez: dos avisos seguidos no piden lo mismo dos veces.
  const enVuelo = useRef(new Set<string>())

  const pedir = useCallback(
    async (ruta: string, clave: string) => {
      if (!cliente || enVuelo.current.has(clave)) return
      enVuelo.current.add(clave)
      setCargando(true)
      try {
        const nuevo = await cliente.obtener<TranscriptDeTarea>(ruta)
        setTranscript((previo) => fusionarTranscript(previo, nuevo))
        setError(null)
      } catch (fallo) {
        setError(comoErrorDelServicio(fallo, `GET ${ruta}`))
      } finally {
        enVuelo.current.delete(clave)
        setCargando(false)
      }
    },
    [cliente],
  )

  // Al abrir (o cambiar de tarea): todo, desde el principio.
  useEffect(() => {
    setTranscript(null)
    setError(null)
    if (!cliente || estado !== 'conectado') return
    void pedir(RUTAS_DEL_TRANSCRIPT.transcript(itemId, tareaId, { limite: TRAMO }), '*')
  }, [cliente, estado, itemId, tareaId, pedir])

  const continuar = useCallback(
    (fase: string, lente: string | null) => {
      const previa = actual.current?.fases.find((f) => f.fase === fase && (f.lente ?? null) === lente)
      void pedir(
        RUTAS_DEL_TRANSCRIPT.transcript(itemId, tareaId, { fase, lente, desde: previa?.siguiente ?? 0, limite: TRAMO }),
        `${fase}·${lente ?? ''}`,
      )
    },
    [itemId, tareaId, pedir],
  )

  useEventoDelServicio(EVENTO_DE_TRANSCRIPT, (evento: EventoServicio) => {
    const aviso = evento.datos as AvisoDeTranscript
    if (!aviso || aviso.itemId !== itemId || aviso.taskId !== tareaId) return
    continuar(aviso.fase, aviso.lente ?? null)
  })

  return (
    <PanelDeTranscript
      transcript={transcript}
      error={error}
      cargando={cargando}
      alCargarMas={(fase) => continuar(fase.fase, fase.lente ?? null)}
    />
  )
}
