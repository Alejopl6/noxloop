// `GET /v1/runs/:itemId/tasks/:taskId/diff` — lo que cambio cada agente (spec
// 003, US6, FR-029).
//
// LO QUE SE PRUEBA. Que el diff sale de GIT y no del estado del run (el run no
// guarda diffs, y una copia se quedaria atras del repositorio); que el commit
// del test y el de la implementacion salen SEPARADOS, porque esa separacion es
// la evidencia visible del principio I; que lo sin commitear de una tarea en
// curso se ve; que un parche enorme se corta DICIENDOLO; y —el invariante— que
// leer el diff no escribe NADA, ni en el repositorio ni en el worktree. `git
// status` y `git diff` refrescan el indice con solo consultarlos: sin cuidado,
// abrir el detalle de un run tocaria el repositorio del operador.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { conServicio, diferencias, huellaDelArbol, pedir } from "./ayuda.mjs";
import { repoConRemoto, runEnDisco } from "./ayuda-motor.mjs";

const git = (cwd, ...a) =>
  execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/**
 * Un repositorio con la forma que deja el motor: rama del ticket desde main,
 * y la rama de la tarea con su worktree, su commit de test y su commit de
 * implementacion con los mensajes de `mensajeDeFase`.
 */
function repoConTarea(home) {
  const { repo } = repoConRemoto();
  git(repo, "branch", "noxloop/FAKE-9-exportar", "main");
  const wt = join(home, "worktrees", "app", "9-T001");
  mkdirSync(join(home, "worktrees", "app"), { recursive: true });
  git(repo, "worktree", "add", "-q", "-b", "noxloop/FAKE-9-exportar-T001", wt, "noxloop/FAKE-9-exportar");
  git(wt, "config", "user.email", "motor@example.test");
  git(wt, "config", "user.name", "El motor");

  mkdirSync(join(wt, "test"), { recursive: true });
  writeFileSync(join(wt, "test", "csv.test.mjs"), 'import { csv } from "../src/csv.mjs";\nif (!csv) throw new Error("rojo");\n');
  git(wt, "add", "test/csv.test.mjs");
  git(wt, "commit", "-q", "-m", "test(app): exportar a CSV (T001, FAKE-9)\n\nEl test del criterio, verificado en rojo.");

  mkdirSync(join(wt, "src"), { recursive: true });
  writeFileSync(join(wt, "src", "csv.mjs"), "export const csv = true;\n");
  writeFileSync(join(wt, "README.md"), "# la app\n\nexporta a CSV\n");
  git(wt, "add", "src/csv.mjs", "README.md");
  git(wt, "commit", "-q", "-m", "feat(app): exportar a CSV (T001, FAKE-9)\n\nCriterio: exporta");

  // Lo que la tarea lleva hecho y no commiteo: un cambio y un archivo nuevo.
  writeFileSync(join(wt, "src", "csv.mjs"), "export const csv = true;\nexport const separador = ';';\n");
  writeFileSync(join(wt, "src", "nuevo.mjs"), "export const nuevo = 1;\n");
  return { repo, wt };
}

function runDeLaTarea(home, repo, wt, estado = "green") {
  return runEnDisco(home, "9", {
    projectId: null,
    runtime: "claude-agent-sdk",
    item: { id: "9", key: "FAKE-9", title: "exportar a CSV", pr: null, branch: "noxloop/FAKE-9-exportar", baseBranch: "main" },
    tasks: [
      {
        id: "T001",
        title: "exportar a CSV",
        repo: "app",
        repoPath: repo,
        status: estado,
        worktree: wt,
        branch: "noxloop/FAKE-9-exportar-T001",
        attempts: {},
        dependsOn: [],
      },
    ],
  });
}

