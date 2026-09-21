'use client'

import { useState, type ReactNode } from 'react'

import { Campo } from '@/components/ui/campo'
import { Segmentado } from '@/components/ui/segmentado'
import { PanelDeProyectos } from '@/components/vista-proyectos'
import { PanelDeAltaDeProyecto } from '@/components/vista-alta-de-proyecto'
import { PanelDeSnapshot } from '@/components/vista-snapshot'
import { PanelDeConstitution, FormularioDeEnmienda } from '@/components/vista-constitution'
import { PanelDeGuidelines } from '@/components/vista-guidelines'
import { PanelDeBootstrap } from '@/components/vista-bootstrap'
import { PanelDeConexiones } from '@/components/vista-conexiones'
import { PanelDeCredenciales } from '@/components/vista-credenciales'
import {
  FormularioDeAgente,
  PanelDeFlota,
  borradorDesdeAgente,
  type BorradorDeAgente,
} from '@/components/vista-flota'
import { PanelDeRuns } from '@/components/vista-runs'
import { PanelDeAuditoria } from '@/components/vista-auditoria'
import { ErrorDelServicio } from '@/lib/daemon'
import type { Lectura } from '@/lib/lectura'
import type {
  Agente,
  AlcanceDeAgente,
  AlcanceDeCredencial,
  Capacidades,
  Conexion,
  Constitution,
  Credencial,
  EventoDeAuditoria,
  Guideline,
  Hallazgo,
  Plantilla,
  Proyecto,
  Recomendacion,
  Run,
  Snapshot,
} from '@/lib/tipos'
import type { Navegar } from '@/lib/ruta'

/**
 * Las PANTALLAS de establecimiento (00-07) en sus estados, dentro del
 * catalogo.
 *
 * POR QUE ESTO NO ES UN EXTRA. El catalogo de componentes ya explica por que
 * existe: un componente que nadie importa se queda fuera del bundle y su
 * primer render de verdad ocurre en produccion. Con las pantallas pasa lo
 * mismo y peor, porque una pantalla tiene ESTADOS: la version con datos se
 * mira veinte veces mientras se escribe, y la version vacia, la de error y la
 * de "todavia cargando" no se miran nunca — que son justo las tres que el
 * operador ve el primer dia, cuando no hay nada, y el peor dia, cuando algo
 * fallo.
 *
 * Por eso cada panel de producto se escribio como funcion pura que recibe la
 * lectura ya hecha, y el contenedor —el que habla con el servicio— es una
 * cascara de diez lineas encima. Aqui se pintan los paneles con datos locales:
 * sin daemon, sin red, y el `next build` los ejercita de verdad.
 *
 * Los datos de ejemplo son genericos a proposito —"gestor de tickets",
 * "gestor de repositorios"— igual que en el resto del catalogo: un nombre
 * propio en los datos de ejemplo acaba copiado a un valor por defecto.
 */

/* -------------------------------------------------------------------------- */
/* Lecturas de mentira                                                        */
/* -------------------------------------------------------------------------- */

function conDatos<T>(datos: T): Lectura<T> {
  return { datos, error: null, cargando: false, releer: () => undefined }
}

/** Ni datos ni error: es exactamente lo que ve una pantalla recien montada. */
function cargando<T>(): Lectura<T> {
  return { datos: null, error: null, cargando: true, releer: () => undefined }
}

function conError<T>(error: ErrorDelServicio): Lectura<T> {
  return { datos: null, error, cargando: false, releer: () => undefined }
}

const SIN_SERVICIO = new ErrorDelServicio({
  codigo: 'servicio_inalcanzable',
  causa:
    'No se pudo alcanzar el servicio de control en http://127.0.0.1:54321 al pedir GET /v1/projects. La peticion no llego a obtener respuesta.',
  accion:
    'Cierra noxloop y vuelve a abrirlo: el servicio arranca con la aplicacion. Si se repite, arrancalo a mano con `npm run service` y mira que imprime.',
  recurso: 'GET /v1/projects',
})

const SIN_PLANTILLAS = new ErrorDelServicio({
  codigo: 'recurso_inexistente',
  causa:
    'El servicio de control no conoce GET /v1/templates. El contrato declara que POST /v1/projects acepta una plantilla, pero no declara donde se enumeran las disponibles.',
  accion:
    'Escribe el identificador de la plantilla a mano, o deja el campo vacio para arrancar sin plantilla.',
  recurso: 'GET /v1/templates',
})

const DESTINO_NO_VACIO = new ErrorDelServicio({
  codigo: 'destino_no_vacio',
  causa:
    'No se pudo crear el proyecto en /Users/operador/proyectos/consola: la carpeta existe y contiene 47 archivos, entre ellos un repositorio git ya inicializado.',
  accion:
    'Adoptalo como proyecto existente para leerlo sin tocar nada, o elige un destino vacio.',
  recurso: 'POST /v1/projects',
})

const NO_ES_REPOSITORIO = new ErrorDelServicio({
  codigo: 'no_es_repositorio',
  causa:
    'La carpeta /Users/operador/notas existe y no es un repositorio git: no hay .git, y sin historial no se puede garantizar que el analisis no modifique nada comprobable.',
  accion:
    'Inicializa el repositorio en esa carpeta, o elige otra que ya lo sea.',
  recurso: 'POST /v1/projects',
})

/* -------------------------------------------------------------------------- */
/* Datos de ejemplo                                                           */
/* -------------------------------------------------------------------------- */

const PROYECTOS: Proyecto[] = [
  {
    id: 'prj_4f2a91',
    nombre: 'consola de control',
    origen: 'local',
    ruta_local: '/Users/operador/proyectos/consola',
    estado: 'ACTIVE',
    creado: '2026-08-02T10:00:00.000Z',
    contadores: { agentes: 3, conexiones: 2, entradas_bandeja: 0 },
  },
  {
    id: 'prj_0c41de',
    nombre: 'motor de facturacion',
    origen: 'remoto',
    remoto: 'git@servidor-interno:plataforma/facturacion.git',
    estado: 'BOOTSTRAPPED',
    creado: '2026-09-11T08:30:00.000Z',
    contadores: { agentes: 0, entradas_bandeja: 2 },
  },
  {
    id: 'prj_b83007',
    nombre: 'panel de operaciones',
    origen: 'nuevo',
    ruta_local: '/Users/operador/proyectos/panel',
    estado: 'CREATED',
    creado: '2026-09-19T17:05:00.000Z',
  },
]

const PLANTILLAS: Plantilla[] = [
  {
    id: 'node-typescript',
    nombre: 'Servicio Node con TypeScript',
    descripcion:
      'Modulos ES, tipado estatico por paquetes y el runner de pruebas del runtime. Sin framework de pruebas externo.',
    stack: 'Node 22, TypeScript',
    arquitectura: 'Paquetes por dominio',
    testing: 'Runner del runtime',
  },
  {
    id: 'interfaz-estatica',
    nombre: 'Interfaz estatica',
    descripcion:
      'Export estatico sin servidor: no hay acciones de servidor ni rutas de API, asi que la interfaz no puede convertirse en un segundo escritor.',
    stack: 'React, export estatico',
    testing: 'Pruebas de componente',
  },
]

