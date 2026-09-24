// Lo que el board calcula en el cliente: filtros, contadores, resumen y runs
// activos (`components/board/derivar.ts`).
//
// POR QUE SE PRUEBA ESTO Y NO LA PINTURA. La columna, el chip y la accion de
// cada tarjeta los decide el servicio; lo que decide esta interfaz es QUE SE
// VE con los filtros puestos y CUANTO se cuenta. Un contador que no refleja lo
// filtrado (FR-007) o un resumen que cuenta un «fallido» como «te necesita»
// compilan, se ven bien y mienten. Esto es lo que lo atrapa.
//
// Se importa el `.ts` tal cual: `derivar.ts` solo importa TIPOS, que Node
// borra al cargar, asi que no hace falta bundler ni resolver el alias `@/`.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FILTROS_VACIOS,
  SIN_ASIGNAR,
  agruparPorColumna,
  colorDeProyecto,
  etiquetaDeGestor,
  filtrarTarjetas,
  hayFiltros,
  iniciales,
  inicialesDeEjecutor,
  opcionesDeFiltro,
  resumirTarjetas,
  runsActivos,
} from "../components/board/derivar.ts";

function tarjeta(id, extra = {}) {
  const { ticket = {}, ...resto } = extra;
  return {
    id,
    proyecto: { id: "pagos", nombre: "Pagos", color: null },
    ticket: { id, key: id, titulo: `Ticket ${id}`, etiquetas: [], asignado: null, ...ticket },
    columna: "todo",
    chip: null,
    avance: null,
    accion: { tipo: "run", habilitada: true, motivo: null },
    run: null,
    tieneRepo: true,
    ...resto,
  };
}

const chip = (tipo) => ({ tipo, texto: tipo, detalle: null });
const run = (itemId) => ({ itemId, estado: "x", pr: null });

test("los filtros se combinan: todos a la vez, no el ultimo", () => {
  const tarjetas = [
    tarjeta("A-1", { ticket: { asignado: { nombre: "Ana" }, etiquetas: ["api"] } }),
    tarjeta("A-2", { ticket: { asignado: { nombre: "Ana" }, etiquetas: ["ui"] } }),
    tarjeta("A-3", { ticket: { asignado: { nombre: "Leo" }, etiquetas: ["api"] }, tieneRepo: false }),
    tarjeta("P-1", { proyecto: { id: "portal", nombre: "Portal" }, ticket: { asignado: { nombre: "Ana" }, etiquetas: ["api"] } }),
  ];

  const filtradas = filtrarTarjetas(tarjetas, {
    ...FILTROS_VACIOS,
    proyecto: "pagos",
    asignado: "Ana",
    etiqueta: "api",
  });
  assert.deepEqual(filtradas.map((t) => t.id), ["A-1"]);

  assert.deepEqual(
    filtrarTarjetas(tarjetas, { ...FILTROS_VACIOS, repo: "sin" }).map((t) => t.id),
    ["A-3"],
  );
});

test("el texto busca sin acentos y exige todas las palabras", () => {
  const tarjetas = [
    tarjeta("CORE-142", { ticket: { titulo: "Revisión del IBAN", etiquetas: ["api"] } }),
    tarjeta("CORE-143", { ticket: { titulo: "Revisión del IBAN", etiquetas: ["ui"] } }),
  ];
  assert.deepEqual(
    filtrarTarjetas(tarjetas, { ...FILTROS_VACIOS, texto: "revision api" }).map((t) => t.id),
    ["CORE-142"],
  );
  assert.deepEqual(
    filtrarTarjetas(tarjetas, { ...FILTROS_VACIOS, texto: "142" }).map((t) => t.id),
    ["CORE-142"],
  );
});

test("«sin asignar» es un valor del filtro, no un nombre", () => {
  const tarjetas = [tarjeta("A"), tarjeta("B", { ticket: { asignado: { nombre: "Ana" } } })];
  assert.deepEqual(
    filtrarTarjetas(tarjetas, { ...FILTROS_VACIOS, asignado: SIN_ASIGNAR }).map((t) => t.id),
    ["A"],
  );
  const opciones = opcionesDeFiltro(tarjetas);
  assert.equal(opciones.haySinAsignar, true);
  assert.deepEqual(opciones.asignados, ["Ana"]);
});

