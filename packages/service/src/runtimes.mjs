// Settings -> Modelos: los runtimes de agente, si tienen con que invocar al
// modelo, y como darselo (spec 003).
//
// -----------------------------------------------------------------------------
// LAS TRES FORMAS DE CONECTAR UN RUNTIME, Y DONDE VIVE CADA UNA
// -----------------------------------------------------------------------------
//
// El operador tiene tres formas legitimas de darle credencial a un runtime: su
// suscripcion de Claude (`claude auth login`), su cuenta de ChatGPT (`codex
// login`) o una API key. Las dos primeras las guarda EL PROPIO RUNTIME, en su
// directorio y en el llavero: este servicio solo pregunta (`claude auth
// status`, `codex login status`) con `estadoDeAutenticacion` de
// `packages/adapters`, y lanza el login sin esperarlo. La tercera vive en la
// BOVEDA (principio IX), como credencial de tipo `modelo`, y llega al motor por
// el entorno del subproceso con un grant del proyecto — igual que la del
// gestor, y nunca por argv.
//
// -----------------------------------------------------------------------------
// LO QUE NINGUNA RESPUESTA LLEVA
// -----------------------------------------------------------------------------
//
// Ni el valor de la key (la prueba del centinela recorre estas rutas con el
// valor dentro), ni la salida cruda de los binarios: `codex login status`
// imprime un trozo de la key enmascarada, y enmascarado sigue siendo un pedazo
// del secreto. `estadoDeAutenticacion` ya arma su respuesta con campos
// elegidos; aqui se le suma el nombre y si hay key guardada, nada mas.

import { spawn as spawnDeNode } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

import {
  RUNTIMES_CON_SESION,
  archivoDeSesion,
  ejecutorDeProceso,
  estadoDeAutenticacion,
  rutaDeSesionVencida,
} from "../../adapters/src/autenticacion.mjs";
import { pathAmpliado, resolverBinario } from "../../adapters/src/binarios.mjs";
import { coleccion, noEsta } from "./comun.mjs";
import { ErrorDeServicio } from "./errores.mjs";
import { VARIABLES_DEL_ENTORNO_BASE } from "./lanzador.mjs";

/** Como se llama cada runtime en la pantalla. */
const NOMBRES = Object.freeze({ "claude-agent-sdk": "Claude Code", codex: "Codex" });

/**
 * La variable en la que cada runtime espera su API key. Es la misma que el
 * adaptador declara en `requiredEnv`: una key guardada con otro nombre llegaria
 * al entorno del motor y el runtime no la veria.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const VARIABLE_DE_KEY = Object.freeze({ "claude-agent-sdk": "ANTHROPIC_API_KEY", codex: "OPENAI_API_KEY" });

/**
 * Lo que se pone en el entorno de la PREGUNTA cuando hay una key en la boveda.
 * `estadoDeAutenticacion` solo mira si la variable esta; sacar el valor de la
 * boveda para contestar un si o un no dejaria un evento de acceso en la
 * auditoria por cada pintada del board, y el secreto en memoria de este
 * proceso para nada.
 */
const MARCA_DE_KEY_GUARDADA = "guardada-en-la-boveda";

/** Quien concede el grant de la key: el operador, con el gesto de guardarla. */
const CONCEDIDO_POR = "el operador, al guardar la API key en Settings → Modelos";

/** @param {string} runtime */
function exigirRuntime(runtime) {
  if (!RUNTIMES_CON_SESION.includes(runtime)) {
    throw noEsta("runtime", runtime, "`GET /v1/runtimes`", `los runtimes con sesion (${RUNTIMES_CON_SESION.join(", ")})`);
  }
  return runtime;
}

/**
 * La credencial `modelo` de un runtime en el inventario, o `null`. La fila no
 * tiene el valor: no hay campo donde quepa.
 *
 * @param {any} dep
 * @param {string} runtime
 */
function credencialDelRuntime(dep, runtime) {
  return (
    dep.almacen.base.consultarUno(
      "SELECT * FROM credential WHERE workspace_id = ? AND tipo = 'modelo' AND proveedor = ? AND estado <> 'revocada' " +
        "ORDER BY creada DESC LIMIT 1",
      [dep.workspace.id, runtime],
    ) ?? null
  );
}

/**
 * El entorno de la pregunta: el de la MAQUINA filtrado por nombre (el mismo que
 * recibe el motor), mas la marca de la key si esta en la boveda. Si se
 * preguntara con todo `process.env`, una `ANTHROPIC_API_KEY` del shell del
 * operador diria «conectado» y el motor —que no la recibe— moriria sin modelo.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {string} runtime
 */
