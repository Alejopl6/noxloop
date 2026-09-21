// T186/T187 — el modelo de flota, validado AL GUARDAR.
//
// EL FALLO QUE EVITA VALIDAR AL GUARDAR Y NO AL EJECUTAR. Un revisor que
// comparte runtime con el implementador descubierto a mitad de un run cuesta el
// run entero: worktrees creados, gates corridos, modelo pagado, y el operador se
// entera cuando la revision ya salio confirmando. La configuracion se escribe
// una vez y se ejecuta miles; el sitio barato de fallar es el primero.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import {
  ROLES,
  crearAgente,
  guardarAgente,
  activarFlota,
  validarFlota,
} from "../src/flota/agente.mjs";
import { repositorioDeFlotaEnMemoria } from "../src/flota/repositorio.mjs";
import { registroDeAdaptadores } from "../src/registro.mjs";
import { crearAdaptadorFake } from "../src/adaptadores/fake.mjs";
import { crearAdaptadorCodex } from "../src/adaptadores/codex.mjs";
import { crearAdaptadorClaude } from "../src/adaptadores/claude-agent-sdk.mjs";
import { ErrorDeAdaptador } from "../src/errores.mjs";
import { capturar, directorioTemporal, crear } from "./ayuda.mjs";

function montar(t) {
  const dir = directorioTemporal(t);
  const home = crear(join(dir, "home"));
  const adaptadores = registroDeAdaptadores([
    crearAdaptadorClaude({ home, hooks: { PreToolUse: [{ matcher: "Edit", hooks: [] }] } }),
    crearAdaptadorCodex({ home }),
    crearAdaptadorFake({ home, hooks: [] }),
  ]);
  return { repositorio: repositorioDeFlotaEnMemoria(), adaptadores, home };
}

const BASE = {
  project_id: "p1",
  modelo: "modelo-x",
  skills: [],
  tools: [],
  mcps: [],
  permisos: { escribir: true },
  presupuesto: { intentos: 3, tokens: 100000, minutos: 30 },
  contexto: { constitution: true, guidelines: ["backend"] },
};

test("T187 — un agente lleva rol, runtime, modelo, skills, tools, MCP, permisos, presupuesto y contexto", (t) => {
  const { adaptadores } = montar(t);
  const a = crearAgente({ ...BASE, nombre: "impl", rol: "implementador", runtime: "claude-agent-sdk" });
  for (const campo of [
    "id", "project_id", "nombre", "rol", "runtime", "modelo",
    "skills", "tools", "mcps", "permisos", "presupuesto", "contexto",
  ]) {
    assert.ok(campo in a, `al agente le falta \`${campo}\``);
  }
  assert.deepEqual([...ROLES], ["implementador", "revisor", "planificador", "verificador"]);
  assert.ok(adaptadores.tiene("claude-agent-sdk"));
});

test("T186 — guardar un revisor con el runtime del implementador se rechaza con `revisor_comparte_runtime`", (t) => {
  const { repositorio, adaptadores } = montar(t);

  guardarAgente({
    agente: crearAgente({ ...BASE, nombre: "impl", rol: "implementador", runtime: "claude-agent-sdk" }),
    repositorio,
    adaptadores,
  });

  const revisor = crearAgente({ ...BASE, nombre: "rev", rol: "revisor", runtime: "claude-agent-sdk" });
  const e = capturar(() => guardarAgente({ agente: revisor, repositorio, adaptadores }));
  assert.ok(e instanceof ErrorDeAdaptador, `no es un ErrorDeAdaptador: ${e}`);
  assert.equal(e.codigo, "revisor_comparte_runtime");
  assert.ok(e.causa.includes("claude-agent-sdk"), "la causa no nombra el runtime compartido");
  assert.ok(e.accion.length > 0);
  assert.equal(repositorio.agentes("p1").length, 1, "el revisor invalido se guardo igual");
});

test("T186 — la regla vale en los dos ordenes: el implementador tambien choca con el revisor ya guardado", (t) => {
  const { repositorio, adaptadores } = montar(t);
  guardarAgente({
    agente: crearAgente({ ...BASE, nombre: "rev", rol: "revisor", runtime: "codex" }),
    repositorio,
    adaptadores,
  });
  assert.throws(
    () => guardarAgente({
      agente: crearAgente({ ...BASE, nombre: "impl", rol: "implementador", runtime: "codex" }),
      repositorio,
      adaptadores,
    }),
    /revisor/,
  );
});

test("T186 — y solo dentro del MISMO proyecto: otro proyecto no hereda la restriccion", (t) => {
  const { repositorio, adaptadores } = montar(t);
  guardarAgente({
    agente: crearAgente({ ...BASE, nombre: "impl", rol: "implementador", runtime: "claude-agent-sdk" }),
    repositorio, adaptadores,
  });
  guardarAgente({
    agente: crearAgente({ ...BASE, project_id: "p2", nombre: "rev", rol: "revisor", runtime: "claude-agent-sdk" }),
    repositorio, adaptadores,
  });
  assert.equal(repositorio.agentes("p2").length, 1);
});

