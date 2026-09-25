// Lo que hace falta para que una fase corra igual desde la app de escritorio
// instalada que desde la terminal, y sin sorpresas. Sacado del referente
// (Nodal), que ya corre en la maquina del operador:
//
//   1. El binario por su RUTA ABSOLUTA: una app de macOS no hereda el PATH de
//      la terminal, y `claude` a secas da ENOENT.
//   2. Un prompt de sistema AÑADIDO que dice que nadie va a contestar: sin el,
//      el agente termina la fase preguntando «¿quieres que...?».
//   3. El revisor con `dontAsk` y una lista cerrada: lo que no esta permitido se
//      niega sin preguntar. Nunca `bypassPermissions`.
//   4. La sesion vencida, reconocida por el error de la fase: `codex login
//      status` decia "Logged in" con el token vencido.
//
// Todo con subprocesos guionados o el transporte del SDK inyectado: ninguna
// prueba invoca un modelo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { errorDeSesion, ejecutorDeProceso } from "../src/autenticacion.mjs";
import { PROMPT_DESATENDIDO, validarPeticion } from "../src/contrato.mjs";
import { crearAdaptadorClaude, herramientasDeRevision } from "../src/adaptadores/claude-agent-sdk.mjs";
import { crearAdaptadorCodex } from "../src/adaptadores/codex.mjs";
import { directorioTemporal } from "./ayuda.mjs";

const GUIONADO = fileURLToPath(new URL("../src/proceso-guionado.mjs", import.meta.url));
const PATH_DE_UNA_APP = "/usr/bin:/bin:/usr/sbin:/sbin";

/** El valor de una bandera en argv, o todas sus apariciones. */
const valores = (/** @type {string[]} */ argv, /** @type {string} */ flag) =>
  argv.flatMap((x, i) => (x === flag ? [argv[i + 1]] : []));

/**
 * Un HOME con un `claude`/`codex` falso en `~/.local/bin` que en realidad es el
 * proceso guionado: es lo que un operador tiene instalado, y lo que una app
 * abierta desde el Dock no encuentra con su PATH.
 */
function homeConBinario(t, /** @type {string} */ nombre, /** @type {any} */ guion) {
  const home = directorioTemporal(t);
  const bin = join(home, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  const rutaGuion = join(home, "guion.json");
  writeFileSync(rutaGuion, JSON.stringify(guion));
  const ruta = join(bin, nombre);
  writeFileSync(ruta, `#!/bin/sh\nexec "${process.execPath}" "${GUIONADO}" "${rutaGuion}" - - -- "$@"\n`);
  chmodSync(ruta, 0o755);
  const cwd = join(home, "worktree");
  mkdirSync(cwd, { recursive: true });
  return { home, ruta, cwd, rutaGuion };
}

const resultadoClaude = (/** @type {any} */ over = {}) =>
  JSON.stringify({ session_id: "s-1", subtype: "success", is_error: false, num_turns: 1, total_cost_usd: 0.01, result: "hecho", ...over });

const lineasCodex = (/** @type {any[]} */ evs) => evs.map((e) => JSON.stringify(e)).join("\n") + "\n";

const CODEX_BIEN = lineasCodex([
  { type: "thread.started", thread_id: "h-1" },
  { type: "item.completed", item: { type: "agent_message", text: "hecho" } },
  { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } },
]);

/**
 * LA SALIDA GRABADA del fallo real: `codex login status` decia "Logged in
 * using ChatGPT" y `codex exec --json` murio asi. El texto es el que vio el
 * operador; la forma de los eventos, la de `codex exec --json` 0.137.0.
 */
const CODEX_TOKEN_VENCIDO = {
  salida: lineasCodex([
    { type: "thread.started", thread_id: "h-vencido" },
    { type: "turn.started" },
    { type: "error", message: "Your access token could not be refreshed. Please log out and sign in again." },
    { type: "turn.failed", error: { message: "Your access token could not be refreshed. Please log out and sign in again." } },
  ]),
  stderr: "ERROR: Your access token could not be refreshed. Please log out and sign in again.\n",
  code: 1,
};

