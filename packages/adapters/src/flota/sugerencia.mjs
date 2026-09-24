// La flota se sugiere: nueve campos por agente derivados de lo que el snapshot
// ya sabe, y cada uno diciendo de donde sale.
//
// EL FALLO QUE CIERRA. Dar de alta un agente pide rol, runtime, modelo, skills,
// tools, MCP, permisos, presupuesto y contexto. Quien llega por primera vez no
// sabe que poner en siete de los nueve, asi que pone lo que suene bien — y lo
// que suena bien se ejecuta miles de veces, porque la configuracion se escribe
// una vez. El snapshot ya leyo el proyecto: casi todo eso esta en el arbol o no
// esta en ninguna parte, y las dos respuestas sirven si se dicen.
//
// SUGERIR ALGO INVALIDO ES PEOR QUE NO SUGERIR. FR-034 dice que el revisor no
// comparte runtime con el implementador, y el servicio lo rechaza AL GUARDAR.
// Una sugerencia que los pone iguales cuesta el viaje del operador, un error
// que el no provoco, y la confianza en lo siguiente que se le proponga. Por eso
// esto no solo evita el caso: se valida a si mismo con `validarFlota`, que es
// exactamente la funcion que lo tumbaria despues. Si no puede producir una
// flota valida —un solo runtime registrado, por ejemplo— lo DICE en vez de
// rellenar el formulario.
//
// POR QUE CADA CAMPO DECLARA SU ORIGEN, Y CON EL VOCABULARIO DEL SNAPSHOT. Es
// el principio X. Un operador que no sabe por que se le propone «modelo X» no
// puede juzgarlo, y acaba aceptando todo — que es lo mismo que no proponerle
// nada, pero con su firma encima. Y el vocabulario es el MISMO que ya aprendio
// leyendo el snapshot (`detectado`, `inferido`, `vacio`) mas `por_defecto` para
// lo que sale del catalogo de runtimes y no del proyecto. Un segundo
// vocabulario para la misma idea es densidad gratuita.
//
// LOS HUECOS SE DECLARAN HUECOS. El presupuesto no se deduce de un repositorio.
// Un numero inventado ahi produce un techo que se lee como decidido y no lo
// decidio nadie — y el dia que corta un run, corta por un limite que nadie puso.
//
// ESTO NO GUARDA NADA. Devuelve una propuesta; quien la confirma es el
// operador, campo por campo si quiere. Una sugerencia que se guarda sola deja
// de ser una sugerencia.

import { ROLES, validarFlota } from "./agente.mjs";

/**
 * El vocabulario de origen, el mismo del snapshot mas el del catalogo.
 *
 *   `detectado`   — sale de un hallazgo del proyecto, y trae su evidencia.
 *   `inferido`    — sale de un hallazgo inferido, y trae su confianza.
 *   `por_defecto` — sale del catalogo de runtimes o de una regla del dominio:
 *                   nada del proyecto lo respalda, y por eso no lleva ruta.
 *   `vacio`       — no se puede saber, y se dice por que en vez de rellenarlo.
 *
 * @type {readonly string[]}
 */
export const ORIGENES = Object.freeze(["detectado", "inferido", "por_defecto", "vacio"]);

/** Los nueve campos que un alta de agente pide, y que esto tiene que responder. */
export const CAMPOS = Object.freeze([
  "rol",
  "runtime",
  "modelo",
  "skills",
  "tools",
  "mcps",
  "permisos",
  "presupuesto",
  "contexto",
]);

/** Los roles sin los cuales un proyecto no puede pasar a `ACTIVE`. */
const OBLIGATORIOS = Object.freeze(["implementador", "revisor"]);

