// T100 — la enmienda exige `principio`, `fallo_que_motiva` y `que_se_rompe_si_no`.
//
// EL FALLO QUE EVITA, Y POR QUE NO ES VALIDACION DE FORMULARIO. La constitution
// de este repositorio dice, en su seccion de gobernanza: "Una enmienda sin un
// fallo detras no es una enmienda: es una preferencia". Es la regla con la que
// se gobierna este proyecto, y el producto la impone a los proyectos de otros.
//
// Lo que pasa sin esto ya se ha visto en repositorios con guias de estilo: la
// regla entra porque a alguien le parecio mejor, nadie recuerda por que, y seis
// meses despues nadie se atreve a quitarla porque tampoco sabe que se rompe si
// la quita. El campo obligatorio no es burocracia: es lo unico que hace que una
// regla se pueda retirar cuando el fallo que la motivaba deja de existir.
//
// El 400 del contrato (`POST /constitution/amend`) sale de aqui: el dominio
// rechaza, y el servicio traduce el codigo a su estado HTTP.

import { test } from "node:test";
import assert from "node:assert/strict";

import { crearConstitution, enmendar, CAMPOS_DE_ENMIENDA } from "../src/index.mjs";
import { ErrorDeNucleo } from "../src/errores.mjs";

const AHORA = Date.parse("2026-09-20T10:00:00.000Z");

const vigente = () =>
  crearConstitution({
    project_id: "prj_1",
    contenido: "# Constitution\n\n### I. El test primero\n",
    ruta_en_repo: "CONSTITUTION.md",
    ahora: AHORA,
  });

/**
 * @param {object} datos
 * @returns {ErrorDeNucleo}
 */
function rechazo(datos) {
  try {
    enmendar(vigente(), datos, { ahora: AHORA });
  } catch (e) {
    return /** @type {ErrorDeNucleo} */ (e);
  }
  throw new Error("la enmienda se acepto y tenia que rechazarse");
}

test("una enmienda sin ninguno de los tres campos se rechaza nombrando los tres", () => {
  const e = rechazo({});
  assert.equal(e.codigo, "enmienda_incompleta");
  assert.equal(e.estado, 400, "el contrato dice 400, no 422 ni 409");
  for (const campo of CAMPOS_DE_ENMIENDA) {
    assert.ok(e.causa.includes(campo), `la causa no nombra \`${campo}\`: ${e.causa}`);
  }
});

test("la causa cita la regla que la motiva, no una etiqueta de formulario", () => {
  // Un "campo requerido" se lee como un obstaculo y se rellena con cualquier
  // cosa. La frase de la constitution explica por que el campo existe, que es
  // lo unico que hace que alguien lo escriba de verdad.
  const e = rechazo({ principio: "Tests primero" });
  assert.match(e.causa, /no es una enmienda: es una preferencia/);
  assert.ok(e.accion.length > 20, "un error sin accion concreta no pasa revision (NFR-006)");
});

test("falta uno solo de los tres y se rechaza nombrando exactamente ese", () => {
  const e = rechazo({
    principio: "El revisor no comparte runtime con el implementador",
    que_se_rompe_si_no: "un revisor con el mismo modelo aprueba su propio razonamiento y nadie lo ve",
  });
  assert.equal(e.codigo, "enmienda_incompleta");
  assert.ok(e.causa.includes("fallo_que_motiva"));
  assert.ok(!e.causa.includes("que_se_rompe_si_no"), `nombra un campo que si venia: ${e.causa}`);
});

test("un campo en blanco no cuenta como presente", () => {
  const e = rechazo({
    principio: "Tests primero",
    fallo_que_motiva: "   ",
    que_se_rompe_si_no: "la disciplina se cae en la tercera iteracion y nadie lo nota hasta el merge",
  });
  assert.equal(e.codigo, "enmienda_incompleta");
  assert.ok(e.causa.includes("fallo_que_motiva"));
});

test("un fallo escrito para salir del paso se rechaza diciendo que se espera", () => {
  // `porque si` cumple "el campo no esta vacio" y no cumple nada de lo que el
  // campo existe para conseguir. Es la grafia con la que un obligatorio se
  // convierte en un tramite.
  const e = rechazo({
    principio: "Tests primero",
    fallo_que_motiva: "porque si",
    que_se_rompe_si_no: "se rompe la disciplina de tests y los rojos dejan de verse antes del merge",
  });
  assert.equal(e.codigo, "enmienda_incompleta");
  assert.match(e.causa, /fallo_que_motiva/);
  assert.match(e.causa, /concreto|medid|observ/i, `la causa no dice que se espera del campo: ${e.causa}`);
});

test("con los tres campos la enmienda se registra con fecha y con la version anterior", () => {
  const { constitution, enmienda } = enmendar(
    vigente(),
    {
      principio: "El revisor no comparte runtime con el implementador",
      fallo_que_motiva:
        "en el recorrido del 12 de septiembre el revisor heredo el transcript del implementador y aprobo su " +
        "propio razonamiento en las tres tareas",
      que_se_rompe_si_no: "la revision deja de ser una segunda opinion y se convierte en una firma",
    },
    { ahora: AHORA },
  );

  assert.equal(enmienda.version_anterior, "1.0.0");
  assert.equal(enmienda.version_nueva, constitution.version);
  assert.equal(enmienda.fecha, new Date(AHORA).toISOString());
  assert.equal(enmienda.constitution_id, constitution.id);
  for (const campo of CAMPOS_DE_ENMIENDA) {
    assert.ok(String(enmienda[campo]).length > 0, `la enmienda perdio \`${campo}\``);
  }
});

test("la enmienda no se puede fabricar saltandose el constructor: el objeto que sale esta congelado", () => {
  // Una enmienda mutable es una enmienda que se puede vaciar despues de pasar
  // la validacion, y entonces la validacion no garantiza nada.
  const { enmienda } = enmendar(
    vigente(),
    {
      principio: "Sin dependencias en el camino critico",
      fallo_que_motiva: "el runner murio en la maquina del operador porque faltaba un paquete del registro",
      que_se_rompe_si_no: "el producto deja de arrancar sin conexion, que es la mitad de su promesa",
    },
    { ahora: AHORA },
  );
  assert.throws(() => {
    // @ts-expect-error se escribe a proposito sobre un objeto congelado
    enmienda.fallo_que_motiva = "";
  });
});
