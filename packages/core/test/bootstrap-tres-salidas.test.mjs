// T113 / FR-025 / FR-027 — tres salidas por recomendacion —aplicar,
// personalizar, omitir— con la decision y su motivo registrados.
//
// POR QUE EXACTAMENTE TRES, Y POR QUE SE REGISTRAN. Una cuarta salida —"luego",
// "quiza"— es una recomendacion que se queda pendiente para siempre y una
// decision que nadie tomo. Y sin registro, la etapa 16 del producto (evolucion
// continua) no tiene de donde aprender: lo que mas informa no es lo que se
// aplico, es lo que se omitio y por que. Una propuesta que el 80% de los
// proyectos omite con el mismo motivo es una propuesta que hay que cambiar, y
// eso solo se sabe si el motivo se guardo.

import { test } from "node:test";
import assert from "node:assert/strict";

import { analizar, aplicar, personalizar, omitir, DECISIONES, arbolEnMemoria, repositorioEnMemoria } from "../src/index.mjs";
import { hueco, snapshotDe, MOTIVO_LARGO } from "./ayuda.mjs";

const AHORA = Date.parse("2026-09-20T10:00:00.000Z");
const DESPUES = AHORA + 60_000;

const SNAPSHOT = snapshotDe([hueco("agentes.instrucciones", MOTIVO_LARGO, [])]);

const CATALOGO = [
  {
    id: "entrada",
    tipo: "instrucciones",
    capacidad: "instrucciones_de_agente",
    titulo: "Instrucciones de agente",
    justificacion: "el proyecto no le dice nada a ningun agente",
    efectos: [],
    cambios: () => ({ cambios: [{ ruta: "AGENTS.md", contenido: "# Lo propuesto\n" }] }),
  },
];

function montar(inicial = {}) {
  const arbol = arbolEnMemoria(inicial);
  const repositorio = repositorioEnMemoria();
  const salida = analizar({ snapshot: SNAPSHOT, arbol, catalogo: CATALOGO, project_id: "prj_1", ahora: AHORA, repositorio });
  return { arbol, repositorio, recomendacion: salida.recomendaciones[0] };
}

test("las salidas son exactamente tres", () => {
  assert.deepEqual([...DECISIONES], ["aplicada", "personalizada", "omitida"]);
});

test("aplicar deja la decision, su instante y su motivo en el almacen", () => {
  const { arbol, repositorio, recomendacion } = montar();
  const { recomendacion: despues } = aplicar(recomendacion, {
    arbol,
    repositorio,
    ahora: DESPUES,
    motivo: "es lo que ya haciamos a mano",
  });

  assert.equal(despues.decision, "aplicada");
  assert.equal(despues.motivo_decision, "es lo que ya haciamos a mano");
  assert.equal(despues.decidida, new Date(DESPUES).toISOString());
  assert.equal(repositorio.recomendacion(recomendacion.id).decision, "aplicada");

  const registradas = repositorio.decisiones("prj_1");
  assert.equal(registradas.length, 1);
  assert.equal(registradas[0].decision, "aplicada");
  assert.equal(registradas[0].recomendacion_id, recomendacion.id);
});

test("omitir no escribe nada y registra el motivo", () => {
  const { arbol, repositorio, recomendacion } = montar();
  const { recomendacion: despues } = omitir(recomendacion, {
    repositorio,
    ahora: DESPUES,
    motivo: "este repositorio no usa agentes",
  });

  assert.equal(despues.decision, "omitida");
  assert.equal(despues.motivo_decision, "este repositorio no usa agentes");
  assert.deepEqual(arbol.archivos(), {}, "omitir escribio en el arbol");
  assert.equal(repositorio.decisiones("prj_1")[0].decision, "omitida");
});

test("omitir sin motivo se permite y se registra como sin motivo, no como si no hubiera pasado", () => {
  const { repositorio, recomendacion } = montar();
  const { recomendacion: despues } = omitir(recomendacion, { repositorio, ahora: DESPUES });
  assert.equal(despues.decision, "omitida");
  assert.equal(despues.motivo_decision, null);
  assert.equal(repositorio.decisiones("prj_1").length, 1);
});

