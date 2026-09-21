'use client'

import { useEffect, useState } from 'react'
import { ChevronRight, Inbox } from 'lucide-react'

import { useLectura } from '@/lib/lectura'
import { formatearRelativo } from '@/lib/tiempo'
import { cn } from '@/lib/utils'
import { ETIQUETA_TIPO_ENTRADA, type EntradaBandeja } from '@/lib/tipos'

/**
 * La bandeja.
 *
 * FR-060: es el UNICO elemento accionable de la vista de inicio. Todo lo demas
 * de esa pantalla son indicadores — se leen, no se pulsan. Esa separacion es el
 * producto: dirigido por excepcion significa que el operador entra, mira si hay
 * algo que decidir, y se va.
 *
 * FR-062: cada entrada muestra la CAUSA TEXTUAL COMPLETA. No se trunca con
 * puntos suspensivos, no se resume, no se genera un titulo a partir de ella. Si
 * el texto es largo, ocupa lo que ocupe: el operador decide con lo que el
 * sistema sabe, no con una version corta que alguien creyo suficiente.
 */

// Constante de modulo, no literal en el render: un array nuevo cada render
// resuscribiria el canal de eventos en cada pintado.
const EVENTOS_DE_BANDEJA = ['bandeja.entrada', 'bandeja.resuelta', 'sincronizar_completo'] as const

export function useBandeja() {
  return useLectura<EntradaBandeja[]>('/v1/inbox', { relerEn: EVENTOS_DE_BANDEJA })
}

function FilaDeBandeja({
  entrada,
  seleccionada,
  onAbrir,
}: {
  entrada: EntradaBandeja
  seleccionada?: boolean
  onAbrir?: (id: string) => void
}) {
  const [ahora, setAhora] = useState(() => Date.parse(entrada.creada))

  useEffect(() => {
    setAhora(Date.now())
    const intervalo = setInterval(() => setAhora(Date.now()), 30_000)
    return () => clearInterval(intervalo)
  }, [])

  const creada = Date.parse(entrada.creada)

  return (
    <li>
      <button
        type="button"
        onClick={() => onAbrir?.(entrada.id)}
        aria-current={seleccionada ? 'true' : undefined}
        className={cn(
          'group flex w-full items-start gap-3 rounded-md px-3 py-3 text-left transition-colors',
          seleccionada ? 'bg-ds-gray-alpha-100' : 'hover:bg-ds-gray-alpha-100',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'mt-1.5 size-1.5 shrink-0 rounded-full',
            entrada.estado === 'esperando' ? 'bg-ds-amber-700' : 'bg-ds-gray-600',
          )}
        />

        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-label-14 text-ds-gray-1000">
              {ETIQUETA_TIPO_ENTRADA[entrada.tipo] ?? entrada.tipo}
            </span>
            {/* Identificador operativo: Geist Mono, y solo aqui. */}
            <span className="fuente-operativa text-label-12 text-ds-gray-700">
              {entrada.id}
            </span>
            <span className="text-label-12 text-ds-gray-700">
              {Number.isNaN(creada) ? '—' : formatearRelativo(creada, ahora)}
            </span>
          </span>

          {/* La causa completa. Sin `line-clamp`, sin `truncate`. */}
          <span className="text-copy-14 text-ds-gray-900">{entrada.causa}</span>
        </span>

        {/* `group-focus-within` ademas de `group-hover`, y no es un extra.
            Con solo hover, quien navega con teclado NO VE NUNCA esta flecha:
            la afordancia que dice "esta fila lleva a algun sitio" existe solo
            para el raton. Es la clase de detalle que hace que una interfaz
            operable con teclado se sienta operable a medias — NFR-005 pide
            recorrerla entera, no poder pulsarla. */}
        <ChevronRight
          className="mt-1 size-4 shrink-0 text-ds-gray-600 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          aria-hidden="true"
        />
      </button>
    </li>
  )
}

export function ListaDeBandeja({
  entradas,
  seleccionada,
  onAbrir,
}: {
  entradas: EntradaBandeja[]
  seleccionada?: string | null
  onAbrir?: (id: string) => void
}) {
  // El estado vacio va FUERA de la lista, no como una fila que finge serlo
  // (regla de tablas de Geist). Y lo dice explicitamente: la bandeja vacia es
  // el estado NORMAL del sistema, no un error ni una pantalla a medio cargar.
  if (entradas.length === 0) {
    return (
      <div className="flex items-start gap-3 py-6">
        <Inbox className="mt-0.5 size-4 shrink-0 text-ds-gray-600" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="text-label-14 text-ds-gray-1000">No hay nada que decidir.</p>
          <p className="text-copy-14 text-ds-gray-900">
            La bandeja vacia es el estado normal del sistema: los agentes solo
            interrumpen cuando no pueden avanzar sin ti.
          </p>
        </div>
      </div>
    )
  }

  return (
    <ul className="-mx-3 flex flex-col">
      {entradas.map((entrada) => (
        <FilaDeBandeja
          key={entrada.id}
          entrada={entrada}
          seleccionada={seleccionada === entrada.id}
          onAbrir={onAbrir}
        />
      ))}
    </ul>
  )
}
