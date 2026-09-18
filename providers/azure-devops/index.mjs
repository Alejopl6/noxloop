// Azure DevOps Boards como gestor de tickets.
//
// FORMA. La misma que `providers/fake/index.mjs`, que es el ejemplo minimo: un
// archivo, `meta` + `capabilities()` + las funciones que las capacidades
// declaran. Lo unico que cambia es que las respuestas vienen de la API en vez
// de un objeto en memoria, y que TODO viaja por `ctx` — el PAT, la
// organizacion, el proyecto, los mapas y el cliente HTTP con reintentos.
//
// LAS DOS TRAMPAS DE ESTE GESTOR, y por que el codigo no las puede ignorar:
//
//   (a) el nombre del TIPO de work item cambia por plantilla de proceso: Agile
//       dice "User Story", Scrum "Product Backlog Item", Basic "Issue" y un
//       proceso heredado puede decir "Ticket". Un despachador que compara
//       contra "User Story" anda en Agile y en Scrum NO HACE NADA, sin error y
//       sin aviso. Por eso el nivel sale del `levelMap` de la configuracion,
//       con `default` obligatorio, y jamas de comparar un nombre.
//   (b) los estados tambien cambian por plantilla (Active/Resolved en Agile,
//       Committed en Scrum, Doing en Basic). Ninguno se escribe de memoria:
//       salen del `stateMap`, y un canonico que el proyecto no tiene se declara
//       null y no se escribe.
//
// PARA ENLAZAR UN PR DE GITHUB va una relacion `Hyperlink`, no un enlace de
// artefacto: `GET /_apis/wit/artifactlinktypes` devuelve 16 tipos y ninguno es
// de GitHub — el unico de PR es `PullRequestId`, que es Azure Repos. Existe un
// tipo "GitHub Pull Request", pero la doc avisa que solo sirve "for
// repositories connected to Azure Boards", o sea que exige la conexion
// Boards-GitHub y no es portable.
//
// LAS ESCRITURAS VAN CON `op: "test"` SOBRE `/rev`. Es el control de
// concurrencia optimista que aparece en todos los ejemplos oficiales: si otra
// persona movio el ticket entre la lectura y la escritura, el gestor responde
// 409 y el proveedor lanza, en vez de pisar el cambio ajeno.

import { NotSupportedError } from "../contract.mjs";

export const meta = { name: "azure-devops", version: "1.0.0" };

// UNA sola variable de entorno, y con el nombre que documenta Microsoft para
// pasar un PAT de forma no interactiva ("Set the AZURE_DEVOPS_EXT_PAT
// environment variable and run CLI commands without using az devops login").
// Usar el nombre oficial evita que quien adopte el proyecto tenga que exportar
// la misma credencial dos veces si ya tiene la CLI configurada.
//
// Todo lo demas —organizacion, proyecto, equipo, mapas, api-versions— es
// CONFIGURACION y llega por `ctx.options`: ningun nombre propio en el codigo.
export const requiredEnv = ["AZURE_DEVOPS_EXT_PAT"];

/**
 * Las diez, todas en true. Azure DevOps tiene jerarquia nativa, dependencias
 * nativas aciclicas, transiciones, comentarios, hipervinculos, etiquetas,
 * consultas WIQL y campos de tablero comunes.
 *
 * Que ninguna este en false significa que este proveedor NO ejercita ningun
 * camino degradado de la tabla del contrato: el que prueba la degradacion es el
 * proveedor falso, que tiene cinco en false. Si alguien quiere probar la
 * degradacion con este gestor, se hace con un segundo juego de fixtures que
 * declare capacidades reducidas — nunca bajando a false una capacidad que el
 * gestor si tiene, porque eso apaga trabajo real.
 */
export function capabilities() {
  return {
    // Los hijos vienen en el array `relations` del propio getItem con
    // `$expand=all`: no hay un viaje extra ni un endpoint de hijos.
    children: true,
    // `System.LinkTypes.Dependency-*`, topology dependency y `acyclic: true`:
    // el gestor rechaza ciclos, asi que el DAG llega sin lazos y el motor no
    // tiene que deducir nada.
    dependencies: true,
    // El hijo nace ya colgado del padre, en un solo POST: no hay una segunda
    // escritura que pueda quedar a medias y dejar un huerfano.
    createChild: true,
    setState: true,
    comment: true,
    linkUrl: true,
    // `System.Tags` es UN campo String separado por punto y coma, asi que
    // agregar una etiqueta es leer-modificar-escribir.
    labels: true,
    searchAssigned: true,
    // OJO, es una capacidad CON VENTANA: el macro `@RecentMentions` solo mira
    // los ultimos 30 dias. Un daemon caido una semana no pierde nada; uno
    // caido un mes si. No es una capacidad a medias, pero el que la use tiene
    // que saber que el disparo por mencion no es memoria infinita.
    searchMentioned: true,
    // Iteracion, area y responsable son campos comunes de todo work item y se
    // escriben en el MISMO patch que crea el hijo: la herencia de campos de
    // tablero no cuesta un viaje aparte.
    boardFields: true,
    identityAssignee: true,  // WIQL acepta cualquier valor en [System.AssignedTo]
  };
}

/**
 * Lo que este proveedor acepta en `provider.options`.
 *
 * `organization`, `project` y `team` son `required` porque el codigo ya los
 * EXIGE con `exigir()` a mitad de la primera llamada: declararlos aca mueve ese
 * error al arranque, que es lo que pide T114.
 */
export const optionsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["organization", "project"],
  properties: {
    organization: { type: "string", description: "La organizacion de Azure DevOps." },
    project: { type: "string", description: "El proyecto donde viven los work items." },
    team: { type: "string", description: "El equipo, para las consultas que lo necesitan." },
    baseUrl: { type: "string", description: "Para instalaciones on-premise. Por omision, dev.azure.com." },
    childType: { type: "string", description: "El tipo de work item que se crea como hija." },
    wiql: {
      type: "object",
      additionalProperties: false,
      description: "Consultas WIQL propias, que ganan sobre las que arma el proveedor.",
      properties: { assigned: { type: "string" }, mentioned: { type: "string" } },
    },
  },
};

