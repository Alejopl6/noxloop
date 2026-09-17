// El recorrido de un hito: de una aprobacion a N historias cerradas.
//
// TODO ESTO CORRE SIN RED, SIN CREDENCIALES Y SIN MODELO. El proveedor es un
// objeto de mentira, `planItem` y `runItem` entran inyectados, y los
// repositorios son repositorios de git de verdad pero desechables. Es a
// proposito: el orden, las exclusiones, el paralelismo y la contabilidad son
// justo lo que no se puede verificar gastando un modelo cada vez.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquire } from "../src/lock.mjs";
import {
  prepararHito, correrHito, leerHito, reporteDeHito, anotarEnHito, milestoneFile,
} from "../src/milestone.mjs";

const git = (cwd, ...a) =>
  execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// ------------------------------------------------------------- el escenario

/** Un repositorio de verdad, con su rama base y un home vacio. */
function escenario() {
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-hito-"));
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

const HIJOS_POR_DEFECTO = ["2", "3", "4"];

/**
 * Un gestor de mentira. Lo que importa de el son dos cosas: que declare sus
 * capacidades, y que registre si le preguntaron por las dependencias — el motor
 * no puede consultarlas cuando dice que no las tiene.
 */
function proveedor(registro, { hijos = HIJOS_POR_DEFECTO, dependencies = true, deps = {}, niveles = {} } = {}) {
  const items = {
    "1": { id: "1", key: "E-1", title: "Unificar el recorrido", level: "epic", url: "fake://1", parentId: null, acceptance: [], canonicalState: "todo", boardFields: null },
  };
  for (const h of hijos) {
    items[h] = {
      id: h, key: `H-${h}`, title: `La historia ${h}`, level: niveles[h] || "story",
      url: `fake://${h}`, parentId: "1", acceptance: ["algo observable"], canonicalState: "todo", boardFields: null,
    };
  }
  return {
    meta: { name: "gestor-de-mentira", version: "1.0.0" },
    capabilities: () => ({
      children: true, dependencies, createChild: false, setState: true, comment: true,
      linkUrl: false, labels: false, searchAssigned: false, searchMentioned: false, boardFields: false,
    }),
    getItem: async (id) => items[id] || null,
    children: async (id) => hijos.map((h) => items[h]).filter(Boolean).filter((x) => x.parentId === id),
    dependencies: async (id) => {
      registro.push({ tipo: "deps", id });
      return { predecessors: deps[id] || [], successors: [] };
    },
    setState: async (id, estado) => {
      registro.push({ tipo: "setState", id, estado });
      return { written: estado };
    },
    comment: async (id, texto) => {
      registro.push({ tipo: "comment", id, texto });
      return { id: "c1" };
    },
  };
}

/**
 * El `resolve` que el cableado le da al hito: resuelve SIEMPRE con rama y base
 * explicitas, y crea el worktree de esa rama naciendo de esa base. El cache es
 * por (repo, rama) y no por repo: un hito resuelve varias ramas del mismo
 * repositorio —la suya y una por historia— y un cache por repo devolveria la
 * del hito a todas.
 */
function hacerResolve(esc, registro) {
  const cache = new Map();
  return (repo, opts = {}) => {
    assert.ok(opts.itemBranch, "el hito resuelve siempre con la rama explicita");
    assert.ok(opts.baseBranch, "el hito resuelve siempre con la base explicita");
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
    registro.push({ tipo: "resolve", repo, rama: opts.itemBranch, base: opts.baseBranch });
    cache.set(clave, r);
    return r;
  };
}

/**
 * Un `runItem` de mentira que SI hace el trabajo: commitea sobre la rama de la
 * historia, como haria la cola de integracion del driver, y anota que veia en su
 * worktree al arrancar. Eso ultimo es la marca observable de si arranco sobre
 * trabajo ya integrado o sobre la base pelada.
 */
function runItemQueCumple(registro, { sinPr = [], costo = null, usdPlano = [] } = {}) {
  let enVuelo = 0;
  const marca = { maxSimultaneas: 0 };
  const fn = async (id, d) => {
    enVuelo += 1;
    marca.maxSimultaneas = Math.max(marca.maxSimultaneas, enVuelo);
    const rr = d.resolve("app");
    registro.push({
      tipo: "run", id, rama: rr.itemBranch, base: rr.baseBranch,
      veia: readdirSync(rr.integrationPath).filter((f) => f.endsWith(".txt")).sort(),
      techo: d.maxCostUsd, milestoneId: d.milestoneId,
    });
    // Cede el turno del bucle de eventos: sin esto dos historias "en paralelo"
    // se ejecutarian una despues de la otra y el test no probaria nada.
    await new Promise((r) => setTimeout(r, 5));
    enVuelo -= 1;
    if (sinPr.includes(id)) {
      return { item: id, pr: null, integrated: [], blocked: ["T1"], reason: "ninguna de las 2 tareas llego a terminar" };
    }
    writeFileSync(join(rr.integrationPath, `${id}.txt`), `historia ${id}\n`);
    git(rr.integrationPath, "add", "-A");
    git(rr.integrationPath, "commit", "-q", "-m", `feat(app): la historia ${id}`);
    const salida = { item: id, pr: `http://forge/pr/${id}`, integrated: ["T1", "T2"], blocked: [] };
    if (usdPlano.includes(id)) return { ...salida, usd: 3 };
    if (costo != null) return { ...salida, spent: { usd: costo, calls: 2 } };
    return salida;
  };
  fn.marca = marca;
  return fn;
}

function depsBase(esc, registro, over = {}) {
  return {
    home: esc.home,
    config: {
      repos: { app: { remote: "git@x:o/app.git", baseBranch: "main", gate: "true" } },
      limits: { maxParallelItems: 2 },
    },
    log: { info() {}, warn() {}, error() {}, child() { return this; } },
    provider: over.provider || proveedor(registro),
    providerCtx: {},
    resolve: hacerResolve(esc, registro),
    planItem: async (id, d) => {
      registro.push({ tipo: "plan", id, notes: d.notes || [], workdir: d.workdir, milestoneId: d.milestoneId });
      return { ok: true, tasks: 2, repos: ["app"] };
    },
    runItem: over.runItem || runItemQueCumple(registro),
    ...over,
  };
}

const ids = (registro, tipo) => registro.filter((x) => x.tipo === tipo).map((x) => x.id);
const orden = (registro) => registro.filter((x) => x.tipo === "run" || x.tipo === "plan").map((x) => `${x.tipo}:${x.id}`);

// ------------------------------------- 1. el orden sale de las dependencias

test("el orden sale de las dependencias que el gestor afirma", async () => {
  const esc = escenario();
  const registro = [];
  const deps = depsBase(esc, registro, { provider: proveedor(registro, { deps: { 3: ["2"], 4: ["3"] } }) });

  const r = await prepararHito("1", deps);

  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.orden, ["2", "3", "4"]);
  assert.equal(r.ordenSegun, "dependencias-del-gestor");
  assert.deepEqual(r.dependencias, { 3: ["2"], 4: ["3"] });
});

