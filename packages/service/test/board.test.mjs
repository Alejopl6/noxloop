// El board: `GET /v1/board`, el read-model del contrato §2 (spec 003).
//
// DOS MITADES, y se prueban por separado a proposito:
//
//   1. `construirBoard` es PURA: tickets, runs y lo que el servicio sabe entran;
//      columnas, tarjetas, chips y resumen salen. Ahi se prueba la precedencia
//      de FR-003 caso por caso, sin servicio ni disco.
//   2. La ruta junta los datos: proyectos del almacen, `listItems` del
//      proveedor, runs del home. Ahi se prueba lo que solo existe junto —la
//      degradacion, el gestor caido, la cache— y el invariante de SC-007:
//      construir el board no cambia NADA en el disco. Se mide antes y despues,
//      igual que el tablero de la spec 001.
//
// El gestor es el proveedor `fake` de verdad, con su `listItems`: el mismo
// modulo que carga el servicio, asi que lo que el test siembra en `fake.db` es
// lo que el board lee.

import { test } from "node:test";
import assert from "node:assert/strict";

import { construirBoard } from "../src/board.mjs";
import * as fake from "../../../providers/fake/index.mjs";
import { conServicio, diferencias, huellaDelArbol, pedir } from "./ayuda.mjs";
import { proyectoActivo, repoConRemoto, runEnDisco } from "./ayuda-motor.mjs";

// ---------------------------------------------------------------------------
// 1. La derivacion, pura
// ---------------------------------------------------------------------------

/** Un ticket como lo devuelve `listItems`. */
const ticket = (id, canonicalState, extra = {}) => ({
  id,
  key: `CORE-${id}`,
  title: `ticket ${id}`,
  url: `fake://items/${id}`,
  canonicalState,
  priority: null,
  assignee: null,
  team: null,
  labels: [],
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...extra,
});

const PROYECTO = { id: "prj-1", nombre: "La App", estado: "ACTIVE" };

/** Lo que la ruta le pasa a `construirBoard` por proyecto. */
const parte = (extra = {}) => ({
  proyecto: PROYECTO,
  gestor: "fake",
  listItems: true,
  tickets: [],
  runs: [],
  nota: null,
  lanzable: true,
  tieneRepo: true,
  motivo: null,
  ...extra,
});

/** Un run ya derivado, como lo deja la ruta. */
const run = (itemId, estado, extra = {}) => ({
  itemId,
  estado,
  detalle: null,
  posicion: null,
  pr: null,
  avance: null,
  gasto: { usd: 0, calls: 0, medido: true },
  titulo: `ticket ${itemId}`,
  ...extra,
});

const tarjeta = (b, id) => b.tarjetas.find((t) => t.id === `prj-1:${id}`);

test("FR-003: la columna sale de la precedencia run con PR > run vivo > estado del gestor", () => {
  const b = construirBoard({
    partes: [
      parte({
        tickets: [
          ticket("1", "backlog"),
          ticket("2", "todo"),
          ticket("3", "todo"),
          ticket("4", "todo"),
          ticket("5", "blocked"),
          ticket("6", "in_review"),
          ticket("7", "in_progress"),
        ],
        runs: [
          run("3", "corriendo", { avance: { hechas: 2, total: 5, fase: "Gate" } }),
          run("4", "pr_abierto", { pr: "https://forja.test/pr/4" }),
        ],
      }),
    ],
  });

  assert.equal(tarjeta(b, "1").columna, "backlog");
  assert.equal(tarjeta(b, "2").columna, "todo");
  assert.equal(tarjeta(b, "3").columna, "in_progress", "el motor manda sobre lo que diga el gestor");
  assert.deepEqual(tarjeta(b, "3").avance, { hechas: 2, total: 5, fase: "Gate" });
  assert.equal(tarjeta(b, "3").chip.tipo, "fase");
  assert.equal(tarjeta(b, "4").columna, "in_review");
  assert.equal(tarjeta(b, "4").chip.tipo, "pr_listo");
  assert.equal(tarjeta(b, "4").run.pr, "https://forja.test/pr/4");
  assert.equal(tarjeta(b, "5").columna, "blocked", "bloqueado es COLUMNA desde la revision de FR-001 (2026-09-24)");
  assert.equal(tarjeta(b, "5").chip.tipo, "bloqueado", "y conserva el chip con la causa");
  assert.equal(tarjeta(b, "6").columna, "in_review");
  assert.equal(tarjeta(b, "7").columna, "in_progress");

  assert.deepEqual(
    b.columnas.map((c) => [c.id, c.total]),
    [["backlog", 1], ["todo", 1], ["in_progress", 2], ["in_review", 2], ["blocked", 1], ["done", 0]],
  );
  assert.deepEqual(b.columnas.map((c) => c.titulo), ["Backlog", "Todo", "En curso", "En revisión", "Bloqueado", "Hecho"]);
});

