// «Una decision en vez de veinte» — la propuesta completa del bootstrap, y las
// dos cosas que NO se pueden perder al agrupar.
//
// EL FALLO QUE ESTO CIERRA. Un bootstrap que obliga a decidir recomendacion por
// recomendacion cobra el mismo peaje de atencion veinte veces, y a la quinta el
// operador deja de leer el diff y aprueba en serie. El resultado es el peor de
// los dos mundos: la puerta humana sigue ahi, pero ya no filtra nada. Agrupar
// lo aditivo en una sola aprobacion devuelve el filtro a donde sirve.
//
// LO PRIMERO QUE SE PIERDE AL AGRUPAR, Y POR ESO SE PRUEBA AQUI: la
// recomendacion que contradice la constitution (FR-028) es justo la que existe
// para ser mirada. Colarla en un «aprobar todo» convierte la declaracion del
// conflicto en decoracion — se declara, se muestra, y se aplica igual sin que
// nadie la lea.
//
// LO SEGUNDO: `diff_obsoleto`. Entre calcular el diff y aprobarlo el arbol es
// de otro. Con una recomendacion suelta, `aplicar` compara la base y se niega.
// Con un lote, la tentacion es comprobar mientras se escribe — y entonces las
// tres primeras ya estan en el disco cuando la cuarta descubre que el arbol se
// movio. El operador queda con medio lote aplicado que nunca aprobo asi.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  analizar,
  aplicarLote,
  arbolEnMemoria,
  fueraDelLote,
  proponerBootstrap,
  repositorioEnMemoria,
} from "../src/index.mjs";
import { capturar, hueco, snapshotDe, MOTIVO_LARGO } from "./ayuda.mjs";

const AHORA = Date.parse("2026-09-20T10:00:00.000Z");
const DESPUES = AHORA + 60_000;

const SNAPSHOT = snapshotDe([
  hueco("agentes.instrucciones", MOTIVO_LARGO, []),
  hueco("guidelines.contributing", MOTIVO_LARGO, []),
  hueco("guidelines.adr", MOTIVO_LARGO, []),
]);

/** @param {{id: string, capacidad: string, ruta: string, contenido?: string}} e */
function entrada({ id, capacidad, ruta, contenido = `# ${id}\n` }) {
  return {
    id,
    tipo: "documentacion",
    capacidad,
    titulo: `Entrada ${id}`,
    justificacion: `el proyecto no tiene ${id} y el snapshot lo declara hueco`,
    efectos: [],
    cambios: () => ({ cambios: [{ ruta, contenido }] }),
  };
}

const CATALOGO = [
  entrada({ id: "instrucciones", capacidad: "instrucciones_de_agente", ruta: "AGENTS.md" }),
  entrada({ id: "contribucion", capacidad: "guia_de_contribucion", ruta: "CONTRIBUTING.md" }),
  entrada({ id: "decisiones", capacidad: "registro_de_decisiones", ruta: "docs/adr/0001.md" }),
];

/**
 * @param {{inicial?: Record<string, string>, constitution?: any, catalogo?: any[]}} [opts]
 */
function montar({ inicial = {}, constitution = null, catalogo = CATALOGO } = {}) {
  const arbol = arbolEnMemoria(inicial);
  const repositorio = repositorioEnMemoria();
  const analisis = analizar({
    snapshot: SNAPSHOT,
    arbol,
    catalogo,
    constitution,
    project_id: "prj_1",
    ahora: AHORA,
    repositorio,
  });
  return { arbol, repositorio, analisis, propuesta: proponerBootstrap(analisis) };
}

// ---------------------------------------------------------------------------
// Una decision en vez de veinte
// ---------------------------------------------------------------------------

test("la propuesta llega entera y con su diff ya calculado: no hay que pedirla pieza a pieza", () => {
  const { analisis, propuesta } = montar();

  assert.equal(analisis.recomendaciones.length, 3);
  assert.equal(propuesta.lote.recomendaciones.length, 3);

  // El diff del lote esta en la propuesta. Si hubiera que pedirlo despues, la
  // aprobacion en bloque seria fe: exactamente lo que FR-026 prohibe.
  for (const r of propuesta.lote.recomendaciones) {
    assert.ok(r.diff.length > 0, `la recomendacion \`${r.id}\` viaja sin diff`);
  }
  assert.deepEqual([...propuesta.lote.rutas], ["AGENTS.md", "CONTRIBUTING.md", "docs/adr/0001.md"]);
});

