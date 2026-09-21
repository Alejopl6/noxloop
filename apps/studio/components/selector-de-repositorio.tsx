'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GitBranch, Lock, Search, Unlock } from 'lucide-react'

import { Badge } from '@/components/ui/insignia'
import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { EmptyState } from '@/components/ui/estado-vacio'
import { Entity, ListaDeEntidades } from '@/components/ui/entidad'
import { ErrorText } from '@/components/ui/fieldset'
import { Note } from '@/components/ui/nota'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { EsqueletoDeLista } from '@/components/pantalla'
import { useServicio } from '@/components/proveedor-servicio'
import { comoErrorDelServicio, type ErrorDelServicio } from '@/lib/daemon'
import { formatearRelativo } from '@/lib/tiempo'
import type { Conexion, Proyecto, RepositorioRemoto } from '@/lib/tipos'
import type { Navegar } from '@/lib/ruta'

/**
 * Elegir el repositorio de una lista.
 *
 * LO QUE ESTE COMPONENTE REEMPLAZA, Y POR QUE ERA UN AGUJERO. El alta de
 * proyecto con origen remoto pedia la direccion del repositorio en una casilla
 * de texto libre — teniendo el producto la credencial del operador guardada en
 * la boveda, con su grant. O sea: el sistema podia preguntarle a la forja cuales
 * son tus repositorios y no lo hacia; el operador abria el navegador, copiaba
 * una URL y la pegaba. Una letra de mas y el fallo aparecia despues, al clonar,
 * con un mensaje de git que no menciona ninguna pantalla.
 *
 * NO HABLA CON NINGUNA FORJA. Le pregunta al servicio por los repositorios que
 * alcanza UNA CONEXION, y el servicio se lo pregunta a la capa de conexiones,
 * que sabe por su catalogo como se le pregunta a cada proveedor. Son dos
 * consecuencias, las dos importantes:
 *
 *   1. El valor del token no pasa por aqui. Viaja en la cabecera de la llamada
 *      que hace el servicio, y lo que vuelve son fichas de repositorio. Esta
 *      pantalla no podria enseñar el token aunque quisiera: no lo recibe.
 *   2. El dia que entre el adaptador alojado —con OAuth de verdad— esta
 *      pantalla no cambia. Lo que cambia es quien guarda la credencial.
 *
 * POR QUE LA BUSQUEDA FILTRA EN EL CLIENTE. La lista ya vino entera —el
 * servicio manda hasta su limite y avisa si recorto— y una peticion por tecla
 * pulsada convierte escribir en una cola de peticiones contra la API de un
 * tercero con cuota. Si el aviso de recorte aparece, se dice y se ofrece
 * escribir mas para acotar del lado del servicio.
 */

/* -------------------------------------------------------------------------- */
/* Las conexiones de codigo que existen, miradas en todo el espacio de trabajo */
/* -------------------------------------------------------------------------- */

/**
 * Las conexiones de clase `scm` vivas de TODOS los proyectos.
 *
 * POR QUE SE RECORREN LOS PROYECTOS EN VEZ DE PEDIR UNA LISTA GLOBAL. Porque
 * una conexion es de un proyecto: es asi en el modelo de datos y tiene sentido
 * —la credencial que la sostiene es de ambito `proyecto`—. Pero el alta de un
 * proyecto NUEVO ocurre cuando ese proyecto todavia no existe, asi que no hay
 * proyecto al que pedirle sus conexiones, y la cuenta de codigo del operador es
 * una sola aunque el modelo la guarde por proyecto.
 *
 * Que esto sean N+1 peticiones esta medido contra la escala real de este
 * producto: un operador, unas decenas de proyectos. Si algun dia son cientos,
 * lo que hace falta es una ruta que liste las conexiones del espacio de
 * trabajo, y queda dicho aqui en vez de descubrirse con una pantalla lenta.
 */
