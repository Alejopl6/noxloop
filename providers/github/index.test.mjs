// El test del proveedor de GitHub Issues. Corre la suite de contrato entera y
// despues los casos propios de este gestor.
//
// POR QUE LAS RESPUESTAS SON GRABADAS Y NO RED. Un test que necesita una cuenta
// no lo puede correr quien adopte el proyecto: queda "verde en la maquina del
// autor" y rojo en todas las demas. Aca cada respuesta es la que la API vigente
// devolvio, recortada a los campos que el proveedor lee, servida por un
// `ctx.fetch` falso que ademas GRABA cada pedido. Eso permite afirmar cosas que
// la respuesta no muestra: que el label va por POST y no por PUT, que el
// `sub_issue_id` es el id global y no el numero, y que el header de version de
// la API viaja pinneado.

import { test } from "node:test";
import assert from "node:assert/strict";
import { contractChecks, NotSupportedError } from "../contract.mjs";
import * as github from "./index.mjs";

// --------------------------------------------------------------------------
// Respuestas grabadas
// --------------------------------------------------------------------------
// Los dos identificadores de un issue de GitHub estan a proposito separados y
// distintos en cada fixture: `number` es el que va en la ruta, `id` es el
// entero global que piden los cuerpos de sub_issues y de dependencies. Si
// fueran iguales, un proveedor que confunda uno con otro pasaria el test.

const ISSUE_42 = {
  id: 1001,
  node_id: "I_kwDOABCD42",
  number: 42,
  title: "El carrito pierde los items al cambiar de moneda",
  body: [
    "Cuando el usuario cambia la moneda, el carrito queda vacio.",
    "",
    "### Criterios de aceptacion",
    "- [ ] dado un carrito con items, cuando se cambia la moneda, entonces los items siguen",
    "- [x] dado un carrito vacio, cuando se cambia la moneda, entonces no hay error",
  ].join("\n"),
  state: "open",
  state_reason: null,
  html_url: "https://github.com/acme/tienda/issues/42",
  labels: [
    { id: 5001, name: "bug", color: "d73a4a" },
    { id: 5002, name: "carrito", color: "0e8a16" },
  ],
  assignee: { login: "noxloop", id: 77 },
  assignees: [{ login: "noxloop", id: 77 }],
  milestone: { number: 3, title: "Sprint 12" },
  type: { id: 301, node_id: "IT_1", name: "User Story", description: "", color: "BLUE" },
  parent_issue_url: "https://api.github.com/repos/acme/tienda/issues/7",
  sub_issues_summary: { total: 0, completed: 0, percent_completed: 0 },
};

const ISSUE_43 = {
  id: 1002,
  node_id: "I_kwDOABCD43",
  number: 43,
  title: "Mostrar el total convertido",
  body: "",
  state: "open",
  state_reason: null,
  html_url: "https://github.com/acme/tienda/issues/43",
  labels: [],
  assignee: null,
  assignees: [],
  milestone: null,
  type: { id: 302, node_id: "IT_2", name: "Task", description: "", color: "GRAY" },
  parent_issue_url: "https://api.github.com/repos/acme/tienda/issues/7",
  sub_issues_summary: { total: 0, completed: 0, percent_completed: 0 },
};

const ISSUE_44 = {
  id: 1003,
  node_id: "I_kwDOABCD44",
  number: 44,
  title: "Publicar el changelog de la conversion",
  body: "",
  state: "open",
  state_reason: null,
  html_url: "https://github.com/acme/tienda/issues/44",
  labels: [],
  assignee: null,
  assignees: [],
  milestone: null,
  type: null,
  parent_issue_url: "https://api.github.com/repos/acme/tienda/issues/7",
  sub_issues_summary: { total: 0, completed: 0, percent_completed: 0 },
};

const ISSUE_7 = {
  id: 900,
  node_id: "I_kwDOABCD7",
  number: 7,
  title: "Multi-moneda",
  body: "El hito entero.",
  state: "open",
  state_reason: null,
  html_url: "https://github.com/acme/tienda/issues/7",
  labels: [],
  assignee: null,
  assignees: [],
  milestone: { number: 3, title: "Sprint 12" },
  type: { id: 300, node_id: "IT_0", name: "Epic", description: "", color: "PURPLE" },
  parent_issue_url: null,
  sub_issues_summary: { total: 3, completed: 0, percent_completed: 0 },
};

// El caso comun, no el raro: un repo de cuenta personal no tiene issue types,
// asi que `type` llega en null. Tiene que caer en el default del mapa.
const ISSUE_55 = {
  id: 1055,
  node_id: "I_kwDOABCD55",
  number: 55,
  title: "Sin issue type porque el repo es de una cuenta personal",
  body: "",
  state: "open",
  state_reason: null,
  html_url: "https://github.com/acme/tienda/issues/55",
  labels: [],
  assignee: null,
  assignees: [],
  milestone: null,
  type: null,
  parent_issue_url: null,
  sub_issues_summary: { total: 0, completed: 0, percent_completed: 0 },
};

// El tipo que la organizacion invento y el mapa no conoce.
const ISSUE_56 = {
  id: 1056,
  node_id: "I_kwDOABCD56",
  number: 56,
  title: "Tipo inventado por la organizacion",
  body: "",
  state: "open",
  state_reason: null,
  html_url: "https://github.com/acme/tienda/issues/56",
  labels: [],
  assignee: null,
  assignees: [],
  milestone: null,
  type: { id: 399, node_id: "IT_9", name: "EstoNoExisteEnNingunGestor", description: "", color: "PINK" },
  parent_issue_url: null,
  sub_issues_summary: { total: 0, completed: 0, percent_completed: 0 },
};

// Un issue cerrado y descartado: reabrirlo exige state_reason "reopened", y si
// el proveedor no lo manda el tablero queda mostrando un issue abierto que
// sigue marcado como "no planificado".
const ISSUE_45 = {
  id: 1045,
  node_id: "I_kwDOABCD45",
  number: 45,
  title: "Se cerro por error",
  body: "",
  state: "closed",
  state_reason: "not_planned",
  html_url: "https://github.com/acme/tienda/issues/45",
  labels: [],
  assignee: null,
  assignees: [],
  milestone: null,
  type: { id: 302, node_id: "IT_2", name: "Task", description: "", color: "GRAY" },
  parent_issue_url: null,
  sub_issues_summary: { total: 0, completed: 0, percent_completed: 0 },
};

// Un issue de OTRO repositorio, como solo puede llegar por la bandeja: GET
// /issues barre todos los repositorios visibles.
const ISSUE_OTRO_REPO = {
  id: 2001,
  node_id: "I_kwDOZZZZ12",
  number: 12,
  title: "Issue de otro repositorio",
  body: "",
  state: "open",
  state_reason: null,
  html_url: "https://github.com/otra-org/otro/issues/12",
  repository_url: "https://api.github.com/repos/otra-org/otro",
  labels: [],
  assignee: null,
  assignees: [],
  milestone: null,
  type: null,
  parent_issue_url: null,
  sub_issues_summary: { total: 0, completed: 0, percent_completed: 0 },
};

