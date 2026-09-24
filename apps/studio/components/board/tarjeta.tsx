'use client'

import { ArrowUpRight, Check, Play, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { ChipDeEstado, COLOR_DE_TONO, tonoDeChip } from '@/components/board/chip'
import { colorDeProyecto, iniciales, inicialesDeEjecutor } from '@/components/board/derivar'
import type { ErrorDelServicio } from '@/lib/daemon'
import type { AsignadoDeTicket, AvanceDeTarjeta, EjecutorDeTarea, Tarjeta } from '@/lib/tipos'
import { cn } from '@/lib/utils'

/**
 * UNA TARJETA DEL BOARD: un ticket del gestor y, si existe, el run del motor
 * sobre el.
 *
 * LA DENSIDAD ES DELIBERADA. El board se mira para saber, de un barrido, que
 * esta vivo y que te espera; una tarjeta alta con aire de sobra deja cuatro
 * por columna en una pantalla y obliga a desplazarse para contar. Cinco
 * franjas, cada una con un trabajo:
 *
 *   1. de donde es      punto del proyecto · equipo, gestor, clave, prioridad
 *   2. que es           el titulo, dos lineas como mucho
 *   3. como se etiqueta las etiquetas del gestor
 *   4. cuanto lleva     la barra segmentada, solo si hay run
 *   5. que pasa y que   el chip a la izquierda; quien y la UNICA accion a la
 *      hago                derecha (FR-005: una accion principal, no un menu)
 *
 * LA TARJETA ENTERA ABRE EL DETALLE, y no es un `<button>` que envuelve otros
 * botones —eso es HTML invalido y los lectores de pantalla lo leen como un
 * boton gigante sin nombre—. El titulo es el boton, y su `::after` cubre la
 * tarjeta; la accion va por encima con `relative z-10`. Es el patron de
 * «tarjeta con enlace estirado»: un solo destino de tabulador para abrir, uno
 * para actuar.
 */

/* -------------------------------------------------------------------------- */
/* Piezas                                                                     */
/* -------------------------------------------------------------------------- */

/** El punto de color de un proyecto. Decorativo: el nombre va al lado. */
export function PuntoDeProyecto({
  proyecto,
  className,
}: {
  proyecto: { id: string; color?: string | null }
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-2 shrink-0 rounded-full', className)}
      style={{ backgroundColor: colorDeProyecto(proyecto) }}
    />
  )
}

const NOMBRE_DE_PRIORIDAD = ['Urgente', 'Alta', 'Media', 'Baja', 'Minima'] as const

/**
 * La prioridad como barras, a la manera de los gestores de tickets.
 *
 * Tres barras de alto creciente; se rellenan tantas como pesa. Urgente no es
 * «tres barras en rojo»: es otro glifo, porque es otra cosa —se atiende antes
 * que todo lo demas— y un color solo no lo diria sin ayuda. Sin dato del
 * gestor no se pinta nada (supuesto de la spec: no se inventa una prioridad).
 */
export function Prioridad({ valor }: { valor: number | null | undefined }) {
  if (valor === null || valor === undefined || valor < 0 || valor > 4) return null
  const nombre = NOMBRE_DE_PRIORIDAD[valor]

  if (valor === 0) {
    return (
      <span
        role="img"
        aria-label={`Prioridad ${nombre.toLowerCase()}`}
        title={`Prioridad ${nombre.toLowerCase()}`}
        className="inline-flex size-3.5 items-center justify-center rounded-[3px] bg-ds-amber-700 text-[10px] font-semibold leading-none text-black"
      >
        !
      </span>
    )
  }

  // 1 alta → 3 barras, 2 media → 2, 3 baja → 1, 4 minima → 0.
  const llenas = 4 - valor
  return (
    <span
      role="img"
      aria-label={`Prioridad ${nombre.toLowerCase()}`}
      title={`Prioridad ${nombre.toLowerCase()}`}
      className="inline-flex h-3.5 items-end gap-[2px]"
    >
      {[0, 1, 2].map((barra) => (
        <span
          key={barra}
          className={cn(
            'w-[3px] rounded-[1px]',
            barra === 0 ? 'h-1.5' : barra === 1 ? 'h-2.5' : 'h-3.5',
            barra < llenas ? 'bg-ds-gray-900' : 'bg-ds-gray-500',
          )}
        />
      ))}
    </span>
  )
}

/** Las iniciales del asignado en un circulo. Sin imagen: ver `AsignadoDeTicket`. */
export function Avatar({ asignado }: { asignado: AsignadoDeTicket | null | undefined }) {
  if (!asignado) {
    return (
      <span
        role="img"
        aria-label="Sin asignar"
        title="Sin asignar"
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed border-ds-gray-500"
      />
    )
  }
  const texto = (asignado.iniciales?.trim() || iniciales(asignado.nombre)).slice(0, 2)
  return (
    <span
      role="img"
      aria-label={`Asignado a ${asignado.nombre}`}
      title={asignado.nombre}
      className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-ds-gray-200 text-[10px] font-medium leading-none text-ds-gray-1000"
    >
      {texto}
    </span>
  )
}

/**
 * EL EJECUTOR: quien va a hacer (o hace) el trabajo, junto al boton que lo
 * lanza. Cuadrado y no circulo a proposito: el circulo es una persona —el
 * asignado del gestor— y el cuadrado es un runtime. Dos formas para dos cosas
 * que pueden estar en la misma tarjeta a la vez.
 */
export function AvatarDeEjecutor({ ejecutor }: { ejecutor: EjecutorDeTarea }) {
  const nombre = ejecutor.agente?.trim()
    ? `${ejecutor.agente} (${ejecutor.runtime})`
    : ejecutor.runtime
  return (
    <span
      role="img"
      aria-label={`Ejecutor: ${nombre}`}
      title={`Ejecutor: ${nombre}`}
      className="fuente-operativa inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[5px] bg-ds-gray-1000 px-1 text-[10px] font-medium leading-none text-ds-background-100"
    >
      {inicialesDeEjecutor(ejecutor)}
    </span>
  )
}

/**
 * EL AVANCE, SEGMENTADO: una muesca por tarea del plan.
 *
 * Segmentos y no una barra continua porque lo que se cuenta son TAREAS, que
 * son discretas —3 de 9 no es un 33%, es «faltan seis cosas»—. Por encima de
 * doce tareas las muescas se vuelven rayas de un pixel y dejan de contarse, y
 * ahi si se pasa a barra continua. El color es el del chip: azul si corre,
 * ambar si te espera, rojo si se rompio.
 */
export function BarraDeAvance({
  avance,
  color,
  className,
}: {
  avance: AvanceDeTarjeta
  color: string
  className?: string
}) {
  const total = Math.max(0, avance.total)
  const hechas = Math.min(Math.max(0, avance.hechas), total)
  const etiqueta = `${hechas} de ${total} tareas integradas${avance.fase ? `, fase ${avance.fase}` : ''}`

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        role="progressbar"
        aria-label={etiqueta}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={hechas}
        className="flex h-1 flex-1 gap-[2px]"
      >
        {total === 0 ? (
          <span className="h-full flex-1 rounded-full bg-ds-gray-alpha-200" />
        ) : total <= 12 ? (
          Array.from({ length: total }, (_, indice) => (
            <span
              key={indice}
              className="h-full flex-1 rounded-full bg-ds-gray-alpha-200"
              style={indice < hechas ? { backgroundColor: color } : undefined}
            />
          ))
        ) : (
          <span className="relative h-full flex-1 overflow-hidden rounded-full bg-ds-gray-alpha-200">
            <span
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${(hechas / total) * 100}%`, backgroundColor: color }}
            />
          </span>
        )}
      </div>
      <span aria-hidden="true" className="fuente-operativa shrink-0 text-label-12 text-ds-gray-900">
        {hechas}/{total}
        {avance.fase ? <span className="text-ds-gray-700"> · {avance.fase}</span> : null}
      </span>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* La accion                                                                  */
/* -------------------------------------------------------------------------- */

const ETIQUETA_DE_ACCION = {
  run: 'Run',
  open_run: 'Abrir run',
  retry: 'Retry',
  approve: 'Aprobar plan',
} as const

export function BotonDeAccion({
  tarjeta,
  trabajando,
  alAccionar,
}: {
  tarjeta: Tarjeta
  trabajando: boolean
  alAccionar: (tarjeta: Tarjeta) => void
}) {
  const { accion } = tarjeta
  if (accion.tipo === 'ninguna') return null

  const etiqueta = ETIQUETA_DE_ACCION[accion.tipo]
  // Run y Aprobar plan son las dos que PONEN A TRABAJAR al motor: van en el
  // primario. Abrir run y Retry son de seguimiento y van en secundario, para
  // que en una columna llena el ojo encuentre donde se lanza algo.
  const primaria = accion.tipo === 'run' || accion.tipo === 'approve'
  const Icono =
    accion.tipo === 'run'
      ? Play
      : accion.tipo === 'approve'
        ? Check
        : accion.tipo === 'retry'
          ? RotateCcw
          : ArrowUpRight

  return (
    <Button
      size="sm"
      variant={primaria ? 'default' : 'secondary'}
      disabled={!accion.habilitada || trabajando}
      // El motivo va en el `title` Y escrito bajo la tarjeta (ver abajo): el
      // `title` solo lo ve quien pasa el raton, y un boton apagado sin motivo
      // a la vista es un boton roto.
      title={!accion.habilitada && accion.motivo ? accion.motivo : undefined}
      aria-label={`${etiqueta}: ${tarjeta.ticket.key ?? tarjeta.ticket.id}`}
      onClick={(evento) => {
        evento.stopPropagation()
        alAccionar(tarjeta)
      }}
      className="relative z-10 [&_svg]:size-3.5"
    >
      {trabajando ? <Spinner tamano="sm" /> : <Icono aria-hidden="true" />}
      {etiqueta}
    </Button>
  )
}

/* -------------------------------------------------------------------------- */
/* La tarjeta                                                                 */
/* -------------------------------------------------------------------------- */

export interface PropsDeTarjeta {
  tarjeta: Tarjeta
  /** «GitHub», «Linear», «Local»: de donde sale el ticket. */
  gestor: string
  trabajando?: boolean
  /** El fallo de la ULTIMA accion sobre esta tarjeta, pegado a ella. */
  error?: ErrorDelServicio | null
  alAccionar: (tarjeta: Tarjeta) => void
  alAbrir: (tarjeta: Tarjeta) => void
}

export function TarjetaDelBoard({
  tarjeta,
  gestor,
  trabajando = false,
  error = null,
  alAccionar,
  alAbrir,
}: PropsDeTarjeta) {
  const { ticket, proyecto, chip, avance, accion } = tarjeta
  const etiquetas = ticket.etiquetas ?? []
  const colorDelAvance = chip ? COLOR_DE_TONO[tonoDeChip(chip.tipo)] : COLOR_DE_TONO.informativo
  const motivo = !accion.habilitada && accion.tipo !== 'ninguna' ? accion.motivo : null
  const sinAccionConMotivo = accion.tipo === 'ninguna' ? accion.motivo : null

  return (
    <article
      aria-label={`${ticket.key ?? ticket.id}: ${ticket.titulo}`}
      className={cn(
        'group relative flex flex-col gap-2 rounded-lg bg-ds-background-100 p-3 shadow-ds-border',
        // El realce al pasar es un borde mas firme y no una sombra: en oscuro
        // Geist no pinta sombras difuminadas y el hover desapareceria.
        'transition-shadow hover:shadow-[0_0_0_1px_var(--ds-gray-alpha-500)]',
        'has-[:focus-visible]:shadow-[var(--ds-focus-ring)]',
      )}
    >
      {/* 1. De donde es. */}
      <div className="flex min-w-0 items-center gap-1.5 text-label-12 text-ds-gray-900">
        <PuntoDeProyecto proyecto={proyecto} />
        <span className="min-w-0 truncate">
          {proyecto.nombre}
          {ticket.equipo ? <span className="text-ds-gray-700"> · {ticket.equipo}</span> : null}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className="rounded-[4px] px-1 text-[11px] leading-4 text-ds-gray-900 shadow-ds-border">
            {gestor}
          </span>
          {ticket.key ? (
            <span className="fuente-operativa text-ds-gray-900">{ticket.key}</span>
          ) : null}
          <Prioridad valor={ticket.prioridad} />
        </span>
      </div>

      {/* 2. Que es. El boton estirado: ver la cabecera. */}
      <h3 className="min-w-0">
        <button
          type="button"
          onClick={() => alAbrir(tarjeta)}
          // `text-button-14` y no `label-14`: es el peso 500 de Geist, que es el
          // del titulo de una fila en un kanban. El anillo de foco no va en el
          // boton —rodearia solo el texto— sino en la tarjeta, con `has-[]`.
          className="line-clamp-2 text-left text-button-14 text-ds-gray-1000 after:absolute after:inset-0 after:rounded-lg focus-visible:shadow-none"
        >
          {ticket.titulo}
        </button>
      </h3>

      {/* 3. Etiquetas. */}
      {etiquetas.length > 0 ? (
        <ul aria-label="Etiquetas" className="flex flex-wrap gap-1">
          {etiquetas.slice(0, 4).map((etiqueta) => (
            <li
              key={etiqueta}
              className="inline-flex h-5 items-center rounded-full px-2 text-label-12 text-ds-gray-900 shadow-ds-border"
            >
              {etiqueta}
            </li>
          ))}
          {etiquetas.length > 4 ? (
            <li className="inline-flex h-5 items-center px-1 text-label-12 text-ds-gray-700">
              +{etiquetas.length - 4}
            </li>
          ) : null}
        </ul>
      ) : null}

      {/* 4. Cuanto lleva. */}
      {avance ? <BarraDeAvance avance={avance} color={colorDelAvance} /> : null}

      {/* 5. Que pasa, quien, y que hago. */}
      <div className="flex min-h-6 items-center gap-2">
        <div className="min-w-0 flex-1">{chip ? <ChipDeEstado chip={chip} /> : null}</div>
        {/* El hueco punteado de «sin asignar» solo cuando tampoco hay
            ejecutor: con ejecutor, la tarjeta ya dice quien la trabaja. */}
        {ticket.asignado || !tarjeta.ejecutor ? <Avatar asignado={ticket.asignado} /> : null}
        {tarjeta.ejecutor ? <AvatarDeEjecutor ejecutor={tarjeta.ejecutor} /> : null}
        <BotonDeAccion tarjeta={tarjeta} trabajando={trabajando} alAccionar={alAccionar} />
      </div>

      {motivo || sinAccionConMotivo ? (
        <p className="text-label-12 text-ds-gray-900">{motivo ?? sinAccionConMotivo}</p>
      ) : null}

      {error ? (
        // El fallo de lanzar se pinta EN la tarjeta que lo provoco, y no en un
        // toast: el operador lo vivio sobre esta tarjeta, y un 409 de «sin
        // gate» tiene que quedarse al lado del boton que lo produjo mientras
        // decide que hacer.
        <div role="status" className="relative z-10 flex flex-col gap-0.5 rounded-md bg-ds-red-100 px-2 py-1.5">
          <p className="text-copy-13 text-ds-gray-1000">{error.causa}</p>
          <p className="text-label-12 text-ds-gray-900">{error.accion}</p>
        </div>
      ) : null}
    </article>
  )
}

/** Una tarjeta de altura conocida mientras llega el board. */
export function EsqueletoDeTarjeta() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2.5 rounded-lg bg-ds-background-100 p-3 shadow-ds-border">
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-ds-gray-200" />
        <span className="h-3 w-24 animate-pulse rounded bg-ds-gray-200" />
        <span className="ml-auto h-3 w-12 animate-pulse rounded bg-ds-gray-200" />
      </div>
      <span className="h-4 w-11/12 animate-pulse rounded bg-ds-gray-200" />
      <span className="h-4 w-2/3 animate-pulse rounded bg-ds-gray-200" />
      <div className="flex items-center gap-2 pt-1">
        <span className="h-5 w-20 animate-pulse rounded-full bg-ds-gray-200" />
        <span className="ml-auto size-5 rounded-full bg-ds-gray-200" />
        <span className="h-6 w-12 animate-pulse rounded-sm bg-ds-gray-200" />
      </div>
    </div>
  )
}
