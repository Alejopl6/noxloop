// El modo rapido: de «nombre + carpeta» al board en UNA decision (spec 003,
// US8, FR-033..036).
//
// -----------------------------------------------------------------------------
// EL PROBLEMA
// -----------------------------------------------------------------------------
//
// El board solo pinta proyectos `ACTIVE`, y llegar ahi pedia recorrer siete
// pantallas del asistente. El operador tenia tres proyectos en `CREATED` que el
// board ignoraba. El referente (Nodal) resuelve el alta con «proyecto = nombre
// + repo, y listo», y la decision del operador fue: «el concepto debe ser
// simple».
//
// -----------------------------------------------------------------------------
// LO QUE ESTO NO ES: UN ATAJO QUE SALTE LAS GUARDAS
// -----------------------------------------------------------------------------
//
// El almacen sigue siendo el escritor unico de `project.estado` y sus guardas
// siguen yendo a buscar el artefacto de cada etapa (principio VIII). El modo
// rapido PRODUCE esos artefactos —un snapshot de verdad, una constitution
// derivada de el, un bootstrap con cada recomendacion decidida, el gestor
// declarado, una flota— y pide cada transicion como la pediria el asistente.
// Si un artefacto no se puede producir, la guarda dice que no y este archivo
// para ahi. Lo que cambia es QUIEN decide cada etapa: una sola decision del
// operador («Activar» o «Crear y abrir board») en vez de siete.
//
// -----------------------------------------------------------------------------
// LO QUE NO ESCRIBE, Y ES LA MITAD QUE IMPORTA
// -----------------------------------------------------------------------------
//
// Nada en el repositorio del operador. «Activar» es la decision de llegar al
// board, no la de escribir `CONSTITUTION.md` ni los archivos del bootstrap
// (FR-026 de la 002: nada se escribe sin decision explicita). La constitution
// queda en el almacen y se DICE como hueco; las recomendaciones se omiten con
// motivo y se pueden volver a proponer desde Settings. Hay un test que mide el
// arbol antes y despues.
//
// -----------------------------------------------------------------------------
// PARAR DONDE SE LLEGO
// -----------------------------------------------------------------------------
//
// Cada etapa se da o no se da. Si una no se puede —carpeta sin git, scanner
// caido, un tracker propio sin vida—, la respuesta es `409
// modo_rapido_detenido` nombrando la etapa, y el proyecto se queda en el
// estado al que llego: lo hecho antes tiene su artefacto y no se deshace
// (retroceder no existe en la maquina de estados).

import { existsSync } from "node:fs";
import { join } from "node:path";

import { exigirProyecto } from "./comun.mjs";
import { ErrorDeServicio } from "./errores.mjs";
import { lanzarEscaneo } from "./escaneo.mjs";
import { activarProyecto } from "./flota.mjs";
import { datosDelProyecto } from "./motor.mjs";
import { fijarConstitutionMinima, resolverBootstrapOmitiendo } from "./nucleo.mjs";
import { estadosDeRuntimes } from "./runtimes.mjs";

/** Quien firma las transiciones y los eventos del modo rapido en la auditoria. */
const ACTOR = "operador (modo rapido)";

/** El motivo con el que quedan omitidas las recomendaciones del bootstrap. */
const MOTIVO_DEL_BOOTSTRAP =
  "omitida por el modo rapido: activar el proyecto no es la decision de escribir en su repositorio. " +
  "Se puede volver a proponer desde Settings -> Bootstrap.";

/** La flota por defecto (FR-036). El modelo lo elige el motor por tier; el agente solo lo declara. */
const IMPLEMENTADOR = Object.freeze({ nombre: "implementador", runtime: "claude-agent-sdk" });
const REVISOR = Object.freeze({ nombre: "revisor", runtime: "codex" });
const MODELO_POR_DEFECTO = "por-defecto-del-runtime";

/**
 * Las etapas, en el orden de la maquina de estados. `desde` es el estado en el
 * que la etapa se da; `artefacto`, la guarda que la juzga.
 */
const ETAPAS = Object.freeze([
  { etapa: "snapshot", desde: "CREATED", hasta: "DISCOVERED", artefacto: "snapshot_aceptado" },
  { etapa: "constitution", desde: "DISCOVERED", hasta: "CONSTITUTED", artefacto: "constitution_vigente" },
  { etapa: "bootstrap", desde: "CONSTITUTED", hasta: "BOOTSTRAPPED", artefacto: "bootstrap_resuelto" },
  { etapa: "conexion", desde: "BOOTSTRAPPED", hasta: "CONNECTED", artefacto: "conexion_viva" },
  { etapa: "flota", desde: "CONNECTED", hasta: "ACTIVE", artefacto: "flota_declarada" },
]);

