'use client'

import { useMemo, useState } from 'react'
import { FolderGit2, GitBranch, Plus, Sparkles } from 'lucide-react'

import { Badge, type TonoDeBadge } from '@/components/ui/insignia'
import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { Entity, ListaDeEntidades } from '@/components/ui/entidad'
import { EmptyState } from '@/components/ui/estado-vacio'
import {
  Encabezado,
  EsqueletoDeLista,
  FalloDeLectura,
  estaCargandoPorPrimeraVez,
} from '@/components/pantalla'
import { useLectura, type Lectura } from '@/lib/lectura'
import { contiene } from '@/lib/texto'
import {
  ETAPA_PENDIENTE,
  ETIQUETA_ESTADO_PROYECTO,
  type EstadoProyecto,
  type Proyecto,
} from '@/lib/tipos'
import { DESTINO_DE_ETAPA, type Navegar } from '@/lib/ruta'

/**
 * T084 · La lista de proyectos.
 *
 * FR-061 EN SU FORMA MAS LITERAL: **no es una grilla de tarjetas por
 * proyecto**. Y la razon no es de gusto. Con doce proyectos activos, doce
 * tarjetas son doce rectangulos del mismo tamano con la misma jerarquia
 * visual, y el operador tiene que barrerlos con la vista uno a uno para
 * descubrir que en diez de ellos no pasa nada. En pocos dias aprende a no
 * mirarlos — y entonces la pantalla ya no informa, solo ocupa.
 *
 * La forma correcta es la FILA: una linea por proyecto, todas alineadas, lo
 * comparable en la misma columna vertical. `Entity` es exactamente eso —
 * contenido descriptivo a la izquierda, uno o dos controles a la derecha— y
 * por eso Geist lo publica como componente propio en vez de dejar que cada
 * pantalla lo resuelva con una tarjeta.
 *
 * QUE LLEVA CADA FILA, y por que esos cuatro datos y no otros:
 *
 *   - El nombre, que es lo pulsable.
 *   - La ruta o el remoto, en Geist Mono: es un identificador operativo, y es
 *     lo unico que distingue dos proyectos que se llaman parecido.
 *   - LA ETAPA QUE FALTA, dicha entera. Es la unica pregunta que el operador
 *     se hace al abrir esta pantalla: "cual de estos me esta esperando". Un
 *     badge con el estado solo responde a medias, porque `BOOTSTRAPPED` no
 *     dice que hacer; el texto de `ETAPA_PENDIENTE` si.
 *   - El estado, en badge, con la palabra escrita: la senal no cromatica va
 *     dentro del propio badge.
 *
 * El filtro existe porque doce filas se barren y cuarenta no. Su estado vacio
 * es distinto del de "no hay proyectos" a proposito: uno pide cambiar la
 * busqueda y el otro pide crear algo (ver `EmptyState`).
 */

const TONO_DEL_ESTADO: Record<EstadoProyecto, TonoDeBadge> = {
  CREATED: 'neutral',
  DISCOVERED: 'neutral',
  CONSTITUTED: 'informativo',
  BOOTSTRAPPED: 'informativo',
  CONNECTED: 'informativo',
  ACTIVE: 'exito',
}

const ICONO_DEL_ORIGEN = {
  nuevo: Sparkles,
  local: FolderGit2,
  remoto: GitBranch,
} as const

/** El texto que el operador lee para saber donde vive el proyecto. */
function ubicacion(proyecto: Proyecto): string | undefined {
  return proyecto.ruta_local ?? proyecto.remoto ?? undefined
}

function FilaDeProyecto({
  proyecto,
  navegar,
}: {
  proyecto: Proyecto
  navegar: Navegar
}) {
  const pendiente = ETAPA_PENDIENTE[proyecto.estado]
  const destino = DESTINO_DE_ETAPA[proyecto.estado]
  const Icono = ICONO_DEL_ORIGEN[proyecto.origen] ?? FolderGit2
  const contadores = proyecto.contadores

  return (
    <Entity
      contenedor="li"
      miniatura={<Icono />}
      titulo={proyecto.nombre}
      identificador={ubicacion(proyecto)}
      descripcion={
        pendiente
          ? pendiente.causa
          : 'El proyecto esta establecido: tiene snapshot, constitution, setup resuelto, conexiones vivas y flota declarada. Puede recibir ciclos del motor.'
      }
      metadatos={
        <>
          <Badge tono={TONO_DEL_ESTADO[proyecto.estado]}>
            {ETIQUETA_ESTADO_PROYECTO[proyecto.estado]}
          </Badge>
          {contadores?.entradas_bandeja ? (
            <Badge tono="advertencia">
              {contadores.entradas_bandeja} en bandeja
            </Badge>
          ) : null}
          {pendiente ? (
            <span className="text-label-12 text-ds-gray-700">
              Falta: {pendiente.etapa}
            </span>
          ) : null}
          {typeof contadores?.agentes === 'number' ? (
            <span className="text-label-12 text-ds-gray-700">
              {contadores.agentes} {contadores.agentes === 1 ? 'agente' : 'agentes'}
            </span>
          ) : null}
        </>
      }
      // Todo estado tiene destino desde que existen la pantalla de flota y la
      // de ciclos: `CONNECTED` se quedaba sin boton porque la flota no estaba
      // construida, y un proyecto activo no tenia a donde ir. Un proyecto
      // establecido no tiene etapa pendiente, tiene la accion que justifica
      // haberlo establecido.
      acciones={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navegar({ seccion: destino, id: proyecto.id })}
        >
          {pendiente ? `Continuar en ${pendiente.etapa}` : 'Lanzar un ciclo'}
        </Button>
      }
      // El titulo lleva siempre al snapshot: es la lectura tecnica del
      // proyecto, existe en todos los estados y no escribe nada.
      alPulsar={() => navegar({ seccion: 'snapshot', id: proyecto.id })}
    />
  )
}

