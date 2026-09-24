// Reglas 2 y 3 del contrato: el navegador del SISTEMA, y el sondeo como camino
// primario.
//
// REGLA 2. Varios proveedores OAuth bloquean webviews embebidos por politica.
// Una URL a secas no dice donde abrirla, y el sitio natural para abrirla en una
// aplicacion de escritorio es justamente el webview que la va a rechazar. Por
// eso el resultado la declara: `abrir_en: "navegador_del_sistema"`.
//
// REGLA 3. El sondeo no es un plan B de los webhooks: la disponibilidad de
// webhooks en la edicion gratuita lleva meses sin aclararse —la tabla dice que
// no, el codigo sugiere que si— y ademas exigirian un endpoint HTTP escuchando
// en la maquina del operador. Construir el camino feliz sobre eso es construir
// sobre algo que no se puede verificar.

import { test } from "node:test";
import assert from "node:assert/strict";

import { crearAdaptadorFalso, CATALOGO_FALSO } from "../src/adaptadores/fake.mjs";
import { relojDePrueba } from "./ayuda.mjs";

const OAUTH = CATALOGO_FALSO.find((p) => p.modo === "oauth2").slug;

function montar(opciones = {}) {
  const { reloj, avanzar } = relojDePrueba();
  const proveedor = crearAdaptadorFalso({ reloj, dormir: async (ms) => avanzar(ms), ...opciones });
  return { proveedor, avanzar };
}

test("EL INVARIANTE: la URL de oauth2 viene marcada para el navegador del sistema", async () => {
  const { proveedor } = montar();
  const r = await proveedor.conectar({ projectId: "p", slug: OAUTH });
  assert.equal(
    r.abrir_en,
    "navegador_del_sistema",
    "la URL salio sin decir donde abrirla: el webview la va a tomar y el proveedor la va a rechazar",
  );
});

test("esperarConexion sondea hasta que la conexion aparece, y no antes", async () => {
  const { proveedor } = montar({ sondeosAntesDeAutorizar: 3 });
  const r = await proveedor.conectar({ projectId: "p", slug: OAUTH });

  const conexion = await proveedor.esperarConexion(r.handle, { timeoutMs: 60_000, intervaloMs: 1_000 });
  assert.equal(conexion.estado, "conectada");
  assert.equal(proveedor.sondeosDePrueba(), 4, "la conexion no se resolvio sondeando: aparecio sola");
});

test("la espera se agota con causa y accion, no se queda colgada para siempre", async () => {
  const { proveedor } = montar({ sondeosAntesDeAutorizar: Infinity });
  const r = await proveedor.conectar({ projectId: "p", slug: OAUTH });
  await assert.rejects(
    () => proveedor.esperarConexion(r.handle, { timeoutMs: 10_000, intervaloMs: 1_000 }),
    (e) => {
      assert.equal(e.codigo, "espera_agotada");
      assert.match(e.causa, /handle|autoriz/i);
      assert.ok(e.accion, "una espera agotada sin accion deja al operador mirando una pantalla");
      return true;
    },
  );
});

test("esperarConexion de un handle que no existe lo dice, en vez de sondear al vacio", async () => {
  const { proveedor } = montar();
  await assert.rejects(
    () => proveedor.esperarConexion("handle-inventado", { timeoutMs: 1_000 }),
    (e) => e.codigo === "handle_desconocido" && Boolean(e.accion),
  );
});

test("ninguna fuente del paquete abre un servidor para recibir webhooks", async () => {
  // La regla 3 se pierde asi: alguien agrega "un endpoint chiquito" para el
  // webhook, y a partir de ahi el camino feliz depende de una casilla que nadie
  // pudo verificar y de un puerto mas escuchando en la maquina del operador.
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const SRC = new URL("../src/", import.meta.url).pathname;
  const fuentes = (dir, acc = []) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) fuentes(p, acc);
      else if (p.endsWith(".mjs")) acc.push(p);
    }
    return acc;
  };
  const hallazgos = [];
  for (const archivo of fuentes(SRC)) {
    const texto = readFileSync(archivo, "utf8").replace(/^\s*\/\/.*$/gm, "");
    // `createServer` aparece en el sondeo del puerto, que ABRE Y CIERRA para
    // ver si esta libre; lo que no puede haber es un servidor que se quede
    // escuchando, ni un manejador de webhook.
    if (/\blisten\s*\(/.test(texto) && !archivo.endsWith("preflight.mjs")) hallazgos.push(`${archivo}: listen()`);
    if (/webhook/i.test(texto)) hallazgos.push(`${archivo}: webhook`);
  }
  assert.deepEqual(hallazgos, [], `la capa de integracion abrio superficie de red:\n${hallazgos.join("\n")}`);
});