// La REST API de GitHub considera issue a todo pull request. Este es el que hay
// que descartar de la bandeja: si no se filtra, el daemon dispara un recorrido
// sobre un PR y el motor busca criterios de aceptacion en una revision.
const PR_88 = {
  id: 3001,
  node_id: "PR_kwDO88",
  number: 88,
  title: "fix: el carrito",
  body: "",
  state: "open",
  state_reason: null,
  html_url: "https://github.com/acme/tienda/pull/88",
  repository_url: "https://api.github.com/repos/acme/tienda",
  labels: [],
  assignee: { login: "noxloop", id: 77 },
  assignees: [{ login: "noxloop", id: 77 }],
  milestone: null,
  type: null,
  parent_issue_url: null,
  pull_request: { url: "https://api.github.com/repos/acme/tienda/pulls/88", html_url: "https://github.com/acme/tienda/pull/88" },
};

const NO_ENCONTRADO = {
  message: "Not Found",
  documentation_url: "https://docs.github.com/rest/issues/issues#get-an-issue",
  status: "404",
};

const ISSUE_77_CREADO = {
  id: 1077,
  node_id: "I_kwDOABCD77",
  number: 77,
  title: "Convertir el total en el carrito",
  body: "### Criterios de aceptacion\n- [ ] dado un carrito, cuando cambia la moneda, entonces el total se convierte",
  state: "open",
  state_reason: null,
  html_url: "https://github.com/acme/tienda/issues/77",
  labels: [{ id: 5003, name: "noxloop", color: "ededed" }],
  assignee: null,
  assignees: [],
  milestone: { number: 3, title: "Sprint 12" },
  type: { id: 302, node_id: "IT_2", name: "Task", description: "", color: "GRAY" },
  parent_issue_url: "https://api.github.com/repos/acme/tienda/issues/7",
  sub_issues_summary: { total: 0, completed: 0, percent_completed: 0 },
};

// Los issues del listado del board. Traen `updated_at`, `assignee.avatar_url`
// y etiquetas de prioridad y de backlog, que son lo que la tarjeta pinta.
const LISTA_60 = {
  id: 1060,
  node_id: "I_kwDOABCD60",
  number: 60,
  title: "El checkout no respeta el cupon",
  body: "- [ ] dado un cupon valido, cuando se paga, entonces se descuenta",
  state: "open",
  state_reason: null,
  html_url: "https://github.com/acme/tienda/issues/60",
  repository_url: "https://api.github.com/repos/acme/tienda",
  labels: [{ id: 6001, name: "P1", color: "b60205" }, { id: 6002, name: "checkout", color: "0e8a16" }],
  assignee: { login: "ana", id: 91, avatar_url: "https://avatars.githubusercontent.com/u/91?v=4" },
  assignees: [{ login: "ana", id: 91, avatar_url: "https://avatars.githubusercontent.com/u/91?v=4" }],
  milestone: null,
  type: { id: 301, node_id: "IT_1", name: "User Story", description: "", color: "BLUE" },
  parent_issue_url: null,
  created_at: "2026-09-01T12:00:00Z",
  updated_at: "2026-09-20T09:15:00Z",
};

const LISTA_61 = {
  id: 1061,
  node_id: "I_kwDOABCD61",
  number: 61,
  title: "Idea: pagar en cuotas",
  body: "",
  state: "open",
  state_reason: null,
  html_url: "https://github.com/acme/tienda/issues/61",
  repository_url: "https://api.github.com/repos/acme/tienda",
  // Dos etiquetas de prioridad a la vez: gana la mas urgente, y la etiqueta de
  // backlog se escribe con otra capitalizacion que la del mapa.
  labels: [{ id: 6003, name: "backlog", color: "cccccc" }, { id: 6004, name: "P3", color: "fbca04" }, { id: 6005, name: "p2", color: "d93f0b" }],
  assignee: null,
  assignees: [],
  milestone: null,
  type: null,
  parent_issue_url: null,
  created_at: "2026-09-02T12:00:00Z",
  updated_at: "2026-09-19T18:00:00Z",
};

const LISTA_62 = {
  id: 1062,
  node_id: "I_kwDOABCD62",
  number: 62,
  title: "Sin etiquetas: sin prioridad, y en todo",
  body: "",
  state: "open",
  state_reason: null,
  html_url: "https://github.com/acme/tienda/issues/62",
  repository_url: "https://api.github.com/repos/acme/tienda",
  labels: [],
  assignee: null,
  assignees: [],
  milestone: null,
  type: { id: 302, node_id: "IT_2", name: "Task", description: "", color: "GRAY" },
  parent_issue_url: null,
  created_at: "2026-09-03T12:00:00Z",
  updated_at: "2026-09-18T08:00:00Z",
};

const LISTA_63 = {
  id: 1063,
  node_id: "I_kwDOABCD63",
  number: 63,
  title: "El de la segunda pagina",
  body: "",
  state: "open",
  state_reason: null,
  html_url: "https://github.com/acme/tienda/issues/63",
  repository_url: "https://api.github.com/repos/acme/tienda",
  labels: [{ id: 6006, name: "prioridad: urgente", color: "b60205" }],
  assignee: null,
  assignees: [],
  milestone: null,
  type: null,
  parent_issue_url: null,
  created_at: "2026-08-01T12:00:00Z",
  updated_at: "2026-09-10T08:00:00Z",
};

const LISTA_64_CERRADO = {
  ...LISTA_62,
  id: 1064,
  node_id: "I_kwDOABCD64",
  number: 64,
  title: "Cerrado y completado",
  state: "closed",
  state_reason: "completed",
  html_url: "https://github.com/acme/tienda/issues/64",
  updated_at: "2026-09-17T08:00:00Z",
};

const LISTA_65_DESCARTADO = {
  ...LISTA_62,
  id: 1065,
  node_id: "I_kwDOABCD65",
  number: 65,
  title: "Cerrado como no planificado",
  state: "closed",
  state_reason: "not_planned",
  html_url: "https://github.com/acme/tienda/issues/65",
  updated_at: "2026-09-16T08:00:00Z",
};