function peticion(/** @type {any} */ over = {}) {
  return {
    phase: "GREEN", taskId: "T-1", task: { id: "T-1" }, item: { id: "1" }, cwd: over.cwd,
    resume: null, model: null, prompt: "el encargo de la fase", tier: "small",
    env: { PATH: PATH_DE_UNA_APP },
    // Ninguna variable de estas pruebas es secreta: sin decirlo, la guarda de
    // argv las mira todas, y el valor de HOME es prefijo de la ruta del binario.
    secretos: [],
    ...over,
  };
}

/** Un transporte del SDK que anota las opciones y devuelve lo guionado. */
function sdkGuionado(/** @type {any[]} */ mensajes) {
  /** @type {any[]} */
  const opciones = [];
  const sdk = (/** @type {any} */ { options }) => {
    opciones.push(options);
    return (async function* () {
      for (const m of mensajes) yield m;
    })();
  };
  return { sdk, opciones };
}

// ---------------------------------------------------------------------------
// 1. El binario por su ruta absoluta
// ---------------------------------------------------------------------------

test("claude por el CLI, con el PATH de una app de macOS: se lanza la ruta ABSOLUTA de ~/.local/bin", async (t) => {
  const m = homeConBinario(t, "claude", { salida: resultadoClaude(), code: 0 });
  /** @type {any[]} */
  const lanzados = [];
  const a = crearAdaptadorClaude({
    resolverSdk: () => ({ disponible: false, motivo: "se prueba el CLI" }),
    alLanzar: (l) => lanzados.push(l.registro),
  });
  const r = await a.runPhase(peticion({ cwd: m.cwd, env: { PATH: PATH_DE_UNA_APP, HOME: m.home } }));
  assert.equal(r.ok, true, r.text);
  assert.equal(lanzados[0].comando, m.ruta);
});

test("codex con el PATH de una app de macOS: se lanza la ruta ABSOLUTA, y el preflight la usa tambien", async (t) => {
  const m = homeConBinario(t, "codex", { salida: CODEX_BIEN, code: 0 });
  /** @type {any[]} */
  const lanzados = [];
  const a = crearAdaptadorCodex({ alLanzar: (l) => lanzados.push(l.registro) });
  const r = await a.runPhase(peticion({ cwd: m.cwd, env: { PATH: PATH_DE_UNA_APP, HOME: m.home } }));
  assert.equal(r.ok, true, r.text);
  assert.equal(lanzados[0].comando, m.ruta);

  // El preflight pregunta `codex login status` al mismo binario. El guion
  // contesta con el stream de una fase, que no es ni "Logged in" ni "Not
  // logged in": lo que se mide es que el binario SE ENCONTRO.
  const conBinario = crearAdaptadorCodex({ entornoDisponible: { PATH: PATH_DE_UNA_APP, HOME: m.home } });
  const pf = /** @type {any} */ (await conBinario.preflight());
  assert.equal(pf.autenticacion.binarioPresente, true, JSON.stringify(pf));
});

test("ejecutorDeProceso (el del preflight y de Settings → Modelos) encuentra el binario fuera del PATH recibido", async (t) => {
  const m = homeConBinario(t, "claude", { salida: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }), code: 0 });
  const s = await ejecutorDeProceso(["claude", "auth", "status"], { env: { PATH: PATH_DE_UNA_APP, HOME: m.home }, secretos: [] });
  assert.equal(s.code, 0, s.stderr);
  assert.equal(JSON.parse(s.stdout).loggedIn, true);
});

// ---------------------------------------------------------------------------
// 2. El prompt de sistema desatendido
// ---------------------------------------------------------------------------

test("el texto desatendido dice que nadie contesta, que reporte corto y se detenga, y que no ofrezca pasos", () => {
  assert.match(PROMPT_DESATENDIDO, /sin supervision/i);
  assert.match(PROMPT_DESATENDIDO, /noxloop/);
  assert.match(PROMPT_DESATENDIDO, /No hagas preguntas/);
  assert.match(PROMPT_DESATENDIDO, /mensaje corto/);
  assert.match(PROMPT_DESATENDIDO, /detente/i);
  assert.match(PROMPT_DESATENDIDO, /No ofrezcas siguientes pasos/);
});

