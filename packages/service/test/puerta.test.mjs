// La puerta: token de sesion y allowlist de origenes.
//
// EL FALLO QUE EVITA, y no es hipotetico: cualquier pagina abierta en el
// navegador del operador puede hacer peticiones a `127.0.0.1`. Sin token, un
// anuncio en otra pestaña enumera sus proyectos, sus conexiones y su bandeja
// con un `fetch` de tres lineas. Ya le paso a otros productos de escritorio con
// servidor local, y el operador no ve absolutamente nada.
//
// El token cierra el caso general. La allowlist de `Origin` cierra el que queda
// cuando el token se filtra a una pagina: un origen que no esta en la lista no
// recibe respuesta ni cabecera de CORS, asi que el navegador no le deja leer ni
// lo que el servicio hubiera contestado.

import { test } from "node:test";
import assert from "node:assert/strict";

import { conServicio, pedir, ORIGEN, TOKEN } from "./ayuda.mjs";

test("sin token no se contesta nada que no sea salud", async () => {
  await conServicio({}, async (svc) => {
    const r = await fetch(`${svc.url}/v1/capabilities`, { headers: { origin: ORIGEN } });
    assert.equal(r.status, 401);
    const cuerpo = await r.json();
    assert.equal(cuerpo.error.codigo, "falta_token");
    assert.ok(cuerpo.error.accion, "un 401 sin accion deja al operador sin saber donde esta el token");
  });
});

test("un token que no es EL token tampoco entra", async () => {
  await conServicio({}, async (svc) => {
    const r = await fetch(`${svc.url}/v1/capabilities`, {
      headers: { origin: ORIGEN, "x-noxloop-token": `${TOKEN}-pero-no` },
    });
    assert.equal(r.status, 401);
    assert.equal((await r.json()).error.codigo, "token_invalido");
  });
});

test("el token tambien viaja como Bearer, que es lo que manda un cliente HTTP normal", async () => {
  await conServicio({}, async (svc) => {
    const r = await fetch(`${svc.url}/v1/capabilities`, {
      headers: { origin: ORIGEN, authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(r.status, 200);
  });
});

test("un origen fuera de la allowlist se rechaza aunque traiga el token bueno", async () => {
  await conServicio({}, async (svc) => {
    const r = await fetch(`${svc.url}/v1/capabilities`, {
      headers: { origin: "https://una-pagina-cualquiera.invalid", "x-noxloop-token": TOKEN },
    });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).error.codigo, "origen_no_permitido");
    assert.equal(
      r.headers.get("access-control-allow-origin"),
      null,
      "un origen rechazado no puede llevarse la cabecera que le deja leer la respuesta",
    );
  });
});

test("la allowlist es configuracion, no una lista escrita a mano en el codigo", async () => {
  // Principio VII: el origen de la web de un operador no lo sabe este
  // repositorio. Si la lista no se puede cambiar sin editar el motor, la unica
  // salida del operador es abrirlo con `*`.
  const propio = "http://una-maquina-del-operador:8080";
  await conServicio({ origenes: [propio] }, async (svc) => {
    const acepta = await fetch(`${svc.url}/v1/capabilities`, {
      headers: { origin: propio, "x-noxloop-token": TOKEN },
    });
    assert.equal(acepta.status, 200);
    assert.equal(acepta.headers.get("access-control-allow-origin"), propio);

    const rechaza = await fetch(`${svc.url}/v1/capabilities`, {
      headers: { origin: ORIGEN, "x-noxloop-token": TOKEN },
    });
    assert.equal(rechaza.status, 403, "declarar una lista propia reemplaza la de por defecto");
  });
});

test("NUNCA se contesta con Access-Control-Allow-Origin: *", async () => {
  await conServicio({}, async (svc) => {
    for (const ruta of ["/v1/health", "/v1/capabilities", "/v1/no-existe"]) {
      const r = await pedir(svc, ruta);
      assert.notEqual(r.headers.get("access-control-allow-origin"), "*", `${ruta} abrio el servicio a todo el mundo`);
    }
  });
});

test("el preflight contesta sin token: el navegador no le pone credenciales", async () => {
  await conServicio({}, async (svc) => {
    const r = await fetch(`${svc.url}/v1/capabilities`, {
      method: "OPTIONS",
      headers: { origin: ORIGEN, "access-control-request-method": "GET" },
    });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get("access-control-allow-origin"), ORIGEN);
    assert.match(r.headers.get("access-control-allow-headers"), /x-noxloop-token/i);
    assert.match(r.headers.get("vary") || "", /origin/i);
  });
});

test("sin cabecera Origin se sigue exigiendo el token: un cliente que no es navegador no es un cliente de confianza", async () => {
  await conServicio({}, async (svc) => {
    const sin = await fetch(`${svc.url}/v1/capabilities`);
    assert.equal(sin.status, 401);

    const con = await fetch(`${svc.url}/v1/capabilities`, { headers: { "x-noxloop-token": TOKEN } });
    assert.equal(con.status, 200, "curl y el propio escritorio no mandan Origin");
  });
});

test("sin --token el servicio se inventa uno, en vez de quedar abierto", async () => {
  await conServicio({ token: undefined }, async (svc) => {
    assert.ok(svc.token && svc.token.length >= 32, "un token corto no es un token");
    const sin = await fetch(`${svc.url}/v1/capabilities`);
    assert.equal(sin.status, 401);
    const con = await fetch(`${svc.url}/v1/capabilities`, { headers: { "x-noxloop-token": svc.token } });
    assert.equal(con.status, 200);
  });
});
