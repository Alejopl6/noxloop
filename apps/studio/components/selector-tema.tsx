'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Monitor, Moon, Sun } from 'lucide-react'

import { cn } from '@/lib/utils'

const OPCIONES = [
  { valor: 'system', etiqueta: 'Tema del sistema', Icono: Monitor },
  { valor: 'light', etiqueta: 'Tema claro', Icono: Sun },
  { valor: 'dark', etiqueta: 'Tema oscuro', Icono: Moon },
] as const

/**
 * Control segmentado de tema.
 *
 * Nota de nomenclatura (research.md §2): esto es lo que Geist llama `Switch`
 * —un control segmentado—, no un booleano. El booleano en Geist se llama
 * `Toggle`. Confundirlos produce un interruptor claro/oscuro que no sabe
 * representar "el del sistema", que es el valor por defecto.
 *
 * Hasta que el componente monta no se sabe que tema resolvio el navegador, asi
 * que se pinta el esqueleto sin marcar ninguno: marcar el equivocado y
 * corregirlo despues es exactamente el destello que se quiere evitar.
 */
export function SelectorDeTema() {
  const { theme, setTheme } = useTheme()
  const [montado, setMontado] = useState(false)

  useEffect(() => setMontado(true), [])

  return (
    <div
      role="radiogroup"
      aria-label="Tema de la interfaz"
      className="inline-flex items-center gap-0.5 rounded-md p-0.5 shadow-ds-border"
    >
      {OPCIONES.map(({ valor, etiqueta, Icono }) => {
        const activo = montado && theme === valor
        return (
          <button
            key={valor}
            type="button"
            role="radio"
            aria-checked={activo}
            aria-label={etiqueta}
            title={etiqueta}
            onClick={() => setTheme(valor)}
            className={cn(
              'flex size-6 items-center justify-center rounded-sm transition-colors',
              activo
                ? 'bg-ds-gray-alpha-200 text-ds-gray-1000'
                : 'text-ds-gray-900 hover:text-ds-gray-1000',
            )}
          >
            <Icono className="size-3.5" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
