// Spec 005, US3 y US4: el hand-off por la API, y los cuatro huecos declarados.
//
// LO QUE SE MIDE AQUI ES LA RUTA: que valida ANTES de lanzar nada (con causa y
// accion), que lanza el motor con el comando que el motor sabe leer, y que la
// credencial de cada runtime que va a correr llega al subproceso por el
// ENTORNO. Que el motor retome de verdad sin repetir RED lo mide
// `packages/engine/test/handoff.test.mjs` de punta a punta.
//
// Los huecos (FR-008), cada uno con su test:
//   (a) `POST /runs` rechaza por un bloqueante del diagnostico, con el mismo
//       codigo que el problema y el mismo motivo que la tarjeta;
//   (c) el board anticipa el choque del ejecutor de la tarea con el revisor de
//       la flota, con la MISMA regla que usa el lanzamiento;
//   (d) la API key del runtime REVISOR llega al entorno del motor, no solo la
//       del implementador.
// El (b) es de la interfaz: `apps/studio/test/tdd-de-la-flota.test.mjs`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { conServicio, FRASE, pedir } from "./ayuda.mjs";
import { proyectoActivo, runEnDisco } from "./ayuda-motor.mjs";

function spawnFalso() {
  /** @type {any[]} */
  const llamadas = [];
  const spawn = (/** @type {string} */ comando, /** @type {string[]} */ args, /** @type {any} */ opciones) => {
    const hijo = /** @type {any} */ (new EventEmitter());
    hijo.stdout = new PassThrough();
    hijo.stderr = new PassThrough();
    hijo.kill = () => (setImmediate(() => hijo.emit("close", null, "SIGTERM")), true);
    llamadas.push({ comando, args, opciones });
    return hijo;
  };
  return { spawn, llamadas };
}

const json = (/** @type {any} */ cuerpo, metodo = "POST") => ({
  method: metodo,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(cuerpo),
});

/** Un ejecutor de versiones falso: los binarios que se nombren estan ausentes. */
const versiones = (/** @type {string[]} */ ausentes = []) => async (/** @type {string[]} */ argv) => {
  const nombre = argv[0].split("/").pop() ?? "";
  const clave = /node/.test(nombre) ? "node" : nombre;
  if (ausentes.includes(clave)) {
    const e = /** @type {any} */ (new Error(`spawn ${argv[0]} ENOENT`));
    e.code = "ENOENT";
    throw e;
  }
  const salida = /** @type {Record<string, string>} */ ({ git: "git version 2.50.1", claude: "2.1.281 (Claude Code)", codex: "codex-cli 0.137.0", node: "v22.11.0" });
  return { code: 0, stdout: `${salida[clave]}\n`, stderr: "" };
};

/** Claude con sesion; Codex segun se pida. */
const sesion = ({ codex = true } = {}) => async (/** @type {string[]} */ argv) =>
  argv[0] === "claude"
    ? { code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }), stderr: "" }
    : codex
      ? { code: 0, stdout: "Logged in using ChatGPT", stderr: "" }
      : { code: 1, stdout: "Not logged in", stderr: "" };

