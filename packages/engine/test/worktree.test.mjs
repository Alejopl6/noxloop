// Los espacios de trabajo, y lo que queda de ellos cuando un recorrido se corta.
//
// EL FALLO QUE ESTOS TESTS FIJAN, y es el que hace peligrosa la limpieza: un
// worktree sucio puede ser el UNICO lugar donde vive un cambio. Borrarlo no
// deja una tarea a medias: deja el trabajo perdido. Asi que la limpieza solo
// toca lo que no tiene nada que perder, y para el resto pide una decision.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as wt from "../src/worktree.mjs";
import { createRun, setTaskFields, setActiveTask, listActiveTasks } from "../src/state.mjs";
import { limpiarHuerfanos } from "../src/recovery.mjs";

const git = (cwd, ...a) =>
  execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const tarea = (id, over = {}) => ({
  id, repo: "app", title: `tarea ${id}`, acceptance: `criterio de ${id}`,
  targetFiles: [`src/${id}.mjs`], testFiles: [`test/${id}.test.mjs`],
  tier: "small", dependsOn: [], dependencyKind: "hard", ...over,
});

const plan = (itemId, tasks) => ({
  item: { id: itemId, key: `H-${itemId}`, title: "la historia", level: "story",
          url: "http://g/1", provider: "fake", acceptance: ["hace lo que promete"] },
  repoScope: ["app"],
  tasks,
});

