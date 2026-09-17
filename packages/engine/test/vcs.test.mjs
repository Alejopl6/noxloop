import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitPaths, mensajeDeFase, hayCambios } from "../src/vcs.mjs";

const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function repo() {
  const d = mkdtempSync(join(tmpdir(), "noxloop-vcs-"));
  git(d, "init", "-q", "-b", "main");
  git(d, "config", "user.email", "t@example.test");
  git(d, "config", "user.name", "T");
  writeFileSync(join(d, "README.md"), "x\n");
  git(d, "add", "-A"); git(d, "commit", "-q", "-m", "base");
  return d;
}

const tarea = (over = {}) => ({
  id: "T001", repo: "app", title: "ocultar la columna costo",
  targetFiles: ["src/grilla.mjs"], testFiles: ["test/grilla.test.mjs"],
  tier: "small", ...over,
});

test("commitea SOLO los archivos declarados, no todo lo que haya", () => {
  const d = repo();
  mkdirSync(join(d, "src"), { recursive: true });
  mkdirSync(join(d, "test"), { recursive: true });
  writeFileSync(join(d, "test/grilla.test.mjs"), "test\n");
  writeFileSync(join(d, "basura.txt"), "esto no es de la tarea\n");

  const r = commitPaths(d, ["test/grilla.test.mjs"], "test(app): x");
  assert.equal(r.committed, true);
  // `git add -A` habria arrastrado basura.txt al PR de la tarea. El alcance de
  // la tarea vale tambien para el commit.
  const archivos = git(d, "show", "--name-only", "--format=", "HEAD").split("\n");
  assert.deepEqual(archivos, ["test/grilla.test.mjs"]);
  assert.match(git(d, "status", "--porcelain"), /basura\.txt/, "lo ajeno sigue sin commitear");
});

test("sin cambios no crea un commit vacio", () => {
  const d = repo();
  const r = commitPaths(d, ["README.md"], "chore: nada");
  assert.equal(r.committed, false);
  assert.equal(git(d, "log", "--oneline").split("\n").length, 1);
});

test("un archivo declarado que no existe no rompe el commit de los que si", () => {
  const d = repo();
  mkdirSync(join(d, "src"), { recursive: true });
  writeFileSync(join(d, "src/grilla.mjs"), "impl\n");
  const r = commitPaths(d, ["src/grilla.mjs", "src/no-existe.mjs"], "feat(app): x");
  assert.equal(r.committed, true);
  assert.deepEqual(git(d, "show", "--name-only", "--format=", "HEAD").split("\n"), ["src/grilla.mjs"]);
});

test("el mensaje de RED es un commit de test, y el de GREEN de implementacion", () => {
  const t = tarea();
  const red = mensajeDeFase("RED", t, { id: "42", key: "H-42" });
  const green = mensajeDeFase("GREEN", t, { id: "42", key: "H-42" });

  assert.match(red, /^test\(app\): /);
  assert.match(green, /^feat\(app\): /);
  // El id de la tarea y el del ticket van en el mensaje: es lo que hace legible
  // el historial del PR cuando tiene ocho tareas.
  assert.match(red, /T001/);
  assert.match(red, /H-42/);
  assert.match(green, /T001/);
});

test("el tipo del commit sale del tier cuando no es logica nueva", () => {
  assert.match(mensajeDeFase("GREEN", tarea({ tier: "trivial" }), { id: "1" }), /^chore\(app\): /);
  assert.match(mensajeDeFase("GREEN", tarea({ tier: "large" }), { id: "1" }), /^feat\(app\): /);
});

test("un titulo largo no produce un asunto ilegible", () => {
  const largo = mensajeDeFase("GREEN", tarea({ title: "x".repeat(200) }), { id: "1" });
  const asunto = largo.split("\n")[0];
  assert.ok(asunto.length <= 72, `el asunto mide ${asunto.length}`);
});

test("hayCambios distingue un arbol sucio de uno limpio", () => {
  const d = repo();
  assert.equal(hayCambios(d), false);
  writeFileSync(join(d, "nuevo.txt"), "x\n");
  assert.equal(hayCambios(d), true);
});

test("el historial queda con el test ANTES de la implementacion", () => {
  const d = repo();
  mkdirSync(join(d, "src"), { recursive: true });
  mkdirSync(join(d, "test"), { recursive: true });
  const t = tarea();

  writeFileSync(join(d, t.testFiles[0]), "test\n");
  commitPaths(d, t.testFiles, mensajeDeFase("RED", t, { id: "42" }));
  writeFileSync(join(d, t.targetFiles[0]), "impl\n");
  commitPaths(d, t.targetFiles, mensajeDeFase("GREEN", t, { id: "42" }));

  // Es la promesa del proyecto que se puede verificar SIN leer su codigo: el
  // commit del test precede al de su implementacion, en el historial del PR.
  const log = git(d, "log", "--format=%s", "--reverse").split("\n");
  const iTest = log.findIndex((l) => l.startsWith("test("));
  const iImpl = log.findIndex((l) => l.startsWith("feat("));
  assert.ok(iTest >= 0 && iImpl > iTest, `el orden no se ve en el historial: ${log.join(" | ")}`);
});