test("claude por el CLI: cada fase lleva --append-system-prompt con el texto desatendido, y el encargo intacto", async (t) => {
  const m = homeConBinario(t, "claude", { salida: resultadoClaude(), code: 0 });
  /** @type {any[]} */
  const lanzados = [];
  const a = crearAdaptadorClaude({
    comando: m.ruta,
    resolverSdk: () => ({ disponible: false, motivo: "se prueba el CLI" }),
    alLanzar: (l) => lanzados.push(l.registro),
  });
  for (const phase of ["PLAN", "RED", "GREEN", "REVIEW"]) {
    await a.runPhase(peticion({ phase, taskId: phase === "PLAN" ? "plan:1" : "T-1", cwd: m.cwd }));
  }
  for (const { argv } of lanzados) {
    assert.deepEqual(valores(argv, "--append-system-prompt"), [PROMPT_DESATENDIDO]);
    assert.deepEqual(valores(argv, "-p"), ["el encargo de la fase"]);
    // Se AÑADE: reemplazar el prompt de Claude Code le quitaria el uso de sus herramientas.
    assert.equal(argv.includes("--system-prompt"), false);
  }
});

test("claude por el SDK: systemPrompt es el preset de Claude Code con el texto desatendido AÑADIDO", async () => {
  const { sdk, opciones } = sdkGuionado([{ type: "result", subtype: "success", is_error: false, result: "hecho" }]);
  const a = crearAdaptadorClaude({ sdk });
  const r = await a.runPhase(peticion({ cwd: "/tmp" }));
  assert.equal(r.ok, true, r.text);
  assert.deepEqual(opciones[0].systemPrompt, { type: "preset", preset: "claude_code", append: PROMPT_DESATENDIDO });
});

test("codex: el texto desatendido va como developer_instructions, y el encargo llega integro", async (t) => {
  const m = homeConBinario(t, "codex", { salida: CODEX_BIEN, code: 0 });
  /** @type {any[]} */
  const lanzados = [];
  const a = crearAdaptadorCodex({ comando: m.ruta, alLanzar: (l) => lanzados.push(l.registro) });
  await a.runPhase(peticion({ cwd: m.cwd }));
  const { argv } = lanzados[0];
  const config = valores(argv, "-c").filter((x) => x.startsWith("developer_instructions="));
  assert.equal(config.length, 1, argv.join(" "));
  // Una cadena TOML basica: comillas y escapes como JSON.
  assert.equal(JSON.parse(config[0].slice("developer_instructions=".length)), PROMPT_DESATENDIDO);
  assert.equal(argv.at(-1), "el encargo de la fase", "el encargo no llego integro");
});

// ---------------------------------------------------------------------------
// 3. El revisor sin prompts de permiso
// ---------------------------------------------------------------------------

test("la lista cerrada del revisor: lectura, git de consulta y cada segmento del gate; nada que ejecute otra cosa", () => {
  const h = herramientasDeRevision(["npm test && npm run typecheck", "bash -c 'rm -rf /'", "node --test (x)"]);
  for (const x of ["Read", "Grep", "Glob", "Bash(git diff:*)", "Bash(git status:*)", "Bash(git log:*)", "Bash(git show:*)"]) {
    assert.ok(h.includes(x), `falta ${x}`);
  }
  assert.ok(h.includes("Bash(npm test:*)"));
  assert.ok(h.includes("Bash(npm run typecheck:*)"));
  assert.equal(h.some((x) => x.includes("bash -c") || x.includes("(x)")), false, h.join(", "));
  for (const x of ["Bash", "Write", "Edit", "MultiEdit"]) assert.equal(h.includes(x), false, `${x} en la lista del revisor`);
});

