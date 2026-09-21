'use client'

import { useId, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * `Campo` — una entrada de texto con su etiqueta, su ayuda y su error.
 *
 * NO EXISTIA PORQUE HASTA AHORA ESTA CONSOLA NO ESCRIBIA NADA. Las pantallas
 * de establecimiento (alta de proyecto, enmienda, correccion de un hallazgo,
 * registro de credencial) son las primeras que piden datos, y el patron se
 * repite lo suficiente como para que copiarlo cinco veces garantice que en
 * una de ellas falte el `htmlFor` y el `aria-describedby`.
 *
 * LO QUE LA API OBLIGA, que es el motivo de que sea un componente y no un
 * `<input>` con clases:
 *
 *   1. La etiqueta es obligatoria y va enlazada con `htmlFor`. Un `placeholder`
 *      no es una etiqueta: desaparece justo cuando el operador escribe, que es
 *      cuando necesita recordar que le estaban pidiendo.
 *   2. La ayuda y el error se enlazan por `aria-describedby`. Sin eso, un
 *      lector de pantalla anuncia el campo y no anuncia por que esta en rojo.
 *   3. El error se escribe como en todas partes: causa y accion, en ese orden
 *      (NFR-006). Aqui es un solo texto porque un campo suele tener una sola
 *      frase util; cuando hacen falta dos, el sitio es `ErrorText`.
 *   4. `operativo` marca el campo como identificador —rutas, urls, huellas— y
 *      apaga el corrector: en macOS convierte guiones en rayas y deja al
 *      operador mirando dos cadenas que se ven iguales y no lo son.
 *
 * Y una regla de canal que viene de `research.md` §2: la validacion de un
 * campo NUNCA es un toast. Va aqui, pegada al campo, porque es donde el
 * operador esta mirando.
 */

export interface PropsDeCampo {
  /** Obligatoria. Prosa corta, sin dos puntos al final. */
  etiqueta: string
  valor: string
  alCambiar: (valor: string) => void
  /** Aclaracion permanente bajo el campo. */
  ayuda?: ReactNode
  /** Que esta mal y que hacer. Pinta el campo como invalido. */
  error?: ReactNode
  marcador?: string
  /** Identificador operativo: Geist Mono, sin corrector ni autocompletado. */
  operativo?: boolean
  /**
   * El campo recibe un secreto que esta DE PASO hacia la boveda.
   *
   * Lo que esto hace y lo que NO hace, porque la diferencia importa: pone el
   * campo en modo contrasena —el navegador lo enmascara y no lo ofrece al
   * autocompletado ni al corrector— y nada mas. El valor sigue estando en el
   * DOM mientras se escribe, porque no hay forma de que un campo de texto no
   * lo tenga. Por eso el unico uso legitimo es el instante entre que el
   * operador lo pega y el servicio lo guarda; en cuanto vuelve del servicio,
   * lo que se ensena es la huella y el componente es `SecretValue`.
   */
  secreto?: boolean
  /** Varias lineas. Para prosa larga (justificaciones, motivos). */
  multilinea?: boolean
  filas?: number
  requerido?: boolean
  deshabilitado?: boolean
  /** Control a la derecha de la etiqueta. Un boton, como mucho. */
  accion?: ReactNode
  className?: string
}

export function Campo({
  etiqueta,
  valor,
  alCambiar,
  ayuda,
  error,
  marcador,
  operativo = false,
  secreto = false,
  multilinea = false,
  filas = 4,
  requerido = false,
  deshabilitado = false,
  accion,
  className,
}: PropsDeCampo) {
  const idDelCampo = useId()
  const idDeLaAyuda = useId()
  const idDelError = useId()

  const descrito =
    [ayuda ? idDeLaAyuda : null, error ? idDelError : null].filter(Boolean).join(' ') ||
    undefined

  const clasesComunes = cn(
    'w-full rounded-md bg-ds-background-100 px-2.5 py-1.5 text-ds-gray-1000 shadow-ds-border',
    'placeholder:text-ds-gray-700 disabled:opacity-50',
    operativo ? 'fuente-operativa text-label-13' : 'text-copy-14',
    // El rojo del borde va acompanado del texto de error debajo: el color
    // nunca es la unica senal.
    error ? 'shadow-[0_0_0_1px_var(--ds-red-700)]' : null,
  )

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor={idDelCampo} className="text-label-13 text-ds-gray-1000">
          {etiqueta}
          {requerido ? (
            <>
              {' '}
              <span className="text-ds-gray-700" aria-hidden="true">
                (obligatorio)
              </span>
              <span className="sr-only">obligatorio</span>
            </>
          ) : null}
        </label>
        {accion}
      </div>

      {multilinea ? (
        <textarea
          id={idDelCampo}
          value={valor}
          rows={filas}
          onChange={(evento) => alCambiar(evento.target.value)}
          aria-describedby={descrito}
          aria-invalid={error ? true : undefined}
          required={requerido}
          disabled={deshabilitado}
          placeholder={marcador}
          spellCheck={!operativo}
          autoCorrect={operativo ? 'off' : undefined}
          className={cn(clasesComunes, 'resize-y')}
        />
      ) : (
        <input
          id={idDelCampo}
          type={secreto ? 'password' : 'text'}
          value={valor}
          onChange={(evento) => alCambiar(evento.target.value)}
          aria-describedby={descrito}
          aria-invalid={error ? true : undefined}
          required={requerido}
          disabled={deshabilitado}
          placeholder={marcador}
          spellCheck={!operativo && !secreto}
          autoCorrect={operativo || secreto ? 'off' : undefined}
          autoComplete={secreto ? 'new-password' : operativo ? 'off' : undefined}
          className={cn(clasesComunes, 'h-8 py-0')}
        />
      )}

      {ayuda ? (
        <p id={idDeLaAyuda} className="text-label-12 text-ds-gray-700">
          {ayuda}
        </p>
      ) : null}

      {error ? (
        <p id={idDelError} className="text-copy-13 text-ds-red-900">
          {error}
        </p>
      ) : null}
    </div>
  )
}
