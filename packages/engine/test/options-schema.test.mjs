// T114 — `provider.options` se valida contra el esquema que el proveedor declara.
//
// EL FALLO QUE CIERRA, y esta escrito en la propia tarea. En
// `config.schema.json`, `options` es `{"type": "object"}` sin `properties`: nada
// de lo que un proveedor necesita ahi se describe ni se comprueba. Una opcion
// mal escrita —`organizacion` por `organization`— pasa la validacion entera y
// falla a mitad de un recorrido, que es exactamente la clase de fallo que D9
// dice que validar vino a matar.
//
// POR QUE EL ESQUEMA LO TRAE EL PROVEEDOR Y NO EL MOTOR. El motor no sabe que
// necesita un gestor: si sus opciones vivieran en `config.schema.json`, agregar
// un proveedor exigiria tocar el motor, y el principio VI dice lo contrario
// —agregar un gestor es agregar un archivo—.
//
// LA TAREA DECIA que no se construyo porque "ninguno de los tres lo usaria
// todavia". Eso dejo de ser cierto: azure-devops EXIGE organization, project y
// team; github usa owner y repo; linear teamId. Los tres tienen algo que declarar.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadProvider } from "../src/wiring.mjs";

/** Escribe un proveedor de mentira en disco y devuelve su ruta. */
function proveedorConEsquema(cuerpoDelEsquema) {
  const dir = mkdtempSync(join(tmpdir(), "nox-optsch-"));
  const ruta = join(dir, "prov.mjs");
  writeFileSync(ruta, `
export const meta = { name: "de-prueba", version: "1.0.0" };
export const requiredEnv = [];
${cuerpoDelEsquema}
export function capabilities() {
  return { children: false, dependencies: false, createChild: false, setState: false,
    comment: false, linkUrl: false, labels: false, searchAssigned: true,
    searchMentioned: false, boardFields: false, identityAssignee: false };
}
export async function getItem() { return null; }
export async function searchInbox() { return { assigned: [], mentioned: [] }; }
`);
  return ruta;
}

const ESQUEMA_TIPICO = `
export const optionsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["organization", "project"],
  properties: {
    organization: { type: "string" },
    project: { type: "string" },
    team: { type: "string" },
  },
};`;

const config = (ruta, options) => ({
  provider: { name: "de-prueba", module: ruta, options },
  home: "/tmp/nox-h",
});

test("opciones validas cargan sin ruido", async () => {
  const ruta = proveedorConEsquema(ESQUEMA_TIPICO);
  const { ctx } = await loadProvider(config(ruta, { organization: "o", project: "p" }));
  assert.equal(ctx.options.organization, "o");
});

test("EL CASO QUE MOTIVA LA TAREA: una opcion mal escrita se rechaza al cargar, no a mitad del recorrido", async () => {
  const ruta = proveedorConEsquema(ESQUEMA_TIPICO);
  let error = null;
  try {
    await loadProvider(config(ruta, { organizacion: "o", project: "p" }));
  } catch (e) {
    error = e;
  }
  assert.ok(error, "cargo con una opcion que el proveedor no conoce");
  assert.match(error.message, /organizacion/, "tiene que nombrar la clave que sobra");
  assert.match(error.message, /organization/, "y la que falta, que es como se ve el error de tipeo");
  assert.match(error.message, /de-prueba/, "y el proveedor, para saber que esquema mirar");
});

test("una opcion obligatoria que falta se nombra por su nombre", async () => {
  const ruta = proveedorConEsquema(ESQUEMA_TIPICO);
  let error = null;
  try {
    await loadProvider(config(ruta, { organization: "o" }));
  } catch (e) {
    error = e;
  }
  assert.ok(error);
  assert.match(error.message, /project/);
});

test("un tipo equivocado tambien: 'project' no puede ser un numero", async () => {
  const ruta = proveedorConEsquema(ESQUEMA_TIPICO);
  let error = null;
  try {
    await loadProvider(config(ruta, { organization: "o", project: 7 }));
  } catch (e) {
    error = e;
  }
  assert.ok(error);
  assert.match(error.message, /project/);
});

