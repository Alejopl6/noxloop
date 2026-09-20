'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, PlugZap, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useServicio } from '@/components/proveedor-servicio'
import { formatearRelativo } from '@/lib/tiempo'

/**
 * T039 · Lo que se ve cuando el servicio no esta.
 *
 * Reglas de redaccion (research.md §2), aplicadas literalmente:
 *
 *   - Que paso y que hacer, EN ESE ORDEN. La causa primero porque sin ella la
 *     accion es un ritual; la accion siempre, porque una causa sin salida es
 *     un callejon.
 *   - "No se pudo" cuando el bloqueo esta en el estado del operador (falta
 *     arrancar algo, falta un permiso). "Fallo" cuando el sistema se rompio.
 *   - Nunca "algo salio mal": se nombra el recurso. Aqui el recurso es "el
 *     servicio de control", y la direccion concreta donde se le busco.
 *
 * Y la regla que atraviesa FR-005: nunca una pantalla en blanco, y nunca datos
 * viejos pintados como si fueran de ahora.
 */

function Bloque({
  Icono,
  titulo,
  causa,
  accion,
  children,
}: {
  Icono: typeof AlertTriangle
  titulo: string
  causa: string
  accion: string
  children?: ReactNode
}) {
  return (
    <div className="flex max-w-xl flex-col items-start gap-4">
      <div className="flex items-center gap-2 text-ds-amber-900">
        <Icono className="size-5 shrink-0" aria-hidden="true" />
        <h2 className="text-heading-20 text-ds-gray-1000">{titulo}</h2>
      </div>

      {/* La causa completa. No se trunca ni se resume: el texto del servicio es
          lo unico que dice que ocurrio de verdad. */}
      <p className="text-copy-14 text-ds-gray-900">{causa}</p>

      <div className="flex flex-col gap-1">
        <span className="text-label-12 uppercase tracking-wide text-ds-gray-700">
          Que hacer
        </span>
        <p className="text-copy-14 text-ds-gray-1000">{accion}</p>
      </div>

      {children}
    </div>
  )
}

/** Pantalla completa: nunca hubo contacto, asi que no hay nada que mostrar. */
export function PantallaServicioCaido() {
  const { error, reintentar, estado } = useServicio()

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-6 py-16">
      <Bloque
        Icono={PlugZap}
        titulo="El servicio de control de noxloop no esta corriendo"
        causa={
          error?.causa ??
          'La interfaz no obtuvo respuesta del servicio de control. Sin el no hay proyectos, ni bandeja, ni indicadores: esta interfaz no guarda estado propio, solo lee el del servicio.'
        }
        accion={
          error?.accion ??
          'En escritorio, cierra noxloop y vuelve a abrirlo: el servicio arranca con la aplicacion. En web, arrancalo con `npm run service` y recarga esta pagina.'
        }
      >
        <div className="flex items-center gap-3">
          <Button onClick={reintentar} disabled={estado === 'iniciando'}>
            <RefreshCw className={estado === 'iniciando' ? 'animate-spin' : undefined} />
            Reintentar ahora
          </Button>
          <span className="text-label-12 text-ds-gray-700">
            La aplicacion tambien reintenta sola.
          </span>
        </div>

        {error?.codigo ? (
          <p className="fuente-operativa text-label-12 text-ds-gray-700">
            codigo: {error.codigo}
            {error.recurso ? ` · ${error.recurso}` : null}
          </p>
        ) : null}
      </Bloque>
    </main>
  )
}

/**
 * Banner: hubo contacto y se perdio. Lo de abajo sigue en pantalla porque
 * borrarlo no ayuda a nadie, pero queda declarado como viejo — que es la unica
 * forma honesta de seguir mostrandolo (FR-005).
 */
export function BannerSinConexion() {
  const { error, ultimoContacto, reintentar } = useServicio()
  const [ahora, setAhora] = useState(() => Date.now())

  useEffect(() => {
    const intervalo = setInterval(() => setAhora(Date.now()), 10_000)
    return () => clearInterval(intervalo)
  }, [])

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-ds-amber-300 bg-ds-amber-100 px-6 py-3"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-2">
        <div className="flex items-start gap-2">
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-ds-amber-900"
            aria-hidden="true"
          />
          <div className="flex flex-col gap-1">
            <p className="text-label-14 text-ds-gray-1000">
              Se perdio la conexion con el servicio de control.{' '}
              {ultimoContacto
                ? `Lo que ves es de ${formatearRelativo(ultimoContacto, ahora)} y puede haber cambiado.`
                : 'Lo que ves puede haber cambiado.'}
            </p>
            <p className="text-copy-13 text-ds-gray-900">
              {error?.causa ??
                'La interfaz dejo de recibir respuesta del servicio de control.'}
            </p>
            <p className="text-copy-13 text-ds-gray-1000">
              {error?.accion ??
                'La aplicacion reintenta sola. Si el aviso no desaparece, comprueba que el servicio sigue corriendo.'}
            </p>
          </div>
        </div>
        <div>
          <Button variant="secondary" size="sm" onClick={reintentar}>
            <RefreshCw />
            Reintentar ahora
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Primer arranque: no se afirma nada todavia. Tampoco se deja en blanco. */
export function PantallaIniciando() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-6">
      <p
        className="text-copy-14 text-ds-gray-900"
        role="status"
        aria-live="polite"
      >
        Buscando el servicio de control de noxloop...
      </p>
    </main>
  )
}
