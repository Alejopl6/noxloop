// El handoff al motor: lanzar, aprobar, reintentar, y leer lo que el motor
// escribio.
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

//
// POR QUE LANZAR TAMPOCO ESCRIBE EL ESTADO DEL RUN. Desde la spec 003 este
// archivo LANZA el motor, y la tentacion es escribir un run «en cola» en disco
// para que el board lo vea. No se hace: lo que este servicio sabe de un run que
// todavia no empezo vive en memoria (`lanzador.mjs`), y el archivo lo crea el
// motor al planificar. Dos escritores del mismo archivo es justo lo que el
// principio VIII prohibe.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { coleccion, exigir, exigirProyecto, noEsta } from "./comun.mjs";
import { ErrorDeServicio } from "./errores.mjs";
import { datosDelProyecto, prepararMotor, secretosDelGestor, terminoPorDefecto } from "./motor.mjs";
import {
  MONTABLE_POR_EL_MOTOR, choqueConElRevisor, ejecutorDelProyecto, flotaDelProyecto, problemaDeEjecucion, resolverEjecutor,
} from "./ejecutor.mjs";
import { claveDelModelo, estadosDeRuntimes } from "./runtimes.mjs";
import { lockVivo } from "./lanzador.mjs";
import { ESTADOS_DEL_RUN, EN_VUELO, accionDelEstado, avanceDe, estadoDelRun, gastoDe } from "./estado-del-run.mjs";
import { bloqueoPara, bloqueosParaElBoard } from "./diagnostico.mjs";
import { vigilarTranscripts } from "./transcript.mjs";

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
export function esDelProyecto(run, proyecto) {
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
  // FR-064: el 409 NOMBRA la etapa que falta. "No esta activo" sin decir que
  // falta deja al operador recorriendo las seis etapas a mano para descubrir
  // cual es, y la que es suele ser la penultima. Va ANTES de leer el cuerpo:
  // un proyecto a medio establecer no se lanza, pida lo que pida.
  exigirActivo(p.dep, proyecto);

  const cuerpo = await p.cuerpo();
  exigir(cuerpo, ["itemId"], "`itemId` es el id del ticket en el gestor: es lo que el motor planifica.");
  const itemId = String(cuerpo.itemId);
  const motor = motorDe(p);

  // FR-016 ANTES de componer nada: el segundo clic sobre el mismo ticket no
  // reescribe la configuracion ni vuelve a sacar la credencial de la boveda.
  const existente = motor.lanzador.derivado(itemId);
  if (existente) return { codigo: 200, cuerpo: { run: existente } };

  // La PRIMERA preparacion se hace aqui, en la peticion: `sin_repo`,
  // `sin_gate`, `sin_gestor` y la credencial que falta salen como el error de
  // ESTA respuesta, con su accion, y no como un run fallido que el operador
  // descubre despues en una tarjeta. Lo mismo el ejecutor y el termino que el
  // motor no sabe cumplir (FR-031/032): el mismo motivo que el board pone en
  // el boton deshabilitado.
  const preparar = preparador(p, proyecto.id, itemId);
  const preparado = await preparar();
  // Y LO BLOQUEANTE DEL DIAGNOSTICO (spec 005, FR-008), que el board ya pone
  // en el boton deshabilitado: sin esto la tarjeta decia «falta git» y la ruta
  // lanzaba igual un motor que moria en su primer `git worktree`.
  await exigirSinBloqueo(p, proyecto, preparado.runtime);
  const r = await motor.lanzador.lanzar({
    projectId: proyecto.id,
    itemId,
    autonomia: String(proyecto.autonomia),
    maxParalelo: preparado.maxParalelo,
    preparado,
    preparar,
  });
  // Un run que arranca va a escribir transcripts: se arma el sondeo que avisa
  // cuando crecen (`run.transcript`), para que el detalle se actualice solo.
  vigilarTranscripts(p.estado);
  return { codigo: r.codigo, cuerpo: { run: r.run } };
}