test("FR-001 revisado: un run bloqueado o fallido va a la columna Bloqueado; el resto de los detenidos sigue En curso con su chip", () => {
  const b = construirBoard({
    partes: [
      parte({
        tickets: ["1", "2", "3", "4"].map((id) => ticket(id, "todo")),
        runs: [
          run("1", "bloqueado", { detalle: "T002 agoto sus intentos" }),
          run("2", "fallido", { detalle: "el gestor devolvio 500" }),
          run("3", "interrumpido"),
          run("4", "necesita_permiso"),
        ],
      }),
    ],
  });
  assert.equal(tarjeta(b, "1").columna, "blocked");
  assert.equal(tarjeta(b, "1").chip.detalle, "T002 agoto sus intentos");
  assert.equal(tarjeta(b, "2").columna, "blocked");
  assert.equal(tarjeta(b, "3").columna, "in_progress");
  assert.equal(tarjeta(b, "4").columna, "in_progress");
  assert.equal(tarjeta(b, "1").accion.tipo, "retry", "desde Bloqueado se reintenta");
});

test("los chips del run y la accion principal de cada tarjeta", () => {
  const b = construirBoard({
    partes: [
      parte({
        tickets: ["1", "2", "3", "4", "5", "6", "7"].map((id) => ticket(id, "todo")),
        runs: [
          run("1", "en_cola", { posicion: 2 }),
          run("2", "plan_listo"),
          run("3", "fallido", { detalle: "el gestor devolvio 500" }),
          run("4", "necesita_criterios", { detalle: "¿Que cuenta como exportado?" }),
          run("5", "necesita_permiso", { detalle: "el agente pidio la credencial del gestor" }),
          run("6", "interrumpido"),
        ],
      }),
    ],
  });
  const chip = (id) => tarjeta(b, id).chip;
  const accion = (id) => tarjeta(b, id).accion;

  assert.deepEqual([chip("1").tipo, chip("1").posicion], ["en_cola", 2]);
  assert.equal(accion("1").tipo, "open_run");
  assert.equal(chip("2").tipo, "plan_listo");
  assert.equal(accion("2").tipo, "approve");
  assert.equal(chip("3").tipo, "fallido");
  assert.equal(chip("3").detalle, "el gestor devolvio 500", "la causa textual completa, no un resumen");
  assert.equal(accion("3").tipo, "retry");
  assert.equal(chip("4").tipo, "necesita_criterios");
  assert.equal(chip("4").detalle, "¿Que cuenta como exportado?");
  assert.equal(chip("5").tipo, "necesita_permiso");
  assert.equal(chip("6").tipo, "interrumpido");
  assert.equal(accion("6").tipo, "retry");
  assert.equal(chip("7"), null);
  assert.deepEqual(accion("7"), { tipo: "run", habilitada: true, motivo: null });

  // «te necesitan»: plan listo, criterios, permiso, fallido, interrumpido.
  assert.deepEqual(b.resumen, { enCurso: 0, teNecesitan: 5, enCola: 1 });
});

test("sin repo: chip `sin_repo` y Run deshabilitado DICIENDO que falta", () => {
  const b = construirBoard({
    partes: [
      parte({
        tickets: [ticket("1", "todo")],
        lanzable: false,
        tieneRepo: false,
        motivo: "El proyecto `La App` no tiene un repositorio remoto.",
      }),
    ],
  });
  const t = tarjeta(b, "1");
  assert.equal(t.chip.tipo, "sin_repo");
  assert.equal(t.tieneRepo, false);
  assert.deepEqual(t.accion, { tipo: "run", habilitada: false, motivo: "El proyecto `La App` no tiene un repositorio remoto." });
});

