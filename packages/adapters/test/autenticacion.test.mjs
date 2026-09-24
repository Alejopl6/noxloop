// La deteccion de sesion de cada runtime, y el preflight que la usa.
//
// EL FALLO QUE CIERRA. El preflight de los dos runtimes reales solo preguntaba
// si el binario respondia a `--version`. Un `claude` instalado y sin sesion, o un
// `codex` sin `codex login`, pasaban el doctor en verde y fallaban en la primera
// fase con "no autenticado" — con la tarea repartida, el worktree creado y el
// operador mirando otra cosa. Lo que el operador necesita saber ANTES es si hay
// con que invocar al modelo: su suscripcion, su cuenta de ChatGPT o una API key.
//
// COMO SE PRUEBA SIN BINARIOS. El ejecutor se inyecta: cada caso guiona lo que
// contestaria `claude auth status` / `codex login status`. Y como la salida
// real de esos comandos trae datos de la cuenta (email, organizacion, un trozo
// de la key), cada caso mete un CENTINELA en esa salida y comprueba sobre el
// objeto serializado que no aparece en el resultado (principio IX).

import { test } from "node:test";
import assert from "node:assert/strict";

import { estadoDeAutenticacion, RUNTIMES_CON_SESION } from "../src/autenticacion.mjs";
import { crearAdaptadorClaude, VARIABLES_DE_SESION as SESION_CLAUDE } from "../src/adaptadores/claude-agent-sdk.mjs";
import { crearAdaptadorCodex, VARIABLES_DE_SESION as SESION_CODEX } from "../src/adaptadores/codex.mjs";
import { validarAdaptador } from "../src/contrato.mjs";

const CENTINELA = "valor-centinela-que-no-sale-7731";

/** Un ejecutor guionado que ademas anota con que argv y que entorno lo llamaron. */
function guionado(respuesta) {
  const llamadas = [];
  const ejecutar = async (argv, opciones) => {
    llamadas.push({ argv: [...argv], env: { ...(opciones?.env || {}) } });
    if (respuesta instanceof Error) throw respuesta;
    return { code: 0, stdout: "", stderr: "", ...respuesta };
  };
  return { ejecutar, llamadas };
}

const ausente = () => Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });

/** Nada de lo que devolvio el modulo contiene el centinela. Se mira el objeto serializado, no la intencion. */
function sinCentinela(r) {
  assert.equal(JSON.stringify(r).includes(CENTINELA), false, `el resultado filtra un dato de la cuenta: ${JSON.stringify(r)}`);
}

// ---------------------------------------------------------------------------
// claude-agent-sdk
// ---------------------------------------------------------------------------

test("claude con sesion de claude.ai: conectado por suscripcion, sin datos de la cuenta", async () => {
  const { ejecutar, llamadas } = guionado({
    stdout: JSON.stringify({
      loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty",
      email: `${CENTINELA}@example.test`, orgId: CENTINELA, orgName: CENTINELA, subscriptionType: "max",
    }),
  });
  const r = await estadoDeAutenticacion("claude-agent-sdk", { ejecutar, env: { HOME: "/h", USER: "u", PATH: "/bin" } });

  assert.equal(r.runtime, "claude-agent-sdk");
  assert.equal(r.conectado, true);
  assert.equal(r.metodo, "suscripcion_claude");
  assert.equal(typeof r.detalle, "string");
  assert.deepEqual(r.comoIniciarSesion, { comando: ["claude", "auth", "login"], abreNavegador: true });
  assert.deepEqual(llamadas[0].argv, ["claude", "auth", "status"]);
  sinCentinela(r);
});

test("claude el ejecutor recibe exactamente el entorno declarado, ni una variable mas", async () => {
  const { ejecutar, llamadas } = guionado({ stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }) });
  const env = { HOME: "/h", USER: "u", PATH: "/bin" };
  await estadoDeAutenticacion("claude-agent-sdk", { ejecutar, env });
  assert.deepEqual(llamadas[0].env, env);
});

test("claude sin sesion: desconectado, con causa y la accion de iniciar sesion o pegar la key", async () => {
  const { ejecutar } = guionado({
    code: 1,
    stdout: JSON.stringify({ loggedIn: false, authMethod: "none", configDirectory: CENTINELA }),
  });
  const r = await estadoDeAutenticacion("claude-agent-sdk", { ejecutar, env: {} });
  assert.equal(r.conectado, false);
  assert.equal(r.metodo, null);
  assert.ok(r.causa && r.causa.length > 20, `sin causa: ${r.causa}`);
  assert.match(r.accion, /claude auth login/);
  assert.match(r.accion, /Settings/);
  sinCentinela(r);
});

test("claude con API key declarada: conectado por api_key, y el valor no aparece", async () => {
  // La sesion local puede no estar: con la key basta, y es la que manda.
  const { ejecutar } = guionado({ stdout: JSON.stringify({ loggedIn: false, authMethod: "none" }) });
  const r = await estadoDeAutenticacion("claude-agent-sdk", { ejecutar, env: { ANTHROPIC_API_KEY: CENTINELA } });
  assert.equal(r.conectado, true);
  assert.equal(r.metodo, "api_key");
  assert.match(r.detalle, /ANTHROPIC_API_KEY/, "el detalle puede nombrar la variable: los nombres si se pueden decir");
  sinCentinela(r);
});

