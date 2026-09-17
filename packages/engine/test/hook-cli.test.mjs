// Los cuatro hooks como EJECUTABLE, no como funcion.
//
// EL FALLO QUE ESTE ARCHIVO EVITA. `hooks.test.mjs` prueba `decide()`, que es la
// forma que NO usa una sesion. Una sesion real invoca el archivo como proceso,
// le manda el payload por stdin y lee el veredicto del codigo de salida. Si ese
// contrato estuviera mal —stdin que no se lee, exit 1 en vez de 2, el motivo
// impreso en stdout donde el modelo no lo ve— los cuatro hooks pasarian todos
// sus tests unitarios y no bloquearian NADA en produccion. El principio IV dice
// que el limite de autonomia lo fuerza un hook "tambien en los subprocesos que
// nadie esta mirando": este archivo es lo que hace verificable esa frase.
//
// Por eso aca no se importa `decide()`. Se usa `spawnSync` con el JSON por
// stdin, exactamente como lo haria una sesion.
//
// El exit code no se elige: sale de `responder()` en `src/hooks/_shared.mjs`,
// que escribe el motivo en stderr y termina con 2 al bloquear, y con 0 al
// permitir. Se prueba contra ESE numero.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRun, setActiveTask, setTaskFields } from "../src/state.mjs";

const HOOKS = fileURLToPath(new URL("../src/hooks/", import.meta.url));

/** El contrato de `responder()`: 2 bloquea, 0 permite. */
const BLOQUEA = 2;
const PERMITE = 0;

const TODOS = [
  "tdd-order-guard.mjs",
  "task-scope-guard.mjs",
  "no-prod-writes.mjs",
  "state-checkpoint.mjs",
];

const home = () => mkdtempSync(join(tmpdir(), "noxloop-hookcli-"));

/**
 * Entorno explicito, sin heredar la maquina de quien corre los tests. Si
 * NOXLOOP_HOME o NOXLOOP_GUARD_ALWAYS quedaran colgados del entorno real, el
 * test miraria una tarea activa que no puso, y pasaria o fallaria por algo
 * ajeno.
 */
function entorno({ noxloopHome, guardAlways, userHome } = {}) {
  const e = { ...process.env };
  delete e.NOXLOOP_HOME;
  delete e.NOXLOOP_GUARD_ALWAYS;
  if (noxloopHome) e.NOXLOOP_HOME = noxloopHome;
  if (guardAlways) e.NOXLOOP_GUARD_ALWAYS = "1";
  if (userHome) e.HOME = userHome;
  return e;
}

/**
 * Invoca el hook como lo invoca una sesion: proceso aparte, payload por stdin.
 *
 * `timeout` no es decoracion: un hook que se queda esperando stdin cuelga el
 * turno entero, y ese fallo tiene que aparecer como test rojo y no como una
 * suite que nunca termina.
 */
function invocar(hook, payload, opts = {}) {
  const r = spawnSync(process.execPath, [join(HOOKS, hook)], {
    input: opts.crudo !== undefined ? opts.crudo : JSON.stringify(payload),
    encoding: "utf8",
    timeout: 20_000,
    env: entorno(opts),
  });
  assert.equal(r.error, undefined, `${hook} no se pudo invocar: ${r.error}`);
  assert.equal(r.signal, null, `${hook} no termino solo (senal ${r.signal}): se colgo esperando stdin`);
  return r;
}

const tarea = (over = {}) => ({
  id: "T001",
  repo: "app",
  title: "t T001",
  acceptance: "c",
  targetFiles: ["src/a.mjs"],
  testFiles: ["test/a.test.mjs"],
  tier: "small",
  dependsOn: [],
  dependencyKind: "hard",
  ...over,
});

/**
 * Un recorrido con T001 activa. `worktree` no se puede pasar en el plan —
 * `createRun` lo pone en null a proposito— asi que se escribe con el setter
 * real, que es lo que hace el motor.
 */
