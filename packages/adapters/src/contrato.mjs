// La interfaz que todo runtime de agente implementa, su validador, y la costura
// con la que se enchufa al motor.
//
// LA COSTURA YA EXISTIA; ESTO LA NOMBRA. El motor de v1 invoca al modelo por un
// unico punto —`deps.runPhase(...)` en `packages/engine/src/driver.mjs`, dentro
// de `fase()`— y el cableado ya elegia entre dos caminos segun la disponibilidad
// del SDK. Esa indireccion existe por una razon declarada en el propio archivo:
// "que el recorrido completo se pueda probar sin red, sin credenciales y sin
// modelo". Esta feature le pone contrato. No la mueve.
//
// REGLA HEREDADA DEL PRINCIPIO VI, trasladada de gestores a runtimes: si
// soportar un runtime exige cambiar el motor, la interfaz esta mal y se arregla
// la interfaz. No se ramifica el driver con un `if`.
//
// QUE CAMBIA RESPECTO DE V1: un solo campo, `env`. Ver `entorno-no-se-hereda`.

/**
 * @typedef {object} AdapterCapabilities
 * @property {boolean} resume puede retomar una sesion anterior
 * @property {boolean} cost reporta coste en USD
 * @property {boolean} effort acepta un nivel de esfuerzo
 * @property {boolean} hooks puede correr hooks dentro de su subproceso
 * @property {string[]|'desconocido'} models modelos que expone, si los enumera
 * @property {boolean} [comandos] entiende los comandos del plugin (`/noxloop-task ...`) como
 *   comandos. OPCIONAL: su ausencia es «no se sabe», y el motor entonces le manda el texto
 *   expandido en vez del nombre del comando. Ver `CAPACIDADES_OPCIONALES`.
 */

/**
 * @typedef {object} PhaseRequest
 * @property {string} phase RED, GREEN, REFACTOR, REVIEW...
 * @property {string} taskId
 * @property {unknown} task
 * @property {unknown} item
 * @property {string} cwd el worktree de la tarea, aislado
 * @property {string|null} resume sessionId anterior, o null para sesion nueva
 * @property {string} model
 * @property {string} [effort]
 * @property {string} prompt
 * @property {string} [tier]
 * @property {Record<string, string>} env el entorno, ya construido por la boveda
 * @property {string[]} [secretos] los nombres de `env` cuyo valor no puede aparecer en argv; sin esto, todos
 */

/**
 * @typedef {object} PhaseResult
 * @property {boolean} ok
 * @property {string|null} [sessionId]
 * @property {number|null} [usd]
 * @property {string} [text]
 * @property {boolean} [budgetExhausted]
 * @property {string|null} [subtype] `null` es "no hubo subtipo", distinto de "no se declaro"
 * @property {string[]} [degradaciones] lo que el adaptador NO pudo hacer de lo que se le pidio
 */

// `degradaciones` no esta en el contrato escrito y esta aqui a proposito: la
// regla 1 pide degradar VISIBLE, y un aviso que solo existe en un log se pierde
// en la primera ventana que no lo mira. Quien recibe el resultado tiene que
// poder ver que se cambio de lo que pidio — que se abrio sesion nueva, que el
// nivel de esfuerzo no viajo — sin ir a buscarlo a otro sitio.

/**
 * @typedef {object} AgentAdapter
 * @property {string} id identificador estable; es lo que guarda `Agent.runtime`
 * @property {string[]} [requiredEnv] las variables que este runtime necesita recibir en `env`
 * @property {string[]} [sessionEnv] variables NO secretas sin las que su sesion local no se encuentra
 *   (`HOME`, `USER`, `CODEX_HOME`...); viajan en `env` pero no cuentan como secretos
 * @property {() => AdapterCapabilities} capabilities
 * @property {() => Promise<{ok: boolean, causa?: string, accion?: string}>} preflight
 * @property {(req: PhaseRequest, opts?: {signal?: AbortSignal}) => Promise<PhaseResult>} runPhase
 */

/** @type {readonly string[]} */
export const CLAVES_DE_CAPACIDAD = Object.freeze(["resume", "cost", "effort", "hooks", "models"]);

