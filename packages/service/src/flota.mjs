// Etapa 07 y la bandeja: la flota, la activacion, y los indicadores.
//
// POR QUE `activate` VALIDA LA FLOTA ANTES DE MIRAR LA MAQUINA DE ESTADOS. Un
// proyecto con la flota mal configurada y en la etapa equivocada tiene DOS
// problemas, y el que hay que reportar primero es el de la flota: es el que la
// persona acaba de tocar y el unico que puede arreglar sin recorrer cinco
// etapas. Reportar el otro primero la manda a completar el recorrido entero
// para volver a chocar con el mismo revisor mal puesto.
//
// POR QUE EL REVISOR NO PUEDE COMPARTIR RUNTIME CON EL IMPLEMENTADOR (FR-034).
// Una revision hecha por el mismo runtime que escribio el codigo aprueba sus
// propios puntos ciegos. No es una segunda opinion: es la primera repetida, y
// cuesta exactamente lo mismo que una de verdad. Se valida AL GUARDAR y no al
// ejecutar, porque un error de configuracion descubierto a mitad de un run
// cuesta el run entero.
//
// POR QUE EL DASHBOARD SALE DE UNA SOLA CONSULTA. NFR-002 da menos de un
// segundo con 20 proyectos. Devolver los proyectos y pedir despues la bandeja
// de cada uno son 21 viajes, y el presupuesto se gasta en los viajes: optimizar
// la consulta luego ya no lo arregla.

import { ENUMS } from "../../store/src/index.mjs";

import { coleccion, conJson, exigir, exigirProyecto, noEsta } from "./comun.mjs";
import { ErrorDeServicio } from "./errores.mjs";

/** Los campos JSON de un agente, para que vuelvan como JSON y no como texto. */
const JSON_DEL_AGENTE = ["skills", "tools", "mcps", "permisos", "presupuesto", "contexto"];

/** El rol contrario, que es contra el que se mide FR-034. */
const CONTRARIO = { revisor: "implementador", implementador: "revisor" };

/**
 * FR-034, comprobado AL GUARDAR.
 *
 * POR QUE AQUI SI EL ESQUEMA YA LO IMPIDE. El disparador
 * `agent_runtime_separado_insert` aborta la fila, y esa es la garantia de
 * verdad: cubre tambien a quien no pase por esta ruta. Lo que el disparador NO
 * puede hacer es explicarse — sale como un `SQLITE_CONSTRAINT` con una cadena
 * suelta adentro, que es un 500 sin causa ni accion para quien lo recibe. Esto
 * mira lo mismo antes y devuelve el error que NFR-006 exige: quien comparte
 * runtime con quien, y cual de los dos cambiar.
 *
 * @param {any} dep
 * @param {{project_id: string, rol: string, runtime: string, nombre: string, id?: string}} candidato
 */
