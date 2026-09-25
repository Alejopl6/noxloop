// La capacidad `comandos`: si el runtime entiende `/noxloop-task ...` como un
// comando, o recibe esa cadena como texto sin significado.
//
// EL FALLO QUE CIERRA. El motor manda prompts como `/noxloop-task 1 T001
// --phase RED`, que son comandos del plugin de Claude Code. El adaptador de
// Codex los pasaba tal cual y Codex recibia una linea que no le decia nada: ni
// que fase era, ni que no podia tocar produccion en RED, ni como declarar un
// veredicto. El producto se decia agnostico del runtime y el encargo solo lo
// entendia uno.
//
// POR QUE ES UNA CAPACIDAD Y NO UN `if` EN EL MOTOR. Por el principio VI
// trasladado a runtimes: el motor pregunta que sabe hacer el runtime; no
// pregunta cual es.

import { test } from "node:test";
import assert from "node:assert/strict";

import { CAPACIDADES_OPCIONALES, validarAdaptador } from "../src/contrato.mjs";
import { crearAdaptadorClaude } from "../src/adaptadores/claude-agent-sdk.mjs";
import { crearAdaptadorCodex } from "../src/adaptadores/codex.mjs";
import { crearAdaptadorFake } from "../src/adaptadores/fake.mjs";

const base = (caps) => ({
  id: "x",
  capabilities: () => ({ resume: false, cost: false, effort: false, hooks: false, models: "desconocido", ...caps }),
  preflight: async () => ({ ok: true }),
  runPhase: async () => ({ ok: true }),
});

test("`comandos` es una capacidad conocida del contrato, y si se declara es boolean", () => {
  assert.ok(CAPACIDADES_OPCIONALES.includes("comandos"));
  assert.equal(validarAdaptador(base({ comandos: true })).ok, true);
  assert.equal(validarAdaptador(base({ comandos: false })).ok, true);

  const v = validarAdaptador(base({ comandos: "si" }));
  assert.equal(v.ok, false);
  assert.match(v.problems.join("\n"), /comandos.*boolean/);
});

test("un adaptador que no declara `comandos` sigue siendo valido: su ausencia es «no se sabe», y el motor expande", () => {
  // Opcional a proposito: la hacen obligatoria y cada doble de prueba de otros
  // paquetes deja de registrarse. Lo que no puede es declararla mal.
  assert.equal(validarAdaptador(base({})).ok, true);
});

// MEDIDO EN UN RUN REAL (2026-09-24): con `comandos: true`, Claude recibio
// `/noxloop-plan ...` sin el plugin de noxloop instalado, no lo reconocio, y
// paso la fase explorando el home para adivinar que se le pedia. Que el
// runtime SEPA expandir comandos no sirve si el plugin no esta cargado, y el
// motor no lo carga. Solo se declara `true` cuando quien monta el adaptador
// afirma que el plugin viaja con el (`pluginCargado: true`).
test("los tres adaptadores dicen la verdad: Claude sin el plugin cargado recibe la fase entera", () => {
  assert.equal(crearAdaptadorClaude({ hooks: { hooks: {} } }).capabilities().comandos, false);
  assert.equal(crearAdaptadorClaude({ hooks: { hooks: {} }, pluginCargado: true }).capabilities().comandos, true);
  assert.equal(crearAdaptadorCodex().capabilities().comandos, false);
  assert.equal(crearAdaptadorFake().capabilities().comandos, false);
});