const HALLAZGOS: Hallazgo[] = [
  {
    id: 'fnd_01',
    categoria: 'stack',
    clave: 'runtime.node',
    valor: '22.11.0',
    origen: 'detectado',
    evidencia: [
      { ruta: 'package.json', linea: 12, extracto: '"node": ">=22"' },
      { ruta: '.nvmrc', linea: 1 },
    ],
    confianza: 'alta',
    decision: 'pendiente',
  },
  {
    id: 'fnd_02',
    categoria: 'arquitectura',
    clave: 'arquitectura.estilo',
    valor: 'capas con nucleo aislado',
    origen: 'inferido',
    confianza: 'media',
    decision: 'pendiente',
  },
  {
    id: 'fnd_03',
    categoria: 'testing',
    clave: 'testing.cobertura_declarada',
    valor: null,
    origen: 'detectado',
    evidencia: [{ ruta: 'package.json', linea: 1 }],
    confianza: 'alta',
    decision: 'pendiente',
  },
  {
    id: 'fnd_04',
    categoria: 'ci',
    clave: 'ci.workflow',
    valor: { archivo: '.github/workflows/ci.yml', gates: ['tipos', 'pruebas', 'guardas'] },
    origen: 'detectado',
    evidencia: [{ ruta: '.github/workflows/ci.yml', linea: 3 }],
    confianza: 'alta',
    decision: 'aceptado',
  },
  {
    id: 'fnd_05',
    categoria: 'agentes',
    clave: 'agentes.hooks',
    valor: 'cuatro hooks configurados',
    origen: 'detectado',
    confianza: 'media',
    decision: 'pendiente',
  },
  {
    id: 'fnd_06',
    categoria: 'riesgos',
    clave: 'riesgos.secreto_en_claro',
    valor: 'posible token en un archivo versionado',
    origen: 'detectado',
    evidencia: [{ ruta: 'scripts/desplegar.sh', linea: 14 }],
    confianza: 'alta',
    decision: 'pendiente',
  },
  {
    id: 'fnd_07',
    categoria: 'guidelines',
    clave: 'guidelines.contributing',
    valor: 'CONTRIBUTING.md con reglas de commit',
    origen: 'detectado',
    confianza: 'baja',
    decision: 'descartado',
  },
]

const SNAPSHOT_COMPLETO: Snapshot = {
  id: 'snp_91ac',
  project_id: 'prj_4f2a91',
  commit: '9f3c1a8',
  creado: '2026-09-20T09:12:00.000Z',
  estado: 'completo',
  duracion_ms: 41200,
  hallazgos: HALLAZGOS,
}

const SNAPSHOT_EN_CURSO: Snapshot = {
  ...SNAPSHOT_COMPLETO,
  estado: 'en_curso',
  duracion_ms: null,
  hallazgos: HALLAZGOS.slice(0, 2),
}

const CONSTITUTION_PROPUESTA: Constitution = {
  project_id: 'prj_4f2a91',
  version: '0.1.0',
  ruta_en_repo: '.specify/memory/constitution.md',
  vigente: false,
  apartados: [
    {
      id: 'apt_testing',
      titulo: 'Politica de testing',
      contenido:
        'Toda tarea entrega su prueba. Un cambio sin prueba no pasa el gate, y el gate se apoya en el codigo de salida, no en la lectura de un modelo.',
      origen: 'detectado',
      evidencia: [{ ruta: '.github/workflows/ci.yml', linea: 21 }],
    },
    {
      id: 'apt_arquitectura',
      titulo: 'Arquitectura',
      contenido:
        'El nucleo no depende de ningun adaptador. Sustituir un proveedor no toca nada fuera de su carpeta.',
      origen: 'inferido',
      confianza: 'media',
    },
    {
      id: 'apt_despliegue',
      titulo: 'Politica de despliegue',
      contenido: '',
      origen: 'vacio',
    },
  ],
}

const CONSTITUTION_VIGENTE: Constitution = {
  ...CONSTITUTION_PROPUESTA,
  version: '1.2.0',
  vigente: true,
  ratificada: '2026-08-04T11:00:00.000Z',
  enmiendas: [
    {
      id: 'enm_01',
      version_anterior: '1.1.0',
      version_nueva: '1.2.0',
      principio: 'Revision cruzada de runtime',
      fallo_que_motiva:
        'Un revisor y un implementador con el mismo runtime aprobaron un cambio que rompia el gate de tipos: los dos leyeron el codigo con el mismo sesgo y ninguno ejecuto nada.',
      que_se_rompe_si_no:
        'La revision deja de ser una segunda opinion y pasa a ser la misma opinion dos veces, con el coste de dos runs y la confianza de uno.',
      fecha: '2026-09-02T16:20:00.000Z',
    },
  ],
}

const GUIDELINE: Guideline = {
  area: 'testing',
  ruta_en_repo: 'docs/guidelines/testing.md',
  contenido:
    '# Testing\n\nCada tarea entrega su prueba antes que su implementacion.\nUna prueba que pasa antes de escribir el codigo no prueba nada.\n',
  reglas_aplicables: ['prueba.antes_que_implementacion', 'cobertura.diff_minima'],
}

const RECOMENDACIONES: Recomendacion[] = [
  {
    id: 'rec_01',
    tipo: 'hook',
    titulo: 'Hook que impide commitear con el gate en rojo',
    justificacion:
      'El proyecto corre sus pruebas en CI y no en local, asi que el rojo se descubre despues del push. Un hook lo adelanta al momento del commit.',
    decision: 'pendiente',
    diff:
      '--- /dev/null\n+++ b/.claude/hooks/pre-commit.mjs\n@@\n+// Corta el commit si el gate no esta en verde.\n+import { veredicto } from "../gate.mjs";\n',
    archivos: [
      {
        ruta: '.claude/hooks/pre-commit.mjs',
        estado: 'anadido',
        diff: '+// Corta el commit si el gate no esta en verde.\n+import { veredicto } from "../gate.mjs";',
      },
      { ruta: '.claude/settings.json', estado: 'modificado', contenido: { hooks: ['pre-commit'] } },
    ],
  },
  {
    id: 'rec_02',
    tipo: 'validacion',
    titulo: 'Permitir merge automatico cuando los gates pasan',
    justificacion:
      'Acortaria el ciclo en los cambios pequenos, que son la mayoria de los que llegan a revision.',
    conflicto_constitution:
      'La constitution de este proyecto dice que la autonomia termina en el pull request abierto: ninguna decision de merge es del sistema. Aplicar esto la contradice, y no es un ajuste de configuracion — es un cambio de invariante que exigiria una enmienda con su fallo detras.',
    decision: 'pendiente',
    diff: '--- a/.github/workflows/ci.yml\n+++ b/.github/workflows/ci.yml\n@@\n+      - uses: merge-automatico\n',
    archivos: [{ ruta: '.github/workflows/ci.yml', estado: 'modificado' }],
  },
  {
    id: 'rec_03',
    tipo: 'documentacion',
    titulo: 'Runbook de arranque para quien llega nuevo',
    justificacion: 'No hay ningun documento que explique como levantar el entorno completo.',
    decision: 'omitida',
    motivo_decision: 'El equipo es de una persona; el runbook vive en la cabeza y se escribira cuando entre alguien.',
    diff: '--- /dev/null\n+++ b/docs/runbook.md\n@@\n+# Arranque\n',
  },
]