function exigirRuntimesSeparados(dep, candidato) {
  const contrario = CONTRARIO[candidato.rol];
  if (!contrario) return;
  const choca = dep.almacen.base.consultarUno(
    "SELECT * FROM agent WHERE project_id = ? AND runtime = ? AND rol = ? AND id <> ? LIMIT 1",
    [candidato.project_id, candidato.runtime, contrario, candidato.id ?? ""],
  );
  if (!choca) return;

  const revisor = candidato.rol === "revisor" ? candidato : choca;
  const implementador = candidato.rol === "implementador" ? candidato : choca;
  throw new ErrorDeServicio("revisor_comparte_runtime", {
    revisor: revisor.nombre,
    implementador: implementador.nombre,
    runtime: candidato.runtime,
  });
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function agentesDelProyecto(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);

  if (p.metodo === "GET") {
    return {
      cuerpo: coleccion(p.dep.almacen.agentes.porProyecto(proyecto.id).map((a) => conJson(a, JSON_DEL_AGENTE))),
    };
  }

  const cuerpo = await p.cuerpo();
  exigir(cuerpo, ["nombre", "rol", "runtime", "modelo"]);
  if (!ENUMS["agent.rol"].includes(cuerpo.rol)) {
    throw new ErrorDeServicio("cuerpo_invalido", {
      detalle:
        `\`rol\` vale \`${cuerpo.rol}\` y los declarados son ${ENUMS["agent.rol"].map((r) => `\`${r}\``).join(", ")}. ` +
        "El rol no es una etiqueta: decide que contexto se le compila al agente y contra que regla se valida la flota",
      campos: ["rol"],
    });
  }

  exigirRuntimesSeparados(p.dep, {
    project_id: proyecto.id,
    rol: cuerpo.rol,
    runtime: cuerpo.runtime,
    nombre: cuerpo.nombre,
  });

  const agente = p.dep.almacen.agentes.crear({
    project_id: proyecto.id,
    nombre: cuerpo.nombre,
    rol: cuerpo.rol,
    runtime: cuerpo.runtime,
    modelo: cuerpo.modelo,
    skills: cuerpo.skills,
    tools: cuerpo.tools,
    mcps: cuerpo.mcps,
    permisos: cuerpo.permisos,
    presupuesto: cuerpo.presupuesto,
    contexto: cuerpo.contexto,
  });

  return { codigo: 201, cuerpo: { agente: conJson(agente, JSON_DEL_AGENTE) } };
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function unAgente(p) {
  const agente = p.dep.almacen.agentes.porId(p.parametros.id);
  if (!agente) throw noEsta("agente", p.parametros.id, "`GET /v1/projects/:id/agents`");

  if (p.metodo === "DELETE") {
    p.dep.almacen.base.escribir("DELETE FROM agent WHERE id = ?", [agente.id]);
    return { cuerpo: { quitado: agente.id, nombre: agente.nombre } };
  }

  const cuerpo = await p.cuerpo();
  // La lista es la lista: `project_id` no esta, y no es un olvido. Mover un
  // agente de proyecto por un `PATCH` se lleva sus grants a un proyecto donde
  // nadie los concedio.
  const EDITABLES = ["nombre", "rol", "runtime", "modelo"];
  const DE_JSON = JSON_DEL_AGENTE;
  const asignaciones = [];
  const valores = [];

  for (const campo of EDITABLES) {
    if (cuerpo[campo] === undefined) continue;
    if (campo === "rol" && !ENUMS["agent.rol"].includes(cuerpo.rol)) {
      throw new ErrorDeServicio("cuerpo_invalido", {
        detalle: `\`rol\` vale \`${cuerpo.rol}\` y los declarados son ${ENUMS["agent.rol"].join(", ")}`,
        campos: ["rol"],
      });
    }
    asignaciones.push(`${campo} = ?`);
    valores.push(cuerpo[campo]);
  }
  for (const campo of DE_JSON) {
    if (cuerpo[campo] === undefined) continue;
    asignaciones.push(`${campo} = ?`);
    valores.push(JSON.stringify(cuerpo[campo]));
  }

  if (asignaciones.length === 0) {
    throw new ErrorDeServicio("cuerpo_invalido", {
      detalle: "la peticion no trae ningun campo editable de un agente",
      campos: [...EDITABLES, ...DE_JSON],
    });
  }

  // El mismo FR-034 al EDITAR: cambiarle el runtime a un revisor para dejarlo
  // igual que el del implementador rompe la regla exactamente igual que
  // crearlo asi, y el disparador de `UPDATE` del esquema tambien lo aborta.
  exigirRuntimesSeparados(p.dep, {
    project_id: String(agente.project_id),
    rol: cuerpo.rol ?? agente.rol,
    runtime: cuerpo.runtime ?? agente.runtime,
    nombre: cuerpo.nombre ?? agente.nombre,
    id: agente.id,
  });

  p.dep.almacen.base.escribir(`UPDATE agent SET ${asignaciones.join(", ")} WHERE id = ?`, [...valores, agente.id]);
  return { cuerpo: { agente: conJson(p.dep.almacen.agentes.porId(agente.id), JSON_DEL_AGENTE) } };
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function activar(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);
  const agentes = p.dep.almacen.agentes.porProyecto(proyecto.id);

  // FR-034, y va PRIMERO. Ver la cabecera.
  const implementadores = agentes.filter((/** @type {any} */ a) => a.rol === "implementador");
  const revisores = agentes.filter((/** @type {any} */ a) => a.rol === "revisor");
  for (const revisor of revisores) {
    const choca = implementadores.find((/** @type {any} */ i) => i.runtime === revisor.runtime);
    if (choca) {
      throw new ErrorDeServicio("revisor_comparte_runtime", {
        revisor: revisor.nombre,
        implementador: choca.nombre,
        runtime: revisor.runtime,
      });
    }
  }

  const actualizado = p.dep.almacen.proyectos.transicionar(proyecto.id, "ACTIVE", { actor: "operador" });
  p.estado.bus.emitir(
    "proyecto.estado",
    { estado: actualizado.estado, motivo: "flota validada y activada" },
    { project_id: proyecto.id },
  );
  return { cuerpo: { proyecto: actualizado, flota: agentes.map((a) => conJson(a, JSON_DEL_AGENTE)) } };
}

// ---------------------------------------------------------------------------
// Bandeja
// ---------------------------------------------------------------------------

/** Lo que el almacen guarda como JSON dentro de una entrada. */
const JSON_DE_LA_ENTRADA = ["contexto", "decisiones_posibles"];

