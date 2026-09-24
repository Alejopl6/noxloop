import type { ComponentType, SVGProps } from 'react'
import {
  CircleAlert,
  CircleDashed,
  CircleHelp,
  Clock3,
  ClipboardList,
  GitPullRequestArrow,
  OctagonAlert,
  Pause,
  ShieldAlert,
  Unplug,
} from 'lucide-react'

import { Badge, type TonoDeBadge } from '@/components/ui/insignia'
import type { ChipDeTarjeta, TipoDeChip } from '@/lib/tipos'

/**
 * EL CHIP DE ESTADO DE UNA TARJETA.
 *
 * Es un `Badge` y no un `StatusDot`, por lo que dice `punto-de-estado.tsx`: un
 * run no es un despliegue, y un punto sin palabra obliga a aprenderse una
 * leyenda. La palabra la manda el servicio («Needs permission», «PR #43
 * listo») y aqui solo se decide el TONO y el ICONO.
 *
 * LOS TONOS SIGUEN LA SEMANTICA DE LA CONSOLA, no el referente visual:
 *
 *   ambar  te necesita y no fallo       necesita permiso, plan listo, criterios
 *   rojo   se rompio                    bloqueado, fallido
 *   azul   esta en marcha               fase k/N
 *   verde  termino bien                 PR listo
 *   gris   espera, sin juicio           en cola, interrumpido, sin repo
 *
 * INTERRUMPIDO VA EN GRIS Y NO EN ROJO a proposito: el servicio se detuvo con
 * el run en vuelo (Edge case de la spec), el trabajo no fallo. Pintarlo rojo
 * mandaria al operador a buscar un error que no existe; Retry lo retoma del
 * disco y ya esta.
 *
 * EL ICONO ES LA SENAL NO CROMATICA que la doctrina exige al lado de todo
 * color. Sin checkmarks ni equis: ninguno de estos estados es un si/no.
 */

type Icono = ComponentType<SVGProps<SVGSVGElement>>

const ESTILO_DE_CHIP: Record<TipoDeChip, { tono: TonoDeBadge; Icono: Icono; porDefecto: string }> = {
  necesita_permiso: { tono: 'advertencia', Icono: ShieldAlert, porDefecto: 'Necesita permiso' },
  plan_listo: { tono: 'advertencia', Icono: ClipboardList, porDefecto: 'Plan listo' },
  necesita_criterios: { tono: 'advertencia', Icono: CircleHelp, porDefecto: 'Necesita criterios' },
  bloqueado: { tono: 'error', Icono: OctagonAlert, porDefecto: 'Bloqueado' },
  fallido: { tono: 'error', Icono: CircleAlert, porDefecto: 'Fallido' },
  fase: { tono: 'informativo', Icono: CircleDashed, porDefecto: 'En curso' },
  pr_listo: { tono: 'exito', Icono: GitPullRequestArrow, porDefecto: 'PR listo' },
  en_cola: { tono: 'neutral', Icono: Clock3, porDefecto: 'En cola' },
  interrumpido: { tono: 'neutral', Icono: Pause, porDefecto: 'Interrumpido' },
  sin_repo: { tono: 'neutral', Icono: Unplug, porDefecto: 'Sin repo' },
}

export function tonoDeChip(tipo: TipoDeChip): TonoDeBadge {
  return ESTILO_DE_CHIP[tipo]?.tono ?? 'neutral'
}

/**
 * El color del chip como variable CSS de texto, para lo que acompana al chip
 * con el mismo tono (la barra de avance, el punto de la lista lateral).
 */
export const COLOR_DE_TONO: Record<TonoDeBadge, string> = {
  neutral: 'var(--ds-gray-700)',
  advertencia: 'var(--ds-amber-700)',
  error: 'var(--ds-red-700)',
  informativo: 'var(--ds-blue-700)',
  exito: 'var(--ds-green-700)',
}

/** El texto del chip: el del servicio, o el nombre del tipo si no vino. */
export function textoDelChip(chip: ChipDeTarjeta): string {
  const texto = chip.texto?.trim() || ESTILO_DE_CHIP[chip.tipo]?.porDefecto || chip.tipo
  // La posicion en cola se anade solo si el texto no la trae ya: «En cola · #2»
  // dos veces seria ruido, y sin ella «En cola» no dice cuanto falta.
  if (chip.tipo === 'en_cola' && chip.posicion != null && !texto.includes('#')) {
    return `${texto} · #${chip.posicion}`
  }
  return texto
}

export function ChipDeEstado({ chip, className }: { chip: ChipDeTarjeta; className?: string }) {
  const estilo = ESTILO_DE_CHIP[chip.tipo] ?? ESTILO_DE_CHIP.en_cola
  const { Icono } = estilo
  const texto = textoDelChip(chip)

  return (
    // `title` lleva la causa ENTERA al pasar por encima (US2, escenario 4). No
    // es la unica via: la misma causa se lee completa en el detalle de la
    // tarjeta, que es lo que usa quien no tiene raton.
    <span title={chip.detalle ?? undefined} className="inline-flex min-w-0">
      <Badge tono={estilo.tono} className={className}>
        <Icono aria-hidden="true" className="size-3 shrink-0" />
        <span className="truncate">{texto}</span>
      </Badge>
    </span>
  )
}
