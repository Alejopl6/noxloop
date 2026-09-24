// LA tabla: todas las rutas que este servicio expone, en un solo sitio.
//
// POR QUE ESTA LISTA ES EL ARTEFACTO Y NO UNA CONVENIENCIA. NFR-004 dice que
// ninguna respuesta de ningun endpoint —errores incluidos— contiene el valor de
// una credencial, y que eso se prueba serializando la respuesta y buscando un
// centinela dentro. Una prueba asi necesita ENUMERAR las rutas, y si las
// enumera desde su propia lista, la ruta numero cuarenta y uno —la que alguien
// agregue sin acordarse del test— queda fuera de la prueba. Justo esa es la que
// filtra, porque es la que nadie reviso.
//
// Por eso la tabla es dato, se exporta, y la prueba la recorre. Agregar una
// ruta la mete en la prueba automaticamente; agregarla sin meterla en la tabla
// no la hace alcanzable, porque el servidor tampoco la ve.

import { crearTabla } from "./rutas.mjs";

import * as salud from "./salud.mjs";
import * as proyectos from "./proyectos.mjs";
import * as escaneo from "./escaneo.mjs";
import * as nucleo from "./nucleo.mjs";
import * as credenciales from "./credenciales.mjs";
import * as catalogo from "./catalogo-de-conexiones.mjs";
import * as flota from "./flota.mjs";
import * as runs from "./runs.mjs";
import * as board from "./board.mjs";
import * as carpetas from "./carpetas.mjs";
import * as opciones from "./opciones.mjs";
import * as asistencia from "./asistencia.mjs";
import * as tareas from "./tareas.mjs";
import * as runtimes from "./runtimes.mjs";
import * as gestor from "./gestor.mjs";
import * as diff from "./diff.mjs";
import * as transcript from "./transcript.mjs";
import * as modoRapido from "./modo-rapido.mjs";
import * as diagnostico from "./diagnostico.mjs";

