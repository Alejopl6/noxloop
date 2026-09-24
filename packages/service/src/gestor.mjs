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
import { datosDelProyecto, diagnosticar, secretosDelGestor } from "./motor.mjs";

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
  // Reglas nuevas, preguntas nuevas: lo que el operador decidio sobre sus
  // tarjetas «movidas» (spec 005, US1 esc. 4) se decidio con las reglas viejas.
  // Una issue que ahora las cumple vuelve a ser del proyecto, y si mañana sale
  // otra vez, el chip vuelve a preguntar en vez de aplicar una decision vieja
  // en silencio. Se borra AQUI porque el board no escribe (SC-007).
  const olvidarMovidas = "opciones" in cuerpo;
  if ("stateMap" in cuerpo) capacidades.stateMap = validarMapa(cuerpo.stateMap);

  p.dep.almacen.base.escribir("UPDATE connection SET capacidades = ? WHERE id = ?", [JSON.stringify(capacidades), conexion.id]);
  if (olvidarMovidas) p.dep.almacen.movidas.olvidarDelProyecto(String(proyecto.id));

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

// -----------------------------------------------------------------------------
// El editor de estados (spec 005, FR-002)
// -----------------------------------------------------------------------------

/** Un logger que no escribe: el proveedor recibe uno, y una lectura no deja rastro. */
const SILENCIO = Object.freeze({ info() {}, warn() {}, error() {}, debug() {} });

/**
 * El `ctx` con que el SERVICIO llama a un proveedor: opciones del proyecto,
 * `stateMap` de la conexion, credencial de la boveda (con su evento de
 * auditoria, principio IX) y red. Es el mismo que arma el board para listar;
 * vive aqui para que el editor de estados y la consulta de las «movidas» no lo
 * copien.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {any} proyecto
 * @param {any} diag lo que devolvio `diagnosticar`
 */
export async function contextoDelGestor(p, proyecto, diag) {
  const gestor = diag.gestor;
  const mod = diag.modulo;
  const env = await secretosDelGestor(p.dep, proyecto, gestor, mod?.requiredEnv ?? [], "llamar_api");
  return {
    options: { ...(diag.opciones ?? gestor.opciones ?? {}), ...(gestor.stateMap ? { stateMap: gestor.stateMap } : {}) },
    identity: { assignee: null, mention: null },
    env,
    log: SILENCIO,
    fetch: globalThis.fetch,
  };
}

/**
 * Lo que un proveedor devolvio en `listStates`, sin confiar en su forma: el
 * validador del contrato vive en `providers/` y este paquete viaja solo al
 * escritorio. Lo que no trae nombre no se puede mapear (el mapa es por NOMBRE)
 * y se descarta; un nombre repetido, tambien —el selector de uno escribiria el
 * del otro—.
 *
 * @param {any} crudos
 */
function estadosLimpios(crudos) {
  const LEIBLES = ["backlog", ...CANONICOS];
  const vistos = new Set();
  /** @type {Array<{id: string, name: string, category: string|null, suggested: string|null}>} */
  const estados = [];
  for (const e of Array.isArray(crudos) ? crudos : []) {
    const nombre = typeof e?.name === "string" ? e.name.trim() : "";
    if (!nombre || vistos.has(nombre)) continue;
    vistos.add(nombre);
    estados.push({
      id: String(e.id ?? nombre),
      name: nombre,
      category: typeof e.category === "string" ? e.category : null,
      suggested: LEIBLES.includes(e.suggested) ? e.suggested : null,
    });
  }
  return estados;
}

