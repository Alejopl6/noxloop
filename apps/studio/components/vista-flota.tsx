'use client'

import { useMemo, useState } from 'react'
import { Bot, KeyRound, Plus, Rocket, Trash2 } from 'lucide-react'

import { Badge, type TonoDeBadge } from '@/components/ui/insignia'
import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { Description, ListaDeDescripciones } from '@/components/ui/descripcion'
import { EmptyState } from '@/components/ui/estado-vacio'
import { Entity, ListaDeEntidades } from '@/components/ui/entidad'
import {
  ErrorText,
  Fieldset,
  FieldsetContent,
  FieldsetFooter,
  WarningText,
} from '@/components/ui/fieldset'
import { ModalDeAccionDestructiva } from '@/components/ui/modal-de-accion-destructiva'
import { Note } from '@/components/ui/nota'
import { Seleccion } from '@/components/ui/seleccion'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { VistaJSON } from '@/components/ui/vista-json'
import {
  Encabezado,
  EsqueletoDeLista,
  FalloDeLectura,
  estaCargandoPorPrimeraVez,
} from '@/components/pantalla'
import { useLectura, type Lectura } from '@/lib/lectura'
import { useMutacion } from '@/lib/mutacion'
import {
  conElValorActual,
  descripcionDe,
  etiquetaDe,
  useOpciones,
} from '@/lib/opciones'
import { contiene } from '@/lib/texto'
import type { ErrorDelServicio } from '@/lib/daemon'
import {
  ETIQUETA_ESTADO_CREDENCIAL,
  GRUPO,
  type Agente,
  type AlcanceDeAgente,
  type GrupoDeOpciones,
  type Proyecto,
  type RolDeAgente,
} from '@/lib/tipos'
import type { Navegar } from '@/lib/ruta'
import { explicarTdd } from '@/lib/tdd'

/**
 * T188 · La flota del proyecto (etapa 07) y la activacion.
 *
 * LA REGLA QUE ESTA PANTALLA SOSTIENE, Y NO ES ADORNO (FR-034): el revisor no
 * puede compartir runtime con el implementador. Si el revisor corre el mismo
 * runtime con el mismo contexto que quien implemento, la revision tiende a
 * confirmar en lugar de romper — no es una segunda opinion, es la primera
 * repetida, con el coste de dos y la confianza de una.
 *
 * SE VALIDA AL GUARDAR, NO AL EJECUTAR. Un error de configuracion descubierto
 * a mitad de un run cuesta el run entero: el implementador ya escribio, el
 * revisor ya aprobo, y lo que hay que tirar es todo. Por eso el servicio
 * rechaza `POST /v1/agents`, `PATCH /v1/agents/:id` y `POST
 * /v1/projects/:id/activate` con `revisor_comparte_runtime`, y por eso esta
 * pantalla lo pinta con su accion —un boton que abre al revisor que choca— y
 * no como un parrafo rojo que deja al operador buscando cual de los seis es.
 *
 * QUIEN DECIDE SIGUE SIENDO EL SERVICIO. Esta pantalla avisa antes de guardar
 * porque descubrir el choque despues de rellenar nueve campos es una perdida
 * de tiempo evitable, pero NO apaga el boton: la interfaz no es el escritor y
 * una regla duplicada en el cliente es una regla que puede divergir en
 * silencio. El aviso se calcula con la misma comparacion que hace el servicio
 * —igualdad exacta del runtime— para que no avise de choques que el servicio
 * no ve ni se calle los que si.
 *
 * LA OTRA MITAD DE LA VISTA INVERSA (FR-045). En `vista-credenciales.tsx` se
 * pregunta "quien alcanza esta credencial"; aqui, "que alcanza este agente".
 * Es la misma consulta con el criterio girado, y las dos pantallas se enlazan
 * porque la respuesta a una lleva siempre a la otra: el operador que ve que un
 * agente alcanza un token de despliegue quiere saber a continuacion quien mas
 * lo alcanza.
 */

/* -------------------------------------------------------------------------- */
/* Conversiones entre el formulario y el contrato                             */
/* -------------------------------------------------------------------------- */

/**
 * El borrador es TODO texto, tambien lo que el contrato tipa como lista o como
 * objeto. No es pereza: un campo de texto solo sabe guardar texto, y mantener
 * el borrador a medio parsear obliga a decidir que hacer con `{"a":` mientras
 * el operador todavia esta escribiendo la llave de cierre. Se parsea al
 * guardar, una vez, y el fallo se pinta en el campo que lo produjo.
 */
export interface BorradorDeAgente {
  nombre: string
  rol: RolDeAgente
  runtime: string
  modelo: string
  skills: string
  tools: string
  mcps: string
  permisos: string
  presupuesto: string
  contexto: string
}

const BORRADOR_VACIO: BorradorDeAgente = {
  nombre: '',
  rol: 'implementador',
  runtime: '',
  modelo: '',
  skills: '',
  tools: '',
  mcps: '',
  permisos: '',
  presupuesto: '',
  contexto: '',
}

function comoTexto(lista: string[] | undefined): string {
  return (lista ?? []).join(', ')
}

function comoLista(texto: string): string[] {
  return texto
    .split(',')
    .map((parte) => parte.trim())
    .filter((parte) => parte.length > 0)
}

function comoTextoJSON(objeto: Record<string, unknown> | undefined): string {
  if (!objeto || Object.keys(objeto).length === 0) return ''
  return JSON.stringify(objeto, null, 2)
}

