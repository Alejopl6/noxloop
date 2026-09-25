// Encontrar `claude` y `codex` cuando el PATH es el de una app de macOS.
//
// EL CASO QUE ESTAS PRUEBAS MIDEN. Una app abierta desde Finder recibe
// `PATH=/usr/bin:/bin:/usr/sbin:/sbin`. Con eso, `spawn("claude")` da ENOENT
// aunque el operador tenga Claude Code en `~/.local/bin` o en Homebrew. Las
// pruebas no dependen de lo que haya instalado en la maquina que las corre: el
// `existe` se inyecta, o las rutas son de un directorio temporal.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

import { carpetasConocidas, esEjecutable, pathAmpliado, resolverBinario } from "../src/binarios.mjs";
import { directorioTemporal } from "./ayuda.mjs";

const PATH_DE_UNA_APP = "/usr/bin:/bin:/usr/sbin:/sbin";

/** Un `existe` que solo reconoce las rutas dadas. */
const soloEstas = (/** @type {string[]} */ rutas) => (/** @type {string} */ r) => rutas.includes(r);

test("con el PATH de una app de macOS, encuentra claude en ~/.local/bin (instalador nativo)", () => {
  const ruta = resolverBinario("claude", {
    env: { PATH: PATH_DE_UNA_APP, HOME: "/Users/op" },
    existe: soloEstas(["/Users/op/.local/bin/claude", "/opt/homebrew/bin/claude"]),
  });
  assert.equal(ruta, "/Users/op/.local/bin/claude");
});

test("encuentra codex en Homebrew, y en ~/.codex/bin si solo esta ahi", () => {
  const env = { PATH: PATH_DE_UNA_APP, HOME: "/Users/op" };
  assert.equal(resolverBinario("codex", { env, existe: soloEstas(["/opt/homebrew/bin/codex"]) }), "/opt/homebrew/bin/codex");
  assert.equal(resolverBinario("codex", { env, existe: soloEstas(["/Users/op/.codex/bin/codex"]) }), "/Users/op/.codex/bin/codex");
  // `~/.codex/bin` es de codex: no se busca `claude` ahi.
  assert.equal(resolverBinario("claude", { env, existe: soloEstas(["/Users/op/.codex/bin/claude"]) }), null);
});

test("el PATH recibido manda sobre las carpetas conocidas: gana el claude que elegiria la terminal", () => {
  const ruta = resolverBinario("claude", {
    env: { PATH: `/opt/propio/bin${delimiter}/usr/bin`, HOME: "/Users/op" },
    existe: soloEstas(["/opt/propio/bin/claude", "/Users/op/.local/bin/claude"]),
  });
  assert.equal(ruta, "/opt/propio/bin/claude");
});

test("sin el binario en ninguna parte devuelve null, y una entrada relativa del PATH no se sigue", () => {
  assert.equal(resolverBinario("claude", { env: { PATH: `bin${delimiter}./x`, HOME: "/h" }, existe: () => false }), null);
  const vistas = [];
  resolverBinario("claude", { env: { PATH: `bin${delimiter}/usr/bin`, HOME: "/h" }, existe: (r) => (vistas.push(r), false) });
  assert.equal(vistas.some((r) => !r.startsWith("/")), false, `probo rutas relativas: ${vistas.join(", ")}`);
});

test("una ruta ya absoluta se devuelve si es ejecutable y null si no", () => {
  assert.equal(resolverBinario("/x/claude", { existe: soloEstas(["/x/claude"]) }), "/x/claude");
  assert.equal(resolverBinario("/x/no-esta", { existe: () => false }), null);
});

test("esEjecutable: un archivo sin permiso de ejecucion o un directorio no cuentan", (t) => {
  const dir = directorioTemporal(t);
  const bin = join(dir, "claude");
  writeFileSync(bin, "#!/bin/sh\n");
  chmodSync(bin, 0o644);
  assert.equal(esEjecutable(bin), false);
  chmodSync(bin, 0o755);
  assert.equal(esEjecutable(bin), true);
  mkdirSync(join(dir, "carpeta"));
  assert.equal(esEjecutable(join(dir, "carpeta")), false);
});

test("resolverBinario de verdad, sin inyectar nada: encuentra el ejecutable en ~/.local/bin de un HOME temporal", (t) => {
  const home = directorioTemporal(t);
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  const bin = join(home, ".local", "bin", "un-binario-de-prueba-noxloop");
  writeFileSync(bin, "#!/bin/sh\n");
  chmodSync(bin, 0o755);
  assert.equal(resolverBinario("un-binario-de-prueba-noxloop", { env: { PATH: "/nada", HOME: home } }), bin);
});

test("pathAmpliado: conserva el PATH recibido primero, suma las conocidas, sin duplicados", () => {
  const home = "/Users/op";
  const p = pathAmpliado({ PATH: `/opt/homebrew/bin${delimiter}/usr/bin${delimiter}/usr/bin`, HOME: home }, { existeCarpeta: () => false });
  const partes = p.split(delimiter);
  assert.deepEqual(partes.slice(0, 2), ["/opt/homebrew/bin", "/usr/bin"]);
  for (const c of carpetasConocidas(home)) assert.ok(partes.includes(c), `falta ${c}`);
  assert.equal(new Set(partes).size, partes.length, `hay duplicados: ${p}`);
  assert.equal(partes.includes(join(home, ".codex", "bin")), false, "~/.codex/bin se sumo sin existir");
});

test("pathAmpliado suma ~/.codex/bin solo si existe, y funciona sin PATH recibido", () => {
  const p = pathAmpliado({ HOME: "/Users/op" }, { existeCarpeta: (d) => d === "/Users/op/.codex/bin" });
  assert.ok(p.split(delimiter).includes("/Users/op/.codex/bin"));
  assert.equal(p.split(delimiter)[0], "/Users/op/.local/bin");
});
