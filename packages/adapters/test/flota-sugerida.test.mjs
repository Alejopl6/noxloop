// La flota se sugiere: nueve campos por agente que el operador hoy rellena a
// ciegas, derivados de lo que el snapshot ya sabe — y cada uno diciendo de
// donde sale.
//
// EL FALLO QUE ESTO CIERRA. Dar de alta un agente pide rol, runtime, modelo,
// skills, tools, MCP, permisos, presupuesto y contexto. Quien llega por primera
// vez no sabe que poner en siete de los nueve, asi que pone lo que suene bien;
// y lo que suena bien se ejecuta miles de veces. El snapshot ya leyo el
// proyecto: casi todo eso esta en el arbol o no esta en ninguna parte, y las
// dos respuestas son utiles si se dicen.
//
// LAS DOS REGLAS QUE HACEN QUE LA SUGERENCIA VALGA ALGO:
//
//   1. FR-034 — el revisor no comparte runtime con el implementador. Una
//      sugerencia que los pone iguales es una que el servicio va a rechazar al
//      guardar: sugerir algo invalido cuesta mas que no sugerir, porque el
//      operador lo acepta, choca con el error, y deja de confiar en lo que se
//      le propone.
//
//   2. Principio X — cada campo declara su origen con el MISMO vocabulario que
//      el snapshot (`detectado`, `inferido`, `por_defecto`, `vacio`). Un
//      operador que no sabe por que se le propone algo no puede juzgarlo, y
//      acaba aceptando todo: que es exactamente lo mismo que no proponerle
//      nada, pero con la firma suya encima.
//
// Y LOS HUECOS SE DECLARAN. El presupuesto no se deduce de un repositorio.
// Inventar un numero ahi produce un techo que parece decidido y no lo decidio
// nadie.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { ORIGENES, sugerirFlota } from "../src/flota/sugerencia.mjs";
import { validarFlota } from "../src/flota/agente.mjs";
import { registroDeAdaptadores } from "../src/registro.mjs";
import { crearAdaptadorFake } from "../src/adaptadores/fake.mjs";
import { crearAdaptadorCodex } from "../src/adaptadores/codex.mjs";
import { crearAdaptadorClaude } from "../src/adaptadores/claude-agent-sdk.mjs";
import { directorioTemporal, crear } from "./ayuda.mjs";

const AHORA = Date.parse("2026-09-20T10:00:00.000Z");

/** @param {string} clave @param {unknown} valor @param {any} [opts] */
function hallazgo(clave, valor, opts = {}) {
  return {
    categoria: clave.split(".")[0],
    clave,
    valor,
    origen: opts.origen ?? "detectado",
    evidencia: opts.evidencia ?? [{ ruta: "package.json", linea: 1 }],
    confianza: opts.confianza ?? (opts.origen === "inferido" ? "media" : "alta"),
    ...(opts.motivo ? { motivo: opts.motivo } : {}),
  };
}

/** Un snapshot con la forma que produce el scanner sobre un repositorio real. */
function snapshotDe(hallazgos) {
  return { id: "snap_1", estado: "completo", commit: "0".repeat(40), hallazgos };
}

const SNAPSHOT = snapshotDe([
  hallazgo("agentes.skills", ["packages/plugin/skills/orchestration", "packages/plugin/skills/tdd"], {
    evidencia: [{ ruta: "packages/plugin/skills/tdd/SKILL.md" }],
  }),
  hallazgo("agentes.mcp", [], { motivo: "se busco en la configuracion de agente y no hay ningun servidor declarado" }),
  hallazgo("ci.comandos", [{ ruta: ".github/workflows/ci.yml", linea: 27, comando: "npm test" }], {
    evidencia: [{ ruta: ".github/workflows/ci.yml", linea: 27 }],
  }),
  hallazgo("guidelines.constitution", { ruta: ".specify/memory/constitution.md", version: "1.2.0" }, {
    evidencia: [{ ruta: ".specify/memory/constitution.md" }],
  }),
  hallazgo("testing.runner", "node --test", { evidencia: [{ ruta: "package.json", linea: 15 }] }),
]);