function entornoDeLaPregunta(p, runtime) {
  const base =
    p.estado.motor?.entornoBase ??
    Object.fromEntries(
      VARIABLES_DEL_ENTORNO_BASE.filter((k) => typeof process.env[k] === "string").map((k) => [k, String(process.env[k])]),
    );
  const guardada = credencialDelRuntime(p.dep, runtime);
  return { env: { ...base, ...(guardada ? { [VARIABLE_DE_KEY[runtime]]: MARCA_DE_KEY_GUARDADA } : {}) }, guardada: Boolean(guardada) };
}

/**
 * El estado de UN runtime, en la forma de `GET /v1/runtimes`.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {string} runtime
 */
async function estadoDe(p, runtime) {
  const { env, guardada } = entornoDeLaPregunta(p, runtime);
  const ejecutar = p.estado.motor?.ejecutarAutenticacion ?? ejecutorDeProceso;
  const e = await estadoDeAutenticacion(runtime, { ejecutar, env });
  return {
    runtime,
    nombre: /** @type {any} */ (NOMBRES)[runtime] ?? runtime,
    conectado: e.conectado,
    metodo: e.metodo,
    detalle: guardada && e.metodo === "api_key" ? `${NOMBRES[/** @type {keyof typeof NOMBRES} */ (runtime)]} usara la API key guardada en la boveda (${VARIABLE_DE_KEY[runtime]})` : e.detalle,
    binarioPresente: e.binarioPresente,
    claveGuardada: guardada,
    comoIniciarSesion: e.comoIniciarSesion,
    ...(e.causa ? { causa: e.causa } : {}),
    ...(e.accion ? { accion: e.accion } : {}),
  };
}

// ---------------------------------------------------------------------------
// La sesion vencida
// ---------------------------------------------------------------------------
//
// EL CASO QUE ESTO CUBRE, medido: `codex login status` contesto "Logged in using
// ChatGPT" con el token vencido, y la fase fallo con "Your access token could
// not be refreshed". La pregunta al binario no lo ve —mira que el token este
// guardado, no que lo acepten—; el error de la fase si. El adaptador lo
// reconoce (`subtype: "sin_sesion"`), el motor deja la señal en el home
// (`rutaDeSesionVencida`) y aqui se RECUERDA por runtime, en memoria y con su
// hora, para que `GET /v1/runtimes`, el board y el diagnostico digan «sesion
// vencida» en vez de «conectado».
//
// SE OLVIDA con prueba de que la sesion volvio, y solo con eso:
//   - el login lanzado desde la app (`POST /v1/runtimes/:id/login`);
//   - una API key guardada o quitada (la credencial ya es otra);
//   - el archivo de sesion del runtime reescrito DESPUES del fallo (un `codex
//     login` hecho desde la terminal): el preflight lo ve por su fecha;
//   - una fase buena de ese runtime despues del fallo (señal «ok» del motor).
// Un "Logged in" del binario NO la olvida: es justo lo que mintio.

/**
 * Lo que se sabe de la sesion de cada runtime: la ultima señal, con su hora.
 * Vive en el motor del servicio; sin motor (una prueba de una ruta suelta), en
 * un mapa de este modulo.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @returns {Map<string, {estado: "vencida"|"ok", hora: string, causa?: string, accion?: string}>}
 */
function memoriaDeSesiones(p) {
  const motor = p.estado.motor;
  if (motor) {
    if (!motor.sesiones) motor.sesiones = new Map();
    return motor.sesiones;
  }
  return SESIONES_SIN_MOTOR;
}
const SESIONES_SIN_MOTOR = new Map();

/**
 * La hora de pared, y NO `motor.reloj`: se compara con la que el motor escribe
 * en su señal (otro proceso, `new Date()`), y un reloj inyectado para la cache
 * del board mezclaria dos escalas.
 */
function ahoraISO() {
  return new Date().toISOString();
}

const msDe = (/** @type {string|undefined} */ hora) => {
  const n = Date.parse(String(hora ?? ""));
  return Number.isNaN(n) ? -Infinity : n;
};

/**
 * Recuerda que la sesion de un runtime vencio. Lo usa quien vea el fallo en
 * este proceso; el motor, que corre aparte, deja la señal en el home.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {string} runtime
 * @param {{causa?: string, accion?: string, hora?: string}} datos
 */
export function recordarSesionVencida(p, runtime, datos) {
  memoriaDeSesiones(p).set(runtime, { estado: "vencida", hora: datos.hora ?? ahoraISO(), causa: datos.causa, accion: datos.accion });
}

