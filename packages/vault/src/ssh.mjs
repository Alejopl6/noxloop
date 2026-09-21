// SSH (T145): el agujero por el que se escapa toda la gobernanza.
//
// POR QUE SSH TIENE SU PROPIO MODULO. Dentro de una sesion SSH no corre ningun
// hook local y la lista de comandos permitidos del shell local deja de aplicar
// (FR-048): la gobernanza entera se queda de este lado del tunel. Un `ssh host`
// interactivo con un shell al otro lado es, en la practica, permiso total sobre
// la maquina remota otorgado por una tarea que pidio "ver los logs".
//
// POR QUE LA ALLOWLIST ES LA SEGUNDA CAPA Y NO LA PRIMERA. La constitution de
// este repositorio lo midio: con una lista de comandos PROHIBIDOS, 45 de 57
// grafias la sortearon — un prefijo (`env`, `bash -c`, `sudo`), una comilla, un
// interprete (`node -e`). Alargar la lista produce el verde inventado: una lista
// mas larga que sigue cayendo con la grafia siguiente. Aqui la primera capa es
// que el comando este DECLARADO por la tarea, y la comparacion es estructural —
// el comando es un vector de argumentos, no una linea de texto — porque contra
// un vector no hay grafia: `["bash","-c","git status"]` no es `["git","status"]`
// mire quien lo mire.

import { fallar } from "./errores.mjs";

/**
 * Lo permitido por defecto: leer y diagnosticar. Cada entrada es el PREFIJO del
 * comando, como vector. `["git","status"]` permite `git status --short` y no
 * permite `git push`, que es la distincion que un `"git"` suelto se come.
 */
export const ALLOWLIST_DE_LECTURA = Object.freeze([
  ["ls"], ["cat"], ["head"], ["tail"], ["stat"], ["find"], ["grep"],
  ["df"], ["du"], ["free"], ["uptime"], ["uname"], ["hostname"], ["id"], ["whoami"],
  ["ps"], ["journalctl"],
  ["git", "status"], ["git", "log"], ["git", "diff"], ["git", "show"], ["git", "rev-parse"],
].map((c) => Object.freeze(c)));

/**
 * Las opciones que no se negocian por sesion.
 *
 * - `StrictHostKeyChecking=yes`: un host desconocido es un bloqueo, nunca una
 *   aceptacion silenciosa. `accept-new` parece razonable y es exactamente la
 *   puerta por la que entra un intermediario la primera vez.
 * - `ForwardAgent=no`: reenviar el agente entrega las llaves del operador al
 *   host remoto. Si ese host esta comprometido, lo siguiente que se compromete
 *   es todo lo demas a lo que el operador tiene acceso.
 * - `BatchMode=yes`: sin esto, un host que pide contrasena deja la tarea colgada
 *   para siempre, porque no hay nadie del otro lado que la escriba.
 * - `IdentitiesOnly=yes`: usar solo la llave declarada, no todas las del agente.
 * - `ClearAllForwardings=yes` y `PermitLocalCommand=no`: cierran los tuneles y la
 *   ejecucion local que un archivo de configuracion del usuario podria abrir.
 */
const OPCIONES_FIJAS = Object.freeze([
  "StrictHostKeyChecking=yes",
  "ForwardAgent=no",
  "ForwardX11=no",
  "BatchMode=yes",
  "IdentitiesOnly=yes",
  "ClearAllForwardings=yes",
  "PermitLocalCommand=no",
  "RequestTTY=no",
]);

const FORMA_DE_HUELLA = /^SHA256:[A-Za-z0-9+/]{43}=?$/;

/** @param {readonly string[]} prefijo @param {readonly string[]} comando */
function esPrefijo(prefijo, comando) {
  return prefijo.length <= comando.length && prefijo.every((p, i) => p === comando[i]);
}

/**
 * @param {{
 *   host: string, usuario: string, huellaDeHost?: string, archivoDeHostsConocidos: string,
 *   comandosDeclarados?: string[][], allowlist?: readonly (readonly string[])[], ejecutar: Function
 * }} config
 */
