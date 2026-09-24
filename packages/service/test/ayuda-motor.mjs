// Lo que comparten los tests del puente proyecto-motor (spec 003).
//
// POR QUE EXISTE UN ATAJO A `ACTIVE`. Llegar a `ACTIVE` por las rutas cuesta
// las seis etapas —escaneo, constitution, bootstrap, conexion, flota— y ya hay
// un test que las recorre enteras: `punta-a-punta.test.mjs`. Estos tests no
// prueban el recorrido: prueban lo que pasa DESPUES, con un proyecto ya activo.
// Pagar el recorrido en cada uno los haria lentos sin probar nada mas, y el
// atajo se escribe por el almacen —la misma puerta que usa el e2e para sus
// `puentes`— y no por HTTP, que es donde la maquina de estados lo impediria.
//
// Lo que el motor lee del proyecto —el remoto, el hallazgo del runner, la
// conexion del gestor— se planta con las mismas funciones del almacen que usan
// las rutas, no con SQL suelto: si la forma de la fila cambia, estos tests se
// enteran igual que el producto.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pedir } from "./ayuda.mjs";

const git = (cwd, ...a) =>
  execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/**
 * Un repositorio con remoto bare y un commit, como el de una organizacion.
 * Sin remoto la cola de integracion del motor no tiene donde empujar.
 *
 * @param {{remoto?: string|null}} [opts] `remoto: null` para uno sin `origin`
 */
export function repoConRemoto(opts = {}) {
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-motor-"));
  const repo = join(raiz, "app");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "equipo@example.test");
  git(repo, "config", "user.name", "El equipo");
  writeFileSync(join(repo, "README.md"), "# la app\n");
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({ name: "app", version: "1.0.0", type: "module", scripts: { test: "node --test" } }, null, 2) + "\n",
  );
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "chore: inicial");

  let remoto = null;
  if (opts.remoto !== null) {
    remoto = opts.remoto ?? join(raiz, "origin.git");
    if (!opts.remoto) {
      mkdirSync(remoto);
      git(remoto, "init", "-q", "--bare", "-b", "main");
    }
    git(repo, "remote", "add", "origin", remoto);
    if (!opts.remoto) git(repo, "push", "-q", "origin", "main");
  }
  return { raiz, repo, remoto };
}

/**
 * Un proyecto dado de alta por HTTP y llevado a `ACTIVE` por el almacen.
 *
 * @param {any} svc
 * @param {{
 *   nombre?: string, ruta?: string,
 *   runner?: {valor: any, evidencia?: any[], decision?: string, valor_corregido?: any}|null,
 *   conexiones?: Array<{clase: string, proveedor: string, credential_id?: string|null, estado?: string, capacidades?: any, delEspacio?: boolean}>,
 *   autonomia?: "L0"|"L1"|"L2",
 *   estado?: string,
 * }} [opts]
 */
export async function proyectoActivo(svc, opts = {}) {
  const ruta = opts.ruta ?? repoConRemoto().repo;
  const r = await pedir(svc, "/v1/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ origen: "local", nombre: opts.nombre ?? "Con Board", ruta_local: ruta }),
  });
  const cuerpo = await r.json();
  if (!cuerpo.proyecto) throw new Error(`no se pudo dar de alta el proyecto: ${JSON.stringify(cuerpo)}`);
  const proyecto = cuerpo.proyecto;
  const almacen = svc.dep.almacen;

  const runner = opts.runner === undefined ? { valor: "node --test" } : opts.runner;
  if (runner) {
    const snapshot = almacen.snapshots.crear({ project_id: proyecto.id, commit: "abc123" });
    almacen.snapshots.agregarHallazgo({
      snapshot_id: snapshot.id,
      categoria: "testing",
      clave: "testing.runner",
      valor: runner.valor,
      origen: "detectado",
      evidencia: runner.evidencia ?? [{ ruta: "package.json", linea: 1, extracto: "node --test" }],
      confianza: "alta",
      decision: runner.decision ?? "aceptado",
      valor_corregido: runner.valor_corregido,
    });
    almacen.snapshots.completar(snapshot.id, { duracion_ms: 1 });
  }

  const conexiones = opts.conexiones ?? [{ clase: "tracker", proveedor: "fake" }];
  for (const c of conexiones) {
    almacen.conexiones.crear({
      project_id: c.delEspacio ? null : proyecto.id,
      workspace_id: svc.dep.workspace.id,
      clase: c.clase,
      proveedor: c.proveedor,
      estado: c.estado ?? "viva",
      credential_id: c.credential_id ?? null,
      capacidades: c.capacidades ?? {},
    });
  }

  almacen.base.escribir("UPDATE project SET estado = ?, autonomia = ? WHERE id = ?", [
    opts.estado ?? "ACTIVE",
    opts.autonomia ?? "L2",
    proyecto.id,
  ]);
  return almacen.proyectos.porId(proyecto.id);
}

/** Un run en disco con la forma que escribe el motor. */
export function runEnDisco(home, id, extra = {}) {
  const dir = join(home, "runs");
  mkdirSync(dir, { recursive: true });
  const run = {
    schemaVersion: 1,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
    projectId: null,
    item: { id, key: `FAKE-${id}`, title: `ticket ${id}`, provider: "fake", url: `fake://items/${id}`, pr: null },
    tasks: [{ id: "T001", title: "una tarea", repo: "app", status: "pending", attempts: {}, dependsOn: [] }],
    spent: { usd: 0, calls: 0 },
    ...extra,
  };
  writeFileSync(join(dir, `run-${id}.json`), JSON.stringify(run));
  return run;
}