const CONEXIONES: Conexion[] = [
  {
    id: 'con_7f2a',
    project_id: 'prj_4f2a91',
    clase: 'tracker',
    proveedor: 'gestor-de-tickets',
    estado: 'viva',
    credential_id: 'cred_7f2a91',
  },
  {
    id: 'con_0c41',
    project_id: 'prj_4f2a91',
    clase: 'scm',
    proveedor: 'gestor-de-repositorios',
    estado: 'viva',
    credential_id: 'cred_0c41de',
  },
  {
    id: 'con_b830',
    project_id: 'prj_4f2a91',
    clase: 'integracion',
    proveedor: 'mensajeria-interna',
    estado: 'fallida',
    causa:
      'El proveedor devolvio 401 al renovar el token: la aplicacion de autorizacion fue revocada desde el panel del proveedor el 18 de septiembre. Las conexiones ya emitidas siguieron funcionando hasta hoy.',
  },
]

const CREDENCIALES: Credencial[] = [
  {
    id: 'cred_7f2a91',
    nombre: 'Token del gestor de tickets',
    proveedor: 'gestor-de-tickets',
    tipo: 'tracker',
    ambito: 'proyecto',
    project_id: 'prj_4f2a91',
    alcance_declarado: 'Leer y comentar work items. Sin permiso para cerrarlos.',
    huella: 'sha256:7f2a91c4d0e58b3617aa',
    backend: 'keychain_so',
    creada: '2026-08-04T12:00:00.000Z',
    expira: '2026-10-01T00:00:00.000Z',
    aviso_dias_antes: 14,
    estado: 'por_expirar',
  },
  {
    id: 'cred_0c41de',
    nombre: 'Token de despliegue',
    proveedor: 'gestor-de-repositorios',
    tipo: 'scm',
    ambito: 'global',
    alcance_declarado: 'Leer y escribir en los repositorios del workspace. Sin administracion.',
    huella: 'sha256:0c41de77b1229ac41f03',
    backend: 'keychain_so',
    creada: '2026-06-02T17:40:00.000Z',
    estado: 'activa',
  },
  {
    id: 'cred_b83007',
    nombre: 'Clave de la nube',
    proveedor: 'proveedor-de-nube',
    tipo: 'api_token',
    ambito: 'global',
    alcance_declarado: 'Lectura de metricas.',
    huella: 'sha256:b83007ee5512cc0918ba',
    backend: 'archivo_cifrado',
    creada: '2026-05-20T09:00:00.000Z',
    estado: 'revocada',
  },
]

const ALCANCE: AlcanceDeCredencial = {
  credential_id: 'cred_0c41de',
  calculado: '2026-09-20T12:00:00.000Z',
  agentes: [
    {
      agent_id: 'agt_impl',
      nombre: 'implementador',
      rol: 'implementador',
      runtime: 'runtime-de-referencia',
      project_id: 'prj_4f2a91',
      proyecto: 'consola de control',
      grant_id: 'grn_11',
      vigencia_hasta: null,
    },
    {
      agent_id: 'agt_rev',
      nombre: 'revisor',
      rol: 'revisor',
      runtime: 'runtime-secundario',
      project_id: 'prj_0c41de',
      proyecto: 'motor de facturacion',
      grant_id: 'grn_12',
      vigencia_hasta: '2026-12-31T00:00:00.000Z',
    },
  ],
  proyectos: [
    { project_id: 'prj_4f2a91', nombre: 'consola de control', agentes: 1 },
    { project_id: 'prj_0c41de', nombre: 'motor de facturacion', agentes: 1 },
  ],
}

const CAPACIDADES_DEGRADADAS: Capacidades = {
  boveda: { backend: 'archivo_cifrado', degradado: true },
  conexiones: { proveedor: 'integraciones-local' },
}

const CAPACIDADES_SIN_PROVEEDOR: Capacidades = {
  boveda: { backend: 'keychain_so' },
}

/**
 * La flota de ejemplo INCLUYE EL CHOQUE DE RUNTIME a proposito: el revisor y
 * el implementador corren los dos sobre `runtime-de-referencia`. Es el unico
 * estado de esta pantalla que un operador no va a ver hasta el dia que lo
 * configure mal, que es justo el dia en que el aviso tiene que estar bien
 * escrito.
 */
const AGENTES: Agente[] = [
  {
    id: 'agt_plan',
    project_id: 'prj_4f2a91',
    nombre: 'planificador',
    rol: 'planificador',
    runtime: 'runtime-de-referencia',
    modelo: 'modelo-de-referencia',
    skills: ['descomposicion', 'dependencias'],
    tools: ['leer'],
    mcps: ['gestor-de-tickets'],
    permisos: { escritura: false },
    presupuesto: { usd: 2, llamadas: 40 },
    contexto: { incluye_constitution: true, incluye_transcript: false },
  },
  {
    id: 'agt_impl',
    project_id: 'prj_4f2a91',
    nombre: 'implementador de backend',
    rol: 'implementador',
    runtime: 'runtime-de-referencia',
    modelo: 'modelo-de-referencia',
    skills: ['testing', 'migraciones'],
    tools: ['leer', 'escribir', 'ejecutar'],
    mcps: ['gestor-de-repositorios'],
    permisos: { escritura: true, despliegue: false },
    presupuesto: { usd: 8, llamadas: 200 },
    contexto: { incluye_constitution: true, incluye_guidelines: ['backend', 'testing'] },
  },
  {
    id: 'agt_rev',
    project_id: 'prj_4f2a91',
    nombre: 'revisor',
    rol: 'revisor',
    // Mismo runtime que el implementador: FR-034 en rojo.
    runtime: 'runtime-de-referencia',
    modelo: 'modelo-secundario',
    skills: ['revision'],
    tools: ['leer'],
    permisos: { escritura: false },
    presupuesto: { usd: 3 },
    contexto: { incluye_transcript: false },
  },
]

/** La misma flota, ya corregida: el revisor corre sobre otro runtime. */
const FLOTA_CORRECTA: Agente[] = AGENTES.map((agente) =>
  agente.rol === 'revisor' ? { ...agente, runtime: 'runtime-secundario' } : agente,
)

const ALCANCE_DEL_AGENTE: AlcanceDeAgente = {
  agent_id: 'agt_impl',
  calculado: '2026-09-20T12:00:00.000Z',
  credenciales: [
    {
      credential_id: 'cred_0c41de',
      nombre: 'Token de despliegue',
      proveedor: 'gestor-de-repositorios',
      alcance_declarado: 'Leer y escribir en los repositorios del workspace. Sin administracion.',
      huella: 'sha256:0c41de77b1229ac41f03',
      estado: 'activa',
      grant_id: 'grn_11',
      project_id: 'prj_4f2a91',
      vigencia_hasta: null,
      concedido_por: 'operador',
    },
    {
      credential_id: 'cred_7f2a91',
      nombre: 'Token del gestor de tickets',
      proveedor: 'gestor-de-tickets',
      alcance_declarado: 'Leer y comentar work items. Sin permiso para cerrarlos.',
      huella: 'sha256:7f2a91c4d0e58b3617aa',
      estado: 'por_expirar',
      grant_id: 'grn_13',
      project_id: 'prj_4f2a91',
      vigencia_hasta: '2026-12-31T00:00:00.000Z',
      concedido_por: 'operador',
    },
  ],
}

