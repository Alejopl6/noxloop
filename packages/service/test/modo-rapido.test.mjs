// El modo rapido: de «nombre + carpeta» al board en un clic (spec 003, US8).
//
// EL PROBLEMA QUE CIERRA, visto en la maquina del operador. Tres proyectos en
// `CREATED` y el board los ignoraba, porque el board solo pinta `ACTIVE` y
// llegar ahi exigia recorrer siete pantallas del asistente. El referente
// (Nodal) lo resuelve con «proyecto = nombre + repo, y listo», y el operador lo
// dijo asi: «el concepto debe ser simple».
//
// LO QUE ESTE ARCHIVO SE NIEGA A ACEPTAR: un atajo que SALTE las guardas. El
// modo rapido recorre las mismas cinco transiciones que el asistente, cada una
// con su artefacto de verdad en la base —el snapshot, la constitution, las
// recomendaciones decididas, el gestor declarado, la flota— y el almacen las
// sigue juzgando igual. Lo unico que cambia es QUIEN decide cada etapa: una
// sola decision del operador («Activar») en vez de siete. Por eso se mide:
//
//   1. Que el arbol del operador sale byte a byte igual (FR-026 de la 002:
//      nada se escribe sin decision explicita, y «Activar» no es la decision
//      de escribir la constitution ni el bootstrap en su repositorio).
//   2. Que las cinco transiciones quedaron en la auditoria, en orden.
//   3. Que el proyecto aparece en `GET /v1/board` como ACTIVE.
//   4. Que un paso que no se puede dar para en esa etapa con un 409 que la
//      nombra, y el proyecto se queda donde llego — no vuelve atras ni salta.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import { carpetaDePrueba, conServicio, diferencias, huellaDelArbol, pedir } from "./ayuda.mjs";
import { repoConRemoto } from "./ayuda-motor.mjs";

/** Claude conectado; Codex segun `conectados`. El `ejecutar` de `estadoDeAutenticacion`. */
const autenticacion = (conectados = ["claude-agent-sdk", "codex"]) => async (argv) => {
  if (argv[0] === "claude") {
    return {
      code: 0,
      stdout: JSON.stringify({ loggedIn: conectados.includes("claude-agent-sdk"), authMethod: "claude.ai" }),
      stderr: "",
    };
  }
  return { code: 0, stdout: conectados.includes("codex") ? "Logged in using ChatGPT" : "Not logged in", stderr: "" };
};

const opciones = (conectados) => ({ motor: { intervaloMs: 0, ejecutarAutenticacion: autenticacion(conectados) } });

/** @param {any} svc @param {string} ruta @param {any} [cuerpo] */
async function post(svc, ruta, cuerpo) {
  const r = await pedir(svc, ruta, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
  });
  return { estado: r.status, cuerpo: await r.json() };
}

/** @param {any} svc @param {string} ruta */
async function get(svc, ruta) {
  const r = await pedir(svc, ruta);
  return { estado: r.status, cuerpo: await r.json() };
}

/** @param {any} svc @param {string} ruta @param {string} nombre */
async function alta(svc, ruta, nombre = "Payments") {
  const r = await post(svc, "/v1/projects", { origen: "local", nombre, ruta_local: ruta });
  assert.equal(r.estado, 201, JSON.stringify(r.cuerpo));
  return r.cuerpo.proyecto;
}

/** Las transiciones que la auditoria registro para un proyecto, en orden. */
function transiciones(svc, id) {
  return svc.dep.almacen.base
    .consultar(
      "SELECT detalle FROM audit_event WHERE accion = 'proyecto.transicion' AND objeto_id = ? ORDER BY id",
      [id],
    )
    .map((/** @type {any} */ f) => {
      const d = JSON.parse(String(f.detalle));
      return `${d.desde}->${d.hasta}`;
    });
}