/**
 * `POST /v1/projects/:id/quickstart`
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function quickstart(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);
  return { cuerpo: await activarRapido(p, proyecto) };
}

/**
 * Lleva el proyecto a `ACTIVE` por las cinco guardas, sin preguntar nada mas.
 * Tambien lo usa `POST /v1/projects` con `rapido: true`.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {any} inicial
 * @returns {Promise<{proyecto: any, pasos: Array<{etapa: string, hecho: string}>, huecos: Array<{etapa: string, causa: string, accion: string}>}>}
 */
export async function activarRapido(p, inicial) {
  /** @type {Array<{etapa: string, hecho: string}>} */
  const pasos = [];
  /** @type {Array<{etapa: string, causa: string, accion: string}>} */
  const huecos = [];
  let proyecto = inicial;

  // Ya activo: no hay nada que hacer, y decirlo con `pasos: []` es mas util
  // que un 409 — el doble clic en «Activar» no es un error del operador.
  if (proyecto.estado === "ACTIVE") return { proyecto, pasos, huecos };

  // La etapa 0: un repositorio debajo. Sin `.git` no hay snapshot
  // reproducible, ni worktree, ni PR: parar aqui y no tres etapas despues.
  // `existsSync` y no «es directorio»: en un worktree `.git` es un archivo.
  if (!existsSync(join(String(proyecto.ruta_local), ".git"))) {
    detener(proyecto, "repositorio", {
      hallado: `\`${proyecto.ruta_local}\` no es un repositorio git (no hay \`.git\` dentro)`,
      comoConseguirlo:
        `Inicializalo con \`git init ${proyecto.ruta_local}\` —y un primer commit— y vuelve a pulsar Activar, ` +
        "o abre la configuracion completa del proyecto.",
    });
  }

  for (const e of ETAPAS) {
    const actual = p.dep.almacen.proyectos.porId(proyecto.id);
    if (!actual) detener(proyecto, e.etapa, { hallado: "el proyecto ya no existe", comoConseguirlo: "Vuelve a darlo de alta." });
    proyecto = actual;
    if (proyecto.estado !== e.desde) continue;

    const hecho = await darEtapa(p, proyecto, e, huecos);
    const veredicto = p.dep.almacen.proyectos.artefactos(proyecto.id)[e.artefacto];
    if (!veredicto.listo) detener(proyecto, e.etapa, veredicto);

    // La constitution y la flota transicionan por su propia via (`fijar` y
    // `activarProyecto`); las demas se piden aqui, al almacen, con su guarda.
    const ahora = p.dep.almacen.proyectos.porId(proyecto.id);
    if (ahora.estado === e.desde) {
      try {
        p.dep.almacen.proyectos.transicionar(proyecto.id, e.hasta, { actor: ACTOR });
      } catch (err) {
        detenerPorExcepcion(proyecto, e.etapa, err);
      }
      p.estado.bus.emitir(
        "proyecto.estado",
        { estado: e.hasta, motivo: `${e.etapa} resuelto por el modo rapido` },
        { project_id: proyecto.id },
      );
    }

    // CADA ETAPA DEJA SU RASTRO. La transicion ya queda en la auditoria (el
    // almacen la registra); esto registra ademas QUE decidio el modo rapido en
    // nombre del operador, que es lo que alguien va a preguntar despues.
    p.dep.almacen.auditoria.registrar({
      actor: ACTOR,
      accion: "proyecto.modo_rapido",
      objeto_tipo: "project",
      objeto_id: proyecto.id,
      resultado: "permitido",
      detalle: { etapa: e.etapa, hecho },
    });
    pasos.push({ etapa: e.etapa, hecho });
  }

  proyecto = p.dep.almacen.proyectos.porId(proyecto.id);
  // El board cacheaba la lista sin este proyecto: sin invalidarla, el operador
  // pulsa «Activar» y sigue sin verlo durante 30 s.
  const cache = p.estado.motor?.cacheDelBoard;
  if (cache) cache.clear();
  p.estado.bus.emitir("board.invalidado", { projectId: proyecto.id }, { project_id: proyecto.id });

  return { proyecto, pasos, huecos };
}

/**
 * Produce el artefacto de UNA etapa. Devuelve que se hizo, en una frase.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {any} proyecto
 * @param {{etapa: string, artefacto: string}} e
 * @param {Array<{etapa: string, causa: string, accion: string}>} huecos
 * @returns {Promise<string>}
 */
