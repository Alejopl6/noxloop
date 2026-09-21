// T114 / FR-028 — una recomendacion que contradice la constitution del
// proyecto no se propone sin declarar el conflicto.
//
// EL FALLO QUE EVITA. Una propuesta que viola las reglas del propio proyecto es
// ruido, y el ruido entrena a ignorar las propuestas. Es la misma medida que el
// producto aplica a la revision automatica: un revisor con precision baja no es
// medio util, es inutil, porque el coste de leer sus hallazgos supera lo que
// encuentra. Una lista de recomendaciones con una que contradice la
// constitution se lee entera con desconfianza.
//
// POR QUE SE MARCA Y NO SE ESCONDE. Porque a veces la contradiccion es el
// punto: el proyecto declaro "sin dependencias nuevas" hace un año y hoy la
// dependencia es la respuesta correcta. Esconder la propuesta le quita al
// operador la decision; marcarla con el conflicto se la da con la informacion
// que necesita para tomarla.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  analizar,
  aplicar,
  conflictoDe,
  invariantesDe,
  crearConstitution,
  arbolEnMemoria,
  repositorioEnMemoria,
} from "../src/index.mjs";
import { hueco, snapshotDe, MOTIVO_LARGO } from "./ayuda.mjs";

const AHORA = Date.parse("2026-09-20T10:00:00.000Z");
const DESPUES = AHORA + 60_000;

const SNAPSHOT = snapshotDe([
  hueco("agentes.instrucciones", MOTIVO_LARGO, []),
  hueco("agentes.mcp", MOTIVO_LARGO, []),
]);

const SIN_DEPENDENCIAS = {
  id: "sin_dependencias_en_el_camino_critico",
  enunciado: "El motor corre con el runtime y nada mas: ninguna dependencia de terceros en el camino critico",
  prohibe: { efecto: "agregar_dependencia" },
};

const constitution = (invariantes = [SIN_DEPENDENCIAS]) =>
  crearConstitution({
    project_id: "prj_1",
    contenido: "# Constitution\n\n### I. Sin dependencias en el camino critico\n",
    ruta_en_repo: "docs/constitution.md",
    invariantes,
    ahora: AHORA,
  });

const CATALOGO = [
  {
    id: "con_dependencia",
    tipo: "validacion",
    capacidad: "instrucciones_de_agente",
    titulo: "Validador de esquema",
    justificacion: "para comprobar la configuracion",
    efectos: [{ efecto: "agregar_dependencia", valor: "un-validador" }],
    cambios: () => ({ cambios: [{ ruta: "AGENTS.md", contenido: "# con dependencia\n" }] }),
  },
  {
    id: "sin_dependencia",
    tipo: "mcp",
    capacidad: "servidores_mcp",
    titulo: "Documento de servidores",
    justificacion: "para declarar los servidores",
    efectos: [],
    cambios: () => ({ cambios: [{ ruta: "docs/mcp.md", contenido: "# servidores\n" }] }),
  },
];

function montar(invariantes) {
  const arbol = arbolEnMemoria();
  const repositorio = repositorioEnMemoria();
  const salida = analizar({
    snapshot: SNAPSHOT,
    arbol,
    catalogo: CATALOGO,
    constitution: constitution(invariantes),
    project_id: "prj_1",
    ahora: AHORA,
    repositorio,
  });
  return { arbol, repositorio, salida };
}

test("la recomendacion que contradice un invariante se propone MARCADA, no se esconde", () => {
  const { salida } = montar();
  const conflictiva = salida.recomendaciones.find((/** @type {any} */ r) => r.id.includes("con_dependencia"));
  assert.ok(conflictiva, "la recomendacion desaparecio en vez de marcarse: el operador pierde la decision");
  assert.ok(conflictiva.conflicto_constitution, "salio sin declarar el conflicto");
  assert.match(conflictiva.conflicto_constitution, /sin_dependencias_en_el_camino_critico/);
  assert.match(conflictiva.conflicto_constitution, /agregar_dependencia|dependencia/);
});

test("la recomendacion que no contradice nada sale con el conflicto en null", () => {
  const { salida } = montar();
  const limpia = salida.recomendaciones.find((/** @type {any} */ r) => r.id.includes("sin_dependencia"));
  assert.equal(limpia.conflicto_constitution, null);
});