test("claude REVIEW por el CLI: dontAsk con la lista cerrada y el gate; las demas fases siguen con acceptEdits", async (t) => {
  const m = homeConBinario(t, "claude", { salida: resultadoClaude(), code: 0 });
  /** @type {any[]} */
  const lanzados = [];
  const a = crearAdaptadorClaude({
    comando: m.ruta,
    resolverSdk: () => ({ disponible: false, motivo: "se prueba el CLI" }),
    alLanzar: (l) => lanzados.push(l.registro),
  });
  await a.runPhase(peticion({ phase: "REVIEW", cwd: m.cwd, comandosPermitidos: ["npm test"] }));
  await a.runPhase(peticion({ phase: "REVIEW-SINTESIS", cwd: m.cwd }));
  await a.runPhase(peticion({ phase: "GREEN", cwd: m.cwd }));

  const [revision, sintesis, green] = lanzados.map((l) => l.argv);
  for (const argv of [revision, sintesis]) {
    assert.deepEqual(valores(argv, "--permission-mode"), ["dontAsk"]);
    const permitidas = valores(argv, "--allowedTools")[0].split(",");
    assert.ok(permitidas.includes("Bash(git diff:*)") && permitidas.includes("Read"), permitidas.join(","));
    assert.equal(permitidas.includes("Bash") || permitidas.includes("Write"), false, permitidas.join(","));
    assert.deepEqual(valores(argv, "--disallowedTools")[0].split(",").sort(), ["Edit", "MultiEdit", "NotebookEdit", "Write"]);
  }
  assert.ok(valores(revision, "--allowedTools")[0].split(",").includes("Bash(npm test:*)"));
  assert.deepEqual(valores(green, "--permission-mode"), ["acceptEdits"]);
  for (const argv of lanzados.map((l) => l.argv)) {
    const todo = argv.join(" ");
    assert.equal(/bypassPermissions|dangerously-skip-permissions/.test(todo), false, todo);
  }
});

test("claude REVIEW por el SDK: permissionMode dontAsk, la lista cerrada y las de escritura prohibidas", async () => {
  const { sdk, opciones } = sdkGuionado([{ type: "result", subtype: "success", is_error: false, result: "limpio" }]);
  const a = crearAdaptadorClaude({ sdk });
  await a.runPhase(peticion({ phase: "REVIEW", cwd: "/tmp", comandosPermitidos: ["npm test"] }));
  await a.runPhase(peticion({ phase: "GREEN", cwd: "/tmp" }));
  const [rev, green] = opciones;
  assert.equal(rev.permissionMode, "dontAsk");
  assert.ok(rev.allowedTools.includes("Bash(npm test:*)") && rev.allowedTools.includes("Bash(git show:*)"));
  assert.equal(rev.allowedTools.includes("Write"), false);
  assert.ok(rev.disallowedTools.includes("Write") && rev.disallowedTools.includes("Edit"));
  assert.equal(rev.allowDangerouslySkipPermissions, undefined);
  assert.equal(green.permissionMode, "acceptEdits");
  assert.equal(green.disallowedTools, undefined);
});

test("comandosPermitidos se valida: una lista de comandos no vacios", () => {
  const base = { phase: "REVIEW", taskId: "T", cwd: "/w", prompt: "p", resume: null, env: {} };
  assert.equal(validarPeticion({ ...base, comandosPermitidos: ["npm test"] }).ok, true);
  assert.equal(validarPeticion({ ...base, comandosPermitidos: "npm test" }).ok, false);
  assert.equal(validarPeticion({ ...base, comandosPermitidos: [""] }).ok, false);
});

// ---------------------------------------------------------------------------
// 4. La sesion vencida, reconocida por su error
// ---------------------------------------------------------------------------

test("errorDeSesion reconoce los textos de autenticacion de claude y codex, y no un 401 cualquiera", () => {
  const vencidos = [
    ["codex", "Your access token could not be refreshed. Please log out and sign in again."],
    ["codex", "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header"],
    ["codex", "Incorrect API key provided: sk-proj-****"],
    ["codex", "Not logged in"],
    ["claude-agent-sdk", "Invalid API key · Please run /login"],
    ["claude-agent-sdk", "Not logged in · Please run /login"],
    ["claude-agent-sdk", 'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired."}}'],
  ];
  for (const [runtime, texto] of vencidos) {
    const s = errorDeSesion(runtime, texto);
    assert.ok(s, `no reconocio: ${texto}`);
    assert.match(s.accion, runtime === "codex" ? /`codex login`/ : /`claude auth login`/);
    // Texto fijo: nada de lo que dijo el runtime (que puede traer un trozo de la key).
    assert.equal(JSON.stringify(s).includes("sk-proj"), false);
  }
  for (const texto of ["el turno fallo", "401 tests passed", "fallo el test de login", ""]) {
    assert.equal(errorDeSesion("codex", texto), null, `falso positivo: ${texto}`);
  }
  assert.equal(errorDeSesion("fake", "Not logged in"), null, "un runtime sin sesion no tiene login que ofrecer");
});

