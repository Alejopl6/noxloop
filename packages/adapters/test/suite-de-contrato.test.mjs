// La suite de contrato corre ENTERA contra los tres adaptadores.
//
// POR QUE ESTA PRUEBA ES LA QUE IMPORTA. Es la traslacion a runtimes de lo que
// `providers/contract.test.mjs` ya hace con los gestores de tickets: la misma
// suite contra todos, incluido el falso. Un adaptador se declara listo cuando la
// pasa entera, y el paso 4 de "añadir un adapter" es correr esto — sin tocar el
// motor.
//
// EL FALLO QUE EVITA. Con un solo adaptador la abstraccion es indireccion sin
// prueba: cualquier suposicion sobre "como se invoca al modelo" se cuela en la
// interfaz y nadie lo nota hasta que hay un segundo. Aqui hay tres, y los tres
// corren sin red, sin credenciales y sin modelo.

import { test } from "node:test";
import assert from "node:assert/strict";

import { PRUEBAS_DEL_CONTRATO, pruebasDelContrato } from "../src/suite.mjs";
import { fixturesDeContrato as fixturesFake } from "../src/adaptadores/fake.mjs";
import { fixturesDeContrato as fixturesClaude } from "../src/adaptadores/claude-agent-sdk.mjs";
import { fixturesDeContrato as fixturesCodex } from "../src/adaptadores/codex.mjs";
import { directorioTemporal } from "./ayuda.mjs";

const ADAPTADORES = [
  ["fake", fixturesFake],
  ["claude-agent-sdk", fixturesClaude],
  ["codex", fixturesCodex],
];

for (const [nombre, hacerFixtures] of ADAPTADORES) {
  test(`el adaptador ${nombre} pasa la suite de contrato entera`, async (t) => {
    const dir = directorioTemporal(t);
    const fx = hacerFixtures({ dir });
    t.after(() => fx.cerrar());

    const pruebas = pruebasDelContrato(fx);
    assert.deepEqual(
      pruebas.map((p) => p.nombre),
      [...PRUEBAS_DEL_CONTRATO],
      "la suite dejo de tener las 11 pruebas que el contrato enumera",
    );

    for (const prueba of pruebas) {
      await t.test(prueba.nombre, async () => {
        await prueba.correr();
      });
    }
  });
}

test("la suite enumera exactamente las 11 pruebas del contrato, con sus nombres", () => {
  // Los nombres son los de la tabla "Suite de contrato" del contrato. Si alguien
  // renombra una prueba, el contrato y el codigo dejan de hablar del mismo
  // mecanismo y la tabla se vuelve documentacion muerta.
  assert.deepEqual([...PRUEBAS_DEL_CONTRATO], [
    "capacidades-honestas",
    "preflight-diagnostica",
    "cwd-respetado",
    "env-exacto",
    "sin-resume-sesion-nueva",
    "revisor-sin-transcript",
    "no-escribe-estado",
    "no-interpreta-veredicto",
    "coste-o-declarado",
    "cancelable",
    "sin-secreto-en-argv",
  ]);
  assert.equal(PRUEBAS_DEL_CONTRATO.length, 11);
});
