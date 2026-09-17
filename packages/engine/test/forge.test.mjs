import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRun } from "../src/state.mjs";
import { prBody, prTitle, createPR } from "../src/forge.mjs";

const home = () => mkdtempSync(join(tmpdir(), "noxloop-forge-"));

function runEjemplo() {
  const run = createRun({
    item: {
      id: "279", key: "AUT-00", title: "Flex declara su catalogo de permisos",
      level: "story", url: "https://gestor/items/279", provider: "fake",
      acceptance: ["un rol sin permisos no ve la grilla", "el catalogo se publica antes de arrancar"],
    },
    repoScope: ["app"],
    tasks: [
      { id: "T001", repo: "app", title: "publicar el catalogo", acceptance: "GET /permisos devuelve el catalogo",
        targetFiles: ["src/permisos.mjs"], testFiles: ["test/permisos.test.mjs"], tier: "small",
        dependsOn: [], dependencyKind: "hard" },
      { id: "T002", repo: "app", title: "la grilla respeta el catalogo", acceptance: "un viewer no ve la columna costo",
        targetFiles: ["src/grilla.mjs"], testFiles: ["test/grilla.test.mjs"], tier: "medium",
        dependsOn: ["T001"], dependencyKind: "hard" },
      { id: "T003", repo: "app", title: "migrar los roles viejos", acceptance: "los roles viejos siguen entrando",
        targetFiles: ["src/migracion.mjs"], testFiles: [], noTestsBecause: "renombra una variable de entorno",
        tier: "trivial", dependsOn: [], dependencyKind: "hard" },
    ],
  }, { home: home() });

  const t1 = run.tasks[0];
  t1.status = "integrated";
  t1.gateEvidence = { command: "npm test && npm run build", exitCode: 0, durationMs: 41200, output: "42 passing", ranAt: "2026-09-17T10:00:00Z" };
  t1.attempts = { red: 1, green: 1, gate: 1, review: 1 };

  const t2 = run.tasks[1];
  t2.status = "integrated";
  t2.gateEvidence = { command: "npm test && npm run build", exitCode: 0, durationMs: 39100, output: "43 passing", ranAt: "2026-09-17T10:20:00Z" };
  t2.attempts = { red: 1, green: 3, gate: 2, review: 1 };
  t2.addedTargets = [{ path: "src/tipos.mjs", why: "el tipo compartido de columna vive aca" }];

  const t3 = run.tasks[2];
  t3.status = "blocked";
  t3.lastFailure = "presupuesto de green agotado: 3/3. Ultimo fallo: no se encontro la tabla roles_legacy";
  t3.attempts = { red: 1, green: 3, gate: 0, review: 0 };

  run.item.branch = "feature/279-flex-catalogo";
  return run;
}

// ------------------------------------------------------------- prBody

test("el cuerpo sale del ESTADO, no de la prosa del modelo", () => {
  const cuerpo = prBody(runEjemplo(), { gaps: { app: ["sin typecheck"] } });

  // los criterios de aceptacion de la historia
  assert.match(cuerpo, /un rol sin permisos no ve la grilla/);
  // el criterio verificable de cada tarea
  assert.match(cuerpo, /GET \/permisos devuelve el catalogo/);
  // la evidencia REAL del gate: comando y exit code, no "paso"
  assert.match(cuerpo, /npm test && npm run build/);
  assert.match(cuerpo, /exit 0/);
  // el enlace al ticket
  assert.match(cuerpo, /https:\/\/gestor\/items\/279/);
});

test("declara los huecos del gate: un verde con huecos no es un verde completo", () => {
  const cuerpo = prBody(runEjemplo(), { gaps: { app: ["sin typecheck", "sin e2e"] } });
  assert.match(cuerpo, /sin typecheck/);
  assert.match(cuerpo, /sin e2e/);
});

test("reporta las ampliaciones de alcance con su motivo", () => {
  const cuerpo = prBody(runEjemplo(), { gaps: {} });
  assert.match(cuerpo, /src\/tipos\.mjs/);
  assert.match(cuerpo, /el tipo compartido de columna vive aca/);
});

