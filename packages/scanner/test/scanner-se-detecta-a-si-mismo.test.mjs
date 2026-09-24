// El test de aceptacion del scanner: se corre sobre este mismo repositorio.
//
// POR QUE SOBRE ESTE REPOSITORIO Y NO SOBRE UN FIXTURE MAS. Porque un fixture
// lo escribe la misma persona que escribe el detector, y sale exactamente con
// las señales que el detector sabe leer. Este arbol no: es un monorepo de
// verdad, con workspaces, con un plugin, con cinco implementaciones de un
// contrato, con un `.gitignore` que excluye una parte de `.specify/` y vuelve a
// incluir otra. Si el scanner sirve para el proyecto de alguien, tiene que
// empezar por servir para el suyo.
//
// Y hay una segunda razon, mas dura: este repositorio es el unico proyecto del
// que se sabe la respuesta correcta sin tener que preguntarle a nadie. Cada
// afirmacion de aqui se puede comprobar a mano en treinta segundos.

import { test, before } from "node:test";
import assert from "node:assert/strict";

import { escanear } from "../src/index.mjs";

const RAIZ = new URL("../../../", import.meta.url).pathname;

/** @type {any} */
let snapshot;

before(async () => {
  snapshot = await escanear({ ruta: RAIZ });
  assert.equal(snapshot.estado, "completo");
}, { timeout: 180_000 });

/**
 * @param {string} clave
 * @returns {any}
 */
const halla = (clave) => snapshot.hallazgos.find((/** @type {any} */ h) => h.clave === clave);

test("detecta que el proyecto corre sobre Node, con la version que el manifiesto fija", async () => {
  const eco = halla("stack.ecosistemas");
  assert.ok(eco, "no se emitio nada sobre el stack");
  assert.ok(eco.valor.includes("node"), `los ecosistemas detectados fueron ${JSON.stringify(eco.valor)}`);
  assert.equal(eco.origen, "detectado");
  assert.ok(eco.evidencia.some((/** @type {any} */ e) => e.ruta === "package.json"));

  // La version se compara contra el manifiesto, no contra un numero escrito
  // aqui. UN NUMERO LITERAL EN ESTE TEST SE ROMPE EL DIA QUE EL PROYECTO SUBE
  // DE VERSION, y el fallo se lee como "el scanner no detecta Node" cuando lo
  // que paso es que el repositorio avanzo. Lo que este test afirma es que el
  // scanner saca el valor del sitio donde esta, con la linea que lo fija.
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const fijada = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")).engines.node;

  const runtime = halla("runtime.node");
  assert.equal(runtime.origen, "detectado");
  assert.equal(runtime.valor, fijada, `el manifiesto fija \`${fijada}\` y se detecto \`${runtime.valor}\``);
  assert.ok(runtime.evidencia[0].linea > 0, "la version del runtime sale sin la linea que la fija");
});

test("detecta que el codigo son modulos ES, no CommonJS", () => {
  const modulos = halla("stack.modulos");
  assert.equal(modulos.valor, "esm");
  assert.equal(modulos.origen, "detectado");
  assert.ok(modulos.evidencia[0].linea > 0);
});

test("detecta que los tests corren con el runner de Node, sin framework", () => {
  const runner = halla("testing.runner");
  assert.equal(runner.origen, "detectado");
  assert.match(runner.valor, /node --test/, `el runner detectado fue ${JSON.stringify(runner.valor)}`);
  assert.ok(runner.evidencia.some((/** @type {any} */ e) => e.ruta === "package.json" && e.linea > 0));

  const ubicacion = halla("testing.ubicacion");
  assert.ok(ubicacion.valor.directorios.includes("packages/engine/test"));
});

test("detecta el workflow de integracion continua y los comandos que corre", () => {
  const workflows = halla("ci.workflows");
  assert.equal(workflows.origen, "detectado");
  assert.ok(
    workflows.valor.includes(".github/workflows/ci.yml"),
    `los workflows detectados fueron ${JSON.stringify(workflows.valor)}`,
  );

  const comandos = halla("ci.comandos");
  const textos = comandos.valor.map((/** @type {any} */ c) => c.comando);
  assert.ok(textos.some((/** @type {string} */ t) => t.includes("npm test")));
  assert.ok(textos.some((/** @type {string} */ t) => t.includes("npm run typecheck")));
  assert.ok(
    comandos.valor.every((/** @type {any} */ c) => c.linea > 0),
    "un comando de CI sin linea obliga a buscarlo a mano en el workflow",
  );

  assert.equal(halla("ci.gatea_pr").valor, true, "el workflow declara disparador de pull request y no se vio");
});

