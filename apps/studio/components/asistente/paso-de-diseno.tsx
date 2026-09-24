'use client'

import { useEffect, useState } from 'react'
import { Save, SkipForward } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { ErrorText, Fieldset, FieldsetContent, FieldsetFooter } from '@/components/ui/fieldset'
import { Note } from '@/components/ui/nota'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { EsqueletoDeLista, FalloDeLectura } from '@/components/pantalla'
import { useLectura } from '@/lib/lectura'
import { useMutacion } from '@/lib/mutacion'
import type { Guideline } from '@/lib/tipos'

/**
 * El paso de diseno. FR-023: OMITIBLE SIN PENALIZACION NI BLOQUEO.
 *
 * POR QUE ESTE PASO TIENE CUERPO PROPIO Y LOS DEMAS REUTILIZAN SU VISTA. No
 * hay pantalla de consola para el diseno: el contrato expone
 * `PUT /v1/projects/:id/design` y la consola lo alcanza de refilon, como el
 * area `diseno` del selector de guidelines. Eso basta cuando se entra a
 * arreglar algo concreto y no basta en un recorrido, donde el paso tiene que
 * poder decir "esto es opcional" y ofrecer la salida sin que parezca que el
 * operador se esta saltando un requisito.
 *
 * LA OMISION NO PIDE MOTIVO, Y ESO ES DELIBERADO. El nucleo lo dice con todas
 * las letras (`packages/core/src/guidelines/diseno.mjs`): exigir un motivo es
 * la penalizacion por otra via —friccion para el caso que la spec declara
 * legitimo—. Se ofrece el campo, se registra si lo hay, y se registra que no
 * lo hubo si no lo hay. El boton de omitir NO se deshabilita por tenerlo
 * vacio.
 *
 * LO QUE ESTA PANTALLA NO PUEDE SABER, dicho como hueco (principio X): si el
 * paso quedo omitido en una sesion anterior. `etapaDeDiseno` existe en el
 * nucleo y devuelve `pendiente`/`omitida`/`definida`, pero el servicio solo la
 * devuelve como respuesta al `PUT` — no hay `GET` de la etapa en la tabla de
 * rutas. Asi que al entrar se lee la guideline del area (`GET .../guidelines/
 * diseno`), que contesta la mitad de la pregunta: si hay contenido, esta
 * definida. Si no lo hay, NO se puede distinguir "nunca se toco" de "se
 * omitio", y por eso no se pinta ninguna de las dos frases.
 */

/** Lo que devuelve `PUT /v1/projects/:id/design`. Solo la parte que se usa. */
interface EtapaDeDiseno {
  estado: 'pendiente' | 'omitida' | 'definida'
  bloquea: boolean
  penalizacion: string | null
  motivo: string | null
}

interface RespuestaDeDiseno {
  etapa?: EtapaDeDiseno
}

