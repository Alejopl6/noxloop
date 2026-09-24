// `PATCH /v1/projects/:id/tracker` — las opciones y el mapa de estados del
// gestor de un proyecto (spec 003).
//
// -----------------------------------------------------------------------------
// EL HUECO QUE CIERRA
// -----------------------------------------------------------------------------
//
// `motor.mjs` compone la configuracion del motor leyendo
// `connection.capacidades.opcionesDelGestor` (organizacion, equipo...) y
// `connection.capacidades.stateMap`, y hasta aqui NINGUNA ruta los escribia.
// Un proyecto con un gestor que EXIGE opciones (organizacion y proyecto)
// quedaba en `sin_gestor` («necesita `organization` y `project`») sin pantalla
// que pudiera declararlas, y uno cuyo listado se acota por equipo listaba el
// espacio entero.
//
// -----------------------------------------------------------------------------
// CONTRA EL ESQUEMA DEL PROVEEDOR, AL GUARDAR
// -----------------------------------------------------------------------------
//
// El esquema lo declara el proveedor (`optionsSchema`) porque el servicio no
// sabe que necesita cada gestor (principio VI). El motor lo vuelve a comprobar
// al cargar; comprobarlo aqui tambien es lo que hace que una opcion mal escrita
// se vea al guardar y no en el stderr de un run.
//
// El validador de abajo es el SUBCONJUNTO que los esquemas de `providers/`
// usan —tipo, `required`, `properties`, `additionalProperties`, `items`,
// `enum`, `minimum`/`maximum`—. El del motor (`packages/engine/src/schema.mjs`)
// no se importa: este paquete viaja solo al escritorio y un import al motor
// revienta en el binario instalado. Y sus mensajes nombran el CAMPO y lo que se
// esperaba, nunca el valor: la prueba del centinela manda una credencial en
// cada campo de cada ruta.

import { exigirProyecto } from "./comun.mjs";
import { ErrorDeServicio } from "./errores.mjs";
import { datosDelProyecto } from "./motor.mjs";

/** Los estados que el `stateMap` de TODO proyecto declara: los que el motor escribe. */
const CANONICOS = Object.freeze(["todo", "in_progress", "blocked", "in_review", "done"]);

/** @param {any} v */
function tipoDe(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (Number.isInteger(v)) return "integer";
  return typeof v;
}

/**
 * Los problemas de `valor` contra `esquema`, por ruta. Vacio si valida.
 *
 * @param {any} esquema
 * @param {any} valor
 * @param {string} ruta
 * @param {string[]} [problemas]
 */
export function validarContraEsquema(esquema, valor, ruta, problemas = []) {
  if (!esquema || typeof esquema !== "object") return problemas;
  const t = tipoDe(valor);
  if (esquema.type) {
    const tipos = Array.isArray(esquema.type) ? esquema.type : [esquema.type];
    const ok = tipos.some((/** @type {string} */ x) => x === t || (x === "number" && t === "integer"));
    if (!ok) {
      problemas.push(`\`${ruta}\` tiene que ser ${tipos.join(" o ")}`);
      return problemas;
    }
  }
  if (Array.isArray(esquema.enum) && !esquema.enum.includes(valor)) {
    problemas.push(`\`${ruta}\` tiene que ser uno de ${esquema.enum.map((/** @type {any} */ e) => JSON.stringify(e)).join(", ")}`);
  }
  if (typeof valor === "number") {
    if (typeof esquema.minimum === "number" && valor < esquema.minimum) problemas.push(`\`${ruta}\` tiene que ser >= ${esquema.minimum}`);
    if (typeof esquema.maximum === "number" && valor > esquema.maximum) problemas.push(`\`${ruta}\` tiene que ser <= ${esquema.maximum}`);
  }
  if (t === "array" && esquema.items) {
    valor.forEach((/** @type {any} */ x, /** @type {number} */ i) => validarContraEsquema(esquema.items, x, `${ruta}[${i}]`, problemas));
  }
  if (t === "object") {
    const propiedades = esquema.properties ?? {};
    for (const requerido of Array.isArray(esquema.required) ? esquema.required : []) {
      if (!(requerido in valor)) problemas.push(`falta \`${ruta}.${requerido}\`, que el proveedor exige`);
    }
    for (const [k, v] of Object.entries(valor)) {
      if (Object.hasOwn(propiedades, k)) validarContraEsquema(propiedades[k], v, `${ruta}.${k}`, problemas);
      else if (esquema.additionalProperties === false) {
        problemas.push(`\`${ruta}.${k}\` no es una opcion que el proveedor conozca (conoce: ${Object.keys(propiedades).join(", ") || "ninguna"})`);
      } else if (esquema.additionalProperties && typeof esquema.additionalProperties === "object") {
        validarContraEsquema(esquema.additionalProperties, v, `${ruta}.${k}`, problemas);
      }
    }
  }
  return problemas;
}

