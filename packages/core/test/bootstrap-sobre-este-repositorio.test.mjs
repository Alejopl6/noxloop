// El criterio de aceptacion de verdad (SC-005): el bootstrap corre sobre ESTE
// repositorio y no vuelve a proponer lo que ya existe.
//
// POR QUE SOBRE ESTE REPOSITORIO Y NO SOBRE UN FIXTURE. Porque un fixture lo
// escribe la misma persona que escribe el detector, y sale exactamente con las
// señales que el detector sabe leer. Este arbol no: tiene un plugin de verdad
// con sus hooks, sus skills, sus subagentes y sus comandos; tiene integracion
// continua que gatea pull requests; tiene una constitution dentro de un
// directorio medio ignorado por `.gitignore`. Si el bootstrap sirve para el
// proyecto de alguien, tiene que empezar por servir para el suyo — y aqui la
// respuesta correcta se puede comprobar a mano en treinta segundos.
//
// POR QUE ESTE ARCHIVO IMPORTA EL SCANNER Y `src/` NO PUEDE. La regla es que
// ninguna FUENTE del nucleo salga del paquete: lo que viaja al escritorio es
// `packages/core/{package.json,src}` y un import relativo de mas revienta la
// aplicacion instalada. Las pruebas no viajan (`files: ["src"]`), y esta
// necesita un snapshot de verdad: fabricarlo a mano seria volver al fixture que
// esta prueba existe para no usar. La guarda que lo prohibe mira `src/`, a
// proposito.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { escanear } from "../../scanner/src/index.mjs";
import { analizar, detectarExistente, arbolDeDisco } from "../src/index.mjs";

const RAIZ = new URL("../../../", import.meta.url).pathname;

/**
 * El arbol de este repositorio, pero incapaz de escribir.
 *
 * No es paranoia: es la unica forma de que esta prueba pueda correr sobre el
 * repositorio de verdad. Si el analisis intentara escribir, la prueba se cae
 * nombrando la ruta, en vez de dejar un archivo en el arbol de quien la corrio.
 */
function arbolDeSoloLectura() {
  const real = arbolDeDisco(RAIZ);
  return {
    raiz: real.raiz,
    existe: real.existe,
    leer: real.leer,
    escribir: (/** @type {string} */ ruta) => {
      throw new Error(`el analisis del bootstrap escribio en \`${ruta}\`, y analizar no escribe (FR-026)`);
    },
  };
}

/** @type {any} */
let snapshot;
/** @type {any} */
let deteccion;
/** @type {any} */
let salida;

before(async () => {
  snapshot = await escanear({ ruta: RAIZ });
  assert.equal(snapshot.estado, "completo");
  deteccion = detectarExistente(snapshot);
  salida = analizar({ snapshot, arbol: arbolDeSoloLectura(), project_id: "prj_este", ahora: Date.now() });
}, { timeout: 180_000 });

test("reconoce el plugin del agente, con la ruta de su manifiesto", () => {
  const c = deteccion.capacidades.plugin_de_agente;
  assert.equal(c.presente, true);
  assert.ok(c.evidencia.some((/** @type {any} */ e) => e.ruta.endsWith("plugin.json")), JSON.stringify(c.evidencia));
});

test("reconoce los hooks, las skills, los subagentes y los comandos que ya existen", () => {
  for (const id of ["hooks", "skills", "subagentes", "comandos_de_agente"]) {
    assert.equal(deteccion.capacidades[id].presente, true, `\`${id}\` no se detecto en este repositorio`);
    assert.ok(deteccion.capacidades[id].evidencia.length > 0, `\`${id}\` se detecto sin evidencia`);
  }
});

test("reconoce la integracion continua y que gatea los pull requests", () => {
  assert.equal(deteccion.capacidades.integracion_continua.presente, true);
  assert.equal(deteccion.capacidades.gate_de_pull_request.presente, true);
  assert.equal(deteccion.capacidades.comandos_de_verificacion.presente, true);
});

test("reconoce la constitution, la guia de contribucion y el runner de tests", () => {
  for (const id of ["constitution", "guia_de_contribucion", "runner_de_tests", "suite_de_tests", "licencia"]) {
    assert.equal(deteccion.capacidades[id].presente, true, `\`${id}\` no se detecto`);
  }
});

test("toda la evidencia de lo detectado apunta a rutas que existen de verdad", () => {
  for (const id of deteccion.presentes) {
    for (const e of deteccion.capacidades[id].evidencia) {
      assert.ok(existsSync(join(RAIZ, e.ruta)), `\`${id}\` cita \`${e.ruta}\`, que no existe`);
    }
  }
});

test("y NO vuelve a proponer nada de lo que ya esta", () => {
  // Es el criterio entero: detectarlo no sirve de nada si igual se propone.
  const propuestas = salida.recomendaciones.map((/** @type {any} */ r) => r.capacidad);
  for (const id of deteccion.presentes) {
    assert.ok(!propuestas.includes(id), `se propuso \`${id}\`, que ya existe en este repositorio`);
  }
});

test("lo que si propone es lo que de verdad falta, y trae su diff calculado", () => {
  for (const r of salida.recomendaciones) {
    assert.equal(deteccion.capacidades[r.capacidad].presente, false, `\`${r.capacidad}\` se propuso estando presente`);
    assert.ok(r.diff.length > 0, `\`${r.id}\` se propuso sin diff`);
    assert.ok(r.cambios.length > 0);
  }
});

test("lo que no se puede derivar del arbol se pregunta en vez de inventarse", () => {
  // Los servidores MCP de un proyecto no estan en su codigo: se declaran. Un
  // bootstrap que propusiera unos estaria eligiendo por el operador.
  const preguntadas = salida.preguntas.map((/** @type {any} */ p) => p.capacidad);
  assert.ok(preguntadas.includes("servidores_mcp"), JSON.stringify(salida.preguntas));
  for (const p of salida.preguntas) {
    assert.ok(p.texto.length > 20, "una pregunta sin texto no se puede responder");
    assert.ok(p.falta.length > 0, "una pregunta que no dice que falta no se distingue de un error");
  }
});

test("el analisis no toco el arbol: `git status --porcelain` sigue igual", () => {
  // La misma promesa que el scanner, medida igual. El arbol de solo lectura ya
  // lo garantiza dentro; esto lo comprueba desde fuera, que es donde el
  // operador lo notaria.
  const estado = execFileSync("git", ["status", "--porcelain"], { cwd: RAIZ, encoding: "utf8" });
  const despues = execFileSync("git", ["status", "--porcelain"], { cwd: RAIZ, encoding: "utf8" });
  assert.equal(estado, despues);
});

test("la mayor parte de lo que este repositorio tiene configurado se reconoce", () => {
  // SC-005 pide el 90% del setup existente. Aqui se mide contra lo que de
  // verdad hay: las capacidades cuya evidencia existe en el disco.
  const total = deteccion.presentes.length;
  assert.ok(total >= 12, `solo se reconocieron ${total} capacidades: ${deteccion.presentes.join(", ")}`);
});
