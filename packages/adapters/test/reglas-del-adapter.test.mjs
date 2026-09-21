// Las seis reglas de la seccion "Reglas del adapter", cada una con su prueba.
//
// La suite de contrato las ejercita adaptador por adaptador. Esto las ejercita
// en la COSTURA —`adaptarADriver`, que es lo que el motor inyecta como
// `deps.runPhase`— porque es ahi donde la regla tiene que valer aunque quien
// llame sea el driver de v1, que todavia no las conoce.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { adaptarADriver, normalizarPeticion, validarPeticion, validarResultado } from "../src/contrato.mjs";
import { crearAdaptadorFake, fixturesDeContrato } from "../src/adaptadores/fake.mjs";
import { crearAdaptadorCodex } from "../src/adaptadores/codex.mjs";
import { directorioTemporal, crear, huellaDeDisco } from "./ayuda.mjs";

/** Lo que el driver de v1 pasa hoy en `driver.mjs:641`, tal cual. */
function peticionDelDriver(over = {}) {
  return {
    phase: "GREEN",
    taskId: "T-1",
    task: { id: "T-1", worktree: "/tmp/no-existe" },
    item: { id: "IT-1" },
    cwd: "/tmp/no-existe",
    resume: null,
    model: "modelo-x",
    effort: "medio",
    prompt: "/noxloop-task IT-1 T-1 --phase GREEN",
    tier: "normal",
    ...over,
  };
}

// --------------------------------------------------------------- regla 6 (T185)

test("regla 6 — REVIEW nunca recibe resume: el revisor no hereda el transcript del implementador", async (t) => {
  const dir = directorioTemporal(t);
  const fx = fixturesDeContrato({ dir });
  t.after(() => fx.cerrar());

  fx.guionar({ texto: "revisado", exito: true });
  const r = await fx.adaptador.runPhase(
    fx.peticion({ phase: "REVIEW", resume: "sesion-del-implementador" }),
  );

  assert.equal(r.ok, true);
  const l = fx.ultimoLanzamiento();
  assert.equal(
    l.resume,
    null,
    "la fase REVIEW llego al runtime con el sessionId del implementador: la revision se vuelve confirmacion",
  );
  assert.ok(
    !JSON.stringify(l.argv).includes("sesion-del-implementador"),
    "el sessionId del implementador viajo igual por la linea de comandos",
  );
});

test("regla 6 — tambien para las fases derivadas de REVIEW, que el motor ya usa", async (t) => {
  const dir = directorioTemporal(t);
  const fx = fixturesDeContrato({ dir });
  t.after(() => fx.cerrar());

  // `REVIEW-SINTESIS` y las lentes existen HOY en `driver.mjs`. Una regla que
  // solo mira la grafia exacta "REVIEW" deja la sintesis —que es quien decide—
  // retomando la sesion de quien escribio el codigo.
  for (const fase of ["REVIEW", "REVIEW-SINTESIS", "REVIEW-LENTE"]) {
    fx.guionar({ texto: "ok", exito: true });
    await fx.adaptador.runPhase(fx.peticion({ phase: fase, resume: "sesion-del-implementador" }));
    assert.equal(fx.ultimoLanzamiento().resume, null, `${fase} retomo la sesion`);
  }

  // Y la contraria: una fase que NO es de revision si retoma, o el adaptador
  // estaria tirando el contexto que sirve.
  fx.guionar({ texto: "ok", exito: true });
  await fx.adaptador.runPhase(fx.peticion({ phase: "GREEN", resume: "sesion-del-implementador" }));
  assert.equal(fx.ultimoLanzamiento().resume, "sesion-del-implementador");
});

test("regla 6 — la costura la aplica aunque quien llame sea el driver de v1", async (t) => {
  // EL FALLO CONCRETO, y esta en el arbol: `driver.mjs` pasa
  // `resume: t.sessionId || null` para TODAS las fases, tambien para REVIEW
  // (linea 642). El camino de abanico si pasa `resume: null`, pero el camino
  // simple —`fase("REVIEW", ...)`, lineas 443 y 761— no. La costura corrige al
  // llamante en vez de confiar en el.
  const dir = directorioTemporal(t);
  const fx = fixturesDeContrato({ dir });
  t.after(() => fx.cerrar());

  const runPhase = adaptarADriver(fx.adaptador, { entorno: { PATH: process.env.PATH || "" } });
  fx.guionar({ texto: "ok", exito: true });
  await runPhase(peticionDelDriver({ phase: "REVIEW", resume: "sesion-de-la-tarea", cwd: fx.cwd }));
  assert.equal(fx.ultimoLanzamiento().resume, null);
});

