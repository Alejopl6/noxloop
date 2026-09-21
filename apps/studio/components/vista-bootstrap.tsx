'use client'

import { useMemo, useState } from 'react'
import { Check, Pencil, Search, SkipForward } from 'lucide-react'

import { ArbolDeArchivos, type EstadoDeArchivo, type NodoDeArchivo } from '@/components/ui/arbol-de-archivos'
import { Badge, type TonoDeBadge } from '@/components/ui/insignia'
import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { EmptyState } from '@/components/ui/estado-vacio'
import { ErrorText, Fieldset, FieldsetContent, FieldsetFooter } from '@/components/ui/fieldset'
import { Note } from '@/components/ui/nota'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { VistaJSON } from '@/components/ui/vista-json'
import { Encabezado, EsqueletoDeLista, FalloDeLectura } from '@/components/pantalla'
import { useLectura } from '@/lib/lectura'
import { useMutacion } from '@/lib/mutacion'
import type { ErrorDelServicio } from '@/lib/daemon'
import {
  ETIQUETA_TIPO_RECOMENDACION,
  type ArchivoDeRecomendacion,
  type DecisionDeRecomendacion,
  type Recomendacion,
} from '@/lib/tipos'
import type { Navegar } from '@/lib/ruta'

/**
 * T116 (3/3) · Bootstrap: lo que la herramienta propone y el operador decide.
 *
 * LA REGLA QUE ORDENA LA PANTALLA ENTERA (FR-026): EL DIFF EXACTO SE ENSENA
 * ANTES DE ESCRIBIR. No un resumen de lo que va a pasar, no "se crearan 3
 * archivos": los archivos, con su contenido. Y lo que se aplica es lo que se
 * vio — el contrato lo sostiene por el otro lado, porque `apply` no recalcula
 * nada y falla con `diff_obsoleto` si el arbol cambio desde que se propuso.
 *
 * Aplicar algo distinto de lo mostrado es la forma exacta en que se pierde la
 * confianza en un instalador, y se pierde una sola vez.
 *
 * TRES SALIDAS POR RECOMENDACION, ni una mas ni una menos (FR-025): aplicar,
 * personalizar, omitir. Omitir NO es cerrar el aviso: se registra con su
 * motivo, y ese registro es lo unico que despues permite saber que clase de
 * propuesta acepta este operador y cual descarta.
 *
 * UNA RECOMENDACION EN CONFLICTO CON LA CONSTITUTION SE PINTA CON EL CONFLICTO
 * DECLARADO (FR-028). No se esconde y no se propone en silencio: se dice cual
 * es la regla que contradice, y la decision sigue siendo del operador.
 */

const TONO_DE_DECISION: Record<DecisionDeRecomendacion, TonoDeBadge> = {
  pendiente: 'neutral',
  aplicada: 'exito',
  personalizada: 'informativo',
  omitida: 'neutral',
}

const ETIQUETA_DECISION: Record<DecisionDeRecomendacion, string> = {
  pendiente: 'Sin decidir',
  aplicada: 'Aplicada',
  personalizada: 'Personalizada',
  omitida: 'Omitida',
}

/**
 * De una lista plana de rutas al arbol que `ArbolDeArchivos` pinta.
 *
 * El servicio manda rutas (`.claude/hooks/pre-commit.mjs`) porque es lo que un
 * diff tiene. La jerarquia se reconstruye aqui y no se le pide al servicio:
 * es presentacion, y el dia que la pantalla prefiera una lista plana no hay
 * que cambiar el contrato.
 */
function arbolDesde(archivos: ArchivoDeRecomendacion[]): NodoDeArchivo[] {
  const raiz: NodoDeArchivo[] = []

  for (const archivo of archivos) {
    const partes = archivo.ruta.split('/').filter(Boolean)
    let nivel = raiz

    partes.forEach((parte, indice) => {
      const ultimo = indice === partes.length - 1
      let nodo = nivel.find((candidato) => candidato.nombre === parte)

      if (!nodo) {
        nodo = ultimo
          ? { nombre: parte, tipo: 'archivo', estado: archivo.estado as EstadoDeArchivo }
          : { nombre: parte, tipo: 'directorio', hijos: [] }
        nivel.push(nodo)
      }

      if (!ultimo) {
        if (!nodo.hijos) nodo.hijos = []
        nivel = nodo.hijos
      }
    })
  }

  return raiz
}

/* -------------------------------------------------------------------------- */
/* Una recomendacion                                                          */
/* -------------------------------------------------------------------------- */

