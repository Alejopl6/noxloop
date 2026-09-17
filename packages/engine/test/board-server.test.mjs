// El servidor del board.
//
// POR QUE SOLO LOOPBACK. El board muestra titulos de tickets, texto de fallos
// de gate y rutas de worktrees — o sea el trabajo interno de quien lo corre.
// Escuchar en 0.0.0.0 publicaria eso en toda la red local sin que nadie lo
// pida. Hay un test que verifica la direccion.
//
// POR QUE SOLO GET. El motor tiene un unico escritor del estado. Este servidor
// no es ese escritor y no puede volverse uno por descuido, asi que todo metodo
// que no sea GET se rechaza en la puerta y hay un test que lo prueba.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { crearServidor } from "../src/board-server.mjs";

function homeCon(runs = []) {
  const home = mkdtempSync(join(tmpdir(), "noxloop-srv-"));
  if (runs.length) mkdirSync(join(home, "runs"), { recursive: true });
  for (const r of runs) writeFileSync(join(home, "runs", `run-${r.item.id}.json`), JSON.stringify(r));
  return home;
}

const unRun = (id) => ({
  schemaVersion: 1, createdAt: "2026-09-17T00:00:00.000Z", updatedAt: "2026-09-17T00:00:00.000Z",
  item: { id, title: `ticket ${id}`, provider: "github" },
  tasks: [{ id: "t1", title: "una tarea", repo: "r", status: "pending", attempts: {}, dependsOn: [] }],
  spent: { usd: 0, calls: 0 },
});

/** Levanta el servidor en un puerto libre y garantiza cerrarlo. */
async function conServidor(home, fn) {
  const srv = crearServidor({ home });
  await new Promise((res) => srv.listen(0, "127.0.0.1", res));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    return await fn(base, srv);
  } finally {
    await new Promise((res) => srv.close(res));
  }
}

test("escucha SOLO en loopback: el board no se publica en la red local", async () => {
  await conServidor(homeCon(), async (_base, srv) => {
    assert.equal(srv.address().address, "127.0.0.1");
  });
});

test("GET /api/board devuelve el read-model como JSON", async () => {
  await conServidor(homeCon([unRun("T-1")]), async (base) => {
    const r = await fetch(`${base}/api/board`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /application\/json/);
    const b = await r.json();
    assert.equal(b.tarjetas.length, 1);
    assert.equal(b.tarjetas[0].itemId, "T-1");
    assert.ok(Array.isArray(b.columnas));
  });
});

test("GET / devuelve la pagina, autocontenida", async () => {
  await conServidor(homeCon(), async (base) => {
    const r = await fetch(`${base}/`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /text\/html/);
    const html = await r.text();
    assert.match(html, /<!doctype html>/i);
    // Sin red no hay board: tiene que servir para mirar un run cuando el gestor
    // de tickets esta caido, que es cuando mas se lo necesita.
    assert.doesNotMatch(html, /https?:\/\/(?!127\.0\.0\.1)[a-z]/i, "la pagina no puede depender de un CDN");
  });
});

test("EL INVARIANTE: todo metodo que no sea GET se rechaza", async () => {
  await conServidor(homeCon([unRun("T-2")]), async (base) => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = await fetch(`${base}/api/board`, { method });
      assert.equal(r.status, 405, `${method} tendria que dar 405 y dio ${r.status}`);
    }
  });
});

test("una ruta que no existe da 404, no la pagina", async () => {
  await conServidor(homeCon(), async (base) => {
    const r = await fetch(`${base}/../../etc/passwd`);
    assert.equal(r.status, 404);
  });
});

test("GET /api/events abre un stream y manda el board de entrada", async () => {
  await conServidor(homeCon([unRun("T-3")]), async (base) => {
    const ctl = new AbortController();
    const r = await fetch(`${base}/api/events`, { signal: ctl.signal });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /text\/event-stream/);

    const lector = r.body.getReader();
    const { value } = await lector.read();
    const texto = new TextDecoder().decode(value);
    assert.match(texto, /^data: /m, "el primer evento llega sin esperar un cambio");
    assert.match(texto, /T-3/);
    ctl.abort();
    await lector.cancel().catch(() => {});
  });
});

