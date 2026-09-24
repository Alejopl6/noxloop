// Un runtime sin plugin recibe el ENCARGO, no el nombre de un comando.
//
// EL FALLO QUE CIERRA, y estaba en produccion. El motor manda cada fase como
// `/noxloop-task <item> <tarea> --phase X` y cada planificacion como
// `/noxloop-plan <item> --out <ruta>`. Son comandos del plugin de Claude Code:
// para ese runtime la cadena se expande al texto de
// `packages/plugin/commands/<cmd>.md`. El adaptador de Codex la pasaba tal
// cual, y Codex recibia una linea sin significado — ni que fase era, ni que en
// RED no se toca produccion, ni con que marcador se declara un bloqueo. El
// producto se decia agnostico del runtime y el encargo solo lo entendia uno.
//
// LO QUE SE MIDE: que lo que llega al subproceso de un runtime con
// `comandos: false` es el TEXTO del comando, con los argumentos sustituidos y
// los flags explicados; y que a uno con `comandos: true` le sigue llegando el
// comando, que es lo que su plugin sabe expandir.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expandirComando, conComandosExpandidos } from "../src/comandos-sin-plugin.mjs";
import { buildDeps } from "../src/wiring.mjs";
import { crearAdaptadorCodex } from "../../adapters/src/adaptadores/codex.mjs";

const muda = { info() {}, warn() {}, error() {}, child() { return this; } };

const TAREA = {
  id: "T001", repo: "app", title: "ocultar costo", acceptance: "el viewer no ve la columna costo",
  targetFiles: ["src/grilla.mjs"], testFiles: ["test/grilla.test.mjs"], addedTargets: [], tier: "small",
};

// ---------------------------------------------------------------------------
// la expansion
// ---------------------------------------------------------------------------

