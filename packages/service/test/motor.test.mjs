// El puente proyecto-motor: de lo que el almacen sabe de un proyecto a la
// configuracion que el motor necesita para correr sobre el.
//
// POR QUE ESTE ARCHIVO ES EL CENTRO DE LA SPEC 003. Hasta aqui ningun camino
// del producto llevaba de un proyecto del Studio a una configuracion del motor:
// el test de punta a punta la armaba a mano (`configDelMotor`). Sin este
// puente no hay boton Run, y lo que se afirma aqui es que el puente sale de
// HECHOS del almacen y del repositorio —el remoto, el runner detectado, la
// conexion del gestor— y no de valores supuestos. Lo que falta se nombra con
// su codigo (`sin_repo`, `sin_gate`, `sin_gestor`) en vez de rellenarse.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  componerConfig,
  datosDelProyecto,
  diagnosticar,
  gateDelRunner,
  leerGit,
  gestorDelSlug,
  prepararMotor,
  repoDelRemoto,
} from "../src/motor.mjs";
import * as github from "../../../providers/github/index.mjs";
import { validate } from "../../engine/src/schema.mjs";
import { loadConfig } from "../../engine/src/config.mjs";
import { conServicio, diferencias, huellaDelArbol } from "./ayuda.mjs";
import { proyectoActivo, repoConRemoto } from "./ayuda-motor.mjs";

const RAIZ = new URL("../../../", import.meta.url).pathname;
const ESQUEMA = JSON.parse(readFileSync(join(RAIZ, "packages/engine/schemas/config.schema.json"), "utf8"));

/** Lo minimo que `componerConfig` necesita, como lo dejaria `datosDelProyecto`. */
function entrada(extra = {}) {
  return {
    proyecto: { id: "prj-1", nombre: "La App", slug: "la-app", ruta_local: "/tmp/la-app", autonomia: "L2" },
    home: "/tmp/home-del-servicio",
    remoto: "git@github.com:acme/la-app.git",
    ramaBase: "main",
    gate: { comando: "npm test", de: "testing.runner = node --test (package.json)" },
    gestor: { nombre: "fake", conexion: "c-1", origen: "tracker" },
    raizDeProveedores: "/opt/noxloop/providers",
    ...extra,
  };
}

/** @param {() => any} fn */
function codigoDe(fn) {
  try {
    fn();
  } catch (e) {
    return { codigo: e.codigo, causa: e.causa, accion: e.accion };
  }
  return null;
}

// ---------------------------------------------------------------------------
// La composicion, pura
// ---------------------------------------------------------------------------

test("compone una configuracion que el esquema del motor acepta tal cual", () => {
  const config = componerConfig(entrada());
  assert.deepEqual(validate(ESQUEMA, config), [], "el motor la rechazaria al cargar, despues del clic en Run");

  assert.equal(config.home, "/tmp/home-del-servicio", "el motor tiene que escribir en el MISMO home que el servicio lee");
  assert.equal(config.provider.name, "fake");
  assert.equal(config.provider.module, "/opt/noxloop/providers/fake/index.mjs");
  const [clave] = Object.keys(config.repos);
  assert.equal(config.repos[clave].path, "/tmp/la-app");
  assert.equal(config.repos[clave].remote, "git@github.com:acme/la-app.git");
  assert.equal(config.repos[clave].baseBranch, "main");
  assert.equal(config.repos[clave].gate, "npm test");
  assert.ok(config.limits.maxParallelItems >= 1, "sin tope la cola del servicio no tiene contra que medir");
});

test("las opciones que el esquema del proveedor pide y el remoto sabe (`owner/repo`) salen del remoto", () => {
  for (const remoto of ["git@forja.test:acme/la-app.git", "https://forja.test/acme/la-app", "ssh://git@forja.test:22/acme/la-app.git"]) {
    const config = componerConfig(
      entrada({ remoto, gestor: { nombre: "github", conexion: "c-2", origen: "scm" }, esquemaDeOpciones: github.optionsSchema }),
    );
    assert.deepEqual(config.provider.options, { owner: "acme", repo: "la-app" }, remoto);
    assert.deepEqual(validate(ESQUEMA, config), []);
  }
});

test("lo que el esquema del proveedor EXIGE y nadie declara se dice al pulsar Run: `sin_gestor`", () => {
  const e = codigoDe(() =>
    componerConfig(
      entrada({
        gestor: { nombre: "otro", conexion: "c", origen: "tracker" },
        esquemaDeOpciones: { type: "object", required: ["organization", "project"], properties: {} },
      }),
    ),
  );
  assert.equal(e?.codigo, "sin_gestor");
  assert.match(e.causa, /`organization` y `project`/);

  const bien = componerConfig(
    entrada({
      gestor: { nombre: "otro", conexion: "c", origen: "tracker", opciones: { organization: "o", project: "p" } },
      esquemaDeOpciones: { type: "object", required: ["organization", "project"], properties: {} },
    }),
  );
  assert.deepEqual(bien.provider.options, { organization: "o", project: "p" }, "las opciones vienen de la conexion");
});

