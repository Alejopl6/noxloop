'use client'

import { useState } from 'react'
import { Copy, ExternalLink, GitBranch, Plug, Server, Ticket } from 'lucide-react'

import { Badge, type TonoDeBadge } from '@/components/ui/insignia'
import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { EmptyState } from '@/components/ui/estado-vacio'
import { Entity, ListaDeEntidades } from '@/components/ui/entidad'
import { ErrorText, Fieldset, FieldsetContent, FieldsetFooter } from '@/components/ui/fieldset'
import { ModalDeAccionDestructiva } from '@/components/ui/modal-de-accion-destructiva'
import { Note } from '@/components/ui/nota'
import { Segmentado } from '@/components/ui/segmentado'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { Encabezado, EsqueletoDeLista, FalloDeLectura } from '@/components/pantalla'
import { abrirExterno } from '@/lib/enlace'
import { comoErrorDelServicio, type ErrorDelServicio } from '@/lib/daemon'
import { useLectura } from '@/lib/lectura'
import { useMutacion } from '@/lib/mutacion'
import {
  ETIQUETA_CLASE_CONEXION,
  ETIQUETA_ESTADO_CONEXION,
  type AutorizacionDeConexion,
  type Capacidades,
  type ClaseDeConexion,
  type Conexion,
  type EstadoDeLaConexion,
} from '@/lib/tipos'
import type { Navegar } from '@/lib/ruta'

/**
 * T163 (1/2) · Conexiones del proyecto.
 *
 * LA SEPARACION QUE ESTA PANTALLA SOSTIENE (FR-032): el gestor de repositorios
 * NO es una integracion mas. Git se habla directo y la capa de integracion no
 * se interpone. Por eso `scm` aparece aqui con su propia clase y no dentro del
 * saco de "integraciones": confundirlos lleva a enrutar `git push` por un
 * proveedor externo, y ese dia el producto depende de un tercero para algo que
 * sabia hacer solo.
 *
 * EL FLUJO DE AUTORIZACION ABRE EL NAVEGADOR DEL SISTEMA, no el webview. La
 * razon esta en `lib/enlace.ts` y es de seguridad, no de comodidad: en una
 * pagina donde el operador va a escribir credenciales, quitarle la barra de
 * direcciones le quita la unica forma de comprobar el dominio.
 *
 * NINGUNA CREDENCIAL SE ESCRIBE AQUI. La conexion queda registrada y su
 * credencial entra al inventario con su huella; el valor va a la boveda por
 * un camino que esta interfaz no tiene.
 */

const ICONO_DE_CLASE = {
  tracker: Ticket,
  scm: GitBranch,
  infra: Server,
  integracion: Plug,
} as const

const TONO_DEL_ESTADO: Record<EstadoDeLaConexion, TonoDeBadge> = {
  pendiente: 'advertencia',
  viva: 'exito',
  expirada: 'advertencia',
  revocada: 'neutral',
  fallida: 'error',
}

const CLASES: Array<{ valor: ClaseDeConexion; etiqueta: string; descripcion: string }> = [
  {
    valor: 'tracker',
    etiqueta: 'Gestor de tickets',
    descripcion:
      'De donde salen los work items. La descripcion de un ticket entra como DATO y nunca como instruccion ejecutable: lo que escriba un tercero en un ticket no manda sobre los agentes.',
  },
  {
    valor: 'scm',
    etiqueta: 'Gestor de repositorios',
    descripcion:
      'Donde se abren los pull requests. Git se habla directo; la capa de integracion no se interpone entre noxloop y tu repositorio.',
  },
  {
    valor: 'infra',
    etiqueta: 'Infraestructura',
    descripcion:
      'Accesos de infraestructura. Las capacidades de alto impacto llegan desactivadas por defecto y solo se elevan con politica explicita y auditada.',
  },
  {
    valor: 'integracion',
    etiqueta: 'Otra integracion',
    descripcion:
      'Cualquier otro servicio externo detras de la capa de integracion. Sustituir el proveedor no deberia tocar nada fuera de su adaptador.',
  },
]

/* -------------------------------------------------------------------------- */
/* El panel                                                                   */
/* -------------------------------------------------------------------------- */

export interface PropsDePanelDeConexiones {
  proyectoId: string
  conexiones: Conexion[]
  capacidades: Capacidades | null
  cargando: boolean
  error: ErrorDelServicio | null
  errorDeMutacion: ErrorDelServicio | null
  trabajando: boolean
  /** Lo que devolvio el ultimo `authorize`, mientras el flujo sigue abierto. */
  autorizacion: AutorizacionDeConexion | null
  alAutorizar: (clase: ClaseDeConexion, proveedor: string) => void
  alRevocar: (conexion: Conexion) => void
  navegar: Navegar
}

