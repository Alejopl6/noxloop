// T035 — El limite de autonomia, de punta a punta.
//
// Este es el test que el proyecto NO se publica sin pasar. Es la unica promesa
// cuyo incumplimiento no lastima a noxloop sino al repositorio de otra persona:
// noxloop NO mergea a una rama protegida, NO despliega, y NO hace force push.
// El principio IV de la constitucion lo declara; este archivo lo vuelve
// verificable, y lo mira desde los tres unicos angulos por los que la promesa
// se puede romper en silencio:
//
//   A. la INTERCEPTACION real — el hook corriendo como subproceso, leyendo el
//      JSON por stdin y contestando con un exit code, que es la forma en la que
//      lo invoca de verdad una sesion. `hooks.test.mjs` prueba `decide()` como
//      funcion, que es la forma que NO usa una sesion.
//
//      Reparto con `hook-cli.test.mjs`, que tambien invoca los hooks como
//      ejecutable: alli se prueba el CABLEADO —stdin, exit 2, el motivo por
//      stderr— para los cuatro hooks, con un comando de muestra cada uno. Aca
//      se prueba la COBERTURA del limite: el inventario de formas en las que
//      los tres verbos prohibidos se pueden escribir, por el camino real. Son
//      dos preguntas distintas y las dos se pueden romper sola.
//
//   B. la AUSENCIA DE CAMINO — que el motor no tenga codigo capaz de hacerlo,
//      con o sin hook. El hook es la segunda linea; la primera es que la
//      operacion no exista. `constitution.test.mjs` ya recorre el fuente con
//      regexes de TEXTO; aca se reusa su criterio (mismo caminador, mismo
//      despojado de comentarios) y se le tapa el hueco que deja: el motor no
//      escribe comandos como frases, los escribe como arreglos de argumentos
//      —`execFileSync("git", ["push", "--force"])`— y ninguna regex de texto
//      plano encuentra eso.
//
//   C. la DISTINCION — que la guarda sepa que el `git merge --ff-only` de la
//      cola de integracion NO es una violacion. Integra a la rama del ticket,
//      no a una protegida. Un test que no los distingue bloquearia el propio
//      mecanismo de integracion, y entonces noxloop no entrega nada. Una guarda
//      que bloquea de mas se apaga, y una guarda apagada no protege.
//
// Y el cierre: un recorrido COMPLETO del driver, sobre un repositorio git de
// verdad, que termina con la rama base exactamente donde estaba.
//
// EL FALLO QUE ESTE ARCHIVO ENCONTRO AL ESCRIBIRSE: `git -C <ruta> push --force
// origin main` pasaba el hook sin que nadie lo frenara. El hook leia `args[0]`
// esperando el subcomando y encontraba `-C`, que no es `push` ni `merge`, asi
// que devolvia ALLOW. Un solo flag global de git —`-C`, `-c`, `--git-dir`—
// desarmaba el limite entero, y el flag no es exotico: la propia cola de
// integracion de este motor invoca a git con `-C`. Por eso los casos con
// prefijo global estan aca abajo, al lado de los desnudos.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRun, loadRun, setActiveTask } from "../src/state.mjs";
import { runItem } from "../src/driver.mjs";

const HOOK = new URL("../src/hooks/no-prod-writes.mjs", import.meta.url).pathname;
const RAIZ = new URL("../../../", import.meta.url).pathname;
const MOTOR = new URL("../", import.meta.url).pathname;

const git = (cwd, ...a) =>
  execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// ---------------------------------------------------------------------------
// A. La interceptacion, por el camino que usa Claude Code de verdad
// ---------------------------------------------------------------------------

const tarea = (id, over = {}) => ({
  id, repo: "app", title: `tarea ${id}`, acceptance: `criterio de ${id}`,
  targetFiles: [`src/${id}.mjs`], testFiles: [`test/${id}.test.mjs`],
  tier: "small", dependsOn: [], dependencyKind: "hard", ...over,
});

/** Un NOXLOOP_HOME con una tarea activa: sin eso el hook se aparta, y bien. */
/**
 * @param {Array<object>} [tasks]
 * @param {string[]} [allowedCommands] lo que el repositorio declara necesitar.
 *   Desde la enmienda 1.1.0 de la constitucion el shell es denegar por defecto
 *   dentro de una tarea, asi que un escenario sin esta lista prueba una tarea
 *   que no puede correr NADA — util para un caso, enganioso para el resto.
 */