export function crearSesionSsh({
  host,
  usuario,
  huellaDeHost,
  archivoDeHostsConocidos,
  comandosDeclarados = [],
  allowlist = ALLOWLIST_DE_LECTURA,
  ejecutar,
}) {
  if (!huellaDeHost || !FORMA_DE_HUELLA.test(huellaDeHost)) {
    fallar(
      "host_sin_huella",
      `el host ${host} no tiene una huella SHA256 fijada, o la que tiene no tiene la forma de una huella`,
      "registra la huella del host al darlo de alta (`ssh-keyscan` y confirmacion humana) antes de usarlo",
    );
  }

  /** @type {any[]} */
  const bitacora = [];
  /** @type {{ comando: string[], autorizacion: any }[]} */
  const autorizadas = [];

  function anotar(entrada) {
    bitacora.push({ ts: new Date().toISOString(), host, usuario, ...entrada });
  }

  function rechazar(codigo, comando, causa, accion) {
    // La bitacora se escribe tambien cuando se rechaza: un comando que alguien
    // intento es parte de lo que hay que poder explicar despues.
    anotar({ comando, resultado: "rechazado", codigo, causa });
    fallar(codigo, causa, accion);
  }

  const sesion = {
    /** La huella fijada, para que quien construya el archivo de hosts conocidos la use. */
    huellaDeHost,

    /** @param {string[]} comando */
    argumentosDe(comando) {
      const opciones = [...OPCIONES_FIJAS, `UserKnownHostsFile=${archivoDeHostsConocidos}`].flatMap((o) => ["-o", o]);
      return [...opciones, `${usuario}@${host}`, "--", ...comando];
    },

    /**
     * Autorizacion explicita, por sesion y no permanente (FR-048): escribir o
     * desplegar sale de la bandeja, y se agota con la sesion.
     *
     * @param {string[]} comando
     * @param {{ por: string, solicitud: string }} autorizacion
     */
    autorizar(comando, autorizacion) {
      autorizadas.push({ comando: [...comando], autorizacion });
    },

    /** @param {string[]} comando */
    async ejecutar(comando) {
      if (!Array.isArray(comando) || comando.length === 0 || comando.some((a) => typeof a !== "string")) {
        anotar({ comando, resultado: "rechazado", codigo: "comando_no_es_lista" });
        fallar(
          "comando_no_es_lista",
          "el comando remoto llego como texto y no como vector de argumentos",
          "pasa el comando como lista (`['git','status']`): una linea de texto la interpreta un shell remoto y ahi la allowlist no significa nada",
        );
      }

      // Primera capa: lo que la tarea declaro necesitar.
      if (!comandosDeclarados.some((d) => esPrefijo(d, comando))) {
        rechazar(
          "comando_no_declarado",
          comando,
          `la tarea no declaro necesitar '${comando[0]}' en el host ${host}`,
          "declara el comando en la tarea y volve a intentarlo; lo que no se declara no sale por el tunel",
        );
      }

      // Segunda capa: de lo declarado, lo que es de lectura, o lo que alguien
      // autorizo a mano para esta sesion.
      const autorizacion = autorizadas.find((a) => esPrefijo(a.comando, comando))?.autorizacion;
      if (!autorizacion && !allowlist.some((p) => esPrefijo(p, comando))) {
        rechazar(
          "comando_no_permitido",
          comando,
          `'${comando.join(" ")}' no es de lectura ni de diagnostico y nadie lo autorizo para esta sesion`,
          "pedi la autorizacion por la bandeja: se concede por sesion, no de forma permanente",
        );
      }

      // La linea se escribe ANTES de salir a la red: si el proceso muere a mitad
      // del comando, lo que queda tiene que decir que se intento, no callarlo.
      anotar({ comando: [...comando], resultado: "ejecutado", autorizacion });
      try {
        return await ejecutar("ssh", sesion.argumentosDe(comando));
      } catch (e) {
        anotar({ comando: [...comando], resultado: "error", causa: String(e?.message ?? e) });
        throw e;
      }
    },

    /** Copias congeladas: la bitacora no se edita desde fuera. */
    bitacora() {
      return bitacora.map((e) => Object.freeze(JSON.parse(JSON.stringify(e))));
    },
  };

  return sesion;
}