export const TABLA = crearTabla([
  // ---- Salud y sesion -----------------------------------------------------
  // `/v1/health` es lo unico publico: si exigiera token, una interfaz sin token
  // no podria ni diagnosticar por que no tiene token.
  { patron: "/v1/health", metodos: ["GET", "HEAD"], publica: true, manejar: salud.salud },
  { patron: "/v1/capabilities", metodos: ["GET", "HEAD"], manejar: salud.capacidades },
  { patron: "/v1/events", metodos: ["GET"], crudo: true, manejar: salud.eventos },

  // ---- Lo que la interfaz necesita para no pedir nada a ciegas ------------
  // Las dos contestan «¿que puedo elegir?» y las dos son `GET` y nada mas.
  // `/v1/folders` ademas LEE EL DISCO del operador: la cabecera de
  // `carpetas.mjs` razona por que se acota a un conjunto de raices en vez de
  // enumerar todo lo que haya.
  { patron: "/v1/folders", metodos: ["GET"], manejar: carpetas.explorar },
  { patron: "/v1/options", metodos: ["GET", "HEAD"], manejar: opciones.catalogoDeOpciones },

  // ---- Proyectos · etapa 00 -----------------------------------------------
  { patron: "/v1/projects", metodos: ["GET", "POST"], manejar: proyectos.lista },
  { patron: "/v1/projects/:id", metodos: ["GET", "PATCH", "DELETE"], manejar: proyectos.uno },
  // Se declara ANTES que `/v1/projects/:id` en la lectura, aunque el orden no
  // importe: la tabla pone lo literal por delante de lo parametrico al montar.
  { patron: "/v1/templates", metodos: ["GET"], manejar: proyectos.plantillas },
  // El modo rapido (spec 003, US8): las cinco etapas por sus guardas en UNA
  // decision del operador, sin escribir en su repositorio. `POST` y nada mas.
  { patron: "/v1/projects/:id/quickstart", metodos: ["POST"], manejar: modoRapido.quickstart },

  // ---- Discovery · etapa 01 -----------------------------------------------
  { patron: "/v1/projects/:id/scan", metodos: ["POST"], manejar: escaneo.arrancarEscaneo },
  { patron: "/v1/scans/:snapshot_id", metodos: ["DELETE"], manejar: escaneo.cancelarEscaneo },
  { patron: "/v1/projects/:id/snapshot", metodos: ["GET"], manejar: escaneo.snapshotVigente },
  { patron: "/v1/snapshots/:id/findings/:finding_id", metodos: ["PATCH"], manejar: escaneo.decidirHallazgo },
  { patron: "/v1/snapshots/:id/accept", metodos: ["POST"], manejar: escaneo.aceptarSnapshot },

  // ---- Constitution y guidelines · etapas 02-04 ---------------------------
  { patron: "/v1/projects/:id/constitution/propose", metodos: ["POST"], manejar: nucleo.proponer },
  { patron: "/v1/projects/:id/constitution", metodos: ["GET", "PUT"], manejar: nucleo.constitution },
  { patron: "/v1/projects/:id/constitution/amend", metodos: ["POST"], manejar: nucleo.enmendar },
  { patron: "/v1/projects/:id/guidelines/:area", metodos: ["GET", "PUT"], manejar: nucleo.guideline },
  { patron: "/v1/projects/:id/design", metodos: ["PUT"], manejar: nucleo.diseno },

  // ---- Bootstrap · etapa 05 -----------------------------------------------
  { patron: "/v1/projects/:id/bootstrap/analyze", metodos: ["POST"], manejar: nucleo.analizarBootstrap },
  // La propuesta completa —el bloque, lo que se decide solo, las preguntas y lo
  // que ya estaba— y su aprobacion en UNA decision. `analyze` sigue existiendo
  // para quien quiera el analisis crudo; esto es lo que la pantalla pide.
  { patron: "/v1/projects/:id/bootstrap/proposal", metodos: ["GET"], manejar: nucleo.propuestaDeBootstrap },
  { patron: "/v1/projects/:id/bootstrap/approve", metodos: ["POST"], manejar: nucleo.aprobarBootstrap },
  { patron: "/v1/projects/:id/recommendations", metodos: ["GET"], manejar: nucleo.recomendaciones },
  { patron: "/v1/recommendations/:id/apply", metodos: ["POST"], manejar: nucleo.aplicarRecomendacion },
  { patron: "/v1/recommendations/:id/customize", metodos: ["POST"], manejar: nucleo.personalizarRecomendacion },
  { patron: "/v1/recommendations/:id/skip", metodos: ["POST"], manejar: nucleo.omitirRecomendacion },
  { patron: "/v1/projects/:id/bootstrap/complete", metodos: ["POST"], manejar: nucleo.completarBootstrap },

  // ---- Conexiones y credenciales · etapa 06 y §12 -------------------------
  // El catalogo va ANTES que `/v1/connections/:id` en la lectura, aunque el
  // orden no importe: la tabla pone lo literal por delante de lo parametrico al
  // montar. Y es la unica ruta de conexiones que NO necesita un proyecto ni un
  // adaptador montado — «¿que puedo conectar?» es una pregunta de solo lectura
  // y no puede exigir tres contenedores levantados para contestarse.
  { patron: "/v1/connections/catalog", metodos: ["GET", "HEAD"], manejar: catalogo.catalogoDeConexiones },
  // LAS CONEXIONES DEL ESPACIO DE TRABAJO, Y ESTAS DOS RUTAS SON EL ARREGLO DE
  // UN FALLO QUE EL OPERADOR VIO EN PANTALLA. En «Anadir proyecto» ->
  // «Repositorio remoto» la pantalla decia «Sin cuenta de codigo conectada» y
  // ofrecia un boton a OTRA pantalla, porque conectar exigia un proyecto y en
  // el alta el proyecto todavia no existe. La cuenta de codigo de un operador
  // es una sola: se conecta aqui, sin proyecto, y todos sus proyectos eligen de
  // ahi.
  //
  // `authorize` es literal y le gana a `/v1/connections/:id` al montar, asi que
  // no hay forma de que una conexion llamada «authorize» se coma esta ruta.
  { patron: "/v1/connections", metodos: ["GET"], manejar: credenciales.conexionesDelEspacioDeTrabajo },
  // El registro de aplicaciones OAuth va ANTES que `/v1/connections/:id`, igual
  // que el catalogo y que `authorize`: es un patron literal y tiene que ganarle
  // al parametrico, o `oauth-apps` entraria como si fuera el id de una conexion.
  {
    patron: "/v1/connections/oauth-apps",
    metodos: ["GET", "HEAD", "POST"],
    manejar: (p) =>
      p.metodo === "POST" ? credenciales.registrarAplicacionOauth(p) : credenciales.aplicacionesOauth(p),
  },
  {
    patron: "/v1/connections/authorize",
    metodos: ["POST"],
    manejar: credenciales.autorizarConexionDelEspacioDeTrabajo,
  },
  { patron: "/v1/projects/:id/connections", metodos: ["GET"], manejar: credenciales.conexionesDelProyecto },
  { patron: "/v1/projects/:id/connections/authorize", metodos: ["POST"], manejar: credenciales.autorizarConexion },
  { patron: "/v1/connections/:id/callback", metodos: ["POST"], manejar: credenciales.callbackDeConexion },
  // Los repositorios que una conexion alcanza, para ELEGIR uno en vez de
  // escribir su direccion a mano. `GET` y nada mas: preguntar que repositorios
  // hay no cambia nada, y un `POST` aqui seria la puerta por la que el servicio
  // empieza a crear repositorios en la forja del operador.
  { patron: "/v1/connections/:id/repos", metodos: ["GET"], manejar: credenciales.repositoriosDeConexion },
  { patron: "/v1/connections/:id", metodos: ["DELETE"], manejar: credenciales.revocarConexion },
  { patron: "/v1/credentials", metodos: ["GET", "POST"], manejar: credenciales.inventario },
  { patron: "/v1/credentials/:id/rotate", metodos: ["POST"], manejar: credenciales.rotar },
  { patron: "/v1/credentials/:id/reach", metodos: ["GET"], manejar: credenciales.reach },
  { patron: "/v1/credentials/:id", metodos: ["DELETE"], manejar: credenciales.revocarCredencial },
  { patron: "/v1/grants", metodos: ["GET", "POST"], manejar: credenciales.grants },
  { patron: "/v1/grants/:id", metodos: ["DELETE"], manejar: credenciales.revocarGrant },

  // FR-049, y la lista de metodos ES el mecanismo: `GET` y nada mas. No hay
  // `POST`, no hay `PATCH`, no hay `DELETE`. No es que esten y devuelvan 403 —
  // no existen, y el 405 de esta ruta lo dice nombrando lo unico que acepta.
  // Un metodo que existe acaba llamandose.
  { patron: "/v1/audit", metodos: ["GET"], manejar: credenciales.auditoria },

  // ---- Flota · etapa 07 ---------------------------------------------------
  { patron: "/v1/projects/:id/agents", metodos: ["GET", "POST"], manejar: flota.agentesDelProyecto },
  // La flota PROPUESTA desde el snapshot. `GET` y nada mas: sugerir no guarda,
  // y un `POST` aqui seria la puerta por la que la propuesta se convierte en
  // configuracion sin que nadie la confirme.
  { patron: "/v1/projects/:id/agents/suggest", metodos: ["GET"], manejar: flota.sugerenciaDeFlota },
  { patron: "/v1/agents/:id", metodos: ["PATCH", "DELETE"], manejar: flota.unAgente },
  { patron: "/v1/projects/:id/activate", metodos: ["POST"], manejar: flota.activar },

  // ---- Bandeja ------------------------------------------------------------
  { patron: "/v1/inbox", metodos: ["GET"], manejar: flota.bandeja },
  { patron: "/v1/inbox/:id", metodos: ["GET"], manejar: flota.entradaDeBandeja },
  { patron: "/v1/inbox/:id/resolve", metodos: ["POST"], manejar: flota.resolverEntrada },
  { patron: "/v1/dashboard", metodos: ["GET"], manejar: flota.dashboard },

  // ---- Handoff al motor ---------------------------------------------------
  // Las tres LEEN archivos y los proyectan. El estado del run lo escribe el
  // motor: hay una prueba que mide el disco antes y despues de un `GET`.
  { patron: "/v1/projects/:id/runs", metodos: ["GET", "POST"], manejar: runs.runsDelProyecto },
  { patron: "/v1/runs/:id", metodos: ["GET"], manejar: runs.unRun },
  // Lo que cambio cada agente (US6, FR-029): `git log`/`git diff` sobre la rama
  // y el worktree de la tarea, SIN escribir (ni el indice: ver `diff.mjs`).
  { patron: "/v1/runs/:id/tasks/:taskId/diff", metodos: ["GET"], manejar: diff.diffDeTarea },
  // Lo que el agente fue diciendo y haciendo en cada fase (spec 004, FR-005):
  // lee los transcripts que el motor escribio, redactados, paginados. `GET` y
  // nada mas; crecer lo avisa el evento `run.transcript` (ver `transcript.mjs`).
  { patron: "/v1/runs/:id/tasks/:taskId/transcript", metodos: ["GET"], manejar: transcript.transcriptDeTarea },

  // ---- El board (spec 003) ------------------------------------------------
  // Lanzar es `POST /v1/projects/:id/runs`, arriba: desde la spec 003 arranca
  // el motor en vez de contestar `pieza_ausente`. Aprobar y reintentar son
  // `POST` sobre el run, y la interfaz no escribe nada: pide (principio VIII).
  { patron: "/v1/runs/:id/approve", metodos: ["POST"], manejar: runs.aprobarRun },
  { patron: "/v1/runs/:id/retry", metodos: ["POST"], manejar: runs.reintentarRun },
  // Las tres lecturas del board. `GET` y nada mas, y las tres miden el disco
  // antes y despues en su test: construir el board no escribe (SC-007).
  { patron: "/v1/runs", metodos: ["GET"], manejar: runs.listaDeRuns },
  { patron: "/v1/usage", metodos: ["GET"], manejar: runs.uso },
  { patron: "/v1/board", metodos: ["GET"], manejar: board.board },

  // ---- Tareas propias: el gestor local (spec 003, FR-030) -----------------
  // El servicio es su UNICO escritor (principio VIII). Las usan la interfaz
  // (crear, editar), el board (en proceso, por `puertoDeTareas`) y el MOTOR,
  // que corre como subproceso y mueve el estado de la tarea y deja el enlace al
  // PR por estas mismas rutas, con el token de sesion. DELETE solo sin run.
  { patron: "/v1/projects/:id/tasks", metodos: ["GET", "POST"], manejar: tareas.tareasDelProyecto },
  { patron: "/v1/tasks/:id", metodos: ["GET", "PATCH", "DELETE"], manejar: tareas.unaTarea },
  { patron: "/v1/tasks/:id/comments", metodos: ["POST"], manejar: tareas.comentariosDeTarea },

  // Las opciones y el mapa de estados del gestor externo del proyecto, que
  // `motor.mjs` lee de la conexion y nadie escribia (ADO y Linear quedaban en
  // `sin_gestor`). Validadas contra el `optionsSchema` del proveedor.
  { patron: "/v1/projects/:id/tracker", metodos: ["PATCH"], manejar: gestor.opcionesDelGestor },

  // ---- Settings -> Modelos: los runtimes de agente ------------------------
  // El parametro se llama `:id` y no `:runtime` A PROPOSITO: la prueba del
  // centinela concreta cada patron con ids de proyecto o inventados, y un
  // `:runtime` le dejaria el literal «runtime» — con `:id` nunca nombra un
  // runtime real, asi que recorrer la tabla no lanza `claude auth login` en la
  // maquina de quien corre los tests.
  { patron: "/v1/runtimes", metodos: ["GET"], manejar: runtimes.runtimes },
  { patron: "/v1/runtimes/:id/login", metodos: ["POST"], manejar: runtimes.iniciarSesion },
  { patron: "/v1/runtimes/:id/api-key", metodos: ["POST", "DELETE"], manejar: runtimes.claveDeRuntime },

  // ---- Diagnostico (spec 004) ---------------------------------------------
  // `GET` y nada mas, y un test mide el disco antes y despues: diagnosticar
  // LEE `~/.claude.json`, el repo y el home, y no escribe en ninguno (FR-002).
  // La confianza de Claude Code se dice como aceptarla; no se acepta desde aqui.
  { patron: "/v1/diagnostics", metodos: ["GET"], manejar: diagnostico.diagnostico },

  // ---- Asistencia con IA --------------------------------------------------
  // El catalogo contesta SIEMPRE, tambien sin clave: es con lo que la pantalla
  // decide si ofrecer el boton, y una ruta que fallara sin credencial dejaria a
  // la pantalla sin distinguir «no hay asistencia» de «el servicio no contesta».
  { patron: "/v1/assistance", metodos: ["GET", "HEAD"], manejar: asistencia.catalogoDeAsistencia },
  // `POST` y no `GET`, aunque sugerir no guarde nada: sugerir GASTA —saca una
  // credencial de la boveda, deja un evento de acceso en la auditoria y llama a
  // un servicio de fuera que cobra—. Un `GET` con eso detras se lo come
  // cualquier reintento, cualquier precarga y cualquier pestaña que se refresque.
  { patron: "/v1/projects/:id/assistance/suggest", metodos: ["POST"], manejar: asistencia.sugerir },
]);
