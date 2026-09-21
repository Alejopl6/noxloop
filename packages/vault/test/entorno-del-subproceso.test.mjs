// T142/T143 — el entorno se construye; no se hereda. Y nada va por argv.
//
// EL FALLO QUE EVITA. `{ ...process.env, TOKEN: valor }` es la linea que
// cualquiera escribe sin pensarla, y con ella el subproceso del runner recibe
// TODO lo que haya en el entorno del servicio: las credenciales de otros
// proyectos que otra tarea inyecto, las variables de CI, el `SSH_AUTH_SOCK` del
// operador. El grant autorizo una credencial y el subproceso recibio quince.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { construirEntorno, prepararLanzamiento, lanzar } from "../src/entorno.mjs";
import { centinela, trozoDelCentinela } from "./ayuda.mjs";

/** Variables que el sistema operativo agrega al hijo por su cuenta. Ver la prueba de abajo. */
const INYECTADAS_POR_LA_PLATAFORMA = ["__CF_USER_TEXT_ENCODING"];

const IMPRIME_ENTORNO = "console.log(JSON.stringify({ env: process.env, argv: process.argv.slice(1) }))";

test("EL INVARIANTE: el entorno del subproceso tiene exactamente lo declarado, ni una variable de mas", async () => {
  const delServicio = centinela("heredado");
  const autorizado = centinela("autorizado");
  process.env.NOXLOOP_PRUEBA_HEREDADA = delServicio;
  try {
    const entorno = construirEntorno({
      variables: { PATH: process.env.PATH ?? "", NOXLOOP_TAREA: "t1" },
      secretos: { TOKEN_DEL_GESTOR: autorizado },
    });

    const salida = await lanzar({ comando: process.execPath, args: ["-e", IMPRIME_ENTORNO], entorno });
    const visto = JSON.parse(salida.stdout);

    // `__CF_USER_TEXT_ENCODING` no lo pone esta boveda: lo inyecta libuv en
    // macOS cuando se le pasa un entorno explicito, para que CoreFoundation no
    // se caiga en el hijo. Medido en esta maquina: con `env` construido a mano,
    // el hijo lo recibe igual. Se declara como excepcion de plataforma en vez de
    // relajar la comparacion a "contiene lo declarado", que es lo que haria que
    // esta prueba dejara de ver una variable heredada de verdad.
    const recibidas = Object.keys(visto.env).filter((n) => !INYECTADAS_POR_LA_PLATAFORMA.includes(n));
    assert.deepEqual(
      recibidas.sort(),
      ["NOXLOOP_TAREA", "PATH", "TOKEN_DEL_GESTOR"],
      `el subproceso recibio variables que nadie declaro: ${Object.keys(visto.env).join(", ")}`,
    );
    assert.equal(visto.env.TOKEN_DEL_GESTOR, autorizado);
    assert.equal(
      trozoDelCentinela(JSON.stringify(visto.env), delServicio),
      null,
      "el entorno del servicio se filtro al subproceso",
    );
  } finally {
    delete process.env.NOXLOOP_PRUEBA_HEREDADA;
  }
});

test("EL INVARIANTE: ningun valor aparece en los argumentos del proceso lanzado", async () => {
  const valor = centinela("argv");
  const entorno = construirEntorno({ variables: {}, secretos: { TOKEN: valor } });

  // Por construccion: lo preparado no tiene el valor en ningun argumento.
  const preparado = prepararLanzamiento({ comando: "git", args: ["clone", "https://host/repo.git"], entorno });
  assert.equal(trozoDelCentinela(JSON.stringify(preparado.args), valor), null);
  assert.equal(trozoDelCentinela(preparado.comando, valor), null);

  // Y comprobado: lo que el hijo ve en su propia `argv`.
  const salida = await lanzar({ comando: process.execPath, args: ["-e", IMPRIME_ENTORNO, "bandera"], entorno });
  assert.equal(trozoDelCentinela(JSON.parse(salida.stdout).argv.join(" "), valor), null);
});

test("un valor de la boveda colado en los argumentos detiene el lanzamiento", async () => {
  // La comprobacion no es cosmetica: un comando que se arma con plantillas
  // (`--header "Authorization: Bearer ${token}"`) mete el secreto en argv sin
  // que nadie lo haya decidido. Aqui el lanzamiento se niega y dice donde.
  const valor = centinela("colado");
  const entorno = construirEntorno({ variables: {}, secretos: { TOKEN: valor } });

  assert.throws(
    () => prepararLanzamiento({ comando: "curl", args: ["-H", `Authorization: Bearer ${valor}`], entorno }),
    (e) => {
      assert.equal(e.codigo, "secreto_en_argv");
      assert.match(e.causa, /TOKEN/, "el error nombra la variable, no el valor");
      assert.equal(trozoDelCentinela(`${e.message} ${e.causa} ${e.accion}`, valor), null);
      return true;
    },
  );
  await assert.rejects(
    () => lanzar({ comando: process.execPath, args: ["-e", "0", valor], entorno }),
    (e) => e.codigo === "secreto_en_argv",
  );
});

test("una variable declarada que no es texto, o un nombre invalido, se rechaza", () => {
  assert.throws(
    () => construirEntorno({ variables: { BUENA: /** @type {any} */ (7) }, secretos: {} }),
    (e) => e.codigo === "variable_invalida",
  );
  assert.throws(
    () => construirEntorno({ variables: { "no-es-un-nombre": "x" }, secretos: {} }),
    (e) => e.codigo === "variable_invalida",
  );
  // Declarar la misma variable como publica y como secreta es ambiguo: cual gana
  // decide si el secreto acaba en el log de la variable publica.
  assert.throws(
    () => construirEntorno({ variables: { TOKEN: "publico" }, secretos: { TOKEN: "secreto" } }),
    (e) => e.codigo === "variable_duplicada",
  );
});

test("el modulo del entorno no menciona `process.env`: heredarlo no es una opcion que exista", () => {
  // Una guarda sobre el codigo, no sobre el comportamiento. El caso que atrapa
  // es el que la prueba de arriba no puede atrapar: alguien agrega una rama
  // `heredar: true` que las pruebas existentes no ejercitan.
  const fuente = readFileSync(new URL("../src/entorno.mjs", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.equal(/process\.env/.test(fuente), false, "el constructor del entorno alcanzo el entorno del servicio");
});