/**
 * Las capacidades que un adaptador PUEDE declarar y no esta obligado a hacerlo.
 *
 * `comandos` dice si el runtime entiende `/noxloop-task <item> <tarea> --phase
 * X` como un comando —el plugin de Claude Code lo expande al texto de
 * `packages/plugin/commands/noxloop-task.md`— o si recibiria esa linea como
 * texto sin significado. El motor la consulta para decidir si manda el comando
 * o su texto expandido (`packages/engine/src/comandos-sin-plugin.mjs`).
 *
 * POR QUE OPCIONAL Y NO OBLIGATORIA como las cinco de arriba. Porque llego
 * despues, y hacerla obligatoria rompe el registro de cada doble de prueba que
 * ya declara las cinco sin que ninguno este mintiendo. Lo que no se admite es
 * declararla MAL. Y su ausencia se lee del lado seguro: «no se sabe» expande,
 * porque mandar el texto a quien entendia el comando cuesta tokens, y mandar el
 * comando a quien no lo entiende cuesta la fase entera.
 *
 * @type {readonly string[]}
 */
export const CAPACIDADES_OPCIONALES = Object.freeze(["comandos"]);

/**
 * Las fases que son una REVISION.
 *
 * SE MIRA EL PREFIJO Y NO LA GRAFIA EXACTA. El motor ya usa `REVIEW` a secas y
 * `REVIEW-SINTESIS`, y el abanico de lentes invoca la fase `REVIEW` cuatro veces.
 * Una regla que solo reconociera `REVIEW` dejaria a la SINTESIS —que es quien
 * decide— retomando la sesion de quien escribio el codigo.
 */
const ES_REVISION = /^REVIEW(\b|-|_)/i;

/** @param {string} fase */
export function esRevision(fase) {
  return ES_REVISION.test(String(fase || ""));
}

/**
 * @param {any} adaptador
 * @returns {{ok: boolean, problems: string[]}}
 */
export function validarAdaptador(adaptador) {
  /** @type {string[]} */
  const problems = [];
  if (!adaptador || typeof adaptador !== "object") {
    return { ok: false, problems: ["el adaptador no es un objeto"] };
  }
  if (typeof adaptador.id !== "string" || !adaptador.id) problems.push("falta `id` (string no vacio)");

  // `requiredEnv` ES OPCIONAL Y SE VALIDA SI ESTA. Es como un runtime dice que
  // variable necesita —su clave, su endpoint— sin que el motor tenga que
  // nombrarla: el mismo mecanismo que ya usan los proveedores de tickets, y por
  // el mismo motivo. En cuanto el cableado del motor nombra la variable de un
  // runtime concreto, soportar el siguiente exige tocar el motor, que es lo que
  // el principio VI prohibe.
  if (adaptador.requiredEnv != null) {
    const bien = Array.isArray(adaptador.requiredEnv)
      && adaptador.requiredEnv.every((/** @type {any} */ x) => typeof x === "string" && x);
    if (!bien) problems.push("requiredEnv: tiene que ser una lista de nombres de variable (strings no vacios)");
  }

  // `sessionEnv`, lo mismo para lo que NO es secreto: donde vive la sesion
  // local del runtime. Va aparte porque las de `requiredEnv` entran en la
  // guarda de argv y estas no pueden: `HOME` es prefijo de casi cualquier ruta.
  // Por eso ningun nombre puede estar en las dos listas — seria declarar a la
  // vez que una variable es secreta y que no lo es, y la guarda elegiria una.
  if (adaptador.sessionEnv != null) {
    const bien = Array.isArray(adaptador.sessionEnv)
      && adaptador.sessionEnv.every((/** @type {any} */ x) => typeof x === "string" && x);
    if (!bien) {
      problems.push("sessionEnv: tiene que ser una lista de nombres de variable (strings no vacios)");
    } else if (Array.isArray(adaptador.requiredEnv)) {
      const cruce = adaptador.sessionEnv.filter((/** @type {string} */ n) => adaptador.requiredEnv.includes(n));
      if (cruce.length) {
        problems.push(
          `sessionEnv y requiredEnv comparten ${cruce.join(", ")}: una variable es secreta o no lo es, no las dos cosas`,
        );
      }
    }
  }

  for (const fn of ["capabilities", "preflight", "runPhase"]) {
    if (typeof adaptador[fn] !== "function") problems.push(`falta \`${fn}()\``);
  }
  if (typeof adaptador.capabilities !== "function") return { ok: false, problems };

  const caps = adaptador.capabilities() || {};
  for (const k of CLAVES_DE_CAPACIDAD) {
    if (!(k in caps)) problems.push(`capabilities() no declara "${k}" (hay que declararla, aunque sea false)`);
  }
  for (const k of Object.keys(caps)) {
    if (!CLAVES_DE_CAPACIDAD.includes(k) && !CAPACIDADES_OPCIONALES.includes(k)) {
      problems.push(`capabilities() declara "${k}", que no es una capacidad conocida`);
    }
  }
  for (const k of ["resume", "cost", "effort", "hooks", ...CAPACIDADES_OPCIONALES]) {
    if (k in caps && typeof caps[k] !== "boolean") problems.push(`capabilities().${k} tiene que ser boolean`);
  }
  if ("models" in caps) {
    const m = caps.models;
    const bien = m === "desconocido" || (Array.isArray(m) && m.every((/** @type {any} */ x) => typeof x === "string"));
    // "desconocido" es una respuesta LEGITIMA y por eso esta en el contrato: un
    // runtime que no enumera modelos declarandolo es honesto; uno que devuelve
    // una lista corta inventada hace que la pantalla ofrezca solo esos.
    if (!bien) problems.push('capabilities().models tiene que ser una lista de strings o el literal "desconocido"');
  }

  return { ok: problems.length === 0, problems };
}