export function PasoDeDiseno({
  proyectoId,
  alTerminar,
}: {
  proyectoId: string
  /** Se llama cuando el paso queda resuelto: definido u omitido. */
  alTerminar: () => void
}) {
  const lectura = useLectura<Guideline>(`/v1/projects/${proyectoId}/guidelines/diseno`)
  const mutacion = useMutacion()
  const [borrador, setBorrador] = useState('')
  const [motivo, setMotivo] = useState('')
  const [etapa, setEtapa] = useState<EtapaDeDiseno | null>(null)

  /**
   * Un 404 aqui no es un fallo: es "este proyecto no tiene guideline de
   * diseno", que es el estado de partida de todos.
   *
   * SE MIRA `estadoHttp` Y NO `codigo`, Y ESA ES LA CORRECCION. El primer
   * intento copiaba la comprobacion de `vista-guidelines.tsx`
   * —`codigo === 'recurso_inexistente'`— y contra el servicio de verdad NO
   * ACIERTA NUNCA. `daemon.ts` solo inventa ese codigo cuando el 404 llega SIN
   * cuerpo de error del contrato; el servicio siempre lo manda, y dentro pone
   * `recurso_desconocido`. Comprobado con curl contra el servicio local:
   *
   *     GET /v1/projects/<id>/guidelines/diseno
   *     404 {"error":{"codigo":"recurso_desconocido", ...}}
   *
   * El sintoma es el peor de los silenciosos: en vez de "esta area todavia no
   * tiene guideline, guardar la crea", el operador lee un error que dice que
   * el recurso pudo borrarlo otra ventana y que vuelva a pedir la lista.
   *
   * `estadoHttp` viene puesto en las dos ramas de `daemon.ts`, con cuerpo y
   * sin el, asi que es la senal que no depende del vocabulario.
   */
  const noExiste = lectura.error?.estadoHttp === 404
  const cargando = lectura.datos === null && lectura.error === null

  // El borrador se resincroniza cuando llega la lectura. Sin esto, entrar al
  // paso con una guideline ya escrita ensena un campo vacio y el siguiente
  // guardado la borraria.
  useEffect(() => {
    setBorrador(lectura.datos?.contenido ?? '')
  }, [lectura.datos])

  const definir = async () => {
    const respuesta = await mutacion.enviar<RespuestaDeDiseno>(
      'PUT',
      `/v1/projects/${proyectoId}/design`,
      { contenido: borrador },
    )
    if (!respuesta) return
    if (respuesta.etapa) setEtapa(respuesta.etapa)
    lectura.releer()
    alTerminar()
  }

  const omitir = async () => {
    const cuerpo = motivo.trim() ? { omitir: true, motivo: motivo.trim() } : { omitir: true }
    const respuesta = await mutacion.enviar<RespuestaDeDiseno>(
      'PUT',
      `/v1/projects/${proyectoId}/design`,
      cuerpo,
    )
    if (!respuesta) return
    if (respuesta.etapa) setEtapa(respuesta.etapa)
    alTerminar()
  }

  return (
    <section aria-labelledby="titulo-diseno" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="titulo-diseno" className="text-heading-20 text-ds-gray-1000">
          Diseno
        </h2>
        <p className="text-copy-14 text-ds-gray-900">
          El sistema de diseno del proyecto: tokens, tipografia, espaciado, las reglas que
          el runtime lee antes de tocar una pantalla. Se guarda como la guideline del area{' '}
          <span className="fuente-operativa">diseno</span>, versionada junto al codigo.
        </p>
      </div>

      <Note tipo="neutral" titulo="Este paso se puede omitir">
        Omitirlo no bloquea ninguna etapa posterior ni penaliza al proyecto. Un motor, una
        libreria o un demonio no tienen superficie visual que describir, y rellenar esto
        con cualquier cosa para poder avanzar es peor que dejarlo vacio: el runtime
        compilaria contexto con un sistema de diseno inventado y lo aplicaria durante
        meses.
      </Note>

      {cargando ? <EsqueletoDeLista filas={1} /> : null}

      {!cargando ? (
        <Fieldset>
          <FieldsetContent
            titulo="Sistema de diseno del proyecto"
            descripcion={
              lectura.datos?.ruta_en_repo ? (
                <>
                  Se escribe en{' '}
                  <span className="fuente-operativa">{lectura.datos.ruta_en_repo}</span>
                </>
              ) : noExiste ? (
                'Este proyecto no tiene guideline de diseno. Guardarla la crea, versionada en el repositorio del proyecto.'
              ) : undefined
            }
          >
            <div className="flex flex-col gap-4">
              <Campo
                etiqueta="Contenido de la guideline de diseno"
                valor={borrador}
                alCambiar={setBorrador}
                multilinea
                filas={12}
                operativo
                marcador="Markdown. Tokens, tipografia, espaciado, componentes: lo que el runtime leera antes de tocar una pantalla."
              />

              <Campo
                etiqueta="Motivo para omitirlo"
                valor={motivo}
                alCambiar={setMotivo}
                ayuda="Opcional. Se registra si lo escribes y se registra que no lo hubo si no. No hace falta para poder omitir."
                marcador="Este proyecto no tiene superficie visual."
              />

              {etapa ? (
                <Note tipo={etapa.estado === 'omitida' ? 'neutral' : 'exito'}>
                  {etapa.estado === 'omitida'
                    ? 'El paso de diseno quedo omitido. El servicio lo registro sin penalizacion y sin bloquear ninguna etapa posterior.'
                    : 'El sistema de diseno quedo definido y escrito en el repositorio del proyecto.'}
                  {etapa.motivo ? ` Motivo registrado: ${etapa.motivo}` : null}
                </Note>
              ) : null}

              {mutacion.error ? (
                <ErrorText causa={mutacion.error.causa} accion={mutacion.error.accion} />
              ) : null}

              {/* El 404 ya se trata arriba como "no existe"; cualquier otro
                  fallo de lectura si es un fallo y se nombra. */}
              {!noExiste ? <FalloDeLectura error={lectura.error} /> : null}
            </div>
          </FieldsetContent>

          <FieldsetFooter nota="Se escribe versionada en el repositorio del proyecto, no dentro de noxloop.">
            {/* El omitir va a la izquierda del guardar y en `secondary`: es una
                salida legitima, no un boton de peligro, y tampoco es la accion
                por defecto de quien si tiene diseno que declarar. */}
            <Button variant="secondary" onClick={() => void omitir()} disabled={mutacion.trabajando}>
              <SkipForward />
              Omitir el diseno
            </Button>

            <Button
              onClick={() => void definir()}
              disabled={mutacion.trabajando || borrador.trim().length === 0}
            >
              {mutacion.trabajando ? (
                <Spinner tamano="sm" etiqueta="Guardando el sistema de diseno" />
              ) : null}
              <Save />
              Guardar el diseno
            </Button>
          </FieldsetFooter>
        </Fieldset>
      ) : null}
    </section>
  )
}
