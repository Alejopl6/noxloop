// El cable cortado de la revision, y el fan-out que nadie leia.
//
// LOS DOS FALLOS QUE ESTE ARCHIVO FIJA, encontrados contrastando el codigo
// contra lo que el propio proyecto declara:
//
//   1. `r.findings` se consumia en dos lugares de driver.mjs y NO LO PRODUCIA
//      NADA. `reduceMessages` nunca emitia ese campo, asi que
//      `if (r.findings === "blocking")` era siempre falso: **la revision no
//      podia bloquear nada en produccion**. Los tests pasaban porque el doble
//      de prueba rellenaba el campo a mano. Es el verde inventado que el
//      principio II prohibe, dentro del mecanismo que existe para atraparlo.
//
//      El agente SI escribe el marcador —`reviewer.md` se lo exige— pero nadie
//      lo leia. El cable estaba cortado del lado del motor.
//
//   2. `fanout` estaba declarado en la politica de tiers y en la configuracion
//      de ejemplo (`large` lo tiene en `true`) y **ningun camino del motor lo
//      leia**. La revision de una tarea `large` era una sola invocacion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { veredictoDeRevision, runPhase } from "../src/runner.mjs";

const stream = (mensajes) => (async function* () { for (const m of mensajes) yield m; })();
const turno = (texto) => stream([
  { type: "system", subtype: "init", session_id: "s1" },
  { type: "result", subtype: "success", is_error: false, session_id: "s1", num_turns: 1, result: texto },
]);

// ------------------------------------------------- el veredicto, del texto

test("el marcador del revisor se lee, y es lo unico que bloquea", () => {
  assert.equal(
    veredictoDeRevision("HALLAZGO BLOQUEANTE: src/a.mjs:12 traga el error del fetch"),
    "blocking",
  );
  // Con prosa alrededor, que es lo que de verdad devuelve un agente.
  assert.equal(
    veredictoDeRevision("Revise el diff contra los cuatro criterios.\n\nHALLAZGO BLOQUEANTE: el catch de la linea 40 no reporta.\n\nLo demas esta limpio."),
    "blocking",
  );
});

test("una revision limpia es un veredicto COMPLETO, no la ausencia de uno", () => {
  // Importa la distincion: `clean` significa "reviso y no encontro"; `null`
  // significa "no se sabe". Tratarlos igual convierte una fase que fallo en una
  // revision aprobada.
  assert.equal(veredictoDeRevision("Revise criterio, seguridad, estilo y alcance. No hay hallazgos bloqueantes."), "clean");
  assert.equal(veredictoDeRevision(""), null);
  assert.equal(veredictoDeRevision(null), null);
  assert.equal(veredictoDeRevision(undefined), null);
});

test("el marcador NOMBRADO no cuenta: mencionar no es declarar", () => {
  // Es el mismo falso positivo que no-prod-writes ya cometio una vez. Un
  // revisor que explica como se declara un hallazgo no esta declarando uno.
  for (const texto of [
    'El contrato dice que un bloqueo se escribe con "HALLAZGO BLOQUEANTE:" al principio.',
    "No encontre nada que amerite un HALLAZGO BLOQUEANTE.",
    "Si lo hubiera, iria como `HALLAZGO BLOQUEANTE:` en la primera linea.",
  ]) {
    assert.notEqual(veredictoDeRevision(texto), "blocking", `bloqueo de mas: ${texto}`);
  }
});

test("el marcador vale al principio de una linea, que es como se pidio", () => {
  assert.equal(veredictoDeRevision("  HALLAZGO BLOQUEANTE: indentado igual cuenta"), "blocking");
  assert.equal(veredictoDeRevision("hallazgo bloqueante: en minuscula tambien"), "blocking");
});

test("runPhase adjunta el veredicto, que es lo que cierra el cable", async () => {
  const r = await runPhase(
    { prompt: "/x", cwd: "/tmp" },
    { transport: () => turno("HALLAZGO BLOQUEANTE: src/a.mjs:3 el default esconde el fallo") },
  );
  assert.equal(r.findings, "blocking", "sin esto, la revision no puede bloquear nada");

  const limpia = await runPhase(
    { prompt: "/x", cwd: "/tmp" },
    { transport: () => turno("Revise las cuatro lentes. Limpio.") },
  );
  assert.equal(limpia.findings, "clean");
});

