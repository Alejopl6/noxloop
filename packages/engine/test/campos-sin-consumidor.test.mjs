// Todo campo que un esquema declara tiene que tener alguien que lo lea.
//
// POR QUE ESTE TEST EXISTE. El proyecto se encontro DOS veces con el mismo modo
// de fallo, y las dos veces lo descubrio una persona leyendo, no la suite:
//
//   1. `findings` se consumia en el driver y NADIE lo producia, asi que la
//      revision no podia bloquear nada. El estado decia que reviso.
//   2. `targetFiles` era `required` en el esquema del plan y `plan.mjs` no lo
//      mencionaba, asi que dos tareas concurrentes podian declarar el mismo
//      archivo y chocar al rebasar.
//
// Los dos son la misma cosa: un campo declarado sin cable del otro lado. Un
// campo asi es PEOR que no tenerlo, porque se ve igual que una funcion que
// existe — el esquema lo valida, la documentacion lo describe, y no hace nada.
//
// LA LISTA DE EXCEPCIONES es deliberadamente incomoda: cada una exige el motivo
// por el que ese campo no lo lee el motor. Si el motivo no se puede escribir,
// el campo no deberia estar en el esquema.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = new URL("../../../", import.meta.url).pathname;
const MOTOR = join(RAIZ, "packages/engine");

/**
 * Campos que el motor legitimamente no lee, con el motivo. El motivo es parte
 * del contrato: no alcanza con listarlo.
 */
const NO_LOS_LEE_EL_MOTOR = {
  schemaVersion: "es la version del formato: la leen las migraciones y quien lee el archivo, no la logica",
  $schema: "no es un campo de datos: es la declaracion del esquema que usa el editor para autocompletar",
};

function fuentes(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e === "node_modules" || e === "test") continue;
      fuentes(p, acc);
    } else if (e.endsWith(".mjs")) {
      acc.push(p);
    }
  }
  return acc;
}

/** Todo nombre de propiedad que los esquemas declaran, con donde lo declaran. */
function camposDeclarados() {
  /** @type {Map<string, string[]>} */
  const campos = new Map();
  const dir = join(MOTOR, "schemas");

  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const esquema = JSON.parse(readFileSync(join(dir, f), "utf8"));

    const recorrer = (nodo) => {
      if (!nodo || typeof nodo !== "object") return;
      if (Array.isArray(nodo)) return nodo.forEach(recorrer);

      // `properties` es el unico lugar donde una clave es un NOMBRE DE CAMPO.
      // En cualquier otro, las claves son palabras del vocabulario de JSON
      // Schema y confundirlas daria un test que grita por nada.
      if (nodo.properties && typeof nodo.properties === "object") {
        for (const nombre of Object.keys(nodo.properties)) {
          if (!campos.has(nombre)) campos.set(nombre, []);
          const donde = campos.get(nombre);
          if (donde && !donde.includes(f)) donde.push(f);
        }
      }
      for (const v of Object.values(nodo)) recorrer(v);
    };

    recorrer(esquema);
  }
  return campos;
}

test("todo campo de los esquemas tiene alguien en el motor que lo lee", () => {
  const campos = camposDeclarados();
  assert.ok(campos.size > 30, `se esperaban muchos campos y se encontraron ${campos.size}`);

  const texto = fuentes(join(MOTOR, "src")).concat(fuentes(join(MOTOR, "bin")))
    .map((f) => readFileSync(f, "utf8")).join("\n");

  const huerfanos = [];
  for (const [nombre, donde] of campos) {
    if (nombre in NO_LOS_LEE_EL_MOTOR) continue;
    // Se busca el nombre como palabra. Alcanza para lo que este test persigue:
    // un campo que NADIE nombra en ningun lugar del motor es un cable cortado.
    const re = new RegExp(`\\b${nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (!re.test(texto)) huerfanos.push(`${nombre} (declarado en ${donde.join(", ")})`);
  }

  assert.deepEqual(huerfanos, [],
    `hay campos declarados que nadie lee — o se cablean, o salen del esquema, o van a NO_LOS_LEE_EL_MOTOR con su motivo:\n  ${huerfanos.join("\n  ")}`);
});

test("cada excepcion trae un motivo de verdad, no un placeholder", () => {
  for (const [campo, motivo] of Object.entries(NO_LOS_LEE_EL_MOTOR)) {
    assert.ok(motivo.length > 25, `la excepcion de "${campo}" no explica nada: "${motivo}"`);
  }
});

test("la lista de excepciones no acumula campos que ya no existen", () => {
  const campos = camposDeclarados();
  const muertas = Object.keys(NO_LOS_LEE_EL_MOTOR).filter((c) => !campos.has(c));
  assert.deepEqual(muertas, [],
    `estas excepciones ya no corresponden a ningun campo del esquema: ${muertas.join(", ")}`);
});
