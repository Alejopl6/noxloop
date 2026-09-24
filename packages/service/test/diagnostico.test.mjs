// El diagnostico: `GET /v1/diagnostics` (spec 004, US1, FR-001..003).
//
// TRES MITADES, probadas por separado:
//
//   1. La confianza de Claude Code, LEIDA de un `~/.claude.json` FALSO. Nunca
//      el del operador: el test que leyera el real pasaria o fallaria segun la
//      maquina, y peor, dependeria de un archivo que no es nuestro.
//   2. Las versiones de la maquina, con un ejecutor inyectado: el binario
//      ausente, el que no contesta a tiempo y el que contesta.
//   3. La ruta y el board: el problema bloqueante deshabilita Run SOLO donde
//      afecta, y nada de esto escribe en ningun sitio (FR-002).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { diagnosticoDeMaquina, leerConfianza } from "../src/diagnostico.mjs";
import { conServicio, diferencias, huellaDelArbol, pedir } from "./ayuda.mjs";
import { proyectoActivo, repoConRemoto } from "./ayuda-motor.mjs";

// ---------------------------------------------------------------------------
// Ayudas
// ---------------------------------------------------------------------------

/** Un home de Claude falso, con el `.claude.json` que se le de (o ninguno). */
function homeDeClaude(contenido) {
  const dir = mkdtempSync(join(tmpdir(), "noxloop-claude-home-"));
  if (contenido !== undefined) {
    writeFileSync(join(dir, ".claude.json"), typeof contenido === "string" ? contenido : JSON.stringify(contenido));
  }
  return dir;
}

/** Los `projects` de un `.claude.json` con la confianza dada por ruta. */
const confianzas = (mapa) => ({
  numStartups: 3,
  projects: Object.fromEntries(Object.entries(mapa).map(([ruta, si]) => [ruta, { allowedTools: [], hasTrustDialogAccepted: si }])),
});

/** Un ejecutor de versiones falso: los binarios que se nombren estan ausentes. */
const versiones =
  (ausentes = [], extra = {}) =>
  async (argv) => {
    const nombre = argv[0].split("/").pop();
    const clave = /node/.test(nombre) ? "node" : nombre;
    if (ausentes.includes(clave)) {
      const e = new Error(`spawn ${argv[0]} ENOENT`);
      /** @type {any} */ (e).code = "ENOENT";
      throw e;
    }
    if (extra[clave]) return extra[clave];
    const salida = {
      git: "git version 2.50.1",
      claude: "2.1.281 (Claude Code)",
      codex: "codex-cli 0.137.0",
      node: "v22.11.0",
    };
    return { code: 0, stdout: `${salida[clave]}\n`, stderr: "" };
  };

/** Claude y Codex con sesion: el `ejecutar` de `estadoDeAutenticacion`. */
const conSesion = async (argv) =>
  argv[0] === "claude"
    ? { code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }), stderr: "" }
    : { code: 0, stdout: "Logged in using ChatGPT", stderr: "" };

const json = (cuerpo) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });

// ---------------------------------------------------------------------------
// 1. La confianza de Claude Code
// ---------------------------------------------------------------------------

test("confianza aceptada: la clave es la ruta REAL del repo y la evidencia la nombra", () => {
  const { repo } = repoConRemoto();
  const real = realpathSync(repo);
  const home = homeDeClaude(confianzas({ [real]: true }));
  const c = leerConfianza({ archivo: join(home, ".claude.json"), ruta: repo });
  assert.equal(c.estado, "aceptada");
  assert.equal(c.clave, real);
  assert.match(c.evidencia, /hasTrustDialogAccepted/);
  assert.ok(c.evidencia.includes(real));
});

test("confianza pendiente: con la entrada en false, y sin entrada; la accion dice abrir `claude` en ESA ruta", () => {
  const { repo } = repoConRemoto();
  const real = realpathSync(repo);
  const enFalso = leerConfianza({ archivo: join(homeDeClaude(confianzas({ [real]: false })), ".claude.json"), ruta: repo });
  assert.equal(enFalso.estado, "pendiente");
  assert.match(enFalso.evidencia, /false/);
  assert.ok(enFalso.accion.includes(`abre \`claude\` una vez en ${real} y acepta el dialogo`), enFalso.accion);

  const sinEntrada = leerConfianza({ archivo: join(homeDeClaude(confianzas({ "/otra/ruta": true })), ".claude.json"), ruta: repo });
  assert.equal(sinEntrada.estado, "pendiente");
  assert.match(sinEntrada.evidencia, /no hay entrada/);
});

