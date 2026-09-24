// La suite de contrato entera sobre el proveedor de Azure DevOps, mas los casos
// propios de este gestor.
//
// POR QUE LOS FIXTURES SON RESPUESTAS GRABADAS Y NO UNA CUENTA DE PRUEBA. Un
// test que necesita una organizacion, un proyecto y un PAT no lo puede correr
// quien adopte el proyecto: queda "verde" en la maquina del que lo escribio y
// saltado en todas las demas. Aca el `ctx.fetch` falso sirve cuerpos copiados de
// la documentacion de la API, con los nombres de referencia reales
// (`System.WorkItemType`, `System.Tags`, `System.LinkTypes.*`), y falla ruidoso
// si el proveedor pide una URL que nadie grabo.
//
// POR QUE LOS FIXTURES VIVEN ACA Y NO EXPORTADOS DESDE `index.mjs` como en el
// proveedor falso: el falso ES su propio gestor de mentira, asi que sus datos
// son parte del proveedor. Este habla por red, y las respuestas grabadas son
// datos de prueba. Un `index.mjs` que las exporte las carga en produccion.

import { test } from "node:test";
import assert from "node:assert/strict";
import { contractChecks, validateItem, CAPABILITY_KEYS } from "../contract.mjs";
import * as azdo from "./index.mjs";

// ---------------------------------------------------------------- constantes
const ORG = "contoso";
const PROY = "Fabrikam";
const EQUIPO = "Fabrikam Team";
const PAT = "pat-de-prueba-que-no-sirve-en-ningun-lado";
const B = "https://dev.azure.com";
// Asi escribe la API las urls de relacion: nivel organizacion, sin proyecto.
const API = `${B}/${ORG}/_apis/wit/workItems`;
const UI = `${B}/${ORG}/${PROY}/_workitems/edit`;

// Los cuatro mapas de nivel de las plantillas de sistema. El mismo codigo de
// proveedor tiene que resolver los tres nombres distintos del nivel "story"
// sin una sola comparacion contra un nombre de tipo.
const MAPA_AGILE = { Epic: "epic", Feature: "feature", "User Story": "story", Task: "task", Bug: "story", default: "story" };
const MAPA_SCRUM = { Epic: "epic", Feature: "feature", "Product Backlog Item": "story", Task: "task", Bug: "story", default: "story" };
const MAPA_BASIC = { Epic: "epic", Issue: "story", Task: "task", default: "story" };

// Estados de la plantilla Agile. `blocked` y `done` en null a proposito:
// Agile no tiene estado de bloqueo, y el motor nunca pide `done` porque cerrar
// un ticket dice que esta integrado y la autonomia termina en el PR abierto.
const ESTADOS = { todo: "New", in_progress: "Active", blocked: null, in_review: "Resolved", done: null };

const IDENTIDAD = {
  displayName: "Noxloop Bot",
  uniqueName: "noxloop@contoso.test",
  id: "d6245f00-bea4-4a0f-a1d4-000000000000",
};

// ------------------------------------------------------- items grabados
function wi(id, tipo, titulo, estado, extra = {}) {
  return {
    id,
    rev: extra.rev ?? 3,
    fields: {
      "System.Id": id,
      "System.WorkItemType": tipo,
      "System.Title": titulo,
      "System.State": estado,
      "System.TeamProject": PROY,
      "System.IterationPath": `${PROY}\\Sprint 12`,
      "System.AreaPath": `${PROY}\\Pagos`,
      "System.AssignedTo": IDENTIDAD,
      ...(extra.fields || {}),
    },
    relations: extra.relations || [],
    _links: { self: { href: `${API}/${id}` }, html: { href: `${UI}/${id}` } },
    url: `${API}/${id}`,
  };
}

const HIJOS_MUCHOS = Array.from({ length: 250 }, (_, i) => 1000 + i);

const ITEMS = {
  // El caso completo: padre, dos hijos, un predecesor, un sucesor y un
  // hipervinculo previo. Notar que el sucesor viene con la `f` MINUSCULA
  // (`Dependency-forward`), que es como lo escribe un ejemplo de la propia
  // documentacion: si el proveedor comparara sensible a mayusculas, el DAG
  // saldria sin ese arco y el motor serializaria de menos sin decir nada.
  297: wi(297, "User Story", "Registrar el pago de una subasta", "Active", {
    rev: 4,
    fields: {
      "System.Parent": 296,
      "System.Tags": "noxloop; pagos",
      "System.Description": "<div>El pago hoy se concilia a mano.</div>",
      "Microsoft.VSTS.Common.AcceptanceCriteria":
        "<div>Dado un pago aprobado<br>cuando se confirma el cobro<br>entonces el estado queda en conciliado</div>",
    },
    relations: [
      { rel: "System.LinkTypes.Hierarchy-Reverse", url: `${API}/296`, attributes: { name: "Parent" } },
      { rel: "System.LinkTypes.Hierarchy-Forward", url: `${API}/298`, attributes: { name: "Child" } },
      { rel: "System.LinkTypes.Hierarchy-Forward", url: `${API}/299`, attributes: { name: "Child" } },
      { rel: "System.LinkTypes.Dependency-Reverse", url: `${API}/295`, attributes: { name: "Predecessor" } },
      { rel: "System.LinkTypes.Dependency-forward", url: `${API}/301`, attributes: { name: "Successor" } },
      { rel: "Hyperlink", url: "https://github.com/org/repo/pull/7", attributes: { comment: "PR anterior" } },
    ],
  }),
  // Un hito con un hijo que el batch OMITE (errorPolicy: omit). Un id borrado
  // entre la lectura de relaciones y la hidratacion no puede voltear el
  // recorrido entero.
  296: wi(296, "Epic", "Unificacion de pagos", "New", {
    relations: [
      { rel: "System.LinkTypes.Hierarchy-Forward", url: `${API}/297` },
      { rel: "System.LinkTypes.Hierarchy-Forward", url: `${API}/9999` },
    ],
  }),
  // Tipo heredado que no esta en ningun mapa: tiene que caer en el default.
  // "Ticket" es el nombre que usa el propio ejemplo oficial de
  // backlogconfiguration, conviviendo con "User Story" en el mismo nivel.
  298: wi(298, "Ticket", "Un tipo de un proceso heredado", "Active"),
  299: wi(299, "Task", "Cerrar la conciliacion", "New"),
  // Estado nativo que el stateMap no declara: el canonico tiene que salir null,
  // no "todo". Un item en Removed reportado como todo se vuelve a despachar.
  300: wi(300, "Task", "Tarea retirada", "Removed"),
  // Sin hijos: el proveedor no puede gastar un viaje al batch.
  302: wi(302, "User Story", "Historia sin hijos", "New"),
  // Muchos hijos: obliga a partir el batch en trozos de 200.
  400: wi(400, "Feature", "Hito enorme", "New", {
    relations: HIJOS_MUCHOS.map((h) => ({ rel: "System.LinkTypes.Hierarchy-Forward", url: `${API}/${h}` })),
  }),
};

// ------------------------------------------------ el listado del board (003)

