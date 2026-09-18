// GitHub Issues.
//
// Es el gestor mas probable de quien adopte este proyecto, asi que su camino
// degradado importa mas que el de los otros dos: `linkUrl` no existe en esta
// API y no va a existir por comodidad de nadie, de modo que "el PR va como
// texto en un comentario" es el camino NORMAL aca, no una excepcion.
//
// LO QUE ESTE PROVEEDOR NO HACE, Y POR QUE. No toca GraphQL. Los campos de
// Projects v2 (Status, Sprint, Iteration) solo viven ahi, y prometer
// `boardFields` con la mitad del tablero —milestone y assignee si, iteracion
// no— es peor que declararlo en false y que el motor avise una vez por
// recorrido. El fallo que evita: una tarea hija que cae en la raiz del proyecto
// sin iteracion no aparece en ningun taskboard, y nadie se enteró hasta el
// final del sprint.
//
// CAMBIO DE PREMISA, DOCUMENTADO. Este repositorio asumia —research.md D4— que
// GitHub Issues no tiene relacion de bloqueo nativa y que por eso
// `dependencies` iba en false. Dejo de ser cierto el 2025-08-21: las
// dependencias entre issues salieron a GA con REST, GraphQL y webhooks
// (GET/POST /repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by y
// .../blocking, tope de 50 issues por tipo de relacion). El contrato manda
// declarar la verdad del gestor y no deducir un orden que el gestor no afirma;
// aca el gestor SI lo afirma, asi que la capacidad va en true. La discusion
// entera esta en docs/PROVIDERS.md.
//
// VERIFICADO CONTRA LA API VIGENTE, NO DE MEMORIA (era el encargo explicito de
// research.md para este gestor, que es el que cambio de modelo mas
// recientemente de los tres).

import { NotSupportedError } from "../contract.mjs";

export const meta = { name: "github", version: "1.0.0" };

/**
 * Un solo secreto. `GITHUB_TOKEN` es el nombre que inyecta GitHub Actions y el
 * que el gh CLI usa de respaldo.
 *
 * `GH_TOKEN` se acepta como ALIAS al leer `ctx.env` (los ejemplos de la
 * documentacion de GitHub lo guardan ahi), pero NO se declara como segunda
 * variable obligatoria: el cargador del motor exige que TODA variable de
 * `requiredEnv` este presente, asi que declarar las dos haria fallar el
 * arranque a quien tenga solo una — que es todo el mundo.
 *
 * Lo que NO va por entorno: `owner`, `repo`, el numero de issue, el `stateMap`
 * y el `typeMap` viajan por `provider.options` de la configuracion. Un gestor
 * con el repositorio hardcodeado en el entorno no se puede correr contra dos
 * repositorios en la misma maquina.
 */
export const requiredEnv = ["GITHUB_TOKEN"];

/**
 * Permisos necesarios, por si el 403 llega en produccion y hay que leer esto:
 * con token fine-grained alcanza "Issues: read and write" + "Metadata:
 * read-only" para las nueve operaciones. Con PAT clasico hace falta `repo`.
 * `read:org` solo si algun dia se resuelve el catalogo de issue types con
 * GET /orgs/{org}/issue-types — hoy no se hace: el typeMap de la configuracion
 * lo reemplaza y no gasta una llamada por recorrido.
 */
export function capabilities() {
  return {
    children: true,          // GET .../sub_issues, y GET .../parent da la inversa
    dependencies: true,      // GA desde 2025-08-21: .../dependencies/blocked_by
    createChild: true,       // POST /issues acepta parent_issue_id: una sola llamada
    setState: true,          // honesto hasta el hueso: ver ESTADOS, abajo
    comment: true,
    linkUrl: false,          // no existe el endpoint: ver LINK, abajo
    labels: true,            // con POST, nunca con PUT
    searchAssigned: true,
    searchMentioned: true,
    boardFields: false,      // Projects v2 es solo GraphQL
    identityAssignee: false, // /issues?filter=assigned es del dueño del token y no se puede cambiar
  };
}

/**
 * Lo que este proveedor acepta en `provider.options`, y lo unico que acepta.
 *
 * POR QUE `additionalProperties: false` (T114). Una clave mal escrita
 * —`owner` por `onwer`— pasaba la validacion entera y fallaba a mitad de un
 * recorrido, con el modelo ya pagado. Cerrado aca significa que el error sale
 * al cargar, nombrando la clave que sobra y la que falta.
 *
 * `owner` y `repo` no son `required` a proposito: sin ellos el proveedor sigue
 * funcionando con los ids completos, y `searchInbox` lo dice al degradar. Lo
 * que no puede pasar es una clave que nadie lee.
 */
