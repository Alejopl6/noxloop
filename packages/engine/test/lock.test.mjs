import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquire } from "../src/lock.mjs";

const home = () => mkdtempSync(join(tmpdir(), "noxloop-lock-"));

test("el primero toma el lock y el segundo no arranca, diciendo quien lo tiene", () => {
  const h = home();
  const a = acquire("run-42", { home: h });
  assert.equal(a.ok, true);
  const b = acquire("run-42", { home: h });
  assert.equal(b.ok, false);
  assert.ok(b.heldBy.pid, "informa el pid que lo tiene");
  a.release();
  assert.equal(acquire("run-42", { home: h }).ok, true);
});

test("locks de recursos distintos no se estorban", () => {
  const h = home();
  assert.equal(acquire("run-42", { home: h }).ok, true);
  assert.equal(acquire("run-43", { home: h }).ok, true);
});

test("un lock de un proceso muerto se recupera en vez de bloquear para siempre", () => {
  const h = home();
  mkdirSync(join(h, "locks"), { recursive: true });
  // pid 2^22 + 1: por encima del maximo de cualquier sistema, garantizado inexistente
  writeFileSync(join(h, "locks", "run-42.json"),
    JSON.stringify({ pid: 4194305, acquiredAt: new Date().toISOString(), host: "x" }));
  const r = acquire("run-42", { home: h });
  assert.equal(r.ok, true);
  assert.equal(r.recovered, true);
});

test("release es idempotente y no borra el lock de otro", () => {
  const h = home();
  const a = acquire("run-42", { home: h });
  a.release();
  a.release();
  const b = acquire("run-42", { home: h });
  a.release();
  assert.ok(existsSync(join(h, "locks", "run-42.json")), "el release viejo no le saco el lock a b");
  b.release();
});