test("prepararHito muestra el recorrido y no ejecuta NADA: es el punto de aprobacion", async () => {
  const esc = escenario();
  const registro = [];
  const r = await prepararHito("1", depsBase(esc, registro));

  assert.equal(r.ok, true);
  assert.deepEqual(ids(registro, "plan"), [], "no planifico ninguna historia");
  assert.deepEqual(ids(registro, "run"), [], "no ejecuto ninguna historia");
  assert.equal(registro.filter((x) => x.tipo === "resolve").length, 0, "no creo ninguna rama ni worktree");
  assert.equal(leerHito("1", { home: esc.home }), null, "no escribio estado: mostrar no es arrancar");
  assert.ok(r.humano.join("\n").length > 0, "pero deja algo que una persona pueda leer y aprobar");
});

test("un ciclo entre las historias se rechaza nombrando el ciclo, antes de arrancar", async () => {
  const esc = escenario();
  const registro = [];
  const deps = depsBase(esc, registro, { provider: proveedor(registro, { deps: { 2: ["3"], 3: ["2"] } }) });

  const r = await prepararHito("1", deps);

  assert.equal(r.ok, false);
  assert.match(r.problemas.join(" "), /2 -> 3|3 -> 2/);
});

// --------------------------- 1b. sin soporte de dependencias, se serializa

