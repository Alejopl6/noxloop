// El diagnostico y Settings → Modelos encuentran los binarios como los
// encuentra la fase, aunque el servicio corra dentro de una app de macOS.
//
// EL FALLO QUE CIERRA. Abierta desde el Dock, la app recibe
// `PATH=/usr/bin:/bin:/usr/sbin:/sbin`. El diagnostico preguntaba `claude
// --version` con ese PATH y decia «falta claude» con Claude Code instalado en
// `~/.local/bin`; y un `claude` instalado con npm (`#!/usr/bin/env node`) no
// encontraba `node` aunque se lo encontrara a el.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { diagnosticoDeMaquina, ejecutorDeVersion } from "../src/diagnostico.mjs";

const PATH_DE_UNA_APP = "/usr/bin:/bin:/usr/sbin:/sbin";

/** Un HOME con un binario en `~/.local/bin` que imprime una version y el PATH que recibio. */
function homeConBinario(/** @type {string} */ nombre) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "noxloop-app-")));
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  const ruta = join(home, ".local", "bin", nombre);
  writeFileSync(ruta, '#!/bin/sh\necho "9.8.7"\necho "PATH=$PATH" >&2\n');
  chmodSync(ruta, 0o755);
  return { home, ruta };
}

test("ejecutorDeVersion: con el PATH de una app, encuentra el binario en ~/.local/bin y le pasa el PATH ampliado", async () => {
  const { home, ruta } = homeConBinario("un-binario-noxloop");
  const s = await ejecutorDeVersion(["un-binario-noxloop", "--version"], { env: { PATH: PATH_DE_UNA_APP, HOME: home }, timeoutMs: 5000 });
  assert.equal(s.code, 0);
  assert.equal(s.ruta, ruta);
  assert.match(s.stdout, /9\.8\.7/);
  const recibido = /PATH=(.*)/.exec(s.stderr)?.[1] ?? "";
  assert.ok(recibido.split(delimiter).includes("/opt/homebrew/bin"), recibido);
  assert.ok(recibido.startsWith(PATH_DE_UNA_APP), "lo que el servicio traia va primero");
});

test("diagnosticoDeMaquina con el ejecutor de verdad: `claude` en ~/.local/bin sale presente, con su ruta", async () => {
  const { home, ruta } = homeConBinario("claude");
  const d = await diagnosticoDeMaquina({ env: { PATH: PATH_DE_UNA_APP, HOME: home } });
  const claude = /** @type {any} */ (d.binarios.find((b) => b.nombre === "claude"));
  assert.equal(claude.estado, "presente", JSON.stringify(claude));
  assert.equal(claude.ruta, ruta);
  assert.equal(claude.version, "9.8.7");
});
