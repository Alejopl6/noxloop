// T193 y T195 — el handoff al motor.
//
// T195 ES EL QUE MAS IMPORTA DE ESTE ARCHIVO, y es el mismo que ya protege el
// board de v1: se mide el disco antes y despues de un `GET` y no cambio nada.
// El motivo esta en el principio VIII. `state.mjs` es el escritor unico del
// estado del run, y ese unico escritor es lo que hace que las transiciones
// guardadas signifiquen algo. Un endpoint de lectura con permiso de escritura
// es un segundo escritor por la puerta de atras: no falla al escribir, falla
// tres pantallas despues, cuando dos ventanas sobre el mismo run lo corrompen
// sin que nadie lo note.
//
// Y no vale con revisar el codigo. "No escribe" es prosa hasta que existe el
// objeto que lo prueba, igual que un gate no paso hasta que existe su exit
// code. El objeto es la huella del arbol antes y despues.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { conServicio, pedir, repoDePrueba, huellaDelArbol, diferencias } from "./ayuda.mjs";

/** Un run en disco, con la forma que escribe el motor. */
function runEnDisco(home, id, projectId, extra = {}) {
  const dir = join(home, "runs");
  mkdirSync(dir, { recursive: true });
  const run = {
    schemaVersion: 1,
    createdAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:00.000Z",
    project_id: projectId,
    item: { id, title: `ticket ${id}`, provider: "un-gestor" },
    tasks: [{ id: "t1", title: "una tarea", repo: "r", status: "pending", attempts: {}, dependsOn: [] }],
    spent: { usd: 0, calls: 0 },
    ...extra,
  };
  writeFileSync(join(dir, `run-${id}.json`), JSON.stringify(run));
  return run;
}

/** @param {any} svc @param {string} estado hasta donde llevar el proyecto */
async function proyectoLocal(svc, nombre = "Con Runs") {
  const r = await pedir(svc, "/v1/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ origen: "local", nombre, ruta_local: repoDePrueba() }),
  });
  return (await r.json()).proyecto;
}

test("T193: POST /runs sobre un proyecto que no esta ACTIVE da 409 NOMBRANDO la etapa que falta", async () => {
  await conServicio({}, async (svc) => {
    const proyecto = await proyectoLocal(svc);

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ item: "T-1" }),
    });

    assert.equal(r.status, 409, await r.clone().text());
    const { error } = await r.json();
    assert.equal(error.codigo, "proyecto_no_activo");

    // Lo que hace util a este error: la etapa concreta. "No esta activo" sin
    // decir que falta deja al operador recorriendo las seis etapas a mano.
    assert.match(error.causa, /CREATED/, "la causa tiene que decir en que estado esta");

    // LA ETAPA POR SU NOMBRE, y se afirma el nombre EXACTO del artefacto a
    // proposito. La primera version de este test buscaba `/snapshot/i` en la
    // causa entera y pasaba igual con la etapa sustituida por la palabra
    // "alguna": el texto del hallazgo ya mencionaba el snapshot por su cuenta,
    // asi que la asercion estaba mirando el campo equivocado. Una asercion que
    // pasa con el mecanismo roto no prueba el mecanismo.
    assert.match(
      error.causa,
      /`snapshot_aceptado`/,
      "FR-064 pide NOMBRAR la etapa que falta, no aludir a ella: desde CREATED es `snapshot_aceptado`",
    );
    assert.match(error.causa, /hallazgo|snapshot/i, "y decir que se encontro en su lugar");
    assert.ok(
      error.accion.length > 30,
      `la accion tiene que decir como conseguir ese artefacto, y dijo: "${error.accion}"`,
    );
  });
});

test("T195 — EL INVARIANTE: `GET /runs` no cambia NADA en el disco", async () => {
  await conServicio({}, async (svc) => {
    const proyecto = await proyectoLocal(svc);
    runEnDisco(svc.home, "T-100", proyecto.id);
    runEnDisco(svc.home, "T-101", proyecto.id);

    // Se mide el home entero, que es donde vive el estado del run. El almacen
    // esta dentro y tampoco puede moverse: una lectura que escribe en SQLite
    // —una tabla de "ultimo visto", una cache— es exactamente el segundo
    // escritor que esto busca.
    const antes = huellaDelArbol(svc.home);

    const lista = await pedir(svc, `/v1/projects/${proyecto.id}/runs`);
    assert.equal(lista.status, 200, await lista.clone().text());
    const { items: runs } = await lista.json();
    assert.equal(runs.length, 2, "el test no vale si no leyo nada");

    const uno = await pedir(svc, "/v1/runs/T-100");
    assert.equal(uno.status, 200);
    assert.equal((await uno.json()).run.item.id, "T-100");

    const despues = huellaDelArbol(svc.home);
    assert.deepEqual(
      diferencias(antes, despues),
      [],
      "un GET de runs escribio en el disco: el motor dejo de ser el unico escritor del estado del run",
    );
  });
});

test("T195, la otra mitad: leer un run NO existe como escritura ni siquiera cuando el archivo esta roto", async () => {
  await conServicio({}, async (svc) => {
    const proyecto = await proyectoLocal(svc);
    mkdirSync(join(svc.home, "runs"), { recursive: true });
    writeFileSync(join(svc.home, "runs", "run-T-ROTO.json"), "esto no es json");

    const antes = huellaDelArbol(svc.home);
    const r = await pedir(svc, `/v1/projects/${proyecto.id}/runs`);
    // Un archivo malo no puede tumbar la lectura: se abre el board cuando algo
    // ya se rompio, y desaparecer justo ahi es lo peor que puede hacer.
    assert.equal(r.status, 200, await r.clone().text());
    const cuerpo = await r.json();
    assert.ok(
      cuerpo.avisos.some((a) => /T-ROTO/.test(a.causa) && a.codigo && a.accion),
      "el archivo ilegible se declara con codigo, causa y accion — no se traga y no sale a medias",
    );

    assert.deepEqual(
      diferencias(antes, huellaDelArbol(svc.home)),
      [],
      "reparar o reescribir un run corrupto es escribir estado, y esa no es la competencia de este servicio",
    );
  });
});

test("GET /runs sin ningun run devuelve una lista vacia, no un 404", async () => {
  await conServicio({}, async (svc) => {
    const proyecto = await proyectoLocal(svc);
    const r = await pedir(svc, `/v1/projects/${proyecto.id}/runs`);
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).items, []);
  });
});

test("GET /v1/runs/:id de uno que no esta da 404 con su accion", async () => {
  await conServicio({}, async (svc) => {
    const r = await pedir(svc, "/v1/runs/T-QUE-NO-HAY");
    assert.equal(r.status, 404);
    const { error } = await r.json();
    assert.equal(error.codigo, "recurso_desconocido");
    assert.ok(error.accion.length > 20);
  });
});

test("los runs de OTRO proyecto no salen en la lista de este", async () => {
  await conServicio({}, async (svc) => {
    const uno = await proyectoLocal(svc, "Uno");
    const otro = await proyectoLocal(svc, "Otro");
    runEnDisco(svc.home, "T-DEL-UNO", uno.id);
    runEnDisco(svc.home, "T-DEL-OTRO", otro.id);

    const { items: runs } = await (await pedir(svc, `/v1/projects/${uno.id}/runs`)).json();
    assert.deepEqual(runs.map((r) => r.item.id), ["T-DEL-UNO"]);
  });
});
