// El termino `commit` en el servicio: un proyecto sin remoto ya no es «Sin
// repo», se lanza, y su run termina en una rama lista del repositorio local.
//
// EL HALLAZGO QUE CIERRA, medido antes de escribir esto. Un repositorio local
// sin `origin` no podia correr nada: `componerConfig` lanzaba `sin_repo` («sin
// remoto no hay donde dejar el trabajo»), la tarjeta salia deshabilitada y
// `commit`, que estaba en el contrato de la tarea desde la spec 003, se negaba
// al lanzar con `termino_sin_soporte`. Hay donde dejar el trabajo: una rama
// del repositorio del operador. El motor ya sabe hacerlo (ver
// `packages/engine/test/termino-commit.test.mjs`); aqui se mide que el
// servicio lo pide, lo pinta y lo explica.
//
// LO QUE NO CAMBIA: `pr` sin remoto sigue rechazado —no hay contra que abrir
// el PR— con la causa y la salida (terminar en `commit`), y `changes` sigue
// sin soporte, declarado.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { construirBoard, ejecucionDeTarjeta } from "../src/board.mjs";
import { problemaDeEjecucion } from "../src/ejecutor.mjs";
import { accionDelEstado, ESTADOS_DEL_RUN, estadoDelRun } from "../src/estado-del-run.mjs";
import { componerConfig, diagnosticar } from "../src/motor.mjs";
import { validate } from "../../engine/src/schema.mjs";
import { conServicio, pedir } from "./ayuda.mjs";
import { proyectoActivo, repoConRemoto } from "./ayuda-motor.mjs";

const RAIZ = new URL("../../../", import.meta.url).pathname;
const ESQUEMA = JSON.parse(readFileSync(join(RAIZ, "packages/engine/schemas/config.schema.json"), "utf8"));
const FIXTURE = new URL("./fixtures/motor-con-agente-falso.mjs", import.meta.url).pathname;

const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) =>
  execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** Lo minimo que `componerConfig` necesita, como lo dejaria `datosDelProyecto`. */
function entrada(extra = {}) {
  return {
    proyecto: { id: "prj-1", nombre: "La App", slug: "la-app", ruta_local: "/tmp/la-app", autonomia: "L2" },
    home: "/tmp/home-del-servicio",
    remoto: "git@forja.test:acme/la-app.git",
    ramaBase: "main",
    gate: { comando: "npm test", de: "testing.runner = node --test (package.json)" },
    gestor: { nombre: "fake", conexion: "c-1", origen: "tracker" },
    raizDeProveedores: "/opt/noxloop/providers",
    ...extra,
  };
}

/** @param {() => any} fn */
function errorDe(fn) {
  try {
    fn();
  } catch (e) {
    return /** @type {any} */ (e);
  }
  return null;
}

// ---------------------------------------------------------------------------
// La composicion
// ---------------------------------------------------------------------------

test("sin remoto la configuracion termina en `commit` por defecto, sin remoto que inventar, y el motor la acepta", () => {
  const config = componerConfig(entrada({ remoto: null }));
  assert.equal(config.termino, "commit");
  const [clave] = Object.keys(config.repos);
  assert.equal("remote" in config.repos[clave], false, "un remoto que no existe no se escribe");
  assert.deepEqual(validate(ESQUEMA, config), []);
});

test("con remoto el termino por defecto sigue siendo `pr`; y cada tarea puede pedir el suyo", () => {
  assert.equal(componerConfig(entrada()).termino, "pr");
  const commit = componerConfig(entrada({ termino: "commit" }));
  assert.equal(commit.termino, "commit", "con remoto tambien se puede terminar en commit");
  const [clave] = Object.keys(commit.repos);
  assert.equal(commit.repos[clave].remote, "git@forja.test:acme/la-app.git", "declarado, el remoto se verifica igual");
});

test("`pr` sin remoto sigue rechazado: `sin_repo`, con la salida de terminar en `commit`", () => {
  const e = errorDe(() => componerConfig(entrada({ remoto: null, termino: "pr" })));
  assert.equal(e?.codigo, "sin_repo");
  assert.match(e.causa, /La App/);
  assert.match(e.causa, /pull request|PR/);
  assert.match(e.accion, /commit/, "la accion tiene que ofrecer terminar en commit");
});

// ---------------------------------------------------------------------------
// El ejecutor y el termino
// ---------------------------------------------------------------------------

const EJECUTOR = { runtime: "claude-agent-sdk", agente: null, de: "el general" };

test("`commit` deja de ser `termino_sin_soporte`; `changes` lo sigue siendo, declarado", () => {
  assert.equal(problemaDeEjecucion({ ejecutor: EJECUTOR, termino: "commit", clave: "PAY-1" }), null);
  assert.equal(problemaDeEjecucion({ ejecutor: EJECUTOR, termino: "pr", clave: "PAY-1" }), null);
  const changes = problemaDeEjecucion({ ejecutor: EJECUTOR, termino: "changes", clave: "PAY-1" });
  assert.equal(changes?.codigo, "termino_sin_soporte");
  assert.match(changes.causa, /changes/);
});