export function borradorDesdeAgente(agente: Agente): BorradorDeAgente {
  return {
    nombre: agente.nombre,
    rol: agente.rol,
    runtime: agente.runtime,
    modelo: agente.modelo ?? '',
    skills: comoTexto(agente.skills),
    tools: comoTexto(agente.tools),
    mcps: comoTexto(agente.mcps),
    permisos: comoTextoJSON(agente.permisos),
    presupuesto: comoTextoJSON(agente.presupuesto),
    contexto: comoTextoJSON(agente.contexto),
  }
}

type Analisis =
  | { ok: true; valor: Record<string, unknown> | undefined }
  | { ok: false; causa: string }

/**
 * Permisos, presupuesto y contexto llegan al servicio como objetos libres.
 *
 * EL CONTRATO NO DECLARA SU FORMA: `data-model.md` y `control-api.md` dicen
 * "permisos, presupuesto y contexto" y nada mas. Esta pantalla no se inventa
 * un esquema —campos con nombre que el servicio no promete acabarian siendo la
 * forma de facto, decidida por la interfaz— asi que pide el objeto tal cual y
 * se limita a comprobar que es un objeto antes de mandarlo. El fallo que eso
 * evita es concreto: un `400 cuerpo_invalido` del servicio despues de rellenar
 * nueve campos, sin decir cual de los tres estaba mal escrito.
 */
function analizarObjeto(texto: string, campo: string): Analisis {
  const limpio = texto.trim()
  if (limpio.length === 0) return { ok: true, valor: undefined }

  let analizado: unknown
  try {
    analizado = JSON.parse(limpio)
  } catch (fallo: unknown) {
    const detalle = fallo instanceof Error ? fallo.message : String(fallo)
    return {
      ok: false,
      causa: `El campo ${campo} no se pudo leer como JSON: ${detalle}. Escribe un objeto entre llaves, o dejalo vacio para no declarar ninguno.`,
    }
  }

  if (analizado === null || typeof analizado !== 'object' || Array.isArray(analizado)) {
    return {
      ok: false,
      causa: `El campo ${campo} tiene que ser un objeto entre llaves y llego como ${
        Array.isArray(analizado) ? 'una lista' : typeof analizado
      }. Envuelvelo en un objeto con la clave que le da sentido, o dejalo vacio.`,
    }
  }

  return { ok: true, valor: analizado as Record<string, unknown> }
}

/* -------------------------------------------------------------------------- */
/* FR-034 · el choque de runtime                                              */
/* -------------------------------------------------------------------------- */

export interface ChoqueDeRuntime {
  runtime: string
  implementador: Agente
  revisor: Agente
}

/**
 * Que revisores comparten runtime con que implementadores, HOY.
 *
 * La comparacion es igualdad exacta del runtime, la misma que hace el servicio
 * al activar. Normalizar aqui (recortar, bajar a minusculas) haria que esta
 * pantalla avisara de choques que el servicio no ve, y peor: que se callara
 * ante dos runtimes que el servicio si considera iguales.
 */
export function choquesDeRuntime(agentes: Agente[]): ChoqueDeRuntime[] {
  const implementadores = agentes.filter((agente) => agente.rol === 'implementador')
  const choques: ChoqueDeRuntime[] = []

  for (const revisor of agentes.filter((agente) => agente.rol === 'revisor')) {
    const choca = implementadores.find((agente) => agente.runtime === revisor.runtime)
    if (choca) choques.push({ runtime: revisor.runtime, implementador: choca, revisor })
  }

  return choques
}

/** El mismo calculo sobre un borrador que todavia no existe en la flota. */
function choqueDelBorrador(
  agentes: Agente[],
  borrador: BorradorDeAgente,
  editando: string | null,
): Agente | null {
  const runtime = borrador.runtime.trim()
  if (runtime.length === 0) return null

  // La regla solo habla de esos dos roles. Un planificador y un verificador
  // pueden compartir runtime con quien sea: no revisan a nadie.
  if (borrador.rol !== 'revisor' && borrador.rol !== 'implementador') return null
  const contrario: RolDeAgente = borrador.rol === 'revisor' ? 'implementador' : 'revisor'

  return (
    agentes.find(
      (agente) =>
        agente.id !== editando && agente.rol === contrario && agente.runtime === runtime,
    ) ?? null
  )
}

const TONO_DEL_ROL: Record<RolDeAgente, TonoDeBadge> = {
  planificador: 'neutral',
  implementador: 'informativo',
  revisor: 'informativo',
  verificador: 'neutral',
}

/* -------------------------------------------------------------------------- */
/* El formulario de un agente                                                 */
/* -------------------------------------------------------------------------- */

