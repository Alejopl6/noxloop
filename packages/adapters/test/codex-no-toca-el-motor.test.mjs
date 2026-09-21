// T184 — la funcion de Codex no es existir: es probar que el contrato aisla.
//
// La prueba es esta: el SEGUNDO runtime se enchufa por la misma costura que el
// primero, con el objeto de fase que `driver.mjs` construye hoy, sin un campo
// nuevo, sin una rama y sin que el motor sepa que existe. Si hiciera falta un
// `if` en el driver, el contrato estaria mal — y se arregla el contrato, no se
// ramifica el motor (principio VI, trasladado de gestores a runtimes).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { adaptarADriver, validarAdaptador } from "../src/contrato.mjs";
import { fixturesDeContrato as fixturesFake } from "../src/adaptadores/fake.mjs";
import { fixturesDeContrato as fixturesCodex } from "../src/adaptadores/codex.mjs";
import { fixturesDeContrato as fixturesClaude } from "../src/adaptadores/claude-agent-sdk.mjs";
import { directorioTemporal } from "./ayuda.mjs";

const RAIZ = new URL("../../../", import.meta.url).pathname;

/** El objeto que `driver.mjs` pasa a `deps.runPhase`, campo por campo. */
function comoElDriver(over = {}) {
  return {
    phase: "GREEN",
    taskId: "T-1",
    task: { id: "T-1", worktree: "/tmp", tier: "normal", specialist: null },
    item: { id: "IT-1", title: "un ticket" },
    cwd: "/tmp",
    resume: null,
    model: "modelo-x",
    effort: "medio",
    prompt: "/noxloop-task IT-1 T-1 --phase GREEN",
    tier: "normal",
    ...over,
  };
}

test("los tres adaptadores se enchufan por la MISMA costura, con el objeto de fase del driver", async (t) => {
  const resultados = [];
  for (const hacer of [fixturesFake, fixturesCodex, fixturesClaude]) {
    const dir = directorioTemporal(t);
    const fx = hacer({ dir });
    t.after(() => fx.cerrar());

    // Lo unico que cambia entre runtimes es QUE adaptador se inyecta. Ni un
    // campo de mas en la peticion, ni una rama en quien llama.
    const runPhase = adaptarADriver(fx.adaptador, { entorno: { HOME_FALSO: "1" } });

    fx.guionar({ texto: "hecho", exito: true, sessionId: "s-42" });
    const r = await runPhase(comoElDriver({ cwd: fx.cwd }));
    resultados.push([fx.adaptador.id, r]);
  }

  for (const [id, r] of resultados) {
    assert.equal(r.ok, true, `${id} no devolvio ok`);
    assert.equal(typeof r.text, "string", `${id} no devolvio texto`);
    assert.ok("usd" in r, `${id} no declaro el gasto (ni siquiera como null)`);
    assert.ok("sessionId" in r, `${id} no declaro sessionId`);
  }
});

test("todos los adaptadores validan contra la misma interfaz", async (t) => {
  for (const hacer of [fixturesFake, fixturesCodex, fixturesClaude]) {
    const dir = directorioTemporal(t);
    const fx = hacer({ dir });
    t.after(() => fx.cerrar());
    const v = validarAdaptador(fx.adaptador);
    assert.equal(v.ok, true, `${fx.adaptador.id}: ${v.problems.join("; ")}`);
  }
});

test("el motor no nombra a ningun runtime concreto para soportarlo", () => {
  // La contraparte de la guarda que ya protege a los proveedores en
  // `packages/engine/test/constitution.test.mjs` ("el motor no importa ningun
  // proveedor por nombre"). Si añadir Codex hubiera exigido tocar el motor,
  // aqui habria aparecido su nombre.
  const MOTOR = join(RAIZ, "packages/engine/src");
  const fuentes = (d, acc = []) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) fuentes(p, acc);
      else if (p.endsWith(".mjs")) acc.push(p);
    }
    return acc;
  };
  const hallazgos = [];
  for (const f of fuentes(MOTOR)) {
    const codigo = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    if (/\bcodex\b/i.test(codigo)) hallazgos.push(f.replace(RAIZ, ""));
    if (/packages\/adapters/.test(codigo)) hallazgos.push(`${f.replace(RAIZ, "")}: importa el paquete de adaptadores`);
  }
  assert.deepEqual(
    hallazgos,
    [],
    `el motor se ramifico para soportar un runtime:\n${hallazgos.join("\n")}`,
  );
});