/** `METODO ruta` -> respuesta grabada. La ruta incluye la query, tal cual sale. */
const GRABADAS = {
  "GET /repos/acme/tienda/issues/42": [200, ISSUE_42],
  "GET /repos/acme/tienda/issues/43": [200, ISSUE_43],
  "GET /repos/acme/tienda/issues/44": [200, ISSUE_44],
  "GET /repos/acme/tienda/issues/45": [200, ISSUE_45],
  "GET /repos/acme/tienda/issues/7": [200, ISSUE_7],
  "GET /repos/acme/tienda/issues/55": [200, ISSUE_55],
  "GET /repos/acme/tienda/issues/56": [200, ISSUE_56],
  "GET /repos/acme/tienda/issues/9999": [404, NO_ENCONTRADO],
  "GET /repos/otra-org/otro/issues/12": [200, ISSUE_OTRO_REPO],

  "GET /repos/acme/tienda/issues/7/sub_issues?per_page=100&page=1": [200, [ISSUE_42, ISSUE_43, ISSUE_44]],
  "GET /repos/acme/tienda/issues/42/sub_issues?per_page=100&page=1": [200, []],
  // Dos paginas llenas seguidas de una corta: el proveedor tiene que pedir la
  // siguiente mientras la pagina venga completa, y parar cuando no.
  "GET /repos/acme/tienda/issues/7/sub_issues?per_page=2&page=1": [200, [ISSUE_42, ISSUE_43]],
  "GET /repos/acme/tienda/issues/7/sub_issues?per_page=2&page=2": [200, [ISSUE_44]],

  "GET /repos/acme/tienda/issues/43/dependencies/blocked_by?per_page=100&page=1": [200, [ISSUE_42]],
  "GET /repos/acme/tienda/issues/43/dependencies/blocking?per_page=100&page=1": [200, [ISSUE_44]],
  "GET /repos/acme/tienda/issues/42/dependencies/blocked_by?per_page=100&page=1": [200, []],
  "GET /repos/acme/tienda/issues/42/dependencies/blocking?per_page=100&page=1": [200, [ISSUE_43]],

  "PATCH /repos/acme/tienda/issues/42": [200, { ...ISSUE_42, state: "closed", state_reason: "completed" }],
  "PATCH /repos/acme/tienda/issues/45": [200, { ...ISSUE_45, state: "open", state_reason: "reopened" }],

  "POST /repos/acme/tienda/issues/42/comments": [201, {
    id: 4001,
    node_id: "IC_kwDO4001",
    html_url: "https://github.com/acme/tienda/issues/42#issuecomment-4001",
    body: "Pull request abierto por noxloop",
  }],

  "POST /repos/acme/tienda/issues/42/labels": [200, [
    { id: 5001, name: "bug", color: "d73a4a" },
    { id: 5002, name: "carrito", color: "0e8a16" },
    { id: 5003, name: "noxloop", color: "ededed" },
  ]],

  "POST /repos/acme/tienda/issues": [201, ISSUE_77_CREADO],

  "GET /issues?filter=assigned&state=open&per_page=100&page=1": [200, [ISSUE_42, PR_88, ISSUE_OTRO_REPO]],
  "GET /issues?filter=mentioned&state=open&per_page=100&page=1": [200, [ISSUE_43]],

  // El listado del board. DOS paginas, unidas por el header Link como las
  // devuelve la API (la URL del `next` usa /repositories/{id}, no
  // /repos/{owner}/{repo}: por eso el proveedor lee solo el `page`). El PR 88
  // viene MEZCLADO en la primera, que es como lo devuelve este endpoint.
  "GET /repos/acme/tienda/issues?state=open&per_page=100&page=1": [200, [LISTA_60, PR_88, LISTA_61, LISTA_62], {
    Link:
      '<https://api.github.com/repositories/555001/issues?state=open&per_page=100&page=2>; rel="next", ' +
      '<https://api.github.com/repositories/555001/issues?state=open&per_page=100&page=2>; rel="last"',
  }],
  "GET /repos/acme/tienda/issues?state=open&per_page=100&page=2": [200, [LISTA_63], {
    Link:
      '<https://api.github.com/repositories/555001/issues?state=open&per_page=100&page=1>; rel="prev", ' +
      '<https://api.github.com/repositories/555001/issues?state=open&per_page=100&page=1>; rel="first"',
  }],
  // Con includeDone: `state=all`, y aparecen un cerrado completado y uno
  // descartado. Una sola pagina, sin Link.
  "GET /repos/acme/tienda/issues?state=all&per_page=100&page=1": [200, [LISTA_60, LISTA_64_CERRADO, LISTA_65_DESCARTADO]],
};

