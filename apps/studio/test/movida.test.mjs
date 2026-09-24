// «Seguir aqui» o «Soltarla» sobre una tarjeta «movida» (spec 005, US1 esc. 4,
// FR-004), en el cliente: que botones ofrece el detalle y que le pide al
// servicio cada uno.
//
// POR QUE IMPORTA. Los dos botones hacen cosas que el operador no ve deshacerse
// solas: «Soltarla» saca la tarjeta del board. El texto tiene que decir ADONDE
// fue la issue y que ni Linear ni el run se tocan, o el operador cree que la
// esta borrando. Y la peticion tiene que ir al proyecto de la TARJETA (en
// «Todos» hay varios) con el id del ticket, no con el `id` compuesto.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runsActivos } from "../components/board/derivar.ts";
import { decisionesDeMovida, esMovida } from "../components/board/movida.ts";
import { RUTAS_DE_MOVIDAS, pedidoDeDecision } from "../lib/daemon.ts";

const tarjeta = (extra = {}) => ({
  id: "prj-1:iss-9",
  proyecto: { id: "prj-1", nombre: "Plataforma" },
  ticket: { id: "iss-9", key: "ENG-124", titulo: "t" },
  columna: "in_progress",
  chip: { tipo: "movida", texto: "Movida · Pagos", detalle: "…", posicion: null, destino: "Pagos" },
  movida: { destino: "Pagos", detalle: "…" },
  avance: null,
  accion: { tipo: "open_run", habilitada: true, motivo: null },
  run: { itemId: "iss-9", estado: "corriendo", pr: null },
  tieneRepo: true,
  ...extra,
});

test("una tarjeta sin `movida` no ofrece nada", () => {
  const normal = tarjeta({ chip: { tipo: "fase", texto: "Fase 1/3", detalle: null }, movida: undefined });
  assert.equal(esMovida(normal), false);
  assert.deepEqual(decisionesDeMovida(normal), []);
});

test("una movida ofrece las dos, en este orden, y las dos dicen el destino", () => {
  const [seguir, soltar] = decisionesDeMovida(tarjeta());
  assert.equal(seguir.decision, "seguir");
  assert.equal(seguir.etiqueta, "Seguir aqui");
  assert.match(seguir.explicacion, /Plataforma/, "seguir dice en que board se queda");
  assert.match(seguir.explicacion, /Pagos/);
  assert.equal(soltar.decision, "soltar");
  assert.equal(soltar.etiqueta, "Soltarla");
  assert.match(soltar.explicacion, /Pagos/);
  assert.match(soltar.explicacion, /Linear|gestor/, "soltar dice que el gestor no se toca");
  assert.match(soltar.explicacion, /run/, "soltar dice que el run no se toca");
});

test("sin destino (el gestor no lo dijo), no se inventa uno", () => {
  const sin = tarjeta({ movida: { destino: null, detalle: "…" }, chip: { tipo: "movida", texto: "Movida", detalle: "…", destino: null } });
  for (const d of decisionesDeMovida(sin)) assert.doesNotMatch(d.explicacion, /null|undefined|«»/);
});

test("la peticion va al proyecto de la tarjeta con el id del ticket, y lleva el destino que se vio", () => {
  const p = pedidoDeDecision(tarjeta(), "soltar");
  assert.equal(p.ruta, "/v1/projects/prj-1/board/movidas/iss-9");
  assert.equal(p.ruta, RUTAS_DE_MOVIDAS.decision("prj-1", "iss-9"));
  assert.deepEqual(p.cuerpo, { decision: "soltar", destino: "Pagos" });
  assert.equal(RUTAS_DE_MOVIDAS.decision("a b", "x/y"), "/v1/projects/a%20b/board/movidas/x%2Fy");
});

test("una movida sigue en «Runs activos»: es un run vivo que pide una decision, antes que lo que solo corre", () => {
  const corriendo = tarjeta({ id: "prj-1:a", chip: { tipo: "fase", texto: "Fase 1/3", detalle: null }, movida: undefined });
  const movida = tarjeta({ id: "prj-1:b" });
  assert.deepEqual(runsActivos([corriendo, movida]).map((t) => t.id), ["prj-1:b", "prj-1:a"]);
});
