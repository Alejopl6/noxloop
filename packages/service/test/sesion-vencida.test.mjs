// La sesion vencida: la ve una fase, la recuerda el servicio, la dicen Settings
// → Modelos y el diagnostico, y se olvida solo con prueba de que volvio.
//
// EL CASO, medido con Codex: `codex login status` contesto "Logged in using
// ChatGPT" con el token vencido, y la fase fallo con "Your access token could
// not be refreshed. Please log out and sign in again.". La pregunta al binario
// no lo ve; el error de la fase si. El motor (otro proceso) deja la señal en el
// home; aqui se comprueba que el servicio la incorpora, con su hora, y que un
// "Logged in" del binario NO la limpia.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { errorDeSesion, rutaDeSesionVencida } from "../../adapters/src/autenticacion.mjs";
import { conServicio, pedir } from "./ayuda.mjs";
import { proyectoActivo } from "./ayuda-motor.mjs";

/** Los dos binarios dicen que hay sesion: es exactamente lo que mintio. */
const autenticacionQueMiente = async (/** @type {string[]} */ argv) =>
  argv[0] === "claude"
    ? { code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }), stderr: "" }
    : { code: 0, stdout: "Logged in using ChatGPT\n", stderr: "" };

/** Lo que dejaria el motor tras la fase fallida, con la causa y accion del adaptador. */
function senal(/** @type {string} */ home, /** @type {string} */ runtime, /** @type {any} */ datos) {
  const ruta = rutaDeSesionVencida(home, runtime);
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, JSON.stringify({ runtime, ...datos }));
}

const haceSegundos = (/** @type {number} */ s) => new Date(Date.now() - s * 1000).toISOString();

async function estados(/** @type {any} */ svc) {
  const { items } = await (await pedir(svc, "/v1/runtimes")).json();
  return Object.fromEntries(items.map((/** @type {any} */ x) => [x.runtime, x]));
}

function opciones() {
  const homeDelOperador = realpathSync(mkdtempSync(join(tmpdir(), "noxloop-operador-")));
  /** @type {any[]} */
  const logins = [];
  return {
    homeDelOperador,
    logins,
    motor: {
      intervaloMs: 0,
      ejecutarAutenticacion: autenticacionQueMiente,
      lanzarLogin: (/** @type {string[]} */ argv) => logins.push(argv),
      entornoBase: { HOME: homeDelOperador, PATH: "/usr/bin:/bin" },
    },
  };
}

test("GET /v1/runtimes: la señal del motor gana al «Logged in» del binario, con causa, `codex login` y hora", async () => {
  const o = opciones();
  await conServicio({ motor: o.motor }, async (svc) => {
    assert.equal((await estados(svc)).codex.conectado, true, "sin señal, lo que dice el binario");

    const vista = errorDeSesion("codex", "Your access token could not be refreshed. Please log out and sign in again.");
    const hora = haceSegundos(5);
    senal(svc.home, "codex", { estado: "vencida", hora, causa: vista?.causa, accion: vista?.accion });

    const e = await estados(svc);
    assert.equal(e.codex.conectado, false);
    assert.match(e.codex.detalle, /sesion vencida/);
    assert.match(e.codex.causa, /codex login status/);
    assert.match(e.codex.accion, /`codex login`/);
    assert.deepEqual(e.codex.sesionVencida, { hora });
    assert.equal(e["claude-agent-sdk"].conectado, true, "la sesion vencida es de UN runtime");
  });
});

test("el login lanzado desde la app la olvida, y la señal vieja del motor no la resucita; una nueva si", async () => {
  const o = opciones();
  await conServicio({ motor: o.motor }, async (svc) => {
    senal(svc.home, "codex", { estado: "vencida", hora: haceSegundos(30), accion: "Corre `codex login`" });
    assert.equal((await estados(svc)).codex.conectado, false);

    const r = await pedir(svc, "/v1/runtimes/codex/login", { method: "POST" });
    assert.equal(r.status, 202);
    assert.deepEqual(o.logins[0], ["codex", "login"]);
    assert.equal((await estados(svc)).codex.conectado, true, "tras el login sigue marcada como vencida");

    // La siguiente fase vuelve a fallar: esa señal es posterior al login.
    await new Promise((res) => setTimeout(res, 5));
    senal(svc.home, "codex", { estado: "vencida", hora: new Date().toISOString() });
    assert.equal((await estados(svc)).codex.conectado, false);
  });
});

test("una fase buena despues del fallo (señal «ok» del motor) la olvida", async () => {
  const o = opciones();
  await conServicio({ motor: o.motor }, async (svc) => {
    senal(svc.home, "claude-agent-sdk", { estado: "vencida", hora: haceSegundos(20) });
    assert.equal((await estados(svc))["claude-agent-sdk"].conectado, false);
    senal(svc.home, "claude-agent-sdk", { estado: "ok", hora: haceSegundos(1) });
    assert.equal((await estados(svc))["claude-agent-sdk"].conectado, true);
  });
});

test("un `codex login` hecho desde la terminal (auth.json reescrito despues del fallo) la olvida; uno anterior no", async () => {
  const o = opciones();
  await conServicio({ motor: o.motor }, async (svc) => {
    const auth = join(o.homeDelOperador, ".codex", "auth.json");
    mkdirSync(dirname(auth), { recursive: true });
    writeFileSync(auth, "{}");
    const antes = new Date(Date.now() - 120_000);
    utimesSync(auth, antes, antes);

    senal(svc.home, "codex", { estado: "vencida", hora: haceSegundos(60) });
    assert.equal((await estados(svc)).codex.conectado, false, "un auth.json ANTERIOR al fallo no prueba nada");

    const ahora = new Date();
    utimesSync(auth, ahora, ahora);
    assert.equal((await estados(svc)).codex.conectado, true);
  });
});

test("el diagnostico del proyecto dice «sesion vencida» para el runtime del rol, con la accion", async () => {
  const o = opciones();
  await conServicio({ motor: o.motor }, async (svc) => {
    const p = await proyectoActivo(svc);
    senal(svc.home, "claude-agent-sdk", {
      estado: "vencida",
      hora: haceSegundos(3),
      causa: "Claude Code rechazo su credencial al correr la fase (el token vencio)",
      accion: "Corre `claude auth login`",
    });
    const d = await (await pedir(svc, `/v1/diagnostics?project=${p.id}&fresh=1`)).json();
    const [proyecto] = d.proyectos;
    const impl = proyecto.runtimes.find((/** @type {any} */ r) => r.rol === "implementador");
    assert.equal(impl.runtime, "claude-agent-sdk");
    assert.equal(impl.conectado, false);
    assert.ok(impl.sesionVencida?.hora);
    const problema = proyecto.problemas.find((/** @type {any} */ x) => x.codigo === "runtime_desconectado");
    assert.ok(problema, JSON.stringify(proyecto.problemas));
    assert.match(problema.motivo, /Sesion vencida/);
    assert.match(problema.causa, /sesion vencida/);
    assert.match(problema.accion, /`claude auth login`/);
  });
});