// ------------------------------------------------------------------ mapas

/**
 * El mapa de tipos de las cuatro plantillas de sistema, que se usa SOLO si la
 * configuracion no declara `levelMap`. El mapa de la configuracion gana
 * siempre: un proyecto con proceso heredado puede tener un tipo custom
 * ("Ticket" aparece asi en el ejemplo oficial de backlogconfiguration,
 * conviviendo con "User Story" en el MISMO nivel de requerimiento).
 *
 * Basic no tiene nivel Feature, y eso no es un hueco: es la plantilla.
 */
const NIVELES_POR_DEFECTO = {
  Epic: "epic",
  Feature: "feature",
  "User Story": "story",          // Agile
  "Product Backlog Item": "story", // Scrum
  Issue: "story",                  // Basic
  Requirement: "story",            // CMMI
  Bug: "story",                    // segun `bugsBehavior` del proyecto puede ser task
  Task: "task",
  default: "story",
};

/** Nombres de referencia de los campos. Ninguno se escribe suelto mas abajo. */
const F = {
  tipo: "System.WorkItemType",
  titulo: "System.Title",
  estado: "System.State",
  descripcion: "System.Description",
  padre: "System.Parent",
  etiquetas: "System.Tags",
  iteracion: "System.IterationPath",
  area: "System.AreaPath",
  responsable: "System.AssignedTo",
  criterios: "Microsoft.VSTS.Common.AcceptanceCriteria",
};

/**
 * Los `rel` de las relaciones, en minusculas porque asi se comparan al LEER.
 *
 * EL FALLO QUE EVITA COMPARAR EN MINUSCULAS: el catalogo
 * `workitemrelationtypes` dice `System.LinkTypes.Dependency-Forward` con F
 * mayuscula y el ejemplo "Add a link" de la pagina Update escribe
 * `Dependency-forward` con f minuscula. La doc se contradice consigo misma y no
 * dice si la comparacion es insensible. Al leer se compara en minusculas (no
 * cuesta nada y cubre las dos formas) y al ESCRIBIR se usa la forma canonica
 * del catalogo, que es la de `REL_ESCRITURA`.
 *
 * Y EL PAR NO VA INVERTIDO: `Dependency-Forward` es **Successor**
 * (`isForward: true`) y `Dependency-Reverse` es **Predecessor**, confirmado en
 * `workitemrelationtypes` con `isForward` y `oppositeEndReferenceName`.
 * Escrito al reves, `dependencies` devolveria el DAG invertido y el motor
 * serializaria al reves sin que nada falle: el fallo silencioso exacto que el
 * contrato existe para atajar.
 */
const REL = {
  hijo: "system.linktypes.hierarchy-forward",
  padre: "system.linktypes.hierarchy-reverse",
  sucesor: "system.linktypes.dependency-forward",
  predecesor: "system.linktypes.dependency-reverse",
  hipervinculo: "hyperlink",
};

const REL_ESCRITURA = {
  padre: "System.LinkTypes.Hierarchy-Reverse",
  hipervinculo: "Hyperlink",
};

/**
 * El mapeo canonico de nivel es por CATEGORIA de backlog, que es estable, y no
 * por nombre de tipo, que no lo es, ni por `rank`, que no es de fiar: la
 * definicion de `BacklogLevelConfiguration` dice "Taskbacklog is 0" y el
 * ejemplo de la misma pagina muestra `rank: 1`.
 */
const CATEGORIA_A_NIVEL = {
  "microsoft.taskcategory": "task",
  "microsoft.requirementcategory": "story",
  "microsoft.featurecategory": "feature",
  "microsoft.epiccategory": "epic",
};

const MAX_BATCH = 200; // lo dice el titulo del endpoint: "Maximum 200"

/** Las consultas WIQL por defecto. El proyecto entra por el macro `@project`. */
const WIQL_POR_DEFECTO = {
  assigned:
    "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project " +
    "AND [System.AssignedTo] = @Me AND [System.State] <> ''",
  // `@RecentMentions` solo es valido con el campo ID y los operadores In/Not In.
  mentioned:
    "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project " +
    "AND [System.Id] IN @RecentMentions",
};

/** WIQL escapa una comilla simple duplicandola. */
const comillar = (v) => `'${String(v).replaceAll("'", "''")}'`;

/**
 * Las consultas de la bandeja, con el responsable declarado si lo hay.
 *
 * EL FALLO QUE CIERRA. `identity.assignee` estaba en el esquema y ADOPTING
 * decia que lo consumen `inbox` y `daemon`, pero la consulta preguntaba por
 * `@Me` —el dueño del token— asi que declarar otro responsable no cambiaba nada
 * y tampoco avisaba. Donde noxloop corre con una cuenta de servicio y los
 * tickets se asignan a OTRO usuario, la bandeja quedaba muda sin decir por que.
 *
 * `identity.mention` NO se usa: las menciones salen de `@RecentMentions`, que
 * es del dueño del token y Azure DevOps no acepta pedirlas de otra persona. Eso
 * se declara en `capabilities()` en vez de fingir que funciona.
 *
 * @param {object} o `provider.options`
 * @param {{assignee?: string|null, mention?: string|null}} identity
 */
export function consultasDeBandeja(o = {}, identity = {}) {
  const base = { ...WIQL_POR_DEFECTO };
  if (identity?.assignee) {
    base.assigned =
      "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project " +
      `AND [System.AssignedTo] = ${comillar(identity.assignee)} AND [System.State] <> ''`;
  }
  // Un `wiql` propio gana sobre todo: es la salida para una consulta que no
  // anticipamos, y quien la escribe ya sabe a quien esta preguntando.
  return { ...base, ...(o.wiql || {}) };
}

