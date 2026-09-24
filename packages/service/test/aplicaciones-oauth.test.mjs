// Las rutas del unico paso que el producto no puede dar solo: registrar la
// aplicacion OAuth.
//
// POR QUE HAY RUTAS PARA ESTO Y NO UN PARRAFO EN LA DOCUMENTACION. La pregunta
// del operador fue «¿por que debo poner token? ¿no sirven las integraciones con
// OAuth?», y la respuesta —medida contra una instancia propia— es que el
// servidor autoalojado no trae aplicaciones compartidas. Un parrafo lo explica;
// un recorrido con la URL que hay que abrir, la redirect URI que hay que pegar
// y las dos casillas donde vuelven los valores lo RESUELVE, y son cuatro pasos.
//
// LA REGLA QUE ATRAVIESA ESTE ARCHIVO. El Client Secret entra por `POST` y no
// sale por ningun sitio: ni en la respuesta del `POST`, ni en el `GET`, ni en
// un error. Hay una prueba de centinela que lo mide sobre la respuesta
// serializada de las dos rutas.

import { test } from "node:test";
import assert from "node:assert/strict";

import { conServicio, pedir } from "./ayuda.mjs";

const RUTA = "/v1/connections/oauth-apps";

/** @param {any} svc */
async function leer(svc) {
  const r = await pedir(svc, RUTA);
  return { estado: r.status, cuerpo: await r.json() };
}

