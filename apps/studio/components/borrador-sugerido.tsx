'use client'

import { useState } from 'react'
import { Sparkles, ArrowDownToLine } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/insignia'
import { Note } from '@/components/ui/nota'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { ErrorText } from '@/components/ui/fieldset'
import { useLectura } from '@/lib/lectura'
import { useMutacion } from '@/lib/mutacion'

/**
 * El borrador que propone un modelo, dibujado de forma que NO se pueda
 * confundir con un hallazgo.
 *
 * POR QUE ESTE COMPONENTE ES SOBRE TODO UNA DECISION DE DIBUJO. El servicio ya
 * marca lo que sale del modelo: `origen: "sugerido"`, una advertencia pegada al
 * dato, la procedencia con el modelo que lo produjo, y los apoyos —los
 * hallazgos reales que la sugerencia cita— en una rama aparte. Todo eso se
 * pierde si la pantalla lo pinta igual que lo detectado. Y el precio de
 * perderlo no es estetico: el operador acepta el borrador, se convierte en la
 * guideline del proyecto, y el runtime la aplica durante meses.
 *
 * LAS CUATRO COSAS QUE HACEN QUE SE VEA DISTINTO, Y NINGUNA ES DECORATIVA:
 *
 *   1. VIVE EN SU PROPIO BLOQUE, con borde discontinuo. Lo detectado de este
 *      producto se pinta en bloques solidos; el discontinuo es «esto todavia no
 *      esta». No hay ninguna otra pantalla que lo use, asi que es propio de
 *      esto.
 *   2. LA ADVERTENCIA VIENE DEL SERVICIO, no escrita aqui. Si la escribiera
 *      esta pantalla habria dos textos que dicen lo mismo en dos sitios, y el
 *      dia que uno cambie el otro seguira afirmando lo de ayer. Se pinta el
 *      que viaja pegado al dato.
 *   3. LOS APOYOS SE PINTAN COMO LO QUE SON: hallazgos, con su `detectado` o
 *      `inferido` y con sus rutas. Es la unica parte de esta tarjeta que
 *      tiene un archivo detras, y se ve que la tiene. Lo demas no.
 *   4. NADA SE GUARDA SOLO. El boton dice «copiar al borrador» y lo unico que
 *      hace es rellenar el campo de texto que ya estaba. Guardar sigue siendo
 *      el mismo boton de antes, con la misma peticion. Un boton que pusiera la
 *      sugerencia directamente en el repositorio seria la puerta por la que una
 *      propuesta se convierte en regla sin que nadie la lea.
 *
 * LO QUE NO SE PINTA: el valor de ninguna credencial. La clave del modelo no
 * llega hasta aqui — no sale del servicio — y esta pantalla no la pide ni la
 * guarda.
 */

type Comprobacion = { tipo: string; comando?: string; ruta?: string; patron?: string }

type ReglaSugerida = {
  enunciado: string
  comprobacion: Comprobacion
  se_apoya_en: string[]
  origen: 'sugerido'
  verificable: boolean
  motivo_de_no_verificable?: string
}

type Apoyo = {
  clave: string
  categoria: string | null
  valor?: unknown
  hallazgos?: number
  origen: 'detectado' | 'inferido'
  confianza: string | null
  evidencia: { ruta: string; linea?: number }[]
}

type Sugerencia = {
  tarea: string
  origen: 'sugerido'
  advertencia: string
  procedencia: { proveedor: string; modelo: string; esquema: string; generado: string }
  sugerencia: { borrador: string; se_apoya_en: string[]; reglas: ReglaSugerida[] }
  apoyos: Apoyo[]
}

type CatalogoDeAsistencia = {
  tareas: { clave: string; titulo: string; para_que: string; por_que_no_es_determinista: string }[]
  disponible: boolean
  ausencia?: { porque: string; como_conseguirlo: string }
}

function describirComprobacion(c: Comprobacion): string {
  if (c.tipo === 'comando') return `corre \`${c.comando}\` y exige exit code 0`
  if (c.tipo === 'archivo_existe') return `exige que exista \`${c.ruta}\``
  if (c.tipo === 'archivo_ausente') return `exige que NO exista \`${c.ruta}\``
  if (c.tipo === 'contenido_coincide') return `exige que \`${c.ruta}\` contenga \`${c.patron}\``
  if (c.tipo === 'ruta_prohibida') return `rechaza las rutas que coincidan con \`${c.patron}\``
  return c.tipo
}

