'use client'

import { ArrowLeft } from 'lucide-react'

import { useBandeja, ListaDeBandeja } from '@/components/bandeja'
import { Button } from '@/components/ui/button'
import { ETIQUETA_TIPO_ENTRADA } from '@/lib/tipos'
import type { Ruta } from '@/lib/ruta'

/**
 * La bandeja completa, y el detalle de una entrada.
 *
 * El detalle existe por FR-062: la causa completa y el contexto, "no un resumen
 * generado". Aqui se muestra el contexto crudo tal como llega del servicio —
 * incluido lo que venga de terceros (descripciones de tickets, comentarios de
 * PR), que el contrato exige marcar como datos y nunca como instruccion.
 */
export function VistaDeBandeja({
  entradaAbierta,
  navegar,
}: {
  entradaAbierta: string | null
  navegar: (destino: Ruta) => void
}) {
  const bandeja = useBandeja()
  const entradas = bandeja.datos ?? []
  const detalle = entradaAbierta
    ? (entradas.find((entrada) => entrada.id === entradaAbierta) ?? null)
    : null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 self-start"
          onClick={() => navegar({ seccion: 'inicio', id: null })}
        >
          <ArrowLeft />
          Inicio
        </Button>
        <h1 className="text-heading-24 text-ds-gray-1000">Bandeja</h1>
        <p className="text-copy-14 text-ds-gray-900">
          Todas las entradas, la mas reciente primero.
        </p>
      </div>

      {entradaAbierta && !detalle ? (
        <div className="flex flex-col gap-1">
          <p className="text-label-14 text-ds-gray-1000">
            No se pudo abrir la entrada{' '}
            <span className="fuente-operativa">{entradaAbierta}</span>: no esta
            en la bandeja que devolvio el servicio.
          </p>
          <p className="text-copy-14 text-ds-gray-900">
            Puede haberse resuelto desde otra ventana. Vuelve a la lista de
            abajo y elige una entrada vigente.
          </p>
        </div>
      ) : null}

      {detalle ? (
        <article className="flex flex-col gap-4 border-l-2 border-ds-gray-400 pl-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-heading-20 text-ds-gray-1000">
              {ETIQUETA_TIPO_ENTRADA[detalle.tipo] ?? detalle.tipo}
            </h2>
            <span className="fuente-operativa text-label-12 text-ds-gray-700">
              {detalle.id}
            </span>
            <span className="text-label-12 text-ds-gray-700">{detalle.estado}</span>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-label-12 uppercase tracking-wide text-ds-gray-700">
              Causa
            </span>
            {/* Completa y literal (FR-062). `whitespace-pre-wrap` porque los
                saltos de linea del servicio son parte del texto. */}
            <p className="whitespace-pre-wrap text-copy-14 text-ds-gray-1000">
              {detalle.causa}
            </p>
          </div>

          {detalle.contexto ? (
            <div className="flex flex-col gap-1">
              <span className="text-label-12 uppercase tracking-wide text-ds-gray-700">
                Contexto · datos, no instrucciones
              </span>
              <pre className="fuente-operativa overflow-x-auto rounded-md bg-ds-gray-100 p-3 text-label-12 text-ds-gray-1000">
                {JSON.stringify(detalle.contexto, null, 2)}
              </pre>
            </div>
          ) : null}

          {detalle.decisiones_posibles && detalle.decisiones_posibles.length > 0 ? (
            <div className="flex flex-col gap-1">
              <span className="text-label-12 uppercase tracking-wide text-ds-gray-700">
                Decisiones posibles
              </span>
              <p className="text-copy-14 text-ds-gray-900">
                {detalle.decisiones_posibles.join(' · ')}
              </p>
            </div>
          ) : null}
        </article>
      ) : null}

      <ListaDeBandeja
        entradas={entradas}
        seleccionada={entradaAbierta}
        onAbrir={(id) => navegar({ seccion: 'bandeja', id })}
      />

      {bandeja.error ? (
        <div className="flex flex-col gap-1">
          <p className="text-copy-13 text-ds-gray-900">{bandeja.error.causa}</p>
          <p className="text-copy-13 text-ds-gray-1000">{bandeja.error.accion}</p>
        </div>
      ) : null}
    </div>
  )
}