/**
 * Lo que el servicio necesita para lanzar el motor, montado en `arrancar`.
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
function motorDe(p) {
  const motor = p.estado.motor;
  if (motor) return motor;
  throw new ErrorDeServicio("pieza_ausente", {
    pieza: "el lanzador del motor",
    porque: "este servicio se monto sin lanzador (`crearServidor` sin `motor`), asi que no puede arrancar el motor.",
    comoConseguirlo: "Arranca el servicio con `arrancar()`, que monta el lanzador sobre el mismo home.",
  });
}

/**
 * Quien ejecuta el ticket y como termina, resuelto en cascada (FR-031/032), y
 * el error si el motor no lo sabe cumplir.
 *
 * Solo una tarea LOCAL declara ejecutor y termino: un ticket de Linear no tiene
 * donde, y hereda del proyecto — su ejecutor, y su termino (`pr` con remoto,
 * `commit` sin el: `terminoPorDefecto`).
 *
 * @param {any} dep
 * @param {any} proyecto
 * @param {any} gestor el de `datosDelProyecto`
 * @param {string} itemId
 * @param {string|null} [remoto] el de `datosDelProyecto`
 */
export function ejecucionDe(dep, proyecto, gestor, itemId, remoto = null) {
  const tarea = gestor?.origen === "local" ? dep.almacen.tareas.porId(itemId) : null;
  const ejecutor = resolverEjecutor(tarea?.ejecutor ?? null, ejecutorDelProyecto(dep, proyecto.id));
  const termino = tarea ? String(tarea.termino) : terminoPorDefecto(remoto);
  // Con el revisor de la flota: la misma comprobacion de FR-034 que hace el
  // board (`choqueConElRevisor`), dicha antes de componer nada. Y el `pr` sin
  // remoto, con el proyecto para que `sin_repo` lo nombre.
  const problema = problemaDeEjecucion({
    ejecutor, termino, clave: tarea ? String(tarea.clave) : itemId, revisor: flotaDelProyecto(dep, proyecto.id).revisor,
    sinRemoto: remoto ? null : proyecto,
  });
  return { ejecutor, termino, problema, tarea };
}

/**
 * Prepara UN paso del motor: compone la configuracion desde el proyecto y saca
 * de la boveda la credencial del gestor. Se llama EN CADA PASO —al pulsar Run,
 * al encadenar el `run` tras el plan, al aprobar, al reintentar— y no una vez:
 * el grant se verifica en el instante del uso (principio IX), y la
 * configuracion se recompone por si el operador corrigio algo entre medias.
 *
 * EL GESTOR LOCAL, DENTRO DEL MOTOR. Sus tareas viven en el almacen y el motor
 * no puede abrirlo (seria un segundo escritor, principio VIII): el proveedor
 * local le habla al servicio por HTTP. Aqui se le pasa COMO: la URL de este
 * servicio como variable, y el token de sesion como SECRETO —al entorno del
 * subproceso y nunca a argv (principio IX), con la guarda de
 * `prepararLanzamiento` mirando que no aparezca en los argumentos—. El token
 * es el de la sesion entera: acotarlo a las rutas de tareas es un hueco
 * declarado, no resuelto.
 *
 * LA KEY DEL MODELO. Si el operador guardo una API key para el runtime
 * resuelto (Settings -> Modelos), sale de la boveda con el grant del proyecto,
 * en cada paso, igual que la del gestor. Sin key, el runtime usa la sesion
 * local del operador (`claude auth login`, `codex login`).
 *
 * LAS KEYS DE TODOS LOS RUNTIMES DEL RUN, no solo la del implementador (spec
 * 005, FR-008). El motor corre cada fase en el runtime de su ROL —la revision en
 * el revisor, la planificacion en el planificador— y cada fase recibe del
 * entorno del motor la variable que SU runtime declara. Si aqui solo se sacaba
 * la del implementador, un revisor sobre otro runtime corria sin modelo aunque
 * el operador hubiera guardado su key. Lo mismo para el implementador de una
 * tarea pasada a otro por un hand-off: su key tiene que estar en el entorno del
 * `resume` que la retoma. Solo por el entorno, y cada una con su grant (principio IX).
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {string} projectId
 * @param {string} itemId
 * @param {{runtimes?: string[], argumentos?: string[]}} [extra] runtimes de mas (el del hand-off) y
 *   argumentos del paso (`--task`, `--runtime` del hand-off) — ninguno es secreto
 */
