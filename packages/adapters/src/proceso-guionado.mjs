// El subproceso guionado: el runtime del adaptador `fake`, y el doble de los
// otros dos cuando corren la suite de contrato.
//
// POR QUE HAY UN PROCESO DE VERDAD Y NO UN OBJETO SIMULADO. Porque la mitad de
// lo que el contrato promete solo se puede comprobar del otro lado de un
// `spawn`: que el entorno que recibe el hijo sea EXACTAMENTE `req.env`, que el
// directorio de trabajo sea el worktree, que ningun valor del entorno aparezca
// en `argv`, que cancelar mate el proceso y no deje huerfanos, y que los hooks
// corran DENTRO. Un doble en memoria hace pasar las pruebas del contrato
// sin probar ninguna de esas cinco.
//
// LO QUE NO HACE: no decide nada. Lo que imprime y con que codigo sale lo dice
// el guion; el adaptador traduce eso a un `PhaseResult` sin leer la prosa.
//
// NUNCA `process.exit()` DESPUES DE ESCRIBIR. Medido en este paquete: cuando la
// salida va a una tuberia —que es siempre, porque el adaptador lanza con
// `stdio: pipe`— `process.stdout.write` es ASINCRONO, y un `process.exit()`
// inmediato descarta lo que quedaba en el buffer. El sintoma fue exit code 0,
// stdout vacio y el adaptador reportando `stream_incompleto` sobre una fase que
// habia ido bien. Se usa `process.exitCode` y se deja terminar solo.
//
// argv: <script> <guion> <visto> <hooks> -- <argumentos del runtime...>
// Los tres primeros aceptan "-" para decir "ninguno".

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [, , guionPath, vistoPath, hooksJson, ...resto] = process.argv;
const args = resto[0] === "--" ? resto.slice(1) : resto;

// LO PRIMERO, ANTES DE CUALQUIER OTRA COSA: dejar constancia de lo que este
// proceso recibio de verdad. Si se escribiera al final, una fase cancelada o un
// hook que corta no dejarian nada que mirar, y esas son justo las dos pruebas a
// las que mas falta les hace poder mirar.
if (vistoPath && vistoPath !== "-") {
  writeFileSync(
    vistoPath,
    JSON.stringify({ cwd: process.cwd(), env: { ...process.env }, argv: args, pid: process.pid }),
  );
}

/** @type {any} */
let guion = {};
let abortado = false;

if (guionPath && guionPath !== "-") {
  try {
    guion = JSON.parse(readFileSync(guionPath, "utf8"));
  } catch (e) {
    process.stderr.write(`el guion ${guionPath} no se pudo leer: ${e.message}\n`);
    process.exitCode = 64;
    abortado = true;
  }
}

// LOS HOOKS CORREN AQUI DENTRO, en el subproceso, con su entorno y su cwd. Es
// la regla 5 del contrato: el hook del paso RED y el del limite de autonomia no
// valen nada si corren en el motor, porque lo que hay que interceptar son las
// escrituras que ocurren aqui.
if (!abortado && hooksJson && hooksJson !== "-") {
  /** @type {string[][]} */
  let hooks = [];
  try {
    hooks = JSON.parse(hooksJson);
  } catch {
    process.stderr.write("la declaracion de hooks no es JSON valido\n");
    process.exitCode = 64;
    abortado = true;
  }
  for (const hook of abortado ? [] : hooks) {
    const [comando, ...argsDelHook] = hook;
    const r = spawnSync(comando, argsDelHook, { cwd: process.cwd(), env: process.env, encoding: "utf8" });
    if (r.status !== 0) {
      // Correr sin guarda es PEOR que no correr: el paso RED se saltea y el
      // limite del PR deja de existir, las dos cosas en silencio.
      process.stderr.write(
        `el hook \`${comando}\` salio con ${r.status === null ? "una señal" : r.status}: no se sigue con la fase. ` +
          `${(r.stderr || "").trim()}\n`,
      );
      process.exitCode = 2;
      abortado = true;
      break;
    }
  }
}

