// El handoff al motor. Tres rutas, y dos de ellas SOLO LEEN.
//
// EL INVARIANTE (FR-002, principio VIII). El estado del run lo escribe el
// motor, no este servicio. Estas rutas leen archivos y los proyectan. Hay un
// test que mide el disco antes y despues de un `GET` — el mismo que ya protege
// el board de v1 — y no es ceremonia: el unico escritor es lo que hace que las
// transiciones guardadas signifiquen algo, y un endpoint de lectura con permiso
// de escritura es un segundo escritor que no falla al escribir, falla tres
// pantallas despues cuando dos ventanas corrompen el mismo run.
//
// POR QUE ESTE ARCHIVO NO IMPORTA `packages/engine`. No solo por el empaquetado
// —que tambien—: importar el motor para leer su estado invita a llamar a algo
// del motor que SI escribe, y el import estaria ya puesto. Lo que hace falta
// para leer es `readFileSync` y `JSON.parse`, y eso es todo lo que hay aqui.
//
// POR QUE NUNCA LANZA POR UN ARCHIVO MALO. Una persona abre esto cuando algo ya
// se rompio. Si un JSON corrupto lo tumba, desaparece justo cuando hace falta.
// Todo fallo de lectura baja a un aviso VISIBLE, que es distinto de tragarselo.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { coleccion, exigirProyecto, noEsta } from "./comun.mjs";
import { ErrorDeServicio } from "./errores.mjs";

/** Donde el motor escribe el estado de cada run, dentro del home. */
const DIRECTORIO = "runs";

/** Como se llaman esos archivos. */
const PATRON = /^run-(.+)\.json$/;

/**
 * Lee todos los runs del home. No escribe, no repara, no crea el directorio.
 *
 * Que NO cree el directorio es parte del invariante: `mkdirSync` con
 * `recursive: true` sobre un directorio que ya existe no falla y parece
 * inofensivo, pero sobre uno que no existe es una escritura — y la prueba que
 * mide el disco la ve. Un home sin runs es un home sin runs.
 *
 * @param {string} home
 * @returns {{runs: any[], avisos: Array<{codigo: string, causa: string, accion: string}>}}
 */
export function leerRuns(home) {
  const dir = join(home, DIRECTORIO);
  /** @type {any[]} */
  const runs = [];
  /** @type {Array<{codigo: string, causa: string, accion: string}>} */
  const avisos = [];

  if (!existsSync(dir)) return { runs, avisos };

  let nombres;
  try {
    nombres = readdirSync(dir);
  } catch (e) {
    return {
      runs,
      avisos: [
        {
          codigo: "runs_ilegibles",
          causa: `no se pudo listar \`${dir}\`: ${e.message}`,
          accion: "Comprueba los permisos del directorio de runs dentro del home que declara `/v1/health`.",
        },
      ],
    };
  }

  for (const nombre of nombres.sort()) {
    const coincide = PATRON.exec(nombre);
    if (!coincide) continue;
    try {
      const run = JSON.parse(readFileSync(join(dir, nombre), "utf8"));
      runs.push(run);
    } catch (e) {
      // El aviso lleva la MISMA forma que un error —codigo, causa y accion—
      // porque es lo mismo: algo que no se pudo hacer y que la persona tiene
      // que poder ver y resolver. Lo unico que cambia es que no corta la
      // respuesta. Degradar visible, que es lo contrario de omitir la fila.
      avisos.push({
        codigo: "run_ilegible",
        causa: `\`${nombre}\` no se pudo leer como estado de run: ${e.message}. El resto de los runs se sigue mostrando.`,
        accion:
          `Mira \`${nombre}\` a mano en el directorio de runs del home. Este servicio lo deja como esta: ` +
          "repararlo seria escribir estado del run, y el unico escritor de eso es el motor.",
      });
    }
  }
  return { runs, avisos };
}

/**
 * De que proyecto es un run.
 *
 * POR QUE SE MIRA `project_id` Y SI NO, LA RUTA DE SUS REPOSITORIOS. El estado
 * del run nacio en la v1, cuando no habia proyectos: los archivos de entonces
 * no traen `project_id`. Adivinar por el titulo del ticket seria inventar una
 * correspondencia; mirar la ruta del worktree es un hecho comprobable. Lo que
 * no se puede atribuir se declara sin proyecto en vez de repartirse al azar.
 *
 * @param {any} run
 * @param {any} proyecto
 */