test("sin soporte de dependencias se serializa, queda declarado, y no se consulta al gestor", async () => {
  const esc = escenario();
  const registro = [];
  const deps = depsBase(esc, registro, {
    provider: proveedor(registro, { hijos: ["4", "2", "3"], dependencies: false, deps: { 3: ["2"] } }),
  });

  const r = await prepararHito("1", deps);

  assert.equal(r.ok, true);
  assert.equal(r.ordenSegun, "serializado");
  assert.deepEqual(r.orden, ["4", "2", "3"], "el orden es el que devolvio el gestor, no uno deducido");
  assert.deepEqual(r.dependencias, {}, "no se inventa ninguna arista");
  assert.equal(r.paralelismo, 1, "serializar es correr de a una, aunque el limite configurado sea 2");
  assert.match(r.notas.join("\n"), /dependencies/, "la serializacion queda DECLARADA en el recorrido");
  assert.deepEqual(registro.filter((x) => x.tipo === "deps"), [], "nunca se le pregunta lo que declaro no saber");
});

// ------------------------------- 2. --skip y --only, antes de arrancar

test("--skip queda declarado antes de arrancar, y arrastra a quien dependia de lo excluido", async () => {
  const esc = escenario();
  const registro = [];
  const deps = depsBase(esc, registro, { provider: proveedor(registro, { deps: { 4: ["3"] } }) });

  const r = await prepararHito("1", { ...deps, skip: ["3"] });

  assert.equal(r.ok, true);
  assert.deepEqual(r.orden, ["2"], "solo queda lo que se puede recorrer");
  const excluida = r.skipped.find((s) => s.id === "3");
  assert.match(excluida.why, /--skip/);
  // Dejar a la 4 dentro solo consigue que se bloquee a mitad del recorrido:
  // ningun driver puede resolver una dependencia que no entro.
  const arrastrada = r.skipped.find((s) => s.id === "4");
  assert.match(arrastrada.why, /3/);
  assert.match(arrastrada.why, /depende|excluida/i);
});

test("una historia excluida no la toca ningun driver, y sigue excluida al relanzar", async () => {
  const esc = escenario();
  const registro = [];
  const deps = depsBase(esc, registro);

  const r = await correrHito("1", { ...deps, skip: ["3"] });

  assert.equal(r.ok, true);
  assert.deepEqual(ids(registro, "plan").sort(), ["2", "4"]);
  assert.deepEqual(ids(registro, "run").sort(), ["2", "4"]);
  assert.ok(r.skipped.some((s) => s.id === "3"));

  // Relanzar SIN la bandera no la vuelve a meter: la razon por la que se excluyo
  // —depende de algo que ningun driver puede resolver— sigue siendo cierta.
  const registro2 = [];
  const r2 = await correrHito("1", depsBase(esc, registro2));
  assert.deepEqual(ids(registro2, "run"), [], "no arranco ninguna: la excluida sigue excluida");
  assert.ok(r2.skipped.some((s) => s.id === "3"));
});

test("--only recorta esta corrida y deja al resto pendiente, sin excluirlo", async () => {
  const esc = escenario();
  const registro = [];
  const deps = depsBase(esc, registro);

  const r = await correrHito("1", { ...deps, only: ["2"] });

  assert.deepEqual(ids(registro, "run"), ["2"]);
  assert.deepEqual(r.integrated, ["2"]);
  assert.deepEqual(r.pending.sort(), ["3", "4"], "no son exclusiones: no entraron en ESTA corrida");
  assert.deepEqual(r.skipped, []);

  const registro2 = [];
  await correrHito("1", depsBase(esc, registro2));
  assert.deepEqual(ids(registro2, "run").sort(), ["3", "4"], "y la corrida siguiente las toma");
});

test("un id que no existe en --skip se dice antes de arrancar, no se ignora", async () => {
  const esc = escenario();
  const registro = [];
  const r = await prepararHito("1", { ...depsBase(esc, registro), skip: ["99"] });

  assert.equal(r.ok, false);
  assert.match(r.problemas.join(" "), /99/);
});

// ------------------------------------------------ 3. la rama del hito

