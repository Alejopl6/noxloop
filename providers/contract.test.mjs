import { test } from "node:test";
import assert from "node:assert/strict";
import { contractChecks, validateProvider, validateItem, CAPABILITY_KEYS, OPTIONAL_CAPABILITY_KEYS, CANONICAL_STATES } from "./contract.mjs";
import * as fake from "./fake/index.mjs";

test("el proveedor falso pasa el contrato completo", async () => {
  for (const check of contractChecks(fake, fake.fixtures)) {
    await check.run();
  }
});

test("validateProvider detecta una capacidad declarada sin su funcion, AL CARGAR", () => {
  const mentiroso = { ...fake, capabilities: () => ({ ...fake.capabilities(), dependencies: true }), dependencies: undefined };
  const r = validateProvider(mentiroso);
  assert.equal(r.ok, false);
  assert.ok(r.problems.join(" ").includes("dependencies"));
});

test("validateProvider detecta una clave de capacidad inventada o faltante", () => {
  const conExtra = { ...fake, capabilities: () => ({ ...fake.capabilities(), telepatia: true }) };
  assert.ok(validateProvider(conExtra).problems.join(" ").includes("telepatia"));
  const conFalta = { ...fake, capabilities: () => ({}) };
  // Las opcionales (las que llegaron despues, como `listItems`) no se exigen:
  // ausentes valen false.
  const obligatorias = CAPABILITY_KEYS.filter((k) => !OPTIONAL_CAPABILITY_KEYS.includes(k));
  assert.ok(validateProvider(conFalta).problems.length >= obligatorias.length);
});

test("validateProvider exige meta y getItem", () => {
  assert.ok(validateProvider({ capabilities: () => ({}) }).problems.join(" ").includes("meta"));
  assert.ok(validateProvider({ meta: { name: "x" }, capabilities: () => ({}) }).problems.join(" ").includes("getItem"));
});

test("validateItem rechaza un item sin los campos canonicos", () => {
  assert.equal(validateItem({ id: "1", title: "t", level: "story", url: "u" }).ok, true);
  assert.ok(validateItem({ id: "1", title: "t", level: "epica", url: "u" }).problems.join(" ").includes("level"));
  assert.ok(validateItem({ title: "t", level: "story", url: "u" }).problems.join(" ").includes("id"));
  assert.ok(validateItem({ id: 7, title: "t", level: "story", url: "u" }).problems.join(" ").includes("id"),
    "id es string: Linear usa UUID y GitHub numero");
});

test("getItem de un id inexistente devuelve null y no lanza", async () => {
  assert.equal(await fake.getItem("no-existe", fake.fixtures.ctx), null);
});

test("un tipo nativo desconocido cae en el nivel por defecto declarado, sin fallar", async () => {
  const item = await fake.getItem("tipo-raro", fake.fixtures.ctx);
  assert.ok(CANONICAL_STATES.length === 5);
  assert.equal(item.level, fake.fixtures.defaultLevel);
});

test("el mapa de estados es total: todo canonico tiene entrada, posiblemente null", () => {
  const mapa = fake.fixtures.ctx.options.stateMap;
  for (const s of CANONICAL_STATES) {
    assert.ok(s in mapa, `falta ${s}`);
  }
});

test("ninguna funcion del proveedor lee process.env: el ctx no se puede saltear", async () => {
  const { readFileSync } = await import("node:fs");
  const fuente = readFileSync(new URL("./fake/index.mjs", import.meta.url), "utf8");
  assert.ok(!/process\.env/.test(fuente), "el proveedor recibe env por ctx, no lo lee");
});

// ---------------------------------------------------------------------------
// listItems (spec 003, contracts/board-api.md §1)
// ---------------------------------------------------------------------------

import {
  can,
  CAPABILITY_FUNCTIONS,
  LISTED_STATES,
  validateListedItem,
  validateListPage,
  listQuery,
} from "./contract.mjs";

/** Un ListedItem minimo y valido, para romperlo campo por campo. */
const listado = (extra = {}) => ({
  id: "1",
  title: "t",
  level: "story",
  url: "u",
  canonicalState: "todo",
  priority: null,
  assignee: null,
  team: null,
  labels: [],
  updatedAt: "2026-09-20T10:00:00.000Z",
  ...extra,
});

test("listItems es una capacidad conocida, respaldada por la funcion listItems", () => {
  assert.ok(CAPABILITY_KEYS.includes("listItems"));
  assert.equal(CAPABILITY_FUNCTIONS.listItems, "listItems");
});

