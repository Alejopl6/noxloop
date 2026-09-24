'use client'

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Entity, ListaDeEntidades } from '@/components/ui/entidad'
import { Badge, type TonoDeBadge } from '@/components/ui/insignia'
import { Note } from '@/components/ui/nota'
import { Encabezado, EsqueletoDeLista, FalloDeLectura } from '@/components/pantalla'
import { useServicio } from '@/components/proveedor-servicio'
import { RUTAS_DE_DIAGNOSTICO, comoErrorDelServicio, type ErrorDelServicio } from '@/lib/daemon'
import { useLectura } from '@/lib/lectura'
import type {
  BinarioDiagnosticado,
  Diagnostico,
  DiagnosticoDeProyecto,
  EstadoDeConfianza,
  ProblemaDeDiagnostico,
} from '@/lib/tipos'

/**
 * DIAGNOSTICO: POR QUE UN RUN NO VA A ARRANCAR, ANTES DE PULSAR RUN.
 *
 * La maquina (git, claude, codex, node) y cada proyecto (repositorio,
 * confianza de Claude Code, gate, runtime de cada rol). Todo lo decide el
 * servicio; esta pantalla pinta lo que dice y NO arregla nada por su cuenta
 * (principio VIII): la confianza de Claude Code se acepta abriendo `claude` en
 * la carpeta, y la accion lo dice con esas palabras.
 *
 * «VOLVER A COMPROBAR» pide `fresh=1`: el servicio guarda el diagnostico 30 s
 * para que el board no lance binarios en cada pintada, y el operador que acaba
 * de aceptar el dialogo no tiene por que esperar a que caduque. Esa misma
 * peticion avisa al board, que se repinta con Run ya habilitado.
 */

const TONO_DEL_PROYECTO: Record<DiagnosticoDeProyecto['estado'], TonoDeBadge> = {
  ok: 'exito',
  aviso: 'advertencia',
  bloqueado: 'error',
}

const ETIQUETA_DEL_PROYECTO: Record<DiagnosticoDeProyecto['estado'], string> = {
  ok: 'Listo para Run',
  aviso: 'Con avisos',
  bloqueado: 'Run bloqueado',
}

const TONO_DE_CONFIANZA: Record<EstadoDeConfianza, TonoDeBadge> = {
  aceptada: 'exito',
  pendiente: 'error',
  desconocida: 'advertencia',
}

const ETIQUETA_DE_CONFIANZA: Record<EstadoDeConfianza, string> = {
  aceptada: 'Confianza aceptada',
  pendiente: 'Confianza pendiente',
  desconocida: 'Confianza desconocida',
}

function Binario({ binario }: { binario: BinarioDiagnosticado }) {
  const presente = binario.estado === 'presente'
  return (
    <li>
      <Entity
        contenedor="div"
        titulo={binario.nombre}
        identificador={binario.version ?? undefined}
        descripcion={
          presente ? undefined : (
            <span className="flex flex-col gap-1">
              {binario.causa ? <span className="text-ds-gray-1000">{binario.causa}</span> : null}
              {binario.accion ? <span className="text-ds-gray-700">{binario.accion}</span> : null}
            </span>
          )
        }
        metadatos={
          <Badge tono={presente ? 'exito' : 'error'}>
            {presente ? 'Presente' : binario.estado === 'ausente' ? 'Ausente' : 'No contesta'}
          </Badge>
        }
      />
    </li>
  )
}

/** Un problema: la causa entera y la accion, con a quien afecta. */
function Problema({ problema }: { problema: ProblemaDeDiagnostico }) {
  return (
    <Note
      tipo={problema.nivel === 'bloqueante' ? 'error' : 'advertencia'}
      titulo={problema.causa}
    >
      <p>{problema.accion}</p>
      <p className="text-label-12 text-ds-gray-700">
        {problema.nivel === 'bloqueante' ? 'Deshabilita Run en ' : 'Aviso para '}
        {problema.afecta ? `las tareas que corren con ${problema.afecta}` : 'todas las tareas'}.
      </p>
    </Note>
  )
}

