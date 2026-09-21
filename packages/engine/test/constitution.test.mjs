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

// El servicio de control nacio en la feature 002 y es codigo de servidor igual
// que el motor: le aplican los mismos principios. La guarda de genericidad
// tenia que crecer con el, porque un paquete nuevo que nadie mira es
// exactamente donde vuelve a entrar un nombre propio.
const SERVICIO = join(RAIZ, "packages/service");
const DEL_SERVICIO = () => [...fuentes(join(SERVICIO, "src")), ...fuentes(join(SERVICIO, "bin"))];

// La boveda. Se lista aparte del servicio porque las guardas que le aplican no
// son las mismas: aqui la de "ningun secreto por argv" no admite la excepcion
// del token de sesion, porque lo que pasa por este paquete SI son credenciales
// del operador.
const BOVEDA = join(RAIZ, "packages/vault");
const DE_LA_BOVEDA = () => fuentes(join(BOVEDA, "src"));

// El scanner. Entra en la guarda de genericidad porque es el paquete con mas
// tentacion de nombres propios de todo el repositorio: un detector que busca
// "el workflow de GitHub" o "el archivo de Linear" lo escribe cualquiera, y a
// partir de ahi el scanner solo entiende los proyectos que se parecen a los de
// quien lo escribio. El detector de puntos de extension del propio repo lo hace
// bien y sirve de ejemplo: encuentra los cuatro proveedores por la FORMA —un
// contrato arriba, implementaciones hermanas debajo— sin nombrar el directorio.
const SCANNER = join(RAIZ, "packages/scanner");
const DEL_SCANNER = () => fuentes(join(SCANNER, "src"));

// La interfaz. Sus fuentes son .ts y .tsx, asi que necesita su propio recorrido.
const STUDIO = join(RAIZ, "apps/studio");

function fuentesDeInterfaz(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e === "node_modules" || e === ".next" || e === "out") continue;
      fuentesDeInterfaz(p, acc);
    } else if (/\.(ts|tsx)$/.test(e)) {
      acc.push(p);
    }
  }
  return acc;
}

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
  //
  // `flex` va CAPITALIZADO o como host a proposito. Con /\bflex\b/i la guarda
  // atrapaba `display: flex` del CSS del board: un falso positivo que empuja a
  // no escribir CSS en el motor, que no es lo que el principio VII protege. El
  // nombre propio aparece como nombre (`el panel Flex`) o como host
  // (`flex.staging...`), y las dos formas siguen cubiertas.
  const PROHIBIDOS = [
    /partequipos/i, /\bFlex\b/, /\bflex\.[a-z]/i, /\bflex-(?:db|api|web)\b/i,
    /azure[- ]?devops/i, /\bado_/i,
    /\.com\b/, /vstfs/i, /dev\.azure/i, /linear\.app/i, /api\.github/i,
  ];
  const hallazgos = [];
  for (const f of [...DEL_MOTOR(), ...DEL_SERVICIO(), ...DE_LA_BOVEDA(), ...DEL_SCANNER()]) {
    const texto = readFileSync(f, "utf8");
    for (const re of PROHIBIDOS) {
      const m = texto.match(re);
      if (m) hallazgos.push(`${f.replace(RAIZ, "")}: ${m[0]}`);
    }
  }
  assert.deepEqual(hallazgos, [], `el motor adquirio nombres propios:\n${hallazgos.join("\n")}`);
});

// ---------------------------------------------------------------------------
// Principios VIII, IX y X — entraron en la v1.2.0 con la feature 002.
//
// Los tres gobiernan codigo que todavia se esta escribiendo, y por eso las
// guardas van ANTES que la mayor parte de ese codigo: una guarda que llega
// despues encuentra el repositorio ya acomodado a la violacion, y entonces
// arreglarla cuesta una refactorizacion en vez de un rechazo en CI.
// ---------------------------------------------------------------------------