test("reporta las tareas bloqueadas con su causa textual, no con un resumen", () => {
  const cuerpo = prBody(runEjemplo(), { gaps: {} });
  assert.match(cuerpo, /T003/);
  assert.match(cuerpo, /roles_legacy/, "la causa real, no 'fallo el build'");
  assert.match(cuerpo, /3\/3/);
});

test("una tarea sin tests declara por que, en el cuerpo", () => {
  const cuerpo = prBody(runEjemplo(), { gaps: {} });
  assert.match(cuerpo, /renombra una variable de entorno/);
});

test("informa las iteraciones donde hubo mas de una, y calla donde no", () => {
  const cuerpo = prBody(runEjemplo(), { gaps: {} });
  assert.match(cuerpo, /T002/);
  // T002 necesito 3 de green y 2 de gate: eso se dice.
  assert.match(cuerpo, /green.*3|3.*green/i);
});

test("dice que no fue revisado por una persona, y que nada se mergeo solo", () => {
  const cuerpo = prBody(runEjemplo(), { gaps: {} });
  assert.match(cuerpo, /revisi[oó]n humana|revisar|no se mergeo|una persona/i);
});

test("acepta las referencias que el proveedor pida para enlazar nativo", () => {
  const cuerpo = prBody(runEjemplo(), { gaps: {}, refs: ["AB#279"] });
  assert.match(cuerpo, /AB#279/);
});

test("un recorrido sin tareas bloqueadas no inventa una seccion vacia", () => {
  const run = runEjemplo();
  run.tasks = run.tasks.filter((t) => t.status !== "blocked");
  const cuerpo = prBody(run, { gaps: {} });
  assert.ok(!/bloquead/i.test(cuerpo.split("## ").find((s) => s.startsWith("Tareas")) || ""), "sin bloqueadas, sin seccion");
});

test("el titulo sale del item y respeta Conventional Commits", () => {
  const t = prTitle(runEjemplo());
  assert.match(t, /^feat\(.+\): /);
  assert.match(t, /Flex declara su catalogo/);
  assert.ok(t.length <= 100, `el titulo mide ${t.length}`);
});

// ------------------------------------------------------------ createPR

test("es idempotente: si el PR ya existe, lo devuelve en vez de fallar", async () => {
  const llamadas = [];
  const r = await createPR(runEjemplo(), {
    cwd: "/tmp", base: "main", cli: "gh", gaps: {},
    exec: (args) => {
      llamadas.push(args.join(" "));
      if (args[0] === "pr" && args[1] === "view") {
        return { ok: true, out: "https://forge/pr/118" };
      }
      throw new Error("no deberia intentar crear uno nuevo");
    },
  });
  assert.equal(r.url, "https://forge/pr/118");
  assert.equal(r.alreadyExisted, true);
});

test("crea el PR cuando no existe, y nunca lo mergea", async () => {
  /** @type {string[][]} */
  const llamadas = [];
  const r = await createPR(runEjemplo(), {
    cwd: "/tmp", base: "main", cli: "gh", gaps: {},
    exec: (args) => {
      llamadas.push(args);
      if (args[0] === "pr" && args[1] === "view") return { ok: false, out: "no pull requests found" };
      return { ok: true, out: "https://forge/pr/119" };
    },
  });
  assert.equal(r.url, "https://forge/pr/119");
  assert.equal(r.alreadyExisted, false);
  assert.ok(llamadas.some((a) => a[0] === "pr" && a[1] === "create"));
  // Se mira el SUBCOMANDO y no un substring de los argumentos: el cuerpo del PR
  // dice "nada se mergeo", y buscar "merge" en el texto es el mismo falso
  // positivo que no-prod-writes existe para no cometer. Mencionar no es
  // ejecutar.
  assert.ok(
    !llamadas.some((a) => a[0] === "pr" && a[1] === "merge"),
    "el PR se abre; no se cierra",
  );
});

test("--dry-run no ejecuta nada y devuelve el cuerpo que habria mandado", async () => {
  let ejecuto = false;
  const r = await createPR(runEjemplo(), {
    cwd: "/tmp", base: "main", cli: "gh", gaps: {}, dryRun: true,
    exec: () => { ejecuto = true; return { ok: true, out: "" }; },
  });
  assert.equal(ejecuto, false);
  assert.equal(r.url, null);
  assert.match(r.body, /GET \/permisos/);
});
