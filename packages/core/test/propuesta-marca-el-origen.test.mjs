// T102 / FR-020 / principio X — la propuesta se deriva del snapshot y cada
// apartado sale marcado `detectado`, `inferido` o `vacio`, con su evidencia.
//
// EL FALLO QUE EVITA, Y POR QUE ES EL PEOR DE ESTA ETAPA. Un apartado inferido
// presentado como detectado convierte una suposicion del modelo en la regla del
// proyecto. Y a diferencia del verde inventado —que se cae en cuanto el codigo
// falla— este no se descubre nunca: el operador lo aprueba porque la pantalla
// decia "detectado", el runtime lo aplica durante meses y cada tarea hereda la
// suposicion como si fuera un hecho verificado.
//
// Por eso la marca no es un adorno de la interfaz: es una propiedad del
// apartado, se calcula del origen de los hallazgos que lo respaldan, y un
// apartado detectado sin evidencia no sale de aqui.

import { test } from "node:test";
import assert from "node:assert/strict";

import { proponerConstitution, derivarApartado } from "../src/index.mjs";
import { hallazgo, hueco, snapshotDe, MOTIVO_LARGO } from "./ayuda.mjs";

const AHORA = Date.parse("2026-09-20T10:00:00.000Z");

const PROYECTO = { id: "prj_1", nombre: "proyecto", origen: "local", estado: "DISCOVERED" };

const SNAPSHOT = snapshotDe([
  hallazgo("stack.ecosistemas", ["node"], { evidencia: [{ ruta: "package.json", linea: 2 }] }),
  hallazgo("runtime.node", ">=22", { evidencia: [{ ruta: "package.json", linea: 14 }] }),
  hallazgo("stack.modulos", "esm", { evidencia: [{ ruta: "package.json", linea: 5 }] }),
  hallazgo("testing.runner", "node --test", { evidencia: [{ ruta: "package.json", linea: 18 }] }),
  hallazgo("testing.ubicacion", { directorios: ["test"] }, { evidencia: [{ ruta: "test/uno.test.mjs" }] }),
  hueco("testing.umbral_cobertura", "se busco un umbral declarado en el manifiesto y en la configuracion y no hay ninguno"),
  hallazgo("ci.workflows", [".github/workflows/ci.yml"], { evidencia: [{ ruta: ".github/workflows/ci.yml" }] }),
  hallazgo("ci.gatea_pr", true, { evidencia: [{ ruta: ".github/workflows/ci.yml", linea: 3 }] }),
  hallazgo(
    "arquitectura.capas",
    { capas: ["puertos"] },
    { origen: "inferido", confianza: "baja", evidencia: [{ ruta: "src/puertos" }] },
  ),
  hueco("agentes.instrucciones", "se recorrio el arbol buscando instrucciones de agente y no hay ninguna", []),
  hueco("agentes.hooks", MOTIVO_LARGO, []),
  hueco("agentes.skills", MOTIVO_LARGO, []),
  hueco("agentes.plugin", MOTIVO_LARGO, []),
  hueco("agentes.configuracion", MOTIVO_LARGO, []),
  hueco("agentes.mcp", MOTIVO_LARGO, []),
  hueco("agentes.subagentes", MOTIVO_LARGO, []),
  hueco("agentes.comandos", MOTIVO_LARGO, []),
]);

const propuesta = proponerConstitution({ snapshot: SNAPSHOT, proyecto: PROYECTO, ahora: AHORA });

/** @param {string} id */
const apartado = (id) => propuesta.apartados.find((/** @type {any} */ a) => a.id === id);

test("todos los apartados salen marcados, y solo con una de las tres marcas", () => {
  assert.ok(propuesta.apartados.length >= 8, `salieron ${propuesta.apartados.length} apartados`);
  for (const a of propuesta.apartados) {
    assert.ok(["detectado", "inferido", "vacio"].includes(a.origen), `\`${a.id}\` salio con origen \`${a.origen}\``);
  }
});

test("un apartado detectado trae la ruta que lo respalda, siempre", () => {
  const detectados = propuesta.apartados.filter((/** @type {any} */ a) => a.origen === "detectado");
  assert.ok(detectados.length > 0, "no se detecto ningun apartado sobre un snapshot con hallazgos");
  for (const a of detectados) {
    assert.ok(a.evidencia.length > 0, `\`${a.id}\` dice detectado sin evidencia`);
    for (const e of a.evidencia) assert.ok(typeof e.ruta === "string" && e.ruta.length > 0);
  }
});

test("el apartado de testing sale detectado y cita el manifiesto con su linea", () => {
  const a = apartado("testing");
  assert.equal(a.origen, "detectado");
  assert.ok(a.evidencia.some((/** @type {any} */ e) => e.ruta === "package.json" && e.linea === 18));
  assert.match(String(a.contenido), /node --test/);
});

test("un hueco del snapshot no convierte el apartado en detectado: sale vacio, con motivo y con pregunta", () => {
  // Los hallazgos de `agentes.*` vienen todos con `motivo`, que es como el
  // scanner declara "se busco y no habia". Un apartado que los contara como
  // respaldo diria "detectado" sobre la nada.
  const a = apartado("agentes");
  assert.equal(a.origen, "vacio", `el apartado de agentes salio \`${a.origen}\``);
  assert.equal(a.contenido, null, "un hueco con contenido es un hueco relleno");
  assert.ok(a.motivo.length > 20, "el hueco no dice por que esta vacio");
  assert.ok(a.pregunta.length > 20, "un hueco sin pregunta deja al operador sin saber que decidir");
  assert.ok(a.evidencia.length > 0, "el hueco no deja constancia de donde se busco");
});