export function useConexionesDeCodigo(): {
  conexiones: Array<Conexion & { proyecto: string }>
  cargando: boolean
  error: ErrorDelServicio | null
  releer: () => void
} {
  const { cliente, estado } = useServicio()
  const [conexiones, setConexiones] = useState<Array<Conexion & { proyecto: string }>>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<ErrorDelServicio | null>(null)
  const [revision, setRevision] = useState(0)

  const releer = useCallback(() => setRevision((n) => n + 1), [])

  useEffect(() => {
    if (!cliente || estado !== 'conectado') return
    const abortador = new AbortController()
    let vigente = true

    setCargando(true)
    ;(async () => {
      const proyectos = await cliente.obtener<{ items: Proyecto[] }>('/v1/projects', {
        senal: abortador.signal,
      })
      const encontradas: Array<Conexion & { proyecto: string }> = []
      for (const proyecto of proyectos.items ?? []) {
        // Un proyecto que falle no tumba la lista entera: sin conexiones es un
        // proyecto sin conexiones, que es el caso normal.
        try {
          const respuesta = await cliente.obtener<{ items: Conexion[] }>(
            `/v1/projects/${proyecto.id}/connections`,
            { senal: abortador.signal },
          )
          for (const conexion of respuesta.items ?? []) {
            if (conexion.clase === 'scm' && conexion.estado === 'viva') {
              encontradas.push({ ...conexion, proyecto: proyecto.nombre })
            }
          }
        } catch {
          // Deliberado: el detalle de por que un proyecto concreto no contesta
          // sus conexiones no ayuda a elegir un repositorio. Lo que importa es
          // si al final hay alguna, y eso lo dice el estado vacio.
        }
      }
      if (!vigente) return
      setConexiones(encontradas)
      setError(null)
    })()
      .catch((fallo: unknown) => {
        if (vigente) setError(comoErrorDelServicio(fallo, 'GET /v1/projects'))
      })
      .finally(() => {
        if (vigente) setCargando(false)
      })

    return () => {
      vigente = false
      abortador.abort()
    }
  }, [cliente, estado, revision])

  return { conexiones, cargando, error, releer }
}

/* -------------------------------------------------------------------------- */
/* Los repositorios de una conexion                                           */
/* -------------------------------------------------------------------------- */

interface Aviso {
  codigo: string
  causa: string
  accion: string
}

function useRepositorios(conexionId: string | null): {
  repositorios: RepositorioRemoto[]
  avisos: Aviso[]
  cargando: boolean
  error: ErrorDelServicio | null
} {
  const { cliente, estado } = useServicio()
  const [repositorios, setRepositorios] = useState<RepositorioRemoto[]>([])
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<ErrorDelServicio | null>(null)

  useEffect(() => {
    if (!cliente || estado !== 'conectado' || !conexionId) {
      setRepositorios([])
      setAvisos([])
      setError(null)
      return
    }
    const abortador = new AbortController()
    let vigente = true

    setCargando(true)
    cliente
      .obtener<{ items: RepositorioRemoto[]; avisos?: Aviso[] }>(
        `/v1/connections/${conexionId}/repos`,
        { senal: abortador.signal },
      )
      .then((respuesta) => {
        if (!vigente) return
        setRepositorios(respuesta.items ?? [])
        setAvisos(respuesta.avisos ?? [])
        setError(null)
      })
      .catch((fallo: unknown) => {
        if (!vigente) return
        // La lista NO se vacia al fallar por la misma regla que `useLectura`:
        // castigar al operador borrandole lo que ya tenia por un corte que no
        // provoco. Lo que no se puede es pintarlo como fresco, y para eso esta
        // el error al lado.
        setError(comoErrorDelServicio(fallo, `GET /v1/connections/${conexionId}/repos`))
      })
      .finally(() => {
        if (vigente) setCargando(false)
      })

    return () => {
      vigente = false
      abortador.abort()
    }
  }, [cliente, estado, conexionId])

  return { repositorios, avisos, cargando, error }
}