/**
 * Olvida la sesion vencida: hay prueba de que volvio. Se guarda como «ok» con
 * su hora, para que una señal vieja del motor no la resucite.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {string} runtime
 */
export function olvidarSesionVencida(p, runtime) {
  memoriaDeSesiones(p).set(runtime, { estado: "ok", hora: ahoraISO() });
}

/**
 * La sesion vencida de un runtime, o `null`. Antes de contestar incorpora lo
 * que el motor dejo en el home y lo que dice el archivo de sesion del runtime,
 * si son MAS NUEVOS que lo que ya se sabia.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {string} runtime
 * @param {Record<string, string>} env el de la pregunta, para ubicar el archivo de sesion
 * @returns {{hora: string, causa?: string, accion?: string}|null}
 */
export function sesionVencida(p, runtime, env) {
  const memoria = memoriaDeSesiones(p);
  let sabido = memoria.get(runtime) ?? null;

  if (p.estado.home) {
    try {
      const senal = JSON.parse(readFileSync(rutaDeSesionVencida(p.estado.home, runtime), "utf8"));
      if ((senal?.estado === "vencida" || senal?.estado === "ok") && msDe(senal.hora) > msDe(sabido?.hora)) {
        sabido = {
          estado: senal.estado,
          hora: String(senal.hora),
          ...(typeof senal.causa === "string" ? { causa: senal.causa } : {}),
          ...(typeof senal.accion === "string" ? { accion: senal.accion } : {}),
        };
        memoria.set(runtime, sabido);
      }
    } catch {
      /* sin señal del motor: vale lo que ya se sabia */
    }
  }
  if (sabido?.estado !== "vencida") return null;

  // Un login hecho FUERA de la app: el runtime reescribio su archivo de sesion
  // despues del fallo. Solo se mira la fecha; el contenido es la credencial.
  const archivo = archivoDeSesion(runtime, env);
  if (archivo) {
    try {
      const cambio = statSync(archivo).mtimeMs;
      if (cambio > msDe(sabido.hora)) {
        memoria.set(runtime, { estado: "ok", hora: new Date(cambio).toISOString() });
        return null;
      }
    } catch {
      /* sin archivo (Claude en macOS usa el llavero): no hay prueba, sigue vencida */
    }
  }
  return { hora: sabido.hora, causa: sabido.causa, accion: sabido.accion };
}

/**
 * El estado de la pregunta al binario, corregido con la sesion vencida si la
 * hay. Se aplica FUERA de la cache: una señal nueva del motor tiene que verse
 * en la siguiente pintada, no dentro de treinta segundos.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {string} runtime
 * @param {any} valor
 */
function conSesionVencida(p, runtime, valor) {
  const { env } = entornoDeLaPregunta(p, runtime);
  const v = sesionVencida(p, runtime, env);
  if (!v) return valor;
  const nombre = /** @type {any} */ (NOMBRES)[runtime] ?? runtime;
  return {
    ...valor,
    conectado: false,
    detalle: `sesion vencida: ${nombre} rechazo su credencial en una fase (${v.hora})`,
    causa: v.causa ?? `${nombre} rechazo su credencial al correr una fase: la sesion vencio o la API key ya no vale.`,
    accion: v.accion ?? `Vuelve a iniciar sesion (\`${valor.comoIniciarSesion?.comando?.join(" ") ?? runtime}\`) o pega una API key nueva en Settings → Modelos.`,
    sesionVencida: { hora: v.hora },
  };
}

/**
 * Los estados de varios runtimes, con la cache del board. `fresco` la salta y
 * la renueva: es lo que pide la pantalla de Modelos despues de un login.
 *
 * Un runtime que `packages/adapters` no sabe interrogar (uno inventado en la
 * flota) vuelve con `conectado: null`: no se sabe, y no se afirma ni que si ni
 * que no.
 *
 * @param {import("./rutas.mjs").Peticion} p
 * @param {string[]} runtimes
 * @param {{fresco?: boolean}} [opts]
 * @returns {Promise<Map<string, any>>}
 */