test("un hallazgo que dice detectado sin evidencia no convierte el apartado en detectado", () => {
  // EL CAMINO POR EL QUE ESTO PASA, Y POR QUE NO ES HIPOTETICO. El scanner no
  // puede emitir un `detectado` sin evidencia: su constructor lo impide. Pero
  // FR-014 deja que el operador CORRIJA un hallazgo antes de aceptar el
  // snapshot, y un hallazgo corregido llega aqui con el valor que escribio una
  // persona. Si la correccion se queda sin la ruta que la respaldaba, lo que
  // entra es una opinion con la etiqueta de un hecho — exactamente lo que el
  // principio X prohibe, solo que entrando por la puerta del formulario en vez
  // de por la del detector.
  const apartado = derivarApartado(
    { id: "testing", titulo: "Politica de testing", prefijos: ["testing."], pregunta: "que gatea?" },
    [{ categoria: "testing", clave: "testing.runner", valor: "lo que dijo el operador", origen: "detectado", evidencia: [], confianza: "alta" }],
  );
  assert.equal(apartado.origen, "vacio", "un detectado sin ruta paso como detectado");
  assert.equal(apartado.contenido, null);
  assert.match(apartado.motivo, /respalda|ruta/);
});

test("un apartado que solo respalda un hallazgo inferido sale inferido, y nunca con confianza alta", () => {
  const a = apartado("arquitectura");
  assert.equal(a.origen, "inferido");
  assert.notEqual(a.confianza, "alta", "un inferido con confianza alta se lee en pantalla como un hecho");
});

test("un apartado que el snapshot no puede responder sale vacio: no se rellena con lo probable", () => {
  // Ningun detector mira la politica de ramas, la de revision ni la de
  // despliegue: no estan en el arbol. Un scanner que igualmente propusiera
  // "trunk-based, revision por pares" estaria escribiendo la constitution de
  // otro proyecto.
  for (const id of ["git", "revision", "despliegue", "autonomia"]) {
    const a = apartado(id);
    assert.ok(a, `no se emitio el apartado \`${id}\``);
    assert.equal(a.origen, "vacio", `\`${id}\` salio como \`${a.origen}\` sin un detector detras`);
    assert.equal(a.contenido, null);
  }
});

test("el fallo que motiva cada principio propuesto sale como hueco declarado, no inventado", () => {
  // Es la union de T100 con el principio X: la constitution exige que cada
  // principio declare el fallo medido que lo motiva, y ese fallo no esta en el
  // arbol de nadie. Inventarlo produciria exactamente la prosa plausible que
  // este producto existe para no producir.
  for (const a of propuesta.apartados) {
    assert.equal(a.fallo_que_motiva, null, `\`${a.id}\` llego con un fallo que nadie midio`);
  }
  assert.match(propuesta.documento, /fallo que lo motiva/i);
});

test("el documento marca los huecos de forma visible y no escribe prosa donde no hay dato", () => {
  assert.match(propuesta.documento, /\[vacio\]/);
  const seccionDeAgentes = propuesta.documento.split("\n").filter((l) => /agentes/i.test(l)).join("\n");
  assert.ok(seccionDeAgentes.length > 0, "el apartado vacio desaparecio del documento en vez de declararse");
});

test("el documento se parece a una constitution: principios numerados, gobernanza y pie de version", () => {
  assert.match(propuesta.documento, /^# /m);
  assert.match(propuesta.documento, /### I\./m, "los principios no salen numerados");
  assert.match(propuesta.documento, /## Governance|## Gobernanza/m);
  assert.match(propuesta.documento, /\*\*Version\*\*: 0\.1\.0/);
});

test("la propuesta declara de que snapshot y de que commit sale", () => {
  // Sin esto, una constitution aprobada hace dos meses no se puede volver a
  // derivar para comparar: no se sabe contra que arbol se leyo.
  assert.equal(propuesta.derivada_de.snapshot_id, SNAPSHOT.id);
  assert.equal(propuesta.derivada_de.commit, SNAPSHOT.commit);
});

test("las preguntas pendientes salen agrupadas: es la lista de lo que el operador tiene que decidir", () => {
  const ids = propuesta.preguntas.map((/** @type {any} */ p) => p.apartado);
  for (const id of ["git", "revision", "despliegue", "autonomia", "agentes"]) {
    assert.ok(ids.includes(id), `\`${id}\` esta vacio y no aparece en las preguntas`);
  }
});

test("un snapshot cancelado no produce propuesta: una lectura a medias no es un borrador", () => {
  assert.throws(
    () => proponerConstitution({ snapshot: snapshotDe([], { estado: "cancelado" }), proyecto: PROYECTO, ahora: AHORA }),
    (/** @type {any} */ e) => e.codigo === "snapshot_incompleto" && e.accion.length > 20,
  );
});

test("sobre un snapshot sin un solo hallazgo, todo sale vacio y nada sale detectado", () => {
  const vacia = proponerConstitution({ snapshot: snapshotDe([]), proyecto: PROYECTO, ahora: AHORA });
  assert.ok(vacia.apartados.every((/** @type {any} */ a) => a.origen === "vacio"));
  assert.equal(vacia.preguntas.length, vacia.apartados.length);
});