test("una fase que se corto no produce un veredicto: no saber no es aprobar", async () => {
  const r = await runPhase(
    { prompt: "/x", cwd: "/tmp" },
    { transport: () => stream([{ type: "system", subtype: "init", session_id: "s" }]) },
  );
  assert.equal(r.ok, false);
  assert.equal(r.findings, null, "un stream cortado no puede pasar por revision limpia");
});

// ---------------------------------------------------------------------------
// El fan-out de la revision, que estaba declarado y no lo leia nadie.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRun, loadRun } from "../src/state.mjs";
import { runItem } from "../src/driver.mjs";

const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function escenarioGit(tier) {
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-fan-"));
  const remoto = join(raiz, "origin.git");
  mkdirSync(remoto);
  git(remoto, "init", "-q", "--bare", "-b", "main");
  const repo = join(raiz, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.test");
  git(repo, "config", "user.name", "T");
  git(repo, "remote", "add", "origin", remoto);
  mkdirSync(join(repo, "src")); mkdirSync(join(repo, "test"));
  writeFileSync(join(repo, "README.md"), "x\n");
  git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", "base");
  git(repo, "push", "-q", "origin", "main");
  git(repo, "branch", "feature/1-h");
  const integracion = join(raiz, "wt-int");
  git(repo, "worktree", "add", "-q", integracion, "feature/1-h");
  const home = join(raiz, "home");
  createRun({
    item: { id: "1", title: "h", level: "story", url: "u", provider: "fake", acceptance: ["x"] },
    repoScope: ["app"],
    tasks: [{
      id: "T1", repo: "app", title: "t", acceptance: "c",
      targetFiles: ["src/a.mjs"], testFiles: ["test/a.test.mjs"],
      tier, dependsOn: [], dependencyKind: "hard",
    }],
  }, { home });
  return { raiz, repo, remoto, integracion, home };
}

const runSingleTestReal = (repo, cwd, file) => {
  try {
    execFileSync("node", ["--input-type=module", "-e", `await import("file://${join(cwd, file)}")`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, exitCode: 0, command: "node", durationMs: 1, output: "", timedOut: false, gaps: [] };
  } catch (e) {
    return { ok: false, exitCode: 1, command: "node", durationMs: 1, output: `${e.stderr || ""}`, timedOut: false, gaps: [] };
  }
};

function depsFan(esc, registro, tiers, over = {}) {
  return {
    config: {
      repos: { app: { gate: "true", fastGate: "true", baseBranch: "main", env: {}, gaps: [], remote: esc.remoto } },
      tiers,
    },
    home: esc.home,
    runPhase: async (o) => {
      registro.push({ fase: o.phase, lente: o.lens || null, resume: o.resume || null, t: Date.now() });
      const t = o.task;
      if (o.phase === "RED") {
        mkdirSync(join(o.cwd, "test"), { recursive: true });
        writeFileSync(join(o.cwd, t.testFiles[0]), `import { v } from "../${t.targetFiles[0]}";\nif (v!==1) throw new Error("rojo");\n`);
      }
      if (o.phase === "GREEN") {
        mkdirSync(join(o.cwd, "src"), { recursive: true });
        writeFileSync(join(o.cwd, t.targetFiles[0]), "export const v = 1;\n");
      }
      const texto = o.phase === "REVIEW" || o.phase === "REVIEW-SINTESIS" ? "Revisado. Limpio." : "ok";
      return { ok: true, sessionId: `s-${o.phase}${o.lens || ""}`, budgetExhausted: false, usd: 0.1, text: texto,
               findings: (o.phase === "REVIEW" || o.phase === "REVIEW-SINTESIS") ? "clean" : null };
    },
    runSingleTest: runSingleTestReal,
    runGate: () => ({ ok: true, exitCode: 0, command: "true", durationMs: 1, output: "", timedOut: false, gaps: [] }),
    createPR: async () => ({ url: "http://pr/1", alreadyExisted: false }),
    resolve: () => ({ repoPath: esc.repo, integrationPath: esc.integracion, itemBranch: "feature/1-h", baseBranch: "main" }),
    provider: null,
    maxParallelTasks: 4,
    ...over,
  };
}

const TIERS = {
  small: { model: null, effort: "medium", gate: "fast", review: true, fanout: false },
  large: { model: null, effort: "xhigh", gate: "full", review: true, fanout: true },
};

test("tier `large`: la revision se reparte en cuatro lentes Y una sintesis", async () => {
  const esc = escenarioGit("large");
  const registro = [];
  await runItem("1", depsFan(esc, registro, TIERS));

  const lentes = registro.filter((x) => x.fase === "REVIEW").map((x) => x.lente);
  assert.equal(lentes.length, 4, `no repartio: ${JSON.stringify(registro.map((r) => r.fase + ":" + r.lente))}`);
  assert.deepEqual([...lentes].sort(), ["alcance", "correccion", "estilo", "seguridad"]);
  assert.equal(registro.filter((x) => x.fase === "REVIEW-SINTESIS").length, 1,
    "cuatro informes sin nadie que decida son cuatro jueces empatados");
});

test("las cuatro lentes NO comparten sesion: la independencia es el punto", async () => {
  const esc = escenarioGit("large");
  const registro = [];
  await runItem("1", depsFan(esc, registro, TIERS));
  // Si una lente retomara la sesion de otra, veria sus hallazgos y dejaria de
  // ser una mirada independiente: el abanico se volveria una sola pasada larga.
  for (const l of registro.filter((x) => x.fase === "REVIEW")) {
    assert.equal(l.resume, null, `la lente ${l.lente} retomo una sesion ajena`);
  }
});

test("las cuatro lentes arrancan a la vez, no una despues de la otra", async () => {
  const esc = escenarioGit("large");
  const registro = [];
  const base = depsFan(esc, registro, TIERS);

  await runItem("1", {
    ...base,
    // Cada lente tarda 150ms. En serie, el span de ARRANQUES seria >= 450ms;
    // en paralelo tiene que ser casi cero. Es la unica forma de medir el
    // solapamiento sin depender de la velocidad de la maquina.
    runPhase: async (o) => {
      const r = await base.runPhase(o);
      if (o.phase === "REVIEW") await new Promise((res) => setTimeout(res, 150));
      return r;
    },
  });

  const arranques = registro.filter((x) => x.fase === "REVIEW").map((x) => x.t);
  assert.equal(arranques.length, 4);
  const span = Math.max(...arranques) - Math.min(...arranques);
  assert.ok(span < 100, `las lentes se serializaron: span de arranque ${span}ms (en serie serian >=450)`);
});

test("tier `small`: una sola revision, sin abanico", async () => {
  const esc = escenarioGit("small");
  const registro = [];
  await runItem("1", depsFan(esc, registro, TIERS));
  const revisiones = registro.filter((x) => x.fase === "REVIEW");
  assert.equal(revisiones.length, 1);
  assert.equal(revisiones[0].lente, null);
  assert.equal(registro.filter((x) => x.fase === "REVIEW-SINTESIS").length, 0,
    "en los tiers baratos el abanico es gasto sin retorno");
});

test("el veredicto sale de la SINTESIS, no de las lentes", async () => {
  const esc = escenarioGit("large");
  const registro = [];
  await runItem("1", depsFan(esc, registro, TIERS, {
    runPhase: async (o) => {
      registro.push({ fase: o.phase, lente: o.lens || null });
      const t = o.task;
      if (o.phase === "RED") {
        mkdirSync(join(o.cwd, "test"), { recursive: true });
        writeFileSync(join(o.cwd, t.testFiles[0]), `import { v } from "../${t.targetFiles[0]}";\nif (v!==1) throw new Error("rojo");\n`);
      }
      if (o.phase === "GREEN") {
        mkdirSync(join(o.cwd, "src"), { recursive: true });
        writeFileSync(join(o.cwd, t.targetFiles[0]), "export const v = 1;\n");
      }
      // Una lente grita bloqueo; la sintesis decide que no lo es. Manda la
      // sintesis: dos jueces sin jerarquia producen hallazgos contradictorios
      // sin nadie que los resuelva.
      if (o.phase === "REVIEW") return { ok: true, sessionId: "s", text: "HALLAZGO BLOQUEANTE: un numero magico", findings: "blocking" };
      if (o.phase === "REVIEW-SINTESIS") return { ok: true, sessionId: "s", text: "Revisado, limpio.", findings: "clean" };
      return { ok: true, sessionId: "s", text: "ok", findings: null };
    },
  }));
  const run = loadRun("1", { home: esc.home });
  assert.equal(run.tasks[0].status, "integrated", "la sintesis dijo limpio y la tarea no avanzo");
});
