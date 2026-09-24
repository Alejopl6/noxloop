// T059 — La tabla de degradacion de `contracts/provider.md`, una fila por test.
//
// POR QUE ESTE TEST EXISTE. La tabla dice, capacidad por capacidad, que hace el
// motor cuando esa capacidad esta en `false`. Es contrato, no sugerencia: sin un
// test por fila, "el gestor es un detalle" (principio VI) es una afirmacion de
// README. El fallo concreto que evita es el que ya se observo con el nivel de
// los tickets: un camino que funciona con el gestor que se uso para escribirlo y
// que con otro no hace nada, sin error y sin aviso. Una degradacion silenciosa
// es peor que una excepcion, porque el recorrido termina "bien" y el tablero
// queda mudo.
//
// POR QUE VIVE EN providers/ Y NO EN packages/engine/test/. El plan lo ubicaba
// en el motor; esta aca porque lo que se prueba es la costura, y la costura la
// define `providers/contract.mjs`. Dos consecuencias, y las dos son deliberadas:
//
//   1. Los proveedores falsos son minimos y viven en `./degradation-fakes.mjs`,
//      uno por capacidad apagada, y cada uno pasa los MISMOS ocho chequeos que
//      un proveedor de verdad. Un strawman que no pasa el contrato no prueba
//      nada sobre la degradacion: prueba que un modulo roto se rompe.
//   2. Del motor se importan solo dos funciones, y de LECTURA: `prBody` de
//      `forge.mjs` y `doctor` de `doctor.mjs`. Las dos son hojas —node builtins
//      y `providers/contract.mjs`— y son los unicos lugares implementados donde
//      la mitad del motor de una fila se puede observar sin levantar git,
//      worktrees ni el SDK. `comandos.mjs` (el mensaje del despacho) no se
//      importa a proposito: arrastra `wiring.mjs` → `runner.mjs`, y eso
//      convertiria este test en rehen de otro archivo. Las mitades que quedan
//      fuera de alcance estan declaradas abajo, no disimuladas.
//
// LO QUE NO ESTA ACA, Y DONDE ESTA. La eleccion del camino degradado la hace el
// motor en `driver.mjs` (`anotarEnGestor`, `escribirEstadoEnGestor`), que es
// privado y solo se alcanza por `runItem` con repositorios de verdad. Eso ya lo
// cubre `packages/engine/test/provider-writes.test.mjs`. Este test cubre la otra
// mitad, la que ese no puede cubrir: que la superficie del proveedor ALCANZA
// para decidir el camino degradado sin adivinar, y que saltearse `can()` es
// ruidoso y nunca un no-op silencioso.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  can,
  validateProvider,
  validateItem,
  contractChecks,
  NotSupportedError,
  CAPABILITY_KEYS,
} from "./contract.mjs";
import { gestorFalso, sinCapacidad, sinDisparo } from "./degradation-fakes.mjs";
import { prBody } from "../packages/engine/src/forge.mjs";
import { doctor } from "../packages/engine/src/doctor.mjs";

/**
 * Las filas de la tabla que este archivo cubre. Se compara contra la tabla de
 * `contracts/provider.md`: una fila nueva sin test rompe el test de abajo, que
 * es la unica forma de que la tabla no se desincronice en silencio.
 */
const FILAS_CUBIERTAS = [
  "children",
  "dependencies",
  "createChild",
  "setState",
  "comment",
  "linkUrl",
  "labels",
  "searchAssigned",
  "searchMentioned",
  "boardFields",
  "identityAssignee",
  "listItems",
];

const CONTRATO = new URL("../specs/001-parallel-ticket-orchestrator/contracts/provider.md", import.meta.url);

/**
 * El contrato del board (spec 003), donde nacio `listItems`.
 *
 * POR QUE SE LEE UN SEGUNDO CONTRATO. La degradacion de `listItems` esta
 * declarada en `specs/003-board-de-control/contracts/board-api.md` §1 —"Sin la
 * capacidad: `capabilities().listItems === false`..."—, que es el contrato que
 * comparten los tres frentes de esa feature. Exigir ademas una fila en la tabla
 * de la spec 001 duplicaria la declaracion en dos archivos que se pueden
 * desincronizar; lo que este test necesita es que la degradacion este DICHA en
 * algun contrato, y que tenga test. Las dos cosas se siguen verificando.
 */