test("confianza de un PADRE fuera del repo no cuenta: Claude Code solo sube hasta la raiz del repositorio", () => {
  const { raiz, repo } = repoConRemoto();
  const c = leerConfianza({
    archivo: join(homeDeClaude(confianzas({ [realpathSync(raiz)]: true })), ".claude.json"),
    ruta: repo,
  });
  assert.equal(c.estado, "pendiente");
});

test("confianza desconocida: archivo ausente, JSON roto, o `projects` con otra forma — con la causa, nunca inventada", () => {
  const { repo } = repoConRemoto();
  const ausente = leerConfianza({ archivo: join(homeDeClaude(), ".claude.json"), ruta: repo });
  assert.equal(ausente.estado, "desconocida");
  assert.match(ausente.causa, /no existe/i);

  const roto = leerConfianza({ archivo: join(homeDeClaude("{ esto no es json"), ".claude.json"), ruta: repo });
  assert.equal(roto.estado, "desconocida");
  assert.match(roto.causa, /JSON/);

  const otraForma = leerConfianza({ archivo: join(homeDeClaude({ projects: ["no", "es", "un", "mapa"] }), ".claude.json"), ruta: repo });
  assert.equal(otraForma.estado, "desconocida");
  assert.match(otraForma.causa, /projects/);

  for (const c of [ausente, roto, otraForma]) assert.ok(c.accion && c.accion.length > 20, "desconocida tambien dice que hacer");
});

test("una ruta con symlink se resuelve: la clave es la real, no la del enlace", () => {
  const { repo } = repoConRemoto();
  const real = realpathSync(repo);
  const enlace = join(mkdtempSync(join(tmpdir(), "noxloop-enlace-")), "atajo");
  symlinkSync(repo, enlace);
  const c = leerConfianza({ archivo: join(homeDeClaude(confianzas({ [real]: true })), ".claude.json"), ruta: enlace });
  assert.equal(c.estado, "aceptada");
  assert.equal(c.clave, real);
});

test("un repo que es un WORKTREE se juzga por su repo canonico, como hace Claude Code", () => {
  const { repo } = repoConRemoto();
  const real = realpathSync(repo);
  const wt = join(mkdtempSync(join(tmpdir(), "noxloop-wt-")), "rama");
  execFileSync("git", ["-C", repo, "worktree", "add", "-q", "-b", "otra", wt], { stdio: "ignore" });
  const c = leerConfianza({ archivo: join(homeDeClaude(confianzas({ [real]: true })), ".claude.json"), ruta: wt });
  assert.equal(c.estado, "aceptada");
  assert.equal(c.clave, real);
});

// ---------------------------------------------------------------------------
// 2. La maquina
// ---------------------------------------------------------------------------

test("versiones de git, claude, codex y node; el ausente dice como instalarlo", async () => {
  const m = await diagnosticoDeMaquina({ ejecutar: versiones(["codex"]), nodo: "node" });
  const por = Object.fromEntries(m.binarios.map((b) => [b.nombre, b]));
  assert.deepEqual(Object.keys(por).sort(), ["claude", "codex", "git", "node"]);
  assert.equal(por.git.estado, "presente");
  assert.equal(por.git.version, "2.50.1");
  assert.equal(por.claude.version, "2.1.281");
  assert.equal(por.node.version, "22.11.0");
  assert.equal(por.codex.estado, "ausente");
  assert.match(por.codex.accion, /npm install -g @openai\/codex/);
  const problema = m.problemas.find((p) => p.codigo === "binario_ausente");
  assert.equal(problema.afecta, "codex", "codex ausente solo afecta a lo que corre con codex");
  assert.equal(problema.nivel, "bloqueante");
});

test("un binario que no contesta a tiempo es `fallo`, no `presente`; y git ausente afecta a todo", async () => {
  const m = await diagnosticoDeMaquina({
    ejecutar: versiones(["git"], { claude: { code: null, stdout: "", stderr: "", agotado: true } }),
    nodo: "node",
  });
  const por = Object.fromEntries(m.binarios.map((b) => [b.nombre, b]));
  assert.equal(por.claude.estado, "fallo");
  assert.match(por.claude.causa, /no contesto/);
  const git = m.problemas.find((p) => p.binario === "git");
  assert.equal(git.afecta, null);
  assert.equal(git.nivel, "bloqueante");
});

test("node por debajo de 22 es bloqueante: el motor lo exige", async () => {
  const m = await diagnosticoDeMaquina({
    ejecutar: versiones([], { node: { code: 0, stdout: "v20.1.0\n", stderr: "" } }),
    nodo: "node",
  });
  assert.ok(m.problemas.some((p) => p.binario === "node" && p.nivel === "bloqueante"));
});

