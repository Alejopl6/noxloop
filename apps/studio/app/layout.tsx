import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'

import { Proveedores } from '@/components/proveedores'
import './globals.css'

/**
 * T012 · Las fuentes.
 *
 * `next/font` las auto-hospeda en tiempo de build y las sirve desde el propio
 * bundle: cero peticiones de red en runtime. Eso no es una optimizacion, es
 * FR-003 — la app funciona sin internet, y una fuente cargada por `<link>`
 * desde Google la dejaria sin tipografia (y con un bloqueo de render de varios
 * segundos) en cada arranque sin conexion.
 *
 * `GeistSans.variable` y `GeistMono.variable` publican `--font-geist-sans` y
 * `--font-geist-mono`, que es lo que consume `@theme inline` en globals.css.
 */
export const metadata: Metadata = {
  title: 'noxloop',
  description:
    'Consola de control de noxloop. Lee el estado del servicio; no escribe nada.',
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // `suppressHydrationWarning`: `next-themes` escribe la clase del tema en
    // <html> antes de que React hidrate. Es lo que evita el destello, y sin
    // esta marca React lo reporta como discrepancia de hidratacion.
    <html
      lang="es"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body>
        <Proveedores>{children}</Proveedores>
      </body>
    </html>
  )
}
