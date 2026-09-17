import { test } from "node:test";
import assert from "node:assert/strict";
import { contractChecks, validateProvider, validateItem, CAPABILITY_KEYS, CANONICAL_STATES } from "./contract.mjs";
import * as fake from "./fake/index.mjs";

test("el proveedor falso pasa el contrato completo", async () => {
  for (const check of contractChecks(fake, fake.fixtures)) {
    await check.run();
  }
});

test("validateProvider detecta una capacidad declarada sin su funcion, AL CARGAR", () => {
  const mentiroso = { ...fake, capabilities: () => ({ ...fake.capabilities(), dependencies: true }), dependencies: undefined };
  const r = validateProvider(mentiroso);
  assert.equal(r.ok, false);
  assert.ok(r.problems.join(" ").includes("dependencies"));
});

test("validateProvider detecta una clave de capacidad inventada o faltante", () => {
  const conExtra = { ...fake, capabilities: () => ({ ...fake.capabilities(), telepatia: true }) };
  assert.ok(validateProvider(conExtra).problems.join(" ").includes("telepatia"));
  const conFalta = { ...fake, capabilities: () => ({}) };
  assert.ok(validateProvider(conFalta).problems.length >= CAPABILITY_KEYS.length);
});

test("validateProvider exige meta y getItem", () => {
  assert.ok(validateProvider({ capabilities: () => ({}) }).problems.join(" ").includes("meta"));
  assert.ok(validateProvider({ meta: { name: "x" }, capabilities: () => ({}) }).problems.join(" ").includes("getItem"));
});

test("validateItem rechaza un item sin los campos canonicos", () => {
  assert.equal(validateItem({ id: "1", title: "t", level: "story", url: "u" }).ok, true);
  assert.ok(validateItem({ id: "1", title: "t", level: "epica", url: "u" }).problems.join(" ").includes("level"));
  assert.ok(validateItem({ title: "t", level: "story", url: "u" }).problems.join(" ").includes("id"));
  assert.ok(validateItem({ id: 7, title: "t", level: "story", url: "u" }).problems.join(" ").includes("id"),
    "id es string: Linear usa UUID y GitHub numero");
});

test("getItem de un id inexistente devuelve null y no lanza", async () => {
  assert.equal(await fake.getItem("no-existe", fake.fixtures.ctx), null);
});

test("un tipo nativo desconocido cae en el nivel por defecto declarado, sin fallar", async () => {
  const item = await fake.getItem("tipo-raro", fake.fixtures.ctx);
  assert.ok(CANONICAL_STATES.length === 5);
  assert.equal(item.level, fake.fixtures.defaultLevel);
});

test("el mapa de estados es total: todo canonico tiene entrada, posiblemente null", () => {
  const mapa = fake.fixtures.ctx.options.stateMap;
  for (const s of CANONICAL_STATES) {
    assert.ok(s in mapa, `falta ${s}`);
  }
});

test("ninguna funcion del proveedor lee process.env: el ctx no se puede saltear", async () => {
  const { readFileSync } = await import("node:fs");
  const fuente = readFileSync(new URL("./fake/index.mjs", import.meta.url), "utf8");
  assert.ok(!/process\.env/.test(fuente), "el proveedor recibe env por ctx, no lo lee");
});