test("un runtime que no esta registrado se rechaza al guardar, no al ejecutar", (t) => {
  const { repositorio, adaptadores } = montar(t);
  const e = capturar(() => guardarAgente({
      agente: crearAgente({ ...BASE, nombre: "x", rol: "implementador", runtime: "inventado" }),
      repositorio, adaptadores,
    }));
  assert.ok(e instanceof ErrorDeAdaptador, `no es un ErrorDeAdaptador: ${e}`);
  assert.equal(e.codigo, "runtime_desconocido");
  assert.ok(e.causa.includes("codex"), "la causa no lista los runtimes que si existen");
});

test("regla 5 — un runtime con hooks:false no es elegible para implementador, y se dice al guardar", (t) => {
  const { repositorio, adaptadores } = montar(t);
  // Codex declara `hooks: false`. Sin hooks, el paso RED depende de que el
  // prompt se acuerde, y ya esta medido que deja de funcionar en la tercera
  // iteracion. Como revisor si vale: la revision no escribe codigo.
  const e = capturar(() => guardarAgente({
      agente: crearAgente({ ...BASE, nombre: "impl", rol: "implementador", runtime: "codex" }),
      repositorio, adaptadores,
    }));
  assert.ok(e instanceof ErrorDeAdaptador, `no es un ErrorDeAdaptador: ${e}`);
  assert.equal(e.codigo, "runtime_sin_hooks_para_implementador");

  guardarAgente({
    agente: crearAgente({ ...BASE, nombre: "rev", rol: "revisor", runtime: "codex" }),
    repositorio, adaptadores,
  });
  assert.equal(repositorio.agentes("p1").length, 1);
});

test("regla 2 — un presupuesto en USD sobre un runtime que no reporta gasto se rechaza al guardar", (t) => {
  const { repositorio, adaptadores } = montar(t);
  // "Un limite que se lee como puesto y no lo esta es peor que no tenerlo":
  // codex declara `cost:false`, asi que un techo de USD no podria dispararse
  // nunca. Se dice al guardarlo, que es cuando el operador lo esta escribiendo.
  const e = capturar(() => guardarAgente({
      agente: crearAgente({
        ...BASE, nombre: "rev", rol: "revisor", runtime: "codex",
        presupuesto: { ...BASE.presupuesto, usd: 5 },
      }),
      repositorio, adaptadores,
    }));
  assert.ok(e instanceof ErrorDeAdaptador, `no es un ErrorDeAdaptador: ${e}`);
  assert.equal(e.codigo, "techo_de_gasto_inaplicable");
});

test("T187 — la flota completa produce el artefacto que lleva el proyecto a ACTIVE", (t) => {
  const { repositorio, adaptadores } = montar(t);
  guardarAgente({
    agente: crearAgente({ ...BASE, nombre: "impl", rol: "implementador", runtime: "claude-agent-sdk" }),
    repositorio, adaptadores,
  });
  guardarAgente({
    agente: crearAgente({ ...BASE, nombre: "rev", rol: "revisor", runtime: "codex" }),
    repositorio, adaptadores,
  });

  const artefacto = activarFlota({ project_id: "p1", repositorio, adaptadores });
  assert.equal(artefacto.estado, "ACTIVE");
  assert.equal(artefacto.agentes.length, 2);
  assert.deepEqual(artefacto.runtimes.sort(), ["claude-agent-sdk", "codex"]);
  // El artefacto declara lo que cada runtime NO sabe hacer, porque el motor
  // tiene que decirlo al arrancar el run en vez de aplicar limites que no
  // pueden dispararse.
  assert.ok(artefacto.degradaciones.some((d) => d.includes("codex")));
});

test("T187 — sin revisor no hay ACTIVE, y el error nombra el rol que falta", (t) => {
  const { repositorio, adaptadores } = montar(t);
  guardarAgente({
    agente: crearAgente({ ...BASE, nombre: "impl", rol: "implementador", runtime: "claude-agent-sdk" }),
    repositorio, adaptadores,
  });
  const e = capturar(() => activarFlota({ project_id: "p1", repositorio, adaptadores }));
  assert.ok(e instanceof ErrorDeAdaptador, `no es un ErrorDeAdaptador: ${e}`);
  assert.equal(e.codigo, "flota_incompleta");
  assert.ok(e.causa.includes("revisor"));
});

test("validarFlota devuelve los problemas sin lanzar, para que la pantalla los pinte todos juntos", (t) => {
  const { repositorio, adaptadores } = montar(t);
  const problemas = validarFlota({
    agentes: [
      crearAgente({ ...BASE, nombre: "a", rol: "implementador", runtime: "codex" }),
      crearAgente({ ...BASE, nombre: "b", rol: "revisor", runtime: "codex" }),
    ],
    adaptadores,
  });
  const codigos = problemas.map((p) => p.codigo).sort();
  assert.deepEqual(codigos, ["revisor_comparte_runtime", "runtime_sin_hooks_para_implementador"]);
  assert.equal(repositorio.agentes("p1").length, 0);
});

test("la persistencia va inyectada: el modelo de flota no conoce ningun almacen", async () => {
  const { readFileSync } = await import("node:fs");
  const fuente = readFileSync(new URL("../src/flota/agente.mjs", import.meta.url), "utf8");
  for (const prohibido of ["node:fs", "sqlite", "node:sqlite"]) {
    assert.ok(!fuente.includes(prohibido), `el modelo de flota alcanzo el almacen por su cuenta (${prohibido})`);
  }
});