/** @param {import("./rutas.mjs").Peticion} p */
export async function bandeja(p) {
  // De TODOS los proyectos y mas reciente primero: la bandeja responde "que me
  // necesita a mi", y partirla por proyecto obliga a recorrer veinte pantallas
  // para encontrar la que espera desde ayer.
  const filas = p.dep.almacen.base.consultar(
    "SELECT * FROM inbox_entry WHERE workspace_id = ? AND estado = 'esperando' ORDER BY creada DESC LIMIT ?",
    [p.dep.workspace.id, 500],
  );
  return { cuerpo: coleccion(filas.map((f) => conJson(f, JSON_DE_LA_ENTRADA))) };
}

/**
 * @param {any} dep
 * @param {string} id
 */
function entradaPorId(dep, id) {
  const fila = dep.almacen.base.consultarUno("SELECT * FROM inbox_entry WHERE id = ?", [id]);
  if (!fila) throw noEsta("entrada de bandeja", id, "`GET /v1/inbox`");
  return fila;
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function entradaDeBandeja(p) {
  const fila = entradaPorId(p.dep, p.parametros.id);
  // FR-062: la causa va COMPLETA y textual. Un resumen generado de la causa es
  // una segunda interpretacion encima de la primera, y la persona que tiene que
  // decidir necesita lo que paso, no lo que un modelo entendio que paso.
  return {
    cuerpo: {
      entrada: conJson(fila, JSON_DE_LA_ENTRADA),
      proyecto: fila.project_id ? p.dep.almacen.proyectos.porId(String(fila.project_id)) : null,
    },
  };
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function resolverEntrada(p) {
  const fila = entradaPorId(p.dep, p.parametros.id);
  const cuerpo = await p.cuerpo();
  exigir(
    cuerpo,
    ["decision", "resuelta_por"],
    "`resuelta_por` es obligatorio: una entrada resuelta sin quien la resolvio deja la decision sin dueño.",
  );

  if (!ENUMS["inbox_entry.estado"].includes(cuerpo.decision)) {
    throw new ErrorDeServicio("cuerpo_invalido", {
      detalle:
        `\`decision\` vale \`${cuerpo.decision}\` y las declaradas son ` +
        `${ENUMS["inbox_entry.estado"].filter((e) => e !== "esperando").map((e) => `\`${e}\``).join(", ")}`,
      campos: ["decision"],
    });
  }

  const resuelta = p.dep.almacen.bandeja.resolver(fila.id, {
    estado: cuerpo.decision,
    resuelta_por: cuerpo.resuelta_por,
  });

  p.estado.bus.emitir(
    "bandeja.resuelta",
    { entrada_id: fila.id, decision: cuerpo.decision, resuelta_por: cuerpo.resuelta_por, motivo: cuerpo.motivo ?? null },
    { project_id: fila.project_id ? String(fila.project_id) : null },
  );

  return { cuerpo: { entrada: conJson(resuelta, JSON_DE_LA_ENTRADA) } };
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function dashboard(p) {
  const proyectos = p.dep.almacen.inicio.proyectos();

  /** @type {Record<string, number>} */
  const porEstado = {};
  for (const estado of ENUMS["project.estado"]) porEstado[estado] = 0;

  let esperando = 0;
  let recomendacionesPendientes = 0;
  let hallazgosPendientes = 0;
  let sinConexionViva = 0;

  for (const proyecto of proyectos) {
    porEstado[String(proyecto.estado)] = (porEstado[String(proyecto.estado)] ?? 0) + 1;
    esperando += Number(proyecto.bandeja_esperando);
    recomendacionesPendientes += Number(proyecto.recomendaciones_pendientes);
    hallazgosPendientes += Number(proyecto.hallazgos_pendientes);
    if (Number(proyecto.conexiones_vivas) === 0) sinConexionViva++;
  }

  const credenciales = p.dep.almacen.boveda.credenciales();
  const ahora = Date.now();

  return {
    cuerpo: coleccion(proyectos, {}, {
      proyectos: {
        total: proyectos.length,
        por_estado: porEstado,
        // Los que estan esperando a una persona. Es el numero que decide si el
        // operador tiene que abrir la bandeja o puede seguir con lo suyo.
        con_bandeja: proyectos.filter((/** @type {any} */ p2) => Number(p2.bandeja_esperando) > 0).length,
        sin_conexion_viva: sinConexionViva,
      },
      bandeja: { esperando },
      bootstrap: { recomendaciones_pendientes: recomendacionesPendientes },
      discovery: { hallazgos_pendientes: hallazgosPendientes },
      credenciales: {
        total: credenciales.length,
        // `expira` es la fecha declarada; el aviso es la parte que evita que la
        // credencial caduque a mitad de un run, que es cuando se descubre.
        por_expirar: credenciales.filter((/** @type {any} */ c) => {
          if (!c.expira) return false;
          const avisoMs = Number(c.aviso_dias_antes ?? 14) * 24 * 60 * 60 * 1000;
          return Date.parse(String(c.expira)) - ahora <= avisoMs;
        }).length,
      },
    }),
  };
}