async function darEtapa(p, proyecto, e, huecos) {
  const listo = () => p.dep.almacen.proyectos.artefactos(proyecto.id)[e.artefacto].listo;

  if (e.etapa === "snapshot") return etapaDelSnapshot(p, proyecto);

  if (e.etapa === "constitution") {
    if (listo()) return "ya habia una constitution vigente: se usa esa";
    let fijada;
    try {
      fijada = fijarConstitutionMinima(p, proyecto);
    } catch (err) {
      detenerPorExcepcion(proyecto, e.etapa, err);
    }
    if (fijada.noEscritas.length > 0) {
      huecos.push({
        etapa: "constitution",
        causa:
          `la constitution ${fijada.constitution.version} vive solo en el almacen: no se escribio ` +
          `\`${fijada.noEscritas.join("`, `")}\` en el repositorio, porque activar no es la decision de escribir en el`,
        accion: "Revisala y fijala desde Settings del proyecto -> Constitution: ahi se escribe en el repositorio.",
      });
    }
    if (fijada.vacios.length > 0) {
      huecos.push({
        etapa: "constitution",
        causa: `el snapshot no dio para ${fijada.vacios.length} apartado(s) (${fijada.vacios.join(", ")}): quedan vacios, declarados como hueco`,
        accion: "Completalos desde Settings del proyecto -> Constitution cuando sepas que poner.",
      });
    }
    return `constitution ${fijada.constitution.version} derivada del snapshot, fijada sin escribir en el repositorio`;
  }

  if (e.etapa === "bootstrap") {
    if (listo()) return "el bootstrap ya estaba resuelto";
    let r;
    try {
      r = resolverBootstrapOmitiendo(p, proyecto, MOTIVO_DEL_BOOTSTRAP);
    } catch (err) {
      detenerPorExcepcion(proyecto, e.etapa, err);
    }
    if (r.omitidas > 0) {
      huecos.push({
        etapa: "bootstrap",
        causa: `${r.omitidas} recomendacion(es) del bootstrap quedaron omitidas sin aplicar: nada se escribio en el repositorio`,
        accion: "Revisalas desde Settings del proyecto -> Bootstrap y aplica las que quieras con su diff delante.",
      });
    }
    return `${r.total} recomendacion(es) del bootstrap, ${r.omitidas} omitida(s) por el modo rapido`;
  }

  if (e.etapa === "conexion") {
    if (listo()) return p.dep.almacen.proyectos.artefactos(proyecto.id).conexion_viva.hallado;
    // Solo el gestor LOCAL se declara solo. Si el motor ve otro gestor —o
    // ninguno—, la guarda dira por que no, sin relajarse (FR-035).
    const datos = datosDelProyecto(p.dep, proyecto, { raizDeProveedores: p.estado.motor?.raizDeProveedores });
    if (datos.gestor?.origen === "local") {
      const { prefijo } = p.dep.almacen.tareas.declararGestorLocal(proyecto.id);
      return `gestor local declarado: las tareas propias del proyecto, con claves \`${prefijo}-<n>\``;
    }
    return "no se declaro el gestor local: el proyecto tiene otro gestor";
  }

  // La flota.
  const existentes = p.dep.almacen.agentes.porProyecto(proyecto.id);
  if (existentes.some((/** @type {any} */ a) => a.rol === "implementador")) {
    // Una flota que el operador ya declaro manda. Reemplazarla seria decidir
    // por el algo que ya decidio.
    activarSinExcepcion(p, proyecto, e.etapa);
    return `se respeta la flota ya declarada (${existentes.length} agente(s))`;
  }
  const declarados = await declararFlotaPorDefecto(p, proyecto, huecos);
  activarSinExcepcion(p, proyecto, e.etapa);
  return `flota por defecto: ${declarados.join(", ")}`;
}

/**
 * El snapshot: el ultimo completo si lo hay, si no uno nuevo esperado hasta
 * el final. Y cada hallazgo PENDIENTE queda aceptado tal como se detecto; los
 * que el operador ya decidio (corregido, descartado) no se tocan.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {any} proyecto
 */
async function etapaDelSnapshot(p, proyecto) {
  const base = p.dep.almacen.base;
  const ultimo = () =>
    base.consultarUno(
      "SELECT id FROM project_snapshot WHERE project_id = ? AND estado = 'completo' ORDER BY creado DESC LIMIT 1",
      [proyecto.id],
    );

  let snapshot = ultimo();
  let nuevo = false;
  if (!snapshot) {
    const { fin } = lanzarEscaneo(p.dep, p.estado.bus, proyecto);
    const r = await fin;
    if (r.estado !== "completo") {
      detener(proyecto, "snapshot", {
        hallado: `el escaneo no termino (${r.estado}): ${r.causa ?? "sin causa declarada"}`,
        comoConseguirlo: r.accion ?? "Vuelve a pulsar Activar, o escanea desde la configuracion completa.",
      });
    }
    snapshot = ultimo();
    nuevo = true;
  }

  let aceptados = 0;
  for (const h of p.dep.almacen.snapshots.hallazgos(snapshot.id)) {
    if (h.decision !== "pendiente") continue;
    p.dep.almacen.snapshots.decidirHallazgo(h.id, { decision: "aceptado" });
    aceptados++;
  }
  return `${nuevo ? "snapshot nuevo" : "ultimo snapshot completo"} con ${aceptados} hallazgo(s) aceptado(s) tal como se detectaron`;
}