test("US8 — repo git desechable -> quickstart -> ACTIVE por las cinco guardas -> aparece en el board, sin tocar el arbol", async () => {
  await conServicio(opciones(["claude-agent-sdk", "codex"]), async (svc) => {
    const { repo } = repoConRemoto();
    const proyecto = await alta(svc, repo);
    assert.equal(proyecto.estado, "CREATED");

    const antes = huellaDelArbol(repo);
    const r = await post(svc, `/v1/projects/${proyecto.id}/quickstart`);
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
    assert.equal(r.cuerpo.proyecto.estado, "ACTIVE");

    // 1. El arbol del operador, igual. La huella primero: `git status` escribe
    //    `.git/index` al consultarlo (ver punta-a-punta.test.mjs).
    assert.deepEqual(diferencias(antes, huellaDelArbol(repo)), [], "el modo rapido escribio en el repositorio del operador");
    assert.equal(execFileSync("git", ["-C", repo, "status", "--porcelain"], { encoding: "utf8" }).trim(), "");

    // 2. Las cinco transiciones, en orden, sin atajos.
    assert.deepEqual(transiciones(svc, proyecto.id), [
      "CREATED->DISCOVERED",
      "DISCOVERED->CONSTITUTED",
      "CONSTITUTED->BOOTSTRAPPED",
      "BOOTSTRAPPED->CONNECTED",
      "CONNECTED->ACTIVE",
    ]);
    // Y cada etapa decidida por el modo rapido dejo su propio rastro.
    const pasos = svc.dep.almacen.base
      .consultar("SELECT detalle FROM audit_event WHERE accion = 'proyecto.modo_rapido' AND objeto_id = ? ORDER BY id", [
        proyecto.id,
      ])
      .map((/** @type {any} */ f) => JSON.parse(String(f.detalle)).etapa);
    assert.deepEqual(pasos, ["snapshot", "constitution", "bootstrap", "conexion", "flota"]);

    // Las guardas, preguntadas al almacen: todas en verde con su artefacto.
    const detalle = await get(svc, `/v1/projects/${proyecto.id}`);
    for (const [nombre, v] of Object.entries(detalle.cuerpo.artefactos)) {
      assert.equal(/** @type {any} */ (v).listo, true, `${nombre}: ${/** @type {any} */ (v).hallado}`);
    }
    assert.match(detalle.cuerpo.artefactos.conexion_viva.hallado, /gestor local/);

    // La flota por defecto: Claude implementa, Codex revisa (FR-034).
    const flota = (await get(svc, `/v1/projects/${proyecto.id}/agents`)).cuerpo.items;
    const porRol = Object.fromEntries(flota.map((/** @type {any} */ a) => [a.rol, a.runtime]));
    assert.deepEqual(porRol, { implementador: "claude-agent-sdk", revisor: "codex" });

    // La respuesta dice que se hizo en cada etapa y que se dejo sin escribir.
    assert.deepEqual(
      r.cuerpo.pasos.map((/** @type {any} */ p) => p.etapa),
      ["snapshot", "constitution", "bootstrap", "conexion", "flota"],
    );
    assert.ok(Array.isArray(r.cuerpo.huecos));
    assert.ok(
      r.cuerpo.huecos.some((/** @type {any} */ h) => h.etapa === "constitution" && /no se escribio/i.test(h.causa)),
      "que la constitution vive solo en el almacen es un hueco, y se dice",
    );

    // 3. El board lo pinta.
    const board = await get(svc, `/v1/board?project=${proyecto.id}`);
    assert.equal(board.estado, 200, JSON.stringify(board.cuerpo));
    const enLista = board.cuerpo.proyectos.find((/** @type {any} */ x) => x.id === proyecto.id);
    assert.ok(enLista, "el proyecto no aparece en el board");
    assert.equal(enLista.estado, "ACTIVE");
    assert.equal(enLista.gestor, "local");

    // Idempotente: sobre un proyecto ACTIVE no hace nada y lo dice.
    const otraVez = await post(svc, `/v1/projects/${proyecto.id}/quickstart`);
    assert.equal(otraVez.estado, 200, JSON.stringify(otraVez.cuerpo));
    assert.equal(otraVez.cuerpo.proyecto.estado, "ACTIVE");
    assert.deepEqual(otraVez.cuerpo.pasos, []);
    assert.equal(transiciones(svc, proyecto.id).length, 5, "un segundo quickstart no transiciona nada");
  });
});

test("US8 — sin Codex conectado: solo implementador, y el revisor que falta se declara hueco", async () => {
  await conServicio(opciones(["claude-agent-sdk"]), async (svc) => {
    const proyecto = await alta(svc, repoConRemoto().repo);
    const r = await post(svc, `/v1/projects/${proyecto.id}/quickstart`);
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
    assert.equal(r.cuerpo.proyecto.estado, "ACTIVE");

    const flota = (await get(svc, `/v1/projects/${proyecto.id}/agents`)).cuerpo.items;
    assert.deepEqual(flota.map((/** @type {any} */ a) => `${a.rol}:${a.runtime}`), ["implementador:claude-agent-sdk"]);
    const hueco = r.cuerpo.huecos.find((/** @type {any} */ h) => h.etapa === "flota");
    assert.ok(hueco, JSON.stringify(r.cuerpo.huecos));
    assert.match(hueco.causa, /revisor/);
    assert.match(hueco.causa, /FR-034|runtime distinto/);
    assert.ok(hueco.accion.length > 20);
  });
});