function preparador(p, projectId, itemId, extra = {}) {
  const motor = motorDe(p);
  const dep = p.dep;
  const home = p.estado.home;
  return async () => {
    const proyecto = exigirProyecto(dep, projectId);
    if (proyecto.estado !== "ACTIVE") exigirActivo(dep, proyecto);
    if (!existsSync(motor.binDelMotor)) {
      throw new ErrorDeServicio("pieza_ausente", {
        pieza: "el motor de ejecucion",
        porque: `el binario del motor no esta en \`${motor.binDelMotor}\`.`,
        comoConseguirlo:
          "Reinstala la aplicacion, o arranca el servicio desde el monorepo, donde el motor vive en " +
          "`packages/engine/bin/noxloop.mjs`.",
      });
    }
    const datos = datosDelProyecto(dep, proyecto, { raizDeProveedores: motor.raizDeProveedores });
    const { ejecutor, termino, problema } = ejecucionDe(dep, proyecto, datos.gestor, itemId, datos.remoto);
    if (problema) throw problema;

    const { ruta, config, gestor, modulo } = await prepararMotor(dep, proyecto, {
      home,
      raizDeProveedores: motor.raizDeProveedores,
      cargarGestor: motor.cargarGestor,
      maxParallelItems: motor.maxParalelo,
      ejecutor,
      // El termino YA RESUELTO viaja al motor: es lo que decide si su ultimo
      // paso abre un PR o deja la rama lista en el repositorio local.
      termino: /** @type {"pr"|"commit"} */ (termino),
    });
    /** @type {Record<string, string>} */
    const secretos = { ...(await secretosDelGestor(dep, proyecto, gestor, modulo?.requiredEnv ?? [], "lanzar_runner")) };
    /** @type {Record<string, string>} */
    const variables = {};
    if (gestor?.origen === "local") {
      if (!motor.url) {
        throw new ErrorDeServicio("pieza_ausente", {
          pieza: "la direccion del servicio para el gestor local",
          porque:
            "el motor lee y escribe las tareas locales pidiendoselas a este servicio, y el servicio todavia no sabe en " +
            "que direccion escucha (se monto sin `listen`).",
          comoConseguirlo: "Arranca el servicio con `arrancar()`, que publica su direccion al motor al escuchar.",
        });
      }
      variables.NOXLOOP_SERVICE_URL = String(motor.url);
      secretos.NOXLOOP_SERVICE_TOKEN = String(p.estado.token);
    }
    for (const runtime of runtimesDelRun(dep, proyecto, home, itemId, ejecutor.runtime, extra.runtimes)) {
      Object.assign(secretos, await claveDelModelo(dep, proyecto, runtime));
    }
    return {
      rutaConfig: ruta,
      secretos,
      variables,
      maxParalelo: config.limits.maxParallelItems,
      // El runtime resuelto, para mirar el diagnostico contra el mismo que corre.
      runtime: ejecutor.runtime,
      ...(extra.argumentos?.length ? { argumentos: [...extra.argumentos] } : {}),
    };
  };
}

/**
 * Los runtimes que pueden correr alguna fase de este run: el implementador
 * resuelto, el revisor y el planificador de la flota, el implementador propio
 * de cada tarea que un hand-off ya paso a otro (leido del archivo del run, que
 * lo escribe el motor), y los que pida quien llama. Sin repetidos.
 *
 * @param {any} dep
 * @param {any} proyecto
 * @param {string} home
 * @param {string} itemId
 * @param {string} implementador
 * @param {string[]} [mas]
 */
function runtimesDelRun(dep, proyecto, home, itemId, implementador, mas = []) {
  const flota = flotaDelProyecto(dep, proyecto.id);
  const run = leerRuns(home).runs.find((r) => String(r?.item?.id) === String(itemId));
  const deTareas = (Array.isArray(run?.tasks) ? run.tasks : [])
    .map((/** @type {any} */ t) => t?.implementador?.runtime)
    .filter((/** @type {any} */ r) => typeof r === "string");
  return [...new Set([implementador, flota.revisor?.runtime, flota.planificador?.runtime, ...deTareas, ...mas].filter(Boolean))];
}