const CONTRATO_BOARD = new URL("../specs/003-board-de-control/contracts/board-api.md", import.meta.url);

/** Las capacidades cuya degradacion declara el contrato del board. */
function degradacionesDelBoard() {
  const md = readFileSync(CONTRATO_BOARD, "utf8");
  return new Set([...md.matchAll(/Sin la capacidad:\s*`capabilities\(\)\.([A-Za-z]+) === false`/g)].map((m) => m[1]));
}

/** Las capacidades nombradas en la primera columna de la tabla de degradacion. */
function filasDeLaTabla() {
  const md = readFileSync(CONTRATO, "utf8");
  const filas = md
    .split("\n")
    .filter((l) => l.startsWith("|"))
    .filter((l) => !/^\|\s*-+/.test(l))
    .filter((l) => !/Qué hace el motor/.test(l));
  const caps = new Set();
  for (const fila of filas) {
    const primera = fila.split("|")[1] || "";
    for (const m of primera.matchAll(/`([A-Za-z]+)`/g)) caps.add(m[1]);
  }
  for (const c of degradacionesDelBoard()) caps.add(c);
  return caps;
}

/**
 * `doctor` con lo minimo: sin repositorios declarados y con el proveedor
 * inyectado, para que no haya red, ni git, ni un modulo que resolver.
 * Se mira solo `avisos`: `ready` depende de si `gh` esta en el PATH de quien
 * corre los tests, y un test que dependa de eso no lo puede correr cualquiera.
 */
async function avisosDe(g) {
  const r = await doctor(
    {
      home: "/dev/null/noxloop-no-escribe",
      provider: {
        name: g.mod.meta.name,
        module: "./degradation-fakes.mjs",
        stateMap: g.fixtures.ctx.options.stateMap,
      },
      repos: {},
      forge: { cli: "gh" },
    },
    { env: {}, loadProvider: async () => g.mod },
  );
  return r.avisos;
}