function homeConTareaActiva(tasks = [tarea("T001")], allowedCommands = ["npm", "node", "pnpm"]) {
  const home = mkdtempSync(join(tmpdir(), "noxloop-autonomy-"));
  createRun({
    item: { id: "42", key: "H-42", title: "la historia", level: "story", url: "http://g/42", provider: "fake" },
    repoScope: ["app"],
    tasks,
  }, { home });
  setActiveTask("42", "T001", { home, allowedCommands });
  return home;
}

/**
 * Invoca el hook como lo invoca Claude Code: proceso aparte, el evento por
 * stdin, la decision en el exit code. Exit 2 bloquea y el motivo va por stderr,
 * que es lo que el modelo lee. Exit 0 permite.
 *
 * Correrlo como subproceso y no como funcion es el punto de este bloque: es el
 * unico modo de probar que el `responder()` del final del archivo esta
 * enganchado. Con `decide()` perfecto y esa linea rota, el hook permite todo.
 */
function interceptar(comando, home) {
  const entrada = JSON.stringify({ tool_name: "Bash", tool_input: { command: comando } });
  try {
    execFileSync("node", [HOOK], {
      input: entrada,
      encoding: "utf8",
      env: { ...process.env, NOXLOOP_HOME: home },
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { exitCode: 0, motivo: "" };
  } catch (e) {
    return { exitCode: e.status, motivo: `${e.stderr || ""}`.trim() };
  }
}

test("A1 — mergear a una rama protegida queda interceptado en el subproceso, en todas sus formas", () => {
  const home = homeConTareaActiva();
  for (const cmd of [
    "gh pr merge 7 --squash",              // el merge del PR: la decision humana
    "gh pr merge 7 --admin --delete-branch",
    "glab pr merge 7",
    "git merge main",                      // el merge local a la rama protegida
    "git merge origin/main",
    "git merge staging",
    "git push origin main",                // publicar en la protegida
    "git push origin HEAD:refs/heads/production",
    "npm test && gh pr merge 7",           // encadenado
  ]) {
    const r = interceptar(cmd, home);
    assert.equal(r.exitCode, 2, `no lo intercepto: ${cmd}`);
    assert.match(r.motivo, /noxloop bloqueo/, `bloqueo sin explicarse: ${cmd}`);
    // El motivo tiene que servirle al modelo para cambiar de plan, no solo
    // negarse: un "no" sin causa produce un reintento identico.
    assert.ok(r.motivo.length > 40, `motivo demasiado corto para ser util: ${cmd} -> ${r.motivo}`);
  }
});

test("A2 — el force push queda interceptado, tambien hacia una rama que no es protegida", () => {
  const home = homeConTareaActiva();
  for (const cmd of [
    "git push --force origin main",
    "git push -f origin main",
    "git push --force-with-lease origin main",
    // Reescribir la historia de la rama de la tarea tampoco esta disponible:
    // otra persona ya puede tener ese PR abierto en su pantalla.
    "git push --force origin task/42-T001",
    "cd /tmp; git push --force origin main",
  ]) {
    const r = interceptar(cmd, home);
    assert.equal(r.exitCode, 2, `no lo intercepto: ${cmd}`);
    assert.match(r.motivo, /force push|historia/i, `motivo que no nombra el fallo: ${cmd}`);
  }
});

test("A3 — desplegar queda interceptado: ningun entorno remoto cambia desde un recorrido", () => {
  const home = homeConTareaActiva();
  for (const cmd of [
    "kubectl apply -f k8s/prod.yaml",
    "kubectl rollout restart deployment/api",
    "terraform apply -auto-approve",
    "terraform destroy",
    "helm upgrade api ./chart",
    "docker compose -f docker-compose.prod.yml up -d",
    "systemctl restart api",
    "pm2 restart api",
    "npm publish",
    // ssh es el caso peor: lo que pase del otro lado es exactamente lo que
    // ningun hook puede vigilar, asi que se corta antes de salir.
    "ssh deploy@vps 'bash deploy.sh'",
    "rsync -az dist/ deploy@vps:/srv/app/",
  ]) {
    const r = interceptar(cmd, home);
    assert.equal(r.exitCode, 2, `no lo intercepto: ${cmd}`);
    assert.match(r.motivo, /noxloop bloqueo/, `bloqueo sin explicarse: ${cmd}`);
  }
});

test("A4 — un flag global de git no desarma la guarda", () => {
  // EL FALLO CONCRETO, encontrado escribiendo este test: el hook buscaba el
  // subcomando en `args[0]`, y `git -C /x push --force origin main` pone `-C`
  // ahi. El limite entero se caia con un flag que la propia cola de integracion
  // de este motor usa en cada invocacion a git.
  const home = homeConTareaActiva();
  for (const cmd of [
    "git -C /tmp/wt push --force origin main",
    "git -C /tmp/wt merge main",
    "git --git-dir=/tmp/wt/.git push origin main",
    "git --git-dir /tmp/wt/.git push --force origin main",
    "git -c user.name=x push --force origin main",
    "git --no-pager push --force origin main",
    "git -P -C /tmp/wt push -f origin master",
    "git --work-tree=/tmp/wt -C /tmp push --force origin main",
  ]) {
    const r = interceptar(cmd, home);
    assert.equal(r.exitCode, 2, `el prefijo global la desarmo: ${cmd}`);
  }
});

test("A5 — el trabajo legitimo pasa: una guarda que bloquea de mas se apaga", () => {
  const home = homeConTareaActiva();
  for (const cmd of [
    "git push origin task/42-T001",          // publicar la rama de la tarea: es como nace el PR
    "git -C /tmp/wt push origin task/42-T001",
      "npm test",
    "git log --oneline origin/main",
    "grep -rn 'gh pr merge' docs/",
    "echo 'nunca corras git push --force origin main'",
    // Una RUTA que se llama como una rama protegida no es una rama protegida.
    "git -C /repos/main push origin task/42-T001",
  ]) {
    const r = interceptar(cmd, home);
    assert.equal(r.exitCode, 0, `bloqueo de mas: ${cmd} -> ${r.motivo}`);
  }
});

test("A5b — abrir el PR desde una sesion de tarea se rechaza: lo abre el motor", () => {
  // Cambio con la enmienda 1.1.0 de la constitucion. Antes `gh pr create` era
  // trabajo legitimo; con el shell en denegar por defecto, no lo es — y no por
  // un descuido: el PR lo abre `forge.mjs` desde el proceso del motor, con el
  // cuerpo armado a partir del estado. Un modelo que abre su propio PR se
  // saltea la maquina de estados y el cuerpo deja de ser comparable.
  const home = homeConTareaActiva();
  const r = interceptar("gh pr create --base main --head task/42-T001 --title t --body b", home);
  assert.equal(r.exitCode, 2, "el PR lo abre el motor, no una sesion de tarea");
  assert.match(r.motivo, /denegar por defecto|no esta permitido/i);
});

test("A6 — sin recorrido activo el hook se aparta: la sesion de una persona no es su asunto", () => {
  // Los hooks corren en cada operacion de la sesion, tambien cuando noxloop no
  // esta. Un hook que decide sin recorrido activo le quita a una persona el
  // control de su propio repositorio, que es peor que el problema que evita.
  const vacio = mkdtempSync(join(tmpdir(), "noxloop-autonomy-vacio-"));
  const r = interceptar("git push --force origin main", vacio);
  assert.equal(r.exitCode, 0, "el hook decidio sobre una sesion que no era de noxloop");
});

// ---------------------------------------------------------------------------
// B. El motor no tiene ninguna ruta de codigo capaz de hacerlo
// ---------------------------------------------------------------------------

// Mismo caminador que `constitution.test.mjs`: fuente del motor, sin
// `node_modules` y sin los tests.
function fuentes(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e === "node_modules" || e === "test") continue;
      fuentes(p, acc);
    } else if (e.endsWith(".mjs")) {
      acc.push(p);
    }
  }
  return acc;
}