test("sin remoto -> `sin_repo`, sin gate -> `sin_gate`, sin gestor -> `sin_gestor`, cada uno con su accion", () => {
  const sinRepo = codigoDe(() => componerConfig(entrada({ remoto: null })));
  assert.equal(sinRepo?.codigo, "sin_repo");
  assert.match(sinRepo.causa, /La App/, "la causa tiene que nombrar el proyecto");

  const sinGate = codigoDe(() => componerConfig(entrada({ gate: null, gateHallado: "el snapshot no encontro runner" })));
  assert.equal(sinGate?.codigo, "sin_gate");
  assert.match(sinGate.causa, /no encontro runner/, "la causa tiene que decir que se busco y que se encontro");

  const sinGestor = codigoDe(() => componerConfig(entrada({ gestor: null, gestorHallado: "no hay conexion tracker" })));
  assert.equal(sinGestor?.codigo, "sin_gestor");

  for (const e of [sinRepo, sinGate, sinGestor]) assert.ok(e.accion.length > 30, `${e.codigo}: accion vacia`);
});

test("un remoto sin forma de forja (una ruta local) no da `owner/repo` inventados: `sin_gestor`", () => {
  const e = codigoDe(() =>
    componerConfig(
      entrada({ remoto: "/tmp/origin.git", gestor: { nombre: "github", conexion: "c", origen: "scm" }, esquemaDeOpciones: github.optionsSchema }),
    ),
  );
  assert.equal(e?.codigo, "sin_gestor");
  assert.match(e.causa, /owner/);
});

test("el gestor sale de los DATOS: el slug de la conexion es el directorio del proveedor", () => {
  assert.equal(gestorDelSlug("fake"), "fake");
  assert.equal(gestorDelSlug("linear"), "linear");
  assert.equal(gestorDelSlug("falso-oauth2"), "fake", "el tracker del adaptador falso va al proveedor falso");
  assert.equal(gestorDelSlug("jira"), null, "sin `providers/jira/` no hay gestor, y no se finge otro");
  assert.equal(gestorDelSlug("../fake"), null, "un slug no es una ruta");
});

test("el gate sale del runner detectado; lo que no se sabe correr no se supone", () => {
  assert.equal(gateDelRunner("node --test", [{ ruta: "package.json" }])?.comando, "npm test");
  assert.equal(gateDelRunner("un script raro", [{ ruta: "package.json" }])?.comando, "npm test");
  assert.equal(gateDelRunner("pytest", [{ ruta: "pytest.ini" }])?.comando, "pytest");
  assert.equal(gateDelRunner("cargo test", [{ ruta: "Cargo.toml" }])?.comando, "cargo test");
  assert.equal(gateDelRunner(null, [{ ruta: "." }]), null, "sin runner no hay gate");
  assert.equal(gateDelRunner("karma", [{ ruta: "karma.conf.js" }]), null, "un runner sin comando conocido no se inventa");
});

test("el runner de un test suelto (bucle RED/GREEN) sale del mismo hallazgo, y sin el no se inventa", () => {
  assert.equal(gateDelRunner("node --test", [{ ruta: "package.json" }])?.suelto, "node --test {file}");
  assert.equal(gateDelRunner("pytest", [{ ruta: "pytest.ini" }])?.suelto, "pytest {file}");
  assert.equal(gateDelRunner("un script raro", [{ ruta: "package.json" }])?.suelto, null);

  const conSuelto = componerConfig(
    entrada({ gate: { comando: "npm test", de: "x", suelto: "node --test {file}" } }),
  );
  assert.deepEqual(Object.values(conSuelto.repos)[0].runners, { test: "node --test {file}" });
  const sinSuelto = componerConfig(entrada());
  assert.equal(Object.values(sinSuelto.repos)[0].runners, undefined);
  assert.ok(
    Object.values(sinSuelto.repos)[0].gaps.some((g) => /test suelto/.test(g)),
    "sin runner suelto el motor no puede verificar el rojo de un test: el hueco se declara en el PR",
  );
});

test("`repoDelRemoto` reconoce la forma de un remoto de forja, no un host concreto", () => {
  assert.deepEqual(repoDelRemoto("git@forja.test:acme/app.git"), { host: "forja.test", owner: "acme", repo: "app" });
  assert.deepEqual(repoDelRemoto("ssh://git@forja.test/acme/app.git"), { host: "forja.test", owner: "acme", repo: "app" });
  assert.deepEqual(repoDelRemoto("https://otra.test/acme/app"), { host: "otra.test", owner: "acme", repo: "app" });
  assert.equal(repoDelRemoto("/srv/origin.git"), null);
  assert.equal(repoDelRemoto(null), null);
});