/** @param {any} svc @param {any} cuerpo */
async function registrar(svc, cuerpo) {
  const r = await pedir(svc, RUTA, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  return { estado: r.status, cuerpo: await r.json() };
}

const CENTINELA = `centinela-client-secret-${Math.random().toString(36).slice(2)}`;

/**
 * Un proveedor de conexiones que trae el registro de aplicaciones, como el
 * alojado. No habla con nadie: lo que se prueba aqui son las rutas.
 */
function proveedorConAplicaciones() {
  const registradas = new Set(["linear"]);
  const recibido = [];
  return {
    recibido,
    registradas,
    proveedor: {
      id: "nango",
      ids: ["nango", "local"],
      servidor: "http://localhost:3003",
      async catalogo() {
        return [
          { slug: "github", nombre: "GitHub", modo: "oauth2", clase: "scm", entorno: {}, api: {} },
          { slug: "linear", nombre: "Linear", modo: "oauth2", clase: "tracker", entorno: {}, api: {} },
        ];
      },
      async listar() {
        return [];
      },
      async preflight() {
        return { ok: true, requisitos: [], problemas: [] };
      },
      async aplicaciones() {
        return {
          servidor: "http://localhost:3003",
          redirect_uri: "http://localhost:3003/oauth/callback",
          aplicaciones_compartidas: {
            hay: false,
            version: "0.71.10",
            porque: "no existen en una instancia propia",
            evidencia: [
              { comprobacion: "GET /api/v1/providers", resultado: "preConfigured: false en los 1013" },
              { comprobacion: "select count(*) from providers_shared_credentials", resultado: "0 filas" },
              { comprobacion: "POST /api/v1/integrations useSharedCredentials", resultado: "400" },
            ],
          },
          items: [
            {
              slug: "github",
              nombre: "GitHub",
              clase: "scm",
              registrada: registradas.has("github"),
              recorrido: {
                slug: "github",
                url_de_registro: "https://github.com/settings/applications/new",
                redirect_uri: "http://localhost:3003/oauth/callback",
                campos_que_devuelve: ["client_id", "client_secret"],
                pasos: [{ titulo: "Abre", detalle: "el registro", abrir: "https://github.com/settings/applications/new" }],
              },
            },
            { slug: "linear", nombre: "Linear", clase: "tracker", registrada: registradas.has("linear"), recorrido: null },
          ],
        };
      },
      async registrarAplicacion(datos) {
        recibido.push(datos);
        registradas.add(datos.slug);
        return { slug: datos.slug, nombre: datos.slug, registrada: true, redirect_uri: "http://localhost:3003/oauth/callback" };
      },
    },
  };
}

test("EL INVARIANTE: `GET /v1/connections/oauth-apps` dice cuales faltan y trae el recorrido", async () => {
  const { proveedor } = proveedorConAplicaciones();
  await conServicio({ proveedorDeConexiones: proveedor }, async (svc) => {
    const r = await leer(svc);
    assert.equal(r.estado, 200);
    const porSlug = Object.fromEntries(r.cuerpo.items.map((a) => [a.slug, a]));
    assert.equal(porSlug.github.registrada, false);
    assert.equal(porSlug.linear.registrada, true);
    assert.ok(porSlug.github.recorrido, "el que falta viene sin recorrido: no guia nada");
    assert.equal(r.cuerpo.redirect_uri, "http://localhost:3003/oauth/callback");
    assert.equal(
      r.cuerpo.aplicaciones_compartidas.hay,
      false,
      "la respuesta no contesta la pregunta que llego primero: por que hay que registrar nada",
    );
    assert.ok(r.cuerpo.aplicaciones_compartidas.evidencia.length >= 3);
  });
});

test("`POST /v1/connections/oauth-apps` registra la aplicacion y NO devuelve el secreto", async () => {
  const { proveedor, recibido } = proveedorConAplicaciones();
  await conServicio({ proveedorDeConexiones: proveedor }, async (svc) => {
    const r = await registrar(svc, {
      proveedor: "github",
      client_id: "un-client-id",
      client_secret: CENTINELA,
    });
    assert.equal(r.estado, 201, JSON.stringify(r.cuerpo));
    assert.equal(r.cuerpo.aplicacion.registrada, true);
    assert.equal(recibido[0].client_secret, CENTINELA, "el secreto no llego al adaptador");
    assert.equal(
      JSON.stringify(r.cuerpo).includes(CENTINELA),
      false,
      "la respuesta de registrar la aplicacion devolvio el Client Secret",
    );

    // Y despues de registrarla, el listado lo refleja: si no, el operador
    // registra y la pantalla le sigue diciendo que falta.
    const listado = await leer(svc);
    assert.equal(listado.cuerpo.items.find((a) => a.slug === "github").registrada, true);
    assert.equal(JSON.stringify(listado.cuerpo).includes(CENTINELA), false);
  });
});

test("faltando un campo, dice CUAL falta y no manda nada al servidor de integraciones", async () => {
  const { proveedor, recibido } = proveedorConAplicaciones();
  await conServicio({ proveedorDeConexiones: proveedor }, async (svc) => {
    const r = await registrar(svc, { proveedor: "github", client_id: "solo-el-id" });
    assert.equal(r.estado, 400);
    assert.ok(String(JSON.stringify(r.cuerpo)).includes("client_secret"), "no nombra el campo que falta");
    assert.deepEqual(recibido, [], "se llamo al adaptador con la peticion incompleta");
  });
});

test("con un adaptador que no registra aplicaciones, la ruta lo dice en vez de reventar", async () => {
  // El adaptador `local` no tiene aplicaciones que registrar: no abre ningun
  // flujo de autorizacion. Un 500 por un metodo que no existe mandaria a
  // revisar el servicio, y lo que pasa es que ese camino no es suyo.
  const soloLocal = {
    id: "local",
    async catalogo() {
      return [];
    },
    async listar() {
      return [];
    },
    async preflight() {
      return { ok: true, requisitos: [], problemas: [] };
    },
  };
  await conServicio({ proveedorDeConexiones: soloLocal }, async (svc) => {
    const r = await leer(svc);
    assert.equal(r.estado, 503);
    const texto = JSON.stringify(r.cuerpo);
    assert.ok(texto.includes("token personal") || texto.includes("local"), `no explica la alternativa: ${texto}`);
    assert.ok(r.cuerpo.error?.accion ?? r.cuerpo.accion, "un 503 sin accion deja al operador sin siguiente paso");
  });
});

test("las dos rutas estan en la tabla, con sus metodos y nada mas", async () => {
  const { TABLA } = await import("../src/tabla.mjs");
  const listado = TABLA.find((r) => r.patron === "/v1/connections/oauth-apps");
  assert.ok(listado, "la ruta no esta en la tabla, asi que la guarda de cobertura no la mira");
  assert.deepEqual(listado.metodos.sort(), ["GET", "HEAD", "POST"].sort());
});
