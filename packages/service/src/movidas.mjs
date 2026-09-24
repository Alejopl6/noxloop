// «Seguir aqui» o «Soltarla»: lo que el operador decide sobre una tarjeta
// «movida» (spec 005, US1 escenario 4, FR-004).
//
// QUE ES UNA MOVIDA. Una issue con run en este proyecto que ya no cumple sus
// reglas de ruteo (la movieron de proyecto en Linear, o cambiaron las reglas).
// El board la pinta con el chip «movida» y su destino (`board.mjs`,
// `movidasDe`); esta ruta guarda la respuesta del operador.
//
// EL GESTOR NO SE ENTERA, Y ES A PROPOSITO (principio VI). «Soltarla» no la
// mueve ni la cierra en Linear: la issue es del equipo, y alli ya esta donde
// alguien la puso. Tampoco se toca el run en disco: es del motor (principio
// III), y soltar una tarjeta del board no es cancelar un trabajo a medias. Lo
// que cambia es lo que pinta ESTE board, y por eso es dato del servicio, en el
// almacen (`movida_decision`), y su test cuenta cada llamada al proveedor.
//
// CUANDO SE OLVIDA. Una decision vale mientras la issue siga fuera de las
// reglas y en el mismo destino para el que se tomo:
//   - si la issue vuelve a cumplir las reglas, el board la pinta como una mas y
//     lo decidido no se mira (`construirBoard`);
//   - cambiar las reglas del gestor (`PATCH /tracker` con `opciones`) BORRA las
//     decisiones del proyecto: las reglas nuevas vuelven a preguntar;
//   - si la issue se va a OTRO destino, la decision no vale y el chip vuelve.
// El borrado no ocurre al pintar, porque pintar no escribe (SC-007). El hueco
// que queda, declarado: una issue que vuelve a cumplir las reglas SIN que
// cambien (la devolvieron en Linear) y luego sale otra vez AL MISMO destino
// encuentra su decision vieja.

import { exigir, exigirProyecto } from "./comun.mjs";
import { ErrorDeServicio } from "./errores.mjs";
import { runsConProyecto } from "./runs.mjs";

/** Las dos respuestas posibles. El almacen tiene el mismo enum en su CHECK. */
export const DECISIONES = Object.freeze(["seguir", "soltar"]);

/**
 * El destino que el board acaba de pintar para esta movida, de la cache del
 * listado (30 s), o `undefined` si ya no esta ahi.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {string} projectId
 * @param {string} itemId
 * @returns {string|null|undefined}
 */
function destinoPintado(p, projectId, itemId) {
  const cache = p.estado.motor?.cacheDelBoard;
  if (!cache) return undefined;
  for (const [clave, entrada] of cache) {
    if (!String(clave).startsWith(`${projectId}:`)) continue;
    const m = entrada?.valor?.movidas;
    if (m instanceof Map && m.get(itemId)) return m.get(itemId).destino ?? null;
  }
  return undefined;
}

/**
 * `POST /v1/projects/:id/board/movidas/:itemId {decision, destino?}`
 *
 * `destino` lo manda la interfaz (el que ve en la tarjeta) y solo se usa si el
 * servicio ya no lo tiene en la cache del board: lo que el servicio pinto gana
 * a lo que la pantalla dice que vio.
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function decisionDeMovida(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);
  const itemId = String(p.parametros.itemId ?? "");
  const cuerpo = await p.cuerpo();
  exigir(cuerpo, ["decision"], "`decision` es `seguir` (la tarjeta se queda aqui) o `soltar` (deja de pintarse aqui).");
  if (!DECISIONES.includes(cuerpo.decision)) {
    throw new ErrorDeServicio("cuerpo_invalido", {
      detalle: `\`${String(cuerpo.decision)}\` no es una decision sobre una tarjeta movida`,
      campos: ["decision"],
      opciones: [...DECISIONES],
    });
  }
  if ("destino" in cuerpo && cuerpo.destino !== null && (typeof cuerpo.destino !== "string" || !cuerpo.destino.trim())) {
    throw new ErrorDeServicio("cuerpo_invalido", {
      detalle: "`destino` es el nombre del proyecto del gestor adonde fue la issue (texto), o `null`",
      campos: ["destino"],
    });
  }

  // Solo se decide sobre un run DE ESTE proyecto: una tarjeta movida es, por
  // definicion, un run cuya issue ya no cumple las reglas. Sin run no hay
  // tarjeta a la que aplicar nada, y guardar la fila seria una decision que
  // nadie ve y que se aplicaria el dia que llegue un run.
  const { runs } = runsConProyecto(p);
  const tieneRun = runs.some((r) => r.itemId === itemId && r.proyecto && String(r.proyecto.id) === String(proyecto.id));
  if (!tieneRun) {
    throw new ErrorDeServicio("recurso_desconocido", {
      tipo: "run",
      id: itemId,
      de: `el proyecto \`${proyecto.nombre}\``,
      donde: `\`GET /v1/board?project=${proyecto.id}\` (las tarjetas con el chip «movida»)`,
    });
  }

  const pintado = destinoPintado(p, String(proyecto.id), itemId);
  const destino = pintado !== undefined ? pintado : typeof cuerpo.destino === "string" ? cuerpo.destino.trim() : null;
  const motor = p.estado.motor;
  const decidida = new Date(motor?.reloj ? motor.reloj() : Date.now()).toISOString();
  p.dep.almacen.movidas.decidir(String(proyecto.id), itemId, { decision: cuerpo.decision, destino, decidida });

  // Las demas ventanas repintan. Sin invalidar la cache del gestor: lo que
  // cambio no viene de el.
  p.estado.bus?.emitir?.("board.invalidado", { projectId: proyecto.id }, { project_id: proyecto.id });
  return { cuerpo: { decision: { itemId, decision: cuerpo.decision, destino, decidida } } };
}
