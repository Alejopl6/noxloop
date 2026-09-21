'use client'

import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { ErrorText, Fieldset, FieldsetContent, FieldsetFooter } from '@/components/ui/fieldset'
import { Note } from '@/components/ui/nota'
import { Segmentado } from '@/components/ui/segmentado'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { EsqueletoDeLista, FalloDeLectura } from '@/components/pantalla'
import { useLectura, type Lectura } from '@/lib/lectura'
import { useMutacion } from '@/lib/mutacion'
import type { ErrorDelServicio } from '@/lib/daemon'
import { AREAS_DE_GUIDELINE, ETIQUETA_AREA, type AreaDeGuideline, type Guideline } from '@/lib/tipos'

/**
 * T116 (2/3) · Guidelines por area.
 *
 * POR QUE UN SELECTOR DE AREA Y NO SIETE BLOQUES EN LA MISMA PAGINA: las siete
 * areas no se editan a la vez. Se entra a arreglar la de testing, o la de git,
 * y las otras seis solo estorban — y peor, siete `Fieldset` abiertos son siete
 * unidades de guardado a la vista, que es exactamente lo que el componente
 * promete que no ocurre.
 *
 * EL AREA DE DISENO ES OMITIBLE SIN PENALIZACION (FR-023) y hay que decirlo,
 * porque un area vacia dentro de una lista de siete se lee como un hueco que
 * falta rellenar. Un proyecto sin superficie visual no tiene guideline de
 * diseno y eso no bloquea nada.
 */

export function PanelDeGuidelines({
  area,
  alCambiarArea,
  lectura,
  borrador,
  alEditar,
  alGuardar,
  trabajando,
  errorDeMutacion,
}: {
  area: AreaDeGuideline
  alCambiarArea: (area: AreaDeGuideline) => void
  lectura: Lectura<Guideline>
  borrador: string
  alEditar: (contenido: string) => void
  alGuardar: () => void
  trabajando: boolean
  errorDeMutacion: ErrorDelServicio | null
}) {
  const guideline = lectura.datos
  // Un 404 aqui no es un fallo: es "esta area todavia no tiene guideline".
  const noExiste = lectura.error?.codigo === 'recurso_inexistente'
  const cargando = guideline === null && lectura.error === null

  return (
    <section aria-labelledby="titulo-guidelines" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="titulo-guidelines" className="text-heading-20 text-ds-gray-1000">
          Guidelines
        </h2>
        <p className="max-w-2xl text-copy-14 text-ds-gray-900">
          Las reglas que el runtime lee antes de escribir codigo. Quedan versionadas junto
          al codigo, igual que la constitution: la diferencia es que la constitution dice
          que no se puede hacer y las guidelines dicen como se hace lo que si.
        </p>
      </div>

      <Segmentado
        etiqueta="Area de la guideline"
        opciones={AREAS_DE_GUIDELINE.map((cual) => ({
          valor: cual,
          etiqueta: ETIQUETA_AREA[cual],
        }))}
        valor={area}
        alCambiar={alCambiarArea}
      />

      {area === 'diseno' ? (
        <Note tipo="neutral">
          El area de diseno es omitible sin penalizacion. Un proyecto sin superficie
          visual la deja vacia y eso no bloquea ninguna etapa ni ningun run.
        </Note>
      ) : null}

      {cargando ? <EsqueletoDeLista filas={1} /> : null}

      {!cargando ? (
        <Fieldset>
          <FieldsetContent
            titulo={`Guideline de ${ETIQUETA_AREA[area]}`}
            descripcion={
              guideline?.ruta_en_repo ? (
                <>
                  Se escribe en{' '}
                  <span className="fuente-operativa">{guideline.ruta_en_repo}</span>
                </>
              ) : noExiste ? (
                'Esta area no tiene guideline todavia. Guardar la crea, versionada en el repositorio del proyecto.'
              ) : undefined
            }
          >
            <div className="flex flex-col gap-4">
              <Campo
                etiqueta={`Contenido de la guideline de ${ETIQUETA_AREA[area]}`}
                valor={borrador}
                alCambiar={alEditar}
                multilinea
                filas={12}
                operativo
                marcador="Markdown. Lo que el runtime leera antes de tocar codigo de esta area."
              />

              {guideline?.reglas_aplicables && guideline.reglas_aplicables.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <span className="text-label-12 uppercase tracking-wide text-ds-gray-700">
                    Reglas que el runtime puede verificar, no solo leer
                  </span>
                  <ul className="flex flex-col gap-0.5">
                    {guideline.reglas_aplicables.map((regla) => (
                      <li
                        key={regla}
                        className="fuente-operativa text-label-12 text-ds-gray-900"
                      >
                        {regla}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {errorDeMutacion ? (
                <ErrorText causa={errorDeMutacion.causa} accion={errorDeMutacion.accion} />
              ) : null}

              {/* El 404 se trata arriba como "no existe"; cualquier otro fallo
                  de lectura si es un fallo y se nombra. */}
              {!noExiste ? <FalloDeLectura error={lectura.error} /> : null}
            </div>
          </FieldsetContent>

          <FieldsetFooter nota="Se escribe versionada en el repositorio del proyecto, no dentro de noxloop.">
            <Button onClick={alGuardar} disabled={trabajando}>
              {trabajando ? <Spinner tamano="sm" etiqueta="Guardando la guideline" /> : null}
              <Save />
              Guardar guideline
            </Button>
          </FieldsetFooter>
        </Fieldset>
      ) : null}
    </section>
  )
}

export function VistaDeGuidelines({ proyectoId }: { proyectoId: string }) {
  const [area, setArea] = useState<AreaDeGuideline>('testing')
  const [borrador, setBorrador] = useState('')
  const lectura = useLectura<Guideline>(`/v1/projects/${proyectoId}/guidelines/${area}`)
  const mutacion = useMutacion()

  // El borrador se resincroniza al cambiar de area o al llegar otra lectura.
  // Sin esto, cambiar de area dejaria el texto de la anterior en el campo y el
  // siguiente guardado escribiria la guideline de git encima de la de testing.
  useEffect(() => {
    setBorrador(lectura.datos?.contenido ?? '')
  }, [lectura.datos, area])

  const guardar = async () => {
    await mutacion.enviar('PUT', `/v1/projects/${proyectoId}/guidelines/${area}`, {
      area,
      contenido: borrador,
    })
    lectura.releer()
  }

  return (
    <PanelDeGuidelines
      area={area}
      alCambiarArea={setArea}
      lectura={lectura}
      borrador={borrador}
      alEditar={setBorrador}
      alGuardar={() => void guardar()}
      trabajando={mutacion.trabajando}
      errorDeMutacion={mutacion.error}
    />
  )
}