function Proyecto({ proyecto }: { proyecto: DiagnosticoDeProyecto }) {
  const { confianza } = proyecto
  return (
    <section className="flex flex-col gap-3 rounded-md border border-ds-gray-400 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-heading-16 text-ds-gray-1000">{proyecto.nombre}</h4>
        <Badge tono={TONO_DEL_PROYECTO[proyecto.estado]}>{ETIQUETA_DEL_PROYECTO[proyecto.estado]}</Badge>
      </header>

      <dl className="grid gap-x-4 gap-y-2 text-copy-13 sm:grid-cols-[10rem_1fr]">
        <dt className="text-ds-gray-700">Repositorio</dt>
        <dd className="text-ds-gray-1000">
          <span className="fuente-operativa break-all">{proyecto.repositorio.rutaReal ?? proyecto.repositorio.ruta}</span>
          {proyecto.repositorio.estado !== 'ok' ? (
            <span className="block text-ds-red-900">{proyecto.repositorio.detalle}</span>
          ) : null}
        </dd>

        <dt className="text-ds-gray-700">Claude Code</dt>
        <dd className="flex flex-col gap-1">
          <span>
            <Badge tono={TONO_DE_CONFIANZA[confianza.estado]}>{ETIQUETA_DE_CONFIANZA[confianza.estado]}</Badge>
          </span>
          <span className="fuente-operativa break-all text-label-12 text-ds-gray-900">{confianza.evidencia}</span>
          <span className="text-label-12 text-ds-gray-700">{confianza.notaDeFase}</span>
        </dd>

        <dt className="text-ds-gray-700">Gate</dt>
        <dd className="text-ds-gray-1000">
          {proyecto.gate.declarado ? (
            <span className="fuente-operativa">{proyecto.gate.comando}</span>
          ) : (
            <span className="text-ds-red-900">Sin gate{proyecto.gate.de ? `: ${proyecto.gate.de}` : ''}</span>
          )}
        </dd>

        <dt className="text-ds-gray-700">Runtimes</dt>
        <dd className="flex flex-col gap-1">
          {proyecto.runtimes.map((runtime) => (
            <span key={runtime.rol} className="flex flex-wrap items-center gap-2">
              <span className="text-ds-gray-900">{runtime.rol}</span>
              <span className="fuente-operativa">{runtime.runtime}</span>
              <Badge tono={runtime.conectado === true ? 'exito' : runtime.conectado === false ? 'error' : 'neutral'}>
                {runtime.conectado === true ? 'Conectado' : runtime.conectado === false ? 'Sin conectar' : 'No se sabe'}
              </Badge>
            </span>
          ))}
        </dd>
      </dl>

      {proyecto.problemas.length > 0 ? (
        <div className="flex flex-col gap-2">
          {proyecto.problemas.map((problema) => (
            <Problema key={`${problema.codigo}:${problema.afecta ?? '*'}`} problema={problema} />
          ))}
        </div>
      ) : null}
    </section>
  )
}

export interface PropsDePanelDeDiagnostico {
  diagnostico: Diagnostico | null
  cargando: boolean
  error: ErrorDelServicio | null
  comprobando: boolean
  alVolverAComprobar: () => void
}

export function PanelDeDiagnostico({
  diagnostico,
  cargando,
  error,
  comprobando,
  alVolverAComprobar,
}: PropsDePanelDeDiagnostico) {
  return (
    <div className="flex flex-col gap-8">
      <Encabezado
        titulo="Diagnostico"
        descripcion="Lo que un run necesita de esta maquina y de cada proyecto, comprobado sin escribir nada. Lo bloqueante deshabilita Run en las tarjetas a las que afecta, con el mismo motivo."
        acciones={
          <Button variant="secondary" size="sm" disabled={comprobando} onClick={alVolverAComprobar}>
            <RefreshCw aria-hidden="true" />
            {comprobando ? 'Comprobando…' : 'Volver a comprobar'}
          </Button>
        }
      />

      <FalloDeLectura error={error} />
      {cargando ? <EsqueletoDeLista filas={4} /> : null}

      {diagnostico ? (
        <>
          <section className="flex flex-col gap-3">
            <h3 className="text-heading-16 text-ds-gray-1000">Esta maquina</h3>
            <ListaDeEntidades etiqueta="Binarios de la maquina">
              {diagnostico.maquina.binarios.map((binario) => (
                <Binario key={binario.nombre} binario={binario} />
              ))}
            </ListaDeEntidades>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-heading-16 text-ds-gray-1000">Proyectos</h3>
            {diagnostico.proyectos.length === 0 ? (
              <p className="text-copy-14 text-ds-gray-900">No hay proyectos que diagnosticar todavia.</p>
            ) : (
              diagnostico.proyectos.map((proyecto) => <Proyecto key={proyecto.id} proyecto={proyecto} />)
            )}
          </section>

          <p className="text-label-12 text-ds-gray-700">
            Comprobado {new Date(diagnostico.generado).toLocaleString()}. El servicio lo guarda 30 s.
          </p>
        </>
      ) : null}
    </div>
  )
}

