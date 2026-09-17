#!/usr/bin/env node
// El limite de autonomia, forzado.
//
// noxloop termina en el PR abierto. No mergea a una rama protegida, no
// despliega, no hace force push y no ejecuta operaciones destructivas sobre un
// entorno remoto. El principio IV de la constitucion dice que eso se fuerza por
// interceptacion y no por instruccion, y este archivo es la interceptacion.
//
// UN RECORRIDO QUE LLEGA A PR ABIERTO CON TRES TAREAS BLOQUEADAS es un exito.
// Uno que llega a PR mergeado sin revision humana es un incidente, aunque el
// codigo este bien. Esa es toda la doctrina.
//
// EL FALLO QUE ESTE ARCHIVO YA COMETIO UNA VEZ, y por eso esta escrito asi:
// bloqueaba comandos legitimos que solo MENCIONABAN la frase prohibida — un
// `echo` con una advertencia, un `grep` buscando en la documentacion. Un hook
// que bloquea de mas deja a una persona sin poder trabajar. Por eso aca se
// parte el comando en segmentos reales, respetando comillas, y se mira el
// PRIMER TOKEN de cada uno: lo que se ejecuta, no lo que se nombra.

import { ALLOW, deny, tareaActiva, leerEntrada, responder } from "./_shared.mjs";

/** Ramas cuyo nombre implica que alguien mas depende de ellas. */
const PROTEGIDAS = ["main", "master", "staging", "production", "prod", "release"];

/**
 * Comandos que solo LEEN. Si un segmento empieza con uno de estos, lo que venga
 * despues es texto, no ejecucion.
 */
const LECTORES = new Set([
  "echo", "printf", "cat", "bat", "grep", "egrep", "fgrep", "rg", "ag", "ack",
  "head", "tail", "less", "more", "wc", "sort", "uniq", "cut", "tr", "jq", "yq",
  "diff", "comm", "awk", "sed", "ls", "tree", "stat", "file", "which", "type",
  "pwd", "cd", "export", "true", "false", "test", "date", "env", "man", "help",
]);

/** Subcomandos de git que solo leen. */
const GIT_LECTORES = new Set([
  "log", "status", "diff", "show", "describe", "rev-parse", "ls-files", "ls-remote",
  "blame", "shortlog", "cat-file", "for-each-ref", "symbolic-ref", "stash",
]);

/**
 * Parte un comando en segmentos ejecutables respetando comillas.
 *
 * Respetar las comillas es lo que evita el falso positivo: sin esto,
 * `echo "a && gh pr merge 1"` produce un segundo segmento que parece un merge.
 */
export function segmentar(comando) {
  const segmentos = [];
  let actual = "";
  let comilla = null;
  for (let i = 0; i < comando.length; i++) {
    const c = comando[i];
    if (comilla) {
      actual += c;
      if (c === comilla && comando[i - 1] !== "\\") comilla = null;
      continue;
    }
    if (c === "'" || c === '"') {
      comilla = c;
      actual += c;
      continue;
    }
    const dos = comando.slice(i, i + 2);
    if (dos === "&&" || dos === "||") {
      segmentos.push(actual);
      actual = "";
      i++;
      continue;
    }
    if (c === ";" || c === "|" || c === "\n") {
      segmentos.push(actual);
      actual = "";
      continue;
    }
    actual += c;
  }
  segmentos.push(actual);
  return segmentos.map((s) => s.trim()).filter(Boolean);
}

/** Quita las asignaciones de entorno del principio: `FOO=bar cmd` -> `cmd`. */
function sinEnvPrefijo(segmento) {
  return segmento.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/, "");
}

function tokens(segmento) {
  return segmento.split(/\s+/).filter(Boolean);
}