/**
 * Lo BLOQUEANTE del diagnostico que afecta a este runtime, como el error de la
 * peticion (spec 005, FR-008). Es la misma pregunta que hace el board
 * (`bloqueosParaElBoard` + `bloqueoPara`) y sale con el MISMO codigo del
 * problema —`binario_ausente`, `no_es_repositorio`...— y el motivo de la
 * tarjeta en `objeto.motivo`, para que la ruta y el boton digan lo mismo.
 *
 * Va DESPUES de preparar: lo que ya rechaza la composicion (sin repo, sin
 * gate...) sale con su propio codigo, igual que en la tarjeta, donde el motivo
 * del proyecto va antes que el del diagnostico.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {any} proyecto
 * @param {string} runtime
 */
async function exigirSinBloqueo(p, proyecto, runtime) {
  const bloqueos = await bloqueosParaElBoard(p, [proyecto]);
  const b = bloqueoPara(bloqueos.get(String(proyecto.id)), runtime);
  if (!b) return;
  // Un error de dominio con la forma del contrato (codigo, causa, accion): el
  // codigo es el del problema del diagnostico, que es el catalogo de ESE modulo.
  throw Object.assign(new Error(b.causa), {
    codigo: b.codigo,
    causa: b.causa,
    accion: b.accion,
    estado: 409,
    objeto: { motivo: b.motivo, afecta: b.afecta, nivel: b.nivel },
  });
}

/**
 * El 409 que nombra la etapa que falta, desde cualquier sitio que lo necesite.
 *
 * @param {any} dep
 * @param {any} proyecto
 */
