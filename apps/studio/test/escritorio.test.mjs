// Lo que la interfaz decide antes de pedirle algo a la cascara de escritorio
// (`lib/escritorio.ts`): que numero va al Dock, que ruta se pide abrir y en
// que linea. La validacion de verdad —que la ruta este dentro de los worktrees
// de noxloop— la hace la cascara en Rust y se prueba alli (`editor.rs`).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  esEscritorio,
  numeroDelBadge,
  ponerBadgeDelDock,
  primeraLineaDelParche,
  rutaEnElWorktree,
} from "../lib/escritorio.ts";

test("el numero del Dock es un entero no negativo, y lo raro es 0", () => {
  assert.equal(numeroDelBadge(2), 2);
  assert.equal(numeroDelBadge(0), 0);
  assert.equal(numeroDelBadge(-1), 0);
  assert.equal(numeroDelBadge(Number.NaN), 0);
  assert.equal(numeroDelBadge(undefined), 0);
  assert.equal(numeroDelBadge("3"), 0);
  assert.equal(numeroDelBadge(2.7), 2);
});

test("la ruta se arma dentro del worktree y no se deja salir", () => {
  assert.equal(rutaEnElWorktree("/h/worktrees/r/I-1-T1", "src/a.ts"), "/h/worktrees/r/I-1-T1/src/a.ts");
  assert.equal(rutaEnElWorktree("/h/worktrees/r/I-1-T1/", "a.ts"), "/h/worktrees/r/I-1-T1/a.ts");
  assert.equal(rutaEnElWorktree(null, "a.ts"), null);
  assert.equal(rutaEnElWorktree("relativo", "a.ts"), null);
  assert.equal(rutaEnElWorktree("/h/w", "../../boveda.json"), null);
  assert.equal(rutaEnElWorktree("/h/w", "/etc/hosts"), null);
  assert.equal(rutaEnElWorktree("/h/w", ""), null);
});

test("un archivo se abre en su primera linea anadida", () => {
  const parche = "@@ -10,4 +12,5 @@ funcion\n contexto\n contexto\n-quitada\n+anadida\n contexto\n";
  assert.equal(primeraLineaDelParche(parche), 14);
});

test("sin lineas anadidas, en el primer hunk; sin hunk, sin linea", () => {
  assert.equal(primeraLineaDelParche("@@ -3,2 +3,1 @@\n-x\n y\n"), 3);
  assert.equal(primeraLineaDelParche("Binary files differ"), null);
  assert.equal(primeraLineaDelParche("@@ -1 +0,0 @@\n-todo\n"), null);
});

test("en web (sin ventana ni Tauri) no se hace nada y no se falla", async () => {
  assert.equal(await esEscritorio(), false);
  await ponerBadgeDelDock(3);
});
