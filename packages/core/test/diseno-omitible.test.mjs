// T105 / FR-023 — la etapa de diseño es omitible sin penalizacion ni bloqueo.
//
// EL FALLO QUE EVITA. Un proyecto sin superficie visual —un motor, una libreria,
// un demonio— no tiene nada que diseñar. Una etapa obligatoria ahi produce una
// de dos cosas, las dos malas: el operador la rellena con cualquier cosa para
// poder avanzar, y el runtime acaba compilando contexto con un sistema de
// diseño inventado que aplica durante meses; o el operador se queda atascado y
// abandona el establecimiento a mitad.
//
// "Sin penalizacion" es literal y por eso se prueba: omitirla no deja el
// proyecto marcado como incompleto, no baja ningun indicador y no cambia lo que
// se puede hacer despues. Lo unico que deja es constancia de que se decidio.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  etapaDeDiseno,
  omitirDiseno,
  definirDiseno,
  repositorioEnMemoria,
  arbolEnMemoria,
} from "../src/index.mjs";

const AHORA = Date.parse("2026-09-20T10:00:00.000Z");

function montar() {
  const repositorio = repositorioEnMemoria();
  repositorio.guardarProyecto({ id: "prj_1", nombre: "motor", origen: "local", estado: "CONSTITUTED" });
  return { repositorio, arbol: arbolEnMemoria() };
}

test("la etapa arranca pendiente y ya entonces declara que no bloquea", () => {
  const { repositorio } = montar();
  const etapa = etapaDeDiseno(repositorio, "prj_1");
  assert.equal(etapa.estado, "pendiente");
  assert.equal(etapa.bloquea, false);
});

test("omitirla la deja omitida, sin bloquear y sin penalizacion", () => {
  const { repositorio } = montar();
  omitirDiseno({ project_id: "prj_1", motivo: "el proyecto no tiene superficie visual", repositorio, ahora: AHORA });

  const etapa = etapaDeDiseno(repositorio, "prj_1");
  assert.equal(etapa.estado, "omitida");
  assert.equal(etapa.bloquea, false);
  assert.equal(etapa.penalizacion, null, "omitir una etapa opcional no puede costar nada");
  assert.equal(etapa.motivo, "el proyecto no tiene superficie visual");
});

test("se puede omitir sin dar un motivo: exigirlo seria la penalizacion por otra via", () => {
  const { repositorio } = montar();
  const { registro } = omitirDiseno({ project_id: "prj_1", repositorio, ahora: AHORA });
  assert.equal(registro.motivo, null);
  assert.equal(etapaDeDiseno(repositorio, "prj_1").estado, "omitida");
  assert.equal(etapaDeDiseno(repositorio, "prj_1").bloquea, false);
});

test("la decision queda registrada con su instante: se omitio, no se olvido", () => {
  // La diferencia importa para la evolucion continua: una etapa que nadie miro
  // y una que alguien decidio saltarse se parecen en el estado y no se parecen
  // en nada mas.
  const { repositorio } = montar();
  omitirDiseno({ project_id: "prj_1", motivo: "sin superficie visual", repositorio, ahora: AHORA });
  const decisiones = repositorio.decisiones("prj_1");
  assert.equal(decisiones.length, 1);
  assert.equal(decisiones[0].etapa, "diseno");
  assert.equal(decisiones[0].decision, "omitida");
  assert.equal(decisiones[0].instante, new Date(AHORA).toISOString());
});

test("con el diseño omitido el proyecto avanza igual a BOOTSTRAPPED", () => {
  // Es la prueba de "sin bloqueo": la etapa siguiente no pregunta por el diseño.
  const { repositorio } = montar();
  omitirDiseno({ project_id: "prj_1", repositorio, ahora: AHORA });
  const proyecto = repositorio.transicionar("prj_1", "BOOTSTRAPPED", { recomendaciones: [] });
  assert.equal(proyecto.estado, "BOOTSTRAPPED");
});

test("omitirla no la cierra: se puede definir despues y queda definida", () => {
  const { repositorio, arbol } = montar();
  omitirDiseno({ project_id: "prj_1", repositorio, ahora: AHORA });
  definirDiseno({
    project_id: "prj_1",
    contenido: "# Diseño\n\nEscala de espaciado y tipografia.\n",
    reglas: [],
    arbol,
    repositorio,
    ruta_en_repo: "guidelines/diseno.md",
    ahora: AHORA,
  });

  const etapa = etapaDeDiseno(repositorio, "prj_1");
  assert.equal(etapa.estado, "definida");
  assert.equal(etapa.bloquea, false);
  assert.match(String(arbol.leer("guidelines/diseno.md")), /Escala de espaciado/);
});

test("la etapa nunca bloquea, en ninguno de sus tres estados", () => {
  // Es la afirmacion entera de FR-023 en una linea, y la que hay que romper
  // para comprobar que esta prueba no esta vacia.
  const { repositorio, arbol } = montar();
  assert.equal(etapaDeDiseno(repositorio, "prj_1").bloquea, false);
  omitirDiseno({ project_id: "prj_1", repositorio, ahora: AHORA });
  assert.equal(etapaDeDiseno(repositorio, "prj_1").bloquea, false);
  definirDiseno({
    project_id: "prj_1",
    contenido: "# Diseño\n",
    arbol,
    repositorio,
    ruta_en_repo: "guidelines/diseno.md",
    ahora: AHORA,
  });
  assert.equal(etapaDeDiseno(repositorio, "prj_1").bloquea, false);
});