/**
 * `GET _apis/wit/workitemtypes`, recortado a lo que el proveedor lee: el nombre
 * de cada tipo y sus estados con su CATEGORIA (Proposed, InProgress, Resolved,
 * Completed, Removed). La categoria es el enum del gestor —el equivalente del
 * `state.type` de Linear—; el nombre del estado cambia por plantilla.
 *
 * "Ticket" es un tipo de proceso heredado con un estado propio ("En espera")
 * que ningun stateMap nombra: su columna tiene que salir de la categoria.
 */
const estadosAgile = [
  { name: "New", color: "b2b2b2", category: "Proposed" },
  { name: "Active", color: "007acc", category: "InProgress" },
  { name: "Resolved", color: "ff9d00", category: "Resolved" },
  { name: "Closed", color: "339933", category: "Completed" },
  { name: "Removed", color: "ffffff", category: "Removed" },
];
const TIPOS_AGILE = {
  count: 5,
  value: [
    { name: "Epic", referenceName: "Microsoft.VSTS.WorkItemTypes.Epic", states: estadosAgile },
    { name: "Feature", referenceName: "Microsoft.VSTS.WorkItemTypes.Feature", states: estadosAgile },
    { name: "User Story", referenceName: "Microsoft.VSTS.WorkItemTypes.UserStory", states: estadosAgile },
    { name: "Bug", referenceName: "Microsoft.VSTS.WorkItemTypes.Bug", states: estadosAgile.filter((e) => e.name !== "Removed") },
    {
      name: "Task",
      referenceName: "Microsoft.VSTS.WorkItemTypes.Task",
      states: estadosAgile.filter((e) => e.name !== "Resolved"),
    },
    {
      name: "Ticket",
      referenceName: "Fabrikam.Ticket",
      states: [
        { name: "New", color: "b2b2b2", category: "Proposed" },
        { name: "En espera", color: "cccccc", category: "InProgress" },
        { name: "Closed", color: "339933", category: "Completed" },
      ],
    },
  ],
};

/** Una identidad con avatar, como la manda `$expand=all` en System.AssignedTo. */
const ANA = {
  displayName: "Ana Pérez",
  uniqueName: "ana@contoso.test",
  id: "a1b2c3d4-0000-4000-8000-000000000001",
  imageUrl: `${B}/${ORG}/_apis/GraphProfile/MemberAvatars/aad.ana`,
  _links: { avatar: { href: `${B}/${ORG}/_apis/GraphProfile/MemberAvatars/aad.ana` } },
};

function wiListado(id, tipo, titulo, estado, { iteracion = `${PROY}\\Sprint 12`, prioridad, asignado = null, area = `${PROY}\\Pagos`, cambio } = {}) {
  const campos = {
    "System.IterationPath": iteracion,
    "System.AreaPath": area,
    "System.AssignedTo": asignado,
    "System.ChangedDate": cambio,
  };
  if (prioridad !== undefined) campos["Microsoft.VSTS.Common.Priority"] = prioridad;
  return wi(id, tipo, titulo, estado, { fields: campos });
}

/** @type {Record<string, any>} */
const LISTADO = {
  // Propuesto y en la RAIZ de iteraciones: no esta en ningun sprint. Backlog.
  501: wiListado(501, "User Story", "Cobrar en cuotas", "New", { iteracion: PROY, prioridad: 1, asignado: ANA, cambio: "2026-09-21T10:00:00.000Z" }),
  // Propuesto pero YA en un sprint: por hacer.
  502: wiListado(502, "User Story", "Conciliar el cobro", "New", { prioridad: 2, cambio: "2026-09-20T10:00:00.000Z" }),
  503: wiListado(503, "Task", "Escribir la migracion", "Active", { prioridad: 4, cambio: "2026-09-19T10:00:00.000Z" }),
  // Sin campo de prioridad: null, no un default.
  504: wiListado(504, "Bug", "El recibo sale en blanco", "Resolved", { area: `${PROY}\\Pagos\\Recibos`, cambio: "2026-09-18T10:00:00.000Z" }),
  // Estado que el stateMap no nombra: la columna sale de la categoria.
  505: wiListado(505, "Ticket", "Esperando al proveedor", "En espera", { prioridad: 3, cambio: "2026-09-17T10:00:00.000Z" }),
  507: wiListado(507, "User Story", "Ya cobrado", "Closed", { prioridad: 2, cambio: "2026-09-16T10:00:00.000Z" }),
  // Retirado: solo llega con una WIQL propia que no lo excluye.
  508: wiListado(508, "User Story", "Retirado", "Removed", { cambio: "2026-09-15T10:00:00.000Z" }),
};
const IDS_LISTADO = [501, 502, 503, 504, 505];

/** Los ids que el gestor no tiene: el batch los omite y el GET da 404. */
const NO_EXISTEN = new Set(["9999", "999999"]);

function sintetico(id) {
  return wi(Number(id), "Task", `Tarea ${id}`, "New");
}

// ------------------------------------------------------ el gestor grabado
/**
 * Sirve respuestas grabadas y anota cada pedido. Si el proveedor pide algo que
 * no esta grabado, revienta con la clave exacta que falta: es lo que convierte
 * un cambio de URL en un test rojo y no en un 404 en produccion.
 */
function gestorGrabado(grabaciones) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    const pedido = {
      method,
      url: String(url),
      headers: init.headers || {},
      body: init.body ? JSON.parse(init.body) : null,
    };
    calls.push(pedido);
    const grabado = grabaciones[`${method} ${url}`];
    if (!grabado) throw new Error(`fixture no grabado: ${method} ${url}`);
    const r = typeof grabado === "function" ? grabado(pedido) : grabado;
    // `raw` sirve un cuerpo TAL CUAL, sin pasarlo por JSON.stringify. Hace
    // falta para grabar las dos respuestas que un gestor real manda y un
    // fixture serializado no puede representar: un 200 con el cuerpo vacio y
    // un 200 con la pagina de login en HTML.
    const cuerpo = r.raw !== undefined ? r.raw : r.body === undefined ? "" : JSON.stringify(r.body);
    return new Response(cuerpo, {
      status: r.status ?? 200,
      headers: { "content-type": r.contentType || "application/json" },
    });
  };
  return { fetch, calls };
}

const q = (params) => Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
const leer = (id, proyecto = PROY) =>
  `GET ${B}/${ORG}${proyecto ? `/${proyecto}` : ""}/_apis/wit/workitems/${id}?${q({ $expand: "all", "api-version": "7.1" })}`;
const escribir = (id) => `PATCH ${B}/${ORG}/${PROY}/_apis/wit/workitems/${id}?${q({ "api-version": "7.1" })}`;
const URL_BATCH = `POST ${B}/${ORG}/${PROY}/_apis/wit/workitemsbatch?${q({ "api-version": "7.1" })}`;
const URL_WIQL = `POST ${B}/${ORG}/${PROY}/_apis/wit/wiql?${q({ "api-version": "7.1" })}`;
const URL_COMENTARIO = (id) =>
  `POST ${B}/${ORG}/${PROY}/_apis/wit/workItems/${id}/comments?${q({ "api-version": "7.0-preview.3" })}`;
