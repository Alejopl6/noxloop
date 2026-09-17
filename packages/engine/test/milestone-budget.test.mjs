// El techo de gasto de un hito.
//
// EL FALLO QUE ESTE TECHO EVITA, y por que es por hito y no por invocacion: un
// techo por invocacion se midio como amputacion, no como ahorro. En un hito de
// 71 invocaciones, 13 aterrizaron entre $7,50 y $7,99 contra un techo de $8, se
// registraron como exit 0, y el trabajo cortado volvio como reintento que costo
// mas que lo que el techo ahorro. Un presupuesto que corta a mitad de una unidad
// indivisible y lo reporta como terminada es el verde inventado del principio II.
//
// Asi que lo que se prueba aca no es solo que el techo exista: es que el
// recorrido se detenga ENTRE historias, con la ultima entera.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { correrHito, leerHito } from "../src/milestone.mjs";

const git = (cwd, ...a) =>
  execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function escenario() {
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-techo-"));
  const repo = join(raiz, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.test");
  git(repo, "config", "user.name", "T");
  writeFileSync(join(repo, "README.md"), "base\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  return { raiz, repo, home: join(raiz, "home") };
}

function proveedor(hijos = ["2", "3", "4"]) {
  const items = {
    "1": { id: "1", key: "E-1", title: "Un hito con techo", level: "epic", url: "fake://1", parentId: null, acceptance: [], canonicalState: "todo", boardFields: null },
  };
  for (const h of hijos) {
    items[h] = { id: h, key: `H-${h}`, title: `La historia ${h}`, level: "story", url: `fake://${h}`, parentId: "1", acceptance: ["algo observable"], canonicalState: "todo", boardFields: null };
  }
  return {
    meta: { name: "gestor-de-mentira", version: "1.0.0" },
    capabilities: () => ({
      children: true, dependencies: false, createChild: false, setState: false, comment: false,
      linkUrl: false, labels: false, searchAssigned: false, searchMentioned: false, boardFields: false,
    }),
    getItem: async (id) => items[id] || null,
    children: async (id) => hijos.map((h) => items[h]).filter((x) => x.parentId === id),
  };
}

function hacerResolve(esc) {
  const cache = new Map();
  return (repo, opts = {}) => {
    const clave = `${repo}:${opts.itemBranch}`;
    if (cache.has(clave)) return cache.get(clave);
    const dest = join(esc.home, "worktrees", repo, opts.itemBranch.replace(/[^A-Za-z0-9]+/g, "_"));
    mkdirSync(join(dest, ".."), { recursive: true });
    // Reusar el worktree que ya existe es lo que hace el cableado de verdad, y
    // es lo que hace que relanzar un hito no intente crear dos veces la misma rama.
    if (!existsSync(dest)) {
      if (git(esc.repo, "branch", "--list", opts.itemBranch)) {
        git(esc.repo, "worktree", "add", "-q", dest, opts.itemBranch);
      } else {
        git(esc.repo, "worktree", "add", "-q", "-b", opts.itemBranch, dest, opts.baseBranch);
      }
    }
    const r = { repoPath: esc.repo, integrationPath: dest, itemBranch: opts.itemBranch, baseBranch: opts.baseBranch };
    cache.set(clave, r);
    return r;
  };
}

/** @param {{costo?: number, usdPlano?: string[]}} opts */
function depsBase(esc, registro, over = {}, opts = {}) {
  return {
    home: esc.home,
    config: {
      repos: { app: { remote: "git@x:o/app.git", baseBranch: "main", gate: "true" } },
      // Ancho 1 a proposito: el techo se comprueba ENTRE historias, y con una
      // sola en vuelo el punto de corte es inequivoco.
      limits: { maxParallelItems: 1 },
    },
    log: { info() {}, warn() {}, error() {}, child() { return this; } },
    provider: proveedor(),
    providerCtx: {},
    resolve: hacerResolve(esc),
    planItem: async (id) => {
      registro.push({ tipo: "plan", id });
      return { ok: true, tasks: 2, repos: ["app"] };
    },
    runItem: async (id, d) => {
      const rr = d.resolve("app");
      registro.push({ tipo: "run", id, techo: d.maxCostUsd, limites: d.limits });
      writeFileSync(join(rr.integrationPath, `${id}.txt`), `historia ${id}\n`);
      git(rr.integrationPath, "add", "-A");
      git(rr.integrationPath, "commit", "-q", "-m", `feat(app): la historia ${id}`);
      const salida = { item: id, pr: `http://forge/pr/${id}`, integrated: ["T1", "T2"], blocked: [] };
      if ((opts.usdPlano || []).includes(id)) return { ...salida, usd: 3 };
      return { ...salida, spent: { usd: opts.costo ?? 5, calls: 4 } };
    },
    ...over,
  };
}

const corridas = (registro) => registro.filter((x) => x.tipo === "run").map((x) => x.id);

// ---------------------------------------------------------------- el techo

test("al alcanzar el techo del hito el recorrido se detiene, con la ultima historia entera", async () => {
  const esc = escenario();
  const registro = [];

  const r = await correrHito("1", { ...depsBase(esc, registro), maxCostUsd: 8 });

  assert.equal(r.stoppedBy, "maxCostUsd");
  // La segunda arranco con $5 gastados y un techo de $8: se la deja terminar.
  // Cortarla a mitad costaria mas que lo que el techo ahorra, porque el
  // reintento rehace todo lo que quedo sin integrar.
  assert.deepEqual(corridas(registro), ["2", "3"]);
  assert.deepEqual(r.integrated, ["2", "3"]);
  assert.deepEqual(r.pending, ["4"], "la que no arranco queda pendiente, no bloqueada: nunca se intento");
  assert.deepEqual(r.blocked, []);
  assert.equal(r.spent.usd, 10);
  assert.equal(r.spent.calls, 8);
  assert.match(r.humano.join("\n"), /techo|8/);

  // Y la historia que si corrio quedo integrada de verdad en la rama del hito,
  // no a medias.
  const enHito = git(esc.repo, "log", "--format=%s", r.branch);
  assert.match(enHito, /la historia 3/);
});

test("el techo es del hito y NUNCA viaja a la invocacion de una historia", async () => {
  const esc = escenario();
  const registro = [];

  await correrHito("1", { ...depsBase(esc, registro), maxCostUsd: 8 });

  for (const c of registro.filter((x) => x.tipo === "run")) {
    assert.equal(c.techo, undefined, `la historia ${c.id} recibio un techo por invocacion`);
    assert.equal(c.limites, undefined);
  }
});

test("un techo ya alcanzado no arranca ninguna historia mas", async () => {
  const esc = escenario();
  const registro = [];
  await correrHito("1", { ...depsBase(esc, registro), maxCostUsd: 8 });

  const registro2 = [];
  const r = await correrHito("1", { ...depsBase(esc, registro2), maxCostUsd: 8 });

  assert.equal(r.stoppedBy, "maxCostUsd");
  assert.deepEqual(corridas(registro2), [], "relanzar con el mismo techo no gasta un centavo mas");
  assert.deepEqual(r.pending, ["4"]);
  assert.equal(r.spent.usd, 10, "el gasto ya consumido no se devuelve al relanzar");
});

test("subir el techo retoma donde quedo, sin repetir lo integrado", async () => {
  const esc = escenario();
  const registro = [];
  await correrHito("1", { ...depsBase(esc, registro), maxCostUsd: 8 });

  const registro2 = [];
  const r = await correrHito("1", { ...depsBase(esc, registro2), maxCostUsd: 20 });

  assert.deepEqual(corridas(registro2), ["4"]);
  assert.deepEqual(r.integrated, ["2", "3", "4"]);
  assert.equal(r.stoppedBy, null);
  assert.equal(r.spent.usd, 15);
});

test("sin techo declarado el recorrido no se detiene por gasto", async () => {
  const esc = escenario();
  const registro = [];

  const r = await correrHito("1", depsBase(esc, registro));

  assert.equal(r.stoppedBy, null);
  assert.deepEqual(corridas(registro), ["2", "3", "4"]);
  assert.equal(r.spent.usd, 15);
});

test("el gasto tambien se lee del costo plano que devuelve una corrida", async () => {
  const esc = escenario();
  const registro = [];

  const r = await correrHito("1", depsBase(esc, registro, {}, { usdPlano: ["2", "3", "4"] }));

  assert.equal(r.spent.usd, 9, "tres historias a $3 sin objeto `spent`");
  const m = leerHito("1", { home: esc.home });
  assert.equal(m.spent.usd, 9, "y queda en disco: un gasto que no se registra no existe");
});

test("alcanzar el techo exacto detiene el recorrido: alcanzarlo es alcanzarlo", async () => {
  const esc = escenario();
  const registro = [];
  const r = await correrHito("1", { ...depsBase(esc, registro), maxCostUsd: 10 });

  // Tres historias a $5: la tercera no arranca porque a esa altura ya hay $10
  // registrados en el archivo del hito, que es contra lo que se compara.
  assert.deepEqual(corridas(registro), ["2", "3"]);
  assert.equal(r.stoppedBy, "maxCostUsd");
  assert.equal(leerHito("1", { home: esc.home }).spent.usd, 10);
  assert.equal(readdirSync(join(esc.home, "milestones")).length, 1);
});