export function FormularioDeAgente({
  borrador,
  alEditar,
  agentes,
  editando,
  roles,
  runtimes,
  cargandoOpciones = false,
  trabajando,
  error,
  alGuardar,
  alCancelar,
}: {
  borrador: BorradorDeAgente
  alEditar: (borrador: BorradorDeAgente) => void
  /** La flota actual, para anticipar el choque de runtime antes de guardar. */
  agentes: Agente[]
  /** Id del agente que se esta editando, o `null` si es uno nuevo. */
  editando: string | null
  /** `agent.rol` y `agent.runtime` del catalogo del servicio. */
  roles: GrupoDeOpciones
  runtimes: GrupoDeOpciones
  cargandoOpciones?: boolean
  trabajando: boolean
  error: ErrorDelServicio | null
  alGuardar: (cuerpo: Partial<Agente>) => void
  alCancelar: () => void
}) {
  const [falloLocal, setFalloLocal] = useState<Record<string, string>>({})

  // LOS MODELOS SALEN DEL RUNTIME ELEGIDO, cuando ese runtime los enumera.
  // `models: "desconocido"` es una respuesta LEGITIMA del contrato de
  // adaptadores —los modelos que acepta cambian sin que este repositorio se
  // entere— y entonces el campo sigue siendo texto libre y se dice por que.
  // Una lista corta inventada aqui haria que la pantalla ofreciera solo esos,
  // que es peor que decir que no se sabe.
  const runtimeElegido = runtimes.opciones.find((o) => o.valor === borrador.runtime) ?? null
  const modelos: GrupoDeOpciones = {
    opciones: (runtimeElegido?.modelos ?? []).map((modelo) => ({ valor: modelo, etiqueta: modelo })),
    unica: (runtimeElegido?.modelos ?? []).length === 1,
    origen: 'detectado',
    porque: `son los modelos que el runtime \`${borrador.runtime}\` enumera en sus capacidades.`,
    preseleccion: null,
  }
  const modeloEsLibre = !runtimeElegido || runtimeElegido.modelos_enumerados !== true

  const cambiar = <C extends keyof BorradorDeAgente>(campo: C, valor: BorradorDeAgente[C]) => {
    alEditar({ ...borrador, [campo]: valor })
  }

  const choca = choqueDelBorrador(agentes, borrador, editando)

  const guardar = () => {
    const permisos = analizarObjeto(borrador.permisos, 'Permisos')
    const presupuesto = analizarObjeto(borrador.presupuesto, 'Presupuesto')
    const contexto = analizarObjeto(borrador.contexto, 'Contexto')

    const fallos: Record<string, string> = {}
    if (!permisos.ok) fallos.permisos = permisos.causa
    if (!presupuesto.ok) fallos.presupuesto = presupuesto.causa
    if (!contexto.ok) fallos.contexto = contexto.causa
    setFalloLocal(fallos)
    if (!permisos.ok || !presupuesto.ok || !contexto.ok) return

    alGuardar({
      nombre: borrador.nombre.trim(),
      rol: borrador.rol,
      runtime: borrador.runtime.trim(),
      modelo: borrador.modelo.trim(),
      skills: comoLista(borrador.skills),
      tools: comoLista(borrador.tools),
      mcps: comoLista(borrador.mcps),
      permisos: permisos.valor,
      presupuesto: presupuesto.valor,
      contexto: contexto.valor,
    })
  }

  const listo =
    borrador.nombre.trim().length > 0 &&
    borrador.runtime.trim().length > 0 &&
    borrador.modelo.trim().length > 0

  return (
    <Fieldset>
      <FieldsetContent
        titulo={editando ? 'Editar el agente' : 'Declarar un agente'}
        descripcion="Rol, runtime, modelo, skills, tools, servidores MCP, permisos, presupuesto y contexto. Lo que no se declara aqui el agente no lo tiene: no hay valores por defecto que se hereden en silencio."
      >
        <div className="flex flex-col gap-5">
          {/* LOS CUATRO ROLES Y LO QUE DECIDE CADA UNO YA NO ESTAN ESCRITOS EN
              ESTA INTERFAZ. Estaban en `lib/tipos.ts`, y el parrafo de cada rol
              con ellos — o sea, esta pantalla explicaba una regla del dominio
              (FR-034: el revisor no comparte runtime con el implementador) que
              sostiene el servicio. El dia que la regla cambiara alla, aqui
              seguiria escrita la de ayer. */}
          <Seleccion
            etiqueta="Rol del agente"
            grupo={roles}
            valor={borrador.rol}
            alCambiar={(valor) => cambiar('rol', valor as RolDeAgente)}
            cargando={cargandoOpciones}
            requerido
            className="max-w-md"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              etiqueta="Nombre"
              valor={borrador.nombre}
              alCambiar={(valor) => cambiar('nombre', valor)}
              requerido
              marcador="implementador de backend"
              ayuda="Como lo vas a reconocer en la bandeja y en la auditoria. Es el nombre que aparece cuando este agente pide permiso para algo."
            />
            {/* ERA UN CAMPO DE TEXTO cuya ayuda decia, literalmente, «este
                servicio declara en /v1/capabilities: claude-agent-sdk, codex».
                La lista estaba en la misma frase que pedia teclearla. Un
                `claude-agent` sin el sufijo se guarda sin error y el agente
                queda con un runtime que ningun adaptador atiende — y eso no se
                descubre hasta el primer ciclo. */}
            <Seleccion
              etiqueta="Runtime"
              grupo={runtimes}
              opciones={conElValorActual(runtimes, borrador.runtime)}
              valor={borrador.runtime}
              alCambiar={(valor) => {
                cambiar('runtime', valor)
              }}
              cargando={cargandoOpciones}
              requerido
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* SELECT SOLO CUANDO EL RUNTIME ENUMERA SUS MODELOS. El contrato
                de adaptadores admite `models: "desconocido"` como respuesta
                honesta —los modelos cambian sin que este repositorio se
                entere— y ahi el campo sigue siendo libre. Convertirlo igualmente
                en desplegable obligaria a inventar la lista, y el operador
                elegiria de entre unos modelos que nadie verifico. */}
            {modeloEsLibre ? (
              <Campo
                etiqueta="Modelo"
                valor={borrador.modelo}
                alCambiar={(valor) => cambiar('modelo', valor)}
                operativo
                requerido
                marcador="modelo-de-referencia"
                // TRES MOTIVOS DISTINTOS PARA EL MISMO CAMPO LIBRE, y decir
                // el que no es seria afirmar algo falso sobre el runtime del
                // operador. La primera version decia siempre «declara models:
                // "desconocido"», tambien cuando el servicio no conocia ese
                // runtime en absoluto — se vio en el HTML generado, con un
                // agente guardado sobre un runtime que ya no esta registrado.
                ayuda={
                  !borrador.runtime
                    ? 'Elige primero el runtime: son sus capacidades las que dicen si enumera modelos o no.'
                    : !runtimeElegido
                      ? `Este servicio no tiene registrado el runtime ${borrador.runtime}, asi que no puede decir que modelos acepta. Escribe el que uses; cuando el adaptador este montado, la lista sale sola.`
                      : `El runtime ${borrador.runtime} no enumera los modelos que acepta —declara models: "desconocido"— asi que esta interfaz no ofrece una lista: la inventaria. Dos agentes con el mismo runtime y distinto modelo siguen compartiendo runtime a efectos de la regla de revision.`
                }
              />
            ) : (
              <Seleccion
                etiqueta="Modelo"
                grupo={modelos}
                opciones={conElValorActual(modelos, borrador.modelo)}
                valor={borrador.modelo}
                alCambiar={(valor) => cambiar('modelo', valor)}
                requerido
                ayuda="Dos agentes con el mismo runtime y distinto modelo siguen compartiendo runtime a efectos de la regla de revision."
              />
            )}
            <Campo
              etiqueta="Skills"
              valor={borrador.skills}
              alCambiar={(valor) => cambiar('skills', valor)}
              operativo
              marcador="testing, migraciones"
              ayuda="Separadas por comas."
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              etiqueta="Tools"
              valor={borrador.tools}
              alCambiar={(valor) => cambiar('tools', valor)}
              operativo
              marcador="leer, escribir, ejecutar"
              ayuda="Separadas por comas. Las de alto impacto llegan desactivadas por defecto y solo se elevan con politica explicita."
            />
            <Campo
              etiqueta="Servidores MCP"
              valor={borrador.mcps}
              alCambiar={(valor) => cambiar('mcps', valor)}
              operativo
              marcador="gestor-de-tickets, buscador"
              ayuda="Separados por comas. Lo que devuelva un servidor MCP entra como dato, nunca como instruccion ejecutable."
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Campo
              etiqueta="Permisos"
              valor={borrador.permisos}
              alCambiar={(valor) => cambiar('permisos', valor)}
              operativo
              multilinea
              filas={5}
              marcador={'{\n  "escritura": false\n}'}
              error={falloLocal.permisos}
              ayuda="Objeto JSON. El contrato no fija sus claves, asi que esta pantalla no se inventa un formulario: pide el objeto y comprueba que lo es."
            />
            <Campo
              etiqueta="Presupuesto"
              valor={borrador.presupuesto}
              alCambiar={(valor) => cambiar('presupuesto', valor)}
              operativo
              multilinea
              filas={5}
              marcador={'{\n  "usd": 5\n}'}
              error={falloLocal.presupuesto}
              ayuda="Objeto JSON. Un agente sin presupuesto declarado no es un agente sin tope: es un agente cuyo tope decide el motor, y esta pantalla no lo sabe."
            />
            <Campo
              etiqueta="Contexto"
              valor={borrador.contexto}
              alCambiar={(valor) => cambiar('contexto', valor)}
              operativo
              multilinea
              filas={5}
              marcador={'{\n  "incluye_transcript": false\n}'}
              error={falloLocal.contexto}
              ayuda="Objeto JSON. Es lo que se le compila al agente antes de arrancar. Darle al revisor el transcript del implementador es la otra forma de romper la revision cruzada."
            />
          </div>

          {/* El aviso ANTES de guardar. El servicio sigue siendo quien decide;
              esto solo evita descubrirlo despues de rellenar nueve campos. */}
          {choca ? (
            <WarningText>
              {borrador.rol === 'revisor'
                ? `El implementador «${choca.nombre}» ya corre sobre el runtime ${choca.runtime}. Guardar este revisor con el mismo runtime lo va a rechazar el servicio con revisor_comparte_runtime: una revision hecha por el mismo runtime que escribio el codigo aprueba sus propios puntos ciegos.`
                : `El revisor «${choca.nombre}» ya corre sobre el runtime ${choca.runtime}. Guardar este implementador con el mismo runtime lo va a rechazar el servicio con revisor_comparte_runtime. Cambia uno de los dos.`}
            </WarningText>
          ) : null}

          {error ? <ErrorText causa={error.causa} accion={error.accion} /> : null}
        </div>
      </FieldsetContent>

      <FieldsetFooter nota="La flota se guarda en el servicio, que es el unico escritor. Esta pantalla no toca el disco ni el almacen.">
        <Button variant="secondary" onClick={alCancelar} disabled={trabajando}>
          Cancelar
        </Button>
        <Button onClick={guardar} disabled={trabajando || !listo}>
          {trabajando ? <Spinner tamano="sm" etiqueta="Guardando" /> : null}
          {editando ? 'Guardar cambios' : 'Declarar agente'}
        </Button>
      </FieldsetFooter>
    </Fieldset>
  )
}