/** Texto comparable: sin mayusculas y sin acentos, igual que en el servicio. */
function normalizar(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/* -------------------------------------------------------------------------- */
/* El selector                                                                */
/* -------------------------------------------------------------------------- */

export interface PropsDeSelectorDeRepositorio {
  /** Las conexiones de codigo entre las que elegir. */
  conexiones: Array<Conexion & { proyecto?: string }>
  cargandoConexiones: boolean
  errorDeConexiones: ErrorDelServicio | null
  /** El repositorio elegido, por su direccion de clonado. */
  elegido: RepositorioRemoto | null
  alElegir: (repositorio: RepositorioRemoto | null) => void
  /** A donde mandar a quien no tiene ninguna cuenta conectada. */
  navegar: Navegar
}

export function SelectorDeRepositorio({
  conexiones,
  cargandoConexiones,
  errorDeConexiones,
  elegido,
  alElegir,
  navegar,
}: PropsDeSelectorDeRepositorio) {
  const [conexionId, setConexionId] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')

  // La primera conexion queda elegida sola, y solo la primera vez: con una
  // sola cuenta conectada —que es el caso normal— obligar a elegirla es un
  // clic que no decide nada. `useRef` y no una dependencia, para que cambiar
  // de conexion a mano no se deshaga en el siguiente repintado.
  const yaElegida = useRef(false)
  useEffect(() => {
    if (yaElegida.current || conexiones.length === 0) return
    yaElegida.current = true
    setConexionId(conexiones[0].id)
  }, [conexiones])

  const { repositorios, avisos, cargando, error } = useRepositorios(conexionId)

  const visibles = useMemo(() => {
    const buscado = normalizar(busqueda).trim()
    if (!buscado) return repositorios
    return repositorios.filter(
      (r) =>
        normalizar(r.nombre_completo).includes(buscado) ||
        normalizar(r.nombre).includes(buscado) ||
        normalizar(r.descripcion).includes(buscado),
    )
  }, [repositorios, busqueda])

  if (cargandoConexiones) return <EsqueletoDeLista filas={2} />

  if (conexiones.length === 0) {
    return (
      <EmptyState
        modo={errorDeConexiones ? 'error' : 'primero'}
        titulo={
          errorDeConexiones
            ? 'No Se Pudieron Leer Las Conexiones'
            : 'Sin Cuenta De Codigo Conectada'
        }
        descripcion={
          errorDeConexiones
            ? errorDeConexiones.causa
            : 'Para elegir un repositorio de una lista hace falta una conexion viva con el gestor de repositorios. Conectala una vez —pegando un token personal— y a partir de ahi eliges el repositorio en vez de escribir su direccion.'
        }
        accion={
          <Button
            variant="secondary"
            onClick={() => navegar({ seccion: 'proyectos', id: null })}
          >
            Ir a un proyecto y conectar
          </Button>
        }
      />
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {conexiones.length > 1 ? (
        <div className="flex flex-col gap-2">
          <span className="text-label-13 text-ds-gray-1000">Cuenta de codigo</span>
          <ListaDeEntidades etiqueta="Conexiones de codigo disponibles">
            {conexiones.map((conexion) => (
              <Entity
                key={conexion.id}
                contenedor="li"
                miniatura={<GitBranch />}
                titulo={conexion.proveedor}
                identificador={conexion.id}
                descripcion={
                  conexion.proyecto
                    ? `Conectada en el proyecto ${conexion.proyecto}. La credencial es suya; este proyecto la usa para leer la lista.`
                    : undefined
                }
                alPulsar={() => {
                  setConexionId(conexion.id)
                  alElegir(null)
                }}
                seleccionada={conexionId === conexion.id}
              />
            ))}
          </ListaDeEntidades>
        </div>
      ) : null}

      <Campo
        etiqueta="Buscar repositorio"
        valor={busqueda}
        alCambiar={setBusqueda}
        operativo
        marcador="parte del nombre o de la cuenta"
        ayuda="Busca por el nombre del repositorio y por la cuenta a la que pertenece: con el mismo nombre en dos cuentas, escribir la cuenta es lo unico que los distingue."
        accion={cargando ? <Spinner tamano="sm" etiqueta="Leyendo repositorios" /> : <Search className="size-4 text-ds-gray-700" />}
        className="max-w-md"
      />

      {avisos.map((aviso) => (
        <Note key={aviso.codigo} tipo="informativo" titulo="La lista se recorto">
          {aviso.causa} {aviso.accion}
        </Note>
      ))}

      {error ? <ErrorText causa={error.causa} accion={error.accion} /> : null}

      {cargando && repositorios.length === 0 ? <EsqueletoDeLista filas={3} /> : null}

      {!cargando && repositorios.length === 0 && !error ? (
        <EmptyState
          modo="primero"
          tamano="compacto"
          titulo="Esta Conexion No Alcanza Ningun Repositorio"
          descripcion="La conexion responde y la lista viene vacia. Suele ser el alcance del token: uno sin permiso de lectura de repositorios contesta bien y no ve ninguno."
        />
      ) : null}

      {repositorios.length > 0 && visibles.length === 0 ? (
        <EmptyState
          modo="filtrado"
          tamano="compacto"
          titulo="Ningun Repositorio Coincide"
          descripcion="Ninguno de los repositorios que alcanza esta conexion contiene ese texto en su nombre, su cuenta o su descripcion."
          consulta={busqueda}
        />
      ) : null}

      {visibles.length > 0 ? (
        <ListaDeEntidades etiqueta="Repositorios que alcanza esta conexion">
          {visibles.map((repo) => (
            <Entity
              key={String(repo.id ?? repo.nombre_completo)}
              contenedor="li"
              miniatura={repo.privado ? <Lock /> : <Unlock />}
              titulo={repo.nombre_completo ?? repo.nombre ?? 'sin nombre'}
              identificador={repo.url_clon ?? undefined}
              descripcion={repo.descripcion ?? undefined}
              metadatos={
                <>
                  <Badge tono={repo.privado ? 'neutral' : 'informativo'}>
                    {repo.privado ? 'Privado' : 'Publico'}
                  </Badge>
                  {repo.rama_por_defecto ? (
                    <span className="fuente-operativa text-label-12 text-ds-gray-700">
                      {repo.rama_por_defecto}
                    </span>
                  ) : null}
                  {repo.actualizado ? (
                    <span className="text-label-12 text-ds-gray-700">
                      Actualizado {formatearRelativo(Date.parse(repo.actualizado))}
                    </span>
                  ) : null}
                </>
              }
              alPulsar={() => alElegir(elegido?.url_clon === repo.url_clon ? null : repo)}
              seleccionada={elegido?.url_clon === repo.url_clon}
            />
          ))}
        </ListaDeEntidades>
      ) : null}
    </div>
  )
}
