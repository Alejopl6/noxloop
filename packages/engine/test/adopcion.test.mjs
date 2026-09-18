// T072 y T073 — los dos tests que protegen la promesa de que alguien mas puede
// instalar esto.
//
// POR QUE EXISTEN. La barrera de adopcion no es entender el proyecto: es
// descubrir, de a un fallo por vez y a mitad de un recorrido, que faltaba una
// variable de entorno o que el checkout no era el que su nombre decia. Los dos
// artefactos que sostienen ese primer dia son la configuracion de ejemplo y
// `doctor`, y los dos pueden mentir en silencio:
//
//   - Un ejemplo con una clave que el esquema no conoce es la peor forma de
//     documentacion: `additionalProperties: false` la rechaza, y quien copio el
//     ejemplo no entiende por que su copia no valida.
//   - Un `doctor` que agrega ("configuracion invalida") obliga a adivinar. La
//     version anterior de este harness no validaba y produjo una configuracion
//     que MENTIA: un campo de carencias vacio que el reporte del PR leia como
//     "este gate no tiene huecos" (D9 en research.md).
//   - Un `doctor` que adivina la ruta de un repositorio es como se trabaja en
//     el repositorio equivocado. Ya paso: un directorio dejo de corresponder al
//     repositorio que su nombre decia y el orquestador trabajo ahi sin que nada
//     avisara (cabecera de repos.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.mjs";
import { doctor } from "../src/doctor.mjs";
import { validate } from "../src/schema.mjs";

const RAIZ = fileURLToPath(new URL("../../../", import.meta.url));
const EJEMPLO = join(RAIZ, "examples/noxloop.config.json");
const ESQUEMA = join(RAIZ, "packages/engine/schemas/config.schema.json");
const FAKE = join(RAIZ, "providers/fake/index.mjs");

const leer = (p) => JSON.parse(readFileSync(p, "utf8"));

// -------------------------------------------------------------------------
// Utilidades
// -------------------------------------------------------------------------

function tempDir(prefijo) {
  return mkdtempSync(join(tmpdir(), `noxloop-${prefijo}-`));
}

/** Un repositorio git desechable con el remote que se le pida. */
function repoCon(remote, dir = tempDir("repo")) {
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  if (remote) execFileSync("git", ["remote", "add", "origin", remote], { cwd: dir });
  return dir;
}

/**
 * Escribe una configuracion en un directorio temporal y la carga.
 *
 * `forge.cli` queda en `git` a proposito: `doctor` comprueba que el binario del
 * forge este en el PATH, y `git` es el unico binario que el motor ya declara
 * como dependencia dura. Poner `gh` ataria el veredicto de estos tests a lo que
 * tenga instalada la maquina que los corre.
 */
function cargar(parcial) {
  const d = tempDir("cfg");
  const cfg = {
    version: 1,
    provider: { name: "fake", module: FAKE },
    forge: { kind: "github", cli: "git" },
    ...parcial,
  };
  const p = join(d, "noxloop.config.json");
  writeFileSync(p, JSON.stringify(cfg));
  return loadConfig(p, { env: {} });
}

/** Cada string del documento, con su ruta. Para el barrido de credenciales. */
function cadenas(valor, ruta = "$", salida = []) {
  if (typeof valor === "string") salida.push({ ruta, valor });
  else if (Array.isArray(valor)) valor.forEach((v, i) => cadenas(v, `${ruta}[${i}]`, salida));
  else if (valor && typeof valor === "object") {
    for (const [k, v] of Object.entries(valor)) cadenas(v, `${ruta}.${k}`, salida);
  }
  return salida;
}

/**
 * Claves del documento que el esquema no describe.
 *
 * Es mas estricto que `validate`: una clave bajo un subesquema sin
 * `properties` ni `additionalProperties` (por ejemplo `provider.options`, que
 * es un `{type: "object"}` libre) la valida cualquier cosa, pero no esta
 * DESCRITA, y un ejemplo solo documenta lo que el esquema describe.
 */
