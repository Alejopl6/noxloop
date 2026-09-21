// El nucleo viaja solo, igual que el scanner, la boveda y el servicio.
//
// EL FALLO QUE EVITA. Este paquete se empaqueta como recurso del sidecar: al
// escritorio viajan `packages/core/{package.json,src}` y nada mas. Un import
// relativo que salga del paquete —a `packages/scanner`, a `packages/engine`—
// resuelve perfectamente dentro del repositorio y revienta al abrir la
// aplicacion instalada, con un ERR_MODULE_NOT_FOUND que el operador ve como una
// ventana que no abre y que nadie relaciona con un import.
//
// La lista de paquetes que tienen que viajar solos crece, y la guarda tiene que
// crecer con ella: un paquete nuevo que nadie mira es exactamente donde vuelve
// a entrar el import.
//
// POR QUE LA GUARDA MIRA `src/` Y NO `test/`. Porque las pruebas no viajan. Y
// una de ellas —la de aceptacion sobre este repositorio— necesita el scanner de
// verdad para producir un snapshot de verdad: fabricarlo a mano seria volver al
// fixture que esa prueba existe para no usar.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../src/", import.meta.url).pathname;

/**
 * @param {string} dir
 * @param {string[]} acc
 * @returns {string[]}
 */
function fuentes(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) fuentes(p, acc);
    else if (p.endsWith(".mjs")) acc.push(p);
  }
  return acc;
}

test("ningun import de `src/` sale del paquete", () => {
  const fuera = [];
  for (const archivo of fuentes(SRC)) {
    const texto = readFileSync(archivo, "utf8");
    for (const m of texto.matchAll(/(?:from|import)\s*\(?\s*["'](\.\.?\/[^"']+)["']/g)) {
      if (/(^|\/)\.\.\/\.\.\//.test(m[1])) fuera.push(`${archivo}: ${m[1]}`);
    }
  }
  assert.deepEqual(fuera, [], `hay imports que salen del paquete:\n${fuera.join("\n")}`);
});

test("ninguna fuente depende de un paquete de terceros: el nucleo corre con Node y nada mas", () => {
  // La constitucion lo dice del motor y vale igual aqui: sin dependencias en el
  // camino critico. Un nucleo que necesita un parser de markdown instalado es
  // un nucleo que no arranca en la maquina del operador el dia que el registro
  // esta caido — y lo que no arranca es la etapa donde se escriben las reglas
  // del proyecto.
  const externos = [];
  for (const archivo of fuentes(SRC)) {
    const texto = readFileSync(archivo, "utf8");
    for (const m of texto.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      const especificador = m[1];
      if (especificador.startsWith(".")) continue;
      if (especificador.startsWith("node:")) continue;
      externos.push(`${archivo}: ${especificador}`);
    }
  }
  assert.deepEqual(externos, [], `el nucleo adquirio dependencias:\n${externos.join("\n")}`);
});

test("el manifiesto declara que lo que viaja es `src/`", () => {
  const manifiesto = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(manifiesto.files, ["src"]);
  assert.equal(manifiesto.type, "module");
  assert.equal(manifiesto.dependencies, undefined, "el nucleo no tiene dependencias de runtime");
});

test("el nucleo no ejecuta nada del proyecto que gestiona", () => {
  // Escribe —esa es su etapa— pero no ejecuta. Un `child_process` aqui es como
  // un script del proyecto ajeno acaba corriendo con los permisos del operador
  // durante una fase que el aprobo como "escribir unos archivos".
  const PROHIBIDOS = [/["']node:child_process["']/, /["']node:vm["']/, /\bexecSync\b/, /\bspawnSync\b/];
  const hallazgos = [];
  for (const archivo of fuentes(SRC)) {
    const texto = readFileSync(archivo, "utf8").replace(/^\s*\/\/.*$/gm, "");
    for (const re of PROHIBIDOS) {
      const m = texto.match(re);
      if (m) hallazgos.push(`${archivo}: ${m[0]}`);
    }
  }
  assert.deepEqual(hallazgos, [], `el nucleo adquirio la capacidad de ejecutar:\n${hallazgos.join("\n")}`);
});

test("toda escritura pasa por el puerto del arbol, que es donde se comprueba la ruta", () => {
  // Si una fuente escribe con `fs` por su cuenta, la comprobacion de "esta ruta
  // no sale del proyecto" y la escritura atomica se las salta. `arbol.mjs` es
  // el unico sitio donde `node:fs` esta permitido, y por eso es el unico donde
  // hay que mirar que esta bien hecho.
  const hallazgos = [];
  for (const archivo of fuentes(SRC)) {
    if (archivo.endsWith("/arbol.mjs")) continue;
    const texto = readFileSync(archivo, "utf8").replace(/^\s*\/\/.*$/gm, "");
    if (/["']node:fs["']/.test(texto)) hallazgos.push(archivo);
  }
  assert.deepEqual(hallazgos, [], `hay escrituras fuera del puerto del arbol:\n${hallazgos.join("\n")}`);
});

test("cada error del catalogo dice la causa y la accion siguiente", async () => {
  // NFR-006. La prueba recorre el catalogo entero en vez de confiar en que cada
  // autor se acuerde: un error nuevo sin `accion` cae aqui y no en la pantalla
  // del operador.
  const catalogo = await import("../src/errores.mjs");
  const fabricas = Object.entries(catalogo).filter(([nombre, v]) => typeof v === "function" && nombre !== "ErrorDeNucleo");
  assert.ok(fabricas.length >= 10, `solo se encontraron ${fabricas.length} errores en el catalogo`);

  for (const [nombre, fabrica] of fabricas) {
    const e = /** @type {any} */ (fabrica)([], [], 20);
    assert.ok(e.codigo, `\`${nombre}\` produce un error sin codigo`);
    assert.ok(e.causa.length > 40, `\`${nombre}\` produce una causa que no explica nada: "${e.causa}"`);
    assert.ok(e.accion.length > 20, `\`${nombre}\` produce un error sin accion concreta`);
    assert.doesNotMatch(e.accion, /^reintenta/i, `\`${nombre}\` dice "reintenta", que no es una accion`);
    assert.ok(typeof e.estado === "number" && e.estado >= 400);
  }
});