async function hasta(/** @type {() => any} */ cond, /** @type {string} */ que, ms = 3000) {
  const fin = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > fin) assert.fail(`no paso a tiempo: ${que}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Implementador en claude, revisor en codex: la flota de la mayoria de los tests. */
async function flota(/** @type {any} */ svc, /** @type {string} */ id, impl = "claude-agent-sdk", rev = "codex") {
  const a = await pedir(svc, `/v1/projects/${id}/agents`, json({ nombre: "impl", rol: "implementador", runtime: impl, modelo: "m" }));
  assert.equal(a.status, 201, await a.clone().text());
  const b = await pedir(svc, `/v1/projects/${id}/agents`, json({ nombre: "rev", rol: "revisor", runtime: rev, modelo: "m" }));
  assert.equal(b.status, 201, await b.clone().text());
}

/** Un run en disco con T001 bloqueada en GREEN (rojo verificado, intentos agotados). */
function bloqueado(/** @type {string} */ home, /** @type {string} */ projectId, extra = {}) {
  return runEnDisco(home, "7", {
    projectId,
    tasks: [{
      id: "T001", title: "t", repo: "app", status: "blocked", redVerified: true,
      attempts: { red: 1, green: 3, gate: 0, review: 0 }, dependsOn: [],
      lastFailure: "el test no llego a pasar: 41 !== 42",
      ...extra,
    }],
  });
}

// ---------------------------------------------------------------------------
// El hand-off: POST /v1/runs/:itemId/tasks/:taskId/handoff
// ---------------------------------------------------------------------------

test("hand-off: lanza `resume` con la tarea y el runtime nuevo, y contesta 202 con lo que va a pasar", async () => {
  const falso = spawnFalso();
  await conServicio({ motor: { spawn: falso.spawn, intervaloMs: 0, ejecutarDiagnostico: versiones(), ejecutarAutenticacion: sesion() } }, async (svc) => {
    const p = await proyectoActivo(svc, { conexiones: [] });
    // Con DOS runtimes registrados y un revisor declarado no queda ningun
    // destino valido (ni el implementador actual ni el revisor): el hand-off
    // tiene sentido con la flota sin revisor, o con un tercer runtime.
    await pedir(svc, `/v1/projects/${p.id}/agents`, json({ nombre: "impl", rol: "implementador", runtime: "claude-agent-sdk", modelo: "m" }));
    bloqueado(svc.home, p.id);

    const r = await pedir(svc, "/v1/runs/7/tasks/T001/handoff", json({ runtime: "codex", nota: "que lo intente otro" }));
    assert.equal(r.status, 202, await r.clone().text());
    const cuerpo = await r.json();
    assert.equal(cuerpo.handoff.taskId, "T001");
    assert.equal(cuerpo.handoff.de, "claude-agent-sdk");
    assert.equal(cuerpo.handoff.a, "codex");
    assert.equal(cuerpo.handoff.retomaEn, "GREEN", "con el rojo verificado, el nuevo agente sigue en GREEN");

    await hasta(() => falso.llamadas.length === 1, "el resume");
    const args = falso.llamadas[0].args;
    assert.deepEqual(args.slice(1, 3), ["resume", "7"]);
    const i = args.indexOf("--task");
    assert.equal(args[i + 1], "T001");
    assert.equal(args[args.indexOf("--runtime") + 1], "codex");
    assert.equal(args[args.indexOf("--nota") + 1], "que lo intente otro");
  });
});

test("hand-off rechazado: al revisor de la flota (FR-034), con causa y accion, sin lanzar nada", async () => {
  const falso = spawnFalso();
  await conServicio({ motor: { spawn: falso.spawn, intervaloMs: 0, ejecutarDiagnostico: versiones(), ejecutarAutenticacion: sesion() } }, async (svc) => {
    const p = await proyectoActivo(svc, { conexiones: [] });
    await flota(svc, p.id, "claude-agent-sdk", "codex");
    bloqueado(svc.home, p.id);
    const r = await pedir(svc, "/v1/runs/7/tasks/T001/handoff", json({ runtime: "codex" }));
    assert.equal(r.status, 409, await r.clone().text());
    const { error } = await r.json();
    assert.equal(error.codigo, "revisor_comparte_runtime");
    assert.match(error.causa, /codex/);
    assert.ok(error.accion.length > 20);
    assert.equal(falso.llamadas.length, 0);
  });
});

test("hand-off rechazado: el mismo implementador, un runtime inventado o sin sesion, una tarea ya integrada", async () => {
  const falso = spawnFalso();
  await conServicio(
    { motor: { spawn: falso.spawn, intervaloMs: 0, ejecutarDiagnostico: versiones(), ejecutarAutenticacion: sesion({ codex: false }) } },
    async (svc) => {
      const p = await proyectoActivo(svc, { conexiones: [] });
      await pedir(svc, `/v1/projects/${p.id}/agents`, json({ nombre: "impl", rol: "implementador", runtime: "claude-agent-sdk", modelo: "m" }));
      bloqueado(svc.home, p.id);

      const razon = async (/** @type {any} */ cuerpo) => {
        const r = await pedir(svc, "/v1/runs/7/tasks/T001/handoff", json(cuerpo));
        assert.equal(r.status, 409, await r.clone().text());
        const { error } = await r.json();
        assert.equal(error.codigo, "handoff_rechazado");
        assert.ok(error.causa && error.accion, "rechazo sin causa o sin accion");
        return error;
      };

      const mismo = await razon({ runtime: "claude-agent-sdk" });
      assert.equal(mismo.objeto.razon, "mismo_runtime");
      assert.match(mismo.accion, /Retry|destrab|unstick/i);

      assert.equal((await razon({ runtime: "uno-inventado" })).objeto.razon, "runtime_no_registrado");

      const sinSesion = await razon({ runtime: "codex" });
      assert.equal(sinSesion.objeto.razon, "runtime_desconectado");
      assert.match(sinSesion.accion, /Modelos/);

      bloqueado(svc.home, p.id, { status: "integrated" });
      assert.equal((await razon({ runtime: "codex" })).objeto.razon, "sin_implementacion");
      assert.equal(falso.llamadas.length, 0, "un hand-off rechazado lanzo el motor");
    },
  );
});

test("hand-off rechazado: con el run corriendo (fase en vuelo) — primero se detiene", async () => {
  const falso = spawnFalso();
  await conServicio({ motor: { spawn: falso.spawn, intervaloMs: 0, ejecutarDiagnostico: versiones(), ejecutarAutenticacion: sesion() } }, async (svc) => {
    const p = await proyectoActivo(svc, { conexiones: [] });
    await pedir(svc, `/v1/projects/${p.id}/agents`, json({ nombre: "impl", rol: "implementador", runtime: "claude-agent-sdk", modelo: "m" }));
    bloqueado(svc.home, p.id);
    const retry = await pedir(svc, "/v1/runs/7/retry", { method: "POST" });
    assert.equal(retry.status, 202, await retry.clone().text());
    await hasta(() => falso.llamadas.length === 1, "el resume del retry");

    const r = await pedir(svc, "/v1/runs/7/tasks/T001/handoff", json({ runtime: "codex" }));
    assert.equal(r.status, 409, await r.clone().text());
    const { error } = await r.json();
    assert.equal(error.codigo, "handoff_rechazado");
    assert.equal(error.objeto.razon, "fase_en_vuelo");
    assert.match(error.accion, /deten|termine/i);
    assert.equal(falso.llamadas.length, 1);
  });
});

test("hand-off: run o tarea que no existen dan 404", async () => {
  await conServicio({ motor: { intervaloMs: 0, ejecutarDiagnostico: versiones(), ejecutarAutenticacion: sesion() } }, async (svc) => {
    const p = await proyectoActivo(svc, { conexiones: [] });
    assert.equal((await pedir(svc, "/v1/runs/nada/tasks/T001/handoff", json({ runtime: "codex" }))).status, 404);
    bloqueado(svc.home, p.id);
    assert.equal((await pedir(svc, "/v1/runs/7/tasks/T999/handoff", json({ runtime: "codex" }))).status, 404);
    const sinRuntime = await pedir(svc, "/v1/runs/7/tasks/T001/handoff", json({}));
    assert.equal(sinRuntime.status, 400);
  });
});

// ---------------------------------------------------------------------------
// (a) POST /runs rechaza por un bloqueante del diagnostico
// ---------------------------------------------------------------------------

test("(a) POST /runs con git ausente: 409 con el codigo del diagnostico y el motivo de la tarjeta, sin lanzar", async () => {
  const falso = spawnFalso();
  await conServicio(
    { motor: { spawn: falso.spawn, intervaloMs: 0, ejecutarDiagnostico: versiones(["git"]), ejecutarAutenticacion: sesion() } },
    async (svc) => {
      const p = await proyectoActivo(svc, { conexiones: [] });
      const tarea = (await (await pedir(svc, `/v1/projects/${p.id}/tasks`, json({ titulo: "una" }))).json()).tarea;

      const board = await (await pedir(svc, `/v1/board?project=${p.id}`)).json();
      const tarjeta = board.tarjetas.find((/** @type {any} */ t) => t.ticket.id === String(tarea.id));
      assert.equal(tarjeta.accion.habilitada, false);

      const r = await pedir(svc, `/v1/projects/${p.id}/runs`, json({ itemId: tarea.id }));
      assert.equal(r.status, 409, await r.clone().text());
      const { error } = await r.json();
      assert.equal(error.codigo, "binario_ausente");
      assert.match(error.causa, /git/);
      assert.ok(error.accion.length > 20);
      assert.equal(error.objeto.motivo, tarjeta.accion.motivo, "la ruta y la tarjeta dicen cosas distintas");
      assert.equal(falso.llamadas.length, 0, "se lanzo un motor que el diagnostico sabia que no podia correr");
    },
  );
});

// ---------------------------------------------------------------------------
// (c) El board anticipa el choque ejecutor de la tarea vs revisor de la flota
// ---------------------------------------------------------------------------

test("(c) una tarea cuyo ejecutor es el runtime del revisor: Run deshabilitado con el MISMO motivo que daria lanzar", async () => {
  const falso = spawnFalso();
  await conServicio({ motor: { spawn: falso.spawn, intervaloMs: 0, ejecutarDiagnostico: versiones(), ejecutarAutenticacion: sesion() } }, async (svc) => {
    const p = await proyectoActivo(svc, { conexiones: [] });
    await flota(svc, p.id, "claude-agent-sdk", "codex");
    const choca = (await (await pedir(svc, `/v1/projects/${p.id}/tasks`, json({ titulo: "choca", ejecutor: { runtime: "codex" } }))).json()).tarea;
    const bien = (await (await pedir(svc, `/v1/projects/${p.id}/tasks`, json({ titulo: "bien" }))).json()).tarea;

    const board = await (await pedir(svc, `/v1/board?project=${p.id}`)).json();
    const t = board.tarjetas.find((/** @type {any} */ x) => x.ticket.id === String(choca.id));
    assert.equal(t.accion.habilitada, false, "el board dejo pulsar un Run que el lanzamiento rechaza");
    const ok = board.tarjetas.find((/** @type {any} */ x) => x.ticket.id === String(bien.id));
    assert.equal(ok.accion.habilitada, true, ok.accion.motivo);

    const r = await pedir(svc, `/v1/projects/${p.id}/runs`, json({ itemId: choca.id }));
    assert.equal(r.status, 409);
    const { error } = await r.json();
    assert.equal(error.codigo, "revisor_comparte_runtime");
    assert.equal(t.accion.motivo, error.causa, "el motivo de la tarjeta no es el del lanzamiento: la regla esta duplicada");
    assert.equal(falso.llamadas.length, 0);
  });
});

// ---------------------------------------------------------------------------
// (d) La key del runtime revisor llega a su fase
// ---------------------------------------------------------------------------

const SECRETO = "sk-ant-rev-9q2-KEY-DEL-REVISOR-QUE-NO-SALE-7z";

test("(d) la API key del runtime que SOLO es revisor llega al entorno del motor, y nunca por argv", async () => {
  const falso = spawnFalso();
  await conServicio(
    { frase: FRASE, motor: { spawn: falso.spawn, intervaloMs: 0, ejecutarDiagnostico: versiones(), ejecutarAutenticacion: sesion() } },
    async (svc) => {
      const p = await proyectoActivo(svc, { autonomia: "L1", conexiones: [] });
      // codex implementa, claude SOLO revisa: la key guardada es la de claude.
      await flota(svc, p.id, "codex", "claude-agent-sdk");
      const k = await pedir(svc, "/v1/runtimes/claude-agent-sdk/api-key", json({ valor: SECRETO }));
      assert.equal(k.status, 201, await k.clone().text());
      const tarea = (await (await pedir(svc, `/v1/projects/${p.id}/tasks`, json({ titulo: "una" }))).json()).tarea;

      const r = await pedir(svc, `/v1/projects/${p.id}/runs`, json({ itemId: tarea.id }));
      assert.equal(r.status, 202, await r.clone().text());
      await hasta(() => falso.llamadas.length === 1, "el plan");
      const { args, opciones } = falso.llamadas[0];
      assert.equal(opciones.env.ANTHROPIC_API_KEY, SECRETO, "la key del revisor no llego al motor: su fase correria sin modelo");
      assert.ok(!args.some((/** @type {string} */ x) => x.includes(SECRETO)), "la key aparecio en la linea de comandos");
    },
  );
});