function clavesNoDescritas(schema, data, ruta = "$", salida = []) {
  if (!schema || typeof schema !== "object" || !data || typeof data !== "object") return salida;
  if (Array.isArray(data)) {
    if (schema.items) data.forEach((v, i) => clavesNoDescritas(schema.items, v, `${ruta}[${i}]`, salida));
    return salida;
  }
  const props = schema.properties || {};
  const extra = schema.additionalProperties;
  for (const [k, v] of Object.entries(data)) {
    if (props[k]) clavesNoDescritas(props[k], v, `${ruta}.${k}`, salida);
    else if (extra && typeof extra === "object") clavesNoDescritas(extra, v, `${ruta}.${k}`, salida);
    else salida.push(`${ruta}.${k}`);
  }
  return salida;
}

// =========================================================================
// T072 — la configuracion de ejemplo
// =========================================================================

test("T072 el ejemplo valida contra el esquema, sin un solo problema", () => {
  const problemas = validate(leer(ESQUEMA), leer(EJEMPLO));
  assert.deepEqual(problemas, [], `examples/noxloop.config.json no valida:\n  - ${problemas.join("\n  - ")}`);
});

test("T072 cada campo que el ejemplo declara esta descrito en el esquema", () => {
  const noDescritas = clavesNoDescritas(leer(ESQUEMA), leer(EJEMPLO));
  assert.deepEqual(
    noDescritas,
    [],
    `el ejemplo declara claves que el esquema no describe, y quien lo copie no va a entender por que se rechazan: ${noDescritas.join(", ")}`,
  );
});

test("T072 doctor acepta el ejemplo: lo que falta es el repositorio, no la forma", async () => {
  const cfg = loadConfig(EJEMPLO, { env: {} });
  const r = await doctor(cfg, { env: {} });

  // El ejemplo apunta al proveedor falso, que no toca ninguna red ni pide
  // credenciales: se puede ver el motor funcionando antes de tener una.
  assert.equal(cfg.provider.name, "fake");
  assert.equal(r.proveedor.ok, true, `el proveedor del ejemplo no valida: ${r.problemas.join(" | ")}`);
  assert.deepEqual(r.proveedor.requiredEnv, [], "el ejemplo no puede exigir ninguna variable de entorno");

  // En una maquina que no tiene el repositorio de ejemplo, lo unico que puede
  // faltar es el entorno: el checkout, el binario del forge o una variable.
  // Un problema de forma —una clave desconocida, un tipo mal, un proveedor que
  // no carga— seria un ejemplo roto, y es lo que este test vigila.
  const esperables = [
    /^repositorio "/,
    /^git no esta disponible/,
    /^el CLI del forge/,
    /^falta la variable de entorno/,
  ];
  for (const p of r.problemas) {
    assert.ok(
      esperables.some((re) => re.test(p)),
      `problema no esperable en una maquina sin el repo de ejemplo (huele a ejemplo roto): ${p}`,
    );
  }
  assert.ok(
    !r.problemas.some((p) => /no se pudo cargar el proveedor|no esta declarado en el esquema|tiene que ser/.test(p)),
    `el ejemplo tiene un problema de forma: ${r.problemas.join(" | ")}`,
  );

  // Y no revienta: devuelve un informe, aunque no este listo.
  assert.equal(typeof r.ready, "boolean");
  assert.ok(Array.isArray(r.avisos));
});