const URL_CREAR = (tipo) =>
  `POST ${B}/${ORG}/${PROY}/_apis/wit/workitems/$${encodeURIComponent(tipo)}?${q({ $expand: "all", "api-version": "7.1" })}`;
const URL_TIPOS = `GET ${B}/${ORG}/${PROY}/_apis/wit/workitemtypes?${q({ "api-version": "7.1" })}`;
const URL_BACKLOG = `GET ${B}/${ORG}/${PROY}/${encodeURIComponent(EQUIPO)}/_apis/work/backlogconfiguration?${q({ "api-version": "7.1" })}`;

/** El PATCH del gestor, con su control de concurrencia optimista sobre /rev. */
function parche(id) {
  return (pedido) => {
    const item = structuredClone(ITEMS[id]);
    const prueba = (pedido.body || []).find((o) => o.op === "test" && o.path === "/rev");
    if (prueba && prueba.value !== item.rev) {
      return { status: 409, body: { message: `VS403351: The work item ${id} has been changed by someone else.` } };
    }
    for (const o of pedido.body || []) {
      if (o.op === "add" && String(o.path).startsWith("/fields/")) item.fields[String(o.path).slice(8)] = o.value;
      if (o.op === "add" && o.path === "/relations/-") (item.relations ||= []).push(o.value);
    }
    item.rev += 1;
    return { status: 200, body: item };
  };
}

const GRABACIONES = {
  ...Object.fromEntries(Object.keys(ITEMS).map((id) => [leer(id), { status: 200, body: ITEMS[id] }])),
  ...Object.fromEntries(Object.keys(ITEMS).map((id) => [escribir(id), parche(id)])),
  // Sin proyecto configurado: `project` es opcional en la ruta de getItem.
  [leer(297, null)]: { status: 200, body: ITEMS[297] },

  // 404 real de la API. No esta en la tabla de Responses de la pagina de
  // referencia, que documenta solo el 200: por eso el chequeo 4 de la suite
  // existe. El contrato exige null, no una excepcion.
  [leer(999999)]: {
    status: 404,
    body: { message: `TF401232: Work item 999999 does not exist, or you do not have permissions to read it.` },
  },
  [leer(777)]: { status: 403, body: { message: "TF401027: You need to have 'View work items in this node' permission." } },
  [leer(888)]: { status: 500, body: { message: "VS800000: An internal error occurred." } },
  // ctx.fetch ya reintento y el limite sigue ahi: el proveedor lanza con el
  // mensaje textual del gestor.
  [leer(429)]: { status: 429, body: { message: "TF400733: The request has been canceled: Request was blocked due to exceeding usage of resource." } },

  // --------------------------------------- respuestas que NO son un work item
  // Un 200 con el cuerpo vacio. El contrato pide null para "no existe" y el
  // 404 ya lo cubre, pero un 200 vacio llegaba a `res.json()` y salia como
  // `SyntaxError: Unexpected end of JSON input`: un error de parseo en vez de
  // una respuesta, y sin el metodo ni la URL que dicen donde paso.
  [leer(100)]: { status: 200, raw: "" },
  // Un 200 (o 203) con la pagina de login. Es lo que devuelve la puerta de
  // entrada de Azure DevOps cuando la credencial no sirve y el pedido cae en la
  // interfaz web en vez de la API: HTTP dice 200 y el cuerpo es HTML.
  [leer(101)]: { status: 200, raw: "<html><head><title>Sign In</title></head></html>", contentType: "text/html" },
  // Un 200 con JSON que no es un work item: sin `id`. `String(undefined)`
  // producia el id "undefined", que pasa el validador del contrato (es un
  // string no vacio) y se persiste en el estado del recorrido como si fuera un
  // ticket.
  [leer(102)]: { status: 200, body: { rev: 1, fields: { "System.Title": "x" }, url: "u" } },
  // Un work item SIN `rev`. El `op: "test"` sobre `/rev` con `value: undefined`
  // desaparece al serializar, y el control de concurrencia optimista se apaga
  // sin que nada lo diga: la escritura pisa el cambio ajeno en silencio.
  [leer(103)]: (() => {
    const item = wi(103, "Task", "Sin rev", "New");
    delete item.rev;
    return { status: 200, body: item };
  })(),
  // `relations` que no es una lista. La forma real siempre es un array; esta no
  // lo es, y `(crudo.relations || []).filter` salia como TypeError crudo.
  [leer(104)]: { status: 200, body: { ...wi(104, "Task", "Relations raro", "New"), relations: { rel: "x" } } },
  // Un id de relacion que no es entero. El endpoint de lote toma enteros, y
  // `Number("abc")` es NaN: `JSON.stringify` lo manda como `null` y el gestor
  // contesta un 400 que no nombra el id culpable.
  [leer(105)]: {
    status: 200,
    body: wi(105, "Feature", "Hijo con id raro", "New", {
      relations: [{ rel: "System.LinkTypes.Hierarchy-Forward", url: `${API}/no-es-un-entero` }],
    }),
  },
  // El mismo arco de dependencia dos veces, una por cada forma en que la doc
  // escribe el `rel`. Contado dos veces, el motor serializa una espera que no
  // existe.
  [leer(106)]: {
    status: 200,
    body: wi(106, "User Story", "Arco repetido", "New", {
      relations: [
        { rel: "System.LinkTypes.Dependency-Forward", url: `${API}/301` },
        { rel: "System.LinkTypes.Dependency-forward", url: `${API}/301` },
        { rel: "System.LinkTypes.Dependency-Reverse", url: `${API}/295` },
        { rel: "System.LinkTypes.Dependency-Reverse", url: `${API}/295?api-version=7.1` },
      ],
    }),
  },

  [URL_BATCH]: (pedido) => ({
    status: 200,
    body: {
      count: pedido.body.ids.length,
      value: pedido.body.ids
        .map(String)
        .filter((id) => !NO_EXISTEN.has(id))
        .map((id) => ITEMS[id] || LISTADO[id] || sintetico(id)),
    },
  }),

  [URL_TIPOS]: { status: 200, body: TIPOS_AGILE },

  [URL_WIQL]: (pedido) => {
    // El listado del board: se reconoce por su ORDER BY, que la bandeja no usa.
    if (String(pedido.body.query).includes("ORDER BY [System.ChangedDate] DESC")) {
      // Lo que la WIQL no excluye, el gestor lo devuelve: asi se prueba que el
      // proveedor filtra igual una WIQL propia que no excluye nada.
      const consulta = String(pedido.body.query);
      const ids = [
        ...IDS_LISTADO,
        ...(consulta.includes("'Closed'") ? [] : [507]),
        ...(consulta.includes("'Removed'") ? [] : [508]),
      ];
      return {
        status: 200,
        body: {
          queryType: "flat",
          asOf: "2026-09-21T00:00:00Z",
          columns: [{ referenceName: "System.Id", name: "ID", url: `${API}` }],
          sortColumns: [{ field: { referenceName: "System.ChangedDate", name: "Changed Date" }, descending: true }],
          workItems: ids.map((id) => ({ id, url: `${API}/${id}` })),
        },
      };
    }
    const esMencion = String(pedido.body.query).includes("@RecentMentions");
    return {
      status: 200,
      body: {
        queryType: "flat",
        asOf: "2026-09-17T00:00:00Z",
        columns: [{ referenceName: "System.Id", name: "ID", url: `${API}` }],
        workItems: esMencion ? [{ id: 300, url: `${API}/300` }] : [{ id: 297, url: `${API}/297` }],
      },
    };
  },

  [URL_COMENTARIO(297)]: (pedido) => ({
    status: 200,
    body: {
      workItemId: 297,
      commentId: 50,
      version: 1,
      text: pedido.body.text,
      createdBy: IDENTIDAD,
      createdDate: "2026-09-17T00:00:00Z",
      mentions: [],
      url: `${B}/${ORG}/${PROY}/_apis/wit/workItems/297/comments/50`,
    },
  }),

  [URL_CREAR("Task")]: (pedido) => {
    const campos = Object.fromEntries(
      (pedido.body || []).filter((o) => String(o.path).startsWith("/fields/")).map((o) => [String(o.path).slice(8), o.value]),
    );
    return { status: 200, body: wi(310, "Task", campos["System.Title"], "New", { rev: 1, fields: campos }) };
  },
  [URL_CREAR("User Story")]: (pedido) => {
    const campos = Object.fromEntries(
      (pedido.body || []).filter((o) => String(o.path).startsWith("/fields/")).map((o) => [String(o.path).slice(8), o.value]),
    );
    return { status: 200, body: wi(311, "User Story", campos["System.Title"], "New", { rev: 1, fields: campos }) };
  },

  // Un proyecto Scrum: el nivel de requerimiento se llama "Product Backlog
  // Item" y el nivel epic esta apagado.
  [URL_BACKLOG]: {
    status: 200,
    body: {
      taskBacklog: { id: "Microsoft.TaskCategory", name: "Tasks", rank: 1, workItemTypes: [{ name: "Task" }], defaultWorkItemType: { name: "Task" } },
      requirementBacklog: {
        id: "Microsoft.RequirementCategory",
        name: "Backlog items",
        rank: 2,
        workItemTypes: [{ name: "Product Backlog Item" }, { name: "Bug" }],
        defaultWorkItemType: { name: "Product Backlog Item" },
      },
      portfolioBacklogs: [
        { id: "Microsoft.FeatureCategory", name: "Features", rank: 3, workItemTypes: [{ name: "Feature" }] },
        { id: "Microsoft.EpicCategory", name: "Epics", rank: 4, workItemTypes: [{ name: "Epic" }] },
        { id: "MiOrg.MiNivelCategory", name: "My level", rank: 5, workItemTypes: [{ name: "My level" }] },
      ],
      hiddenBacklogs: ["Microsoft.EpicCategory"],
      bugsBehavior: "asRequirements",
    },
  },
};