test("una tarea que pide `pr` en un proyecto sin remoto: `sin_repo`, dicho antes de componer", () => {
  const proyecto = { id: "prj-1", nombre: "La App", ruta_local: "/tmp/la-app" };
  const e = problemaDeEjecucion({ ejecutor: EJECUTOR, termino: "pr", clave: "PAY-1", sinRemoto: proyecto });
  assert.equal(e?.codigo, "sin_repo");
  assert.match(e.accion, /commit/);
  assert.equal(problemaDeEjecucion({ ejecutor: EJECUTOR, termino: "commit", clave: "PAY-1", sinRemoto: proyecto }), null);
});

test("en el board, el termino de una tarjeta sin termino propio sale del proyecto: `commit` sin remoto, `pr` con el", () => {
  const ticket = { id: "7", key: "CORE-7" };
  assert.equal(ejecucionDeTarjeta(ticket, { gestor: "fake", tieneRemoto: false }).termino, "commit");
  assert.equal(ejecucionDeTarjeta(ticket, { gestor: "fake", tieneRemoto: true }).termino, "pr");
  // La tarea local que lo declara, manda.
  const local = { id: "t-1", key: "PAY-1", raw: { termino: "pr" } };
  assert.equal(ejecucionDeTarjeta(local, { gestor: "local", tieneRemoto: false }).termino, "pr");
});

// ---------------------------------------------------------------------------
// El estado del run y la tarjeta
// ---------------------------------------------------------------------------

const RAMA = "feature/t-1-publicar-el-catalogo";
const runConRama = () => ({
  item: {
    id: "t-1",
    termino: "commit",
    branch: RAMA,
    pr: null,
    ramaLista: { rama: RAMA, base: "main", head: "a".repeat(40), commits: [{ sha: "b".repeat(40), asunto: "test(app): x" }] },
  },
  tasks: [{ id: "T001", status: "integrated" }],
});

test("un run terminado en commit esta en `rama_lista`, con la rama como detalle, y su accion es abrir el run", () => {
  assert.ok(ESTADOS_DEL_RUN.includes("rama_lista"), "`/v1/runs?estado=rama_lista` tiene que poder filtrarse");
  const e = estadoDelRun(runConRama(), null);
  assert.equal(e?.estado, "rama_lista");
  assert.equal(e.detalle, RAMA);
  assert.equal(accionDelEstado("rama_lista"), "open_run");
});

test("la tarjeta va a En revision con el chip «Rama lista · <rama>» que dice como verla", () => {
  const board = construirBoard({
    partes: [
      {
        proyecto: { id: "prj-1", nombre: "La App" },
        gestor: "local",
        listItems: true,
        tickets: [{ id: "t-1", key: "PAY-1", title: "publicar el catalogo", canonicalState: "in_review", labels: [] }],
        runs: [{ itemId: "t-1", estado: "rama_lista", detalle: RAMA, rama: RAMA, pr: null, avance: null, gasto: null }],
        nota: null,
        lanzable: true,
        tieneRepo: true,
        tieneRemoto: false,
        motivo: null,
      },
    ],
  });
  const t = board.tarjetas.find((/** @type {any} */ x) => x.id === "prj-1:t-1");
  assert.equal(t.columna, "in_review");
  assert.equal(t.chip.tipo, "rama_lista");
  assert.equal(t.chip.texto, `Rama lista · ${RAMA}`);
  assert.match(t.chip.detalle, new RegExp(`git log .*${RAMA.replace(/\//g, "\\/")}`));
  assert.equal(t.accion.tipo, "open_run");
  assert.equal(t.run.rama, RAMA);
});

// ---------------------------------------------------------------------------
// Por el servicio
// ---------------------------------------------------------------------------

test("un proyecto sin remoto se puede lanzar: `diagnosticar` no dice `sin_repo`", async () => {
  await conServicio({}, async (svc) => {
    const proyecto = await proyectoActivo(svc, { nombre: "Suelto", ruta: repoConRemoto({ remoto: null }).repo });
    const d = await diagnosticar(svc.dep, proyecto);
    assert.equal(d.lanzable, true, JSON.stringify(d.problema));
    assert.equal(d.tieneRepo, true, "una carpeta con git ES un repositorio");
    assert.equal(d.tieneRemoto, false);
    assert.equal(d.termino, "commit");
  });
});

test("una tarea nueva sin termino hereda el del proyecto: `commit` sin remoto, `pr` con el", async () => {
  await conServicio({}, async (svc) => {
    const json = (/** @type {any} */ c) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) });
    const suelto = await proyectoActivo(svc, { nombre: "Suelto", ruta: repoConRemoto({ remoto: null }).repo, conexiones: [] });
    const conRemoto = await proyectoActivo(svc, { nombre: "Con Remoto", conexiones: [] });

    const a = await (await pedir(svc, `/v1/projects/${suelto.id}/tasks`, json({ titulo: "x" }))).json();
    assert.equal(a.tarea.termino, "commit");
    const b = await (await pedir(svc, `/v1/projects/${conRemoto.id}/tasks`, json({ titulo: "y" }))).json();
    assert.equal(b.tarea.termino, "pr");
    // Lo que se pide explicitamente, se respeta.
    const c = await (await pedir(svc, `/v1/projects/${conRemoto.id}/tasks`, json({ titulo: "z", termino: "commit" }))).json();
    assert.equal(c.tarea.termino, "commit");
  });
});