test("T072 el ejemplo no trae ninguna credencial ni ningun valor que parezca una", () => {
  const crudo = leer(EJEMPLO);
  const todas = cadenas(crudo);

  // Prefijos de credenciales reales de los gestores y forges que el proyecto
  // soporta. Un ejemplo con uno de estos se copia, se commitea y filtra.
  const HUELLAS = [
    /gh[oprsu]_[A-Za-z0-9]{16,}/,
    /github_pat_[A-Za-z0-9_]{16,}/,
    /\bsk-[A-Za-z0-9-]{16,}/,
    /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
    /\bglpat-[A-Za-z0-9_-]{16,}/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\beyJ[A-Za-z0-9_-]{10,}\./, // JWT
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\b[0-9a-f]{32,}\b/, // un blob hexadecimal no es un valor de ejemplo
  ];
  for (const { ruta, valor } of todas) {
    for (const re of HUELLAS) {
      assert.ok(!re.test(valor), `${ruta} parece una credencial (${re}): ${valor}`);
    }
  }

  // Una clave con nombre de secreto solo puede traer una referencia al entorno,
  // nunca un literal: es la diferencia entre documentar de donde sale el valor
  // y dejar el valor puesto.
  const SENSIBLE = /(token|secret|password|passwd|apikey|api_key|credential|\bpat\b|bearer)/i;
  for (const { ruta, valor } of todas) {
    if (!SENSIBLE.test(ruta)) continue;
    assert.match(valor, /^\$\{[^}]+\}$/, `${ruta} es un campo de credencial con un literal: ${valor}`);
  }

  // Un `usuario:clave@host` en una URL solo es admisible contra la maquina
  // local: el default de la base de tests tiene que quedar copiable, y una
  // clave contra localhost no es una credencial. Contra cualquier otro host,
  // si lo es.
  for (const { ruta, valor } of todas) {
    const m = valor.match(/\/\/[^/@\s:]+:[^/@\s]+@([^/\s:]+)/);
    if (!m) continue;
    assert.ok(
      ["localhost", "127.0.0.1", "::1", "db", "host.docker.internal"].includes(m[1]),
      `${ruta} lleva credenciales embebidas contra ${m[1]}: ${valor}`,
    );
  }
});

// =========================================================================
// T073 — doctor
// =========================================================================

test("T073 enumera cada carencia por separado, no un 'configuracion invalida'", async () => {
  const cfg = cargar({
    repos: {
      app: { path: join(tempDir("vacio"), "no-esta"), remote: "git@example.com:o/app.git", baseBranch: "main", gate: "npm test" },
      web: { path: join(tempDir("vacio"), "tampoco"), remote: "git@example.com:o/web.git", baseBranch: "main", gate: "npm test" },
    },
  });
  const r = await doctor(cfg, { env: {} });

  assert.equal(r.ready, false);
  assert.ok(Array.isArray(r.problemas), "los problemas son una lista, no un texto");
  assert.equal(r.problemas.filter((p) => p.includes('repositorio "app"')).length, 1);
  assert.equal(r.problemas.filter((p) => p.includes('repositorio "web"')).length, 1);

  // Cada repositorio trae su propio veredicto, con su propia causa: es lo que
  // permite arreglar una ruta sin volver a correr para descubrir la siguiente.
  assert.equal(r.repos.length, 2);
  for (const repo of r.repos) {
    assert.equal(repo.ok, false);
    assert.equal(repo.path, null);
    assert.ok(repo.problem.includes(repo.name), `el problema de ${repo.name} tiene que nombrarlo: ${repo.problem}`);
  }
});

test("T073 un repositorio sin `path` no recibe una ruta adivinada", async () => {
  const cfg = cargar({
    repos: { app: { remote: "git@example.com:o/app.git", baseBranch: "main", gate: "npm test" } },
  });
  const r = await doctor(cfg, { env: {} });

  assert.equal(r.ready, false, "sin ruta no se puede arrancar: es un problema, no un aviso");
  assert.equal(r.repos[0].path, null, "no hay ruta, y `null` es la respuesta honesta");
  const p = r.problemas.find((x) => x.includes('repositorio "app"'));
  assert.ok(p, `falta el problema del repositorio: ${r.problemas.join(" | ")}`);
  assert.match(p, /path/, "el problema tiene que nombrar el campo que falta");
  assert.match(p, /--search|declaralo/, "y tiene que decir como arreglarlo");

  // Lo que NO puede pasar: que aparezca una ruta inventada a partir del nombre
  // de la clave, del cwd o del home. Trabajar en el repositorio equivocado es
  // un fallo silencioso, que es la peor clase.
  assert.ok(!r.problemas.some((x) => x.includes(join(process.cwd(), "app"))));
  assert.ok(!r.problemas.some((x) => /\/app\b/.test(x)), `doctor adivino una ruta: ${r.problemas.join(" | ")}`);
});

