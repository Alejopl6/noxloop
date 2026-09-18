// De quien es el fallo del gate: del codigo, de la base, o del entorno.
//
// POR QUE IMPORTA. Los tres se arreglan distinto y hoy los tres consumian los
// mismos tres intentos:
//
//   - CODIGO: lo arregla la tarea. Es el unico donde reintentar tiene sentido.
//   - BASE: ya estaba roto antes de esta tarea. Bloquearla por un fallo ajeno
//     es como se pierde una tarea que estaba bien; y "arreglarlo" desde la
//     tarea significa meter en su diff un cambio que no es suyo.
//   - ENTORNO: falta una herramienta, no hay red, no hay permisos. NINGUN
//     reintento lo arregla, y hoy se pagaban tres invocaciones del modelo para
//     llegar al mismo lugar.
//
// `blameGate` ya existia en `gate.mjs` y NADIE lo llamaba: distinguia codigo de
// base y no llegaba al driver. Otro cable cortado, encontrado por el inventario.
//
// EL ORDEN DE LA CLASIFICACION NO ES ARBITRARIO. El entorno se decide PRIMERO y
// mirando la salida, sin correr nada: si falta `npm`, correr el gate sobre la
// base tampoco va a funcionar, y seria pagar una segunda corrida para aprender
// lo que la primera ya dijo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { claseDeFallo, esFalloDeEntorno } from "../src/gate.mjs";

// ------------------------------------------------------------ entorno

test("exit 127 es el codigo de 'comando no encontrado': entorno, sin dudar", () => {
  assert.equal(esFalloDeEntorno({ exitCode: 127, output: "" }).es, true);
});

const DEL_ENTORNO = [
  ["command not found", "bash: line 1: pnpm: command not found"],
  ["executable no encontrado", "npm ERR! could not determine executable to run"],
  ["modulo ausente", "Error: Cannot find module 'typescript'"],
  ["dependencias sin instalar", "sh: 1: vitest: not found"],
  ["dns", "npm ERR! network request to https://registry.npmjs.org/ failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org"],
  ["conexion rechazada", "Error: connect ECONNREFUSED 127.0.0.1:5432"],
  ["permisos", "EACCES: permission denied, open '/usr/lib/node_modules'"],
  ["disco lleno", "ENOSPC: no space left on device, write"],
];

for (const [que, salida] of DEL_ENTORNO) {
  test(`entorno: ${que}`, () => {
    const r = esFalloDeEntorno({ exitCode: 1, output: salida });
    assert.equal(r.es, true, `no se reconocio como entorno: ${salida}`);
    assert.ok(r.senial, "tiene que decir QUE lo delato, o no se puede verificar la decision");
  });
}

const DEL_CODIGO = [
  ["un test que falla", "FAIL test/saldo.test.ts\n  ✕ recalcula el cupo (12 ms)\n  expected 100 to equal 90"],
  ["tipos", "src/a.ts(14,3): error TS2322: Type 'string' is not assignable to type 'number'."],
  ["lint", "src/a.ts:3:1  error  'x' is assigned a value but never used  no-unused-vars"],
  // El caso que mas facil se clasifica mal: el texto NOMBRA un modulo, pero es
  // el codigo de la tarea el que importa algo que no escribio.
  ["un import roto del codigo propio", "Error: Cannot find module './saldo-nuevo' imported from src/index.ts"],
];

for (const [que, salida] of DEL_CODIGO) {
  test(`NO es entorno: ${que}`, () => {
    assert.equal(esFalloDeEntorno({ exitCode: 1, output: salida }).es, false, `se clasifico mal: ${salida}`);
  });
}

test("un timeout no es entorno: puede ser un test que cuelga, que es codigo", () => {
  assert.equal(esFalloDeEntorno({ exitCode: null, timedOut: true, output: "" }).es, false);
});

// --------------------------------------------------- la clasificacion entera

test("gate verde: no hay a quien culpar", () => {
  const r = claseDeFallo({ ok: true, exitCode: 0, output: "" }, () => { throw new Error("no se corre la base si paso"); });
  assert.equal(r.clase, "ninguna");
});

test("entorno: se decide SIN correr el gate sobre la base", () => {
  let corridas = 0;
  const r = claseDeFallo({ ok: false, exitCode: 127, output: "pnpm: command not found" }, () => { corridas++; return { ok: true }; });
  assert.equal(r.clase, "entorno");
  assert.equal(corridas, 0, "correr la base con el entorno roto paga una corrida para no aprender nada");
  assert.ok(r.porque);
});

test("base: el gate falla igual sobre la base, asi que no es de esta tarea", () => {
  const r = claseDeFallo(
    { ok: false, exitCode: 1, output: "FAIL test/viejo.test.ts" },
    () => ({ ok: false, exitCode: 1, output: "FAIL test/viejo.test.ts" }),
  );
  assert.equal(r.clase, "base");
  assert.ok(r.base, "el resultado de la base viaja: es la evidencia de que no es de la tarea");
});

test("codigo: la base pasa, asi que lo rompio esta tarea", () => {
  const r = claseDeFallo(
    { ok: false, exitCode: 1, output: "FAIL test/nuevo.test.ts" },
    () => ({ ok: true, exitCode: 0, output: "" }),
  );
  assert.equal(r.clase, "codigo");
});

test("si no se puede correr la base, NO se asume que es de la tarea", () => {
  // Asumir "codigo" cuando no se sabe hace que una tarea cargue con un fallo
  // ajeno. Se devuelve "indeterminada" y el driver decide con eso a la vista.
  const r = claseDeFallo({ ok: false, exitCode: 1, output: "FAIL" }, () => { throw new Error("no hay worktree de base"); });
  assert.equal(r.clase, "indeterminada");
  assert.match(r.porque, /no hay worktree de base/, "la causa real, textual");
});

test("sin funcion para correr la base tampoco se adivina", () => {
  const r = claseDeFallo({ ok: false, exitCode: 1, output: "FAIL" }, null);
  assert.equal(r.clase, "indeterminada");
});
