// El orden a mano del board y la cola global (spec 005, US2, FR-005..006).
//
// LO QUE SE PRUEBA AQUI, Y POR QUE ASI:
//
//   1. `ordenarTarjetas` es PURA: tarjetas y ordenes entran, tarjetas ordenadas
//      salen. Ahi se prueba la regla (lo ordenado primero, lo demas despues en
//      el orden del gestor, lo que desaparecio se olvida) sin servicio.
//   2. La ruta del orden, con el servicio de verdad: el orden sobrevive a
//      REINICIAR el servicio (mismo home, proceso nuevo) y reordenar no le
//      pregunta NADA al gestor — se cuenta cada llamada al proveedor.
//   3. La cola global por HTTP, con el spawn inyectado: el limite sale de
//      Settings, `GET /v1/queue` dice quien corre y quien espera, y
//      `PUT /v1/queue` reordena lo que espera.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { ordenarTarjetas } from "../src/orden.mjs";
import * as fake from "../../../providers/fake/index.mjs";
import { conServicio, homeTemporal, pedir } from "./ayuda.mjs";
import { proyectoActivo } from "./ayuda-motor.mjs";

// ---------------------------------------------------------------------------
// 1. La regla, pura
// ---------------------------------------------------------------------------

/** @param {string} proyecto @param {string} id @param {string} columna */
const t = (proyecto, id, columna) => ({ id: `${proyecto}:${id}`, proyecto: { id: proyecto }, ticket: { id }, columna });

test("ordenar: lo ordenado a mano va primero por su posicion; lo demas despues, en el orden del gestor", () => {
  const tarjetas = [t("p", "1", "todo"), t("p", "2", "todo"), t("p", "3", "todo"), t("p", "4", "todo")];
  const salida = ordenarTarjetas(tarjetas, new Map([["p", { todo: ["3", "1"] }]]));
  assert.deepEqual(
    salida.filter((x) => x.columna === "todo").map((x) => x.ticket.id),
    ["3", "1", "2", "4"],
  );
});

test("ordenar: una posicion solo vale en SU columna, y un id que ya no esta se olvida sin error", () => {
  const tarjetas = [t("p", "1", "todo"), t("p", "2", "todo"), t("p", "9", "in_review")];
  // `9` se ordeno cuando estaba en Todo; ahora esta en revision. `fantasma`
  // desaparecio del gestor.
  const salida = ordenarTarjetas(tarjetas, new Map([["p", { todo: ["fantasma", "2", "9", "1"] }]]));
  assert.deepEqual(salida.filter((x) => x.columna === "todo").map((x) => x.ticket.id), ["2", "1"]);
  assert.deepEqual(salida.filter((x) => x.columna === "in_review").map((x) => x.ticket.id), ["9"]);
});

test("ordenar: el orden es por proyecto; sin orden guardado no se toca nada", () => {
  const tarjetas = [t("a", "1", "todo"), t("b", "1", "todo"), t("a", "2", "todo")];
  const salida = ordenarTarjetas(tarjetas, new Map([["a", { todo: ["2"] }]]));
  assert.deepEqual(salida.map((x) => x.id), ["a:2", "a:1", "b:1"]);
  assert.deepEqual(ordenarTarjetas(tarjetas, new Map()).map((x) => x.id), tarjetas.map((x) => x.id));
});

// ---------------------------------------------------------------------------
// 2. La ruta del orden
// ---------------------------------------------------------------------------

function sembrar() {
  fake.reset();
  for (const id of ["10", "11", "12"]) {
    fake.db.items[id] = { type: "Historia", title: `ticket ${id}`, state: "Nuevo", parentId: null, children: [] };
  }
}

/**
 * El proveedor falso, con CADA funcion contada. Lo que se afirma es que
 * reordenar no llama a ninguna — ni a las que escriben ni a las que leen.
 */
function contado() {
  const llamadas = /** @type {string[]} */ ([]);
  const mod = /** @type {any} */ ({});
  for (const [k, v] of Object.entries(fake)) {
    mod[k] =
      typeof v === "function" && k !== "capabilities"
        ? (/** @type {any[]} */ ...args) => {
            llamadas.push(k);
            return /** @type {any} */ (v)(...args);
          }
        : v;
  }
  return { mod, llamadas };
}