const CAPACIDADES_CON_RUNTIMES: Capacidades = {
  runtimes: ['runtime-de-referencia', 'runtime-secundario'],
  boveda: { backend: 'keychain_so' },
  motor: { presente: true },
}

const REVISOR_COMPARTE_RUNTIME = new ErrorDelServicio({
  codigo: 'revisor_comparte_runtime',
  causa:
    'El revisor `revisor` y el implementador `implementador de backend` corren sobre el mismo runtime `runtime-de-referencia`. Una revision hecha por el mismo runtime que escribio el codigo aprueba sus propios puntos ciegos: no es una segunda opinion, es la primera repetida.',
  accion:
    'Cambia el runtime de `revisor` a uno distinto de `runtime-de-referencia` en la pantalla de flota del proyecto, y vuelve a activar.',
  estadoHttp: 409,
  recurso: 'POST /v1/projects/prj_4f2a91/activate',
})

const PROYECTO_NO_ACTIVO = new ErrorDelServicio({
  codigo: 'proyecto_no_activo',
  causa:
    'El proyecto `motor de facturacion` esta en `BOOTSTRAPPED` y un run solo se lanza desde `ACTIVE`. La etapa que falta es `conexion_viva`: el proyecto no tiene ninguna conexion en estado vivo, y sin tracker ni SCM un ciclo no tiene de donde sacar el work item ni donde abrir el pull request.',
  accion:
    'Conecta al menos un proveedor desde la pantalla de Conexiones del proyecto y vuelve a lanzar.',
  estadoHttp: 409,
  recurso: 'POST /v1/projects/prj_0c41de/runs',
})

const RUNS: Run[] = [
  {
    item: {
      id: 'PROJ-142',
      title: 'Cola de integracion con rebase',
      branch: 'noxloop/PROJ-142',
      pr: null,
    },
    project_id: 'prj_4f2a91',
    createdAt: '2026-09-20T09:40:00.000Z',
    updatedAt: '2026-09-20T11:55:00.000Z',
    spent: { usd: 4.2, calls: 118 },
    tasks: [
      { id: 'T1', title: 'Esquema de la cola', status: 'integrated', attempts: { red: 1, green: 1, gate: 1, review: 1 }, redVerified: true },
      { id: 'T2', title: 'Rebase automatico al encolar', status: 'red', attempts: { red: 1, green: 0, gate: 0, review: 0 }, redVerified: true },
      { id: 'T4', title: 'Metrica de la cola', status: 'queued', attempts: { red: 1, green: 1, gate: 1, review: 1 }, redVerified: true },
      {
        id: 'T3',
        title: 'Reintento tras conflicto',
        status: 'blocked',
        attempts: { red: 2, green: 3, gate: 3, review: 0 },
        redVerified: true,
        lastFailure:
          'El gate quedo en rojo tres veces seguidas con el mismo fallo: `cola.test.mjs` espera que un conflicto vuelva la tarea a green y el codigo la deja en queued. El presupuesto del lazo de gate se agoto, asi que la tarea se bloqueo en vez de seguir gastando vueltas sobre el mismo error.',
      },
    ],
  },
  {
    item: { id: 'PROJ-139', title: 'Purga de sesiones caducadas', branch: 'noxloop/PROJ-139' },
    project_id: 'prj_4f2a91',
    createdAt: '2026-09-18T08:00:00.000Z',
    updatedAt: '2026-09-18T15:12:00.000Z',
    spent: { usd: 1.8, calls: 52 },
    tasks: [
      { id: 'T1', title: 'Barrido por vigencia', status: 'integrated', attempts: { red: 1, green: 1, gate: 1, review: 1 } },
      { id: 'T2', title: 'Metrica de sesiones purgadas', status: 'integrated', attempts: { red: 1, green: 1, gate: 1, review: 1 } },
    ],
  },
  {
    // El archivo existe y no se deja leer. Se declara como tal en vez de
    // desaparecer de la lista: un run que desaparece se lee como uno que nunca
    // existio, y es justo al reves.
    item: { id: 'PROJ-121' },
    corrupto: true,
    tasks: [],
  },
]

const AUDITORIA: EventoDeAuditoria[] = [
  {
    id: 412,
    instante: '2026-09-20T11:58:00.000Z',
    actor: 'operador',
    accion: 'grant.concedido',
    objeto_tipo: 'grant',
    objeto_id: 'grn_12',
    resultado: 'permitido',
    detalle: { proyecto: 'prj_0c41de', agente: 'agt_rev', credencial: 'cred_0c41de' },
    hash_anterior: 'sha256:aa11',
    hash: 'sha256:bb22',
  },
  {
    id: 411,
    instante: '2026-09-20T10:31:00.000Z',
    actor: 'agente implementador',
    accion: 'credencial.solicitada',
    objeto_tipo: 'credential',
    objeto_id: 'cred_b83007',
    resultado: 'denegado',
    detalle: {
      motivo: 'sin grant vigente',
      entrada_de_bandeja: 'inb_4f2a',
      // La clave dice `token`, asi que `VistaJSON` lo enmascara sola. Esta
      // aqui para que el catalogo demuestre la segunda linea de defensa, no
      // para afirmarla: si alguien afloja la heuristica, se ve en pantalla.
      token_del_proveedor: 'esto tiene que salir enmascarado',
    },
    hash_anterior: 'sha256:9900',
    hash: 'sha256:aa11',
  },
  {
    id: 410,
    instante: '2026-09-19T08:02:00.000Z',
    actor: 'sistema',
    accion: 'credencial.rotada',
    objeto_tipo: 'credential',
    objeto_id: 'cred_7f2a91',
    resultado: 'error',
    detalle: { causa: 'la boveda del sistema estaba bloqueada' },
    hash_anterior: 'sha256:8877',
    hash: 'sha256:9900',
  },
]

/* -------------------------------------------------------------------------- */
/* Andamio                                                                    */
/* -------------------------------------------------------------------------- */

function Pantalla({
  titulo,
  nota,
  children,
}: {
  titulo: string
  nota: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-heading-20 text-ds-gray-1000">{titulo}</h2>
        <p className="text-copy-14 text-ds-gray-900">{nota}</p>
      </div>
      {children}
    </section>
  )
}

function Estado({ nombre, children }: { nombre: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="fuente-operativa text-label-12 text-ds-gray-700">{nombre}</span>
      {/* Un filete a la izquierda y nada mas: separa un estado del siguiente
          sin meter una caja alrededor de cada pantalla. */}
      <div className="border-l border-ds-gray-400 pl-5">{children}</div>
    </div>
  )
}

const SIN_EFECTO = () => undefined

/* -------------------------------------------------------------------------- */
/* El catalogo de pantallas                                                   */
/* -------------------------------------------------------------------------- */

