// Las rutas del motor que usa el board: lanzar, aprobar, reintentar, la lista
// de runs y los costos (contrato §2 de specs/003-board-de-control).
//
// POR QUE EL SPAWN VA INYECTADO AQUI TAMBIEN. Lo que estas pruebas afirman es
// la RUTA: que codigo contesta, que cuerpo, que valida antes de lanzar, que
// evento emite. Que el motor de verdad corra por este camino lo afirma
// `lanzar-motor-real.test.mjs`, que paga los procesos.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { conServicio, diferencias, eventos, huellaDelArbol, leerFrames, pedir } from "./ayuda.mjs";
import { proyectoActivo, repoConRemoto, runEnDisco } from "./ayuda-motor.mjs";

function spawnFalso() {
  /** @type {any[]} */
  const llamadas = [];
  const spawn = (comando, args, opciones) => {
    const hijo = /** @type {any} */ (new EventEmitter());
    hijo.stdout = new PassThrough();
    hijo.stderr = new PassThrough();
    hijo.kill = () => {
      setImmediate(() => hijo.emit("close", null, "SIGTERM"));
      return true;
    };
    llamadas.push({
      comando,
      args,
      opciones,
      terminar: (code, salida = { ok: true }) => {
        hijo.stdout.end(JSON.stringify(salida));
        hijo.stderr.end();
        setImmediate(() => hijo.emit("close", code, null));
      },
    });
    return hijo;
  };
  return { spawn, llamadas };
}

const post = (svc, ruta, cuerpo) =>
  pedir(svc, ruta, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
  });

