// Cada paquete que el servicio importa viaja con el al escritorio, y en la
// posicion exacta que sus imports esperan.
//
// EL FALLO QUE ESTO CIERRA, Y YA OCURRIO. El escritorio empaqueta los recursos
// que `tauri.conf.json` declara y nada mas. Un paquete importado y no declarado
// resuelve perfectamente en el repositorio y revienta al abrir la aplicacion
// instalada, con un `ERR_MODULE_NOT_FOUND` que el operador ve como una ventana
// que no abre, sin ningun mensaje que lo explique. Paso con el lock, y el
// arreglo de entonces fue copiar el mecanismo dentro del paquete.
//
// Ese arreglo no escala: cablear cuatro paquetes ES el trabajo de este
// servicio. Asi que en vez de prohibir los imports de fuera, se ata la lista de
// imports a la lista de recursos, y si se separan falla aqui.
//
// LA SEGUNDA MITAD IMPORTA TANTO COMO LA PRIMERA: no basta con que el paquete
// viaje, tiene que aterrizar donde el import lo busca. El servicio hace
// `../../store/src/...` desde `servicio/src/`, que en el bundle resuelve a la
// RAIZ de recursos — no a `packages/`. Declararlo en `packages/store/src/`
// empaqueta el archivo correcto en el sitio equivocado, y el sintoma es
// identico al de no empaquetarlo: exactamente igual de mudo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = new URL("../../../", import.meta.url).pathname;
const CONFIG = join(RAIZ, "apps/desktop/src-tauri/tauri.conf.json");

/** Todos los `.mjs` de un directorio, recursivo. */
function fuentes(dir, acc = []) {
  for (const entrada of readdirSync(dir)) {
    const p = join(dir, entrada);
    if (statSync(p).isDirectory()) fuentes(p, acc);
    else if (entrada.endsWith(".mjs")) acc.push(p);
  }
  return acc;
}

/** Los paquetes del monorepo que el servicio importa de verdad, leidos del codigo. */
function paquetesImportados() {
  const encontrados = new Set();
  for (const base of ["src", "bin"]) {
    for (const archivo of fuentes(join(RAIZ, "packages/service", base))) {
      const texto = readFileSync(archivo, "utf8");
      // `../../<paquete>/` desde `packages/service/<base>/` es `packages/<paquete>/`.
      for (const m of texto.matchAll(/from\s+["']\.\.\/\.\.\/([a-z-]+)\//g)) {
        encontrados.add(m[1]);
      }
    }
  }
  return encontrados;
}

test("todo paquete que el servicio importa esta declarado como recurso del escritorio", () => {
  const recursos = JSON.parse(readFileSync(CONFIG, "utf8")).bundle?.resources ?? {};
  const importados = paquetesImportados();

  // Sin esta guarda el test es vacio: si los imports cambiaran de forma, el
  // conjunto quedaria a cero y el bucle no comprobaria nada.
  assert.ok(
    importados.size > 0,
    "el servicio no importa ningun paquete del monorepo, o cambio la forma de sus imports y este test dejo de mirar donde tiene que mirar",
  );

  const faltan = [];
  for (const paquete of importados) {
    const origen = `../../../packages/${paquete}/src/**/*`;
    if (!(origen in recursos)) {
      faltan.push(`${paquete}: falta la entrada ${origen} en bundle.resources`);
      continue;
    }
    // Y aterriza donde el import lo busca: raiz de recursos, no `packages/`.
    const destino = recursos[origen];
    assert.equal(
      destino,
      `${paquete}/src/`,
      `el recurso de '${paquete}' viaja a '${destino}', pero el servicio lo importa como '../../${paquete}/src/...', que en el bundle resuelve a '${paquete}/src/'`,
    );
    const manifiesto = `../../../packages/${paquete}/package.json`;
    if (!(manifiesto in recursos)) {
      faltan.push(`${paquete}: falta su package.json, y sin el Node no resuelve el paquete como modulo ES`);
    }
  }

  assert.deepEqual(faltan, [], `paquetes que el servicio importa y no viajan al escritorio:\n${faltan.join("\n")}`);
});

test("no se declara como recurso ningun paquete que el servicio no importa", () => {
  // La direccion contraria, y no es simetria por gusto: un recurso declarado de
  // mas engorda el instalador con codigo muerto y, peor, hace creer que ese
  // paquete forma parte de la superficie del escritorio. Quien lea la
  // configuracion para saber que viaja obtendria una respuesta falsa.
  const recursos = JSON.parse(readFileSync(CONFIG, "utf8")).bundle?.resources ?? {};
  const importados = paquetesImportados();

  const sobran = [];
  for (const origen of Object.keys(recursos)) {
    const m = origen.match(/^\.\.\/\.\.\/\.\.\/packages\/([a-z-]+)\/src\/\*\*\/\*$/);
    if (!m) continue;
    // El propio servicio viaja siempre; es el sidecar.
    if (m[1] === "service") continue;
    if (!importados.has(m[1])) sobran.push(m[1]);
  }

  assert.deepEqual(
    sobran,
    [],
    `declarados como recursos y no importados por el servicio: ${sobran.join(", ")}.\n` +
      "Si se anadieron previendo un cableado futuro, el orden correcto es al reves: primero el import, despues el recurso.",
  );
});
