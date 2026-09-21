'use client'

import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { ErrorText, Fieldset, FieldsetContent, FieldsetFooter } from '@/components/ui/fieldset'
import { Seleccion } from '@/components/ui/seleccion'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { EsqueletoDeLista, FalloDeLectura } from '@/components/pantalla'
import { BorradorSugerido } from '@/components/borrador-sugerido'
import { useLectura, type Lectura } from '@/lib/lectura'
import { useMutacion } from '@/lib/mutacion'
import { etiquetaDe, useOpciones, useValorConPreseleccion } from '@/lib/opciones'
import type { ErrorDelServicio } from '@/lib/daemon'
import { GRUPO, type AreaDeGuideline, type GrupoDeOpciones, type Guideline } from '@/lib/tipos'

/**
 * T116 (2/3) · Guidelines por area.
 *
 * POR QUE UN SELECTOR DE AREA Y NO SIETE BLOQUES EN LA MISMA PAGINA: las siete
 * areas no se editan a la vez. Se entra a arreglar la de testing, o la de git,
 * y las otras seis solo estorban — y peor, siete `Fieldset` abiertos son siete
 * unidades de guardado a la vista, que es exactamente lo que el componente
 * promete que no ocurre.
 *
 * LA LISTA DE AREAS YA NO SE ESCRIBE AQUI, y el cambio no es cosmetico. Estaba
 * en `lib/tipos.ts` como una constante de siete elementos copiada del `CHECK`
 * de la tabla `guideline`. Mientras las dos copias coincidieran no se notaba
 * nada; el dia que el enum creciera, esta pantalla habria seguido ofreciendo
 * siete areas y la octava no habria existido para el operador — sin un error,
 * sin un hueco, sin nada que mirar. Ahora sale de `GET /v1/options`, que las
 * deriva de `ENUMS`, trae lo que significa cada una, y con el proyecto delante
 * dice cual respalda el snapshot y con que evidencia.
 *
 * QUE EL AREA DE DISENO ES OMITIBLE SIN PENALIZACION (FR-023) HAY QUE DECIRLO
 * —un area vacia dentro de una lista de siete se lee como un hueco que falta
 * rellenar— y ya NO se dice aqui: lo dice el propio catalogo, en la descripcion
 * de esa opcion, y `Seleccion` la pinta bajo el control cuando esta elegida.
 * Estaba escrito en esta pantalla como una nota con un `area === 'diseno'`
 * dentro, que es la segunda copia de una regla del dominio: el dia que la regla
 * cambie, el servicio la cambia y esta pantalla sigue afirmando la de ayer.
 */

export function PanelDeGuidelines({
  proyectoId,
  areas,
  cargandoOpciones = false,
  area,
  alCambiarArea,
  lectura,
  borrador,
  alEditar,
  alGuardar,
  trabajando,
  errorDeMutacion,
}: {
  /**
   * OPCIONAL a proposito. El catalogo de pantallas monta este panel sin
   * proyecto —es una galeria de componentes, no una sesion— y sin proyecto no
   * hay snapshot del que sugerir ni grant que mirar. Sin el, el bloque de
   * asistencia no se pinta en vez de pintarse roto.
   */
  proyectoId?: string
  /** `guideline.area` del catalogo del servicio. Ver `lib/opciones.ts`. */
  areas: GrupoDeOpciones
  cargandoOpciones?: boolean
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
  //
  // SE MIRA EL ESTADO HTTP Y NO EL CODIGO, y la diferencia se pagaba en
  // pantalla. Esto comparaba contra `recurso_inexistente`, un codigo que
  // `daemon.ts` solo inventa cuando el 404 llega SIN cuerpo del contrato — y el
  // servicio siempre lo manda, con `recurso_desconocido`. Asi que la
  // comparacion nunca era cierta: entrar a un area sin guideline no decia
  // "todavia no tiene, guardar la crea", decia un error que habla de que otra
  // ventana pudo borrar el recurso. El operador leia una alarma donde habia un
  // estado normal.
  //
  // El estado HTTP es el hecho; el codigo es el vocabulario, y hay dos
  // vocabularios en juego —el del servicio y el que el cliente fabrica cuando
  // no recibe ninguno—. Comparar contra uno de los dos funciona hasta que llega
  // el otro.
  const noExiste = lectura.error?.estadoHttp === 404
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

      <Seleccion
        etiqueta="Area de la guideline"
        grupo={areas}
        valor={area}
        alCambiar={(valor) => alCambiarArea(valor as AreaDeGuideline)}
        cargando={cargandoOpciones}
        className="max-w-md"
      />

      {cargando ? <EsqueletoDeLista filas={1} /> : null}

      {!cargando ? (
        <Fieldset>
          <FieldsetContent
            titulo={`Guideline de ${etiquetaDe(areas, area)}`}
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
                etiqueta={`Contenido de la guideline de ${etiquetaDe(areas, area)}`}
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

              {/* EL BORRADOR SUGERIDO VA DEBAJO DEL CAMPO Y NO DENTRO, y eso
                  es la decision entera. Dentro del campo, el texto del modelo
                  seria indistinguible del que escribio el operador en cuanto
                  el cursor pasara por encima: la unica marca que quedaria es
                  la memoria de quien lo pego. Fuera, se ve de donde sale,
                  quien lo produjo y en que hallazgos dice apoyarse, y entra al
                  campo solo cuando alguien pulsa. */}
              {proyectoId ? (
                <BorradorSugerido proyectoId={proyectoId} area={area} alCopiar={alEditar} />
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
  // El area de arranque la PRESELECCIONA EL SERVICIO a partir del snapshot: si
  // el proyecto trae `testing.runner`, se abre en testing y lo dice con la
  // evidencia. Antes estaba fijada a `'testing'` con un literal, que acertaba
  // en los proyectos que tienen tests y mentia en los que no: el operador leia
  // «Guideline de Testing» como si alguien hubiera mirado su repositorio.
  const opciones = useOpciones(proyectoId)
  const areas = opciones.grupoDe(GRUPO.areaDeGuideline)
  const [area, setArea] = useValorConPreseleccion(areas, 'testing')
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
      proyectoId={proyectoId}
      areas={areas}
      cargandoOpciones={opciones.catalogo === null && opciones.lectura.error === null}
      area={area as AreaDeGuideline}
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