export const optionsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    owner: { type: "string", description: "La organizacion o persona dueña del repositorio." },
    repo: { type: "string", description: "El repositorio del que sale la bandeja." },
    apiBase: { type: "string", description: "Para GitHub Enterprise. Por omision, la API publica." },
    webBase: { type: "string", description: "La base de las URLs que se muestran, si difiere de la API." },
    apiVersion: { type: "string", description: "El header X-GitHub-Api-Version que se pinnea." },
    perPage: { type: "integer", minimum: 1, maximum: 100 },
    maxPages: { type: "integer", minimum: 1 },
    childType: { type: "string", description: "El tipo que se le pone a las tareas hijas." },
    childLabels: { type: "array", items: { type: "string" }, description: "Etiquetas que llevan las hijas creadas." },
    typeMap: { type: "object", description: "De tipo nativo a nivel canonico." },
    typeMapById: { type: "object", description: "Igual, pero por id de tipo." },
    stateReasonMap: { type: "object", description: "De estado canonico a state_reason de GitHub." },
  },
};

/**
 * La version de la API se pinnea, y no es cosmetico: omitir el header cae en
 * `2022-11-28`, y los endpoints nuevos —dependencies, issue field values— estan
 * documentados bajo `2026-03-10`.
 *
 * PENDIENTE DE CONFIRMAR: no pude verificar si dependencies responde igual bajo
 * `2022-11-28`. Se confirma con un `curl -i` al mismo endpoint cambiando solo
 * el header; mientras no este confirmado, el default de aca es el unico valor
 * en el que se sabe que andan. Se puede sobreescribir con
 * `options.apiVersion` cuando GitHub publique la siguiente.
 */
const VERSION_API = "2026-03-10";
const BASE_API = "https://api.github.com";

// Mapa de tipos por defecto. La entrada `default` es obligatoria y NO es el
// caso raro: en GitHub cubre tres situaciones que son el caso comun.
//   1. `type: null`, que es lo que devuelve TODO issue de un repo de cuenta
//      personal — el catalogo de issue types es de la organizacion
//      (GET /orgs/{org}/issue-types), no del repositorio.
//   2. un tipo que la organizacion invento y este mapa no conoce.
//   3. un tipo que la organizacion renombro; los tres por defecto (task, bug,
//      feature) se pueden renombrar, deshabilitar y borrar.
// El nivel sale de este mapa y nunca de comparar `type.name` contra una
// constante: ese es el fallo observado —un despachador que compara contra
// "User Story" anda en un proyecto y calla en otro, sin error y sin aviso.
/** @type {Record<string, string>} */
const NIVELES_POR_DEFECTO = {
  Epic: "epic",
  Feature: "feature",
  Story: "story",
  "User Story": "story",
  Task: "task",
  Bug: "story",
  default: "story",
};

// --------------------------------------------------------------------------
// HTTP
// --------------------------------------------------------------------------

function tokenDe(ctx) {
  // `GH_TOKEN` es alias de lectura, no variable obligatoria: ver requiredEnv.
  const t = ctx?.env?.GITHUB_TOKEN || ctx?.env?.GH_TOKEN;
  if (!t) {
    throw new Error(
      "falta GITHUB_TOKEN en ctx.env: el proveedor no lee el entorno por su cuenta, lo recibe inyectado",
    );
  }
  return t;
}

/**
 * Un pedido a la API. El reintento y el respeto de `Retry-After` NO viven aca:
 * viven en `ctx.fetch`, porque el manejo de 429 es identico en todos los
 * gestores y repetirlo por proveedor es como uno termina sin el. Importa
 * especialmente en el endpoint de comentarios, que la documentacion marca como
 * sujeto a limite de tasa secundario.
 */