const DEL_MOTOR = () => [...fuentes(join(MOTOR, "src")), ...fuentes(join(MOTOR, "bin"))];

// Mismo criterio que `constitution.test.mjs`: los comentarios NO cuentan. Los
// comentarios de este motor explican los fallos que cada mecanismo evita, y
// explicar un force push exige escribir "force push". Ese comentario es la
// documentacion del principio IV, no una violacion.
const codigo = (f) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * El fuente aplanado a una linea. Es lo que permite encontrar la operacion
 * escrita como ARREGLO DE ARGUMENTOS partido en varias lineas, que es como la
 * escribe este motor y lo que una regex de texto plano no ve.
 */
const plano = (f) => codigo(f).replace(/\s+/g, " ");

const PROTEGIDAS = ["main", "master", "staging", "production", "prod", "release"];

// Este es el corazon del detector: la juntura entre el verbo y su argumento,
// permisiva en comillas, comas y corchetes. Cubre a la vez la frase
// (`git push --force`) y el arreglo (`execFileSync("git", ["push", "--force"])`),
// que son la misma operacion escrita de dos maneras. Sin los corchetes en la
// clase, `["apply", ...]` no se encuentra — y ese es justo el hueco que dejaba
// la version de texto plano de esta guarda.
const J = `[\\s"',(\\[\\])]{0,6}`;

