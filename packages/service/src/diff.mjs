// `GET /v1/runs/:itemId/tasks/:taskId/diff` — lo que cambio cada agente (spec
// 003, US6, FR-029).
//
// -----------------------------------------------------------------------------
// DE GIT, NO DEL ESTADO DEL RUN
// -----------------------------------------------------------------------------
//
// El run no guarda diffs, y no deberia: una copia del diff en el estado se
// quedaria atras del repositorio en cuanto la cola de integracion rebase. Lo
// que el run SI guarda es donde mirar —la rama y el worktree de la tarea, el
// repositorio, la rama base— y los commits de una tarea se reconocen por su
// MENSAJE: `mensajeDeFase` del motor pone `(<tarea>, <ticket>)` al final del
// asunto de cada uno. Es lo que hace que la separacion test / implementacion
// —la evidencia visible del principio I— se lea sin conocer el motor.
//
// -----------------------------------------------------------------------------
// SOLO LECTURA, Y NO ES OBVIO (SC-007, principio VIII)
// -----------------------------------------------------------------------------
//
// `git status` y `git diff` REFRESCAN EL INDICE con solo consultarlos: escriben
// `.git/index` (o el del worktree) para cachear lo que vieron. Una ruta de
// lectura que escribe en el repositorio del operador es exactamente lo que el
// test de huella del board existe para impedir. Por eso cada `git` de aqui va
// con `--no-optional-locks` y `GIT_OPTIONAL_LOCKS=0`, que le prohiben a git
// esas escrituras oportunistas; y los archivos nuevos sin commitear se leen
// del disco en vez de con `git add -N`, que si escribiria.
//
// -----------------------------------------------------------------------------
// LOS PARCHES ENORMES SE CORTAN, Y LO DICEN
// -----------------------------------------------------------------------------
//
// Un archivo generado de 5 MB en el diff congela la ventana que lo pinta. Mas
// de `PARCHE_MAXIMO` se corta, con `cortado: true` y una linea final que lo
// dice; el recuento de lineas (`mas`, `menos`) sigue siendo el real.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { noEsta } from "./comun.mjs";
import { leerRun } from "./lanzador.mjs";

/** El tope de un parche: 200 KB, del contrato. */
export const PARCHE_MAXIMO = 200 * 1024;

/** El tope de un archivo nuevo sin commitear que se lee del disco para armar su parche. */
const ARCHIVO_NUEVO_MAXIMO = 2 * 1024 * 1024;

/**
 * Un `git` de SOLO LECTURA: sin locks opcionales (no refresca el indice), sin
 * paginador, sin color, y con el entorno del servicio sin las variables de git
 * que podrian redirigirlo a otro repositorio.
 *
 * @param {string} cwd
 * @param {string[]} args
 */