function exigirActivo(dep, proyecto) {
  if (proyecto.estado === "ACTIVE") return;
  const falta = etapaQueFalta(dep, proyecto);
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

// ---------------------------------------------------------------------------
// Lo que el operador hace sobre un run: aprobar el plan, reintentar
// ---------------------------------------------------------------------------

/**
 * Las entradas de la bandeja que piden un permiso para un run, por item.
 *
 * La bandeja NO es un destino en el board (FR-026): sus entradas aparecen como
 * el chip «te necesita» de su tarjeta. Se reconocen por el item que declara su
 * contexto; la causa va COMPLETA, que es lo que el operador tiene que leer.
 *
 * @param {any} dep
 * @returns {Map<string, string>}
 */
export function permisosPendientes(dep) {
  /** @type {Map<string, string>} */
  const porItem = new Map();
  const filas = dep.almacen.base.consultar(
    "SELECT * FROM inbox_entry WHERE workspace_id = ? AND estado = 'esperando' AND tipo IN ('autorizacion_credencial', 'permiso_tool')",
    [dep.workspace.id],
  );
  for (const f of filas) {
    let contexto = {};
    try {
      contexto = JSON.parse(String(f.contexto || "{}")) ?? {};
    } catch {
      /* un contexto roto no atribuye la entrada a ningun run; la bandeja la sigue mostrando */
    }
    const c = /** @type {any} */ (contexto);
    const item = c.itemId ?? c.item_id ?? c.item;
    if (item !== undefined && item !== null && !porItem.has(String(item))) porItem.set(String(item), String(f.causa));
  }
  return porItem;
}

/**
 * Todo lo que se sabe de un run, junto: el archivo, lo que el lanzador tiene
 * en memoria, el lock y la bandeja.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {string} itemId
 * @param {{run?: any, permisos?: Map<string, string>}} [ya] lo ya leido, para no leerlo dos veces
 */
function estadoCompleto(p, itemId, ya = {}) {
  const home = p.estado.home;
  const run = ya.run !== undefined ? ya.run : leerRuns(home).runs.find((r) => String(r?.item?.id) === itemId) ?? null;
  const vivo = p.estado.motor ? p.estado.motor.lanzador.estado(itemId) : null;
  const permisos = ya.permisos ?? permisosPendientes(p.dep);
  const e = estadoDelRun(run, vivo, { lockVivo: lockVivo(home, itemId), permiso: permisos.get(itemId) ?? null });
  return { run, vivo, e };
}

/**
 * El proyecto de un run: el que lo lanzo, el que el run declara, o el que
 * contiene la ruta de sus tareas. Si ninguno, se dice.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {any} run
 * @param {any} vivo
 */
function proyectoDelRun(p, run, vivo) {
  const declarado = vivo?.projectId ?? run?.projectId ?? run?.project_id;
  if (typeof declarado === "string") return p.dep.almacen.proyectos.porId(declarado) ?? null;
  if (!run) return null;
  const todos = p.dep.almacen.base.consultar("SELECT * FROM project WHERE workspace_id = ?", [p.dep.workspace.id]);
  return todos.find((/** @type {any} */ pr) => esDelProyecto(run, pr)) ?? null;
}

/**
 * La parte comun de aprobar y reintentar.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {"approve"|"retry"} accion
 */
async function actuar(p, accion) {
  const itemId = p.parametros.id;
  const motor = motorDe(p);
  const { run, vivo, e } = estadoCompleto(p, itemId);
  if (!e) throw noEsta("run", itemId, "`GET /v1/runs`");

  const puede = accion === "approve" ? e.estado === "plan_listo" : accionDelEstado(e.estado) === "retry";
  const proyecto = proyectoDelRun(p, run, vivo);
  if (!puede) {
    const disponible = accionDelEstado(e.estado);
    throw new ErrorDeServicio("run_sin_esa_accion", {
      itemId,
      estado: e.estado,
      accion,
      projectId: proyecto?.id ?? null,
      cuando:
        accion === "approve"
          ? "cuando el plan esta escrito y esperando aprobacion (`plan_listo`)"
          : "cuando el run fallo, quedo bloqueado, se interrumpio o espera al operador",
      riesgo:
        accion === "approve"
          ? "ejecutaria un plan que nadie reviso, o lanzaria un segundo motor sobre el mismo ticket"
          : "lanzaria un segundo motor sobre un run que no lo necesita",
      disponible: disponible === "open_run" ? null : disponible,
    });
  }
  if (!proyecto) {
    throw noEsta("proyecto del run", itemId, "`GET /v1/projects`", "ningun proyecto de este espacio de trabajo");
  }
  exigirActivo(p.dep, proyecto);

  const preparar = preparador(p, proyecto.id, itemId);
  const preparado = await preparar();
  await exigirSinBloqueo(p, proyecto, preparado.runtime);
  const pedido = {
    projectId: proyecto.id,
    itemId,
    autonomia: String(proyecto.autonomia),
    maxParalelo: preparado.maxParalelo,
    preparado,
    preparar,
  };
  const r = accion === "approve" ? await motor.lanzador.aprobar(pedido) : await motor.lanzador.reintentar(pedido);
  vigilarTranscripts(p.estado);
  return { codigo: r.codigo, cuerpo: { run: r.run } };
}

/** `POST /v1/runs/:id/approve` — el plan es el punto de aprobacion humana del flujo. */
export async function aprobarRun(/** @type {import("./rutas.mjs").Peticion} */ p) {
  return actuar(p, "approve");
}

/** `POST /v1/runs/:id/retry` — retoma desde el disco (principio III). */
export async function reintentarRun(/** @type {import("./rutas.mjs").Peticion} */ p) {
  return actuar(p, "retry");
}

// ---------------------------------------------------------------------------
// El hand-off: pasar una tarea a otro agente (spec 005, US3, FR-007)
// ---------------------------------------------------------------------------

/**
 * Los estados de tarea que todavia tienen implementacion que pasar. Es la
 * lista de `TRASPASABLES` del motor (`packages/engine/src/state.mjs`), repetida
 * aqui porque este archivo no importa el motor (ver la cabecera). No es una
 * segunda regla: el motor la vuelve a comprobar al escribir y es el que manda;
 * esta solo evita lanzar un subproceso para que diga que no.
 */
const TAREA_CON_IMPLEMENTACION = Object.freeze(["pending", "in_progress", "red", "green", "blocked"]);

/**
 * `POST /v1/runs/:id/tasks/:taskId/handoff {runtime, agente?, nota?}`
 *
 * Valida TODO antes de lanzar —con causa y accion— y despues lanza `resume`
 * con la tarea y el runtime nuevo: el motor escribe el override (el servicio no
 * escribe estado del run, principio VIII), la reabre en la misma rama, y sigue.
 *
 * EL ORDEN DE LAS GUARDAS es el de «que tiene que cambiar para que se pueda»:
 * primero lo que no depende del runtime pedido (el run en vuelo, la tarea sin
 * implementacion pendiente), despues el runtime (registrado, el revisor, el
 * mismo de ahora) y al final lo que cuesta preguntar (si tiene sesion).
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function pasarAOtroAgente(p) {
  const itemId = p.parametros.id;
  const taskId = p.parametros.taskId;
  const home = p.estado.home;
  const motor = motorDe(p);
  const { run, vivo } = estadoCompleto(p, itemId);
  if (!run) throw noEsta("run", itemId, "`GET /v1/runs`");
  const tarea = (Array.isArray(run.tasks) ? run.tasks : []).find((/** @type {any} */ t) => t && String(t.id) === taskId);
  if (!tarea) throw noEsta("tarea", taskId, `\`GET /v1/runs/${itemId}\``, `el run ${itemId}`);

  const cuerpo = await p.cuerpo();
  exigir(cuerpo, ["runtime"], "`runtime` es el id del runtime que recibe la tarea (`GET /v1/runtimes`).");
  const runtime = String(cuerpo.runtime);
  const agente = typeof cuerpo.agente === "string" && cuerpo.agente.trim() ? cuerpo.agente.trim() : null;
  const nota = typeof cuerpo.nota === "string" && cuerpo.nota.trim() ? cuerpo.nota.trim() : null;

  const rechazo = (/** @type {string} */ razon, /** @type {string} */ porque, /** @type {string} */ comoSeguir) =>
    new ErrorDeServicio("handoff_rechazado", { itemId, taskId, runtime, porque, comoSeguir, objeto: { razon } });

  // Una fase en vuelo no se toca por atras: la tarea terminaria con la fase de
  // un agente y el estado del otro. Lo mismo un run en cola: va a arrancar.
  if (lockVivo(home, itemId) || (vivo && (EN_VUELO.includes(vivo.estado) || vivo.estado === "en_cola"))) {
    throw rechazo(
      "fase_en_vuelo",
      `el run esta ${vivo?.estado ?? "corriendo en otro proceso"}, y cambiarle el implementador a mitad de una fase la dejaria a medias entre dos agentes`,
      "Espera a que el run termine o se bloquee (o detenlo) y vuelve a pedir el hand-off.",
    );
  }
  if (!TAREA_CON_IMPLEMENTACION.includes(String(tarea.status))) {
    throw rechazo(
      "sin_implementacion",
      `la tarea esta en \`${tarea.status}\`: ya paso su GREEN con el gate verde (o esta integrada), y no le queda implementacion que pasar`,
      `Mira el detalle del run (\`GET /v1/runs/${itemId}\`): si lo que falla es la revision o la cola, un hand-off no lo cambia.`,
    );
  }

  const proyecto = proyectoDelRun(p, run, vivo);
  if (!proyecto) throw noEsta("proyecto del run", itemId, "`GET /v1/projects`", "ningun proyecto de este espacio de trabajo");
  exigirActivo(p.dep, proyecto);

  if (!Object.hasOwn(MONTABLE_POR_EL_MOTOR, runtime) || MONTABLE_POR_EL_MOTOR[runtime] !== null) {
    const soportados = Object.keys(MONTABLE_POR_EL_MOTOR).filter((k) => MONTABLE_POR_EL_MOTOR[k] === null);
    throw rechazo(
      "runtime_no_registrado",
      `el motor no tiene registrado ningun adaptador \`${runtime}\` que pueda implementar (los que hay: ${soportados.join(", ")})`,
      `Elige uno de ${soportados.map((s) => `\`${s}\``).join(" o ")}.`,
    );
  }
  // FR-034, con la MISMA regla que el lanzamiento y el board.
  const choque = choqueConElRevisor({ runtime, de: "el hand-off de la tarea" }, flotaDelProyecto(p.dep, proyecto.id).revisor);
  if (choque) throw choque;

  const actual = typeof tarea.implementador?.runtime === "string"
    ? tarea.implementador.runtime
    : ejecucionDe(p.dep, proyecto, datosDelProyecto(p.dep, proyecto, { raizDeProveedores: motor.raizDeProveedores }).gestor, itemId).ejecutor.runtime;
  if (runtime === actual) {
    throw rechazo(
      "mismo_runtime",
      `\`${runtime}\` ya es quien implementa la tarea: pasarsela a si mismo seria otro intento del mismo agente sin decir por que`,
      "Para que lo intente de nuevo el mismo agente usa Retry (o destrabala con nota); para cambiarlo, elige otro runtime.",
    );
  }
  const sesion = (await estadosDeRuntimes(p, [runtime])).get(runtime);
  if (sesion?.conectado === false) {
    throw rechazo(
      "runtime_desconectado",
      `\`${runtime}\` no tiene con que invocar al modelo: ${sesion.causa ?? sesion.detalle ?? "sin sesion ni API key"}`,
      sesion.accion ?? "Conecta el runtime en Settings → Modelos y vuelve a pedir el hand-off.",
    );
  }

  // El paso: `resume <item> --task <t> --runtime <r>`. La key del runtime nuevo
  // se saca de la boveda como la de los demas roles (ver `preparador`).
  const argumentos = ["--task", taskId, "--runtime", runtime, ...(agente ? ["--agente", agente] : []), ...(nota ? ["--nota", nota] : [])];
  const preparar = preparador(p, proyecto.id, itemId, { runtimes: [runtime], argumentos });
  const preparado = await preparar();
  await exigirSinBloqueo(p, proyecto, runtime);
  const r = await motor.lanzador.reintentar({
    projectId: proyecto.id,
    itemId,
    autonomia: String(proyecto.autonomia),
    maxParalelo: preparado.maxParalelo,
    preparado,
    preparar,
  });
  vigilarTranscripts(p.estado);
  return {
    codigo: r.codigo,
    cuerpo: {
      run: r.run,
      handoff: {
        taskId,
        de: actual,
        a: runtime,
        agente,
        // Con el rojo verificado el motor la retoma en GREEN y no repite RED;
        // sin el, no hay rojo que conservar y empieza por RED.
        retomaEn: tarea.redVerified === true ? "GREEN" : "RED",
        // Los intentos NO se reponen (principio III): un bucle agotado deja un
        // intento, que el motor declara en el run (`tasks[].handoffs`).
        attempts: tarea.attempts ?? null,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Las dos lecturas nuevas: `/v1/runs` y `/v1/usage`
// ---------------------------------------------------------------------------

/**
 * Los runs del disco y los que el servicio tiene en memoria sin archivo
 * todavia (en cola, planificando, el plan que fallo), con su proyecto.
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export function runsConProyecto(p) {
  const { runs, avisos } = leerRuns(p.estado.home);
  const permisos = permisosPendientes(p.dep);
  const proyectos = p.dep.almacen.base.consultar("SELECT * FROM project WHERE workspace_id = ?", [p.dep.workspace.id]);
  const porId = new Map(proyectos.map((/** @type {any} */ pr) => [String(pr.id), pr]));
  const vivos = p.estado.motor ? p.estado.motor.lanzador.estados() : [];

  const salida = [];
  const vistos = new Set();
  for (const run of runs) {
    const itemId = String(run?.item?.id ?? "");
    if (!itemId) continue;
    vistos.add(itemId);
    const vivo = vivos.find((/** @type {any} */ v) => v.itemId === itemId) ?? null;
    const declarado = vivo?.projectId ?? run.projectId ?? run.project_id;
    const proyecto =
      typeof declarado === "string"
        ? porId.get(declarado) ?? null
        : proyectos.find((/** @type {any} */ pr) => esDelProyecto(run, pr)) ?? null;
    const e = estadoDelRun(run, vivo, { lockVivo: lockVivo(p.estado.home, itemId), permiso: permisos.get(itemId) ?? null });
    salida.push({ itemId, run, proyecto, e });
  }
  for (const vivo of vivos) {
    if (vistos.has(vivo.itemId)) continue;
    const e = estadoDelRun(null, vivo, { permiso: permisos.get(vivo.itemId) ?? null });
    salida.push({ itemId: vivo.itemId, run: null, proyecto: porId.get(vivo.projectId) ?? null, e });
  }
  return { runs: salida, avisos };
}