test("VII — el puerto de desarrollo esta declarado igual en los tres lugares que lo usan", () => {
  // El puerto de `next dev` aparece en TRES sitios que tienen que coincidir, y
  // ninguno puede deducir el valor de los otros:
  //
  //   1. el script `dev` de la interfaz, que es quien abre el puerto
  //   2. `devUrl` de Tauri, que es quien carga esa URL en el webview
  //   3. la allowlist de origenes del servicio, que decide si esa URL puede
  //      hablarle
  //
  // Si se separan, el sintoma no dice lo que pasa: la ventana abre en blanco
  // (Tauri pidiendo un puerto donde no hay nadie) o la interfaz carga y todas
  // sus peticiones se rechazan por origen. Ninguno de los dos mensajes
  // menciona un puerto.
  //
  // El valor es 3100 y no el 3000 por defecto de Next porque en la maquina
  // donde se monto esto Docker tenia 3000 tomado de forma permanente, y
  // `tauri dev` moria con EADDRINUSE antes de abrir la ventana.
  const leer = (ruta) => readFileSync(join(RAIZ, ruta), "utf8");

  const enScript = leer("apps/studio/package.json").match(/next dev -p \$\{NOXLOOP_PUERTO_DEV:-(\d+)\}/);
  const enConfig = leer("apps/studio/next.config.ts").match(/NOXLOOP_PUERTO_DEV \|\| ["'](\d+)["']/);
  const enTauri = leer("apps/desktop/src-tauri/tauri.conf.json").match(/"devUrl"\s*:\s*"http:\/\/localhost:(\d+)"/);
  const enServicio = leer("packages/service/src/puerta.mjs").match(/"http:\/\/localhost:(\d+)"/);

  const declarados = {
    "script dev de la interfaz": enScript?.[1],
    "next.config.ts": enConfig?.[1],
    "devUrl de Tauri": enTauri?.[1],
    "allowlist del servicio": enServicio?.[1],
  };

  const sinDeclarar = Object.entries(declarados).filter(([, v]) => !v).map(([k]) => k);
  assert.deepEqual(sinDeclarar, [], `no se pudo leer el puerto en: ${sinDeclarar.join(", ")} — cambio la forma de declararlo y esta guarda dejo de mirar donde tiene que mirar`);

  const distintos = new Set(Object.values(declarados));
  assert.equal(
    distintos.size,
    1,
    `el puerto de desarrollo diverge: ${JSON.stringify(declarados)}`,
  );
});

test("VIII — la interfaz no tiene superficie de servidor", () => {
  // `output: 'export'` no tiene servidor: ni rutas de API, ni acciones de
  // servidor, ni middleware. Que el build lo haga IMPOSIBLE es justamente lo
  // que convierte el principio VIII en un mecanismo y no en un recordatorio.
  //
  // Esta guarda existe porque la restriccion se puede perder sin que nadie lo
  // note: basta que alguien saque `output: 'export'` de la configuracion para
  // que Next vuelva a aceptar todo eso y la interfaz pueda escribir estado por
  // su cuenta. El dia que pase, el fallo tiene que leerse aca.
  const config = readFileSync(join(STUDIO, "next.config.ts"), "utf8");
  assert.match(
    config,
    /output\s*:\s*["']export["']/,
    "apps/studio perdio `output: 'export'`: la interfaz recupero un servidor y con el la posibilidad de escribir estado",
  );

  const PROHIBIDO = [
    [/^\s*["']use server["']/m, "una accion de servidor"],
    [/from\s+["']node:fs["']/, "acceso al sistema de archivos"],
    [/from\s+["']fs["']/, "acceso al sistema de archivos"],
    [/from\s+["']node:child_process["']/, "lanzamiento de subprocesos"],
  ];
  const hallazgos = [];
  for (const f of fuentesDeInterfaz(STUDIO)) {
    const base = f.split("/").pop();
    // Los nombres de archivo que Next reserva para superficie de servidor.
    if (base === "route.ts" || base === "middleware.ts") {
      hallazgos.push(`${f.replace(RAIZ, "")}: un archivo de ruta de servidor`);
    }
    const texto = readFileSync(f, "utf8");
    for (const [re, que] of PROHIBIDO) {
      if (re.test(texto)) hallazgos.push(`${f.replace(RAIZ, "")}: ${que}`);
    }
  }
  assert.deepEqual(hallazgos, [], `la interfaz dejo de ser solo lectora:\n${hallazgos.join("\n")}`);
});

test("VIII — la interfaz habla con el servicio, no con el estado en disco", () => {
  // El fallo concreto: alguien resuelve "es mas rapido leer el archivo
  // directamente" y la interfaz se convierte en el segundo lector privilegiado
  // del estado. Funciona, y despues alguien escribe. El board de v1 no escribe
  // porque hay un test que lo mide; esta es la version de esa medida para una
  // superficie que todavia no existe del todo.
  const hallazgos = [];
  for (const f of fuentesDeInterfaz(STUDIO)) {
    const texto = codigo(f);
    if (/NOXLOOP_HOME/.test(texto)) hallazgos.push(`${f.replace(RAIZ, "")}: alcanza el home del estado`);
  }
  assert.deepEqual(hallazgos, [], `la interfaz alcanzo el estado sin pasar por el servicio:\n${hallazgos.join("\n")}`);
});

test("VIII — el servicio escucha en la interfaz de loopback, nunca en todas", () => {
  // Un servicio local que bindea 0.0.0.0 deja de ser local: queda expuesto a
  // cualquiera en la red, con el inventario de credenciales detras. El token de
  // sesion acota el dano pero no lo evita, y la superficie no deberia existir.
  const hallazgos = [];
  for (const f of DEL_SERVICIO()) {
    const texto = codigo(f);
    if (/0\.0\.0\.0/.test(texto)) hallazgos.push(f.replace(RAIZ, ""));
  }
  assert.deepEqual(hallazgos, [], `el servicio se expuso fuera de la maquina:\n${hallazgos.join("\n")}`);
});

test("IX — ningun secreto llega a un subproceso por la linea de comandos", () => {
  // `ps` muestra los argumentos de cualquier proceso a cualquier proceso de la
  // maquina. Una credencial pasada como argumento es una credencial publica
  // para el resto del sistema, y el grant que la autorizo deja de significar
  // nada. El unico camino es el entorno del subproceso.
  const SOSPECHOSOS = [
    /--token[=\s]["'`]?\$\{?\s*(?:token|secret|credential|apiKey)/i,
    /--(?:secret|password|api-key|apikey)[=\s]/i,
  ];
  const hallazgos = [];
  for (const f of [...DEL_MOTOR(), ...DEL_SERVICIO(), ...DE_LA_BOVEDA()]) {
    // El token de SESION del servicio no es una credencial del operador: lo
    // genera la cascara de escritorio al arrancar, vive lo que vive la ventana
    // y no da acceso a nada fuera de esta maquina. Va por argumento porque el
    // sidecar tiene que recibirlo antes de escuchar en ningun puerto.
    //
    // La excepcion es SOLO del servicio. La boveda queda cubierta entera,
    // porque lo que pasa por ella si son credenciales del operador: ahi no hay
    // ningun valor que se pueda justificar en `argv`.
    if (f.includes("/service/")) continue;
    const texto = codigo(f);
    for (const re of SOSPECHOSOS) {
      const m = texto.match(re);
      if (m) hallazgos.push(`${f.replace(RAIZ, "")}: ${m[0]}`);
    }
  }
  assert.deepEqual(hallazgos, [], `un secreto viaja por argv:\n${hallazgos.join("\n")}`);
});

// NO hay aqui una guarda de "la boveda no llega al webview", y es deliberado.
//
// Se escribio una, y era PEOR que la que ya existe: miraba si un archivo
// mencionaba el llavero y tenia algun `#[tauri::command]`, asi que marcaba
// `lib.rs` —que declara `pub mod llavero;` y expone `daemon_info`, que no toca
// secretos— como violacion. Un falso positivo en una guarda entrena a ignorar
// la guarda, que es el mismo fallo que §12 de la definicion de producto mide
// como "precision del revisor": el ruido es peor que no tener revisor.
//
// El invariante SI esta protegido, en `apps/desktop/src-tauri/src/lib.rs`,
// prueba `ningun_comando_de_boveda_llega_al_webview`: comprueba que
// `llavero.rs` no tiene ningun `#[tauri::command]` y que la lista de
// `generate_handler!` no crecio. Esta en Rust porque ahi puede mirar la lista
// de verdad en vez de adivinarla con una expresion regular.
//
// Lo que faltaba no era una guarda: era que `cargo test` corriera en CI.
// Se anadio alli.

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