function git(cwd, args) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_PAGER: "cat", LC_ALL: "C" };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[k];
  return execFileSync("git", ["--no-optional-locks", "-C", cwd, "-c", "core.quotepath=off", ...args], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Si una rama existe, sin escribir nada. @param {string} cwd @param {string} rama */
function existeRama(cwd, rama) {
  try {
    git(cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${rama}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} parche */
function acotar(parche) {
  if (Buffer.byteLength(parche) <= PARCHE_MAXIMO) return { parche, cortado: false };
  const total = Buffer.byteLength(parche);
  const corte = Buffer.from(parche).subarray(0, PARCHE_MAXIMO - 256).toString("utf8").replace(/�+$/, "");
  return {
    parche: `${corte}\n… (parche cortado: se muestran ${Math.round(corte.length / 1024)} KB de ${Math.round(total / 1024)} KB)`,
    cortado: true,
  };
}

/**
 * Los archivos de un diff: estado, `+/-` y parche de cada uno, a partir de la
 * salida de `--name-status`, `--numstat` y del parche entero.
 *
 * @param {string} nombres salida de `--name-status -M`
 * @param {string} numeros salida de `--numstat -M`
 * @param {string} parches el parche completo
 */
function archivosDe(nombres, numeros, parches) {
  /** @type {Map<string, {ruta: string, estado: string, mas: number, menos: number, parche: string, cortado: boolean}>} */
  const porRuta = new Map();
  for (const linea of nombres.split("\n").filter(Boolean)) {
    const [estado, ...rutas] = linea.split("\t");
    const ruta = rutas.at(-1) ?? "";
    porRuta.set(ruta, { ruta, estado: estado[0], mas: 0, menos: 0, parche: "", cortado: false });
  }
  for (const linea of numeros.split("\n").filter(Boolean)) {
    const [mas, menos, ...resto] = linea.split("\t");
    // Un renombrado sale como `viejo => nuevo` o `dir/{a => b}/x`.
    let ruta = resto.join("\t");
    const llaves = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(ruta);
    if (llaves) ruta = `${llaves[1]}${llaves[3]}${llaves[4]}`.replace(/\/\//g, "/");
    else if (ruta.includes(" => ")) ruta = ruta.split(" => ").at(-1) ?? ruta;
    const a = porRuta.get(ruta);
    if (a) {
      a.mas = mas === "-" ? 0 : Number(mas);
      a.menos = menos === "-" ? 0 : Number(menos);
    }
  }
  for (const bloque of parches.split(/^diff --git /m).slice(1)) {
    const cabecera = /^a\/(.*?) b\/(.*)$/m.exec(bloque);
    const ruta = cabecera ? cabecera[2] : "";
    const a = porRuta.get(ruta);
    if (!a) continue;
    const desde = bloque.search(/^@@ /m);
    // Un binario no tiene `@@`: se dice en vez de dejar el parche vacio.
    const crudo = desde >= 0 ? bloque.slice(desde).replace(/\n$/, "") : "(archivo binario: sin parche de texto)";
    Object.assign(a, acotar(crudo));
  }
  return [...porRuta.values()];
}

/** @param {string} asunto */
function tipoDelCommit(asunto) {
  if (/^test[(:!]/.test(asunto)) return "test";
  // `mensajeDeFase` usa `feat` o, en un tier trivial, `chore` para el GREEN.
  if (/^(feat|fix|chore|refactor|perf)[(:!]/.test(asunto)) return "impl";
  return "otro";
}

/**
 * Los commits de la tarea: los de su rama (o la del ticket, si la suya ya no
 * esta) que no estan en la base y cuyo asunto lleva `(<tarea>, <ticket>)`.
 *
 * @param {string} repo
 * @param {any} run
 * @param {any} tarea
 */
function commitsDe(repo, run, tarea) {
  const ref = run.item?.key || `#${run.item?.id}`;
  const rama = [tarea.branch, run.item?.branch].find((r) => typeof r === "string" && r && existeRama(repo, r));
  if (!rama) return [];
  const base = run.item?.baseBranch && existeRama(repo, run.item.baseBranch) ? [`^${run.item.baseBranch}`] : [];
  const salida = git(repo, [
    "log",
    "--reverse",
    "--format=%H%x1f%B%x1e",
    "-F",
    `--grep=(${tarea.id}, ${ref})`,
    rama,
    ...base,
  ]);
  return salida
    .split("\x1e")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((registro) => {
      const [sha, mensaje] = registro.split("\x1f");
      const asunto = String(mensaje).split("\n")[0];
      return {
        sha,
        mensaje: String(mensaje).trim(),
        tipo: tipoDelCommit(asunto),
        archivos: archivosDe(
          git(repo, ["show", "--format=", "--name-status", "-M", sha]),
          git(repo, ["show", "--format=", "--numstat", "-M", sha]),
          git(repo, ["show", "--format=", "-M", "--no-color", "--no-ext-diff", sha]),
        ),
      };
    });
}

/**
 * Lo que la tarea lleva hecho en su worktree y no commiteo: lo modificado
 * respecto a HEAD, y los archivos nuevos (leidos del disco, sin `git add -N`,
 * que escribiria el indice).
 *
 * @param {string} wt
 */
function sinCommitearDe(wt) {
  const archivos = archivosDe(
    git(wt, ["diff", "HEAD", "--name-status", "-M"]),
    git(wt, ["diff", "HEAD", "--numstat", "-M"]),
    git(wt, ["diff", "HEAD", "-M", "--no-color", "--no-ext-diff"]),
  );
  const nuevos = git(wt, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
  for (const ruta of nuevos) {
    const abs = join(wt, ruta);
    let texto = "";
    try {
      if (statSync(abs).size > ARCHIVO_NUEVO_MAXIMO) {
        archivos.push({ ruta, estado: "A", mas: 0, menos: 0, parche: "(archivo nuevo de mas de 2 MB: no se lee)", cortado: true });
        continue;
      }
      texto = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const lineas = texto.split("\n");
    if (lineas.at(-1) === "") lineas.pop();
    const parche = `@@ -0,0 +1,${lineas.length} @@\n${lineas.map((l) => `+${l}`).join("\n")}`;
    archivos.push({ ruta, estado: "A", mas: lineas.length, menos: 0, ...acotar(parche) });
  }
  return { archivos };
}

/**
 * `GET /v1/runs/:id/tasks/:taskId/diff`
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function diffDeTarea(p) {
  const itemId = p.parametros.id;
  const run = leerRun(p.estado.home, itemId);
  if (!run) throw noEsta("run", itemId, "`GET /v1/runs`");
  const tarea = (Array.isArray(run.tasks) ? run.tasks : []).find((/** @type {any} */ t) => t && t.id === p.parametros.taskId);
  if (!tarea) throw noEsta("tarea", p.parametros.taskId, `\`GET /v1/runs/${itemId}\``, `el run ${itemId}`);

  const repo = [tarea.repoPath, tarea.worktree].find((r) => typeof r === "string" && r && existsSync(r)) ?? null;
  const commits = repo ? commitsDe(repo, run, tarea) : [];
  const enCurso = tarea.status !== "integrated" && typeof tarea.worktree === "string" && existsSync(tarea.worktree);

  return {
    cuerpo: {
      tarea: {
        id: String(tarea.id),
        titulo: tarea.title ?? null,
        estado: tarea.status ?? null,
        agente: run.runtime ?? null,
        rama: tarea.branch ?? null,
      },
      commits,
      sinCommitear: enCurso ? sinCommitearDe(tarea.worktree) : null,
    },
  };
}