// --------------------------------------------------------------- plomeria

function exigir(valor, nombre) {
  if (valor === undefined || valor === null || valor === "") {
    throw new Error(
      `falta "${nombre}" en la configuracion del proveedor (provider.options.${nombre}): ` +
        `es configuracion y no se adivina`,
    );
  }
  return String(valor);
}

const opciones = (ctx) => (ctx && ctx.options) || {};

function versionApi(ctx) {
  return opciones(ctx).apiVersion || "7.1";
}

/**
 * Arma una URL de la API.
 *
 * `alcance` dice hasta donde llega la ruta, porque no todas las operaciones
 * viven en el mismo nivel: `workitemrelationtypes` es de organizacion,
 * `comments` y `wiql` EXIGEN proyecto, `getItem` lo acepta opcional, y
 * `backlogconfiguration` necesita equipo.
 *
 * La query se arma a mano y no con URLSearchParams porque `$expand` y
 * `$top` llevan un `$` que URLSearchParams escapa a `%24`.
 */
function urlApi(ctx, alcance, ruta, params = {}) {
  const o = opciones(ctx);
  const base = String(o.baseUrl || "https://dev.azure.com").replace(/\/+$/, "");
  const segmentos = [base, encodeURIComponent(exigir(o.organization, "organization"))];
  if (alcance === "project" || alcance === "team") {
    segmentos.push(encodeURIComponent(exigir(o.project, "project")));
  }
  if (alcance === "team") segmentos.push(encodeURIComponent(exigir(o.team, "team")));

  const todos = { ...params };
  if (!("api-version" in todos)) todos["api-version"] = versionApi(ctx);
  const query = Object.entries(todos)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  return `${segmentos.join("/")}/${ruta}?${query}`;
}

/** El alcance de una lectura de work item: con proyecto si esta declarado. */
const alcanceLectura = (ctx) => (opciones(ctx).project ? "project" : "org");

/**
 * La cabecera de autenticacion: PAT por Basic con usuario VACIO. La doc lo
 * muestra como `curl -u :{PAT}` y como
 * `Convert.ToBase64String(ASCII.GetBytes(string.Format("{0}:{1}", "", pat)))`,
 * o sea que la mitad del usuario es cadena vacia.
 *
 * El PAT llega por `ctx.env` y NO por `process.env`: es lo que hace que este
 * proveedor se pueda probar sin credenciales, y lo verifica el chequeo 8 de la
 * suite leyendo este fuente.
 *
 * NO se valida el formato del PAT (hoy miden 84 caracteres con la firma `AZDO`
 * en las posiciones 76-80). Un PAT de otra epoca, o un token de Entra ID, no
 * tienen por que cumplirlo, y rechazar localmente una credencial que el gestor
 * aceptaria es peor que gastar un viaje para enterarse. Lo unico que se
 * verifica es que exista.
 */
function cabeceras(ctx, extra = {}) {
  const pat = ctx && ctx.env ? ctx.env.AZURE_DEVOPS_EXT_PAT : null;
  if (!pat) {
    throw new Error(
      "falta AZURE_DEVOPS_EXT_PAT en ctx.env: el PAT lo inyecta el motor desde el entorno, " +
        "y el proveedor no lo lee por su cuenta. Scopes minimos: vso.work para leer, vso.work_write para escribir",
    );
  }
  return {
    Authorization: `Basic ${Buffer.from(`:${pat}`).toString("base64")}`,
    Accept: "application/json",
    ...extra,
  };
}

/**
 * El mensaje TEXTUAL del gestor. Nunca se resume a "no se pudo".
 *
 * Recibe el cuerpo ya leido y no la respuesta: el cuerpo de una `Response` se
 * puede consumir UNA sola vez, y `pedir` lo necesita para decidir si la
 * respuesta era JSON.
 */
function mensajeDelGestor(cuerpo, status) {
  if (!cuerpo) return `(sin cuerpo, status ${status})`;
  try {
    const json = JSON.parse(cuerpo);
    return json.message || json.value?.Message || cuerpo;
  } catch {
    return cuerpo;
  }
}

/** Un pedazo del cuerpo, en una linea, para que quepa en un mensaje de error. */
const recortar = (texto, n = 200) => {
  const linea = String(texto).replace(/\s+/g, " ").trim();
  return linea.length > n ? `${linea.slice(0, n)}…` : linea;
};

/**
 * Un viaje a la API por `ctx.fetch`, que es el que reintenta con espera y
 * respeta el limite de tasa. Si el limite persiste, `ctx.fetch` devuelve la
 * ultima respuesta y el proveedor LANZA con el mensaje del gestor: el motor
 * detiene el recorrido con la causa real y no marca nada como terminado.
 *
 * No se verifico la politica de rate limiting ni las cabeceras que la anuncian
 * (`Retry-After`, `X-RateLimit-*`). El contrato pone los reintentos dentro de
 * `ctx.fetch`, asi que el proveedor no tiene que resolverlo; el presupuesto por
 * organizacion queda sin afirmar.
 *
 * @param {any} ctx
 * @param {{method?: string, url: string, body?: any, contentType?: string, aceptar404?: boolean}} pedido
 */