/* -------------------------------------------------------------------------- */
/* Que alcanza este agente · la vista inversa girada (FR-045)                 */
/* -------------------------------------------------------------------------- */

export function QueAlcanzaElAgente({
  agente,
  alcance,
  navegar,
}: {
  agente: Agente
  alcance: Lectura<AlcanceDeAgente>
  navegar: Navegar
}) {
  const credenciales = alcance.datos?.credenciales ?? []
  const cargando = estaCargandoPorPrimeraVez(alcance)

  return (
    <section aria-labelledby="titulo-alcance-agente" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 id="titulo-alcance-agente" className="text-heading-16 text-ds-gray-1000">
          Que alcanza este agente hoy
        </h3>
        <p className="text-copy-13 text-ds-gray-900">
          La otra mitad de la vista inversa: en Credenciales se pregunta quien alcanza un
          secreto, y aqui que secretos alcanza un agente. Son los grants VIGENTES, no las
          filas de la tabla — lo revocado y lo caducado no aparece porque no alcanza nada.
        </p>
      </div>

      {cargando ? <EsqueletoDeLista filas={2} /> : null}

      {!cargando && credenciales.length === 0 ? (
        <EmptyState
          modo={alcance.error ? 'error' : 'primero'}
          tamano="compacto"
          titulo={
            alcance.error ? 'No Se Pudo Calcular El Alcance' : 'Este Agente No Alcanza Nada'
          }
          descripcion={
            alcance.error
              ? alcance.error.causa
              : `«${agente.nombre}» no tiene ningun grant vigente. No existe el grant implicito: una tarea suya que necesite una credencial se bloquea con causa textual y entra en la bandeja. Denegar por defecto es el comportamiento, no un fallo.`
          }
          accion={
            alcance.error ? null : (
              <Button
                variant="secondary"
                onClick={() => navegar({ seccion: 'credenciales', id: null })}
              >
                Conceder un grant desde Credenciales
              </Button>
            )
          }
        />
      ) : null}

      {credenciales.length > 0 ? (
        <ListaDeEntidades etiqueta={`Credenciales que alcanza ${agente.nombre}`}>
          {credenciales.map((credencial) => (
            <Entity
              key={credencial.grant_id}
              contenedor="li"
              miniatura={<KeyRound />}
              titulo={credencial.nombre}
              identificador={credencial.huella ?? credencial.credential_id}
              descripcion={
                <>
                  {credencial.alcance_declarado ??
                    'Sin alcance declarado en la respuesta del servicio.'}
                  {credencial.vigencia_hasta
                    ? ` El grant vence el ${credencial.vigencia_hasta}.`
                    : ' El grant no tiene fecha de vencimiento.'}
                  {credencial.concedido_por ? ` Lo concedio ${credencial.concedido_por}.` : null}
                </>
              }
              metadatos={
                <>
                  {credencial.estado ? (
                    <Badge tono={credencial.estado === 'activa' ? 'exito' : 'advertencia'}>
                      {ETIQUETA_ESTADO_CREDENCIAL[credencial.estado]}
                    </Badge>
                  ) : null}
                  {credencial.proveedor ? (
                    <span className="text-label-12 text-ds-gray-700">
                      {credencial.proveedor}
                    </span>
                  ) : null}
                  <span className="fuente-operativa text-label-12 text-ds-gray-700">
                    {credencial.grant_id}
                  </span>
                </>
              }
              acciones={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    navegar({ seccion: 'credenciales', id: credencial.credential_id })
                  }
                >
                  Quien mas la alcanza
                </Button>
              }
            />
          ))}
        </ListaDeEntidades>
      ) : null}

      {credenciales.length > 0 ? (
        <>
          <p className="text-label-12 text-ds-gray-700">
            {credenciales.length} {credenciales.length === 1 ? 'credencial' : 'credenciales'}{' '}
            alcanzables por este agente.
            {alcance.datos?.calculado ? ` Calculado el ${alcance.datos.calculado}.` : null} Revocar
            un grant se hace desde la credencial, que es donde se ve el efecto completo.
          </p>
          <FalloDeLectura error={alcance.error} />
        </>
      ) : null}
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/* El detalle de un agente                                                    */
/* -------------------------------------------------------------------------- */

function DetalleDeAgente({
  agente,
  alcance,
  roles,
  navegar,
  alEditar,
  alQuitar,
  trabajando,
}: {
  agente: Agente
  alcance: Lectura<AlcanceDeAgente>
  /** Para traducir el `rol` guardado a su etiqueta y a lo que decide. */
  roles: GrupoDeOpciones
  navegar: Navegar
  alEditar: () => void
  alQuitar: () => void
  trabajando: boolean
}) {
  return (
    <div className="flex flex-col gap-6 border-l-2 border-ds-gray-400 pl-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-heading-20 text-ds-gray-1000">{agente.nombre}</h2>
        <span className="fuente-operativa text-label-12 text-ds-gray-700">{agente.id}</span>
        <Badge tono={TONO_DEL_ROL[agente.rol]}>{etiquetaDe(roles, agente.rol)}</Badge>
      </div>

      {descripcionDe(roles, agente.rol) ? (
        <p className="max-w-2xl text-copy-14 text-ds-gray-900">
          {descripcionDe(roles, agente.rol)}
        </p>
      ) : null}

      <ListaDeDescripciones>
        <Description titulo="Runtime" contenido={agente.runtime} operativo />
        {/* Como se fuerza su test-primero (spec 005, FR-008): por hook, por el
            motor despues de la fase, o nadie. Ver `lib/tdd.ts`. */}
        <Description titulo="TDD" contenido={explicarTdd(agente.tdd).etiqueta} nota={explicarTdd(agente.tdd).frase} />
        <Description titulo="Modelo" contenido={agente.modelo} operativo />
        <Description
          titulo="Skills"
          contenido={comoTexto(agente.skills) || undefined}
          nota="Lo que sabe hacer, declarado."
        />
        <Description
          titulo="Tools"
          contenido={comoTexto(agente.tools) || undefined}
          nota="Lo que puede ejecutar. Sin declarar, nada."
        />
        <Description
          titulo="Servidores MCP"
          contenido={comoTexto(agente.mcps) || undefined}
          nota="Lo que devuelven entra como dato, nunca como instruccion."
        />
      </ListaDeDescripciones>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-2">
          <h3 className="text-label-13 text-ds-gray-1000">Permisos</h3>
          <VistaJSON valor={agente.permisos ?? null} etiqueta="Permisos del agente" />
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-label-13 text-ds-gray-1000">Presupuesto</h3>
          <VistaJSON valor={agente.presupuesto ?? null} etiqueta="Presupuesto del agente" />
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-label-13 text-ds-gray-1000">Contexto</h3>
          <VistaJSON valor={agente.contexto ?? null} etiqueta="Contexto del agente" />
        </div>
      </div>

      <QueAlcanzaElAgente agente={agente} alcance={alcance} navegar={navegar} />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={alEditar} disabled={trabajando}>
          Editar agente
        </Button>
        <Button variant="destructive" onClick={alQuitar} disabled={trabajando}>
          <Trash2 />
          Quitar de la flota
        </Button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* El panel                                                                   */
/* -------------------------------------------------------------------------- */

export interface PropsDePanelDeFlota {
  proyectoId: string
  /** El proyecto, para saber si ya esta activo. `null` mientras no se conoce. */
  proyecto: Proyecto | null
  agentes: Agente[]
  seleccionado: string | null
  alSeleccionar: (id: string | null) => void
  /** Los grants vigentes del agente abierto. */
  alcance: Lectura<AlcanceDeAgente>
  /** `agent.rol` y `agent.runtime` del catalogo del servicio. */
  roles: GrupoDeOpciones
  runtimes: GrupoDeOpciones
  cargandoOpciones?: boolean
  cargando: boolean
  error: ErrorDelServicio | null
  errorDeMutacion: ErrorDelServicio | null
  trabajando: boolean
  alGuardar: (cuerpo: Partial<Agente>, agenteId: string | null) => void
  alQuitar: (agente: Agente) => void
  alActivar: () => void
  navegar: Navegar
}

export function PanelDeFlota({
  proyectoId,
  proyecto,
  agentes,
  seleccionado,
  alSeleccionar,
  alcance,
  roles,
  runtimes,
  cargandoOpciones = false,
  cargando,
  error,
  errorDeMutacion,
  trabajando,
  alGuardar,
  alQuitar,
  alActivar,
  navegar,
}: PropsDePanelDeFlota) {
  const [consulta, setConsulta] = useState('')
  const [editando, setEditando] = useState<string | null>(null)
  const [abierto, setAbierto] = useState(false)
  const [borrador, setBorrador] = useState<BorradorDeAgente>(BORRADOR_VACIO)
  const [porQuitar, setPorQuitar] = useState<Agente | null>(null)

  const filtrados = useMemo(
    () =>
      agentes.filter((agente) =>
        contiene(`${agente.nombre} ${agente.runtime} ${agente.modelo ?? ''}`, consulta),
      ),
    [agentes, consulta],
  )

  const detalle = agentes.find((agente) => agente.id === seleccionado) ?? null
  const choques = choquesDeRuntime(agentes)
  const activo = proyecto?.estado === 'ACTIVE'

  const abrirNuevo = () => {
    setBorrador(BORRADOR_VACIO)
    setEditando(null)
    setAbierto(true)
  }

  const abrirEdicion = (agente: Agente) => {
    setBorrador(borradorDesdeAgente(agente))
    setEditando(agente.id)
    setAbierto(true)
  }

  return (
    <div className="flex flex-col gap-8">
      <Encabezado
        titulo="Flota"
        identificador={proyectoId}
        descripcion="Que agentes existen para este proyecto y con que corre cada uno. Es la ultima etapa del establecimiento: sin flota declarada no hay a quien entregarle un ciclo."
        volver={{ ruta: { seccion: 'proyectos', id: null }, etiqueta: 'Proyectos' }}
        navegar={navegar}
        acciones={
          <>
            <Button
              variant="secondary"
              onClick={() => navegar({ seccion: 'credenciales', id: null })}
            >
              Credenciales
            </Button>
            <Button onClick={abrirNuevo}>
              <Plus />
              Declarar agente
            </Button>
          </>
        }
      />

      {/* FR-034 sobre la flota YA GUARDADA. Va arriba porque es lo que impide
          activar, y descubrirlo al pulsar "Activar" manda al operador a buscar
          cual de los seis agentes choca. */}
      {choques.length > 0 ? (
        <Note
          tipo="advertencia"
          titulo="Hay un revisor que comparte runtime con un implementador"
          accion={
            <Button variant="secondary" size="sm" onClick={() => abrirEdicion(choques[0].revisor)}>
              Editar a {choques[0].revisor.nombre}
            </Button>
          }
        >
          {choques.map((choque) => (
            <p key={choque.revisor.id}>
              El revisor «{choque.revisor.nombre}» y el implementador «
              {choque.implementador.nombre}» corren los dos sobre{' '}
              <span className="fuente-operativa">{choque.runtime}</span>. Activar el proyecto
              se va a rechazar hasta que cambies uno de los dos: con el mismo runtime, la
              revision confirma lo que el implementador ya decidio en vez de romperlo.
            </p>
          ))}
        </Note>
      ) : null}

      {agentes.length > 6 ? (
        <Campo
          etiqueta="Filtrar"
          valor={consulta}
          alCambiar={setConsulta}
          marcador="nombre, runtime o modelo"
          ayuda="El filtro mira el nombre, el runtime y el modelo. No mira el rol: para eso estan los badges."
          className="max-w-md"
        />
      ) : null}

      {abierto ? (
        <FormularioDeAgente
          borrador={borrador}
          alEditar={setBorrador}
          agentes={agentes}
          editando={editando}
          roles={roles}
          runtimes={runtimes}
          cargandoOpciones={cargandoOpciones}
          trabajando={trabajando}
          error={errorDeMutacion}
          alGuardar={(cuerpo) => {
            alGuardar(cuerpo, editando)
            setAbierto(false)
          }}
          alCancelar={() => setAbierto(false)}
        />
      ) : null}

      {cargando ? <EsqueletoDeLista filas={3} /> : null}

      {!cargando && agentes.length === 0 ? (
        <EmptyState
          modo={error ? 'error' : 'primero'}
          titulo={error ? 'No Se Pudo Cargar La Flota' : 'Sin Flota Declarada'}
          descripcion={
            error
              ? error.causa
              : 'Un proyecto conectado sin flota no puede recibir ciclos: no hay quien planifique, quien implemente ni quien revise. Declara al menos un implementador y un revisor, y que corran sobre runtimes distintos.'
          }
          accion={error ? null : <Button onClick={abrirNuevo}>Declarar agente</Button>}
        />
      ) : null}

      {filtrados.length > 0 ? (
        <ListaDeEntidades etiqueta="Agentes de la flota">
          {filtrados.map((agente) => {
            const choque = choques.find(
              (candidato) =>
                candidato.revisor.id === agente.id || candidato.implementador.id === agente.id,
            )
            return (
              <Entity
                key={agente.id}
                contenedor="li"
                miniatura={<Bot />}
                titulo={agente.nombre}
                identificador={agente.runtime}
                descripcion={descripcionDe(roles, agente.rol)}
                metadatos={
                  <>
                    <Badge tono={TONO_DEL_ROL[agente.rol]}>
                      {etiquetaDe(roles, agente.rol)}
                    </Badge>
                    {agente.modelo ? (
                      <span className="fuente-operativa text-label-12 text-ds-gray-700">
                        {agente.modelo}
                      </span>
                    ) : null}
                    {agente.tdd !== 'no_aplica' ? (
                      // Solo donde dice algo: en un revisor «no aplica» es ruido.
                      <span title={explicarTdd(agente.tdd).frase}>
                        <Badge tono={explicarTdd(agente.tdd).tono}>{explicarTdd(agente.tdd).etiqueta}</Badge>
                      </span>
                    ) : null}
                    {choque ? (
                      <Badge tono="advertencia">Comparte runtime con la revision</Badge>
                    ) : null}
                  </>
                }
                acciones={
                  <Button variant="secondary" size="sm" onClick={() => abrirEdicion(agente)}>
                    Editar
                  </Button>
                }
                alPulsar={() => alSeleccionar(seleccionado === agente.id ? null : agente.id)}
                seleccionada={seleccionado === agente.id}
              />
            )
          })}
        </ListaDeEntidades>
      ) : null}

      {agentes.length > 0 && filtrados.length === 0 ? (
        <EmptyState
          modo="filtrado"
          tamano="compacto"
          titulo="Ningun Agente Coincide"
          consulta={consulta}
          descripcion={`La flota tiene ${agentes.length} agentes declarados.`}
        />
      ) : null}

      {agentes.length > 0 ? <FalloDeLectura error={error} /> : null}

      {detalle ? (
        <DetalleDeAgente
          agente={detalle}
          alcance={alcance}
          roles={roles}
          navegar={navegar}
          alEditar={() => abrirEdicion(detalle)}
          alQuitar={() => setPorQuitar(detalle)}
          trabajando={trabajando}
        />
      ) : null}

      {/* La activacion. Ultimo bloque de la pantalla porque es el ultimo paso
          del establecimiento: con la flota delante, no antes de mirarla. */}
      {activo ? (
        <Note
          tipo="exito"
          titulo="El proyecto ya esta activo"
          accion={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navegar({ seccion: 'board', id: proyectoId })}
            >
              <Rocket />
              Ir al board
            </Button>
          }
        >
          Tiene snapshot aceptado, constitution vigente, setup resuelto, conexiones vivas y
          flota declarada. Editar la flota desde aqui no lo saca de ACTIVE: la maquina de
          estados no retrocede.
        </Note>
      ) : proyecto ? (
        // Solo cuando se sabe en que estado esta. Con `proyecto` a null no se
        // conoce todavia, y ofrecer "Activar" ahi es afirmar que no lo esta:
        // el proyecto puede llevar activo desde ayer y esta pantalla estaria
        // proponiendo una operacion que el servicio va a rechazar.
        <Fieldset>
          <FieldsetContent
            titulo="Activar el proyecto"
            descripcion="Activar es declarar que el establecimiento termino. El servicio comprueba la flota ANTES de mover el estado: si el revisor comparte runtime con el implementador, rechaza con revisor_comparte_runtime y el proyecto se queda donde estaba."
          >
            <p className="text-copy-13 text-ds-gray-900">
              Se valida al guardar y no al ejecutar a proposito: un error de configuracion
              descubierto a mitad de un run cuesta el run entero — el implementador ya
              escribio, el revisor ya aprobo, y lo que hay que tirar es todo.
            </p>

            {/* El rechazo del servicio, pintado con su accion y con el boton que
                lleva al agente concreto. Un mensaje que dice "el revisor comparte
                runtime" sin decir cual deja al operador abriendo agentes uno a uno. */}
            {errorDeMutacion && !abierto ? (
              <Note
                tipo="error"
                titulo="El servicio rechazo la ultima operacion sobre la flota"
                accion={
                  errorDeMutacion.codigo === 'revisor_comparte_runtime' && choques.length > 0 ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => abrirEdicion(choques[0].revisor)}
                    >
                      Cambiar el runtime de {choques[0].revisor.nombre}
                    </Button>
                  ) : null
                }
              >
                <span className="flex flex-col gap-1">
                  <span>{errorDeMutacion.causa}</span>
                  <span className="text-ds-gray-1000">{errorDeMutacion.accion}</span>
                </span>
              </Note>
            ) : null}
          </FieldsetContent>

          <FieldsetFooter nota="El estado del proyecto lo mueve el servicio. Esta pantalla lo pide y pinta lo que conteste.">
            <Button onClick={alActivar} disabled={trabajando || agentes.length === 0}>
              {trabajando ? <Spinner tamano="sm" etiqueta="Activando" /> : null}
              Activar proyecto
            </Button>
          </FieldsetFooter>
        </Fieldset>
      ) : null}

      <ModalDeAccionDestructiva
        abierto={porQuitar !== null}
        alCerrar={() => setPorQuitar(null)}
        titulo="Quitar agente de la flota"
        recurso={porQuitar?.nombre ?? ''}
        claseDeRecurso="el agente"
        consecuencias={
          <>
            Sus grants se van con el: las credenciales que alcanzaba dejan de estar
            autorizadas para este agente y no se reasignan a nadie. Si era el unico
            implementador o el unico revisor, el proyecto se queda sin poder cubrir ese rol
            y un ciclo lanzado despues se bloquea con causa textual. La baja queda en el
            registro de auditoria, que esta aplicacion no puede editar ni borrar.
          </>
        }
        etiquetaDeConfirmacion="Quitar agente"
        trabajando={trabajando}
        error={
          errorDeMutacion
            ? { causa: errorDeMutacion.causa, accion: errorDeMutacion.accion }
            : null
        }
        alConfirmar={() => {
          if (porQuitar) alQuitar(porQuitar)
          setPorQuitar(null)
        }}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* El contenedor                                                              */
/* -------------------------------------------------------------------------- */

const EVENTOS_DE_FLOTA = ['proyecto.estado', 'sincronizar_completo'] as const

export function VistaDeFlota({
  proyectoId,
  navegar,
}: {
  proyectoId: string
  navegar: Navegar
}) {
  const lectura = useLectura<Agente[]>(`/v1/projects/${proyectoId}/agents`, {
    relerEn: EVENTOS_DE_FLOTA,
  })
  const proyecto = useLectura<Proyecto>(`/v1/projects/${proyectoId}`, {
    relerEn: EVENTOS_DE_FLOTA,
  })
  // EL CATALOGO DE OPCIONES SUSTITUYE A `/v1/capabilities` AQUI. Esta pantalla
  // lo pedia solo para sacar la lista de runtimes de `capacidades.runtimes` y
  // escribirla en la AYUDA de un campo de texto. `/v1/options` la trae con lo
  // que cada runtime puede y no puede —si tiene hooks, si reporta gasto, si
  // retoma sesion— que es lo que hace que elegir uno sea una decision y no una
  // apuesta.
  const opciones = useOpciones(proyectoId)
  const mutacion = useMutacion()

  const [seleccionado, setSeleccionado] = useState<string | null>(null)

  // Los grants se piden SOLO del agente abierto, por lo mismo que la vista
  // inversa de credenciales: pedir el alcance de los seis para pintar un
  // contador son seis consultas por render de una pantalla que se mira entera.
  const alcance = useLectura<AlcanceDeAgente>(
    seleccionado ? `/v1/grants?agent_id=${encodeURIComponent(seleccionado)}` : null,
  )

  const guardar = async (cuerpo: Partial<Agente>, agenteId: string | null) => {
    if (agenteId) await mutacion.enviar('PATCH', `/v1/agents/${agenteId}`, cuerpo)
    else await mutacion.enviar('POST', `/v1/projects/${proyectoId}/agents`, cuerpo)
    lectura.releer()
  }

  const quitar = async (agente: Agente) => {
    await mutacion.enviar('DELETE', `/v1/agents/${agente.id}`)
    if (seleccionado === agente.id) setSeleccionado(null)
    lectura.releer()
  }

  const activar = async () => {
    await mutacion.enviar('POST', `/v1/projects/${proyectoId}/activate`)
    proyecto.releer()
    lectura.releer()
  }

  return (
    <PanelDeFlota
      proyectoId={proyectoId}
      proyecto={proyecto.datos}
      agentes={lectura.datos ?? []}
      seleccionado={seleccionado}
      alSeleccionar={setSeleccionado}
      alcance={alcance}
      roles={opciones.grupoDe(GRUPO.rolDeAgente)}
      runtimes={opciones.grupoDe(GRUPO.runtime)}
      cargandoOpciones={opciones.catalogo === null && opciones.lectura.error === null}
      cargando={estaCargandoPorPrimeraVez(lectura)}
      error={lectura.error}
      errorDeMutacion={mutacion.error}
      trabajando={mutacion.trabajando}
      alGuardar={(cuerpo, agenteId) => void guardar(cuerpo, agenteId)}
      alQuitar={(agente) => void quitar(agente)}
      alActivar={() => void activar()}
      navegar={navegar}
    />
  )
}