function respuesta(status, body, cabeceras = {}) {
  /** @type {Record<string, string>} */
  const minusculas = Object.fromEntries(Object.entries(cabeceras).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (/** @type {string} */ k) => minusculas[String(k).toLowerCase()] ?? null },
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

/**
 * El `ctx.fetch` falso. Sirve las respuestas grabadas y anota cada pedido.
 *
 * `extra` permite grabar una respuesta distinta para un caso puntual (un 403 de
 * permisos, por ejemplo) sin duplicar el mapa entero.
 */
function hacerCtx(opciones = {}, extra = {}) {
  const pedidos = [];
  const tabla = { ...GRABADAS, ...extra };
  const ctx = {
    options: {
      owner: "acme",
      repo: "tienda",
      stateMap: {
        todo: "open",
        // GitHub Issues no tiene estos tres, y el mapa lo dice en vez de
        // inventar un nombre nativo. El motor no mueve el ticket y la senal es
        // el comentario: es la fila de la tabla de degradacion, no una falla.
        in_progress: null,
        blocked: null,
        in_review: null,
        done: "closed",
      },
      typeMap: {
        Epic: "epic",
        Feature: "feature",
        Story: "story",
        "User Story": "story",
        Task: "task",
        Bug: "story",
        default: "story",
      },
      ...opciones,
    },
    env: { GITHUB_TOKEN: "ghp_falso_para_el_test" },
    log: { info() {}, warn() {}, error() {} },
    fetch: async (url, init = {}) => {
      const metodo = (init.method || "GET").toUpperCase();
      const ruta = String(url).replace("https://api.github.com", "");
      pedidos.push({ metodo, ruta, init, body: init.body ? JSON.parse(init.body) : null });
      const grabada = tabla[`${metodo} ${ruta}`];
      if (!grabada) {
        throw new Error(`no hay respuesta grabada para ${metodo} ${ruta}`);
      }
      return respuesta(grabada[0], grabada[1], grabada[2]);
    },
  };
  return { ctx, pedidos };
}

const fixturesDeTest = (opciones, extra) => {
  const { ctx, pedidos } = hacerCtx(opciones, extra);
  return { ...github.fixtures, ctx, pedidos };
};

// --------------------------------------------------------------------------
// La suite de contrato, completa
// --------------------------------------------------------------------------

test("pasa la suite de contrato entera", async (t) => {
  const fx = fixturesDeTest();
  for (const check of contractChecks(github, fx)) {
    await t.test(check.name, async () => {
      await check.run();
    });
  }
});

// --------------------------------------------------------------------------
// Forma del modulo
// --------------------------------------------------------------------------

test("declara las diez capacidades, con linkUrl y boardFields en false", () => {
  const caps = github.capabilities();
  // Explicita y en true: el listado del board sale de GET /repos/{o}/{r}/issues.
  assert.equal(caps.listItems, true);
  assert.equal(caps.children, true);
  assert.equal(caps.createChild, true);
  assert.equal(caps.comment, true);
  assert.equal(caps.labels, true);
  assert.equal(caps.searchAssigned, true);
  assert.equal(caps.searchMentioned, true);
  assert.equal(caps.setState, true);
  // Dependencias nativas desde el 2025-08-21: GET .../dependencies/blocked_by.
  assert.equal(caps.dependencies, true);
  // No existe endpoint de remote links en la API de Issues, y los issue fields
  // no tienen tipo URL: el PR va como texto en un comentario.
  assert.equal(caps.linkUrl, false);
  assert.equal(caps.boardFields, false);
});

test("requiredEnv pide un solo secreto, y es el nombre que inyecta GitHub Actions", () => {
  assert.deepEqual(github.requiredEnv, ["GITHUB_TOKEN"]);
});

test("owner, repo y los mapas viajan por options y no por entorno", async () => {
  const { ctx } = hacerCtx();
  // Si el proveedor leyera owner/repo del entorno, este ctx sin esas variables
  // no podria resolver la ruta.
  assert.equal(ctx.env.GITHUB_TOKEN, "ghp_falso_para_el_test");
  const item = await github.getItem("42", ctx);
  assert.ok(item);
  assert.equal(item.url, "https://github.com/acme/tienda/issues/42");
});

// --------------------------------------------------------------------------
// getItem
// --------------------------------------------------------------------------

test("getItem traduce un issue al modelo canonico", async () => {
  const { ctx } = hacerCtx();
  const item = await github.getItem("42", ctx);
  assert.ok(item);
  assert.equal(item.id, "42");
  assert.equal(typeof item.id, "string", "el id canonico es string, siempre");
  assert.equal(item.key, "acme/tienda#42");
  assert.equal(item.title, ISSUE_42.title);
  assert.equal(item.level, "story");
  assert.equal(item.state, "open");
  assert.equal(item.canonicalState, "todo");
  assert.equal(item.assignee, "noxloop");
  assert.equal(item.parentId, "7");
  assert.deepEqual(item.labels, ["bug", "carrito"]);
  assert.equal(item.url, "https://github.com/acme/tienda/issues/42");
  assert.equal(item.boardFields, null, "boardFields esta en false: no se promete medio tablero");
});

test("getItem expone el id global aparte del numero: no son intercambiables", async () => {
  const { ctx } = hacerCtx();
  const item = await github.getItem("42", ctx);
  assert.equal(item.id, "42", "el numero es el que va en la ruta");
  assert.equal(item.gid, 1001, "el entero global es el que piden los cuerpos de sub_issues y dependencies");
});

test("getItem saca los criterios de la lista de tareas del cuerpo", async () => {
  const { ctx } = hacerCtx();
  const item = await github.getItem("42", ctx);
  assert.deepEqual(item.acceptance, [
    "dado un carrito con items, cuando se cambia la moneda, entonces los items siguen",
    "dado un carrito vacio, cuando se cambia la moneda, entonces no hay error",
  ]);
});

test("getItem de un issue inexistente devuelve null y no lanza", async () => {
  const { ctx } = hacerCtx();
  assert.equal(await github.getItem("9999", ctx), null);
});

test("getItem de un id calificado owner/repo#numero va al repositorio que dice", async () => {
  const { ctx, pedidos } = hacerCtx();
  const item = await github.getItem("otra-org/otro#12", ctx);
  assert.ok(item);
  assert.equal(pedidos[0].ruta, "/repos/otra-org/otro/issues/12");
  assert.equal(item.id, "otra-org/otro#12", "el id sigue calificado: un numero pelado seria ambiguo entre repos");
});

test("un error que no es 404 lanza con el mensaje textual de GitHub", async () => {
  const { ctx } = hacerCtx({}, {
    "GET /repos/acme/tienda/issues/42": [403, {
      message: "Resource not accessible by personal access token",
      documentation_url: "https://docs.github.com/rest/issues/issues#get-an-issue",
    }],
  });
  await assert.rejects(
    () => github.getItem("42", ctx),
    (e) => {
      assert.match(e.message, /Resource not accessible by personal access token/);
      assert.match(e.message, /403/);
      return true;
    },
    "un permiso mal configurado no se resume a 'no se pudo': se cita al gestor",
  );
});

// --------------------------------------------------------------------------
// El nivel sale del mapa
// --------------------------------------------------------------------------

test("un issue sin issue type cae en el default del mapa", async () => {
  const { ctx } = hacerCtx();
  const item = await github.getItem("55", ctx);
  assert.equal(item.level, "story", "type: null es el caso comun en repos de cuenta personal");
});

test("un tipo que la organizacion invento cae en el default, sin lanzar", async () => {
  const { ctx } = hacerCtx();
  const item = await github.getItem("56", ctx);
  assert.equal(item.level, "story");
});

test("typeMapById gana sobre el nombre: sobrevive a un rename en la organizacion", async () => {
  // La organizacion renombro "User Story" a "Historia de usuario". El nombre ya
  // no esta en el mapa; el id del issue type no cambio.
  const { ctx } = hacerCtx({
    typeMap: { Task: "task", default: "task" },
    typeMapById: { 301: "story" },
  });
  const item = await github.getItem("42", ctx);
  assert.equal(item.level, "story");
});

test("el nivel no se deduce comparando el nombre del tipo", async () => {
  // Mismo issue, mapa distinto: si el nivel saliera de comparar contra
  // "User Story" en el codigo, este caso daria "story" igual.
  const { ctx } = hacerCtx({ typeMap: { "User Story": "feature", default: "task" } });
  const item = await github.getItem("42", ctx);
  assert.equal(item.level, "feature");
});

// --------------------------------------------------------------------------
// children
// --------------------------------------------------------------------------

test("children devuelve los sub-issues como items canonicos", async () => {
  const { ctx, pedidos } = hacerCtx();
  const hijos = await github.children("7", ctx);
  assert.deepEqual(hijos.map((h) => h.id), ["42", "43", "44"]);
  assert.deepEqual(hijos.map((h) => h.level), ["story", "task", "story"]);
  assert.equal(pedidos.length, 1, "los sub-issues vienen completos en la lista: no hay un GET por hijo");
});

test("children pagina mientras la pagina venga llena", async () => {
  const { ctx, pedidos } = hacerCtx({ perPage: 2 });
  const hijos = await github.children("7", ctx);
  assert.deepEqual(hijos.map((h) => h.id), ["42", "43", "44"]);
  assert.deepEqual(pedidos.map((p) => p.ruta), [
    "/repos/acme/tienda/issues/7/sub_issues?per_page=2&page=1",
    "/repos/acme/tienda/issues/7/sub_issues?per_page=2&page=2",
  ]);
});

test("children de un issue sin hijos devuelve un array vacio", async () => {
  const { ctx } = hacerCtx();
  assert.deepEqual(await github.children("42", ctx), []);
});

// --------------------------------------------------------------------------
// dependencies
// --------------------------------------------------------------------------

test("dependencies mapea blocked_by a predecesores y blocking a sucesores", async () => {
  const { ctx, pedidos } = hacerCtx();
  const deps = await github.dependencies("43", ctx);
  assert.deepEqual(deps.predecessors, ["42"], "blocked_by son los que tienen que terminar antes");
  assert.deepEqual(deps.successors, ["44"]);
  assert.deepEqual(pedidos.map((p) => p.ruta), [
    "/repos/acme/tienda/issues/43/dependencies/blocked_by?per_page=100&page=1",
    "/repos/acme/tienda/issues/43/dependencies/blocking?per_page=100&page=1",
  ]);
});

test("dependencies devuelve ids canonicos, no objetos crudos", async () => {
  const { ctx } = hacerCtx();
  const deps = await github.dependencies("42", ctx);
  assert.deepEqual(deps, { predecessors: [], successors: ["43"] });
});

// --------------------------------------------------------------------------
// setState
// --------------------------------------------------------------------------

test("un canonico que GitHub no tiene no se escribe, y lo dice", async () => {
  for (const canonico of ["in_progress", "blocked", "in_review"]) {
    const { ctx, pedidos } = hacerCtx();
    const r = await github.setState("42", canonico, ctx);
    assert.deepEqual(r, { written: null, skipped: canonico });
    assert.equal(pedidos.length, 0, "no se inventa un nombre nativo ni se gasta una llamada");
  }
});

test("setState a done cierra con state_reason completed", async () => {
  const { ctx, pedidos } = hacerCtx();
  const r = await github.setState("42", "done", ctx);
  assert.equal(r.written, "closed");
  const patch = pedidos.find((p) => p.metodo === "PATCH");
  assert.ok(patch);
  assert.equal(patch.ruta, "/repos/acme/tienda/issues/42");
  assert.deepEqual(patch.body, { state: "closed", state_reason: "completed" });
});

test("reabrir un issue cerrado manda state_reason reopened", async () => {
  const { ctx, pedidos } = hacerCtx();
  const r = await github.setState("45", "todo", ctx);
  assert.equal(r.written, "open");
  const patch = pedidos.find((p) => p.metodo === "PATCH");
  assert.deepEqual(patch.body, { state: "open", state_reason: "reopened" });
});

test("poner en todo un issue ya abierto no toca el motivo del cierre", async () => {
  const { ctx, pedidos } = hacerCtx();
  await github.setState("42", "todo", ctx);
  const patch = pedidos.find((p) => p.metodo === "PATCH");
  assert.deepEqual(patch.body, { state: "open", state_reason: null });
});

// --------------------------------------------------------------------------
// comment, labels, linkUrl
// --------------------------------------------------------------------------

test("comment publica el cuerpo y devuelve el id del comentario como string", async () => {
  const { ctx, pedidos } = hacerCtx();
  const r = await github.comment("42", "Pull request abierto por noxloop: https://x/pull/1", ctx);
  assert.equal(r.id, "4001");
  assert.equal(r.url, "https://github.com/acme/tienda/issues/42#issuecomment-4001");
  assert.equal(pedidos[0].metodo, "POST");
  assert.equal(pedidos[0].ruta, "/repos/acme/tienda/issues/42/comments");
  assert.deepEqual(pedidos[0].body, { body: "Pull request abierto por noxloop: https://x/pull/1" });
});

test("addLabel SUMA con POST y nunca reemplaza con PUT", async () => {
  const { ctx, pedidos } = hacerCtx();
  const r = await github.addLabel("42", "noxloop", ctx);
  assert.equal(r.ok, true);
  assert.equal(pedidos[0].metodo, "POST", "PUT borraria las etiquetas que el equipo puso a mano");
  assert.equal(pedidos[0].ruta, "/repos/acme/tienda/issues/42/labels");
  assert.deepEqual(pedidos[0].body, { labels: ["noxloop"] });
  assert.ok(r.labels.includes("noxloop"));
});

test("una escritura rechazada por permisos lanza con el mensaje del gestor", async () => {
  const { ctx } = hacerCtx({}, {
    "POST /repos/acme/tienda/issues/42/labels": [403, { message: "Resource not accessible by integration" }],
  });
  await assert.rejects(
    () => github.addLabel("42", "noxloop", ctx),
    /Resource not accessible by integration/,
  );
});

test("linkUrl esta en false y lanza NotSupportedError si alguien la llama", async () => {
  const { ctx } = hacerCtx();
  await assert.rejects(
    () => github.linkUrl("42", "https://github.com/acme/tienda/pull/1", "Pull request", ctx),
    (e) => e instanceof NotSupportedError,
    "no existe endpoint de remote links: fingir que se adjunto seria peor que no hacerlo",
  );
});

// --------------------------------------------------------------------------
// createChild
// --------------------------------------------------------------------------

test("createChild cuelga la tarea del padre en UNA llamada, con el id global", async () => {
  const { ctx, pedidos } = hacerCtx({ childType: "Task", childLabels: ["noxloop"] });
  const hijo = await github.createChild("7", {
    id: "T1",
    title: "Convertir el total en el carrito",
    acceptance: ["dado un carrito, cuando cambia la moneda, entonces el total se convierte"],
    repo: "app",
  }, ctx);

  assert.equal(hijo.id, "77");
  assert.equal(hijo.level, "task");

  const post = pedidos.find((p) => p.metodo === "POST" && p.ruta === "/repos/acme/tienda/issues");
  assert.ok(post, "la creacion va a POST /repos/{owner}/{repo}/issues");
  assert.equal(post.body.title, "Convertir el total en el carrito");
  assert.equal(post.body.parent_issue_id, 900, "el id GLOBAL del padre, no su numero 7");
  assert.notEqual(post.body.parent_issue_id, 7, "mandar el numero engancharia un issue ajeno que casualmente tenga ese id global");
  assert.equal(post.body.type, "Task", "el issue type se pasa por NOMBRE, no por id");
  assert.deepEqual(post.body.labels, ["noxloop"]);
  assert.match(post.body.body, /el total se convierte/);
});

test("createChild no promete campos de tablero que no hereda", async () => {
  const { ctx, pedidos } = hacerCtx();
  await github.createChild("7", { id: "T1", title: "Una tarea", acceptance: [], repo: "app" }, ctx);
  const post = pedidos.find((p) => p.metodo === "POST" && p.ruta === "/repos/acme/tienda/issues");
  assert.equal(post.body.milestone, undefined, "boardFields esta en false: no se inventa la herencia de milestone");
});

// --------------------------------------------------------------------------
// searchInbox
// --------------------------------------------------------------------------

test("searchInbox separa asignados de mencionados en dos consultas al core", async () => {
  const { ctx, pedidos } = hacerCtx();
  const { assigned, mentioned } = await github.searchInbox(ctx);
  assert.deepEqual(pedidos.map((p) => p.ruta), [
    "/issues?filter=assigned&state=open&per_page=100&page=1",
    "/issues?filter=mentioned&state=open&per_page=100&page=1",
  ]);
  assert.deepEqual(mentioned.map((i) => i.id), ["43"]);
  // Sin filtro declarado se devuelven los dos; con `owner`/`repo` puestos, el
  // ajeno no entra (su propio test lo fija).
  assert.deepEqual(assigned.map((i) => i.id), ["42"]);
});

test("searchInbox descarta los pull requests que GitHub cuenta como issues", async () => {
  const { ctx } = hacerCtx();
  const { assigned } = await github.searchInbox(ctx);
  assert.ok(!assigned.some((i) => i.id === "88"), "un PR en la bandeja dispararia un recorrido sobre una revision");
});

test("searchInbox NO ofrece issues de repositorios que la configuracion no declara", async () => {
  // EL FALLO QUE EVITA, y es un bloqueante para usarlo con un token personal:
  // `/issues?filter=assigned` devuelve los issues asignados al dueño del token
  // en TODOS los repositorios que puede ver. Con un PAT personal, el daemon
  // levantaba los issues de trabajo de esa persona —de otras organizaciones
  // enteras— y gastaba una invocacion de planificacion en cada uno antes de que
  // `validatePlan` los rechazara por tocar un repositorio no declarado.
  //
  // La configuracion declara sobre que repositorio trabaja noxloop. Lo de afuera
  // no es asunto suyo, y omitirlo se DICE en vez de callarse.
  const { ctx, pedidos } = hacerCtx();
  const { assigned } = await github.searchInbox(ctx);

  assert.deepEqual(
    assigned.map((i) => i.id),
    ["42"],
    "un issue de otra organizacion no puede entrar a la bandeja",
  );
  // La consulta sigue siendo una sola por senial: filtrar del lado del cliente
  // es mas barato que una consulta por repositorio, y el endpoint del core no
  // acepta acotarla por repositorio.
  assert.equal(pedidos.filter((x) => x.ruta.includes("filter=assigned")).length, 1);
});

test("searchInbox deja pasar lo de otro repositorio si la configuracion no dice cual", async () => {
  // Sin `owner`/`repo` declarados no hay con que filtrar, y filtrar todo seria
  // dejar la bandeja muda sin decir por que. Se devuelve lo que hay.
  const { ctx } = hacerCtx({ owner: undefined, repo: undefined });
  const { assigned } = await github.searchInbox(ctx);
  assert.ok(assigned.length >= 2, "sin configuracion de repositorio no se filtra");
});

test("searchInbox califica los items de otros repositorios", async () => {
  // Con el filtro apagado, para poder verificar la calificacion del id.
  const { ctx } = hacerCtx({ owner: undefined, repo: undefined });
  const { assigned } = await github.searchInbox(ctx);
  // Se elige por su URL y no por "tiene #": sin repositorio configurado, `aItem`
  // califica TODOS los ids, asi que buscar el "#" agarra cualquiera.
  const ajeno = assigned.find((i) => i.url.includes("otra-org"));
  assert.equal(ajeno.id, "otra-org/otro#12", "dos repos pueden tener el issue 12: un numero pelado despacharia el equivocado");
  assert.equal(ajeno.url, "https://github.com/otra-org/otro/issues/12");
});

// --------------------------------------------------------------------------
// Auth y version de la API
// --------------------------------------------------------------------------

test("cada pedido pinnea la version de la API y manda el token por Bearer", async () => {
  const { ctx, pedidos } = hacerCtx();
  await github.getItem("42", ctx);
  const h = pedidos[0].init.headers;
  assert.equal(h.Authorization, "Bearer ghp_falso_para_el_test");
  assert.equal(h.Accept, "application/vnd.github+json");
  assert.equal(
    h["X-GitHub-Api-Version"],
    "2026-03-10",
    "sin el header la API cae en 2022-11-28, donde los endpoints de dependencies no estan documentados",
  );
});

test("acepta GH_TOKEN como alias, que es donde lo guarda el gh CLI", async () => {
  const { ctx, pedidos } = hacerCtx();
  ctx.env = { GH_TOKEN: "gho_del_cli" };
  await github.getItem("42", ctx);
  assert.equal(pedidos[0].init.headers.Authorization, "Bearer gho_del_cli");
});

test("sin token lanza antes de gastar una llamada", async () => {
  const { ctx, pedidos } = hacerCtx();
  ctx.env = {};
  await assert.rejects(() => github.getItem("42", ctx), /GITHUB_TOKEN/);
  assert.equal(pedidos.length, 0);
});

// --------------------------------------------------------------------------
// Que la suite de contrato no pase por casualidad
// --------------------------------------------------------------------------
//
// El check 6 —un tipo nativo desconocido cae en el nivel por defecto— se puede
// aprobar sin querer: el default declarado en los fixtures es "story", y el
// typeMap manda a "story" a cinco de sus siete entradas. Un proveedor que
// devolviera "story" fijo, o que comparara el nombre del tipo contra una
// constante, pasaria el check igual. Correr la MISMA suite entera con un
// default distinto es lo que lo distingue: si el nivel no saliera del mapa,
// esta segunda pasada falla.

test("pasa la suite de contrato tambien con otro nivel por defecto declarado", async (t) => {
  const fx = {
    ...fixturesDeTest({ typeMap: { Epic: "epic", Task: "task", default: "task" } }),
    defaultLevel: "task",
  };
  for (const check of contractChecks(github, fx)) {
    await t.test(check.name, async () => {
      await check.run();
    });
  }
});

// --------------------------------------------------------------------------
// Lo que el gestor devuelve cuando no devuelve lo que promete
// --------------------------------------------------------------------------
//
// Ninguno de estos casos es hipotetico en una API con el tamaño de la de
// GitHub: un issue transferido a mitad de una paginacion, un proxy corporativo
// que corta un cuerpo, un endpoint nuevo que devuelve un envoltorio en vez de
// una lista. El fallo que estos tests evitan es siempre el mismo: un
// `TypeError: Cannot read properties of null` que el motor reporta como causa
// del recorrido, sin decir contra que gestor ni contra que ruta paso.

/** Un issue recortado a lo minimo, para construir respuestas raras. */
const ISSUE_MINIMO = {
  id: 1099,
  number: 99,
  title: "Minimo",
  body: "",
  state: "open",
  state_reason: null,
  html_url: "https://github.com/acme/tienda/issues/99",
  labels: [],
  assignee: null,
  type: null,
  parent_issue_url: null,
};

test("children saltea lo que no es un issue y devuelve el resto", async () => {
  const { ctx } = hacerCtx({}, {
    "GET /repos/acme/tienda/issues/7/sub_issues?per_page=100&page=1": [200, [ISSUE_42, null, ISSUE_43]],
  });
  const avisos = [];
  ctx.log.warn = (...a) => avisos.push(a);
  const hijos = await github.children("7", ctx);
  assert.deepEqual(hijos.map((h) => h.id), ["42", "43"], "un hueco en la lista no puede tirar el hito entero");
  assert.equal(avisos.length, 1, "saltear en silencio es como se pierde un hijo sin que nadie se entere");
});

test("dependencies saltea lo que no es un issue", async () => {
  const { ctx } = hacerCtx({}, {
    "GET /repos/acme/tienda/issues/43/dependencies/blocked_by?per_page=100&page=1": [200, [null, ISSUE_42]],
    "GET /repos/acme/tienda/issues/43/dependencies/blocking?per_page=100&page=1": [200, [{ sin: "number" }]],
  });
  const deps = await github.dependencies("43", ctx);
  assert.deepEqual(deps, { predecessors: ["42"], successors: [] });
});

test("searchInbox saltea lo que no es un issue", async () => {
  const { ctx } = hacerCtx({}, {
    "GET /issues?filter=assigned&state=open&per_page=100&page=1": [200, [null, ISSUE_42]],
    "GET /issues?filter=mentioned&state=open&per_page=100&page=1": [200, [ISSUE_43, null]],
  });
  const { assigned, mentioned } = await github.searchInbox(ctx);
  assert.deepEqual(assigned.map((i) => i.id), ["42"]);
  assert.deepEqual(mentioned.map((i) => i.id), ["43"]);
});

test("un 200 que no trae un issue lanza citando la ruta, y no devuelve un item con id 'undefined'", async () => {
  for (const cuerpo of [null, [], { message: "algo raro" }]) {
    const { ctx } = hacerCtx({}, { "GET /repos/acme/tienda/issues/42": [200, cuerpo] });
    await assert.rejects(
      () => github.getItem("42", ctx),
      (e) => {
        assert.match(e.message, /\/repos\/acme\/tienda\/issues\/42/);
        assert.ok(!(e instanceof TypeError), `un TypeError no dice que paso: ${e.message}`);
        return true;
      },
      // El motor guarda el estado del recorrido por `item.id`: un item con
      // id "undefined" y sin url se propaga y recien se nota al final.
      "un item invalido en silencio es peor que un error con la ruta adentro",
    );
  }
});

test("un issue sin html_url igual sale con una url usable", async () => {
  const { ctx } = hacerCtx({}, {
    "GET /repos/acme/tienda/issues/42": [200, { ...ISSUE_MINIMO, number: 42, html_url: undefined }],
  });
  const item = await github.getItem("42", ctx);
  // El `Item` del contrato exige `url` no vacia: sin respaldo el item sale
  // invalido y el fallo aparece lejos de donde nacio.
  assert.equal(item.url, "https://github.com/acme/tienda/issues/42");
});

test("labels que no viene como lista no revienta", async () => {
  const { ctx } = hacerCtx({}, {
    "GET /repos/acme/tienda/issues/42": [200, { ...ISSUE_MINIMO, number: 42, labels: { name: "bug" } }],
  });
  const item = await github.getItem("42", ctx);
  assert.deepEqual(item.labels, []);
});

test("comment no lanza si la respuesta no trae el id: el reintento duplicaria el comentario", async () => {
  const { ctx } = hacerCtx({}, { "POST /repos/acme/tienda/issues/42/comments": [201, null] });
  const r = await github.comment("42", "Pull request abierto", ctx);
  // El comentario YA se publico: fallar despues de la escritura hace que el
  // motor reintente y el ticket termine con el mismo comentario dos veces.
  assert.deepEqual(r, { id: null, url: null });
});

test("createChild avisa que el issue ya se creo si no puede leer la respuesta", async () => {
  const { ctx } = hacerCtx({}, { "POST /repos/acme/tienda/issues": [201, null] });
  await assert.rejects(
    () => github.createChild("7", { title: "Una tarea" }, ctx),
    /ya quedo creada|ya se creo/,
    "reintentar la creacion entera duplica tickets en el tablero: el mensaje tiene que decirlo",
  );
});

// --------------------------------------------------------------------------
// El id canonico
// --------------------------------------------------------------------------

test("owner y repo se comparan sin distinguir mayusculas, como los compara GitHub", async () => {
  // La configuracion dice "Acme/Tienda"; la API devuelve la capitalizacion
  // canonica del repositorio. Si la comparacion fuera sensible, getItem("42")
  // devolveria id "acme/tienda#42" para el repositorio configurado, el motor
  // guardaria el estado bajo un id distinto del que despacho, y la tarea
  // quedaria huerfana sin un solo error.
  const { ctx } = hacerCtx({ owner: "Acme", repo: "Tienda" }, {
    "GET /repos/Acme/Tienda/issues/42": [200, ISSUE_42],
  });
  const item = await github.getItem("42", ctx);
  assert.equal(item.id, "42");
});

// --------------------------------------------------------------------------
// setState y el nombre nativo que viene de la configuracion
// --------------------------------------------------------------------------

test("un stateMap con 'Closed' capitalizado escribe el valor que la API acepta", async () => {
  const { ctx, pedidos } = hacerCtx({
    stateMap: { todo: "open", in_progress: null, blocked: null, in_review: null, done: "Closed" },
  });
  const r = await github.setState("42", "done", ctx);
  assert.equal(r.written, "closed");
  const patch = pedidos.find((p) => p.metodo === "PATCH");
  assert.deepEqual(patch.body, { state: "closed", state_reason: "completed" });
});

test("un nativo que la API de Issues no acepta se rechaza antes de gastar una llamada", async () => {
  const { ctx, pedidos } = hacerCtx({
    stateMap: { todo: "Abierto", in_progress: null, blocked: null, in_review: null, done: "closed" },
  });
  await assert.rejects(
    () => github.setState("42", "todo", ctx),
    (e) => {
      assert.match(e.message, /stateMap/, "el mensaje tiene que apuntar a la configuracion que hay que arreglar");
      assert.match(e.message, /open/);
      return true;
    },
    "un PATCH con un estado que la API no acepta vuelve como 422 y el recorrido se detiene sin decir que el mapa esta mal",
  );
  assert.equal(pedidos.length, 0);
});

test("perPage 0 no pide paginas de cero elementos", async () => {
  // per_page=0 hace que GitHub devuelva su default de 30: la pagina nunca
  // "viene corta" contra 0 y el proveedor gira hasta el tope de paginas.
  const { ctx, pedidos } = hacerCtx({ perPage: 0 }, {
    "GET /repos/acme/tienda/issues/7/sub_issues?per_page=1&page=1": [200, [ISSUE_42]],
    "GET /repos/acme/tienda/issues/7/sub_issues?per_page=1&page=2": [200, []],
  });
  const hijos = await github.children("7", ctx);
  assert.deepEqual(hijos.map((h) => h.id), ["42"]);
  assert.equal(pedidos.length, 2);
});

// --------------------------------------------------------------------------
// listItems (spec 003, contracts/board-api.md §1)
// --------------------------------------------------------------------------

const PRIORIDADES = { P0: 0, P1: 1, P2: 2, P3: 3, "prioridad: urgente": 0 };

test("listItems lista los issues abiertos del repositorio y descarta los pull requests", async () => {
  const { ctx, pedidos } = hacerCtx();
  const r = await github.listItems({}, ctx);
  assert.deepEqual(r.items.map((i) => i.id), ["60", "61", "62", "63"], "el PR 88 viene mezclado en el endpoint y no es un ticket");
  assert.equal(r.nextCursor, null);
  assert.equal(r.total, null, "este endpoint no dice cuantos hay: null antes que un numero inventado");
  assert.deepEqual(pedidos.map((p) => p.ruta), [
    "/repos/acme/tienda/issues?state=open&per_page=100&page=1",
    "/repos/acme/tienda/issues?state=open&per_page=100&page=2",
  ], "la segunda pagina se pide porque el header Link la anuncia");
});

test("listItems traduce la tarjeta: equipo owner/repo, asignado con avatar, etiquetas y fecha", async () => {
  const { ctx } = hacerCtx();
  const { items } = await github.listItems({}, ctx);
  const i60 = items.find((i) => i.id === "60");
  assert.ok(i60);
  assert.equal(i60.key, "acme/tienda#60");
  assert.equal(i60.team, "acme/tienda");
  assert.deepEqual(i60.assignee, { id: "91", name: "ana", avatarUrl: "https://avatars.githubusercontent.com/u/91?v=4" });
  assert.deepEqual(i60.labels, ["P1", "checkout"]);
  assert.equal(i60.updatedAt, "2026-09-20T09:15:00Z");
  assert.equal(i60.level, "story");
  assert.equal(items.find((i) => i.id === "62").assignee, null);
});

test("listItems: sin priorityLabels no hay prioridad, aunque haya etiquetas que parezcan una", async () => {
  const { ctx } = hacerCtx();
  const { items } = await github.listItems({}, ctx);
  for (const i of items) assert.equal(i.priority, null, `${i.id}: GitHub Issues no tiene prioridad nativa y no se inventa`);
});

test("listItems: con priorityLabels, la prioridad sale de la etiqueta mapeada, y gana la mas urgente", async () => {
  const { ctx } = hacerCtx({ priorityLabels: PRIORIDADES });
  const { items } = await github.listItems({}, ctx);
  const p = Object.fromEntries(items.map((i) => [i.id, i.priority]));
  assert.equal(p["60"], 1);
  assert.equal(p["61"], 2, "P3 y p2 a la vez: gana 2, y la etiqueta se compara sin mayusculas como la compara GitHub");
  assert.equal(p["62"], null);
  assert.equal(p["63"], 0);
});

test("listItems: nunca backlog en GitHub, salvo que stateMap.backlog nombre una etiqueta", async () => {
  const sinMapa = await github.listItems({}, hacerCtx().ctx);
  assert.ok(sinMapa.items.every((i) => i.canonicalState === "todo"), "sin mapeo, todo lo abierto es todo");

  const { ctx } = hacerCtx({
    stateMap: { todo: "open", in_progress: null, blocked: null, in_review: null, done: "closed", backlog: "Backlog" },
  });
  const { items } = await github.listItems({}, ctx);
  const e = Object.fromEntries(items.map((i) => [i.id, i.canonicalState]));
  assert.equal(e["61"], "backlog");
  assert.equal(e["60"], "todo");
});

test("listItems pagina con cursor: limit corta a mitad de pagina y el cursor retoma sin repetir ni perder", async () => {
  const { ctx } = hacerCtx();
  const p1 = await github.listItems({ limit: 2 }, ctx);
  assert.deepEqual(p1.items.map((i) => i.id), ["60", "61"]);
  assert.equal(typeof p1.nextCursor, "string");
  const p2 = await github.listItems({ limit: 2, cursor: p1.nextCursor }, ctx);
  assert.deepEqual(p2.items.map((i) => i.id), ["62", "63"]);
  assert.equal(p2.nextCursor, null);
});

test("listItems: un cursor que cae justo al final de una pagina apunta a la siguiente", async () => {
  const { ctx, pedidos } = hacerCtx();
  const p1 = await github.listItems({ limit: 3 }, ctx);
  assert.deepEqual(p1.items.map((i) => i.id), ["60", "61", "62"]);
  assert.equal(pedidos.length, 1, "no pide la pagina 2 si ya junto el limite");
  const p2 = await github.listItems({ limit: 3, cursor: p1.nextCursor }, ctx);
  assert.deepEqual(p2.items.map((i) => i.id), ["63"]);
});

test("listItems con includeDone: el cerrado completado sale en done y el descartado no sale", async () => {
  const { ctx, pedidos } = hacerCtx();
  const r = await github.listItems({ includeDone: true }, ctx);
  assert.equal(pedidos[0].ruta, "/repos/acme/tienda/issues?state=all&per_page=100&page=1");
  const e = Object.fromEntries(r.items.map((i) => [i.id, i.canonicalState]));
  assert.equal(e["64"], "done");
  assert.ok(!("65" in e), "no_planned no es terminado: es descartado, y el board no lo muestra como hecho");
});

test("listItems sin owner/repo lo dice, en vez de listar todo lo que el token ve", async () => {
  const { ctx, pedidos } = hacerCtx({ owner: undefined, repo: undefined });
  await assert.rejects(() => github.listItems({}, ctx), /owner.*repo|repo.*owner/);
  assert.equal(pedidos.length, 0);
});

test("listItems: un cursor que no salio de este proveedor se rechaza con su valor", async () => {
  const { ctx } = hacerCtx();
  await assert.rejects(() => github.listItems({ cursor: "../../etc" }, ctx), /cursor/);
});

test("priorityLabels esta descrita en el esquema de opciones, con el rango del contrato", () => {
  const p = github.optionsSchema.properties.priorityLabels;
  assert.ok(p, "una opcion que el codigo lee y el esquema no describe no se puede usar con additionalProperties:false");
  assert.equal(p.additionalProperties.minimum, 0);
  assert.equal(p.additionalProperties.maximum, 4);
});