function hacerCtx(over = {}) {
  const gestor = gestorGrabado(GRABACIONES);
  const ctx = {
    options: {
      organization: ORG,
      project: PROY,
      team: EQUIPO,
      levelMap: MAPA_AGILE,
      stateMap: ESTADOS,
      ...(over.options || {}),
    },
    env: { AZURE_DEVOPS_EXT_PAT: PAT, ...(over.env || {}) },
    log: { info() {}, warn() {}, error() {} },
    fetch: gestor.fetch,
  };
  return { ctx, calls: gestor.calls };
}

const soloOpciones = (over) => hacerCtx({ options: over }).ctx;
const deTipo = (calls, patron) => calls.filter((c) => c.url.includes(patron));

// ------------------------------------------------------ 1. la suite entera
test("el proveedor de Azure DevOps pasa la suite de contrato entera", async () => {
  const { ctx } = hacerCtx();
  const fixtures = {
    ctx,
    defaultLevel: "story",
    knownItemId: "297",
    unknownItemId: "999999",
    unknownTypeItemId: "298",
    sourceUrl: new URL("./index.mjs", import.meta.url),
  };
  for (const check of contractChecks(azdo, fixtures)) {
    await check.run().catch((e) => {
      throw new Error(`${check.name}: ${e.message}`);
    });
  }
});

// ------------------------------------------------- 2. capacidades y entorno
test("declara las diez capacidades, todas en true: este gestor no ejercita ningun camino degradado", () => {
  const caps = azdo.capabilities();
  // `listItems` incluida, explicita: la clave es opcional en el contrato, pero
  // este gestor la tiene y la declara.
  assert.deepEqual(Object.keys(caps).sort(), [...CAPABILITY_KEYS].sort());
  const enFalse = Object.entries(caps).filter(([, v]) => v !== true).map(([k]) => k);
  assert.deepEqual(enFalse, [], "la degradacion se prueba con el proveedor falso, no bajando a false algo que el gestor si tiene");
});

test("requiredEnv declara UNA variable, la que documenta Microsoft para un PAT no interactivo", () => {
  assert.deepEqual(azdo.requiredEnv, ["AZURE_DEVOPS_EXT_PAT"]);
});

test("el PAT viaja como Basic con usuario vacio, y sale de ctx.env", async () => {
  const { ctx, calls } = hacerCtx();
  await azdo.getItem("297", ctx);
  const esperado = `Basic ${Buffer.from(`:${PAT}`).toString("base64")}`;
  assert.equal(calls[0].headers.Authorization, esperado);
});

test("sin el PAT en ctx.env lanza nombrando la variable, antes de gastar un viaje", async () => {
  const { ctx, calls } = hacerCtx({ env: { AZURE_DEVOPS_EXT_PAT: "" } });
  await assert.rejects(() => azdo.getItem("297", ctx), /AZURE_DEVOPS_EXT_PAT/);
  assert.equal(calls.length, 0);
});

test("organizacion y proyecto son configuracion: si faltan, lo dice y no arma una URL a medias", async () => {
  const sinOrg = soloOpciones({ organization: undefined });
  await assert.rejects(() => azdo.getItem("297", sinOrg), /organization/);
  const sinProyecto = soloOpciones({ project: undefined });
  // getItem funciona sin proyecto (la ruta lo acepta opcional)...
  assert.ok(await azdo.getItem("297", sinProyecto));
  // ...pero comment lo exige, y el error tiene que nombrarlo.
  await assert.rejects(() => azdo.comment("297", "hola", sinProyecto), /project/);
});

// --------------------------------------------------------- 3. getItem
test("getItem mapea el work item al modelo canonico", async () => {
  const { ctx } = hacerCtx();
  const item = await azdo.getItem("297", ctx);
  const v = validateItem(item);
  assert.ok(v.ok, v.problems.join("; "));

  assert.equal(item.id, "297");
  assert.equal(typeof item.id, "string", "el id canonico es string SIEMPRE: un numero rompe la comparacion contra el estado en disco");
  assert.equal(item.title, "Registrar el pago de una subasta");
  assert.equal(item.level, "story");
  assert.equal(item.state, "Active");
  assert.equal(item.canonicalState, "in_progress");
  assert.equal(item.parentId, "296");
  assert.deepEqual(item.labels, ["noxloop", "pagos"], "System.Tags es UN string separado por punto y coma");
  assert.deepEqual(item.acceptance, [
    "Dado un pago aprobado",
    "cuando se confirma el cobro",
    "entonces el estado queda en conciliado",
  ], "los criterios vienen en HTML y el modelo los quiere como lineas");
  assert.equal(item.url, `${UI}/297`, "la url es la humana (_links.html.href), no la de la API: un PR con una URL de JSON no le sirve a nadie");
  assert.deepEqual(item.boardFields, {
    iterationPath: `${PROY}\\Sprint 12`,
    areaPath: `${PROY}\\Pagos`,
    assignedTo: IDENTIDAD.uniqueName,
  });
  assert.equal(item.raw.rev, 4, "el rev viaja en raw: sin el no hay control de concurrencia en la escritura");
});

