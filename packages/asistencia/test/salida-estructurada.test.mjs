// La salida es estructurada y se VALIDA aqui, no solo en el proveedor.
//
// POR QUE SE VUELVE A VALIDAR LO QUE `generateObject` YA VALIDO. Porque
// `generateObject` es UNA de las implementaciones del proveedor, y la garantia
// tiene que valer para todas — incluido el proveedor falso de estas pruebas, y
// incluido el dia que alguien cablee otro. Una comprobacion que solo existe
// dentro de la dependencia se evapora cuando la dependencia cambia, y lo hace
// en silencio: lo que llega es un objeto con la forma equivocada, y el primer
// sitio donde se nota es la pantalla.
//
// POR QUE ESTRUCTURADA Y NO TEXTO LIBRE. Una sugerencia en prosa hay que
// leerla para saber si trae lo que hacia falta; una sugerencia que no encaja en
// su esquema se detecta sin leer nada. La diferencia es que la segunda falla
// ruidosamente y la primera falla en silencio, con aspecto de respuesta buena.

import { test } from "node:test";
import assert from "node:assert/strict";

import { crearAsistencia, TAREAS } from "../src/index.mjs";
import { proveedorFijo, proveedorQueFalla, snapshotDePrueba } from "./ayuda.mjs";

const FORMAS = ["comando", "archivo_existe", "archivo_ausente", "contenido_coincide", "ruta_prohibida"];
const OPCIONES = { area: "testing", formas_de_comprobacion: FORMAS };

/** @param {any} proveedor */
const conProveedor = (proveedor) => crearAsistencia({ proveedor });

test("cada tarea declara su esquema, y el esquema viaja al proveedor", async () => {
  // Si el esquema no llegara, `generateObject` no tendria contra que restringir
  // y la salida volveria a ser texto libre con forma de objeto.
  const proveedor = proveedorFijo({
    borrador: "x",
    se_apoya_en: ["testing.runner"],
    reglas: [
      { enunciado: "e", comprobacion: { tipo: "comando", comando: "npm test" }, se_apoya_en: ["testing.runner"] },
    ],
  });
  const asistencia = conProveedor(proveedor);
  await asistencia.sugerir({ tarea: "guideline", snapshot: snapshotDePrueba(), opciones: OPCIONES });

  assert.equal(proveedor.llamadas.length, 1);
  const peticion = proveedor.llamadas[0];
  assert.equal(peticion.esquema.type, "object");
  assert.ok(peticion.esquema.properties.reglas, "el esquema que viajo no declara `reglas`");
  assert.equal(peticion.esquema.additionalProperties, false, "un esquema abierto no restringe nada");
  assert.ok(peticion.instruccion.includes("testing.runner"), "el insumo no llevaba los hallazgos del snapshot");
});

test("un objeto que no encaja en el esquema se rechaza diciendo QUE campo no encaja", async () => {
  const asistencia = conProveedor(proveedorFijo({ borrador: "x", reglas: "esto no es una lista" }));
  await assert.rejects(
    () => asistencia.sugerir({ tarea: "guideline", snapshot: snapshotDePrueba(), opciones: OPCIONES }),
    (/** @type {any} */ e) => {
      assert.equal(e.codigo, "salida_no_encaja");
      assert.match(e.causa, /reglas/);
      assert.ok(e.accion.length > 20);
      return true;
    },
  );
});

test("un campo obligatorio que falta se rechaza: la mitad de una sugerencia no es media sugerencia", async () => {
  const asistencia = conProveedor(
    proveedorFijo({
      borrador: "x",
      se_apoya_en: ["testing.runner"],
      reglas: [{ enunciado: "e", se_apoya_en: ["testing.runner"] }],
    }),
  );
  await assert.rejects(
    () => asistencia.sugerir({ tarea: "guideline", snapshot: snapshotDePrueba(), opciones: OPCIONES }),
    (/** @type {any} */ e) => {
      assert.equal(e.codigo, "salida_no_encaja");
      assert.match(e.causa, /comprobacion/);
      return true;
    },
  );
});

test("una forma de comprobacion que el runtime no sabe correr se rechaza, y el error dice cuales hay", async () => {
  // La lista de formas la trae quien llama —es de `packages/core`, no de aqui—
  // justamente para que no haya dos listas que se separen. Un `tipo` inventado
  // por el modelo produciria una regla que la pantalla enseña como verificable
  // y que ningun runtime puede correr.
  const asistencia = conProveedor(
    proveedorFijo({
      borrador: "x",
      se_apoya_en: ["testing.runner"],
      reglas: [
        {
          enunciado: "e",
          comprobacion: { tipo: "el_modelo_opina", comando: "pregunta si esta bien" },
          se_apoya_en: ["testing.runner"],
        },
      ],
    }),
  );
  await assert.rejects(
    () => asistencia.sugerir({ tarea: "guideline", snapshot: snapshotDePrueba(), opciones: OPCIONES }),
    (/** @type {any} */ e) => {
      assert.equal(e.codigo, "salida_no_encaja");
      assert.match(e.causa, /el_modelo_opina/);
      assert.match(e.accion, /archivo_existe/, "el error no dice cuales son las formas que si valen");
      return true;
    },
  );
});

