'use client'

import { ArrowUpRight, GitPullRequest, X } from 'lucide-react'

import { Dialogo } from '@/components/ui/dialogo'
import { Button } from '@/components/ui/button'
import { Note, type TipoDeNota } from '@/components/ui/nota'
import { ChipDeEstado, COLOR_DE_TONO, tonoDeChip } from '@/components/board/chip'
import {
  Avatar,
  BarraDeAvance,
  BotonDeAccion,
  Prioridad,
  PuntoDeProyecto,
} from '@/components/board/tarjeta'
import type { ErrorDelServicio } from '@/lib/daemon'
import type { GastoDeRun, Tarjeta } from '@/lib/tipos'

/**
 * EL DETALLE DE UNA TARJETA: la causa textual completa y la accion que la
 * resuelve (US3, escenario 2).
 *
 * POR QUE EXISTE SI LA TARJETA YA TIENE EL CHIP. El chip dice «Necesita
 * permiso» en dos palabras; la causa es un parrafo —que credencial, para que
 * herramienta, que agente la pidio— y en la tarjeta no cabe sin volverla
 * ilegible. El `title` del chip la ensena al pasar el raton, pero eso no lo
 * alcanza el teclado ni una pantalla tactil. Aqui se lee entera, sin resumir.
 *
 * SOLO LECTURA Y UNA ACCION. No se edita nada del ticket: el gestor es la
 * fuente de verdad del backlog. Lo que se puede hacer es la misma accion
 * principal de la tarjeta, abrir el ticket en su gestor y abrir el PR.
 */

const NOTA_DEL_TONO = {
  neutral: 'neutral',
  advertencia: 'advertencia',
  error: 'error',
  informativo: 'informativo',
  exito: 'exito',
} as const satisfies Record<ReturnType<typeof tonoDeChip>, TipoDeNota>

export function formatearGasto(gasto: GastoDeRun | null | undefined): string {
  if (!gasto) return '—'
  if (!gasto.medido) return 'sin medir'
  const usd = gasto.usd ?? 0
  const llamadas = gasto.calls ?? 0
  return `${usd.toLocaleString('es', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })} · ${llamadas} ${llamadas === 1 ? 'invocacion' : 'invocaciones'}`
}

export function DetalleDeTarjeta({
  tarjeta,
  gestor,
  trabajando,
  error,
  alCerrar,
  alAccionar,
  alAbrirExterno,
}: {
  tarjeta: Tarjeta | null
  gestor: string
  trabajando: boolean
  error: ErrorDelServicio | null
  alCerrar: () => void
  alAccionar: (tarjeta: Tarjeta) => void
  alAbrirExterno: (url: string) => void
}) {
  return (
    <Dialogo
      abierto={tarjeta !== null}
      alCerrar={alCerrar}
      etiqueta={tarjeta ? `Detalle de ${tarjeta.ticket.key ?? tarjeta.ticket.id}` : 'Detalle de la tarjeta'}
      ancho="lg"
    >
      {tarjeta ? (
        <Contenido
          tarjeta={tarjeta}
          gestor={gestor}
          trabajando={trabajando}
          error={error}
          alCerrar={alCerrar}
          alAccionar={alAccionar}
          alAbrirExterno={alAbrirExterno}
        />
      ) : null}
    </Dialogo>
  )
}