test("la rama del hito nace de la base declarada y cada historia integra sobre ella", async () => {
  const esc = escenario();
  const registro = [];
  const deps = depsBase(esc, registro, {
    provider: proveedor(registro, { hijos: ["2", "3"], deps: { 3: ["2"] } }),
  });
  const mainAntes = git(esc.repo, "rev-parse", "main");

  const r = await correrHito("1", deps);

  assert.equal(r.ok, true);
  assert.match(r.branch, /^milestone\/1-/);
  assert.equal(r.repo, "app");
  assert.equal(r.baseBranch, "main");
  assert.equal(git(esc.repo, "merge-base", "main", r.branch), mainAntes, "nace de la base declarada");
  assert.equal(git(esc.repo, "rev-parse", "main"), mainAntes, "y la base no se movio ni un commit");

  // Las dos historias terminaron integradas EN la rama del hito.
  const enHito = git(esc.repo, "log", "--format=%s", r.branch);
  assert.match(enHito, /la historia 2/);
  assert.match(enHito, /la historia 3/);
  assert.deepEqual(r.integrated, ["2", "3"]);

  // Los PRs de las historias apuntan a la rama del hito, no a la base: es la
  // base con la que el driver resuelve el destino del PR.
  for (const c of registro.filter((x) => x.tipo === "run")) {
    assert.equal(c.base, r.branch, `la historia ${c.id} tendria que apuntar a la rama del hito`);
    assert.notEqual(c.rama, r.branch, "cada historia tiene su propia rama");
  }

  // Y la segunda arranco SOBRE trabajo ya integrado, que es la razon de que la
  // rama del hito exista.
  const segunda = registro.find((x) => x.tipo === "run" && x.id === "3");
  assert.deepEqual(segunda.veia, ["2.txt"]);
});

test("la rama del hito vive en UN repositorio: con varios declarados hay que decir cual", async () => {
  const esc = escenario();
  const registro = [];
  const deps = depsBase(esc, registro);
  deps.config.repos.otro = { remote: "git@x:o/otro.git", baseBranch: "main", gate: "true" };

  const r = await prepararHito("1", deps);

  assert.equal(r.ok, false);
  assert.match(r.reason, /repositorio/i);
});

// ------------------------------------------------- 4. paralelismo acotado

test("las historias independientes corren en paralelo hasta maxParallelItems", async () => {
  const esc = escenario();
  const registro = [];
  const run = runItemQueCumple(registro);
  const deps = depsBase(esc, registro, {
    provider: proveedor(registro, { hijos: ["2", "3", "4", "5"] }),
    runItem: run,
  });

  const r = await correrHito("1", deps);

  assert.deepEqual(r.integrated.sort(), ["2", "3", "4", "5"]);
  assert.equal(run.marca.maxSimultaneas, 2, "dos a la vez: el limite configurado, ni una mas");
  // Las cuatro terminaron en la rama del hito, tambien las que no pudieron
  // integrar con fast-forward porque la punta se movio debajo.
  const enHito = readdirSync(join(esc.home, "worktrees", "app", r.branch.replace(/[^A-Za-z0-9]+/g, "_")))
    .filter((f) => f.endsWith(".txt")).sort();
  assert.deepEqual(enHito, ["2.txt", "3.txt", "4.txt", "5.txt"]);
});

test("una dependencia dura no arranca hasta que la anterior esta integrada", async () => {
  const esc = escenario();
  const registro = [];
  const run = runItemQueCumple(registro);
  const deps = depsBase(esc, registro, {
    provider: proveedor(registro, { hijos: ["2", "3"], deps: { 3: ["2"] } }),
    runItem: run,
    config: {
      repos: { app: { remote: "git@x:o/app.git", baseBranch: "main", gate: "true" } },
      limits: { maxParallelItems: 4 },
    },
  });

  await correrHito("1", deps);

  assert.equal(run.marca.maxSimultaneas, 1, "el ancho no puede pasar por encima del orden");
  assert.deepEqual(orden(registro), ["plan:2", "run:2", "plan:3", "run:3"]);
});