/** Dos runtimes de verdad: uno con hooks y otro sin ellos. Es el caso del producto. */
function conDosRuntimes(t) {
  const home = crear(join(directorioTemporal(t), "home"));
  return registroDeAdaptadores([
    crearAdaptadorClaude({ home, hooks: { PreToolUse: [{ matcher: "Edit", hooks: [] }] } }),
    crearAdaptadorCodex({ home }),
  ]);
}

// ---------------------------------------------------------------------------
// FR-034: la sugerencia no propone algo que el servicio vaya a rechazar
// ---------------------------------------------------------------------------

test("el revisor sugerido NO comparte runtime con el implementador", (t) => {
  const adaptadores = conDosRuntimes(t);
  const sugerencia = sugerirFlota({ snapshot: SNAPSHOT, adaptadores, project_id: "p1", ahora: AHORA });

  const implementador = sugerencia.agentes.find((/** @type {any} */ a) => a.rol === "implementador");
  const revisor = sugerencia.agentes.find((/** @type {any} */ a) => a.rol === "revisor");
  assert.ok(implementador, "no se sugirio implementador, y sin el la flota no puede activarse");
  assert.ok(revisor, "no se sugirio revisor, y sin el la flota no puede activarse");
  assert.notEqual(revisor.runtime, implementador.runtime);
});

test("la sugerencia pasa las MISMAS reglas con las que el servicio la va a validar", (t) => {
  // La comprobacion no es «parece bien»: es `validarFlota`, la funcion que
  // rechaza la flota al guardar. Sugerir algo que esa funcion tumba es el peor
  // resultado posible — cuesta el viaje del operador y la confianza.
  const adaptadores = conDosRuntimes(t);
  const sugerencia = sugerirFlota({ snapshot: SNAPSHOT, adaptadores, project_id: "p1", ahora: AHORA });

  assert.equal(sugerencia.sugerida, true);
  assert.deepEqual(sugerencia.problemas, []);
  assert.deepEqual(validarFlota({ agentes: sugerencia.agentes, adaptadores }), []);
});

test("el implementador sugerido corre sobre un runtime CON hooks", (t) => {
  // Sin hooks el paso RED depende de que el prompt se acuerde, y el modelo de
  // flota ya lo rechaza al guardar.
  const adaptadores = conDosRuntimes(t);
  const sugerencia = sugerirFlota({ snapshot: SNAPSHOT, adaptadores, project_id: "p1", ahora: AHORA });
  const implementador = sugerencia.agentes.find((/** @type {any} */ a) => a.rol === "implementador");
  assert.equal(adaptadores.capacidades(implementador.runtime).hooks, true);
});

test("con UN solo runtime no se sugiere una flota invalida: se dice que no se puede", (t) => {
  const home = crear(join(directorioTemporal(t), "home"));
  // Con hooks: el runtime SI sirve para implementar. Lo que falta es el
  // segundo, y por tanto lo que falta es el revisor de FR-034.
  const adaptadores = registroDeAdaptadores([crearAdaptadorFake({ home, hooks: [{ matcher: "Edit", hooks: [] }] })]);

  const sugerencia = sugerirFlota({ snapshot: SNAPSHOT, adaptadores, project_id: "p1", ahora: AHORA });

  assert.equal(sugerencia.sugerida, false);
  const revisor = sugerencia.no_sugeridos.find((/** @type {any} */ n) => n.rol === "revisor");
  assert.ok(revisor, "con un solo runtime el revisor no se puede sugerir, y hay que decirlo");
  assert.match(revisor.porque, /runtime/i);
  // Y no se cuela un revisor con el mismo runtime «para que el formulario salga lleno».
  assert.equal(
    sugerencia.agentes.some((/** @type {any} */ a) => a.rol === "revisor"),
    false,
  );
});

