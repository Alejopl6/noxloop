// La suite de contrato entera contra el proveedor de Linear, mas los casos
// propios de este gestor. Todo corre contra respuestas GRABADAS
// (./fixtures.mjs): sin red, sin API key y sin workspace.

import { test } from "node:test";
import assert from "node:assert/strict";
import { contractChecks, validateItem, CANONICAL_STATES } from "../contract.mjs";
import * as linear from "./index.mjs";
import { fixtures, nuevoCtx, IDS, DISPARADORES, MENSAJES, MAPA_ESTADOS, MAPA_NIVELES } from "./fixtures.mjs";

/**
 * Un `ctx` que devuelve el cuerpo que se le diga, para las respuestas que NO
 * son grabadas: un nodo null en una lista, una conexion sin `nodes`, un id
 * numerico. No van en fixtures.mjs a proposito — ese archivo son respuestas
 * tal como las devuelve api.linear.app, y estas no las devuelve Linear: las
 * devuelve lo que haya en el medio (un proxy, una cache, un gateway) o una
 * version futura del esquema. Lo que se prueba aca es que el proveedor degrada
 * en vez de reventar con un TypeError a mitad de un recorrido.
 */
function ctxRoto(responder, options = {}) {
  const llamadas = [];
  const ctx = {
    options: { stateMap: { ...MAPA_ESTADOS }, levelMap: { ...MAPA_NIVELES }, ...options },
    env: { LINEAR_API_KEY: "lin_api_GRABADA" },
    log: { info() {}, warn() {}, error() {} },
    fetch: async (_url, init = {}) => {
      const cuerpo = JSON.parse(String(init.body || "{}"));
      llamadas.push({ query: String(cuerpo.query || ""), variables: cuerpo.variables || {} });
      return new Response(JSON.stringify(responder(String(cuerpo.query || ""), cuerpo.variables || {})), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  };
  return { ctx, llamadas };
}

// --------------------------------------------------------------- el contrato

test("Linear pasa la suite de contrato entera", async (t) => {
  for (const check of contractChecks(linear, fixtures)) {
    await t.test(check.name, async () => {
      await check.run();
    });
  }
});

/**
 * La MISMA suite, otra vez, con otro nivel por defecto declarado.
 *
 * EL FALLO QUE ESTO EVITA, y que estaba. Los fixtures declaraban
 * `defaultLevel: "story"`, que es el nivel al que mapea la etiqueta `Story` —la
 * de la mayoria de los issues grabados—. Con eso, el chequeo 6 lo aprueba
 * tambien un proveedor que devuelva `level: "story"` fijo y que ni mire el mapa
 * de tipos: se comprobo con un impostor de quince lineas, que pasaba los ocho
 * chequeos. Es justo el fallo que el chequeo 6 existe para detectar, y es el
 * mismo aviso que da `providers/README.md` en el paso 4.
 *
 * Dos corridas con dos defaults distintos no las puede pasar un nivel fijo.
 */
test("Linear pasa la suite de contrato con OTRO default declarado", async (t) => {
  const { ctx } = nuevoCtx({ options: { levelMap: { ...MAPA_NIVELES, default: "task" } } });
  const fx = { ...fixtures, ctx, defaultLevel: "task" };
  for (const check of contractChecks(linear, fx)) {
    await t.test(check.name, async () => {
      await check.run();
    });
  }
});

test("declara las variables de entorno que necesita, y ninguna mas", () => {
  // El nombre lo elige el proveedor: Linear documenta el header, no una
  // variable de entorno. El motor valida que exista antes de arrancar.
  assert.deepEqual(linear.requiredEnv, ["LINEAR_API_KEY"]);
});

test("capabilities dice la verdad de este gestor", () => {
  const caps = linear.capabilities();
  assert.deepEqual(caps, {
    children: true,
    dependencies: true,
    createChild: true,
    setState: true,
    comment: true,
    linkUrl: true,
    labels: true,
    searchAssigned: true,
    // Arranca en false: el corte de menciones se apoya en una pieza cuyos
    // valores no estan documentados. El daemon igual arranca porque
    // searchAssigned esta en true.
    searchMentioned: false,
    boardFields: true,
  });
});

// --------------------------------------------------------------- transporte

test("todo va por un solo POST a /graphql, con la API key TAL CUAL y sin Bearer", async () => {
  const { ctx, llamadas } = nuevoCtx();
  await linear.getItem("ENG-123", ctx);

  assert.equal(llamadas.length, 1, "getItem hace UN viaje: existencia y datos salen de la misma query");
  assert.equal(llamadas[0].url, "https://api.linear.app/graphql");
  assert.equal(llamadas[0].method, "POST");
  assert.equal(llamadas[0].headers["Content-Type"], "application/json");
  // El `Bearer` es solo para access tokens de OAuth2. Con una API key personal
  // el prefijo hace que Linear conteste 401, y el fallo se ve como "credencial
  // mala" cuando la credencial esta bien.
  assert.equal(llamadas[0].headers.Authorization, "lin_api_GRABADA");
});

test("un error de GraphQL con HTTP 200 lanza con el mensaje textual del gestor", async () => {
  const { ctx } = nuevoCtx();
  // Mirar solo el status deja pasar este caso como si fuera un exito, y el
  // recorrido sigue con `data: null`.
  await assert.rejects(() => linear.getItem(DISPARADORES.errorDeGraphql, ctx), /Entity not found: Issue/);
});

test("un RATELIMITED (HTTP 400) lanza con el mensaje del gestor, no con un resumen propio", async () => {
  const { ctx } = nuevoCtx();
  // ctx.fetch reintenta 429 y 5xx; Linear manda el limite de tasa como 400, que
  // no se reintenta. El proveedor propaga el texto y el motor detiene el
  // recorrido con la causa real.
  await assert.rejects(() => linear.getItem(DISPARADORES.limiteDeTasa, ctx), new RegExp(MENSAJES.limiteDeTasa));
});

// ----------------------------------------------------------------- getItem

test("getItem por identificador humano filtra por team.key + number", async () => {
  const { ctx, llamadas } = nuevoCtx();
  const item = await linear.getItem("ENG-123", ctx);

  assert.equal(llamadas[0].variables.filtro.team.key.eq, "ENG");
  assert.equal(llamadas[0].variables.filtro.number.eq, 123);
  // IssueFilter.id es un IssueIDComparator con `eq: ID`: solo UUID. Filtrar
  // "ENG-123" por id no devuelve nada y el ticket parece no existir.
  assert.equal(item.id, IDS.historia, "el id canonico es el UUID, no el identificador");
  assert.equal(typeof item.id, "string", "los ids de Linear son UUID: el id canonico es string");
  assert.equal(item.key, "ENG-123");
  assert.equal(item.url, "https://linear.app/acme/issue/ENG-123/el-daemon-toma-el-ticket-asignado");
  assert.equal(validateItem(item).ok, true);
});

test("getItem por UUID filtra por id.eq", async () => {
  const { ctx, llamadas } = nuevoCtx();
  const item = await linear.getItem(IDS.historia, ctx);
  assert.equal(llamadas[0].variables.filtro.id.eq, IDS.historia);
  assert.equal(item.key, "ENG-123");
});

test("un id inexistente devuelve null sin leer el texto de ningun error", async () => {
  const { ctx, llamadas } = nuevoCtx();
  assert.equal(await linear.getItem(IDS.inexistente, ctx), null);
  // `issue(id:)` es Issue! (no nulable): un id inexistente contesta errors[] y
  // habria que adivinar el texto. `issues(filter:)` contesta nodes: [].
  assert.match(llamadas[0].query, /issues\(filter:/);
  assert.equal(/\bissue\(id:/.test(llamadas[0].query), false);
});

test("un id que no es UUID ni identificador devuelve null sin gastar un viaje", async () => {
  const { ctx, llamadas } = nuevoCtx();
  assert.equal(await linear.getItem("no-existe", ctx), null);
  assert.equal(llamadas.length, 0, "no hay filtro posible para ese id: no existe, y preguntarlo es gasto puro");
});

test("acceptance sale de los criterios de la descripcion y no arrastra el resto", async () => {
  const { ctx } = nuevoCtx();
  const item = await linear.getItem("ENG-123", ctx);
  assert.deepEqual(item.acceptance, [
    "Dado un ticket asignado, cuando el daemon lo toma, entonces queda en curso",
    "Dado un PR abierto, cuando se anota en el ticket, entonces el adjunto apunta al PR",
  ]);
});

test("boardFields trae los campos heredables del tablero", async () => {
  const { ctx } = nuevoCtx();
  const item = await linear.getItem("ENG-123", ctx);
  assert.deepEqual(item.boardFields, {
    teamId: IDS.equipo,
    teamKey: "ENG",
    projectId: IDS.proyecto,
    projectMilestoneId: IDS.hito,
    cycleId: IDS.ciclo,
    assigneeId: IDS.persona,
    estimate: 3,
  });
});

// ------------------------------------------------------------------ niveles

test("el nivel sale del mapa de etiquetas, nunca de la estructura", async () => {
  const { ctx } = nuevoCtx();
  assert.equal((await linear.getItem("ENG-100", ctx)).level, "epic");
  assert.equal((await linear.getItem("ENG-123", ctx)).level, "story");
  // Etiquetada Epic Y con padre. Deducir el nivel de `parent == null` es la
  // misma deduccion que el contrato prohibe, con otro disfraz: esta quedaria
  // "task" por accidente.
  assert.equal((await linear.getItem("ENG-900", ctx)).level, "epic");
});

test("una etiqueta que no esta en el mapa, o ninguna etiqueta, cae en el default explicito", async () => {
  const { ctx } = nuevoCtx();
  assert.equal((await linear.getItem("ENG-777", ctx)).level, "story");
  assert.equal((await linear.getItem("ENG-500", ctx)).level, "story");
});

test("el mapa de niveles de la configuracion gana, y el default no se puede perder", async () => {
  const { ctx } = nuevoCtx({ options: { levelMap: { Story: "task", default: "feature" } } });
  assert.equal((await linear.getItem("ENG-123", ctx)).level, "task");
  assert.equal((await linear.getItem("ENG-777", ctx)).level, "feature");
});

// ------------------------------------------------------------------ estados

test("el estado canonico sale del stateMap por nombre", async () => {
  const { ctx } = nuevoCtx();
  assert.equal((await linear.getItem("ENG-123", ctx)).canonicalState, "todo");
  assert.equal((await linear.getItem("ENG-100", ctx)).canonicalState, "in_progress");
});

test("un nombre de estado que el mapa no tiene cae en state.type, que es un enum del gestor", async () => {
  const { ctx } = nuevoCtx();
  // "Listo para QA" es un nombre que puso el equipo; `type` es "started".
  const item = await linear.getItem("ENG-500", ctx);
  assert.equal(item.state, "Listo para QA");
  assert.equal(item.canonicalState, "in_progress");
});

test("canceled no tiene equivalente canonico y se deja en null", async () => {
  const { ctx } = nuevoCtx();
  const item = await linear.getItem("ENG-321", ctx);
  assert.equal(item.canonicalState, null);
  assert.equal(validateItem(item).ok, true, "null es una respuesta valida: inventar un canonico seria peor");
});

test("el mapa de estados es total: los cinco canonicos tienen entrada", () => {
  const mapa = fixtures.ctx.options.stateMap;
  for (const s of CANONICAL_STATES) assert.ok(s in mapa, `falta ${s}`);
  assert.equal(mapa.blocked, null, "Linear no tiene estado Blocked en ninguna plantilla");
  assert.equal(mapa.in_review, null);
  assert.equal(mapa.done, null, "el motor nunca pide done");
});

// -------------------------------------------------------------- setState

test("setState resuelve el NOMBRE destino a un stateId del equipo y despues escribe", async () => {
  const { ctx, llamadas } = nuevoCtx();
  const r = await linear.setState("ENG-123", "in_progress", ctx);

  // Los estados de workflow son por equipo y se piden por UUID: escribir el
  // nombre en `stateId` es un input invalido, no un estado nuevo.
  assert.match(llamadas.at(-2).query, /workflowStates\(/);
  assert.equal(llamadas.at(-2).variables.name, "In Progress");
  assert.equal(llamadas.at(-2).variables.team, "ENG");
  assert.match(llamadas.at(-1).query, /issueUpdate\(/);
  assert.equal(llamadas.at(-1).variables.stateId, "st-progress");
  assert.equal(r.written, "In Progress");
});

test("un canonico declarado null en el mapa no se escribe: se informa como omitido", async () => {
  const { ctx, llamadas } = nuevoCtx();
  const r = await linear.setState("ENG-123", "in_review", ctx);
  assert.deepEqual(r, { written: null, skipped: "in_review" });
  assert.equal(llamadas.length, 0, "ni siquiera se pregunta: el mapa ya dijo que ese estado no existe");
});

test("un nombre de estado que el equipo no tiene lanza, y dice que nombre y que equipo", async () => {
  // El mapa promete un estado que la plantilla del equipo no tiene: es un error
  // de configuracion, y callarlo deja el tablero quieto sin que nadie se entere.
  const { ctx } = nuevoCtx({ options: { stateMap: { todo: "Todo", in_progress: "In Progress", blocked: "Blocked", in_review: null, done: null } } });
  await assert.rejects(() => linear.setState("ENG-123", "blocked", ctx), /Blocked.*ENG|ENG.*Blocked/s);
});

test("con teamKey en las opciones, setState no gasta el viaje de leer el equipo", async () => {
  const { ctx, llamadas } = nuevoCtx({ options: { teamKey: "ENG" } });
  await linear.setState("ENG-123", "todo", ctx);
  assert.equal(llamadas.length, 2, "workflowStates + issueUpdate, sin el issue(id:){team}");
});

// --------------------------------------------------------------- children

test("children pagina: un hito con mas hijos que la pagina no pierde los ultimos", async () => {
  const { ctx, llamadas } = nuevoCtx();
  const hijos = await linear.children("ENG-100", ctx);

  assert.equal(llamadas.length, 2, "`children(first: 50)` pagina: hay que seguir el endCursor");
  assert.equal(llamadas[1].variables.after, "cursor-pagina-2");
  assert.deepEqual(hijos.map((h) => h.key), ["ENG-123", "ENG-124"]);
  for (const h of hijos) assert.equal(validateItem(h).ok, true);
});

// ----------------------------------------------------------- dependencies

test("dependencies usa el enum blocks en las dos direcciones, y no deduce nada", async () => {
  const { ctx, llamadas } = nuevoCtx();
  const d = await linear.dependencies("ENG-124", ctx);

  assert.equal(llamadas.length, 1, "relations e inverseRelations van en el mismo viaje");
  // `blocked_by` no existe como tipo propio en Linear: es la inversa de blocks.
  assert.deepEqual(d.predecessors, [IDS.historia]);
  assert.deepEqual(d.successors, [IDS.epicaHija]);
});

test("related y duplicate no son dependencias: no afirman precedencia", async () => {
  const { ctx } = nuevoCtx();
  const d = await linear.dependencies("ENG-124", ctx);
  const todos = [...d.predecessors, ...d.successors];
  assert.equal(todos.includes(IDS.tipoRaro), false, "un `related` como dependencia serializa trabajo que el gestor nunca ordeno");
  assert.equal(todos.includes(IDS.cancelada), false);
});

test("un item sin relaciones devuelve las dos listas vacias", async () => {
  const { ctx } = nuevoCtx();
  assert.deepEqual(await linear.dependencies("ENG-123", ctx), { predecessors: [], successors: [] });
});

// -------------------------------------------------- comment, linkUrl, labels

test("comment crea el comentario y devuelve su id", async () => {
  const { ctx, llamadas } = nuevoCtx();
  const r = await linear.comment("ENG-123", "noxloop arranco el recorrido", ctx);
  assert.match(llamadas[0].query, /commentCreate\(/);
  assert.equal(llamadas[0].variables.body, "noxloop arranco el recorrido");
  assert.equal(r.id, "cmt-1");
});

test("una escritura rechazada por permisos lanza con el mensaje textual del gestor", async () => {
  const { ctx } = nuevoCtx();
  await assert.rejects(() => linear.comment(DISPARADORES.sinPermiso, "hola", ctx), new RegExp(MENSAJES.sinPermiso));
});

test("linkUrl de un PR de GitHub usa el adjunto rico del integrador", async () => {
  const { ctx, llamadas } = nuevoCtx();
  const r = await linear.linkUrl("ENG-123", "https://github.com/acme/app/pull/42", "Pull request", ctx);
  // attachmentLinkGitHubPR sincroniza el estado del PR en el ticket. Degradar
  // el PR a un adjunto generico pierde esa sincronizacion sin motivo.
  assert.match(llamadas[0].query, /attachmentLinkGitHubPR\(/);
  assert.equal(r.ok, true);
});

test("linkUrl de cualquier otra URL usa el adjunto generico", async () => {
  const { ctx, llamadas } = nuevoCtx();
  const r = await linear.linkUrl("ENG-123", "https://ci.acme.dev/builds/7", "Gate", ctx);
  assert.match(llamadas[0].query, /attachmentLinkURL\(/);
  assert.equal(r.ok, true);
});

test("addLabel resuelve el UUID de la etiqueta por nombre antes de agregarla", async () => {
  const { ctx, llamadas } = nuevoCtx();
  const r = await linear.addLabel("ENG-123", "noxloop", ctx);
  assert.match(llamadas[0].query, /issueLabels\(/);
  assert.equal(llamadas[1].variables.labelId, "lbl-noxloop");
  // issueAddLabel suma; `issueUpdate(labelIds:)` reemplaza las existentes.
  assert.match(llamadas[1].query, /issueAddLabel\(/);
  assert.equal(r.ok, true);
});

test("una etiqueta que no existe lanza y lo dice: este proveedor no crea etiquetas al pasar", async () => {
  const { ctx } = nuevoCtx();
  await assert.rejects(() => linear.addLabel("ENG-123", "no-existe-esta", ctx), /no-existe-esta/);
});

// -------------------------------------------------------------- createChild

test("createChild lee el teamId del padre, porque issueCreate lo exige y parentId no lo implica", async () => {
  const { ctx, llamadas } = nuevoCtx();
  const hijo = await linear.createChild("ENG-100", { id: "T001", title: "Escribir el test rojo", acceptance: ["Dado X, entonces Y"], repo: "app" }, ctx);

  assert.match(llamadas[0].query, /team \{ id key \}/);
  const input = llamadas.at(-1).variables.input;
  assert.equal(input.teamId, IDS.equipo, "sin teamId, issueCreate falla por input invalido");
  assert.equal(input.parentId, "ENG-100");
  assert.equal(input.title, "Escribir el test rojo");
  assert.match(input.description, /Dado X, entonces Y/);
  assert.equal(validateItem(hijo).ok, true);
});

test("el hijo creado lleva la etiqueta del nivel task: sin ella volveria como story", async () => {
  const { ctx, llamadas } = nuevoCtx();
  const hijo = await linear.createChild("ENG-100", { id: "T001", title: "Una tarea" }, ctx);
  assert.deepEqual(llamadas.at(-1).variables.input.labelIds, ["lbl-task"]);
  assert.equal(hijo.level, "task", "el nivel sale de las etiquetas: una tarea sin etiqueta volveria del gestor como story");
});

test("createChild hereda los campos de tablero del padre", async () => {
  const { ctx, llamadas } = nuevoCtx();
  await linear.createChild(
    "ENG-100",
    { id: "T002", title: "Con tablero", boardFields: { projectId: IDS.proyecto, projectMilestoneId: IDS.hito, cycleId: IDS.ciclo, assigneeId: IDS.persona, estimate: 2, teamId: IDS.equipo, teamKey: "ENG" } },
    ctx,
  );
  const input = llamadas.at(-1).variables.input;
  // Una hija sin ciclo ni proyecto no aparece en ningun taskboard.
  assert.equal(input.projectId, IDS.proyecto);
  assert.equal(input.projectMilestoneId, IDS.hito);
  assert.equal(input.cycleId, IDS.ciclo);
  assert.equal(input.assigneeId, IDS.persona);
  assert.equal(input.estimate, 2);
  assert.equal(input.teamId, IDS.equipo);
});

test("con teamId en boardFields, createChild no vuelve a leer el padre", async () => {
  const { ctx, llamadas } = nuevoCtx();
  await linear.createChild("ENG-100", { id: "T003", title: "Sin viaje extra", boardFields: { teamId: IDS.equipo } }, ctx);
  assert.equal(/team \{ id key \}/.test(llamadas[0].query), false);
});

// -------------------------------------------------------------- searchInbox

test("searchInbox parte las notificaciones por category, en un solo viaje", async () => {
  const { ctx, llamadas } = nuevoCtx();
  const inbox = await linear.searchInbox(ctx);

  assert.equal(llamadas.length, 1);
  // `category` es un enum documentado; `Notification.type` es String! sin
  // valores documentados, asi que el corte va por category y del lado de aca.
  assert.deepEqual(inbox.assigned.map((i) => i.key), ["ENG-123", "ENG-124"], "dos notificaciones del mismo issue son un item, no dos");
  for (const i of inbox.assigned) assert.equal(validateItem(i).ok, true);
});

test("mentioned viene vacio mientras searchMentioned este en false", () => {
  // Devolver menciones con la capacidad en false le daria al motor un disparo
  // que el proveedor le dijo que no tenia.
  assert.equal(linear.capabilities().searchMentioned, false);
});

test("mentioned vacio es coherente con la capacidad declarada", async () => {
  const { ctx } = nuevoCtx();
  const inbox = await linear.searchInbox(ctx);
  assert.deepEqual(inbox.mentioned, []);
});

// ------------------------------------------------- niveles: claves hostiles

test("una etiqueta llamada como una propiedad de Object cae en el default, no en el prototipo", async () => {
  const { ctx } = nuevoCtx();
  const item = await linear.getItem("ENG-666", ctx);
  // `mapa["constructor"]` devuelve una funcion heredada del prototipo: sin
  // chequear que la clave sea PROPIA, el nivel vuelve siendo `[Function]` y el
  // motor descarta un ticket perfectamente valido por "level invalido".
  assert.equal(item.level, "story", "el nivel tiene que salir del mapa, no del prototipo de Object");
  assert.equal(validateItem(item).ok, true);
});

test("un levelMap con un valor que no es un nivel canonico cae en el default declarado", async () => {
  // El mapa lo escribe una persona en la configuracion: "defecto" en vez de
  // "task" es un error de tipeo que el motor solo veria como un Item invalido
  // a mitad del recorrido, sin decir de donde salio.
  const { ctx } = nuevoCtx({ options: { levelMap: { Chore: "defecto" } } });
  const item = await linear.getItem("ENG-777", ctx);
  assert.equal(item.level, "story");
  assert.equal(validateItem(item).ok, true);
});

test("un levelMap con un default que no es canonico cae en el default del proveedor", async () => {
  const { ctx } = nuevoCtx({ options: { levelMap: { default: "ninguno" } } });
  const item = await linear.getItem("ENG-500", ctx);
  assert.equal(item.level, "story");
});

// --------------------------------------------- respuestas de forma imposible

const ISSUE_ROTO = {
  id: IDS.historia,
  identifier: "ENG-123",
  title: "t",
  description: "",
  url: "https://linear.app/acme/issue/ENG-123/t",
  estimate: null,
  state: { id: "st-todo", name: "Todo", type: "unstarted" },
  parent: null,
  assignee: null,
  labels: { nodes: [] },
  team: { id: IDS.equipo, key: "ENG" },
  project: null,
  projectMilestone: null,
  cycle: null,
};

test("children saltea un nodo null en vez de reventar con un TypeError", async () => {
  const { ctx } = ctxRoto(() => ({
    data: { issue: { children: { nodes: [null, ISSUE_ROTO], pageInfo: { hasNextPage: false, endCursor: null } } } },
  }));
  const hijos = await linear.children(IDS.epica, ctx);
  // Un null en la lista reventaba en `String(crudo.id)`, y el recorrido moria
  // con "Cannot read properties of null (reading 'id')": un mensaje que no
  // dice ni que gestor ni que ticket.
  assert.equal(hijos.length, 1);
  assert.equal(validateItem(hijos[0]).ok, true);
});

test("un nodo sin id se saltea: un Item sin id no se puede comparar contra el estado en disco", async () => {
  const { ctx } = ctxRoto(() => ({
    data: { issue: { children: { nodes: [{ title: "sin id" }, ISSUE_ROTO], pageInfo: {} } } },
  }));
  assert.equal((await linear.children(IDS.epica, ctx)).length, 1);
});

test("labels.nodes que no es una lista no revienta: el nivel cae en el default", async () => {
  const { ctx } = ctxRoto(() => ({ data: { issues: { nodes: [{ ...ISSUE_ROTO, labels: { nodes: { name: "Task" } } }] } } }));
  const item = await linear.getItem(IDS.historia, ctx);
  assert.equal(item.level, "story");
  assert.deepEqual(item.labels, []);
});

test("searchInbox deduplica por el id canonico, no por el crudo del gestor", async () => {
  // Dos notificaciones del mismo ticket con el id en tipos distintos (7 y "7")
  // son un item. Comparar el crudo las cuenta como dos, y el motor arranca dos
  // recorridos sobre el mismo ticket: dos ramas y dos PR para una historia.
  const { ctx } = ctxRoto(() => ({
    data: {
      notifications: {
        nodes: [
          { id: "n1", category: "assignments", issue: { ...ISSUE_ROTO, id: 7 } },
          { id: "n2", category: "assignments", issue: { ...ISSUE_ROTO, id: "7" } },
        ],
      },
    },
  }));
  const inbox = await linear.searchInbox(ctx);
  assert.equal(inbox.assigned.length, 1);
  assert.equal(inbox.assigned[0].id, "7");
  assert.equal(typeof inbox.assigned[0].id, "string");
});

// ------------------------------------- escrituras que no pueden decir "listo"

test("addLabel no dice que agrego la etiqueta si el gestor devolvio una etiqueta sin id", async () => {
  // Mandaba el string "undefined" como labelId y devolvia `{ok: true}`: el
  // recorrido sigue creyendo que el ticket quedo etiquetado y el tablero no
  // muestra nada.
  const { ctx } = ctxRoto((q) => {
    if (q.includes("issueLabels(")) return { data: { issueLabels: { nodes: [{ name: "noxloop" }] } } };
    return { data: { issueAddLabel: { success: true } } };
  });
  await assert.rejects(() => linear.addLabel("ENG-123", "noxloop", ctx), /noxloop/);
});

test("setState no escribe un stateId indefinido cuando el estado vuelve sin id", async () => {
  const { ctx, llamadas } = ctxRoto((q) => {
    if (q.includes("workflowStates(")) return { data: { workflowStates: { nodes: [{ name: "Todo", type: "unstarted" }] } } };
    if (q.includes("issueUpdate(")) return { data: { issueUpdate: { success: true, issue: { id: IDS.historia, state: { name: "Todo" } } } } };
    if (q.includes("team { id key }")) return { data: { issue: { id: IDS.historia, team: { id: IDS.equipo, key: "ENG" } } } };
    throw new Error(`query inesperada: ${q}`);
  });
  await assert.rejects(() => linear.setState("ENG-123", "todo", ctx), /Todo/);
  assert.equal(llamadas.some((l) => /issueUpdate\(/.test(l.query)), false, "no se manda una mutacion con stateId undefined");
});

test("un acceptanceHeading que no compila lo dice nombrando la opcion", async () => {
  // Antes salia un `SyntaxError: Invalid regular expression` desde getItem, sin
  // nombrar la opcion ni el proveedor: el error parecia un bug del motor.
  const { ctx } = nuevoCtx({ options: { acceptanceHeading: "criterios(" } });
  await assert.rejects(() => linear.getItem("ENG-123", ctx), /acceptanceHeading/);
});

test("un state.type que choca con el prototipo de Object no se cuela como estado canonico", async () => {
  // Mismo fallo que las etiquetas, una linea mas abajo: `TIPOS_DE_ESTADO[type]`
  // con type "constructor" devuelve una funcion, `?? null` no la atrapa —una
  // funcion no es nullish— y el Item vuelve con `canonicalState: [Function]`.
  // `state.type` es un enum del gestor, asi que hace falta que Linear agregue o
  // renombre un valor; el guard cuesta una linea y el fallo cuesta el recorrido.
  const { ctx } = ctxRoto(() => ({
    data: { issues: { nodes: [{ ...ISSUE_ROTO, state: { id: "s", name: "Raro", type: "constructor" } }] } },
  }));
  const item = await linear.getItem(IDS.historia, ctx);
  assert.equal(item.canonicalState, null, "un type que el mapa no declara no tiene equivalente canonico");
  assert.equal(validateItem(item).ok, true);
});