test("un conflicto al integrar no contamina la rama del hito, y el relanzamiento lo retoma", async () => {
  const esc = escenario();
  const registro = [];
  // Las dos historias tocan LA MISMA linea del mismo archivo: es el conflicto de
  // verdad, no uno simulado.
  const enConflicto = async (id, d) => {
    const rr = d.resolve("app");
    registro.push({ tipo: "run", id, wt: rr.integrationPath });
    await new Promise((r) => setTimeout(r, 5));
    writeFileSync(join(rr.integrationPath, "compartido.txt"), `lo escribio ${id}\n`);
    git(rr.integrationPath, "add", "-A");
    git(rr.integrationPath, "commit", "-q", "-m", `feat(app): la historia ${id}`);
    return { item: id, pr: `http://forge/pr/${id}`, integrated: ["T1"], blocked: [] };
  };
  const deps = depsBase(esc, registro, {
    provider: proveedor(registro, { hijos: ["2", "3"] }),
    runItem: enConflicto,
  });

  const r = await correrHito("1", deps);

  assert.equal(r.integrated.length, 1, "la primera entro");
  assert.equal(r.prOpen.length, 1, "la segunda quedo con su PR abierto y sin integrar");
  assert.match(r.prOpen[0].reason, /no entro|CONFLICT/i);

  // La rama del hito quedo EXACTAMENTE con lo que entro: un rechazo no contamina.
  const wtHito = join(esc.home, "worktrees", "app", r.branch.replace(/[^A-Za-z0-9]+/g, "_"));
  const contenido = readFileSync(join(wtHito, "compartido.txt"), "utf8");
  assert.equal(contenido, `lo escribio ${r.integrated[0]}\n`);
  assert.equal(git(wtHito, "status", "--porcelain"), "", "y el worktree del hito no quedo a medias de una mezcla");

  // Alguien resuelve el conflicto en la rama de la historia rechazada.
  const rechazada = r.prOpen[0].id;
  const wt = registro.find((x) => x.tipo === "run" && x.id === rechazada).wt;
  try {
    git(wt, "merge", "--no-commit", r.branch);
  } catch {
    /* conflictua, que es justamente el escenario */
  }
  writeFileSync(join(wt, "compartido.txt"), `lo escribieron las dos\n`);
  git(wt, "add", "-A");
  git(wt, "commit", "-q", "-m", "fix(app): conflicto resuelto a mano");

  const registro2 = [];
  const r2 = await correrHito("1", depsBase(esc, registro2, {
    provider: proveedor(registro2, { hijos: ["2", "3"] }),
    runItem: enConflicto,
  }));

  assert.deepEqual(ids(registro2, "run"), [], "no se vuelve a gastar una invocacion: el trabajo ya estaba hecho");
  assert.deepEqual(r2.integrated.sort(), ["2", "3"]);
  assert.deepEqual(r2.prOpen, []);
});

/** Dos historias que escriben LA MISMA linea del mismo archivo. */
function runItemEnConflicto(registro) {
  return async (id, d) => {
    const rr = d.resolve("app");
    registro.push({ tipo: "run", id, wt: rr.integrationPath });
    await new Promise((r) => setTimeout(r, 5));
    writeFileSync(join(rr.integrationPath, "compartido.txt"), `lo escribio ${id}\n`);
    git(rr.integrationPath, "add", "-A");
    git(rr.integrationPath, "commit", "-q", "-m", `feat(app): la historia ${id}`);
    return { item: id, pr: `http://forge/pr/${id}`, integrated: ["T1"], blocked: [] };
  };
}

test("una historia con el PR abierto y sin integrar no habilita a la que dependia de ella", async () => {
  const esc = escenario();
  const registro = [];
  const deps = depsBase(esc, registro, {
    provider: proveedor(registro, { hijos: ["2", "3", "4"], deps: { 4: ["2", "3"] } }),
    runItem: runItemEnConflicto(registro),
  });

  const r = await correrHito("1", deps);

  assert.equal(r.integrated.length, 1, "una de las dos entro");
  assert.equal(r.prOpen.length, 1, "la otra quedo con el PR abierto y su trabajo sin integrar");
  // Nadie ramifica sobre trabajo no integrado: la 4 habria nacido de una rama
  // que no tiene el trabajo de la que la precede, y el conflicto reaparece al
  // final en vez de al principio. Es el fallo de las catorce ramas encadenadas.
  assert.deepEqual(ids(registro, "run").sort(), ["2", "3"], "la 4 no arranco");
  assert.deepEqual(r.unreachable.map((u) => u.id), ["4"]);
  assert.deepEqual(r.unreachable[0].porque, [r.prOpen[0].id]);
});