/**
 * El panel, sin servicio.
 *
 * Recibe la lectura ya hecha en vez de pedirla. Es lo que permite que el
 * catalogo lo pinte en sus cuatro estados con datos locales y que el `next
 * build` los ejercite de verdad, en vez de comprobar que el archivo compila.
 */
export function PanelDeProyectos({
  lectura,
  navegar,
}: {
  lectura: Lectura<Proyecto[]>
  navegar: Navegar
}) {
  const [consulta, setConsulta] = useState('')
  const proyectos = lectura.datos ?? []

  const filtrados = useMemo(
    () =>
      proyectos.filter((proyecto) =>
        contiene(`${proyecto.nombre} ${ubicacion(proyecto) ?? ''}`, consulta),
      ),
    [proyectos, consulta],
  )

  const cargando = estaCargandoPorPrimeraVez(lectura)

  return (
    <div className="flex flex-col gap-8">
      <Encabezado
        titulo="Proyectos"
        descripcion="Una fila por proyecto, con la etapa que le falta escrita entera. No hay tarjetas: con doce proyectos, doce tarjetas son doce rectangulos que se aprenden a ignorar."
        acciones={
          <Button onClick={() => navegar({ seccion: 'proyecto-nuevo', id: null })}>
            <Plus />
            Anadir proyecto
          </Button>
        }
      />

      {proyectos.length > 6 ? (
        <Campo
          etiqueta="Filtrar"
          valor={consulta}
          alCambiar={setConsulta}
          marcador="nombre o ruta"
          ayuda={`${proyectos.length} proyectos registrados. El filtro mira el nombre y la ubicacion, no el estado.`}
          className="max-w-md"
        />
      ) : null}

      {cargando ? <EsqueletoDeLista filas={4} /> : null}

      {!cargando && proyectos.length === 0 ? (
        <EmptyState
          modo={lectura.error ? 'error' : 'primero'}
          titulo={
            lectura.error ? 'No Se Pudo Cargar La Lista De Proyectos' : 'Sin Proyectos Registrados'
          }
          descripcion={
            lectura.error
              ? lectura.error.causa
              : 'noxloop no adopta nada por su cuenta: hasta que senales una carpeta, un repositorio remoto o pidas uno nuevo, no hay nada que escanear ni nada que gobernar.'
          }
          accion={
            lectura.error ? (
              <Button variant="secondary" onClick={lectura.releer}>
                Reintentar ahora
              </Button>
            ) : (
              <Button onClick={() => navegar({ seccion: 'proyecto-nuevo', id: null })}>
                Anadir proyecto
              </Button>
            )
          }
        />
      ) : null}

      {filtrados.length > 0 ? (
        <ListaDeEntidades etiqueta="Proyectos registrados">
          {filtrados.map((proyecto) => (
            <FilaDeProyecto key={proyecto.id} proyecto={proyecto} navegar={navegar} />
          ))}
        </ListaDeEntidades>
      ) : null}

      {proyectos.length > 0 && filtrados.length === 0 ? (
        <EmptyState
          modo="filtrado"
          tamano="compacto"
          titulo="Ningun Proyecto Coincide"
          consulta={consulta}
          descripcion={`Hay ${proyectos.length} proyectos registrados. El filtro distingue espacios y compara contra el nombre y la ubicacion.`}
        />
      ) : null}

      {/* El fallo se pinta AL LADO de lo que ya habia, nunca en su lugar. */}
      {proyectos.length > 0 ? <FalloDeLectura error={lectura.error} /> : null}
    </div>
  )
}

const EVENTOS_DE_PROYECTOS = ['proyecto.estado', 'sincronizar_completo'] as const

export function VistaDeProyectos({ navegar }: { navegar: Navegar }) {
  const lectura = useLectura<Proyecto[]>('/v1/projects', { relerEn: EVENTOS_DE_PROYECTOS })
  return <PanelDeProyectos lectura={lectura} navegar={navegar} />
}