function TarjetaDeRecomendacion({
  recomendacion,
  trabajando,
  error,
  alAplicar,
  alPersonalizar,
  alOmitir,
  alRecalcular,
}: {
  recomendacion: Recomendacion
  trabajando: boolean
  error: ErrorDelServicio | null
  alAplicar: (recomendacion: Recomendacion) => void
  alPersonalizar: (recomendacion: Recomendacion, diff: string) => void
  alOmitir: (recomendacion: Recomendacion, motivo: string) => void
  alRecalcular: () => void
}) {
  const [modo, setModo] = useState<'cerrado' | 'diff' | 'personalizar' | 'omitir'>('cerrado')
  const [diff, setDiff] = useState(recomendacion.diff)
  const [motivo, setMotivo] = useState('')
  const [archivo, setArchivo] = useState<string | null>(null)

  const archivos = recomendacion.archivos ?? []
  const arbol = useMemo(() => arbolDesde(archivos), [archivos])
  const seleccionado = archivos.find((candidato) => candidato.ruta === archivo) ?? null
  const decidida = recomendacion.decision !== 'pendiente'

  return (
    <Fieldset>
      <FieldsetContent
        titulo={recomendacion.titulo}
        descripcion={recomendacion.justificacion}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tono="neutral">{ETIQUETA_TIPO_RECOMENDACION[recomendacion.tipo]}</Badge>
            <Badge tono={TONO_DE_DECISION[recomendacion.decision]}>
              {ETIQUETA_DECISION[recomendacion.decision]}
            </Badge>
            <span className="fuente-operativa text-label-12 text-ds-gray-700">
              {recomendacion.id}
            </span>
            {archivos.length > 0 ? (
              <span className="text-label-12 text-ds-gray-700">
                Toca {archivos.length} {archivos.length === 1 ? 'archivo' : 'archivos'}
              </span>
            ) : null}
          </div>

          {/* FR-028. El conflicto se declara, no se esconde ni se resuelve por
              el operador: se le dice cual es la regla y decide el. */}
          {recomendacion.conflicto_constitution ? (
            <Note tipo="advertencia" titulo="Contradice la constitution del proyecto">
              {recomendacion.conflicto_constitution}
            </Note>
          ) : null}

          {recomendacion.decision === 'omitida' && recomendacion.motivo_decision ? (
            <p className="text-copy-13 text-ds-gray-900">
              Omitida por: {recomendacion.motivo_decision}
            </p>
          ) : null}

          {modo === 'diff' ? (
            <div className="flex flex-col gap-3">
              <p className="text-copy-13 text-ds-gray-900">
                Esto es exactamente lo que se escribira. Si el arbol del proyecto cambio
                desde que se calculo, aplicar falla y pide recalcular en vez de escribir
                otra cosa.
              </p>

              {arbol.length > 0 ? (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
                  <ArbolDeArchivos
                    nodos={arbol}
                    etiqueta={`Archivos que toca ${recomendacion.titulo}`}
                    seleccionada={archivo}
                    alSeleccionar={(ruta) => setArchivo(ruta)}
                  />

                  <div className="min-w-0">
                    {seleccionado?.diff ? (
                      <pre className="fuente-operativa overflow-x-auto rounded-md bg-ds-background-200 p-3 text-label-12 text-ds-gray-900">
                        {seleccionado.diff}
                      </pre>
                    ) : seleccionado?.contenido !== undefined ? (
                      <VistaJSON
                        valor={seleccionado.contenido}
                        etiqueta={`Contenido de ${seleccionado.ruta}`}
                      />
                    ) : (
                      <p className="text-copy-13 text-ds-gray-900">
                        Elige un archivo del arbol para ver que se le escribe. El diff
                        completo de la recomendacion esta debajo.
                      </p>
                    )}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-col gap-1">
                <span className="text-label-12 text-ds-gray-900">Diff completo</span>
                <pre className="fuente-operativa max-h-96 overflow-auto rounded-md bg-ds-background-200 p-3 text-label-12 text-ds-gray-900">
                  {recomendacion.diff}
                </pre>
              </div>
            </div>
          ) : null}

          {modo === 'personalizar' ? (
            <Campo
              etiqueta="Diff modificado"
              valor={diff}
              alCambiar={setDiff}
              multilinea
              filas={16}
              operativo
              ayuda="Lo que quede aqui es lo que se escribira. El servicio lo valida antes de aplicarlo; si no cuadra con el arbol, lo rechaza nombrando el archivo."
            />
          ) : null}

          {modo === 'omitir' ? (
            <Campo
              etiqueta="Por que se omite"
              valor={motivo}
              alCambiar={setMotivo}
              multilinea
              filas={3}
              ayuda="Opcional, y util: el registro de lo omitido es lo unico que permite despues saber que clase de propuesta no encaja en este proyecto."
            />
          ) : null}

          {error ? (
            <div className="flex flex-col gap-2">
              <ErrorText causa={error.causa} accion={error.accion} />
              {error.codigo === 'diff_obsoleto' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={alRecalcular}>
                    Volver a calcular las recomendaciones
                  </Button>
                  <span className="text-label-12 text-ds-gray-700">
                    El arbol cambio desde que se calculo este diff. Recalcular ensena el
                    nuevo antes de escribir nada.
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </FieldsetContent>

      <FieldsetFooter
        nota={
          decidida
            ? 'Ya decidida. Volver a aplicarla es idempotente: no duplica nada.'
            : 'Nada se escribe hasta que elijas una de las tres salidas.'
        }
      >
        {modo === 'cerrado' ? (
          <>
            <Button variant="secondary" onClick={() => setModo('omitir')} disabled={trabajando}>
              <SkipForward />
              Omitir
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setDiff(recomendacion.diff)
                setModo('personalizar')
              }}
              disabled={trabajando}
            >
              <Pencil />
              Personalizar
            </Button>
            <Button onClick={() => setModo('diff')} disabled={trabajando}>
              Ver el diff y aplicar
            </Button>
          </>
        ) : null}

        {modo === 'diff' ? (
          <>
            <Button variant="secondary" onClick={() => setModo('cerrado')} disabled={trabajando}>
              Cerrar
            </Button>
            <Button onClick={() => alAplicar(recomendacion)} disabled={trabajando}>
              {trabajando ? <Spinner tamano="sm" etiqueta="Aplicando" /> : null}
              <Check />
              Aplicar lo que se ve
            </Button>
          </>
        ) : null}

        {modo === 'personalizar' ? (
          <>
            <Button variant="secondary" onClick={() => setModo('cerrado')} disabled={trabajando}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                alPersonalizar(recomendacion, diff)
                setModo('cerrado')
              }}
              disabled={trabajando}
            >
              Guardar y aplicar la version personalizada
            </Button>
          </>
        ) : null}

        {modo === 'omitir' ? (
          <>
            <Button variant="secondary" onClick={() => setModo('cerrado')} disabled={trabajando}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                alOmitir(recomendacion, motivo)
                setModo('cerrado')
              }}
              disabled={trabajando}
            >
              Omitir y registrar el motivo
            </Button>
          </>
        ) : null}
      </FieldsetFooter>
    </Fieldset>
  )
}