// ------------------------------------- 5. bloqueada vs inalcanzable

test("una historia bloqueada no detiene el hito, y quien dependia de ella queda inalcanzable", async () => {
  const esc = escenario();
  const registro = [];
  const deps = depsBase(esc, registro, {
    provider: proveedor(registro, { deps: { 3: ["2"] } }),
    runItem: runItemQueCumple(registro, { sinPr: ["2"] }),
  });

  const r = await correrHito("1", deps);

  assert.deepEqual(r.integrated, ["4"], "el hito siguio con lo que no dependia de la que fallo");
  assert.deepEqual(r.blocked.map((b) => b.id), ["2"]);
  assert.match(r.blocked[0].reason, /ninguna de las 2 tareas/);
  assert.deepEqual(r.unreachable.map((u) => u.id), ["3"], "nunca pudo intentarse: no es lo mismo que haber fallado");
  assert.deepEqual(r.unreachable[0].porque, ["2"], "y se dice por quien");
  assert.deepEqual(ids(registro, "run").sort(), ["2", "4"], "la inalcanzable no se intento");

  // Las dos categorias sobreviven al proceso: el reporte final solo sirve si las
  // distingue, y se lee del disco.
  const m = leerHito("1", { home: esc.home });
  assert.equal(m.items.find((i) => i.id === "2").status, "blocked");
  assert.equal(m.items.find((i) => i.id === "3").status, "unreachable");
  const leido = reporteDeHito("1", { home: esc.home });
  assert.deepEqual(leido.blocked.map((b) => b.id), ["2"]);
  assert.deepEqual(leido.unreachable.map((u) => u.id), ["3"]);
  assert.match(leido.humano.join("\n"), /inalcanzable/i);
  assert.match(leido.humano.join("\n"), /bloquead/i);
});

// ------------------------------------------- 6. las notas, canal de vuelta

test("la pregunta de la planificacion entra a las notas, y la respuesta vuelve por ahi", async () => {
  const esc = escenario();
  const registro = [];
  const pregunta = "¿el recorrido incluye los terceros sin perfil?";
  const deps = depsBase(esc, registro, {
    provider: proveedor(registro, { hijos: ["2"] }),
    planItem: async (id, d) => {
      registro.push({ tipo: "plan", id, notes: d.notes || [] });
      return { ok: false, reason: "falta un criterio verificable", question: pregunta };
    },
  });

  const r = await correrHito("1", deps);

  assert.deepEqual(r.integrated, []);
  assert.deepEqual(r.blocked.map((b) => b.id), ["2"]);
  assert.match(r.blocked[0].reason, /terceros sin perfil/);
  assert.deepEqual(ids(registro, "run"), [], "no se ejecuta una historia que no se pudo planificar");

  const m = leerHito("1", { home: esc.home });
  const it = m.items.find((i) => i.id === "2");
  assert.equal(it.esperandoRespuesta, true);
  assert.match(it.notes.at(-1).texto, /terceros sin perfil/);

  // La respuesta entra por la nota, y eso solo la reabre.
  anotarEnHito("1", "2", "si, los terceros sin perfil entran", { home: esc.home, de: "humano" });
  assert.equal(leerHito("1", { home: esc.home }).items.find((i) => i.id === "2").status, "pending");

  const registro2 = [];
  const r2 = await correrHito("1", depsBase(esc, registro2, { provider: proveedor(registro2, { hijos: ["2"] }) }));

  const replan = registro2.find((x) => x.tipo === "plan" && x.id === "2");
  assert.ok(replan, "se replanifica");
  assert.match(
    replan.notes.map((n) => n.texto).join("\n"),
    /los terceros sin perfil entran/,
    "y la planificacion recibe la respuesta: las notas son el canal de vuelta, no un adorno",
  );
  assert.deepEqual(r2.integrated, ["2"]);
});

// ------------------------------------------------------ 8. retomable