function mencionaProtegida(args) {
  return args.some((a) => {
    const limpio = a.replace(/^origin\//, "").replace(/^refs\/heads\//, "");
    return PROTEGIDAS.includes(limpio);
  });
}

/**
 * @returns {string | null} el motivo del bloqueo, o null si el segmento pasa
 */
function revisarSegmento(segmento) {
  const limpio = sinEnvPrefijo(segmento);
  const t = tokens(limpio);
  if (t.length === 0) return null;

  const cmd = t[0].replace(/^.*\//, ""); // ruta absoluta -> nombre
  if (LECTORES.has(cmd)) return null;

  const args = t.slice(1);
  const resto = args.join(" ");

  if (cmd === "git") {
    const sub = args[0];
    if (GIT_LECTORES.has(sub)) return null;

    if (sub === "push") {
      if (/(^|\s)(--force|-f|--force-with-lease)(\s|$)/.test(` ${resto} `)) {
        return "un force push reescribe la historia de una rama compartida. No esta disponible: si de verdad hace falta, lo hace una persona.";
      }
      if (args.includes("--delete") || args.includes("-d")) {
        return "borrar una rama remota no es parte de cerrar una tarea.";
      }
      if (mencionaProtegida(args)) {
        return `empujar a una rama protegida (${PROTEGIDAS.join(", ")}) esta fuera del limite: noxloop termina en el PR abierto.`;
      }
      return null;
    }
    if (sub === "merge" && mencionaProtegida(args)) {
      return "mergear una rama protegida es una decision humana, y ocurre sobre el PR.";
    }
    if (sub === "branch" && (args.includes("-D") || args.includes("--delete")) && mencionaProtegida(args)) {
      return "borrar una rama protegida no es parte de ninguna tarea.";
    }
    return null;
  }

  if (cmd === "gh" || cmd === "glab") {
    if (args[0] === "pr" && args[1] === "merge") {
      return "mergear el PR es la decision humana con la que termina el recorrido. noxloop lo abre; no lo cierra.";
    }
    if (args[0] === "release" && ["create", "delete", "upload"].includes(args[1])) {
      return "publicar un release es una operacion hacia afuera y necesita una persona.";
    }
    return null;
  }

  if (cmd === "kubectl" && ["apply", "delete", "patch", "scale", "rollout", "replace", "drain"].includes(args[0])) {
    return `\`kubectl ${args[0]}\` cambia un entorno desplegado. El despliegue esta fuera del limite de autonomia.`;
  }
  if (cmd === "terraform" && ["apply", "destroy"].includes(args[0])) {
    return `\`terraform ${args[0]}\` cambia infraestructura real.`;
  }
  if (cmd === "helm" && ["install", "upgrade", "uninstall", "rollback"].includes(args[0])) {
    return `\`helm ${args[0]}\` cambia un entorno desplegado.`;
  }
  if (cmd === "docker" || cmd === "docker-compose") {
    if (args.includes("deploy") || (args[0] === "service" && args[1] === "update")) {
      return "desplegar un stack esta fuera del limite de autonomia.";
    }
    if (/(prod|production)/i.test(resto) && /\b(up|start|restart|deploy)\b/.test(resto)) {
      return "levantar un compose de produccion esta fuera del limite de autonomia.";
    }
    return null;
  }
  if ((cmd === "npm" || cmd === "pnpm" || cmd === "yarn") && args[0] === "publish") {
    return "publicar un paquete es una operacion hacia afuera y necesita una persona.";
  }
  if (cmd === "systemctl" && ["restart", "stop", "start", "reload"].includes(args[0])) {
    return `\`systemctl ${args[0]}\` toca un servicio real.`;
  }
  if (cmd === "pm2" && ["restart", "stop", "delete", "deploy", "reload"].includes(args[0])) {
    return `\`pm2 ${args[0]}\` toca un servicio real.`;
  }
  if (cmd === "ssh" && args.length >= 2) {
    // `ssh host comando` ejecuta en una maquina que no es esta. Lo que pase
    // alla es exactamente lo que este hook no puede vigilar.
    return "ejecutar un comando en una maquina remota por ssh esta fuera del limite: el hook no puede vigilar lo que pasa del otro lado.";
  }
  if (cmd === "rsync" && args.some((a) => /^[^:]+:[^:]/.test(a) && !a.startsWith("-"))) {
    return "sincronizar hacia una maquina remota es un despliegue.";
  }
  if (cmd === "dropdb" || (cmd === "psql" && /drop\s+(database|table)|truncate/i.test(resto))) {
    return "una operacion destructiva sobre una base de datos no se ejecuta sin una persona mirando.";
  }

  return null;
}

export function decide(input, opts = {}) {
  if (input?.tool_name !== "Bash") return ALLOW;
  const comando = input?.tool_input?.command;
  if (!comando || typeof comando !== "string") return ALLOW;

  // A diferencia de los otros dos hooks, este NO se desactiva sin tarea activa
  // cuando el motor lo instala como hook global — pero por defecto respeta el
  // mismo principio: si noxloop no esta corriendo, esta sesion es de una
  // persona y no le corresponde a este hook decidir.
  const activa = tareaActiva(opts);
  if (!activa && !opts.always) return ALLOW;

  for (const segmento of segmentar(comando)) {
    const motivo = revisarSegmento(segmento);
    if (motivo) return deny(`noxloop bloqueo \`${segmento.trim()}\`: ${motivo}`);
  }
  return ALLOW;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  responder(decide(leerEntrada(), { always: process.env.NOXLOOP_GUARD_ALWAYS === "1" }));
}