test("ninguna recomendacion sale con un conflicto sin declarar", () => {
  // La afirmacion entera de FR-028, comprobada recalculando el conflicto sobre
  // cada recomendacion que salio. Si una tiene conflicto y lo trae en null, es
  // exactamente el caso que el requisito prohibe.
  const { salida } = montar();
  const invariantes = invariantesDe(constitution());
  for (const r of salida.recomendaciones) {
    const deberia = conflictoDe(r, invariantes);
    assert.equal(
      r.conflicto_constitution === null,
      deberia === null,
      `\`${r.id}\` salio con conflicto \`${r.conflicto_constitution}\` y el calculado es \`${deberia}\``,
    );
  }
});

test("escribir encima de la constitution es conflicto sin que nadie lo declare: es implicito", () => {
  // No hace falta que el proyecto lo escriba: una recomendacion del bootstrap
  // que reescribe la constitution del proyecto esta cambiando las reglas desde
  // dentro del instalador.
  const arbol = arbolEnMemoria();
  const salida = analizar({
    snapshot: SNAPSHOT,
    arbol,
    catalogo: [
      {
        id: "pisa_constitution",
        tipo: "documentacion",
        capacidad: "instrucciones_de_agente",
        titulo: "Reescribir las reglas",
        justificacion: "porque si",
        efectos: [],
        cambios: () => ({ cambios: [{ ruta: "docs/constitution.md", contenido: "# otras reglas\n" }] }),
      },
    ],
    constitution: constitution([]),
    project_id: "prj_1",
    ahora: AHORA,
    repositorio: repositorioEnMemoria(),
  });
  const r = salida.recomendaciones[0];
  assert.ok(r.conflicto_constitution, "una recomendacion puede reescribir la constitution sin decirlo");
  assert.match(r.conflicto_constitution, /docs\/constitution\.md/);
});

test("sin constitution fijada no hay conflicto que declarar, y se dice", () => {
  const salida = analizar({
    snapshot: SNAPSHOT,
    arbol: arbolEnMemoria(),
    catalogo: CATALOGO,
    constitution: null,
    project_id: "prj_1",
    ahora: AHORA,
    repositorio: repositorioEnMemoria(),
  });
  assert.ok(salida.recomendaciones.every((/** @type {any} */ r) => r.conflicto_constitution === null));
  assert.equal(salida.constitution_evaluada, false);
});

test("aplicar una recomendacion en conflicto sin aceptarlo se rechaza", () => {
  const { arbol, repositorio, salida } = montar();
  const conflictiva = salida.recomendaciones.find((/** @type {any} */ r) => r.id.includes("con_dependencia"));
  assert.throws(
    () => aplicar(conflictiva, { arbol, repositorio, ahora: DESPUES }),
    (/** @type {any} */ e) => e.codigo === "conflicto_no_aceptado" && e.estado === 409,
  );
  assert.deepEqual(arbol.archivos(), {}, "se escribio pese al conflicto");
});

test("aceptando el conflicto se aplica, y la aceptacion queda registrada con su motivo", () => {
  const { arbol, repositorio, salida } = montar();
  const conflictiva = salida.recomendaciones.find((/** @type {any} */ r) => r.id.includes("con_dependencia"));
  const { recomendacion } = aplicar(conflictiva, {
    arbol,
    repositorio,
    ahora: DESPUES,
    conflicto_aceptado: true,
    motivo: "la regla es de hace un año y esta dependencia no va en el camino critico",
  });

  assert.equal(arbol.leer("AGENTS.md"), "# con dependencia\n");
  assert.equal(recomendacion.conflicto_aceptado, true);
  const registro = repositorio.decisiones("prj_1")[0];
  assert.equal(registro.conflicto_aceptado, true);
  assert.ok(registro.conflicto.length > 0, "se acepto un conflicto y no quedo escrito cual");
});

test("el conflicto se calcula tambien sobre las rutas que prohibe un invariante declarado", () => {
  const invariantes = [
    {
      id: "la_ci_no_se_toca_desde_aqui",
      enunciado: "La definicion de integracion continua la cambia una persona, no un instalador",
      prohibe: { efecto: "crear_archivo", rutas: ["automatizacion/"] },
    },
  ];
  const r = {
    id: "x",
    efectos: [{ efecto: "crear_archivo", valor: "automatizacion/flujo.yml" }],
    cambios: [{ ruta: "automatizacion/flujo.yml", accion: "crear" }],
  };
  const conflicto = conflictoDe(r, invariantes);
  assert.ok(conflicto);
  assert.match(conflicto, /la_ci_no_se_toca_desde_aqui/);
  assert.equal(conflictoDe({ id: "y", efectos: [], cambios: [{ ruta: "otro.md", accion: "crear" }] }, invariantes), null);
});
