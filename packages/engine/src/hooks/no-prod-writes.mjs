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
  "diff", "comm", "awk", "sed", "ls", "tree", "stat", "file",
  "pwd", "cd", "true", "false", "date", "man", "help",
]);

/**
 * Lo que la capa 2 permite sin que la tarea lo declare.
 *
 * Es DISTINTA de `LECTORES`, y la diferencia importa: `LECTORES` significa
 * "esto no ejecuta nada, la capa 1 puede saltearlo", y `git` no cumple eso —
 * meterlo ahi hace que la capa 1 deje pasar cualquier `git push`. Aca significa
 * "la tarea puede correr esto", que para git es cierto: necesita leer su propio
 * diff, y sus verbos peligrosos los sigue mirando la capa 1.
 */
const PERMITIDOS_BASE = new Set([...LECTORES, "git"]);

/**
 * Binarios que EJECUTAN otro comando. No son lectores aunque lo parezcan, y
 * tratarlos como tales fue el agujero mas barato de la version anterior: un
 * `env` de prefijo desarmaba la guarda entera, y se ejecuto contra un remoto
 * real moviendole la rama principal.
 *
 * Dentro de una tarea se rechazan siempre, sin mirar lo que traen detras:
 * mirar lo que traen detras es volver al parser que ya fallo.
 */
const PREFIJOS_EJECUTORES = new Set([
  "env", "sudo", "doas", "command", "builtin", "exec", "eval", "time", "nice",
  "nohup", "setsid", "stdbuf", "timeout", "watch", "xargs", "parallel",
  "bash", "sh", "zsh", "dash", "ksh", "fish", "script", "ssh", "su",
]);

/** Interpretes que pueden evaluar codigo pasado en la linea de comandos. */
const INTERPRETES = new Set([
  "node", "deno", "bun", "python", "python3", "ruby", "perl", "php", "osascript", "Rscript",
]);

/** Los flags con los que un interprete ejecuta codigo arbitrario. */
const FLAGS_EVAL = new Set(["-e", "--eval", "-c", "--command", "-p", "--print", "-E"]);

/**
 * Lo que el shell hace con las comillas y este parser no hacia: quitarlas.
 *
 * Sin esto, `git push origin "main"` no coincidia con la lista de ramas
 * protegidas, y `g"i"t push` no coincidia ni con el nombre del binario.
 */
function normalizar(token) {
  return token.replace(/["']/g, "");
}

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
  return segmento.split(/\s+/).filter(Boolean).map(normalizar);
}

/**
 * Opciones GLOBALES de git, las que van ANTES del subcomando. Las que piden un
 * valor aparte se listan para poder saltearlo tambien.
 */
const GIT_GLOBALES_CON_VALOR = new Set([
  "-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path",
  "--super-prefix", "--config-env",
]);

/**
 * Deja los argumentos con el SUBCOMANDO adelante.
 *
 * EL FALLO QUE ESTO EVITA, encontrado por el test de autonomia T035: el hook
 * leia el subcomando en `args[0]`, y `git -C /ruta push --force origin main`
 * pone `-C` ahi. No era `push` ni `merge`, asi que el segmento se permitia y el
 * limite entero se caia con un flag que no tiene nada de exotico — la propia
 * cola de integracion de este motor invoca a git con `-C` en cada llamada.
 */
function sinGlobalesDeGit(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith("-")) {
    const a = args[i];
    const nombre = a.includes("=") ? a.slice(0, a.indexOf("=")) : a;
    i++;
    // `-C /ruta` y `--git-dir /ruta` se comen el token siguiente; `-C/ruta` y
    // `--git-dir=/ruta` ya lo traen pegado.
    if (GIT_GLOBALES_CON_VALOR.has(nombre) && !a.includes("=") && a === nombre) i++;
  }
  return args.slice(i);
}

/**
 * El DESTINO de un argumento de push, mirando el refspec.
 *
 * EL FALLO QUE ESTO EVITA, del mismo test: `git push origin HEAD:main` no se
 * frenaba. El argumento es `HEAD:main`, no `main`, y la comparacion contra la
 * lista de protegidas no lo reconocia. Es la forma normal de empujar a una rama
 * en la que no estas parado, o sea exactamente la forma que importa.
 */