test("personalizar escribe lo del operador y guarda las dos versiones", () => {
  // Guardar solo la version final perderia el dato que de verdad sirve: en que
  // se equivoco la propuesta. La diferencia entre lo propuesto y lo aceptado es
  // el unico sitio donde eso esta escrito.
  const { arbol, repositorio, recomendacion } = montar();
  const { recomendacion: despues } = personalizar(recomendacion, {
    arbol,
    repositorio,
    ahora: DESPUES,
    motivo: "faltaba el comando de verificacion",
    cambios_modificados: [{ ruta: "AGENTS.md", contenido: "# Lo que escribio el operador\n" }],
  });

  assert.equal(arbol.leer("AGENTS.md"), "# Lo que escribio el operador\n");
  assert.equal(despues.decision, "personalizada");
  assert.equal(despues.cambios_propuestos[0].contenido, "# Lo propuesto\n");
  assert.equal(despues.cambios[0].contenido, "# Lo que escribio el operador\n");
});

test("personalizar sin cambios se rechaza: aplicar el original llamandolo personalizado falsea el registro", () => {
  const { arbol, repositorio, recomendacion } = montar();
  assert.throws(
    () => personalizar(recomendacion, { arbol, repositorio, ahora: DESPUES }),
    (/** @type {any} */ e) => e.codigo === "personalizacion_sin_cambios" && e.accion.length > 20,
  );
});

test("personalizar no puede ampliar el alcance a una ruta que nadie reviso", () => {
  const { arbol, repositorio, recomendacion } = montar();
  assert.throws(
    () =>
      personalizar(recomendacion, {
        arbol,
        repositorio,
        ahora: DESPUES,
        cambios_modificados: [{ ruta: "otro/archivo.md", contenido: "x" }],
      }),
    (/** @type {any} */ e) => e.codigo === "ruta_fuera_del_diff" && e.causa.includes("otro/archivo.md"),
  );
  assert.deepEqual(arbol.archivos(), {});
});

test("personalizar tambien comprueba que el arbol no cambio: el operador partio de lo que vio", () => {
  const { arbol, repositorio, recomendacion } = montar({ "AGENTS.md": "lo que habia\n" });
  arbol.escribir("AGENTS.md", "otra cosa\n");
  assert.throws(
    () =>
      personalizar(recomendacion, {
        arbol,
        repositorio,
        ahora: DESPUES,
        cambios_modificados: [{ ruta: "AGENTS.md", contenido: "lo mio\n" }],
      }),
    (/** @type {any} */ e) => e.codigo === "diff_obsoleto",
  );
});

test("una decision que no es una de las tres se rechaza nombrando las tres", () => {
  const { arbol, repositorio, recomendacion } = montar();
  assert.throws(
    () => aplicar(recomendacion, { arbol, repositorio, ahora: DESPUES, decision: "luego" }),
    (/** @type {any} */ e) => e.codigo === "decision_desconocida" && DECISIONES.every((d) => e.causa.includes(d)),
  );
});

test("cambiar de opinion se permite y deja las dos decisiones en el historial", () => {
  // Omitir hoy y aplicar mañana es legitimo. Lo que no puede pasar es que la
  // primera decision desaparezca: la evolucion continua aprende del cambio de
  // opinion tanto como de la decision.
  const { arbol, repositorio, recomendacion } = montar();
  const { recomendacion: omitida } = omitir(recomendacion, { repositorio, ahora: DESPUES, motivo: "ahora no" });
  const { recomendacion: aplicada } = aplicar(omitida, { arbol, repositorio, ahora: DESPUES + 1, motivo: "lo pensé mejor" });

  assert.equal(aplicada.decision, "aplicada");
  assert.equal(aplicada.historial.length, 2);
  assert.deepEqual(aplicada.historial.map((/** @type {any} */ h) => h.decision), ["omitida", "aplicada"]);
  assert.equal(repositorio.decisiones("prj_1").length, 2);
});
