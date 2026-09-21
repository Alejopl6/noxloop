'use client'

import { useEffect, useMemo, useState } from 'react'

import { Badge, type TonoDeBadge } from '@/components/ui/insignia'
import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { EmptyState } from '@/components/ui/estado-vacio'
import { Note } from '@/components/ui/nota'
import { Segmentado } from '@/components/ui/segmentado'
import { Instante, Tabla, type ColumnaDeTabla } from '@/components/ui/tabla'
import { VistaJSON } from '@/components/ui/vista-json'
import { Encabezado, EsqueletoDeLista, FalloDeLectura } from '@/components/pantalla'
import { useLectura } from '@/lib/lectura'
import { contiene } from '@/lib/texto'
import type { ErrorDelServicio } from '@/lib/daemon'
import {
  ETIQUETA_RESULTADO_AUDITORIA,
  type EventoDeAuditoria,
  type PaginaDeAuditoria,
  type ResultadoDeAuditoria,
} from '@/lib/tipos'
import type { Navegar } from '@/lib/ruta'

/**
 * T164 · Auditoria. SOLO LECTURA, y eso se comprueba mirando el archivo.
 *
 * NO HAY EN ESTA PANTALLA UN SOLO CONTROL QUE ESCRIBA. Ni `useMutacion`, ni un
 * `POST`, ni un boton de borrar, ni uno de editar, ni uno de exportar que
 * mande nada. El contrato lo dice del lado del servicio —para `/v1/audit` no
 * existe `POST`, ni `PATCH`, ni `DELETE`— y aqui se sostiene del lado de la
 * interfaz: la ausencia es la garantia. Un registro append-only con un boton
 * de limpiar en la esquina es un registro que alguien va a limpiar.
 *
 * Los unicos controles son filtros y paginacion, que solo cambian que se pide.
 *
 * EL FILTRO SE APLICA TAMBIEN EN LA PANTALLA, no solo en la peticion. El
 * contrato dice que `/v1/audit` es "paginado, filtrable" pero no fija los
 * nombres de los parametros; un servicio que ignore los que esta pantalla
 * manda devolveria todo, y entonces el operador veria filas que no cumplen el
 * filtro que acaba de escribir — la interfaz mintiendo sobre lo que ensena.
 * Filtrando tambien aqui, lo que se ve siempre cumple lo que se pidio, y en un
 * servicio que si filtre este segundo paso no quita nada.
 *
 * LA CADENA DE HASHES SE ENSENA porque es lo que hace detectable una
 * manipulacion hecha FUERA de la aplicacion. Sin ella, "append-only" es una
 * promesa sobre el codigo; con ella, es una propiedad comprobable sobre los
 * datos.
 */

const TONO_DEL_RESULTADO: Record<ResultadoDeAuditoria, TonoDeBadge> = {
  permitido: 'neutral',
  denegado: 'advertencia',
  error: 'error',
}

const RESULTADOS = [
  { valor: 'todos' as const, etiqueta: 'Todos' },
  { valor: 'permitido' as const, etiqueta: 'Permitidos' },
  { valor: 'denegado' as const, etiqueta: 'Denegados' },
  { valor: 'error' as const, etiqueta: 'Errores' },
]

type FiltroDeResultado = 'todos' | ResultadoDeAuditoria

export interface PropsDePanelDeAuditoria {
  eventos: EventoDeAuditoria[]
  cargando: boolean
  error: ErrorDelServicio | null
  ahora: number
  /** Hay mas paginas. Solo cambia que se pide, no lo que esta escrito. */
  hayMas: boolean
  alPedirMas: () => void
  navegar: Navegar
}

