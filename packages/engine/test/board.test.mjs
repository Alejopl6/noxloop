// El read-model del board de control.
//
// POR QUE ES UN LECTOR PURO. El motor ya tiene un unico escritor del estado
// (state.mjs) con transiciones guardadas. Un board que pudiera escribir seria
// un segundo escritor, y la carrera que se cerro con `conEstadoFresco` volveria
// por la puerta de atras. Hay un test aca abajo que lo verifica midiendo el
// disco antes y despues: si algun dia alguien agrega una escritura, revienta.
//
// POR QUE NUNCA LANZA. Un board es lo que una persona mira cuando algo ya se
// rompio. Si un archivo corrupto lo tumba, se pierde justo cuando hace falta.
// Todo fallo de lectura se degrada a un AVISO visible en el board.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { construirBoard } from "../src/board.mjs";

function homeVacio() {
  return mkdtempSync(join(tmpdir(), "noxloop-board-"));
}

function escribirRun(home, run) {
  mkdirSync(join(home, "runs"), { recursive: true });
  writeFileSync(join(home, "runs", `run-${run.item.id}.json`), JSON.stringify(run));
}

function tarea(id, status, extra = {}) {
  return { id, title: `tarea ${id}`, repo: "repo-a", status, attempts: { red: 0, green: 0, gate: 0, review: 0 }, dependsOn: [], lastFailure: null, ...extra };
}

function run(id, tareas, item = {}) {
  return {
    schemaVersion: 1,
    milestoneId: null,
    createdAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T01:00:00.000Z",
    item: { id, title: `ticket ${id}`, provider: "github", url: `https://x/${id}`, branch: null, pr: null, ...item },
    tasks: tareas,
    spent: { usd: 0.5, calls: 12 },
  };
}

test("un home vacio da un board vacio, no un error", () => {
  const b = construirBoard({ home: homeVacio() });
  assert.deepEqual(b.tarjetas, []);
  assert.deepEqual(b.avisos, []);
  assert.deepEqual(b.necesitanRespuesta, []);
  assert.ok(Array.isArray(b.columnas), "las columnas existen incluso sin trabajo");
});

test("un home que no existe tampoco lanza", () => {
  const b = construirBoard({ home: join(homeVacio(), "no", "existe") });
  assert.deepEqual(b.tarjetas, []);
});

test("un recorrido se vuelve una tarjeta con su conteo de tareas por estado", () => {
  const home = homeVacio();
  escribirRun(home, run("T-1", [tarea("t1", "integrated"), tarea("t2", "green"), tarea("t3", "pending")]));

  const b = construirBoard({ home });
  assert.equal(b.tarjetas.length, 1);
  const c = b.tarjetas[0];
  assert.equal(c.itemId, "T-1");
  assert.equal(c.titulo, "ticket T-1");
  assert.equal(c.provider, "github");
  assert.equal(c.tareas.total, 3);
  assert.equal(c.tareas.porEstado.integrated, 1);
  assert.equal(c.tareas.porEstado.green, 1);
  assert.equal(c.tareas.porEstado.pending, 1);
  assert.equal(c.gasto.usd, 0.5);
  assert.equal(c.gasto.calls, 12);
});

test("el avance se mide sobre las tareas integradas, no sobre las que se creen listas", () => {
  const home = homeVacio();
  escribirRun(home, run("T-2", [tarea("t1", "integrated"), tarea("t2", "reviewed"), tarea("t3", "reviewed"), tarea("t4", "pending")]));

  const c = construirBoard({ home }).tarjetas[0];
  assert.equal(c.avance, 25, "1 de 4 integradas es 25% — 'reviewed' no cuenta como hecho");
});

test("una tarea bloqueada viaja con su causa real", () => {
  const home = homeVacio();
  escribirRun(home, run("T-3", [
    tarea("t1", "blocked", { lastFailure: { loop: "gate", message: "el gate del repo fallo 3 veces" } }),
    tarea("t2", "pending"),
  ]));

  const c = construirBoard({ home }).tarjetas[0];
  assert.equal(c.tareas.bloqueadas.length, 1);
  assert.equal(c.tareas.bloqueadas[0].id, "t1");
  assert.match(c.tareas.bloqueadas[0].motivo, /gate del repo fallo/);
});

