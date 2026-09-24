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
import { prepararMotor, secretosDelGestor } from "./motor.mjs";
import { lockVivo } from "./lanzador.mjs";
import { ESTADOS_DEL_RUN, accionDelEstado, avanceDe, estadoDelRun, gastoDe } from "./estado-del-run.mjs";

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
  // descubre despues en una tarjeta.
  const preparar = preparador(p, proyecto.id);
  const preparado = await preparar();
  const r = await motor.lanzador.lanzar({
    projectId: proyecto.id,
    itemId,
    autonomia: String(proyecto.autonomia),
    maxParalelo: preparado.maxParalelo,
    preparado,
    preparar,
  });
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
 * Prepara UN paso del motor: compone la configuracion desde el proyecto y saca
 * de la boveda la credencial del gestor. Se llama EN CADA PASO —al pulsar Run,
 * al encadenar el `run` tras el plan, al aprobar, al reintentar— y no una vez:
 * el grant se verifica en el instante del uso (principio IX), y la
 * configuracion se recompone por si el operador corrigio algo entre medias.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {string} projectId
 */
function preparador(p, projectId) {
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
    const { ruta, config, gestor, modulo } = await prepararMotor(dep, proyecto, {
      home,
      raizDeProveedores: motor.raizDeProveedores,
      cargarGestor: motor.cargarGestor,
      maxParallelItems: motor.maxParalelo,
    });
    const secretos = await secretosDelGestor(dep, proyecto, gestor, modulo?.requiredEnv ?? [], "lanzar_runner");
    return { rutaConfig: ruta, secretos, maxParalelo: config.limits.maxParallelItems };
  };
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

  const preparar = preparador(p, proyecto.id);
  const preparado = await preparar();
  const pedido = {
    projectId: proyecto.id,
    itemId,
    autonomia: String(proyecto.autonomia),
    maxParalelo: preparado.maxParalelo,
    preparado,
    preparar,
  };
  const r = accion === "approve" ? await motor.lanzador.aprobar(pedido) : await motor.lanzador.reintentar(pedido);
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