// ---------------------------------------------------------------------------
// Lo que se lee del repositorio y del almacen
// ---------------------------------------------------------------------------

test("`leerGit` lee el remoto y la rama sin tocar el repositorio (ni `git status`)", () => {
  const org = repoConRemoto();
  const antes = huellaDelArbol(org.repo);
  assert.deepEqual(leerGit(org.repo), { remoto: org.remoto, rama: "main" });
  assert.deepEqual(diferencias(antes, huellaDelArbol(org.repo)), [], "leer el remoto escribio en el repositorio");

  const sinRemoto = repoConRemoto({ remoto: null });
  assert.deepEqual(leerGit(sinRemoto.repo), { remoto: null, rama: "main" });
  assert.deepEqual(leerGit("/no/existe/esto"), { remoto: null, rama: null });
});

test("datos del proyecto: remoto del repo, gate del snapshot, gestor de la conexion tracker", async () => {
  await conServicio({}, async (svc) => {
    const proyecto = await proyectoActivo(svc);
    const d = datosDelProyecto(svc.dep, proyecto);
    assert.ok(d.remoto, "el proyecto se dio de alta sin `remoto` y el repo tiene `origin`: tiene que encontrarlo");
    assert.equal(d.ramaBase, "main");
    assert.equal(d.gate?.comando, "npm test");
    assert.equal(d.gestor?.nombre, "fake");
    assert.equal(d.gestor?.origen, "tracker");
  });
});

test("el valor corregido por el operador gana, y un hallazgo descartado no da gate", async () => {
  await conServicio({}, async (svc) => {
    const corregido = await proyectoActivo(svc, {
      nombre: "Corregido",
      runner: { valor: "jest", evidencia: [{ ruta: "jest.config.js" }], decision: "corregido", valor_corregido: "pytest" },
    });
    assert.equal(datosDelProyecto(svc.dep, corregido).gate?.comando, "pytest");

    const descartado = await proyectoActivo(svc, { nombre: "Descartado", runner: { valor: "node --test", decision: "descartado" } });
    const d = datosDelProyecto(svc.dep, descartado);
    assert.equal(d.gate, null);
    assert.match(d.gateHallado, /descart/);

    const sinSnapshot = await proyectoActivo(svc, { nombre: "Sin Snapshot", runner: null });
    assert.equal(datosDelProyecto(svc.dep, sinSnapshot).gate, null);
  });
});

test("el gestor: tracker del proyecto gana; si no hay, la cuenta de codigo con proveedor hace de gestor; si no, ninguno", async () => {
  await conServicio({}, async (svc) => {
    const conLos2 = await proyectoActivo(svc, {
      nombre: "Con Los Dos",
      conexiones: [
        { clase: "scm", proveedor: "github" },
        { clase: "tracker", proveedor: "linear" },
      ],
    });
    assert.equal(datosDelProyecto(svc.dep, conLos2).gestor?.nombre, "linear");

    const soloGithub = await proyectoActivo(svc, {
      nombre: "Solo GitHub",
      conexiones: [{ clase: "scm", proveedor: "github", delEspacio: true }],
    });
    const g = datosDelProyecto(svc.dep, soloGithub).gestor;
    assert.equal(g?.nombre, "github", "los issues viven en la cuenta de codigo, y esa es del espacio de trabajo");
    assert.equal(g?.origen, "scm");

    const caida = await proyectoActivo(svc, {
      nombre: "Caida",
      conexiones: [{ clase: "tracker", proveedor: "linear", estado: "expirada" }],
    });
    const d = datosDelProyecto(svc.dep, caida);
    // Se mira SOLO este proyecto: la del espacio de trabajo de arriba es GitHub.
    assert.equal(d.gestor?.nombre, "github", "una conexion expirada no es gestor; la del espacio si");

    const tracker = await proyectoActivo(svc, {
      nombre: "Jira",
      conexiones: [{ clase: "tracker", proveedor: "jira" }],
    });
    const j = datosDelProyecto(svc.dep, tracker);
    assert.equal(j.gestor, null, "no hay proveedor del motor para `jira`: no se finge otro");
    assert.match(j.gestorHallado, /jira/);
  });
});

