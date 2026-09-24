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
import { modoTdd, sugerirFlota } from "../../adapters/src/index.mjs";

import { coleccion, conJson, exigir, exigirProyecto, noEsta } from "./comun.mjs";
import { ErrorDeServicio } from "./errores.mjs";

/** Los campos JSON de un agente, para que vuelvan como JSON y no como texto. */
const JSON_DEL_AGENTE = ["skills", "tools", "mcps", "permisos", "presupuesto", "contexto"];

/**
 * Un agente como sale por la API: sus campos JSON como JSON y, al lado, QUIEN
 * SOSTIENE SU TDD (`tdd`, ver `modoTdd`).
 *
 * POR QUE SE DERIVA Y NO SE GUARDA. Sale de las capacidades del runtime, que
 * son del adaptador registrado y no del almacen: guardarlo seria una copia que
 * se queda vieja el dia que el runtime gane o pierda hooks. Sin registro de
 * runtimes no se puede afirmar nada, y se dice `null` en vez de adivinar.
 *
 * EL MOTOR SIEMPRE APLICA LA GUARDA POSTERIOR a un implementador sin hooks, y
 * el servicio solo lanza fases por el motor: por eso aqui un implementador sin
 * hooks es `por_motor` y no un rechazo.
 *
 * @param {any} dep
 * @param {any} fila
 */
function agenteDeSalida(dep, fila) {
  const caps = dep.adaptadores?.tiene?.(String(fila.runtime)) ? dep.adaptadores.capacidades(String(fila.runtime)) : null;
  return {
    ...conJson(fila, JSON_DEL_AGENTE),
    tdd: caps ? modoTdd(String(fila.rol), caps) : null,
  };
}

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
      cuerpo: coleccion(p.dep.almacen.agentes.porProyecto(proyecto.id).map((a) => agenteDeSalida(p.dep, a))),
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

  return { codigo: 201, cuerpo: { agente: agenteDeSalida(p.dep, agente) } };
}

/**
 * La flota PROPUESTA a partir del snapshot: nueve campos por agente, cada uno
 * diciendo de donde sale, y lo que no se puede saber declarado pendiente.
 *
 * ESTO NO GUARDA NADA, y es la mitad que importa. Devuelve una propuesta; quien
 * la confirma es el operador por `POST /v1/projects/:id/agents`, campo por
 * campo si quiere. Una sugerencia que se guarda sola deja de ser una
 * sugerencia: es configuracion que nadie escribio, ejecutandose miles de veces.
 *
 * LOS AGENTES YA GUARDADOS VIAJAN COMO `existentes`. FR-034 es relacional y
 * nadie monta la flota de una sentada: el caso normal es que el implementador
 * ya este dado de alta cuando se pide el resto. Una sugerencia que solo mira lo
 * que ella misma propone coloca al revisor encima del runtime del implementador
 * guardado — y este mismo servicio la rechaza al guardarla, despues de que el
 * operador ya la haya aceptado.
 *
 * SIN REGISTRO DE RUNTIMES NO SE CONTESTA UNA FLOTA VACIA. Con cero runtimes la
 * sugerencia solo puede decir «ningun rol se puede sugerir», y eso se lee como
 * «este proyecto no puede tener agentes» — una conclusion que nadie saco. Se
 * nombra la pieza que falta y como conseguirla.
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function sugerenciaDeFlota(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);

  if (!p.dep.adaptadores) {
    throw new ErrorDeServicio("pieza_ausente", {
      pieza: "el registro de runtimes de agente",
      porque: p.dep.ausenciaDeAdaptadores.porque,
      comoConseguirlo: p.dep.ausenciaDeAdaptadores.comoConseguirlo,
    });
  }

  const snapshot = snapshotDelProyecto(p.dep, proyecto);

  // Se leen tal cual estan guardados: lo que importa de un existente para
  // FR-034 son `rol` y `runtime`, que son columnas, no JSON.
  const existentes = p.dep.almacen.agentes.porProyecto(proyecto.id);

  return {
    cuerpo: {
      sugerencia: sugerirFlota({
        snapshot,
        adaptadores: p.dep.adaptadores,
        project_id: proyecto.id,
        existentes,
      }),
    },
  };
}

/**
 * El snapshot completo del proyecto con sus hallazgos, en la forma que el
 * modelo de flota espera.
 *
 * `valor_corregido` GANA cuando lo hay, por lo mismo que en el nucleo: lo que
 * vale es lo que el operador corrigio. Derivar la flota del valor original
 * despues de que alguien lo arreglo a mano es ignorar la unica correccion
 * humana que hubo en todo el recorrido.
 *
 * @param {any} dep
 * @param {any} proyecto
 */
function snapshotDelProyecto(dep, proyecto) {
  const fila = dep.almacen.base.consultarUno(
    "SELECT * FROM project_snapshot WHERE project_id = ? AND estado = 'completo' ORDER BY creado DESC LIMIT 1",
    [proyecto.id],
  );
  if (!fila) {
    throw noEsta("snapshot completo", proyecto.id, "`POST /v1/projects/:id/scan`", `el proyecto \`${proyecto.nombre}\``);
  }
  return {
    ...fila,
    estado: "completo",
    hallazgos: dep.almacen.snapshots.hallazgos(fila.id).map((/** @type {any} */ h) => ({
      categoria: h.categoria,
      clave: h.clave,
      valor: h.valor_corregido === null ? JSON.parse(String(h.valor)) : JSON.parse(String(h.valor_corregido)),
      origen: h.origen,
      evidencia: JSON.parse(String(h.evidencia)),
      confianza: h.confianza,
      motivo: h.motivo ?? undefined,
    })),
  };
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
  return { cuerpo: { agente: agenteDeSalida(p.dep, p.dep.almacen.agentes.porId(agente.id)) } };
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function activar(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);
  return { cuerpo: activarProyecto(p, proyecto, "flota validada y activada") };
}

/**
 * La activacion, compartida por `POST /activate` y el modo rapido (US8): la
 * misma comprobacion de FR-034 y la misma transicion con guarda. Dos caminos a
 * `ACTIVE` con dos comprobaciones distintas serian dos verdades.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {any} proyecto
 * @param {string} motivo
 */
export function activarProyecto(p, proyecto, motivo) {
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
  p.estado.bus.emitir("proyecto.estado", { estado: actualizado.estado, motivo }, { project_id: proyecto.id });
  return { proyecto: actualizado, flota: agentes.map((/** @type {any} */ a) => agenteDeSalida(p.dep, a)) };
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
