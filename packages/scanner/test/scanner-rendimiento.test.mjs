// NFR-001: 10.000 archivos en menos de 60 segundos.
//
// POR QUE UN NUMERO Y NO "que sea rapido". Porque el scanner corre en la
// primera pantalla que alguien ve del producto, antes de haber decidido si
// confia en el. Un recorrido que tarda tres minutos sobre un monorepo mediano
// no se percibe como lento: se percibe como colgado, y el operador lo mata
// antes de que termine. El limite es el que separa "esta trabajando" de "esto
// no funciona".
//
// EL FALLO QUE ESTE TEST ATRAPA. La forma facil de escribir los detectores es
// que cada uno recorra el arbol y lea lo que necesita. Con seis detectores eso
// son seis recorridos y N lecturas repetidas del mismo `package.json`: en un
// arbol de diez mil archivos la diferencia no es de porcentajes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { escanear } from "../src/index.mjs";

const ARCHIVOS = 10_000;
const LIMITE_MS = 60_000;

/** Un arbol sintetico, sin git: lo que se mide es el recorrido, no `git init`. */
function arbolSintetico() {
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-scanner-perf-"));
  writeFileSync(
    join(raiz, "package.json"),
    JSON.stringify({ name: "grande", type: "module", scripts: { test: "node --test" } }, null, 2),
  );
  const porDirectorio = 50;
  for (let i = 0; i < ARCHIVOS / porDirectorio; i++) {
    const dir = join(raiz, "src", `modulo-${i}`);
    mkdirSync(dir, { recursive: true });
    for (let j = 0; j < porDirectorio; j++) {
      // Contenido con forma de codigo de verdad: un archivo vacio no ejerce ni
      // la deteccion de binarios ni la busqueda linea a linea de la fase de
      // riesgos, que es donde esta el coste real.
      writeFileSync(
        join(dir, `archivo-${j}.mjs`),
        `// modulo ${i} archivo ${j}\nimport { algo } from "./otro.mjs";\n` +
          `export function calcular${j}(entrada) {\n  return algo(entrada) + ${j};\n}\n`.repeat(6),
      );
    }
  }
  return raiz;
}

test(
  `${ARCHIVOS} archivos sinteticos por debajo de ${LIMITE_MS / 1000} segundos`,
  { timeout: 300_000 },
  async () => {
    const raiz = arbolSintetico();

    const t0 = Date.now();
    const snapshot = await escanear({ ruta: raiz });
    const duracion = Date.now() - t0;

    assert.equal(snapshot.estado, "completo");
    assert.ok(
      snapshot.archivos.length >= ARCHIVOS,
      `el recorrido vio ${snapshot.archivos.length} archivos de ${ARCHIVOS}: se esta midiendo menos arbol del que hay`,
    );
    assert.ok(
      duracion < LIMITE_MS,
      `${ARCHIVOS} archivos tardaron ${duracion} ms, por encima del limite de ${LIMITE_MS} ms (NFR-001)`,
    );
    assert.ok(snapshot.duracion_ms > 0, "el snapshot no registra su duracion: NFR-001 no se puede medir sin ella");
  },
);