async function hasta(cond, que, ms = 3000) {
  const fin = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > fin) assert.fail(`no paso a tiempo: ${que}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

test("POST /runs sobre un proyecto ACTIVE lanza el motor: 202 con el run, y el segundo clic devuelve el mismo con 200", async () => {
  const falso = spawnFalso();
  await conServicio({ motor: { spawn: falso.spawn, intervaloMs: 0 } }, async (svc) => {
    const proyecto = await proyectoActivo(svc, { autonomia: "L2" });

    const r = await post(svc, `/v1/projects/${proyecto.id}/runs`, { itemId: "2" });
    assert.equal(r.status, 202, await r.clone().text());
    assert.deepEqual((await r.json()).run, { itemId: "2", estado: "planificando", posicion: null });

    await hasta(() => falso.llamadas.length === 1, "el subproceso");
    const [bin, paso, item, , ruta, flag, projectId] = falso.llamadas[0].args;
    assert.match(bin, /engine\/bin\/noxloop\.mjs$/);
    assert.deepEqual([paso, item, flag, projectId], ["plan", "2", "--project", proyecto.id]);
    assert.equal(ruta, `${svc.home}/motor/${proyecto.id}.config.json`);

    const otra = await post(svc, `/v1/projects/${proyecto.id}/runs`, { itemId: "2" });
    assert.equal(otra.status, 200, "FR-016: el segundo Run sobre el mismo ticket no lanza otro");
    assert.equal((await otra.json()).run.itemId, "2");
    assert.equal(falso.llamadas.length, 1);
  });
});

test("POST /runs valida ANTES de lanzar: sin `itemId` 400, sin repo 409 `sin_repo`, sin gate 409 `sin_gate`", async () => {
  const falso = spawnFalso();
  await conServicio({ motor: { spawn: falso.spawn, intervaloMs: 0 } }, async (svc) => {
    const bueno = await proyectoActivo(svc, { nombre: "Bueno" });
    const sinItem = await post(svc, `/v1/projects/${bueno.id}/runs`, {});
    assert.equal(sinItem.status, 400);
    assert.equal((await sinItem.json()).error.codigo, "cuerpo_invalido");

    const sinRepo = await proyectoActivo(svc, { nombre: "Sin Repo", ruta: repoConRemoto({ remoto: null }).repo });
    const r1 = await post(svc, `/v1/projects/${sinRepo.id}/runs`, { itemId: "2" });
    assert.equal(r1.status, 409);
    assert.equal((await r1.json()).error.codigo, "sin_repo");

    const sinGate = await proyectoActivo(svc, { nombre: "Sin Gate", runner: null });
    const r2 = await post(svc, `/v1/projects/${sinGate.id}/runs`, { itemId: "2" });
    assert.equal(r2.status, 409);
    assert.equal((await r2.json()).error.codigo, "sin_gate");

    assert.equal(falso.llamadas.length, 0, "se lanzo un motor que no podia correr");
  });
});

test("L1: Run para en `plan_listo`; approve lanza `run`; approve fuera de `plan_listo` es 409", async () => {
  const falso = spawnFalso();
  await conServicio({ motor: { spawn: falso.spawn, intervaloMs: 0 } }, async (svc) => {
    const proyecto = await proyectoActivo(svc, { autonomia: "L1" });
    await post(svc, `/v1/projects/${proyecto.id}/runs`, { itemId: "2" });
    await hasta(() => falso.llamadas.length === 1, "el plan");

    const antes = await post(svc, "/v1/runs/2/approve");
    assert.equal(antes.status, 409, "aprobar un plan que todavia no existe");
    const error = (await antes.json()).error;
    assert.equal(error.codigo, "run_sin_esa_accion");
    assert.match(error.causa, /planificando/);

    falso.llamadas[0].terminar(0, { ok: true, tasks: 1 });
    await hasta(async () => {
      const l = await (await pedir(svc, `/v1/runs?project=${proyecto.id}`)).json();
      return l.items.some((/** @type {any} */ r) => r.itemId === "2" && r.estado === "plan_listo");
    }, "plan_listo en /v1/runs");

    const ok = await post(svc, "/v1/runs/2/approve");
    assert.equal(ok.status, 202, await ok.clone().text());
    await hasta(() => falso.llamadas.length === 2, "el run tras aprobar");
    assert.deepEqual(falso.llamadas[1].args.slice(1, 3), ["run", "2"]);
  });
});

test("retry retoma desde el disco con `resume`; sobre un run con PR es 409", async () => {
  const falso = spawnFalso();
  await conServicio({ motor: { spawn: falso.spawn, intervaloMs: 0 } }, async (svc) => {
    const proyecto = await proyectoActivo(svc);
    runEnDisco(svc.home, "7", {
      projectId: proyecto.id,
      tasks: [{ id: "T001", status: "blocked", lastFailure: "el gate dio rojo tres veces" }],
    });
    const r = await post(svc, "/v1/runs/7/retry");
    assert.equal(r.status, 202, await r.clone().text());
    await hasta(() => falso.llamadas.length === 1, "el resume");
    assert.deepEqual(falso.llamadas[0].args.slice(1, 3), ["resume", "7"]);

    runEnDisco(svc.home, "8", { projectId: proyecto.id, item: { id: "8", title: "t", pr: "https://forge.test/pr/8" } });
    const conPr = await post(svc, "/v1/runs/8/retry");
    assert.equal(conPr.status, 409);
    assert.equal((await conPr.json()).error.codigo, "run_sin_esa_accion");

    const nada = await post(svc, "/v1/runs/no-existe/retry");
    assert.equal(nada.status, 404);
  });
});

test("GET /v1/runs lista los de todos los proyectos, filtra por proyecto y estado, y no escribe en disco", async () => {
  await conServicio({ motor: { spawn: spawnFalso().spawn, intervaloMs: 0 } }, async (svc) => {
    const a = await proyectoActivo(svc, { nombre: "A" });
    const b = await proyectoActivo(svc, { nombre: "B" });
    runEnDisco(svc.home, "1", {
      projectId: a.id,
      tasks: [
        { id: "T001", status: "integrated" },
        { id: "T002", status: "red" },
      ],
      spent: { usd: 1.5, calls: 3 },
    });
    runEnDisco(svc.home, "2", { projectId: b.id, item: { id: "2", title: "otro", pr: "https://forge.test/pr/2" } });
    runEnDisco(svc.home, "3", { projectId: null });

    const antes = huellaDelArbol(svc.home);
    const todos = await (await pedir(svc, "/v1/runs")).json();
    assert.deepEqual(todos.items.map((/** @type {any} */ r) => r.itemId).sort(), ["1", "2", "3"]);
    const uno = todos.items.find((/** @type {any} */ r) => r.itemId === "1");
    assert.deepEqual(uno.proyecto, { id: a.id, nombre: "A", color: null });
    assert.deepEqual(uno.avance, { hechas: 1, total: 2, fase: "Implementar" });
    assert.deepEqual(uno.gasto, { usd: 1.5, calls: 3, medido: true });
    assert.equal(uno.estado, "interrumpido", "a medias y sin motor corriendo");
    assert.equal(todos.items.find((/** @type {any} */ r) => r.itemId === "3").proyecto, null);

    const deB = await (await pedir(svc, `/v1/runs?project=${b.id}`)).json();
    assert.deepEqual(deB.items.map((/** @type {any} */ r) => r.itemId), ["2"]);
    assert.equal(deB.items[0].pr, "https://forge.test/pr/2");

    const conPr = await (await pedir(svc, "/v1/runs?estado=pr_abierto")).json();
    assert.deepEqual(conPr.items.map((/** @type {any} */ r) => r.itemId), ["2"]);

    const malo = await pedir(svc, "/v1/runs?estado=cualquiera");
    assert.equal(malo.status, 400);

    assert.deepEqual(diferencias(antes, huellaDelArbol(svc.home)), [], "listar runs escribio en el home");
  });
});

test("GET /v1/usage suma por proyecto y por run, y distingue «sin medir» de cero", async () => {
  await conServicio({ motor: { spawn: spawnFalso().spawn, intervaloMs: 0 } }, async (svc) => {
    const a = await proyectoActivo(svc, { nombre: "A" });
    const b = await proyectoActivo(svc, { nombre: "B" });
    runEnDisco(svc.home, "1", { projectId: a.id, spent: { usd: 2, calls: 10 }, updatedAt: "2026-09-10T00:00:00.000Z" });
    runEnDisco(svc.home, "2", { projectId: a.id, spent: { usd: 0.5, calls: 4 }, updatedAt: "2026-09-11T00:00:00.000Z" });
    // Un runtime que no mide: invocaciones, y cero dolares. No fue gratis.
    runEnDisco(svc.home, "3", { projectId: b.id, spent: { usd: 0, calls: 6 }, updatedAt: "2026-09-12T00:00:00.000Z" });
    runEnDisco(svc.home, "4", { projectId: b.id, spent: { usd: 9, calls: 1 }, updatedAt: "2025-01-01T00:00:00.000Z" });

    const r = await pedir(svc, "/v1/usage?desde=2026-09-01T00:00:00Z&hasta=2026-09-30T00:00:00Z");
    assert.equal(r.status, 200, await r.clone().text());
    const uso = await r.json();
    assert.deepEqual(uso.total, { usd: 2.5, calls: 20, sinMedir: 1 });
    const porA = uso.porProyecto.find((/** @type {any} */ x) => x.proyecto?.id === a.id);
    assert.deepEqual([porA.usd, porA.calls, porA.sinMedir], [2.5, 14, 0]);
    const porB = uso.porProyecto.find((/** @type {any} */ x) => x.proyecto?.id === b.id);
    assert.deepEqual([porB.usd, porB.calls, porB.sinMedir], [0, 6, 1]);
    assert.deepEqual(uso.runs.map((/** @type {any} */ x) => x.itemId), ["1", "2", "3"], "los mas caros primero");
    assert.equal(uso.runs.find((/** @type {any} */ x) => x.itemId === "3").medido, false);

    const malo = await pedir(svc, "/v1/usage?desde=ayer");
    assert.equal(malo.status, 400);
  });
});

test("SSE: lanzar emite `run.cambio` y `board.invalidado`", async () => {
  const falso = spawnFalso();
  await conServicio({ motor: { spawn: falso.spawn, intervaloMs: 0 } }, async (svc) => {
    const proyecto = await proyectoActivo(svc);
    const canal = await pedir(svc, "/v1/events");
    const pendientes = leerFrames(
      canal,
      (f) => eventos(f).some((e) => e.tipo === "board.invalidado"),
      3000,
    );
    await post(svc, `/v1/projects/${proyecto.id}/runs`, { itemId: "2" });
    const frames = eventos(await pendientes);
    const cambio = frames.find((e) => e.tipo === "run.cambio");
    assert.ok(cambio, `no llego \`run.cambio\`: ${JSON.stringify(frames)}`);
    assert.deepEqual(cambio.datos.datos, { projectId: proyecto.id, itemId: "2", estado: "planificando" });
    assert.equal(cambio.datos.project_id, proyecto.id);
  });
});