test("getItem de un id inexistente devuelve null y no lanza", async () => {
  const { ctx } = hacerCtx();
  assert.equal(await azdo.getItem("999999", ctx), null);
});

test("un rechazo por permisos lanza con el mensaje textual del gestor, sin resumirlo", async () => {
  const { ctx } = hacerCtx();
  await assert.rejects(() => azdo.getItem("777", ctx), /TF401027/);
  await assert.rejects(() => azdo.getItem("888", ctx), /VS800000/);
  await assert.rejects(() => azdo.getItem("429", ctx), /TF400733/);
});

test("un estado nativo que el mapa no declara da canonicalState null, no 'todo'", async () => {
  const { ctx } = hacerCtx();
  const item = await azdo.getItem("300", ctx);
  assert.equal(item.state, "Removed");
  assert.equal(item.canonicalState, null, "'todo' haria que el motor volviera a despachar un ticket retirado");
});

// ------------------------------------------ 4. el nivel sale del mapa, punto
test("el mismo codigo resuelve el nivel de requerimiento en Agile, Scrum y Basic", async () => {
  const agile = await azdo.getItem("297", soloOpciones({ levelMap: MAPA_AGILE }));
  assert.equal(agile.level, "story");

  // El MISMO item, leido con el mapa de Scrum: "User Story" no existe ahi, y
  // cae en el default declarado en vez de fallar.
  const scrum = await azdo.getItem("297", soloOpciones({ levelMap: MAPA_SCRUM }));
  assert.equal(scrum.level, "story");

  const basic = await azdo.getItem("298", soloOpciones({ levelMap: MAPA_BASIC }));
  assert.equal(basic.level, "story", "Basic no tiene nivel Feature y su nivel de requerimiento se llama Issue");
});

test("el nivel lo manda el mapa, no el nombre del tipo, ni siquiera para 'User Story'", async () => {
  // Un mapa absurdo A PROPOSITO: ningun proyecto pondria una historia en el
  // nivel epic. Si el nivel saliera de comparar el nombre del tipo contra una
  // constante —el atajo que anda en Agile y calla en Scrum— "User Story"
  // devolveria "story" y este test lo delata. El mapa gana siempre.
  const ctx = soloOpciones({ levelMap: { "User Story": "epic", default: "task" } });
  assert.equal((await azdo.getItem("297", ctx)).level, "epic");
  assert.equal((await azdo.getItem("298", ctx)).level, "task", "y el default tambien es el que declara el mapa");
});

test("un tipo que no existe en ningun gestor cae en el default del mapa", async () => {
  const { ctx } = hacerCtx();
  const item = await azdo.getItem("298", ctx);
  assert.equal(item.raw.fields["System.WorkItemType"], "Ticket");
  assert.equal(item.level, "story");
});

test("un mapa sin entrada `default` explicita se rechaza al resolver, no se adivina", async () => {
  const sinDefault = soloOpciones({ levelMap: { Epic: "epic" } });
  await assert.rejects(() => azdo.getItem("297", sinDefault), /default/);
});

// --------------------------------------------------------- 5. children
test("children sale del MISMO getItem y se hidrata en un solo viaje al batch", async () => {
  const { ctx, calls } = hacerCtx();
  const hijos = await azdo.children("297", ctx);

  assert.deepEqual(hijos.map((h) => h.id), ["298", "299"], "solo Hierarchy-Forward: el padre y el hipervinculo no son hijos");
  for (const h of hijos) assert.ok(validateItem(h).ok, validateItem(h).problems.join("; "));
  assert.equal(hijos[1].level, "task");

  assert.equal(deTipo(calls, "/workitemsbatch").length, 1, "una llamada, no una por hijo");
  assert.equal(deTipo(calls, "/wiql").length, 0, "no hace falta WIQL recursivo para un nivel de hijos");
  assert.deepEqual(calls.find((c) => c.url.includes("/workitemsbatch")).body.errorPolicy, "omit");
});

test("children de un item sin hijos devuelve [] sin tocar el batch", async () => {
  const { ctx, calls } = hacerCtx();
  assert.deepEqual(await azdo.children("302", ctx), []);
  assert.equal(deTipo(calls, "/workitemsbatch").length, 0);
});

test("children parte el batch en trozos de 200: es el maximo que declara el endpoint", async () => {
  const { ctx, calls } = hacerCtx();
  const hijos = await azdo.children("400", ctx);
  const lotes = deTipo(calls, "/workitemsbatch");
  assert.deepEqual(lotes.map((l) => l.body.ids.length), [200, 50]);
  assert.equal(hijos.length, 250);
});

test("un hijo borrado entre la lectura y la hidratacion se omite y no voltea el recorrido", async () => {
  const { ctx } = hacerCtx();
  const hijos = await azdo.children("296", ctx);
  assert.deepEqual(hijos.map((h) => h.id), ["297"]);
});

// ------------------------------------------------------ 6. dependencies
test("dependencies no invierte el par: Forward es Successor y Reverse es Predecessor", async () => {
  const { ctx, calls } = hacerCtx();
  const dep = await azdo.dependencies("297", ctx);
  assert.deepEqual(dep.predecessors, ["295"], "Dependency-Reverse es Predecessor");
  assert.deepEqual(dep.successors, ["301"], "Dependency-Forward es Successor; al reves el motor serializa el DAG invertido y nada falla");
  assert.equal(deTipo(calls, "/wiql").length, 0, "sale del array relations, no de una consulta de enlaces cuyo nombre la doc escribe de dos maneras");
});

test("el rel se compara en minusculas: la doc escribe Dependency-forward y Dependency-Forward", async () => {
  const { ctx } = hacerCtx();
  // El sucesor 301 esta grabado con la `f` minuscula, como en el ejemplo
  // oficial de la pagina Update.
  const dep = await azdo.dependencies("297", ctx);
  assert.deepEqual(dep.successors, ["301"]);
});

test("dependencies de un item sin enlaces devuelve las dos listas vacias", async () => {
  const { ctx } = hacerCtx();
  assert.deepEqual(await azdo.dependencies("299", ctx), { predecessors: [], successors: [] });
});

// --------------------------------------------------------- 7. setState
test("setState escribe el nombre nativo del mapa, con el test sobre /rev", async () => {
  const { ctx, calls } = hacerCtx();
  const r = await azdo.setState("297", "in_progress", ctx);
  assert.deepEqual(r.written, "Active");

  const patch = calls.find((c) => c.method === "PATCH");
  assert.equal(patch.headers["Content-Type"], "application/json-patch+json");
  assert.deepEqual(patch.body, [
    { op: "test", path: "/rev", value: 4 },
    { op: "add", path: "/fields/System.State", value: "Active" },
  ]);
});

