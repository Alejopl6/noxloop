// T111 / FR-026 — el diff exacto se calcula ANTES de proponer, y es lo que se
// muestra.
//
// EL FALLO QUE EVITA. Un instalador que dice "voy a configurar tu proyecto" y
// enseña una lista de titulos pide fe. El diff exacto convierte la aprobacion
// en una revision: el operador lee lo que va a pasar, archivo por archivo y
// linea por linea, y aprueba eso. Sin el, la primera sorpresa —un archivo suyo
// modificado que no esperaba— se paga con la confianza entera del producto, y
// esa no vuelve.
//
// Y el diff no es decorativo: es el objeto que `aplicar` escribe. Por eso se
// calcula aqui, con el arbol delante, y viaja con la recomendacion.

import { test } from "node:test";
import assert from "node:assert/strict";

import { analizar, arbolEnMemoria, repositorioEnMemoria } from "../src/index.mjs";
import { hueco, snapshotDe, MOTIVO_LARGO } from "./ayuda.mjs";

const AHORA = Date.parse("2026-09-20T10:00:00.000Z");

const SIN_NADA = snapshotDe([
  hueco("agentes.instrucciones", MOTIVO_LARGO, []),
  hueco("guidelines.contributing", MOTIVO_LARGO, []),
]);

/** @param {any[]} cambios */
const catalogoQueEscribe = (cambios) => [
  {
    id: "entrada",
    tipo: "instrucciones",
    capacidad: "instrucciones_de_agente",
    titulo: "Instrucciones de agente",
    justificacion: "el proyecto no le dice nada a ningun agente todavia",
    efectos: [],
    cambios: () => ({ cambios }),
  },
];

/** @param {Record<string,string>} [inicial] @param {any[]} [cambios] */
function analisis(inicial = {}, cambios = [{ ruta: "AGENTS.md", contenido: "# Instrucciones\n\nNode.\n" }]) {
  const arbol = arbolEnMemoria(inicial);
  const salida = analizar({
    snapshot: SIN_NADA,
    arbol,
    catalogo: catalogoQueEscribe(cambios),
    project_id: "prj_1",
    ahora: AHORA,
    repositorio: repositorioEnMemoria(),
  });
  return { arbol, salida };
}

test("cada recomendacion viaja con su diff y con el contenido exacto de cada archivo", () => {
  const { salida } = analisis();
  const r = salida.recomendaciones[0];
  assert.ok(r.diff.length > 0, "la recomendacion salio sin diff");
  assert.equal(r.cambios.length, 1);
  assert.equal(r.cambios[0].ruta, "AGENTS.md");
  assert.equal(r.cambios[0].contenido, "# Instrucciones\n\nNode.\n");
  assert.equal(r.cambios[0].accion, "crear");
});

test("el diff de un archivo nuevo nombra la ruta y trae todas sus lineas como añadidas", () => {
  const { salida } = analisis();
  const diff = salida.recomendaciones[0].diff;
  assert.match(diff, /AGENTS\.md/);
  assert.match(diff, /^\+# Instrucciones$/m);
  assert.match(diff, /^\+Node\.$/m);
  assert.doesNotMatch(diff, /^-/m, "un archivo que no existia no puede tener lineas quitadas");
});

test("el diff de una modificacion enseña lo que se quita y lo que se pone", () => {
  const { salida } = analisis(
    { "AGENTS.md": "# Instrucciones\n\nPython.\n" },
    [{ ruta: "AGENTS.md", contenido: "# Instrucciones\n\nNode.\n" }],
  );
  const r = salida.recomendaciones[0];
  assert.equal(r.cambios[0].accion, "modificar");
  assert.match(r.diff, /^-Python\.$/m);
  assert.match(r.diff, /^\+Node\.$/m);
  assert.match(r.diff, /^ # Instrucciones$/m, "el contexto sin cambios no se enseña y el diff no se puede leer");
});

test("la base lleva la huella de cada archivo tal como estaba al calcular el diff", () => {
  // Es lo que permite detectar despues que el arbol cambio. Sin huella, la
  // unica forma de saberlo es recalcular, y recalcular es exactamente lo que
  // `aplicar` no puede hacer.
  const { salida } = analisis({ "AGENTS.md": "viejo\n" });
  const r = salida.recomendaciones[0];
  assert.equal(r.base.length, 1);
  assert.equal(r.base[0].ruta, "AGENTS.md");
  assert.ok(typeof r.base[0].huella_antes === "string" && r.base[0].huella_antes.length === 64);
});

test("la huella de un archivo que no existe es null, y eso tambien es un estado que se compara", () => {
  const { salida } = analisis();
  assert.equal(salida.recomendaciones[0].base[0].huella_antes, null);
});

test("un cambio identico a lo que ya hay no se propone: no hay nada que aprobar", () => {
  const { salida } = analisis(
    { "AGENTS.md": "# Instrucciones\n\nNode.\n" },
    [{ ruta: "AGENTS.md", contenido: "# Instrucciones\n\nNode.\n" }],
  );
  assert.equal(salida.recomendaciones.length, 0);
  assert.ok(salida.ya_presentes.some((/** @type {any} */ p) => /identic|ya tiene/.test(p.motivo)));
});

test("una recomendacion con varios archivos trae el diff de todos, en orden", () => {
  const { salida } = analisis({}, [
    { ruta: "AGENTS.md", contenido: "uno\n" },
    { ruta: "docs/agentes.md", contenido: "dos\n" },
  ]);
  const r = salida.recomendaciones[0];
  assert.deepEqual(r.cambios.map((/** @type {any} */ c) => c.ruta), ["AGENTS.md", "docs/agentes.md"]);
  assert.ok(r.diff.indexOf("AGENTS.md") < r.diff.indexOf("docs/agentes.md"));
});

test("una ruta que sale del proyecto no llega a proponerse", () => {
  assert.throws(
    () => analisis({}, [{ ruta: "../fuera.md", contenido: "x" }]),
    (/** @type {any} */ e) => e.codigo === "ruta_fuera_del_proyecto",
  );
});

test("calcular el diff no escribe nada", () => {
  const { arbol } = analisis({ "AGENTS.md": "viejo\n" });
  assert.deepEqual(arbol.archivos(), { "AGENTS.md": "viejo\n" });
});

test("la recomendacion nace pendiente, sin decision y sin fecha de decision", () => {
  const { salida } = analisis();
  const r = salida.recomendaciones[0];
  assert.equal(r.decision, "pendiente");
  assert.equal(r.motivo_decision, null);
  assert.equal(r.decidida, null);
});