test("US8 — `POST /v1/projects` con `rapido: true` da de alta y activa en la misma peticion", async () => {
  await conServicio(opciones(), async (svc) => {
    const r = await post(svc, "/v1/projects", {
      origen: "local",
      nombre: "Checkout",
      ruta_local: repoConRemoto().repo,
      rapido: true,
    });
    assert.equal(r.estado, 201, JSON.stringify(r.cuerpo));
    assert.equal(r.cuerpo.proyecto.estado, "ACTIVE");
    assert.ok(Array.isArray(r.cuerpo.pasos) && r.cuerpo.pasos.length === 5);
  });
});

test("US8 — una carpeta sin git para en la etapa `repositorio` con 409 y el proyecto se queda en CREATED", async () => {
  await conServicio(opciones(), async (svc) => {
    const carpeta = carpetaDePrueba();
    const creado = await post(svc, "/v1/projects", { origen: "nuevo", nombre: "Vacio", ruta_local: carpeta });
    assert.equal(creado.estado, 201, JSON.stringify(creado.cuerpo));

    const antes = huellaDelArbol(carpeta);
    const r = await post(svc, `/v1/projects/${creado.cuerpo.proyecto.id}/quickstart`);
    assert.equal(r.estado, 409, JSON.stringify(r.cuerpo));
    assert.equal(r.cuerpo.error.codigo, "modo_rapido_detenido");
    assert.match(r.cuerpo.error.causa, /repositorio/);
    assert.match(r.cuerpo.error.causa, /CREATED/);
    assert.match(r.cuerpo.error.accion, /git init/);
    assert.equal(r.cuerpo.error.objeto.etapa, "repositorio");
    assert.deepEqual(diferencias(antes, huellaDelArbol(carpeta)), [], "parar no es excusa para escribir");

    const leido = await get(svc, `/v1/projects/${creado.cuerpo.proyecto.id}`);
    assert.equal(leido.cuerpo.proyecto.estado, "CREATED");
  });
});

test("US8 — con un tracker PROPIO sin vida, para en `conexion`: la guarda no se relaja para un gestor externo", async () => {
  await conServicio(opciones(), async (svc) => {
    const proyecto = await alta(svc, repoConRemoto().repo, "Con Jira");
    svc.dep.almacen.conexiones.crear({ project_id: proyecto.id, clase: "tracker", proveedor: "jira", estado: "pendiente" });

    const r = await post(svc, `/v1/projects/${proyecto.id}/quickstart`);
    assert.equal(r.estado, 409, JSON.stringify(r.cuerpo));
    assert.equal(r.cuerpo.error.codigo, "modo_rapido_detenido");
    assert.equal(r.cuerpo.error.objeto.etapa, "conexion");
    assert.match(r.cuerpo.error.causa, /BOOTSTRAPPED/);
    assert.match(r.cuerpo.error.causa, /pendiente/);

    // Se queda DONDE LLEGO: las etapas anteriores ya estan hechas y no se deshacen.
    const leido = await get(svc, `/v1/projects/${proyecto.id}`);
    assert.equal(leido.cuerpo.proyecto.estado, "BOOTSTRAPPED");
    assert.deepEqual(transiciones(svc, proyecto.id), [
      "CREATED->DISCOVERED",
      "DISCOVERED->CONSTITUTED",
      "CONSTITUTED->BOOTSTRAPPED",
    ]);
  });
});

test("US8 — una flota ya declarada se respeta: el modo rapido no la reemplaza ni pregunta por runtimes", async () => {
  let preguntas = 0;
  const ejecutar = async (/** @type {string[]} */ argv) => {
    preguntas++;
    return autenticacion()(argv);
  };
  await conServicio({ motor: { intervaloMs: 0, ejecutarAutenticacion: ejecutar } }, async (svc) => {
    const proyecto = await alta(svc, repoConRemoto().repo, "Con Flota");
    const agente = await post(svc, `/v1/projects/${proyecto.id}/agents`, {
      nombre: "el mio",
      rol: "implementador",
      runtime: "claude-agent-sdk",
      modelo: "opus",
    });
    assert.equal(agente.estado, 201, JSON.stringify(agente.cuerpo));

    const r = await post(svc, `/v1/projects/${proyecto.id}/quickstart`);
    assert.equal(r.estado, 200, JSON.stringify(r.cuerpo));
    assert.equal(r.cuerpo.proyecto.estado, "ACTIVE");
    const flota = (await get(svc, `/v1/projects/${proyecto.id}/agents`)).cuerpo.items;
    assert.deepEqual(flota.map((/** @type {any} */ a) => a.nombre), ["el mio"]);
    assert.equal(preguntas, 0, "con flota declarada no hace falta preguntar a ningun runtime");
  });
});