// ---------------------------------------------------------------------------
// Principio X: de donde sale cada campo
// ---------------------------------------------------------------------------

test("los nueve campos de cada agente declaran su origen, y con el vocabulario del snapshot", (t) => {
  const adaptadores = conDosRuntimes(t);
  const sugerencia = sugerirFlota({ snapshot: SNAPSHOT, adaptadores, project_id: "p1", ahora: AHORA });

  const NUEVE = ["rol", "runtime", "modelo", "skills", "tools", "mcps", "permisos", "presupuesto", "contexto"];
  assert.deepEqual([...ORIGENES], ["detectado", "inferido", "por_defecto", "vacio"]);

  for (const agente of sugerencia.agentes) {
    for (const campo of NUEVE) {
      const p = agente.procedencia[campo];
      assert.ok(p, `\`${agente.nombre}\` propone \`${campo}\` sin decir de donde sale`);
      assert.ok(
        ORIGENES.includes(p.origen),
        `\`${agente.nombre}.${campo}\` salio con origen \`${p.origen}\`, que no es del vocabulario del snapshot`,
      );
      assert.ok(p.porque.length > 30, `\`${agente.nombre}.${campo}\` no explica nada: "${p.porque}"`);

      // Un `detectado` sin la ruta que lo respalda es una opinion. Es la misma
      // regla que el almacen ya impone sobre los hallazgos (FR-013).
      if (p.origen === "detectado") {
        assert.ok(
          Array.isArray(p.evidencia) && p.evidencia.length > 0 && p.evidencia.every((/** @type {any} */ e) => e.ruta),
          `\`${agente.nombre}.${campo}\` se declara detectado sin evidencia`,
        );
      }
      if (p.origen === "inferido") assert.ok(p.confianza, `\`${campo}\` inferido sin declarar confianza`);
      if (p.origen === "vacio") assert.ok(p.porque.length > 30, "un hueco sin motivo no se distingue de no mirar");
    }
  }
});

test("las skills se proponen DETECTADAS, con la ruta del proyecto que las respalda", (t) => {
  const adaptadores = conDosRuntimes(t);
  const sugerencia = sugerirFlota({ snapshot: SNAPSHOT, adaptadores, project_id: "p1", ahora: AHORA });
  const implementador = sugerencia.agentes.find((/** @type {any} */ a) => a.rol === "implementador");

  assert.equal(implementador.procedencia.skills.origen, "detectado");
  assert.deepEqual(
    [...implementador.skills],
    ["packages/plugin/skills/orchestration", "packages/plugin/skills/tdd"],
  );
  assert.equal(implementador.procedencia.skills.evidencia[0].ruta, "packages/plugin/skills/tdd/SKILL.md");
});

test("un hallazgo inferido llega marcado inferido y con su confianza, no ascendido a detectado", (t) => {
  const adaptadores = conDosRuntimes(t);
  const sugerencia = sugerirFlota({
    snapshot: snapshotDe([
      hallazgo("agentes.skills", ["skills/x"], { origen: "inferido", confianza: "baja" }),
    ]),
    adaptadores,
    project_id: "p1",
    ahora: AHORA,
  });
  const implementador = sugerencia.agentes.find((/** @type {any} */ a) => a.rol === "implementador");

  assert.equal(implementador.procedencia.skills.origen, "inferido");
  assert.equal(implementador.procedencia.skills.confianza, "baja");
});

test("el presupuesto se deja PENDIENTE: no se deduce de un repositorio", (t) => {
  const adaptadores = conDosRuntimes(t);
  const sugerencia = sugerirFlota({ snapshot: SNAPSHOT, adaptadores, project_id: "p1", ahora: AHORA });

  for (const agente of sugerencia.agentes) {
    assert.equal(agente.procedencia.presupuesto.origen, "vacio");
    assert.deepEqual(agente.presupuesto, {});
    assert.ok(
      agente.pendientes.includes("presupuesto"),
      `\`${agente.nombre}\` no declara el presupuesto como pendiente, asi que la pantalla no sabe que preguntarlo`,
    );
  }
  // Y la lista de pendientes sube a la sugerencia entera: es lo que el operador
  // TIENE que rellenar para que la flota se pueda guardar.
  assert.ok(sugerencia.pendientes.some((/** @type {any} */ p) => p.campo === "presupuesto"));
});