test("un item que espera respuesta aparece en necesitanRespuesta con la pregunta", () => {
  const home = homeVacio();
  escribirRun(home, run("T-4", [tarea("t1", "pending")], {
    esperandoRespuesta: true,
    pregunta: "el ticket no dice si el borrado es logico o fisico",
  }));

  const b = construirBoard({ home });
  assert.equal(b.necesitanRespuesta.length, 1);
  assert.equal(b.necesitanRespuesta[0].itemId, "T-4");
  assert.match(b.necesitanRespuesta[0].pregunta, /logico o fisico/);
  assert.equal(b.tarjetas[0].esperandoRespuesta, true);
});

test("esperar respuesta SIN pregunta sigue siendo visible: callarlo seria peor", () => {
  const home = homeVacio();
  escribirRun(home, run("T-5", [tarea("t1", "pending")], { esperandoRespuesta: true }));

  const b = construirBoard({ home });
  assert.equal(b.necesitanRespuesta.length, 1);
  assert.ok(b.necesitanRespuesta[0].pregunta, "sin texto se explica que no se registro la pregunta");
});

test("una tarea activa se marca en su tarjeta", () => {
  const home = homeVacio();
  escribirRun(home, run("T-6", [tarea("t1", "in_progress"), tarea("t2", "pending")]));
  mkdirSync(join(home, "active-tasks"), { recursive: true });
  writeFileSync(join(home, "active-tasks", "wt-a.json"), JSON.stringify({
    itemId: "T-6", taskId: "t1", worktree: "/tmp/wt-a", since: "2026-09-17T00:30:00.000Z",
  }));

  const c = construirBoard({ home }).tarjetas[0];
  assert.deepEqual(c.tareas.activas.map((a) => a.taskId), ["t1"]);
  assert.equal(c.tareas.activas[0].worktree, "/tmp/wt-a");
});

test("una tarea activa huerfana es un aviso, no una tarjeta fantasma", () => {
  const home = homeVacio();
  mkdirSync(join(home, "active-tasks"), { recursive: true });
  writeFileSync(join(home, "active-tasks", "wt-z.json"), JSON.stringify({ itemId: "T-NO-EXISTE", taskId: "t1" }));

  const b = construirBoard({ home });
  assert.deepEqual(b.tarjetas, []);
  assert.equal(b.avisos.length, 1);
  assert.match(b.avisos[0].mensaje, /T-NO-EXISTE/);
});

test("un recorrido corrupto es un aviso y no tumba el board", () => {
  const home = homeVacio();
  mkdirSync(join(home, "runs"), { recursive: true });
  writeFileSync(join(home, "runs", "run-T-7.json"), "{ esto no es json");
  escribirRun(home, run("T-8", [tarea("t1", "pending")]));

  const b = construirBoard({ home });
  assert.equal(b.tarjetas.length, 1, "el recorrido sano se sigue viendo");
  assert.equal(b.tarjetas[0].itemId, "T-8");
  assert.ok(b.avisos.some((a) => /T-7/.test(a.mensaje)), "y el corrupto se nombra");
});

test("un lock mas viejo que el umbral se avisa como posible huerfano", () => {
  const home = homeVacio();
  mkdirSync(join(home, "locks"), { recursive: true });
  writeFileSync(join(home, "locks", "integracion.json"), JSON.stringify({
    host: "otra-maquina", pid: 999, since: "2020-01-01T00:00:00.000Z",
  }));

  const b = construirBoard({ home, ahora: new Date("2026-09-17T00:00:00.000Z"), maxEdadLockMs: 60_000 });
  assert.ok(b.avisos.some((a) => /integracion/.test(a.mensaje)));
});

test("las columnas cubren todos los estados de item, tambien los vacios", () => {
  const home = homeVacio();
  escribirRun(home, run("T-9", [tarea("t1", "pending")]));

  const b = construirBoard({ home });
  const ids = b.columnas.map((c) => c.id);
  for (const esperado of ["pending", "running", "pr_open", "integrated", "blocked"]) {
    assert.ok(ids.includes(esperado), `falta la columna ${esperado}`);
  }
  assert.equal(b.columnas.reduce((n, c) => n + c.tarjetas.length, 0), 1, "cada tarjeta esta en exactamente una columna");
});