function conTareaActiva(h, { worktree, ...over } = {}) {
  const run = createRun(
    {
      item: { id: "42", title: "h", level: "story", url: "u", provider: "fake" },
      repoScope: ["app"],
      tasks: [tarea(over)],
    },
    { home: h },
  );
  if (worktree) setTaskFields(run, "T001", { worktree }, { home: h });
  setActiveTask("42", "T001", { home: h, worktree });
  return run;
}

const edit = (path) => ({ tool_name: "Edit", tool_input: { file_path: path } });
const bash = (cmd) => ({ tool_name: "Bash", tool_input: { command: cmd } });

// ------------------------------------------------- 1. bloquear es exit 2 + stderr

test("un comando prohibido sale con el codigo que significa bloqueado y el motivo por stderr", () => {
  const h = home();
  conTareaActiva(h);

  const r = invocar("no-prod-writes.mjs", bash("gh pr merge 12 --squash"), { noxloopHome: h });

  assert.equal(r.status, BLOQUEA, "un exit distinto de 2 no bloquea: la sesion sigue y mergea");
  assert.match(r.stderr, /merge/i);
  assert.ok(r.stderr.trim().length > 10, "el motivo es lo que el modelo lee; vacio no le dice como desatascarse");
  assert.equal(r.stdout, "", "el motivo va por stderr: en stdout el modelo no lo ve");
});

test("los tres hooks que bloquean lo hacen con el mismo exit 2 desde su modo ejecutable", () => {
  const h = home();
  conTareaActiva(h);

  // tdd-order-guard: produccion sin rojo verificado.
  const tdd = invocar("tdd-order-guard.mjs", edit(join(h, "src/a.mjs")), { noxloopHome: h });
  assert.equal(tdd.status, BLOQUEA);
  assert.match(tdd.stderr, /rojo/i);

  // task-scope-guard: archivo que la tarea no declaro.
  const scope = invocar("task-scope-guard.mjs", edit(join(h, "src/no-declarado.mjs")), { noxloopHome: h });
  assert.equal(scope.status, BLOQUEA);
  assert.match(scope.stderr, /add-target|declar/i);

  // no-prod-writes: force push sobre una rama compartida.
  const prod = invocar("no-prod-writes.mjs", bash("git push --force origin main"), { noxloopHome: h });
  assert.equal(prod.status, BLOQUEA);
  assert.match(prod.stderr, /force push/i);
});

test("NOXLOOP_GUARD_ALWAYS=1 bloquea sin tarea activa: la bandera solo existe en el modo ejecutable", () => {
  // Esta rama no la puede cubrir `hooks.test.mjs`: la bandera se lee del
  // entorno del proceso, no de un argumento de `decide()`.
  const h = home();

  const conBandera = invocar("no-prod-writes.mjs", bash("kubectl apply -f prod.yaml"), {
    noxloopHome: h,
    guardAlways: true,
  });
  assert.equal(conBandera.status, BLOQUEA, "con la bandera puesta, el limite aplica aunque no haya tarea activa");

  const sinBandera = invocar("no-prod-writes.mjs", bash("kubectl apply -f prod.yaml"), { noxloopHome: h });
  assert.equal(sinBandera.status, PERMITE, "sin la bandera y sin tarea, la sesion es de una persona");
});

// ------------------------------------------------- 2. el falso positivo ya cometido

test("un comando que solo MENCIONA la frase prohibida sale 0", () => {
  // Este hook ya bloqueo de mas una vez: un `echo` con una advertencia y un
  // `grep` sobre la documentacion. Bloquear de mas deja a una persona sin poder
  // trabajar, y se comprueba por el exit code porque es lo unico que la sesion
  // mira.
  const h = home();
  conTareaActiva(h);

  for (const cmd of [
    "echo 'no hagas git push --force'",
    "grep -rn 'gh pr merge' docs/",
    'echo "a && gh pr merge 1"',
    "git log --oneline origin/main",
    "cat deploy.sh",
    "git push origin feature/42-x",
  ]) {
    const r = invocar("no-prod-writes.mjs", bash(cmd), { noxloopHome: h });
    assert.equal(r.status, PERMITE, `bloqueo de mas: ${cmd} (stderr: ${r.stderr.trim()})`);
    assert.equal(r.stderr, "", `imprimio un motivo sin bloquear: ${cmd}`);
  }
});