// ---------------------------------------------------------------------------
// 3. La ruta y el board
// ---------------------------------------------------------------------------

test("GET /v1/diagnostics: maquina y proyecto, con repo, confianza, gate y runtimes por rol; ?project filtra", async () => {
  const home = homeDeClaude(confianzas({}));
  await conServicio(
    { motor: { intervaloMs: 0, homeDeClaude: home, ejecutarDiagnostico: versiones(), ejecutarAutenticacion: conSesion } },
    async (svc) => {
      const a = await proyectoActivo(svc, { nombre: "Pagos", conexiones: [] });
      const b = await proyectoActivo(svc, { nombre: "Sin gate", conexiones: [], runner: null });

      const r = await pedir(svc, "/v1/diagnostics");
      assert.equal(r.status, 200);
      const d = await r.json();
      assert.equal(d.maquina.binarios.length, 4);
      const pa = d.proyectos.find((x) => x.id === a.id);
      assert.equal(pa.repositorio.estado, "ok");
      assert.equal(pa.confianza.estado, "pendiente");
      assert.ok(pa.confianza.rutaDeFase.startsWith(svc.home), "la ruta de las fases es un worktree bajo el home");
      assert.equal(pa.gate.declarado, true);
      assert.ok(pa.runtimes.some((x) => x.rol === "implementador" && x.runtime === "claude-agent-sdk" && x.conectado === true));
      const confianza = pa.problemas.find((x) => x.codigo === "confianza_pendiente");
      assert.equal(confianza.afecta, "claude-agent-sdk");
      assert.match(confianza.accion, /abre `claude` una vez en .* y acepta el dialogo/);

      const pb = d.proyectos.find((x) => x.id === b.id);
      assert.equal(pb.gate.declarado, false);
      assert.ok(pb.problemas.some((x) => x.codigo === "sin_gate" && x.causa && x.accion));

      // Sin remoto Y sin gate: los dos se dicen, no solo el primero que para
      // la composicion de la configuracion.
      const c = await proyectoActivo(svc, { nombre: "Suelto", conexiones: [], runner: null, ruta: repoConRemoto({ remoto: null }).repo });
      const pc = (await (await pedir(svc, `/v1/diagnostics?project=${c.id}`)).json()).proyectos[0];
      assert.deepEqual(pc.problemas.map((x) => x.codigo).filter((k) => k.startsWith("sin_")).sort(), ["sin_gate", "sin_repo"]);

      const solo = await (await pedir(svc, `/v1/diagnostics?project=${a.id}`)).json();
      assert.deepEqual(solo.proyectos.map((x) => x.id), [a.id]);
      assert.equal((await pedir(svc, "/v1/diagnostics?project=prj-que-no-existe")).status, 404);
    },
  );
});

test("FR-002: el diagnostico NO escribe — ni en el claude.json, ni en el repo, ni en el home", async () => {
  const org = repoConRemoto();
  const home = homeDeClaude(confianzas({ [realpathSync(org.repo)]: false }));
  await conServicio(
    { motor: { intervaloMs: 0, homeDeClaude: home, ejecutarDiagnostico: versiones(), ejecutarAutenticacion: conSesion } },
    async (svc) => {
      const p = await proyectoActivo(svc, { ruta: org.repo, conexiones: [] });
      await pedir(svc, `/v1/projects/${p.id}/tasks`, json({ titulo: "algo" }));
      // El almacen se abre en WAL: se deja asentar antes de medir.
      await pedir(svc, "/v1/board");

      const antes = { claude: huellaDelArbol(home), repo: huellaDelArbol(org.repo), home: huellaDelArbol(svc.home) };
      const r = await pedir(svc, "/v1/diagnostics?fresh=1");
      assert.equal(r.status, 200);
      assert.equal((await r.json()).proyectos.length, 1, "el test no vale si no diagnostico nada");
      await pedir(svc, `/v1/diagnostics?project=${p.id}`);

      assert.deepEqual(diferencias(antes.claude, huellaDelArbol(home)), [], "escribio en el home de Claude");
      assert.deepEqual(diferencias(antes.repo, huellaDelArbol(org.repo)), [], "escribio en el repositorio");
      assert.deepEqual(diferencias(antes.home, huellaDelArbol(svc.home)), [], "escribio en el home de noxloop");
    },
  );
});