test("la tarjeta lleva lo que FR-005 pide, y la prioridad solo si el gestor la da", () => {
  const b = construirBoard({
    partes: [
      parte({
        tickets: [
          ticket("1", "todo", {
            priority: 1,
            team: "Core",
            labels: ["api"],
            assignee: { id: "u1", name: "Ana Maria Lopez", avatarUrl: "https://avatares.test/ana.png" },
          }),
          ticket("2", "todo"),
        ],
      }),
    ],
  });
  const t = tarjeta(b, "1");
  assert.deepEqual(t.proyecto, { id: "prj-1", nombre: "La App", color: null });
  assert.deepEqual(t.ticket, {
    id: "1",
    key: "CORE-1",
    titulo: "ticket 1",
    url: "fake://items/1",
    prioridad: 1,
    equipo: "Core",
    etiquetas: ["api"],
    asignado: { nombre: "Ana Maria Lopez", iniciales: "AL", avatarUrl: "https://avatares.test/ana.png" },
  });
  assert.equal(tarjeta(b, "2").ticket.prioridad, null, "sin dato no se inventa una prioridad");
  assert.equal(tarjeta(b, "2").ticket.asignado, null);
});

test("un run cuyo ticket el gestor no devolvio sigue apareciendo: el disco no depende del gestor", () => {
  const b = construirBoard({
    partes: [parte({ tickets: [], runs: [run("9", "corriendo", { titulo: "el del run" })], nota: "el gestor no contesto" })],
  });
  const t = tarjeta(b, "9");
  assert.ok(t, "la tarjeta del run desaparecio porque el gestor no la listo");
  assert.equal(t.ticket.titulo, "el del run");
  assert.equal(t.columna, "in_progress");
});

test("Hecho sale siempre, con los ULTIMOS 20 cerrados; `includeDone` los trae todos, y el corte se DICE", () => {
  const cerrados = Array.from({ length: 25 }, (_, i) =>
    ticket(`d${i}`, "done", { updatedAt: `2026-09-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` }),
  );
  const partes = [parte({ tickets: [...cerrados, ticket("abierto", "todo")] })];

  const b = construirBoard({ partes });
  const hechas = b.tarjetas.filter((t) => t.columna === "done");
  assert.equal(hechas.length, 20);
  assert.ok(hechas.some((t) => t.ticket.id === "d24"), "el mas reciente tiene que estar");
  assert.ok(!hechas.some((t) => t.ticket.id === "d0"), "el mas viejo es el que se corta");
  const columna = b.columnas.find((c) => c.id === "done");
  assert.equal(columna.total, 20);
  assert.match(String(columna.nota), /20 de 25/, "un corte en silencio se lee como «no hay mas»");

  const todas = construirBoard({ partes, includeDone: true });
  assert.equal(todas.tarjetas.filter((t) => t.columna === "done").length, 25);
  assert.equal(todas.columnas.find((c) => c.id === "done").nota, null);
});

test("la tarjeta dice de donde viene el ticket (`origen`) y quien lo ejecuta, resuelto en cascada", () => {
  const b = construirBoard({
    partes: [
      parte({
        gestor: "local",
        ejecutorDelProyecto: { runtime: "claude-agent-sdk", agente: null },
        tickets: [
          ticket("1", "todo"),
          ticket("2", "todo", { raw: { ejecutor: { runtime: "claude-agent-sdk", agente: "revisor-api" }, termino: "pr" } }),
        ],
      }),
    ],
  });
  assert.equal(tarjeta(b, "1").origen, "local");
  assert.deepEqual(tarjeta(b, "1").ejecutor, { runtime: "claude-agent-sdk", agente: null });
  assert.deepEqual(tarjeta(b, "2").ejecutor, { runtime: "claude-agent-sdk", agente: "revisor-api" });
  assert.equal(construirBoard({ partes: [parte()] }).tarjetas.length, 0);
});

test("nada te espera: el resumen en cero es cero, y lo dice", () => {
  const b = construirBoard({ partes: [parte()] });
  assert.deepEqual(b.resumen, { enCurso: 0, teNecesitan: 0, enCola: 0 });
});

// ---------------------------------------------------------------------------
// 2. La ruta
// ---------------------------------------------------------------------------

