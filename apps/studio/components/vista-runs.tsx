'use client'

import { useEffect, useState } from 'react'
import { Rocket } from 'lucide-react'

import { Badge, type TonoDeBadge } from '@/components/ui/insignia'
import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { Description, ListaDeDescripciones } from '@/components/ui/descripcion'
import { EmptyState } from '@/components/ui/estado-vacio'
import { Fieldset, FieldsetContent, FieldsetFooter } from '@/components/ui/fieldset'
import { Note } from '@/components/ui/nota'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { Instante, Tabla, type ColumnaDeTabla } from '@/components/ui/tabla'
import {
  Encabezado,
  EsqueletoDeLista,
  FalloDeLectura,
  estaCargandoPorPrimeraVez,
} from '@/components/pantalla'
import { useLectura } from '@/lib/lectura'
import { useMutacion } from '@/lib/mutacion'
import type { ErrorDelServicio } from '@/lib/daemon'
import {
  ETIQUETA_ESTADO_PROYECTO,
  ETIQUETA_ESTADO_TAREA,
  type EstadoDeTarea,
  type Proyecto,
  type Run,
  type TareaDeRun,
  etapaQueFalta,
} from '@/lib/tipos'
import { destinoDeLaEtapaQueFalta } from '@/components/ui/ciclo-de-vida'
import { type Navegar } from '@/lib/ruta'

/**
 * T189 · Lanzar un ciclo, y mirar los que ya estan en marcha.
 *
 * LA LISTA DE RUNS NO ESCRIBE NADA, Y ESO SE COMPRUEBA MIRANDO EL ARCHIVO
 * (FR-002, principio VIII). El motor es el unico escritor del estado de un
 * run: estas filas son la proyeccion de archivos que escribe el, y aqui no hay
 * ni un boton de pausar, ni de reintentar, ni de marcar una tarea como
 * integrada. No es que esten deshabilitados: no existen. Un endpoint de
 * lectura con un control de escritura al lado es un segundo escritor, y el
 * segundo escritor no falla al escribir — falla tres pantallas despues, cuando
 * dos ventanas corrompen el mismo run.
 *
 * LA UNICA MUTACION DE ESTA PANTALLA es `POST /v1/projects/:id/runs`, y esta
 * separada de la lista a proposito: vive en su `Fieldset`, que es la unidad de
 * guardado, y lo que hace no es escribir el estado de un run sino pedirle al
 * servicio que arranque el motor.
 *
 * EL 409 SE PINTA COMO ACCION, NO COMO TEXTO (FR-064). El servicio rechaza un
 * lanzamiento sobre un proyecto que no esta `ACTIVE` nombrando la etapa que
 * falta. Un mensaje que dice "falta la constitution" y no lleva a la
 * constitution obliga al operador a recorrer las seis etapas a mano para
 * encontrar la que es — y la que es suele ser la penultima. Por eso el rechazo
 * trae el boton que va exactamente ahi, sacado de `DESTINO_DE_ETAPA`, la misma
 * tabla que usa la fila de la lista de proyectos.
 *
 * Y se impide ANTES de pedirlo cuando el estado ya se conoce: si el proyecto
 * no esta `ACTIVE`, el formulario de lanzamiento no se pinta. El 409 sigue
 * pintandose igual, porque el estado pudo cambiar por debajo entre que esta
 * pantalla lo leyo y el operador pulso.
 */

/* -------------------------------------------------------------------------- */
/* Lo que se deduce de un run sin escribir nada                               */
/* -------------------------------------------------------------------------- */

const TONO_DE_LA_TAREA: Record<EstadoDeTarea, TonoDeBadge> = {
  pending: 'neutral',
  in_progress: 'informativo',
  red: 'advertencia',
  green: 'informativo',
  gated: 'informativo',
  reviewed: 'informativo',
  queued: 'informativo',
  integrated: 'exito',
  blocked: 'error',
}