export function PanelDeConexiones({
  proyectoId,
  conexiones,
  capacidades,
  cargando,
  error,
  errorDeMutacion,
  trabajando,
  autorizacion,
  alAutorizar,
  alRevocar,
  navegar,
}: PropsDePanelDeConexiones) {
  const [clase, setClase] = useState<ClaseDeConexion>('tracker')
  const [proveedor, setProveedor] = useState('')
  const [porRevocar, setPorRevocar] = useState<Conexion | null>(null)
  const [errorDeEnlace, setErrorDeEnlace] = useState<ErrorDelServicio | null>(null)

  const proveedorDeIntegraciones = capacidades?.conexiones?.proveedor

  const abrir = async (url: string) => {
    setErrorDeEnlace(null)
    try {
      await abrirExterno(url)
    } catch (fallo: unknown) {
      setErrorDeEnlace(comoErrorDelServicio(fallo, url))
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <Encabezado
        titulo="Conexiones"
        identificador={proyectoId}
        descripcion="Con que habla este proyecto. Cada conexion queda registrada con su proveedor, su estado y la credencial que la habilita; el valor de esa credencial no pasa por esta interfaz."
        volver={{ ruta: { seccion: 'proyectos', id: null }, etiqueta: 'Proyectos' }}
        navegar={navegar}
        acciones={
          <Button
            variant="secondary"
            onClick={() => navegar({ seccion: 'credenciales', id: null })}
          >
            Ver el inventario de credenciales
          </Button>
        }
      />

      {capacidades && !proveedorDeIntegraciones ? (
        <Note tipo="advertencia" titulo="No hay proveedor de integraciones declarado">
          Este servicio no declara ningun proveedor de integraciones en /v1/capabilities.
          Las conexiones que ya existen siguen funcionando con los tokens ya emitidos
          hasta su expiracion; las nuevas van a fallar. Arranca el servicio de
          integraciones y vuelve a cargar esta pantalla.
        </Note>
      ) : null}

      {cargando ? <EsqueletoDeLista filas={2} /> : null}

      {!cargando && conexiones.length === 0 ? (
        <EmptyState
          modo={error ? 'error' : 'primero'}
          titulo={error ? 'No Se Pudieron Cargar Las Conexiones' : 'Sin Conexiones Todavia'}
          descripcion={
            error
              ? error.causa
              : 'Sin gestor de tickets no hay de donde sacar el work item, y sin gestor de repositorios no hay donde abrir el pull request. Un ciclo lanzado sin ninguna de las dos se bloquea y entra en la bandeja en vez de fallar a medias.'
          }
        />
      ) : null}

      {conexiones.length > 0 ? (
        <ListaDeEntidades etiqueta="Conexiones del proyecto">
          {conexiones.map((conexion) => {
            const Icono = ICONO_DE_CLASE[conexion.clase] ?? Plug
            return (
              <Entity
                key={conexion.id}
                contenedor="li"
                miniatura={<Icono />}
                titulo={conexion.proveedor}
                identificador={conexion.id}
                descripcion={
                  conexion.causa
                    ? conexion.causa
                    : `${ETIQUETA_CLASE_CONEXION[conexion.clase]}. ${
                        conexion.clase === 'scm'
                          ? 'Git se habla directo: la capa de integracion no se interpone entre noxloop y el repositorio.'
                          : 'Lo que devuelva este proveedor entra como dato, nunca como instruccion ejecutable.'
                      }`
                }
                metadatos={
                  <>
                    <Badge tono={TONO_DEL_ESTADO[conexion.estado]}>
                      {ETIQUETA_ESTADO_CONEXION[conexion.estado]}
                    </Badge>
                    {conexion.credential_id ? (
                      <span className="fuente-operativa text-label-12 text-ds-gray-700">
                        {conexion.credential_id}
                      </span>
                    ) : (
                      <span className="text-label-12 text-ds-gray-700">
                        Sin credencial asociada
                      </span>
                    )}
                  </>
                }
                acciones={
                  conexion.estado !== 'revocada' ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setPorRevocar(conexion)}
                    >
                      Revocar
                    </Button>
                  ) : null
                }
              />
            )
          })}
        </ListaDeEntidades>
      ) : null}

      {conexiones.length > 0 ? <FalloDeLectura error={error} /> : null}

      <Fieldset>
        <FieldsetContent
          titulo="Conectar un proveedor"
          descripcion="El flujo de autorizacion se abre en tu navegador, no dentro de esta ventana: en la pagina donde vas a escribir credenciales necesitas la barra de direcciones para comprobar donde estas."
        >
          <div className="flex flex-col gap-5">
            <Segmentado
              etiqueta="Clase de conexion"
              opciones={CLASES}
              valor={clase}
              alCambiar={setClase}
            />

            <Campo
              etiqueta="Proveedor"
              valor={proveedor}
              alCambiar={setProveedor}
              operativo
              requerido
              marcador="identificador del proveedor"
              ayuda={
                proveedorDeIntegraciones
                  ? `El servicio de integraciones declarado es ${proveedorDeIntegraciones}. El identificador del proveedor es el que ese servicio publica en su catalogo.`
                  : 'El identificador del proveedor, tal como lo publica el servicio de integraciones en su catalogo.'
              }
              className="max-w-md"
            />

            {autorizacion ? (
              <Note tipo="informativo" titulo="El flujo de autorizacion esta abierto">
                <div className="flex flex-col gap-2">
                  <p>
                    Termina la autorizacion en el navegador. Esta pantalla se entera sola
                    cuando el proveedor conteste: no hace falta recargar.
                  </p>
                  <p className="fuente-operativa break-all text-label-12 text-ds-gray-900">
                    {autorizacion.url_autorizacion}
                  </p>
                  <p className="text-label-12 text-ds-gray-700">
                    Caduca el{' '}
                    <span className="fuente-operativa">{autorizacion.expira}</span>. Si
                    caduca, vuelve a pulsar conectar: no se queda a medias.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void abrir(autorizacion.url_autorizacion)}
                    >
                      <ExternalLink />
                      Abrir en el navegador
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        void navigator.clipboard?.writeText(autorizacion.url_autorizacion)
                      }
                    >
                      <Copy />
                      Copiar la direccion
                    </Button>
                  </div>
                </div>
              </Note>
            ) : null}

            {errorDeEnlace ? (
              <ErrorText causa={errorDeEnlace.causa} accion={errorDeEnlace.accion} />
            ) : null}
            {errorDeMutacion ? (
              <ErrorText causa={errorDeMutacion.causa} accion={errorDeMutacion.accion} />
            ) : null}
          </div>
        </FieldsetContent>

        <FieldsetFooter nota="Al autorizar, la credencial entra al inventario con su huella. El valor va a la boveda del sistema operativo y no pasa por esta pantalla.">
          <Button
            onClick={() => alAutorizar(clase, proveedor.trim())}
            disabled={trabajando || proveedor.trim().length === 0}
          >
            {trabajando ? <Spinner tamano="sm" etiqueta="Abriendo el flujo" /> : null}
            <Plug />
            Conectar
          </Button>
        </FieldsetFooter>
      </Fieldset>

      <ModalDeAccionDestructiva
        abierto={porRevocar !== null}
        alCerrar={() => setPorRevocar(null)}
        titulo="Revocar conexion"
        recurso={porRevocar?.proveedor ?? ''}
        claseDeRecurso="la conexion"
        consecuencias={
          <>
            El proyecto deja de alcanzar {porRevocar?.proveedor ?? 'este proveedor'} de
            inmediato. Un run en marcha que dependa de esta conexion se bloquea en su
            proximo paso y entra en la bandeja con la causa escrita; no falla en
            silencio. La revocacion queda en el registro de auditoria, que no se puede
            editar ni borrar desde aqui.
          </>
        }
        etiquetaDeConfirmacion="Revocar conexion"
        trabajando={trabajando}
        alConfirmar={() => {
          if (porRevocar) alRevocar(porRevocar)
          setPorRevocar(null)
        }}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* El contenedor                                                              */