test("un proveedor escrito antes de listItems sigue validando: ausente es false, y can() lo dice", () => {
  // EL FALLO QUE ESTO EVITA. Hacer obligatoria una clave nueva rompe al cargar a
  // TODO proveedor escrito contra el contrato anterior —incluidos los de fuera
  // de este repositorio, que el motor carga por configuracion—. Ausente es la
  // degradacion declarada, no un error.
  const { listItems: _fuera, ...viejas } = fake.capabilities();
  const viejo = { ...fake, capabilities: () => viejas, listItems: undefined };
  const v = validateProvider(viejo);
  assert.equal(v.ok, true, v.problems.join("; "));
  const r = can(viejo, "listItems");
  assert.equal(r.available, false);
  assert.match(String(r.reason), /listItems/);
  assert.match(String(r.reason), /fake/);
});

test("listItems declarada tiene que ser boolean, y en true exige la funcion", () => {
  const raro = { ...fake, capabilities: () => ({ ...fake.capabilities(), listItems: "si" }) };
  assert.ok(validateProvider(raro).problems.join(" ").includes("listItems"));
  const sinFuncion = { ...fake, capabilities: () => ({ ...fake.capabilities(), listItems: true }), listItems: undefined };
  assert.ok(validateProvider(sinFuncion).problems.join(" ").includes("listItems"));
});

test("LISTED_STATES suma backlog a los canonicos, sin tocar los cinco de setState", () => {
  assert.deepEqual(LISTED_STATES, ["backlog", ...CANONICAL_STATES]);
  assert.ok(!CANONICAL_STATES.includes("backlog"), "backlog no es escribible: setState no lo conoce");
});

test("validateListedItem acepta el item minimo y cada estado listable", () => {
  for (const s of LISTED_STATES) {
    const r = validateListedItem(listado({ canonicalState: s }));
    assert.equal(r.ok, true, `${s}: ${r.problems.join("; ")}`);
  }
  assert.equal(validateListedItem(listado({ priority: 0, assignee: { id: "a", name: "Ana" }, team: "Core", labels: ["api"] })).ok, true);
  assert.equal(validateListedItem(listado({ assignee: { id: "a", name: "Ana", avatarUrl: "https://x/y.png" } })).ok, true);
});

test("validateListedItem rechaza lo que el board no puede pintar sin adivinar", () => {
  const falla = (extra, campo) => {
    const r = validateListedItem(listado(extra));
    assert.equal(r.ok, false, `acepto ${JSON.stringify(extra)}`);
    assert.ok(r.problems.join(" ").includes(campo), `el problema no nombra ${campo}: ${r.problems.join("; ")}`);
  };
  falla({ canonicalState: null }, "canonicalState");
  falla({ canonicalState: "cancelado" }, "canonicalState");
  falla({ priority: 5 }, "priority");
  falla({ priority: -1 }, "priority");
  falla({ priority: 1.5 }, "priority");
  falla({ priority: "alta" }, "priority");
  falla({ priority: undefined }, "priority");
  falla({ assignee: "ana" }, "assignee");
  falla({ assignee: { name: "Ana" } }, "assignee");
  falla({ team: 7 }, "team");
  falla({ labels: "api" }, "labels");
  falla({ labels: ["api", 3] }, "labels");
  falla({ updatedAt: "ayer" }, "updatedAt");
  falla({ updatedAt: null }, "updatedAt");
  falla({ id: 7 }, "id");
  falla({ level: "epica" }, "level");
});

test("validateListPage exige la forma de la pagina y respeta el limite pedido", () => {
  assert.equal(validateListPage({ items: [listado()], nextCursor: null, total: 1 }, { limit: 5 }).ok, true);
  assert.equal(validateListPage({ items: [], nextCursor: "c2", total: null }, {}).ok, true);
  assert.ok(validateListPage({ items: [listado()] }, {}).problems.join(" ").includes("nextCursor"));
  assert.ok(validateListPage({ items: null, nextCursor: null, total: null }, {}).problems.join(" ").includes("items"));
  assert.ok(validateListPage({ items: [], nextCursor: 2, total: null }, {}).problems.join(" ").includes("nextCursor"));
  assert.ok(validateListPage({ items: [], nextCursor: null, total: "3" }, {}).problems.join(" ").includes("total"));
  const dos = [listado({ id: "1" }), listado({ id: "2" })];
  assert.ok(validateListPage({ items: dos, nextCursor: null, total: 2 }, { limit: 1 }).problems.join(" ").includes("limit"));
  assert.ok(validateListPage({ items: [listado({ id: "1" }), listado({ id: "1" })], nextCursor: null, total: 2 }, {}).problems.join(" ").includes("repetido"));
  // `done` solo con includeDone: sin pedirlo, un cerrado en la lista es un
  // ticket que el board vuelve a ofrecer para correr.
  const cerrado = [listado({ canonicalState: "done" })];
  assert.ok(validateListPage({ items: cerrado, nextCursor: null, total: 1 }, {}).problems.join(" ").includes("done"));
  assert.equal(validateListPage({ items: cerrado, nextCursor: null, total: 1 }, { includeDone: true }).ok, true);
});

