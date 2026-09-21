'use client'

import { useEffect, useId, useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialogo } from '@/components/ui/dialogo'
import { ErrorText } from '@/components/ui/fieldset'
import { Spinner } from '@/components/ui/indicador-de-carga'

/**
 * T162 · `ModalDeAccionDestructiva` — revocar una credencial, revocar un grant.
 *
 * POR QUE ESCRIBIR EL NOMBRE Y NO UN "¿Estas seguro?". Un dialogo de si/no se
 * confirma con el musculo: quien ha revocado nueve credenciales pulsa la decima
 * sin leer, y el dialogo no ha evitado nada — solo ha anadido un clic al camino
 * feliz. Escribir el nombre obliga a MIRAR cual es la cosa, que es exactamente
 * el error que se quiere atrapar: no "no queria revocar", sino "no queria
 * revocar ESTA".
 *
 * Y por eso la comparacion es exacta, sin `trim()` ni `toLowerCase()`: aflojarla
 * devuelve la friccion a cero para el descuidado y no ayuda a nadie mas. Si el
 * operador se deja un espacio, el boton sigue apagado y el texto de ayuda dice
 * que tiene que coincidir exacto.
 *
 * `cerrarAlPulsarFuera` va en `false`. En un dialogo informativo cerrar con un
 * clic fuera es comodo; en este, un clic descuidado justo despues de haber
 * escrito el nombre entero tira el trabajo sin decir nada. Escape sigue
 * funcionando, que es la salida que el operador busca a proposito.
 *
 * Las consecuencias se piden como prop OBLIGATORIA. "Esta accion no se puede
 * deshacer" no es una consecuencia, es una formula: lo que el operador necesita
 * saber es que tres agentes se quedan sin acceso y que el run en marcha va a
 * fallar en el proximo paso.
 */

export interface PropsDeModalDeAccionDestructiva {
  abierto: boolean
  alCerrar: () => void
  /** Verbo + sustantivo. "Revocar credencial", "Eliminar grant". */
  titulo: string
  /** El nombre EXACTO que hay que escribir. Tambien es lo que se ensena arriba. */
  recurso: string
  /** Como se llama la clase de cosa. "la credencial", "el grant". */
  claseDeRecurso: string
  /** Que se pierde, en concreto. Nunca "esta accion no se puede deshacer". */
  consecuencias: ReactNode
  /** El texto del boton. Verbo + sustantivo, el mismo verbo del titulo. */
  etiquetaDeConfirmacion: string
  alConfirmar: () => void
  /** Mientras el servicio responde. Apaga el boton y ensena el progreso. */
  trabajando?: boolean
  /** Lo que fallo al confirmar. Causa y accion, en ese orden (NFR-006). */
  error?: { causa: ReactNode; accion: ReactNode } | null
  className?: string
}

export function ModalDeAccionDestructiva({
  abierto,
  alCerrar,
  titulo,
  recurso,
  claseDeRecurso,
  consecuencias,
  etiquetaDeConfirmacion,
  alConfirmar,
  trabajando = false,
  error = null,
  className,
}: PropsDeModalDeAccionDestructiva) {
  const [escrito, setEscrito] = useState('')
  const idDelCampo = useId()
  const idDeLaAyuda = useId()

  // Lo escrito se tira al abrir y al cerrar. Si se conservara, reabrir el
  // dialogo presentaria el nombre ya escrito y el boton ya activo: justo el
  // "confirmar sin mirar" que el componente existe para impedir.
  useEffect(() => {
    setEscrito('')
  }, [abierto, recurso])

  const coincide = escrito === recurso

  return (
    <Dialogo
      abierto={abierto}
      alCerrar={alCerrar}
      etiqueta={titulo}
      cerrarAlPulsarFuera={false}
      className={className}
    >
      <div className="flex flex-col gap-4 px-5 py-5">
        <h2 className="text-heading-16 text-ds-gray-1000">{titulo}</h2>

        <div className="text-copy-14 text-ds-gray-900">{consecuencias}</div>

        <div className="flex flex-col gap-2">
          <label htmlFor={idDelCampo} className="text-label-13 text-ds-gray-1000">
            Escribe{' '}
            <span className="fuente-operativa text-ds-gray-1000">{recurso}</span> para
            confirmar
          </label>

          <input
            id={idDelCampo}
            value={escrito}
            onChange={(evento) => setEscrito(evento.target.value)}
            aria-describedby={idDeLaAyuda}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            // Es un identificador, no prosa: Geist Mono y sin autocorrector, que
            // en macOS convierte guiones en rayas y deja al operador mirando dos
            // cadenas que se ven iguales y no lo son.
            className={cn(
              'fuente-operativa h-8 w-full rounded-md bg-ds-background-100 px-2.5 text-label-13 text-ds-gray-1000 shadow-ds-border',
              'placeholder:text-ds-gray-700',
            )}
            placeholder={recurso}
          />

          <p id={idDeLaAyuda} className="text-label-12 text-ds-gray-700">
            Tiene que coincidir exacto, con mayusculas y espacios. Es lo que
            garantiza que estas mirando {claseDeRecurso} que crees.
          </p>
        </div>

        {error ? <ErrorText causa={error.causa} accion={error.accion} /> : null}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-ds-gray-400 bg-ds-background-200 px-5 py-3">
        <Button variant="secondary" onClick={alCerrar} disabled={trabajando}>
          Cancelar
        </Button>
        <Button
          variant="destructive"
          onClick={alConfirmar}
          disabled={!coincide || trabajando}
        >
          {trabajando ? <Spinner etiqueta="Aplicando" tamano="sm" /> : null}
          {etiquetaDeConfirmacion}
        </Button>
      </div>
    </Dialogo>
  )
}