test("una tarjeta con PR abierto cae en pr_open y trae la URL", () => {
  const home = homeVacio();
  escribirRun(home, run("T-10", [tarea("t1", "integrated")], { pr: "https://github.com/o/r/pull/9", branch: "nox/T-10" }));

  const b = construirBoard({ home });
  const col = b.columnas.find((c) => c.id === "pr_open");
  assert.equal(col.tarjetas.length, 1);
  assert.equal(col.tarjetas[0].pr, "https://github.com/o/r/pull/9");
  assert.equal(col.tarjetas[0].rama, "nox/T-10");
});

test("un item con toda tarea bloqueada cae en blocked, no en running", () => {
  const home = homeVacio();
  escribirRun(home, run("T-11", [tarea("t1", "blocked", { lastFailure: { message: "x" } })]));

  const b = construirBoard({ home });
  assert.equal(b.columnas.find((c) => c.id === "blocked").tarjetas.length, 1);
});

test("EL INVARIANTE: construir el board no escribe una sola cosa en disco", () => {
  const home = homeVacio();
  escribirRun(home, run("T-12", [tarea("t1", "pending")]));
  mkdirSync(join(home, "active-tasks"), { recursive: true });
  writeFileSync(join(home, "active-tasks", "wt.json"), JSON.stringify({ itemId: "T-12", taskId: "t1" }));

  const huella = () => readdirSync(home, { recursive: true }).sort().map((f) => {
    const p = join(home, String(f));
    const s = statSync(p);
    return `${f}:${s.isDirectory() ? "d" : s.size}:${s.mtimeMs}`;
  }).join("|");

  const antes = huella();
  construirBoard({ home });
  construirBoard({ home });
  assert.equal(huella(), antes, "el board leyo y ademas escribio: eso lo vuelve un segundo escritor del estado");
});

// ---------------------------------------------------------------- la bandeja
//
// Un ticket que el motor RECHAZO es trabajo pendiente igual, y hoy su motivo
// solo se ve en la terminal de quien corrio el comando. En el board tiene que
// estar, porque el rechazo permanente es precisamente el que necesita a una
// persona.

function escribirMemoria(home, items) {
  mkdirSync(join(home, "inbox"), { recursive: true });
  writeFileSync(join(home, "inbox", "omitidos.json"), JSON.stringify({ schemaVersion: 1, items }));
}

test("un rechazo permanente pide respuesta: reintentarlo llega al mismo lugar", () => {
  const home = homeVacio();
  escribirMemoria(home, {
    "T-20": { motivo: "el ticket no tiene criterios de aceptacion verificables — ¿cual es el criterio observable?", clase: "permanente", desde: "2026-09-16T00:00:00.000Z", ultimaVez: "2026-09-17T00:00:00.000Z" },
  });

  const b = construirBoard({ home });
  assert.equal(b.necesitanRespuesta.length, 1);
  assert.equal(b.necesitanRespuesta[0].itemId, "T-20");
  assert.match(b.necesitanRespuesta[0].pregunta, /criterio observable/);
  assert.equal(b.necesitanRespuesta[0].origen, "bandeja");
});

test("un rechazo transitorio NO pide respuesta: el motor lo reintenta solo", () => {
  const home = homeVacio();
  escribirMemoria(home, {
    "T-21": { motivo: "el gestor devolvio 503", clase: "transitorio", ultimaVez: "2026-09-17T00:00:00.000Z" },
  });

  const b = construirBoard({ home });
  assert.deepEqual(b.necesitanRespuesta, []);
  assert.equal(b.omitidos.length, 1, "pero se sigue viendo que fue omitido");
  assert.equal(b.omitidos[0].clase, "transitorio");
});

test("un omitido que ya tiene recorrido no se cuenta dos veces", () => {
  const home = homeVacio();
  escribirRun(home, run("T-22", [tarea("t1", "pending")]));
  escribirMemoria(home, { "T-22": { motivo: "viejo", clase: "permanente", ultimaVez: "2026-01-01T00:00:00.000Z" } });

  const b = construirBoard({ home });
  assert.equal(b.tarjetas.length, 1);
  assert.deepEqual(b.necesitanRespuesta, [], "el recorrido ya existe: el motivo viejo no describe la realidad");
});