test("RED: el texto de /noxloop-task, sin frontmatter, con $ARGUMENTS sustituido y la fase explicada", () => {
  const r = expandirComando("/noxloop-task 1 T001 --phase RED", { task: TAREA, hooks: false });
  assert.equal(r.ok, true, r.causa);
  const p = r.prompt;

  assert.ok(!p.startsWith("/noxloop-"), `sigue empezando por el comando: ${p.slice(0, 60)}`);
  assert.doesNotMatch(p, /\$ARGUMENTS/, "quedo el marcador sin sustituir");
  assert.doesNotMatch(p, /argument-hint:/, "viajo el frontmatter del plugin");
  // El cuerpo del comando, de verdad: la seccion de la fase y los no negociables.
  assert.match(p, /## Fase RED/);
  assert.match(p, /No toques ningún archivo de producción/);
  assert.match(p, /`1 T001 --phase RED`/, "los argumentos no quedaron donde el comando los espera");
  // Los flags, dichos en claro: un runtime sin plugin no sabe que `--phase` es la fase.
  assert.match(p, /[Ff]ase: RED/);
  assert.match(p, /T001/);
  // Y los datos de la tarea, para no depender de que `noxloop` este en su PATH.
  assert.match(p, /test\/grilla\.test\.mjs/);
  assert.match(p, /src\/grilla\.mjs/);
  assert.match(p, /el viewer no ve la columna costo/);
  // Sin hooks, el runtime tiene que saber que la guarda es posterior y revierte.
  assert.match(p, /revierte/i);
});

test("REVIEW con lente y con sintesis: la sub-seccion correcta, dicha en claro", () => {
  const lente = expandirComando("/noxloop-task 1 T001 --phase REVIEW --lens seguridad", { task: TAREA, hooks: false });
  assert.equal(lente.ok, true);
  assert.match(lente.prompt, /[Ll]ente: seguridad/);
  assert.match(lente.prompt, /No escribas\s+`HALLAZGO BLOQUEANTE:`/);

  const sintesis = expandirComando(
    "/noxloop-task 1 T001 --phase REVIEW --sintesis\n\nCuatro lentes miraron este diff.",
    { task: TAREA, hooks: false },
  );
  assert.equal(sintesis.ok, true);
  assert.match(sintesis.prompt, /[Ss][ií]ntesis/);
  assert.match(sintesis.prompt, /Cuatro lentes miraron este diff\./, "se perdio el contexto que el motor agrego despues del comando");
});

test("lo que el motor agrega despues del comando (un fallo del gate, el especialista) viaja entero", () => {
  const r = expandirComando("/noxloop-task 1 T001 --phase GREEN\n\nEl gate fallo:\nexit 1", { task: TAREA, hooks: true });
  assert.equal(r.ok, true);
  assert.match(r.prompt, /## Fase GREEN/);
  assert.match(r.prompt, /El gate fallo:\nexit 1/);
});

test("/noxloop-plan: el texto del plan con la ruta de --out explicada", () => {
  const r = expandirComando("/noxloop-plan 42 --out /home/x/plans/42.json", { task: null, hooks: false });
  assert.equal(r.ok, true);
  assert.ok(!r.prompt.startsWith("/noxloop-"));
  assert.match(r.prompt, /# \/noxloop-plan/);
  assert.match(r.prompt, /\/home\/x\/plans\/42\.json/);
  assert.match(r.prompt, /escrib[ií]\w* el plan/i);
});

test("un prompt que no es un comando del motor no se toca; un comando que no existe no se inventa", () => {
  assert.deepEqual(expandirComando("revisa esto", { task: null }), { ok: true, prompt: "revisa esto", expandido: false });

  const r = expandirComando("/noxloop-inventado 1", { task: null });
  assert.equal(r.ok, false);
  assert.match(r.causa, /noxloop-inventado/);
});

// ---------------------------------------------------------------------------
// la costura: se expande segun la capacidad, no segun el nombre del runtime
// ---------------------------------------------------------------------------

test("la costura expande para `comandos: false`, deja el comando para `comandos: true`, y expande si no se declara", async () => {
  const vistos = [];
  const eco = async (p) => { vistos.push(p.prompt); return { ok: true, text: "" }; };
  const req = { phase: "RED", taskId: "T001", task: TAREA, prompt: "/noxloop-task 1 T001 --phase RED" };

  await conComandosExpandidos(eco, { comandos: true, hooks: true })(req);
  await conComandosExpandidos(eco, { comandos: false, hooks: false })(req);
  await conComandosExpandidos(eco, { hooks: false })(req);

  assert.equal(vistos[0], req.prompt, "a un runtime con plugin se le reescribio el comando que sabe expandir");
  assert.ok(!vistos[1].startsWith("/noxloop-"));
  assert.ok(!vistos[2].startsWith("/noxloop-"), "sin declarar la capacidad se asumio que el runtime la tiene");
});

test("un comando que no se puede expandir NO se manda: la fase falla con la causa, sin invocar al runtime", async () => {
  let invocado = false;
  const r = await conComandosExpandidos(async () => { invocado = true; return { ok: true }; }, { comandos: false })({
    phase: "RED", taskId: "T001", task: TAREA, prompt: "/noxloop-inventado 1",
  });
  assert.equal(invocado, false);
  assert.equal(r.ok, false);
  assert.equal(r.subtype, "comando_sin_expansion");
  assert.match(r.text, /noxloop-inventado/);
});

test("de punta a punta: lo que recibe el subproceso de codex son las instrucciones de la fase, no `/noxloop-`", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "noxloop-sin-plugin-")));
  const home = join(dir, "home");
  const cwd = join(dir, "wt");
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  const guion = join(dir, "guion.json");
  const visto = join(dir, "visto.json");
  const GUIONADO = fileURLToPath(new URL("../../adapters/src/proceso-guionado.mjs", import.meta.url));
  const salida = [
    JSON.stringify({ type: "thread.started", thread_id: "h1" }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hecho" } }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }),
  ].join("\n") + "\n";
  writeFileSync(guion, JSON.stringify({ code: 0, salida }));

  const codex = crearAdaptadorCodex({
    comando: process.execPath,
    argsPrefijo: [GUIONADO, guion, visto, "-", "--"],
    ejecutarAutenticacion: async () => ({ code: 0, stdout: "Logged in\n", stderr: "" }),
  });
  const deps = await buildDeps({ id: "1" }, { home, repos: {}, runtime: "codex" }, {
    provider: {}, providerCtx: {}, log: muda, adaptadores: [codex], env: { PATH: "/usr/bin" },
  });

  const r = await deps.runPhase({
    phase: "RED", taskId: "T001", task: TAREA, item: { id: "1" }, cwd, resume: null,
    model: null, prompt: "/noxloop-task 1 T001 --phase RED", tier: "small",
  });
  assert.equal(r.ok, true, r.text);

  const argv = JSON.parse(readFileSync(visto, "utf8")).argv;
  const prompt = argv[argv.length - 1];
  assert.ok(!prompt.startsWith("/noxloop-"), `codex recibio el comando crudo: ${prompt.slice(0, 80)}`);
  assert.match(prompt, /## Fase RED/, "codex no recibio las instrucciones de la fase");
  assert.match(prompt, /test\/grilla\.test\.mjs/);
});