export async function estadosDeRuntimes(p, runtimes, opts = {}) {
  const motor = p.estado.motor;
  const ahora = motor ? motor.reloj() : Date.now();
  const ttl = motor?.ttlDelBoardMs ?? 30_000;
  if (motor && !motor.cacheDeRuntimes) motor.cacheDeRuntimes = new Map();
  const cache = motor?.cacheDeRuntimes ?? new Map();
  const salida = new Map();
  for (const runtime of new Set(runtimes)) {
    if (!RUNTIMES_CON_SESION.includes(runtime)) {
      salida.set(runtime, { runtime, conectado: null });
      continue;
    }
    const guardado = cache.get(runtime);
    if (!opts.fresco && guardado && ahora - guardado.ts < ttl) {
      salida.set(runtime, conSesionVencida(p, runtime, guardado.valor));
      continue;
    }
    const valor = await estadoDe(p, runtime);
    cache.set(runtime, { ts: ahora, valor });
    salida.set(runtime, conSesionVencida(p, runtime, valor));
  }
  return salida;
}

/** @param {import("./rutas.mjs").Peticion} p */
function olvidarEstados(p) {
  p.estado.motor?.cacheDeRuntimes?.clear?.();
  p.estado.motor?.cacheDelBoard?.clear?.();
  p.estado.bus?.emitir?.("board.invalidado", { projectId: null });
}

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

/** `GET /v1/runtimes` — siempre fresco: es la pantalla donde el operador acaba de iniciar sesion. */
export async function runtimes(/** @type {import("./rutas.mjs").Peticion} */ p) {
  const estados = await estadosDeRuntimes(p, [...RUNTIMES_CON_SESION], { fresco: true });
  return { cuerpo: coleccion([...estados.values()]) };
}

/**
 * `POST /v1/runtimes/:id/login` — lanza el login DEL RUNTIME y no lo espera.
 *
 * DESACOPLADO A PROPOSITO. `claude auth login` abre el navegador y se queda
 * esperando a que el operador termine alli; esperar aqui colgaria la peticion
 * minutos. Se lanza en su propio grupo de procesos, sin stdio, y se suelta
 * (`unref`): si el servicio se cierra, el login sigue. La pantalla vuelve a
 * pedir `GET /v1/runtimes` para ver si ya hay sesion. El entorno es el de la
 * maquina filtrado (el runtime necesita HOME/USER para su llavero), nunca el
 * del servicio entero.
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function iniciarSesion(p) {
  const runtime = exigirRuntime(p.parametros.id);
  const e = await estadoDe(p, runtime);
  const argv = e.comoIniciarSesion.comando;
  const { env } = entornoDeLaPregunta(p, runtime);
  delete env[VARIABLE_DE_KEY[runtime]];
  const lanzarLogin =
    p.estado.motor?.lanzarLogin ??
    ((/** @type {string[]} */ a, /** @type {Record<string, string>} */ entorno) => {
      // POR SU RUTA ABSOLUTA y con el PATH ampliado: desde una app de macOS
      // `claude` a secas da ENOENT, y el login de un runtime puede necesitar
      // `node` o el navegador por su nombre. Ver `binarios.mjs`.
      const conPath = { ...entorno, PATH: pathAmpliado(entorno) };
      const binario = resolverBinario(a[0], { env: conPath }) ?? a[0];
      const hijo = spawnDeNode(binario, a.slice(1), { env: conPath, detached: true, stdio: "ignore" });
      // Un binario que no esta emite `error` despues: sin este manejador, el
      // proceso del servicio se cae por una excepcion que nadie espera.
      hijo.on("error", () => {});
      hijo.unref();
    });
  if (!e.binarioPresente) {
    throw new ErrorDeServicio("pieza_ausente", {
      pieza: `el binario de ${e.nombre}`,
      porque: e.causa ?? `\`${argv[0]}\` no esta instalado en la maquina del servicio.`,
      comoConseguirlo: e.accion ?? `Instala \`${argv[0]}\` y vuelve a pulsar «Iniciar sesion».`,
    });
  }
  lanzarLogin([...argv], env);
  // Un login lanzado es la accion que la sesion vencida pedia: se olvida. Si el
  // operador lo abandona, la siguiente fase lo volvera a marcar.
  olvidarSesionVencida(p, runtime);
  olvidarEstados(p);
  return { codigo: 202, cuerpo: { iniciado: true, runtime, comando: argv.join(" "), abreNavegador: true } };
}