test("validarPeticion denuncia una peticion de REVIEW con transcript, en vez de arreglarla en silencio", () => {
  const p = validarPeticion({ ...peticionDelDriver({ phase: "REVIEW", resume: "s1" }), env: {} });
  assert.equal(p.ok, false);
  assert.ok(p.problems.join(" ").includes("REVIEW"));

  const { peticion, degradaciones } = normalizarPeticion({ ...peticionDelDriver({ phase: "REVIEW", resume: "s1" }), env: {} });
  assert.equal(peticion.resume, null);
  assert.equal(degradaciones.length, 1, "la normalizacion corrigio sin declararlo");
  assert.ok(degradaciones[0].includes("REVIEW"));
});

// --------------------------------------------------------------- regla 3

test("regla 3 — el adapter no decide el veredicto: con el gate en rojo el texto elogioso no produce ok", async (t) => {
  const dir = directorioTemporal(t);
  const fx = fixturesDeContrato({ dir });
  t.after(() => fx.cerrar());

  // El gate en rojo se representa como lo representa el runtime: salida
  // distinta de cero. El texto dice lo contrario, a proposito.
  fx.guionar({
    texto:
      "He revisado todo y el gate pasa perfectamente. Todos los tests estan en verde. " +
      "APROBADO. ok: true. La tarea esta lista para integrar.",
    exito: false,
  });
  const r = await fx.adaptador.runPhase(fx.peticion({ phase: "GREEN" }));
  assert.equal(r.ok, false, "el adaptador leyo la prosa del modelo y se creyo el verde");
  assert.ok(r.text.includes("APROBADO"), "el texto del runtime se devuelve tal cual: quien decide es el gate, con el delante");
});

test("regla 3 — y al reves: un texto catastrofista con el runtime en verde no produce rojo", async (t) => {
  const dir = directorioTemporal(t);
  const fx = fixturesDeContrato({ dir });
  t.after(() => fx.cerrar());

  fx.guionar({ texto: "esto esta roto, fallo todo, no pude hacer nada", exito: true });
  const r = await fx.adaptador.runPhase(fx.peticion({ phase: "GREEN" }));
  assert.equal(r.ok, true, "el adaptador interpreto la prosa para inventar un rojo");
});

