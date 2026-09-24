// El catalogo empotrado de Nango: que viaja, de donde salio, y que ninguna
// entrada se cuela sin que alguien haya decidido que hacer con ella.
//
// EL FALLO QUE EVITA, Y ES EL MISMO QUE YA COSTO CARO DOS VECES.
//
//   1. En `globals.css`: 166 de ~184 valores de Geist escritos de memoria
//      estaban mal. Compilaban igual. Ninguna prueba los habria atrapado.
//      La leccion que quedo escrita ahi es que un dato de otra empresa se
//      copia con su procedencia o no se copia.
//   2. En este mismo paquete: un proveedor sin `modo` no falla al cargar,
//      falla cuando alguien lo conecta y POR LA RAMA EQUIVOCADA, porque la
//      mayoria es oauth2 y ese es el camino que se asume. El sintoma es una
//      pestana del navegador que se abre para pegar un PAT.
//
// Los 1012 proveedores del catalogo de Nango multiplican el segundo fallo por
// mil. Y el catalogo REAL trae exactamente ese caso: `google-calendar-mcp`
// viene con la columna de modo VACIA. Si el mapeo tuviera un default, ese
// proveedor seria oauth2 sin que nadie lo decidiera.

import { test } from "node:test";
import assert from "node:assert/strict";

import { PROCEDENCIA, PROVEEDORES_DE_NANGO } from "../src/catalogo-nango.mjs";
import { MODO_POR_MODO_DE_NANGO, MOTIVO_DEL_MODO_NO_ATENDIDO, urlDeDocs } from "../src/catalogo-consultable.mjs";
import { MODOS_AUTH } from "../src/modelo.mjs";

test("EL INVARIANTE: el dato empotrado dice de donde salio y cuando, como los tokens de Geist", () => {
  assert.match(
    PROCEDENCIA.fuente,
    /^https:\/\/nango\.dev\/docs\/api-catalog\.txt$/,
    "sin la URL exacta, quien lo regenere dentro de un ano tiene que adivinar de donde vino",
  );
  assert.match(PROCEDENCIA.descargado, /^\d{4}-\d{2}-\d{2}$/, "una fecha de extraccion o el dato no tiene edad");
  assert.equal(typeof PROCEDENCIA.proveedores, "number");
  assert.match(PROCEDENCIA.sha256, /^[0-9a-f]{64}$/, "la huella del archivo original: sin ella no se sabe si cambio");
  assert.ok(
    PROCEDENCIA.regenerar && PROCEDENCIA.regenerar.includes("scripts/generar-catalogo-nango.mjs"),
    "envejecer esta bien; envejecer sin una forma comprobable de refrescarlo, no. La orden tiene que estar escrita aqui",
  );
});

test("la cuenta declarada en la procedencia es la cuenta de filas que de verdad viajan", () => {
  // No es tautologico: el generador la lee de la linea `Provider count:` del
  // ORIGEN y aqui se compara contra lo que quedo empotrado. Un parser que se
  // come 30 filas por un pipe dentro de un nombre daria 982 y esto lo canta.
  assert.equal(
    PROVEEDORES_DE_NANGO.length,
    PROCEDENCIA.proveedores,
    "el archivo declara una cantidad de proveedores y trae otra: el parseo perdio filas por el camino",
  );
  assert.ok(PROVEEDORES_DE_NANGO.length > 900, `solo viajan ${PROVEEDORES_DE_NANGO.length} proveedores`);
});

test("ningun slug repetido: dos filas con el mismo slug hacen que la segunda no se alcance nunca", () => {
  const vistos = new Set();
  const repetidos = [];
  for (const p of PROVEEDORES_DE_NANGO) {
    if (vistos.has(p.slug)) repetidos.push(p.slug);
    vistos.add(p.slug);
  }
  assert.deepEqual(repetidos, []);
});

test("cada fila trae slug, nombre y categorias; el modo puede faltar pero el campo no", () => {
  const rotas = [];
  for (const p of PROVEEDORES_DE_NANGO) {
    if (typeof p.slug !== "string" || !/^[a-z0-9][a-z0-9.-]*$/.test(p.slug)) rotas.push(`slug: ${p.slug}`);
    else if (typeof p.nombre !== "string" || !p.nombre) rotas.push(`${p.slug}: sin nombre`);
    else if (!Array.isArray(p.categorias)) rotas.push(`${p.slug}: categorias no es una lista`);
    else if (!("nango" in p)) rotas.push(`${p.slug}: no declara el campo \`nango\``);
    else if (p.docs !== "api" && p.docs !== "all") rotas.push(`${p.slug}: docs=${p.docs}`);
  }
  assert.deepEqual(rotas, []);
});

test("LOS SIETE VERIFICADOS: el modo que trae el catalogo empotrado es el que declara el catalogo oficial", () => {
  // Esta es la prueba que hace que el dato empotrado valga algo. Si alguien
  // regenera el archivo con un parser roto, o lo edita a mano, estas siete
  // filas son las que ya estaban comprobadas contra la documentacion oficial
  // el 2026-09-20 y las que el producto necesita de verdad.
  const esperado = {
    linear: "OAUTH2",
    jira: "OAUTH2",
    github: "OAUTH2",
    slack: "OAUTH2",
    notion: "OAUTH2",
    // Los dos que NO son OAuth. Es el hallazgo que gobierna todo el diseno de
    // este paquete y el que decide que adaptador atiende a cada uno.
    "azure-devops": "BASIC",
    vercel: "API_KEY",
  };
  const porSlug = Object.fromEntries(PROVEEDORES_DE_NANGO.map((p) => [p.slug, p]));
  for (const [slug, modo] of Object.entries(esperado)) {
    assert.ok(porSlug[slug], `'${slug}' no esta en el catalogo empotrado`);
    assert.equal(porSlug[slug].nango, modo, `'${slug}' viaja como ${porSlug[slug].nango} y el catalogo oficial dice ${modo}`);
  }
});

