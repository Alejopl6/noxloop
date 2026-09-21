// T112 — `aplicar` no recalcula: aplica lo que el operador vio. Si el arbol
// cambio desde que se calculo el diff, falla con `diff_obsoleto`.
//
// EL FALLO QUE EVITA, Y POR QUE NO TIENE SEGUNDA OPORTUNIDAD. Aplicar algo
// distinto de lo mostrado es exactamente como se pierde la confianza en un
// instalador. El operador revisa un diff, aprueba, y lo que se escribe es otra
// cosa —porque entre la revision y el click alguien toco el archivo, o porque
// el generador volvio a correr con otro estado—. La siguiente vez no revisa el
// diff: o lo aplica todo a ciegas, o no lo aplica nunca. Las dos son peores que
// no tener la funcion.
//
// POR QUE LA GARANTIA ES ESTRUCTURAL Y NO UNA PROMESA. `aplicar` recibe la
// recomendacion, el arbol y el almacen. NO recibe el catalogo, ni el snapshot,
// ni el generador. No es que se abstenga de recalcular: es que no tiene con
// que. Esta prueba lo comprueba cambiando el catalogo despues de analizar y
// exigiendo que lo escrito sea lo de antes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { analizar, aplicar, arbolEnMemoria, repositorioEnMemoria } from "../src/index.mjs";
import { hueco, snapshotDe, MOTIVO_LARGO } from "./ayuda.mjs";

const AHORA = Date.parse("2026-09-20T10:00:00.000Z");
const DESPUES = AHORA + 60_000;

const SNAPSHOT = snapshotDe([hueco("agentes.instrucciones", MOTIVO_LARGO, [])]);

/** @param {string} contenido */
const catalogo = (contenido) => [
  {
    id: "entrada",
    tipo: "instrucciones",
    capacidad: "instrucciones_de_agente",
    titulo: "Instrucciones de agente",
    justificacion: "el proyecto no le dice nada a ningun agente",
    efectos: [],
    cambios: () => ({ cambios: [{ ruta: "AGENTS.md", contenido }] }),
  },
];

function montar(inicial = {}, contenido = "# Lo que el operador aprobo\n") {
  const arbol = arbolEnMemoria(inicial);
  const repositorio = repositorioEnMemoria();
  const salida = analizar({
    snapshot: SNAPSHOT,
    arbol,
    catalogo: catalogo(contenido),
    project_id: "prj_1",
    ahora: AHORA,
    repositorio,
  });
  return { arbol, repositorio, recomendacion: salida.recomendaciones[0] };
}

test("aplicar escribe exactamente los bytes del diff que se mostro", () => {
  const { arbol, repositorio, recomendacion } = montar();
  const { escrituras } = aplicar(recomendacion, { arbol, repositorio, ahora: DESPUES });
  assert.deepEqual(escrituras, ["AGENTS.md"]);
  assert.equal(arbol.leer("AGENTS.md"), recomendacion.cambios[0].contenido);
});

test("aunque el generador cambie de opinion, se escribe lo que se aprobo", () => {
  // Es la prueba de que no recalcula: entre analizar y aplicar, el catalogo
  // pasa a producir otro contenido. `aplicar` no lo puede ver siquiera.
  const { arbol, repositorio, recomendacion } = montar({}, "# La version aprobada\n");
  // El catalogo nuevo existe y produce otra cosa; `aplicar` no lo recibe.
  catalogo("# Una version distinta\n");
  aplicar(recomendacion, { arbol, repositorio, ahora: DESPUES });
  assert.equal(arbol.leer("AGENTS.md"), "# La version aprobada\n");
});

test("si el arbol cambio desde que se calculo el diff, aplicar falla y pide recalcular", () => {
  const { arbol, repositorio, recomendacion } = montar({ "AGENTS.md": "lo que habia\n" });
  arbol.escribir("AGENTS.md", "lo que alguien puso despues\n");

  let error = null;
  try {
    aplicar(recomendacion, { arbol, repositorio, ahora: DESPUES });
  } catch (e) {
    error = /** @type {any} */ (e);
  }
  assert.ok(error, "se aplico encima de un cambio que nadie vio");
  assert.equal(error.codigo, "diff_obsoleto");
  assert.equal(error.estado, 409);
  assert.match(error.causa, /AGENTS\.md/);
  assert.match(error.accion, /analisis|recalcul/i);
  assert.equal(arbol.leer("AGENTS.md"), "lo que alguien puso despues\n", "se escribio igual despues de fallar");
});

test("un archivo que aparecio entre el analisis y la aplicacion tambien es diff obsoleto", () => {
  // El diff decia `crear`. Si el archivo ya existe, crearlo es pisarlo, y el
  // operador aprobo una creacion sobre un hueco.
  const { arbol, repositorio, recomendacion } = montar();
  arbol.escribir("AGENTS.md", "alguien lo escribio a mano mientras tanto\n");
  assert.throws(
    () => aplicar(recomendacion, { arbol, repositorio, ahora: DESPUES }),
    (/** @type {any} */ e) => e.codigo === "diff_obsoleto",
  );
});

test("aplicar dos veces es idempotente: la segunda no falla ni reescribe", () => {
  // El contrato lo exige. Y tiene sentido: el estado final es el que el
  // operador aprobo, que es justo lo que ya hay.
  const { arbol, repositorio, recomendacion } = montar();
  const primera = aplicar(recomendacion, { arbol, repositorio, ahora: DESPUES });
  const segunda = aplicar(primera.recomendacion, { arbol, repositorio, ahora: DESPUES + 1 });
  assert.equal(segunda.sin_cambios, true);
  assert.deepEqual(segunda.escrituras, []);
  assert.equal(arbol.leer("AGENTS.md"), recomendacion.cambios[0].contenido);
});

test("recalcular despues del fallo produce un diff nuevo que si se puede aplicar", () => {
  // La accion que el error nombra tiene que llevar a algun sitio: si vuelves a
  // analizar, el diff sale contra el arbol de ahora y aplica.
  const arbol = arbolEnMemoria({ "AGENTS.md": "lo que habia\n" });
  const repositorio = repositorioEnMemoria();
  const viejo = analizar({
    snapshot: SNAPSHOT,
    arbol,
    catalogo: catalogo("# aprobado\n"),
    project_id: "prj_1",
    ahora: AHORA,
    repositorio,
  }).recomendaciones[0];

  arbol.escribir("AGENTS.md", "otra cosa\n");
  assert.throws(() => aplicar(viejo, { arbol, repositorio, ahora: DESPUES }));

  const nuevo = analizar({
    snapshot: SNAPSHOT,
    arbol,
    catalogo: catalogo("# aprobado\n"),
    project_id: "prj_1",
    ahora: DESPUES,
    repositorio,
  }).recomendaciones[0];
  aplicar(nuevo, { arbol, repositorio, ahora: DESPUES + 1 });
  assert.equal(arbol.leer("AGENTS.md"), "# aprobado\n");
});