// LO QUE LA FASE HACE EN EL ARBOL, si el guion lo dice: `fases.<FASE>.escribir`
// ({ruta relativa al cwd: contenido}) y `fases.<FASE>.correr` ([[comando,
// ...args]]). Existe para poder probar SIN MODELO lo que el motor hace con un
// runtime sin hooks que se porta mal —escribir produccion en RED, tocar un
// archivo ajeno en GREEN, mover una rama—: sin esto, la guarda posterior del
// motor solo se podria probar con un doble en memoria, que no escribe en un
// worktree de verdad.
if (!abortado && guion.fases && typeof guion.fases === "object") {
  const i = args.indexOf("--phase");
  const paso = i >= 0 ? guion.fases[args[i + 1]] : null;
  for (const [ruta, contenido] of Object.entries(paso?.escribir || {})) {
    const destino = resolve(process.cwd(), ruta);
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, String(contenido));
  }
  for (const [comando, ...argsDelPaso] of paso?.correr || []) {
    const r = spawnSync(comando, argsDelPaso, { cwd: process.cwd(), env: process.env, encoding: "utf8" });
    if (r.status !== 0) process.stderr.write(`\`${comando}\` salio con ${r.status}: ${(r.stderr || "").trim()}\n`);
  }
}

if (!abortado) {
  if (guion.colgar) {
    // Una fase que no termina sola: la unica forma de probar que cancelar de
    // verdad mata el proceso. Sin `unref` a proposito — tiene que quedarse vivo.
    setInterval(() => {}, 1000);
  } else if (typeof guion.salida === "string") {
    process.stdout.write(guion.salida);
    // Lo que un runtime de verdad dice por stderr al fallar —una sesion
    // vencida, un 401—: sin esto no se puede reproducir una salida grabada.
    if (typeof guion.stderr === "string") process.stderr.write(guion.stderr);
    process.exitCode = Number.isInteger(guion.code) ? guion.code : 0;
  } else {
    const i = args.indexOf("--resume");
    const retomada = i >= 0 ? args[i + 1] : null;
    const exito = guion.exito !== false;
    // LO QUE EL RUNTIME VA DICIENDO, antes del resultado: `eventos` son
    // mensajes con la forma de Claude (`assistant`, `user`), uno por linea,
    // como `stream-json`. Es lo que deja probar el transcript en vivo sin
    // modelo. Con `pausaMs` entre uno y otro, el stream tarda lo que tarda un
    // runtime de verdad y se puede ver crecer.
    const eventos = Array.isArray(guion.eventos) ? guion.eventos : [];
    const pausa = Number.isInteger(guion.pausaMs) && guion.pausaMs > 0 ? guion.pausaMs : 0;
    const lineaFinal =
      JSON.stringify({
        type: "result",
        // Retomar de verdad: si se pidio una sesion, se sigue en ella. Un
        // adaptador que declara `resume: true` y abre sesion nueva igual seria
        // una capacidad fingida, que es lo que la regla 1 prohibe.
        session_id: guion.sessionId ?? retomada ?? `fake-${process.pid}`,
        subtype: guion.subtype ?? (exito ? "success" : "error"),
        is_error: !exito,
        num_turns: 1,
        // `null` y no `0`: este runtime no invoca ningun modelo, asi que no hay
        // coste que reportar, y un cero fingiria uno medido.
        total_cost_usd: guion.usd ?? null,
        result: guion.texto ?? "el adaptador fake no invoco ningun modelo: no hay red, ni credenciales, ni modelo",
        // Los tokens, SOLO si el guion los trae: sin modelo no hay nada que
        // contar, y el transcript tiene que decir «sin medir», no cero.
        ...(guion.usage ? { usage: guion.usage } : {}),
      }) + "\n";
    process.exitCode = exito ? 0 : 1;
    if (!pausa) {
      for (const ev of eventos) process.stdout.write(JSON.stringify(ev) + "\n");
      process.stdout.write(lineaFinal);
    } else {
      // Encadenado y no con `setInterval`: el proceso termina solo cuando no
      // queda nada pendiente, que es la regla de la cabecera (nada de exit).
      const siguiente = (/** @type {number} */ n) => {
        if (n < eventos.length) {
          process.stdout.write(JSON.stringify(eventos[n]) + "\n");
          setTimeout(() => siguiente(n + 1), pausa);
        } else {
          process.stdout.write(lineaFinal);
        }
      };
      siguiente(0);
    }
  }
}