export function BorradorSugerido({
  proyectoId,
  area,
  alCopiar,
}: {
  proyectoId: string
  area: string
  /** Rellena el campo de texto que ya existe. NO guarda: guardar sigue siendo el otro boton. */
  alCopiar: (texto: string) => void
}) {
  const catalogo = useLectura<CatalogoDeAsistencia>(`/v1/assistance?project_id=${proyectoId}`)
  const mutacion = useMutacion()
  const [sugerencia, setSugerencia] = useState<Sugerencia | null>(null)

  const pedir = async () => {
    const salida = await mutacion.enviar<{ sugerencia: Sugerencia }>(
      'POST',
      `/v1/projects/${proyectoId}/assistance/suggest`,
      { tarea: 'guideline', area },
    )
    if (salida) setSugerencia(salida.sugerencia)
  }

  // SIN CLAVE NO SE ESCONDE EL BOTON: se dice por que no esta y como se
  // consigue. Un boton que desaparece deja al operador sin saber que existia, y
  // la asistencia es justamente lo que «hoy es invisible».
  if (catalogo.datos && !catalogo.datos.disponible) {
    return (
      <Note tipo="neutral" titulo="La asistencia con IA no esta disponible">
        <p className="text-copy-14">{catalogo.datos.ausencia?.porque}</p>
        <p className="mt-2 text-copy-14 text-ds-gray-900">
          {catalogo.datos.ausencia?.como_conseguirlo}
        </p>
      </Note>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => void pedir()} disabled={mutacion.trabajando}>
          {mutacion.trabajando ? <Spinner tamano="sm" etiqueta="Pidiendo el borrador" /> : <Sparkles />}
          Proponer un borrador
        </Button>
        <span className="text-label-12 text-ds-gray-700">
          Lo redacta un modelo a partir del snapshot. No se guarda nada: rellena el campo de
          arriba para que lo revises.
        </span>
      </div>

      {mutacion.error ? (
        <ErrorText causa={mutacion.error.causa} accion={mutacion.error.accion} />
      ) : null}

      {sugerencia ? (
        // El borde DISCONTINUO es la señal de que esto todavia no esta: ningun
        // bloque de datos detectados de esta aplicacion lo usa.
        <section
          aria-label="Borrador propuesto por un modelo"
          className="flex flex-col gap-4 rounded-lg border border-dashed border-ds-gray-500 bg-ds-background-100 p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge tono="advertencia">Sugerido por un modelo</Badge>
            <span className="fuente-operativa text-label-12 text-ds-gray-700">
              {sugerencia.procedencia.proveedor} · {sugerencia.procedencia.modelo} ·{' '}
              {sugerencia.procedencia.esquema}
            </span>
          </div>

          {/* La advertencia viene del servicio, pegada al dato. Escribirla aqui
              seria la segunda copia del mismo texto. */}
          <p className="max-w-3xl text-copy-14 text-ds-gray-900">{sugerencia.advertencia}</p>

          <div className="flex flex-col gap-1">
            <span className="text-label-12 uppercase tracking-wide text-ds-gray-700">
              Borrador propuesto
            </span>
            <pre className="fuente-operativa max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-ds-background-200 p-3 text-label-13 text-ds-gray-1000">
              {sugerencia.sugerencia.borrador}
            </pre>
          </div>

          {sugerencia.sugerencia.reglas.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="text-label-12 uppercase tracking-wide text-ds-gray-700">
                Reglas propuestas
              </span>
              <ul className="flex flex-col gap-2">
                {sugerencia.sugerencia.reglas.map((regla, i) => (
                  <li key={`${regla.enunciado}-${i}`} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-copy-14 text-ds-gray-1000">{regla.enunciado}</span>
                      {/* Verificable o no lo decide el nucleo del producto, no
                          el modelo: `motivoDeNoVerificable` mira los campos de
                          la comprobacion. Por eso esta insignia si se puede
                          pintar como un hecho. */}
                      <Badge tono={regla.verificable ? 'exito' : 'neutral'}>
                        {regla.verificable ? 'El runtime puede verificarla' : 'Solo documentacion'}
                      </Badge>
                    </div>
                    <span className="fuente-operativa text-label-12 text-ds-gray-900">
                      {describirComprobacion(regla.comprobacion)}
                    </span>
                    {!regla.verificable && regla.motivo_de_no_verificable ? (
                      <span className="text-label-12 text-ds-gray-700">
                        {regla.motivo_de_no_verificable}
                      </span>
                    ) : null}
                    <span className="text-label-12 text-ds-gray-700">
                      Dice apoyarse en: {regla.se_apoya_en.join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* LOS APOYOS SON LA OTRA MITAD, y es la que si tiene archivos
              detras: son hallazgos del scanner, con el origen que el scanner
              les puso. El servicio comprobo que cada clave citada existe de
              verdad en el snapshot; lo que no se puede comprobar es que el
              texto de arriba se siga de ellos. */}
          <div className="flex flex-col gap-2 border-t border-ds-gray-400 pt-3">
            <span className="text-label-12 uppercase tracking-wide text-ds-gray-700">
              Hallazgos que la sugerencia cita — estos si estan comprobados
            </span>
            <ul className="flex flex-col gap-1">
              {sugerencia.apoyos.map((apoyo) => (
                <li key={apoyo.clave} className="flex flex-wrap items-baseline gap-2">
                  <Badge tono={apoyo.origen === 'detectado' ? 'neutral' : 'advertencia'}>
                    {apoyo.origen === 'detectado'
                      ? 'Detectado'
                      : `Inferido · confianza ${apoyo.confianza ?? 'desconocida'}`}
                  </Badge>
                  <span className="fuente-operativa text-label-12 text-ds-gray-1000">
                    {apoyo.clave}
                  </span>
                  <span className="text-label-12 text-ds-gray-700">
                    {apoyo.evidencia.slice(0, 3).map((e) => e.ruta).join(', ')}
                    {apoyo.evidencia.length > 3 ? ` y ${apoyo.evidencia.length - 3} mas` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={() => alCopiar(sugerencia.sugerencia.borrador)}>
              <ArrowDownToLine />
              Copiar al borrador
            </Button>
            <span className="text-label-12 text-ds-gray-700">
              Lo pone en el campo de arriba. Guardar sigue siendo tuyo, y guarda lo que quede
              escrito ahi.
            </span>
          </div>
        </section>
      ) : null}
    </div>
  )
}