function Contenido({
  tarjeta,
  gestor,
  trabajando,
  error,
  alCerrar,
  alAccionar,
  alAbrirExterno,
}: {
  tarjeta: Tarjeta
  gestor: string
  trabajando: boolean
  error: ErrorDelServicio | null
  alCerrar: () => void
  alAccionar: (tarjeta: Tarjeta) => void
  alAbrirExterno: (url: string) => void
}) {
  const { ticket, proyecto, chip, avance, run, accion } = tarjeta
  const tono = chip ? tonoDeChip(chip.tipo) : 'informativo'

  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label-12 text-ds-gray-900">
            <PuntoDeProyecto proyecto={proyecto} />
            <span>{proyecto.nombre}</span>
            {ticket.equipo ? <span className="text-ds-gray-700">· {ticket.equipo}</span> : null}
            <span className="text-ds-gray-700">· {gestor}</span>
            {ticket.key ? <span className="fuente-operativa text-ds-gray-1000">{ticket.key}</span> : null}
            <Prioridad valor={ticket.prioridad} />
          </p>
          <h2 className="text-heading-20 text-ds-gray-1000">{ticket.titulo}</h2>
        </div>
        <Button variant="ghost" size="icon" aria-label="Cerrar el detalle" onClick={alCerrar}>
          <X aria-hidden="true" />
        </Button>
      </div>

      {chip ? (
        <div className="flex flex-col gap-2">
          <ChipDeEstado chip={chip} className="self-start" />
          {chip.detalle ? (
            // LA CAUSA ENTERA, con los saltos de linea que traiga. Es texto del
            // servicio o del agente: resumirla aqui seria decidir por el
            // operador que parte importaba.
            <Note tipo={NOTA_DEL_TONO[tono]}>
              <p className="whitespace-pre-wrap">{chip.detalle}</p>
            </Note>
          ) : null}
        </div>
      ) : null}

      {avance ? <BarraDeAvance avance={avance} color={COLOR_DE_TONO[tono]} /> : null}

      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-label-13">
        <dt className="text-ds-gray-900">Asignado</dt>
        <dd className="flex items-center gap-2 text-ds-gray-1000">
          <Avatar asignado={ticket.asignado} />
          {ticket.asignado?.nombre ?? 'Sin asignar'}
        </dd>

        {(ticket.etiquetas ?? []).length > 0 ? (
          <>
            <dt className="text-ds-gray-900">Etiquetas</dt>
            <dd className="text-ds-gray-1000">{(ticket.etiquetas ?? []).join(', ')}</dd>
          </>
        ) : null}

        <dt className="text-ds-gray-900">Repositorio</dt>
        <dd className="text-ds-gray-1000">{tarjeta.tieneRepo ? 'Configurado' : 'Sin repositorio'}</dd>

        {run ? (
          <>
            <dt className="text-ds-gray-900">Run</dt>
            <dd className="fuente-operativa text-ds-gray-1000">
              {run.itemId} · {run.estado}
            </dd>
            <dt className="text-ds-gray-900">Gasto</dt>
            <dd className="text-ds-gray-1000">{formatearGasto(run.gasto)}</dd>
          </>
        ) : null}
      </dl>

      {accion.tipo !== 'ninguna' && !accion.habilitada && accion.motivo ? (
        <Note tipo="neutral">{accion.motivo}</Note>
      ) : null}
      {accion.tipo === 'ninguna' && accion.motivo ? <Note tipo="neutral">{accion.motivo}</Note> : null}

      {error ? (
        <Note tipo="error" titulo={error.causa}>
          {error.accion}
        </Note>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-ds-gray-400 pt-4">
        {ticket.url ? (
          <Button variant="secondary" size="sm" onClick={() => alAbrirExterno(ticket.url!)}>
            <ArrowUpRight aria-hidden="true" />
            Abrir en {gestor}
          </Button>
        ) : null}
        {run?.pr ? (
          // La columna «En revision» termina en un ENLACE al PR, nunca en un
          // boton de merge: la autonomia termina en el PR abierto (principio IV).
          <Button variant="secondary" size="sm" onClick={() => alAbrirExterno(run.pr!)}>
            <GitPullRequest aria-hidden="true" />
            Ver el pull request
          </Button>
        ) : null}
        <div className="ml-auto">
          <BotonDeAccion tarjeta={tarjeta} trabajando={trabajando} alAccionar={alAccionar} />
        </div>
      </div>
    </div>
  )
}