const conectado = async (/** @type {string[]} */ argv) =>
  argv[0] === "claude"
    ? { code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }), stderr: "" }
    : { code: 0, stdout: "Not logged in", stderr: "" };

test("de punta a punta, sin remoto: la tarea local llega a «Rama lista», con su comentario, y `main` intacto", async () => {
  await conServicio({ motor: { binDelMotor: FIXTURE, intervaloMs: 100, ejecutarAutenticacion: conectado } }, async (svc) => {
    const org = repoConRemoto({ remoto: null });
    const mainAntes = git(org.repo, "rev-parse", "main");
    const proyecto = await proyectoActivo(svc, { nombre: "Payments", ruta: org.repo, autonomia: "L2", conexiones: [] });

    const alta = await pedir(svc, `/v1/projects/${proyecto.id}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        titulo: "publicar el catalogo de permisos",
        plan: "## Plan\nExportar el catalogo desde `src/permisos.mjs`.",
        criterios: ["el modulo de permisos exporta el catalogo"],
      }),
    });
    assert.equal(alta.status, 201, await alta.clone().text());
    const tarea = (await alta.json()).tarea;
    assert.equal(tarea.termino, "commit");

    const r = await pedir(svc, `/v1/projects/${proyecto.id}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: tarea.id }),
    });
    assert.equal(r.status, 202, await r.clone().text());

    const fin = Date.now() + 90_000;
    let item = null;
    while (Date.now() < fin) {
      const lista = await (await pedir(svc, `/v1/runs?project=${proyecto.id}`)).json();
      item = lista.items.find((/** @type {any} */ x) => x.itemId === tarea.id);
      if (item && ["rama_lista", "pr_abierto", "fallido", "bloqueado", "necesita_criterios", "interrumpido"].includes(item.estado)) break;
      await new Promise((listo) => setTimeout(listo, 200));
    }
    assert.equal(item?.estado, "rama_lista", `el run no llego a la rama: ${JSON.stringify(item)}`);

    const enDisco = JSON.parse(readFileSync(join(svc.home, "runs", `run-${tarea.id}.json`), "utf8"));
    const rama = enDisco.item.branch;
    assert.equal(item.rama, rama, "`/v1/runs` dice la rama");
    assert.equal(item.pr, null);
    assert.equal(enDisco.item.ramaLista.rama, rama);

    // La rama esta en el repositorio del operador, con el test antes que la
    // implementacion; `main` no se movio y no aparecio ningun remoto.
    const historial = git(org.repo, "log", "--format=%s", "--reverse", `main..${rama}`).split("\n");
    const iTest = historial.findIndex((l) => l.startsWith("test("));
    const iImpl = historial.findIndex((l) => l.startsWith("feat("));
    assert.ok(iTest >= 0 && iImpl > iTest, historial.join(" | "));
    assert.equal(git(org.repo, "rev-parse", "main"), mainAntes);
    assert.equal(git(org.repo, "remote"), "");

    // El proveedor local, por el servicio: En revision, y el comentario con la rama.
    const leida = await (await pedir(svc, `/v1/tasks/${tarea.id}`)).json();
    assert.equal(leida.tarea.estado, "in_review");
    assert.ok(
      leida.comentarios.some((/** @type {any} */ c) => c.texto.includes(rama) && /git log/.test(c.texto)),
      `la rama no quedo dicha en la tarea: ${JSON.stringify(leida.comentarios)}`,
    );

    // El board: En revision, chip «Rama lista», y abrir el run.
    const board = await (await pedir(svc, `/v1/board?project=${proyecto.id}`)).json();
    const tarjeta = board.tarjetas.find((/** @type {any} */ x) => x.id === `${proyecto.id}:${tarea.id}`);
    assert.equal(tarjeta?.columna, "in_review", JSON.stringify(tarjeta));
    assert.equal(tarjeta.chip.tipo, "rama_lista");
    assert.equal(tarjeta.chip.texto, `Rama lista · ${rama}`);
    assert.equal(tarjeta.accion.tipo, "open_run");
  });
});

test("el modo rapido deja el proyecto en L2: plan y ejecucion sin parar a la primera", async () => {
  await conServicio({ motor: { intervaloMs: 0, ejecutarAutenticacion: conectado } }, async (svc) => {
    const r = await pedir(svc, "/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ origen: "local", nombre: "Rapido", ruta_local: repoConRemoto({ remoto: null }).repo, rapido: true }),
    });
    const cuerpo = await r.json();
    assert.equal(r.status, 201, JSON.stringify(cuerpo));
    assert.equal(cuerpo.proyecto.estado, "ACTIVE");
    assert.equal(cuerpo.proyecto.autonomia, "L2");
  });
});
