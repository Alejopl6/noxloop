// Denegar por defecto, y la vigencia comprobada en el instante del uso.
//
// Cubre `sin-grant-no-hay-valor`, `grant-expirado-no-alcanza`,
// `rotacion-conserva-grants` y `vista-inversa-considera-vigencia`.
//
// EL FALLO QUE EVITA. La fila del grant existe: se otorgo el mes pasado para una
// tarea que ya termino. Si la comprobacion mira "hay grant" en vez de "hay grant
// vigente ahora", una vigencia es decoracion y una revocacion no revoca nada.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { crearBoveda } from "../src/boveda.mjs";
import { repositorioEnMemoria } from "../src/repositorio.mjs";
import { crearAuditoria } from "../src/auditoria.mjs";
import { crearBackendDeArchivo } from "../src/backends/archivo.mjs";
import { centinela, trozoDelCentinela, motivoDePrueba } from "./ayuda.mjs";

const HORA = 60 * 60 * 1000;

function bovedaDePrueba() {
  const dir = mkdtempSync(join(tmpdir(), "noxloop-grants-"));
  const backend = crearBackendDeArchivo({
    ruta: join(dir, "credenciales.cifrado"),
    passphrase: "frase-de-prueba",
    motivo: "prueba: no se ejercita el llavero del sistema operativo",
  });
  const auditoria = crearAuditoria();
  const repositorio = repositorioEnMemoria();
  return { boveda: crearBoveda({ backend, repositorio, auditoria }), auditoria, repositorio };
}

async function conCredencial(valor = centinela("grants")) {
  const montado = bovedaDePrueba();
  const { credencial } = await montado.boveda.registrar({
    workspace: "w1",
    nombre: "token-del-gestor",
    proveedor: "proveedor-de-prueba", tipo: "api_token",
    valor,
  });
  return { ...montado, credencial, valor };
}

test("EL INVARIANTE: sin grant no hay valor, y el intento denegado queda auditado", async () => {
  const { boveda, auditoria, credencial, valor } = await conCredencial();

  await assert.rejects(
    () => boveda.recuperar(credencial.ref_boveda, motivoDePrueba({ grant_id: "g-inventado" })),
    (e) => {
      assert.equal(e.codigo, "sin_grant");
      assert.ok(e.accion, "denegar sin decir como pedirlo deja la tarea bloqueada sin salida");
      // El mensaje del error tambien es un sitio donde se persiste texto.
      assert.equal(trozoDelCentinela(`${e.message} ${e.causa ?? ""} ${e.accion}`, valor), null);
      return true;
    },
  );

  const denegado = auditoria.listar().filter((e) => e.resultado === "denegado");
  assert.equal(denegado.length, 1, "un acceso denegado que no se registra no existio para nadie");
  assert.equal(denegado[0].tipo, "acceso");
  assert.equal(denegado[0].motivo.grant_id, "g-inventado");
  assert.ok(denegado[0].causa, "el registro tiene que decir por que se denego");
});

test("T135: un acceso sin motivo completo no se puede escribir", async () => {
  const { boveda, credencial } = await conCredencial();

  // Sin motivo ninguno.
  await assert.rejects(
    () => /** @type {any} */ (boveda).recuperar(credencial.ref_boveda),
    (e) => e.codigo === "motivo_ausente",
  );

  // Con un motivo al que le falta cualquiera de sus campos. El proposito es lo
  // que hace que la auditoria sea automatica en vez de recordada: sin el, el
  // registro no dice para que se saco la credencial.
  for (const campo of ["grant_id", "project_id", "agent_id", "proposito"]) {
    const roto = motivoDePrueba();
    delete roto[campo];
    await assert.rejects(
      () => boveda.recuperar(credencial.ref_boveda, roto),
      (e) => {
        assert.equal(e.codigo, "motivo_ausente", `falto ${campo} y no se rechazo por eso`);
        assert.match(e.causa, new RegExp(campo));
        return true;
      },
    );
  }

  // Un proposito inventado tampoco: la lista esta en el contrato.
  await assert.rejects(
    () => boveda.recuperar(credencial.ref_boveda, motivoDePrueba({ proposito: "porque_si" })),
    (e) => e.codigo === "motivo_ausente" || e.codigo === "proposito_desconocido",
  );
});

test("EL INVARIANTE: un grant con vigencia pasada no alcanza, aunque la fila exista", async () => {
  const { boveda, auditoria, credencial, repositorio } = await conCredencial();
  const grant = await boveda.otorgar({
    project_id: "p1",
    agent_id: "a1",
    credential_id: credencial.id,
    vigenciaHasta: new Date(Date.now() - HORA).toISOString(),
  });

  assert.ok(
    repositorio.instantanea().grants.some((g) => g.id === grant.id),
    "la fila tiene que seguir ahi: lo que caduco es la vigencia, no el registro",
  );

  await assert.rejects(
    () => boveda.recuperar(credencial.ref_boveda, motivoDePrueba({ grant_id: grant.id })),
    (e) => {
      assert.equal(e.codigo, "grant_no_vigente");
      assert.match(e.causa, /vigencia/i);
      return true;
    },
  );
  assert.equal(auditoria.listar().filter((e) => e.resultado === "denegado").length, 1);
});