function destinoDeRefspec(a) {
  const sinMas = a.replace(/^\+/, "");
  const dst = sinMas.includes(":") ? sinMas.slice(sinMas.lastIndexOf(":") + 1) : sinMas;
  return dst.replace(/^origin\//, "").replace(/^refs\/heads\//, "");
}

function mencionaProtegida(args) {
  return args.some((a) => PROTEGIDAS.includes(destinoDeRefspec(a)));
}

/** `+HEAD:main` fuerza el push sin decir `--force`. Es lo mismo. */
function fuerzaPorRefspec(args) {
  return args.some((a) => a.startsWith("+") && a.includes(":"));
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
    // Los flags globales van antes del subcomando, y saltearlos es lo que hace
    // que `git -C /x push --force` se lea como el push que es.
    const propios = sinGlobalesDeGit(args);
    const sub = propios[0];
    const deSub = propios.slice(1);
    if (GIT_LECTORES.has(sub)) return null;

    if (sub === "push") {
      const flags = ` ${deSub.join(" ")} `;
      if (/(^|\s)(--force|-f|--force-with-lease)(\s|$)/.test(flags) || fuerzaPorRefspec(deSub)) {
        return "un force push reescribe la historia de una rama compartida. No esta disponible: si de verdad hace falta, lo hace una persona.";
      }
      if (deSub.includes("--delete") || deSub.includes("-d")) {
        return "borrar una rama remota no es parte de cerrar una tarea.";
      }
      if (deSub.includes("--mirror") || deSub.includes("--all")) {
        // Alcanzan a las ramas protegidas sin nombrarlas, asi que
        // `mencionaProtegida` no las ve.
        return "un push con --mirror o --all alcanza a las ramas protegidas sin nombrarlas.";
      }
      if (mencionaProtegida(deSub)) {
        return `empujar a una rama protegida (${PROTEGIDAS.join(", ")}) esta fuera del limite: noxloop termina en el PR abierto.`;
      }
      return null;
    }
    if (sub === "merge" && mencionaProtegida(deSub)) {
      return "mergear una rama protegida es una decision humana, y ocurre sobre el PR.";
    }
    if (sub === "update-ref" && mencionaProtegida(deSub)) {
      // Mueve una rama sin nombrar `merge` ni `push`. Estaba ausente del
      // inventario, que es el problema estructural de los inventarios.
      return "mover a mano la referencia de una rama protegida esta fuera del limite.";
    }
    if (sub === "config" && deSub.some((a) => a.startsWith("alias."))) {
      return "definir un alias de git crea un verbo que ninguna guarda conoce.";
    }
    if (sub === "branch" && (deSub.includes("-D") || deSub.includes("--delete")) && mencionaProtegida(deSub)) {
      return "borrar una rama protegida no es parte de ninguna tarea.";
    }
    return null;
  }

  if (cmd === "gh" || cmd === "glab") {
    // Los flags globales del CLI del forge corren el subcomando igual que los de
    // git: `gh --repo o/r pr merge 7`. Saltearlos solo para git dejaba este
    // caso abierto, que es el mismo fallo a medias.
    const sinFlags = args.filter((a) => !a.startsWith("-"));
    const conValor = args.filter((a, i) => a.startsWith("-") && !String(args[i + 1] || "").startsWith("-"));
    const limpios = sinFlags.filter((a) => !conValor.some((f, i) => args[args.indexOf(f) + 1] === a));
    if (limpios[0] === "pr" && limpios[1] === "merge") {
      return "mergear el PR es la decision humana con la que termina el recorrido. noxloop lo abre; no lo cierra.";
    }
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

/**
 * El primer token real de un segmento: sin asignaciones de entorno delante y sin
 * los flags globales del binario.
 */
function binarioDe(segmento) {
  const t = tokens(sinEnvPrefijo(segmento));
  if (t.length === 0) return { cmd: null, args: [] };
  const cmd = t[0].replace(/^.*\//, "");
  return { cmd, args: t.slice(1) };
}

export function decide(input, opts = {}) {
  if (input?.tool_name !== "Bash") return ALLOW;
  const comando = input?.tool_input?.command;
  if (!comando || typeof comando !== "string") return ALLOW;

  // Si noxloop no esta corriendo, esta sesion es de una persona y no le
  // corresponde a este hook decidir. Es el principio "ante la duda, permitir", y
  // la enmienda 1.1.0 de la constitucion lo acota justamente a este caso.
  const activa = tareaActiva(opts, input);
  if (!activa && !opts.always) return ALLOW;

  const permitidos = new Set([
    ...PERMITIDOS_BASE,
    ...(activa?.entry?.allowedCommands || []),
  ]);

  for (const segmento of segmentar(comando)) {
    // ---- capa 1: lo prohibido, siempre. Es la red, no el piso.
    const motivo = revisarSegmento(segmento);
    if (motivo) return deny(`noxloop bloqueo \`${segmento.trim()}\`: ${motivo}`);

    // ---- capa 2: DENEGAR POR DEFECTO, y solo dentro de una tarea.
    //
    // Es la inversion que exige la enmienda 1.1.0. Adentro de una tarea que el
    // motor lanzo no hay nadie del otro lado, asi que el argumento que sostiene
    // la permisividad no aplica — y una lista de prohibidos ya demostro caerse
    // con 45 de 57 grafias.
    if (!activa) continue;

    const { cmd, args } = binarioDe(segmento);
    if (!cmd) continue;

    if (PREFIJOS_EJECUTORES.has(cmd)) {
      return deny(
        `noxloop bloqueo \`${segmento.trim()}\`: \`${cmd}\` ejecuta otro comando, y lo que ejecuta ` +
          `no se puede vigilar desde aca. Corre el comando directo.`,
      );
    }

    if (INTERPRETES.has(cmd) && args.some((a) => FLAGS_EVAL.has(a))) {
      return deny(
        `noxloop bloqueo \`${segmento.trim()}\`: evaluar codigo en la linea de comandos puede hacer ` +
          `cualquier cosa, asi que ninguna guarda lo puede revisar. Poné el codigo en un archivo de la tarea.`,
      );
    }

    if (!permitidos.has(cmd)) {
      const declarados = activa.entry?.allowedCommands || [];
      return deny(
        `noxloop bloqueo \`${segmento.trim()}\`: dentro de una tarea el shell es denegar por defecto, y ` +
          `\`${cmd}\` no esta permitido.\n` +
          `Permitidos en esta tarea: ${[...(declarados.length ? declarados : ["(ninguno declarado)"])].join(", ")}, ` +
          `mas lectura (${[...PERMITIDOS_BASE].slice(0, 8).join(", ")}...).\n` +
          `Si la tarea lo necesita de verdad, va declarado en el \`gate\` o en los \`runners\` de su ` +
          `repositorio, en la configuracion — no como una excepcion de esta sesion.`,
      );
    }
  }

  return ALLOW;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  responder(decide(leerEntrada(), { always: process.env.NOXLOOP_GUARD_ALWAYS === "1" }));
}
