// Dos huecos que el recorrido de un hito destapó, y que no son suyos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRun, loadRun, addSpend } from "../src/state.mjs";
import { makeResolve } from "../src/wiring.mjs";

const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// ---------------------------------------------------------------------------
// 1. El techo de gasto no puede funcionar si nadie anota el gasto.
//
// EL HUECO: el recorrido de un hito lee `run.spent.usd` para decidir si se
// detiene, y NADA del motor lo escribia. El techo en dolares existia en la
// configuracion, en el esquema y en el codigo del hito, y no podia dispararse
// nunca — la peor clase de limite, porque se lee como si estuviera puesto.
// ---------------------------------------------------------------------------

const unPlan = () => ({
  item: { id: "1", title: "h", level: "story", url: "u", provider: "fake" },
  repoScope: ["app"],
  tasks: [{
    id: "T1", repo: "app", title: "t", acceptance: "c",
    targetFiles: ["src/a.mjs"], testFiles: ["test/a.test.mjs"],
    tier: "small", dependsOn: [], dependencyKind: "hard",
  }],
});

test("el gasto se acumula en el recorrido, y sobrevive a releerlo del disco", () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-gasto-"));
  const run = createRun(unPlan(), { home });
  assert.deepEqual(run.spent, { usd: 0, calls: 0 });

  addSpend(run, { usd: 1.25, calls: 1 }, { home });
  addSpend(run, { usd: 2.5, calls: 1 }, { home });

  const disco = loadRun("1", { home });
  assert.equal(disco.spent.calls, 2);
  assert.ok(Math.abs(disco.spent.usd - 3.75) < 1e-9, `usd=${disco.spent.usd}`);
});

test("una invocacion que no informa costo cuenta igual como invocacion", () => {
  // Un contador que se queda en cero no es un contador. Si el proveedor del
  // modelo no devuelve el costo, el numero de invocaciones sigue siendo el
  // limite util — y es el que el driver ya usaba.
  const home = mkdtempSync(join(tmpdir(), "noxloop-gasto2-"));
  const run = createRun(unPlan(), { home });
  addSpend(run, { usd: null, calls: 1 }, { home });
  const disco = loadRun("1", { home });
  assert.equal(disco.spent.calls, 1);
  assert.equal(disco.spent.usd, 0);
});

test("el gasto no se puede bajar: un negativo es un error, no una correccion", () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-gasto3-"));
  const run = createRun(unPlan(), { home });
  addSpend(run, { usd: 5, calls: 1 }, { home });
  assert.throws(() => addSpend(run, { usd: -3, calls: 0 }, { home }), /negativ/i);
  assert.equal(loadRun("1", { home }).spent.usd, 5);
});

test("dos fases concurrentes no se pisan el gasto", () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-gasto4-"));
  const a = createRun(unPlan(), { home });
  const b = loadRun("1", { home });   // otra referencia, leida antes
  addSpend(a, { usd: 1, calls: 1 }, { home });
  addSpend(b, { usd: 2, calls: 1 }, { home });
  const disco = loadRun("1", { home });
  assert.equal(disco.spent.calls, 2, "una de las dos escrituras se perdio");
  assert.equal(disco.spent.usd, 3);
});

// ---------------------------------------------------------------------------
// 2. El cache de `makeResolve` era por repositorio.
//
// EL HUECO: un hito resuelve VARIAS ramas del mismo repositorio —la del hito y
// una por historia—, y un cache indexado solo por repositorio devuelve la
// primera para todas. La segunda historia habria trabajado en el worktree de la
// primera.
// ---------------------------------------------------------------------------

/**
 * Un repositorio con un remoto LOCAL de verdad.
 *
 * El remoto tiene que existir: `worktree.add` hace `git fetch origin <base>`
 * antes de crear el worktree, y contra un remoto inventado por SSH ese fetch se
 * queda esperando una conexion que no va a llegar. Un test que depende de la
 * red no es un test.
 */
function repoDePrueba() {
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-res-"));
  const remoto = join(raiz, "origin.git");
  mkdirSync(remoto);
  git(remoto, "init", "-q", "--bare", "-b", "main");

  const repo = join(raiz, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.test");
  git(repo, "config", "user.name", "T");
  git(repo, "remote", "add", "origin", remoto);
  writeFileSync(join(repo, "README.md"), "x\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  git(repo, "push", "-q", "origin", "main");
  return { raiz, repo, remoto };
}

test("dos ramas del MISMO repositorio resuelven a worktrees distintos", () => {
  const { raiz, repo, remoto } = repoDePrueba();
  const home = join(raiz, "home");
  const config = {
    home,
    repos: { app: { path: repo, remote: remoto, baseBranch: "main", gate: "true", env: {}, gaps: [] } },
  };

  const resolve = makeResolve(config, { home, item: { id: "9", title: "el hito" } });

  const a = resolve("app", { itemBranch: "epic/9-hito", baseBranch: "main" });
  const b = resolve("app", { itemBranch: "feature/10-historia", baseBranch: "epic/9-hito" });

  assert.notEqual(a.integrationPath, b.integrationPath, "las dos ramas cayeron en el mismo worktree");
  assert.equal(a.itemBranch, "epic/9-hito");
  assert.equal(b.itemBranch, "feature/10-historia");
  assert.equal(b.baseBranch, "epic/9-hito", "la historia nace de la rama del hito, no de la base");

  // Y el cache sigue sirviendo para lo que existe: la misma rama, la misma ruta.
  assert.equal(resolve("app", { itemBranch: "epic/9-hito" }).integrationPath, a.integrationPath);
});

test("cada worktree resuelto esta de verdad en su rama", () => {
  const { raiz, repo, remoto } = repoDePrueba();
  const home = join(raiz, "home");
  const config = {
    home,
    repos: { app: { path: repo, remote: remoto, baseBranch: "main", gate: "true", env: {}, gaps: [] } },
  };
  const resolve = makeResolve(config, { home, item: { id: "9", title: "el hito" } });
  const a = resolve("app", { itemBranch: "epic/9-hito", baseBranch: "main" });
  const b = resolve("app", { itemBranch: "feature/10-historia", baseBranch: "epic/9-hito" });

  assert.equal(git(a.integrationPath, "rev-parse", "--abbrev-ref", "HEAD"), "epic/9-hito");
  assert.equal(git(b.integrationPath, "rev-parse", "--abbrev-ref", "HEAD"), "feature/10-historia");
});