/**
 * @param {any} req
 * @returns {{ok: boolean, problems: string[]}}
 */
export function validarPeticion(req) {
  /** @type {string[]} */
  const problems = [];
  if (!req || typeof req !== "object") return { ok: false, problems: ["la peticion no es un objeto"] };

  for (const campo of ["phase", "taskId", "cwd", "prompt"]) {
    if (typeof req[campo] !== "string" || !req[campo]) problems.push(`${campo}: tiene que ser un string no vacio`);
  }
  if (req.resume !== null && typeof req.resume !== "string") {
    problems.push("resume: tiene que ser un sessionId (string) o null explicito");
  }
  if (req.model != null && typeof req.model !== "string") problems.push("model: tiene que ser un string");
  if (req.effort != null && typeof req.effort !== "string") problems.push("effort: tiene que ser un string");

  // EL ENTORNO ES OBLIGATORIO, Y NO ADMITE UN DEFAULT. Un adaptador que
  // completara lo que falta con el entorno del proceso padre propagaria al
  // agente todas las credenciales que el motor tenga cargadas, tenga grant o no
  // — y la capa de grants queda decorativa. Denegar por defecto (principio IX):
  // sin entorno declarado no se invoca.
  if (!req.env || typeof req.env !== "object" || Array.isArray(req.env)) {
    problems.push(
      "env: falta el entorno explicito que construye la boveda a partir del grant vigente. Heredar el del " +
        "motor no es un modo degradado: es la fuga",
    );
  } else {
    for (const [nombre, valor] of Object.entries(req.env)) {
      if (typeof valor !== "string") {
        problems.push(`env.${nombre}: no es texto (el entorno de un proceso solo tiene texto)`);
      }
    }
  }

  // CUALES DE ESAS VARIABLES SON SECRETAS. El campo es opcional y su ausencia
  // NO es "ninguna": es "no se dijo", y entonces se miran todas. Lo que no
  // puede es nombrar una variable que no esta en `env` — eso es una
  // declaracion que no protege nada y se lee como si protegiera.
  if (req.secretos != null) {
    if (!Array.isArray(req.secretos) || req.secretos.some((/** @type {any} */ x) => typeof x !== "string" || !x)) {
      problems.push("secretos: tiene que ser una lista de nombres de variable (strings no vacios)");
    } else if (req.env && typeof req.env === "object") {
      const ausentes = req.secretos.filter((/** @type {string} */ n) => !Object.hasOwn(req.env, n));
      if (ausentes.length) {
        problems.push(
          `secretos: ${ausentes.join(", ")} no esta${ausentes.length > 1 ? "n" : ""} en \`env\`. Declarar como ` +
            "secreta una variable que no viaja es una guarda que se lee puesta y no puede saltar nunca",
        );
      }
    }
  }

  if (esRevision(req.phase) && req.resume != null) {
    problems.push(
      `phase "${req.phase}" con resume "${req.resume}": una revision nunca retoma la sesion del implementador. ` +
        "Si la retoma, hereda su razonamiento y la revision se vuelve confirmacion",
    );
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Corrige la peticion en el unico punto donde el contrato manda mas que quien
 * llama, y DECLARA la correccion en vez de aplicarla en silencio.
 *
 * POR QUE CORRIGE EN VEZ DE RECHAZAR. Porque el llamante de hoy es el driver de
 * v1, que pasa `resume: t.sessionId || null` para todas las fases, tambien para
 * REVIEW (el camino de abanico si pasa null; el camino simple no). Rechazar
 * dejaria al motor sin poder revisar; corregir y decirlo cumple la regla y
 * ademas deja la huella para arreglar el llamante.
 *
 * @param {any} req
 * @returns {{peticion: any, degradaciones: string[]}}
 */
export function normalizarPeticion(req) {
  /** @type {string[]} */
  const degradaciones = [];
  const peticion = { ...req };

  if (esRevision(peticion.phase) && peticion.resume != null) {
    degradaciones.push(
      `la fase ${peticion.phase} llego con resume "${peticion.resume}" y se abre sesion NUEVA: el revisor no ` +
        "hereda el transcript del implementador",
    );
    peticion.resume = null;
  }
  if (peticion.resume === undefined) peticion.resume = null;

  return { peticion, degradaciones };
}

/**
 * @param {any} resultado
 * @param {AdapterCapabilities} caps
 * @returns {{ok: boolean, problems: string[]}}
 */
export function validarResultado(resultado, caps) {
  /** @type {string[]} */
  const problems = [];
  if (!resultado || typeof resultado !== "object") return { ok: false, problems: ["el resultado no es un objeto"] };
  if (typeof resultado.ok !== "boolean") problems.push("ok: tiene que ser boolean");

  const usd = resultado.usd;
  if (caps?.cost === false) {
    // NO SE FINGE UN CERO. Un adaptador que no reporta gasto y devuelve `usd: 0`
    // deja el techo del hito sumando ceros: el limite se lee como puesto y no
    // puede dispararse nunca.
    if (usd !== null && usd !== undefined) {
      problems.push(
        `usd: el adaptador declara \`cost: false\` y devolvio ${JSON.stringify(usd)}. Sin reporte de gasto el ` +
          "valor tiene que ser null: un cero finge un coste medido y desactiva el techo sin decirlo",
      );
    }
  } else if (usd !== null && usd !== undefined && (typeof usd !== "number" || !Number.isFinite(usd))) {
    problems.push("usd: tiene que ser un numero o null");
  }

  if (resultado.sessionId != null && typeof resultado.sessionId !== "string") {
    problems.push("sessionId: tiene que ser un string o null");
  }
  if (resultado.text != null && typeof resultado.text !== "string") problems.push("text: tiene que ser un string");

  return { ok: problems.length === 0, problems };
}

/**
 * La costura: convierte un `AgentAdapter` en la funcion que el motor inyecta
 * como `deps.runPhase`.
 *
 * EL ENTORNO QUE TRAE LA FASE MANDA, y esto cambio. La version anterior
 * sobreescribia `env` siempre, porque daba por hecho que el objeto de fase de
 * `driver.mjs` nunca lo traia —en v1 no lo traia—. Desde que los call sites del
 * motor construyen la peticion completa, sobreescribir en silencio convertiria
 * la declaracion del llamante en mentira: el motor diria con que entorno quiere
 * correr la fase y correria con otro, sin que nada lo dijera. Aqui solo se
 * RELLENA lo que falta.
 *
 * Se pide POR FASE y no una vez: un grant que caduca a mitad del recorrido
 * tiene que dejar de valer en la fase siguiente, y un entorno capturado al
 * arrancar seguiria valiendo hasta el final.
 *
 * @param {AgentAdapter} adaptador
 * @param {{entorno?: Record<string,string> | ((fase: any) => Record<string,string>), signal?: AbortSignal}} [opts]
 * @returns {(fase: any) => Promise<PhaseResult>}
 */
export function adaptarADriver(adaptador, opts) {
  const { entorno } = opts || {};
  return async (fase) => {
    const env = fase?.env ?? (typeof entorno === "function" ? entorno(fase) : entorno);
    return adaptador.runPhase({ ...fase, env }, { signal: opts?.signal });
  };
}

/** Un resultado de fase completo, para que ningun adaptador devuelva a medias. */
export function resultadoDeFase(
  /** @type {{ok: boolean, sessionId?: string|null, usd?: number|null, text?: string, budgetExhausted?: boolean, subtype?: string|null}} */ p,
) {
  return {
    ok: p.ok,
    sessionId: p.sessionId ?? null,
    usd: p.usd ?? null,
    text: p.text ?? "",
    budgetExhausted: p.budgetExhausted ?? false,
    subtype: p.subtype ?? null,
  };
}
