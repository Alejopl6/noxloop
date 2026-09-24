'use client'

import { ThemeProvider } from 'next-themes'
import type { ReactNode } from 'react'

import { ProveedorDeServicio } from '@/components/proveedor-servicio'
import { ProveedorDeEventos } from '@/components/proveedor-eventos'

/**
 * T014 · El tema, y los dos contextos de los que cuelga todo lo demas.
 *
 * `attribute="class"` porque los tokens de Geist se declaran sobre la clase
 * `.dark`, no sobre `data-theme` (research.md §2: cero ocurrencias de
 * `prefers-color-scheme` en el propio Geist; "system" lo resuelve
 * `next-themes`, igual que en el ThemeSwitcher de Vercel).
 *
 * `disableTransitionOnChange` corta las transiciones CSS durante el cambio: sin
 * eso, alternar tema produce un barrido de colores interpolandose elemento por
 * elemento, que se ve exactamente como un fallo de pintado.
 *
 * El destello del arranque lo evita el script que `next-themes` inyecta antes
 * de pintar; por eso `<html>` lleva `suppressHydrationWarning` en el layout:
 * ese script modifica el `class` del html antes de que React hidrate, y sin la
 * marca React lo reporta como discrepancia.
 */
export function Proveedores({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <ProveedorDeServicio>
        <ProveedorDeEventos>{children}</ProveedorDeEventos>
      </ProveedorDeServicio>
    </ThemeProvider>
  )
}