test("un runtime que no reporta gasto lo avisa junto al presupuesto que se pide", (t) => {
  // Pedir un techo en USD para un runtime con `cost: false` produce un limite
  // que se lee como puesto y no se dispara nunca.
  const adaptadores = conDosRuntimes(t);
  const sugerencia = sugerirFlota({ snapshot: SNAPSHOT, adaptadores, project_id: "p1", ahora: AHORA });
  const revisor = sugerencia.agentes.find((/** @type {any} */ a) => a.rol === "revisor");

  assert.equal(adaptadores.capacidades(revisor.runtime).cost, false);
  assert.match(revisor.procedencia.presupuesto.porque, /cost/);
});

test("el modelo queda vacio cuando el runtime declara que no enumera modelos", (t) => {
  // `models: "desconocido"` es una respuesta legitima del contrato. Rellenarla
  // con una lista corta inventada hace que la pantalla ofrezca solo esos.
  const adaptadores = conDosRuntimes(t);
  const sugerencia = sugerirFlota({ snapshot: SNAPSHOT, adaptadores, project_id: "p1", ahora: AHORA });
  const implementador = sugerencia.agentes.find((/** @type {any} */ a) => a.rol === "implementador");

  assert.equal(adaptadores.capacidades(implementador.runtime).models, "desconocido");
  assert.equal(implementador.procedencia.modelo.origen, "vacio");
  assert.equal(implementador.modelo, null);
  assert.ok(implementador.pendientes.includes("modelo"));
});

test("el modelo sale POR_DEFECTO del catalogo cuando el runtime si los enumera", (t) => {
  const home = crear(join(directorioTemporal(t), "home"));
  const adaptadores = registroDeAdaptadores([
    crearAdaptadorFake({ home, hooks: [{ matcher: "Edit", hooks: [] }] }),
    crearAdaptadorCodex({ home }),
  ]);
  const sugerencia = sugerirFlota({ snapshot: SNAPSHOT, adaptadores, project_id: "p1", ahora: AHORA });
  const implementador = sugerencia.agentes.find((/** @type {any} */ a) => a.rol === "implementador");

  assert.equal(implementador.procedencia.modelo.origen, "por_defecto");
  assert.equal(implementador.modelo, "fake");
});

test("una lista vacia comprobada por el snapshot es `vacio` con el motivo, no un hueco mudo", (t) => {
  // `agentes.mcp: []` con motivo significa «se busco y no hay». Es distinto de
  // «nadie miro», y la pantalla tiene que poder decirlas distinto.
  const adaptadores = conDosRuntimes(t);
  const sugerencia = sugerirFlota({ snapshot: SNAPSHOT, adaptadores, project_id: "p1", ahora: AHORA });
  const implementador = sugerencia.agentes.find((/** @type {any} */ a) => a.rol === "implementador");

  assert.equal(implementador.procedencia.mcps.origen, "vacio");
  assert.match(implementador.procedencia.mcps.porque, /no hay ningun servidor declarado/);
  assert.deepEqual([...implementador.mcps], []);
});

// ---------------------------------------------------------------------------
// Lo que NO se sugiere, y por que
// ---------------------------------------------------------------------------