/* -------------------------------------------------------------------------- */
/* El panel                                                                   */
/* -------------------------------------------------------------------------- */

export interface PropsDePanelDeBootstrap {
  proyectoId: string
  recomendaciones: Recomendacion[]
  cargando: boolean
  error: ErrorDelServicio | null
  errorDeMutacion: ErrorDelServicio | null
  trabajando: boolean
  alAnalizar: () => void
  alAplicar: (recomendacion: Recomendacion) => void
  alPersonalizar: (recomendacion: Recomendacion, diff: string) => void
  alOmitir: (recomendacion: Recomendacion, motivo: string) => void
  alCompletar: () => void
  navegar: Navegar
}

export function PanelDeBootstrap({
  proyectoId,
  recomendaciones,
  cargando,
  error,
  errorDeMutacion,
  trabajando,
  alAnalizar,
  alAplicar,
  alPersonalizar,
  alOmitir,
  alCompletar,
  navegar,
}: PropsDePanelDeBootstrap) {
  const pendientes = recomendaciones.filter((una) => una.decision === 'pendiente')
  const decididas = recomendaciones.length - pendientes.length
  const enConflicto = recomendaciones.filter((una) => una.conflicto_constitution).length

  return (
    <div className="flex flex-col gap-8">
      <Encabezado
        titulo="Bootstrap"
        identificador={proyectoId}
        descripcion="Lo que este proyecto podria tener y no tiene. Cada propuesta llega con el diff exacto ya calculado, y ninguna se escribe sin que elijas una de sus tres salidas."
        volver={{ ruta: { seccion: 'constitution', id: proyectoId }, etiqueta: 'Constitution' }}
        navegar={navegar}
        acciones={
          <Button variant="secondary" onClick={alAnalizar} disabled={trabajando}>
            <Search />
            Detectar lo que ya hay
          </Button>
        }
      />

      <Note tipo="neutral" titulo="Primero se detecta, despues se propone">
        El bootstrap lee el setup existente antes de proponer nada: hooks, skills,
        servidores MCP, validaciones y CI que ya estan configurados no se vuelven a
        proponer. Una herramienta que propone instalar lo que ya tienes se deja de leer
        a la segunda vez.
      </Note>

      {errorDeMutacion && errorDeMutacion.codigo !== 'diff_obsoleto' ? (
        <ErrorText causa={errorDeMutacion.causa} accion={errorDeMutacion.accion} />
      ) : null}

      {cargando ? <EsqueletoDeLista filas={2} /> : null}

      {!cargando && recomendaciones.length === 0 ? (
        <EmptyState
          modo={error ? 'error' : 'primero'}
          titulo={
            error ? 'No Se Pudieron Cargar Las Recomendaciones' : 'Sin Recomendaciones Pendientes'
          }
          descripcion={
            error
              ? error.causa
              : 'O el bootstrap no se ha ejecutado todavia, o este proyecto ya tiene configurado todo lo que noxloop sabe proponer para su stack. Las dos cosas son buenas noticias; la primera se arregla con el boton de arriba.'
          }
          accion={
            <Button onClick={alAnalizar} disabled={trabajando}>
              Detectar lo que ya hay
            </Button>
          }
        />
      ) : null}

      {recomendaciones.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="text-label-13 text-ds-gray-900">
            {recomendaciones.length} recomendaciones · {pendientes.length} sin decidir ·{' '}
            {decididas} decididas
          </span>
          {enConflicto > 0 ? (
            <Badge tono="advertencia">
              {enConflicto} en conflicto con la constitution
            </Badge>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-6">
        {recomendaciones.map((recomendacion) => (
          <TarjetaDeRecomendacion
            key={recomendacion.id}
            recomendacion={recomendacion}
            trabajando={trabajando}
            // El `diff_obsoleto` es de una recomendacion concreta, asi que se
            // pinta dentro de ella y no arriba, donde no se sabria de cual es.
            error={
              errorDeMutacion &&
              errorDeMutacion.recurso?.includes(recomendacion.id)
                ? errorDeMutacion
                : null
            }
            alAplicar={alAplicar}
            alPersonalizar={alPersonalizar}
            alOmitir={alOmitir}
            alRecalcular={alAnalizar}
          />
        ))}
      </div>

      {recomendaciones.length > 0 ? <FalloDeLectura error={error} /> : null}

      {recomendaciones.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ds-gray-400 pt-5">
          <p className="max-w-xl text-copy-13 text-ds-gray-900">
            {pendientes.length > 0
              ? `Quedan ${pendientes.length} recomendaciones sin decidir. Cerrar el bootstrap con pendientes las deja registradas como no decididas, que no es lo mismo que omitidas.`
              : 'Todas las recomendaciones estan decididas. Queda registrado que se acepto y que no.'}
          </p>
          <Button onClick={alCompletar} disabled={trabajando}>
            Cerrar el bootstrap
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* El contenedor                                                              */
/* -------------------------------------------------------------------------- */

const EVENTOS_DE_BOOTSTRAP = ['recomendacion.aplicada', 'sincronizar_completo'] as const

export function VistaDeBootstrap({
  proyectoId,
  navegar,
}: {
  proyectoId: string
  navegar: Navegar
}) {
  const lectura = useLectura<Recomendacion[]>(`/v1/projects/${proyectoId}/recommendations`, {
    relerEn: EVENTOS_DE_BOOTSTRAP,
  })
  const mutacion = useMutacion()

  const analizar = async () => {
    await mutacion.enviar('POST', `/v1/projects/${proyectoId}/bootstrap/analyze`)
    lectura.releer()
  }

  const aplicar = async (recomendacion: Recomendacion) => {
    await mutacion.enviar('POST', `/v1/recommendations/${recomendacion.id}/apply`)
    lectura.releer()
  }

  const personalizar = async (recomendacion: Recomendacion, diff: string) => {
    await mutacion.enviar('POST', `/v1/recommendations/${recomendacion.id}/customize`, {
      diff_modificado: diff,
    })
    lectura.releer()
  }

  const omitir = async (recomendacion: Recomendacion, motivo: string) => {
    await mutacion.enviar(
      'POST',
      `/v1/recommendations/${recomendacion.id}/skip`,
      motivo.trim() ? { motivo: motivo.trim() } : {},
    )
    lectura.releer()
  }

  const completar = async () => {
    await mutacion.enviar('POST', `/v1/projects/${proyectoId}/bootstrap/complete`)
    navegar({ seccion: 'conexiones', id: proyectoId })
  }

  return (
    <PanelDeBootstrap
      proyectoId={proyectoId}
      recomendaciones={lectura.datos ?? []}
      cargando={lectura.datos === null && lectura.error === null}
      error={lectura.error}
      errorDeMutacion={mutacion.error}
      trabajando={mutacion.trabajando}
      alAnalizar={() => void analizar()}
      alAplicar={(recomendacion) => void aplicar(recomendacion)}
      alPersonalizar={(recomendacion, diff) => void personalizar(recomendacion, diff)}
      alOmitir={(recomendacion, motivo) => void omitir(recomendacion, motivo)}
      alCompletar={() => void completar()}
      navegar={navegar}
    />
  )
}
