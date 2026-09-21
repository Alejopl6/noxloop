// La guarda contra la cita inventada.
//
// EL FALLO QUE CIERRA, Y ES EL UNICO QUE HACE UTIL A ESTE PAQUETE. Una
// sugerencia que dice "porque el proyecto usa vitest" cuando el snapshot dice
// `node:test` no es un error visible: es una frase bien escrita, plausible, y
// exactamente igual de convincente que la correcta. El operador la lee, le
// parece razonable, y la pega en la guideline. Nadie va a ir a comprobar la
// mitad de las afirmaciones de un borrador que ya suena bien — si hubiera que
// comprobarlas todas, el borrador no ahorro nada y valia mas la hoja en blanco.
//
// Por eso cada pieza propuesta tiene que CITAR por clave los hallazgos en los
// que se apoya, y cada clave citada tiene que existir en el snapshot que se le
// paso. Es lo unico de una sugerencia que se puede verificar por maquina, y se
// verifica: una clave inventada no se recorta en silencio —eso dejaria una
// sugerencia mutilada con aspecto de entera— se rechaza la respuesta con la
// clave inventada por delante.
//
// POR QUE SE EXIGE AL MENOS UNA CITA. Una propuesta sin ninguna no se apoya en
// este proyecto: se apoya en lo que el modelo sabe de los proyectos en general,
// que es precisamente lo que el operador puede leer en cualquier sitio y no
// necesita de aqui.

import { test } from "node:test";
import assert from "node:assert/strict";

import { crearAsistencia } from "../src/index.mjs";
import { proveedorFijo, snapshotDePrueba } from "./ayuda.mjs";

const FORMAS = ["comando", "archivo_existe", "archivo_ausente", "contenido_coincide", "ruta_prohibida"];

const PETICION = {
  tarea: /** @type {const} */ ("guideline"),
  snapshot: snapshotDePrueba(),
  opciones: { area: "testing", formas_de_comprobacion: FORMAS },
};

test("una clave citada que el snapshot no tiene tumba la respuesta entera, nombrandola", async () => {
  const asistencia = crearAsistencia({
    proveedor: proveedorFijo({
      borrador: "El proyecto usa vitest con cobertura al 90%.",
      se_apoya_en: ["testing.runner"],
      reglas: [
        {
          enunciado: "Cobertura minima del 90%",
          comprobacion: { tipo: "comando", comando: "vitest --coverage" },
          // `testing.runner` existe. `testing.vitest` no existe en ningun sitio.
          se_apoya_en: ["testing.runner", "testing.vitest"],
        },
      ],
    }),
  });

  await assert.rejects(
    () => asistencia.sugerir(PETICION),
    (/** @type {any} */ e) => {
      assert.equal(e.codigo, "cita_inventada");
      assert.match(e.causa, /testing\.vitest/, "el error no dice QUE clave se invento");
      assert.ok(e.accion.length > 20, "el error no dice que hacer despues");
      assert.doesNotMatch(e.accion, /^reintenta/i);
      return true;
    },
  );
});

test("una pieza sin ninguna cita tambien se rechaza: sin apoyo no se apoya en este proyecto", async () => {
  const asistencia = crearAsistencia({
    proveedor: proveedorFijo({
      borrador: "Escribe tests.",
      se_apoya_en: ["testing.runner"],
      reglas: [
        {
          enunciado: "Todo modulo nuevo llega con su test",
          comprobacion: { tipo: "comando", comando: "npm test" },
          se_apoya_en: [],
        },
      ],
    }),
  });

  await assert.rejects(
    () => asistencia.sugerir(PETICION),
    (/** @type {any} */ e) => {
      assert.equal(e.codigo, "sugerencia_sin_apoyo");
      assert.match(e.causa, /Todo modulo nuevo/, "el error no dice cual de las piezas se quedo sin apoyo");
      return true;
    },
  );
});

test("NO se recorta en silencio: la respuesta con una cita mala no llega a medias", async () => {
  // El caso que tienta: dos reglas, una buena y una con cita inventada. Tirar
  // solo la mala y entregar la buena deja al operador con una respuesta que
  // parece completa y no lo esta — y no hay nada en ella que se lo diga.
  const asistencia = crearAsistencia({
    proveedor: proveedorFijo({
      borrador: "Un borrador cualquiera.",
      se_apoya_en: ["testing.runner"],
      reglas: [
        {
          enunciado: "La suite pasa antes del pull request",
          comprobacion: { tipo: "comando", comando: "npm test" },
          se_apoya_en: ["testing.runner"],
        },
        {
          enunciado: "Los snapshots de vitest se revisan a mano",
          comprobacion: { tipo: "comando", comando: "vitest -u" },
          se_apoya_en: ["testing.vitest"],
        },
      ],
    }),
  });

  await assert.rejects(() => asistencia.sugerir(PETICION), /cita/i);
});