test("el verificador se sugiere solo si el proyecto declara comandos que gatean", (t) => {
  const adaptadores = conDosRuntimes(t);

  const con = sugerirFlota({ snapshot: SNAPSHOT, adaptadores, project_id: "p1", ahora: AHORA });
  const verificador = con.agentes.find((/** @type {any} */ a) => a.rol === "verificador");
  assert.ok(verificador, "hay comandos de CI detectados y no se sugirio quien los corra");
  assert.equal(verificador.procedencia.rol.origen, "detectado");
  assert.deepEqual([...verificador.contexto.comandos], ["npm test"]);

  const sin = sugerirFlota({ snapshot: snapshotDe([]), adaptadores, project_id: "p1", ahora: AHORA });
  assert.equal(
    sin.agentes.some((/** @type {any} */ a) => a.rol === "verificador"),
    false,
  );
  assert.ok(sin.no_sugeridos.some((/** @type {any} */ n) => n.rol === "verificador"));
});

test("lo que no se sugiere se dice, con su motivo: el silencio se lee como olvido", (t) => {
  const adaptadores = conDosRuntimes(t);
  const sugerencia = sugerirFlota({ snapshot: SNAPSHOT, adaptadores, project_id: "p1", ahora: AHORA });

  const planificador = sugerencia.no_sugeridos.find((/** @type {any} */ n) => n.rol === "planificador");
  assert.ok(planificador, "el planificador no se sugiere y la sugerencia no lo declara");
  assert.ok(planificador.porque.length > 40);
});

// ---------------------------------------------------------------------------
// Lo que la sugerencia NO hace
// ---------------------------------------------------------------------------

test("sugerir no guarda: no toca ningun repositorio de flota", (t) => {
  const adaptadores = conDosRuntimes(t);
  /** @type {any[]} */
  const guardados = [];
  const espia = {
    guardarAgente: (/** @type {any} */ a) => guardados.push(a),
    agentes: () => [],
    agente: () => null,
    borrarAgente: () => {},
  };

  sugerirFlota({ snapshot: SNAPSHOT, adaptadores, project_id: "p1", ahora: AHORA, repositorio: espia });
  assert.deepEqual(guardados, [], "la sugerencia guardo agentes: una propuesta que se guarda sola ya no es una propuesta");
});

test("un snapshot sin terminar no produce sugerencia", (t) => {
  const adaptadores = conDosRuntimes(t);
  const sugerencia = sugerirFlota({
    snapshot: { id: "s", estado: "en_curso", hallazgos: [] },
    adaptadores,
    project_id: "p1",
    ahora: AHORA,
  });
  assert.equal(sugerencia.sugerida, false);
  assert.match(sugerencia.avisos.join(" "), /snapshot/i);
});

// ---------------------------------------------------------------------------
// La flota que YA existe
// ---------------------------------------------------------------------------

test("se sugiere lo que FALTA: un rol ya dado de alta no se vuelve a proponer", (t) => {
  const adaptadores = conDosRuntimes(t);
  const ids = adaptadores.ids();
  const conHooks = ids.find((/** @type {string} */ i) => adaptadores.capacidades(i).hooks === true);

  const sugerencia = sugerirFlota({
    snapshot: SNAPSHOT,
    adaptadores,
    project_id: "p1",
    ahora: AHORA,
    existentes: [{ id: "a1", project_id: "p1", nombre: "El mio", rol: "implementador", runtime: conHooks }],
  });

  assert.equal(
    sugerencia.agentes.some((/** @type {any} */ a) => a.rol === "implementador"),
    false,
    "se propuso un segundo implementador sobre uno que ya estaba dado de alta",
  );
  const dicho = sugerencia.no_sugeridos.find((/** @type {any} */ n) => n.rol === "implementador");
  assert.match(dicho.porque, /El mio/);
});