test("listQuery normaliza la consulta: default 100, tope 500, cursor y includeDone", () => {
  assert.deepEqual(listQuery(undefined), { limit: 100, cursor: null, includeDone: false });
  assert.deepEqual(listQuery({ limit: 900, cursor: "x", includeDone: true }), { limit: 500, cursor: "x", includeDone: true });
  assert.equal(listQuery({ limit: 0 }).limit, 1);
  assert.equal(listQuery({ limit: "7" }).limit, 100, "un limite que no es numero no se interpreta: cae en el default");
  assert.equal(listQuery({ limit: 2.9 }).limit, 2);
  assert.equal(listQuery({ cursor: "" }).cursor, null);
});

// ------------------------------------------------------- el falso, listando

test("el falso declara listItems y lista sus tickets abiertos como ListedItem", async () => {
  fake.reset();
  assert.equal(fake.capabilities().listItems, true);
  const r = await fake.listItems({}, fake.fixtures.ctx);
  const v = validateListPage(r, {});
  assert.equal(v.ok, true, v.problems.join("; "));
  assert.deepEqual(r.items.map((i) => i.id), ["1", "2", "3", "tipo-raro"]);
  assert.equal(r.total, 4);
  assert.equal(r.nextCursor, null);
  for (const i of r.items) {
    assert.equal(i.canonicalState, "todo");
    assert.equal(i.priority, null, "el falso no tiene prioridad salvo que el item la traiga: no se inventa");
  }
});

test("el falso pagina con cursor y no repite ni pierde tickets", async () => {
  fake.reset();
  const p1 = await fake.listItems({ limit: 3 }, fake.fixtures.ctx);
  assert.equal(p1.items.length, 3);
  assert.equal(typeof p1.nextCursor, "string");
  const p2 = await fake.listItems({ limit: 3, cursor: p1.nextCursor }, fake.fixtures.ctx);
  assert.deepEqual([...p1.items, ...p2.items].map((i) => i.id), ["1", "2", "3", "tipo-raro"]);
  assert.equal(p2.nextCursor, null);
});

test("el falso distingue backlog solo con un mapeo explicito, y oculta done salvo includeDone", async () => {
  fake.reset();
  fake.db.items["2"].state = "Pendiente";
  fake.db.items["3"].state = "Hecho";
  fake.db.items["1"].priority = 1;
  fake.db.items["1"].assignee = "ana";
  fake.db.items["1"].team = "Core";
  const ctx = {
    ...fake.fixtures.ctx,
    options: { stateMap: { ...fake.fixtures.ctx.options.stateMap, backlog: "Pendiente", done: "Hecho" } },
  };
  const abiertos = await fake.listItems({}, ctx);
  assert.deepEqual(abiertos.items.map((i) => i.id), ["1", "2", "tipo-raro"], "el hecho no aparece sin includeDone");
  const porId = Object.fromEntries(abiertos.items.map((i) => [i.id, i]));
  assert.equal(porId["2"].canonicalState, "backlog");
  assert.equal(porId["1"].priority, 1);
  assert.deepEqual(porId["1"].assignee, { id: "ana", name: "ana" });
  assert.equal(porId["1"].team, "Core");
  // getItem sigue devolviendo un canonico de los cinco: backlog no es escribible.
  assert.equal((await fake.getItem("2", ctx)).canonicalState, "todo");
  const todos = await fake.listItems({ includeDone: true }, ctx);
  assert.ok(todos.items.some((i) => i.id === "3" && i.canonicalState === "done"));
  fake.reset();
});

// ---------------------------------------------- el chequeo de la suite