/* -------------------------------------------------------------------------- */

const EVENTOS_DE_CONEXIONES = ['conexion.estado', 'sincronizar_completo'] as const

export function VistaDeConexiones({
  proyectoId,
  navegar,
}: {
  proyectoId: string
  navegar: Navegar
}) {
  const lectura = useLectura<Conexion[]>(`/v1/projects/${proyectoId}/connections`, {
    relerEn: EVENTOS_DE_CONEXIONES,
  })
  const capacidades = useLectura<Capacidades>('/v1/capabilities')
  const mutacion = useMutacion()
  const [autorizacion, setAutorizacion] = useState<AutorizacionDeConexion | null>(null)

  const autorizar = async (clase: ClaseDeConexion, proveedor: string) => {
    const respuesta = await mutacion.enviar<AutorizacionDeConexion>(
      'POST',
      `/v1/projects/${proyectoId}/connections/authorize`,
      { clase, proveedor },
    )
    if (respuesta) setAutorizacion(respuesta)
  }

  const revocar = async (conexion: Conexion) => {
    await mutacion.enviar('DELETE', `/v1/connections/${conexion.id}`)
    lectura.releer()
  }

  return (
    <PanelDeConexiones
      proyectoId={proyectoId}
      conexiones={lectura.datos ?? []}
      capacidades={capacidades.datos}
      cargando={lectura.datos === null && lectura.error === null}
      error={lectura.error}
      errorDeMutacion={mutacion.error}
      trabajando={mutacion.trabajando}
      autorizacion={autorizacion}
      alAutorizar={(clase, proveedor) => void autorizar(clase, proveedor)}
      alRevocar={(conexion) => void revocar(conexion)}
      navegar={navegar}
    />
  )
}