/** El gestor falso, sembrado. */
function sembrar() {
  fake.reset();
  fake.db.items["10"] = { type: "Historia", title: "exportar a CSV", state: "Nuevo", parentId: null, children: [], priority: 2 };
  fake.db.items["11"] = { type: "Historia", title: "ya en curso", state: "En curso", parentId: null, children: [] };
}

test("GET /v1/board: los tickets de los proyectos ACTIVE, una vez por proyecto, y el filtro por proyecto", async (t) => {
  sembrar();
  t.after(() => fake.reset());
  await conServicio({ motor: { intervaloMs: 0 } }, async (svc) => {
    const a = await proyectoActivo(svc, { nombre: "Alfa" });
    const b = await proyectoActivo(svc, { nombre: "Beta" });
    const c = await proyectoActivo(svc, { nombre: "A Medias", estado: "BOOTSTRAPPED" });
    runEnDisco(svc.home, "2", { projectId: a.id, tasks: [{ id: "T001", status: "red" }, { id: "T002", status: "integrated" }] });

    const r = await pedir(svc, "/v1/board");
    assert.equal(r.status, 200, await r.clone().text());
    const board = await r.json();

    assert.deepEqual(Object.keys(board).sort(), ["avisos", "columnas", "proyectos", "resumen", "tarjetas"]);
    const ids = board.tarjetas.map((/** @type {any} */ x) => x.id);
    assert.equal(new Set(ids).size, ids.length, "una tarjeta repetida en el board");
    assert.ok(ids.includes(`${a.id}:10`) && ids.includes(`${b.id}:10`), "el ticket de dos proyectos aparece una vez por proyecto");
    assert.ok(!ids.some((/** @type {string} */ id) => id.startsWith(`${c.id}:`)), "un proyecto no ACTIVE no pone tarjetas");

    const conRun = board.tarjetas.find((/** @type {any} */ x) => x.id === `${a.id}:2`);
    assert.equal(conRun.columna, "in_progress");
    assert.deepEqual(conRun.avance, { hechas: 1, total: 2, fase: "Implementar" });
    assert.equal(board.tarjetas.find((/** @type {any} */ x) => x.id === `${b.id}:2`).columna, "todo");
    assert.equal(board.tarjetas.find((/** @type {any} */ x) => x.id === `${a.id}:11`).columna, "in_progress");
    assert.equal(board.tarjetas.find((/** @type {any} */ x) => x.id === `${a.id}:10`).ticket.prioridad, 2);

    const lista = board.proyectos.map((/** @type {any} */ x) => [x.nombre, x.estado, x.gestor, x.listItems]);
    assert.deepEqual(
      lista.sort(),
      [["A Medias", "BOOTSTRAPPED", "fake", null], ["Alfa", "ACTIVE", "fake", true], ["Beta", "ACTIVE", "fake", true]],
    );

    const soloB = await (await pedir(svc, `/v1/board?project=${b.id}`)).json();
    assert.ok(soloB.tarjetas.length > 0);
    assert.ok(soloB.tarjetas.every((/** @type {any} */ x) => x.proyecto.id === b.id));

    const noExiste = await pedir(svc, "/v1/board?project=no-existe");
    assert.equal(noExiste.status, 404);
  });
});

test("SC-007 — EL INVARIANTE: construir el board no cambia nada en el disco (home ni repositorio)", async (t) => {
  sembrar();
  t.after(() => fake.reset());
  await conServicio({ motor: { intervaloMs: 0 } }, async (svc) => {
    const org = repoConRemoto();
    const a = await proyectoActivo(svc, { ruta: org.repo });
    runEnDisco(svc.home, "2", { projectId: a.id });

    const antesHome = huellaDelArbol(svc.home);
    const antesRepo = huellaDelArbol(org.repo);
    const r = await pedir(svc, "/v1/board");
    assert.equal(r.status, 200);
    assert.ok((await r.json()).tarjetas.length > 0, "el test no vale si el board no leyo nada");
    await pedir(svc, `/v1/board?project=${a.id}&includeDone=1`);

    assert.deepEqual(diferencias(antesHome, huellaDelArbol(svc.home)), [], "el board escribio en el home");
    assert.deepEqual(diferencias(antesRepo, huellaDelArbol(org.repo)), [], "el board escribio en el repositorio del operador");
  });
});

