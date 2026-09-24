// El runtime de un recorrido puede venir de la CONFIGURACION (spec 003, FR-031).
//
// EL HUECO QUE CIERRA. El servicio resuelve el ejecutor de una tarea en
// cascada —tarea -> proyecto -> general— y hasta aqui no tenia por donde
// decirselo al motor: el runtime solo entraba por `opts.runtime`, que la CLI no
// expone, asi que el motor montaba siempre el primero del registro. Una
// eleccion que no llega es una eleccion que el operador cree hecha y no lo
// esta. Con `runtime` en la configuracion, lo resuelto viaja por el mismo
// archivo que ya transporta todo lo demas.
//
// Y LO QUE NO SE PUEDE MONTAR SE DICE AL ARRANCAR: un id que el registro no
// conoce es un error de carga, no una fase que muere sin modelo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../src/config.mjs";
import { buildDeps } from "../src/wiring.mjs";
import { crearAdaptadorCodex } from "../../adapters/src/adaptadores/codex.mjs";
import { crearAdaptadorClaude } from "../../adapters/src/adaptadores/claude-agent-sdk.mjs";

const muda = { info() {}, warn() {}, error() {}, child() { return this; } };
const FAKE = new URL("../../../providers/fake/index.mjs", import.meta.url).pathname;

test("el esquema acepta `runtime` como texto, y lo rechaza si no lo es", () => {
  const dir = mkdtempSync(join(tmpdir(), "noxloop-runtime-"));
  const base = {
    version: 1,
    home: join(dir, "home"),
    provider: { name: "fake", module: FAKE, stateMap: { todo: "Nuevo", in_progress: null, blocked: null, in_review: null, done: null } },
    repos: { app: { path: dir, remote: join(dir, "origin.git"), baseBranch: "main", gate: "npm test" } },
  };
  const ruta = join(dir, "c.json");
  writeFileSync(ruta, JSON.stringify({ ...base, runtime: "claude-agent-sdk" }));
  assert.equal(loadConfig(ruta, { env: {} }).runtime, "claude-agent-sdk");

  writeFileSync(ruta, JSON.stringify({ ...base, runtime: 7 }));
  assert.throws(() => loadConfig(ruta, { env: {} }), /runtime/);
});

test("sin `opts.runtime`, el motor monta el runtime que dice la configuracion", async () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-runtime-"));
  const adaptadores = [crearAdaptadorClaude({ hooks: { hooks: {} } }), crearAdaptadorCodex()];
  const deps = await buildDeps({ id: "1" }, { home, repos: {}, runtime: "codex" }, {
    provider: {}, providerCtx: {}, log: muda, adaptadores, env: { PATH: "/usr/bin" },
  });
  assert.equal(deps.runtime, "codex", "la eleccion del servicio no llego al motor");

  const porDefecto = await buildDeps({ id: "1" }, { home, repos: {} }, {
    provider: {}, providerCtx: {}, log: muda, adaptadores, env: { PATH: "/usr/bin" },
  });
  assert.equal(porDefecto.runtime, "claude-agent-sdk", "sin eleccion se sigue montando el de referencia");
});

test("un runtime que el registro no conoce falla AL CARGAR, nombrandolo", async () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-runtime-"));
  await assert.rejects(
    () => buildDeps({ id: "1" }, { home, repos: {}, runtime: "uno-inventado" }, {
      provider: {}, providerCtx: {}, log: muda, adaptadores: [crearAdaptadorClaude({ hooks: { hooks: {} } })], env: {},
    }),
    /uno-inventado/,
  );
});
