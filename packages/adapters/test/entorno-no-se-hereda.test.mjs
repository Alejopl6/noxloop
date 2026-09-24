// `env`: el unico campo nuevo de v2, y el que sostiene la capa de grants.
//
// EL FALLO QUE CIERRA. Hoy el subproceso hereda el entorno del motor
// (`packages/engine/src/runner.mjs`: `const env = { ...process.env, ... }`), asi
// que propaga al agente TODAS las credenciales que el proceso padre tenga
// cargadas, tenga grant o no. Un agente al que se le concedio el tracker acaba
// con la clave del modelo, la del SCM y lo que hubiera en el shell del operador
// — y la capa de grants, que es el diferencial del producto, queda decorativa.
// Ninguna prueba de permisos lo detecta, porque desde el punto de vista del
// grant todo esta bien.
//
// El entorno lo construye `packages/vault/src/entorno.mjs` a partir del grant
// vigente y llega EXPLICITO en `req.env`. El adaptador no lo completa.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { adaptarADriver, validarPeticion } from "../src/contrato.mjs";
import { INYECTADAS_POR_EL_SISTEMA } from "../src/suite.mjs";
import { fixturesDeContrato as fixturesFake } from "../src/adaptadores/fake.mjs";
import { fixturesDeContrato as fixturesClaude } from "../src/adaptadores/claude-agent-sdk.mjs";
import { fixturesDeContrato as fixturesCodex } from "../src/adaptadores/codex.mjs";
import { directorioTemporal } from "./ayuda.mjs";

/**
 * Lo que el subproceso recibio, sin lo que mete el sistema operativo.
 *
 * `__CF_USER_TEXT_ENCODING` lo añade CoreFoundation a todo proceso que macOS
 * lanza: no viene del adaptador y ningun adaptador puede quitarlo. La lista de
 * exentas vive en `src/suite.mjs` y es corta y cerrada a proposito — es la unica
 * valvula de escape de esta comprobacion.
 */
function sinLasDelSistema(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !INYECTADAS_POR_EL_SISTEMA.includes(k)));
}

const TODOS = [
  ["fake", fixturesFake],
  ["claude-agent-sdk", fixturesClaude],
  ["codex", fixturesCodex],
];

for (const [nombre, hacerFixtures] of TODOS) {
  test(`${nombre}: el subproceso recibe exactamente req.env, ni una variable heredada de mas`, async (t) => {
    const dir = directorioTemporal(t);
    const fx = hacerFixtures({ dir });
    t.after(() => fx.cerrar());

    // Un centinela en el entorno del PADRE que el grant no autorizo. Si el
    // adaptador hereda, aparece abajo.
    process.env.NOXLOOP_CENTINELA_DE_HERENCIA = "una-credencial-de-otro-agente";
    t.after(() => {
      delete process.env.NOXLOOP_CENTINELA_DE_HERENCIA;
    });

    const env = { SOLO_ESTA: "1", Y_ESTA: "2" };
    fx.guionar({ texto: "ok", exito: true });
    await fx.adaptador.runPhase(fx.peticion({ phase: "GREEN", env }));

    const l = fx.ultimoLanzamiento();
    assert.ok(l.constanciaDelHijo, "no hay constancia de lo que recibio el hijo: se estaria midiendo el plan del padre");
    const visto = sinLasDelSistema(l.env);
    assert.deepEqual(
      Object.keys(visto).sort(),
      ["SOLO_ESTA", "Y_ESTA"],
      `el subproceso recibio variables que el grant no autorizo: ${Object.keys(visto).join(", ")}`,
    );
    assert.equal(visto.NOXLOOP_CENTINELA_DE_HERENCIA, undefined);
  });
}