/**
 * El hallazgo de una clave, si trae sustancia.
 *
 * La definicion de «sustancia» es la del contrato del scanner y la misma que
 * usa el bootstrap: un hallazgo con `motivo` es un hueco que el scanner ya
 * declaro —«se busco aqui y no habia»— y no respalda nada, aunque su `origen`
 * diga `detectado`. Leer un hueco como un hallazgo es el principio X al reves.
 *
 * @param {any} snapshot
 * @param {string} clave
 */
function hallazgoDe(snapshot, clave) {
  for (const h of snapshot?.hallazgos ?? []) {
    if (h?.clave !== clave) continue;
    if (h.motivo) return { hueco: h };
    const v = h.valor;
    if (v === null || v === undefined) return { hueco: h };
    if (Array.isArray(v) && v.length === 0) return { hueco: h };
    if (typeof v === "string" && v.trim().length === 0) return { hueco: h };
    return { hallazgo: h };
  }
  return {};
}

/**
 * Una procedencia derivada de un hallazgo, propagando su origen tal cual.
 *
 * NO SE ASCIENDE UN `inferido` A `detectado`. Es el fallo que el principio X
 * prohibe de frente: un valor inferido leido como detectado se convierte en
 * configuracion del proyecto y el runtime lo aplica durante meses sin que nadie
 * lo revise.
 *
 * @param {any} h
 * @param {string} porque
 */
function deHallazgo(h, porque) {
  return Object.freeze({
    origen: h.origen === "inferido" ? "inferido" : "detectado",
    porque,
    evidencia: Object.freeze(
      (h.evidencia ?? []).filter((/** @type {any} */ e) => e && typeof e.ruta === "string").slice(0, 6),
    ),
    ...(h.origen === "inferido" ? { confianza: h.confianza ?? "media" } : {}),
  });
}

/** @param {string} porque */
const porDefecto = (porque) => Object.freeze({ origen: "por_defecto", porque, evidencia: Object.freeze([]) });

/** @param {string} porque */
const vacio = (porque) => Object.freeze({ origen: "vacio", porque, evidencia: Object.freeze([]) });

/**
 * El motivo de un hueco, dicho por el scanner si lo dijo.
 *
 * @param {any} hueco
 * @param {string} respaldo
 */
const motivoDelHueco = (hueco, respaldo) => (hueco?.motivo ? String(hueco.motivo) : respaldo);

/**
 * El modelo que este runtime ofrece, si ofrece alguno.
 *
 * `models: "desconocido"` es una respuesta LEGITIMA del contrato: un runtime
 * que no enumera modelos y lo declara es honesto. Rellenarlo con una lista
 * corta inventada hace que la pantalla ofrezca solo esos, que es peor.
 *
 * @param {string} runtime
 * @param {any} caps
 */
function modeloDe(runtime, caps) {
  const modelos = caps?.models;
  if (Array.isArray(modelos) && modelos.length > 0) {
    return {
      valor: modelos[0],
      procedencia: porDefecto(
        `el runtime \`${runtime}\` enumera ${modelos.length} modelo(s) y este es el primero de su lista. No ` +
          "sale del proyecto: nada en el arbol dice que modelo usar, asi que es un valor del catalogo que " +
          "conviene revisar antes de guardarlo.",
      ),
    };
  }
  return {
    valor: null,
    procedencia: vacio(
      `el runtime \`${runtime}\` declara \`models: "desconocido"\`: no enumera los modelos que acepta, y una ` +
        "lista corta inventada aqui haria que la pantalla ofreciera solo esos. Escribelo tu.",
    ),
  };
}

/**
 * El presupuesto, que siempre es un hueco — y a veces ademas inaplicable.
 *
 * @param {string} runtime
 * @param {any} caps
 */
function presupuestoDe(runtime, caps) {
  const base =
    "el presupuesto no se deduce de un repositorio: ningun archivo del proyecto dice cuanto puede gastar un " +
    "agente. Un numero inventado aqui se lee como decidido, y el dia que corte un run cortara por un limite " +
    "que no puso nadie.";
  if (caps?.cost === true) return vacio(base);
  return vacio(
    `${base} Ademas, \`${runtime}\` declara \`cost: false\`: no reporta gasto, asi que un techo en USD no se ` +
      "puede aplicar a sus fases y se acotan por intentos y por tiempo.",
  );
}