/** @param {any} proyecto */
const proyectoCorto = (proyecto) => (proyecto ? { id: String(proyecto.id), nombre: String(proyecto.nombre), color: null } : null);

/** `GET /v1/runs?project=<id>&estado=...` */
export async function listaDeRuns(/** @type {import("./rutas.mjs").Peticion} */ p) {
  const proyectoPedido = p.url.searchParams.get("project");
  if (proyectoPedido) exigirProyecto(p.dep, proyectoPedido);
  const estadoPedido = p.url.searchParams.get("estado");
  if (estadoPedido && !ESTADOS_DEL_RUN.includes(estadoPedido)) {
    throw new ErrorDeServicio("parametro_invalido", { parametro: "estado", valor: estadoPedido, opciones: [...ESTADOS_DEL_RUN] });
  }

  const { runs, avisos } = runsConProyecto(p);
  const items = runs
    .filter((r) => !proyectoPedido || r.proyecto?.id === proyectoPedido)
    .filter((r) => !estadoPedido || r.e?.estado === estadoPedido)
    .map((r) => ({
      itemId: r.itemId,
      proyecto: proyectoCorto(r.proyecto),
      titulo: r.run?.item?.title ?? null,
      estado: r.e?.estado ?? null,
      detalle: r.e?.detalle ?? null,
      posicion: r.e?.posicion ?? null,
      avance: avanceDe(r.run, r.e?.estado ?? null),
      pr: r.run?.item?.pr ?? null,
      // Con el termino `commit` el final no es un PR sino esta rama, en el
      // repositorio del operador. `null` en cualquier otro caso.
      rama: r.run?.item?.ramaLista?.rama ?? null,
      gasto: r.run ? gastoDe(r.run) : null,
      creado: r.run?.createdAt ?? null,
      actualizado: r.run?.updatedAt ?? null,
    }))
    .sort((a, b) => String(b.actualizado ?? "").localeCompare(String(a.actualizado ?? "")));
  return { cuerpo: coleccion(items, { avisos }) };
}

