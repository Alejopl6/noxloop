// `boveda-no-serializa-valor` — la prueba que sostiene el principio IX.
//
// EL FALLO QUE EVITA. Nadie escribe `credencial.valor = secreto` a proposito. Lo
// que pasa es mas barato: una entidad gana un campo "para depurar", un
// `JSON.stringify` del inventario acaba en un log, y el secreto queda en disco
// sin que ninguna linea diga que lo puso ahi. Por eso esta prueba no mira el
// codigo ni la intencion: serializa el objeto real —y el archivo real— y busca
// el centinela dentro, entero o truncado.

import { test } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { crearBoveda } from "../src/boveda.mjs";
import { repositorioEnMemoria } from "../src/repositorio.mjs";
import { crearAuditoria } from "../src/auditoria.mjs";
import { crearBackendDeArchivo } from "../src/backends/archivo.mjs";
import { centinela, trozoDelCentinela } from "./ayuda.mjs";

/** Monta una boveda completa sobre un archivo cifrado en un directorio temporal. */
function bovedaDePrueba() {
  const dir = mkdtempSync(join(tmpdir(), "noxloop-boveda-"));
  const archivo = join(dir, "credenciales.cifrado");
  const backend = crearBackendDeArchivo({
    ruta: archivo,
    passphrase: "una-frase-de-prueba-que-no-es-un-secreto-real",
    motivo: "prueba: no se ejercita el llavero del sistema operativo",
  });
  const repositorio = repositorioEnMemoria();
  const auditoria = crearAuditoria();
  return { boveda: crearBoveda({ backend, repositorio, auditoria }), repositorio, auditoria, archivo };
}

test("EL INVARIANTE: ninguna entidad del inventario serializa el valor, ni truncado", async () => {
  const valor = centinela("inventario");
  const { boveda, repositorio, auditoria, archivo } = bovedaDePrueba();

  const { credencial, huella } = await boveda.registrar({
    workspace: "w1",
    nombre: "token-del-gestor",
    proveedor: "proveedor-de-prueba", tipo: "api_token",
    valor,
  });
  const grant = await boveda.otorgar({
    project_id: "p1",
    agent_id: "a1",
    credential_id: credencial.id,
  });
  // Un acceso concedido: es el momento en que el valor existe de verdad en el
  // proceso, y por tanto el momento en que se puede filtrar a una estructura.
  const recuperado = await boveda.recuperar(credencial.ref_boveda, {
    grant_id: grant.id,
    project_id: "p1",
    agent_id: "a1",
    proposito: "lanzar_runner",
  });
  assert.equal(recuperado, valor, "si esto falla, el resto de la prueba no prueba nada");

  const sospechosos = {
    credencial: JSON.stringify(credencial),
    grant: JSON.stringify(grant),
    inventario: JSON.stringify(repositorio.instantanea()),
    auditoria: JSON.stringify(auditoria.listar()),
    boveda: JSON.stringify(boveda),
    "boveda (inspect profundo)": inspect(boveda, { depth: Infinity, showHidden: true }),
    "repositorio (inspect profundo)": inspect(repositorio, { depth: Infinity, showHidden: true }),
    huella,
    "archivo en disco": readFileSync(archivo, "utf8"),
  };

  for (const [donde, texto] of Object.entries(sospechosos)) {
    const trozo = trozoDelCentinela(String(texto), valor);
    assert.equal(trozo, null, `el valor aparece en ${donde}: ${trozo}`);
  }
});

test("la huella identifica el valor sin revelarlo, y cambia cuando el valor cambia", async () => {
  const { boveda } = bovedaDePrueba();
  const primero = centinela("huella-1");
  const { credencial, huella } = await boveda.registrar({
    workspace: "w1",
    nombre: "clave",
    proveedor: "proveedor-de-prueba", tipo: "api_token",
    valor: primero,
  });
  assert.equal(await boveda.huella(credencial.ref_boveda), huella);
  assert.equal(trozoDelCentinela(huella, primero, 8), null);

  const { huella: segunda } = await boveda.guardar(credencial.ref_boveda, centinela("huella-2"));
  assert.notEqual(segunda, huella, "sin esto, rotar una credencial no se puede detectar");
});

test("`existe` responde sin revelar, y de una credencial que no esta dice que no", async () => {
  const { boveda } = bovedaDePrueba();
  const { credencial } = await boveda.registrar({
    workspace: "w1",
    nombre: "clave",
    proveedor: "proveedor-de-prueba", tipo: "api_token",
    valor: centinela("existe"),
  });
  assert.equal(await boveda.existe(credencial.ref_boveda), true);
  assert.equal(await boveda.existe("noxloop:w1:no-existe"), false);
  assert.equal(await boveda.huella("noxloop:w1:no-existe"), null);
});

test("borrar deja de tener el valor y lo registra en la bitacora", async () => {
  const { boveda, auditoria } = bovedaDePrueba();
  const { credencial } = await boveda.registrar({
    workspace: "w1",
    nombre: "clave",
    proveedor: "proveedor-de-prueba", tipo: "api_token",
    valor: centinela("borrado"),
  });
  await boveda.borrar(credencial.ref_boveda);
  assert.equal(await boveda.existe(credencial.ref_boveda), false);
  assert.ok(
    auditoria.listar().some((e) => e.tipo === "credencial_borrada"),
    "borrar sin dejar constancia hace imposible explicar un inventario que encogio",
  );
});