test("un home corrupto se sirve igual, con el aviso adentro", async () => {
  const home = homeCon();
  mkdirSync(join(home, "runs"), { recursive: true });
  writeFileSync(join(home, "runs", "run-T-4.json"), "no soy json");

  await conServidor(home, async (base) => {
    const r = await fetch(`${base}/api/board`);
    assert.equal(r.status, 200, "el board no puede caerse por un archivo malo");
    const b = await r.json();
    assert.ok(b.avisos.some((a) => /T-4/.test(a.mensaje)));
  });
});

// --------------------------------------------- el board arranca sin config
//
// EL FALLO QUE EVITA, y se encontro usandolo: `noxloop board` exigia una
// configuracion completa —proveedor, al menos un repo— para levantar un lector
// que no usa ninguna de las dos cosas. Justo el escenario para el que existe el
// board (mirar que quedo cuando el gestor esta caido, o cuando estas en otra
// maquina sin los checkouts) era el que no podia abrirlo.

import { resolverHomeDelBoard } from "../src/board-server.mjs";

test("--home gana sobre todo: es la ruta mas corta a mirar el estado", () => {
  const h = resolverHomeDelBoard({ home: "/un/home" }, { NOXLOOP_HOME: "/otro" }, () => ({ home: "/del/archivo" }));
  assert.equal(h.home, "/un/home");
  assert.equal(h.de, "--home");
});

test("sin --home manda NOXLOOP_HOME, que es la misma precedencia del motor", () => {
  const h = resolverHomeDelBoard({}, { NOXLOOP_HOME: "/del/entorno" }, () => ({ home: "/del/archivo" }));
  assert.equal(h.home, "/del/entorno");
  assert.equal(h.de, "NOXLOOP_HOME");
});

test("sin ninguno de los dos se usa la configuracion, como cualquier comando", () => {
  const h = resolverHomeDelBoard({}, {}, () => ({ home: "/del/archivo" }));
  assert.equal(h.home, "/del/archivo");
  assert.equal(h.de, "la configuracion");
});

test("una configuracion invalida NO impide mirar el estado si hay donde mirarlo", () => {
  const h = resolverHomeDelBoard({ home: "/un/home" }, {}, () => { throw new Error("no valida"); });
  assert.equal(h.home, "/un/home", "el board es un lector: la config no es su dependencia");
});

test("sin config valida y sin donde mirar, lo dice en vez de abrir un board vacio", () => {
  const h = resolverHomeDelBoard({}, {}, () => { throw new Error("falta provider") });
  assert.equal(h.home, null);
  assert.match(h.problema, /falta provider/, "se nombra la causa real, no un 'algo fallo'");
  assert.match(h.problema, /--home|NOXLOOP_HOME/, "y se dice como seguir sin arreglarla");
});

// ------------------------------------------------- la pagina tiene que parsear
//
// EL FALLO QUE EVITA. El JS de la pagina viaja como texto dentro de un modulo:
// nada lo compila, y un parentesis de menos no rompe ningun test. El board
// quedaria en blanco, el servidor seguiria devolviendo 200 y la suite entera
// verde. Aca se lo pasa por el parser de verdad.

import { PAGINA } from "../src/board-page.mjs";

test("el script de la pagina parsea: un board en blanco no puede dar verde", () => {
  const bloques = [...PAGINA.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(bloques.length > 0, "la pagina tiene que traer su script");

  for (const js of bloques) {
    // `new Function` compila sin ejecutar: alcanza para el parser y no toca
    // nada del entorno del test.
    assert.doesNotThrow(() => new Function(js), "el script de la pagina no parsea");
  }
});

test("la pagina trae los anclajes que su script busca por id", () => {
  const js = [...PAGINA.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
  const pedidos = new Set([...js.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]));
  assert.ok(pedidos.size > 5, "se esperaban varios ids en juego");

  const faltan = [...pedidos].filter((id) => !PAGINA.includes(`id="${id}"`));
  assert.deepEqual(faltan, [], `el script busca ids que el HTML no tiene: ${faltan.join(", ")}`);
});
