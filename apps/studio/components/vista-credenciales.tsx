'use client'

import { useEffect, useMemo, useState } from 'react'
import { KeyRound, RefreshCw, ShieldOff, Users } from 'lucide-react'

import { Badge, type TonoDeBadge } from '@/components/ui/insignia'
import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { Description, ListaDeDescripciones } from '@/components/ui/descripcion'
import { EmptyState } from '@/components/ui/estado-vacio'
import { Entity, ListaDeEntidades } from '@/components/ui/entidad'
import { ErrorText, Fieldset, FieldsetContent, FieldsetFooter } from '@/components/ui/fieldset'
import { ModalDeAccionDestructiva } from '@/components/ui/modal-de-accion-destructiva'
import { Note } from '@/components/ui/nota'
import { SecretValue } from '@/components/ui/valor-secreto'
import { Seleccion } from '@/components/ui/seleccion'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { Instante } from '@/components/ui/tabla'
import {
  Encabezado,
  EsqueletoDeLista,
  FalloDeLectura,
} from '@/components/pantalla'
import { useLectura, type Lectura } from '@/lib/lectura'
import { useMutacion } from '@/lib/mutacion'
import { etiquetaDe, useOpciones, useValorConPreseleccion } from '@/lib/opciones'
import { contiene } from '@/lib/texto'
import type { ErrorDelServicio } from '@/lib/daemon'
import {
  ETIQUETA_ESTADO_CREDENCIAL,
  GRUPO,
  type Agente,
  type AlcanceDeCredencial,
  type AmbitoDeCredencial,
  type Capacidades,
  type Credencial,
  type EstadoDeCredencial,
  type GrupoDeOpciones,
  type Proyecto,
  type TipoDeCredencial,
} from '@/lib/tipos'
import type { Navegar } from '@/lib/ruta'

/**
 * T163 (2/2) · Inventario de credenciales, grants y vista inversa.
 *
 * LO PRIMERO, PORQUE ORDENA TODO LO DEMAS: ESTA INTERFAZ NUNCA RECIBE EL VALOR
 * DE UNA CREDENCIAL, Y ESO NO ES UNA DEGRADACION — ES EL DISENO. El contrato
 * lo prohibe endpoint por endpoint: ninguna respuesta, ni siquiera un mensaje
 * de error o una traza, contiene el secreto. La boveda vive detras de comandos
 * que no estan expuestos al webview. No hay ruta por la que el valor pueda
 * llegar hasta aqui.
 *
 * Por eso `SecretValue` se usa en modo huella, sin boton de revelar: no hay
 * nada que revelar. El componente lo dice con todas sus letras, porque un
 * campo enmascarado sin boton parece roto si nadie explica que detras no hay
 * nada escondido.
 *
 * El unico momento en que esta pantalla toca un secreto es el instante entre
 * que el operador lo pega y el servicio lo guarda —registrar y rotar—, y de
 * ahi no vuelve: lo que el servicio devuelve es la huella.
 *
 * LA VISTA INVERSA (FR-045) CONTESTA UNA PREGUNTA CONCRETA: "que agentes y que
 * proyectos alcanzan esta credencial HOY". No es la lista de filas de grant.
 * Un grant revocado o fuera de vigencia existe en la tabla y no alcanza nada,
 * y mezclarlos responderia a otra pregunta — la equivocada, justo en la
 * pantalla donde el operador decide si un secreto esta mas expuesto de lo que
 * creia.
 *
 * REVOCAR VA POR `ModalDeAccionDestructiva`: escribir el nombre exacto. Quien
 * ha revocado nueve credenciales confirma la decima sin leer, y el error que
 * se quiere atrapar no es "no queria revocar" sino "no queria revocar ESTA".
 */

const TONO_DEL_ESTADO: Record<EstadoDeCredencial, TonoDeBadge> = {
  activa: 'exito',
  por_expirar: 'advertencia',
  expirada: 'error',
  revocada: 'neutral',
}

/* -------------------------------------------------------------------------- */
/* Vista inversa                                                              */
/* -------------------------------------------------------------------------- */