test("gestor sin `listItems`: Backlog y Todo dicen que falta y muestran lo que el motor conoce", async (t) => {
  sembrar();
  fake.db.inbox = { assigned: ["10"], mentioned: [] };
  t.after(() => fake.reset());
  // El mismo falso, declarando la capacidad en false: es la degradacion que
  // un proveedor sin la capacidad tiene que producir.
  const sinListar = {
    ...fake,
    capabilities: () => ({ ...fake.capabilities(), listItems: false }),
    listItems: undefined,
  };
  await conServicio({ motor: { intervaloMs: 0, cargarGestor: async () => sinListar } }, async (svc) => {
    const a = await proyectoActivo(svc);
    runEnDisco(svc.home, "3", { projectId: a.id });
    const board = await (await pedir(svc, "/v1/board")).json();

    const [backlog, todo] = board.columnas;
    assert.match(String(backlog.nota), /fake/, "la nota tiene que nombrar el proveedor");
    assert.match(String(backlog.nota), /listItems/, "y la capacidad que le falta");
    assert.match(String(todo.nota), /listItems/);
    const ids = board.tarjetas.map((/** @type {any} */ x) => x.ticket.id).sort();
    assert.deepEqual(ids, ["10", "3"], "lo asignado en la bandeja del gestor y lo que ya tiene run");
    assert.equal(board.proyectos[0].listItems, false);
  });
});

test("gestor caido: el board contesta 200, con la causa y la accion, y las tarjetas de los runs siguen", async (t) => {
  const caido = {
    ...fake,
    listItems: async () => {
      throw new Error("401 Unauthorized: el token del gestor expiro");
    },
  };
  await conServicio({ motor: { intervaloMs: 0, cargarGestor: async () => caido } }, async (svc) => {
    const a = await proyectoActivo(svc);
    runEnDisco(svc.home, "3", { projectId: a.id, tasks: [{ id: "T001", status: "green" }] });
    const r = await pedir(svc, "/v1/board");
    assert.equal(r.status, 200, "un gestor caido no puede tumbar el board");
    const board = await r.json();
    const aviso = board.avisos.find((/** @type {any} */ x) => x.proyecto === a.id);
    assert.ok(aviso, JSON.stringify(board.avisos));
    assert.equal(aviso.nivel, "error");
    assert.match(aviso.causa, /401 Unauthorized/, "la causa textual del fallo, no «error del gestor»");
    assert.ok(aviso.accion.length > 20);
    assert.ok(board.tarjetas.some((/** @type {any} */ x) => x.ticket.id === "3"), "la tarjeta del run desaparecio");
    assert.ok(board.columnas[1].nota, "la columna que depende del gestor tiene que decir que esta incompleta");
  });
});

test("la cache: el gestor se consulta una vez cada 30 s por proyecto, no en cada pintada", async (t) => {
  sembrar();
  t.after(() => fake.reset());
  let llamadas = 0;
  let ahora = 1_000_000;
  const contado = {
    ...fake,
    listItems: async (q, ctx) => {
      llamadas++;
      return fake.listItems(q, ctx);
    },
  };
  await conServicio({ motor: { intervaloMs: 0, cargarGestor: async () => contado, reloj: () => ahora } }, async (svc) => {
    await proyectoActivo(svc);
    await pedir(svc, "/v1/board");
    await pedir(svc, "/v1/board");
    assert.equal(llamadas, 1, "dos pintadas seguidas consultaron el gestor dos veces");
    ahora += 31_000;
    await pedir(svc, "/v1/board");
    assert.equal(llamadas, 2, "pasados 30 s la cache no se renovo");
  });
});

test("muchos tickets: el board muestra los primeros y DICE cuantos mas hay", async (t) => {
  const muchos = {
    ...fake,
    listItems: async () => ({
      items: [ticket("1", "todo"), ticket("2", "backlog")],
      nextCursor: "2",
      total: 250,
    }),
  };
  await conServicio({ motor: { intervaloMs: 0, cargarGestor: async () => muchos } }, async (svc) => {
    await proyectoActivo(svc);
    const board = await (await pedir(svc, "/v1/board")).json();
    assert.match(String(board.columnas[0].nota), /248/, "se cortaron tickets en silencio");
  });
});
