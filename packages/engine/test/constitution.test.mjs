// Las guardas de la constitucion. Cada test de aca corresponde a un principio
// que se puede violar en silencio, y el objetivo es que la violacion falle en CI
// en vez de aparecer en el repositorio de otra persona.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = new URL("../../../", import.meta.url).pathname;
const MOTOR = join(RAIZ, "packages/engine");

function fuentes(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e === "node_modules" || e === "test") continue;
      fuentes(p, acc);
    } else if (e.endsWith(".mjs")) {
      acc.push(p);
    }
  }
  return acc;
}

const DEL_MOTOR = () => [...fuentes(join(MOTOR, "src")), ...fuentes(join(MOTOR, "bin"))];

// Las guardas de CODIGO miran codigo. Los comentarios de este motor explican
// los fallos que cada mecanismo evita, y explicarlos exige nombrarlos: el
// comentario que dice "un `.noxloop/` por repositorio no puede dar eso" es
// justamente la documentacion del principio III, no una violacion.
//
// La guarda de NOMBRES PROPIOS es la excepcion deliberada: ahi los comentarios
// SI cuentan, porque un comentario que menciona una organizacion concreta es
// exactamente la fuga de genericidad que se quiere atrapar.
const codigo = (f) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("VII — el motor no contiene ningun nombre propio de organizacion, repo o host", () => {
  // La lista son los nombres del harness del que sale este motor. Si alguno
  // aparece, la genericidad se rompio y hay que mover el dato a configuracion.
  const PROHIBIDOS = [
    /partequipos/i, /\bflex\b/i, /azure[- ]?devops/i, /\bado_/i,
    /\.com\b/, /vstfs/i, /dev\.azure/i, /linear\.app/i, /api\.github/i,
  ];
  const hallazgos = [];
  for (const f of DEL_MOTOR()) {
    const texto = readFileSync(f, "utf8");
    for (const re of PROHIBIDOS) {
      const m = texto.match(re);
      if (m) hallazgos.push(`${f.replace(RAIZ, "")}: ${m[0]}`);
    }
  }
  assert.deepEqual(hallazgos, [], `el motor adquirio nombres propios:\n${hallazgos.join("\n")}`);
});

test("VI — el motor no importa ningun proveedor por nombre: los carga por configuracion", () => {
  const hallazgos = [];
  for (const f of DEL_MOTOR()) {
    const texto = codigo(f);
    if (/from\s+["'].*providers\/(?!contract)/.test(texto)) hallazgos.push(f.replace(RAIZ, ""));
  }
  assert.deepEqual(hallazgos, [], "un import directo a un proveedor concreto ramifica el motor");
});

test("II — solo state.mjs puede escribir un estado de tarea", () => {
  const hallazgos = [];
  for (const f of DEL_MOTOR()) {
    if (f.endsWith("/state.mjs")) continue;
    const texto = codigo(f);
    if (/\.status\s*=\s*["']/.test(texto)) hallazgos.push(f.replace(RAIZ, ""));
  }
  assert.deepEqual(hallazgos, [], "un estado escrito fuera de state.mjs se saltea las guardas");
});

test("IV — el motor no contiene ninguna operacion de merge, deploy o force push", () => {
  const PROHIBIDAS = [
    /pr\s+merge/, /git\s+merge\s+--no-ff/, /push\s+--force/, /push\s+-f\b/,
    /kubectl\s+apply/, /terraform\s+apply/,
  ];
  const hallazgos = [];
  for (const f of DEL_MOTOR()) {
    // El hook que las PROHIBE necesita nombrarlas: es el unico lugar legitimo.
    if (f.includes("/hooks/")) continue;
    const texto = codigo(f);
    for (const re of PROHIBIDAS) {
      if (re.test(texto)) hallazgos.push(`${f.replace(RAIZ, "")}: ${re}`);
    }
  }
  assert.deepEqual(hallazgos, [], `la autonomia se paso del PR:\n${hallazgos.join("\n")}`);
});

test("III — el estado no se escribe dentro de un repositorio de trabajo", () => {
  const hallazgos = [];
  for (const f of DEL_MOTOR()) {
    const texto = codigo(f);
    if (/\.noxloop["'\/]/.test(texto) && !/homedir|NOXLOOP_HOME/.test(texto)) {
      hallazgos.push(f.replace(RAIZ, ""));
    }
  }
  assert.deepEqual(hallazgos, [], "el estado tiene que vivir en NOXLOOP_HOME, fuera de los repos");
});

test("I — ningun archivo del motor puede conceder redVerified sin una corrida", () => {
  const hallazgos = [];
  for (const f of DEL_MOTOR()) {
    if (f.endsWith("/state.mjs")) continue;
    const texto = codigo(f);
    if (/redVerified\s*[=:]\s*true/.test(texto)) hallazgos.push(f.replace(RAIZ, ""));
  }
  assert.deepEqual(hallazgos, [], "redVerified solo lo concede state.mjs, y solo con evidencia");
});
