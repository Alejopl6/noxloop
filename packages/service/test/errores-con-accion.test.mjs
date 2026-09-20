// El formato unico de error, y la guarda que lo sostiene.
//
// POR QUE ESTE TEST RECORRE EL CATALOGO ENTERO EN VEZ DE MIRAR TRES ERRORES.
// NFR-006 exige que todo error nombre la causa y la accion siguiente. Un test
// que comprueba los errores que alguien se acordo de listar deja de cubrir el
// septimo error el dia que alguien agrega el septimo error — y ese es siempre
// el que aparece en la maquina del operador. Aca el catalogo es la fuente: si
// hay un codigo sin forma de provocarlo, o uno que se provoca y sale sin
// `accion`, el test falla nombrando cual.
//
// La `accion` no es cortesia. Un servicio local que dice "no autorizado" y se
// calla deja al operador reinstalando la aplicacion; uno que dice donde esta el
// token lo devuelve al trabajo en diez segundos.

import { test } from "node:test";
import assert from "node:assert/strict";

import { CATALOGO, deExcepcion } from "../src/errores.mjs";
import { arrancar } from "../src/servidor.mjs";
import { homeTemporal, ORIGEN, TOKEN } from "./ayuda.mjs";

/**
 * Como se provoca cada error del catalogo, de verdad. No se fabrica el objeto:
 * se ejerce el camino que lo emite y se mira lo que sale por el cable.
 *
 * @type {Record<string, (svc: any) => Promise<any>>}
 */
const PROVOCADORES = {
  falta_token: async (svc) =>
    (await (await fetch(`${svc.url}/v1/capabilities`, { headers: { origin: ORIGEN } })).json()).error,

  token_invalido: async (svc) =>
    (await (await fetch(`${svc.url}/v1/capabilities`, {
      headers: { origin: ORIGEN, "x-noxloop-token": "el que no es" },
    })).json()).error,

  origen_no_permitido: async (svc) =>
    (await (await fetch(`${svc.url}/v1/capabilities`, {
      headers: { origin: "https://otra-pestana.invalid", "x-noxloop-token": TOKEN },
    })).json()).error,

  ruta_desconocida: async (svc) =>
    (await (await fetch(`${svc.url}/v1/lo-que-no-existe`, {
      headers: { "x-noxloop-token": TOKEN },
    })).json()).error,

  metodo_no_permitido: async (svc) =>
    (await (await fetch(`${svc.url}/v1/health`, {
      method: "DELETE",
      headers: { "x-noxloop-token": TOKEN },
    })).json()).error,

  home_bloqueado: async (svc) => {
    // El segundo servicio sobre el mismo home. No llega a escuchar: el error
    // sale del arranque, y tiene la misma obligacion que uno de HTTP.
    try {
      const otro = await arrancar({ home: svc.home, token: TOKEN });
      await otro.detener();
      throw new Error("arranco un segundo servicio sobre el mismo home");
    } catch (e) {
      return e.cuerpo ? e.cuerpo.error : null;
    }
  },

  fallo_interno: async () => deExcepcion(new Error("una excepcion que nadie previo")).error,
};

test("todo codigo del catalogo tiene una forma de provocarlo", () => {
  const sinProvocador = Object.keys(CATALOGO).filter((c) => !PROVOCADORES[c]);
  assert.deepEqual(
    sinProvocador,
    [],
    `hay errores declarados que ningun camino del servicio emite: ${sinProvocador.join(", ")}`,
  );
});

test("EL INVARIANTE: ningun error del servicio sale sin causa y sin accion", async (t) => {
  const svc = await arrancar({ home: homeTemporal(), token: TOKEN });
  t.after(() => svc.detener());

  for (const codigo of Object.keys(CATALOGO)) {
    const error = await PROVOCADORES[codigo](svc);
    assert.ok(error, `${codigo}: no salio ningun error`);
    assert.equal(error.codigo, codigo, `${codigo}: el provocador emitio ${error.codigo}`);

    // La causa es texto completo, no un resumen: el contrato lo dice asi.
    assert.equal(typeof error.causa, "string", `${codigo}: la causa no es texto`);
    assert.ok(error.causa.length > 30, `${codigo}: la causa es demasiado corta para explicar nada`);

    assert.equal(typeof error.accion, "string", `${codigo}: no trae accion`);
    assert.ok(error.accion.length > 20, `${codigo}: la accion no nombra ninguna operacion concreta`);
    assert.ok(
      /[A-Za-z]/.test(error.accion) && !/^(reintenta|intenta de nuevo)\.?$/i.test(error.accion.trim()),
      `${codigo}: "${error.accion}" no es una accion, es un encogimiento de hombros`,
    );
  }
});

test("la respuesta de error no trae nada mas que el sobre: { error: {...} }", async () => {
  const svc = await arrancar({ home: homeTemporal(), token: TOKEN });
  try {
    const r = await fetch(`${svc.url}/v1/lo-que-no-existe`, { headers: { "x-noxloop-token": TOKEN } });
    assert.equal(r.status, 404);
    assert.match(r.headers.get("content-type"), /application\/json/);
    const cuerpo = await r.json();
    assert.deepEqual(Object.keys(cuerpo), ["error"], "un segundo campo arriba parte a los clientes en dos");
    for (const clave of Object.keys(cuerpo.error)) {
      assert.ok(
        ["codigo", "causa", "accion", "objeto"].includes(clave),
        `el error trae un campo que el contrato no declara: ${clave}`,
      );
    }
  } finally {
    await svc.detener();
  }
});

test("el codigo HTTP acompania al codigo del error, no lo contradice", async () => {
  const svc = await arrancar({ home: homeTemporal(), token: TOKEN });
  try {
    const casos = [
      ["/v1/capabilities", {}, 401],
      ["/v1/lo-que-no-existe", { "x-noxloop-token": TOKEN }, 404],
    ];
    for (const [ruta, headers, esperado] of casos) {
      const r = await fetch(`${svc.url}${ruta}`, { headers: /** @type {any} */ (headers) });
      assert.equal(r.status, esperado, `${ruta} contesto ${r.status}`);
    }
  } finally {
    await svc.detener();
  }
});
