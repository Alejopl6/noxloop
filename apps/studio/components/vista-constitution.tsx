'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { FileSignature, GitPullRequestArrow, Scale } from 'lucide-react'

import { Badge, type TonoDeBadge } from '@/components/ui/insignia'
import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { EmptyState } from '@/components/ui/estado-vacio'
import {
  ErrorText,
  Fieldset,
  FieldsetContent,
  FieldsetFooter,
  WarningText,
} from '@/components/ui/fieldset'
import { Note } from '@/components/ui/nota'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { Encabezado, EsqueletoDeLista, FalloDeLectura } from '@/components/pantalla'
import { VistaDeGuidelines } from '@/components/vista-guidelines'
import { useLectura } from '@/lib/lectura'
import { useMutacion } from '@/lib/mutacion'
import type { ErrorDelServicio } from '@/lib/daemon'
import {
  type ApartadoDeConstitution,
  type Constitution,
  type OrigenDeApartado,
  type PeticionDeEnmienda,
} from '@/lib/tipos'
import type { Navegar } from '@/lib/ruta'

/**
 * T116 (1/3) · Constitution: la propuesta, la fijacion y las enmiendas.
 *
 * CADA APARTADO LLEVA SU ORIGEN, por lo mismo que cada hallazgo del snapshot
 * lleva el suyo, y aqui pesa mas: el snapshot es una lectura que se revisa una
 * vez, y la constitution es lo que el runtime consulta cada vez que una
 * decision es ambigua, durante meses. Un apartado inferido que el operador dio
 * por detectado se convierte en una regla que el proyecto no tiene y que los
 * agentes aplican igual.
 *
 * Y el tercer origen es el que suele desaparecer: `vacio`. El hueco se declara
 * hueco. Un proyecto sin politica de despliegue tiene un apartado vacio, no un
 * apartado con una politica plausible escrita por el modelo.
 *
 * LA ENMIENDA PIDE LOS TRES CAMPOS Y NO DEJA ENVIAR SIN ELLOS. No es una
 * validacion de formulario que alguien puso por costumbre: el contrato
 * devuelve 400 sin ellos, y el 400 viene de la constitution de este
 * repositorio — *"una enmienda sin un fallo detras no es una enmienda: es una
 * preferencia"*. Lo que exigimos de nosotros lo exige el producto, asi que el
 * motivo esta escrito A LA VISTA, junto al formulario, y no escondido en el
 * mensaje de error que sale despues de intentarlo.
 */

const ETIQUETA_ORIGEN: Record<OrigenDeApartado, string> = {
  detectado: 'Detectado',
  inferido: 'Inferido',
  vacio: 'Vacio',
}

const TONO_DEL_ORIGEN: Record<OrigenDeApartado, TonoDeBadge> = {
  detectado: 'exito',
  inferido: 'advertencia',
  vacio: 'neutral',
}

const EXPLICACION_DEL_ORIGEN: Record<OrigenDeApartado, string> = {
  detectado:
    'Sale de algo que el scanner leyo en el repositorio. Tiene evidencia detras.',
  inferido:
    'Es una lectura plausible del proyecto, sin ningun archivo que la respalde. Reviselo antes de fijarla: una regla inferida se aplica igual que una detectada.',
  vacio:
    'El proyecto no declara nada sobre esto y no se ha rellenado con lo probable. Escribelo tu o dejalo vacio a proposito.',
}

/* -------------------------------------------------------------------------- */
/* Apartados                                                                  */
/* -------------------------------------------------------------------------- */

