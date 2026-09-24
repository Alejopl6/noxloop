'use client'

import { useEffect, useId, useState, type ReactNode } from 'react'
import { Minus, Plus, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { Dialogo } from '@/components/ui/dialogo'
import { Markdown } from '@/components/ui/markdown'
import { Note } from '@/components/ui/nota'
import { Segmentado } from '@/components/ui/segmentado'
import type { ErrorDelServicio } from '@/lib/daemon'
import type {
  EstadoDeRuntime,
  ProyectoDelBoard,
  TareaNueva,
  TerminoDeTarea,
} from '@/lib/tipos'

/**
 * NUEVA TAREA: una tarea propia, sin gestor externo (US7, FR-030 a FR-032).
 *
 * POR QUE AHORA SI SE CREA ALGO DESDE EL BOARD, cuando la primera version de
 * la spec lo excluia. Lo excluido sigue excluido: crear o mover tickets de
 * Linear, GitHub o Azure DevOps, que tienen su propio escritor. Lo nuevo es un
 * gestor MAS —el `local`— cuyo unico escritor es el servicio (principio
 * VIII). Esta pantalla manda el formulario al servicio y no guarda nada de
 * el; la tarea aparece en Todo cuando el board se relee, con la clave que el
 * servicio le dio (`PAY-12`).
 *
 * LOS CAMPOS SON LOS QUE EL MOTOR USA, y en el orden en que se piensan: de que
 * proyecto y repo, que hay que hacer (titulo y plan), como se sabe que esta
 * hecho (criterios), cuanto importa (prioridad, etiquetas), quien lo hace
 * (ejecutor) y hasta donde llega (como termina).
 *
 * SIN CRITERIOS SE PUEDE CREAR, pero se dice que pasara: el planificador pide
 * un criterio verificable antes de gastar una ejecucion (US7, escenario 2),
 * igual que con un ticket externo. Bloquear el alta aqui seria un segundo
 * sitio donde vive esa regla.
 */

const PRIORIDADES: Array<{ valor: string; etiqueta: string; numero: number | null }> = [
  { valor: 'urgente', etiqueta: 'Urgente', numero: 0 },
  { valor: 'alta', etiqueta: 'Alta', numero: 1 },
  { valor: 'media', etiqueta: 'Media', numero: 2 },
  { valor: 'baja', etiqueta: 'Baja', numero: 3 },
  { valor: 'ninguna', etiqueta: 'Ninguna', numero: null },
]

const TERMINOS: Array<{ valor: TerminoDeTarea; etiqueta: string; descripcion: string }> = [
  {
    valor: 'changes',
    etiqueta: 'Sin commitear',
    descripcion: 'Deja los cambios en el worktree de la tarea, sin commit. Para revisarlos a mano antes de nada.',
  },
  {
    valor: 'commit',
    etiqueta: 'Commit',
    descripcion: 'Commitea en la rama de la tarea y para ahi. No empuja ni abre pull request.',
  },
  {
    valor: 'pr',
    etiqueta: 'Pull request',
    descripcion: 'Empuja la rama y abre el pull request. Es el limite: ningun modo mergea (principio IV).',
  },
]

/** `select` nativo con la piel de la consola: dentro de un dialogo modal, un
 *  menu que abre OTRO dialogo modal es una pila de capas para elegir uno de
 *  tres proyectos. El nativo trae teclado y lector de pantalla resueltos. */
function Selector({
  etiqueta,
  valor,
  alCambiar,
  children,
  ayuda,
  deshabilitado,
}: {
  etiqueta: string
  valor: string
  alCambiar: (valor: string) => void
  children: ReactNode
  ayuda?: ReactNode
  deshabilitado?: boolean
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label-13 text-ds-gray-900">
        {etiqueta}
      </label>
      <select
        id={id}
        value={valor}
        disabled={deshabilitado}
        onChange={(evento) => alCambiar(evento.target.value)}
        className="h-9 rounded-md bg-ds-background-100 px-2 text-label-14 text-ds-gray-1000 shadow-ds-border outline-none disabled:opacity-50"
      >
        {children}
      </select>
      {ayuda ? <p className="text-label-12 text-ds-gray-700">{ayuda}</p> : null}
    </div>
  )
}

export interface PropsDeFormularioDeTarea {
  /** Los proyectos donde se puede crear: los `ACTIVE`. */
  proyectos: Array<Pick<ProyectoDelBoard, 'id' | 'nombre'> & { remoto?: string | null }>
  proyectoInicial: string | null
  /** `GET /v1/runtimes`. `null` mientras llega o si fallo. */
  runtimes: EstadoDeRuntime[] | null
  enviando: boolean
  error: ErrorDelServicio | null
  alEnviar: (proyectoId: string, tarea: TareaNueva) => Promise<boolean>
  alCancelar?: () => void
}

export function FormularioDeTareaNueva({
  proyectos,
  proyectoInicial,
  runtimes,
  enviando,
  error,
  alEnviar,
  alCancelar,
}: PropsDeFormularioDeTarea) {
  const [proyecto, setProyecto] = useState(proyectoInicial ?? proyectos[0]?.id ?? '')
  const [repo, setRepo] = useState('')
  const [titulo, setTitulo] = useState('')
  const [plan, setPlan] = useState('')
  const [modoPlan, setModoPlan] = useState<'escribir' | 'vista'>('escribir')
  const [criterios, setCriterios] = useState<string[]>([''])
  const [prioridad, setPrioridad] = useState('ninguna')
  const [etiquetas, setEtiquetas] = useState<string[]>([])
  const [etiquetaEscrita, setEtiquetaEscrita] = useState('')
  const [runtime, setRuntime] = useState('')
  const [agente, setAgente] = useState('')
  const [termino, setTermino] = useState<TerminoDeTarea>('pr')
  const [intentado, setIntentado] = useState(false)

  // Si el filtro de proyecto del board cambia con el dialogo cerrado, el
  // proyecto inicial sigue al filtro. Con el dialogo abierto no se pisa.
  useEffect(() => {
    if (proyectoInicial) setProyecto(proyectoInicial)
  }, [proyectoInicial])

  const elegido = proyectos.find((candidato) => candidato.id === proyecto) ?? null
  const criteriosLimpios = criterios.map((criterio) => criterio.trim()).filter(Boolean)
  const faltaTitulo = titulo.trim().length === 0
  const faltaProyecto = !elegido

  const anadirEtiqueta = () => {
    const nuevas = etiquetaEscrita
      .split(',')
      .map((etiqueta) => etiqueta.trim())
      .filter((etiqueta) => etiqueta && !etiquetas.includes(etiqueta))
    if (nuevas.length > 0) setEtiquetas((previas) => [...previas, ...nuevas])
    setEtiquetaEscrita('')
  }

  const enviar = async () => {
    setIntentado(true)
    if (faltaTitulo || faltaProyecto) return
    // Lo que quedo escrito en el campo de etiquetas sin pulsar «Anadir» se
    // incluye: perderlo en silencio al crear es justo lo que no se nota hasta
    // buscar la tarea por esa etiqueta.
    const pendientes = etiquetaEscrita
      .split(',')
      .map((etiqueta) => etiqueta.trim())
      .filter((etiqueta) => etiqueta && !etiquetas.includes(etiqueta))
    const tarea: TareaNueva = {
      repo: repo.trim() || null,
      titulo: titulo.trim(),
      plan,
      criterios: criteriosLimpios,
      prioridad: PRIORIDADES.find((opcion) => opcion.valor === prioridad)?.numero ?? null,
      etiquetas: [...etiquetas, ...pendientes],
      ejecutor: runtime ? { runtime, agente: agente.trim() || null } : null,
      termino,
    }
    const hecho = await alEnviar(proyecto, tarea)
    if (hecho) {
      setTitulo('')
      setPlan('')
      setCriterios([''])
      setEtiquetas([])
      setEtiquetaEscrita('')
      setRepo('')
      setIntentado(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(evento) => {
        evento.preventDefault()
        void enviar()
      }}
    >
      {proyectos.length === 0 ? (
        <Note tipo="advertencia" titulo="No hay ningun proyecto activo donde crearla">
          Una tarea pertenece a un proyecto establecido. Termina de configurar uno con el asistente y
          vuelve aqui.
        </Note>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Selector
          etiqueta="Proyecto"
          valor={proyecto}
          alCambiar={setProyecto}
          deshabilitado={proyectos.length === 0}
        >
          {proyectos.map((candidato) => (
            <option key={candidato.id} value={candidato.id}>
              {candidato.nombre}
            </option>
          ))}
        </Selector>
        <Campo
          etiqueta="Repositorio"
          valor={repo}
          alCambiar={setRepo}
          operativo
          marcador={elegido?.remoto ?? 'el del proyecto'}
          ayuda="Vacio = el repositorio del proyecto."
        />
      </div>

      <Campo
        etiqueta="Titulo"
        valor={titulo}
        alCambiar={setTitulo}
        requerido
        marcador="Que hay que hacer, en una linea"
        error={intentado && faltaTitulo ? 'Falta el titulo: es lo que se lee en la tarjeta y lo primero que lee el planificador. Escribe que hay que hacer.' : undefined}
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-label-13 text-ds-gray-900">Plan</span>
          <Segmentado
            etiqueta="Modo del plan"
            opciones={[
              { valor: 'escribir', etiqueta: 'Escribir' },
              { valor: 'vista', etiqueta: 'Vista previa' },
            ]}
            valor={modoPlan}
            alCambiar={setModoPlan}
          />
        </div>
        {modoPlan === 'escribir' ? (
          <Campo
            etiqueta="Plan en markdown"
            valor={plan}
            alCambiar={setPlan}
            multilinea
            filas={8}
            operativo
            marcador={'## Contexto\n\n## Pasos\n- …'}
            ayuda="Markdown. Es lo que el planificador lee antes de partir la tarea."
          />
        ) : (
          <div className="min-h-40 rounded-md px-3 py-2.5 shadow-ds-border">
            {plan.trim() ? (
              <Markdown texto={plan} />
            ) : (
              <p className="text-copy-14 text-ds-gray-700">El plan esta vacio.</p>
            )}
          </div>
        )}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="pb-2 text-label-13 text-ds-gray-900">Criterios de aceptacion</legend>
        <ol className="flex flex-col gap-2">
          {criterios.map((criterio, indice) => (
            <li key={indice} className="flex items-center gap-2">
              <span aria-hidden="true" className="fuente-operativa w-5 text-right text-label-12 text-ds-gray-700">
                {indice + 1}.
              </span>
              <input
                aria-label={`Criterio ${indice + 1}`}
                value={criterio}
                onChange={(evento) =>
                  setCriterios((previos) => previos.map((valor, n) => (n === indice ? evento.target.value : valor)))
                }
                onKeyDown={(evento) => {
                  if (evento.key === 'Enter') {
                    evento.preventDefault()
                    setCriterios((previos) => [...previos.slice(0, indice + 1), '', ...previos.slice(indice + 1)])
                  }
                }}
                placeholder="Algo que se pueda comprobar: un test, un comando, una respuesta"
                className="h-8 flex-1 rounded-md bg-ds-background-100 px-2 text-label-14 text-ds-gray-1000 shadow-ds-border outline-none placeholder:text-ds-gray-700"
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`Quitar el criterio ${indice + 1}`}
                disabled={criterios.length === 1}
                onClick={() => setCriterios((previos) => previos.filter((_, n) => n !== indice))}
              >
                <Minus aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ol>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => setCriterios((previos) => [...previos, ''])}>
            <Plus aria-hidden="true" />
            Anadir criterio
          </Button>
          {criteriosLimpios.length === 0 ? (
            <span className="text-label-12 text-ds-gray-900">
              Sin criterios, Run pedira uno verificable antes de gastar una ejecucion.
            </span>
          ) : null}
        </div>
      </fieldset>

      <Segmentado
        etiqueta="Prioridad"
        opciones={PRIORIDADES.map(({ valor, etiqueta }) => ({ valor, etiqueta }))}
        valor={prioridad}
        alCambiar={setPrioridad}
      />

      <div className="flex flex-col gap-2">
        <Campo
          etiqueta="Etiquetas"
          valor={etiquetaEscrita}
          alCambiar={setEtiquetaEscrita}
          marcador="api, backend"
          ayuda="Separadas por comas. «Anadir» las fija; lo que quede escrito al crear tambien se guarda."
          accion={
            <Button variant="secondary" size="sm" onClick={anadirEtiqueta} disabled={!etiquetaEscrita.trim()}>
              Anadir
            </Button>
          }
        />
        {etiquetas.length > 0 ? (
          <ul aria-label="Etiquetas de la tarea" className="flex flex-wrap gap-1.5">
            {etiquetas.map((etiqueta) => (
              <li
                key={etiqueta}
                className="inline-flex h-6 items-center gap-1 rounded-full pl-2 pr-1 text-label-12 text-ds-gray-1000 shadow-ds-border"
              >
                {etiqueta}
                <button
                  type="button"
                  aria-label={`Quitar la etiqueta ${etiqueta}`}
                  onClick={() => setEtiquetas((previas) => previas.filter((valor) => valor !== etiqueta))}
                  className="flex size-4 items-center justify-center rounded-full text-ds-gray-700 hover:bg-ds-gray-alpha-200 hover:text-ds-gray-1000"
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Selector
          etiqueta="Ejecutor"
          valor={runtime}
          alCambiar={setRuntime}
          ayuda={
            runtimes === null
              ? 'La lista de modelos no llego del servicio: se puede heredar igual.'
              : 'Vacio = hereda del repo, despues del proyecto, despues el general.'
          }
        >
          <option value="">Heredar</option>
          {(runtimes ?? []).map((candidato) => (
            <option key={candidato.runtime} value={candidato.runtime}>
              {candidato.nombre}
              {candidato.conectado ? '' : ' (no conectado)'}
            </option>
          ))}
        </Selector>
        <Campo
          etiqueta="Agente (opcional)"
          valor={agente}
          alCambiar={setAgente}
          operativo
          deshabilitado={!runtime}
          marcador={runtime ? 'el agente por defecto del runtime' : 'elige un runtime primero'}
        />
      </div>

      <Segmentado
        etiqueta="Como termina"
        opciones={TERMINOS}
        valor={termino}
        alCambiar={setTermino}
      />

      {error ? (
        <Note tipo="error" titulo={error.causa}>
          {error.accion}
        </Note>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-ds-gray-400 pt-4">
        {alCancelar ? (
          <Button variant="ghost" onClick={alCancelar}>
            Cancelar
          </Button>
        ) : null}
        <Button type="submit" disabled={enviando || proyectos.length === 0}>
          {enviando ? 'Creando…' : 'Crear tarea'}
        </Button>
      </div>
    </form>
  )
}

export function DialogoDeTareaNueva({
  abierto,
  alCerrar,
  ...formulario
}: PropsDeFormularioDeTarea & { abierto: boolean; alCerrar: () => void }) {
  return (
    <Dialogo abierto={abierto} alCerrar={alCerrar} etiqueta="Nueva tarea" ancho="lg" cerrarAlPulsarFuera={false}>
      <div className="flex max-h-[85dvh] flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-ds-gray-400 px-5 py-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-heading-16 text-ds-gray-1000">Nueva tarea</h2>
            <p className="text-copy-13 text-ds-gray-900">
              Una tarea propia de noxloop, sin gestor externo. Aparece en Todo con su clave.
            </p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Cerrar" onClick={alCerrar}>
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          {abierto ? <FormularioDeTareaNueva {...formulario} alCancelar={alCerrar} /> : null}
        </div>
      </div>
    </Dialogo>
  )
}