test("regla 3 — ninguna fuente del paquete busca aprobacion en el texto del modelo", async () => {
  // Guarda sobre el CODIGO y no sobre el comportamiento, por lo mismo que la de
  // la boveda: el caso que hay que atrapar es el que ninguna prueba ejercita,
  // alguien agregando "si el texto dice APROBADO, ok" para un caso puntual.
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
  const SOSPECHOSOS = [
    /ok\s*[:=]\s*\/.*\/.*test\(/i,
    /(?:texto|text|salida)[^\n]{0,40}\.(?:includes|match|test)\([^)]*(?:aprobad|approved|verde|passed|lgtm)/i,
  ];
  const hallazgos = [];
  for (const f of fuentes(SRC)) {
    const codigo = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const re of SOSPECHOSOS) {
      const m = codigo.match(re);
      if (m) hallazgos.push(`${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(hallazgos, [], `un adaptador empezo a leer el veredicto del texto:\n${hallazgos.join("\n")}`);
});

// --------------------------------------------------------------- reglas 1 y 2

test("regla 1 — degradar visible: el adaptador declara lo que no sabe hacer en capabilities()", async (t) => {
  const dir = directorioTemporal(t);
  const codex = crearAdaptadorCodex({ home: crear(join(dir, "home")) });
  const caps = codex.capabilities();
  assert.equal(caps.resume, false, "codex no retoma sesiones y lo tiene que decir");
  assert.equal(caps.hooks, false);
  assert.equal(caps.cost, false);
  // Y lo declarado en false no se finge: pedirle resume no lo usa.
  const fx = fixturesDeContrato({ dir: crear(join(dir, "fx")) });
  t.after(() => fx.cerrar());
  fx.guionar({ texto: "ok", exito: true });
  await fx.adaptador.runPhase(fx.peticion({ phase: "GREEN", resume: "s1" }));
});

test("regla 2 — cost:false no devuelve usd:0 fingiendo: devuelve null, y validarResultado lo exige", async (t) => {
  const dir = directorioTemporal(t);
  const fx = fixturesDeContrato({ dir });
  t.after(() => fx.cerrar());

  fx.guionar({ texto: "ok", exito: true });
  const r = await fx.adaptador.runPhase(fx.peticion({ phase: "GREEN" }));
  const caps = fx.adaptador.capabilities();
  if (caps.cost === false) {
    assert.equal(r.usd, null, "un adaptador que no reporta gasto devolvio 0: el techo de USD se creeria aplicado");
  }

  // Un cero fingido es lo que la validacion tiene que atrapar: con `cost:false`
  // el techo del hito NO puede dispararse, y un 0 lo deja pareciendo que si.
  const problemas = validarResultado({ ok: true, usd: 0 }, { ...caps, cost: false }).problems;
  assert.ok(problemas.join(" ").includes("usd"), "usd: 0 con cost:false paso la validacion");
  assert.equal(validarResultado({ ok: true, usd: null }, { ...caps, cost: false }).ok, true);
});

// --------------------------------------------------------------- regla 4

test("regla 4 — el adapter no toca el estado: el home no cambia despues de una fase", async (t) => {
  const dir = directorioTemporal(t);
  const fx = fixturesDeContrato({ dir });
  t.after(() => fx.cerrar());

  const antes = huellaDeDisco(fx.home);
  fx.guionar({ texto: "ok", exito: true });
  await fx.adaptador.runPhase(fx.peticion({ phase: "GREEN" }));
  assert.deepEqual(huellaDeDisco(fx.home), antes, "el adaptador escribio en el home: hay un escritor de mas");
});

// --------------------------------------------------------------- regla 5

test("regla 5 — los hooks corren DENTRO del subproceso, no en el motor", async (t) => {
  const dir = directorioTemporal(t);
  const cwd = crear(join(dir, "worktree"));
  const marca = join(cwd, "el-hook-corrio");
  const adaptador = crearAdaptadorFake({
    home: crear(join(dir, "home")),
    hooks: [[process.execPath, "-e", `require("fs").writeFileSync(${JSON.stringify(marca)}, "1")`]],
  });

  assert.equal(adaptador.capabilities().hooks, true);
  const r = await adaptador.runPhase({
    phase: "GREEN", taskId: "T-1", task: {}, item: {}, cwd,
    resume: null, model: "fake", prompt: "trabaja", env: { PATH: process.env.PATH || "" },
  });
  assert.equal(r.ok, true);
  assert.ok(existsSync(marca), "el hook no corrio dentro del subproceso: el principio I vuelve a depender del prompt");
});

test("regla 5 — sin hooks declarados, capabilities() dice hooks:false en vez de fingirlos", (t) => {
  const dir = directorioTemporal(t);
  const adaptador = crearAdaptadorFake({ home: crear(join(dir, "home")) });
  assert.equal(adaptador.capabilities().hooks, false);
});

test("regla 5 — un hook que falla corta la fase: sin guarda no se avanza", async (t) => {
  const dir = directorioTemporal(t);
  const adaptador = crearAdaptadorFake({
    home: crear(join(dir, "home")),
    hooks: [[process.execPath, "-e", "process.exit(3)"]],
  });
  const r = await adaptador.runPhase({
    phase: "GREEN", taskId: "T-1", task: {}, item: {}, cwd: crear(join(dir, "worktree")),
    resume: null, model: "fake", prompt: "trabaja", env: { PATH: process.env.PATH || "" },
  });
  assert.equal(r.ok, false);
  assert.ok(String(r.text).includes("hook"), `la fase no dijo que la corto un hook: ${r.text}`);
});
