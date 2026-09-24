// `/v1/capabilities` es el principio X aplicado al propio servicio.
//
// EL FALLO QUE EVITA. En la fase A no hay boveda, no hay proveedor de
// conexiones y no hay deteccion de runtimes. La tentacion es devolver la forma
// final con valores plausibles para que la interfaz se pueda escribir contra
// ella. Eso es exactamente el contexto inventado: la interfaz dibuja un backend
// de boveda que nadie ejercio, el operador guarda una credencial creyendo que
// va al llavero del sistema, y el hueco se descubre cuando ya hay secretos
// adentro.
//
// Por eso cada capacidad viaja con su origen: `detectado` trae la evidencia que
// lo respalda, `vacio` trae la constancia de que se busco y no habia.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { conServicio, pedir } from "./ayuda.mjs";

const traer = (svc) => pedir(svc, "/v1/capabilities").then((r) => r.json());

test("ninguna capacidad se declara sin origen", async () => {
  await conServicio({}, async (svc) => {
    const caps = await traer(svc);
    const sinOrigen = Object.entries(caps)
      .filter(([, v]) => v && typeof v === "object" && !Array.isArray(v))
      .filter(([, v]) => !["detectado", "inferido", "vacio"].includes(/** @type {any} */ (v).origen))
      .map(([k]) => k);
    assert.deepEqual(sinOrigen, [], "una capacidad sin origen es una capacidad inventada");
  });
});

test("lo detectado trae la ruta que lo respalda; lo vacio, el motivo de que lo este", async () => {
  await conServicio({}, async (svc) => {
    const caps = await traer(svc);
    for (const [nombre, cap] of Object.entries(caps)) {
      if (!cap || typeof cap !== "object" || Array.isArray(cap)) continue;
      const c = /** @type {any} */ (cap);
      if (c.origen === "detectado") {
        assert.ok(c.evidencia, `${nombre} dice detectado sin evidencia`);
        assert.ok(existsSync(c.evidencia), `la evidencia de ${nombre} no existe: ${c.evidencia}`);
      }
      if (c.origen === "vacio") {
        assert.ok(c.motivo && c.motivo.length > 20, `${nombre} declara el hueco sin decir por que`);
      }
    }
  });
});

test("la fase A no declara boveda, ni conexiones, ni runtimes: no los ejercio", async () => {
  await conServicio({}, async (svc) => {
    const caps = await traer(svc);
    assert.equal(caps.boveda.valor, null);
    assert.equal(caps.boveda.origen, "vacio");
    assert.equal(caps.conexiones.valor, null);
    assert.equal(caps.conexiones.origen, "vacio");
    assert.deepEqual(caps.runtimes.valor, []);
    assert.equal(caps.runtimes.origen, "vacio");
  });
});

test("la presencia del motor SI se detecta, porque se puede mirar el disco", async () => {
  await conServicio({}, async (svc) => {
    const caps = await traer(svc);
    assert.equal(typeof caps.motor.valor.presente, "boolean");
    if (caps.motor.valor.presente) {
      assert.equal(caps.motor.origen, "detectado");
      assert.match(caps.motor.evidencia, /package\.json$/);
    } else {
      assert.equal(caps.motor.origen, "vacio");
    }
  });
});

test("/v1/capabilities exige token: enumerar lo que este servicio sabe hacer ya es informacion", async () => {
  await conServicio({}, async (svc) => {
    const r = await fetch(`${svc.url}/v1/capabilities`);
    assert.equal(r.status, 401);
  });
});
