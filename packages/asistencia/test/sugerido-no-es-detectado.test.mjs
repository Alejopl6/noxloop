// EL INVARIANTE DE ESTE PAQUETE: nada que salga de un modelo puede acabar
// indistinguible de un hallazgo del scanner.
//
// POR QUE ES EL INVARIANTE Y NO UNA PREFERENCIA DE PRESENTACION. El vocabulario
// del scanner ya esta cerrado y el operador lo aprendio: `detectado` es un
// hecho con un archivo detras, `inferido` es una lectura del scanner sobre
// señales que tambien enseña, `vacio` es la constancia de que se busco. Las
// tres tienen algo del disco debajo. Lo que propone un modelo no tiene nada del
// disco debajo: es texto plausible.
//
// Si esa cuarta cosa entra al mismo saco, el precio no es una pantalla fea. El
// hallazgo se acepta, se convierte en la constitution del proyecto, y el
// runtime la aplica durante meses — que es exactamente el daño que el principio
// X describe. Por eso:
//
//   1. El origen lo SELLA este paquete despues de validar, y lo que el modelo
//      diga en ese campo se tira. Un modelo que devuelve `origen: "detectado"`
//      no puede conseguir que se publique un `detectado`.
//   2. Ninguna pieza sugerida lleva `evidencia`. `evidencia` es la palabra del
//      scanner para "aqui esta el archivo", y una sugerencia no tiene archivo:
//      tiene `se_apoya_en`, que son claves de hallazgos que SI existen.
//
// La prueba se hace sobre el objeto serializado y no sobre la intencion, que es
// como este proyecto prueba sus invariantes: un campo que no se puso es una
// promesa; un `JSON.stringify` que no lo contiene es un hecho.

import { test } from "node:test";
import assert from "node:assert/strict";

import { crearAsistencia, ORIGEN_DE_LO_SUGERIDO } from "../src/index.mjs";
import { proveedorFijo, snapshotDePrueba } from "./ayuda.mjs";

const FORMAS = ["comando", "archivo_existe", "archivo_ausente", "contenido_coincide", "ruta_prohibida"];

/** @param {any} [encima] */
function guidelinePlausible(encima = {}) {
  return {
    borrador: "Los tests corren con el runner de Node y no hay cobertura configurada todavia.",
    se_apoya_en: ["testing.runner"],
    reglas: [
      {
        enunciado: "La suite entera tiene que pasar antes de abrir un pull request",
        comprobacion: { tipo: "comando", comando: "npm test" },
        se_apoya_en: ["testing.runner"],
      },
    ],
    ...encima,
  };
}

test("el origen de todo lo sugerido es `sugerido`, y el que diga el modelo se tira", async () => {
  // El modelo devuelve `origen: "detectado"` en todas partes: es el caso malo,
  // y tiene que ser inofensivo.
  const envenenada = guidelinePlausible({
    origen: "detectado",
    reglas: [
      {
        enunciado: "La suite entera tiene que pasar antes de abrir un pull request",
        comprobacion: { tipo: "comando", comando: "npm test" },
        se_apoya_en: ["testing.runner"],
        origen: "detectado",
        evidencia: [{ ruta: "package.json", linea: 1 }],
      },
    ],
  });

  const asistencia = crearAsistencia({ proveedor: proveedorFijo(envenenada) });
  const salida = await asistencia.sugerir({
    tarea: "guideline",
    snapshot: snapshotDePrueba(),
    opciones: { area: "testing", formas_de_comprobacion: FORMAS },
  });

  assert.equal(salida.origen, ORIGEN_DE_LO_SUGERIDO);
  assert.equal(ORIGEN_DE_LO_SUGERIDO, "sugerido");
  for (const regla of salida.sugerencia.reglas) {
    assert.equal(regla.origen, "sugerido", "una regla propuesta salio con el origen que dijo el modelo");
  }
});

test("EL INVARIANTE: la rama sugerida del objeto serializado no contiene `detectado` en ningun `origen`", async () => {
  const asistencia = crearAsistencia({
    proveedor: proveedorFijo(
      guidelinePlausible({
        origen: "detectado",
        reglas: [
          {
            enunciado: "Cobertura minima del 80%",
            comprobacion: { tipo: "comando", comando: "npm run cobertura" },
            se_apoya_en: ["testing.cobertura"],
            origen: "detectado",
          },
        ],
      }),
    ),
  });

  const salida = await asistencia.sugerir({
    tarea: "guideline",
    snapshot: snapshotDePrueba(),
    opciones: { area: "testing", formas_de_comprobacion: FORMAS },
  });

  // `apoyos` es la OTRA rama y si lleva hallazgos de verdad con su origen de
  // verdad: son los hechos que la sugerencia cita. Se separa para poder
  // afirmar sobre la rama sugerida sin que los hechos citados la contaminen.
  const { apoyos, ...loSugerido } = salida;
  const texto = JSON.stringify(loSugerido);
  assert.ok(
    !texto.includes('"origen":"detectado"'),
    `algo de lo sugerido salio marcado como detectado:\n${texto}`,
  );
  assert.ok(
    !texto.includes('"origen":"inferido"'),
    "algo de lo sugerido salio marcado como `inferido`, que es la palabra del scanner para SUS lecturas: " +
      "las del scanner enseñan las señales que las sostienen, y esto no tiene ninguna",
  );

  // Y los apoyos si son hallazgos, con el origen que el scanner les puso.
  assert.ok(apoyos.length > 0, "la sugerencia no cito ningun hallazgo y aun asi se entrego");
  for (const apoyo of apoyos) {
    assert.ok(["detectado", "inferido"].includes(apoyo.origen), `un apoyo salio con origen \`${apoyo.origen}\``);
  }
});