/** Un repositorio de verdad, desechable, con la rama del item ya creada. */
function escenario() {
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-wt-"));
  const repo = join(raiz, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.test");
  git(repo, "config", "user.name", "T");
  writeFileSync(join(repo, "README.md"), "base\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  git(repo, "branch", "feature/1-historia");
  const home = join(raiz, "home");
  // Los worktrees del motor viven bajo el home, como los crea el driver.
  const bajoElHome = (nombre) => join(home, "worktrees", "app", nombre);
  return { raiz, repo, home, bajoElHome };
}

const ensuciar = (ruta, texto = "a medias\n") => writeFileSync(join(ruta, "sucio.txt"), texto);

/**
 * OTRO proceso, vivo, con el lock de un recorrido tomado.
 *
 * Tiene que ser un proceso de verdad: `lock.mjs` decide si un lock esta vivo
 * preguntandole al sistema operativo por el pid, asi que un lock escrito a mano
 * con un pid inventado prueba lo contrario de lo que hace falta.
 */
async function otroProcesoConElLock(home, recurso) {
  const rutaLock = fileURLToPath(new URL("../src/lock.mjs", import.meta.url));
  const guion =
    `const { acquire } = await import(${JSON.stringify(rutaLock)});\n` +
    `if (!acquire(${JSON.stringify(recurso)}, { home: ${JSON.stringify(home)} }).ok) process.exit(9);\n` +
    `console.log("tomado");\nsetInterval(() => {}, 1000);\n`;
  const hijo = spawn(process.execPath, ["--input-type=module", "-e", guion], { stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((listo, fallo) => {
    hijo.stdout.on("data", (d) => String(d).includes("tomado") && listo());
    hijo.on("exit", (c) => fallo(new Error(`el proceso que tenia que tomar el lock murio (${c})`)));
  });
  return hijo;
}

// ------------------------------------------------------ lectura del registro

test("list dice la rama, si el directorio existe y si el registro quedo podable", () => {
  const esc = escenario();
  const dest = esc.bajoElHome("1-T1");
  wt.add(esc.repo, { branch: "task/1-T1", base: "main", dest, fetch: false });

  const antes = wt.list(esc.repo);
  const mio = antes.find((w) => w.path.endsWith("1-T1"));
  assert.equal(mio.branch, "task/1-T1", "la rama, sin el refs/heads/");
  assert.equal(mio.exists, true);
  assert.equal(mio.prunable, null);

  // Alguien borro el directorio a mano: el registro de git sigue apuntando ahi.
  rmSync(dest, { recursive: true, force: true });
  const despues = wt.list(esc.repo).find((w) => w.path.endsWith("1-T1"));
  assert.equal(despues.exists, false);
  assert.ok(despues.prunable, "git declara el registro podable, y list lo pasa tal cual");
});

test("changes enumera lo que quedo sin commitear, no solo si hay algo", () => {
  const esc = escenario();
  const dest = esc.bajoElHome("1-T1");
  wt.add(esc.repo, { branch: "task/1-T1", base: "main", dest, fetch: false });

  assert.deepEqual(wt.changes(dest), []);
  assert.equal(wt.isDirty(dest), false);

  ensuciar(dest);
  const cambios = wt.changes(dest);
  assert.equal(cambios.length, 1);
  assert.equal(cambios[0].path, "sucio.txt");
  assert.equal(cambios[0].status, "??");
  assert.equal(wt.isDirty(dest), true);
  // Enumerarlos es lo que permite decir QUE se perderia, en vez de "hay cambios".
  assert.deepEqual(wt.changes(join(esc.raiz, "no-existe")), []);
});

// ------------------------------------- 5. el huerfano, y el trabajo que guarda

test("findOrphans no llama huerfano al worktree que el estado declara vivo, aunque git escriba otra grafia de la ruta", () => {
  const esc = escenario();
  const vivo = esc.bajoElHome("1-T1");
  const añadido = wt.add(esc.repo, { branch: "task/1-T1", base: "main", dest: vivo, fetch: false });

  // EL FALLO QUE ESTO FIJA, y es el mismo que ya se midio en el puntero de
  // tarea activa: en macOS el temporal es /var/folders/... y su ruta real es
  // /private/var/folders/... El estado guarda la grafia con la que se creo el
  // worktree y git informa la real. Comparando textos, el worktree de una
  // tarea EN CURSO aparecia como huerfano — y limpio, asi que la limpieza lo
  // borraba con la tarea trabajando adentro.
  const huerfanos = wt.findOrphans(esc.repo, [añadido.path]);
  assert.deepEqual(huerfanos.map((h) => h.path), [], `un worktree vivo quedo como huerfano: ${JSON.stringify(huerfanos)}`);
});

test("findOrphans detecta el worktree que ningun recorrido reclama, y dice si esta sucio", () => {
  const esc = escenario();
  const limpio = esc.bajoElHome("9-T9");
  const sucio = esc.bajoElHome("9-T8");
  wt.add(esc.repo, { branch: "task/9-T9", base: "main", dest: limpio, fetch: false });
  wt.add(esc.repo, { branch: "task/9-T8", base: "main", dest: sucio, fetch: false });
  ensuciar(sucio);

  const huerfanos = wt.findOrphans(esc.repo, []);
  assert.equal(huerfanos.length, 2);
  assert.equal(huerfanos.find((h) => h.path.endsWith("9-T9")).dirty, false);
  assert.equal(huerfanos.find((h) => h.path.endsWith("9-T8")).dirty, true);
  // El checkout principal nunca es un huerfano.
  assert.ok(!huerfanos.some((h) => h.path.endsWith("/repo")));
});

test("findOrphans con `under` no mira lo que el motor no creo", () => {
  const esc = escenario();
  // El worktree de integracion, o el de una persona: vive fuera del home.
  const ajeno = join(esc.raiz, "wt-de-una-persona");
  git(esc.repo, "worktree", "add", "-q", ajeno, "feature/1-historia");
  const mio = esc.bajoElHome("9-T9");
  wt.add(esc.repo, { branch: "task/9-T9", base: "main", dest: mio, fetch: false });

  const todos = wt.findOrphans(esc.repo, []).map((h) => h.path);
  assert.equal(todos.length, 2, "sin acotar, los dos parecen huerfanos");

  const acotados = wt.findOrphans(esc.repo, [], { under: join(esc.home, "worktrees") });
  assert.equal(acotados.length, 1);
  assert.ok(acotados[0].path.endsWith("9-T9"), "solo el que creo el motor");
});

test("remove sin force se niega con un worktree sucio, y con force lo descarta", () => {
  const esc = escenario();
  const dest = esc.bajoElHome("1-T1");
  wt.add(esc.repo, { branch: "task/1-T1", base: "main", dest, fetch: false });
  ensuciar(dest);

  assert.throws(() => wt.remove(esc.repo, dest), /sin commitear|force/i);
  assert.ok(existsSync(dest), "y no lo toco");

  wt.remove(esc.repo, dest, { force: true });
  assert.equal(existsSync(dest), false);
});

test("limpiarHuerfanos quita el huerfano limpio y CONSERVA el sucio, diciendo por que", () => {
  const esc = escenario();
  const vivo = esc.bajoElHome("1-T1");
  wt.add(esc.repo, { branch: "task/1-T1", base: "main", dest: vivo, fetch: false });
  const run = createRun(plan("1", [tarea("T1")]), { home: esc.home });
  setTaskFields(run, "T1", { worktree: vivo, branch: "task/1-T1" }, { home: esc.home });

  const limpio = esc.bajoElHome("9-T9");
  const sucio = esc.bajoElHome("9-T8");
  wt.add(esc.repo, { branch: "task/9-T9", base: "main", dest: limpio, fetch: false });
  wt.add(esc.repo, { branch: "task/9-T8", base: "main", dest: sucio, fetch: false });
  ensuciar(sucio, "el unico lugar donde vive este cambio\n");

  const r = limpiarHuerfanos({ home: esc.home, repoPath: esc.repo });

  assert.deepEqual(r.limpiados.map((x) => x.path.endsWith("9-T9")), [true], "se fue el limpio");
  assert.equal(existsSync(limpio), false);
  assert.equal(existsSync(sucio), true, "el sucio sigue ahi: sin force no se descarta trabajo");
  assert.equal(readFileSync(join(sucio, "sucio.txt"), "utf8"), "el unico lugar donde vive este cambio\n");
  const conservado = r.conservados.find((x) => x.path.endsWith("9-T8"));
  assert.match(conservado.motivo, /sin commitear|sucio/i);
  assert.ok(conservado.cambios.some((c) => c.path === "sucio.txt"), "dice que se perderia");
  assert.equal(existsSync(vivo), true, "el worktree de un recorrido vivo no se toca");
});

test("limpiarHuerfanos con force descarta el sucio, y solo entonces", () => {
  const esc = escenario();
  const sucio = esc.bajoElHome("9-T8");
  wt.add(esc.repo, { branch: "task/9-T8", base: "main", dest: sucio, fetch: false });
  ensuciar(sucio);

  const r = limpiarHuerfanos({ home: esc.home, repoPath: esc.repo, force: true });
  assert.equal(existsSync(sucio), false);
  assert.deepEqual(r.conservados, []);
  assert.ok(r.limpiados.some((x) => x.forzado === true), "queda registrado que se descarto trabajo");
});

test("limpiarHuerfanos poda el registro de un worktree cuyo directorio ya no esta", () => {
  const esc = escenario();
  const dest = esc.bajoElHome("9-T9");
  wt.add(esc.repo, { branch: "task/9-T9", base: "main", dest, fetch: false });
  rmSync(dest, { recursive: true, force: true });

  const r = limpiarHuerfanos({ home: esc.home, repoPath: esc.repo });
  assert.ok(r.podados.some((p) => p.endsWith("9-T9")), `no lo podo: ${JSON.stringify(r)}`);
  // `git worktree remove` no sirve para esto: el directorio no existe y falla.
  // Sin poda, el registro queda sucio para siempre y `worktree add` se niega a
  // reusar la ruta.
  assert.ok(!wt.list(esc.repo).some((w) => w.path.endsWith("9-T9")));
});

test("limpiarHuerfanos no toca nada que viva fuera del home: no es suyo", () => {
  const esc = escenario();
  const ajeno = join(esc.raiz, "wt-de-una-persona");
  git(esc.repo, "worktree", "add", "-q", ajeno, "feature/1-historia");

  const r = limpiarHuerfanos({ home: esc.home, repoPath: esc.repo });
  assert.equal(existsSync(ajeno), true);
  assert.deepEqual(r.limpiados, []);
  assert.ok(!r.conservados.some((c) => c.path === ajeno), "ni lo considera");
});

// ------------------------------- 6. el puntero de tarea activa que quedo solo

test("limpiarHuerfanos borra el puntero de tarea activa cuyo recorrido ya no existe", () => {
  const esc = escenario();
  createRun(plan("1", [tarea("T1")]), { home: esc.home });
  setActiveTask("1", "T1", { home: esc.home, worktree: esc.bajoElHome("1-T1") });
  // Este es el huerfano: su recorrido no esta en disco.
  setActiveTask("77", "T3", { home: esc.home, worktree: esc.bajoElHome("77-T3") });

  const r = limpiarHuerfanos({ home: esc.home, repoPath: esc.repo });

  const quedan = listActiveTasks({ home: esc.home });
  assert.deepEqual(quedan.map((p) => p.itemId), ["1"], "sobrevive el del recorrido que existe");
  assert.ok(r.punteros.limpiados.some((p) => p.itemId === "77"));
  // EL FALLO QUE EVITA: el hook resuelve el puntero contra su recorrido. Con uno
  // que apunta a un recorrido inexistente y otro valido, `activeTaskFull` no
  // puede elegir y devuelve null — la guarda de orden y la de alcance se
  // apartan justo cuando tenian que actuar.
  assert.match(r.punteros.limpiados[0].motivo, /recorrido/i);
});

test("limpiarHuerfanos borra el puntero que apunta a una tarea que el plan no tiene", () => {
  const esc = escenario();
  createRun(plan("1", [tarea("T1")]), { home: esc.home });
  setActiveTask("1", "T9", { home: esc.home, worktree: esc.bajoElHome("1-T9") });

  const r = limpiarHuerfanos({ home: esc.home, repoPath: esc.repo });
  assert.deepEqual(listActiveTasks({ home: esc.home }), []);
  assert.match(r.punteros.limpiados[0].motivo, /tarea/i);
});

test("limpiarHuerfanos conserva el puntero de un recorrido corrupto: ahi no se decide solo", () => {
  const esc = escenario();
  createRun(plan("1", [tarea("T1")]), { home: esc.home });
  writeFileSync(join(esc.home, "runs", "run-1.json"), "{ esto no es json");
  setActiveTask("1", "T1", { home: esc.home, worktree: esc.bajoElHome("1-T1") });

  const r = limpiarHuerfanos({ home: esc.home, repoPath: esc.repo });
  assert.equal(listActiveTasks({ home: esc.home }).length, 1, "un recorrido ilegible no es un recorrido ausente");
  assert.ok(r.punteros.conservados.some((p) => /corrupto|ilegible/i.test(p.motivo)));
});

// ------------------------- 7. lo que la limpieza NO puede decidir por su cuenta

test("limpiarHuerfanos conserva el worktree que git declara bloqueado, y termina el resto de la limpieza", () => {
  const esc = escenario();
  const bloqueado = esc.bajoElHome("9-T8");
  wt.add(esc.repo, { branch: "task/9-T8", base: "main", dest: bloqueado, fetch: false });
  git(esc.repo, "worktree", "lock", "--reason", "una persona lo bloqueo a mano", bloqueado);
  const limpio = esc.bajoElHome("9-T9");
  wt.add(esc.repo, { branch: "task/9-T9", base: "main", dest: limpio, fetch: false });

  // EL FALLO QUE EVITA, medido con un `git worktree lock` de verdad: `git
  // worktree remove` sale con error sobre uno bloqueado, la excepcion se
  // escapaba de `limpiarHuerfanos` y el llamador no recibia NADA — ni el
  // reporte de los worktrees que la misma pasada ya habia borrado. Un comando
  // de limpieza que revienta a mitad y no dice que borro es peor que uno que no
  // limpia.
  const r = limpiarHuerfanos({ home: esc.home, repoPath: esc.repo });

  assert.equal(existsSync(bloqueado), true, "un `lock` de git es alguien diciendo explicitamente que no se toque");
  const conservado = r.conservados.find((x) => x.path.endsWith("9-T8"));
  assert.ok(conservado, `no lo reporto como conservado: ${JSON.stringify(r)}`);
  assert.match(conservado.motivo, /bloquead|lock/i);
  assert.ok(r.limpiados.some((x) => x.path.endsWith("9-T9")), "y el resto de la limpieza ocurrio igual");
  assert.equal(existsSync(limpio), false);
});

test("limpiarHuerfanos no borra nada mientras otro proceso tiene el lock de un recorrido", async () => {
  const esc = escenario();
  createRun(plan("1", [tarea("T1")]), { home: esc.home });
  // Este worktree no lo reclama ningun recorrido... TODAVIA. El driver lo crea
  // con `git worktree add` y escribe la ruta en el estado DESPUES: entre las
  // dos cosas hay una ventana en la que el worktree de una tarea viva parece un
  // huerfano limpio, y un huerfano limpio se borra sin preguntar.
  //
  // EL FALLO QUE EVITA, medido: con el recorrido colgado dentro de `addWorktree`
  // en otro proceso, esta limpieza le borro el espacio de trabajo a la tarea que
  // el otro proceso estaba abriendo.
  const enVentana = esc.bajoElHome("1-T1");
  wt.add(esc.repo, { branch: "task/1-T1", base: "main", dest: enVentana, fetch: false });

  const otro = await otroProcesoConElLock(esc.home, "run-1");
  try {
    const r = limpiarHuerfanos({ home: esc.home, repoPath: esc.repo });
    assert.equal(existsSync(enVentana), true, "no se limpia alrededor de un recorrido que esta corriendo");
    assert.deepEqual(r.limpiados, []);
    const conservado = r.conservados.find((x) => x.path.endsWith("1-T1"));
    assert.match(conservado.motivo, /otro proceso|corriendo|lock/i);
  } finally {
    otro.kill("SIGKILL");
  }
});