test("un estado canonico que el proyecto no tiene no se escribe ni se inventa", async () => {
  const { ctx, calls } = hacerCtx();
  const r = await azdo.setState("297", "blocked", ctx);
  assert.equal(r.written, null);
  assert.equal(r.skipped, "blocked");
  assert.equal(calls.filter((c) => c.method === "PATCH").length, 0, "ni un viaje: el gestor no tiene ese estado");
});

test("setState de un item inexistente lanza: no existe no es un estado escribible", async () => {
  const { ctx } = hacerCtx();
  await assert.rejects(() => azdo.setState("999999", "in_progress", ctx), /999999/);
});

// --------------------------------------------------------- 8. comment
test("comment usa la unica api-version documentada y exige el proyecto en la ruta", async () => {
  const { ctx, calls } = hacerCtx();
  const r = await azdo.comment("297", "noxloop arranco", ctx);
  assert.equal(r.id, "50");
  const c = calls.at(-1);
  assert.ok(c.url.includes(`/${PROY}/_apis/wit/workItems/297/comments`));
  assert.ok(c.url.includes("api-version=7.0-preview.3"), "7.1 no tiene pagina para esta operacion");
  assert.deepEqual(c.body, { text: "noxloop arranco" });
});

test("la api-version del comentario es configuracion: se mueve sin tocar codigo", async () => {
  const { ctx, calls } = hacerCtx({ options: { commentApiVersion: "7.1-preview.4" } });
  await assert.rejects(() => azdo.comment("297", "x", ctx)); // no hay fixture grabado para esa version
  assert.ok(calls.at(-1).url.includes("api-version=7.1-preview.4"));
});

// --------------------------------------------------------- 9. linkUrl
test("linkUrl adjunta el PR como relacion Hyperlink, la unica que acepta una URL de GitHub", async () => {
  const { ctx, calls } = hacerCtx();
  const r = await azdo.linkUrl("297", "https://github.com/org/repo/pull/123", "Pull request", ctx);
  assert.equal(r.ok, true);

  const patch = calls.find((c) => c.method === "PATCH");
  assert.deepEqual(patch.body, [
    { op: "test", path: "/rev", value: 4 },
    {
      op: "add",
      path: "/relations/-",
      value: {
        rel: "Hyperlink",
        url: "https://github.com/org/repo/pull/123",
        attributes: { comment: "Pull request" },
      },
    },
  ]);
});

test("un hipervinculo que ya esta no se vuelve a escribir: el gestor rechaza la relacion duplicada", async () => {
  const { ctx, calls } = hacerCtx();
  const r = await azdo.linkUrl("297", "https://github.com/org/repo/pull/7", "PR anterior", ctx);
  assert.equal(r.ok, true);
  assert.equal(r.alreadyExisted, true);
  assert.equal(calls.filter((c) => c.method === "PATCH").length, 0, "un relanzamiento del recorrido moriria en un 400 por relacion repetida");
});

// -------------------------------------------------------- 10. addLabel
test("addLabel es leer-modificar-escribir: System.Tags es un solo campo String", async () => {
  const { ctx, calls } = hacerCtx();
  const r = await azdo.addLabel("297", "en-curso", ctx);
  assert.equal(r.ok, true);
  const patch = calls.find((c) => c.method === "PATCH");
  assert.deepEqual(patch.body, [
    { op: "test", path: "/rev", value: 4 },
    { op: "add", path: "/fields/System.Tags", value: "noxloop; pagos; en-curso" },
  ]);
});

test("una etiqueta que ya esta no se reescribe, y la comparacion ignora mayusculas", async () => {
  const { ctx, calls } = hacerCtx();
  const r = await azdo.addLabel("297", "NOXLOOP", ctx);
  assert.equal(r.alreadyExisted, true);
  assert.equal(calls.filter((c) => c.method === "PATCH").length, 0);
});

// ------------------------------------------------------ 11. createChild
test("createChild cuelga el hijo del padre en el MISMO POST", async () => {
  const { ctx, calls } = hacerCtx();
  const hijo = await azdo.createChild("297", {
    id: "T1",
    title: "Escribir el test de conciliacion",
    acceptance: "dado un pago, cuando se concilia, entonces queda registrado",
    repo: "app",
    boardFields: { iterationPath: `${PROY}\\Sprint 12`, areaPath: `${PROY}\\Pagos`, assignedTo: IDENTIDAD.uniqueName },
  }, ctx);

  assert.ok(validateItem(hijo).ok, validateItem(hijo).problems.join("; "));
  assert.equal(hijo.id, "310");
  assert.equal(hijo.level, "task");

  const post = calls.at(-1);
  assert.ok(post.url.includes("/_apis/wit/workitems/$Task?"), "el `$` antes del tipo es literal y el tipo sale del levelMap");
  assert.equal(post.headers["Content-Type"], "application/json-patch+json");
  const rel = post.body.find((o) => o.path === "/relations/-");
  assert.deepEqual(rel.value.rel, "System.LinkTypes.Hierarchy-Reverse", "Hierarchy-Reverse es Parent: un item tiene un solo padre");
  assert.equal(rel.value.url, `${API}/297`);
  const campos = Object.fromEntries(post.body.filter((o) => String(o.path).startsWith("/fields/")).map((o) => [o.path, o.value]));
  assert.equal(campos["/fields/System.Title"], "Escribir el test de conciliacion");
  assert.ok(campos["/fields/Microsoft.VSTS.Common.AcceptanceCriteria"].includes("conciliada") === false);
  assert.ok(campos["/fields/Microsoft.VSTS.Common.AcceptanceCriteria"].includes("queda registrado"));
  assert.equal(campos["/fields/System.IterationPath"], `${PROY}\\Sprint 12`, "una hija sin iteracion no aparece en ningun taskboard");
  assert.equal(campos["/fields/System.AreaPath"], `${PROY}\\Pagos`);
  assert.equal(campos["/fields/System.AssignedTo"], IDENTIDAD.uniqueName);
});

test("el tipo del hijo se puede forzar, y va URL-encoded", async () => {
  const { ctx, calls } = hacerCtx();
  const hijo = await azdo.createChild("297", { title: "Una historia hija", type: "User Story" }, ctx);
  assert.equal(hijo.level, "story");
  assert.ok(calls.at(-1).url.includes("/workitems/$User%20Story?"));
});

test("createChild sin un tipo de nivel task en el mapa lo dice en vez de adivinar 'Task'", async () => {
  const ctx = soloOpciones({ levelMap: { Epic: "epic", Issue: "story", default: "story" } });
  await assert.rejects(() => azdo.createChild("297", { title: "x" }, ctx), /task/);
});