test("codex con la salida GRABADA del token vencido: sin_sesion, con causa y `codex login` como accion", async (t) => {
  const m = homeConBinario(t, "codex", CODEX_TOKEN_VENCIDO);
  const a = crearAdaptadorCodex({ comando: m.ruta });
  const r = /** @type {any} */ (await a.runPhase(peticion({ cwd: m.cwd })));
  assert.equal(r.ok, false);
  assert.equal(r.subtype, "sin_sesion");
  assert.match(r.causa, /Codex rechazo su credencial/);
  assert.match(r.causa, /codex login status/, "la causa tiene que explicar por que el preflight no lo vio");
  assert.match(r.accion, /`codex login`/);
  assert.match(r.text, /`codex login`/);
});

test("codex: un turno que falla por otra cosa NO es sesion vencida", async (t) => {
  const m = homeConBinario(t, "codex", {
    salida: lineasCodex([{ type: "thread.started", thread_id: "h" }, { type: "turn.failed", error: { message: "el turno fallo" } }]),
    code: 1,
  });
  const r = await crearAdaptadorCodex({ comando: m.ruta }).runPhase(peticion({ cwd: m.cwd }));
  assert.equal(r.ok, false);
  assert.notEqual(r.subtype, "sin_sesion");
});

test("codex: el agente que MENCIONA un 401 en una fase que termino bien no marca la sesion", async (t) => {
  const m = homeConBinario(t, "codex", {
    salida: lineasCodex([
      { type: "thread.started", thread_id: "h" },
      { type: "item.completed", item: { type: "agent_message", text: "arregle el manejo del 401 Unauthorized: Not logged in" } },
      { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } },
    ]),
    code: 0,
  });
  const r = await crearAdaptadorCodex({ comando: m.ruta }).runPhase(peticion({ cwd: m.cwd }));
  assert.equal(r.ok, true);
  assert.notEqual(r.subtype, "sin_sesion");
});

test("claude por el CLI con la salida grabada de una key invalida: sin_sesion y `claude auth login`", async (t) => {
  const m = homeConBinario(t, "claude", {
    salida: resultadoClaude({ is_error: true, result: "Invalid API key · Please run /login", total_cost_usd: 0 }),
    code: 1,
  });
  const a = crearAdaptadorClaude({ comando: m.ruta, resolverSdk: () => ({ disponible: false, motivo: "CLI" }) });
  const r = /** @type {any} */ (await a.runPhase(peticion({ cwd: m.cwd })));
  assert.equal(r.subtype, "sin_sesion");
  assert.match(r.accion, /`claude auth login`/);
});

test("claude por el SDK con el token OAuth vencido: sin_sesion; con un error cualquiera, no", async () => {
  const vencido = sdkGuionado([
    { type: "result", subtype: "success", is_error: true, result: "Failed to authenticate. API Error: 401 {\"type\":\"error\",\"error\":{\"type\":\"authentication_error\",\"message\":\"OAuth token has expired.\"}}" },
  ]);
  const r = /** @type {any} */ (await crearAdaptadorClaude({ sdk: vencido.sdk }).runPhase(peticion({ cwd: "/tmp" })));
  assert.equal(r.subtype, "sin_sesion");
  assert.match(r.accion, /`claude auth login`/);

  const otro = sdkGuionado([{ type: "result", subtype: "error_during_execution", is_error: true, result: "algo se rompio" }]);
  const r2 = await crearAdaptadorClaude({ sdk: otro.sdk }).runPhase(peticion({ cwd: "/tmp" }));
  assert.equal(r2.subtype, "error_during_execution");
});
