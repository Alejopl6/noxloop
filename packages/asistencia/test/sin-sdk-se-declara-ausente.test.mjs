// La frontera degrada: cuando el SDK no esta, se dice por que y como
// conseguirlo. No se revienta, y no se calla.
//
// EL CASO REAL QUE ESTO CUBRE. Al escritorio viaja lo que `tauri.conf.json`
// declara. Si alguien quita —o se olvida de mover— una entrada del subarbol de
// `node_modules`, el import muere con `ERR_MODULE_NOT_FOUND` DENTRO de la
// aplicacion instalada. Lo que el operador ve entonces depende enteramente de
// este archivo: o una ventana que no abre y un log que nadie mira, o una
// tarjeta que dice "la asistencia no esta disponible en esta instalacion
// porque falta tal paquete". La segunda es la unica que se puede arreglar.
//
// POR QUE `cargar` SE INYECTA. Para poder probar la ausencia sin desinstalar
// nada y sin red: la prueba pasa un cargador que falla igual que fallaria el
// bundle roto. Es el mismo criterio que el resto del producto usa con los
// adaptadores de runtime y con el proveedor de conexiones.

import { test } from "node:test";
import assert from "node:assert/strict";

import { crearProveedorDeAiSdk, MODELO_POR_DEFECTO } from "../src/proveedor-ai-sdk.mjs";

/** Un fallo identico al que da Node cuando el paquete no viajo al bundle. */
function comoEnElBundleRoto(especificador) {
  const e = new Error(`Cannot find package '${especificador}' imported from /Applications/noxloop.app/asistencia`);
  /** @type {any} */ (e).code = "ERR_MODULE_NOT_FOUND";
  return e;
}

test("sin el SDK en el bundle, la asistencia se declara ausente con causa y accion", async () => {
  const proveedor = crearProveedorDeAiSdk({
    clave: "no-se-usa-porque-no-se-llega-a-llamar",
    cargar: async (especificador) => {
      throw comoEnElBundleRoto(especificador);
    },
  });

  await assert.rejects(
    () => proveedor({ esquema: { type: "object" }, sistema: "s", instruccion: "i" }),
    (/** @type {any} */ e) => {
      assert.equal(e.codigo, "sdk_ausente");
      assert.match(e.causa, /ERR_MODULE_NOT_FOUND|no se pudo cargar/i);
      assert.match(e.causa, /\bai\b/, "la causa no dice QUE paquete falta");
      assert.match(e.accion, /tauri\.conf\.json/, "la accion no dice donde se declara lo que viaja al escritorio");
      assert.equal(e.estado, 503);
      return true;
    },
  );
});

test("un fallo del SDK que NO es de carga no se disfraza de ausencia", async () => {
  // Si una clave caducada saliera como `sdk_ausente`, la accion mandaria al
  // operador a revisar el empaquetado por un problema de credencial. Dos
  // causas distintas necesitan dos acciones distintas.
  const proveedor = crearProveedorDeAiSdk({
    clave: "una-clave",
    cargar: async () => ({
      generateObject: async () => {
        throw new Error("401 authentication_error: invalid x-api-key");
      },
      jsonSchema: (/** @type {any} */ e) => e,
      createAnthropic: () => () => ({}),
    }),
  });

  await assert.rejects(
    () => proveedor({ esquema: { type: "object" }, sistema: "s", instruccion: "i" }),
    (/** @type {any} */ e) => {
      assert.equal(e.codigo, "modelo_no_contesto");
      assert.match(e.causa, /invalid x-api-key/);
      return true;
    },
  );
});

test("el modelo por defecto esta declarado y es el que viaja en la procedencia", async () => {
  /** @type {any} */
  let vistoPorElSdk = null;
  const proveedor = crearProveedorDeAiSdk({
    clave: "una-clave",
    cargar: async () => ({
      generateObject: async (/** @type {any} */ opciones) => {
        vistoPorElSdk = opciones;
        return { object: { ok: true } };
      },
      jsonSchema: (/** @type {any} */ e) => e,
      createAnthropic: (/** @type {any} */ conf) => {
        vistoPorElSdk = { ...vistoPorElSdk, conf };
        return (/** @type {string} */ id) => ({ id });
      },
    }),
  });

  const salida = await proveedor({ esquema: { type: "object" }, sistema: "s", instruccion: "i" });
  assert.equal(salida.modelo, MODELO_POR_DEFECTO);
  assert.equal(salida.proveedor, "anthropic");
  assert.deepEqual(salida.objeto, { ok: true });
  assert.equal(vistoPorElSdk.model.id, MODELO_POR_DEFECTO);
});

test("LA CLAVE NO VUELVE: ni en la salida del proveedor, ni dentro de un error suyo", async () => {
  // Principio IX. El valor entra por el entorno del proveedor y no sale: el
  // unico camino por el que podria volver es un mensaje de error que arrastre
  // la configuracion, y eso es exactamente lo que se comprueba aqui sobre el
  // objeto serializado.
  const CENTINELA = "sk-ant-CENTINELA-QUE-NO-PUEDE-SALIR-9f3a";

  const ok = crearProveedorDeAiSdk({
    clave: CENTINELA,
    cargar: async () => ({
      generateObject: async () => ({ object: { ok: true } }),
      jsonSchema: (/** @type {any} */ e) => e,
      createAnthropic: () => () => ({}),
    }),
  });
  const salida = await ok({ esquema: { type: "object" }, sistema: "s", instruccion: "i" });
  assert.ok(!JSON.stringify(salida).includes(CENTINELA), "la clave salio en la respuesta del proveedor");

  // Y el camino de error, que es por donde vuelven las configuraciones: el SDK
  // revienta con la clave dentro del mensaje, como hace cualquier cliente HTTP
  // que serializa sus opciones al fallar.
  const roto = crearProveedorDeAiSdk({
    clave: CENTINELA,
    cargar: async () => ({
      generateObject: async () => {
        throw new Error(`request failed with headers {"x-api-key":"${CENTINELA}"}`);
      },
      jsonSchema: (/** @type {any} */ e) => e,
      createAnthropic: () => () => ({}),
    }),
  });

  const fallo = await roto({ esquema: { type: "object" }, sistema: "s", instruccion: "i" }).then(
    () => null,
    (/** @type {any} */ e) => e,
  );
  assert.ok(fallo, "el proveedor no fallo cuando el SDK fallo");
  const serializado = JSON.stringify({ codigo: fallo.codigo, causa: fallo.causa, accion: fallo.accion, m: fallo.message });
  assert.ok(
    !serializado.includes(CENTINELA),
    `la clave volvio dentro del error:\n${serializado}`,
  );
});