test("ninguna pieza sugerida lleva `evidencia`: esa palabra es del scanner y significa que hay un archivo", async () => {
  const asistencia = crearAsistencia({
    proveedor: proveedorFijo(
      guidelinePlausible({
        reglas: [
          {
            enunciado: "La suite entera tiene que pasar antes de abrir un pull request",
            comprobacion: { tipo: "comando", comando: "npm test" },
            se_apoya_en: ["testing.runner"],
            // El modelo se inventa una cita de archivo. No puede llegar a la salida.
            evidencia: [{ ruta: "inventado/que/no/existe.md", linea: 99, extracto: "lo que quiera" }],
          },
        ],
      }),
    ),
  });

  const salida = await asistencia.sugerir({
    tarea: "guideline",
    snapshot: snapshotDePrueba(),
    opciones: { area: "testing", formas_de_comprobacion: FORMAS },
  });

  const { apoyos: _, ...loSugerido } = salida;
  assert.ok(
    !JSON.stringify(loSugerido).includes("evidencia"),
    "una pieza sugerida viajo con `evidencia`: quien la pinte va a enseñar una ruta que nadie leyo",
  );
  assert.ok(
    !JSON.stringify(loSugerido).includes("inventado/que/no/existe.md"),
    "la ruta que el modelo se invento llego a la salida",
  );
});

test("la procedencia dice quien lo produjo: sin eso, la marca no se puede auditar despues", async () => {
  const asistencia = crearAsistencia({
    proveedor: proveedorFijo(guidelinePlausible(), { modelo: "claude-opus-5", proveedor: "anthropic" }),
    reloj: () => Date.parse("2026-09-21T10:00:00.000Z"),
  });

  const salida = await asistencia.sugerir({
    tarea: "guideline",
    snapshot: snapshotDePrueba(),
    opciones: { area: "testing", formas_de_comprobacion: FORMAS },
  });

  assert.equal(salida.procedencia.modelo, "claude-opus-5");
  assert.equal(salida.procedencia.proveedor, "anthropic");
  assert.equal(salida.procedencia.generado, "2026-09-21T10:00:00.000Z");
  assert.equal(salida.procedencia.snapshot_id, "snap-1");
  assert.ok(salida.procedencia.esquema.length > 0, "sin la version del esquema no se sabe contra que se valido");
});

test("la advertencia viaja DENTRO de la respuesta, no en la documentacion de la API", async () => {
  // Una marca que solo existe en el contrato es una marca que el operador no
  // ve. Esta viaja pegada al dato, asi que cualquier cliente —la interfaz, un
  // `curl`, un log— la tiene delante sin haber leido nada.
  const asistencia = crearAsistencia({ proveedor: proveedorFijo(guidelinePlausible()) });
  const salida = await asistencia.sugerir({
    tarea: "guideline",
    snapshot: snapshotDePrueba(),
    opciones: { area: "testing", formas_de_comprobacion: FORMAS },
  });

  assert.equal(typeof salida.advertencia, "string");
  assert.ok(
    salida.advertencia.length > 60,
    `la advertencia es demasiado corta para decir nada: "${salida.advertencia}"`,
  );
  assert.match(salida.advertencia, /no es un hallazgo/i);
});

test("la marca la pone el sellado aunque el esquema DECLARE `origen`: no es solo que se filtre", async () => {
  // POR QUE ESTE TEST EXISTE, Y LO DESCUBRIO UNA MUTACION. Se rompio a mano el
  // sellado —`pieza.origen = pieza.origen ?? "sugerido"`, o sea «respeta el que
  // dijo el modelo»— y NINGUNA prueba cayo. El motivo: los esquemas de hoy no
  // declaran `origen`, asi que la limpieza ya lo habia tirado antes de llegar
  // al sellado, y las dos defensas se tapaban la una a la otra.
  //
  // Que se tapen esta bien —son dos mecanismos contra el mismo fallo— pero una
  // prueba que no las distingue no dice cuantas quedan vivas. El dia que un
  // esquema declare `origen` por cualquier motivo, la limpieza deja de tapar y
  // el sellado es lo unico que queda: esto comprueba que ese solo basta.
  const { sellar } = await import("../src/marca.mjs");

  const esquemaQueDeclaraOrigen = {
    type: "object",
    additionalProperties: false,
    required: ["se_apoya_en"],
    properties: {
      origen: { type: "string" },
      se_apoya_en: { type: "array", items: { type: "string" } },
    },
  };

  const sellada = sellar({
    tarea: "guideline",
    esquema: esquemaQueDeclaraOrigen,
    esquemaId: "prueba/1",
    objeto: { origen: "detectado", se_apoya_en: ["testing.runner"] },
    snapshot: snapshotDePrueba(),
    procedencia: { modelo: "m", proveedor: "p", generado: "2026-09-21T00:00:00.000Z" },
  });

  assert.equal(
    sellada.sugerencia.origen,
    "sugerido",
    "el esquema dejo pasar `origen` y el sellado lo respeto: una sugerencia se publico como detectada",
  );
});