export function etiquetaDeTarea(estado: string): string {
  return ETIQUETA_ESTADO_TAREA[estado as EstadoDeTarea] ?? estado
}

export function tonoDeTarea(estado: string): TonoDeBadge {
  return TONO_DE_LA_TAREA[estado as EstadoDeTarea] ?? 'neutral'
}

export interface ResumenDeRun {
  total: number
  integradas: number
  bloqueadas: number
  /** `true` cuando todas las tareas estan integradas y hay al menos una. */
  terminado: boolean
}

export function resumirRun(run: Run): ResumenDeRun {
  const tareas = run.tasks ?? []
  const integradas = tareas.filter((tarea) => tarea.status === 'integrated').length
  const bloqueadas = tareas.filter((tarea) => tarea.status === 'blocked').length
  return {
    total: tareas.length,
    integradas,
    bloqueadas,
    terminado: tareas.length > 0 && integradas === tareas.length,
  }
}

/* -------------------------------------------------------------------------- */
/* Un run, en solo lectura                                                    */
/* -------------------------------------------------------------------------- */

const COLUMNAS_DE_TAREAS: ColumnaDeTabla<TareaDeRun>[] = [
  { clave: 'id', encabezado: 'Tarea', alineacion: 'operativo', celda: (tarea) => tarea.id },
  { clave: 'titulo', encabezado: 'Que hace', celda: (tarea) => tarea.title },
  {
    clave: 'estado',
    encabezado: 'Estado',
    celda: (tarea) => (
      <Badge tono={tonoDeTarea(tarea.status)}>{etiquetaDeTarea(tarea.status)}</Badge>
    ),
  },
  {
    clave: 'vueltas',
    encabezado: 'Vueltas',
    alineacion: 'numero',
    celda: (tarea) => {
      const intentos = tarea.attempts
      if (!intentos) return null
      // La suma y no el desglose: la columna contesta "cuanto le ha costado",
      // y el desglose por lazo se lee en el motor, no en un ancho de tabla.
      return (
        (intentos.red ?? 0) +
        (intentos.green ?? 0) +
        (intentos.gate ?? 0) +
        (intentos.review ?? 0)
      )
    },
  },
]