test("claude con salida ilegible: desconectado, y la salida cruda no se repite", async () => {
  const { ejecutar } = guionado({ stdout: `no es json ${CENTINELA}`, stderr: CENTINELA });
  const r = await estadoDeAutenticacion("claude-agent-sdk", { ejecutar, env: {} });
  assert.equal(r.conectado, false);
  assert.ok(r.causa && r.accion);
  sinCentinela(r);
});

test("claude sin binario: desconectado, la causa dice que no esta y la accion dice instalarlo", async () => {
  const { ejecutar } = guionado(ausente());
  const r = await estadoDeAutenticacion("claude-agent-sdk", { ejecutar, env: {} });
  assert.equal(r.conectado, false);
  assert.equal(r.metodo, null);
  assert.match(r.causa, /no esta instalado|no se encontro/i);
  assert.match(r.accion, /[Ii]nstala/);
  assert.deepEqual(r.comoIniciarSesion.comando, ["claude", "auth", "login"]);
});

// ---------------------------------------------------------------------------
// codex
// ---------------------------------------------------------------------------

test("codex con cuenta de ChatGPT: conectado por cuenta_chatgpt", async () => {
  const { ejecutar, llamadas } = guionado({ stdout: "Logged in using ChatGPT\n" });
  const r = await estadoDeAutenticacion("codex", { ejecutar, env: {} });
  assert.equal(r.runtime, "codex");
  assert.equal(r.conectado, true);
  assert.equal(r.metodo, "cuenta_chatgpt");
  assert.deepEqual(r.comoIniciarSesion, { comando: ["codex", "login"], abreNavegador: true });
  assert.deepEqual(llamadas[0].argv, ["codex", "login", "status"]);
});

test("codex logueado con API key: api_key, y el trozo de key que imprime no sale", async () => {
  // `codex login status` imprime la key enmascarada. Enmascarada sigue siendo
  // un pedazo del secreto: no se repite.
  const { ejecutar } = guionado({ stderr: `Logged in using an API key - sk-proj-***${CENTINELA}\n` });
  const r = await estadoDeAutenticacion("codex", { ejecutar, env: {} });
  assert.equal(r.conectado, true);
  assert.equal(r.metodo, "api_key");
  sinCentinela(r);
});

test("codex sin sesion: desconectado con la accion `codex login` o pegar la key", async () => {
  const { ejecutar } = guionado({ code: 1, stderr: "Not logged in\n" });
  const r = await estadoDeAutenticacion("codex", { ejecutar, env: {} });
  assert.equal(r.conectado, false);
  assert.equal(r.metodo, null);
  assert.match(r.accion, /codex login/);
  assert.match(r.accion, /Settings/);
});

test("codex con OPENAI_API_KEY declarada: api_key sin depender de la sesion", async () => {
  const { ejecutar } = guionado({ code: 1, stderr: "Not logged in\n" });
  const r = await estadoDeAutenticacion("codex", { ejecutar, env: { OPENAI_API_KEY: CENTINELA } });
  assert.equal(r.conectado, true);
  assert.equal(r.metodo, "api_key");
  sinCentinela(r);
});

test("codex sin binario: desconectado con accion de instalarlo", async () => {
  const { ejecutar } = guionado(ausente());
  const r = await estadoDeAutenticacion("codex", { ejecutar, env: { OPENAI_API_KEY: CENTINELA } });
  // Con key y sin binario no hay nada que la use: la key sola no invoca nada.
  assert.equal(r.conectado, false);
  assert.match(r.accion, /[Ii]nstala/);
  sinCentinela(r);
});

test("un runtime sin deteccion se rechaza nombrando los que la tienen", async () => {
  await assert.rejects(
    estadoDeAutenticacion("fake", { ejecutar: async () => ({ code: 0, stdout: "", stderr: "" }), env: {} }),
    (e) => RUNTIMES_CON_SESION.every((id) => e.message.includes(id)),
  );
});

// ---------------------------------------------------------------------------
// el preflight usa la deteccion
// ---------------------------------------------------------------------------

const sinSesionClaude = () => guionado({ code: 1, stdout: JSON.stringify({ loggedIn: false, authMethod: "none" }) });