test("US6: el commit del test y el de la implementacion por separado, con sus archivos y parches, y lo sin commitear", async () => {
  await conServicio({ motor: { intervaloMs: 0 } }, async (svc) => {
    const { repo, wt } = repoConTarea(svc.home);
    runDeLaTarea(svc.home, repo, wt);

    const r = await pedir(svc, "/v1/runs/9/tasks/T001/diff");
    assert.equal(r.status, 200, await r.clone().text());
    const d = await r.json();

    assert.deepEqual(d.tarea, { id: "T001", titulo: "exportar a CSV", estado: "green", agente: "claude-agent-sdk", rama: "noxloop/FAKE-9-exportar-T001" });
    assert.deepEqual(d.commits.map((c) => c.tipo), ["test", "impl"], "el orden test -> implementacion es la evidencia del principio I");
    assert.match(d.commits[0].mensaje, /^test\(app\): exportar a CSV \(T001, FAKE-9\)/);
    assert.match(d.commits[0].sha, /^[0-9a-f]{40}$/);

    const [delTest] = d.commits[0].archivos;
    assert.deepEqual([delTest.ruta, delTest.estado, delTest.mas, delTest.menos], ["test/csv.test.mjs", "A", 2, 0]);
    assert.match(delTest.parche, /^@@ /, "el parche empieza en el primer `@@`, como declara el contrato");

    const impl = Object.fromEntries(d.commits[1].archivos.map((a) => [a.ruta, a]));
    assert.equal(impl["src/csv.mjs"].estado, "A");
    assert.equal(impl["README.md"].estado, "M");
    assert.equal(impl["README.md"].mas, 2);

    const sin = Object.fromEntries(d.sinCommitear.archivos.map((a) => [a.ruta, a]));
    assert.equal(sin["src/csv.mjs"].estado, "M");
    assert.equal(sin["src/csv.mjs"].mas, 1);
    assert.equal(sin["src/nuevo.mjs"].estado, "A", "un archivo nuevo sin commitear tambien es trabajo del agente");
    assert.match(sin["src/nuevo.mjs"].parche, /\+export const nuevo = 1;/);
  });
});

test("EL INVARIANTE: leer el diff no escribe nada, ni en el repositorio ni en el worktree", async () => {
  await conServicio({ motor: { intervaloMs: 0 } }, async (svc) => {
    const { repo, wt } = repoConTarea(svc.home);
    runDeLaTarea(svc.home, repo, wt);
    // Un primer `git` cualquiera puede dejar el indice al dia; lo que se mide
    // es que ESTA ruta no toque nada, empezando desde un estado quieto.
    const antesRepo = huellaDelArbol(repo);
    const antesWt = huellaDelArbol(wt);
    const antesHome = huellaDelArbol(svc.home);

    for (let i = 0; i < 2; i++) assert.equal((await pedir(svc, "/v1/runs/9/tasks/T001/diff")).status, 200);

    assert.deepEqual(diferencias(antesRepo, huellaDelArbol(repo)), [], "el diff escribio en el repositorio del operador");
    assert.deepEqual(diferencias(antesWt, huellaDelArbol(wt)), [], "el diff escribio en el worktree de la tarea");
    assert.deepEqual(diferencias(antesHome, huellaDelArbol(svc.home)), [], "el diff escribio en el home");
  });
});

test("una tarea integrada no tiene «sin commitear»; un parche de mas de 200 KB se corta y LO DICE", async () => {
  await conServicio({ motor: { intervaloMs: 0 } }, async (svc) => {
    const { repo, wt } = repoConTarea(svc.home);
    git(wt, "checkout", "-q", "--", ".");
    git(wt, "clean", "-qfd");
    writeFileSync(join(wt, "enorme.txt"), Array.from({ length: 12000 }, (_, i) => `linea ${i} ${"x".repeat(20)}`).join("\n") + "\n");
    git(wt, "add", "enorme.txt");
    git(wt, "commit", "-q", "-m", "chore(app): datos de prueba (T001, FAKE-9)");
    runDeLaTarea(svc.home, repo, wt, "integrated");

    const d = await (await pedir(svc, "/v1/runs/9/tasks/T001/diff")).json();
    assert.equal(d.sinCommitear, null);
    const enorme = d.commits.at(-1).archivos.find((a) => a.ruta === "enorme.txt");
    assert.equal(enorme.cortado, true);
    assert.ok(Buffer.byteLength(enorme.parche) <= 201 * 1024, `el parche pesa ${Buffer.byteLength(enorme.parche)} bytes`);
    assert.match(enorme.parche, /parche cortado/);
    assert.equal(enorme.mas, 12000, "el recuento de lineas es el real aunque el parche se corte");
  });
});

test("un run o una tarea que no existen son 404 con donde buscar", async () => {
  await conServicio({ motor: { intervaloMs: 0 } }, async (svc) => {
    const { repo, wt } = repoConTarea(svc.home);
    runDeLaTarea(svc.home, repo, wt);
    const sinRun = await pedir(svc, "/v1/runs/no-existe/tasks/T001/diff");
    assert.equal(sinRun.status, 404);
    const sinTarea = await pedir(svc, "/v1/runs/9/tasks/T999/diff");
    assert.equal(sinTarea.status, 404);
    assert.equal((await sinTarea.json()).error.codigo, "recurso_desconocido");
  });
});