export function CatalogoDePantallas({ navegar }: { navegar: Navegar }) {
  const [texto, setTexto] = useState('')
  const [secreto, setSecreto] = useState('')
  const [origen, setOrigen] = useState<'nuevo' | 'local' | 'remoto'>('local')
  const [credencial, setCredencial] = useState<string | null>('cred_0c41de')
  const [area, setArea] = useState<Guideline['area']>('testing')
  const [guideline, setGuideline] = useState(GUIDELINE.contenido)
  const [agente, setAgente] = useState<string | null>('agt_impl')
  // El formulario de agente vive detras de un estado local del panel, asi que
  // el build no lo ejercitaria nunca desde `PanelDeFlota`: se monta aparte,
  // igual que `FormularioDeEnmienda`.
  const [borrador, setBorrador] = useState<BorradorDeAgente>(() =>
    borradorDesdeAgente(AGENTES[2]),
  )

  return (
    <div className="flex flex-col gap-14">
      <Pantalla
        titulo="Campo"
        nota="La entrada de texto con etiqueta enlazada, ayuda y error. El error se escribe como en todas partes: que paso y que hacer."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <Estado nombre="normal">
            <Campo
              etiqueta="Nombre del proyecto"
              valor={texto}
              alCambiar={setTexto}
              marcador="consola de control"
              ayuda="No tiene que coincidir con el nombre de la carpeta."
            />
          </Estado>
          <Estado nombre="obligatorio con error">
            <Campo
              etiqueta="Carpeta del proyecto"
              valor=""
              alCambiar={SIN_EFECTO}
              requerido
              operativo
              error="La ruta tiene que ser absoluta: el servicio la abre desde su propio proceso y no comparte tu directorio de trabajo. Empieza por /."
            />
          </Estado>
          <Estado nombre="secreto de paso">
            <Campo
              etiqueta="Valor de la credencial"
              valor={secreto}
              alCambiar={setSecreto}
              secreto
              ayuda="Enmascarado por el navegador mientras se escribe. En cuanto el servicio lo guarde, lo unico que vuelve es la huella."
            />
          </Estado>
          <Estado nombre="multilinea deshabilitado">
            <Campo
              etiqueta="Motivo de la omision"
              valor="El equipo es de una persona."
              alCambiar={SIN_EFECTO}
              multilinea
              filas={3}
              deshabilitado
              ayuda="Deshabilitado porque la recomendacion ya esta decidida."
            />
          </Estado>
        </div>
      </Pantalla>

      <Pantalla
        titulo="Segmentado"
        nota="Elegir una opcion entre pocas, con todas a la vista. Es lo que Geist llama Switch, que no es un booleano. Las flechas mueven la seleccion y el grupo entero es una sola parada de tabulador."
      >
        <Segmentado
          etiqueta="Origen del proyecto"
          valor={origen}
          alCambiar={setOrigen}
          opciones={[
            {
              valor: 'nuevo',
              etiqueta: 'Proyecto nuevo',
              descripcion: 'No hay codigo todavia: se parte de una plantilla.',
            },
            {
              valor: 'local',
              etiqueta: 'Carpeta local',
              descripcion: 'El codigo ya existe en esta maquina y se lee sin tocarlo.',
            },
            {
              valor: 'remoto',
              etiqueta: 'Repositorio remoto',
              descripcion: 'Se clona a un area de trabajo propia de noxloop.',
            },
          ]}
        />
      </Pantalla>

      <Pantalla
        titulo="T084 · Lista de proyectos"
        nota="Una fila por proyecto con la etapa que falta escrita entera. Ni una tarjeta: con doce proyectos, doce tarjetas son doce rectangulos que se aprenden a ignorar."
      >
        <div className="flex flex-col gap-10">
          <Estado nombre="con datos">
            <PanelDeProyectos lectura={conDatos(PROYECTOS)} navegar={navegar} />
          </Estado>
          <Estado nombre="cargando">
            <PanelDeProyectos lectura={cargando<Proyecto[]>()} navegar={navegar} />
          </Estado>
          <Estado nombre="vacio">
            <PanelDeProyectos lectura={conDatos<Proyecto[]>([])} navegar={navegar} />
          </Estado>
          <Estado nombre="error">
            <PanelDeProyectos lectura={conError<Proyecto[]>(SIN_SERVICIO)} navegar={navegar} />
          </Estado>
        </div>
      </Pantalla>

      <Pantalla
        titulo="T085 y T087 · Alta de proyecto y plantillas"
        nota="Los tres origenes, el selector de carpeta segun la superficie, y los dos errores del contrato pintados con su accion, no solo con su texto."
      >
        <div className="flex flex-col gap-10">
          <Estado nombre="con catalogo de plantillas">
            <PanelDeAltaDeProyecto
              plantillas={conDatos(PLANTILLAS)}
              alCrear={SIN_EFECTO}
              trabajando={false}
              error={null}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="sin catalogo de plantillas · el servicio no lo publica">
            <PanelDeAltaDeProyecto
              plantillas={conError<Plantilla[]>(SIN_PLANTILLAS)}
              alCrear={SIN_EFECTO}
              trabajando={false}
              error={null}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="error destino_no_vacio · con su salida">
            <PanelDeAltaDeProyecto
              plantillas={conDatos(PLANTILLAS)}
              alCrear={SIN_EFECTO}
              trabajando={false}
              error={DESTINO_NO_VACIO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="error no_es_repositorio · con su salida">
            <PanelDeAltaDeProyecto
              plantillas={cargando<Plantilla[]>()}
              alCrear={SIN_EFECTO}
              trabajando={false}
              error={NO_ES_REPOSITORIO}
              navegar={navegar}
            />
          </Estado>
        </div>
      </Pantalla>

      <Pantalla
        titulo="T086 · Snapshot"
        nota="Hallazgos agrupados por categoria, cada uno con su origen ocupando sitio: detectado con ruta y linea, inferido con confianza, el hueco declarado como hueco, y el detectado sin evidencia marcado como incoherente con el contrato."
      >
        <div className="flex flex-col gap-10">
          <Estado nombre="con datos">
            <PanelDeSnapshot
              proyectoId="prj_4f2a91"
              snapshot={SNAPSHOT_COMPLETO}
              hallazgos={HALLAZGOS}
              progreso={null}
              cargando={false}
              error={null}
              errorDeMutacion={null}
              trabajando={false}
              alAnalizar={SIN_EFECTO}
              alCancelar={SIN_EFECTO}
              alAceptar={SIN_EFECTO}
              alDecidir={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="analizando · progreso y lista que crece">
            <PanelDeSnapshot
              proyectoId="prj_4f2a91"
              snapshot={SNAPSHOT_EN_CURSO}
              hallazgos={HALLAZGOS.slice(0, 2)}
              progreso={{ fase: 'manifiestos', archivos_vistos: 3120, total_estimado: 9800 }}
              cargando={false}
              error={null}
              errorDeMutacion={null}
              trabajando={false}
              alAnalizar={SIN_EFECTO}
              alCancelar={SIN_EFECTO}
              alAceptar={SIN_EFECTO}
              alDecidir={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="cargando">
            <PanelDeSnapshot
              proyectoId="prj_4f2a91"
              snapshot={null}
              hallazgos={[]}
              progreso={null}
              cargando
              error={null}
              errorDeMutacion={null}
              trabajando={false}
              alAnalizar={SIN_EFECTO}
              alCancelar={SIN_EFECTO}
              alAceptar={SIN_EFECTO}
              alDecidir={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="vacio · sin snapshot todavia">
            <PanelDeSnapshot
              proyectoId="prj_b83007"
              snapshot={null}
              hallazgos={[]}
              progreso={null}
              cargando={false}
              error={null}
              errorDeMutacion={null}
              trabajando={false}
              alAnalizar={SIN_EFECTO}
              alCancelar={SIN_EFECTO}
              alAceptar={SIN_EFECTO}
              alDecidir={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="error">
            <PanelDeSnapshot
              proyectoId="prj_b83007"
              snapshot={null}
              hallazgos={[]}
              progreso={null}
              cargando={false}
              error={SIN_SERVICIO}
              errorDeMutacion={SIN_SERVICIO}
              trabajando={false}
              alAnalizar={SIN_EFECTO}
              alCancelar={SIN_EFECTO}
              alAceptar={SIN_EFECTO}
              alDecidir={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
        </div>
      </Pantalla>

      <Pantalla
        titulo="T116 · Constitution"
        nota="Cada apartado marcado por origen, incluido el vacio. La enmienda pide los tres campos y el motivo esta a la vista, no escondido en el mensaje de error que sale despues."
      >
        <div className="flex flex-col gap-10">
          <Estado nombre="propuesta · detectado, inferido y vacio">
            <PanelDeConstitution
              proyectoId="prj_4f2a91"
              constitution={CONSTITUTION_PROPUESTA}
              cargando={false}
              error={null}
              errorDeMutacion={null}
              errorDeEnmienda={null}
              trabajando={false}
              trabajandoEnLaEnmienda={false}
              alProponer={SIN_EFECTO}
              alFijar={SIN_EFECTO}
              alEnmendar={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="vigente · con enmienda e historial">
            <PanelDeConstitution
              proyectoId="prj_4f2a91"
              constitution={CONSTITUTION_VIGENTE}
              cargando={false}
              error={null}
              errorDeMutacion={null}
              errorDeEnmienda={null}
              trabajando={false}
              trabajandoEnLaEnmienda={false}
              alProponer={SIN_EFECTO}
              alFijar={SIN_EFECTO}
              alEnmendar={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="cargando">
            <PanelDeConstitution
              proyectoId="prj_4f2a91"
              constitution={null}
              cargando
              error={null}
              errorDeMutacion={null}
              errorDeEnmienda={null}
              trabajando={false}
              trabajandoEnLaEnmienda={false}
              alProponer={SIN_EFECTO}
              alFijar={SIN_EFECTO}
              alEnmendar={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="vacio · sin constitution todavia">
            <PanelDeConstitution
              proyectoId="prj_b83007"
              constitution={null}
              cargando={false}
              error={null}
              errorDeMutacion={null}
              errorDeEnmienda={null}
              trabajando={false}
              trabajandoEnLaEnmienda={false}
              alProponer={SIN_EFECTO}
              alFijar={SIN_EFECTO}
              alEnmendar={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="enmienda con el rechazo del servicio">
            <FormularioDeEnmienda
              alEnmendar={SIN_EFECTO}
              trabajando={false}
              error={
                new ErrorDelServicio({
                  codigo: 'enmienda_incompleta',
                  causa:
                    'El servicio rechazo la enmienda al principio "Revision cruzada de runtime": llego sin el campo que_se_rompe_si_no.',
                  accion:
                    'Escribe que consecuencia tiene dejar el principio como esta. Sin ella la enmienda no se registra.',
                  recurso: 'POST /v1/projects/prj_4f2a91/constitution/amend',
                })
              }
            />
          </Estado>
        </div>
      </Pantalla>

      <Pantalla
        titulo="T116 · Guidelines"
        nota="Una area cada vez. La de diseno se declara omitible sin penalizacion, porque un area vacia dentro de una lista de siete se lee como un hueco que falta rellenar."
      >
        <div className="flex flex-col gap-10">
          <Estado nombre="con contenido">
            <PanelDeGuidelines
              area={area}
              alCambiarArea={setArea}
              lectura={conDatos(GUIDELINE)}
              borrador={guideline}
              alEditar={setGuideline}
              alGuardar={SIN_EFECTO}
              trabajando={false}
              errorDeMutacion={null}
            />
          </Estado>
          <Estado nombre="area sin guideline todavia">
            <PanelDeGuidelines
              area="diseno"
              alCambiarArea={SIN_EFECTO}
              lectura={conError<Guideline>(
                new ErrorDelServicio({
                  codigo: 'recurso_inexistente',
                  causa: 'El servicio de control no conoce GET /v1/projects/prj_4f2a91/guidelines/diseno.',
                  accion: 'Escribe la guideline y guardala: se crea versionada en el repositorio.',
                  recurso: 'GET /v1/projects/prj_4f2a91/guidelines/diseno',
                }),
              )}
              borrador=""
              alEditar={SIN_EFECTO}
              alGuardar={SIN_EFECTO}
              trabajando={false}
              errorDeMutacion={null}
            />
          </Estado>
        </div>
      </Pantalla>

      <Pantalla
        titulo="T116 · Bootstrap"
        nota="El diff exacto antes de escribir, con arbol de archivos y vista de JSON. Tres salidas por recomendacion, y el conflicto con la constitution declarado en la que lo tiene."
      >
        <div className="flex flex-col gap-10">
          <Estado nombre="con recomendaciones · una en conflicto, una omitida">
            <PanelDeBootstrap
              proyectoId="prj_4f2a91"
              recomendaciones={RECOMENDACIONES}
              cargando={false}
              error={null}
              errorDeMutacion={null}
              trabajando={false}
              alAnalizar={SIN_EFECTO}
              alAplicar={SIN_EFECTO}
              alPersonalizar={SIN_EFECTO}
              alOmitir={SIN_EFECTO}
              alCompletar={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="cargando">
            <PanelDeBootstrap
              proyectoId="prj_4f2a91"
              recomendaciones={[]}
              cargando
              error={null}
              errorDeMutacion={null}
              trabajando={false}
              alAnalizar={SIN_EFECTO}
              alAplicar={SIN_EFECTO}
              alPersonalizar={SIN_EFECTO}
              alOmitir={SIN_EFECTO}
              alCompletar={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="vacio">
            <PanelDeBootstrap
              proyectoId="prj_4f2a91"
              recomendaciones={[]}
              cargando={false}
              error={null}
              errorDeMutacion={null}
              trabajando={false}
              alAnalizar={SIN_EFECTO}
              alAplicar={SIN_EFECTO}
              alPersonalizar={SIN_EFECTO}
              alOmitir={SIN_EFECTO}
              alCompletar={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="error">
            <PanelDeBootstrap
              proyectoId="prj_4f2a91"
              recomendaciones={[]}
              cargando={false}
              error={SIN_SERVICIO}
              errorDeMutacion={null}
              trabajando={false}
              alAnalizar={SIN_EFECTO}
              alAplicar={SIN_EFECTO}
              alPersonalizar={SIN_EFECTO}
              alOmitir={SIN_EFECTO}
              alCompletar={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
        </div>
      </Pantalla>

      <Pantalla
        titulo="T163 · Conexiones"
        nota="El gestor de repositorios no es una integracion mas: git se habla directo. El flujo de autorizacion se abre en el navegador del sistema, no en el webview."
      >
        <div className="flex flex-col gap-10">
          <Estado nombre="con datos · una conexion fallida con su causa completa">
            <PanelDeConexiones
              proyectoId="prj_4f2a91"
              conexiones={CONEXIONES}
              capacidades={CAPACIDADES_DEGRADADAS}
              cargando={false}
              error={null}
              errorDeMutacion={null}
              trabajando={false}
              autorizacion={{
                url_autorizacion: 'http://127.0.0.1:3003/autorizar?sesion=4f2a91c4',
                session_token: 'ses_4f2a91',
                expira: '2026-09-20T12:15:00.000Z',
              }}
              alAutorizar={SIN_EFECTO}
              alRevocar={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="vacio · sin proveedor de integraciones declarado">
            <PanelDeConexiones
              proyectoId="prj_0c41de"
              conexiones={[]}
              capacidades={CAPACIDADES_SIN_PROVEEDOR}
              cargando={false}
              error={null}
              errorDeMutacion={null}
              trabajando={false}
              autorizacion={null}
              alAutorizar={SIN_EFECTO}
              alRevocar={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="cargando">
            <PanelDeConexiones
              proyectoId="prj_0c41de"
              conexiones={[]}
              capacidades={null}
              cargando
              error={null}
              errorDeMutacion={null}
              trabajando={false}
              autorizacion={null}
              alAutorizar={SIN_EFECTO}
              alRevocar={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="error">
            <PanelDeConexiones
              proyectoId="prj_0c41de"
              conexiones={[]}
              capacidades={null}
              cargando={false}
              error={SIN_SERVICIO}
              errorDeMutacion={SIN_SERVICIO}
              trabajando={false}
              autorizacion={null}
              alAutorizar={SIN_EFECTO}
              alRevocar={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
        </div>
      </Pantalla>

      <Pantalla
        titulo="T163 · Credenciales, grants y vista inversa"
        nota="SecretValue en modo huella: no hay boton de revelar porque no hay nada que revelar. La vista inversa contesta quien la alcanza HOY, no que filas de grant existen."
      >
        <div className="flex flex-col gap-10">
          <Estado nombre="con datos · con el detalle y la vista inversa abiertos">
            <PanelDeCredenciales
              credenciales={CREDENCIALES}
              seleccionada={credencial}
              alSeleccionar={setCredencial}
              alcance={conDatos(ALCANCE)}
              capacidades={CAPACIDADES_DEGRADADAS}
              ahora={Date.parse('2026-09-20T12:00:00.000Z')}
              cargando={false}
              error={null}
              errorDeMutacion={null}
              trabajando={false}
              alRegistrar={SIN_EFECTO}
              alRotar={SIN_EFECTO}
              alRevocar={SIN_EFECTO}
              alRevocarGrant={SIN_EFECTO}
              alConcederGrant={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="credencial que nadie alcanza">
            <PanelDeCredenciales
              credenciales={CREDENCIALES}
              seleccionada="cred_b83007"
              alSeleccionar={SIN_EFECTO}
              alcance={conDatos<AlcanceDeCredencial>({
                credential_id: 'cred_b83007',
                agentes: [],
                proyectos: [],
              })}
              capacidades={null}
              ahora={Date.parse('2026-09-20T12:00:00.000Z')}
              cargando={false}
              error={null}
              errorDeMutacion={null}
              trabajando={false}
              alRegistrar={SIN_EFECTO}
              alRotar={SIN_EFECTO}
              alRevocar={SIN_EFECTO}
              alRevocarGrant={SIN_EFECTO}
              alConcederGrant={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="cargando">
            <PanelDeCredenciales
              credenciales={[]}
              seleccionada={null}
              alSeleccionar={SIN_EFECTO}
              alcance={cargando<AlcanceDeCredencial>()}
              capacidades={null}
              ahora={Date.parse('2026-09-20T12:00:00.000Z')}
              cargando
              error={null}
              errorDeMutacion={null}
              trabajando={false}
              alRegistrar={SIN_EFECTO}
              alRotar={SIN_EFECTO}
              alRevocar={SIN_EFECTO}
              alRevocarGrant={SIN_EFECTO}
              alConcederGrant={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="vacio">
            <PanelDeCredenciales
              credenciales={[]}
              seleccionada={null}
              alSeleccionar={SIN_EFECTO}
              alcance={cargando<AlcanceDeCredencial>()}
              capacidades={null}
              ahora={Date.parse('2026-09-20T12:00:00.000Z')}
              cargando={false}
              error={null}
              errorDeMutacion={null}
              trabajando={false}
              alRegistrar={SIN_EFECTO}
              alRotar={SIN_EFECTO}
              alRevocar={SIN_EFECTO}
              alRevocarGrant={SIN_EFECTO}
              alConcederGrant={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="error">
            <PanelDeCredenciales
              credenciales={[]}
              seleccionada={null}
              alSeleccionar={SIN_EFECTO}
              alcance={cargando<AlcanceDeCredencial>()}
              capacidades={null}
              ahora={Date.parse('2026-09-20T12:00:00.000Z')}
              cargando={false}
              error={SIN_SERVICIO}
              errorDeMutacion={null}
              trabajando={false}
              alRegistrar={SIN_EFECTO}
              alRotar={SIN_EFECTO}
              alRevocar={SIN_EFECTO}
              alRevocarGrant={SIN_EFECTO}
              alConcederGrant={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
        </div>
      </Pantalla>

      <Pantalla
        titulo="T188 · Flota (etapa 07) y activacion"
        nota="FR-034 pintado con su accion: el revisor que comparte runtime con el implementador no se avisa con un parrafo rojo, se avisa con el boton que abre al revisor. Y la vista inversa girada: que credenciales alcanza este agente."
      >
        <div className="flex flex-col gap-10">
          <Estado nombre="con datos · el revisor comparte runtime con el implementador">
            <PanelDeFlota
              proyectoId="prj_4f2a91"
              proyecto={{ ...PROYECTOS[0], estado: 'CONNECTED' }}
              agentes={AGENTES}
              seleccionado={agente}
              alSeleccionar={setAgente}
              alcance={conDatos(ALCANCE_DEL_AGENTE)}
              capacidades={CAPACIDADES_CON_RUNTIMES}
              cargando={false}
              error={null}
              errorDeMutacion={null}
              trabajando={false}
              alGuardar={SIN_EFECTO}
              alQuitar={SIN_EFECTO}
              alActivar={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="rechazo del servicio · revisor_comparte_runtime con su salida">
            <PanelDeFlota
              proyectoId="prj_4f2a91"
              proyecto={{ ...PROYECTOS[0], estado: 'CONNECTED' }}
              agentes={AGENTES}
              seleccionado={null}
              alSeleccionar={SIN_EFECTO}
              alcance={cargando<AlcanceDeAgente>()}
              capacidades={CAPACIDADES_CON_RUNTIMES}
              cargando={false}
              error={null}
              errorDeMutacion={REVISOR_COMPARTE_RUNTIME}
              trabajando={false}
              alGuardar={SIN_EFECTO}
              alQuitar={SIN_EFECTO}
              alActivar={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="flota correcta y proyecto ya activo · agente sin ningun grant">
            <PanelDeFlota
              proyectoId="prj_4f2a91"
              proyecto={PROYECTOS[0]}
              agentes={FLOTA_CORRECTA}
              seleccionado="agt_rev"
              alSeleccionar={SIN_EFECTO}
              alcance={conDatos<AlcanceDeAgente>({ agent_id: 'agt_rev', credenciales: [] })}
              capacidades={CAPACIDADES_CON_RUNTIMES}
              cargando={false}
              error={null}
              errorDeMutacion={null}
              trabajando={false}
              alGuardar={SIN_EFECTO}
              alQuitar={SIN_EFECTO}
              alActivar={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="cargando">
            <PanelDeFlota
              proyectoId="prj_b83007"
              proyecto={null}
              agentes={[]}
              seleccionado={null}
              alSeleccionar={SIN_EFECTO}
              alcance={cargando<AlcanceDeAgente>()}
              capacidades={null}
              cargando
              error={null}
              errorDeMutacion={null}
              trabajando={false}
              alGuardar={SIN_EFECTO}
              alQuitar={SIN_EFECTO}
              alActivar={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="vacio · proyecto conectado sin flota">
            <PanelDeFlota
              proyectoId="prj_b83007"
              proyecto={{ ...PROYECTOS[2], estado: 'CONNECTED' }}
              agentes={[]}
              seleccionado={null}
              alSeleccionar={SIN_EFECTO}
              alcance={cargando<AlcanceDeAgente>()}
              capacidades={CAPACIDADES_CON_RUNTIMES}
              cargando={false}
              error={null}
              errorDeMutacion={null}
              trabajando={false}
              alGuardar={SIN_EFECTO}
              alQuitar={SIN_EFECTO}
              alActivar={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="error">
            <PanelDeFlota
              proyectoId="prj_b83007"
              proyecto={null}
              agentes={[]}
              seleccionado={null}
              alSeleccionar={SIN_EFECTO}
              alcance={cargando<AlcanceDeAgente>()}
              capacidades={null}
              cargando={false}
              error={SIN_SERVICIO}
              errorDeMutacion={null}
              trabajando={false}
              alGuardar={SIN_EFECTO}
              alQuitar={SIN_EFECTO}
              alActivar={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="el formulario · nueve campos y el aviso de FR-034 antes de guardar">
            <FormularioDeAgente
              borrador={borrador}
              alEditar={setBorrador}
              agentes={AGENTES}
              editando="agt_rev"
              runtimesDeclarados={CAPACIDADES_CON_RUNTIMES.runtimes ?? []}
              trabajando={false}
              error={null}
              alGuardar={SIN_EFECTO}
              alCancelar={SIN_EFECTO}
            />
          </Estado>
          <Estado nombre="el formulario · sin runtimes declarados y con el rechazo del servicio">
            <FormularioDeAgente
              borrador={{ ...borrador, rol: 'verificador', permisos: '{ esto no es JSON' }}
              alEditar={SIN_EFECTO}
              agentes={AGENTES}
              editando={null}
              runtimesDeclarados={[]}
              trabajando={false}
              error={REVISOR_COMPARTE_RUNTIME}
              alGuardar={SIN_EFECTO}
              alCancelar={SIN_EFECTO}
            />
          </Estado>
        </div>
      </Pantalla>

      <Pantalla
        titulo="T189 · Lanzar un ciclo y leer los runs"
        nota="El 409 es una accion, no un texto: el rechazo nombra la etapa que falta y trae el boton que lleva ahi. La lista de runs no tiene un solo control que escriba — el motor es el unico escritor de su estado."
      >
        <div className="flex flex-col gap-10">
          <Estado nombre="con datos · un ciclo con una tarea bloqueada y un archivo ilegible">
            <PanelDeRuns
              proyectoId="prj_4f2a91"
              proyecto={PROYECTOS[0]}
              runs={RUNS}
              ahora={Date.parse('2026-09-20T12:00:00.000Z')}
              cargando={false}
              error={null}
              errorDeLanzamiento={null}
              trabajando={false}
              alLanzar={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          {/* El proyecto va en `BOOTSTRAPPED` y no en `ACTIVE` a proposito: es
              el estado real despues de un 409: el contenedor relee el proyecto
              al ser rechazado y descubre que ya no estaba activo. Ahi es donde
              el boton de la etapa que falta tiene que seguir en pantalla. */}
          <Estado nombre="409 del servicio · la etapa que falta, con su boton">
            <PanelDeRuns
              proyectoId="prj_0c41de"
              proyecto={PROYECTOS[1]}
              runs={[]}
              ahora={Date.parse('2026-09-20T12:00:00.000Z')}
              cargando={false}
              error={null}
              errorDeLanzamiento={PROYECTO_NO_ACTIVO}
              trabajando={false}
              alLanzar={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="proyecto que todavia no puede recibir ciclos">
            <PanelDeRuns
              proyectoId="prj_0c41de"
              proyecto={PROYECTOS[1]}
              runs={[]}
              ahora={Date.parse('2026-09-20T12:00:00.000Z')}
              cargando={false}
              error={null}
              errorDeLanzamiento={null}
              trabajando={false}
              alLanzar={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="cargando">
            <PanelDeRuns
              proyectoId="prj_4f2a91"
              proyecto={PROYECTOS[0]}
              runs={[]}
              ahora={Date.parse('2026-09-20T12:00:00.000Z')}
              cargando
              error={null}
              errorDeLanzamiento={null}
              trabajando={false}
              alLanzar={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="vacio · activo y sin ningun ciclo todavia">
            <PanelDeRuns
              proyectoId="prj_4f2a91"
              proyecto={PROYECTOS[0]}
              runs={[]}
              ahora={Date.parse('2026-09-20T12:00:00.000Z')}
              cargando={false}
              error={null}
              errorDeLanzamiento={null}
              trabajando={false}
              alLanzar={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="error">
            <PanelDeRuns
              proyectoId="prj_4f2a91"
              proyecto={PROYECTOS[0]}
              runs={[]}
              ahora={Date.parse('2026-09-20T12:00:00.000Z')}
              cargando={false}
              error={SIN_SERVICIO}
              errorDeLanzamiento={null}
              trabajando={false}
              alLanzar={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
        </div>
      </Pantalla>

      <Pantalla
        titulo="T164 · Auditoria"
        nota="Solo lectura: en este archivo no hay ni un control que escriba. El detalle se ensena con VistaJSON, que enmascara por defecto lo que huele a secreto — mira el evento denegado."
      >
        <div className="flex flex-col gap-10">
          <Estado nombre="con datos">
            <PanelDeAuditoria
              eventos={AUDITORIA}
              cargando={false}
              error={null}
              ahora={Date.parse('2026-09-20T12:00:00.000Z')}
              hayMas
              alPedirMas={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="cargando">
            <PanelDeAuditoria
              eventos={[]}
              cargando
              error={null}
              ahora={Date.parse('2026-09-20T12:00:00.000Z')}
              hayMas={false}
              alPedirMas={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="vacio">
            <PanelDeAuditoria
              eventos={[]}
              cargando={false}
              error={null}
              ahora={Date.parse('2026-09-20T12:00:00.000Z')}
              hayMas={false}
              alPedirMas={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
          <Estado nombre="error">
            <PanelDeAuditoria
              eventos={[]}
              cargando={false}
              error={SIN_SERVICIO}
              ahora={Date.parse('2026-09-20T12:00:00.000Z')}
              hayMas={false}
              alPedirMas={SIN_EFECTO}
              navegar={navegar}
            />
          </Estado>
        </div>
      </Pantalla>
    </div>
  )
}
