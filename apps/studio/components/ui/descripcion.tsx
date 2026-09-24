import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { Desconocido } from '@/components/ui/desconocido'

/**
 * T083 · `Description` — el bloque clave/valor de una pagina de detalle.
 *
 * GEIST PROHIBE USAR UNA TABLA DE DOS COLUMNAS PARA ESTO, y la prohibicion
 * tiene motivo: una tabla afirma que sus filas son comparables entre si y que
 * su columna izquierda es un eje. "Proveedor / Creada / Huella / Alcance" no es
 * un eje, son cuatro atributos de UNA cosa. Un lector de pantalla en modo tabla
 * lo recorre como una rejilla y anuncia "fila 3 de 7, columna 1" para leer una
 * ficha. `<dl>` lo anuncia como lo que es: terminos y definiciones.
 *
 * La rejilla es responsive por espaciado, no por bordes: no hay ni una linea
 * entre celdas. Es la regla de "spacing and alignment over borders and boxes"
 * aplicada al sitio donde mas se cae en la tentacion contraria.
 */

export function ListaDeDescripciones({
  children,
  columnas = 3,
  className,
}: {
  children: ReactNode
  /** Cuantas columnas como maximo en pantalla ancha. */
  columnas?: 2 | 3 | 4
  className?: string
}) {
  // Las clases van literales y no interpoladas: Tailwind escanea el fuente en
  // busca de nombres completos, y `sm:grid-cols-${columnas}` no aparece en
  // ningun sitio del CSS generado.
  const rejilla =
    columnas === 2
      ? 'sm:grid-cols-2'
      : columnas === 4
        ? 'sm:grid-cols-2 lg:grid-cols-4'
        : 'sm:grid-cols-2 lg:grid-cols-3'

  return (
    <dl className={cn('grid grid-cols-1 gap-x-10 gap-y-6', rejilla, className)}>
      {children}
    </dl>
  )
}

export interface PropsDeDescription {
  /** La clave. Corta, sin dos puntos al final. */
  titulo: string
  /**
   * El valor. `null` y `undefined` se pintan como desconocido; la cadena vacia
   * tambien, porque un hueco en blanco no se distingue de un fallo de pintado.
   */
  contenido?: ReactNode
  /**
   * Marca el contenido como identificador operativo: id, huella, instante,
   * ruta, comando. Geist Mono, y solo aqui. La prosa y los numeros van en Sans.
   */
  operativo?: boolean
  /** Aclaracion bajo el valor, cuando el valor solo no basta. */
  nota?: ReactNode
  className?: string
}

export function Description({
  titulo,
  contenido,
  operativo = false,
  nota,
  className,
}: PropsDeDescription) {
  const vacio = contenido === null || contenido === undefined || contenido === ''

  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <dt className="text-label-12 text-ds-gray-900">{titulo}</dt>
      <dd
        className={cn(
          'min-w-0 break-words text-ds-gray-1000',
          operativo ? 'fuente-operativa text-label-13' : 'text-copy-14',
        )}
      >
        {vacio ? <Desconocido /> : contenido}
      </dd>
      {nota ? <p className="text-label-12 text-ds-gray-700">{nota}</p> : null}
    </div>
  )
}
