// Rutas que el desarrollador no tiene en su maquina y el operador si.
//
// EL FALLO QUE EVITA. Espacios, acentos y enlaces simbolicos aparecen en
// proyectos reales —un `node_modules` enlazado, un worktree, una carpeta en el
// idioma de quien la creo— y son exactamente lo que no hay en el arbol de
// pruebas de nadie. El modo de fallo caro no es reventar: es escanear a medias
// y devolver un snapshot `completo` al que le falta el directorio con tilde.
// Eso es contexto inventado por omision, y no se nota nunca.
//
// El contrato admite las dos salidas: funciona, o falla con causa textual.
// Prohibe la tercera, que es la que pasa sola.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import { escanear } from "../src/index.mjs";
import { arbolTemporal, enlazar } from "./ayuda.mjs";

const RARAS = {
  "package.json": JSON.stringify({ name: "raro", type: "module" }, null, 2),
  "con espacios/modulo de dominio.mjs": "export const x = 1;\n",
  "árboles/ñandú/configuración.mjs": "export const y = 2;\n",
  "con espacios/árboles y tildes/otro archivo.mjs": "export const z = 3;\n",
  "parentesis (1)/archivo[raro].mjs": "export const w = 4;\n",
};

test("espacios y acentos: los archivos aparecen con su ruta intacta", async () => {
  const raiz = arbolTemporal(RARAS);
  const snapshot = await escanear({ ruta: raiz });

  assert.equal(snapshot.estado, "completo");
  const rutas = snapshot.archivos.map((a) => a.ruta);
  assert.ok(rutas.includes("con espacios/modulo de dominio.mjs"), `faltan rutas con espacios: ${rutas.join(", ")}`);
  assert.ok(rutas.includes("árboles/ñandú/configuración.mjs"), "faltan rutas con acentos");
  assert.ok(rutas.includes("con espacios/árboles y tildes/otro archivo.mjs"));
  assert.ok(rutas.includes("parentesis (1)/archivo[raro].mjs"));
});

test("un enlace simbolico no se sigue, y se declara que esta ahi", async () => {
  // Seguirlos es como un recorrido se come el disco entero: un enlace a `/` o
  // un ciclo de dos directorios bastan. Y omitirlos en silencio deja un hueco
  // sin declarar, que es lo que el principio X prohibe.
  const raiz = arbolTemporal(RARAS);
  const fuera = arbolTemporal({ "secreto/fuera-del-arbol.mjs": "export const fuga = 1;\n" });
  enlazar(raiz, fuera, "enlace-a-otro-arbol");

  const snapshot = await escanear({ ruta: raiz });

  assert.equal(snapshot.estado, "completo");
  assert.ok(
    !snapshot.archivos.some((a) => a.ruta.includes("fuera-del-arbol")),
    "el recorrido salio del arbol por un enlace simbolico",
  );
  assert.ok(
    snapshot.enlaces.some((e) => e.ruta === "enlace-a-otro-arbol"),
    "el enlace no se declaro: un hueco sin constancia es un hueco inventado",
  );
});

test("un ciclo de enlaces no cuelga el recorrido", async () => {
  const raiz = arbolTemporal({ "package.json": "{}", "a/b/c.mjs": "export const c = 1;\n" });
  symlinkSync(raiz, join(raiz, "a", "vuelta"));
  const snapshot = await escanear({ ruta: raiz });
  assert.equal(snapshot.estado, "completo");
});

test("un enlace roto no rompe el recorrido", async () => {
  const raiz = arbolTemporal({ "package.json": "{}" });
  symlinkSync(join(raiz, "no-existe"), join(raiz, "roto"));
  const snapshot = await escanear({ ruta: raiz });
  assert.equal(snapshot.estado, "completo");
  assert.ok(snapshot.enlaces.some((e) => e.ruta === "roto"));
});

test("un directorio ilegible se declara ilegible en vez de desaparecer del snapshot", async () => {
  // El caso real: un directorio con permisos de otro usuario dentro del arbol.
  // Saltarselo sin decirlo produce un snapshot `completo` al que le falta una
  // parte del proyecto, y nadie se entera nunca.
  const { chmodSync } = await import("node:fs");
  const raiz = arbolTemporal({ "package.json": "{}", "src/visible.mjs": "export const v = 1;\n" });
  mkdirSync(join(raiz, "prohibido"), { recursive: true });
  chmodSync(join(raiz, "prohibido"), 0o000);
  try {
    const snapshot = await escanear({ ruta: raiz });
    assert.equal(snapshot.estado, "completo");
    assert.ok(
      snapshot.ilegibles.some((i) => i.ruta === "prohibido" && i.causa.length > 0),
      `un directorio ilegible no se declaro: ${JSON.stringify(snapshot.ilegibles)}`,
    );
  } finally {
    chmodSync(join(raiz, "prohibido"), 0o755);
  }
});

test("apuntar a un archivo en vez de a un directorio falla con causa y accion", async () => {
  const raiz = arbolTemporal({ "package.json": "{}" });
  await assert.rejects(() => escanear({ ruta: join(raiz, "package.json") }), (e) => {
    assert.match(e.causa, /directorio/i);
    assert.ok(e.accion.length > 20);
    return true;
  });
});
