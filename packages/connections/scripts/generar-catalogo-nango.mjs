#!/usr/bin/env node
// Regenera `src/catalogo-nango.mjs` desde el catalogo publico de Nango.
//
// POR QUE ESTO EXISTE COMO SCRIPT Y NO COMO UNA INSTRUCCION EN PROSA. El dato
// viaja empotrado, asi que envejece. Envejecer esta bien; envejecer sin una
// forma conocida y comprobable de refrescarlo, no: el que lo intente dentro de
// un ano tendria que reconstruir el parseo del formato de otra empresa desde
// cero, y el resultado seria un diff de mil lineas que nadie puede revisar.
//
// EL PRECEDENTE QUE OBLIGA A TODO ESTO. `apps/studio/app/globals.css` tiene una
// cabecera de procedencia porque la primera version de los tokens de Geist se
// escribio de memoria y 166 de ~184 valores estaban mal. Compilaban igual.
// Aqui el equivalente seria un modo de autenticacion inventado: tambien carga
// igual, y el sintoma aparece meses despues, en la maquina del operador, como
// una pestana de navegador que no lleva a ningun sitio.
//
// POR QUE ESTE ARCHIVO VIVE EN `scripts/` Y NO EN `src/`. Dos motivos, y los
// dos son reglas que ya estan probadas en este paquete:
//
//   1. `package.json` declara `files: ["src"]`. Lo que viaja al escritorio es
//      `src/`. Un generador que hace red y escribe en disco no tiene por que
//      estar dentro del recurso instalado.
//   2. `test/paquete-autocontenido.test.mjs` prohibe `writeFileSync` dentro de
//      `src/`, y con razon: la capa de conexiones no persiste nada por su
//      cuenta. Este script escribe, asi que no puede estar ahi.
//
// USO:
//   node packages/connections/scripts/generar-catalogo-nango.mjs
//   node packages/connections/scripts/generar-catalogo-nango.mjs ./api-catalog.txt
//
// Con un argumento, parsea ese archivo local en vez de descargar. Es lo que
// permite regenerar sin red y, sobre todo, revisar el diff contra una copia
// concreta del origen.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FUENTE = "https://nango.dev/docs/api-catalog.txt";
const DESTINO = new URL("../src/catalogo-nango.mjs", import.meta.url);

/**
 * Los dos prefijos bajo los que Nango publica la documentacion de un proveedor.
 * Son DOS y cual toca depende del proveedor; adivinar da un 404 en el navegador
 * del operador, que es el peor sitio para descubrirlo.
 */
const PREFIJOS = Object.freeze({
  "https://nango.dev/docs/api-integrations/": "api",
  "https://nango.dev/docs/integrations/all/": "all",
});

/**
 * Parte una fila de la tabla markdown del origen.
 *
 * POR QUE NO SE PARTE POR `|` A SECAS Y YA. Porque una fila incompleta se
 * convierte silenciosamente en una entrada con menos campos y el error sale
 * meses despues como un proveedor sin modo. Aqui se exige el numero de columnas
 * y se cuenta cuantas filas entraron, para compararlo con la cuenta que el
 * propio origen declara.
 *
 * @param {string} linea
 * @returns {{slug: string, nombre: string, nango: string|null, docs: string, categorias: string[]}|null}
 */
function filaDeProveedor(linea) {
  if (!linea.startsWith("|")) return null;
  const celdas = linea.split("|").slice(1, -1).map((c) => c.trim());
  if (celdas.length !== 7) return null;
  const slug = celdas[0].replace(/^`|`$/g, "");
  if (!slug || slug === "Slug" || /^-+$/.test(slug)) return null;

  const enlace = /\((https:\/\/[^)]+)\)/.exec(celdas[3]);
  let docs = null;
  if (enlace) {
    for (const [prefijo, marca] of Object.entries(PREFIJOS)) {
      if (enlace[1].startsWith(prefijo)) docs = marca;
    }
  }

  return {
    slug,
    nombre: celdas[1],
    // La columna VACIA se conserva como `null` y NO se rellena. El catalogo
    // real trae al menos una fila asi (`google-calendar-mcp` el 2026-09-21), y
    // rellenarla con el modo mas comun seria fabricar el dato que este paquete
    // entero existe para no fabricar.
    nango: celdas[2] === "" ? null : celdas[2],
    docs: docs ?? "all",
    categorias: celdas[6]
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c.length > 0),
  };
}

/** @param {string} texto */
function parsear(texto) {
  const declarada = /^Provider count:\s*(\d+)\s*$/m.exec(texto);
  if (!declarada) {
    throw new Error(
      "el origen ya no declara `Provider count:`. Es la unica forma de saber si el parseo perdio filas: sin esa " +
        "linea no se puede comprobar nada, asi que no se genera nada. Revisa el formato del origen a mano.",
    );
  }
  const proveedores = [];
  for (const linea of texto.split("\n")) {
    const fila = filaDeProveedor(linea);
    if (fila) proveedores.push(fila);
  }
  const esperados = Number(declarada[1]);
  if (proveedores.length !== esperados) {
    throw new Error(
      `el origen declara ${esperados} proveedores y el parseo saco ${proveedores.length}. No se escribe nada: un ` +
        "catalogo al que le faltan filas no falla, simplemente no ofrece proveedores que existen, y eso no lo " +
        "nota nadie. Arregla `filaDeProveedor` contra el formato nuevo.",
    );
  }
  const vistos = new Set();
  for (const p of proveedores) {
    if (vistos.has(p.slug)) throw new Error(`el slug '${p.slug}' aparece dos veces en el origen`);
    vistos.add(p.slug);
  }
  return { proveedores, esperados };
}

