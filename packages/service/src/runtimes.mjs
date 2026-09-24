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

import { RUNTIMES_CON_SESION, ejecutorDeProceso, estadoDeAutenticacion } from "../../adapters/src/autenticacion.mjs";
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
      salida.set(runtime, guardado.valor);
      continue;
    }
    const valor = await estadoDe(p, runtime);
    cache.set(runtime, { ts: ahora, valor });
    salida.set(runtime, valor);
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
      const hijo = spawnDeNode(a[0], a.slice(1), { env: entorno, detached: true, stdio: "ignore" });
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
