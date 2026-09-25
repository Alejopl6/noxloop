// El entorno EXACTO de una fase tiene que alcanzar para que la sesion local del
// runtime funcione.
//
// EL RIESGO. El motor construye el entorno de cada fase por nombre (principio
// IX: nada se hereda). Si de esa lista falta lo que el runtime necesita para
// encontrar su propia sesion, el agente arranca y muere con "no autenticado",
// aunque el operador tenga `claude` o `codex` logueados en la misma maquina y
// el doctor haya dicho que si.
//
// LO MEDIDO ANTES DE ESCRIBIR ESTO (macOS, esta maquina):
//   - `env -i HOME PATH USER claude auth status`  -> loggedIn: true
//   - `env -i HOME PATH claude auth status`       -> loggedIn: false (sin USER
//     el llavero no encuentra la entrada "Claude Code-credentials")
//   - `codex` guarda la sesion en `$CODEX_HOME/auth.json` (por defecto
//     `~/.codex`): con CODEX_HOME movido y sin viajar, la fase no la encuentra.
//   - el adaptador de codex no declaraba NADA: ni OPENAI_API_KEY ni CODEX_HOME
//     llegaban a su fase.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildDeps } from "../src/wiring.mjs";
import { crearAdaptadorCodex } from "../../adapters/src/adaptadores/codex.mjs";
import { crearAdaptadorClaude } from "../../adapters/src/adaptadores/claude-agent-sdk.mjs";

const muda = { info() {}, warn() {}, error() {}, child() { return this; } };

const LA_MAQUINA = {
  PATH: "/opt/homebrew/bin:/usr/bin:/bin",
  HOME: "/Users/alguien",
  USER: "alguien",
  LOGNAME: "alguien",
  CODEX_HOME: "/Users/alguien/.config/codex",
  CLAUDE_CONFIG_DIR: "/Users/alguien/.config/claude",
  OPENAI_API_KEY: "sk-centinela-openai-4471",
  ANTHROPIC_API_KEY: "sk-ant-centinela-4471",
  // Lo que NO tiene que viajar: una credencial de otra cosa en el shell del operador.
  GITHUB_TOKEN: "ghp-centinela-que-no-viaja",
};

async function depsCon(adaptador) {
  const home = mkdtempSync(join(tmpdir(), "noxloop-sesion-"));
  return buildDeps({ id: "1" }, { home, repos: {} }, {
    provider: {}, providerCtx: {}, log: muda,
    adaptadores: [adaptador], runtime: adaptador.id, env: LA_MAQUINA,
  });
}

test("codex: su fase recibe lo que su sesion local necesita, y su key si esta en la boveda", async () => {
  const deps = await depsCon(crearAdaptadorCodex());
  const env = deps.entorno();
  // El PATH viaja AMPLIADO (ver `binarios.mjs`): el de la maquina primero,
  // intacto, y detras las carpetas donde los instaladores dejan los binarios.
  assert.ok(env.PATH.startsWith(LA_MAQUINA.PATH), `la fase no recibe el PATH de la maquina: ${env.PATH}`);
  for (const v of ["HOME", "USER", "CODEX_HOME", "OPENAI_API_KEY"]) {
    assert.equal(env[v], LA_MAQUINA[v], `la fase de codex no recibe ${v}: correria con "no autenticado"`);
  }
  assert.equal(Object.hasOwn(env, "GITHUB_TOKEN"), false, "viajo una variable que nadie declaro");
  assert.equal(Object.hasOwn(env, "ANTHROPIC_API_KEY"), false, "codex recibio la key de otro runtime");
});

test("claude: su fase recibe USER (el llavero) y CLAUDE_CONFIG_DIR si el operador la movio", async () => {
  const deps = await depsCon(crearAdaptadorClaude({ hooks: { hooks: {} } }));
  const env = deps.entorno();
  // El PATH viaja AMPLIADO (ver `binarios.mjs`): el de la maquina primero,
  // intacto, y detras las carpetas donde los instaladores dejan los binarios.
  assert.ok(env.PATH.startsWith(LA_MAQUINA.PATH), `la fase no recibe el PATH de la maquina: ${env.PATH}`);
  for (const v of ["HOME", "USER", "CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY"]) {
    assert.equal(env[v], LA_MAQUINA[v], `la fase de claude no recibe ${v}`);
  }
  assert.equal(Object.hasOwn(env, "GITHUB_TOKEN"), false);
  assert.equal(Object.hasOwn(env, "OPENAI_API_KEY"), false, "claude recibio la key de otro runtime");
});

test("las variables de sesion NO cuentan como secretas; las keys si", async () => {
  // Si CODEX_HOME o HOME contaran como secretos, la guarda de argv daria
  // positivo con cualquier ruta bajo el home y ninguna fase se lanzaria.
  const codex = await depsCon(crearAdaptadorCodex());
  assert.deepEqual(codex.secretos, ["OPENAI_API_KEY"]);
  const claude = await depsCon(crearAdaptadorClaude({ hooks: { hooks: {} } }));
  assert.deepEqual(claude.secretos, ["ANTHROPIC_API_KEY"]);
});
