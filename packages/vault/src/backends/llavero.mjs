// El llavero del sistema operativo (T130), por el comando de Rust.
//
// POR QUE UN COMANDO DE RUST Y NO UN PLUGIN. `tauri-plugin-stronghold` NO usa el
// llavero del sistema: guarda un fichero cifrado con una contrasena que la
// aplicacion tiene que suministrar, y esa contrasena habria que guardarla en el
// llavero. No aporta la pieza. No hay plugin oficial de llavero para Tauri, y la
// via verificada es el crate `keyring` —Keychain en macOS, Credential Manager en
// Windows, Secret Service en Linux— desde codigo Rust nuestro
// (`apps/desktop/src-tauri/src/llavero.rs`).
//
// EL EFECTO LATERAL QUE MEJORA EL DISENO. Ese comando NO se expone al webview.
// La interfaz no puede pedir un valor porque no existe la ruta para pedirlo:
// no hay `#[tauri::command]` que lo devuelva, y por tanto no hay `invoke` que lo
// alcance. La interfaz solo ve huellas. Quien habla con el llavero es este
// modulo, que corre en el servicio.
//
// POR QUE EL VALOR VA POR LA ENTRADA ESTANDAR. `ps ax -o command` muestra los
// argumentos de cualquier proceso a cualquier proceso del mismo usuario —
// comprobado en este repositorio con el token de sesion del servicio. Un
// `llavero guardar <valor>` publica la credencial durante toda la vida del
// proceso hijo. Por la referencia opaca no pasa nada: para eso es opaca.

import { spawn } from "node:child_process";

import { fallar } from "../errores.mjs";

/**
 * @param {{ ejecutable: string, argumentosPrevios?: string[], servicio?: string, motivo: string }} config
 */
export function crearBackendDeLlavero({ ejecutable, argumentosPrevios = [], servicio = "noxloop", motivo }) {
  /**
   * @param {string[]} orden
   * @param {string} [entrada] el valor, cuando lo hay; nunca un argumento
   * @returns {Promise<string>}
   */
  function invocar(orden, entrada) {
    return new Promise((resolver, rechazar) => {
      const hijo = spawn(ejecutable, [...argumentosPrevios, ...orden, "--servicio", servicio], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let salida = "";
      let error = "";
      hijo.stdout.on("data", (t) => {
        salida += t;
      });
      hijo.stderr.on("data", (t) => {
        error += t;
      });
      hijo.on("error", (e) =>
        rechazar(
          construirError(
            "llavero_no_disponible",
            `no se pudo ejecutar el comando del llavero (${ejecutable}): ${e.message}`,
            "comproba que la aplicacion de escritorio esta instalada; en un servidor sin sesion grafica usa el respaldo cifrado",
          ),
        ),
      );
      hijo.on("close", (codigo) => {
        if (codigo === 0) return resolver(salida);
        rechazar(
          construirError(
            "llavero_fallo",
            `el comando del llavero termino con codigo ${codigo}: ${error.trim() || "sin diagnostico"}`,
            "desbloquea el llavero del sistema y volve a intentarlo; si el equipo no tiene llavero, arranca con el respaldo cifrado",
          ),
        );
      });
      if (entrada !== undefined) hijo.stdin.end(entrada);
      else hijo.stdin.end();
    });
  }

  return {
    tipo: "keychain_so",
    motivo,
    evidencia: ejecutable,

    /** Sondeo para `elegirBackend`: dice si hay llavero, no si hay credenciales. */
    async disponible() {
      try {
        const salida = await invocar(["disponible"]);
        return { disponible: JSON.parse(salida).disponible === true, evidencia: ejecutable };
      } catch (e) {
        return { disponible: false, causa: e.causa ?? String(e) };
      }
    },

    async guardar(ref, valor) {
      await invocar(["guardar", "--ref", ref], valor);
    },

    async recuperar(ref) {
      return await invocar(["recuperar", "--ref", ref]);
    },

    async existe(ref) {
      return JSON.parse(await invocar(["existe", "--ref", ref])).existe === true;
    },

    async borrar(ref) {
      await invocar(["borrar", "--ref", ref]);
    },
  };
}

/** `fallar` lanza; aqui hace falta el objeto para rechazar la promesa. */
function construirError(codigo, causa, accion) {
  try {
    fallar(codigo, causa, accion);
  } catch (e) {
    return e;
  }
}