test("el proyecto es navegacion, no un filtro que cuente como puesto", () => {
  assert.equal(hayFiltros({ ...FILTROS_VACIOS, proyecto: "pagos" }), false);
  assert.equal(hayFiltros({ ...FILTROS_VACIOS, texto: "  " }), false);
  assert.equal(hayFiltros({ ...FILTROS_VACIOS, repo: "con" }), true);
});

test("las tarjetas se reparten en las seis columnas, en el orden del servicio", () => {
  const grupos = agruparPorColumna([
    tarjeta("1", { columna: "in_progress" }),
    tarjeta("2", { columna: "blocked" }),
    tarjeta("3", { columna: "in_progress" }),
    tarjeta("4", { columna: "done" }),
    tarjeta("5", { columna: "columna-que-no-existe" }),
  ]);
  assert.deepEqual(grupos.in_progress.map((t) => t.id), ["1", "3", "5"]);
  assert.deepEqual(grupos.blocked.map((t) => t.id), ["2"]);
  assert.deepEqual(grupos.done.map((t) => t.id), ["4"]);
  assert.deepEqual(Object.keys(grupos).sort(), ["backlog", "blocked", "done", "in_progress", "in_review", "todo"]);
});

test("el resumen cuenta lo que te necesita, y fallido no es una decision", () => {
  const resumen = resumirTarjetas([
    tarjeta("1", { chip: chip("fase") }),
    tarjeta("2", { chip: chip("fase") }),
    tarjeta("3", { chip: chip("necesita_permiso") }),
    tarjeta("4", { chip: chip("plan_listo") }),
    tarjeta("5", { chip: chip("bloqueado") }),
    tarjeta("6", { chip: chip("necesita_criterios") }),
    tarjeta("7", { chip: chip("fallido") }),
    tarjeta("8", { chip: chip("en_cola") }),
    tarjeta("9", { chip: chip("pr_listo") }),
    tarjeta("10"),
  ]);
  assert.deepEqual(resumen, { enCurso: 2, teNecesitan: 4, enCola: 1 });
});

test("runs activos: con run y chip, lo urgente primero, sin los PR listos", () => {
  const activos = runsActivos([
    tarjeta("cola", { chip: chip("en_cola"), run: run("cola") }),
    tarjeta("fase", { chip: chip("fase"), run: run("fase") }),
    tarjeta("pr", { chip: chip("pr_listo"), run: run("pr") }),
    tarjeta("permiso", { chip: chip("necesita_permiso"), run: run("permiso") }),
    tarjeta("sin-run", { chip: chip("sin_repo") }),
    tarjeta("fallo", { chip: chip("fallido"), run: run("fallo") }),
  ]);
  assert.deepEqual(activos.map((t) => t.id), ["permiso", "fallo", "fase", "cola"]);
});

test("pequenas derivaciones: iniciales, ejecutor, gestor y color estable", () => {
  assert.equal(iniciales("Ana Ruiz Gomez"), "AG");
  assert.equal(iniciales("leo"), "LE");
  assert.equal(inicialesDeEjecutor({ runtime: "claude-agent-sdk" }), "CL");
  assert.equal(inicialesDeEjecutor({ runtime: "codex", agente: "revisor estricto" }), "RE");
  assert.equal(etiquetaDeGestor("local"), "Local");
  assert.equal(etiquetaDeGestor("azure-devops"), "ADO");
  assert.equal(etiquetaDeGestor(null), "Local");
  // El mismo proyecto, el mismo color, siempre; el hex del servicio manda.
  assert.equal(colorDeProyecto({ id: "pagos" }), colorDeProyecto({ id: "pagos" }));
  assert.equal(colorDeProyecto({ id: "pagos", color: "#ff0000" }), "#ff0000");
  assert.match(colorDeProyecto({ id: "pagos", color: "rojo; background:url(x)" }), /^var\(--ds-/);
});
