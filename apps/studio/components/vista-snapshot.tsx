'use client'

import { useCallback, useMemo, useState } from 'react'
import { Ban, Check, FileSearch, Pencil, Play, X } from 'lucide-react'

import { Badge, type TonoDeBadge } from '@/components/ui/insignia'
import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { EmptyState } from '@/components/ui/estado-vacio'
import { ErrorText } from '@/components/ui/fieldset'
import { Note } from '@/components/ui/nota'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { VistaJSON } from '@/components/ui/vista-json'
import { Encabezado, EsqueletoDeLista, FalloDeLectura } from '@/components/pantalla'
import { useEventoDelServicio } from '@/components/proveedor-eventos'
import { useLectura } from '@/lib/lectura'
import { useMutacion } from '@/lib/mutacion'
import { cn } from '@/lib/utils'
import type { ErrorDelServicio } from '@/lib/daemon'
import {
  ETIQUETA_CATEGORIA,
  ETIQUETA_FASE,
  ORDEN_DE_CATEGORIAS,
  type CategoriaDeHallazgo,
  type ConfianzaDeHallazgo,
  type DecisionDeHallazgo,
  type FaseDeScan,
  type Hallazgo,
  type ProgresoDeScan,
  type Snapshot,
} from '@/lib/tipos'
import type { Navegar } from '@/lib/ruta'

/**
 * T086 · El snapshot del proyecto.
 *
 * ESTA PANTALLA ES EL PRINCIPIO X CONVERTIDO EN INTERFAZ, y conviene decir por
 * que antes de describir nada. Un snapshot mezcla tres clases de afirmacion
 * que se parecen mucho en pantalla y no valen lo mismo:
 *
 *   - lo DETECTADO, que tiene un archivo y una linea detras;
 *   - lo INFERIDO, que es una lectura plausible del modelo y nada mas;
 *   - el HUECO, que es el scanner diciendo "busque y no habia".
 *
 * Si las tres se presentan con la misma autoridad, al operador le quedan dos
 * salidas y las dos son malas: revisarlo todo —y entonces el scanner no le
 * ahorro nada— o no revisar nada, y adoptar suposiciones como si fueran
 * reglas. Esa constitution derivada gobierna el proyecto durante meses.
 *
 * Por eso aqui el ORIGEN VIAJA CON CADA HALLAZGO y ocupa sitio:
 *
 *   - `detectado` ensena sus rutas y sus lineas, en Geist Mono, sin plegar.
 *   - `inferido` ensena su confianza y dice con todas las letras que ningun
 *     archivo lo respalda.
 *   - un valor nulo detectado se pinta como HUECO DECLARADO, no como un campo
 *     que falta: "no hay tests" es informacion, y rellenarlo con un runner
 *     plausible es exactamente lo que el contrato del scanner prohibe.
 *   - un `detectado` SIN evidencia se marca como incoherente con el contrato.
 *     No deberia existir; si llega, se ve.
 *
 * FR-014: corregir y descartar, por hallazgo. Ninguna de las dos escribe
 * aqui — las dos son un `PATCH` al servicio, que sigue siendo el unico
 * escritor.
 *
 * FR-015 y el evento `scan.hallazgo`: la lista CRECE EN VIVO. Los hallazgos
 * que llegan por el canal de eventos se mezclan con los de la lectura por
 * `id`, asi que un hallazgo que llega dos veces —por evento y por relectura—
 * no se duplica.
 */

/* -------------------------------------------------------------------------- */
/* El origen, que es lo que esta pantalla existe para no esconder             */
/* -------------------------------------------------------------------------- */

const TONO_DE_CONFIANZA: Record<ConfianzaDeHallazgo, TonoDeBadge> = {
  alta: 'neutral',
  media: 'advertencia',
  baja: 'advertencia',
}

const TONO_DE_DECISION: Record<DecisionDeHallazgo, TonoDeBadge> = {
  pendiente: 'neutral',
  aceptado: 'exito',
  corregido: 'informativo',
  descartado: 'neutral',
}

const ETIQUETA_DECISION: Record<DecisionDeHallazgo, string> = {
  pendiente: 'Sin revisar',
  aceptado: 'Aceptado',
  corregido: 'Corregido por ti',
  descartado: 'Descartado',
}

function esHueco(hallazgo: Hallazgo): boolean {
  const valor = hallazgo.valor_corregido ?? hallazgo.valor
  return valor === null || valor === undefined
}

