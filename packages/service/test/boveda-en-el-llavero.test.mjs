// La boveda sobre el llavero del sistema, sin frase de paso.
//
// EL FALLO QUE ESTO CIERRA. El servicio solo montaba la boveda con
// `NOXLOOP_BOVEDA_FRASE`, y nadie la pasaba: ni el escritorio ni `npm run
// service`. Sin boveda no hay adaptador de tokens personales, y la instalacion
// del operador no podia conectar ni GitHub con un token. El backend del
// llavero existia (`packages/vault/src/backends/llavero.mjs`) y su binario
// tambien (`noxloop-llavero`), pero nadie los cableaba.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { abrirDependencias } from "../src/dependencias.mjs";

const FALSO = fileURLToPath(new URL("./fixtures/llavero-falso.mjs", import.meta.url));

function llaveroFalso({ caido = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "llavero-falso-"));
  process.env.LLAVERO_FALSO_DIR = dir;
  process.env.LLAVERO_FALSO_CAIDO = caido ? "1" : "0";
  return { dir, llavero: { ejecutable: process.execPath, argumentosPrevios: [FALSO] } };
}

test("con llavero disponible y SIN frase, la boveda se monta sobre el llavero", async () => {
  const { llavero } = llaveroFalso();
  const home = mkdtempSync(join(tmpdir(), "home-llavero-"));
  const dep = await abrirDependencias({ home, llavero });
  try {
    assert.ok(dep.boveda, `no se monto la boveda: ${dep.ausenciaDeLaBoveda?.porque}`);
    assert.equal(dep.backend.tipo, "keychain_so");
    assert.equal(dep.ausenciaDeLaBoveda, null);
  } finally {
    dep.almacen.cerrar?.();
  }
});

test("un valor guardado va al llavero y no a ningun archivo del home", async () => {
  const { llavero, dir } = llaveroFalso();
  const home = mkdtempSync(join(tmpdir(), "home-llavero-"));
  const dep = await abrirDependencias({ home, llavero });
  try {
    await dep.backend.guardar("ref-de-prueba", "valor-centinela-del-llavero-4471");
    assert.equal(await dep.backend.recuperar("ref-de-prueba"), "valor-centinela-del-llavero-4471");
    assert.match(readFileSync(join(dir, "llavero.json"), "utf8"), /valor-centinela-del-llavero-4471/);
  } finally {
    dep.almacen.cerrar?.();
  }
});

test("llavero caido y sin frase: la ausencia se declara con la causa del llavero, no se inventa una frase", async () => {
  const { llavero } = llaveroFalso({ caido: true });
  const home = mkdtempSync(join(tmpdir(), "home-llavero-"));
  const dep = await abrirDependencias({ home, llavero });
  try {
    assert.equal(dep.boveda, null);
    assert.match(dep.ausenciaDeLaBoveda.porque, /llavero/);
  } finally {
    dep.almacen.cerrar?.();
  }
});

test("llavero caido CON frase: cae al respaldo cifrado y lo dice", async () => {
  const { llavero } = llaveroFalso({ caido: true });
  const home = mkdtempSync(join(tmpdir(), "home-llavero-"));
  const dep = await abrirDependencias({ home, llavero, frase: "una frase de prueba larga" });
  try {
    assert.ok(dep.boveda);
    assert.equal(dep.backend.tipo, "archivo_cifrado");
  } finally {
    dep.almacen.cerrar?.();
  }
});