test("T073 un directorio que coincide de nombre pero no de remote no vale como checkout", async () => {
  // El caso exacto del fallo de repos.mjs: `<base>/app` existe, es un git, y no
  // es el repositorio "app". Pasarle `--search` no autoriza a asumirlo.
  const base = tempDir("search");
  mkdirSync(join(base, "app"));
  repoCon("git@example.com:o/OTRO.git", join(base, "app"));

  const cfg = cargar({
    repos: { app: { remote: "git@example.com:o/app.git", baseBranch: "main", gate: "npm test" } },
  });
  const r = await doctor(cfg, { search: [base], env: {} });

  assert.equal(r.ready, false);
  assert.equal(r.repos[0].path, null);
  assert.match(r.problemas.join("\n"), /OTRO/, "el problema tiene que decir que remote encontro");
});

test("T073 detecta que el checkout local declarado no corresponde al remote declarado", async () => {
  const p = repoCon("git@example.com:o/OTRO.git");
  const cfg = cargar({
    repos: { app: { path: p, remote: "git@example.com:o/app.git", baseBranch: "main", gate: "npm test" } },
  });
  const r = await doctor(cfg, { env: {} });

  assert.equal(r.ready, false);
  const problema = r.problemas.find((x) => x.includes('repositorio "app"'));
  assert.ok(problema, `falta el problema del repositorio: ${r.problemas.join(" | ")}`);
  assert.match(problema, /OTRO/, "tiene que decir cual es el remote que encontro");
  assert.match(problema, /o\/app/, "y contra cual lo comparo");
});

test("T073 un aviso no baja `ready`; un problema si", async () => {
  const p = repoCon("git@example.com:o/app.git");
  // Un repositorio resoluble al que le faltan las tres cosas de las que
  // `doctor` avisa —`fastGate`, `gaps`, `runners`— y sin `stateMap`. Todo eso
  // es "se puede arrancar, con menos garantias".
  const cfg = cargar({
    repos: { app: { path: p, remote: "git@example.com:o/app.git", baseBranch: "main", gate: "npm test" } },
  });
  const r = await doctor(cfg, { env: {} });

  assert.deepEqual(r.problemas, [], "nada impide arrancar");
  assert.equal(r.ready, true, "`ready` solo lo baja un problema");

  // Y los avisos tambien vienen de a uno, por carencia y por repositorio.
  const avisos = r.avisos.join("\n");
  assert.match(avisos, /fastGate/);
  assert.match(avisos, /runners/);
  assert.match(avisos, /stateMap/);
  // El `gaps` vacio es el fallo medido de D9: un campo de carencias vacio que
  // el reporte leyo como "este gate no tiene huecos".
  assert.ok(
    r.avisos.some((a) => a.includes("gaps") && a.includes('"app"')),
    `falta el aviso de gaps vacio: ${avisos}`,
  );

  // El mismo repositorio con el remote cambiado: ahora si baja `ready`.
  const roto = await doctor(
    cargar({ repos: { app: { path: p, remote: "git@example.com:o/distinto.git", baseBranch: "main", gate: "npm test" } } }),
    { env: {} },
  );
  assert.equal(roto.ready, false);
});