/** @param {string} s */
const comillas = (s) => JSON.stringify(s);

/**
 * @param {{proveedores: any[], esperados: number}} datos
 * @param {{sha256: string, descargado: string, fuente: string}} procedencia
 */
function renderizar({ proveedores }, procedencia) {
  const filas = proveedores
    .map(
      (p) =>
        `  { slug: ${comillas(p.slug)}, nombre: ${comillas(p.nombre)}, nango: ${
          p.nango === null ? "null" : comillas(p.nango)
        }, docs: ${comillas(p.docs)}, categorias: [${p.categorias.map(comillas).join(", ")}] },`,
    )
    .join("\n");

  return `// GENERADO. No editar a mano: lo reescribe \`scripts/generar-catalogo-nango.mjs\`.
//
// ===========================================================================
// PROCEDENCIA — leer antes de tocar una sola fila.
// ---------------------------------------------------------------------------
// Fuente:     ${procedencia.fuente}
// Descargado: ${procedencia.descargado}
// sha256 del archivo original: ${procedencia.sha256}
// Proveedores: ${proveedores.length}
//
// QUE ES ESTO. El catalogo publico de proveedores de Nango: slug, nombre,
// modo de autenticacion y categorias. **Es dato de otra empresa.** No es una
// API con contrato ni con changelog: pueden agregar proveedores, quitarlos,
// renombrarlos y —lo que mas duele— cambiarle el modo de autenticacion a uno
// que ya estaba. Nada de eso avisa.
//
// POR QUE VIAJA EMPOTRADO EN VEZ DE PEDIRSE EN TIEMPO DE EJECUCION. Porque
// "¿que puedo conectar?" es una pregunta de SOLO LECTURA y no puede exigir
// levantar tres contenedores para contestarse. El adaptador \`local\` existe
// justamente para el operador que no puede o no quiere levantar Docker; si la
// lista necesitara Nango corriendo, ese operador no podria ni MIRAR que hay —
// y la mitad del producto dependeria de la infraestructura que la otra mitad
// existe para evitar. Ademas la fuente no es el Nango del operador: es una
// pagina de documentacion en internet, asi que "en runtime" tampoco seria
// "preguntarle a tu Nango", seria "depender de que nango.dev responda".
//
// EL COSTE QUE SE ACEPTA, DICHO ENTERO: esto envejece. La contrapartida es que
// se regenera con una orden, el diff se revisa, y las pruebas comprueban que
// la cuenta y los siete proveedores verificados siguen cuadrando.
//
// EL PRECEDENTE QUE OBLIGA A ESTA CABECERA. \`apps/studio/app/globals.css\`
// lleva una igual porque los tokens de Geist se escribieron de memoria la
// primera vez y 166 de ~184 valores estaban mal. Compilaban igual. Aqui el
// equivalente es un modo de autenticacion inventado: tambien carga igual, y el
// sintoma aparece en la maquina del operador como una pestana de navegador que
// se abre para pegar un token.
//
// PARA REGENERAR:
//   node packages/connections/scripts/generar-catalogo-nango.mjs
// ===========================================================================

/** De donde salio este dato y cuando. Las pruebas la comparan contra las filas. */
export const PROCEDENCIA = Object.freeze({
  fuente: ${comillas(procedencia.fuente)},
  descargado: ${comillas(procedencia.descargado)},
  proveedores: ${proveedores.length},
  sha256: ${comillas(procedencia.sha256)},
  regenerar: "node packages/connections/scripts/generar-catalogo-nango.mjs",
  aviso:
    "Dato publico de Nango, no una API con contrato. Puede cambiar sin aviso, incluido el modo de autenticacion " +
    "de un proveedor que ya estaba.",
});

/**
 * Los proveedores del catalogo de Nango, tal como los declara el origen.
 *
 * \`nango\` es el modo CRUDO de Nango y se conserva sin traducir a proposito:
 * la traduccion a los modos de este contrato vive en \`catalogo-consultable.mjs\`,
 * es explicita y es total. Un \`nango: null\` es una fila que el origen publica
 * SIN modo — existe de verdad — y no se rellena con nada.
 *
 * \`docs\` es \`"api"\` o \`"all"\`: cual de los dos prefijos de documentacion de
 * Nango le corresponde. Se guarda la marca y no la URL entera porque la URL se
 * reconstruye, pero el prefijo no se adivina: elegir el equivocado da un 404.
 *
 * \`docs\` solo vale \`"api"\` o \`"all"\`; el tipo dice \`string\` porque el dato es
 * generado y el compilador no puede estrecharlo solo. Quien lo sostiene es
 * \`test/catalogo-de-nango.test.mjs\`, que recorre las 1012 filas y rechaza
 * cualquier otro valor.
 *
 * @type {readonly {slug: string, nombre: string, nango: string|null, docs: string, categorias: readonly string[]}[]}
 */
export const PROVEEDORES_DE_NANGO = Object.freeze([
${filas}
].map((p) => Object.freeze(p)));
`;
}

async function principal() {
  const local = process.argv[2];
  const texto = local ? readFileSync(local, "utf8") : await (await fetch(FUENTE)).text();
  const sha256 = createHash("sha256").update(texto).digest("hex");
  const datos = parsear(texto);

  const salida = renderizar(datos, {
    fuente: FUENTE,
    descargado: new Date().toISOString().slice(0, 10),
    sha256,
  });

  writeFileSync(fileURLToPath(DESTINO), salida);
  process.stdout.write(
    `escrito ${fileURLToPath(DESTINO)}\n  proveedores: ${datos.proveedores.length}\n  sha256 del origen: ${sha256}\n`,
  );
}

await principal();