function FilaDeRun({ run, ahora }: { run: Run; ahora: number }) {
  const resumen = resumirRun(run)

  if (run.corrupto) {
    return (
      <Note tipo="advertencia" titulo={`El archivo del run ${run.item.id} no se pudo leer`}>
        El estado existe en disco y no se pudo interpretar. Esta pantalla no lo repara: el
        estado de un run lo escribe el motor, y arreglarlo desde aqui seria convertir esta
        aplicacion en un segundo escritor. Mira el archivo con la CLI del motor sobre el
        mismo home que declara /v1/health.
      </Note>
    )
  }

  return (
    <div className="flex flex-col gap-4 border-l-2 border-ds-gray-400 pl-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-heading-16 text-ds-gray-1000">
          {run.item.title ?? 'Ciclo sin titulo declarado'}
        </h3>
        <span className="fuente-operativa text-label-12 text-ds-gray-700">{run.item.id}</span>
        {resumen.bloqueadas > 0 ? (
          <Badge tono="error">
            {resumen.bloqueadas} {resumen.bloqueadas === 1 ? 'tarea bloqueada' : 'tareas bloqueadas'}
          </Badge>
        ) : resumen.terminado ? (
          <Badge tono="exito">Terminado</Badge>
        ) : (
          <Badge tono="informativo">En curso</Badge>
        )}
      </div>

      <ListaDeDescripciones columnas={4}>
        <Description
          titulo="Tareas integradas"
          contenido={resumen.total > 0 ? `${resumen.integradas} de ${resumen.total}` : undefined}
          nota="Lo escribe el motor al integrar. Esta pantalla lo cuenta, no lo decide."
        />
        <Description titulo="Arrancado" contenido={<Instante valor={run.createdAt} ahora={ahora} />} />
        <Description
          titulo="Ultimo cambio"
          contenido={<Instante valor={run.updatedAt} ahora={ahora} />}
        />
        <Description
          titulo="Gastado"
          contenido={
            run.spent
              ? `${run.spent.usd ?? 0} USD · ${run.spent.calls ?? 0} llamadas`
              : undefined
          }
        />
      </ListaDeDescripciones>

      {run.tasks && run.tasks.length > 0 ? (
        <div className="overflow-x-auto">
          <Tabla
            columnas={COLUMNAS_DE_TAREAS}
            filas={run.tasks}
            claveDeFila={(tarea) => tarea.id}
            etiqueta={`Tareas del ciclo ${run.item.id}`}
          />
        </div>
      ) : (
        <EmptyState
          modo="primero"
          tamano="compacto"
          titulo="Este Ciclo No Tiene Tareas Todavia"
          descripcion="El plan aun no se ha descompuesto en tareas, o el archivo de estado se escribio antes de que existiera el DAG. Cuando el motor lo escriba, esta lista lo refleja sola."
        />
      )}

      {/* El ultimo fallo, entero. Truncarlo aqui es tomar la decision con
          media frase, que es lo mismo que prohibe FR-062 en la bandeja. */}
      {(run.tasks ?? [])
        .filter((tarea) => tarea.lastFailure)
        .map((tarea) => (
          <Note key={`${tarea.id}-fallo`} tipo="advertencia" titulo={`Ultimo fallo de ${tarea.id}`}>
            {tarea.lastFailure}
          </Note>
        ))}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* El panel                                                                   */
/* -------------------------------------------------------------------------- */

export interface PropsDePanelDeRuns {
  proyectoId: string
  /** `null` mientras no se conoce el proyecto: no se supone que este ACTIVE. */
  proyecto: Proyecto | null
  runs: Run[]
  ahora: number
  cargando: boolean
  error: ErrorDelServicio | null
  /** Lo que contesto el ultimo `POST /runs`. Aqui vive el 409 de FR-064. */
  errorDeLanzamiento: ErrorDelServicio | null
  trabajando: boolean
  alLanzar: (workItem: string) => void
  navegar: Navegar
}

export function PanelDeRuns({
  proyectoId,
  proyecto,
  runs,
  ahora,
  cargando,
  error,
  errorDeLanzamiento,
  trabajando,
  alLanzar,
  navegar,
}: PropsDePanelDeRuns) {
  const [workItem, setWorkItem] = useState('')

  const activo = proyecto?.estado === 'ACTIVE'
  // EL ATAJO DE PROYECTO NUEVO, que esta pantalla no contemplaba.
  //
  // Leer `ETAPA_PENDIENTE[estado]` y `DESTINO_DE_ETAPA[estado]` directamente
  // supone que el recorrido es siempre lineal, y no lo es: un proyecto `nuevo`
  // salta de `CREATED` a `CONSTITUTED` sin snapshot, porque no hay codigo que
  // escanear. Con las tablas crudas, a ese proyecto se le decia "corre el
  // analisis" y el boton lo mandaba a escanear una carpeta vacia — una
  // instruccion que no se puede cumplir, que es peor que ninguna.
  //
  // `etapaQueFalta` mira el ORIGEN ademas del estado, y ademas prefiere el
  // veredicto real de la guarda cuando el servicio lo manda: dice que falta de
  // verdad en vez de la frase generica de la etapa.
  const pendiente = proyecto ? etapaQueFalta(proyecto) : null
  const destino = proyecto ? destinoDeLaEtapaQueFalta(proyecto) : null

  return (
    <div className="flex flex-col gap-8">
      <Encabezado
        titulo="Ciclos"
        identificador={proyectoId}
        descripcion="Lanzar un ciclo y mirar los que estan en marcha. Lo que se ve abajo lo escribe el motor: esta pantalla lo lee y no lo toca."
        volver={{ ruta: { seccion: 'proyectos', id: null }, etiqueta: 'Proyectos' }}
        navegar={navegar}
        acciones={
          <Button
            variant="secondary"
            onClick={() => navegar({ seccion: 'flota', id: proyectoId })}
          >
            Ver la flota
          </Button>
        }
      />

      {/* FR-064 en su forma preventiva: si el estado ya dice que no se puede,
          no se ofrece el formulario. La salida es la etapa que falta, con el
          boton que lleva ahi — no un parrafo que la nombra y la deja buscar. */}
      {/* Cuando ya hay un rechazo en pantalla, este bloque sobra: los dos
          dicen lo mismo y ofrecen el mismo boton, y el del servicio lo dice
          mejor — nombra la etapa que falta con lo que el almacen encontro en su
          lugar, no con la tabla generica de esta interfaz. Dos llamadas a la
          accion identicas una encima de otra hacen dudar de si son la misma. */}
      {proyecto && !activo && !errorDeLanzamiento ? (
        <EmptyState
          modo="sin_permiso"
          titulo="Este Proyecto Todavia No Puede Recibir Ciclos"
          descripcion={
            <span className="flex flex-col gap-2">
              <span>
                Esta en {ETIQUETA_ESTADO_PROYECTO[proyecto.estado]} y un ciclo solo se lanza
                desde Activo.{pendiente ? ` ${pendiente.causa}` : null}
              </span>
              {pendiente ? <span className="text-ds-gray-1000">{pendiente.accion}</span> : null}
            </span>
          }
          accion={
            destino && pendiente ? (
              <Button onClick={() => navegar({ seccion: destino, id: proyectoId })}>
                Ir a {pendiente.etapa}
              </Button>
            ) : null
          }
        />
      ) : null}

      {/* EL RECHAZO VA FUERA DEL FORMULARIO, y eso no es colocacion: el
          contenedor relee el proyecto despues de un lanzamiento rechazado —
          porque si el rechazo fue por estado, lo que esta pantalla tenia leido
          estaba viejo— y ese releer deja el proyecto fuera de `ACTIVE`. Con el
          mensaje dentro del `Fieldset`, el formulario desaparecia llevandose el
          motivo, y el operador veia el bloque esfumarse sin saber por que.
          La causa y la accion van literales: las escribe el servicio nombrando
          la etapa que falta, y recortarlas aqui tira la unica informacion util. */}
      {errorDeLanzamiento ? (
        <Note
          tipo="error"
          titulo="No se pudo lanzar el ciclo"
          accion={
            destino && pendiente ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navegar({ seccion: destino, id: proyectoId })}
              >
                Ir a {pendiente.etapa}
              </Button>
            ) : null
          }
        >
          <span className="flex flex-col gap-1">
            <span>{errorDeLanzamiento.causa}</span>
            <span className="text-ds-gray-1000">{errorDeLanzamiento.accion}</span>
            <span className="fuente-operativa text-label-12 text-ds-gray-700">
              codigo: {errorDeLanzamiento.codigo}
            </span>
          </span>
        </Note>
      ) : null}

      {activo ? (
        <Fieldset>
          <FieldsetContent
            titulo="Lanzar un ciclo"
            descripcion="El motor recibe el contexto compilado del proyecto —constitution, guidelines, diseno y work item— y hace lo que ya sabe hacer: plan, DAG, worktrees, gates, pull request."
          >
            <div className="flex flex-col gap-4">
              <Campo
                etiqueta="Work item"
                valor={workItem}
                alCambiar={setWorkItem}
                operativo
                marcador="PROJ-142"
                ayuda="Opcional. El contrato declara la ruta pero no el cuerpo de la peticion, asi que este campo viaja como `item` y vacio no viaja: sin el, el servicio elige con el gestor de tickets conectado. Si tu servicio espera otro nombre, el rechazo lo va a decir con todas sus letras."
                className="max-w-md"
              />
            </div>
          </FieldsetContent>

          <FieldsetFooter nota="Lanzar arranca el motor. A partir de ahi el estado del run lo escribe el, y esta pantalla solo lo lee.">
            <Button onClick={() => alLanzar(workItem.trim())} disabled={trabajando}>
              {trabajando ? <Spinner tamano="sm" etiqueta="Lanzando" /> : null}
              <Rocket />
              Lanzar ciclo
            </Button>
          </FieldsetFooter>
        </Fieldset>
      ) : null}

      {/* A partir de aqui, SOLO LECTURA. Ni un control que escriba. */}
      <section aria-labelledby="titulo-runs" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="titulo-runs" className="text-heading-20 text-ds-gray-1000">
            Ciclos de este proyecto
          </h2>
          <p className="text-copy-14 text-ds-gray-900">
            Se lee y no se toca. El motor es el unico escritor del estado de un run, asi que
            aqui no hay pausar, ni reintentar, ni marcar una tarea: no estan deshabilitados,
            no existen.
          </p>
        </div>

        {cargando ? <EsqueletoDeLista filas={2} /> : null}

        {!cargando && runs.length === 0 ? (
          <EmptyState
            modo={error ? 'error' : 'primero'}
            titulo={error ? 'No Se Pudieron Leer Los Ciclos' : 'Ningun Ciclo Todavia'}
            descripcion={
              error
                ? error.causa
                : 'Este proyecto no tiene ningun archivo de estado de run en el home del servicio. Recien establecido eso es lo normal: no falta nada, todavia no se ha pedido nada.'
            }
          />
        ) : null}

        {/* Un bloque por ciclo, no una fila que hay que abrir: un proyecto tiene
            pocos ciclos vivos a la vez, y lo que el operador viene a mirar —que
            tarea va por donde— esta dentro. Esconderlo tras un clic por cada uno
            convierte "que esta pasando" en seis clics. */}
        {runs.map((run) => (
          <FilaDeRun key={run.item.id} run={run} ahora={ahora} />
        ))}

        {runs.length > 0 ? <FalloDeLectura error={error} /> : null}
      </section>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* El contenedor                                                              */
/* -------------------------------------------------------------------------- */

const EVENTOS_DE_RUNS = ['run.estado', 'proyecto.estado', 'sincronizar_completo'] as const

export function VistaDeRuns({
  proyectoId,
  navegar,
}: {
  proyectoId: string
  navegar: Navegar
}) {
  const lectura = useLectura<Run[]>(`/v1/projects/${proyectoId}/runs`, {
    relerEn: EVENTOS_DE_RUNS,
  })
  const proyecto = useLectura<Proyecto>(`/v1/projects/${proyectoId}`, {
    relerEn: EVENTOS_DE_RUNS,
  })
  const mutacion = useMutacion()

  // `Date.now()` solo despues de hidratar, como en el resto de la consola:
  // leerlo en el render haria que el HTML prerenderizado y el primer render
  // del cliente no coincidan.
  const [ahora, setAhora] = useState(0)
  useEffect(() => {
    setAhora(Date.now())
  }, [])

  const lanzar = async (workItem: string) => {
    await mutacion.enviar(
      'POST',
      `/v1/projects/${proyectoId}/runs`,
      workItem ? { itemId: workItem } : undefined,
    )
    lectura.releer()
    // El proyecto tambien: si el rechazo fue por estado, lo que esta pantalla
    // tenia leido estaba viejo y el boton de la etapa que falta tiene que
    // llevar a la de ahora, no a la de hace cinco minutos.
    proyecto.releer()
  }

  return (
    <PanelDeRuns
      proyectoId={proyectoId}
      proyecto={proyecto.datos}
      runs={lectura.datos ?? []}
      ahora={ahora}
      cargando={estaCargandoPorPrimeraVez(lectura)}
      error={lectura.error}
      errorDeLanzamiento={mutacion.error}
      trabajando={mutacion.trabajando}
      alLanzar={(workItem) => void lanzar(workItem)}
      navegar={navegar}
    />
  )
}