for (const [nombre, crear, sinSesion, conSesion, comando] of [
  [
    "claude-agent-sdk",
    (o) => crearAdaptadorClaude({ resolverSdk: () => ({ disponible: true, motivo: null }), ...o }),
    sinSesionClaude,
    () => guionado({ stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai" }) }),
    "claude auth login",
  ],
  [
    "codex",
    (o) => crearAdaptadorCodex(o),
    () => guionado({ code: 1, stderr: "Not logged in\n" }),
    () => guionado({ stdout: "Logged in using ChatGPT\n" }),
    "codex login",
  ],
]) {
  test(`${nombre}: preflight sin sesion ni key dice que no, con causa y accion`, async () => {
    const { ejecutar } = sinSesion();
    const r = await crear({ ejecutarAutenticacion: ejecutar }).preflight();
    assert.equal(r.ok, false, "sin sesion el preflight dijo que todo bien: la primera fase fallaria con 'no autenticado'");
    assert.ok(r.causa && r.causa.length > 20);
    assert.ok(r.accion.includes(comando), `la accion no dice como iniciar sesion: ${r.accion}`);
    assert.match(r.accion, /Settings/);
    assert.equal(r.autenticacion.conectado, false);
  });

  test(`${nombre}: preflight con sesion dice que si y cuenta por que metodo`, async () => {
    const { ejecutar } = conSesion();
    const r = await crear({ ejecutarAutenticacion: ejecutar }).preflight();
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.autenticacion.conectado, true);
  });

  test(`${nombre}: preflight solo le pasa al comando las variables que el runtime declara`, async () => {
    const { ejecutar, llamadas } = conSesion();
    const disponible = {
      HOME: "/h", USER: "u", PATH: "/bin", LOGNAME: "u",
      NOXLOOP_CREDENCIAL_DE_OTRO: CENTINELA, GITHUB_TOKEN: CENTINELA,
    };
    await crear({ ejecutarAutenticacion: ejecutar, entornoDisponible: disponible }).preflight();
    const visto = llamadas.at(-1).env;
    assert.equal(visto.USER, "u", "sin USER la sesion del llavero de macOS no se encuentra: medido");
    assert.equal(visto.HOME, "/h");
    assert.equal(visto.PATH, "/bin");
    assert.equal(JSON.stringify(visto).includes(CENTINELA), false, "el preflight heredo variables que nadie declaro");
  });
}

test("claude: con el SDK ausente y sin binario, el preflight sigue diciendo que instalar", async () => {
  const { ejecutar } = guionado(ausente());
  const r = await crearAdaptadorClaude({
    comando: "/no/existe/claude",
    resolverSdk: () => ({ disponible: false, motivo: "no instalado" }),
    ejecutarAutenticacion: ejecutar,
  }).preflight();
  assert.equal(r.ok, false);
  assert.match(r.accion, /[Ii]nstala/);
});

// ---------------------------------------------------------------------------
// lo que la sesion local necesita, declarado por el runtime
// ---------------------------------------------------------------------------

test("cada runtime declara, como NO secretas, las variables sin las que su sesion local no se encuentra", () => {
  // Medido en esta maquina: `claude auth status` con `env -i HOME PATH` (sin
  // USER) contesta `loggedIn: false` aunque la sesion este en el llavero. El
  // llavero se consulta por usuario.
  for (const v of ["HOME", "USER", "PATH"]) {
    assert.ok(SESION_CLAUDE.includes(v), `claude no declara ${v}`);
    assert.ok(SESION_CODEX.includes(v), `codex no declara ${v}`);
  }
  assert.ok(SESION_CLAUDE.includes("CLAUDE_CONFIG_DIR"), "si el operador movio la config de Claude, la fase no la encontraria");
  assert.ok(SESION_CODEX.includes("CODEX_HOME"), "si el operador movio ~/.codex, la fase no encontraria auth.json");

  const claude = crearAdaptadorClaude({ hooks: { hooks: {} } });
  const codex = crearAdaptadorCodex();
  assert.deepEqual(claude.sessionEnv, [...SESION_CLAUDE]);
  assert.deepEqual(codex.sessionEnv, [...SESION_CODEX]);
  assert.ok(codex.requiredEnv.includes("OPENAI_API_KEY"), "la key de OpenAI guardada en la boveda no llegaria a la fase");

  // Ninguna variable es secreta y publica a la vez: las de sesion no se tratan
  // como secretos en la guarda de argv (HOME es prefijo de casi toda ruta).
  for (const a of [claude, codex]) {
    const cruce = a.sessionEnv.filter((n) => a.requiredEnv.includes(n));
    assert.deepEqual(cruce, [], `${a.id} declara como secreta y como de sesion: ${cruce.join(", ")}`);
    assert.equal(validarAdaptador(a).ok, true, validarAdaptador(a).problems.join("; "));
  }
});

test("el contrato valida sessionEnv: lista de nombres, y sin cruzarse con requiredEnv", () => {
  const base = {
    id: "x",
    capabilities: () => ({ resume: false, cost: false, effort: false, hooks: false, models: "desconocido" }),
    preflight: async () => ({ ok: true }),
    runPhase: async () => ({ ok: true }),
  };
  assert.equal(validarAdaptador({ ...base, sessionEnv: ["HOME"] }).ok, true);
  assert.equal(validarAdaptador({ ...base, sessionEnv: "HOME" }).ok, false);
  assert.equal(validarAdaptador({ ...base, sessionEnv: [""] }).ok, false);
  const cruzado = validarAdaptador({ ...base, requiredEnv: ["K"], sessionEnv: ["K"] });
  assert.equal(cruzado.ok, false);
  assert.ok(cruzado.problems.join(" ").includes("K"));
});