test("el numero de decisiones que la propuesta exige es UNA cuando todo es aditivo", () => {
  const { propuesta } = montar();
  // Es el numero que mide si el rediseño funciono. Si vuelve a ser uno por
  // recomendacion, esta prueba lo dice.
  assert.equal(propuesta.decisiones, 1);
  assert.deepEqual(propuesta.aparte, []);
});

test("aprobar el lote escribe las tres y registra UNA decision por recomendacion", () => {
  const { arbol, repositorio, propuesta } = montar();

  const salida = aplicarLote(propuesta, { arbol, repositorio, ahora: DESPUES, motivo: "el lote aditivo entero" });

  assert.deepEqual([...salida.escrituras], ["AGENTS.md", "CONTRIBUTING.md", "docs/adr/0001.md"]);
  assert.equal(arbol.leer("AGENTS.md"), "# instrucciones\n");
  assert.equal(arbol.leer("docs/adr/0001.md"), "# decisiones\n");

  // Una aprobacion del operador, tres decisiones registradas: FR-027 no se
  // relaja por agrupar. Lo que la etapa de evolucion continua aprende es que se
  // aplico cada propuesta, no que «se aprobo un lote».
  const decisiones = repositorio.decisiones("prj_1");
  assert.equal(decisiones.length, 3);
  for (const d of decisiones) {
    assert.equal(d.decision, "aplicada");
    assert.equal(d.motivo, "el lote aditivo entero");
  }
});

// ---------------------------------------------------------------------------
// Lo que NO entra en el lote
// ---------------------------------------------------------------------------

test("la recomendacion que contradice la constitution sale del lote y se presenta sola", () => {
  const constitution = {
    ruta_en_repo: ".specify/memory/constitution.md",
    invariantes: [
      {
        id: "la_documentacion_no_se_genera",
        enunciado: "Los documentos de `docs/` los escribe una persona",
        prohibe: { efecto: "crear_archivo", rutas: ["docs/"] },
      },
    ],
  };
  const { propuesta } = montar({ constitution });

  const conflictiva = propuesta.aparte.find((a) => a.recomendacion.entrada === "decisiones");
  assert.ok(conflictiva, "la recomendacion que choca con un invariante se quedo dentro del lote");
  assert.equal(conflictiva.motivo, "conflicto_constitution");
  assert.match(conflictiva.recomendacion.conflicto_constitution, /la_documentacion_no_se_genera/);

  // Y no esta en el lote NI por casualidad.
  assert.equal(
    propuesta.lote.recomendaciones.some((/** @type {any} */ r) => r.entrada === "decisiones"),
    false,
  );
  assert.equal(propuesta.lote.recomendaciones.length, 2);
  // Dos decisiones: el lote, y la que exige mirar.
  assert.equal(propuesta.decisiones, 2);
});

test("aprobar el lote se NIEGA si alguien mete a mano una recomendacion con conflicto", () => {
  // La guarda no es «la propuesta no la pone»: es que aplicar el lote tampoco
  // la acepta. Un lote se arma con ids que llegan de fuera, y una guarda que
  // vive solo en el constructor se salta mandando la lista a mano.
  const constitution = {
    ruta_en_repo: ".specify/memory/constitution.md",
    invariantes: [
      {
        id: "la_documentacion_no_se_genera",
        enunciado: "Los documentos de `docs/` los escribe una persona",
        prohibe: { efecto: "crear_archivo", rutas: ["docs/"] },
      },
    ],
  };
  const { arbol, repositorio, analisis, propuesta } = montar({ constitution });
  const conflictiva = analisis.recomendaciones.find((/** @type {any} */ r) => r.entrada === "decisiones");

  const error = capturar(() =>
    aplicarLote(
      { lote: { recomendaciones: [...propuesta.lote.recomendaciones, conflictiva] } },
      { arbol, repositorio, ahora: DESPUES },
    ),
  );
  assert.equal(error.codigo, "recomendacion_fuera_del_lote");
  assert.match(error.causa, /conflicto/i);

  // Y no escribio NADA: ni siquiera las dos que si eran del lote.
  assert.equal(arbol.leer("AGENTS.md"), null);
  assert.equal(arbol.leer("CONTRIBUTING.md"), null);
});

test("la recomendacion que pisa un archivo que ya existe sale del lote", () => {
  // Crear un archivo que no estaba se deshace borrandolo. Pisar uno que el
  // operador escribio, no. La linea va por ahi y no por el numero de cambios.
  const { propuesta } = montar({ inicial: { "CONTRIBUTING.md": "# La que escribio el equipo\n" } });

  const pisa = propuesta.aparte.find((a) => a.recomendacion.entrada === "contribucion");
  assert.ok(pisa, "una recomendacion que modifica un archivo existente se colo en el lote");
  assert.equal(pisa.motivo, "pisa_un_archivo_existente");
  assert.deepEqual([...pisa.rutas], ["CONTRIBUTING.md"]);
  assert.equal(propuesta.lote.recomendaciones.length, 2);
});

