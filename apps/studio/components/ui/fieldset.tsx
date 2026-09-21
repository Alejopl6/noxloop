import type { ReactNode } from 'react'
import { CircleAlert, Lock, TriangleAlert } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * T115 · `Fieldset` — la tarjeta de ajustes con pie de acciones.
 *
 * ES LA UNICA CAJA DE ESTA CONSOLA, y eso es deliberado. La doctrina de Geist
 * dice "prefer spacing and alignment over borders and boxes"; el `Fieldset` es
 * la excepcion nombrada, porque aqui la caja significa algo concreto: "dentro
 * de este marco hay cambios sin guardar, y el boton de abajo es lo que los
 * aplica". Una caja que no delimita una unidad de guardado es decoracion.
 *
 * DE AHI SALEN DOS REGLAS DE USO:
 *
 *   1. Un `Fieldset` NO va dentro de otro. Dos marcos anidados prometen dos
 *      unidades de guardado independientes y solo hay una.
 *   2. No se usa "una card por seccion". Si la seccion no tiene footer de
 *      acciones, no es un `Fieldset`: es un titulo y contenido, con aire.
 *
 * Es constitution, guidelines y recomendaciones — las tres pantallas que
 * guardan algo.
 *
 * EL BORDE VA EN LA SOMBRA, NO EN `border`. `research.md` §2 lo explica y es la
 * diferencia que mas descoloca al escribirlo: en Geist el borde de un material
 * es `--ds-shadow-border-base`, una sombra de 1px sin difuminado. Sustituirlo
 * por `border: 1px solid` se ve casi igual y descuadra el layout, porque el
 * borde suma a la caja y la sombra no — dos materiales adyacentes dejan de
 * alinearse. Aqui eso es `shadow-ds-border`.
 *
 * La linea que separa el pie SI es un `border-t`: ahi no es el contorno de un
 * material, es un divisor interno, y no hay ningun material que alinear con el.
 */

export function Fieldset({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-lg bg-ds-background-100 shadow-ds-border',
        className,
      )}
    >
      {children}
    </section>
  )
}

export function FieldsetContent({
  titulo,
  descripcion,
  children,
  className,
}: {
  titulo?: string
  descripcion?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-4 px-5 py-5', className)}>
      {titulo || descripcion ? (
        <div className="flex flex-col gap-1.5">
          {titulo ? <h3 className="text-heading-16 text-ds-gray-1000">{titulo}</h3> : null}
          {descripcion ? (
            <div className="text-copy-14 text-ds-gray-900">{descripcion}</div>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  )
}

/**
 * El pie. A la izquierda la consecuencia (o el aviso), a la derecha la accion.
 *
 * Ese orden no es cosmetico: en occidental se lee de izquierda a derecha, asi
 * que el operador encuentra "esto reinicia los agentes en marcha" ANTES que el
 * boton que lo hace. Al reves, lee el aviso justo despues de haber pulsado.
 */
export function FieldsetFooter({
  nota,
  children,
  className,
}: {
  /** La consecuencia de pulsar, o el limite. Texto corto. */
  nota?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 border-t border-ds-gray-400 bg-ds-background-200 px-5 py-3',
        className,
      )}
    >
      <div className="text-label-13 text-ds-gray-900">{nota}</div>
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
    </div>
  )
}

/**
 * `ErrorText` — el error del formulario, junto al formulario.
 *
 * LA API OBLIGA A LA REDACCION CORRECTA, que es la unica forma de que una regla
 * de estilo sobreviva a la tercera prisa: dos campos, `causa` y `accion`, en
 * ese orden, y los dos requeridos. No hay manera de escribir "Algo salio mal"
 * con este componente sin dejar el segundo hueco en blanco y que se note.
 *
 * NFR-006 al pie de la letra: se nombra el recurso concreto. "No se pudo
 * guardar la constitution del proyecto noxloop" y no "Error al guardar".
 *
 * "No se pudo" cuando el bloqueo esta en el estado del operador; "Fallo"
 * cuando el sistema se rompio. Nunca "Algo salio mal".
 *
 * `role="alert"` porque el operador acaba de pulsar y esta esperando: aqui la
 * interrupcion es exactamente lo que pidio.
 */
export function ErrorText({
  causa,
  accion,
  className,
}: {
  causa: ReactNode
  accion: ReactNode
  className?: string
}) {
  return (
    <div role="alert" className={cn('flex items-start gap-2', className)}>
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-ds-red-900" aria-hidden="true" />
      <div className="flex flex-col gap-0.5">
        <p className="text-copy-13 text-ds-red-900">{causa}</p>
        <p className="text-copy-13 text-ds-gray-1000">{accion}</p>
      </div>
    </div>
  )
}

/**
 * `WarningText` — nada ha fallado; algo va a doler si se sigue.
 *
 * La diferencia con `ErrorText` es de tiempo verbal: el error habla en pasado
 * de algo que ya no se puede hacer, la advertencia habla en futuro de algo que
 * todavia se puede evitar. Por eso esta no lleva `role="alert"`: interrumpir
 * por algo que aun no ha pasado entrena a ignorar las interrupciones.
 */
export function WarningText({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start gap-2', className)}>
      <TriangleAlert
        className="mt-0.5 size-4 shrink-0 text-ds-amber-900"
        aria-hidden="true"
      />
      <p className="text-copy-13 text-ds-gray-1000">{children}</p>
    </div>
  )
}

/**
 * `DisabledWall` — el ajuste existe, se ve, y no se puede tocar. Y se dice por
 * que.
 *
 * LA ALTERNATIVA HABITUAL ES PEOR de dos formas. Ocultar el bloque deja al
 * operador buscando un ajuste que la documentacion menciona y el no encuentra.
 * Deshabilitar los controles sin explicacion le deja pulsando un boton muerto
 * hasta que se rinde. Esto ensena la forma del ajuste, la atenua, y pone
 * encima la razon.
 *
 * `inert` es lo que hace que sea de verdad intocable: quita los hijos del orden
 * de tabulacion Y del arbol de accesibilidad de una vez. `pointer-events-none`
 * solo para el raton — con teclado se sigue llegando, y un campo alcanzable
 * dentro de un muro es peor que no tener muro.
 *
 * La razon se escribe en forma de causa + salida, igual que un error: "Solo el
 * propietario del proyecto puede cambiar la constitution" y, si hay salida,
 * cual es. Un muro sin salida deja al operador sin siguiente paso.
 */
export function DisabledWall({
  razon,
  accion,
  children,
  className,
}: {
  razon: ReactNode
  /** La salida, si existe. Un control o un enlace. */
  accion?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('relative', className)}>
      <div inert className="pointer-events-none select-none opacity-40">
        {children}
      </div>

      <div className="absolute inset-0 flex items-center justify-center bg-ds-background-100/60 p-6">
        <div className="flex max-w-sm flex-col items-center gap-2 text-center">
          <Lock className="size-4 text-ds-gray-700" aria-hidden="true" />
          <p className="text-label-14 text-ds-gray-1000">{razon}</p>
          {accion}
        </div>
      </div>
    </div>
  )
}
