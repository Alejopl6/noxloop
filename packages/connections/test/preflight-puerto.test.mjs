// T155 · el preflight comprueba el puerto del callback AL ARRANCAR y falla
// ruidosamente.
//
// POR QUE NO HAY REASIGNACION DINAMICA, QUE ES LO QUE CUALQUIERA HARIA. El
// puerto del callback queda registrado como redirect URI en la aplicacion OAuth
// de CADA proveedor. Moverlo en caliente no degrada el flujo: lo rompe entero,
// y el error que devuelve el proveedor habla de un redirect_uri que no coincide,
// no de un puerto ocupado. Es un contrato con el mundo exterior, y eso se
// comprueba al arrancar.
//
// LA DIFERENCIA QUE MIDE ESTA PRUEBA. "Al arrancar, no al conectar" quiere decir
// que el diagnostico lo da `preflight`, y que `arrancar` se niega a seguir. Un
// try/catch dentro de `conectar` daria el mismo mensaje seis pantallas despues,
// con el operador ya metido en el flujo.

import { test } from "node:test";
import assert from "node:assert/strict";

import { crearAdaptadorFalso } from "../src/adaptadores/fake.mjs";
import { crearAdaptadorLocal } from "../src/adaptadores/local.mjs";
import { sondearPuertoConNet, PUERTO_DE_CALLBACK } from "../src/preflight.mjs";
import { arrancar } from "../src/arranque.mjs";
import { puertoLibre, puertoOcupadoDeVerdad } from "./ayuda.mjs";

test("el sondeo del puerto mira un puerto de verdad: ocupado es ocupado y libre es libre", async () => {
  const { puerto, soltar } = await puertoOcupadoDeVerdad();
  try {
    const ocupado = await sondearPuertoConNet(puerto);
    assert.equal(ocupado.libre, false);
    assert.ok(ocupado.causa, "decir que esta ocupado sin decir por que no ayuda a liberarlo");
  } finally {
    await soltar();
  }

  const libre = await sondearPuertoConNet(await puertoLibre());
  assert.equal(libre.libre, true);
});

test("EL INVARIANTE: con el puerto del callback ocupado, preflight lo dice con causa y accion", async () => {
  const { puerto, soltar } = await puertoOcupadoDeVerdad();
  try {
    const proveedor = crearAdaptadorFalso({ puertoDeCallback: puerto, sondearPuerto: sondearPuertoConNet });
    const estado = await proveedor.preflight();

    assert.equal(estado.ok, false, "el puerto estaba tomado y el preflight dijo que todo bien");
    const problema = estado.problemas.find((p) => p.codigo === "puerto_ocupado");
    assert.ok(problema, `ningun problema habla del puerto: ${JSON.stringify(estado.problemas)}`);
    assert.match(problema.causa, new RegExp(String(puerto)), "la causa no nombra el puerto");
    assert.ok(problema.accion, "un puerto ocupado sin accion deja al operador sin nada que hacer");
    assert.match(
      problema.accion,
      /liber|proceso/i,
      "la accion tiene que llevar a liberar el puerto, no a cambiarlo: esta registrado en cada aplicacion OAuth",
    );
  } finally {
    await soltar();
  }
});

test("arrancar se niega a seguir con el puerto ocupado, y lo hace ruidosamente", async () => {
  const { puerto, soltar } = await puertoOcupadoDeVerdad();
  try {
    const proveedor = crearAdaptadorFalso({ puertoDeCallback: puerto, sondearPuerto: sondearPuertoConNet });
    await assert.rejects(
      () => arrancar(proveedor),
      (e) => {
        assert.equal(e.codigo, "preflight_fallido");
        assert.match(e.causa, new RegExp(String(puerto)));
        assert.ok(e.accion);
        return true;
      },
    );
  } finally {
    await soltar();
  }
});

test("el diagnostico del puerto es del preflight, no de conectar", async () => {
  // Si `conectar` sondeara el puerto, el operador se enteraria seis pantallas
  // despues de arrancar, y el sintoma seria "la conexion falla" en vez de "la
  // aplicacion no arranca".
  const { puerto, soltar } = await puertoOcupadoDeVerdad();
  const sondeos = { veces: 0 };
  try {
    const proveedor = crearAdaptadorFalso({
      puertoDeCallback: puerto,
      sondearPuerto: async (p) => {
        sondeos.veces += 1;
        return await sondearPuertoConNet(p);
      },
    });
    await proveedor.preflight();
    const antes = sondeos.veces;
    assert.ok(antes > 0, "el preflight no sondeo el puerto");

    await proveedor.conectar({ projectId: "p", slug: "falso-oauth2" });
    assert.equal(sondeos.veces, antes, "conectar sondeo el puerto: el diagnostico se movio al sitio equivocado");
  } finally {
    await soltar();
  }
});

test("con el puerto libre el preflight pasa y declara el requisito", async () => {
  const puerto = await puertoLibre();
  const proveedor = crearAdaptadorFalso({ puertoDeCallback: puerto, sondearPuerto: sondearPuertoConNet });
  const estado = await proveedor.preflight();
  assert.equal(estado.ok, true, JSON.stringify(estado.problemas));
  const requisito = estado.requisitos.find((r) => r.tipo === "puerto");
  assert.ok(requisito, "el preflight paso sin declarar que el puerto es un requisito");
  assert.equal(requisito.puerto, puerto);
});

test("un adaptador SIN oauth2 en su catalogo no reclama el puerto: no tiene callback que registrar", async () => {
  // `local` no hace OAuth. Exigirle el puerto seria impedirle arrancar por un
  // contrato externo que no firmo — y es justo el adaptador que existe para el
  // operador que no puede levantar la infraestructura del otro.
  const proveedor = crearAdaptadorLocal({
    boveda: bovedaInerte(),
    workspaceId: "espacio-de-prueba",
    peticion: async () => new Response("{}"),
  });
  const estado = await proveedor.preflight();
  assert.deepEqual(estado.requisitos.filter((r) => r.tipo === "puerto"), []);
  assert.equal(estado.ok, true, JSON.stringify(estado.problemas));
});

test("el puerto del callback tiene un valor declarado y es el registrado con los proveedores", () => {
  assert.equal(PUERTO_DE_CALLBACK, 3003);
});

function bovedaInerte() {
  return {
    registrar: async () => ({ credencial: { id: "c", ref_boveda: "noxloop:w:c" } }),
    otorgar: async () => ({ id: "g" }),
    recuperar: async () => "",
    borrar: async () => {},
    revocar: async () => {},
  };
}