const VERBOS_PROHIBIDOS = [
  { nombre: "force push", re: new RegExp(`\\bpush${J}(?:--force\\b|--force-with-lease\\b|-f\\b)`) },
  { nombre: "force push (flag al final)", re: new RegExp(`(?:--force|--force-with-lease)${J}\\bpush\\b`) },
  { nombre: "merge del PR", re: new RegExp(`\\bpr${J}merge\\b`) },
  { nombre: "merge a rama protegida", re: new RegExp(`\\bmerge\\b[^;]{0,60}?["'](?:origin/|refs/heads/)?(?:${PROTEGIDAS.join("|")})["']`) },
  { nombre: "push a rama protegida", re: new RegExp(`\\bpush\\b[^;]{0,60}?["'](?:\\+?HEAD:)?(?:origin/|refs/heads/)?(?:${PROTEGIDAS.join("|")})["']`) },
  // Pararse en la rama base es el primer paso del merge local en dos tiempos
  // (`checkout main` y despues `merge`), que ninguna regex de proximidad puede
  // ver como una sola operacion. Se corta el primer paso, que no tiene ningun
  // uso legitimo dentro de una tarea: el trabajo vive en un worktree aparte,
  // sobre la rama de la tarea.
  { nombre: "checkout de la rama protegida", re: new RegExp(`\\b(?:checkout|switch)${J}["'](?:origin/)?(?:${PROTEGIDAS.join("|")})["']`) },
  { nombre: "kubectl", re: new RegExp(`\\bkubectl${J}(?:apply|delete|patch|scale|rollout|replace|drain)\\b`) },
  { nombre: "terraform", re: new RegExp(`\\bterraform${J}(?:apply|destroy)\\b`) },
  { nombre: "helm", re: new RegExp(`\\bhelm${J}(?:install|upgrade|uninstall|rollback)\\b`) },
  { nombre: "systemctl", re: new RegExp(`\\bsystemctl${J}(?:restart|stop|start|reload)\\b`) },
  { nombre: "pm2", re: new RegExp(`\\bpm2${J}(?:restart|reload|deploy)\\b`) },
  { nombre: "publish", re: new RegExp(`\\b(?:npm|pnpm|yarn)${J}publish\\b`) },
  { nombre: "docker deploy", re: new RegExp(`\\bdocker(?:-compose)?\\b[^;]{0,40}?["']deploy["']`) },
];

/** @returns {string[]} los verbos prohibidos que aparecen en este fuente */
function verbosEn(texto) {
  return VERBOS_PROHIBIDOS.filter((v) => v.re.test(texto)).map((v) => v.nombre);
}

test("B1 — el motor no tiene ninguna ruta de codigo que mergee, despliegue ni fuerce un push", () => {
  const hallazgos = [];
  for (const f of DEL_MOTOR()) {
    // El hook que las PROHIBE necesita nombrarlas para prohibirlas: es el unico
    // lugar legitimo del motor donde estas cadenas pueden aparecer.
    if (f.includes("/hooks/")) continue;
    for (const v of verbosEn(plano(f))) hallazgos.push(`${f.replace(RAIZ, "")}: ${v}`);
  }
  assert.deepEqual(hallazgos, [], `la autonomia se paso del PR:\n${hallazgos.join("\n")}`);
});