function esDelProyecto(run, proyecto) {
  // `projectId` es el nombre que el motor ESCRIBE: sus archivos de estado van
  // en camelCase (`milestoneId`, `createdAt`). Este lector buscaba
  // `project_id`, que es la convencion del almacen, y por eso no encontraba
  // nada ni cuando el campo existia. Se aceptan los dos porque un archivo
  // escrito por una version intermedia puede traer cualquiera, y equivocarse
  // aqui no da error: da una lista vacia, que se lee como "este proyecto no ha
  // corrido nada".
  const declarado = run?.projectId ?? run?.project_id;
  if (typeof declarado === "string") return declarado === proyecto.id;
  const rutas = Array.isArray(run?.tasks) ? run.tasks.map((/** @type {any} */ t) => t && t.repoPath).filter(Boolean) : [];
  return rutas.some((/** @type {string} */ r) => r === proyecto.ruta_local || r.startsWith(`${proyecto.ruta_local}/`));
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function runsDelProyecto(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);
  if (p.metodo === "POST") return lanzar(p, proyecto);

  const { runs, avisos } = leerRuns(p.estado.home);
  return { cuerpo: coleccion(runs.filter((r) => esDelProyecto(r, proyecto)), { avisos }) };
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function unRun(p) {
  const { runs, avisos } = leerRuns(p.estado.home);
  const run = runs.find((r) => r && r.item && String(r.item.id) === p.parametros.id);
  if (!run) throw noEsta("run", p.parametros.id, "`GET /v1/projects/:id/runs`");
  return { cuerpo: { run, avisos } };
}

/**
 * La etapa que falta, con el nombre que el operador reconoce.
 *
 * Sale de las guardas del almacen y no de una tabla escrita aqui: las guardas
 * VAN A BUSCAR —cuentan los hallazgos sin decidir, miran si hay conexion viva—
 * asi que saben decir no solo QUE falta sino QUE encontraron en su lugar. Una
 * tabla local diria "falta el snapshot" tambien cuando el snapshot esta y tiene
 * doce hallazgos sin decidir, que manda al operador al sitio equivocado.
 *
 * @param {any} dep
 * @param {any} proyecto
 */
function etapaQueFalta(dep, proyecto) {
  const artefactos = dep.almacen.proyectos.artefactos(proyecto.id);
  // El orden de las etapas es el orden del recorrido: la primera que falte es
  // la que bloquea, y las de despues no informan nada todavia.
  const ORDEN = ["snapshot_aceptado", "constitution_vigente", "bootstrap_resuelto", "conexion_viva", "flota_declarada"];
  for (const nombre of ORDEN) {
    const veredicto = artefactos[nombre];
    if (veredicto && !veredicto.listo) return { etapa: nombre, ...veredicto };
  }
  return null;
}

/**
 * @param {import("./rutas.mjs").Peticion} p
 * @param {any} proyecto
 */
async function lanzar(p, proyecto) {
  if (proyecto.estado !== "ACTIVE") {
    const falta = etapaQueFalta(p.dep, proyecto);
    // FR-064: el 409 NOMBRA la etapa que falta. "No esta activo" sin decir que
    // falta deja al operador recorriendo las seis etapas a mano para descubrir
    // cual es, y la que es suele ser la penultima.
    throw new ErrorDeServicio("proyecto_no_activo", {
      nombre: proyecto.nombre,
      estado: proyecto.estado,
      etapa: falta ? falta.etapa : "ninguna que el almacen sepa nombrar",
      hallado: falta ? falta.hallado : "todas las guardas dan por buena su etapa y el estado sigue sin ser ACTIVE",
      comoConseguirlo: falta
        ? falta.comoConseguirlo
        : `Pide \`GET /v1/projects/${proyecto.id}\` para ver el estado de cada artefacto y cual no cuadra.`,
    });
  }

  // El proyecto esta ACTIVE y aqui se acaba lo que este servicio puede hacer
  // solo: lanzar un ciclo es arrancar el motor, y el motor es quien escribe el
  // estado del run. Este servicio no lo tiene montado, y lo DICE. La
  // alternativa —devolver un `run_id` inventado y un 202— seria un run que la
  // interfaz pinta en curso y que nadie esta corriendo.
  throw new ErrorDeServicio("pieza_ausente", {
    pieza: "el motor de ejecucion",
    porque:
      `el proyecto \`${proyecto.nombre}\` esta ACTIVE y se puede lanzar, pero este servicio no tiene el motor ` +
      "conectado: quien escribe el estado de un run es el motor y no este proceso (principio VIII).",
    comoConseguirlo:
      "Lanza el ciclo con la CLI del motor sobre el mismo `--home` que este servicio (`/v1/health` lo dice), y " +
      "`GET /v1/projects/:id/runs` lo va a proyectar en cuanto exista el archivo de estado.",
  });
}
