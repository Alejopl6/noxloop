// Toda utilidad propia declarada en `globals.css` esta registrada en `cn()`.
//
// EL FALLO QUE ESTO EVITA, y estuvo activo en toda la interfaz sin dar un solo
// error. `twMerge` decide a que grupo pertenece una clase por su prefijo. Las
// utilidades tipograficas de Geist empiezan por `text-`, igual que los colores
// de texto, asi que las metia en el grupo "color" y al encontrar dos en la
// misma llamada BORRABA UNA:
//
//     cn("text-ds-gray-1000 text-label-14")  ->  "text-label-14"     (sin color)
//     cn("text-heading-16 text-ds-gray-1000") -> "text-ds-gray-1000" (sin encabezado)
//
// El componente compila, se renderiza, y sale con la tipografia del padre o sin
// color. Como casi siempre hereda algo parecido, se ve "casi bien" — que es
// exactamente lo que lo hizo durar. Lo encontro alguien leyendo el HTML
// generado, no el typecheck ni una revision.
//
// POR QUE ESTA GUARDA Y NO SOLO EL ARREGLO. El arreglo enseña a `twMerge` las
// utilidades que existen HOY. El dia que alguien añada `text-copy-32` a
// `globals.css` y no la registre, la trampa vuelve a estar puesta para esa
// clase sola, en silencio, y el siguiente no va a tener a nadie leyendo el
// HTML. Esto ata las dos listas.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = new URL("../", import.meta.url).pathname;

/** Las utilidades que `globals.css` declara con `@utility`. */
function declaradasEnLaHoja() {
  const css = readFileSync(join(RAIZ, "app/globals.css"), "utf8");
  return new Set([...css.matchAll(/@utility\s+([a-z0-9-]+)/g)].map((m) => m[1]));
}

/** Las que `cn()` le enseña a `tailwind-merge`. */
function registradasEnCn() {
  const utils = readFileSync(join(RAIZ, "lib/utils.ts"), "utf8");

  const registradas = new Set();
  // Las tipograficas se declaran sin el prefijo `text-`, dentro de `{ text: [...] }`.
  for (const m of utils.matchAll(/'((?:heading|button|label|copy)-\d+)'/g)) {
    registradas.add(`text-${m[1]}`);
  }
  // Las demas se declaran con su nombre entero.
  //
  // Los NOMBRES DE GRUPO se excluyen por convencion —terminan en `-geist`— y
  // no por la puntuacion que llevan al lado. El primer intento los filtraba
  // buscando los dos puntos de `'movimiento-geist':`, y volvio a fallar en
  // cuanto el mismo nombre aparecio como parametro de tipo, seguido de `>`.
  // Filtrar por como se escribe alrededor es perseguir la sintaxis; filtrar
  // por lo que la cosa ES se sostiene.
  for (const m of utils.matchAll(/'((?:movimiento|fuente)-[a-z-]+)'/g)) {
    if (m[1].endsWith("-geist")) continue;
    registradas.add(m[1]);
  }
  return registradas;
}

test("toda utilidad propia de la hoja esta registrada en `cn()`", () => {
  const enLaHoja = declaradasEnLaHoja();
  const enCn = registradasEnCn();

  // Sin esta guarda el test es vacio: si cambiara la forma de declararlas, los
  // dos conjuntos quedarian a cero y la comparacion pasaria sin mirar nada.
  assert.ok(
    enLaHoja.size >= 20,
    `solo se encontraron ${enLaHoja.size} utilidades en globals.css: cambio la forma de declararlas y esta guarda dejo de mirar donde tiene que mirar`,
  );
  assert.ok(enCn.size >= 20, `solo se encontraron ${enCn.size} utilidades en lib/utils.ts: idem`);

  const sinRegistrar = [...enLaHoja].filter((u) => !enCn.has(u)).sort();
  assert.deepEqual(
    sinRegistrar,
    [],
    "estas utilidades existen en globals.css y `cn()` no las conoce, asi que `tailwind-merge` puede borrarlas " +
      `al combinarlas con una clase del mismo prefijo:\n  ${sinRegistrar.join("\n  ")}\n` +
      "Registralas en `TIPOGRAFIA_DE_GEIST` o en el `classGroup` que les toque.",
  );

  const fantasmas = [...enCn].filter((u) => !enLaHoja.has(u)).sort();
  assert.deepEqual(
    fantasmas,
    [],
    `\`cn()\` registra utilidades que la hoja ya no declara: ${fantasmas.join(", ")}.\n` +
      "No rompe nada, pero es una lista que dejo de describir la realidad — y la proxima persona la lee como si la describiera.",
  );
});

test("EL INVARIANTE: una tipografia y un color sobreviven a la misma llamada", async () => {
  // La comprobacion de resultado, no de configuracion. Reconstruye el mismo
  // `cn()` desde la lista de la hoja y ejerce los cuatro pares que estaban
  // rotos, mas los tres que SI tienen que seguir resolviendo.
  const { extendTailwindMerge } = await import("tailwind-merge");

  const enLaHoja = [...declaradasEnLaHoja()];
  const tipografia = enLaHoja
    .filter((u) => /^text-(heading|button|label|copy)-\d+$/.test(u))
    .map((u) => u.replace(/^text-/, ""));

  const cn = extendTailwindMerge({
    extend: {
      classGroups: { "tipografia-geist": [{ text: tipografia }] },
      conflictingClassGroups: { "tipografia-geist": [] },
    },
  });

  for (const [entrada, esperado] of [
    ["text-ds-gray-1000 text-label-14", "text-ds-gray-1000 text-label-14"],
    ["text-button-14 text-ds-gray-900", "text-button-14 text-ds-gray-900"],
    ["text-heading-16 text-ds-gray-1000", "text-heading-16 text-ds-gray-1000"],
    ["text-copy-14 text-ds-gray-900", "text-copy-14 text-ds-gray-900"],
  ]) {
    assert.equal(cn(entrada), esperado, `\`cn("${entrada}")\` perdio una clase`);
  }

  // Y lo que NO se puede romper al arreglar lo de arriba: dos tipografias
  // siguen siendo un conflicto —gana la ultima— y los colores tambien. Sin
  // esto, "arreglarlo" podria ser apagar la resolucion entera.
  assert.equal(cn("text-heading-16 text-copy-14"), "text-copy-14", "dos tipografias tienen que resolver");
  assert.equal(cn("text-ds-gray-700 text-ds-gray-1000"), "text-ds-gray-1000", "dos colores tienen que resolver");
  assert.equal(cn("px-2 px-4"), "px-4", "el Tailwind de siempre tiene que seguir resolviendo");
});