test("una peticion sin `env` se rechaza: heredar no es un modo degradado, es la fuga", async (t) => {
  const dir = directorioTemporal(t);
  const fx = fixturesFake({ dir });
  t.after(() => fx.cerrar());

  const sinEnv = fx.peticion({ phase: "GREEN" });
  delete sinEnv.env;

  const v = validarPeticion(sinEnv);
  assert.equal(v.ok, false);
  assert.ok(v.problems.join(" ").includes("env"));

  const r = await fx.adaptador.runPhase(sinEnv);
  assert.equal(r.ok, false, "sin entorno declarado el adaptador corrio igual");
  assert.equal(r.subtype, "entorno_ausente");
  assert.ok(
    String(r.text).toLowerCase().includes("hered"),
    `el mensaje no explica por que no se hereda: ${r.text}`,
  );
});

test("un env con un valor que no es texto se rechaza nombrando la variable", async (t) => {
  const dir = directorioTemporal(t);
  const fx = fixturesFake({ dir });
  t.after(() => fx.cerrar());

  const v = validarPeticion(fx.peticion({ phase: "GREEN", env: { BIEN: "1", MAL: 7 } }));
  assert.equal(v.ok, false);
  assert.ok(v.problems.join(" ").includes("MAL"));
});

test("la costura entrega el entorno de la boveda, no el del motor", async (t) => {
  // `adaptarADriver` es lo que se inyecta como `deps.runPhase`. El driver de v1
  // NO manda `env` —su objeto de fase no lo tiene— asi que el entorno se ata
  // aqui, en el cableado, que es donde la boveda ya esta a mano. Es lo que hace
  // que soportar el campo nuevo no exija tocar el motor.
  const dir = directorioTemporal(t);
  const fx = fixturesFake({ dir });
  t.after(() => fx.cerrar());

  const llamadas = [];
  const runPhase = adaptarADriver(fx.adaptador, {
    entorno: (fase) => {
      llamadas.push(fase.phase);
      return { DEL_GRANT: "si", TAREA: fase.taskId };
    },
  });

  fx.guionar({ texto: "ok", exito: true });
  await runPhase({
    phase: "GREEN", taskId: "T-9", task: {}, item: { id: "IT-1" },
    cwd: fx.cwd, resume: null, model: "fake", effort: null, prompt: "hace", tier: "normal",
  });

  assert.deepEqual(llamadas, ["GREEN"], "el entorno no se pidio por fase: un grant que caduca a mitad seguiria valiendo");
  assert.deepEqual(sinLasDelSistema(fx.ultimoLanzamiento().env), { DEL_GRANT: "si", TAREA: "T-9" });
});

test("ninguna fuente del paquete nombra el entorno del proceso padre", async () => {
  // La misma guarda que protege `packages/vault/src/entorno.mjs`, y por el mismo
  // motivo: lo que hay que atrapar no es un caso que alguna prueba ejercite, es
  // alguien agregando una rama "heredar" para un runtime concreto.
  //
  // Se permite en las pruebas y en las FIXTURES —que arman un PATH para lanzar
  // node— pero no en el camino por el que pasa una fase.
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const SRC = new URL("../src/", import.meta.url).pathname;
  const fuentes = (d, acc = []) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) fuentes(p, acc);
      else if (p.endsWith(".mjs")) acc.push(p);
    }
    return acc;
  };
  // DOS EXENCIONES, Y LAS DOS SON LO CONTRARIO DE LA FUGA:
  //
  // - `proceso-guionado.mjs` es el HIJO. Ahi `process.env` es exactamente el
  //   entorno que la boveda entrego, y leerlo es como el subproceso deja
  //   constancia de lo que recibio — que es la evidencia de la prueba de arriba.
  // - `suite.mjs` mete un centinela en el entorno del PADRE justamente para
  //   comprobar que no aparece abajo. Sin poder nombrarlo, la prueba no existe.
  const EXENTOS = new Set(["proceso-guionado.mjs", "suite.mjs"]);

  const hallazgos = [];
  for (const f of fuentes(SRC)) {
    const relativo = f.replace(SRC, "");
    if (EXENTOS.has(relativo)) continue;
    const codigo = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    if (/process\.env/.test(codigo)) hallazgos.push(relativo);
  }
  assert.deepEqual(
    hallazgos,
    [],
    `el camino de una fase nombra el entorno del proceso padre:\n${hallazgos.join("\n")}`,
  );
});