/**
 * La flota por defecto (FR-036): Claude implementa; revisa Codex si esta
 * conectado, porque FR-034 exige un runtime distinto del implementador. Si
 * Codex no esta, se declara SOLO el implementador y el revisor que falta se
 * dice como hueco: un revisor sobre el mismo runtime aprobaria sus propios
 * puntos ciegos, y uno sobre un runtime sin sesion fallaria en la primera
 * revision.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {any} proyecto
 * @param {Array<{etapa: string, causa: string, accion: string}>} huecos
 */
async function declararFlotaPorDefecto(p, proyecto, huecos) {
  const estados = await estadosDeRuntimes(p, [IMPLEMENTADOR.runtime, REVISOR.runtime]);
  const claude = estados.get(IMPLEMENTADOR.runtime);
  const codex = estados.get(REVISOR.runtime);

  const crear = (/** @type {{nombre: string, runtime: string}} */ a, /** @type {string} */ rol) =>
    p.dep.almacen.agentes.crear({
      project_id: proyecto.id,
      nombre: a.nombre,
      rol,
      runtime: a.runtime,
      modelo: MODELO_POR_DEFECTO,
    });

  crear(IMPLEMENTADOR, "implementador");
  const declarados = [`implementador sobre \`${IMPLEMENTADOR.runtime}\``];

  if (!claude?.conectado) {
    huecos.push({
      etapa: "flota",
      causa:
        `el implementador usa \`${IMPLEMENTADOR.runtime}\` y ese runtime no tiene sesion ni API key en esta maquina: ` +
        "el board deshabilitara Run hasta que la tenga",
      accion: "Conectalo desde Settings -> Modelos (iniciar sesion con Claude o guardar una API key).",
    });
  }

  if (codex?.conectado) {
    crear(REVISOR, "revisor");
    declarados.push(`revisor sobre \`${REVISOR.runtime}\``);
  } else {
    huecos.push({
      etapa: "flota",
      causa:
        `sin revisor: FR-034 exige que revise un runtime distinto del implementador (\`${IMPLEMENTADOR.runtime}\`), ` +
        `y \`${REVISOR.runtime}\` no esta conectado en esta maquina`,
      accion:
        "Conecta Codex desde Settings -> Modelos y anade el revisor en Settings del proyecto -> Flota. Mientras " +
        "tanto el proyecto funciona sin revision cruzada.",
    });
  }
  return declarados;
}

/**
 * @param {import("./rutas.mjs").Peticion} p
 * @param {any} proyecto
 * @param {string} etapa
 */
function activarSinExcepcion(p, proyecto, etapa) {
  try {
    activarProyecto(p, proyecto, "flota declarada y activada por el modo rapido");
  } catch (err) {
    detenerPorExcepcion(proyecto, etapa, err);
  }
}

/**
 * @param {any} proyecto
 * @param {string} etapa
 * @param {{hallado: string, comoConseguirlo: string}} veredicto
 * @returns {never}
 */
function detener(proyecto, etapa, veredicto) {
  throw new ErrorDeServicio("modo_rapido_detenido", {
    nombre: proyecto.nombre,
    etapa,
    estado: proyecto.estado,
    hallado: veredicto.hallado,
    comoConseguirlo:
      veredicto.comoConseguirlo ||
      "Abre la configuracion completa del proyecto: el asistente retoma en esta etapa con lo que ya se hizo.",
    objeto: { tipo: "proyecto", id: proyecto.id, etapa, estado: proyecto.estado },
  });
}

/**
 * Una excepcion de una etapa convertida en la parada de esa etapa, con la
 * causa y la accion del paquete que la lanzo.
 *
 * @param {any} proyecto
 * @param {string} etapa
 * @param {any} err
 * @returns {never}
 */
function detenerPorExcepcion(proyecto, etapa, err) {
  if (err instanceof ErrorDeServicio && err.codigo === "modo_rapido_detenido") throw err;
  detener(proyecto, etapa, {
    hallado: String(err?.causa ?? err?.message ?? err),
    comoConseguirlo: String(err?.accion ?? ""),
  });
}