export function PanelDeAuditoria({
  eventos,
  cargando,
  error,
  ahora,
  hayMas,
  alPedirMas,
  navegar,
}: PropsDePanelDeAuditoria) {
  const [consulta, setConsulta] = useState('')
  const [resultado, setResultado] = useState<FiltroDeResultado>('todos')
  const [abierto, setAbierto] = useState<string | null>(null)

  const filtrados = useMemo(
    () =>
      eventos.filter((evento) => {
        if (resultado !== 'todos' && evento.resultado !== resultado) return false
        return contiene(
          `${evento.actor} ${evento.accion} ${evento.objeto_tipo ?? ''} ${evento.objeto_id ?? ''}`,
          consulta,
        )
      }),
    [eventos, consulta, resultado],
  )

  const columnas: ColumnaDeTabla<EventoDeAuditoria>[] = [
    {
      clave: 'instante',
      encabezado: 'Cuando',
      celda: (evento) => <Instante valor={evento.instante} ahora={ahora} />,
    },
    { clave: 'actor', encabezado: 'Actor', celda: (evento) => evento.actor },
    {
      clave: 'accion',
      encabezado: 'Accion',
      alineacion: 'operativo',
      celda: (evento) => evento.accion,
    },
    {
      clave: 'objeto',
      encabezado: 'Objeto',
      alineacion: 'operativo',
      celda: (evento) =>
        evento.objeto_id ? `${evento.objeto_tipo ?? 'objeto'} ${evento.objeto_id}` : null,
    },
    {
      clave: 'resultado',
      encabezado: 'Resultado',
      celda: (evento) => (
        <Badge tono={TONO_DEL_RESULTADO[evento.resultado]}>
          {ETIQUETA_RESULTADO_AUDITORIA[evento.resultado]}
        </Badge>
      ),
    },
    {
      clave: 'detalle',
      encabezado: 'Detalle',
      celda: (evento) =>
        evento.detalle ? (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={abierto === String(evento.id)}
            onClick={() =>
              setAbierto((antes) => (antes === String(evento.id) ? null : String(evento.id)))
            }
          >
            {abierto === String(evento.id) ? 'Ocultar' : 'Ver'}
          </Button>
        ) : null,
    },
  ]

  const evidencia = filtrados.find((evento) => String(evento.id) === abierto) ?? null

  return (
    <div className="flex flex-col gap-8">
      <Encabezado
        titulo="Auditoria"
        descripcion="Toda accion sensible sobre credenciales, grants y capacidades, en orden. Esta pantalla lee y nada mas: no hay aqui ningun control que edite o borre una fila, porque tampoco existe el endpoint que lo haria."
        volver={{ ruta: { seccion: 'inicio', id: null }, etiqueta: 'Inicio' }}
        navegar={navegar}
      />

      <Note tipo="neutral" titulo="Append-only, y comprobable">
        Cada fila encadena el hash de la anterior. Alterar una rompe la cadena y se nota,
        incluso si la manipulacion ocurrio fuera de noxloop. El detalle de cada evento
        llega ya redactado contra la boveda: si una accion manejo un secreto, lo que se
        registro nunca fue el valor.
      </Note>

      <div className="flex flex-wrap items-end gap-4">
        <Campo
          etiqueta="Filtrar"
          valor={consulta}
          alCambiar={setConsulta}
          marcador="actor, accion u objeto"
          ayuda="Filtra sobre lo que ya esta cargado. Para buscar algo antiguo, pide mas paginas primero."
          className="max-w-md"
        />
        <Segmentado
          etiqueta="Resultado"
          opciones={RESULTADOS}
          valor={resultado}
          alCambiar={setResultado}
        />
      </div>

      {cargando ? <EsqueletoDeLista filas={4} /> : null}

      {!cargando && eventos.length === 0 ? (
        <EmptyState
          modo={error ? 'error' : 'primero'}
          titulo={error ? 'No Se Pudo Cargar La Auditoria' : 'Sin Eventos Registrados'}
          descripcion={
            error
              ? error.causa
              : 'Todavia no ha ocurrido ninguna accion sensible sobre credenciales, grants o capacidades. El registro se escribe solo; no hay forma de anadirle una entrada a mano.'
          }
        />
      ) : null}

      {filtrados.length > 0 ? (
        <div className="overflow-x-auto">
          <Tabla
            columnas={columnas}
            filas={filtrados}
            claveDeFila={(evento) => String(evento.id)}
            etiqueta="Eventos de auditoria"
          />
        </div>
      ) : null}

      {eventos.length > 0 && filtrados.length === 0 ? (
        <EmptyState
          modo="filtrado"
          tamano="compacto"
          titulo="Ningun Evento Coincide"
          consulta={consulta}
          descripcion={`Hay ${eventos.length} eventos cargados${
            resultado === 'todos' ? '' : ` y el filtro de resultado esta en «${resultado}»`
          }. Los eventos mas antiguos pueden estar en paginas que todavia no se han pedido.`}
        />
      ) : null}

      {evidencia ? (
        <div className="flex flex-col gap-3 border-l-2 border-ds-gray-400 pl-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-heading-16 text-ds-gray-1000">{evidencia.accion}</h2>
            <span className="fuente-operativa text-label-12 text-ds-gray-700">
              evento {String(evidencia.id)}
            </span>
          </div>

          <VistaJSON
            valor={evidencia.detalle}
            etiqueta={`Detalle del evento ${String(evidencia.id)}`}
          />

          {evidencia.hash ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-label-12 uppercase tracking-wide text-ds-gray-700">
                Cadena
              </span>
              <span className="fuente-operativa break-all text-label-12 text-ds-gray-900">
                anterior: {evidencia.hash_anterior ?? 'ninguno, es la primera fila'}
              </span>
              <span className="fuente-operativa break-all text-label-12 text-ds-gray-900">
                esta: {evidencia.hash}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {eventos.length > 0 ? <FalloDeLectura error={error} /> : null}

      {hayMas ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={alPedirMas}>
            Cargar mas eventos
          </Button>
          <span className="text-label-12 text-ds-gray-700">
            Hay {eventos.length} cargados. Pedir mas solo lee: la paginacion no cambia
            nada del registro.
          </span>
        </div>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* El contenedor                                                              */
/* -------------------------------------------------------------------------- */

export function VistaDeAuditoria({ navegar }: { navegar: Navegar }) {
  // El cursor de la pagina que se esta pidiendo. La ruta cambia con el, asi
  // que `useLectura` vuelve a pedir sola.
  const [cursor, setCursor] = useState<string | null>(null)
  const [acumulados, setAcumulados] = useState<EventoDeAuditoria[]>([])
  const [ahora, setAhora] = useState(0)

  const lectura = useLectura<PaginaDeAuditoria>(
    cursor ? `/v1/audit?cursor=${encodeURIComponent(cursor)}` : '/v1/audit',
  )

  useEffect(() => {
    setAhora(Date.now())
  }, [])

  // Las paginas se acumulan en vez de sustituirse: pedir la siguiente no debe
  // hacer desaparecer lo que el operador estaba leyendo. La mezcla va por
  // `id`, que en auditoria es un entero autoincremental y por tanto unico.
  useEffect(() => {
    const pagina = lectura.datos
    if (!pagina) return
    setAcumulados((antes) => {
      const porId = new Map(antes.map((evento) => [String(evento.id), evento]))
      for (const evento of pagina.eventos ?? []) porId.set(String(evento.id), evento)
      return [...porId.values()]
    })
  }, [lectura.datos])

  return (
    <PanelDeAuditoria
      eventos={acumulados}
      cargando={lectura.datos === null && lectura.error === null && acumulados.length === 0}
      error={lectura.error}
      ahora={ahora}
      hayMas={Boolean(lectura.datos?.siguiente_cursor)}
      alPedirMas={() => setCursor(lectura.datos?.siguiente_cursor ?? null)}
      navegar={navegar}
    />
  )
}
