// El sandbox de Codex, por fase, contra las banderas que la CLI de verdad tiene.
//
// EL HUECO QUE CIERRA. Codex como PLANIFICADOR no podia dejar el plan: el motor
// lo pide en `<home>/plans/`, FUERA del worktree, y `--sandbox workspace-write`
// solo deja escribir en el directorio de trabajo. La fase terminaba "bien" y el
// motor leia "no se pudo planificar".
//
// LA SALIDA ES `--add-dir`, verificada con `codex exec --help` (codex-cli
// 0.137.0): "Additional directories that should be writable alongside the
// primary workspace". Solo en PLAN y solo el directorio de planes: este runtime
// no tiene hooks que acoten lo que escribe, y darle el home entero en GREEN le
// dejaria tocar el worktree de otra tarea sin que la guarda posterior —que mira
// el SUYO— lo viera.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { crearAdaptadorCodex } from "../src/adaptadores/codex.mjs";
import { directorioTemporal } from "./ayuda.mjs";

const GUIONADO = fileURLToPath(new URL("../src/proceso-guionado.mjs", import.meta.url));

function montar(t) {
  const dir = directorioTemporal(t);
  const cwd = join(dir, "worktree");
  const planes = join(dir, "home", "plans");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(planes, { recursive: true });
  const guion = join(dir, "guion.json");
  const salida = [
    JSON.stringify({ type: "thread.started", thread_id: "h-1" }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hecho" } }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } }),
  ].join("\n") + "\n";
  writeFileSync(guion, JSON.stringify({ colgar: false, code: 0, salida }));

  /** @type {string[][]} */
  const argvs = [];
  const adaptador = crearAdaptadorCodex({
    comando: process.execPath,
    argsPrefijo: [GUIONADO, guion, "-", "-", "--"],
    directoriosDelPlan: [planes],
    alLanzar: (/** @type {any} */ l) => argvs.push(l.registro.argv),
  });
  const correr = (/** @type {string} */ phase) => adaptador.runPhase({
    phase, taskId: phase === "PLAN" ? "plan:1" : "T001", task: phase === "PLAN" ? null : { id: "T001" },
    item: { id: "1" }, cwd, resume: null, model: null, effort: null, prompt: "el encargo", tier: "small",
    env: { PATH: "/usr/bin" },
  });
  return { correr, argvs, planes };
}

/** El valor de una bandera en argv, o todas sus apariciones. */
const valores = (/** @type {string[]} */ argv, /** @type {string} */ flag) =>
  argv.flatMap((x, i) => (x === flag ? [argv[i + 1]] : []));

test("PLAN: workspace-write y el directorio de planes como escribible", async (t) => {
  const m = montar(t);
  const r = await m.correr("PLAN");
  assert.equal(r.ok, true, r.text);
  const [argv] = m.argvs;
  assert.deepEqual(valores(argv, "--sandbox"), ["workspace-write"]);
  assert.deepEqual(valores(argv, "--add-dir"), [m.planes]);
});

test("RED y GREEN: workspace-write y NINGUN directorio extra", async (t) => {
  const m = montar(t);
  await m.correr("RED");
  await m.correr("GREEN");
  for (const argv of m.argvs) {
    assert.deepEqual(valores(argv, "--sandbox"), ["workspace-write"]);
    assert.deepEqual(valores(argv, "--add-dir"), [], "una fase que implementa recibio escritura fuera de su worktree");
  }
});

test("REVIEW y su sintesis: solo lectura, sin directorios extra", async (t) => {
  const m = montar(t);
  await m.correr("REVIEW");
  await m.correr("REVIEW-SINTESIS");
  for (const argv of m.argvs) {
    assert.deepEqual(valores(argv, "--sandbox"), ["read-only"]);
    assert.deepEqual(valores(argv, "--add-dir"), []);
  }
});

test("las banderas son las que `codex exec --help` declara (codex-cli 0.137.0)", async (t) => {
  // Copiado de la ayuda real de la CLI. Si una version futura las renombra, este
  // test no lo va a ver —no llama al binario—, pero deja escrito contra que se
  // verifico y en que version.
  const AYUDA = {
    "--sandbox": ["read-only", "workspace-write", "danger-full-access"],
    "--add-dir": "Additional directories that should be writable alongside the primary workspace",
  };
  const m = montar(t);
  await m.correr("PLAN");
  await m.correr("REVIEW");
  for (const argv of m.argvs) {
    for (const s of valores(argv, "--sandbox")) assert.ok(AYUDA["--sandbox"].includes(s), s);
  }
});
