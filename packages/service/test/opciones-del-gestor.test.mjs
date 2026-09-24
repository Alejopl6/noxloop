// `PATCH /v1/projects/:id/tracker` — las opciones y el mapa de estados del
// gestor, escritos donde el motor los lee (spec 003).
//
// EL HUECO QUE CIERRA. `motor.mjs` lee `connection.capacidades.opcionesDelGestor`
// y `.stateMap`, y ninguna ruta los escribia. Un proyecto con Azure DevOps o
// Linear conectado quedaba en `sin_gestor` para siempre («necesita
// `organization` y `project`, y la conexion no los declara») sin ninguna
// pantalla que los pudiera declarar.
//
// Y SE VALIDA CONTRA EL ESQUEMA QUE EL PROVEEDOR DECLARA, al guardar: una
// opcion mal escrita (`organizacion`) pasaba hasta el `loadProvider` del
// motor, con el operador ya esperando el run.

import { test } from "node:test";
import assert from "node:assert/strict";

import { diagnosticar } from "../src/motor.mjs";
import { conServicio, pedir } from "./ayuda.mjs";
import { proyectoActivo } from "./ayuda-motor.mjs";

const MAPA = { todo: "To Do", in_progress: "Doing", blocked: null, in_review: null, done: null };

/** @param {any} svc @param {string} id @param {any} cuerpo */
async function patch(svc, id, cuerpo) {
  const r = await pedir(svc, `/v1/projects/${id}/tracker`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  return { estado: r.status, cuerpo: await r.json() };
}

test("ADO sin `organization/project` es `sin_gestor`; con el PATCH, el proyecto se puede lanzar", async () => {
  await conServicio({ motor: { intervaloMs: 0 } }, async (svc) => {
    const p = await proyectoActivo(svc, { conexiones: [{ clase: "tracker", proveedor: "azure-devops" }] });
    const antes = await diagnosticar(svc.dep, p);
    assert.equal(antes.problema?.codigo, "sin_gestor");

    const r = await patch(svc, p.id, { opciones: { organization: "acme", project: "pagos" }, stateMap: MAPA });
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
    assert.deepEqual(r.cuerpo.gestor.opciones, { organization: "acme", project: "pagos" });
    assert.deepEqual(r.cuerpo.gestor.stateMap, MAPA);

    const fila = svc.dep.almacen.base.consultarUno("SELECT capacidades FROM connection WHERE project_id = ?", [p.id]);
    const capacidades = JSON.parse(fila.capacidades);
    assert.deepEqual(capacidades.opcionesDelGestor, { organization: "acme", project: "pagos" });
    assert.deepEqual(capacidades.stateMap, MAPA);

    const despues = await diagnosticar(svc.dep, p);
    assert.equal(despues.lanzable, true, JSON.stringify(despues.problema));
  });
});

test("se valida contra el `optionsSchema` del proveedor: clave desconocida, tipo equivocado, mapa incompleto o con `backlog`", async () => {
  await conServicio({ motor: { intervaloMs: 0 } }, async (svc) => {
    const p = await proyectoActivo(svc, { conexiones: [{ clase: "tracker", proveedor: "azure-devops" }] });
    for (const [cuerpo, nombra] of [
      [{ opciones: { organizacion: "acme", project: "x" } }, "organizacion"],
      [{ opciones: { organization: 5, project: "x" } }, "organization"],
      [{ opciones: { project: "x" } }, "organization"],
      [{ stateMap: { todo: "To Do" } }, "in_progress"],
      [{ stateMap: { ...MAPA, backlog: "New" } }, "backlog"],
      [{}, "opciones"],
    ]) {
      const r = await patch(svc, p.id, cuerpo);
      assert.equal(r.estado, 400, `${nombra}: ${JSON.stringify(r.cuerpo)}`);
      assert.equal(r.cuerpo.error.codigo, "cuerpo_invalido");
      assert.match(r.cuerpo.error.causa, new RegExp(nombra), `el error no nombra \`${nombra}\``);
    }
    const fila = svc.dep.almacen.base.consultarUno("SELECT capacidades FROM connection WHERE project_id = ?", [p.id]);
    assert.deepEqual(JSON.parse(fila.capacidades), {}, "un cuerpo invalido escribio algo");
  });
});

test("un gestor de la conexion del ESPACIO no se toca desde un proyecto: 409 `gestor_compartido`; y el local no tiene opciones", async () => {
  await conServicio({ motor: { intervaloMs: 0 } }, async (svc) => {
    const p = await proyectoActivo(svc, { conexiones: [{ clase: "tracker", proveedor: "linear", delEspacio: true }] });
    const r = await patch(svc, p.id, { opciones: { teamKey: "ENG" } });
    assert.equal(r.estado, 409);
    assert.equal(r.cuerpo.error.codigo, "gestor_compartido");
  });
  // Otro servicio: en el de arriba la conexion del ESPACIO alcanza a todo proyecto nuevo.
  await conServicio({ motor: { intervaloMs: 0 } }, async (svc) => {
    const local = await proyectoActivo(svc, { nombre: "Local", conexiones: [] });
    const r2 = await patch(svc, local.id, { opciones: {} });
    assert.equal(r2.estado, 409);
    assert.equal(r2.cuerpo.error.codigo, "sin_gestor");
  });
});