/**
 * `POST|DELETE /v1/runtimes/:id/api-key` — la key en la boveda, o fuera.
 *
 * GUARDAR CONCEDE EL GRANT DEL MOTOR. La key es global (un operador, una
 * cuenta), pero la boveda entrega un valor solo con un grant de (proyecto,
 * agente) vigente (principio IX). Al guardarla se concede a los implementadores
 * de cada proyecto que ya existen, con el operador como quien concede —fue su
 * gesto—. Un proyecto dado de alta DESPUES no la recibe hasta que se guarde de
 * nuevo o se conceda en Settings -> Credenciales: su runtime usa entonces la
 * sesion local, y `GET /v1/runtimes` no puede saber por proyecto. Hueco
 * declarado.
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function claveDeRuntime(p) {
  const runtime = exigirRuntime(p.parametros.id);
  const boveda = p.dep.exigirBoveda();
  const existente = credencialDelRuntime(p.dep, runtime);

  if (p.metodo === "DELETE") {
    if (!existente) throw noEsta("API key de runtime", runtime, "`GET /v1/runtimes` (`claveGuardada`)");
    await boveda.borrar(existente.ref_boveda);
    await p.dep.recargarRedaccion();
    // Otra credencial: lo que vencio era la de antes.
    olvidarSesionVencida(p, runtime);
    olvidarEstados(p);
    return { cuerpo: { quitada: true, runtime } };
  }

  const cuerpo = await p.cuerpo();
  if (!cuerpo || typeof cuerpo.valor !== "string" || !cuerpo.valor.trim()) {
    throw new ErrorDeServicio("cuerpo_invalido", {
      detalle: "falta `valor`: la API key del runtime, como texto",
      campos: ["valor"],
    });
  }

  let credencial = existente;
  if (existente) {
    // Rotar sobre la MISMA fila: los grants se conservan (FR-047).
    await boveda.rotar(existente.ref_boveda, cuerpo.valor.trim());
  } else {
    credencial = (
      await boveda.registrar({
        workspace: p.dep.workspace.id,
        nombre: `api-key-${runtime}`,
        proveedor: runtime,
        tipo: "modelo",
        ambito: "global",
        project_id: null,
        alcance_declarado: `invocar el modelo de ${NOMBRES[/** @type {keyof typeof NOMBRES} */ (runtime)]} desde las fases del motor (${VARIABLE_DE_KEY[runtime]})`,
        valor: cuerpo.valor.trim(),
      })
    ).credencial;
  }
  // El redactor conoce el valor nuevo ANTES de que nada mas se persista.
  await p.dep.recargarRedaccion();

  const implementadores = p.dep.almacen.base.consultar(
    "SELECT a.id AS agent_id, a.project_id FROM agent a JOIN project pr ON pr.id = a.project_id " +
      "WHERE pr.workspace_id = ? AND a.rol = 'implementador'",
    [p.dep.workspace.id],
  );
  for (const { agent_id, project_id } of implementadores) {
    const vigente = p.dep.almacen.base.consultarUno(
      'SELECT id FROM "grant" WHERE credential_id = ? AND project_id = ? AND agent_id = ? AND revocado_en IS NULL LIMIT 1',
      [credencial.id, project_id, agent_id],
    );
    if (vigente) continue;
    await boveda.otorgar({
      project_id,
      agent_id,
      credential_id: credencial.id,
      concedido_por: CONCEDIDO_POR,
      vigenciaHasta: null,
    });
  }

  // Otra credencial: lo que vencio era la de antes.
  olvidarSesionVencida(p, runtime);
  olvidarEstados(p);
  const [estado] = (await estadosDeRuntimes(p, [runtime], { fresco: true })).values();
  return { codigo: existente ? 200 : 201, cuerpo: estado };
}

/**
 * La API key del runtime para el entorno del motor, desde la boveda y con el
 * grant del proyecto. `{}` si no hay key o no hay grant: el runtime usa
 * entonces la sesion local del operador, que es un camino tan legitimo como la
 * key. Se llama en cada paso del motor, no una vez: el grant se verifica en el
 * instante del uso (principio IX).
 *
 * @param {any} dep
 * @param {any} proyecto
 * @param {string} runtime
 * @returns {Promise<Record<string, string>>}
 */
export async function claveDelModelo(dep, proyecto, runtime) {
  const variable = VARIABLE_DE_KEY[runtime];
  if (!variable || !dep.boveda) return {};
  const credencial = credencialDelRuntime(dep, runtime);
  if (!credencial) return {};
  const grant = dep.almacen.base.consultarUno(
    'SELECT * FROM "grant" WHERE credential_id = ? AND project_id = ? AND revocado_en IS NULL ' +
      "AND (vigencia_hasta IS NULL OR vigencia_hasta > ?) ORDER BY concedido_en DESC LIMIT 1",
    [credencial.id, proyecto.id, new Date().toISOString()],
  );
  if (!grant) return {};
  const valor = await dep.boveda.recuperar(String(credencial.ref_boveda), {
    grant_id: String(grant.id),
    project_id: String(proyecto.id),
    agent_id: String(grant.agent_id),
    proposito: "lanzar_runner",
  });
  return { [variable]: valor };
}