test("T073 el SDK ausente es un aviso y nunca un problema, porque el motor degrada al CLI", async () => {
  const p = repoCon("git@example.com:o/app.git");
  const cfg = cargar({
    repos: { app: { path: p, remote: "git@example.com:o/app.git", baseBranch: "main", gate: "npm test" } },
  });
  const r = await doctor(cfg, { env: {} });

  // HALLAZGO: `doctor` resuelve el SDK con `createRequire(...).resolve()` y no
  // acepta inyeccion, asi que el test no puede FORZAR la ausencia; y como el
  // SDK es `optionalDependency` del motor, un `npm ci` normal lo instala. La
  // rama degradada, entonces, casi nunca se recorre aca. Lo que si se puede
  // afirmar sin depender de la maquina es la bicondicional, que es la promesa
  // real: ausente => hay aviso; presente => no hay aviso. En ninguno de los dos
  // casos es un problema.
  assert.equal(typeof r.entorno.sdkPresente, "boolean");
  const avisoSdk = r.avisos.some((a) => a.includes("SDK"));
  assert.equal(avisoSdk, !r.entorno.sdkPresente, "el aviso del SDK tiene que seguir exactamente a su ausencia");
  assert.ok(!r.problemas.some((x) => x.includes("SDK")), `el SDK no puede ser un problema: ${r.problemas.join(" | ")}`);
  if (!r.entorno.sdkPresente) {
    assert.equal(r.ready, true, "sin SDK el motor arranca igual, invocando el CLI");
  }
});

test("T073 un stateMap que mapea `done` produce un aviso: la autonomia termina en el PR abierto", async () => {
  const p = repoCon("git@example.com:o/app.git");
  const cfg = cargar({
    provider: {
      name: "fake",
      module: FAKE,
      stateMap: { todo: "Nuevo", in_progress: "En curso", blocked: "Bloqueado", in_review: null, done: "Cerrado" },
    },
    repos: { app: { path: p, remote: "git@example.com:o/app.git", baseBranch: "main", gate: "npm test" } },
  });
  const r = await doctor(cfg, { env: {} });

  assert.equal(r.ready, true, "mapear `done` no impide arrancar: solo se avisa que no se va a escribir");
  assert.ok(
    r.avisos.some((a) => a.includes("done") && a.includes("PR abierto")),
    `falta el aviso de que noxloop no cierra tickets: ${r.avisos.join(" | ")}`,
  );
  // Y los estados sin mapear se declaran uno por uno, en vez de fallar al
  // escribirlos.
  assert.ok(r.avisos.some((a) => a.includes("in_review")), `falta el aviso de in_review sin mapear: ${r.avisos.join(" | ")}`);
});

test("T073 una variable de entorno que el proveedor necesita se reporta por su nombre", async () => {
  const p = repoCon("git@example.com:o/app.git");
  const cfg = cargar({
    repos: { app: { path: p, remote: "git@example.com:o/app.git", baseBranch: "main", gate: "npm test" } },
  });
  // Un proveedor que pide dos variables. Se inyecta en vez de usar uno real
  // para que el test no dependa de que gestor tenga credenciales la maquina.
  const proveedor = {
    meta: { name: "inventado", version: "1.0.0" },
    requiredEnv: ["TOKEN_A", "TOKEN_B"],
    getItem: async () => ({}),
    capabilities: () => ({
      children: false, dependencies: false, createChild: false, setState: false,
      comment: false, linkUrl: false, labels: false, searchAssigned: false,
      searchMentioned: false, boardFields: false, identityAssignee: false,
    }),
  };
  const r = await doctor(cfg, { env: { TOKEN_A: "presente" }, loadProvider: async () => proveedor });

  assert.equal(r.ready, false);
  assert.equal(r.problemas.length, 1, `una carencia, un problema: ${r.problemas.join(" | ")}`);
  assert.match(r.problemas[0], /TOKEN_B/);
  assert.ok(!r.problemas[0].includes("TOKEN_A"), "la que si esta no se reporta");

  // Y un proveedor que no sabe hacer nada no es un error: cada capacidad
  // ausente es un aviso con su degradacion declarada.
  const avisos = r.avisos.join("\n");
  assert.match(avisos, /disparo automatico/);
  assert.match(avisos, /hijos/);
  assert.match(avisos, /dependencias/);
});