test("`fueraDelLote` dice el motivo por recomendacion, para que la pantalla lo pinte sin recalcularlo", () => {
  const { analisis } = montar({ inicial: { "CONTRIBUTING.md": "# La que escribio el equipo\n" } });
  const aditiva = analisis.recomendaciones.find((/** @type {any} */ r) => r.entrada === "instrucciones");
  const pisa = analisis.recomendaciones.find((/** @type {any} */ r) => r.entrada === "contribucion");

  assert.equal(fueraDelLote(aditiva), null);
  assert.equal(fueraDelLote(pisa), "pisa_un_archivo_existente");
});

// ---------------------------------------------------------------------------
// El arbol se movio
// ---------------------------------------------------------------------------

test("si el arbol cambio bajo UNA del lote, no se escribe NINGUNA", () => {
  const { arbol, repositorio, propuesta } = montar();

  // Alguien edita el repositorio entre el analisis y la aprobacion. Es el caso
  // normal, no el raro: el operador tiene el editor abierto.
  arbol.escribir("docs/adr/0001.md", "# esto lo escribi yo mientras revisaba\n");

  const error = capturar(() => aplicarLote(propuesta, { arbol, repositorio, ahora: DESPUES }));
  assert.equal(error.codigo, "diff_obsoleto");
  assert.match(error.causa, /docs\/adr\/0001\.md/);

  // Y LO QUE IMPORTA: las otras dos tampoco se escribieron. Medio lote aplicado
  // es un estado que el operador no aprobo y que ya no puede revisar.
  assert.equal(arbol.leer("AGENTS.md"), null);
  assert.equal(arbol.leer("CONTRIBUTING.md"), null);
  assert.equal(arbol.leer("docs/adr/0001.md"), "# esto lo escribi yo mientras revisaba\n");
  assert.deepEqual(repositorio.decisiones("prj_1"), []);
});

test("dos recomendaciones del lote que escriben la misma ruta se rechazan antes de escribir", () => {
  // La segunda partiria de una base que la primera acaba de invalidar, y el
  // sintoma seria un `diff_obsoleto` a mitad de lote con medio lote en disco.
  const catalogo = [
    entrada({ id: "instrucciones", capacidad: "instrucciones_de_agente", ruta: "AGENTS.md", contenido: "# uno\n" }),
    entrada({ id: "contribucion", capacidad: "guia_de_contribucion", ruta: "AGENTS.md", contenido: "# dos\n" }),
  ];
  const { arbol, repositorio, propuesta } = montar({ catalogo });

  const error = capturar(() => aplicarLote(propuesta, { arbol, repositorio, ahora: DESPUES }));
  assert.equal(error.codigo, "ruta_repetida_en_el_lote");
  assert.match(error.causa, /AGENTS\.md/);
  assert.equal(arbol.leer("AGENTS.md"), null);
});

test("un lote vacio no es una aprobacion: se niega en vez de contestar que todo fue bien", () => {
  const { arbol, repositorio } = montar();
  const error = capturar(() => aplicarLote({ lote: { recomendaciones: [] } }, { arbol, repositorio }));
  assert.equal(error.codigo, "lote_vacio");
});

// ---------------------------------------------------------------------------
// Lo que la propuesta arrastra del analisis
// ---------------------------------------------------------------------------

test("la propuesta no pierde las preguntas ni lo que ya estaba: agrupar no es esconder", () => {
  const catalogo = [
    ...CATALOGO,
    {
      id: "mcp",
      tipo: "mcp",
      capacidad: "servidores_mcp",
      titulo: "Declarar los servidores de contexto",
      justificacion: "no se deducen del arbol",
      efectos: [],
      cambios: () => ({ pregunta: { texto: "Que servidores usa este proyecto?", falta: ["servidores"] } }),
    },
  ];
  const { propuesta } = montar({ catalogo, inicial: { "CONTRIBUTING.md": "# La que escribio el equipo\n" } });

  assert.equal(propuesta.preguntas.length, 1);
  assert.equal(propuesta.preguntas[0].entrada, "mcp");
  assert.equal(propuesta.project_id, "prj_1");
  assert.equal(propuesta.snapshot_id, "snap_prueba");
  assert.equal(propuesta.analizado_en, new Date(AHORA).toISOString());
  assert.equal(propuesta.constitution_evaluada, false);
});
