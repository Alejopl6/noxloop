// T104 / FR-021 — guidelines por area, versionadas junto al codigo, con lo que
// el runtime puede verificar separado de lo que solo puede leer.
//
// POR QUE LA SEPARACION ES EL PUNTO Y NO UN DETALLE. Es la diferencia que el
// producto declara entre constitution y guidelines: la constitution son
// invariantes que se discuten entre personas; las guidelines son documentacion
// que ADEMAS lleva reglas que una maquina puede comprobar. Si todo entra en el
// mismo saco, el runtime acaba "aplicando" parrafos —es decir, pidiendole a un
// modelo que decida si un texto se cumplio— y eso es el verde inventado del
// principio II con otro disfraz: una afirmacion sin exit code detras.
//
// Y por eso una regla que se declara verificable sin una comprobacion mecanica
// no se filtra en silencio: se degrada a documentacion CON su motivo. Filtrar
// en silencio es inventar contexto hacia quien escribio la regla, que se queda
// creyendo que el runtime la vigila.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AREAS,
  COMPROBACIONES,
  crearGuideline,
  guardarGuideline,
  rutaDeGuideline,
  arbolEnMemoria,
  repositorioEnMemoria,
} from "../src/index.mjs";

const AHORA = Date.parse("2026-09-20T10:00:00.000Z");

const REGLA_DE_COMANDO = {
  id: "tests-en-verde",
  enunciado: "La suite entera pasa antes de abrir un PR",
  comprobacion: { tipo: "comando", comando: "npm test" },
};

/** @param {any[]} reglas */
const guideline = (reglas, area = "testing") =>
  crearGuideline({ project_id: "prj_1", area, contenido: "# Testing\n\nLo que hacemos aqui.\n", reglas, ahora: AHORA });

test("las siete areas del modelo se aceptan y ninguna otra", () => {
  assert.deepEqual([...AREAS], ["frontend", "backend", "testing", "git", "seguridad", "agentes", "diseno"]);
  for (const area of AREAS) assert.equal(guideline([], area).area, area);

  assert.throws(
    () => guideline([], "infra"),
    (/** @type {any} */ e) => e.codigo === "area_desconocida" && AREAS.every((a) => e.causa.includes(a)),
  );
});

test("una regla con comprobacion mecanica entra en las aplicables por el runtime", () => {
  const g = guideline([REGLA_DE_COMANDO]);
  assert.equal(g.reglas_aplicables.length, 1);
  assert.equal(g.reglas_aplicables[0].id, "tests-en-verde");
  assert.equal(g.reglas_aplicables[0].comprobacion.tipo, "comando");
  assert.equal(g.documentacion.length, 0);
});

test("una regla sin comprobacion no se tira: baja a documentacion con el motivo", () => {
  const g = guideline([{ id: "legible", enunciado: "El codigo se escribe para leerse" }]);
  assert.equal(g.reglas_aplicables.length, 0, "una regla sin comprobacion no la puede verificar el runtime");
  assert.equal(g.documentacion.length, 1, "la regla desaparecio en silencio");
  assert.match(g.documentacion[0].motivo, /comprobacion/i);
  assert.equal(g.documentacion[0].enunciado, "El codigo se escribe para leerse");
});

test("una comprobacion de un tipo que no existe se degrada nombrando los tipos que si", () => {
  const g = guideline([{ id: "x", enunciado: "Algo", comprobacion: { tipo: "revision_humana" } }]);
  assert.equal(g.reglas_aplicables.length, 0);
  for (const tipo of COMPROBACIONES) assert.ok(g.documentacion[0].motivo.includes(tipo));
});

test("una comprobacion de comando sin comando no es una comprobacion: el criterio es un exit code", () => {
  // "corre los tests" no es un criterio: es una intencion. Sin el comando
  // exacto no hay exit code que mirar, y sin exit code la regla se verifica
  // preguntandole a un modelo si le parece que se cumplio.
  const g = guideline([{ id: "y", enunciado: "Corre los tests", comprobacion: { tipo: "comando" } }]);
  assert.equal(g.reglas_aplicables.length, 0);
  assert.match(g.documentacion[0].motivo, /comando/);
});

test("una comprobacion de contenido sin patron tampoco pasa", () => {
  const g = guideline([{ id: "z", enunciado: "El README explica el arranque", comprobacion: { tipo: "contenido_coincide", ruta: "README.md" } }]);
  assert.equal(g.reglas_aplicables.length, 0);
  assert.match(g.documentacion[0].motivo, /patron/);
});

test("el documento renderizado lleva las dos partes, y las reglas se pueden volver a leer de el", () => {
  const g = guideline([REGLA_DE_COMANDO, { id: "legible", enunciado: "El codigo se escribe para leerse" }]);
  assert.match(g.documento, /La suite entera pasa antes de abrir un PR/);
  assert.match(g.documento, /npm test/, "la comprobacion no viaja en el documento y el runtime no la puede correr");
  assert.match(g.documento, /El codigo se escribe para leerse/);
  assert.match(g.documento, /no la verifica el runtime|documentacion/i);
});

test("la ruta cuelga de donde vive la constitution: las guidelines se versionan al lado del codigo", () => {
  assert.equal(rutaDeGuideline("testing", ".specify/memory/constitution.md"), ".specify/memory/guidelines/testing.md");
  assert.equal(rutaDeGuideline("git", "CONSTITUTION.md"), "guidelines/git.md");
});

test("guardar escribe en el arbol del proyecto y deja la guideline en el almacen", () => {
  const arbol = arbolEnMemoria();
  const repositorio = repositorioEnMemoria();
  const g = guideline([REGLA_DE_COMANDO]);
  const { escrituras } = guardarGuideline({ guideline: g, arbol, repositorio, ruta_en_repo: "guidelines/testing.md" });

  assert.deepEqual(escrituras, ["guidelines/testing.md"]);
  assert.match(String(arbol.leer("guidelines/testing.md")), /La suite entera pasa/);
  assert.equal(repositorio.guideline("prj_1", "testing").reglas_aplicables.length, 1);
});

test("dos areas distintas no se pisan en el almacen", () => {
  const arbol = arbolEnMemoria();
  const repositorio = repositorioEnMemoria();
  for (const area of ["testing", "git"]) {
    guardarGuideline({
      guideline: guideline([], area),
      arbol,
      repositorio,
      ruta_en_repo: `guidelines/${area}.md`,
    });
  }
  assert.equal(repositorio.guidelines("prj_1").length, 2);
  assert.ok(repositorio.guideline("prj_1", "git"));
});

test("un contenido vacio con reglas vale: la guideline puede ser solo reglas", () => {
  // No es lo mismo que una constitution en blanco. Una guideline de `git` que
  // sea solo "los commits siguen este formato, y aqui esta el comando que lo
  // comprueba" es exactamente lo que el runtime necesita.
  const g = crearGuideline({ project_id: "prj_1", area: "git", contenido: "", reglas: [REGLA_DE_COMANDO], ahora: AHORA });
  assert.equal(g.reglas_aplicables.length, 1);
  assert.match(g.documento, /npm test/);
});