test("un grant revocado deja de alcanzar desde el instante en que se revoca", async () => {
  const { boveda, credencial } = await conCredencial();
  const grant = await boveda.otorgar({ project_id: "p1", agent_id: "a1", credential_id: credencial.id });
  const motivo = motivoDePrueba({ grant_id: grant.id });

  assert.ok(await boveda.recuperar(credencial.ref_boveda, motivo));
  await boveda.revocar(grant.id);
  await assert.rejects(() => boveda.recuperar(credencial.ref_boveda, motivo), (e) => e.codigo === "grant_no_vigente");
});

test("el grant es una tripleta: no sirve el de otro proyecto, otro agente ni otra credencial", async () => {
  const { boveda, credencial } = await conCredencial();
  const otra = await boveda.registrar({ workspace: "w1", nombre: "otra", proveedor: "proveedor-de-prueba", tipo: "api_token", valor: centinela("otra") });
  const grant = await boveda.otorgar({ project_id: "p1", agent_id: "a1", credential_id: credencial.id });

  for (const cambio of [{ project_id: "p2" }, { agent_id: "a2" }]) {
    await assert.rejects(
      () => boveda.recuperar(credencial.ref_boveda, motivoDePrueba({ grant_id: grant.id, ...cambio })),
      (e) => e.codigo === "sin_grant",
      `el grant alcanzo con ${JSON.stringify(cambio)}`,
    );
  }
  await assert.rejects(
    () => boveda.recuperar(otra.credencial.ref_boveda, motivoDePrueba({ grant_id: grant.id })),
    (e) => e.codigo === "sin_grant",
    "el grant de una credencial alcanzo a otra",
  );
});

test("EL INVARIANTE: rotar cambia la huella y conserva los grants", async () => {
  const { boveda, credencial } = await conCredencial(centinela("antes"));
  const grant = await boveda.otorgar({ project_id: "p1", agent_id: "a1", credential_id: credencial.id });
  const motivo = motivoDePrueba({ grant_id: grant.id });
  const antes = await boveda.huella(credencial.ref_boveda);

  const nuevo = centinela("despues");
  const { huella } = await boveda.rotar(credencial.ref_boveda, nuevo);

  assert.notEqual(huella, antes, "si la huella no cambia, nadie puede saber que se roto");
  assert.equal(await boveda.huella(credencial.ref_boveda), huella);
  // EL FALLO QUE EVITA: implementar rotar como borrar + registrar se lleva los
  // grants por delante, y cada rotacion obliga a volver a autorizar a mano todo
  // lo que la usaba. Eso hace que nadie rote.
  assert.equal(
    await boveda.recuperar(credencial.ref_boveda, motivo),
    nuevo,
    "la rotacion se llevo los grants por delante",
  );
});

test("EL INVARIANTE: la vista inversa no devuelve grants revocados ni expirados", async () => {
  const { boveda, credencial } = await conCredencial();
  const vigente = await boveda.otorgar({ project_id: "p1", agent_id: "a1", credential_id: credencial.id });
  const expirado = await boveda.otorgar({
    project_id: "p2",
    agent_id: "a2",
    credential_id: credencial.id,
    vigenciaHasta: new Date(Date.now() - HORA).toISOString(),
  });
  const revocado = await boveda.otorgar({ project_id: "p3", agent_id: "a3", credential_id: credencial.id });
  await boveda.revocar(revocado.id);
  const futuro = await boveda.otorgar({
    project_id: "p4",
    agent_id: "a4",
    credential_id: credencial.id,
    vigenciaHasta: new Date(Date.now() + HORA).toISOString(),
  });

  const alcance = await boveda.reach({ credential_id: credencial.id });
  const ids = [...alcance.grants.map((g) => g.id)].sort();
  assert.deepEqual(ids, [vigente.id, futuro.id].sort(), `la vista inversa devolvio: ${JSON.stringify(ids)}`);
  assert.deepEqual([...alcance.proyectos].sort(), ["p1", "p4"]);
  assert.deepEqual([...alcance.agentes].sort(), ["a1", "a4"]);

  // Y en el otro sentido: que alcanza un proyecto.
  const porProyecto = await boveda.reach({ project_id: "p3" });
  assert.deepEqual(porProyecto.grants, [], "un proyecto con el grant revocado no alcanza nada");
});