/**
 * Los ids de tickets de una columna del board, en el orden en que se pintan,
 * quedandose con los que siembra este test (`fake.reset` trae los suyos).
 */
async function columna(svc, proyectoId, col) {
  const board = await (await pedir(svc, `/v1/board?project=${proyectoId}`)).json();
  return board.tarjetas
    .filter((/** @type {any} */ x) => x.columna === col && ["10", "11", "12"].includes(x.ticket.id))
    .map((/** @type {any} */ x) => x.ticket.id);
}

/** @param {any} svc @param {string} id @param {any} cuerpo */
const ordenar = (svc, id, cuerpo) =>
  pedir(svc, `/v1/projects/${id}/board/orden`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });

test("PUT /board/orden: subir la tercera la deja primera, y el orden sobrevive a reiniciar el servicio", async (tt) => {
  sembrar();
  tt.after(() => fake.reset());
  const home = homeTemporal();
  let proyectoId = "";

  await conServicio({ home, motor: { intervaloMs: 0 } }, async (svc) => {
    const p = await proyectoActivo(svc);
    proyectoId = p.id;
    assert.deepEqual(await columna(svc, p.id, "todo"), ["10", "11", "12"], "sin orden, el del gestor");

    const r = await ordenar(svc, p.id, { columna: "todo", itemIds: ["12", "10", "11"] });
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual((await r.json()).orden, { todo: ["12", "10", "11"] });
    assert.deepEqual(await columna(svc, p.id, "todo"), ["12", "10", "11"]);
  });

  // Un servicio NUEVO sobre el mismo home: el orden vive en el almacen, no en
  // la memoria del proceso que lo recibio.
  sembrar();
  await conServicio({ home, motor: { intervaloMs: 0 } }, async (svc) => {
    assert.deepEqual(await columna(svc, proyectoId, "todo"), ["12", "10", "11"]);
  });
});

test("PUT /board/orden: reordenar NO llama al gestor (ni para leer ni para escribir)", async (tt) => {
  sembrar();
  tt.after(() => fake.reset());
  const { mod, llamadas } = contado();
  await conServicio({ motor: { intervaloMs: 0, cargarGestor: async () => mod } }, async (svc) => {
    const p = await proyectoActivo(svc);
    const antes = llamadas.length;
    const r = await ordenar(svc, p.id, { columna: "todo", itemIds: ["11", "10"] });
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual(llamadas.slice(antes), [], "reordenar hablo con el gestor");
  });
});

test("PUT /board/orden: columna desconocida, ids repetidos o proyecto inexistente se rechazan con causa", async (tt) => {
  sembrar();
  tt.after(() => fake.reset());
  await conServicio({ motor: { intervaloMs: 0 } }, async (svc) => {
    const p = await proyectoActivo(svc);
    const mala = await ordenar(svc, p.id, { columna: "cualquiera", itemIds: ["10"] });
    assert.equal(mala.status, 400);
    assert.match((await mala.json()).error.accion, /todo/);
    const repetidos = await ordenar(svc, p.id, { columna: "todo", itemIds: ["10", "10"] });
    assert.equal(repetidos.status, 400);
    const sinLista = await ordenar(svc, p.id, { columna: "todo" });
    assert.equal(sinLista.status, 400);
    const noExiste = await ordenar(svc, "no-existe", { columna: "todo", itemIds: [] });
    assert.equal(noExiste.status, 404);
  });
});

// ---------------------------------------------------------------------------
// 3. La cola global y el limite, por HTTP
// ---------------------------------------------------------------------------

/** Un spawn que no termina nunca solo: los runs se quedan corriendo. */
function spawnQuieto() {
  const llamadas = /** @type {Array<{args: string[], hijo: any}>} */ ([]);
  const spawn = (/** @type {string} */ _c, /** @type {string[]} */ args) => {
    const hijo = /** @type {any} */ (new EventEmitter());
    hijo.stdout = new PassThrough();
    hijo.stderr = new PassThrough();
    hijo.kill = () => {
      setImmediate(() => hijo.emit("close", null, "SIGTERM"));
      return true;
    };
    llamadas.push({ args, hijo });
    return hijo;
  };
  return { spawn, llamadas };
}