test("`diagnosticar` no lanza nunca: dice si se puede lanzar y, si no, por que", async () => {
  await conServicio({}, async (svc) => {
    const bueno = await proyectoActivo(svc, { nombre: "Bueno" });
    const d1 = await diagnosticar(svc.dep, bueno);
    assert.equal(d1.lanzable, true, JSON.stringify(d1));
    assert.equal(d1.tieneRepo, true);

    const sinRepo = await proyectoActivo(svc, { nombre: "Sin Repo", ruta: repoConRemoto({ remoto: null }).repo });
    const d2 = await diagnosticar(svc.dep, sinRepo);
    assert.equal(d2.lanzable, false);
    assert.equal(d2.tieneRepo, false);
    assert.equal(d2.problema.codigo, "sin_repo");
    assert.ok(d2.problema.causa.length > 20);
  });
});

test("`prepararMotor` la escribe en `<home>/motor/<proyecto>.config.json` y el motor la carga", async () => {
  await conServicio({}, async (svc) => {
    const proyecto = await proyectoActivo(svc);
    const { ruta, config } = await prepararMotor(svc.dep, proyecto, { home: svc.home });
    assert.equal(ruta, join(svc.home, "motor", `${proyecto.id}.config.json`));
    assert.ok(existsSync(ruta));
    assert.equal(config.home, svc.home);

    // Lo carga el MISMO cargador que usa la CLI del motor: si no valida, el
    // subproceso moriria al arrancar con el operador ya esperando.
    const cargada = loadConfig(ruta, { env: {} });
    assert.equal(cargada.provider.name, "fake");
    assert.ok(existsSync(cargada.provider.module), `el modulo del gestor no existe: ${cargada.provider.module}`);
    // Y fuera del repositorio del operador (principio III).
    assert.ok(!ruta.startsWith(proyecto.ruta_local));
  });
});

// ---------------------------------------------------------------------------
// El runtime por rol: la flota del proyecto llega al motor (FR-031 y FR-034)
// ---------------------------------------------------------------------------

test("con la flota, la configuracion lleva el runtime de cada rol y el esquema del motor la acepta", () => {
  const config = componerConfig(entrada({
    ejecutor: { runtime: "codex", agente: null, de: "la tarea" },
    flota: { revisor: { runtime: "claude-agent-sdk", nombre: "rev" }, planificador: { runtime: "claude-agent-sdk", nombre: "plan" } },
  }));
  assert.deepEqual(validate(ESQUEMA, config), []);
  assert.deepEqual(config.runtimes, { implementador: "codex", revisor: "claude-agent-sdk", planificador: "claude-agent-sdk" });
});

test("sin revisor ni planificador en la flota, `runtimes` no los inventa", () => {
  const config = componerConfig(entrada({
    ejecutor: { runtime: "claude-agent-sdk", agente: null, de: "el proyecto" },
    flota: { revisor: null, planificador: null },
  }));
  assert.deepEqual(config.runtimes, { implementador: "claude-agent-sdk" });
});

test("FR-034: si la cascada pone al implementador en el runtime del revisor, se niega al componer, con causa y accion", () => {
  // La flota lo impide al guardar, pero la tarea puede elegir su ejecutor: una
  // tarea con `codex` en un proyecto cuyo revisor es `codex` se revisaria a si
  // misma. Se dice al pulsar Run, no a mitad del recorrido.
  const e = codigoDe(() => componerConfig(entrada({
    ejecutor: { runtime: "codex", agente: null, de: "la tarea" },
    flota: { revisor: { runtime: "codex", nombre: "el revisor" }, planificador: null },
  })));
  assert.equal(e?.codigo, "revisor_comparte_runtime");
  assert.match(e.causa, /el revisor/);
  assert.match(e.causa, /codex/);
  assert.ok(e.accion.length > 0);
});

test("`prepararMotor` deriva los runtimes de la flota del proyecto, y el motor los carga", async () => {
  await conServicio({}, async (svc) => {
    const proyecto = await proyectoActivo(svc);
    const agentes = svc.dep.almacen.agentes;
    agentes.crear({ project_id: proyecto.id, nombre: "impl", rol: "implementador", runtime: "claude-agent-sdk", modelo: "m" });
    agentes.crear({ project_id: proyecto.id, nombre: "rev", rol: "revisor", runtime: "codex", modelo: "m" });

    const { ruta, config } = await prepararMotor(svc.dep, proyecto, {
      home: svc.home, ejecutor: { runtime: "claude-agent-sdk", agente: null },
    });
    assert.deepEqual(config.runtimes, { implementador: "claude-agent-sdk", revisor: "codex" });
    assert.deepEqual(loadConfig(ruta, { env: {} }).runtimes, config.runtimes);

    // Una tarea que elige `codex` para implementar choca con el revisor.
    await assert.rejects(
      prepararMotor(svc.dep, proyecto, { home: svc.home, ejecutor: { runtime: "codex", agente: null, de: "la tarea" } }),
      (/** @type {any} */ e) => e.codigo === "revisor_comparte_runtime",
    );
  });
});