test("detecta la constitution donde vive de verdad, dentro de un directorio medio ignorado", () => {
  // `.gitignore` de este repositorio dice `/.specify/*` y despues
  // `!/.specify/memory/`. Un matcher que no implemente la negacion se come la
  // constitution entera, que es justo el documento sin el cual el producto no
  // tiene de donde partir.
  const constitucion = halla("guidelines.constitution");
  assert.equal(constitucion.origen, "detectado");
  assert.equal(constitucion.valor.ruta, ".specify/memory/constitution.md");
  assert.ok(constitucion.valor.version, "la constitution declara su version y no se leyo");
});

test("detecta el plugin del agente, sus hooks, sus comandos y sus skills", () => {
  const plugin = halla("agentes.plugin");
  assert.equal(plugin.origen, "detectado");
  assert.ok(
    plugin.evidencia.some((/** @type {any} */ e) => e.ruta === "packages/plugin/.claude-plugin/plugin.json"),
    `la evidencia del plugin fue ${JSON.stringify(plugin.evidencia)}`,
  );

  const skills = halla("agentes.skills");
  assert.equal(skills.origen, "detectado");
  assert.ok(skills.valor.length >= 2, `se detectaron ${skills.valor.length} skills`);

  const hooks = halla("agentes.hooks");
  assert.equal(hooks.origen, "detectado");
  assert.ok(hooks.evidencia.some((/** @type {any} */ e) => e.ruta === "packages/plugin/hooks/hooks.json"));

  const subagentes = halla("agentes.subagentes");
  assert.ok(subagentes.valor.length >= 4, `se detectaron ${subagentes.valor.length} subagentes`);
});

test("detecta las cinco implementaciones del contrato de proveedor", () => {
  // Es el principio VI hecho estructura: el motor habla con una interfaz y las
  // implementaciones son archivos planos al lado. El detector no sabe como se
  // llama ese directorio en este proyecto; lo encuentra por la forma —un
  // contrato arriba, implementaciones hermanas debajo— que es lo unico que se
  // repite entre proyectos.
  const puntos = halla("arquitectura.puntos_de_extension");
  assert.ok(puntos, "no se detecto ningun punto de extension");
  assert.equal(puntos.origen, "detectado");

  const proveedores = puntos.valor.find((/** @type {any} */ p) => p.contrato.startsWith("providers/"));
  assert.ok(proveedores, `los puntos detectados fueron ${JSON.stringify(puntos.valor)}`);
  assert.deepEqual(
    [...proveedores.implementaciones].sort(),
    // `local` es el gestor de tareas propio (spec 003), un proveedor mas.
    ["azure-devops", "fake", "github", "linear", "local"],
    "no salieron los cinco proveedores incluidos",
  );
});

test("detecta el monorepo y sus workspaces", () => {
  const monorepo = halla("arquitectura.monorepo");
  assert.equal(monorepo.origen, "detectado");
  assert.deepEqual(monorepo.valor.patrones, ["packages/*", "apps/*"]);
  assert.ok(monorepo.valor.miembros.includes("packages/engine"));
  assert.ok(monorepo.valor.miembros.includes("packages/scanner"), "el propio scanner no se vio como workspace");
});

test("no se inventa nada sobre este repositorio: cada detectado trae una ruta que existe", async () => {
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  for (const h of snapshot.hallazgos) {
    if (h.origen !== "detectado") continue;
    assert.ok(h.evidencia.length > 0, `${h.clave} dice detectado sin evidencia`);
    for (const e of h.evidencia) {
      assert.ok(existsSync(join(RAIZ, e.ruta)), `${h.clave} cita \`${e.ruta}\`, que no existe`);
    }
  }
});

test("el recorrido de este repositorio no incluye lo que git ignora ni las dependencias", () => {
  const rutas = snapshot.archivos.map((/** @type {any} */ a) => a.ruta);
  assert.ok(!rutas.some((/** @type {string} */ r) => r.includes("node_modules/")), "entro node_modules");
  assert.ok(!rutas.some((/** @type {string} */ r) => r.includes("/.next/")), "entro la salida de build de la interfaz");
  assert.ok(rutas.includes(".specify/memory/constitution.md"));
});
