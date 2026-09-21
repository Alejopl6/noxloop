import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { formatearRelativo } from '@/lib/tiempo'
import { Desconocido } from '@/components/ui/desconocido'

/**
 * `Tabla` — datos comparables entre si, y solo eso.
 *
 * SE LLAMA `tabla.tsx` Y NO `table.tsx` por lo mismo que `insignia.tsx`: shadcn
 * publica un `table` en su registro, y ese es un juego de primitivas sueltas
 * (`Table`, `TableHeader`, `TableCell`...) que no sabe nada de las reglas de
 * abajo. Si compartieran nombre, un `npx shadcn add table` se llevaria por
 * delante las reglas sin avisar.
 *
 * LAS REGLAS DE GEIST, METIDAS EN EL COMPONENTE en vez de escritas en una guia
 * que nadie relee. Esa es toda la idea de la API por columnas: la alineacion no
 * la elige quien escribe la celda, la declara la columna, y por tanto no se
 * puede olvidar en la fila 4.
 *
 *   - Texto a la izquierda.
 *   - Numeros a la derecha y con `tabular-nums`. A la derecha porque asi se
 *     alinean las unidades y una columna se puede comparar de un vistazo;
 *     tabulares porque si no, el `1` es mas estrecho que el `8` y la columna
 *     BAILA cada vez que un contador cambia.
 *   - Numeros en Sans, no en Mono. Mono es para identificadores operativos
 *     (ids, huellas, instantes), no para cantidades.
 *   - `—` para lo desconocido, nunca una celda vacia: vacio y "no se cargo" se
 *     ven igual.
 *   - Tiempo relativo hasta 7 dias, absoluto despues. Lo resuelve
 *     `lib/tiempo.ts`, que ya existia con esa regla dentro.
 *   - EL ESTADO VACIO VA FUERA DE LA TABLA. Ver abajo.
 *
 * POR QUE ESTO DEVUELVE `null` CUANDO NO HAY FILAS. Una fila que dice "Sin
 * resultados" es una fila: el lector de pantalla la cuenta, el `aria-rowcount`
 * la incluye, y la cabecera se queda rotulando columnas de nada. Geist manda el
 * estado vacio fuera de la tabla, asi que la tabla desaparece entera y el sitio
 * de llamada decide que poner:
 *
 *     {filas.length > 0
 *       ? <Tabla columnas={...} filas={filas} ... />
 *       : <EmptyState modo="filtrado" consulta={consulta} ... />}
 *
 * Y NO hay bordes entre filas. Solo una linea bajo la cabecera —que ahi si
 * separa dos cosas distintas, rotulos y datos— y resaltado al pasar por encima.
 * Una rejilla completa de lineas es la forma mas rapida de que una tabla de
 * ocho columnas se lea como un tablero de ajedrez.
 */

export type AlineacionDeColumna = 'texto' | 'numero' | 'operativo'

export interface ColumnaDeTabla<T> {
  clave: string
  encabezado: string
  /**
   * `texto` prosa a la izquierda · `numero` cantidades a la derecha con cifras
   * tabulares · `operativo` identificadores en Geist Mono a la izquierda.
   */
  alineacion?: AlineacionDeColumna
  /** Devolver `null`/`undefined`/`''` pinta `—`. No hace falta comprobarlo aqui. */
  celda: (fila: T) => ReactNode
  /** Clases extra para la columna entera (ancho, ocultar en movil). */
  className?: string
}

export interface PropsDeTabla<T> {
  columnas: ColumnaDeTabla<T>[]
  filas: T[]
  claveDeFila: (fila: T) => string
  /** Que contiene la tabla. Va en un `<caption>` para lector de pantalla. */
  etiqueta: string
  className?: string
}

const ALINEACION: Record<AlineacionDeColumna, { celda: string; encabezado: string }> = {
  texto: { celda: 'text-left text-copy-14 text-ds-gray-1000', encabezado: 'text-left' },
  numero: {
    celda: 'text-right text-copy-14 tabular-nums text-ds-gray-1000',
    encabezado: 'text-right',
  },
  operativo: {
    celda: 'text-left fuente-operativa text-label-13 text-ds-gray-900',
    encabezado: 'text-left',
  },
}