test("un proveedor SIN optionsSchema sigue cargando: es opcional, no obligatorio", async () => {
  const ruta = proveedorConEsquema("");
  const { ctx } = await loadProvider(config(ruta, { cualquier: "cosa" }));
  assert.equal(ctx.options.cualquier, "cosa");
});

test("las claves que el motor agrega al contexto no las juzga el esquema del proveedor", async () => {
  // `stateMap` y `levelMap` los mete el motor en `ctx.options`, no la persona en
  // el archivo. Validarlos contra un esquema con additionalProperties:false
  // rechazaria una configuracion correcta.
  const ruta = proveedorConEsquema(ESQUEMA_TIPICO);
  const { ctx } = await loadProvider({
    provider: { name: "de-prueba", module: ruta, options: { organization: "o", project: "p" }, stateMap: { todo: "New" }, levelMap: { story: "Story" } },
    home: "/tmp/nox-h",
  });
  assert.deepEqual(ctx.options.stateMap, { todo: "New" });
});

test("un optionsSchema que no es un esquema valido se dice, en vez de tragarse la validacion", async () => {
  const ruta = proveedorConEsquema(`export const optionsSchema = "no soy un esquema";`);
  let error = null;
  try {
    await loadProvider(config(ruta, { a: 1 }));
  } catch (e) {
    error = e;
  }
  assert.ok(error, "un esquema invalido no puede degradarse a 'no valido nada' en silencio");
  assert.match(error.message, /optionsSchema/);
});

// ------------------------------------------- y los tres proveedores de verdad

test("los tres proveedores reales declaran su optionsSchema: sin eso la tarea no esta cerrada", async () => {
  for (const nombre of ["github", "linear", "azure-devops"]) {
    const mod = await import(`../../../providers/${nombre}/index.mjs`);
    assert.equal(typeof mod.optionsSchema, "object",
      `${nombre} no declara optionsSchema: sus opciones siguen sin comprobarse`);
    assert.ok(mod.optionsSchema.properties, `${nombre}: el esquema no describe ninguna propiedad`);
  }
});

test("el ejemplo de configuracion de github valida contra el esquema de github", async () => {
  const { readFileSync } = await import("node:fs");
  const ejemplo = JSON.parse(readFileSync(new URL("../../../examples/noxloop.config.github.json", import.meta.url), "utf8"));
  const mod = await import("../../../providers/github/index.mjs");
  const { validate } = await import("../src/schema.mjs");
  assert.deepEqual(validate(mod.optionsSchema, ejemplo.provider.options), [],
    "el ejemplo que se publica no valida contra el esquema del proveedor que declara");
});

test("cada opcion que un proveedor LEE esta descrita en su esquema", async () => {
  // Una opcion que el codigo lee y el esquema no describe es la mitad del
  // problema que T114 arregla: con additionalProperties:false, usarla seria un
  // error de configuracion aunque el proveedor la soporte.
  const { readFileSync } = await import("node:fs");
  const faltantes = [];
  for (const nombre of ["github", "linear", "azure-devops"]) {
    const src = readFileSync(new URL(`../../../providers/${nombre}/index.mjs`, import.meta.url), "utf8");
    const mod = await import(`../../../providers/${nombre}/index.mjs`);
    const descritas = new Set(Object.keys(mod.optionsSchema.properties || {}));
    const leidas = new Set([...src.matchAll(/\bo(?:ptions)?(?:\?)?\.([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1]));
    for (const l of leidas) {
      // `stateMap` y `levelMap` los inyecta el motor, no la persona.
      if (l === "stateMap" || l === "levelMap") continue;
      if (!descritas.has(l)) faltantes.push(`${nombre}.${l}`);
    }
  }
  assert.deepEqual(faltantes, [], `opciones que el codigo lee y el esquema no describe: ${faltantes.join(", ")}`);
});
