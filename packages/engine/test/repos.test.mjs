import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot, verifyRemote } from "../src/repos.mjs";

function repoCon(remote) {
  const d = mkdtempSync(join(tmpdir(), "noxloop-repo-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: d });
  if (remote) execFileSync("git", ["remote", "add", "origin", remote], { cwd: d });
  return d;
}

test("devuelve la ruta cuando el remote coincide", () => {
  const p = repoCon("git@example.com:o/app.git");
  const cfg = { repos: { app: { path: p, remote: "git@example.com:o/app.git" } } };
  assert.equal(repoRoot("app", cfg), p);
});

test("detecta que el directorio local NO es el repo declarado", () => {
  const p = repoCon("git@example.com:o/OTRO.git");
  const cfg = { repos: { app: { path: p, remote: "git@example.com:o/app.git" } } };
  assert.throws(() => repoRoot("app", cfg), /OTRO|no corresponde|remote/i);
});

test("acepta las dos formas del mismo remote: ssh y https", () => {
  const p = repoCon("https://github.com/o/app.git");
  assert.equal(verifyRemote(p, "git@github.com:o/app.git").ok, true);
  assert.equal(verifyRemote(p, "https://github.com/o/app").ok, true);
});

test("un directorio que no es repositorio git se reporta como tal", () => {
  const d = mkdtempSync(join(tmpdir(), "noxloop-norepo-"));
  assert.equal(verifyRemote(d, "git@example.com:o/app.git").ok, false);
});

test("un repo sin remote no pasa como coincidencia", () => {
  assert.equal(verifyRemote(repoCon(null), "git@example.com:o/app.git").ok, false);
});

test("un repo no declarado en la configuracion es un error nombrado", () => {
  assert.throws(() => repoRoot("fantasma", { repos: {} }), /fantasma/);
});
