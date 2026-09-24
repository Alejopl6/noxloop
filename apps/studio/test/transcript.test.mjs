// Lo que el detalle de un run calcula del transcript en el cliente
// (`components/runs/transcript.ts`, spec 004, US2, FR-006).
//
// POR QUE SE PRUEBA ESTO Y NO LA PINTURA. Lo que decide la interfaz es QUE SE
// DICE de los tokens —«sin medir» no es cero: pintar `0` de una fase que el
// runtime no midio es inventar un gasto—, como se juntan una herramienta y su
// resultado, y como se añade lo nuevo que llega en vivo sin duplicar ni perder
// lineas. Las tres cosas compilan, se ven bien y pueden mentir.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  agruparEventos,
  claveDeFase,
  formatearTokens,
  fusionarTranscript,
  resumirEntrada,
  totalDeTokens,
} from "../components/runs/transcript.ts";

const SIN_MEDIR = { medido: false, entrada: null, salida: null, cacheLectura: null, cacheEscritura: null };
const medido = (entrada, salida, cacheLectura = null) => ({ medido: true, entrada, salida, cacheLectura, cacheEscritura: null });

test("«sin medir» no es cero, y los numeros grandes se leen", () => {
  assert.equal(formatearTokens(SIN_MEDIR), "sin medir");
  assert.equal(formatearTokens(medido(0, 0)), "0 entrada · 0 salida");
  assert.equal(formatearTokens(medido(1200, 340, 51_000)), "1,2 k entrada · 340 salida · 51 k de cache");
  assert.equal(formatearTokens(null), "sin medir");
});

test("el total: uno sin medir deja el total sin medir", () => {
  assert.deepEqual(totalDeTokens([medido(10, 1), medido(5, 2, 3)]), { medido: true, entrada: 15, salida: 3, cacheLectura: 3, cacheEscritura: null });
  assert.equal(totalDeTokens([medido(10, 1), SIN_MEDIR]).medido, false);
  assert.equal(totalDeTokens([]).medido, false);
});

test("una herramienta se junta con SU resultado, aunque haya texto en medio", () => {
  const eventos = [
    { t: "1", tipo: "texto", contenido: "Leo." },
    { t: "2", tipo: "herramienta", herramienta: "Read", contenido: '{"file_path":"a.mjs"}' },
    { t: "3", tipo: "herramienta", herramienta: "Bash", contenido: '{"command":"npm test"}' },
    { t: "4", tipo: "resultado_herramienta", herramienta: "Read", contenido: "contenido de a" },
    { t: "5", tipo: "resultado_herramienta", herramienta: "Bash", contenido: "ok" },
    { t: "6", tipo: "resultado_herramienta", herramienta: "Grep", contenido: "huerfano" },
    { t: "7", tipo: "resultado", contenido: "listo" },
  ];
  const bloques = agruparEventos(eventos);
  assert.deepEqual(
    bloques.map((b) => [b.tipo, b.tipo === "herramienta" ? b.nombre : null, b.tipo === "herramienta" ? b.resultado?.contenido ?? null : null]),
    [
      ["texto", null, null],
      ["herramienta", "Read", "contenido de a"],
      ["herramienta", "Bash", "ok"],
      // Un resultado sin su llamada (se pagino antes) se muestra igual: perderlo seria peor.
      ["herramienta", "Grep", "huerfano"],
      ["resultado", null, null],
    ],
  );
});

test("la entrada de una herramienta, resumida en una linea: el campo que dice que hace", () => {
  assert.equal(resumirEntrada('{"command":"npm test -- --watch=false","description":"x"}'), "npm test -- --watch=false");
  assert.equal(resumirEntrada('{"file_path":"src/a.mjs","content":"...mucho..."}'), "src/a.mjs");
  assert.equal(resumirEntrada('{"pattern":"TODO","path":"src"}'), "TODO");
  const largo = resumirEntrada(JSON.stringify({ otra: "x".repeat(400) }));
  assert.ok(largo.length <= 121, largo);
  assert.equal(resumirEntrada("texto plano"), "texto plano");
});

test("lo que llega en vivo se AÑADE a su fase, desde donde se pidio, sin duplicar", () => {
  const fase = (eventos, siguiente, extra = {}) => ({ fase: "GREEN", eventos, tokens: SIN_MEDIR, total: siguiente, desde: 0, siguiente, cortado: false, ...extra });
  const actual = {
    itemId: "9", tareaId: "T001", limite: 200, total: SIN_MEDIR,
    fases: [
      { ...fase([{ t: "1", tipo: "texto", contenido: "a" }], 1), fase: "RED" },
      fase([{ t: "2", tipo: "texto", contenido: "b" }], 1),
    ],
  };
  const nuevo = {
    itemId: "9", tareaId: "T001", limite: 200, total: medido(5, 5),
    fases: [fase([{ t: "3", tipo: "resultado", contenido: "c" }], 2, { desde: 1, tokens: medido(5, 5) })],
  };
  const fusionado = fusionarTranscript(actual, nuevo);
  const green = fusionado.fases.find((f) => claveDeFase(f) === "GREEN");
  assert.deepEqual(green.eventos.map((e) => e.contenido), ["b", "c"]);
  assert.equal(green.siguiente, 2);
  assert.deepEqual(green.tokens, medido(5, 5), "los tokens son los del servidor, no una suma local");
  assert.equal(fusionado.fases.length, 2, "la fase RED no se pierde por no venir en el tramo nuevo");

  // Lo mismo dos veces (dos eventos del canal seguidos): no se duplica.
  const otraVez = fusionarTranscript(fusionado, nuevo);
  assert.deepEqual(otraVez.fases.find((f) => claveDeFase(f) === "GREEN").eventos.map((e) => e.contenido), ["b", "c"]);

  // Una fase nueva (REVIEW con su lente) aparece.
  const conRevision = fusionarTranscript(otraVez, {
    ...nuevo,
    fases: [{ ...fase([{ t: "9", tipo: "texto", contenido: "miro" }], 1), fase: "REVIEW", lente: "seguridad" }],
  });
  assert.deepEqual(conRevision.fases.map(claveDeFase), ["RED", "GREEN", "REVIEW·seguridad"]);
});