test("B2 — el detector no es vacio: encuentra las tres formas en las que se escribiria", () => {
  // Sin esto, B1 pasaria igual con las regexes rotas, y un test que no puede
  // fallar es exactamente el verde inventado que la constitucion prohibe.
  // Los tres pares son: frase de shell, arreglo de argumentos, y arreglo
  // partido en varias lineas — las tres maneras reales de escribirlo en este
  // motor, que invoca a git con `execFileSync` y un arreglo.
  const debenCaer = [
    ['execSync("git push --force origin main")', "force push"],
    ['execFileSync("git", ["push", "--force", "origin", "main"])', "force push"],
    ['execFileSync("git", [\n  "push",\n  "--force-with-lease",\n])', "force push"],
    ['spawnSync("gh", ["pr", "merge", num])', "merge del PR"],
    ['exec("gh pr merge 7 --squash")', "merge del PR"],
    ['git(wt, ["merge", "--no-ff", "main"])', "merge a rama protegida"],
    ['git(wt, ["merge", "origin/staging"])', "merge a rama protegida"],
    ['git(wt, ["push", "origin", "production"])', "push a rama protegida"],
    ['run("kubectl", ["apply", "-f", manifiesto])', "kubectl"],
    ['run("terraform apply -auto-approve")', "terraform"],
    ['run("helm", ["upgrade", nombre, chart])', "helm"],
    ['run("npm", ["publish"])', "publish"],
    ['run("docker", ["stack", "deploy", stack])', "docker deploy"],
  ];
  for (const [fragmento, esperado] of debenCaer) {
    const encontrados = verbosEn(plano2(fragmento));
    assert.ok(
      encontrados.includes(esperado),
      `el detector no vio "${esperado}" en: ${fragmento} (vio: ${encontrados.join(", ") || "nada"})`,
    );
  }
});

/** El mismo aplanado que `plano`, para fragmentos en memoria. */
const plano2 = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s+/g, " ");

test("B3 — el detector ignora los comentarios, que es donde el motor explica los fallos", () => {
  // Si los comentarios contaran, la unica salida seria dejar de documentar el
  // fallo que cada mecanismo evita — y esa memoria es la parte del proyecto
  // mas dificil de reconstruir.
  assert.deepEqual(verbosEn(plano2("// nunca corras git push --force origin main\nconst x = 1;")), []);
  assert.deepEqual(verbosEn(plano2("/* un `gh pr merge` aca seria un incidente */\nconst y = 2;")), []);
});

// ---------------------------------------------------------------------------
// C. La cola de integracion NO es una violacion, y la guarda lo sabe
// ---------------------------------------------------------------------------

test("C1 — el `merge --ff-only` real de la cola de integracion no cuenta como violacion", () => {
  const cola = join(MOTOR, "src/merge-queue.mjs");
  const texto = plano(cola);
  // Primero: confirmar que estamos mirando el archivo que de verdad mergea. Sin
  // esto, el test pasaria porque la cola cambio de nombre y ya no se revisa
  // nada — y entonces el `deepEqual([])` de abajo no diria nada.
  assert.match(texto, /"merge", "--ff-only"/, "la cola ya no integra con fast-forward: revisar este test");
  assert.deepEqual(
    verbosEn(texto), [],
    "el detector marco el mecanismo de integracion como violacion: asi bloquearia la unica forma que tiene noxloop de entregar",
  );
});

test("C2 — el detector distingue integrar a la rama del ticket de mergear a una protegida", () => {
  // Este par es la razon de ser del bloque. Un test que no los distingue es
  // inutil en las dos direcciones: o deja pasar el merge a main, o prohibe el
  // fast-forward y el recorrido no entrega nunca.
  const legitimo = [
    'git(integrationPath, ["merge", "--ff-only", task.branch])',
    'git(integrationPath, ["merge", "--ff-only", `task/${run.item.id}-${task.id}`])',
    'git(task.worktree, ["rebase", itemBranch])',
    'git(integrationPath, ["merge", "--ff-only", itemBranch])',
  ];
  for (const f of legitimo) {
    assert.deepEqual(verbosEn(plano2(f)), [], `bloquearia la integracion: ${f}`);
  }

  const prohibido = [
    'git(repoPath, ["merge", "--ff-only", "main"])',
    'git(repoPath, ["merge", "--no-ff", "origin/staging"])',
    // El merge local en dos tiempos: la segunda mitad es indistinguible de una
    // integracion legitima, asi que lo que se detecta es la primera.
    'git(repoPath, ["checkout", "main"]); git(repoPath, ["merge", task.branch])',
    'git(repoPath, ["push", "origin", "HEAD:main"])',
  ];
  for (const f of prohibido) {
    assert.notDeepEqual(verbosEn(plano2(f)), [], `dejaria pasar una operacion prohibida: ${f}`);
  }
  // La diferencia no es el flag: es el DESTINO. `--ff-only` hacia main sigue
  // siendo mover una rama de la que depende otra gente.
  assert.ok(verbosEn(plano2('["merge", "--ff-only", "main"]')).includes("merge a rama protegida"));
});