/** @param {string[]} problemas @param {string[]} campos */
function rechazar(problemas, campos) {
  throw new ErrorDeServicio("cuerpo_invalido", { detalle: problemas.join("; "), campos });
}

/**
 * El `stateMap`: los cinco canonicos, todos (`null` es una respuesta: «este
 * gestor no tiene ese estado, no lo escribas»), y nada mas. `backlog` no entra:
 * es un estado de LECTURA del board y el esquema del motor rechaza la clave.
 *
 * @param {any} mapa
 */
function validarMapa(mapa) {
  if (!mapa || typeof mapa !== "object" || Array.isArray(mapa)) rechazar(["`stateMap` tiene que ser un objeto"], ["stateMap"]);
  const problemas = [];
  for (const c of CANONICOS) {
    if (!(c in mapa)) problemas.push(`falta \`stateMap.${c}\` (pon null si el gestor no tiene ese estado)`);
    else if (mapa[c] !== null && (typeof mapa[c] !== "string" || !mapa[c].trim())) {
      problemas.push(`\`stateMap.${c}\` tiene que ser el nombre del estado en el gestor, o null`);
    }
  }
  for (const k of Object.keys(mapa)) {
    if (!CANONICOS.includes(k)) {
      problemas.push(
        `\`stateMap.${k}\` no es un estado que el motor escriba (son ${CANONICOS.join(", ")})` +
          (k === "backlog" ? ": backlog es de lectura del board, y el gestor lo reconoce por su cuenta" : ""),
      );
    }
  }
  if (problemas.length) rechazar(problemas, ["stateMap"]);
  return Object.fromEntries(CANONICOS.map((c) => [c, mapa[c]]));
}

/**
 * `PATCH /v1/projects/:id/tracker {opciones?, stateMap?}`
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function opcionesDelGestor(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);
  const motor = p.estado.motor;
  const datos = datosDelProyecto(p.dep, proyecto, { raizDeProveedores: motor?.raizDeProveedores });
  const gestor = datos.gestor;

  if (!gestor || gestor.origen === "local" || !gestor.conexion) {
    throw new ErrorDeServicio("sin_gestor", {
      nombre: proyecto.nombre,
      hallado: gestor
        ? "el proyecto usa sus tareas propias (el gestor local), que no tiene opciones: las opciones son de un gestor externo conectado"
        : datos.gestorHallado,
    });
  }
  const conexion = p.dep.almacen.base.consultarUno("SELECT * FROM connection WHERE id = ?", [gestor.conexion]);
  if (!conexion || !conexion.project_id) {
    throw new ErrorDeServicio("gestor_compartido", { nombre: proyecto.nombre, proveedor: gestor.slug });
  }

  const cuerpo = await p.cuerpo();
  if (!cuerpo || typeof cuerpo !== "object" || (!("opciones" in cuerpo) && !("stateMap" in cuerpo))) {
    rechazar(["faltan `opciones` y `stateMap`: manda al menos uno"], ["opciones", "stateMap"]);
  }

  /** @type {Record<string, any>} */
  let capacidades = {};
  try {
    capacidades = JSON.parse(String(conexion.capacidades || "{}")) ?? {};
  } catch {
    /* una columna rota se reescribe entera con lo que ahora se valida */
  }

  if ("opciones" in cuerpo) {
    const cargar = motor?.cargarGestor;
    const modulo = cargar ? await cargar(gestor.nombre) : null;
    const esquema = modulo?.optionsSchema ?? { type: "object" };
    const problemas = validarContraEsquema(esquema, cuerpo.opciones, "opciones");
    if (problemas.length) rechazar(problemas, ["opciones"]);
    capacidades.opcionesDelGestor = cuerpo.opciones;
  }
  if ("stateMap" in cuerpo) capacidades.stateMap = validarMapa(cuerpo.stateMap);

  p.dep.almacen.base.escribir("UPDATE connection SET capacidades = ? WHERE id = ?", [JSON.stringify(capacidades), conexion.id]);

  // El board cacheaba los tickets con las opciones viejas: sin esto, el
  // operador corrige el equipo y sigue viendo el de antes durante 30 s.
  const cache = motor?.cacheDelBoard;
  if (cache) for (const k of [...cache.keys()]) if (k.startsWith(`${proyecto.id}:`)) cache.delete(k);
  p.estado.bus?.emitir?.("board.invalidado", { projectId: proyecto.id }, { project_id: proyecto.id });

  const ahora = datosDelProyecto(p.dep, proyecto, { raizDeProveedores: motor?.raizDeProveedores }).gestor;
  return {
    cuerpo: {
      gestor: {
        nombre: ahora?.nombre ?? gestor.nombre,
        conexion: String(conexion.id),
        opciones: ahora?.opciones ?? null,
        stateMap: capacidades.stateMap ?? null,
      },
    },
  };
}