/**
 * El contexto que se le compila al agente: los documentos que gobiernan el
 * proyecto, leidos del snapshot.
 *
 * @param {any} snapshot
 */
function contextoDe(snapshot) {
  /** @type {string[]} */
  const documentos = [];
  /** @type {any[]} */
  const evidencia = [];
  let inferido = false;
  /** @type {string|null} */
  let confianza = null;

  for (const clave of ["guidelines.constitution", "guidelines.contributing", "guidelines.estilo"]) {
    const { hallazgo } = hallazgoDe(snapshot, clave);
    if (!hallazgo) continue;
    const v = hallazgo.valor;
    const rutas = Array.isArray(v) ? v : v && typeof v === "object" && v.ruta ? [v.ruta] : [String(v)];
    documentos.push(...rutas.filter((/** @type {any} */ r) => typeof r === "string"));
    evidencia.push(...(hallazgo.evidencia ?? []).filter((/** @type {any} */ e) => e && e.ruta));
    if (hallazgo.origen === "inferido") {
      inferido = true;
      confianza = hallazgo.confianza ?? "media";
    }
  }

  if (documentos.length === 0) {
    return {
      valor: { documentos: [] },
      procedencia: vacio(
        "el snapshot no encontro constitution, guia de contribucion ni estilo declarado en el arbol, asi que no " +
          "hay documentos del proyecto que compilarle al agente. Lo que se le pase hay que decirlo a mano.",
      ),
    };
  }

  return {
    valor: { documentos },
    procedencia: Object.freeze({
      origen: inferido ? "inferido" : "detectado",
      porque:
        `son los documentos que gobiernan este proyecto segun el snapshot (${documentos
          .map((d) => `\`${d}\``)
          .join(", ")}), y por eso son los que el agente tiene que leer antes de tocar nada.`,
      evidencia: Object.freeze(evidencia.slice(0, 6)),
      ...(inferido ? { confianza: confianza ?? "media" } : {}),
    }),
  };
}

/**
 * Los comandos que gatean un merge en este proyecto, si estan declarados.
 *
 * @param {any} snapshot
 */
function comandosDe(snapshot) {
  const { hallazgo } = hallazgoDe(snapshot, "ci.comandos");
  if (!hallazgo || !Array.isArray(hallazgo.valor)) return null;
  const comandos = hallazgo.valor
    .map((/** @type {any} */ c) => (typeof c === "string" ? c : c?.comando))
    .filter((/** @type {any} */ c) => typeof c === "string" && c.length > 0);
  return comandos.length > 0 ? { comandos, hallazgo } : null;
}

/**
 * Un agente sugerido, con sus nueve campos y la procedencia de cada uno.
 *
 * @param {{
 *   rol: string,
 *   nombre: string,
 *   runtime: string,
 *   caps: any,
 *   snapshot: any,
 *   project_id: string|null,
 *   procedenciaDelRol: any,
 *   procedenciaDelRuntime: any,
 *   contexto: {valor: any, procedencia: any},
 * }} datos
 */
function agenteSugerido({
  rol,
  nombre,
  runtime,
  caps,
  snapshot,
  project_id,
  procedenciaDelRol,
  procedenciaDelRuntime,
  contexto,
}) {
  const modelo = modeloDe(runtime, caps);

  const skills = hallazgoDe(snapshot, "agentes.skills");
  const mcps = hallazgoDe(snapshot, "agentes.mcp");

  /** @type {Record<string, any>} */
  const procedencia = {
    rol: procedenciaDelRol,
    runtime: procedenciaDelRuntime,
    modelo: modelo.procedencia,
    skills: skills.hallazgo
      ? deHallazgo(
          skills.hallazgo,
          "son las skills que el snapshot encontro en el arbol de este proyecto: ya estan escritas y " +
            "versionadas, asi que el agente puede cargarlas sin que nadie escriba nada nuevo.",
        )
      : vacio(
          motivoDelHueco(
            skills.hueco,
            "el snapshot no encontro ninguna skill en el arbol. No se inventa una lista: una skill que no " +
              "existe se declara y nadie la carga.",
          ),
        ),
    tools: vacio(
      "el arbol no declara que herramientas se le autorizan a un agente, y no es un hueco del scanner: el " +
        "conjunto de herramientas es una decision de permisos, no un hecho del repositorio. Concederlas por " +
        "defecto es conceder de verdad lo que nadie autorizo.",
    ),
    mcps: mcps.hallazgo
      ? deHallazgo(
          mcps.hallazgo,
          "son los servidores de contexto que el proyecto ya declara en su configuracion versionada.",
        )
      : vacio(
          motivoDelHueco(
            mcps.hueco,
            "el snapshot no encontro ningun servidor de contexto declarado. Proponer uno seria elegir por el " +
              "operador, y conectar un servidor da acceso a datos que nadie autorizo.",
          ),
        ),
    permisos: vacio(
      "el repositorio no declara ninguna politica de permisos de agente, y un permiso propuesto se concede de " +
        "verdad al confirmarlo. Es la decision que menos se puede derivar de leer codigo.",
    ),
    presupuesto: presupuestoDe(runtime, caps),
    contexto: contexto.procedencia,
  };

  const valores = {
    rol,
    runtime,
    modelo: modelo.valor,
    skills: skills.hallazgo ? [...skills.hallazgo.valor] : [],
    tools: [],
    mcps: mcps.hallazgo ? [...mcps.hallazgo.valor] : [],
    permisos: {},
    presupuesto: {},
    contexto: contexto.valor,
  };

  // LO QUE FALTA, DICHO. Un campo `vacio` que no se declara pendiente es un
  // campo que la pantalla pinta en blanco y el operador guarda en blanco.
  const pendientes = CAMPOS.filter((c) => procedencia[c].origen === "vacio");

  return Object.freeze({
    // `id` no se pone: esto no es un agente, es lo que un agente seria. El id
    // lo asigna quien lo guarde, y ponerlo aqui haria creer que ya existe.
    project_id,
    nombre,
    ...valores,
    procedencia: Object.freeze(procedencia),
    pendientes: Object.freeze(pendientes),
  });
}

/**
 * Propone la flota de un proyecto a partir de su snapshot.
 *
 * POR QUE RECIBE LOS AGENTES QUE YA ESTAN DADOS DE ALTA. Porque FR-034 es
 * relacional y el operador rara vez monta la flota de una sentada: da de alta
 * un implementador, vuelve al dia siguiente y pide que le sugieran el resto.
 * Una sugerencia que ignora lo que ya hay propone un revisor sobre el runtime
 * del implementador guardado, y el servicio la rechaza al guardarla — que es
 * exactamente el fallo que esta funcion existe para evitar, cometido por no
 * mirar.
 *
 * @param {{
 *   snapshot: any,
 *   adaptadores: any,
 *   project_id?: string|null,
 *   ahora?: number,
 *   existentes?: readonly any[],
 * }} datos
 */
export function sugerirFlota({
  snapshot,
  adaptadores,
  project_id = null,
  ahora = Date.now(),
  existentes = [],
}) {
  /** @type {any[]} */
  const agentes = [];
  /** @type {any[]} */
  const no_sugeridos = [];
  /** @type {string[]} */
  const avisos = [];

  const vacia = (/** @type {string[]} */ extra) =>
    Object.freeze({
      project_id,
      sugerida: false,
      agentes: Object.freeze([]),
      pendientes: Object.freeze([]),
      no_sugeridos: Object.freeze(ROLES.map((rol) => ({ rol, porque: extra[0] }))),
      problemas: Object.freeze([]),
      avisos: Object.freeze(extra),
      snapshot_id: snapshot?.id ?? null,
      sugerida_en: new Date(ahora).toISOString(),
    });

  // Sin snapshot completo no hay de donde derivar: lo que saldria seria el
  // catalogo entero presentado como si viniera del proyecto.
  if (snapshot?.estado !== "completo") {
    return vacia([
      `el snapshot de este proyecto esta en estado \`${snapshot?.estado ?? "desconocido"}\` y no \`completo\`: ` +
        "sin el, cada campo saldria del catalogo presentado como si viniera del proyecto, que es justo lo que " +
        "el principio X prohibe. Corre el escaneo y acepta el snapshot primero.",
    ]);
  }

  const ids = adaptadores?.ids?.() ?? [];

  /** @param {string} rol */
  const yaHay = (rol) => existentes.find((a) => a?.rol === rol) ?? null;

  // ---- El implementador: exige hooks -------------------------------------
  const implementadorExistente = yaHay("implementador");
  const conHooks = ids.filter((/** @type {string} */ id) => adaptadores.capacidades(id)?.hooks === true);
  // Si ya hay uno dado de alta, su runtime es EL del implementador: no se
  // sugiere otro, y es contra ese contra el que se separa el revisor.
  const runtimeImplementador = implementadorExistente ? implementadorExistente.runtime : (conHooks[0] ?? null);

  if (implementadorExistente) {
    no_sugeridos.push({
      rol: "implementador",
      porque:
        `este proyecto ya tiene un implementador dado de alta (\`${implementadorExistente.nombre}\`, sobre ` +
        `\`${implementadorExistente.runtime}\`). Sugerir otro duplicaria el rol y el gasto sin que nadie lo pidiera.`,
    });
  } else if (!runtimeImplementador) {
    no_sugeridos.push({
      rol: "implementador",
      porque:
        `ninguno de los runtimes registrados (${ids.map((/** @type {string} */ i) => `\`${i}\``).join(", ") || "ninguno"}) ` +
        "declara `hooks: true`, y la sugerencia solo propone implementadores cuyo paso RED lo BLOQUEA un hook " +
        "dentro del subproceso. Sin hooks el motor lo fuerza DESPUES de cada fase —revierte lo escrito fuera de " +
        "alcance— y el agente se guarda como `tdd: por_motor`: es valido, pero es una garantia menor y la elige " +
        "una persona, no la sugerencia. Declaralo a mano en Flota -> Agentes, o registra un runtime con hooks.",
    });
  }

  // ---- El revisor: FR-034, distinto del implementador ---------------------
  //
  // EL RUNTIME DEL REVISOR NO SE ELIGE SOLO: se elige EN RELACION al del
  // implementador. FR-034 es una regla relacional, no una propiedad de un
  // agente — por eso sin implementador asignado no hay revisor que proponer, y
  // decirlo asi es lo unico que le dice al operador que el problema es el par y
  // no cada uno por su lado.
  const revisorExistente = yaHay("revisor");
  const runtimeRevisor = revisorExistente
    ? revisorExistente.runtime
    : runtimeImplementador
      ? (ids.find((/** @type {string} */ id) => id !== runtimeImplementador) ?? null)
      : null;

  if (revisorExistente) {
    no_sugeridos.push({
      rol: "revisor",
      porque:
        `este proyecto ya tiene un revisor dado de alta (\`${revisorExistente.nombre}\`, sobre ` +
        `\`${revisorExistente.runtime}\`). Sugerir otro duplicaria el rol y el gasto sin que nadie lo pidiera.`,
    });
  } else if (!runtimeRevisor && !runtimeImplementador) {
    no_sugeridos.push({
      rol: "revisor",
      porque:
        "el runtime del revisor se elige en relacion al del implementador —FR-034 exige que no sean el mismo— y " +
        "aqui no hay implementador que asignar, asi que no hay de que separarlo. Resuelve primero el " +
        "implementador: el par se decide junto.",
    });
  } else if (!runtimeRevisor) {
    no_sugeridos.push({
      rol: "revisor",
      porque:
        `solo hay ${ids.length} runtime registrado (${ids.map((/** @type {string} */ i) => `\`${i}\``).join(", ") || "ninguno"}), ` +
        "y FR-034 exige que el revisor no comparta runtime con el implementador: una revision hecha por el mismo " +
        "runtime que escribio el codigo comparte sus puntos ciegos y confirma en vez de revisar. Sugerir aqui un " +
        "revisor con el mismo runtime seria proponer una flota que el servicio rechaza al guardarla. Registra un " +
        "segundo runtime.",
    });
  }

  const contexto = contextoDe(snapshot);

  // Se sugiere lo que FALTA. Un rol ya dado de alta no se vuelve a proponer:
  // su motivo ya esta en `no_sugeridos`.
  if (runtimeImplementador && runtimeRevisor && !implementadorExistente) {
    agentes.push(
      agenteSugerido({
        rol: "implementador",
        nombre: "Implementador",
        runtime: runtimeImplementador,
        caps: adaptadores.capacidades(runtimeImplementador),
        snapshot,
        project_id,
        procedenciaDelRol: porDefecto(
          "es uno de los dos roles sin los cuales un proyecto no puede activarse: alguien tiene que escribir el " +
            "codigo. No sale del proyecto, sale del modelo de flota.",
        ),
        procedenciaDelRuntime: porDefecto(
          `\`${runtimeImplementador}\` es el runtime registrado que declara \`hooks: true\`, y el implementador ` +
            "es el unico rol que los exige: sin ellos el paso RED depende de que el prompt se acuerde. No sale " +
            "del proyecto, sale de lo que el runtime declara de si mismo.",
        ),
        contexto,
      }),
    );

  }

  if (runtimeImplementador && runtimeRevisor && !revisorExistente) {
    agentes.push(
      agenteSugerido({
        rol: "revisor",
        nombre: "Revisor",
        runtime: runtimeRevisor,
        caps: adaptadores.capacidades(runtimeRevisor),
        snapshot,
        project_id,
        procedenciaDelRol: porDefecto(
          "es el segundo rol obligatorio para activar: sin una revision, lo que sale del implementador entra al " +
            "repositorio sin que nadie lo mire.",
        ),
        procedenciaDelRuntime: porDefecto(
          `\`${runtimeRevisor}\` es un runtime DISTINTO del implementador (\`${runtimeImplementador}\`), y eso es ` +
            "lo que exige FR-034: un revisor sobre el mismo runtime que escribio el codigo revisa con la misma " +
            "cabeza que implemento, y la revision se vuelve confirmacion.",
        ),
        contexto,
      }),
    );
  }

  // ---- El verificador: solo si el proyecto declara que verificar ----------
  const ci = comandosDe(snapshot);
  const verificadorExistente = yaHay("verificador");
  if (verificadorExistente) {
    no_sugeridos.push({
      rol: "verificador",
      porque: `este proyecto ya tiene un verificador dado de alta (\`${verificadorExistente.nombre}\`).`,
    });
  } else if (ci && runtimeRevisor) {
    const verificador = agenteSugerido({
      rol: "verificador",
      nombre: "Verificador",
      runtime: runtimeRevisor,
      caps: adaptadores.capacidades(runtimeRevisor),
      snapshot,
      project_id,
      procedenciaDelRol: deHallazgo(
        ci.hallazgo,
        `este proyecto declara ${ci.comandos.length} comando(s) que la integracion continua corre antes de ` +
          "mergear. Son los unicos comandos de los que consta que alguien decidio que tenian que pasar, y el " +
          "criterio de exito es su exit code — no la afirmacion de nadie sobre ellos.",
      ),
      procedenciaDelRuntime: porDefecto(
        `se le asigna \`${runtimeRevisor}\`: el verificador no escribe codigo de produccion, asi que no necesita ` +
          "hooks, y mantenerlo fuera del runtime del implementador deja la verificacion independiente de quien " +
          "escribio.",
      ),
      contexto,
    });
    // El contexto del verificador lleva ademas los comandos: es lo que tiene
    // que correr, y sin ellos el rol no significa nada.
    agentes.push(
      Object.freeze({
        ...verificador,
        contexto: { ...verificador.contexto, comandos: Object.freeze([...ci.comandos]) },
      }),
    );
  } else if (!ci) {
    no_sugeridos.push({
      rol: "verificador",
      porque:
        "el snapshot no encontro ningun comando declarado que gatee un merge en este proyecto. Un verificador " +
        "sin comandos que correr solo puede inventarse el criterio de exito, y un criterio inventado aprueba lo " +
        "que no deberia. Declara los comandos de verificacion y vuelve a sugerir.",
    });
  }

  no_sugeridos.push({
    rol: "planificador",
    porque:
      "no es un rol obligatorio para activar y nada en el snapshot dice que este proyecto lo necesite. Sugerir " +
      "un agente que nadie pidio cuesta contexto y presupuesto en cada run, y el operador lo descubre en la " +
      "factura. Dalo de alta tu si el trabajo de este proyecto se reparte antes de implementarse.",
  });

  // ---- La sugerencia se valida con las MISMAS reglas que la rechazarian ---
  // Ver la cabecera: el peor resultado posible es proponer algo que el servicio
  // tumba al guardar. Se comprueba aqui, no se confia en haberlo hecho bien.
  // SE VALIDA LA FLOTA RESULTANTE, no solo lo sugerido: FR-034 es relacional y
  // el choque que importa es el de un revisor propuesto contra un implementador
  // YA GUARDADO. Validar solo lo nuevo deja pasar exactamente la mitad de los
  // casos — la mitad que ocurre, porque nadie monta la flota de una sentada.
  const flotaResultante = [...existentes, ...agentes];
  const problemas = flotaResultante.length > 0 ? validarFlota({ agentes: flotaResultante, adaptadores }) : [];

  const faltan = OBLIGATORIOS.filter((r) => !flotaResultante.some((a) => a.rol === r));
  if (faltan.length > 0) {
    avisos.push(
      `no se pudo sugerir ${faltan.map((f) => `\`${f}\``).join(" ni ")}: la flota propuesta no basta para ` +
        "activar el proyecto tal como esta. El motivo de cada uno esta en `no_sugeridos`.",
    );
  }
  for (const problema of problemas) {
    avisos.push(`la sugerencia no paso su propia validacion: ${problema.causa}`);
  }

  /** @type {any[]} */
  const pendientes = [];
  for (const agente of agentes) {
    for (const campo of agente.pendientes) {
      pendientes.push(
        Object.freeze({ agente: agente.nombre, rol: agente.rol, campo, porque: agente.procedencia[campo].porque }),
      );
    }
  }

  return Object.freeze({
    project_id,
    snapshot_id: snapshot?.id ?? null,
    sugerida: agentes.length > 0 && faltan.length === 0 && problemas.length === 0,
    agentes: Object.freeze(agentes),
    // Lo que el operador TIENE que rellenar para que esto se pueda guardar,
    // junto en una lista: repartido por agente obliga a abrir cada ficha para
    // descubrir que falta.
    pendientes: Object.freeze(pendientes),
    no_sugeridos: Object.freeze(no_sugeridos),
    problemas: Object.freeze(problemas.map((p) => ({ codigo: p.codigo, causa: p.causa, accion: p.accion }))),
    avisos: Object.freeze(avisos),
    sugerida_en: new Date(ahora).toISOString(),
  });
}