function ApartadoEditable({
  apartado,
  valor,
  alCambiar,
}: {
  apartado: ApartadoDeConstitution
  valor: string
  alCambiar: (valor: string) => void
}) {
  const evidencia = apartado.evidencia ?? []

  return (
    <div className="flex flex-col gap-2 border-l-2 border-ds-gray-400 pl-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-heading-16 text-ds-gray-1000">{apartado.titulo}</h3>
        <Badge tono={TONO_DEL_ORIGEN[apartado.origen]}>
          {ETIQUETA_ORIGEN[apartado.origen]}
          {apartado.origen === 'inferido' && apartado.confianza
            ? ` · confianza ${apartado.confianza}`
            : ''}
        </Badge>
      </div>

      <p className="text-label-12 text-ds-gray-700">
        {EXPLICACION_DEL_ORIGEN[apartado.origen]}
      </p>

      {evidencia.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {evidencia.map((cita, indice) => (
            <li
              key={`${cita.ruta}:${cita.linea ?? indice}`}
              className="fuente-operativa text-label-12 text-ds-gray-900"
            >
              {cita.ruta}
              {typeof cita.linea === 'number' ? `:${cita.linea}` : null}
            </li>
          ))}
        </ul>
      ) : null}

      <Campo
        etiqueta={`Contenido de ${apartado.titulo}`}
        valor={valor}
        alCambiar={alCambiar}
        multilinea
        filas={apartado.origen === 'vacio' ? 3 : 6}
        marcador={
          apartado.origen === 'vacio'
            ? 'Vacio a proposito. Si escribes algo, deja de ser un hueco y pasa a ser una regla.'
            : undefined
        }
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Enmienda                                                                   */
/* -------------------------------------------------------------------------- */

export function FormularioDeEnmienda({
  alEnmendar,
  trabajando,
  error,
}: {
  alEnmendar: (enmienda: PeticionDeEnmienda) => void
  trabajando: boolean
  error: ErrorDelServicio | null
}) {
  const [principio, setPrincipio] = useState('')
  const [fallo, setFallo] = useState('')
  const [rotura, setRotura] = useState('')

  const faltan = [
    principio.trim() ? null : 'que principio cambia',
    fallo.trim() ? null : 'que fallo la motiva',
    rotura.trim() ? null : 'que se rompe si no se enmienda',
  ].filter(Boolean) as string[]

  return (
    <Fieldset>
      <FieldsetContent
        titulo="Enmendar la constitution"
        descripcion="Un cambio a la constitution vigente no sobrescribe: produce una enmienda con fecha, motivo y version anterior recuperable."
      >
        <div className="flex flex-col gap-5">
          {/* El motivo, a la vista y antes del formulario. Escondido en el
              mensaje de error solo se lee cuando ya molesta. */}
          <Note tipo="informativo" titulo="Los tres campos son obligatorios, y no por formalidad">
            Una enmienda sin un fallo detras no es una enmienda: es una preferencia. El
            servicio rechaza la peticion sin los tres campos, y esta pantalla no la
            envia: escribir el fallo concreto es lo que distingue una regla que aprendio
            algo de una regla que alguien prefirio.
          </Note>

          <Campo
            etiqueta="Que principio cambia"
            valor={principio}
            alCambiar={setPrincipio}
            requerido
            ayuda="El principio concreto, no el documento entero."
          />
          <Campo
            etiqueta="Que fallo la motiva"
            valor={fallo}
            alCambiar={setFallo}
            requerido
            multilinea
            filas={3}
            ayuda="Que ocurrio, en concreto, que esta regla no evito. Si no hay un fallo que contar, no hay enmienda que hacer."
          />
          <Campo
            etiqueta="Que se rompe si no se enmienda"
            valor={rotura}
            alCambiar={setRotura}
            requerido
            multilinea
            filas={3}
            ayuda="La consecuencia de dejarlo como esta. Sirve para decidir si el cambio merece la pena y para entenderlo dentro de un ano."
          />

          {error ? <ErrorText causa={error.causa} accion={error.accion} /> : null}
        </div>
      </FieldsetContent>

      <FieldsetFooter
        nota={
          faltan.length > 0
            ? `No se puede enviar: falta ${faltan.join(', falta ')}.`
            : 'Queda registrada con fecha, y la version anterior sigue siendo recuperable.'
        }
      >
        <Button
          onClick={() =>
            alEnmendar({
              principio: principio.trim(),
              fallo_que_motiva: fallo.trim(),
              que_se_rompe_si_no: rotura.trim(),
            })
          }
          disabled={faltan.length > 0 || trabajando}
        >
          {trabajando ? <Spinner tamano="sm" etiqueta="Registrando la enmienda" /> : null}
          <GitPullRequestArrow />
          Registrar enmienda
        </Button>
      </FieldsetFooter>
    </Fieldset>
  )
}

/* -------------------------------------------------------------------------- */
/* El panel                                                                   */
/* -------------------------------------------------------------------------- */

/** Markdown a partir de los apartados. Es lo que se escribe en el repositorio. */
function comoMarkdown(
  apartados: ApartadoDeConstitution[],
  contenidos: Record<string, string>,
): string {
  return apartados
    .map((apartado) => `## ${apartado.titulo}\n\n${(contenidos[apartado.id] ?? '').trim()}`)
    .join('\n\n')
    .trim()
}

export interface PropsDePanelDeConstitution {
  proyectoId: string
  constitution: Constitution | null
  cargando: boolean
  error: ErrorDelServicio | null
  errorDeMutacion: ErrorDelServicio | null
  /** El de la enmienda va aparte: son dos formularios y dos fallos distintos. */
  errorDeEnmienda: ErrorDelServicio | null
  trabajando: boolean
  trabajandoEnLaEnmienda: boolean
  alProponer: () => void
  alFijar: (cuerpo: { contenido: string; apartados?: ApartadoDeConstitution[] }) => void
  alEnmendar: (enmienda: PeticionDeEnmienda) => void
  navegar: Navegar
  /** El bloque de guidelines. Se inyecta para que el catalogo pueda omitirlo. */
  guidelines?: ReactNode
}

export function PanelDeConstitution({
  proyectoId,
  constitution,
  cargando,
  error,
  errorDeMutacion,
  errorDeEnmienda,
  trabajando,
  trabajandoEnLaEnmienda,
  alProponer,
  alFijar,
  alEnmendar,
  navegar,
  guidelines,
}: PropsDePanelDeConstitution) {
  const apartados = useMemo(() => constitution?.apartados ?? [], [constitution])
  const [contenidos, setContenidos] = useState<Record<string, string>>({})
  const [markdown, setMarkdown] = useState('')

  // El borrador del operador se rehace cuando llega otra constitution, no en
  // cada render: si se recalculara siempre, cada relectura por SSE borraria lo
  // que estuviera escribiendo.
  useEffect(() => {
    setContenidos(
      Object.fromEntries(apartados.map((apartado) => [apartado.id, apartado.contenido])),
    )
    setMarkdown(constitution?.contenido ?? '')
  }, [apartados, constitution])

  const vigente = constitution?.vigente === true
  const enmiendas = constitution?.enmiendas ?? []
  const inferidos = apartados.filter((apartado) => apartado.origen === 'inferido').length
  const vacios = apartados.filter((apartado) => apartado.origen === 'vacio').length

  const fijar = () =>
    alFijar(
      apartados.length > 0
        ? { contenido: comoMarkdown(apartados, contenidos), apartados }
        : { contenido: markdown },
    )

  return (
    <div className="flex flex-col gap-10">
      <Encabezado
        titulo="Constitution del proyecto"
        identificador={proyectoId}
        descripcion="Los invariantes que el runtime consulta cuando una decision es ambigua. Se escriben versionados junto al codigo, no dentro de noxloop: un proyecto clonado en otra maquina trae su contexto sin traer esta base de datos."
        volver={{ ruta: { seccion: 'proyectos', id: null }, etiqueta: 'Proyectos' }}
        navegar={navegar}
      />

      {cargando ? <EsqueletoDeLista filas={3} /> : null}

      {!cargando && !constitution ? (
        <EmptyState
          modo={error && error.codigo !== 'recurso_inexistente' ? 'error' : 'primero'}
          titulo={
            error && error.codigo !== 'recurso_inexistente'
              ? 'No Se Pudo Cargar La Constitution'
              : 'Sin Constitution Todavia'
          }
          descripcion={
            error && error.codigo !== 'recurso_inexistente'
              ? error.causa
              : 'El borrador se deriva del snapshot: cada apartado sale de lo que el scanner leyo, de lo que infirio, o se declara vacio. Proponerlo sin haber leido el proyecto produce un documento generico que nadie respeta.'
          }
          accion={
            <Button onClick={alProponer} disabled={trabajando}>
              Proponer un borrador
            </Button>
          }
        />
      ) : null}

      {constitution ? (
        <Fieldset>
          <FieldsetContent
            titulo={vigente ? 'Constitution vigente' : 'Constitution propuesta'}
            descripcion={
              <>
                Version <span className="fuente-operativa">{constitution.version}</span>
                {constitution.ruta_en_repo ? (
                  <>
                    {' · se escribe en '}
                    <span className="fuente-operativa">{constitution.ruta_en_repo}</span>
                  </>
                ) : null}
              </>
            }
          >
            <div className="flex flex-col gap-6">
              {inferidos > 0 || vacios > 0 ? (
                <WarningText>
                  {inferidos > 0
                    ? `${inferidos} ${inferidos === 1 ? 'apartado esta inferido' : 'apartados estan inferidos'}: ninguna evidencia los respalda y se aplicaran igual que los detectados. `
                    : ''}
                  {vacios > 0
                    ? `${vacios} ${vacios === 1 ? 'apartado esta vacio' : 'apartados estan vacios'}, declarados como huecos en vez de rellenados con lo probable.`
                    : ''}
                </WarningText>
              ) : null}

              {apartados.length > 0 ? (
                apartados.map((apartado) => (
                  <ApartadoEditable
                    key={apartado.id}
                    apartado={apartado}
                    valor={contenidos[apartado.id] ?? ''}
                    alCambiar={(valor) =>
                      setContenidos((antes) => ({ ...antes, [apartado.id]: valor }))
                    }
                  />
                ))
              ) : (
                // El servicio mando la constitution como un documento entero y
                // sin apartados. Se edita entera, y se dice que el origen de
                // cada parte no viaja con ella.
                <div className="flex flex-col gap-2">
                  <Note tipo="neutral">
                    Este servicio devolvio la constitution como un unico documento, sin
                    apartados marcados por origen. Se edita entera; que parte salio de una
                    deteccion y cual de una inferencia no viene en la respuesta.
                  </Note>
                  <Campo
                    etiqueta="Constitution"
                    valor={markdown}
                    alCambiar={setMarkdown}
                    multilinea
                    filas={18}
                    operativo
                  />
                </div>
              )}

              {errorDeMutacion ? (
                <ErrorText causa={errorDeMutacion.causa} accion={errorDeMutacion.accion} />
              ) : null}
            </div>
          </FieldsetContent>

          <FieldsetFooter
            nota={
              vigente
                ? 'Guardar sobre una constitution vigente produce una enmienda, no una sobreescritura.'
                : 'Al fijarla se escribe versionada en el repositorio y el proyecto pasa a tener constitution.'
            }
          >
            <Button onClick={fijar} disabled={trabajando}>
              {trabajando ? <Spinner tamano="sm" etiqueta="Fijando la constitution" /> : null}
              <FileSignature />
              {vigente ? 'Guardar cambios' : 'Fijar constitution'}
            </Button>
          </FieldsetFooter>
        </Fieldset>
      ) : null}

      {constitution ? <FalloDeLectura error={error} /> : null}

      {vigente ? (
        <FormularioDeEnmienda
          alEnmendar={alEnmendar}
          trabajando={trabajandoEnLaEnmienda}
          error={errorDeEnmienda}
        />
      ) : null}

      {enmiendas.length > 0 ? (
        <section aria-labelledby="titulo-enmiendas" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="titulo-enmiendas" className="text-heading-20 text-ds-gray-1000">
              Historial de enmiendas
            </h2>
            <p className="text-copy-14 text-ds-gray-900">
              Cada cambio con su fecha, su motivo y la version anterior. Es lo que
              permite responder dentro de un ano a "por que esta regla dice esto".
            </p>
          </div>

          <ol className="flex flex-col gap-6">
            {enmiendas.map((enmienda) => (
              <li key={enmienda.id} className="flex flex-col gap-2 border-l-2 border-ds-gray-400 pl-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-label-14 text-ds-gray-1000">{enmienda.principio}</span>
                  <span className="fuente-operativa text-label-12 text-ds-gray-700">
                    {enmienda.version_anterior} to {enmienda.version_nueva}
                  </span>
                  <span className="fuente-operativa text-label-12 text-ds-gray-700">
                    {enmienda.fecha}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-label-12 uppercase tracking-wide text-ds-gray-700">
                    Fallo que la motiva
                  </span>
                  <p className="whitespace-pre-wrap text-copy-14 text-ds-gray-900">
                    {enmienda.fallo_que_motiva}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-label-12 uppercase tracking-wide text-ds-gray-700">
                    Que se rompe si no
                  </span>
                  <p className="whitespace-pre-wrap text-copy-14 text-ds-gray-900">
                    {enmienda.que_se_rompe_si_no}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {guidelines}

      <div className="flex flex-wrap items-center gap-3 border-t border-ds-gray-400 pt-5">
        <Button
          variant="secondary"
          onClick={() => navegar({ seccion: 'bootstrap', id: proyectoId })}
        >
          <Scale />
          Ir al bootstrap
        </Button>
        <span className="text-label-12 text-ds-gray-700">
          El bootstrap detecta lo que ya hay antes de proponer nada, y ninguna
          recomendacion se escribe sin tu decision.
        </span>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* El contenedor                                                              */
/* -------------------------------------------------------------------------- */

const EVENTOS_DE_CONSTITUTION = ['proyecto.estado', 'sincronizar_completo'] as const

export function VistaDeConstitution({
  proyectoId,
  navegar,
}: {
  proyectoId: string
  navegar: Navegar
}) {
  const lectura = useLectura<Constitution>(`/v1/projects/${proyectoId}/constitution`, {
    relerEn: EVENTOS_DE_CONSTITUTION,
  })
  // Dos mutaciones y no una: fijar la constitution y enmendarla son dos
  // formularios distintos en la misma pantalla, y un solo estado de error
  // pintaria el fallo de uno debajo del otro.
  const mutacion = useMutacion()
  const mutacionDeEnmienda = useMutacion()
  const [propuesta, setPropuesta] = useState<Constitution | null>(null)

  const proponer = async () => {
    const borrador = await mutacion.enviar<Constitution>(
      'POST',
      `/v1/projects/${proyectoId}/constitution/propose`,
    )
    if (borrador) setPropuesta(borrador)
  }

  const fijar = async (cuerpo: { contenido: string; apartados?: ApartadoDeConstitution[] }) => {
    // El contrato fija la ruta y el efecto (`PUT` escribe en el repo y pasa a
    // CONSTITUTED) pero no la forma exacta del cuerpo. Se mandan las dos
    // representaciones: el markdown, que es lo que se escribe, y los apartados,
    // que son lo que conserva el origen de cada parte. Un servicio que solo
    // entienda una ignora la otra; ninguno se queda sin lo que necesita.
    await mutacion.enviar('PUT', `/v1/projects/${proyectoId}/constitution`, cuerpo)
    setPropuesta(null)
    lectura.releer()
  }

  const enmendar = async (enmienda: PeticionDeEnmienda) => {
    await mutacionDeEnmienda.enviar(
      'POST',
      `/v1/projects/${proyectoId}/constitution/amend`,
      enmienda,
    )
    lectura.releer()
  }

  // La propuesta recien pedida gana sobre la lectura: es lo que el operador
  // acaba de pedir ver, y la lectura todavia devuelve la vigente (o un 404).
  const constitution = propuesta ?? lectura.datos

  return (
    <PanelDeConstitution
      proyectoId={proyectoId}
      constitution={constitution}
      cargando={lectura.datos === null && lectura.error === null && propuesta === null}
      error={lectura.error}
      errorDeMutacion={mutacion.error}
      errorDeEnmienda={mutacionDeEnmienda.error}
      trabajando={mutacion.trabajando}
      trabajandoEnLaEnmienda={mutacionDeEnmienda.trabajando}
      alProponer={() => void proponer()}
      alFijar={(cuerpo) => void fijar(cuerpo)}
      alEnmendar={(enmienda) => void enmendar(enmienda)}
      navegar={navegar}
      guidelines={<VistaDeGuidelines proyectoId={proyectoId} />}
    />
  )
}