async function pedir(ctx, ruta, init = {}) {
  const base = ctx?.options?.apiBase || BASE_API;
  /** @type {Record<string, string>} */
  const headers = {
    Authorization: `Bearer ${tokenDe(ctx)}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": ctx?.options?.apiVersion || VERSION_API,
  };
  if (init.body) headers["Content-Type"] = "application/json";
  return ctx.fetch(`${base}${ruta}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
}

/**
 * Lee la respuesta o LANZA con el mensaje textual de GitHub.
 *
 * Nunca se resume a "no se pudo": el 403 de un token sin el permiso de Issues
 * dice "Resource not accessible by personal access token", y ese texto es la
 * diferencia entre arreglarlo en un minuto y buscar a ciegas.
 */
async function leer(r, metodo, ruta) {
  if (r.ok) return r.json();
  let texto = "";
  try {
    const cuerpo = await r.json();
    texto = cuerpo?.message || "";
    if (Array.isArray(cuerpo?.errors) && cuerpo.errors.length) {
      texto += `: ${cuerpo.errors.map((e) => e?.message || e?.code || JSON.stringify(e)).join(", ")}`;
    }
  } catch {
    texto = "(sin cuerpo)";
  }
  throw new Error(`GitHub ${r.status} en ${metodo} ${ruta}: ${texto}`);
}

/**
 * Recorre un endpoint paginado.
 *
 * El tope de paginas no es defensa teorica: un bucle "mientras venga lleno"
 * contra un endpoint que ignore el parametro `page` gira para siempre y se come
 * la cuota horaria entera antes de que nadie mire el log.
 */
async function paginar(ctx, ruta, extra = "") {
  // El piso de 1 tampoco es defensa teorica: `per_page=0` hace que GitHub
  // devuelva su default de 30, y una pagina de 30 nunca "viene corta" contra 0,
  // asi que el bucle pide la misma pagina hasta el tope y no lo nota nadie.
  const porPagina = Math.max(1, Math.min(100, ctx?.options?.perPage ?? 100));
  const maxPaginas = ctx?.options?.maxPages ?? 20;
  const prefijo = extra ? `${extra}&` : "";
  const todos = [];
  let ultimoLote = 0;
  let paginas = 0;
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const completa = `${ruta}?${prefijo}per_page=${porPagina}&page=${pagina}`;
    const r = await pedir(ctx, completa);
    const lote = await leer(r, "GET", completa);
    if (!Array.isArray(lote) || lote.length === 0) break;
    paginas = pagina;
    ultimoLote = lote.length;
    todos.push(...lote);
    if (lote.length < porPagina) break;
  }

  // NINGUN TOPE ACOTA EN SILENCIO. Ver `paginacionIncompleta`.
  const corte = paginacionIncompleta({ paginas, maxPaginas, ultimoLote, porPagina });
  if (corte.incompleta) ctx?.log?.warn?.(`${ruta}: ${corte.aviso}`);

  return todos;
}

/**
 * Si la paginacion corto por el tope y quedaron cosas sin traer.
 *
 * EL FALLO QUE CIERRA. El bucle se detenia al llegar a `maxPages` sin decir
 * nada. Si la ultima pagina vino LLENA, hay mas del otro lado y esos tickets
 * simplemente no existen para el motor: la bandeja se ve completa y no lo esta.
 * Es el peor de los recortes silenciosos, porque lo que se pierde es trabajo.
 *
 * Una ultima pagina CORTA es el final de verdad, no un recorte.
 *
 * El parametro NO se llama `o`: el test que verifica que toda opcion leida este
 * descrita en el esquema del proveedor busca `o.<algo>`, y un parametro con ese
 * nombre le hace ver opciones donde no las hay. El heuristico es tosco a
 * proposito —atrapa el caso que importa— y esto es lo que cuesta.
 *
 * @param {{paginas: number, maxPaginas: number, ultimoLote: number, porPagina: number}} corte
 * @returns {{incompleta: boolean, aviso?: string}}
 */
export function paginacionIncompleta(corte) {
  if (corte.paginas < corte.maxPaginas) return { incompleta: false };
  if (corte.ultimoLote < corte.porPagina) return { incompleta: false };
  return {
    incompleta: true,
    aviso:
      `se llego al tope de ${corte.maxPaginas} paginas (options.maxPages) con la ultima pagina llena: ` +
      `hay mas resultados que no se trajeron. Lo que sigue esta INCOMPLETO. ` +
      `Subi \`maxPages\` o acota la consulta.`,
  };
}

/**
 * Si lo que llego es un issue que este proveedor puede traducir.
 *
 * El unico campo que se exige es `number`, porque es el que se vuelve el id
 * canonico. Sin el, `aItem` fabrica un item con `id: "undefined"` y sin `url`:
 * no lanza, valida mal, y el motor guarda el estado del recorrido bajo esa
 * clave. El fallo aparece al final y lejos de donde nacio.
 */
function esIssue(crudo) {
  return !!crudo && typeof crudo === "object" && !Array.isArray(crudo) && crudo.number != null;
}

/**
 * Filtra una lista paginada dejando solo issues traducibles, y AVISA por cada
 * descarte.
 *
 * Saltear en vez de lanzar: un hueco en la lista de sub-issues de un hito de
 * veinte historias no puede tirar el recorrido entero, y un
 * `TypeError: Cannot read properties of null` que el motor reporta como causa
 * no dice contra que gestor ni contra que ruta paso. Saltear EN SILENCIO seria
 * la otra mitad del fallo: un hijo que desaparece del plan sin que nadie se
 * entere.
 */
function soloIssues(lote, ctx, ruta) {
  const limpio = [];
  for (const crudo of lote) {
    if (esIssue(crudo)) limpio.push(crudo);
    else ctx?.log?.warn?.(`github: ${ruta} devolvio algo que no es un issue y se salteo`, { crudo });
  }
  return limpio;
}