test("la suite de contrato tiene un chequeo de listItems", () => {
  const nombres = contractChecks(fake, fake.fixtures).map((c) => c.name);
  assert.ok(nombres.some((n) => /listItems/.test(n)), nombres.join(" | "));
});

test("el chequeo de listItems atrapa a un proveedor que declara listar y devuelve basura", async () => {
  const mentiroso = {
    ...fake,
    listItems: async () => ({ items: [{ id: "1", title: "t", level: "story", url: "u", canonicalState: "todo", priority: "alta" }], nextCursor: null, total: 1 }),
  };
  const chequeo = contractChecks(mentiroso, fake.fixtures).find((c) => /listItems/.test(c.name));
  assert.ok(chequeo);
  await assert.rejects(() => chequeo.run(), /priority/);
});

test("el chequeo de listItems atrapa un cursor que repite la primera pagina", async () => {
  const circular = {
    ...fake,
    listItems: async (q) => ({
      items: [{ ...listado({ id: "1" }) }],
      nextCursor: "otra-vez",
      total: null,
    }),
  };
  const chequeo = contractChecks(circular, fake.fixtures).find((c) => /listItems/.test(c.name));
  await assert.rejects(() => chequeo.run(), /cursor/);
});

test("sin la capacidad, el chequeo de listItems exige la degradacion declarada y no llama nada", async () => {
  const { listItems: _fuera, ...caps } = fake.capabilities();
  let llamadas = 0;
  const sin = { ...fake, capabilities: () => ({ ...caps, listItems: false }), listItems: async () => { llamadas++; throw new Error("no"); } };
  const chequeo = contractChecks(sin, fake.fixtures).find((c) => /listItems/.test(c.name));
  await chequeo.run();
  assert.equal(llamadas, 0);
});

// ---------------------------------------------------------------------------
// listStates (spec 005, FR-002: el editor visual del stateMap)
// ---------------------------------------------------------------------------

import { validateStateList } from "./contract.mjs";

test("listStates es una capacidad OPCIONAL conocida, respaldada por la funcion listStates", () => {
  assert.ok(CAPABILITY_KEYS.includes("listStates"));
  assert.ok(OPTIONAL_CAPABILITY_KEYS.includes("listStates"), "hacerla obligatoria rompe a todo proveedor anterior");
  assert.equal(CAPABILITY_FUNCTIONS.listStates, "listStates");
});

test("un proveedor sin listStates sigue validando, y can() lo dice nombrando proveedor y capacidad", () => {
  // El falso no la declara: es exactamente el proveedor escrito antes de ella.
  assert.equal("listStates" in fake.capabilities(), false);
  assert.equal(validateProvider(fake).ok, true);
  const r = can(fake, "listStates");
  assert.equal(r.available, false);
  assert.match(String(r.reason), /listStates/);
  assert.match(String(r.reason), /fake/);
});

test("listStates en true sin la funcion falla AL CARGAR, no al abrir el editor", () => {
  const sinFuncion = { ...fake, capabilities: () => ({ ...fake.capabilities(), listStates: true }) };
  assert.ok(validateProvider(sinFuncion).problems.join(" ").includes("listStates"));
});

test("validateStateList: {id, name, category, suggested}, sin nombres repetidos ni un canonico inventado", () => {
  const bien = [
    { id: "1", name: "Todo", category: "unstarted", suggested: "todo" },
    { id: "2", name: "Pausa", category: null, suggested: null },
  ];
  assert.equal(validateStateList(bien).ok, true, validateStateList(bien).problems.join("; "));
  assert.match(validateStateList("no").problems.join(" "), /array/);
  assert.match(validateStateList([{ id: "1", name: "" }]).problems.join(" "), /name/);
  assert.match(validateStateList([{ id: "1", name: "A", suggested: "revisando" }]).problems.join(" "), /suggested/);
  // El editor guarda NOMBRES (el stateMap es por nombre): dos estados con el
  // mismo nombre harian que el selector de uno escriba el del otro.
  assert.match(validateStateList([{ id: "1", name: "A" }, { id: "2", name: "A" }]).problems.join(" "), /repetid/);
});

test("el contrato lleva un chequeo de listStates: en true lista estados validos; en false can() lo declara", async () => {
  const nombres = contractChecks(fake, fake.fixtures).map((c) => c.name);
  assert.ok(nombres.some((n) => /listStates/.test(n)), nombres.join("\n"));
  // El falso no la tiene: el chequeo pasa por la rama de la degradacion.
  for (const check of contractChecks(fake, fake.fixtures)) await check.run();
});