// ----------------------------------------------------- 12. searchInbox
test("searchInbox consulta asignados y menciones y los hidrata en un batch", async () => {
  const { ctx, calls } = hacerCtx();
  const inbox = await azdo.searchInbox(ctx);

  assert.deepEqual(inbox.assigned.map((i) => i.id), ["297"]);
  assert.deepEqual(inbox.mentioned.map((i) => i.id), ["300"]);
  for (const i of [...inbox.assigned, ...inbox.mentioned]) assert.ok(validateItem(i).ok);

  const wiqls = deTipo(calls, "/wiql");
  assert.equal(wiqls.length, 2);
  assert.ok(wiqls.some((w) => w.body.query.includes("@Me")));
  assert.ok(wiqls.some((w) => w.body.query.includes("@RecentMentions")));
  assert.ok(wiqls.every((w) => w.body.query.includes("@project")), "el nombre del proyecto es configuracion, no una constante en la consulta");
  assert.equal(deTipo(calls, "/workitemsbatch").length, 1, "WIQL solo devuelve ids: se hidrata la union de las dos consultas de una vez");
});

test("las consultas WIQL se pueden reemplazar por configuracion", async () => {
  const { ctx, calls } = hacerCtx({
    options: { wiql: { assigned: "SELECT [System.Id] FROM WorkItems WHERE [System.Id] = 297", mentioned: null } },
  });
  const inbox = await azdo.searchInbox(ctx);
  assert.deepEqual(inbox.assigned.map((i) => i.id), ["297"]);
  assert.deepEqual(inbox.mentioned, [], "una consulta en null apaga ese disparo sin apagar el otro");
  assert.equal(deTipo(calls, "/wiql").length, 1);
});

// ------------------------------------- 13. el mapa contra el gestor vivo
test("verifyLevelMap delata un levelMap que no es el de este proyecto", async () => {
  const { ctx } = hacerCtx(); // mapa Agile contra un proyecto Scrum
  const r = await azdo.verifyLevelMap(ctx);
  assert.equal(r.ok, false);
  const texto = r.problems.join(" | ");
  assert.ok(texto.includes("Product Backlog Item"), texto);
  assert.equal(r.bugsBehavior, "asRequirements", "es la respuesta del proyecto a si un Bug es story o task");
  assert.deepEqual(r.hiddenLevels, ["epic"], "este proyecto apago el nivel epic");
  assert.deepEqual(r.expected["Task"], "task");
  assert.deepEqual(r.expected["Feature"], "feature");
});

test("verifyLevelMap acepta el mapa correcto y mapea por categoria, no por rank", async () => {
  const ctx = soloOpciones({ levelMap: { ...MAPA_SCRUM, "My level": "epic" } });
  const r = await azdo.verifyLevelMap(ctx);
  assert.equal(r.ok, true, r.problems.join(" | "));
  assert.deepEqual(r.customPortfolio, ["MiOrg.MiNivelCategory"], "un nivel de portafolio custom se reporta, no se adivina");
});

// --------------------- 14. lo que pasa cuando el gestor no contesta un ticket
//
// Ninguno de estos casos es hipotetico: son las cuatro formas en que una
// respuesta con status 200 puede no ser un work item. El chequeo 4 de la suite
// NO los cubre —solo ejercita el 404—, asi que el comentario del proveedor que
// decia "si algun dia responde 200 con cuerpo vacio, el chequeo 4 lo delata"
// era falso y estos tests son los que lo delatan.

test("un 200 con el cuerpo vacio es 'no existe' y no un error de parseo de JSON", async () => {
  const { ctx } = hacerCtx();
  assert.equal(await azdo.getItem("100", ctx), null, "`res.json()` sobre un cuerpo vacio tira SyntaxError, que no es una respuesta ni una causa");
});

test("un 200 con la pagina de login en HTML lanza nombrando status y URL, no 'Unexpected token <'", async () => {
  const { ctx } = hacerCtx();
  await assert.rejects(() => azdo.getItem("101", ctx), (e) => {
    assert.ok(!/Unexpected token/.test(e.message), `el error de parseo se filtro al motor: ${e.message}`);
    assert.match(e.message, /200/, "el status tiene que estar en el mensaje");
    assert.match(e.message, /_apis\/wit\/workitems\/101/, "y la URL que se pidio");
    assert.match(e.message, /Sign In/, "y un pedazo del cuerpo, que es lo que dice que era un login");
    return true;
  });
});

test("un 200 sin `id` no se convierte en el ticket 'undefined'", async () => {
  const { ctx } = hacerCtx();
  await assert.rejects(() => azdo.getItem("102", ctx), (e) => {
    assert.match(e.message, /id/, e.message);
    assert.ok(!/^Cannot/.test(e.message));
    return true;
  });
  // El fallo que evita: `String(undefined)` es el string no vacio "undefined",
  // pasa `validateItem` y se persiste en el estado del recorrido como un id.
});

test("sin `rev` no se escribe: el `test /rev` sin valor apaga el control de concurrencia en silencio", async () => {
  const { ctx, calls } = hacerCtx();
  await assert.rejects(() => azdo.setState("103", "in_progress", ctx), /rev/);
  assert.equal(
    calls.filter((c) => c.method === "PATCH").length,
    0,
    "sin rev la escritura pisa el cambio ajeno sin que el gestor pueda contestar 409",
  );
});

test("un `relations` que no es una lista no sale como TypeError", async () => {
  const { ctx } = hacerCtx();
  assert.deepEqual(await azdo.children("104", ctx), []);
  assert.deepEqual(await azdo.dependencies("104", ctx), { predecessors: [], successors: [] });
  assert.ok(await azdo.getItem("104", ctx));
});

test("un id de relacion que no es entero se nombra, en vez de mandar null al lote", async () => {
  const { ctx, calls } = hacerCtx();
  await assert.rejects(() => azdo.children("105", ctx), (e) => {
    assert.match(e.message, /no-es-un-entero/, `el id culpable no aparece en el mensaje: ${e.message}`);
    return true;
  });
  const lote = calls.find((c) => c.url.includes("/workitemsbatch"));
  assert.ok(!lote || !lote.body.ids.includes(null), "`Number('abc')` es NaN y JSON.stringify lo manda como null: el 400 del gestor no nombra el id");
});

test("dependencies no cuenta dos veces el mismo arco", async () => {
  const { ctx } = hacerCtx();
  const dep = await azdo.dependencies("106", ctx);
  assert.deepEqual(dep.successors, ["301"], "el rel viene escrito de las dos formas que usa la doc: es UN arco");
  assert.deepEqual(dep.predecessors, ["295"], "un arco contado dos veces le hace serializar al motor una espera que no existe");
});

test("createChild con los criterios en array no los colapsa en una linea con comas", async () => {
  const { ctx, calls } = hacerCtx();
  // `Item.acceptance` es un array en el modelo canonico —asi lo devuelve
  // getItem—, y la escritura hacia `String(["a","b"])`: "a,b". El ida y vuelta
  // perdia la separacion de criterios, que es lo unico que el planificador
  // puede convertir en un test.
  const hijo = await azdo.createChild("297", {
    title: "Una tarea",
    acceptance: ["primer criterio", "segundo criterio"],
  }, ctx);
  assert.deepEqual(hijo.acceptance, ["primer criterio", "segundo criterio"]);
  const escrito = calls.at(-1).body.find((o) => String(o.path).includes("AcceptanceCriteria")).value;
  assert.ok(!escrito.includes("criterio,segundo"), `se escribio con coma: ${escrito}`);
});