/**
 * `GET /v1/projects/:id/tracker/estados` — los estados REALES del gestor y el
 * `stateMap` vigente, para el editor visual (contracts/gestor-api.md §3).
 *
 * NO GUARDA NADA: el editor guarda por el `PATCH` de arriba, que es el que
 * valida. Esta ruta solo junta lo que hace falta para no escribir JSON: la fila
 * de cada estado, el canonico que el mapa le da hoy (`asignado`), los que
 * ningun canonico nombra (`sinAsignar`, que la spec pide NOMBRAR) y los nombres
 * del mapa que el gestor no tiene (`desconocidos`: `setState` fallaria con ellos
 * en el primer run, y es mejor decirlo aqui).
 *
 * NUNCA 500 POR EL GESTOR: una caida o una capacidad que falta vuelven como
 * `nota` con la causa textual, y el editor sigue pudiendo guardar a mano.
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function estadosDelGestor(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);
  const motor = p.estado.motor;
  const diag = await diagnosticar(
    p.dep,
    proyecto,
    motor ? { raizDeProveedores: motor.raizDeProveedores, cargarGestor: motor.cargarGestor } : {},
  );
  const gestor = diag.gestor;
  if (!gestor || gestor.origen === "local") {
    throw new ErrorDeServicio("sin_gestor", {
      nombre: proyecto.nombre,
      hallado: gestor
        ? "el proyecto usa sus tareas propias (el gestor local), cuyos estados SON los canonicos: no hay nada que mapear"
        : diag.datos?.gestorHallado ?? "el proyecto no tiene gestor",
    });
  }

  const conexion = gestor.conexion
    ? p.dep.almacen.base.consultarUno("SELECT * FROM connection WHERE id = ?", [gestor.conexion])
    : null;
  const editable = Boolean(conexion?.project_id);
  const mod = diag.modulo;
  const nombre = gestor.nombre;
  /** @type {Record<string, string|null>|null} */
  const stateMap = gestor.stateMap ?? null;

  const caps = mod && typeof mod.capabilities === "function" ? mod.capabilities() ?? {} : {};
  const sabeListar = caps.listStates === true && typeof mod?.listStates === "function";

  /** @type {ReturnType<typeof estadosLimpios>} */
  let estados = [];
  /** @type {string|null} */
  let nota = null;
  if (!mod) {
    nota = `El proveedor \`${nombre}\` no esta disponible en esta instalacion: no se pueden leer sus estados.`;
  } else if (!sabeListar) {
    // LA DEGRADACION DECLARADA (contracts/gestor-api.md §2). No se inventa la
    // lista: el editor ofrece los nombres que el mapa ya declara y deja
    // escribir uno a mano.
    nota =
      `El gestor \`${nombre}\` no declara la capacidad \`listStates\`: no sabe listar sus estados, asi que el ` +
      "editor muestra los nombres que el mapa ya declara y puedes escribir otros a mano, tal como se llaman en el gestor.";
  } else {
    try {
      estados = estadosLimpios(await mod.listStates(await contextoDelGestor(p, proyecto, diag)));
    } catch (e) {
      const causa = e && e.causa ? e.causa : String(e?.message ?? e);
      nota = `El gestor \`${nombre}\` no contesto al pedir sus estados: ${causa}`;
    }
  }

  const asignadoA = (/** @type {string} */ nombreDeEstado) =>
    CANONICOS.find((c) => stateMap?.[c] === nombreDeEstado) ?? null;
  const conAsignado = estados.map((e) => ({ ...e, asignado: asignadoA(e.name) }));
  const nombres = new Set(estados.map((e) => e.name));
  // Solo se afirma «el gestor no tiene ese estado» cuando se tiene la lista:
  // sin ella, cualquier nombre del mapa podria existir.
  const desconocidos =
    estados.length > 0
      ? CANONICOS.filter((c) => typeof stateMap?.[c] === "string" && !nombres.has(/** @type {string} */ (stateMap?.[c]))).map(
          (c) => ({ canonico: c, nombre: /** @type {string} */ (stateMap?.[c]) }),
        )
      : [];

  return {
    cuerpo: {
      gestor: { nombre, conexion: gestor.conexion ?? null, opciones: gestor.opciones ?? null },
      // El esquema viaja para que la interfaz pinte los campos que el
      // proveedor DECLARA (equipo, reglas...) sin saber que gestor es.
      esquema: mod?.optionsSchema ?? null,
      editable,
      motivo: editable
        ? null
        : `La conexion \`${gestor.slug}\` es del espacio de trabajo y la comparten otros proyectos: sus opciones y su ` +
          "mapa de estados no se cambian desde aqui. Conecta el gestor como conexion del proyecto para editarlos.",
      listStates: sabeListar,
      estados: conAsignado,
      stateMap,
      sinAsignar: conAsignado.filter((e) => e.asignado === null).map((e) => e.name),
      desconocidos,
      nota,
    },
  };
}