// ------------------------------------------------- 3. sin tarea activa, todo pasa

test("sin tarea activa los cuatro hooks salen 0 y no dicen nada", () => {
  // Los hooks corren en cada operacion de la sesion, tambien cuando noxloop no
  // esta activo. Aca se verifica desde el proceso, que es donde el fallo
  // costaria: un exit 2 con noxloop apagado deja a una persona sin trabajar.
  const h = home();

  for (const hook of TODOS) {
    for (const payload of [
      edit("/otro/repo/src/cualquiera.mjs"),
      bash("git push --force origin main"),
      { hook_event_name: "Stop", cwd: "/otro/repo" },
    ]) {
      const r = invocar(hook, payload, { noxloopHome: h });
      assert.equal(r.status, PERMITE, `${hook} bloqueo sin tarea activa (stderr: ${r.stderr.trim()})`);
      assert.equal(r.stderr, "", `${hook} escribio en stderr sin tarea activa`);
    }
  }
});

// ------------------------------------------------- 4. entrada invalida: permitir

test("un stdin invalido o vacio no cuelga el hook ni lo hace bloquear", () => {
  // `leerEntrada()` parsea el fd 0. Si un payload roto lanzara, el hook
  // terminaria con un exit distinto de 0 por un error PROPIO, y bloquearia una
  // operacion que nunca reviso. Ante la duda, permitir.
  const h = home();
  conTareaActiva(h);

  const crudos = ["", "   ", "no soy json", "{", "{\"tool_name\":", "null", "[]", '"hola"', "0"];

  for (const hook of TODOS) {
    for (const crudo of crudos) {
      const r = invocar(hook, null, { noxloopHome: h, crudo });
      assert.equal(
        r.status,
        PERMITE,
        `${hook} no permitio ante el stdin ${JSON.stringify(crudo)} (stderr: ${r.stderr.trim()})`,
      );
      assert.doesNotMatch(r.stderr, /at \w|Error:/, `${hook} explico un error propio ante ${JSON.stringify(crudo)}`);
    }
  }
});

// ------------------------------------------------- 5. sin NOXLOOP_HOME

test("sin NOXLOOP_HOME los cuatro hooks resuelven el default y salen 0", () => {
  // Una sesion que nadie configuro no exporta NOXLOOP_HOME. El hook cae al
  // default (~/.noxloop), que puede no existir: no existir es "no hay tarea
  // activa", no es un error. Se apunta HOME a un directorio vacio para que el
  // resultado no dependa del ~/.noxloop real de la maquina.
  const casa = home();

  for (const hook of TODOS) {
    const r = invocar(hook, edit("src/a.mjs"), { userHome: casa });
    assert.equal(r.status, PERMITE, `${hook} fallo sin NOXLOOP_HOME (stderr: ${r.stderr.trim()})`);
    assert.equal(r.stderr, "", `${hook} escribio en stderr sin NOXLOOP_HOME`);
  }
});

// ------------------------------------------------- avisar no es bloquear

test("state-checkpoint avisa por stderr pero sale 0: un aviso no puede frenar el turno", () => {
  // El checkpoint es el unico de los cuatro que notifica sin bloquear. Si su
  // modo ejecutable saliera 2, cada fin de turno con el worktree sucio se
  // convertiria en un bloqueo — el aviso pasaria a ser el problema.
  const h = home();
  const worktree = mkdtempSync(join(tmpdir(), "noxloop-wt-"));
  execFileSync("git", ["init", "-q", worktree], { stdio: "ignore" });
  writeFileSync(join(worktree, "sin-commitear.txt"), "trabajo a medias\n");
  conTareaActiva(h, { worktree });

  const r = invocar("state-checkpoint.mjs", { hook_event_name: "Stop", cwd: worktree }, { noxloopHome: h });

  assert.equal(r.status, PERMITE, "el aviso del checkpoint no bloquea");
  assert.match(r.stderr, /T001/, "el aviso sale por stderr, que es lo que el modelo lee");
});
