'use client'

import { useEffect, useState } from 'react'

import { useRuta } from '@/lib/ruta'
import { useServicio } from '@/components/proveedor-servicio'
import {
  BannerSinConexion,
  PantallaIniciando,
  PantallaServicioCaido,
} from '@/components/estado-servicio'
import { SelectorDeTema } from '@/components/selector-tema'
import { VistaDeInicio } from '@/components/vista-inicio'
import { VistaDeBandeja } from '@/components/vista-bandeja'
import { formatearRelativo } from '@/lib/tiempo'
import { cn } from '@/lib/utils'

/**
 * El cascaron de la aplicacion y el enrutado en cliente.
 *
 * Es un componente de cliente entero a proposito: en un export estatico el
 * prerender produce HTML sin datos, y todo lo que se pinta depende de lo que
 * diga el servicio. Fingir contenido en el servidor aqui seria fingir datos.
 */

/** FR-005 llevado al encabezado: en todo momento se sabe si esto es de ahora. */
function IndicadorDeFrescura() {
  const { estado, ultimoContacto } = useServicio()
  const [ahora, setAhora] = useState<number | null>(null)

  useEffect(() => {
    setAhora(Date.now())
    const intervalo = setInterval(() => setAhora(Date.now()), 10_000)
    return () => clearInterval(intervalo)
  }, [])

  const fresco = estado === 'conectado'

  return (
    <span className="flex items-center gap-2" role="status" aria-live="polite">
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 rounded-full',
          fresco ? 'bg-ds-green-700' : 'bg-ds-amber-700',
        )}
      />
      <span className="text-label-12 text-ds-gray-900">
        {fresco
          ? 'En vivo'
          : ultimoContacto && ahora
            ? `Sin conexion · datos de ${formatearRelativo(ultimoContacto, ahora)}`
            : 'Sin conexion'}
      </span>
    </span>
  )
}

export function Aplicacion() {
  const { ruta, navegar } = useRuta()
  const { estado } = useServicio()

  if (estado === 'iniciando') return <PantallaIniciando />

  // Nunca hubo contacto: no hay datos que ensenar, asi que se ensena el
  // problema. Lo que no se hace, jamas, es dejar la pantalla en blanco.
  if (estado === 'sin_servicio') return <PantallaServicioCaido />

  const secciones = [
    { seccion: 'inicio' as const, etiqueta: 'Inicio' },
    { seccion: 'bandeja' as const, etiqueta: 'Bandeja' },
  ]

  return (
    <div className="flex min-h-dvh flex-col">
      {/* NFR-005: lo primero que recibe el foco es la forma de saltarse el
          encabezado. Sin esto, llegar al contenido con teclado cuesta seis
          tabulaciones en cada carga. */}
      <a
        href="#contenido"
        className="sr-only rounded-md bg-ds-background-100 px-3 py-2 text-label-14 text-ds-gray-1000 focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
      >
        Saltar al contenido
      </a>

      <header className="border-b border-ds-gray-400">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
          <span className="text-heading-16 text-ds-gray-1000">noxloop</span>

          <nav aria-label="Secciones" className="flex items-center gap-1">
            {secciones.map(({ seccion, etiqueta }) => {
              const activa = ruta.seccion === seccion
              return (
                <button
                  key={seccion}
                  type="button"
                  aria-current={activa ? 'page' : undefined}
                  onClick={() => navegar({ seccion, id: null })}
                  className={cn(
                    'rounded-md px-2 py-1 text-button-14 transition-colors',
                    activa
                      ? 'bg-ds-gray-alpha-100 text-ds-gray-1000'
                      : 'text-ds-gray-900 hover:text-ds-gray-1000',
                  )}
                >
                  {etiqueta}
                </button>
              )
            })}
          </nav>

          <div className="ml-auto flex items-center gap-4">
            <IndicadorDeFrescura />
            <SelectorDeTema />
          </div>
        </div>
      </header>

      {estado === 'sin_conexion' ? <BannerSinConexion /> : null}

      <main id="contenido" className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        {ruta.seccion === 'bandeja' ? (
          <VistaDeBandeja entradaAbierta={ruta.id} navegar={navegar} />
        ) : (
          <VistaDeInicio navegar={navegar} />
        )}
      </main>
    </div>
  )
}