/** Un recorrido terminado: una tarea integrada y una bloqueada. Para `prBody`. */
function recorridoTerminado() {
  return {
    item: {
      id: "s1",
      key: "FALSO-s1",
      title: "La primera historia",
      url: "falso://items/s1",
      acceptance: ["dado un estado, cuando algo, entonces algo"],
      branch: "feature/s1-la-primera-historia",
    },
    tasks: [
      {
        id: "T1",
        title: "Extraer el validador",
        acceptance: "un id numerico se rechaza",
        repo: "app",
        tier: "small",
        status: "integrated",
        testFiles: ["test/t1.test.mjs"],
        gateEvidence: { command: "npm test", exitCode: 0, durationMs: 1200, timedOut: false },
        attempts: { red: 1, green: 1, gate: 1 },
      },
      {
        id: "T2",
        title: "Migrar el llamador",
        acceptance: "el llamador pasa un string",
        repo: "app",
        tier: "small",
        status: "blocked",
        testFiles: ["test/t2.test.mjs"],
        attempts: { red: 1, green: 3 },
        lastFailure: "el gate volvio en 1: tres intentos de green sin rojo verificado",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// La tabla entera, y que ninguna fila se quede sin test
// ---------------------------------------------------------------------------

test("la tabla de degradacion tiene una fila por capacidad, y este archivo un test por fila", () => {
  const enLaTabla = filasDeLaTabla();
  for (const k of CAPABILITY_KEYS) {
    assert.ok(enLaTabla.has(k), `la capacidad "${k}" no tiene fila en la tabla de contracts/provider.md`);
  }
  for (const k of enLaTabla) {
    assert.ok(CAPABILITY_KEYS.includes(k), `la tabla nombra "${k}", que no es una capacidad del enum`);
    assert.ok(FILAS_CUBIERTAS.includes(k), `la fila "${k}" de la tabla no tiene test en este archivo`);
  }
  assert.deepEqual([...FILAS_CUBIERTAS].sort(), [...CAPABILITY_KEYS].sort());
});

test("cada fake degradado sigue siendo un proveedor legitimo: pasa los ocho chequeos", async () => {
  for (const cap of [...CAPABILITY_KEYS, "ninguna"]) {
    const g = cap === "ninguna" ? gestorFalso() : sinCapacidad(cap);
    const v = validateProvider(g.mod);
    assert.ok(v.ok, `sin "${cap}" el modulo no valida:\n  - ${v.problems.join("\n  - ")}`);
    for (const check of contractChecks(g.mod, g.fixtures)) {
      try {
        await check.run();
      } catch (e) {
        assert.fail(`sin "${cap}", ${check.name}: ${e.message}`);
      }
    }
  }
});

test("apagar una capacidad no apaga otra, y el motivo nombra al gestor y a la capacidad", () => {
  for (const cap of CAPABILITY_KEYS) {
    const g = sinCapacidad(cap);
    const r = can(g.mod, cap);
    assert.equal(r.available, false, `${cap} deberia estar en false`);
    assert.match(String(r.reason), new RegExp(cap), `el motivo de "${cap}" no la nombra`);
    assert.match(String(r.reason), new RegExp(g.mod.meta.name), `el motivo de "${cap}" no nombra al gestor`);
    for (const otra of CAPABILITY_KEYS.filter((k) => k !== cap)) {
      assert.equal(can(g.mod, otra).available, true, `apagar "${cap}" arrastro "${otra}"`);
    }
  }
});

// ---------------------------------------------------------------------------
// Fila `children`: no acepta items de nivel epic/feature. Lo dice al despachar,
// no a mitad del recorrido.
// ---------------------------------------------------------------------------

test("fila children: el rechazo de un hito se decide con UNA lectura y sin recorrer nada", async () => {
  const g = sinCapacidad("children");
  const ctx = g.fixtures.ctx;

  const hito = await g.mod.getItem("h1", ctx);
  assert.ok(hito);
  // El nivel llega en la PRIMERA respuesta, resuelto por el mapa de tipos del
  // proveedor. Es lo que hace que el rechazo sea posible al despachar: si el
  // nivel hubiera que deducirlo recorriendo hijos, la unica forma de saber que
  // no se puede recorrer seria empezar a recorrer.
  assert.equal(hito.level, "epic");
  assert.equal(can(g.mod, "children").available, false);
  assert.equal(g.llamadas.children, 0, "para decidir no hizo falta pedir hijos");
  assert.equal(g.llamadas.getItem, 1, "una sola lectura");

  const paquete = await g.mod.getItem("p1", ctx);
  assert.ok(paquete);
  assert.equal(paquete.level, "feature", "feature es el otro nivel que se recorre como hito");
});

test("fila children: con la capacidad en false, children() no devuelve [] — lanza", async () => {
  const g = sinCapacidad("children");
  // [] seria indistinguible de "un hito que no tiene hijos", y el recorrido
  // terminaria informando que no habia nada que hacer. Ese es el fallo
  // silencioso que la tabla existe para impedir.
  await assert.rejects(() => g.mod.children("h1", g.fixtures.ctx), NotSupportedError);
  assert.equal(g.tablero.escrituras, 0, "una capacidad ausente no escribe nada");
});

test("fila children: que no se pueden recorrer hitos se dice al validar, antes de despachar nada", async () => {
  const avisos = await avisosDe(sinCapacidad("children"));
  assert.ok(
    avisos.some((a) => /hijos/.test(a) && /hito/.test(a)),
    `ningun aviso habla de hitos ni de hijos:\n  - ${avisos.join("\n  - ")}`,
  );
  const conHijos = await avisosDe(gestorFalso());
  assert.ok(!conHijos.some((a) => /no sabe leer hijos/.test(a)), "el aviso sale con la capacidad en true");
});

// ---------------------------------------------------------------------------
// Fila `dependencies`: serializa el orden de los items y lo declara en el plan.
// No deduce un orden que el gestor no afirma.
// ---------------------------------------------------------------------------

test("fila dependencies: con la capacidad en true, el orden sale del gestor y de ningun otro lado", async () => {
  const g = gestorFalso();
  const d = await g.mod.dependencies("s2", g.fixtures.ctx);
  assert.deepEqual(d, { predecessors: ["s1"], successors: [] });
  // Este es el UNICO lugar donde una precedencia esta afirmada por el gestor.
});

test("fila dependencies: en false no hay ninguna fuente de orden, tampoco por la puerta de atras", async () => {
  const g = sinCapacidad("dependencies");
  const ctx = g.fixtures.ctx;
  await assert.rejects(() => g.mod.dependencies("s2", ctx), NotSupportedError);

  // Y el `Item` canonico no tiene donde traer un orden. Se verifica sobre el
  // objeto devuelto y no sobre el modelo: un proveedor que agregara
  // `predecessors` "por si sirve" le daria al motor exactamente lo que la fila
  // prohibe — un orden que el gestor no afirma, con aspecto de dato.
  for (const id of ["h1", "s1", "s2"]) {
    const item = await g.mod.getItem(id, ctx);
    assert.ok(item);
    assert.ok(validateItem(item).ok);
    for (const campo of ["dependsOn", "predecessors", "successors", "blockedBy", "after", "blocks"]) {
      assert.ok(!(campo in item), `${id} trae "${campo}": es un orden colado por getItem`);
    }
  }
});

test("fila dependencies: la serializacion queda DECLARADA, no implicita", async () => {
  const avisos = await avisosDe(sinCapacidad("dependencies"));
  assert.ok(
    avisos.some((a) => /serializar/.test(a) && /declarad/.test(a)),
    `el aviso no declara que va a serializar:\n  - ${avisos.join("\n  - ")}`,
  );
  const conDeps = await avisosDe(gestorFalso());
  assert.ok(!conDeps.some((a) => /serializar/.test(a)));
});

// ---------------------------------------------------------------------------
// Fila `createChild`: las tareas viven solo en el recorrido. El PR las enumera
// para que el tablero no quede mudo.
// ---------------------------------------------------------------------------

test("fila createChild: en false el tablero no cambia, ni a medias", async () => {
  const g = sinCapacidad("createChild");
  const antes = JSON.stringify(g.tablero.items);
  await assert.rejects(
    () => g.mod.createChild("s1", { id: "T1", title: "Extraer el validador", acceptance: "c" }, g.fixtures.ctx),
    NotSupportedError,
  );
  assert.equal(JSON.stringify(g.tablero.items), antes, "quedo una escritura parcial");
  assert.deepEqual(g.tablero.creados, []);
});

test("fila createChild: el PR enumera las tareas, integradas y bloqueadas, con su causa", () => {
  const run = recorridoTerminado();
  const cuerpo = prBody(run, { gaps: {} });

  // "El tablero no queda mudo" es esto: el unico registro de las tareas es el
  // PR, y tiene que nombrarlas todas. Se cuenta la total, no solo las que
  // salieron: un PR que enumera dos de cinco es un verde parcial leido como
  // completo.
  assert.match(cuerpo, /### Tareas \(1 de 2 integradas\)/);
  for (const t of run.tasks) {
    assert.ok(cuerpo.includes(t.id), `el PR no nombra ${t.id}`);
    assert.ok(cuerpo.includes(t.title), `el PR no nombra el titulo de ${t.id}`);
  }
  assert.ok(cuerpo.includes("un id numerico se rechaza"), "falta el criterio de la integrada");
  assert.ok(cuerpo.includes("tres intentos de green sin rojo verificado"), "falta la causa de la bloqueada");
  assert.ok(cuerpo.includes("exit 0"), "falta el exit code textual del gate");
});

// ---------------------------------------------------------------------------
// Fila `setState`: no mueve el ticket. La señal es el comentario.
// ---------------------------------------------------------------------------

test("fila setState: en false el ticket no se mueve, y la senial es el comentario", async () => {
  const g = sinCapacidad("setState");
  const ctx = g.fixtures.ctx;
  await assert.rejects(() => g.mod.setState("s1", "in_progress", ctx), NotSupportedError);
  assert.deepEqual(g.tablero.estados, {}, "movio el ticket con la capacidad en false");

  // La fila promete una senial de repuesto, asi que tiene que EXISTIR: sin
  // `comment`, "la senial es el comentario" no es una degradacion, es una
  // perdida. Y el comentario se guarda textual.
  assert.equal(can(g.mod, "comment").available, true);
  await g.mod.comment("s1", "noxloop arranco el recorrido de FALSO-s1", ctx);
  assert.deepEqual(
    g.tablero.comentarios.map((c) => c.text),
    ["noxloop arranco el recorrido de FALSO-s1"],
  );
});

test("fila setState: un estado canonico que el proyecto no tiene no se escribe ni se marca escrito", async () => {
  const g = gestorFalso();
  // `in_review: null` en el mapa es el caso normal, no una excepcion: en varias
  // plantillas ese estado no existe. Inventar el nombre nativo es como se mueve
  // un ticket a un estado que el proyecto no tiene.
  const r = await g.mod.setState("s1", "in_review", g.fixtures.ctx);
  assert.deepEqual(r, { written: null, skipped: "in_review" });
  assert.deepEqual(g.tablero.estados, {});

  const ok = await g.mod.setState("s1", "in_progress", g.fixtures.ctx);
  assert.deepEqual(ok, { written: "En curso" });
  assert.deepEqual(g.tablero.estados, { s1: "En curso" });
});

// ---------------------------------------------------------------------------
// Fila `comment`: nada bloquea; el recorrido queda solo en el PR y en el
// reporte local.
// ---------------------------------------------------------------------------

test("fila comment: en false nada bloquea, y el recorrido sigue entero en el PR", async () => {
  const g = sinCapacidad("comment");
  assert.ok(validateProvider(g.mod).ok, "un gestor sin comentarios sigue siendo un gestor valido");
  await assert.rejects(() => g.mod.comment("s1", "cualquier cosa", g.fixtures.ctx), NotSupportedError);
  assert.deepEqual(g.tablero.comentarios, []);

  // El reporte que no depende del gestor: ticket, criterios, tareas y rama.
  const cuerpo = prBody(recorridoTerminado(), { gaps: {} });
  assert.ok(cuerpo.includes("falso://items/s1"), "el PR no trae la URL del ticket");
  assert.ok(cuerpo.includes("dado un estado, cuando algo, entonces algo"), "el PR no trae los criterios");
  assert.ok(cuerpo.includes("feature/s1-la-primera-historia"), "el PR no trae la rama");
});

// ---------------------------------------------------------------------------
// Fila `linkUrl`: el PR se deja como texto en un comentario.
// ---------------------------------------------------------------------------

test("fila linkUrl: en false el PR va como comentario y la URL no se pierde", async () => {
  const g = sinCapacidad("linkUrl");
  const ctx = g.fixtures.ctx;
  const url = "https://forge.example/org/app/pull/7";

  assert.equal(can(g.mod, "linkUrl").available, false);
  assert.equal(can(g.mod, "comment").available, true, "el destino de repuesto tiene que existir");
  await assert.rejects(() => g.mod.linkUrl("s1", url, "Pull request", ctx), NotSupportedError);
  assert.deepEqual(g.tablero.enlaces, []);

  await g.mod.comment("s1", `Pull request abierto por noxloop: ${url}`, ctx);
  assert.equal(g.tablero.comentarios.length, 1);
  // La URL ENTERA y textual. Un comentario con la URL recortada o escapada es
  // peor que ninguno: parece que quedo anotada y no se puede abrir.
  assert.ok(g.tablero.comentarios[0].text.includes(url), g.tablero.comentarios[0].text);
});

test("fila linkUrl: con la capacidad en true el enlace es nativo y no hace falta el comentario", async () => {
  const g = gestorFalso();
  const url = "https://forge.example/org/app/pull/7";
  const r = await g.mod.linkUrl("s1", url, "Pull request", g.fixtures.ctx);
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(g.tablero.enlaces, [{ id: "s1", url, title: "Pull request" }]);
  assert.deepEqual(g.tablero.comentarios, []);
});

// ---------------------------------------------------------------------------
// Fila `labels`: se omiten las etiquetas de progreso.
// ---------------------------------------------------------------------------

test("fila labels: en false se omite la etiqueta y el Item sigue validando", async () => {
  const g = sinCapacidad("labels");
  const ctx = g.fixtures.ctx;
  await assert.rejects(() => g.mod.addLabel("s1", "noxloop:en-curso", ctx), NotSupportedError);
  assert.deepEqual(g.tablero.etiquetas, []);

  // Omitir la etiqueta no puede degradar el Item: `labels` sigue siendo una
  // lista, vacia. Un `null` ahi obligaria a cada llamador a un guard, y el que
  // se lo olvide revienta con "labels is not iterable" a mitad del recorrido.
  const item = await g.mod.getItem("s1", ctx);
  assert.ok(item);
  assert.deepEqual(item.labels, []);
  assert.ok(validateItem(item).ok);
});

// ---------------------------------------------------------------------------
// Fila `searchAssigned` / `searchMentioned`: el disparo correspondiente se
// desactiva; si los dos estan en `false`, el modo daemon no arranca y lo dice
// al validar.
// ---------------------------------------------------------------------------

test("fila search: apagar uno desactiva ese disparo y deja el otro en pie, en el mismo viaje", async () => {
  const soloMenciones = sinCapacidad("searchAssigned");
  const a = await soloMenciones.mod.searchInbox(soloMenciones.fixtures.ctx);
  assert.deepEqual(a.assigned, [], "devolvio asignados con searchAssigned en false");
  assert.deepEqual(a.mentioned.map((i) => i.id), ["s2"]);
  assert.equal(soloMenciones.llamadas.searchInbox, 1, "las dos seniales salen de una sola consulta");

  const soloAsignados = sinCapacidad("searchMentioned");
  const b = await soloAsignados.mod.searchInbox(soloAsignados.fixtures.ctx);
  assert.deepEqual(b.assigned.map((i) => i.id), ["s1"]);
  assert.deepEqual(b.mentioned, [], "devolvio menciones con searchMentioned en false");
});

test("fila search: los dos en false — el daemon no arranca, y se dice al validar", async () => {
  const g = sinDisparo();
  assert.ok(
    validateProvider(g.mod).ok,
    "un gestor sin ninguna busqueda sigue siendo valido: se usa a mano, con el id del ticket",
  );
  // Sin ninguna busqueda la funcion no existe. Exportarla devolviendo
  // `{assigned: [], mentioned: []}` seria el fallo de la fila `children` otra
  // vez: una bandeja vacia es indistinguible de "no hay nada asignado", y el
  // daemon giraria para siempre sin disparar nada y sin decir por que.
  assert.equal(typeof g.mod.searchInbox, "undefined");

  const avisos = await avisosDe(g);
  assert.ok(
    avisos.some((a) => /daemon/.test(a) && /no va a arrancar/.test(a)),
    `no se dijo que el daemon no arranca:\n  - ${avisos.join("\n  - ")}`,
  );

  // Con uno de los dos en true el aviso NO sale: un disparo alcanza.
  const conUno = await avisosDe(sinCapacidad("searchAssigned"));
  assert.ok(!conUno.some((a) => /daemon/.test(a)), `${conUno.join(" | ")}`);
});

// ---------------------------------------------------------------------------
// Fila `boardFields`: las tareas hijas no heredan campos de tablero.
// ---------------------------------------------------------------------------

test("fila boardFields: en false la hija no hereda nada, y no se le inventa nada", async () => {
  const g = sinCapacidad("boardFields");
  const ctx = g.fixtures.ctx;
  const padre = await g.mod.getItem("s1", ctx);
  assert.ok(padre);
  assert.equal(padre.boardFields, null, "declaro campos de tablero con la capacidad en false");

  const hija = await g.mod.createChild(
    "s1",
    { id: "T1", title: "Extraer el validador", acceptance: "c", boardFields: padre.boardFields },
    ctx,
  );
  assert.ok(hija);
  assert.equal(hija.boardFields, null);
  assert.equal(hija.parentId, "s1", "sin campos de tablero, el parentesco sigue siendo el unico vinculo");
});

test("fila boardFields: en true la hija hereda los del padre", async () => {
  const g = gestorFalso();
  const ctx = g.fixtures.ctx;
  const padre = await g.mod.getItem("s1", ctx);
  assert.ok(padre);
  assert.deepEqual(padre.boardFields, { iteration: "Sprint 7", area: "Plataforma" });

  const hija = await g.mod.createChild(
    "s1",
    { id: "T1", title: "Extraer el validador", acceptance: "c", boardFields: padre.boardFields },
    ctx,
  );
  assert.ok(hija);
  // El fallo que la herencia evita: una hija sin iteracion cae en la raiz del
  // proyecto y no aparece en ningun taskboard. Nadie la ve, y el recorrido
  // parece no haber creado nada.
  assert.deepEqual(hija.boardFields, { iteration: "Sprint 7", area: "Plataforma" });
});

// ---------------------------------------------------- fila identityAssignee
//
// La fila dice: con la capacidad en false la bandeja busca por el dueño del
// token y no por el `identity.assignee` declarado, y se advierte nombrando el
// responsable que se ignora.
//
// LA MITAD QUE SE PRUEBA ACA es que la superficie alcanza para decidirlo sin
// adivinar: la capacidad es consultable y el aviso sale de `revisarBandeja`. La
// otra mitad —que Azure DevOps de verdad mete el responsable en su WIQL— vive
// en `providers/azure-devops/identidad.test.mjs`, que es donde esta el WIQL.

import { revisarBandeja } from "../packages/engine/src/inbox.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const homeDesechable = () => mkdtempSync(join(tmpdir(), "nox-degr-"));

test("fila identityAssignee: en false, declarar un responsable AVISA en vez de ignorarse callado", async () => {
  const { mod, fixtures } = sinCapacidad("identityAssignee");
  const r = await revisarBandeja(
    { identity: { assignee: "cuenta-de-servicio@x.test" } },
    {
      provider: mod,
      providerCtx: { ...fixtures.ctx, identity: { assignee: "cuenta-de-servicio@x.test" } },
      home: homeDesechable(),
    },
  );

  const aviso = r.degradaciones.find((d) => /identity\.assignee/.test(d));
  assert.ok(aviso, "la degradacion tiene que salir: sin aviso, lo declarado se ignora en silencio");
  assert.match(aviso, /cuenta-de-servicio@x\.test/, "y nombrar el responsable que se ignora");
  assert.match(aviso, /vacia|dueño del token/, "y decir la consecuencia, que es una bandeja vacia");
});

test("fila identityAssignee: en true no hay aviso, porque no hay degradacion", async () => {
  const { mod, fixtures } = gestorFalso();
  const r = await revisarBandeja(
    { identity: { assignee: "cuenta-de-servicio@x.test" } },
    {
      provider: mod,
      providerCtx: { ...fixtures.ctx, identity: { assignee: "cuenta-de-servicio@x.test" } },
      home: homeDesechable(),
    },
  );
  assert.equal(r.degradaciones.filter((d) => /identity/.test(d)).length, 0);
});

test("fila identityAssignee: la capacidad se puede consultar sin llamar a searchInbox", () => {
  const { mod, llamadas } = sinCapacidad("identityAssignee");
  assert.equal(mod.capabilities().identityAssignee, false);
  assert.equal(llamadas.searchInbox, 0, "decidir el camino degradado no puede costar un viaje a la API");
});

// ---------------------------------------------------------------------------
// Fila `listItems` (spec 003, contracts/board-api.md §1): sin la capacidad, el
// board muestra lo que el motor ya conoce del proyecto y una nota que nombra al
// proveedor y la capacidad. Nunca un board vacio sin explicacion.
//
// LA MITAD QUE SE PRUEBA ACA es la del proveedor: que la ausencia se puede
// decidir con `can()` sin un viaje a la API, que el motivo alcanza para
// escribir la nota de la columna, y que la funcion no finge una lista vacia. La
// otra mitad —la nota en la columna— vive en `packages/service`, que es donde
// se arma el board.
// ---------------------------------------------------------------------------

test("fila listItems: el contrato del board declara la degradacion", () => {
  assert.ok(degradacionesDelBoard().has("listItems"), "board-api.md §1 ya no dice que pasa sin listItems");
});

test("fila listItems: en false, can() lo dice con un motivo que alcanza para la nota de la columna", () => {
  const g = sinCapacidad("listItems");
  const r = can(g.mod, "listItems");
  assert.equal(r.available, false);
  assert.match(String(r.reason), /listItems/);
  assert.match(String(r.reason), new RegExp(g.mod.meta.name), "la nota nombra al proveedor");
  assert.equal(g.llamadas.listItems, 0, "decidir el camino degradado no cuesta un viaje a la API");
});

test("fila listItems: en false, listItems() no devuelve una lista vacia — lanza", async () => {
  const g = sinCapacidad("listItems");
  // `{items: []}` es indistinguible de "el proyecto no tiene tickets": el board
  // quedaria vacio y sin nota, que es exactamente lo que la spec prohibe.
  await assert.rejects(() => g.mod.listItems({}, g.fixtures.ctx), NotSupportedError);
  assert.equal(g.tablero.escrituras, 0);
});

test("fila listItems: en true lista los tickets del gestor, y la bandeja sigue siendo la alternativa", async () => {
  const g = gestorFalso();
  const r = await g.mod.listItems({ limit: 10 }, g.fixtures.ctx);
  assert.deepEqual(r.items.map((/** @type {any} */ i) => i.id).sort(), ["h1", "p1", "raro", "s1", "s2"]);
  assert.equal(g.llamadas.listItems, 1);
  // Lo que el board muestra en el camino degradado —lo asignado y mencionado—
  // sigue en pie aunque listItems este apagada: apagar una no arrastra la otra.
  const sin = sinCapacidad("listItems");
  const bandeja = await sin.mod.searchInbox(sin.fixtures.ctx);
  assert.equal(bandeja.assigned.length + bandeja.mentioned.length, 2);
});