function OrigenDelHallazgo({ hallazgo }: { hallazgo: Hallazgo }) {
  const evidencia = hallazgo.evidencia ?? []

  if (hallazgo.origen === 'declarado') {
    return (
      <p className="text-label-12 text-ds-gray-700">
        Declarado por ti. Gana sobre lo que el scanner leyo, y queda registrado que lo
        contradice.
      </p>
    )
  }

  if (hallazgo.origen === 'inferido') {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tono={TONO_DE_CONFIANZA[hallazgo.confianza]}>
            Inferido · confianza {hallazgo.confianza}
          </Badge>
        </div>
        <p className="text-label-12 text-ds-gray-700">
          Ningun archivo lo respalda: es una lectura del proyecto, no una cita. Si no
          coincide con como es de verdad, corrigelo antes de fijar la constitution.
        </p>
      </div>
    )
  }

  // `detectado`.
  if (evidencia.length === 0) {
    return (
      <Note tipo="advertencia" titulo="Detectado sin evidencia">
        El contrato del scanner no permite emitir un hallazgo detectado sin al menos un
        archivo que lo respalde, asi que este llego incompleto. Tratalo como inferido:
        comprueba el dato antes de aceptarlo.
      </Note>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-label-12 text-ds-gray-700">
        Detectado en {evidencia.length === 1 ? 'un archivo' : `${evidencia.length} archivos`}
      </span>
      <ul className="flex flex-col gap-1">
        {evidencia.map((cita, indice) => (
          <li key={`${cita.ruta}:${cita.linea ?? indice}`} className="flex flex-col gap-0.5">
            <span className="fuente-operativa text-label-12 text-ds-gray-900">
              {cita.ruta}
              {typeof cita.linea === 'number' ? `:${cita.linea}` : null}
            </span>
            {cita.extracto ? (
              <pre className="fuente-operativa overflow-x-auto rounded-md bg-ds-background-200 px-2 py-1 text-label-12 text-ds-gray-900">
                {cita.extracto}
              </pre>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ValorDelHallazgo({ hallazgo }: { hallazgo: Hallazgo }) {
  const valor = hallazgo.valor_corregido ?? hallazgo.valor

  if (valor === null || valor === undefined) {
    return (
      <p className="text-copy-14 text-ds-gray-900">
        <span className="text-ds-gray-1000">Hueco declarado.</span> El scanner busco y no
        habia nada. Es un dato, no un campo que falta: rellenarlo con lo probable seria
        inventarse el proyecto.
      </p>
    )
  }

  if (typeof valor === 'string' || typeof valor === 'number' || typeof valor === 'boolean') {
    return (
      <p className="fuente-operativa break-words text-label-13 text-ds-gray-1000">
        {String(valor)}
      </p>
    )
  }

  return <VistaJSON valor={valor} etiqueta={`Valor de ${hallazgo.clave}`} profundidadAbierta={1} />
}

/* -------------------------------------------------------------------------- */
/* Un hallazgo                                                                */
/* -------------------------------------------------------------------------- */

function FilaDeHallazgo({
  hallazgo,
  alDecidir,
  trabajando,
}: {
  hallazgo: Hallazgo
  alDecidir: (hallazgo: Hallazgo, decision: DecisionDeHallazgo, corregido?: string) => void
  trabajando: boolean
}) {
  const [corrigiendo, setCorrigiendo] = useState(false)
  const [borrador, setBorrador] = useState('')

  const abrirCorreccion = () => {
    const valor = hallazgo.valor_corregido ?? hallazgo.valor
    setBorrador(
      typeof valor === 'string' ? valor : valor === null || valor === undefined ? '' : JSON.stringify(valor, null, 2),
    )
    setCorrigiendo(true)
  }

  const descartado = hallazgo.decision === 'descartado'

  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-md px-3 py-3 transition-colors',
        // Descartado se atenua, no se oculta: esconderlo dejaria al operador
        // buscando un hallazgo que recuerda haber visto.
        descartado ? 'opacity-55' : null,
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="fuente-operativa text-label-13 text-ds-gray-1000">{hallazgo.clave}</span>
        <Badge tono={TONO_DE_DECISION[hallazgo.decision]}>
          {ETIQUETA_DECISION[hallazgo.decision]}
        </Badge>
        {esHueco(hallazgo) ? <Badge tono="neutral">Hueco</Badge> : null}
      </div>

      <ValorDelHallazgo hallazgo={hallazgo} />

      <OrigenDelHallazgo hallazgo={hallazgo} />

      {corrigiendo ? (
        <div className="flex flex-col gap-3 border-l-2 border-ds-gray-400 pl-3">
          <Campo
            etiqueta={`Valor corregido de ${hallazgo.clave}`}
            valor={borrador}
            alCambiar={setBorrador}
            multilinea
            filas={3}
            operativo
            ayuda="Se envia tal cual si es texto; si escribes JSON valido, se envia como JSON. Lo que declares gana sobre lo detectado y queda registrado que lo contradice."
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={trabajando}
              onClick={() => {
                alDecidir(hallazgo, 'corregido', borrador)
                setCorrigiendo(false)
              }}
            >
              <Check />
              Guardar correccion
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setCorrigiendo(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={abrirCorreccion}
            disabled={trabajando}
          >
            <Pencil />
            Corregir
          </Button>
          {hallazgo.decision !== 'descartado' ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => alDecidir(hallazgo, 'descartado')}
              disabled={trabajando}
            >
              <X />
              Descartar
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => alDecidir(hallazgo, 'pendiente')}
              disabled={trabajando}
            >
              Recuperar
            </Button>
          )}
          {hallazgo.decision === 'pendiente' ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => alDecidir(hallazgo, 'aceptado')}
              disabled={trabajando}
            >
              <Check />
              Aceptar
            </Button>
          ) : null}
        </div>
      )}
    </li>
  )
}

/* -------------------------------------------------------------------------- */
/* El progreso                                                                */
/* -------------------------------------------------------------------------- */

function ProgresoDelAnalisis({ progreso }: { progreso: ProgresoDeScan }) {
  const total = progreso.total_estimado > 0 ? progreso.total_estimado : null
  const porcentaje = total
    ? Math.min(100, Math.round((progreso.archivos_vistos / total) * 100))
    : null
  const fase = ETIQUETA_FASE[progreso.fase as FaseDeScan] ?? progreso.fase

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Spinner conTexto etiqueta={fase} tamano="sm" />
        <span className="fuente-operativa text-label-12 text-ds-gray-700">
          {progreso.archivos_vistos.toLocaleString('es')}
          {total ? ` / ~${total.toLocaleString('es')}` : ''} archivos
        </span>
      </div>

      {/* El total es ESTIMADO y por eso la barra puede quedarse corta. Cuando
          no hay estimacion no se dibuja una barra al 50% que finge saber:
          queda el contador, que es lo unico cierto. */}
      {porcentaje !== null ? (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={porcentaje}
          aria-label={fase}
          className="h-1 w-full overflow-hidden rounded-full bg-ds-gray-200"
        >
          <div
            className="h-full bg-ds-gray-700 transition-[width]"
            style={{ width: `${porcentaje}%` }}
          />
        </div>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* El panel                                                                   */
/* -------------------------------------------------------------------------- */

export interface PropsDePanelDeSnapshot {
  proyectoId: string
  snapshot: Snapshot | null
  /** Ya mezclados: los de la lectura mas los que llegaron por el canal. */
  hallazgos: Hallazgo[]
  progreso: ProgresoDeScan | null
  cargando: boolean
  error: ErrorDelServicio | null
  errorDeMutacion: ErrorDelServicio | null
  trabajando: boolean
  alAnalizar: () => void
  alCancelar: () => void
  alAceptar: () => void
  alDecidir: (hallazgo: Hallazgo, decision: DecisionDeHallazgo, corregido?: string) => void
  navegar: Navegar
}

export function PanelDeSnapshot({
  proyectoId,
  snapshot,
  hallazgos,
  progreso,
  cargando,
  error,
  errorDeMutacion,
  trabajando,
  alAnalizar,
  alCancelar,
  alAceptar,
  alDecidir,
  navegar,
}: PropsDePanelDeSnapshot) {
  const enCurso = snapshot?.estado === 'en_curso'

  const grupos = useMemo(() => {
    const porCategoria = new Map<CategoriaDeHallazgo, Hallazgo[]>()
    for (const hallazgo of hallazgos) {
      const lista = porCategoria.get(hallazgo.categoria)
      if (lista) lista.push(hallazgo)
      else porCategoria.set(hallazgo.categoria, [hallazgo])
    }
    return ORDEN_DE_CATEGORIAS.filter((categoria) => porCategoria.has(categoria)).map(
      (categoria) => ({ categoria, hallazgos: porCategoria.get(categoria) ?? [] }),
    )
  }, [hallazgos])

  const pendientes = hallazgos.filter((hallazgo) => hallazgo.decision === 'pendiente').length
  const inferidos = hallazgos.filter((hallazgo) => hallazgo.origen === 'inferido').length

  return (
    <div className="flex flex-col gap-8">
      <Encabezado
        titulo="Snapshot del proyecto"
        identificador={proyectoId}
        descripcion="La lectura tecnica del proyecto, agrupada por lo que mira. Es una propuesta de lectura, no una verdad impuesta: cada hallazgo dice de donde sale y se puede corregir o descartar."
        volver={{ ruta: { seccion: 'proyectos', id: null }, etiqueta: 'Proyectos' }}
        navegar={navegar}
        acciones={
          enCurso ? (
            <Button variant="secondary" onClick={alCancelar} disabled={trabajando}>
              <Ban />
              Cancelar analisis
            </Button>
          ) : (
            <Button onClick={alAnalizar} disabled={trabajando}>
              <Play />
              {snapshot ? 'Volver a analizar' : 'Analizar el proyecto'}
            </Button>
          )
        }
      />

      <Note tipo="neutral" titulo="El scanner lee y no escribe">
        Ni un archivo del proyecto cambia durante el analisis, y es verificable: el arbol
        de trabajo queda byte a byte igual antes y despues. Si el scanner encuentra un
        secreto en claro, lo reporta con su ruta y su linea y no copia el valor a ninguna
        parte.
      </Note>

      {enCurso && progreso ? <ProgresoDelAnalisis progreso={progreso} /> : null}
      {enCurso && !progreso ? (
        <Spinner conTexto etiqueta="Analizando el proyecto" />
      ) : null}

      {snapshot?.estado === 'cancelado' ? (
        <Note tipo="advertencia" titulo="El analisis se cancelo">
          No quedo un snapshot a medias marcado como completo: lo que se ve abajo es lo
          que se alcanzo a leer antes de cortar, y el snapshot esta declarado como
          cancelado. Vuelve a analizar cuando quieras.
        </Note>
      ) : null}

      {errorDeMutacion ? (
        <ErrorText causa={errorDeMutacion.causa} accion={errorDeMutacion.accion} />
      ) : null}

      {cargando ? <EsqueletoDeLista filas={3} /> : null}

      {!cargando && hallazgos.length === 0 ? (
        <EmptyState
          modo={error ? 'error' : 'primero'}
          titulo={error ? 'No Se Pudo Cargar El Snapshot' : 'Sin Snapshot Todavia'}
          descripcion={
            error
              ? error.causa
              : 'Este proyecto no tiene una lectura tecnica. Sin ella, la constitution que se proponga sera un documento generico: proponer reglas sin haber leido el proyecto produce un documento que nadie respeta.'
          }
          accion={
            error ? null : (
              <Button onClick={alAnalizar} disabled={trabajando}>
                Analizar el proyecto
              </Button>
            )
          }
        />
      ) : null}

      {hallazgos.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="text-label-13 text-ds-gray-900">
            {hallazgos.length} hallazgos · {pendientes} sin revisar · {inferidos} inferidos
          </span>
          {snapshot?.commit ? (
            <span className="fuente-operativa text-label-12 text-ds-gray-700">
              commit {snapshot.commit}
            </span>
          ) : null}
          {typeof snapshot?.duracion_ms === 'number' ? (
            <span className="text-label-12 text-ds-gray-700">
              leido en {(snapshot.duracion_ms / 1000).toFixed(1)} s
            </span>
          ) : null}
        </div>
      ) : null}

      {grupos.map(({ categoria, hallazgos: delGrupo }) => (
        <section key={categoria} aria-labelledby={`grupo-${categoria}`} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id={`grupo-${categoria}`} className="text-heading-16 text-ds-gray-1000">
              {ETIQUETA_CATEGORIA[categoria]}
            </h2>
            <span className="text-label-12 text-ds-gray-700">
              {delGrupo.length} {delGrupo.length === 1 ? 'hallazgo' : 'hallazgos'}
            </span>
          </div>

          {categoria === 'riesgos' ? (
            <p className="text-copy-13 text-ds-gray-900">
              Lo que hay aqui no bloquea nada por si solo. Un secreto encontrado se
              reporta con su ruta y nunca con su valor: el snapshot no guarda una segunda
              copia del problema.
            </p>
          ) : null}

          <ul className="-mx-3 flex flex-col">
            {delGrupo.map((hallazgo) => (
              <FilaDeHallazgo
                key={hallazgo.id}
                hallazgo={hallazgo}
                alDecidir={alDecidir}
                trabajando={trabajando}
              />
            ))}
          </ul>
        </section>
      ))}

      {hallazgos.length > 0 ? <FalloDeLectura error={error} /> : null}

      {snapshot && snapshot.estado === 'completo' ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ds-gray-400 pt-5">
          <p className="max-w-xl text-copy-13 text-ds-gray-900">
            {pendientes > 0
              ? `Quedan ${pendientes} hallazgos sin revisar. Puedes aceptar el snapshot igualmente: lo no revisado entra como detectado, con su evidencia, y se puede corregir despues.`
              : 'Todos los hallazgos estan revisados. Al aceptar, el proyecto pasa a analizado y la siguiente etapa es la constitution.'}
          </p>
          <Button onClick={alAceptar} disabled={trabajando}>
            <FileSearch />
            Aceptar el snapshot
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* El contenedor                                                              */
/* -------------------------------------------------------------------------- */

const EVENTOS_DE_SNAPSHOT = ['scan.terminado', 'scan.cancelado', 'sincronizar_completo'] as const

export function VistaDeSnapshot({
  proyectoId,
  navegar,
}: {
  proyectoId: string
  navegar: Navegar
}) {
  const lectura = useLectura<Snapshot>(`/v1/projects/${proyectoId}/snapshot`, {
    relerEn: EVENTOS_DE_SNAPSHOT,
  })
  const mutacion = useMutacion()
  const [progreso, setProgreso] = useState<ProgresoDeScan | null>(null)
  const [enVivo, setEnVivo] = useState<Hallazgo[]>([])

  // La lista crece en vivo. Los hallazgos llegan de dos sitios —el canal de
  // eventos y la relectura al terminar— asi que se mezclan por `id`: uno que
  // llegue por los dos caminos aparece una sola vez, y gana la version de la
  // lectura, que es la que el servicio considera vigente.
  useEventoDelServicio(
    'scan.hallazgo',
    useCallback((evento) => {
      const hallazgo = evento.datos as Hallazgo | null
      if (!hallazgo || typeof hallazgo.id !== 'string') return
      setEnVivo((antes) =>
        antes.some((previo) => previo.id === hallazgo.id) ? antes : [...antes, hallazgo],
      )
    }, []),
  )

  useEventoDelServicio(
    'scan.progreso',
    useCallback((evento) => setProgreso(evento.datos as ProgresoDeScan), []),
  )

  useEventoDelServicio(
    'scan.terminado',
    useCallback(() => setProgreso(null), []),
  )

  useEventoDelServicio(
    'scan.cancelado',
    useCallback(() => setProgreso(null), []),
  )

  const snapshot = lectura.datos
  const hallazgos = useMemo(() => {
    const porId = new Map<string, Hallazgo>()
    for (const hallazgo of enVivo) porId.set(hallazgo.id, hallazgo)
    for (const hallazgo of snapshot?.hallazgos ?? []) porId.set(hallazgo.id, hallazgo)
    return [...porId.values()]
  }, [enVivo, snapshot])

  const analizar = async () => {
    setEnVivo([])
    setProgreso(null)
    await mutacion.enviar('POST', `/v1/projects/${proyectoId}/scan`)
    lectura.releer()
  }

  const cancelar = async () => {
    if (!snapshot) return
    await mutacion.enviar('DELETE', `/v1/scans/${snapshot.id}`)
    lectura.releer()
  }

  const aceptar = async () => {
    if (!snapshot) return
    const aceptado = await mutacion.enviar('POST', `/v1/snapshots/${snapshot.id}/accept`)
    if (aceptado === null && mutacion.error) return
    navegar({ seccion: 'constitution', id: proyectoId })
  }

  const decidir = async (
    hallazgo: Hallazgo,
    decision: DecisionDeHallazgo,
    corregido?: string,
  ) => {
    if (!snapshot) return
    // El valor corregido se manda como JSON si lo es, y como texto si no. El
    // operador escribe `20` cuando quiere el numero y `node --test` cuando
    // quiere la cadena; obligarle a poner comillas seria pedirle que aprenda
    // el formato de transporte.
    let valor: unknown = corregido
    if (typeof corregido === 'string' && corregido.trim().length > 0) {
      try {
        valor = JSON.parse(corregido)
      } catch {
        valor = corregido
      }
    }

    await mutacion.enviar(
      'PATCH',
      `/v1/snapshots/${snapshot.id}/findings/${hallazgo.id}`,
      decision === 'corregido' ? { decision, valor_corregido: valor } : { decision },
    )
    lectura.releer()
  }

  return (
    <PanelDeSnapshot
      proyectoId={proyectoId}
      snapshot={snapshot}
      hallazgos={hallazgos}
      progreso={progreso}
      cargando={lectura.datos === null && lectura.error === null && hallazgos.length === 0}
      error={lectura.error}
      errorDeMutacion={mutacion.error}
      trabajando={mutacion.trabajando}
      alAnalizar={() => void analizar()}
      alCancelar={() => void cancelar()}
      alAceptar={() => void aceptar()}
      alDecidir={(hallazgo, decision, corregido) => void decidir(hallazgo, decision, corregido)}
      navegar={navegar}
    />
  )
}