test("relanzar no repite una historia integrada ni pierde el avance", async () => {
  const esc = escenario();
  const registro = [];
  const deps = depsBase(esc, registro, { provider: proveedor(registro, { hijos: ["2", "3"] }) });

  const primera = await correrHito("1", { ...deps, maxItems: 1 });
  assert.equal(primera.stoppedBy, "maxItems");
  assert.deepEqual(primera.integrated, ["2"]);
  assert.deepEqual(primera.pending, ["3"]);

  const registro2 = [];
  const segunda = await correrHito("1", depsBase(esc, registro2, { provider: proveedor(registro2, { hijos: ["2", "3"] }) }));

  assert.deepEqual(ids(registro2, "plan"), ["3"], "no replanifica la que ya esta integrada");
  assert.deepEqual(ids(registro2, "run"), ["3"], "ni la vuelve a ejecutar");
  assert.deepEqual(segunda.integrated.sort(), ["2", "3"]);
  assert.equal(segunda.spent.calls > primera.spent.calls, true, "el gasto se acumula entre corridas");
});

test("una historia que quedo en vuelo de un recorrido matado se retoma", async () => {
  const esc = escenario();
  const registro = [];
  const deps = depsBase(esc, registro, { provider: proveedor(registro, { hijos: ["2"] }) });

  await correrHito("1", { ...deps, maxItems: 0 });
  const archivo = milestoneFile(esc.home, "1");
  const m = JSON.parse(readFileSync(archivo, "utf8"));
  assert.equal(m.items[0].status, "pending");
  // Como si el proceso hubiera muerto con la historia en curso.
  m.items[0].status = "running";
  writeFileSync(archivo, JSON.stringify(m, null, 2));

  const registro2 = [];
  const r = await correrHito("1", depsBase(esc, registro2, { provider: proveedor(registro2, { hijos: ["2"] }) }));

  assert.deepEqual(r.integrated, ["2"], "se retoma en vez de quedar en vuelo para siempre");
  assert.deepEqual(ids(registro2, "run"), ["2"]);
});

// ----------------------------------------------------- el gestor y el lock

test("el ticket del hito se mueve hacia adelante y nunca se cierra", async () => {
  const esc = escenario();
  const registro = [];
  const deps = depsBase(esc, registro, { provider: proveedor(registro, { hijos: ["2"] }) });

  await correrHito("1", deps);

  const escritos = registro.filter((x) => x.tipo === "setState").map((x) => x.estado);
  assert.deepEqual(escritos, ["in_progress", "in_review"]);

  // Relanzar un hito terminado no devuelve el ticket a "en curso": el tablero
  // pasaria a mentir en la direccion mas confusa, como si el trabajo volviera a
  // empezar.
  const registro2 = [];
  await correrHito("1", depsBase(esc, registro2, { provider: proveedor(registro2, { hijos: ["2"] }) }));
  assert.deepEqual(registro2.filter((x) => x.tipo === "setState"), []);
});

test("dos procesos no recorren el mismo hito a la vez", async () => {
  const esc = escenario();
  const registro = [];
  mkdirSync(esc.home, { recursive: true });
  const tomado = acquire("milestone-1", { home: esc.home });
  assert.equal(tomado.ok, true);

  await assert.rejects(() => correrHito("1", depsBase(esc, registro)), /hito 1|lock|proceso/i);
  assert.deepEqual(ids(registro, "run"), []);
  tomado.release();
});

test("un item que no es hito no se recorre como hito", async () => {
  const esc = escenario();
  const registro = [];
  const deps = depsBase(esc, registro, {
    provider: proveedor(registro, { hijos: ["2"], niveles: { 2: "story" } }),
  });

  const r = await prepararHito("2", deps);
  assert.equal(r.ok, false);
  assert.match(r.reason, /story|nivel/i);
});

test("un gestor que no sabe leer hijos lo dice antes de arrancar, no a mitad", async () => {
  const esc = escenario();
  const registro = [];
  const p = proveedor(registro, { hijos: ["2"] });
  const deps = depsBase(esc, registro, {
    provider: { ...p, capabilities: () => ({ ...p.capabilities(), children: false }) },
  });

  const r = await prepararHito("1", deps);
  assert.equal(r.ok, false);
  assert.match(r.reason, /children/);
  assert.equal(existsSync(join(esc.home, "milestones")), false);
});