export function VistaInversa({
  alcance,
  cargando,
  error,
  trabajando,
  alRevocarGrant,
}: {
  alcance: AlcanceDeCredencial | null
  cargando: boolean
  error: ErrorDelServicio | null
  trabajando: boolean
  alRevocarGrant: (grantId: string) => void
}) {
  const agentes = alcance?.agentes ?? []
  const proyectos = alcance?.proyectos ?? []

  return (
    <section aria-labelledby="titulo-alcance" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 id="titulo-alcance" className="text-heading-16 text-ds-gray-1000">
          Quien la alcanza hoy
        </h3>
        <p className="text-copy-13 text-ds-gray-900">
          Grants vigentes, no filas de la tabla: lo revocado y lo caducado no aparece
          aqui porque no alcanza nada. No existe el grant implicito — un agente sin fila
          vigente no llega a esta credencial aunque sea del mismo proyecto.
        </p>
      </div>

      {cargando ? <EsqueletoDeLista filas={2} /> : null}

      {!cargando && agentes.length === 0 ? (
        <EmptyState
          modo={error ? 'error' : 'primero'}
          tamano="compacto"
          titulo={error ? 'No Se Pudo Calcular El Alcance' : 'Ningun Agente La Alcanza'}
          descripcion={
            error
              ? error.causa
              : 'Esta credencial esta inventariada y nadie tiene grant vigente sobre ella. Una tarea que la necesite se bloquea con causa textual y entra en la bandeja: denegar por defecto es el comportamiento, no un fallo.'
          }
        />
      ) : null}

      {agentes.length > 0 ? (
        <ListaDeEntidades etiqueta="Agentes que alcanzan la credencial">
          {agentes.map((agente) => (
            <Entity
              key={agente.grant_id}
              contenedor="li"
              miniatura={<Users />}
              titulo={agente.nombre}
              identificador={agente.agent_id}
              descripcion={
                <>
                  En el proyecto {agente.proyecto}
                  {agente.rol ? `, con rol ${agente.rol}` : ''}
                  {agente.runtime ? `, sobre el runtime ${agente.runtime}` : ''}.
                  {agente.vigencia_hasta
                    ? ` El grant vence el ${agente.vigencia_hasta}.`
                    : ' El grant no tiene fecha de vencimiento.'}
                </>
              }
              metadatos={
                <span className="fuente-operativa text-label-12 text-ds-gray-700">
                  {agente.grant_id}
                </span>
              }
              acciones={
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={trabajando}
                  onClick={() => alRevocarGrant(agente.grant_id)}
                >
                  Revocar grant
                </Button>
              }
            />
          ))}
        </ListaDeEntidades>
      ) : null}

      {proyectos.length > 0 ? (
        <p className="text-label-12 text-ds-gray-700">
          Alcanzan esta credencial {agentes.length}{' '}
          {agentes.length === 1 ? 'agente' : 'agentes'} repartidos en {proyectos.length}{' '}
          {proyectos.length === 1 ? 'proyecto' : 'proyectos'}:{' '}
          {proyectos.map((proyecto) => proyecto.nombre).join(', ')}.
          {alcance?.calculado ? ` Calculado el ${alcance.calculado}.` : null}
        </p>
      ) : null}

      {agentes.length > 0 ? <FalloDeLectura error={error} /> : null}
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* Detalle                                                                    */
/* -------------------------------------------------------------------------- */

function DetalleDeCredencial({
  credencial,
  alcance,
  proyectos,
  tipos,
  ambitos,
  ahora,
  trabajando,
  errorDeMutacion,
  alRotar,
  alRevocar,
  alRevocarGrant,
  alConcederGrant,
}: {
  credencial: Credencial
  alcance: Lectura<AlcanceDeCredencial>
  /** Los proyectos del workspace: la tripleta se concede sobre uno concreto. */
  proyectos: Proyecto[]
  tipos: GrupoDeOpciones
  ambitos: GrupoDeOpciones
  ahora: number
  trabajando: boolean
  errorDeMutacion: ErrorDelServicio | null
  alRotar: (valor: string) => void
  alRevocar: () => void
  alRevocarGrant: (grantId: string) => void
  alConcederGrant: (proyecto: string, agente: string, hasta: string) => void
}) {
  const [rotando, setRotando] = useState(false)
  const [nuevoValor, setNuevoValor] = useState('')
  const [proyecto, setProyecto] = useState(credencial.project_id ?? '')
  const [agente, setAgente] = useState('')
  const [hasta, setHasta] = useState('')

  // LOS AGENTES SE PIDEN DEL PROYECTO ELEGIDO, no de todos. No es una
  // optimizacion: un grant es la tripleta proyecto + agente + credencial, y un
  // agente de OTRO proyecto en esa lista es una fila que el servicio va a
  // rechazar. Ofrecerla es ofrecer un error.
  const agentes = useLectura<Agente[]>(
    proyecto ? `/v1/projects/${encodeURIComponent(proyecto)}/agents` : null,
  )

  // Proyectos y agentes NO salen de `/v1/options`: no son un enum del dominio,
  // son filas del almacen que cambian cada dia. El catalogo publica conjuntos
  // cerrados; esto es una lista, y su sitio es la ruta que ya la sirve.
  const grupoDeProyectos: GrupoDeOpciones = {
    opciones: proyectos.map((p) => ({
      valor: p.id,
      etiqueta: p.nombre,
      descripcion: p.ruta_local ?? undefined,
    })),
    unica: proyectos.length === 1,
    origen: 'detectado',
    porque: 'son los proyectos que este servicio gestiona en este home.',
    como_conseguirlo:
      'Da de alta un proyecto desde la pantalla de proyectos: un grant se concede sobre uno concreto, nunca en abstracto.',
    preseleccion: null,
  }

  const grupoDeAgentes: GrupoDeOpciones = {
    opciones: (agentes.datos ?? []).map((a) => ({
      valor: a.id,
      etiqueta: a.nombre,
      descripcion: `${a.rol} · ${a.runtime}`,
    })),
    unica: (agentes.datos ?? []).length === 1,
    origen: proyecto ? 'detectado' : 'vacio',
    porque: proyecto
      ? 'son los agentes declarados en el proyecto elegido.'
      : 'todavia no hay ningun proyecto elegido, y un agente solo existe dentro de uno.',
    como_conseguirlo: proyecto
      ? 'Declara un agente en la pantalla de flota de ese proyecto. Sin agente no hay a quien conceder nada.'
      : 'Elige primero el proyecto de arriba.',
    preseleccion: null,
  }

  return (
    <div className="flex flex-col gap-6 border-l-2 border-ds-gray-400 pl-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-heading-20 text-ds-gray-1000">{credencial.nombre}</h2>
        <span className="fuente-operativa text-label-12 text-ds-gray-700">
          {credencial.id}
        </span>
        <Badge tono={TONO_DEL_ESTADO[credencial.estado]}>
          {ETIQUETA_ESTADO_CREDENCIAL[credencial.estado]}
        </Badge>
      </div>

      <SecretValue huella={credencial.huella} etiqueta={`la credencial ${credencial.nombre}`} />

      <ListaDeDescripciones>
        <Description titulo="Proveedor" contenido={credencial.proveedor} />
        <Description titulo="Tipo" contenido={etiquetaDe(tipos, credencial.tipo)} />
        <Description
          titulo="Ambito"
          contenido={etiquetaDe(ambitos, credencial.ambito)}
          nota={
            credencial.ambito === 'global'
              ? 'Visible para cualquier proyecto, pero solo alcanzable con grant.'
              : undefined
          }
        />
        <Description titulo="Alcance declarado" contenido={credencial.alcance_declarado} />
        <Description
          titulo="Guardada en"
          contenido={credencial.backend}
          nota="Donde vive el valor. Esta interfaz no lo pide nunca: no existe el endpoint."
        />
        <Description
          titulo="Creada"
          contenido={<Instante valor={credencial.creada} ahora={ahora} />}
        />
        <Description
          titulo="Caduca"
          contenido={
            credencial.expira ? <Instante valor={credencial.expira} ahora={ahora} /> : 'No caduca'
          }
          nota={
            credencial.aviso_dias_antes
              ? `Aviso ${credencial.aviso_dias_antes} dias antes.`
              : undefined
          }
        />
      </ListaDeDescripciones>

      {credencial.estado === 'por_expirar' ? (
        <Note tipo="advertencia" titulo="Esta credencial esta a punto de caducar">
          Al caducar, las tareas que la necesiten se bloquean con causa textual escrita
          por noxloop, no con un error del proveedor sin contexto. Rotarla ahora conserva
          todos los grants.
        </Note>
      ) : null}

      <VistaInversa
        alcance={alcance.datos}
        cargando={alcance.datos === null && alcance.error === null}
        error={alcance.error}
        trabajando={trabajando}
        alRevocarGrant={alRevocarGrant}
      />

      <Fieldset>
        <FieldsetContent
          titulo="Conceder un grant"
          descripcion="La autorizacion es la tripleta proyecto + agente + credencial, con vigencia opcional. No hay forma de autorizar a un agente en abstracto: siempre es sobre un proyecto concreto."
        >
          {/* LOS DOS PRIMEROS ERAN CAMPOS DE TEXTO que pedian `prj_...` y
              `agt_...`. Esos identificadores no estan escritos en ninguna
              pantalla donde el operador pueda copiarlos: habia que sacarlos de
              la barra de direcciones o de una respuesta cruda. Y equivocarse no
              daba un error util — daba un 404 sobre un id que nadie reconoce.
              El tercero sigue siendo texto porque una fecha no es un enum. */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Seleccion
              etiqueta="Proyecto"
              grupo={grupoDeProyectos}
              valor={proyecto}
              alCambiar={(valor) => {
                setProyecto(valor)
                // El agente elegido pertenecia al proyecto anterior. Dejarlo
                // puesto manda una tripleta que el servicio rechaza, y el
                // rechazo habla de un agente que en la pantalla se ve bien.
                setAgente('')
              }}
              requerido
            />
            <Seleccion
              etiqueta="Agente"
              grupo={grupoDeAgentes}
              valor={agente}
              alCambiar={setAgente}
              cargando={Boolean(proyecto) && agentes.datos === null && agentes.error === null}
              requerido
            />
            <Campo
              etiqueta="Vigente hasta"
              valor={hasta}
              alCambiar={setHasta}
              operativo
              marcador="2026-12-31"
              ayuda="Opcional. Sin fecha, el grant dura hasta que se revoque."
            />
          </div>
        </FieldsetContent>
        <FieldsetFooter nota="Queda en el registro de auditoria, que esta aplicacion no puede editar ni borrar.">
          <Button
            onClick={() => alConcederGrant(proyecto.trim(), agente.trim(), hasta.trim())}
            disabled={trabajando || !proyecto.trim() || !agente.trim()}
          >
            Conceder grant
          </Button>
        </FieldsetFooter>
      </Fieldset>

      {rotando ? (
        <Fieldset>
          <FieldsetContent
            titulo="Rotar la credencial"
            descripcion="El valor nuevo va directo a la boveda. La huella cambia y los grants se conservan: rotar no es revocar y volver a conceder."
          >
            <Campo
              etiqueta="Valor nuevo"
              valor={nuevoValor}
              alCambiar={setNuevoValor}
              secreto
              requerido
              ayuda="Se envia una vez y no vuelve. Lo que esta pantalla vera despues es la huella nueva."
            />
            {errorDeMutacion ? (
              <ErrorText causa={errorDeMutacion.causa} accion={errorDeMutacion.accion} />
            ) : null}
          </FieldsetContent>
          <FieldsetFooter nota="Los agentes con grant vigente empiezan a usar el valor nuevo en su proximo lanzamiento.">
            <Button variant="secondary" onClick={() => setRotando(false)} disabled={trabajando}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                alRotar(nuevoValor)
                setNuevoValor('')
                setRotando(false)
              }}
              disabled={trabajando || nuevoValor.length === 0}
            >
              {trabajando ? <Spinner tamano="sm" etiqueta="Rotando" /> : null}
              Rotar credencial
            </Button>
          </FieldsetFooter>
        </Fieldset>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setRotando(true)} disabled={trabajando}>
            <RefreshCw />
            Rotar
          </Button>
          {credencial.estado !== 'revocada' ? (
            <Button variant="destructive" onClick={alRevocar} disabled={trabajando}>
              <ShieldOff />
              Revocar credencial
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* El formulario de alta                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Registrar una credencial.
 *
 * ESTA EXPORTADO Y SEPARADO DEL PANEL POR UNA RAZON MEDIDA, no por estilo.
 * Vivia dentro de `PanelDeCredenciales`, detras de un `useState` que empieza en
 * `false`, asi que NADA lo renderizaba nunca: ni el catalogo de pantallas, ni
 * el `next build`, ni ningun test. Y ahi dentro habia un fallo que no podia
 * salir de otra manera — el formulario no mandaba `tipo`, que
 * `POST /v1/credentials` EXIGE, asi que registrar una credencial desde la
 * interfaz contestaba 400 siempre y no habia ningun control con el que
 * arreglarlo.
 *
 * Es exactamente el motivo que ya tenia escrito `FormularioDeAgente`: un
 * componente que nadie importa se queda fuera del bundle y su primer render de
 * verdad ocurre en la maquina del operador.
 */
export function FormularioDeCredencial({
  tipos,
  ambitos,
  cargandoOpciones = false,
  trabajando,
  errorDeMutacion,
  alRegistrar,
  alCerrar,
}: {
  tipos: GrupoDeOpciones
  ambitos: GrupoDeOpciones
  cargandoOpciones?: boolean
  trabajando: boolean
  errorDeMutacion: ErrorDelServicio | null
  alRegistrar: (credencial: Partial<Credencial> & { valor: string }) => void
  alCerrar: () => void
}) {
  const [nueva, setNueva] = useState({
    nombre: '',
    proveedor: '',
    alcance_declarado: '',
    valor: '',
  })
  // EL FALLO QUE ESTOS DOS CIERRAN, y estaba en la pantalla: `POST
  // /v1/credentials` EXIGE `tipo` —`exigir(cuerpo, ["nombre", "proveedor",
  // "tipo", "alcance_declarado", "valor"])`— y este formulario no lo mandaba.
  // O sea: registrar una credencial desde la interfaz devolvia 400 «falta el
  // campo `tipo`» SIEMPRE, y no habia ningun control con el que ponerlo. El
  // boton estaba, se pulsaba, y no podia funcionar nunca.
  //
  // `ambito` no era obligatorio —el servicio lo deduce de si hay `project_id`—
  // pero tampoco se podia decidir, asi que toda credencial nacia global sin
  // que nadie lo eligiera.
  const [tipo, setTipo] = useValorConPreseleccion(tipos)
  const [ambito, setAmbito] = useValorConPreseleccion(ambitos)

  return (
      <Fieldset>
        <FieldsetContent
          titulo="Registrar credencial"
          descripcion="El valor se manda una vez y va directo a la boveda. Lo que vuelve es la huella; esta pantalla no lo guarda ni lo vuelve a pedir."
        >
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo
                etiqueta="Nombre"
                valor={nueva.nombre}
                alCambiar={(valor) => setNueva((antes) => ({ ...antes, nombre: valor }))}
                requerido
                marcador="token de despliegue"
              />
              <Campo
                etiqueta="Proveedor"
                valor={nueva.proveedor}
                alCambiar={(valor) => setNueva((antes) => ({ ...antes, proveedor: valor }))}
                requerido
                operativo
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Seleccion
                etiqueta="Tipo"
                grupo={tipos}
                valor={tipo}
                alCambiar={setTipo}
                cargando={cargandoOpciones}
                requerido
                ayuda="Que clase de credencial es. El servicio lo exige y no lo deduce del proveedor: dos tokens del mismo sitio pueden servir para cosas distintas."
              />
              <Seleccion
                etiqueta="Ambito"
                grupo={ambitos}
                valor={ambito}
                alCambiar={setAmbito}
                cargando={cargandoOpciones}
              />
            </div>

            {/* EL ALCANCE DECLARADO SIGUE SIENDO TEXTO LIBRE, y eso es
                deliberado: no es un enum ni lo puede ser. Es lo que el
                operador afirma que esta credencial puede hacer, con sus
                palabras, y no se verifica contra el proveedor. Convertirlo en
                un desplegable obligaria a inventarse una lista de alcances
                que ningun proveedor comparte, y el operador elegiria el que
                mas se parezca — que es peor que la frase que habria escrito. */}
            <Campo
              etiqueta="Alcance declarado"
              valor={nueva.alcance_declarado}
              alCambiar={(valor) =>
                setNueva((antes) => ({ ...antes, alcance_declarado: valor }))
              }
              requerido
              ayuda="Lo que esta credencial puede hacer, escrito por ti. No se verifica contra el proveedor: es lo que declaras, y sirve para decidir a quien se la concedes."
            />
            <Campo
              etiqueta="Valor"
              valor={nueva.valor}
              alCambiar={(valor) => setNueva((antes) => ({ ...antes, valor }))}
              secreto
              requerido
              ayuda="Esta es la unica pantalla de noxloop donde un secreto pasa por la interfaz, y solo de paso. En cuanto el servicio lo guarde, lo unico que vuelve es la huella."
            />
            {errorDeMutacion ? (
              <ErrorText causa={errorDeMutacion.causa} accion={errorDeMutacion.accion} />
            ) : null}
          </div>
        </FieldsetContent>
        <FieldsetFooter nota="Registrar no concede nada: sin grant, ningun agente la alcanza.">
          <Button variant="secondary" onClick={() => alCerrar()} disabled={trabajando}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              alRegistrar({
                ...nueva,
                // Los dos vienen del catalogo del servicio, que los deriva
                // del mismo enum que la base impone con un CHECK: el
                // estrechamiento es lo que el tipo del cliente afirma, y el
                // servicio lo vuelve a comprobar de todas formas.
                tipo: tipo as TipoDeCredencial,
                ambito: ambito as AmbitoDeCredencial,
              })
              setNueva({ nombre: '', proveedor: '', alcance_declarado: '', valor: '' })
              alCerrar()
            }}
            disabled={
              trabajando ||
              !nueva.nombre.trim() ||
              !nueva.proveedor.trim() ||
              !nueva.alcance_declarado.trim() ||
              !nueva.valor ||
              // Sin tipo el servicio contesta 400. El boton lo dice
              // apagandose en vez de dejar mandar algo que no puede salir
              // bien, que es lo que hacia antes.
              !tipo
            }
          >
            {trabajando ? <Spinner tamano="sm" etiqueta="Registrando" /> : null}
            Registrar credencial
          </Button>
        </FieldsetFooter>
      </Fieldset>
  )
}

/* -------------------------------------------------------------------------- */
/* El panel                                                                   */
/* -------------------------------------------------------------------------- */

export interface PropsDePanelDeCredenciales {
  credenciales: Credencial[]
  seleccionada: string | null
  alSeleccionar: (id: string | null) => void
  alcance: Lectura<AlcanceDeCredencial>
  /** Los proyectos del workspace: el grant se concede sobre uno concreto. */
  proyectos: Proyecto[]
  /** `credential.tipo` y `credential.ambito` del catalogo del servicio. */
  tipos: GrupoDeOpciones
  ambitos: GrupoDeOpciones
  cargandoOpciones?: boolean
  capacidades: Capacidades | null
  ahora: number
  cargando: boolean
  error: ErrorDelServicio | null
  errorDeMutacion: ErrorDelServicio | null
  trabajando: boolean
  alRegistrar: (credencial: Partial<Credencial> & { valor: string }) => void
  alRotar: (credencial: Credencial, valor: string) => void
  alRevocar: (credencial: Credencial) => void
  alRevocarGrant: (grantId: string) => void
  alConcederGrant: (credencial: Credencial, proyecto: string, agente: string, hasta: string) => void
  navegar: Navegar
}

export function PanelDeCredenciales({
  credenciales,
  seleccionada,
  alSeleccionar,
  alcance,
  proyectos,
  tipos,
  ambitos,
  cargandoOpciones = false,
  capacidades,
  ahora,
  cargando,
  error,
  errorDeMutacion,
  trabajando,
  alRegistrar,
  alRotar,
  alRevocar,
  alRevocarGrant,
  alConcederGrant,
  navegar,
}: PropsDePanelDeCredenciales) {
  const [consulta, setConsulta] = useState('')
  const [registrando, setRegistrando] = useState(false)
  const [porRevocar, setPorRevocar] = useState<Credencial | null>(null)
  const filtradas = useMemo(
    () =>
      credenciales.filter((credencial) =>
        contiene(`${credencial.nombre} ${credencial.proveedor}`, consulta),
      ),
    [credenciales, consulta],
  )

  const detalle = credenciales.find((credencial) => credencial.id === seleccionada) ?? null
  const boveda = capacidades?.boveda

  return (
    <div className="flex flex-col gap-8">
      <Encabezado
        titulo="Credenciales"
        descripcion="El inventario: nombre, proveedor, alcance, ambito, creacion, caducidad y huella. El valor no esta aqui, y no porque se haya omitido: no hay ningun endpoint que lo devuelva."
        volver={{ ruta: { seccion: 'inicio', id: null }, etiqueta: 'Inicio' }}
        navegar={navegar}
        acciones={
          <Button onClick={() => setRegistrando((antes) => !antes)}>
            <KeyRound />
            Registrar credencial
          </Button>
        }
      />

      {boveda?.degradado ? (
        <Note tipo="advertencia" titulo="La boveda esta degradada">
          Este sistema no ofrece el almacen de secretos del sistema operativo, asi que
          las credenciales van a un archivo cifrado ({boveda.backend}). Queda declarado
          en /v1/capabilities, nunca en silencio: saberlo cambia como de seguro esta este
          equipo, y esa decision es tuya.
        </Note>
      ) : null}

      {registrando ? (
        <FormularioDeCredencial
          tipos={tipos}
          ambitos={ambitos}
          cargandoOpciones={cargandoOpciones}
          trabajando={trabajando}
          errorDeMutacion={errorDeMutacion}
          alRegistrar={alRegistrar}
          alCerrar={() => setRegistrando(false)}
        />
      ) : null}

      {credenciales.length > 6 ? (
        <Campo
          etiqueta="Filtrar"
          valor={consulta}
          alCambiar={setConsulta}
          marcador="nombre o proveedor"
          ayuda="El filtro mira el nombre y el proveedor. Nunca la huella: comparar huellas a ojo no es una busqueda."
          className="max-w-md"
        />
      ) : null}

      {cargando ? <EsqueletoDeLista filas={3} /> : null}

      {!cargando && credenciales.length === 0 ? (
        <EmptyState
          modo={error ? 'error' : 'primero'}
          titulo={error ? 'No Se Pudo Cargar El Inventario' : 'Sin Credenciales Registradas'}
          descripcion={
            error
              ? error.causa
              : 'Los agentes solo usan credenciales autorizadas por la tripleta proyecto + agente + credencial. Sin ninguna registrada, ningun run puede publicar nada, que es el estado seguro por defecto.'
          }
          accion={
            error ? null : <Button onClick={() => setRegistrando(true)}>Registrar credencial</Button>
          }
        />
      ) : null}

      {filtradas.length > 0 ? (
        <ListaDeEntidades etiqueta="Credenciales del inventario">
          {filtradas.map((credencial) => (
            <Entity
              key={credencial.id}
              contenedor="li"
              miniatura={<KeyRound />}
              titulo={credencial.nombre}
              identificador={credencial.huella}
              descripcion={credencial.alcance_declarado}
              metadatos={
                <>
                  <Badge tono={TONO_DEL_ESTADO[credencial.estado]}>
                    {ETIQUETA_ESTADO_CREDENCIAL[credencial.estado]}
                  </Badge>
                  <span className="text-label-12 text-ds-gray-700">{credencial.proveedor}</span>
                  <span className="text-label-12 text-ds-gray-700">
                    {credencial.ambito === 'global' ? 'Global' : 'De un proyecto'}
                  </span>
                </>
              }
              alPulsar={() =>
                alSeleccionar(seleccionada === credencial.id ? null : credencial.id)
              }
              seleccionada={seleccionada === credencial.id}
            />
          ))}
        </ListaDeEntidades>
      ) : null}

      {credenciales.length > 0 && filtradas.length === 0 ? (
        <EmptyState
          modo="filtrado"
          tamano="compacto"
          titulo="Ninguna Credencial Coincide"
          consulta={consulta}
          descripcion={`Hay ${credenciales.length} credenciales en el inventario.`}
        />
      ) : null}

      {credenciales.length > 0 ? <FalloDeLectura error={error} /> : null}

      {detalle ? (
        <DetalleDeCredencial
          credencial={detalle}
          alcance={alcance}
          proyectos={proyectos}
          tipos={tipos}
          ambitos={ambitos}
          ahora={ahora}
          trabajando={trabajando}
          errorDeMutacion={errorDeMutacion}
          alRotar={(valor) => alRotar(detalle, valor)}
          alRevocar={() => setPorRevocar(detalle)}
          alRevocarGrant={alRevocarGrant}
          alConcederGrant={(proyecto, agente, hasta) =>
            alConcederGrant(detalle, proyecto, agente, hasta)
          }
        />
      ) : null}

      <ModalDeAccionDestructiva
        abierto={porRevocar !== null}
        alCerrar={() => setPorRevocar(null)}
        titulo="Revocar credencial"
        recurso={porRevocar?.nombre ?? ''}
        claseDeRecurso="la credencial"
        consecuencias={
          <>
            Los agentes con grant vigente pierden el acceso en cuanto se revoque, y un
            run en marcha que la use fallara en su proximo paso — con causa textual y
            una entrada en la bandeja, no con un error del proveedor. La huella se
            conserva en el inventario para que la evidencia de los runs pasados siga
            explicandose.
          </>
        }
        etiquetaDeConfirmacion="Revocar credencial"
        trabajando={trabajando}
        error={
          errorDeMutacion
            ? { causa: errorDeMutacion.causa, accion: errorDeMutacion.accion }
            : null
        }
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

const EVENTOS_DE_CREDENCIALES = ['credencial.por_expirar', 'sincronizar_completo'] as const

export function VistaDeCredenciales({
  credencialAbierta,
  navegar,
}: {
  credencialAbierta: string | null
  navegar: Navegar
}) {
  const lectura = useLectura<Credencial[]>('/v1/credentials', {
    relerEn: EVENTOS_DE_CREDENCIALES,
  })
  const capacidades = useLectura<Capacidades>('/v1/capabilities')
  // Los proyectos, para que conceder un grant sea elegir y no teclear un
  // `prj_...` que no esta escrito en ninguna pantalla.
  const proyectos = useLectura<Proyecto[]>('/v1/projects')
  const opciones = useOpciones()
  const mutacion = useMutacion()

  // La vista inversa se pide SOLO de la credencial abierta. Pedir el alcance
  // de las cuarenta del inventario para pintar un contador seria cuarenta
  // consultas por render de una pantalla que casi siempre se mira entera.
  const alcance = useLectura<AlcanceDeCredencial>(
    credencialAbierta ? `/v1/credentials/${credencialAbierta}/reach` : null,
  )

  // `Date.now()` solo despues de hidratar, como en `vista-catalogo.tsx`:
  // leerlo en el render haria que el HTML prerenderizado y el primer render
  // del cliente no coincidan. Hasta entonces, `Instante` pinta el absoluto,
  // que es correcto aunque sea menos comodo.
  const [ahora, setAhora] = useState(0)
  useEffect(() => {
    setAhora(Date.now())
  }, [])

  const registrar = async (credencial: Partial<Credencial> & { valor: string }) => {
    await mutacion.enviar('POST', '/v1/credentials', credencial)
    lectura.releer()
  }

  const rotar = async (credencial: Credencial, valor: string) => {
    await mutacion.enviar('POST', `/v1/credentials/${credencial.id}/rotate`, { valor })
    lectura.releer()
    alcance.releer()
  }

  const revocar = async (credencial: Credencial) => {
    await mutacion.enviar('DELETE', `/v1/credentials/${credencial.id}`)
    lectura.releer()
    alcance.releer()
  }

  const revocarGrant = async (grantId: string) => {
    await mutacion.enviar('DELETE', `/v1/grants/${grantId}`)
    alcance.releer()
  }

  const concederGrant = async (
    credencial: Credencial,
    proyecto: string,
    agente: string,
    hasta: string,
  ) => {
    await mutacion.enviar('POST', '/v1/grants', {
      project_id: proyecto,
      agent_id: agente,
      credential_id: credencial.id,
      ...(hasta ? { vigencia_hasta: hasta } : {}),
    })
    alcance.releer()
  }

  return (
    <PanelDeCredenciales
      credenciales={lectura.datos ?? []}
      seleccionada={credencialAbierta}
      alSeleccionar={(id) => navegar({ seccion: 'credenciales', id })}
      alcance={alcance}
      proyectos={proyectos.datos ?? []}
      tipos={opciones.grupoDe(GRUPO.tipoDeCredencial)}
      ambitos={opciones.grupoDe(GRUPO.ambitoDeCredencial)}
      cargandoOpciones={opciones.catalogo === null && opciones.lectura.error === null}
      capacidades={capacidades.datos}
      ahora={ahora}
      cargando={lectura.datos === null && lectura.error === null}
      error={lectura.error}
      errorDeMutacion={mutacion.error}
      trabajando={mutacion.trabajando}
      alRegistrar={(credencial) => void registrar(credencial)}
      alRotar={(credencial, valor) => void rotar(credencial, valor)}
      alRevocar={(credencial) => void revocar(credencial)}
      alRevocarGrant={(grantId) => void revocarGrant(grantId)}
      alConcederGrant={(credencial, proyecto, agente, hasta) =>
        void concederGrant(credencial, proyecto, agente, hasta)
      }
      navegar={navegar}
    />
  )
}
