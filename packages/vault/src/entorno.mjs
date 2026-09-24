// El entorno del subproceso se construye; no se hereda (T142/T143).
//
// EL FALLO QUE EVITA. `{ ...elEntornoDelServicio, TOKEN: valor }` es la linea que
// cualquiera escribe sin pensarla, y con ella el subproceso del runner recibe
// TODO lo que hubiera ahi: las credenciales que otra tarea inyecto, las
// variables de la maquina de CI, el socket del agente SSH del operador. El grant
// autorizo una credencial y el subproceso recibio quince. Ninguna prueba de
// permisos lo detecta, porque desde el punto de vista del grant todo esta bien.
//
// POR QUE ESTE MODULO NO PUEDE NOMBRAR EL ENTORNO DEL PROCESO. Hay una prueba
// que lee este archivo y falla si aparece. Una guarda sobre el codigo y no sobre
// el comportamiento, porque el caso que hay que atrapar es el que ninguna prueba
// existente ejercita: alguien agrega una rama "heredar" para un caso puntual.
//
// Y NADA POR LA LINEA DE COMANDOS. `ps ax -o command` muestra los argumentos de
// cualquier proceso a cualquier proceso del mismo usuario. Un secreto en argv es
// un secreto publico para el resto de la maquina, y el grant que lo autorizo
// deja de significar nada.

import { spawn } from "node:child_process";

import { fallar } from "./errores.mjs";

const NOMBRE_VALIDO = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * @param {{ variables?: Record<string, string>, secretos?: Record<string, string> }} declarado
 */
export function construirEntorno({ variables = {}, secretos = {} } = {}) {
  for (const [donde, tabla] of [["variables", variables], ["secretos", secretos]]) {
    for (const [nombre, valor] of Object.entries(tabla)) {
      if (!NOMBRE_VALIDO.test(nombre)) {
        fallar(
          "variable_invalida",
          `'${nombre}' no es un nombre de variable de entorno valido (en ${donde})`,
          "usa letras, digitos y guion bajo, empezando por letra o guion bajo",
        );
      }
      if (typeof valor !== "string") {
        fallar(
          "variable_invalida",
          `la variable ${nombre} no es texto (en ${donde})`,
          "convierte el valor a texto antes de declararlo: el entorno de un proceso solo tiene texto",
        );
      }
    }
  }
  const duplicadas = Object.keys(secretos).filter((n) => Object.hasOwn(variables, n));
  if (duplicadas.length > 0) {
    fallar(
      "variable_duplicada",
      `${duplicadas.join(", ")} esta declarada a la vez como variable y como secreto`,
      "declarala en un solo sitio: si es secreta, sacala de las variables publicas",
    );
  }

  // Los valores viven en el cierre, no en un campo del objeto: asi no hay
  // `JSON.stringify` de la estructura de lanzamiento que los arrastre a un log.
  const publicas = { ...variables };
  const privadas = { ...secretos };

  return {
    /** Los nombres si se pueden decir: son los que hay que leer en un diagnostico. */
    nombres: [...Object.keys(publicas), ...Object.keys(privadas)].sort(),
    nombresSecretos: Object.keys(privadas).sort(),

    /** Exactamente lo declarado. Nada mas. */
    paraSpawn() {
      return { ...publicas, ...privadas };
    },

    /**
     * @param {string[]} textos
     * @returns {string|null} el NOMBRE de la variable encontrada; nunca el valor
     */
    buscarSecretoEn(textos) {
      for (const [nombre, valor] of Object.entries(privadas)) {
        if (textos.some((t) => typeof t === "string" && t.includes(valor))) return nombre;
      }
      return null;
    },
  };
}

/**
 * Arma el lanzamiento y se niega si un valor se colo en los argumentos.
 *
 * La comprobacion no es cosmetica: un comando armado con plantillas
 * (`--header "Authorization: Bearer ${token}"`) mete el secreto en argv sin que
 * nadie lo haya decidido, y quien lo escribio no tenia forma de verlo.
 *
 * @param {{ comando: string, args?: string[], entorno: any, cwd?: string }} plan
 */
export function prepararLanzamiento({ comando, args = [], entorno, cwd }) {
  const colado = entorno.buscarSecretoEn([comando, ...args]);
  if (colado) {
    fallar(
      "secreto_en_argv",
      `el valor de ${colado} aparece en los argumentos del proceso que se iba a lanzar`,
      `pasalo por el entorno: el subproceso ya recibe ${colado}, y los argumentos los ve cualquier proceso de la maquina`,
    );
  }
  return { comando, args: [...args], env: entorno.paraSpawn(), cwd };
}

/**
 * @param {{ comando: string, args?: string[], entorno: any, cwd?: string }} plan
 * @returns {Promise<{ code: number|null, stdout: string, stderr: string }>}
 */
export async function lanzar(plan) {
  // `async` a proposito: `prepararLanzamiento` lanza de forma sincrona, y un
  // llamante que hace `lanzar(...).catch(...)` se quedaria sin capturar el
  // rechazo mas importante de los dos, el del secreto en argv.
  const preparado = prepararLanzamiento(plan);
  return await new Promise((resolver, rechazar) => {
    const hijo = spawn(preparado.comando, preparado.args, {
      env: preparado.env,
      cwd: preparado.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    hijo.stdout.on("data", (t) => {
      stdout += t;
    });
    hijo.stderr.on("data", (t) => {
      stderr += t;
    });
    hijo.on("error", rechazar);
    hijo.on("close", (code) => resolver({ code, stdout, stderr }));
  });
}