// --------------------------------------------------------------------------
// Identificadores
// --------------------------------------------------------------------------
//
// GitHub tiene DOS identificadores por issue y no son intercambiables:
//   - `number`: el que va en la RUTA (/issues/42).
//   - `id`: el entero GLOBAL, el que piden los CUERPOS de sub_issues y de
//     dependencies (`sub_issue_id`, `issue_id`, `parent_issue_id`).
// Los dos son enteros, asi que confundirlos no da un error de tipo: da un 404
// o, peor, engancha un issue ajeno que casualmente tenga ese id global. Por eso
// el id canonico del Item es el NUMERO (es lo que una persona escribe y lo que
// queda legible en el nombre de una rama) y el global viaja aparte, en `gid`.

const RE_CALIFICADO = /^([^/\s]+)\/([^#\s]+)#(\d+)$/;

/**
 * Un id canonico puede ser `"42"` —el repositorio de la configuracion— o
 * `"owner/repo#42"`. La forma calificada existe porque GET /issues barre TODOS
 * los repositorios visibles: dos repos pueden tener el issue 12, y un numero
 * pelado haria que el daemon despache el equivocado.
 */
function partirId(id, ctx) {
  const s = String(id);
  const m = RE_CALIFICADO.exec(s);
  if (m) return { owner: m[1], repo: m[2], number: m[3] };
  return { owner: ctx?.options?.owner, repo: ctx?.options?.repo, number: s };
}

function rutaIssue(id, ctx, sufijo = "") {
  const { owner, repo, number } = partirId(id, ctx);
  if (!owner || !repo) {
    throw new Error("faltan `owner` y `repo` en provider.options: el proveedor no los adivina ni los lee del entorno");
  }
  return `/repos/${owner}/${repo}/issues/${number}${sufijo}`;
}

/** De donde vive realmente un issue crudo, que puede no ser el repo configurado. */
function repoDe(crudo, ctx) {
  const porApi = /\/repos\/([^/]+)\/([^/]+)/.exec(String(crudo?.repository_url || ""));
  if (porApi) return { owner: porApi[1], repo: porApi[2] };
  const porWeb = /github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\//.exec(String(crudo?.html_url || ""));
  if (porWeb) return { owner: porWeb[1], repo: porWeb[2] };
  return { owner: ctx?.options?.owner, repo: ctx?.options?.repo };
}

// GitHub compara owner y repo SIN distinguir mayusculas —`Acme/Tienda` y
// `acme/tienda` son el mismo repositorio, y la API responde siempre con la
// capitalizacion canonica, no con la que se escribio en la configuracion—. El
// fallo que esta funcion evita: con la comparacion sensible, un `owner: "Acme"`
// en la configuracion hace que getItem("42") devuelva `id: "acme/tienda#42"`
// para el repositorio configurado; el motor despacho "42", guarda el estado
// bajo otro id, y los hijos y las dependencias no matchean con nada. Sin un
// solo error.
const igualRepo = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

function idCanonico(owner, repo, numero, ctx) {
  const propio = igualRepo(owner, ctx?.options?.owner) && igualRepo(repo, ctx?.options?.repo);
  return propio ? String(numero) : `${owner}/${repo}#${numero}`;
}

/** El `parent_issue_url` viene como URL de la API, no como numero. */
function padreDe(crudo, ctx) {
  const m = /\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)/.exec(String(crudo?.parent_issue_url || ""));
  return m ? idCanonico(m[1], m[2], m[3], ctx) : null;
}

// --------------------------------------------------------------------------
// Traduccion al modelo canonico
// --------------------------------------------------------------------------

function nivelDe(crudo, ctx) {
  const porNombre = ctx?.options?.typeMap || ctx?.options?.levelMap || NIVELES_POR_DEFECTO;
  const porId = ctx?.options?.typeMapById || null;
  // El id del issue type es estable dentro de la organizacion y sobrevive a un
  // rename; el nombre no. Por eso el mapa por id, si esta, gana.
  if (porId && crudo?.type?.id != null && porId[crudo.type.id] != null) return porId[crudo.type.id];
  const nombre = crudo?.type?.name;
  return (nombre != null ? porNombre[nombre] : undefined) ?? porNombre.default ?? NIVELES_POR_DEFECTO.default;
}

/**
 * ESTADOS. GitHub Issues tiene UN solo estado nativo —`open`/`closed`, mas un
 * `state_reason`— y eso es todo: no hay in_progress, ni blocked, ni in_review.
 * Tres de los cinco canonicos quedan en `null` en el stateMap, y el mapa lo
 * dice en vez de inventar un nombre nativo. Como el motor nunca pide `done`, en
 * la practica setState casi no escribe nada y la senal real es el comentario:
 * es exactamente la fila "setState en false" de la tabla de degradacion,
 * ocurriendo con la capacidad en true.
 */
function canonicoDe(nativo, ctx) {
  const mapa = ctx?.options?.stateMap || {};
  if (nativo == null) return null;
  const entrada = Object.entries(mapa).find(([, v]) => v != null && v === nativo);
  return entrada ? entrada[0] : null;
}

/**
 * Los criterios de aceptacion. GitHub Issues NO tiene campo para esto: los
 * issue fields son text, date, single_select, multi_select y number, y ninguno
 * es una lista. La convencion mas duradera es la lista de tareas del cuerpo, y
 * es lo que se lee. Si no hay ninguna, se devuelve vacio y el motor lo ve: es
 * mejor que devolver un criterio inventado.
 */
function criteriosDelCuerpo(body) {
  return String(body || "")
    .split("\n")
    .map((l) => /^\s*[-*]\s*\[[ xX]\]\s*(.+)$/.exec(l))
    .map((m) => (m ? m[1].trim() : ""))
    .filter((s) => s.length > 0);
}

function aItem(crudo, ctx) {
  const { owner, repo } = repoDe(crudo, ctx);
  return {
    id: idCanonico(owner, repo, crudo.number, ctx),
    // El entero global, el que va en los CUERPOS. Aparte del id a proposito.
    gid: crudo.id,
    nodeId: crudo.node_id,
    key: `${owner}/${repo}#${crudo.number}`,
    title: crudo.title || "",
    body: crudo.body || "",
    acceptance: criteriosDelCuerpo(crudo.body),
    level: nivelDe(crudo, ctx),
    state: crudo.state,
    stateReason: crudo.state_reason ?? null,
    canonicalState: canonicoDe(crudo.state, ctx),
    assignee: crudo.assignee?.login || null,
    parentId: padreDe(crudo, ctx),
    // `Array.isArray` y no `|| []`: un `labels` que llegue como objeto —o como
    // el envoltorio `{labels: [...]}` de un endpoint nuevo— hace que `.map` no
    // sea una funcion, y eso revienta la traduccion de un issue por un campo
    // que el motor casi no usa.
    labels: (Array.isArray(crudo.labels) ? crudo.labels : [])
      .map((l) => (typeof l === "string" ? l : l?.name))
      .filter(Boolean),
    // `html_url` lo manda GitHub siempre; el respaldo existe porque sin `url`
    // el Item no valida contra el modelo canonico y el motor lo descubre lejos
    // de aca. `webBase` es para GitHub Enterprise, donde el host no es
    // github.com.
    url: crudo.html_url || `${ctx?.options?.webBase || "https://github.com"}/${owner}/${repo}/issues/${crudo.number}`,
    // Declarado en false: milestone y assignee si serian heredables por REST,
    // pero Status/Sprint/Iteration viven solo en GraphQL. Medio tablero
    // prometido es peor que ninguno.
    boardFields: null,
    raw: crudo,
  };
}

// --------------------------------------------------------------------------
// La interfaz
// --------------------------------------------------------------------------

export async function getItem(id, ctx) {
  const ruta = rutaIssue(id, ctx);
  const r = await pedir(ctx, ruta);
  // "No existe" es una RESPUESTA, no un fallo: un id que ya no esta es normal
  // cuando alguien borra o transfiere un issue a mitad de un recorrido, y
  // lanzar aca obligaria a todo llamador a envolver el caso normal en
  // try/catch.
  if (r.status === 404) return null;
  const crudo = await leer(r, "GET", ruta);
  // Un 200 que no trae un issue NO es "no existe" y tampoco es traducible: un
  // proxy corporativo que devuelve una pagina de error con 200, un envoltorio
  // en vez del objeto. Lanzar con la ruta adentro es la unica forma de que la
  // causa sea legible; devolver el item que `aItem` fabricaria —con
  // `id: "undefined"`— lo propaga en silencio hasta el final del recorrido.
  if (!esIssue(crudo)) {
    throw new Error(`GitHub respondio 200 en GET ${ruta} con algo que no es un issue: ${JSON.stringify(crudo)?.slice(0, 200)}`);
  }
  return aItem(crudo, ctx);
}

/**
 * Los sub-issues. Vienen como objetos issue COMPLETOS, asi que no hace falta un
 * GET por hijo: un hito de veinte historias serian veintiuna llamadas en vez de
 * una, y la cuota por recorrido esta limitada.
 *
 * ASUMIDO, no confirmado: que el sub-issue vive en el MISMO repositorio que el
 * padre. La documentacion solo dice "The sub-issue must belong to the same
 * repository owner as the parent issue", que no aclara si habilita cross-repo
 * dentro del mismo owner. El `id` canonico se califica solo cuando el repo
 * difiere, asi que si aparece un caso cross-repo esto lo refleja sin cambios;
 * se confirma grabando un fixture de un sub-issue de otro repo del mismo owner.
 */
export async function children(id, ctx) {
  const ruta = rutaIssue(id, ctx, "/sub_issues");
  const lote = await paginar(ctx, ruta);
  return soloIssues(lote, ctx, ruta).map((c) => aItem(c, ctx));
}

/**
 * Dependencias nativas. `blocked_by` son los PREDECESORES —los que tienen que
 * terminar antes— y `blocking` los sucesores.
 *
 * Solo se LEE. Los endpoints de escritura existen (POST .../dependencies/
 * blocked_by con `{issue_id: <id global>}`, DELETE .../blocked_by/{issue_id}),
 * pero el motor no escribe precedencias: las lee para ordenar. Exportar una
 * escritura que nadie llama es superficie que se rompe sin que ningun test lo
 * note.
 *
 * Se devuelven IDS canonicos y no objetos crudos, igual que el proveedor falso:
 * el planificador compara contra los ids de los items del recorrido.
 *
 * NO CONFIRMADO: si el issue bloqueante puede vivir en otro repositorio. El
 * tope de 50 issues por tipo de relacion sale del changelog, no de la pagina de
 * referencia; si un hito lo supera, esto devuelve los primeros 50 y GitHub no
 * avisa. Se confirma contando `blocked_by` contra un issue preparado con 51.
 */
export async function dependencies(id, ctx) {
  const rutaAntes = rutaIssue(id, ctx, "/dependencies/blocked_by");
  const rutaDespues = rutaIssue(id, ctx, "/dependencies/blocking");
  const bloqueantes = soloIssues(await paginar(ctx, rutaAntes), ctx, rutaAntes);
  const bloqueados = soloIssues(await paginar(ctx, rutaDespues), ctx, rutaDespues);
  const aId = (crudo) => {
    const { owner, repo } = repoDe(crudo, ctx);
    return idCanonico(owner, repo, crudo.number, ctx);
  };
  return { predecessors: bloqueantes.map(aId), successors: bloqueados.map(aId) };
}

/**
 * Mueve el issue, si el estado canonico existe en este gestor.
 *
 * El GET previo solo se paga al ABRIR, y compra el `state_reason` correcto:
 * reabrir exige `state_reason: "reopened"`, y un PATCH con solo
 * `{state: "open"}` sobre un issue cerrado como "not_planned" deja el issue
 * abierto y todavia marcado como descartado — el tablero miente en la
 * direccion mas confusa posible. Sobre un issue ya abierto se manda `null`, que
 * no toca el motivo de un cierre anterior.
 */
export async function setState(id, canonicalState, ctx) {
  const declarado = ctx?.options?.stateMap?.[canonicalState];
  // Un canonico que este gestor no tiene NO se escribe, y se declara. No se
  // gasta una llamada ni se inventa un nombre de estado.
  if (!declarado) return { written: null, skipped: canonicalState };

  // Los dos nativos que aparecen aca NO son nombres de plantilla escritos de
  // memoria —eso es lo que el contrato prohibe, y es lo que hace que el mapa
  // viva en la configuracion—: son el enum cerrado del campo `state` de la API
  // REST, que ninguna organizacion puede renombrar. Por eso el mapa se VALIDA
  // contra ellos en vez de asumirlos, y se normaliza la capitalizacion: un
  // `done: "Closed"` en la configuracion caia en la rama de ABRIR, pagaba un
  // GET de mas y mandaba un PATCH que GitHub rechaza con 422 "Invalid value",
  // sin que nada dijera que el mapa era lo que estaba mal.
  const NATIVOS = { open: "open", closed: "closed" };
  const nativo = NATIVOS[String(declarado).trim().toLowerCase()];
  if (!nativo) {
    throw new Error(
      `stateMap.${canonicalState} = ${JSON.stringify(declarado)} no es un estado de GitHub Issues: ` +
        `el campo \`state\` solo acepta "open" o "closed" (los cinco canonicos que no existen van en null)`,
    );
  }

  /** @type {string|null} */
  let razon = ctx?.options?.stateReasonMap?.[canonicalState] ?? null;
  if (nativo === NATIVOS.closed) {
    if (razon == null) razon = "completed";
  } else {
    const actual = await getItem(id, ctx);
    razon = actual && actual.state === NATIVOS.closed ? "reopened" : null;
  }

  const ruta = rutaIssue(id, ctx);
  const r = await pedir(ctx, ruta, {
    method: "PATCH",
    body: JSON.stringify({ state: nativo, state_reason: razon }),
  });
  await leer(r, "PATCH", ruta);
  return { written: nativo };
}

export async function comment(id, text, ctx) {
  const ruta = rutaIssue(id, ctx, "/comments");
  const r = await pedir(ctx, ruta, { method: "POST", body: JSON.stringify({ body: text }) });
  const creado = await leer(r, "POST", ruta);
  // El comentario YA se publico: el 201 lo afirma. Lanzar porque la respuesta
  // no se puede leer haria que el motor reintente y el ticket termine con el
  // mismo comentario dos veces — el fallo mas visible que puede dejar un
  // orquestador en un tablero ajeno. Se devuelve lo que haya, y el id sale
  // string como todo id que sale de un proveedor.
  return {
    id: creado?.id != null ? String(creado.id) : null,
    url: creado?.html_url ?? null,
  };
}

/**
 * LINK. Declarada en false por AUSENCIA CONFIRMADA de endpoint, no por
 * comodidad: el indice de la API de Issues lista Assignees, Comments, Events,
 * Issue dependencies, Issue field values, Issues, Labels, Milestones,
 * Sub-issues y Timeline events — no hay grupo de remote links ni de linked
 * pull requests. Enlazar un PR a un issue solo se puede desde la barra
 * Development de la interfaz (a mano, tope de 10 issues por PR) o por palabra
 * clave en el CUERPO DEL PR ("Closes #42"), que ademas solo se interpreta si el
 * PR apunta a la rama por defecto. Los issue fields no ayudan: no hay tipo URL.
 *
 * Si el motor la llamara igual, esto lo delata en vez de fingir que adjunto
 * algo. El camino que si funciona —el PR como texto en un comentario— lo toma
 * el motor solo, porque `comment` esta en true.
 */
export async function linkUrl(_id, _url, _title, _ctx) {
  throw new NotSupportedError("linkUrl", meta.name);
}

/**
 * Suma una etiqueta. POST, y NUNCA PUT: el PUT con el mismo cuerpo reemplaza el
 * conjunto entero, y una etiqueta de progreso del orquestador borraria las que
 * el equipo puso a mano.
 */
export async function addLabel(id, label, ctx) {
  const ruta = rutaIssue(id, ctx, "/labels");
  const r = await pedir(ctx, ruta, { method: "POST", body: JSON.stringify({ labels: [label] }) });
  const etiquetas = await leer(r, "POST", ruta);
  return {
    ok: true,
    labels: (Array.isArray(etiquetas) ? etiquetas : []).map((l) => l?.name).filter(Boolean),
  };
}

/**
 * Materializa una tarea como issue hijo.
 *
 * `parent_issue_id` deja la tarea colgada del padre en UNA llamada. La
 * alternativa en dos pasos —crear y despues POST .../sub_issues con
 * `sub_issue_id`— queda como respaldo si algun dia el parametro desaparece; el
 * respaldo importa porque el primer paso ya creo el issue, y reintentar la
 * creacion entera duplica tickets en el tablero.
 *
 * El `parent_issue_id` es el id GLOBAL del padre, no su numero, y por eso hay
 * un GET antes: mandar el numero no da error de tipo, engancha la tarea al
 * issue que casualmente tenga ese id global.
 */
export async function createChild(parentId, spec, ctx) {
  const padre = await getItem(parentId, ctx);
  if (!padre) throw new Error(`el issue padre ${parentId} no existe: no se crea la tarea huerfana`);

  const criterios = Array.isArray(spec?.acceptance)
    ? spec.acceptance
    : spec?.acceptance
      ? [spec.acceptance]
      : [];
  const cuerpo = criterios.length
    ? `### Criterios de aceptacion\n${criterios.map((c) => `- [ ] ${c}`).join("\n")}`
    : "";

  /** @type {Record<string, any>} */
  const payload = {
    title: spec?.title,
    body: spec?.body ? `${spec.body}\n\n${cuerpo}`.trim() : cuerpo,
    // El issue type se pasa por NOMBRE, no por id. Configurable porque una
    // organizacion puede haber borrado "Task": ver el default del typeMap.
    type: ctx?.options?.childType ?? null,
    parent_issue_id: padre.gid,
  };
  const etiquetas = ctx?.options?.childLabels || [];
  if (etiquetas.length) payload.labels = etiquetas;
  // No se manda `milestone` ni `assignees`: `boardFields` esta en false, y
  // heredar la mitad del tablero en silencio es lo que el motor avisa que no
  // hace.

  const { owner, repo } = partirId(parentId, ctx);
  const ruta = `/repos/${owner}/${repo}/issues`;
  const r = await pedir(ctx, ruta, { method: "POST", body: JSON.stringify(payload) });
  const creado = await leer(r, "POST", ruta);
  // Si la respuesta no es un issue, el POST ya se ejecuto igual: el mensaje
  // tiene que decirlo, porque el reintento natural —volver a crear— deja dos
  // tickets iguales colgados del mismo padre.
  if (!esIssue(creado)) {
    throw new Error(
      `GitHub respondio en POST ${ruta} con algo que no es un issue, pero la tarea ya quedo creada en el tablero: ` +
        `hay que revisarla a mano antes de reintentar, o el reintento la duplica`,
    );
  }
  return aItem(creado, ctx);
}

/**
 * La bandeja: lo asignado y lo mencionado, en dos consultas al core.
 *
 * DOS LLAMADAS Y NO UNA, A PROPOSITO. GET /search/issues resolveria las dos en
 * una consulta, pero el buscador va a 30 pedidos por minuto contra los 5000 por
 * hora del core, y una sola consulta no permite distinguir el balde `assigned`
 * del balde `mentioned` —que son dos capacidades separadas del contrato, con
 * dos disparos distintos—. Dos llamadas al core cuestan menos cuota que una al
 * buscador y no pierden la distincion.
 *
 * `filter=assigned|mentioned` cubre todos los repositorios visibles: propios,
 * de los que se es miembro, y de la organizacion. Eso trae issues de repos que
 * no son el configurado, y por eso el id canonico se califica.
 */
export async function searchInbox(ctx) {
  const owner = ctx.options?.owner;
  const repo = ctx.options?.repo;

  /**
   * DEL REPOSITORIO DECLARADO, Y NADA MAS.
   *
   * `/issues?filter=assigned` devuelve los issues asignados al dueño del token
   * en TODOS los repositorios que puede ver. Con un token personal eso son los
   * issues de trabajo de esa persona, de otras organizaciones enteras — y el
   * daemon gastaba una invocacion de planificacion en cada uno antes de que
   * `validatePlan` los rechazara por tocar un repositorio no declarado.
   *
   * La configuracion declara sobre que repositorio trabaja noxloop. Lo de afuera
   * no es asunto suyo. Sin `owner`/`repo` declarados no hay con que filtrar, y
   * ahi se devuelve lo que hay: filtrar todo dejaria la bandeja muda.
   */
  const delRepo = (crudo) => {
    if (!owner || !repo) return true;
    const url = String(crudo?.repository_url || crudo?.html_url || "");
    return url.toLowerCase().includes(`/${String(owner).toLowerCase()}/${String(repo).toLowerCase()}`);
  };

  const traer = async (filtro) => {
    const lote = await paginar(ctx, "/issues", `filter=${filtro}&state=open`);
    // La REST API de GitHub considera issue a TODO pull request. Sin este
    // filtro el daemon dispara un recorrido sobre una revision y el motor busca
    // criterios de aceptacion en un diff. La clave `pull_request` es la marca
    // documentada.
    const propios = soloIssues(lote, ctx, `/issues?filter=${filtro}`)
      .filter((c) => !c?.pull_request);

    const dentro = propios.filter(delRepo);
    const afuera = propios.length - dentro.length;
    if (afuera > 0) {
      ctx?.log?.info?.(
        `github: ${afuera} issue(s) asignado(s) fuera de ${owner}/${repo} quedaron fuera de la bandeja`,
      );
    }
    return dentro.map((c) => aItem(c, ctx));
  };

  return { assigned: await traer("assigned"), mentioned: await traer("mentioned") };
}

/**
 * Lo que la suite de contrato necesita. El `ctx` de aca trae las opciones y
 * niega la red: las respuestas GRABADAS viven en `index.test.mjs`, que las
 * sirve con su propio `ctx.fetch`. Un test que necesita una cuenta no lo puede
 * correr quien adopte el proyecto, y los fixtures HTTP no son parte del
 * proveedor que se publica.
 */
export const fixtures = {
  ctx: {
    options: {
      owner: "acme",
      repo: "tienda",
      stateMap: {
        todo: "open",
        in_progress: null,  // GitHub Issues no lo tiene, y el mapa lo dice
        blocked: null,
        in_review: null,
        done: "closed",     // el motor nunca pide `done`: la autonomia termina en el PR
      },
      typeMap: NIVELES_POR_DEFECTO,
    },
    env: { GITHUB_TOKEN: "sin-token-real" },
    log: { info() {}, warn() {}, error() {} },
    fetch: async () => {
      throw new Error("los fixtures grabados viven en index.test.mjs: este ctx no hace red");
    },
  },
  defaultLevel: "story",
  knownItemId: "42",
  unknownItemId: "9999",
  unknownTypeItemId: "56",
  sourceUrl: new URL("./index.mjs", import.meta.url),
};