test("los criterios se escriben escapados: el campo es HTML y el ida y vuelta tiene que ser exacto", async () => {
  const { ctx } = hacerCtx();
  // Sin escapar, un criterio con `<` se lo come `textoDeHtml` al leerlo de
  // vuelta, y un `<b>` ajeno termina interpretado en el tablero.
  const hijo = await azdo.createChild("297", { title: "t", acceptance: ["a < b && c > d"] }, ctx);
  assert.deepEqual(hijo.acceptance, ["a < b && c > d"]);
});

// ------------------------------------------------ listItems (spec 003 §1)

test("listItems: los estados cerrados de la WIQL salen del gestor, no de memoria", async () => {
  const { ctx, calls } = hacerCtx();
  await azdo.listItems({}, ctx);
  assert.equal(calls[0].url, URL_TIPOS.slice(4), "primero lee los tipos y sus categorias de estado");
  const wiql = deTipo(calls, "/_apis/wit/wiql")[0].body.query;
  assert.match(wiql, /\[System\.TeamProject\] = @project/);
  assert.match(wiql, /\[System\.State\] NOT IN \('Closed', 'Removed'\)/, "Completed y Removed, por categoria");
  assert.ok(!/'Resolved'/.test(wiql), "Resolved es revision, no cerrado: sigue en el board");
  assert.match(wiql, /ORDER BY \[System\.ChangedDate\] DESC$/);
});

test("listItems traduce la tarjeta: backlog, prioridad, area como equipo, asignado con avatar", async () => {
  const { ctx } = hacerCtx();
  const r = await azdo.listItems({}, ctx);
  assert.deepEqual(r.items.map((i) => i.id), ["501", "502", "503", "504", "505"], "el orden de la WIQL se respeta");
  assert.equal(r.total, 5, "WIQL devuelve todos los ids: aca el total si se sabe");
  assert.equal(r.nextCursor, null);
  const e = Object.fromEntries(r.items.map((i) => [i.id, i]));
  assert.equal(e["501"].canonicalState, "backlog", "propuesto y sin iteracion");
  assert.equal(e["502"].canonicalState, "todo", "propuesto pero en un sprint");
  assert.equal(e["503"].canonicalState, "in_progress");
  assert.equal(e["504"].canonicalState, "in_review");
  assert.equal(e["505"].canonicalState, "in_progress", "'En espera' no esta en el stateMap: sale de su categoria InProgress");

  assert.equal(e["501"].priority, 0, "1 (la mas alta de ADO) -> 0");
  assert.equal(e["502"].priority, 1);
  assert.equal(e["503"].priority, 3, "4 (la mas baja de ADO) -> 3");
  assert.equal(e["504"].priority, null, "sin campo de prioridad: null, no un default");

  assert.equal(e["501"].team, "Pagos");
  assert.equal(e["504"].team, "Recibos", "el ultimo tramo del area");
  assert.deepEqual(e["501"].assignee, { id: "ana@contoso.test", name: "Ana Pérez", avatarUrl: ANA._links.avatar.href });
  assert.equal(e["502"].assignee, null);
  assert.equal(e["501"].updatedAt, "2026-09-21T10:00:00.000Z");
  assert.equal(e["501"].key, "#501");
});

test("listItems: un stateMap.backlog explicito manda sobre la iteracion", async () => {
  const { ctx } = hacerCtx({ options: { stateMap: { ...ESTADOS, backlog: "Active" } } });
  const { items } = await azdo.listItems({}, ctx);
  assert.equal(items.find((i) => i.id === "503").canonicalState, "backlog");
});

test("listItems pagina por posicion en la WIQL, sin repetir ni perder", async () => {
  const { ctx, calls } = hacerCtx();
  const p1 = await azdo.listItems({ limit: 2 }, ctx);
  assert.deepEqual(p1.items.map((i) => i.id), ["501", "502"]);
  assert.equal(p1.nextCursor, "2");
  assert.equal(p1.total, 5);
  const lote = deTipo(calls, "workitemsbatch")[0].body;
  assert.deepEqual(lote.ids, [501, 502], "solo se hidrata la pagina, no los cinco");
  const p2 = await azdo.listItems({ limit: 2, cursor: p1.nextCursor }, ctx);
  assert.deepEqual(p2.items.map((i) => i.id), ["503", "504"]);
  const p3 = await azdo.listItems({ limit: 2, cursor: p2.nextCursor }, ctx);
  assert.deepEqual(p3.items.map((i) => i.id), ["505"]);
  assert.equal(p3.nextCursor, null);
});

test("listItems: un cursor que no es una posicion se rechaza con su valor", async () => {
  const { ctx } = hacerCtx();
  await assert.rejects(() => azdo.listItems({ cursor: "abc" }, ctx), /cursor/);
});

test("listItems con includeDone: solo Removed queda fuera, y lo cerrado sale en done", async () => {
  const { ctx, calls } = hacerCtx();
  const { items } = await azdo.listItems({ includeDone: true }, ctx);
  const wiql = deTipo(calls, "/_apis/wit/wiql")[0].body.query;
  assert.match(wiql, /\[System\.State\] NOT IN \('Removed'\)/);
  assert.equal(items.find((i) => i.id === "507").canonicalState, "done");
});

test("listItems acota por areaPath si se declara", async () => {
  const { ctx, calls } = hacerCtx({ options: { areaPath: "Fabrikam\\Pagos" } });
  await azdo.listItems({}, ctx);
  const wiql = deTipo(calls, "/_apis/wit/wiql")[0].body.query;
  assert.match(wiql, /\[System\.AreaPath\] UNDER 'Fabrikam\\Pagos'/);
});

test("listItems: una WIQL propia gana, y lo retirado o cerrado que traiga igual queda fuera", async () => {
  const propia = "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project ORDER BY [System.ChangedDate] DESC";
  const { ctx, calls } = hacerCtx({ options: { wiql: { list: propia } } });
  // La WIQL propia no excluye nada: el grabado devuelve tambien 507 (cerrado) y
  // 508 (retirado), y el proveedor tiene que filtrarlos por categoria.
  const r = await azdo.listItems({}, ctx);
  assert.equal(deTipo(calls, "/_apis/wit/wiql")[0].body.query, propia);
  assert.ok(!r.items.some((i) => i.id === "507"), "un cerrado no se lista sin includeDone, venga de donde venga");
  assert.ok(!r.items.some((i) => i.id === "508"), "un retirado no se lista nunca");
  const conHechos = await azdo.listItems({ includeDone: true }, ctx);
  assert.ok(conHechos.items.some((i) => i.id === "507"));
  assert.ok(!conHechos.items.some((i) => i.id === "508"), "ni siquiera con includeDone: retirado no es hecho");
});

test("listItems exige organizacion y proyecto antes de gastar un viaje", async () => {
  const { ctx, calls } = hacerCtx({ options: { project: undefined } });
  await assert.rejects(() => azdo.listItems({}, ctx), /project/);
  assert.equal(calls.length, 0);
});

test("areaPath y wiql.list estan descritas en el esquema de opciones", () => {
  assert.ok(azdo.optionsSchema.properties.areaPath);
  assert.ok(azdo.optionsSchema.properties.wiql.properties.list);
});
