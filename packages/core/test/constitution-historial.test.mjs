// T101 / FR-022 — historial de enmiendas con la version anterior recuperable.
//
// EL FALLO QUE EVITA. Una constitution que se sobreescribe deja al proyecto sin
// forma de contestar la unica pregunta que importa cuando una regla molesta:
// "por que esta esto aqui". Sin la version anterior guardada, revisar una
// decision cuesta leer el historial de git a mano —si es que el archivo llego a
// commitearse— y en la practica nadie lo hace: la regla se acata o se ignora,
// pero no se discute.

import { test } from "node:test";
import assert from "node:assert/strict";

import { crearConstitution, enmendar, repositorioEnMemoria, registrarEnmienda, recuperarVersion } from "../src/index.mjs";

const AHORA = Date.parse("2026-09-20T10:00:00.000Z");
const DESPUES = Date.parse("2026-10-01T10:00:00.000Z");

const TRES_CAMPOS = {
  principio: "El estado del run vive en disco",
  fallo_que_motiva: "una compactacion de contexto borro la tarea activa y el recorrido volvio a empezar de cero",
  que_se_rompe_si_no: "un recorrido deja de ser retomable y cada corte cuesta el trabajo entero",
};

function conRepositorio() {
  const repositorio = repositorioEnMemoria();
  repositorio.guardarProyecto({ id: "prj_1", nombre: "proyecto", origen: "local", estado: "DISCOVERED" });
  const primera = crearConstitution({
    project_id: "prj_1",
    contenido: "# Constitution\n\n### I. Primero\n\n**Version**: 1.0.0 | **Ratified**: 2026-09-20 | **Last Amended**: 2026-09-20\n",
    ruta_en_repo: "CONSTITUTION.md",
    ahora: AHORA,
  });
  repositorio.guardarConstitution(primera);
  return { repositorio, primera };
}

test("la version sube segun el tipo de cambio declarado, no segun lo que escriba quien enmienda", () => {
  const { primera } = conRepositorio();
  const menor = enmendar(primera, { ...TRES_CAMPOS, tipo_de_cambio: "principio_nuevo" }, { ahora: AHORA });
  assert.equal(menor.constitution.version, "1.1.0");

  const mayor = enmendar(primera, { ...TRES_CAMPOS, tipo_de_cambio: "principio_retirado" }, { ahora: AHORA });
  assert.equal(mayor.constitution.version, "2.0.0");

  const parche = enmendar(primera, { ...TRES_CAMPOS, tipo_de_cambio: "aclaracion" }, { ahora: AHORA });
  assert.equal(parche.constitution.version, "1.0.1");
});

test("un tipo de cambio desconocido se rechaza en vez de caer en un default silencioso", () => {
  const { primera } = conRepositorio();
  assert.throws(
    () => enmendar(primera, { ...TRES_CAMPOS, tipo_de_cambio: "mejora" }, { ahora: AHORA }),
    (/** @type {any} */ e) => e.codigo === "tipo_de_cambio_desconocido" && e.accion.length > 20,
  );
});

test("despues de enmendar hay una sola constitution vigente y la anterior sigue recuperable", () => {
  const { repositorio, primera } = conRepositorio();
  const { constitution, enmienda } = enmendar(
    primera,
    { ...TRES_CAMPOS, contenido: "# Constitution\n\n### I. Primero\n\n### II. Segundo\n" },
    { ahora: DESPUES },
  );
  registrarEnmienda(repositorio, { anterior: primera, constitution, enmienda });

  const vigentes = repositorio.constituciones("prj_1").filter((/** @type {any} */ c) => c.vigente);
  assert.equal(vigentes.length, 1, "quedo mas de una constitution vigente");
  assert.equal(vigentes[0].version, "1.1.0");

  const anterior = recuperarVersion(repositorio, "prj_1", "1.0.0");
  assert.ok(anterior, "la version anterior no es recuperable (FR-022)");
  assert.equal(anterior.contenido, primera.contenido, "la version anterior se recupero con el contenido nuevo");
  assert.equal(anterior.vigente, false);
});

test("el historial trae cada enmienda con sus tres campos y su fecha, en orden", () => {
  const { repositorio, primera } = conRepositorio();
  const uno = enmendar(primera, TRES_CAMPOS, { ahora: AHORA });
  registrarEnmienda(repositorio, { anterior: primera, constitution: uno.constitution, enmienda: uno.enmienda });

  const dos = enmendar(
    uno.constitution,
    {
      principio: "La autonomia termina en el PR abierto",
      fallo_que_motiva: "un recorrido mergeo a la rama protegida sin revision humana el 3 de agosto",
      que_se_rompe_si_no: "el producto pasa de abrir pull requests a integrarlos, que es otro producto",
    },
    { ahora: DESPUES },
  );
  registrarEnmienda(repositorio, { anterior: uno.constitution, constitution: dos.constitution, enmienda: dos.enmienda });

  const historial = repositorio.enmiendas("prj_1");
  assert.equal(historial.length, 2);
  assert.deepEqual(
    historial.map((/** @type {any} */ a) => [a.version_anterior, a.version_nueva]),
    [["1.0.0", "1.1.0"], ["1.1.0", "1.2.0"]],
  );
  assert.ok(historial.every((/** @type {any} */ a) => a.fallo_que_motiva.length > 20));

  // Y las dos versiones anteriores siguen ahi: recuperable no es "la ultima".
  assert.ok(recuperarVersion(repositorio, "prj_1", "1.0.0"));
  assert.ok(recuperarVersion(repositorio, "prj_1", "1.1.0"));
  assert.equal(recuperarVersion(repositorio, "prj_1", "9.9.9"), null);
});

test("el pie del documento queda sellado con la version que la enmienda produjo", () => {
  // EL FALLO QUE EVITA: el archivo dice 1.0.0 y el almacen dice 1.1.0. Quien
  // lee el repositorio —una persona o el runtime— se cree el archivo, porque es
  // lo unico que viaja con el codigo.
  const { primera } = conRepositorio();
  const { constitution } = enmendar(primera, TRES_CAMPOS, { ahora: DESPUES });
  assert.match(constitution.contenido, /\*\*Version\*\*: 1\.1\.0/);
  assert.match(constitution.contenido, /\*\*Last Amended\*\*: 2026-10-01/);
  assert.match(constitution.contenido, /\*\*Ratified\*\*: 2026-09-20/, "la ratificacion original se perdio");
});
