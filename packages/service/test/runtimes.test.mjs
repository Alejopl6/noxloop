// Settings -> Modelos: `GET /v1/runtimes`, el login del runtime y la API key en
// la boveda (spec 003).
//
// LO QUE MAS IMPORTA DE ESTE ARCHIVO es el camino de la key: se guarda en la
// boveda, no vuelve por ninguna respuesta, y llega al motor por el ENTORNO del
// subproceso —nunca por argv— con el grant del proyecto (principio IX). Y que
// la pregunta «¿esta conectado?» se hace con el entorno que el motor va a
// tener, no con el del servicio: una key en el shell del operador no llega al
// motor, asi que no puede contar como conectado.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { conServicio, FRASE, pedir } from "./ayuda.mjs";
import { proyectoActivo } from "./ayuda-motor.mjs";

const SECRETO = "sk-ant-zqx7-KEY-DEL-MODELO-QUE-NO-SALE-NUNCA-5e1";

/** Registra con que se pregunto, y contesta como un Claude sin sesion y un Codex con ChatGPT. */
function autenticacionQueRegistra() {
  const preguntas = [];
  const ejecutar = async (argv, { env }) => {
    preguntas.push({ argv, env });
    if (argv[0] === "claude") return { code: 0, stdout: JSON.stringify({ loggedIn: false }), stderr: "" };
    return { code: 0, stdout: "Logged in using ChatGPT", stderr: "" };
  };
  return { ejecutar, preguntas };
}

const json = (cuerpo) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });

test("GET /v1/runtimes: uno por runtime con sesion, con nombre y metodo, y preguntado con el entorno FILTRADO", async (t) => {
  process.env.ANTHROPIC_API_KEY = "sk-del-shell-del-operador";
  t.after(() => delete process.env.ANTHROPIC_API_KEY);
  const a = autenticacionQueRegistra();
  await conServicio({ motor: { intervaloMs: 0, ejecutarAutenticacion: a.ejecutar } }, async (svc) => {
    const r = await pedir(svc, "/v1/runtimes");
    assert.equal(r.status, 200);
    const { items } = await r.json();
    const por = Object.fromEntries(items.map((x) => [x.runtime, x]));
    assert.deepEqual(Object.keys(por).sort(), ["claude-agent-sdk", "codex"]);
    assert.equal(por["claude-agent-sdk"].nombre, "Claude Code");
    assert.equal(por["claude-agent-sdk"].conectado, false, "la key del shell del operador no llega al motor: no cuenta");
    assert.ok(por["claude-agent-sdk"].accion.length > 20);
    assert.equal(por.codex.conectado, true);
    assert.equal(por.codex.metodo, "cuenta_chatgpt");
    for (const { env } of a.preguntas) assert.equal(env.ANTHROPIC_API_KEY, undefined);
  });
});

test("POST /v1/runtimes/:id/login lanza el login del runtime SIN esperarlo (202); un runtime inventado es 404", async () => {
  const lanzados = [];
  const a = autenticacionQueRegistra();
  await conServicio(
    { motor: { intervaloMs: 0, ejecutarAutenticacion: a.ejecutar, lanzarLogin: (argv, env) => lanzados.push({ argv, env }) } },
    async (svc) => {
      const r = await pedir(svc, "/v1/runtimes/claude-agent-sdk/login", { method: "POST" });
      assert.equal(r.status, 202);
      assert.equal((await r.json()).iniciado, true);
      assert.deepEqual(lanzados[0].argv, ["claude", "auth", "login"]);
      assert.equal(lanzados[0].env.ANTHROPIC_API_KEY, undefined, "el login no recibe ninguna key");

      const no = await pedir(svc, "/v1/runtimes/uno-inventado/login", { method: "POST" });
      assert.equal(no.status, 404);
      assert.equal(lanzados.length, 1);
    },
  );
});

test("la API key: a la boveda como credencial `modelo`, con grant del implementador, fuera de toda respuesta, y al motor por ENTORNO", async () => {
  const a = autenticacionQueRegistra();
  const llamadas = [];
  const spawn = (comando, args, opciones) => {
    const hijo = /** @type {any} */ (new EventEmitter());
    hijo.stdout = new PassThrough();
    hijo.stderr = new PassThrough();
    hijo.kill = () => (setImmediate(() => hijo.emit("close", null, "SIGTERM")), true);
    llamadas.push({ comando, args, opciones });
    return hijo;
  };
  await conServicio({ frase: FRASE, motor: { intervaloMs: 0, ejecutarAutenticacion: a.ejecutar, spawn } }, async (svc) => {
    const p = await proyectoActivo(svc, { autonomia: "L1" });
    const agente = await pedir(svc, `/v1/projects/${p.id}/agents`, json({ nombre: "impl", rol: "implementador", runtime: "claude-agent-sdk", modelo: "m" }));
    assert.equal(agente.status, 201, await agente.clone().text());

    const r = await pedir(svc, "/v1/runtimes/claude-agent-sdk/api-key", json({ valor: SECRETO }));
    const texto = await r.text();
    assert.equal(r.status, 201, texto);
    assert.ok(!texto.includes(SECRETO) && !texto.includes(SECRETO.slice(0, 16)), "la key volvio en la respuesta");
    const estado = JSON.parse(texto);
    assert.equal(estado.conectado, true);
    assert.equal(estado.metodo, "api_key");
    assert.equal(estado.claveGuardada, true);

    const cred = svc.dep.almacen.base.consultarUno("SELECT * FROM credential WHERE tipo = 'modelo'");
    assert.equal(cred.proveedor, "claude-agent-sdk");
    const grant = svc.dep.almacen.base.consultarUno('SELECT * FROM "grant" WHERE credential_id = ?', [cred.id]);
    assert.equal(grant.project_id, p.id, "sin grant del proyecto la boveda no entrega la key al motor");

    const lanzar = await pedir(svc, `/v1/projects/${p.id}/runs`, json({ itemId: "2" }));
    assert.equal(lanzar.status, 202, await lanzar.clone().text());
    const fin = Date.now() + 2000;
    while (!llamadas.length && Date.now() < fin) await new Promise((l) => setTimeout(l, 5));
    const { args, opciones } = llamadas[0];
    assert.equal(opciones.env.ANTHROPIC_API_KEY, SECRETO, "el motor no recibio la key de la boveda");
    assert.ok(!args.some((x) => x.includes(SECRETO)), "la key aparecio en la linea de comandos");

    const quitar = await pedir(svc, "/v1/runtimes/claude-agent-sdk/api-key", { method: "DELETE" });
    assert.equal(quitar.status, 200);
    const despues = (await (await pedir(svc, "/v1/runtimes")).json()).items.find((x) => x.runtime === "claude-agent-sdk");
    assert.equal(despues.claveGuardada, false);
    assert.equal(despues.conectado, false);
  });
});