export function Tabla<T>({
  columnas,
  filas,
  claveDeFila,
  etiqueta,
  className,
}: PropsDeTabla<T>) {
  if (filas.length === 0) return null

  return (
    <table
      className={cn(
        'w-full border-collapse',
        // LA TABLA ENTERA ENTRA DE UNA VEZ, Y LAS FILAS NO SE ANIMAN.
        //
        // La tentacion aqui es el escalonado: cada `<tr>` con su retraso, que
        // queda muy bien en una captura de tres filas. Con veinte —que es lo
        // normal en runs o en credenciales— son veinte esperas antes de que la
        // ultima linea exista, y el operador que vino a comparar dos numeros se
        // queda mirando como aparecen. Es literalmente "gate reading behind
        // animation", que es lo unico que Geist prohibe de forma explicita.
        //
        // Lo que SI tiene trabajo es el bloque completo: la tabla aparece donde
        // estaba el esqueleto, y el fundido dice "es lo mismo que estabas
        // mirando, ya cargado" en vez de un cambiazo seco.
        //
        // Se anima al MONTAR y no en cada render, y eso es justo lo que se
        // quiere: al filtrar, React reusa el mismo `<table>` y no hay
        // animacion. Volver a fundir la tabla en cada tecleo del filtro seria
        // retrasar la lectura una vez por letra.
        'movimiento-contenido-cargado',
        className,
      )}
    >
      <caption className="sr-only">{etiqueta}</caption>

      <thead>
        <tr className="border-b border-ds-gray-400">
          {columnas.map((columna) => {
            const alineacion = ALINEACION[columna.alineacion ?? 'texto']
            return (
              <th
                key={columna.clave}
                scope="col"
                className={cn(
                  'px-3 py-2 text-label-12 font-normal text-ds-gray-900',
                  alineacion.encabezado,
                  columna.className,
                )}
              >
                {columna.encabezado}
              </th>
            )
          })}
        </tr>
      </thead>

      <tbody>
        {filas.map((fila) => (
          <tr key={claveDeFila(fila)} className="transition-colors hover:bg-ds-gray-alpha-100">
            {columnas.map((columna) => {
              const alineacion = ALINEACION[columna.alineacion ?? 'texto']
              const contenido = columna.celda(fila)
              const vacio = contenido === null || contenido === undefined || contenido === ''

              return (
                <td
                  key={columna.clave}
                  className={cn('px-3 py-2.5 align-top', alineacion.celda, columna.className)}
                >
                  {vacio ? <Desconocido /> : contenido}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * Un instante, con la regla de Geist ya aplicada: relativo hasta 7 dias,
 * absoluto a partir de ahi.
 *
 * `title` lleva SIEMPRE el absoluto completo, tambien cuando se pinta el
 * relativo: "hace 3 horas" es util para decidir y inservible para un informe, y
 * el operador que necesita el instante exacto no deberia tener que ir al log.
 *
 * `suppressHydrationWarning` no hace falta porque esto no llama a `Date.now()`
 * en el render: el `ahora` entra por parametro desde un estado del sitio de
 * llamada, que es como `bandeja.tsx` evita la discrepancia de hidratacion.
 */
export function Instante({
  valor,
  ahora,
}: {
  /** ISO-8601 o epoch en ms. `null` pinta `—`. */
  valor: string | number | null | undefined
  /** El "ahora" del sitio de llamada. Sin el, el prerender y el cliente difieren. */
  ahora: number
}) {
  if (valor === null || valor === undefined || valor === '') return <Desconocido />

  const instante = typeof valor === 'number' ? valor : Date.parse(valor)
  if (Number.isNaN(instante)) return <Desconocido razon="Instante ilegible" />

  return (
    <time
      dateTime={new Date(instante).toISOString()}
      title={new Date(instante).toISOString()}
      className="fuente-operativa"
    >
      {formatearRelativo(instante, ahora)}
    </time>
  )
}
