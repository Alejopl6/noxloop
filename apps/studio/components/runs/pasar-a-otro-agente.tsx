'use client'

import { useState } from 'react'
import { ArrowRightLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { Note } from '@/components/ui/nota'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { FalloDeLectura } from '@/components/pantalla'
import {
  destinosDeHandoff,
  implementadorDeTarea,
  tareasTraspasables,
} from '@/components/runs/handoff'
import { EVENTOS_DEL_HANDOFF, RUTAS, RUTAS_DEL_HANDOFF } from '@/lib/daemon'
import { useLectura } from '@/lib/lectura'
import { useMutacion } from '@/lib/mutacion'
import type {
  Agente,
  EstadoDeRuntime,
  PedidoDeHandoff,
  RespuestaDeHandoff,
  Run,
  TareaDeRun,
} from '@/lib/tipos'
import { cn } from '@/lib/utils'

/**
 * «PASAR A OTRO AGENTE» (spec 005, US3, FR-007): la tarea que un runtime no
 * supo terminar la retoma otro, en la misma rama, con el rojo, los commits y
 * los intentos que ya tenia.
 *
 * LA INTERFAZ PIDE Y NADA MAS (principio VIII). El `POST` va al servicio, que
 * valida y lanza el motor; el override lo escribe el motor en el estado del
 * run. Aqui solo se evita OFRECER lo que se va a rechazar —el revisor, quien ya
 * la tiene, un runtime sin sesion— y cada opcion apagada dice por que
 * (`destinosDeHandoff`). Si el servicio rechaza igual, su causa y su accion se
 * pintan al lado del boton.
 *
 * SE MONTA PLEGADO: el formulario, con sus tres lecturas, solo existe al
 * abrirlo. Una columna de Bloqueado con diez tarjetas no hace treinta
 * peticiones por si el operador quiere pasar alguna.
 */
export function PasarAOtroAgente({
  itemId,
  proyectoId,
  implementadorDelRun,
  tarea,
  compacto = false,
}: {
  itemId: string
  proyectoId: string | null
  /** El ejecutor del run si se sabe (la tarjeta lo trae); si no, el implementador de la flota. */
  implementadorDelRun?: string | null
  /** Desde el detalle de un run la tarea ya esta elegida; desde la tarjeta se elige aqui. */
  tarea?: TareaDeRun | null
  compacto?: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  return (
    <div className={cn('relative z-10 flex flex-col gap-2', compacto ? null : 'pt-1')}>
      <Button
        variant="secondary"
        size="sm"
        className="self-start [&_svg]:size-3.5"
        aria-expanded={abierto}
        onClick={(evento) => {
          evento.stopPropagation()
          setAbierto((v) => !v)
        }}
      >
        <ArrowRightLeft aria-hidden="true" />
        Pasar a otro agente
      </Button>
      {abierto ? (
        <FormularioDeHandoff
          itemId={itemId}
          proyectoId={proyectoId}
          implementadorDelRun={implementadorDelRun ?? null}
          tareaFija={tarea ?? null}
          alTerminar={() => setAbierto(false)}
        />
      ) : null}
    </div>
  )
}

function FormularioDeHandoff({
  itemId,
  proyectoId,
  implementadorDelRun,
  tareaFija,
  alTerminar,
}: {
  itemId: string
  proyectoId: string | null
  implementadorDelRun: string | null
  tareaFija: TareaDeRun | null
  alTerminar: () => void
}) {
  const run = useLectura<Run>(tareaFija ? null : RUTAS.run(itemId), { relerEn: EVENTOS_DEL_HANDOFF })
  const runtimes = useLectura<EstadoDeRuntime[]>(RUTAS.runtimes())
  const agentes = useLectura<Agente[]>(proyectoId ? RUTAS_DEL_HANDOFF.agentes(proyectoId) : null)
  const mutacion = useMutacion()

  const candidatas = tareasTraspasables(tareaFija ? [tareaFija] : run.datos?.tasks ?? [])
    // Las bloqueadas primero: son las que un hand-off viene a destrabar.
    .sort((a, b) => Number(b.status === 'blocked') - Number(a.status === 'blocked'))
  const [tareaId, setTareaId] = useState<string | null>(null)
  const elegida = candidatas.find((t) => t.id === tareaId) ?? candidatas[0] ?? null

  const flota = agentes.datos ?? []
  const revisor = flota.find((a) => a.rol === 'revisor')?.runtime ?? null
  const delRun = implementadorDelRun ?? flota.find((a) => a.rol === 'implementador')?.runtime ?? null
  const actual = elegida ? implementadorDeTarea(elegida, delRun) : null
  const destinos = destinosDeHandoff({ runtimes: runtimes.datos ?? [], revisor, actual })
  const [runtime, setRuntime] = useState<string | null>(null)
  const destino = destinos.find((d) => d.runtime === runtime && d.habilitado) ?? null
  const [nota, setNota] = useState('')
  const [hecho, setHecho] = useState<RespuestaDeHandoff | null>(null)

  const cargando = (!tareaFija && run.datos === null && run.error === null) || (runtimes.datos === null && runtimes.error === null)

  async function pasar() {
    if (!elegida || !destino) return
    const pedido: PedidoDeHandoff = { runtime: destino.runtime, nota: nota.trim() || null }
    const r = await mutacion.enviar<RespuestaDeHandoff>('POST', RUTAS_DEL_HANDOFF.handoff(itemId, elegida.id), pedido)
    if (r) setHecho(r)
  }

  if (hecho) {
    return (
      <Note tipo="exito" titulo={`${hecho.handoff.taskId} pasa a ${hecho.handoff.a}`}>
        Retoma en {hecho.handoff.retomaEn}
        {hecho.handoff.retomaEn === 'GREEN' ? ', sin repetir el paso RED' : ''}, en la misma rama y con los intentos que ya
        llevaba: el hand-off no los repone.
        <Button variant="ghost" size="sm" className="ml-2" onClick={alTerminar}>
          Cerrar
        </Button>
      </Note>
    )
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-md bg-ds-background-100 p-3 shadow-ds-border"
      onClick={(evento) => evento.stopPropagation()}
    >
      <FalloDeLectura error={run.error ?? runtimes.error ?? agentes.error} />
      {cargando ? <Spinner etiqueta="Leyendo el run y los runtimes" conTexto /> : null}

      {!cargando && candidatas.length === 0 ? (
        <p className="text-copy-13 text-ds-gray-900">
          Ninguna tarea de este run tiene implementacion pendiente: las que pasaron su gate ya no cambian de implementador.
        </p>
      ) : null}

      {candidatas.length > 1 ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-label-13 text-ds-gray-900">Tarea</legend>
          {candidatas.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-label-13 text-ds-gray-1000">
              <input
                type="radio"
                name={`tarea-${itemId}`}
                checked={elegida?.id === t.id}
                onChange={() => setTareaId(t.id)}
              />
              <span className="fuente-operativa">{t.id}</span>
              <span className="truncate text-ds-gray-900">{t.title ?? t.status}</span>
            </label>
          ))}
        </fieldset>
      ) : elegida ? (
        <p className="text-label-13 text-ds-gray-900">
          Tarea <span className="fuente-operativa text-ds-gray-1000">{elegida.id}</span>
          {actual ? (
            <>
              {' '}· hoy la implementa <span className="fuente-operativa text-ds-gray-1000">{actual}</span>
            </>
          ) : null}
        </p>
      ) : null}

      {elegida?.lastFailure ? (
        <p className="line-clamp-3 whitespace-pre-wrap text-copy-13 text-ds-red-900" title={elegida.lastFailure}>
          {elegida.lastFailure}
        </p>
      ) : null}

      {elegida && destinos.length > 0 ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-label-13 text-ds-gray-900">Runtime que la recibe</legend>
          {destinos.map((d) => (
            <label
              key={d.runtime}
              className={cn('flex flex-col gap-0.5 text-label-13', d.habilitado ? 'text-ds-gray-1000' : 'text-ds-gray-700')}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`runtime-${itemId}`}
                  disabled={!d.habilitado}
                  checked={runtime === d.runtime}
                  onChange={() => setRuntime(d.runtime)}
                />
                {d.nombre} <span className="fuente-operativa text-label-12 text-ds-gray-700">{d.runtime}</span>
              </span>
              {d.motivo ? <span className="pl-6 text-label-12 text-ds-gray-700">{d.motivo}</span> : null}
            </label>
          ))}
          {destinos.every((d) => !d.habilitado) ? (
            <p className="text-label-12 text-ds-gray-900">
              No hay a quien pasarla: con dos runtimes registrados, uno implementa y el otro revisa. Quita el revisor de la
              flota o conecta otro runtime.
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {elegida ? (
        <Campo
          etiqueta="Por que (opcional)"
          valor={nota}
          alCambiar={setNota}
          marcador="El primero no converge en el gate"
          ayuda="Queda en el registro de decisiones del run."
        />
      ) : null}

      {mutacion.error ? (
        <div role="status" className="flex flex-col gap-0.5 rounded-md bg-ds-red-100 px-2 py-1.5">
          <p className="text-copy-13 text-ds-gray-1000">{mutacion.error.causa}</p>
          <p className="text-label-12 text-ds-gray-900">{mutacion.error.accion}</p>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button size="sm" disabled={!elegida || !destino || mutacion.trabajando} onClick={pasar}>
          {mutacion.trabajando ? <Spinner tamano="sm" /> : <ArrowRightLeft aria-hidden="true" />}
          Pasar {elegida ? elegida.id : ''} {destino ? `a ${destino.nombre}` : ''}
        </Button>
        <Button variant="ghost" size="sm" onClick={alTerminar}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}