/**
 * Una fecha de la query, o el 400 que dice como escribirla.
 *
 * @param {URL} url
 * @param {string} nombre
 */
function fechaDe(url, nombre) {
  const crudo = url.searchParams.get(nombre);
  if (!crudo) return null;
  const ms = Date.parse(crudo);
  if (Number.isNaN(ms) || !/^\d{4}-\d{2}-\d{2}/.test(crudo)) {
    throw new ErrorDeServicio("parametro_invalido", {
      parametro: nombre,
      valor: crudo,
      opciones: ["una fecha ISO 8601, como 2026-09-01 o 2026-09-01T00:00:00Z"],
    });
  }
  return ms;
}

/**
 * `GET /v1/usage?desde=<ISO>&hasta=<ISO>` — lo gastado, a partir de lo que cada
 * run ya registra. No mide nada nuevo, y distingue «sin medir» de cero
 * (FR-028): un run con invocaciones y cero dolares se cuenta en `sinMedir`, no
 * como gratis.
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function uso(p) {
  const desde = fechaDe(p.url, "desde");
  const hasta = fechaDe(p.url, "hasta");
  const { runs, avisos } = runsConProyecto(p);

  const total = { usd: 0, calls: 0, sinMedir: 0 };
  /** @type {Map<string, any>} */
  const porProyecto = new Map();
  const detalle = [];
  const redondear = (/** @type {number} */ n) => Math.round(n * 1e6) / 1e6;

  for (const r of runs) {
    if (!r.run) continue;
    const cuando = Date.parse(String(r.run.updatedAt ?? r.run.createdAt ?? ""));
    if (desde !== null && !(cuando >= desde)) continue;
    if (hasta !== null && !(cuando <= hasta)) continue;
    const g = gastoDe(r.run);
    total.usd = redondear(total.usd + g.usd);
    total.calls += g.calls;
    if (!g.medido) total.sinMedir++;
    const clave = r.proyecto ? String(r.proyecto.id) : "";
    const acc = porProyecto.get(clave) ?? { proyecto: proyectoCorto(r.proyecto), usd: 0, calls: 0, sinMedir: 0 };
    acc.usd = redondear(acc.usd + g.usd);
    acc.calls += g.calls;
    if (!g.medido) acc.sinMedir++;
    porProyecto.set(clave, acc);
    detalle.push({
      itemId: r.itemId,
      proyecto: proyectoCorto(r.proyecto),
      titulo: r.run?.item?.title ?? null,
      usd: g.usd,
      calls: g.calls,
      medido: g.medido,
    });
  }

  return {
    cuerpo: {
      total,
      porProyecto: [...porProyecto.values()].sort((a, b) => b.usd - a.usd),
      runs: detalle.sort((a, b) => b.usd - a.usd || b.calls - a.calls),
      avisos,
    },
  };
}