// LA CONFIANZA PENDIENTE AVISA, NO BLOQUEA. Medido en `claude` 2.1.281: con
// `-p` —como el motor lanza cada fase— Claude Code se da por confiado y no
// muestra el dialogo, asi que el run no falla ni se cuelga. Lo que SI cambia
// es que descarta la configuracion propia del repo (`.claude/settings.json`,
// sus hooks y sus MCP). Los hooks de noxloop llegan por `--settings`, asi que
// siguen. Bloquear Run por esto frenaria al operador por algo que no rompe el
// run; se le dice lo que pierde y como evitarlo.
test("FR-003: confianza pendiente es un AVISO — Run sigue habilitado, y el diagnostico dice que se ignora la config del repo", async () => {
  const org = repoConRemoto();
  const real = realpathSync(org.repo);
  const home = homeDeClaude(confianzas({ [real]: false }));
  await conServicio(
    { motor: { intervaloMs: 0, homeDeClaude: home, ejecutarDiagnostico: versiones(), ejecutarAutenticacion: conSesion } },
    async (svc) => {
      const p = await proyectoActivo(svc, { ruta: org.repo, conexiones: [] });
      await pedir(svc, `/v1/projects/${p.id}/tasks`, json({ titulo: "con claude" }));

      const b = await (await pedir(svc, `/v1/board?project=${p.id}`)).json();
      const t = b.tarjetas.find((x) => x.ticket.titulo === "con claude");
      assert.equal(t.accion.habilitada, true, t.accion.motivo);

      const d = await (await pedir(svc, `/v1/diagnostics?project=${p.id}`)).json();
      const c = d.proyectos[0].problemas.find((x) => x.codigo === "confianza_pendiente");
      assert.equal(c.nivel, "aviso");
      assert.match(c.causa, /\.claude\/settings/);
      assert.ok(c.accion.includes(real));
    },
  );
});

test("git ausente deshabilita Run en TODAS las tarjetas, con como instalarlo", async () => {
  await conServicio(
    {
      motor: {
        intervaloMs: 0,
        homeDeClaude: homeDeClaude(),
        ejecutarDiagnostico: versiones(["git"]),
        ejecutarAutenticacion: conSesion,
      },
    },
    async (svc) => {
      const p = await proyectoActivo(svc, { conexiones: [] });
      await pedir(svc, `/v1/projects/${p.id}/tasks`, json({ titulo: "una" }));
      await pedir(svc, `/v1/projects/${p.id}/tasks`, json({ titulo: "otra", ejecutor: { runtime: "codex" } }));
      const b = await (await pedir(svc, `/v1/board?project=${p.id}`)).json();
      const conRun = b.tarjetas.filter((t) => t.accion.tipo === "run");
      assert.equal(conRun.length, 2);
      for (const t of conRun) {
        assert.equal(t.accion.habilitada, false);
        assert.match(t.accion.motivo, /git/);
      }
    },
  );
});

test("confianza desconocida (sin ~/.claude.json) NO deshabilita Run: se avisa, no se inventa un bloqueo", async () => {
  await conServicio(
    { motor: { intervaloMs: 0, homeDeClaude: homeDeClaude(), ejecutarDiagnostico: versiones(), ejecutarAutenticacion: conSesion } },
    async (svc) => {
      const p = await proyectoActivo(svc, { conexiones: [] });
      await pedir(svc, `/v1/projects/${p.id}/tasks`, json({ titulo: "una" }));
      const b = await (await pedir(svc, `/v1/board?project=${p.id}`)).json();
      assert.equal(b.tarjetas[0].accion.habilitada, true, b.tarjetas[0].accion.motivo);
      const d = await (await pedir(svc, "/v1/diagnostics")).json();
      const aviso = d.proyectos[0].problemas.find((x) => x.codigo === "confianza_desconocida");
      assert.equal(aviso.nivel, "aviso");
    },
  );
});

test("el board cachea el diagnostico: dos pintadas seguidas lanzan los binarios UNA vez", async () => {
  let llamadas = 0;
  const contar = async (argv, o) => {
    llamadas++;
    return versiones()(argv, o);
  };
  await conServicio(
    { motor: { intervaloMs: 0, homeDeClaude: homeDeClaude(), ejecutarDiagnostico: contar, ejecutarAutenticacion: conSesion } },
    async (svc) => {
      await proyectoActivo(svc, { conexiones: [] });
      await pedir(svc, "/v1/board");
      const primera = llamadas;
      assert.ok(primera > 0);
      await pedir(svc, "/v1/board");
      assert.equal(llamadas, primera);
    },
  );
});