test("la guarda discrimina: la misma respuesta con las claves buenas SI se entrega", async () => {
  // El control. Sin el, "rechaza lo inventado" podria significar "rechaza
  // todo", y una guarda que nunca deja pasar nada no prueba que sepa distinguir.
  const asistencia = crearAsistencia({
    proveedor: proveedorFijo({
      borrador: "Un borrador cualquiera.",
      se_apoya_en: ["testing.runner"],
      reglas: [
        {
          enunciado: "La suite pasa antes del pull request",
          comprobacion: { tipo: "comando", comando: "npm test" },
          se_apoya_en: ["testing.runner"],
        },
        {
          enunciado: "La cobertura se configura antes de exigir un minimo",
          comprobacion: { tipo: "archivo_existe", ruta: "cobertura.config.mjs" },
          se_apoya_en: ["testing.cobertura"],
        },
      ],
    }),
  });

  const salida = await asistencia.sugerir(PETICION);
  assert.equal(salida.sugerencia.reglas.length, 2);
  assert.deepEqual(
    salida.apoyos.map((/** @type {any} */ a) => a.clave).sort(),
    ["testing.cobertura", "testing.runner"],
  );
});

test("los apoyos traen el hallazgo COMPLETO, con su evidencia de verdad", async () => {
  // Para que la pantalla pueda enseñar el archivo que sostiene el hecho que la
  // sugerencia cita. El hecho tiene evidencia; la sugerencia no. Las dos cosas
  // en la misma respuesta y separadas es lo que permite mirar una y desconfiar
  // de la otra.
  const asistencia = crearAsistencia({
    proveedor: proveedorFijo({
      borrador: "x",
      se_apoya_en: ["testing.runner"],
      reglas: [
        {
          enunciado: "La suite pasa antes del pull request",
          comprobacion: { tipo: "comando", comando: "npm test" },
          se_apoya_en: ["testing.runner"],
        },
      ],
    }),
  });

  const salida = await asistencia.sugerir(PETICION);
  const apoyo = salida.apoyos.find((/** @type {any} */ a) => a.clave === "testing.runner");
  assert.ok(apoyo, "el apoyo citado no viajo con la respuesta");
  assert.equal(apoyo.origen, "detectado");
  assert.deepEqual(apoyo.evidencia, [{ ruta: "package.json", linea: 12 }]);
  assert.equal(apoyo.valor, "node:test");
});

test("los invariantes de la constitution pasan por la misma guarda", async () => {
  // La guarda vive en el sellado y no en cada tarea: una tarea nueva que se
  // olvide de comprobar las citas no existe, porque ninguna tarea comprueba
  // nada por su cuenta.
  const asistencia = crearAsistencia({
    proveedor: proveedorFijo({
      invariantes: [
        {
          enunciado: "Ningun secreto se versiona en el arbol",
          porque: "el escaneo encontro un archivo de entorno en la raiz",
          se_apoya_en: ["riesgos.no_existe"],
        },
      ],
    }),
  });

  await assert.rejects(
    () => asistencia.sugerir({ tarea: "invariantes", snapshot: snapshotDePrueba(), opciones: {} }),
    (/** @type {any} */ e) => {
      assert.equal(e.codigo, "cita_inventada");
      assert.match(e.causa, /riesgos\.no_existe/);
      return true;
    },
  );
});

test("una clave que agrupa varios hallazgos no se presenta como si fuera uno", async () => {
  // EL CASO SALIO DEL SNAPSHOT DE VERDAD DE ESTE REPOSITORIO: el detector de
  // riesgos emite VEINTE hallazgos con la clave `riesgos.secreto`, uno por
  // archivo. Una version anterior de esto guardaba clave -> hallazgo en un
  // `Map` y conservaba el ultimo: el apoyo enseñaba UN archivo, y quien lo
  // leyera entenderia «el secreto esta aqui» cuando esta en veinte sitios.
  const repetidos = [1, 2, 3].map((i) => ({
    categoria: "riesgos",
    clave: "riesgos.secreto",
    valor: { ruta: `archivo-${i}.env` },
    origen: i === 3 ? "inferido" : "detectado",
    evidencia: [{ ruta: `archivo-${i}.env` }],
    confianza: "alta",
  }));

  const asistencia = crearAsistencia({
    proveedor: proveedorFijo({
      borrador: "Hay secretos versionados en el arbol.",
      se_apoya_en: ["riesgos.secreto"],
      reglas: [],
    }),
  });

  const salida = await asistencia.sugerir({
    tarea: "guideline",
    snapshot: snapshotDePrueba(repetidos),
    opciones: { area: "seguridad", formas_de_comprobacion: FORMAS },
  });

  const apoyo = salida.apoyos.find((/** @type {any} */ a) => a.clave === "riesgos.secreto");
  assert.equal(apoyo.hallazgos, 3, "el apoyo no dice cuantos hallazgos comparten la clave");
  assert.equal(apoyo.valor, undefined, "el apoyo da UN valor para una clave que tiene tres: es una respuesta falsa");
  assert.equal(apoyo.evidencia.length, 3, "el apoyo no junta las rutas de todos los hallazgos de la clave");
  assert.equal(
    apoyo.origen,
    "inferido",
    "el grupo trae una lectura del scanner y el apoyo se presenta como detectado: el origen mas flojo es el que manda",
  );
});