test("el revisor sugerido se separa del implementador YA GUARDADO, no solo del propuesto", (t) => {
  // FR-034 es relacional y nadie monta la flota de una sentada: el caso normal
  // es que el implementador ya este guardado cuando se pide el resto. Una
  // sugerencia que solo mira lo que ella misma propone choca al guardar.
  const adaptadores = conDosRuntimes(t);
  const ids = adaptadores.ids();
  const conHooks = ids.find((/** @type {string} */ i) => adaptadores.capacidades(i).hooks === true);
  const existentes = [{ id: "a1", project_id: "p1", nombre: "El mio", rol: "implementador", runtime: conHooks }];

  const sugerencia = sugerirFlota({ snapshot: SNAPSHOT, adaptadores, project_id: "p1", ahora: AHORA, existentes });
  const revisor = sugerencia.agentes.find((/** @type {any} */ a) => a.rol === "revisor");

  assert.ok(revisor, "no se sugirio el revisor que falta");
  assert.notEqual(revisor.runtime, conHooks);
  // Y la flota RESULTANTE —lo guardado mas lo sugerido— pasa la validacion.
  assert.deepEqual(validarFlota({ agentes: [...existentes, ...sugerencia.agentes], adaptadores }), []);
  assert.equal(sugerencia.sugerida, true);
});

test("si la flota ya guardada es invalida, la sugerencia lo dice en vez de construir encima", (t) => {
  // El operador tiene dos agentes que comparten runtime. Sugerir encima de eso
  // produce una flota que no se puede guardar ni activar, y el error aparecera
  // al final del recorrido en vez de ahora.
  const adaptadores = conDosRuntimes(t);
  const conHooks = adaptadores.ids().find((/** @type {string} */ i) => adaptadores.capacidades(i).hooks === true);
  const existentes = [
    { id: "a1", project_id: "p1", nombre: "Impl", rol: "implementador", runtime: conHooks },
    { id: "a2", project_id: "p1", nombre: "Rev", rol: "revisor", runtime: conHooks },
  ];

  const sugerencia = sugerirFlota({ snapshot: SNAPSHOT, adaptadores, project_id: "p1", ahora: AHORA, existentes });

  assert.equal(sugerencia.sugerida, false, "se declaro sugerible una flota que el servicio va a rechazar");
  assert.ok(sugerencia.problemas.length > 0, "la sugerencia no ejecuto su propia validacion");
  assert.equal(sugerencia.problemas[0].codigo, "revisor_comparte_runtime");
  assert.match(sugerencia.avisos.join(" "), /revisor|runtime/i);
});

test("con VARIOS runtimes con hooks, el revisor se separa del que el implementador guardado usa de verdad", (t) => {
  // El caso que distingue «mirar la flota guardada» de «volver a elegir desde
  // cero»: si el implementador ya esta sobre el segundo runtime con hooks y la
  // sugerencia asume el primero, el revisor que propone cae justo encima del
  // runtime del implementador real. FR-034 roto, y el servicio lo rechaza al
  // guardar — despues de que el operador ya haya aceptado la sugerencia.
  const home = crear(join(directorioTemporal(t), "home"));
  const adaptadores = registroDeAdaptadores([
    crearAdaptadorClaude({ home, hooks: { PreToolUse: [{ matcher: "Edit", hooks: [] }] } }),
    crearAdaptadorFake({ home, hooks: [{ matcher: "Edit", hooks: [] }] }),
    crearAdaptadorCodex({ home }),
  ]);
  const conHooks = adaptadores.ids().filter((/** @type {string} */ i) => adaptadores.capacidades(i).hooks === true);
  assert.ok(conHooks.length >= 2, "el test necesita dos runtimes con hooks para distinguir los dos comportamientos");

  // El implementador guardado NO esta sobre el primero de la lista.
  const existentes = [
    { id: "a1", project_id: "p1", nombre: "El mio", rol: "implementador", runtime: conHooks[1] },
  ];
  const sugerencia = sugerirFlota({ snapshot: SNAPSHOT, adaptadores, project_id: "p1", ahora: AHORA, existentes });
  const revisor = sugerencia.agentes.find((/** @type {any} */ a) => a.rol === "revisor");

  assert.ok(revisor, "no se sugirio el revisor que falta");
  assert.notEqual(
    revisor.runtime,
    conHooks[1],
    "el revisor sugerido comparte runtime con el implementador que ya estaba guardado",
  );
  assert.equal(sugerencia.sugerida, true);
  assert.deepEqual(validarFlota({ agentes: [...existentes, ...sugerencia.agentes], adaptadores }), []);
});