test("sin la lista de formas no se sugiere una guideline: inventarla aqui la separa de la del nucleo", async () => {
  const asistencia = conProveedor(proveedorFijo({ borrador: "x", reglas: [] }));
  await assert.rejects(
    () => asistencia.sugerir({ tarea: "guideline", snapshot: snapshotDePrueba(), opciones: { area: "testing" } }),
    (/** @type {any} */ e) => {
      assert.equal(e.codigo, "insumo_incompleto");
      assert.match(e.causa, /formas_de_comprobacion/);
      return true;
    },
  );
});

test("una tarea que no existe se rechaza nombrando las que si", async () => {
  const asistencia = conProveedor(proveedorFijo({}));
  await assert.rejects(
    () => asistencia.sugerir({ tarea: "adivina", snapshot: snapshotDePrueba(), opciones: {} }),
    (/** @type {any} */ e) => {
      assert.equal(e.codigo, "tarea_desconocida");
      for (const t of TAREAS) assert.match(e.accion, new RegExp(t.clave));
      return true;
    },
  );
});

test("un snapshot sin hallazgos no se manda al modelo: no hay de que sugerir", async () => {
  // El principio X aplicado a la entrada. Con un snapshot vacio, lo que el
  // modelo devolveria seria un borrador sobre proyectos en general — texto
  // razonable sobre un proyecto que no es este.
  const proveedor = proveedorFijo({ borrador: "x", reglas: [] });
  const asistencia = conProveedor(proveedor);
  await assert.rejects(
    () => asistencia.sugerir({ tarea: "guideline", snapshot: { id: "s", hallazgos: [] }, opciones: OPCIONES }),
    (/** @type {any} */ e) => {
      assert.equal(e.codigo, "insumo_incompleto");
      assert.match(e.causa, /hallazgo/);
      return true;
    },
  );
  assert.equal(proveedor.llamadas.length, 0, "se llamo al proveedor con un snapshot vacio");
});

test("un area sin ningun hallazgo que la toque se dice, en vez de sugerirse a ciegas", async () => {
  const proveedor = proveedorFijo({ borrador: "x", reglas: [] });
  const asistencia = conProveedor(proveedor);
  await assert.rejects(
    () =>
      asistencia.sugerir({
        tarea: "guideline",
        snapshot: snapshotDePrueba(),
        opciones: { area: "frontend", formas_de_comprobacion: FORMAS },
      }),
    (/** @type {any} */ e) => {
      assert.equal(e.codigo, "insumo_incompleto");
      assert.match(e.causa, /frontend/);
      assert.ok(e.accion.length > 20);
      return true;
    },
  );
  assert.equal(proveedor.llamadas.length, 0);
});

test("un proveedor que revienta sale con causa y accion, no con la excepcion cruda", async () => {
  const asistencia = conProveedor(proveedorQueFalla("socket hang up"));
  await assert.rejects(
    () => asistencia.sugerir({ tarea: "guideline", snapshot: snapshotDePrueba(), opciones: OPCIONES }),
    (/** @type {any} */ e) => {
      assert.equal(e.codigo, "modelo_no_contesto");
      assert.match(e.causa, /socket hang up/, "la causa de verdad se perdio por el camino");
      assert.ok(e.accion.length > 20);
      return true;
    },
  );
});

test("cada error de este paquete dice causa y accion: se recorre el catalogo, no tres casos", async () => {
  // NFR-006, con la misma forma que el nucleo: un error nuevo sin `accion` cae
  // aqui y no en la pantalla del operador.
  const catalogo = await import("../src/errores.mjs");
  const fabricas = Object.entries(catalogo).filter(
    ([nombre, v]) => typeof v === "function" && nombre !== "ErrorDeAsistencia",
  );
  assert.ok(fabricas.length >= 6, `solo se encontraron ${fabricas.length} errores en el catalogo`);
  for (const [nombre, fabrica] of fabricas) {
    // Dos argumentos a proposito: el tercero de varias fabricas es una accion a
    // medida, y pasarsela aqui probaria la que trae el test en vez de la que
    // trae el catalogo — que es justo la que nadie revisa.
    const e = /** @type {any} */ (fabrica)("algo", ["a", "b"]);
    assert.ok(e.codigo, `\`${nombre}\` produce un error sin codigo`);
    assert.ok(e.causa.length > 40, `\`${nombre}\` produce una causa que no explica nada: "${e.causa}"`);
    assert.ok(e.accion.length > 20, `\`${nombre}\` produce un error sin accion concreta`);
    assert.doesNotMatch(e.accion, /^reintenta/i, `\`${nombre}\` dice "reintenta", que no es una accion`);
    assert.ok(typeof e.estado === "number" && e.estado >= 400, `\`${nombre}\` no trae estado HTTP`);
  }
});