async function pedir(ctx, { method = "GET", url, body, contentType, aceptar404 = false }) {
  const init = { method, headers: cabeceras(ctx, contentType ? { "Content-Type": contentType } : {}) };
  if (body !== undefined) init.body = JSON.stringify(body);

  const res = await ctx.fetch(url, init);
  // El 404 no esta en la tabla de Responses de la pagina de referencia, que
  // documenta solo el 200. Que un id inexistente responda 404 con un cuerpo
  // `TF401232: Work item ... does not exist` esta observado pero no
  // documentado; el contrato exige devolver null sin lanzar, asi que se trata
  // el 404 como "no existe" y cualquier otro >= 400 como fallo.
  if (res.status === 404 && aceptar404) return null;

  // El cuerpo se lee como TEXTO y se parsea a mano, y no con `res.json()`.
  //
  // EL FALLO QUE EVITA. `res.json()` sobre un cuerpo que no es JSON lanza
  // `SyntaxError: Unexpected token '<'`, un error de parseo que no nombra el
  // metodo, ni la URL, ni el status, y que el motor recibe como si el
  // proveedor tuviera un bug. Y hay dos respuestas reales que caen ahi con
  // status 200: el cuerpo VACIO, y la pagina de login en HTML que devuelve la
  // puerta de entrada de Azure DevOps cuando la credencial no sirve y el
  // pedido termina en la interfaz web en vez de la API. La primera es "no
  // existe" (null, que es lo que el contrato pide) y la segunda es un fallo
  // que tiene que lanzar con la causa real.
  let cuerpo = "";
  try {
    cuerpo = await res.text();
  } catch {
    cuerpo = "";
  }

  if (res.status >= 400) {
    throw new Error(`${method} ${url} -> ${res.status}: ${mensajeDelGestor(cuerpo, res.status)}`);
  }
  // Cubre el 204 y el 200 con cuerpo vacio, que es el que salia como SyntaxError.
  if (!cuerpo.trim()) return null;
  try {
    return JSON.parse(cuerpo);
  } catch {
    throw new Error(
      `${method} ${url} -> ${res.status}: la respuesta no es JSON (¿la credencial sirve?): ${recortar(cuerpo)}`,
    );
  }
}

const PATCH = "application/json-patch+json";

// -------------------------------------------------------------- traduccion

/**
 * Los campos de texto de Azure DevOps son HTML (`System.Description`,
 * `Microsoft.VSTS.Common.AcceptanceCriteria`). El modelo canonico quiere texto
 * y `acceptance` quiere una linea por criterio: pasarle `<div>` y `<br>` a un
 * planificador produce criterios que nadie puede convertir en un test.
 */