test("EL INVARIANTE: todo modo de Nango que aparece en el dato tiene una decision explicita, sin default", () => {
  // Un `?? "oauth2"` en el mapeo convertiria 228 proveedores que esta capa no
  // sabe atender en 228 pestanas de navegador que no llevan a ningun sitio.
  const sinDecidir = new Set();
  for (const p of PROVEEDORES_DE_NANGO) {
    const clave = p.nango ?? "";
    if (!Object.prototype.hasOwnProperty.call(MODO_POR_MODO_DE_NANGO, clave)) sinDecidir.add(JSON.stringify(clave));
  }
  assert.deepEqual(
    [...sinDecidir],
    [],
    "hay modos de Nango sin decision en MODO_POR_MODO_DE_NANGO: agregalos ahi, con su motivo si no se atienden",
  );
});

test("lo que el mapeo SI atiende es uno de los modos del contrato, y nunca inventa uno", () => {
  for (const [deNango, nuestro] of Object.entries(MODO_POR_MODO_DE_NANGO)) {
    if (nuestro === null) {
      assert.ok(
        MOTIVO_DEL_MODO_NO_ATENDIDO[deNango],
        `'${deNango}' se declara no atendido y no dice por que: el operador ve una fila apagada sin explicacion`,
      );
      continue;
    }
    assert.ok(MODOS_AUTH.includes(nuestro), `'${deNango}' se mapea a '${nuestro}', que no es un modo del contrato`);
  }
});

test("el proveedor que el catalogo oficial trae SIN modo no se convierte en oauth2", () => {
  // No es hipotetico: `google-calendar-mcp` viene con la columna vacia en el
  // archivo real descargado el 2026-09-21. Es exactamente el fallo que este
  // paquete ya documenta, servido por la fuente.
  const sinModo = PROVEEDORES_DE_NANGO.filter((p) => !p.nango);
  assert.ok(sinModo.length > 0, "el catalogo oficial ya no trae filas sin modo: revisa si el parser dejo de detectarlas");
  for (const p of sinModo) {
    assert.equal(
      MODO_POR_MODO_DE_NANGO[""],
      null,
      `'${p.slug}' viene sin modo declarado y el mapeo lo resolveria igual: eso es abrir un navegador a ciegas`,
    );
  }
});

test("OAUTH2_CC no es oauth2: no hay nada que autorizar en un navegador", () => {
  // Client credentials es maquina contra maquina. Meterlo en `oauth2` manda al
  // operador al flujo del navegador para una credencial que se pega a mano —
  // el mismo sintoma que el bug de Azure DevOps, multiplicado por 112.
  assert.equal(MODO_POR_MODO_DE_NANGO.OAUTH2_CC, null);
  assert.match(MOTIVO_DEL_MODO_NO_ATENDIDO.OAUTH2_CC, /\S/);
});

test("la URL de docs se reconstruye con el prefijo que corresponde, que son dos y no uno", () => {
  // Los docs de Nango viven en DOS rutas distintas y cual toca depende del
  // proveedor. Adivinar da un 404 en el navegador del operador, que es donde
  // menos sirve descubrirlo.
  const porSlug = Object.fromEntries(PROVEEDORES_DE_NANGO.map((p) => [p.slug, p]));
  assert.equal(urlDeDocs(porSlug.vercel), "https://nango.dev/docs/api-integrations/vercel.md");
  assert.equal(urlDeDocs(porSlug["azure-devops"]), "https://nango.dev/docs/integrations/all/azure-devops.md");
  const prefijos = new Set(PROVEEDORES_DE_NANGO.map((p) => p.docs));
  assert.deepEqual([...prefijos].sort(), ["all", "api"], "los dos prefijos siguen existiendo en el origen");
});

test("el catalogo empotrado no lleva ningun campo donde pueda caber una credencial", () => {
  // El catalogo de Nango es DESCRIPCION de proveedores ajenos. Si alguna fila
  // trajera `valor`, `token`, `secreto` o `entorno`, seria un sitio donde el
  // dia de manana alguien guarda algo — y de aqui sale a una pantalla.
  const prohibidos = ["valor", "token", "secret", "secreto", "credencial", "entorno", "password", "api_key"];
  for (const p of PROVEEDORES_DE_NANGO) {
    for (const clave of Object.keys(p)) {
      assert.ok(!prohibidos.includes(clave), `'${p.slug}' trae el campo '${clave}', que no describe: guarda`);
    }
  }
});

test("el dato esta congelado: nadie le cambia el modo a un proveedor en caliente", () => {
  assert.ok(Object.isFrozen(PROVEEDORES_DE_NANGO));
  assert.throws(() => {
    PROVEEDORES_DE_NANGO[0].nango = "OAUTH2";
  }, TypeError);
});
