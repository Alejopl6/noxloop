// `/v1/health` es lo primero que pide la interfaz, y lo unico que puede pedir
// sin token todavia.
//
// EL FALLO QUE EVITA `escritorUnico`. El principio VIII dice que la interfaz
// lee y el servicio escribe. Con varias ventanas abiertas eso deja de ser una
// promesa del diseño y pasa a ser algo que cada ventana tiene que poder
// comprobar al conectarse: si el servicio no lo afirma, la interfaz no tiene
// forma de distinguir un servicio de control de cualquier otra cosa escuchando
// en ese puerto.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";

import { conServicio, homeTemporal, pedir } from "./ayuda.mjs";

const VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

test("/v1/health afirma escritorUnico: true", async () => {
  await conServicio({}, async (svc) => {
    const r = await pedir(svc, "/v1/health");
    assert.equal(r.status, 200);
    const cuerpo = await r.json();
    assert.equal(cuerpo.escritorUnico, true);
  });
});

test("/v1/health devuelve el home RESUELTO, no el que pidieron", async () => {
  // En macOS `/var` es un enlace a `/private/var`, asi que el home de un test
  // temporal llega por dos rutas distintas. Si el servicio devuelve la que le
  // pasaron, dos ventanas que comparan homes creen estar en proyectos
  // distintos cuando estan en el mismo.
  const home = homeTemporal();
  await conServicio({ home }, async (svc) => {
    const cuerpo = await (await pedir(svc, "/v1/health")).json();
    assert.equal(cuerpo.home, realpathSync(home));
  });
});

test("/v1/health trae version, esquema y arranque, que es lo que el contrato promete", async () => {
  await conServicio({}, async (svc) => {
    const cuerpo = await (await pedir(svc, "/v1/health")).json();
    assert.equal(cuerpo.version, VERSION);
    assert.equal(typeof cuerpo.esquema, "number");
    assert.ok(!Number.isNaN(Date.parse(cuerpo.arranque)), `arranque no es una fecha: ${cuerpo.arranque}`);
    // El arranque es el del proceso, no el de la peticion: la interfaz lo usa
    // para saber si el servicio se reinicio por debajo.
    const otra = await (await pedir(svc, "/v1/health")).json();
    assert.equal(otra.arranque, cuerpo.arranque);
  });
});

test("/v1/health contesta SIN token: sin el, la interfaz no puede diagnosticar nada", async () => {
  await conServicio({}, async (svc) => {
    const r = await fetch(`${svc.url}/v1/health`);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).escritorUnico, true);
  });
});