function textoDeHtml(html) {
  if (!html) return "";
  return String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

const lineasDeHtml = (html) =>
  textoDeHtml(html)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/**
 * La vuelta de `textoDeHtml`, para los campos que el gestor guarda como HTML.
 *
 * Escapar no es cosmetica: sin escapar, un criterio que diga "a < b" se lo come
 * el `replace(/<[^>]*>/g, "")` de la lectura de vuelta, y un `<b>` que venga en
 * el texto queda interpretado en el tablero. Escapar al escribir y decodificar
 * al leer hace que el ida y vuelta sea exacto.
 */
const aHtml = (texto) =>
  String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Los criterios de aceptacion, listos para el campo HTML.
 *
 * `Item.acceptance` es un ARRAY en el modelo canonico —asi lo devuelve
 * `getItem`, una linea por criterio—, y la escritura hacia `String(acceptance)`:
 * `String(["a","b"])` es `"a,b"`. El ida y vuelta perdia la separacion de
 * criterios, que es lo unico que un planificador puede convertir en un test. Se
 * aceptan las dos formas, array y string, y se separan con `<br>`, que es lo que
 * `lineasDeHtml` vuelve a leer como lineas.
 */
const criteriosAHtml = (acceptance) =>
  (Array.isArray(acceptance) ? acceptance : String(acceptance).split("\n"))
    .map((l) => String(l).trim())
    .filter(Boolean)
    .map(aHtml)
    .join("<br>");

function mapaNiveles(ctx) {
  return opciones(ctx).levelMap || NIVELES_POR_DEFECTO;
}

/**
 * El nivel canonico de un tipo nativo. Sale del MAPA, con `default` explicito.
 *
 * Un mapa declarado sin `default` se rechaza en vez de inventar uno: la entrada
 * por defecto es lo que hace que un tipo custom de un proceso heredado caiga en
 * un nivel conocido en vez de voltear el recorrido, y un mapa a medias es
 * justamente el que no lo cubre.
 */
function nivelDe(tipoNativo, ctx) {
  const mapa = mapaNiveles(ctx);
  if (!("default" in mapa)) {
    throw new Error(
      'el levelMap del proveedor no declara la entrada "default", que es obligatoria: ' +
        "sin ella un tipo de work item que el mapa no conozca no tiene nivel",
    );
  }
  const clave = String(tipoNativo || "");
  if (clave in mapa) return mapa[clave];
  const porMinusculas = Object.keys(mapa).find((k) => k.toLowerCase() === clave.toLowerCase());
  return porMinusculas ? mapa[porMinusculas] : mapa.default;
}

/** El primer tipo nativo que el mapa pone en un nivel. Para crear hijos. */
function tipoNativoDeNivel(nivel, ctx) {
  const mapa = mapaNiveles(ctx);
  const entrada = Object.entries(mapa).find(([k, v]) => k !== "default" && v === nivel);
  return entrada ? entrada[0] : null;
}

/** El nombre nativo de un estado canonico, o null si el proyecto no lo tiene. */
function nativoDeEstado(canonico, ctx) {
  const mapa = opciones(ctx).stateMap || {};
  return mapa[canonico] || null;
}

/**
 * El canonico de un estado nativo. Si el mapa no lo declara devuelve **null**,
 * no "todo": un item en `Removed` o `Closed` reportado como `todo` es un item
 * que el motor vuelve a despachar.
 */
function canonicoDeEstado(nativo, ctx) {
  const mapa = opciones(ctx).stateMap || {};
  const entrada = Object.entries(mapa).find(
    ([, v]) => v && String(v).toLowerCase() === String(nativo || "").toLowerCase(),
  );
  return entrada ? entrada[0] : null;
}

/** El id de un work item es el ultimo segmento de la url de la relacion. */
function idDeUrl(url) {
  const limpia = String(url || "").split("?")[0].replace(/\/+$/, "");
  const ultimo = limpia.split("/").pop();
  return ultimo || "";
}

// `Array.isArray` y no `|| []`: un `relations` que llega como objeto —o como
// cualquier cosa que no sea una lista— salia como `TypeError: .filter is not a
// function`, que el motor recibe como un bug del proveedor y no como una
// respuesta rara del gestor.
const relaciones = (crudo, clave) =>
  (Array.isArray(crudo.relations) ? crudo.relations : []).filter(
    (r) => r && String(r.rel || "").toLowerCase() === clave,
  );

/**
 * Los ids de un tipo de relacion, SIN repetidos.
 *
 * El `rel` de dependencia lo escribe la doc de dos maneras
 * (`Dependency-Forward` y `Dependency-forward`), asi que dos relaciones que son
 * el MISMO arco pueden llegar con distinto casing, y la url puede traer o no la
 * query. Contado dos veces, el motor serializa una espera que no existe.
 */
const idsDeRelaciones = (crudo, clave) => [
  ...new Set(relaciones(crudo, clave).map((r) => idDeUrl(r.url)).filter(Boolean)),
];

/**
 * La URL HUMANA del work item, que es `_links.html.href`. `url` en la respuesta
 * es la de la API: pegada en un PR le da a una persona un JSON.
 *
 * Si `_links` no vino (una respuesta sin `$expand`), se cae a la url de la API
 * antes que armar una de la UI a mano: una URL inventada que un dia cambie de
 * forma es peor que una fea que el gestor si devolvio. Por eso todas las
 * lecturas de este proveedor piden `$expand=all`.
 */
const urlHumana = (crudo) => crudo._links?.html?.href || crudo.url || "";

/** IdentityRef -> el identificador estable. `displayName` cambia cuando la
 * persona se cambia el nombre; `uniqueName` es el que se puede comparar. */
function responsableDe(identidad) {
  if (!identidad) return null;
  if (typeof identidad === "string") return identidad;
  return identidad.uniqueName || identidad.displayName || identidad.id || null;
}

/** Un WorkItem de la API -> el Item canonico del contrato. */
function aItem(crudo, ctx) {
  // Un 200 cuyo cuerpo es JSON pero no es un work item —sin `id`— producia
  // `String(undefined)`, o sea el id "undefined": un string NO VACIO, que pasa
  // el `validateItem` del contrato y se persiste en el estado del recorrido
  // como si fuera un ticket. No es "no existe" (eso es el 404 y el cuerpo
  // vacio, y los dos devuelven null): es una respuesta rota, y lanza.
  if (crudo.id === undefined || crudo.id === null || crudo.id === "") {
    throw new Error(
      `el gestor contesto un cuerpo sin "id", asi que no es un work item: ${recortar(JSON.stringify(crudo))}`,
    );
  }
  const f = crudo.fields || {};
  const padrePorCampo = f[F.padre] != null ? String(f[F.padre]) : null;
  const padrePorRelacion = idsDeRelaciones(crudo, REL.padre)[0] || null;

  return {
    // String SIEMPRE. Azure DevOps devuelve el id como numero, y un numero
    // rompe toda comparacion contra el estado persistido en disco.
    id: String(crudo.id),
    key: `#${crudo.id}`,
    title: f[F.titulo] || "",
    body: textoDeHtml(f[F.descripcion]),
    acceptance: lineasDeHtml(f[F.criterios]),
    level: nivelDe(f[F.tipo], ctx),
    state: f[F.estado] || null,
    canonicalState: canonicoDeEstado(f[F.estado], ctx),
    assignee: responsableDe(f[F.responsable]),
    parentId: padrePorCampo || padrePorRelacion,
    labels: String(f[F.etiquetas] || "")
      .split(";")
      .map((t) => t.trim())
      .filter(Boolean),
    url: urlHumana(crudo),
    boardFields: {
      iterationPath: f[F.iteracion] || null,
      areaPath: f[F.area] || null,
      assignedTo: responsableDe(f[F.responsable]),
    },
    // `raw` lleva el `rev`, que es lo que necesitan las escrituras para el
    // `op: "test"` sobre `/rev`.
    raw: crudo,
  };
}

/**
 * La UNICA lectura de un work item, con `$expand=all`.
 *
 * Una sola forma de leer a proposito: el 404, el `rev` para las escrituras, las
 * relaciones de jerarquia y las de dependencia salen todas de aca. Tener dos
 * lecturas distintas (una con relaciones y otra sin) es como una de las dos se
 * queda sin el manejo del 404.
 */
function leerCrudo(id, ctx, { aceptar404 = true } = {}) {
  const url = urlApi(ctx, alcanceLectura(ctx), `_apis/wit/workitems/${encodeURIComponent(String(id))}`, {
    $expand: "all", // {None, Relations, Fields, Links, All}
  });
  return pedir(ctx, { url, aceptar404 });
}

/** Como `leerCrudo`, pero para una escritura: aca "no existe" SI es un fallo. */
async function leerParaEscribir(id, ctx) {
  const crudo = await leerCrudo(id, ctx, { aceptar404: true });
  if (!crudo) throw new Error(`el work item ${id} no existe (o el PAT no tiene permiso para leerlo)`);
  return crudo;
}

/**
 * Una operacion de JSON Patch. `op` es uno de {add, remove, replace, move,
 * copy, test}; de esos, este proveedor solo usa `add` y `test`.
 *
 * @typedef {{op: string, path: string, value?: any, from?: any}} OpParche
 */

/**
 * El PATCH de un work item, siempre con el control de concurrencia adelante.
 *
 * @param {string|number} id
 * @param {number} rev
 * @param {OpParche[]} ops
 * @param {any} ctx
 */
function parchear(id, rev, ops, ctx) {
  // EL FALLO QUE EVITA ESTA GUARDA. `{op: "test", path: "/rev", value: undefined}`
  // pierde el `value` al serializar: `JSON.stringify` borra las claves
  // undefined. La operacion sale como un `test` sin valor, el control de
  // concurrencia optimista se apaga, y la escritura pisa el cambio ajeno sin
  // que el gestor tenga con que contestar 409 — el fallo silencioso que el
  // `op: "test"` existe para atajar, escondido dentro de la guarda misma.
  const revision = Number(rev);
  if (!Number.isInteger(revision)) {
    throw new Error(
      `el work item ${id} llego sin un "rev" entero (${JSON.stringify(rev)}), y sin el no hay control de ` +
        `concurrencia: escribir igual seria pisar en silencio el cambio de otra persona`,
    );
  }
  const url = urlApi(ctx, "project", `_apis/wit/workitems/${encodeURIComponent(String(id))}`);
  return pedir(ctx, {
    method: "PATCH",
    url,
    contentType: PATCH,
    body: [{ op: "test", path: "/rev", value: revision }, ...ops],
  });
}

/**
 * Hidrata ids en Items. WIQL y el array de relaciones devuelven ids y nada mas
 * ("The API only returns work item IDs, regardless of which fields you include
 * in the SELECT statement"), asi que la hidratacion no es una optimizacion:
 * es el unico modo de tener titulo, tipo y estado.
 *
 * Se pide `$expand: "all"` y NO la lista `fields`. El ejemplo documentado pasa
 * las dos cosas juntas, pero con `fields` la respuesta no trae `_links`, y sin
 * `_links.html.href` el Item de un hijo se quedaria sin URL humana o habria que
 * armarla a mano. Falta confirmar si `fields` y `$expand` se pueden combinar de
 * verdad; si algun dia hay que recortar el payload, se pasa
 * `fields: ["System.Id","System.Title","System.WorkItemType","System.State"]`
 * y se acepta que la URL del hijo sea la de la API.
 *
 * `errorPolicy: "omit"` porque un id borrado entre la lectura de relaciones y
 * la hidratacion no puede voltear el recorrido entero: con "fail" un solo hijo
 * eliminado hace fallar el lote completo.
 */
async function hidratar(ids, ctx) {
  const unicos = [...new Set(ids.map(String))].filter(Boolean);
  if (unicos.length === 0) return [];

  // El endpoint de lote toma ENTEROS. `Number("no-es-un-entero")` es NaN y
  // `JSON.stringify` lo manda como `null`: el gestor contesta un 400 que no
  // nombra el id culpable, y quien lee el error no tiene de donde agarrarse.
  // Se nombra aca, donde se sabe cual era.
  const enteros = unicos.map((n) => {
    const v = Number(n);
    if (!Number.isInteger(v)) {
      throw new Error(
        `el id "${n}" no es un entero y el endpoint de lote solo acepta enteros: ` +
          `vino de una relacion o de una consulta WIQL de este proyecto`,
      );
    }
    return v;
  });

  const url = urlApi(ctx, "project", "_apis/wit/workitemsbatch");
  const items = [];
  for (let i = 0; i < enteros.length; i += MAX_BATCH) {
    const lote = enteros.slice(i, i + MAX_BATCH);
    const r = await pedir(ctx, {
      method: "POST",
      url,
      contentType: "application/json",
      body: { ids: lote, $expand: "all", errorPolicy: "omit" },
    });
    for (const crudo of r?.value || []) items.push(aItem(crudo, ctx));
  }
  return items;
}

// -------------------------------------------------------------- interfaz

export async function getItem(id, ctx) {
  const crudo = await leerCrudo(id, ctx);
  // "No existe" es una RESPUESTA, no un fallo.
  if (!crudo) return null;
  return aItem(crudo, ctx);
}

/**
 * Los hijos salen del MISMO getItem: no hay endpoint de hijos, y no hace falta
 * — con `$expand=all` las relaciones ya vienen. Se filtra por
 * `System.LinkTypes.Hierarchy-Forward` (nombre amigable "Child", topology tree,
 * `isForward: true`) y el id es el ultimo segmento de `relation.url`.
 *
 * La alternativa recursiva es una WIQL `FROM workitemLinks ... MODE (Recursive)`,
 * que devuelve `workItemRelations` y NADA de campos: dos viajes para lo mismo.
 * Aca alcanza un nivel de hijos, que es lo que el motor pide para un hito.
 */
export async function children(id, ctx) {
  const crudo = await leerCrudo(id, ctx);
  if (!crudo) return [];
  const ids = idsDeRelaciones(crudo, REL.hijo);
  if (ids.length === 0) return [];
  return hidratar(ids, ctx);
}

/**
 * Las dependencias salen tambien del mismo getItem, y a proposito no de una
 * consulta de enlaces: la pagina de sintaxis WIQL lista como valores validos de
 * `[System.Links.LinkType]` a `Dependency-Predecessor` y `Dependency-Successor`,
 * y en un ejemplo de la MISMA pagina usa `-Reverse` y `-Forward`. No pude
 * resolver cual anda, y leer `relations` no obliga a apostar a un nombre que la
 * doc escribe de dos maneras.
 */
export async function dependencies(id, ctx) {
  const crudo = await leerCrudo(id, ctx);
  if (!crudo) return { predecessors: [], successors: [] };
  return {
    predecessors: idsDeRelaciones(crudo, REL.predecesor),
    successors: idsDeRelaciones(crudo, REL.sucesor),
  };
}

/**
 * Mueve el ticket al nombre NATIVO que diga el stateMap.
 *
 * Un canonico que este proyecto no tiene devuelve `written: null` y no gasta un
 * viaje: inventar el nombre nativo es como se mueve un ticket a un estado que
 * no existe en su plantilla. `in_review` nulo es normal —Basic no tiene ningun
 * estado en la categoria Resolved— y el motor nunca pide `done`.
 */
export async function setState(id, canonicalState, ctx) {
  const nativo = nativoDeEstado(canonicalState, ctx);
  if (!nativo) return { written: null, skipped: canonicalState };

  const crudo = await leerParaEscribir(id, ctx);
  const r = await parchear(id, crudo.rev, [{ op: "add", path: `/fields/${F.estado}`, value: nativo }], ctx);
  return { written: nativo, rev: r?.rev ?? null };
}

/**
 * Un comentario.
 *
 * La api-version es `7.0-preview.3` y sale de `provider.options`: esta
 * operacion NO tiene pagina 7.1 ni 7.2 —las dos redirigen a la de 7.0, que
 * declara obligatorio `7.0-preview.3`—. En la practica circula
 * `7.1-preview.4`, pero no esta confirmado contra la doc oficial, asi que el
 * codigo usa el unico valor documentado y deja el string en configuracion para
 * poder moverlo sin tocar codigo cuando Microsoft publique el GA.
 *
 * Aca el proyecto es OBLIGATORIO en la ruta, a diferencia de getItem.
 */
export async function comment(id, text, ctx) {
  const url = urlApi(ctx, "project", `_apis/wit/workItems/${encodeURIComponent(String(id))}/comments`, {
    "api-version": opciones(ctx).commentApiVersion || "7.0-preview.3",
  });
  const r = await pedir(ctx, { method: "POST", url, contentType: "application/json", body: { text } });
  // En la definicion el campo se llama `id` y en el ejemplo `commentId`: se
  // aceptan los dos antes que devolver undefined.
  const idComentario = r?.commentId ?? r?.id;
  return { id: idComentario != null ? String(idComentario) : null };
}

/**
 * Adjunta la URL del PR como relacion `Hyperlink`.
 *
 * `attributes.comment` lleva el titulo. El ejemplo oficial "Add a link" pasa
 * `attributes: {comment}` pero es un workItemLink; el ejemplo "Add a hyperlink"
 * pasa solo `rel` y `url`. Falta confirmar, contra un proyecto real, que una
 * relacion Hyperlink acepte `comment`: si el gestor lo rechaza, se pierde el
 * titulo pero no el enlace, y se arregla borrando `attributes`.
 *
 * Si la URL ya esta entre las relaciones no se vuelve a escribir: Azure DevOps
 * rechaza una relacion duplicada con un 400, y un recorrido relanzado moriria
 * en el paso mas inocente que tiene.
 */
export async function linkUrl(id, url, title, ctx) {
  const crudo = await leerParaEscribir(id, ctx);
  const yaEsta = relaciones(crudo, REL.hipervinculo).some((r) => String(r.url) === String(url));
  if (yaEsta) return { ok: true, alreadyExisted: true };

  /** @type {{rel: string, url: string, attributes?: {comment: string}}} */
  const value = { rel: REL_ESCRITURA.hipervinculo, url: String(url) };
  if (title) value.attributes = { comment: String(title) };
  await parchear(id, crudo.rev, [{ op: "add", path: "/relations/-", value }], ctx);
  return { ok: true };
}

/**
 * Agrega una etiqueta.
 *
 * `System.Tags` NO es un array: es UN campo String con las etiquetas separadas
 * por punto y coma, asi que esto es leer-modificar-escribir. La doc no dice si
 * un `op: add` con un solo valor reemplaza el campo o lo fusiona (el ejemplo
 * oficial escribe la lista completa, `"Tag1; Tag2"`); se asume que REEMPLAZA,
 * que es correcto en los dos casos. Lo contrario borra etiquetas ajenas.
 */
export async function addLabel(id, label, ctx) {
  const crudo = await leerParaEscribir(id, ctx);
  const actuales = String(crudo.fields?.[F.etiquetas] || "")
    .split(";")
    .map((t) => t.trim())
    .filter(Boolean);
  if (actuales.some((t) => t.toLowerCase() === String(label).toLowerCase())) {
    return { ok: true, alreadyExisted: true };
  }
  const value = [...actuales, String(label)].join("; ");
  await parchear(id, crudo.rev, [{ op: "add", path: `/fields/${F.etiquetas}`, value }], ctx);
  return { ok: true, tags: value };
}

/**
 * Crea un ticket hijo YA COLGADO del padre, en un solo POST.
 *
 * El `$` antes del tipo es LITERAL y forma parte de la ruta
 * (`workitems/$User%20Story`), y el nombre del tipo va URL-encoded.
 *
 * El tipo sale del `levelMap`, buscando cual tipo nativo esta en el nivel
 * `task`: es el mismo mapa que resuelve el nivel al leer, asi que no hay una
 * segunda fuente de verdad ni un "Task" escrito a mano que Basic o un proceso
 * heredado pueden no tener.
 *
 * La relacion `Hierarchy-Reverse` (que es "Parent") va en el MISMO patch. El
 * unico ejemplo oficial de la pagina Create pone solo el titulo, sin relacion:
 * esta forma se compuso del ejemplo de la pagina Update mas el referenceName
 * del catalogo, y falta un ejemplo oficial de crear-y-colgar en una sola
 * llamada. Si el gestor la rechazara, el plan B son dos llamadas (crear y
 * despues PATCH la relacion), con el riesgo de dejar un hijo huerfano si la
 * segunda no entra — que es exactamente lo que este POST unico evita.
 */
export async function createChild(parentId, spec, ctx) {
  const o = opciones(ctx);
  const tipo = spec.type || o.childType || tipoNativoDeNivel("task", ctx);
  if (!tipo) {
    throw new Error(
      'el levelMap no declara ningun tipo de work item en el nivel "task", y sin eso no se sabe que crear: ' +
        "declaralo en provider.levelMap o forzalo con provider.options.childType",
    );
  }

  /** @type {OpParche[]} */
  const ops = [{ op: "add", path: `/fields/${F.titulo}`, from: null, value: String(spec.title || "") }];
  const criterios = spec.acceptance == null ? "" : criteriosAHtml(spec.acceptance);
  if (criterios) {
    ops.push({ op: "add", path: `/fields/${F.criterios}`, value: criterios });
  }
  // Los campos de tablero heredables se pasan como campos comunes. Una hija sin
  // iteracion cae en la raiz del proyecto y no aparece en ningun taskboard.
  const tablero = spec.boardFields || {};
  if (tablero.iterationPath) ops.push({ op: "add", path: `/fields/${F.iteracion}`, value: tablero.iterationPath });
  if (tablero.areaPath) ops.push({ op: "add", path: `/fields/${F.area}`, value: tablero.areaPath });
  if (tablero.assignedTo) ops.push({ op: "add", path: `/fields/${F.responsable}`, value: tablero.assignedTo });

  // La url del padre en la relacion es de nivel organizacion, sin proyecto:
  // asi la escribe la API en `relation.url`.
  const base = String(o.baseUrl || "https://dev.azure.com").replace(/\/+$/, "");
  const urlPadre = `${base}/${encodeURIComponent(exigir(o.organization, "organization"))}/_apis/wit/workItems/${encodeURIComponent(String(parentId))}`;
  ops.push({ op: "add", path: "/relations/-", value: { rel: REL_ESCRITURA.padre, url: urlPadre } });

  const url = urlApi(ctx, "project", `_apis/wit/workitems/$${encodeURIComponent(String(tipo))}`, { $expand: "all" });
  const crudo = await pedir(ctx, { method: "POST", url, contentType: PATCH, body: ops });
  return aItem(crudo, ctx);
}

/**
 * Las dos senales de disparo en una funcion, porque son dos consultas de la
 * misma forma y el motor las pide juntas.
 *
 * Las dos WIQL devuelven SOLO ids, asi que la hidratacion es obligatoria; se
 * hidrata la UNION de las dos consultas en un lote, para no pedir dos veces un
 * item que esta asignado y mencionado a la vez.
 *
 * Una consulta puesta en `null` por configuracion apaga ese disparo sin apagar
 * el otro: es lo que permite usar solo asignacion en un proyecto donde las
 * menciones las maneja otra herramienta.
 */
export async function searchInbox(ctx) {
  const o = opciones(ctx);
  const consultas = consultasDeBandeja(o, ctx.identity);
  const url = urlApi(ctx, "project", "_apis/wit/wiql");

  const idsDe = async (query) => {
    if (!query) return [];
    const r = await pedir(ctx, { method: "POST", url, contentType: "application/json", body: { query } });
    return (r?.workItems || []).map((w) => String(w.id));
  };

  const asignados = await idsDe(consultas.assigned);
  const mencionados = await idsDe(consultas.mentioned);

  const items = await hidratar([...asignados, ...mencionados], ctx);
  const porId = new Map(items.map((i) => [i.id, i]));
  const resolver = (ids) => ids.map((i) => porId.get(i)).filter(Boolean);

  return { assigned: resolver(asignados), mentioned: resolver(mencionados) };
}

/**
 * Verifica el levelMap declarado contra el gestor VIVO, para que el mapa no sea
 * una opinion.
 *
 * No es parte de la interfaz del contrato: es la herramienta de diagnostico que
 * contesta "¿este mapa es el de ESTE proyecto?" antes de un recorrido, y el
 * fallo que evita es el de (a) — un mapa de Agile apuntado a un proyecto Scrum
 * no falla, mapea todo al default y despacha mal en silencio.
 *
 * El mapeo se hace por `id` de CATEGORIA, que es estable, y no por nombre de
 * tipo ni por `rank`. Devuelve tambien `bugsBehavior`, que es la respuesta del
 * proyecto a "un Bug es story o es task", y los niveles apagados.
 */
export async function verifyLevelMap(ctx) {
  const url = urlApi(ctx, "team", "_apis/work/backlogconfiguration");
  const cfg = await pedir(ctx, { url });
  const backlogs = [cfg.taskBacklog, cfg.requirementBacklog, ...(cfg.portfolioBacklogs || [])].filter(Boolean);

  /** @type {Record<string, string>} */
  const expected = {};
  const customPortfolio = [];
  for (const b of backlogs) {
    const nivel = CATEGORIA_A_NIVEL[String(b.id || "").toLowerCase()];
    if (!nivel) {
      // Un nivel de portafolio custom ("My level" en el ejemplo oficial) se
      // REPORTA y no se adivina: solo la persona que lo creo sabe si es un epic.
      customPortfolio.push(b.id);
      continue;
    }
    for (const t of b.workItemTypes || []) expected[t.name] = nivel;
  }

  const mapa = mapaNiveles(ctx);
  const declarado = (tipo) => {
    if (tipo in mapa) return mapa[tipo];
    const k = Object.keys(mapa).find((x) => x.toLowerCase() === tipo.toLowerCase());
    return k ? mapa[k] : null;
  };

  const problems = [];
  for (const [tipo, nivel] of Object.entries(expected)) {
    const d = declarado(tipo);
    if (!d) {
      problems.push(
        `el proyecto tiene el tipo "${tipo}" en el nivel ${nivel} y el levelMap no lo declara: ` +
          `caeria en el default "${mapa.default}"`,
      );
    } else if (d !== nivel) {
      problems.push(`el levelMap dice "${tipo}" -> ${d} y el proyecto lo tiene en ${nivel}`);
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    expected,
    customPortfolio,
    bugsBehavior: cfg.bugsBehavior ?? null,
    hiddenLevels: (cfg.hiddenBacklogs || []).map((id) => CATEGORIA_A_NIVEL[String(id).toLowerCase()] || id),
  };
}

// `NotSupportedError` se importa aunque este proveedor no lo use: las diez
// capacidades estan en true, asi que no hay ninguna funcion a medias que tenga
// que lanzarlo. Queda referenciado para que el dia que una capacidad baje a
// false —por ejemplo `comment` en una organizacion que lo tenga restringido— la
// funcion correspondiente lo lance en vez de fingir que escribio algo.
export { NotSupportedError };