test("una memoria ilegible no tumba el board", () => {
  const home = homeVacio();
  mkdirSync(join(home, "inbox"), { recursive: true });
  writeFileSync(join(home, "inbox", "omitidos.json"), "{{{");
  const b = construirBoard({ home });
  assert.deepEqual(b.tarjetas, []);
  assert.ok(b.avisos.some((a) => /bandeja|omitidos/i.test(a.mensaje)));
});

test("un item del hito que espera respuesta llega al board sin tener recorrido", () => {
  const home = homeVacio();
  mkdirSync(join(home, "milestones"), { recursive: true });
  writeFileSync(join(home, "milestones", "milestone-F-1.json"), JSON.stringify({
    item: { id: "F-1", title: "feature", provider: "azure-devops" },
    items: [
      { id: "S-1", title: "historia uno", status: "blocked", reason: "¿el borrado es logico o fisico?", esperandoRespuesta: true },
      { id: "S-2", title: "historia dos", status: "pending" },
    ],
  }));

  const b = construirBoard({ home });
  assert.equal(b.tarjetas.length, 2);
  assert.equal(b.necesitanRespuesta.length, 1);
  assert.equal(b.necesitanRespuesta[0].itemId, "S-1");
  assert.match(b.necesitanRespuesta[0].pregunta, /logico o fisico/);
  assert.equal(b.tarjetas.find((t) => t.itemId === "S-2").hitoId, "F-1");
});

// ------------------------------------------------- lo que el board DERIVA
//
// Un recorrido que agoto su presupuesto sin integrar nada necesita una persona,
// y el motor no escribe ningun campo que lo diga. El board lo deriva de las
// tareas — que es su trabajo. La alternativa era agregar un campo al estado y
// esperar que alguien lo escriba: exactamente el cable cortado que este
// proyecto ya se encontro una vez (un `findings` que nadie producia).

test("un recorrido sin nada integrado y sin nada por intentar pide una persona", () => {
  const home = homeVacio();
  escribirRun(home, run("T-30", [
    tarea("t1", "blocked", { lastFailure: { loop: "gate", message: "el gate fallo 3 veces: tipos" } }),
    tarea("t2", "blocked", { lastFailure: { loop: "red", message: "no se pudo ver fallar el test" } }),
  ]));

  const b = construirBoard({ home });
  assert.equal(b.necesitanRespuesta.length, 1);
  const n = b.necesitanRespuesta[0];
  assert.equal(n.itemId, "T-30");
  assert.equal(n.origen, "derivado");
  assert.match(n.pregunta, /gate fallo 3 veces: tipos/, "la causa real viaja, no un resumen");
  assert.match(n.pregunta, /no se pudo ver fallar el test/, "las dos causas, no solo la primera");
});

test("con algo integrado NO pide una persona: hay trabajo que sirve y sigue el curso normal", () => {
  const home = homeVacio();
  escribirRun(home, run("T-31", [
    tarea("t1", "integrated"),
    tarea("t2", "blocked", { lastFailure: { message: "x" } }),
  ]));

  assert.deepEqual(construirBoard({ home }).necesitanRespuesta, []);
});

test("con una tarea todavia por intentar NO pide una persona: no agoto nada", () => {
  const home = homeVacio();
  escribirRun(home, run("T-32", [
    tarea("t1", "blocked", { lastFailure: { message: "x" } }),
    tarea("t2", "pending"),
  ]));

  assert.deepEqual(construirBoard({ home }).necesitanRespuesta, []);
});

test("un recorrido con PR abierto no pide una persona aunque le quedaran tareas bloqueadas", () => {
  const home = homeVacio();
  escribirRun(home, run("T-33", [tarea("t1", "blocked", { lastFailure: { message: "x" } })], { pr: "https://x/1" }));

  assert.deepEqual(construirBoard({ home }).necesitanRespuesta, [], "el PR ya esta en manos de alguien");
});

test("no se pide dos veces la misma respuesta por el mismo item", () => {
  const home = homeVacio();
  escribirRun(home, run("T-34", [tarea("t1", "blocked", { lastFailure: { message: "x" } })], {
    esperandoRespuesta: true, pregunta: "una pregunta explicita",
  }));

  const b = construirBoard({ home });
  assert.equal(b.necesitanRespuesta.length, 1, "el campo explicito gana sobre la derivacion");
  assert.match(b.necesitanRespuesta[0].pregunta, /una pregunta explicita/);
});
