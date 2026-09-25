// «Pasar a otro agente» (spec 005, US3, FR-007): lo que la interfaz decide del
// hand-off antes de pedirlo.
//
// La regla la aplica el servicio —y el motor otra vez, al escribir—; lo que se
// prueba aqui es que el SELECTOR no ofrezca lo que el servicio va a rechazar:
// el runtime del revisor (FR-034), el que ya implementa la tarea, y uno sin
// sesion. Ofrecerlos no rompe nada —el 409 llega con su causa—, pero un menu
// que ofrece opciones que siempre fallan es un menu que miente.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  destinosDeHandoff,
  implementadorDeTarea,
  runtimesDeLosEventos,
  tareasTraspasables,
} from "../components/runs/handoff.ts";

const RUNTIMES = [
  { runtime: "claude-agent-sdk", nombre: "Claude Code", conectado: true, metodo: "suscripcion_claude", detalle: "ok" },
  { runtime: "codex", nombre: "Codex", conectado: true, metodo: "cuenta_chatgpt", detalle: "ok" },
  { runtime: "otro", nombre: "Otro", conectado: false, metodo: null, detalle: "sin sesion", accion: "Conecta en Settings → Modelos" },
];

test("el selector excluye al revisor y al implementador actual; el desconectado sale deshabilitado con su motivo", () => {
  const d = destinosDeHandoff({ runtimes: RUNTIMES, revisor: "codex", actual: "claude-agent-sdk" });
  const por = Object.fromEntries(d.map((x) => [x.runtime, x]));
  assert.equal(por["codex"].habilitado, false, "se ofrecio el runtime del revisor");
  assert.match(por["codex"].motivo, /revisor/i);
  assert.equal(por["claude-agent-sdk"].habilitado, false, "se ofrecio pasarle la tarea a quien ya la tiene");
  assert.equal(por["otro"].habilitado, false);
  assert.match(por["otro"].motivo, /Modelos|sesion/);
});

test("sin revisor declarado, el otro runtime conectado queda disponible", () => {
  const d = destinosDeHandoff({ runtimes: RUNTIMES, revisor: null, actual: "claude-agent-sdk" });
  assert.deepEqual(d.filter((x) => x.habilitado).map((x) => x.runtime), ["codex"]);
});

test("las tareas que se pueden pasar: las que aun tienen implementacion pendiente", () => {
  const tareas = [
    { id: "T1", status: "blocked" },
    { id: "T2", status: "integrated" },
    { id: "T3", status: "green" },
    { id: "T4", status: "reviewed" },
  ];
  assert.deepEqual(tareasTraspasables(tareas).map((t) => t.id), ["T1", "T3"]);
});

test("el implementador de una tarea: su override de hand-off, o el del run", () => {
  assert.equal(implementadorDeTarea({ id: "T1", status: "blocked", implementador: { runtime: "codex", agente: null } }, "claude-agent-sdk"), "codex");
  assert.equal(implementadorDeTarea({ id: "T1", status: "blocked" }, "claude-agent-sdk"), "claude-agent-sdk");
});

test("quien hizo una fase: los runtimes que el motor estampo en sus eventos, en orden de aparicion", () => {
  const eventos = [
    { t: "1", tipo: "texto", contenido: "a", runtime: "codex" },
    { t: "2", tipo: "resultado", contenido: "b", runtime: "codex" },
    { t: "3", tipo: "texto", contenido: "c", runtime: "claude-agent-sdk" },
    { t: "4", tipo: "texto", contenido: "d" },
  ];
  assert.deepEqual(runtimesDeLosEventos(eventos), ["codex", "claude-agent-sdk"]);
});