test("C3 — el hook deja correr el comando exacto de la cola, y frena el mismo verbo hacia una protegida", () => {
  const home = homeConTareaActiva();
  // El comando textual que arma `merge-queue.mjs` en el paso 3.
  assert.equal(
    interceptar("git merge --ff-only task/42-T001", home).exitCode, 0,
    "el hook bloquea la propia cola de integracion: noxloop no podria entregar nada",
  );
  assert.equal(interceptar("git merge --ff-only itemBranch", home).exitCode, 0);
  // Y el mismo verbo, un destino distinto.
  assert.equal(interceptar("git merge --ff-only main", home).exitCode, 2, "un ff-only a main sigue siendo un merge a protegida");
  assert.equal(interceptar("git merge --ff-only origin/master", home).exitCode, 2);
});

// ---------------------------------------------------------------------------
// D. Un recorrido completo deja la rama base del repositorio intacta
// ---------------------------------------------------------------------------

// Mismo armado de repositorio git desechable que `driver.test.mjs`: repositorio
// de verdad, rama del item y worktree de integracion. Lo que cambia es lo que
// se mide al final.
function escenario(tasks = [tarea("T1")]) {
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-autonomy-drv-"));
  const repo = join(raiz, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.test");
  git(repo, "config", "user.name", "T");
  mkdirSync(join(repo, "src"));
  mkdirSync(join(repo, "test"));
  writeFileSync(join(repo, "README.md"), "base\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");

  const itemBranch = "feature/1-historia";
  git(repo, "branch", itemBranch);
  const integracion = join(raiz, "wt-int");
  git(repo, "worktree", "add", "-q", integracion, itemBranch);

  const home = join(raiz, "home");
  createRun({
    item: { id: "1", key: "H-1", title: "la historia", level: "story", url: "http://g/1", provider: "fake",
            acceptance: ["el sistema hace lo que promete"] },
    repoScope: ["app"],
    tasks,
  }, { home });

  return { raiz, repo, integracion, itemBranch, home };
}

/** Un modelo de mentira que SI hace el trabajo: test en RED, codigo en GREEN. */
function modeloQueCumple(registro) {
  return async (opts) => {
    registro.push({ fase: opts.phase, tarea: opts.taskId });
    const wt = opts.cwd;
    const t = opts.task;
    if (opts.phase === "RED") {
      mkdirSync(join(wt, "test"), { recursive: true });
      writeFileSync(join(wt, t.testFiles[0]),
        `import { valor } from "../${t.targetFiles[0]}";\nif (valor !== 42) throw new Error("rojo");\n`);
    }
    if (opts.phase === "GREEN") {
      mkdirSync(join(wt, "src"), { recursive: true });
      writeFileSync(join(wt, t.targetFiles[0]), "export const valor = 42;\n");
    }
    return { ok: true, sessionId: `s-${t.id}`, budgetExhausted: false, text: "listo" };
  };
}

function runSingleTestReal(repo, cwd, file) {
  try {
    execFileSync("node", ["--input-type=module", "-e", `await import("file://${join(cwd, file)}")`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, exitCode: 0, command: `node ${file}`, durationMs: 5, output: "", timedOut: false, gaps: [] };
  } catch (e) {
    return { ok: false, exitCode: 1, command: `node ${file}`, durationMs: 5,
             output: `${e.stdout || ""}${e.stderr || ""}`, timedOut: false, gaps: [] };
  }
}

function depsBase(esc, registro, over = {}) {
  return {
    config: { repos: { app: { gate: "true", fastGate: "true", baseBranch: "main", env: {}, gaps: [],
                              remote: "git@x:o/app.git", runners: { node: "node {file}" } } } },
    home: esc.home,
    runPhase: modeloQueCumple(registro),
    runSingleTest: runSingleTestReal,
    runGate: () => ({ ok: true, exitCode: 0, command: "true", durationMs: 10, output: "ok", timedOut: false, gaps: [] }),
    createPR: async () => ({ url: "http://forge/pr/1", alreadyExisted: false, body: "cuerpo" }),
    resolve: () => ({ repoPath: esc.repo, integrationPath: esc.integracion,
                      itemBranch: esc.itemBranch, baseBranch: "main" }),
    provider: null,
    maxParallelTasks: 4,
    log: { info() {}, warn() {}, error() {}, child() { return this; } },
    ...over,
  };
}

test("D1 — un recorrido completo mueve la rama del ticket y deja la rama base donde estaba", async () => {
  const esc = escenario([tarea("T1"), tarea("T2")]);
  const baseAntes = git(esc.repo, "rev-parse", "main");
  const itemAntes = git(esc.repo, "rev-parse", esc.itemBranch);
  const reflogAntes = git(esc.repo, "reflog", "show", "main", "--format=%H").split("\n").filter(Boolean).length;

  const registro = [];
  const r = await runItem("1", depsBase(esc, registro));

  // Primero: el recorrido de verdad HIZO el trabajo. Sin esto, "la base quedo
  // intacta" seria cierto por no haber pasado nada, y el test no diria nada.
  assert.deepEqual(r.integrated, ["T1", "T2"], "el recorrido no integro nada: la medicion de abajo seria vacia");
  assert.equal(r.pr, "http://forge/pr/1");
  const itemDespues = git(esc.repo, "rev-parse", esc.itemBranch);
  assert.notEqual(itemDespues, itemAntes, "la rama del ticket no avanzo");

  // Y ahora la promesa: la rama base no se movio ni un commit.
  assert.equal(git(esc.repo, "rev-parse", "main"), baseAntes, "la rama base se movio");
  assert.equal(
    git(esc.repo, "log", "--oneline", "main").split("\n").length, 1,
    "main recibio commits que no eran suyos",
  );
  // El reflog es la prueba de que no se movio Y VOLVIO. Un reset que deshace
  // un merge deja el SHA igual y el reflog distinto.
  assert.equal(
    git(esc.repo, "reflog", "show", "main", "--format=%H").split("\n").filter(Boolean).length,
    reflogAntes,
    "la rama base se movio y volvio: el SHA final no alcanza como prueba",
  );
});

test("D2 — un recorrido completo no crea ninguna rama con nombre protegido ni contacta un remoto", async () => {
  const esc = escenario();
  const registro = [];
  await runItem("1", depsBase(esc, registro));

  const ramas = git(esc.repo, "for-each-ref", "--format=%(refname:short)", "refs/heads")
    .split("\n").map((s) => s.trim()).filter(Boolean);
  for (const rama of ramas) {
    if (rama === "main") continue; // la base, que ya existia
    assert.ok(
      !PROTEGIDAS.includes(rama),
      `el recorrido creo la rama protegida "${rama}"; las ramas son: ${ramas.join(", ")}`,
    );
  }

  // El repositorio no tiene remoto: nada de lo que hizo el recorrido pudo salir
  // de esta maquina. Y no se invento uno para lograrlo.
  assert.equal(git(esc.repo, "remote"), "", "el recorrido agrego un remoto");
  assert.equal(
    git(esc.repo, "for-each-ref", "--format=%(refname:short)", "refs/remotes"), "",
    "aparecieron refs remotas: algo hablo con un remoto",
  );
});

test("D3 — todo lo que el recorrido integro pasa por la rama del ticket, nunca por la base", async () => {
  const esc = escenario([tarea("T1")]);
  const registro = [];
  await runItem("1", depsBase(esc, registro));

  // El commit del test y el de la implementacion existen, y estan en la rama
  // del ticket y NO en la base. Es la forma de ver que la integracion apunto a
  // donde tenia que apuntar.
  const enItem = git(esc.integracion, "log", "--format=%s", "--reverse");
  assert.match(enItem, /test\(/, "no hay commit de test en la rama del ticket");
  assert.match(enItem, /feat\(/, "no hay commit de implementacion en la rama del ticket");

  const enBase = git(esc.repo, "log", "--format=%s", "main");
  assert.doesNotMatch(enBase, /test\(/, "el commit del test llego a la rama base");
  assert.doesNotMatch(enBase, /feat\(/, "la implementacion llego a la rama base");
});
