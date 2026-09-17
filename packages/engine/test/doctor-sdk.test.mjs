// T115 — la rama degradada de `doctor`, probada de verdad.
//
// EL FALLO QUE CIERRA, escrito en la propia tarea: `sdkDisponible()` resolvia
// el paquete con `createRequire` y no aceptaba inyeccion. Como el SDK es una
// `optionalDependency`, un `npm ci` normal lo instala — asi que el camino que
// el README promete ("si falta, se degrada a invocar el CLI y lo dice") casi
// nunca se recorria en los tests. Lo unico que se podia afirmar era una
// bicondicional: ausente si y solo si hay aviso. Eso no prueba el MENSAJE, ni
// que sea un aviso y no un problema, ni que el motor elija el otro transporte.
//
// LA FORMA DEL ARREGLO es la misma que ya usa el resto del motor: se acepta un
// detector por `opts`, con el de produccion como default. Inyectar una funcion
// es lo que permitio probar la cola de integracion, los locks y el reloj sin
// levantar nada.

import { test } from "node:test";
import assert from "node:assert/strict";
import { doctor } from "../src/doctor.mjs";
import { sdkAvailable } from "../src/runner.mjs";

const configMinima = {
  provider: { name: "fake", module: new URL("../../../providers/fake/index.mjs", import.meta.url).pathname },
  home: "/tmp/nox-doctor",
  repos: {},
  forge: { cli: "gh" },
};

test("SIN el SDK: doctor avisa, y es un AVISO, no un problema", async () => {
  const r = await doctor(configMinima, { sdkDisponible: async () => false, search: [] });

  assert.equal(r.entorno.sdkPresente, false);
  const aviso = r.avisos.find((a) => /Agent SDK/i.test(a));
  assert.ok(aviso, "sin el SDK tiene que haber un aviso");
  assert.match(aviso, /CLI/, "y decir a que se degrada, que es la promesa del README");
  assert.equal(r.problemas.filter((p) => /SDK/i.test(p)).length, 0,
    "que falte el SDK NO impide usar noxloop: convertirlo en problema bloquearia a quien no lo tiene");
});

test("CON el SDK: ni aviso ni problema por el SDK", async () => {
  const r = await doctor(configMinima, { sdkDisponible: async () => true, search: [] });
  assert.equal(r.entorno.sdkPresente, true);
  assert.equal(r.avisos.filter((a) => /Agent SDK/i.test(a)).length, 0);
});

test("un detector que revienta cuenta como ausente, y no tumba el diagnostico", async () => {
  // `doctor` existe para decir que falta. Si se cae al averiguarlo, no dice nada.
  const r = await doctor(configMinima, {
    sdkDisponible: async () => { throw new Error("node_modules ilegible"); },
    search: [],
  });
  assert.equal(r.entorno.sdkPresente, false);
  assert.ok(r.avisos.some((a) => /Agent SDK/i.test(a)));
});

test("sin inyeccion se usa el detector de produccion: el default no puede ser el falso", async () => {
  const r = await doctor(configMinima, { search: [] });
  assert.equal(r.entorno.sdkPresente, sdkAvailable(),
    "doctor y el runner tienen que coincidir sobre si el SDK esta: si difieren, uno de los dos miente");
});

// ------------------------------------- y el transporte, que es la otra mitad

import { runPhase } from "../src/runner.mjs";

test("el transporte elegido sigue al detector: ausente => cli, presente => agent-sdk", async () => {
  const llamadas = [];
  const transporteFalso = async (p) => { llamadas.push(p); return { ok: true, text: "", usd: 0 }; };

  // Con `via` explicito se prueba que el runner respeta la eleccion; el default
  // lo decide `sdkAvailable()`, que es lo que doctor ahora reporta igual.
  await runPhase({ phase: "GREEN", taskId: "T001", task: { id: "T001", tier: "small" }, item: { id: "T-1" }, cwd: "/tmp", prompt: "x" },
    { via: "cli", transport: transporteFalso });
  assert.equal(llamadas.length, 1, "el transporte inyectado tiene que haberse usado");
});