/**
 * «Volver a comprobar»: la ruta con `fresh=1`, y despues la lectura de
 * siempre, que ya recibe lo recien comprobado.
 */
function useComprobar(proyecto: string | null, releer: () => void) {
  const { cliente } = useServicio()
  const [comprobando, setComprobando] = useState(false)
  const [error, setError] = useState<ErrorDelServicio | null>(null)
  const comprobar = async () => {
    if (!cliente) return
    setComprobando(true)
    setError(null)
    try {
      await cliente.obtener<Diagnostico>(RUTAS_DE_DIAGNOSTICO.diagnostico({ proyecto, fresco: true }))
      releer()
    } catch (fallo) {
      setError(comoErrorDelServicio(fallo))
    } finally {
      setComprobando(false)
    }
  }
  return { comprobando, error, comprobar }
}

export function VistaDeDiagnostico() {
  const lectura = useLectura<Diagnostico>(RUTAS_DE_DIAGNOSTICO.diagnostico())
  const { comprobando, error, comprobar } = useComprobar(null, lectura.releer)
  return (
    <PanelDeDiagnostico
      diagnostico={lectura.datos}
      cargando={lectura.datos === null && lectura.error === null}
      error={error ?? lectura.error}
      comprobando={comprobando}
      alVolverAComprobar={() => void comprobar()}
    />
  )
}

/* -------------------------------------------------------------------------- */
/* El resumen en Settings del proyecto                                        */
/* -------------------------------------------------------------------------- */

export function ResumenDeDiagnostico({
  diagnostico,
  error,
  comprobando,
  alVolverAComprobar,
}: {
  diagnostico: Diagnostico | null
  error: ErrorDelServicio | null
  comprobando: boolean
  alVolverAComprobar: () => void
}) {
  const proyecto = diagnostico?.proyectos[0] ?? null
  // Lo de la maquina tambien apaga Run aqui (git ausente): se cuenta junto.
  const problemas = [
    ...(diagnostico?.maquina.problemas.filter((problema) => problema.nivel === 'bloqueante') ?? []),
    ...(proyecto?.problemas ?? []),
  ]
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-heading-16 text-ds-gray-1000">Diagnostico</h3>
        <Button variant="ghost" size="sm" disabled={comprobando} onClick={alVolverAComprobar}>
          <RefreshCw aria-hidden="true" />
          {comprobando ? 'Comprobando…' : 'Volver a comprobar'}
        </Button>
      </div>
      <FalloDeLectura error={error} />
      {proyecto ? (
        <>
          <p className="flex flex-wrap items-center gap-2 text-copy-14 text-ds-gray-900">
            <Badge tono={TONO_DEL_PROYECTO[proyecto.estado]}>{ETIQUETA_DEL_PROYECTO[proyecto.estado]}</Badge>
            <Badge tono={TONO_DE_CONFIANZA[proyecto.confianza.estado]}>
              {ETIQUETA_DE_CONFIANZA[proyecto.confianza.estado]}
            </Badge>
            <span>
              {problemas.length === 0
                ? 'Nada impide lanzar un run en este proyecto.'
                : `${problemas.length} ${problemas.length === 1 ? 'cosa' : 'cosas'} que mirar. El detalle completo esta en Settings → Diagnostico.`}
            </span>
          </p>
          {problemas.map((problema) => (
            <Problema key={`${problema.codigo}:${problema.binario ?? problema.afecta ?? '*'}`} problema={problema} />
          ))}
        </>
      ) : null}
    </section>
  )
}

export function ResumenDeDiagnosticoDelProyecto({ proyectoId }: { proyectoId: string }) {
  const lectura = useLectura<Diagnostico>(RUTAS_DE_DIAGNOSTICO.diagnostico({ proyecto: proyectoId }))
  const { comprobando, error, comprobar } = useComprobar(proyectoId, lectura.releer)
  return (
    <ResumenDeDiagnostico
      diagnostico={lectura.datos}
      error={error ?? lectura.error}
      comprobando={comprobando}
      alVolverAComprobar={() => void comprobar()}
    />
  )
}