const hasta = async (/** @type {() => boolean} */ cond, /** @type {string} */ que) => {
  const fin = Date.now() + 3000;
  while (!cond()) {
    if (Date.now() > fin) assert.fail(`no paso a tiempo: ${que}`);
    await new Promise((r) => setTimeout(r, 5));
  }
};

/** @param {any} svc @param {string} metodo @param {string} ruta @param {any} [cuerpo] */
async function json(svc, metodo, ruta, cuerpo) {
  const r = await pedir(svc, ruta, {
    method: metodo,
    ...(cuerpo ? { headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) } : {}),
  });
  return { status: r.status, cuerpo: await r.json() };
}

test("Settings: `runsSimultaneos` por defecto 3, se guarda en el almacen y sobrevive a reiniciar; lo invalido se rechaza", async () => {
  const home = homeTemporal();
  await conServicio({ home, motor: { intervaloMs: 0 } }, async (svc) => {
    assert.deepEqual((await json(svc, "GET", "/v1/settings")).cuerpo, { runsSimultaneos: 3 });
    const r = await json(svc, "PATCH", "/v1/settings", { runsSimultaneos: 5 });
    assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
    assert.equal(r.cuerpo.runsSimultaneos, 5);
    for (const malo of [0, -1, 2.5, "3", 1000]) {
      const x = await json(svc, "PATCH", "/v1/settings", { runsSimultaneos: malo });
      assert.equal(x.status, 400, `aceptó ${JSON.stringify(malo)}`);
    }
  });
  await conServicio({ home, motor: { intervaloMs: 0 } }, async (svc) => {
    assert.equal((await json(svc, "GET", "/v1/settings")).cuerpo.runsSimultaneos, 5);
    assert.equal((await json(svc, "GET", "/v1/queue")).cuerpo.limite, 5);
  });
});

test("GET/PUT /v1/queue: limite global 2 y cuatro runs pedidos -> 2 corren, 2 esperan; mover el ultimo lo hace arrancar antes", async (tt) => {
  sembrar();
  fake.db.items["13"] = { type: "Historia", title: "ticket 13", state: "Nuevo", parentId: null, children: [] };
  tt.after(() => fake.reset());
  const quieto = spawnQuieto();
  await conServicio({ motor: { intervaloMs: 0, spawn: quieto.spawn } }, async (svc) => {
    const a = await proyectoActivo(svc, { nombre: "Alfa" });
    const b = await proyectoActivo(svc, { nombre: "Beta" });
    assert.equal((await json(svc, "PATCH", "/v1/settings", { runsSimultaneos: 2 })).status, 200);

    for (const [p, item] of [[a, "10"], [b, "11"], [a, "12"], [b, "13"]]) {
      const r = await json(svc, "POST", `/v1/projects/${p.id}/runs`, { itemId: item });
      assert.ok([200, 202].includes(r.status), JSON.stringify(r.cuerpo));
    }
    await hasta(() => quieto.llamadas.length === 2, "dos motores");

    const cola = (await json(svc, "GET", "/v1/queue")).cuerpo;
    assert.equal(cola.limite, 2);
    assert.deepEqual(cola.corriendo.map((/** @type {any} */ x) => x.itemId).sort(), ["10", "11"]);
    assert.deepEqual(
      cola.esperando.map((/** @type {any} */ x) => [x.itemId, x.projectId, x.posicion]),
      [
        ["12", a.id, 1],
        ["13", b.id, 2],
      ],
    );

    const r = await json(svc, "PUT", "/v1/queue", { orden: ["13"] });
    assert.equal(r.status, 200, JSON.stringify(r.cuerpo));
    assert.deepEqual(r.cuerpo.esperando.map((/** @type {any} */ x) => x.itemId), ["13", "12"]);

    // Se libera un hueco: arranca el movido.
    quieto.llamadas[0].hijo.stdout.end(JSON.stringify({ ok: false, reason: "x" }));
    quieto.llamadas[0].hijo.stderr.end();
    setImmediate(() => quieto.llamadas[0].hijo.emit("close", 1, null));
    await hasta(() => quieto.llamadas.length === 3, "que arranque el siguiente");
    assert.equal(quieto.llamadas[2].args[2], "13");

    const malo = await json(svc, "PUT", "/v1/queue", { orden: "13" });
    assert.equal(malo.status, 400);
  });
});
