'use client'

import { useCallback, useState } from 'react'
import { ChevronDown, ChevronRight, Copy } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/**
 * T115 · `VistaJSON` — el snapshot y el diff de una recomendacion, legibles.
 *
 * Un `<pre>{JSON.stringify(x, null, 2)}</pre>` es la alternativa y falla en dos
 * sitios concretos: un snapshot de configuracion son cientos de lineas y no hay
 * forma de plegar lo que no interesa, y cualquier secreto que el servicio haya
 * dejado dentro sale pintado en claro.
 *
 * ENMASCARADO POR DEFECTO (NFR-004). Un visor de JSON crudo es exactamente
 * donde se escapa un secreto: nadie lo mete a proposito, llega dentro de un
 * objeto de contexto que alguien volco entero. La lista de claves sospechosas
 * es heuristica y se sabe incompleta — no sustituye a que el servicio no mande
 * secretos, es la segunda linea. Se puede apagar con `enmascararSecretos` para
 * un payload del que se sabe que no lleva nada.
 *
 * Y LO QUE SE COPIA ES LO QUE SE VE: con el enmascarado puesto, el boton de
 * copiar copia la version enmascarada. Un boton que copia mas de lo que ensena
 * convierte el enmascarado en teatro, porque el primer reflejo ante un valor
 * tapado es copiarlo y pegarlo en otro sitio.
 *
 * Monocromo a proposito: el JSON ya trae sus propias senales no cromaticas
 * —comillas para las cadenas, `true`/`false`/`null` escritos— y colorear por
 * tipo encima es color que no anade significado. Lo unico que se distingue por
 * peso es la clave frente al valor.
 */

const CLAVE_SENSIBLE =
  /(token|secret|password|passwd|api[_-]?key|apikey|authorization|credential|private[_-]?key|session)/i

const VALOR_ENMASCARADO = '••••••••'

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

/** Serializa aplicando el mismo enmascarado que se pinta. Ver la cabecera. */
function serializar(valor: unknown, enmascarar: boolean, claveDelPadre?: string): unknown {
  if (enmascarar && claveDelPadre && CLAVE_SENSIBLE.test(claveDelPadre)) {
    return VALOR_ENMASCARADO
  }
  if (Array.isArray(valor)) return valor.map((hijo) => serializar(hijo, enmascarar))
  if (esObjeto(valor)) {
    const salida: Record<string, unknown> = {}
    for (const [clave, hijo] of Object.entries(valor)) {
      salida[clave] = serializar(hijo, enmascarar, clave)
    }
    return salida
  }
  return valor
}

function Primitivo({ valor }: { valor: unknown }) {
  if (typeof valor === 'string') {
    return <span className="text-ds-gray-1000">&quot;{valor}&quot;</span>
  }
  if (valor === null) return <span className="text-ds-gray-700">null</span>
  if (valor === undefined) return <span className="text-ds-gray-700">undefined</span>
  return <span className="text-ds-gray-900">{String(valor)}</span>
}

function Nodo({
  clave,
  valor,
  nivel,
  profundidadAbierta,
  enmascarar,
}: {
  clave: string | null
  valor: unknown
  nivel: number
  profundidadAbierta: number
  enmascarar: boolean
}) {
  const [abierto, setAbierto] = useState(nivel < profundidadAbierta)

  const enmascarado = enmascarar && clave !== null && CLAVE_SENSIBLE.test(clave)
  const compuesto = !enmascarado && (Array.isArray(valor) || esObjeto(valor))

  const etiquetaDeClave = clave === null ? null : (
    <span className="text-ds-gray-900">{clave}:</span>
  )

  if (!compuesto) {
    return (
      <li className="flex flex-wrap items-baseline gap-x-1.5 py-0.5">
        {etiquetaDeClave}
        {enmascarado ? (
          <>
            <span className="text-ds-gray-700" aria-hidden="true">
              &quot;{VALOR_ENMASCARADO}&quot;
            </span>
            <span className="sr-only">valor enmascarado</span>
          </>
        ) : (
          <Primitivo valor={valor} />
        )}
      </li>
    )
  }

  const entradas: [string, unknown][] = Array.isArray(valor)
    ? valor.map((hijo, indice) => [String(indice), hijo])
    : Object.entries(valor as Record<string, unknown>)

  const resumen = Array.isArray(valor)
    ? `[${entradas.length}]`
    : `{${entradas.length}}`

  return (
    <li className="py-0.5">
      <button
        type="button"
        onClick={() => setAbierto((estaba) => !estaba)}
        aria-expanded={abierto}
        className="flex items-baseline gap-1.5 rounded-sm text-left hover:text-ds-gray-1000"
      >
        {abierto ? (
          <ChevronDown className="size-3 shrink-0 self-center text-ds-gray-700" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3 shrink-0 self-center text-ds-gray-700" aria-hidden="true" />
        )}
        {etiquetaDeClave}
        {/* El recuento va siempre, abierto o cerrado: plegado dice cuanto se
            esconde, y desplegado evita contar a mano para saber si falta algo. */}
        <span className="text-ds-gray-700">{resumen}</span>
      </button>

      {abierto ? (
        <ul className="border-l border-ds-gray-300 pl-3 ml-1.5">
          {entradas.map(([claveHija, hija]) => (
            <Nodo
              key={claveHija}
              clave={claveHija}
              valor={hija}
              nivel={nivel + 1}
              profundidadAbierta={profundidadAbierta}
              enmascarar={enmascarar}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export interface PropsDeVistaJSON {
  valor: unknown
  /** Que es esto. Va al `aria-label` del arbol y al boton de copiar. */
  etiqueta: string
  /** Hasta que nivel arranca desplegado. 2 ensena la forma sin ensenar todo. */
  profundidadAbierta?: number
  enmascararSecretos?: boolean
  className?: string
}

export function VistaJSON({
  valor,
  etiqueta,
  profundidadAbierta = 2,
  enmascararSecretos = true,
  className,
}: PropsDeVistaJSON) {
  const [mensaje, setMensaje] = useState<string | null>(null)

  const copiar = useCallback(async () => {
    const texto = JSON.stringify(serializar(valor, enmascararSecretos), null, 2)
    if (!navigator.clipboard?.writeText) {
      setMensaje('No se pudo copiar: este entorno no da acceso al portapapeles. Selecciona el texto y copialo con el teclado.')
      return
    }
    try {
      await navigator.clipboard.writeText(texto)
      setMensaje(
        enmascararSecretos
          ? 'Copiado, con los valores sensibles enmascarados.'
          : 'Copiado.',
      )
    } catch {
      setMensaje('No se pudo copiar: el navegador denego el acceso al portapapeles. Selecciona el texto y copialo con el teclado.')
    }
  }, [valor, enmascararSecretos])

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-label-12 text-ds-gray-900">{etiqueta}</span>
        <Button variant="secondary" size="sm" onClick={() => void copiar()}>
          <Copy />
          Copiar
        </Button>
      </div>

      <ul
        aria-label={etiqueta}
        className="fuente-operativa overflow-x-auto rounded-md bg-ds-background-200 p-3 text-label-12 text-ds-gray-900"
      >
        <Nodo
          clave={null}
          valor={valor}
          nivel={0}
          profundidadAbierta={profundidadAbierta}
          enmascarar={enmascararSecretos}
        />
      </ul>

      <p role="status" aria-live="polite" className="text-label-12 text-ds-gray-700">
        {mensaje}
      </p>
    </div>
  )
}
