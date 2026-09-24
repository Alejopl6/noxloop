#!/usr/bin/env node
// Deja el sidecar listo antes de que Tauri empaquete o arranque.
//
// El sidecar de noxloop **es el ejecutable de Node**. El servicio viaja aparte,
// como codigo `.mjs` en `bundle.resources`. La decision esta en `research.md`
// §1 y no es de gusto: Node SEA declara `macOS x64 "not currently supported"`,
// lo que bloquea cualquier publicacion de build Intel, y `vercel/pkg` esta
// archivado por sus autores. Asumir que hay un Node instalado tampoco sirve: la
// version es impredecible y el PATH bajo Finder no es el del terminal, asi que
// la aplicacion fallaria solo en las maquinas de los demas.
//
// Este script corre en `build.beforeBundleCommand` y al principio de
// `build.beforeDevCommand`, para que ni un `tauri build` ni un `tauri dev`
// puedan empaquetar un sidecar viejo o no encontrarlo. Se asume que el cwd es
// `apps/desktop` (asi lo invoca la CLI de Tauri), pero todas las rutas se
// resuelven desde `import.meta.url`, no desde el cwd.

import { chmodSync, copyFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const AQUI = dirname(fileURLToPath(import.meta.url));
const DESTINO = resolve(AQUI, "..", "src-tauri", "binaries");
const NOMBRE = "noxloop-service";

// De donde sale el ejecutable que se empaqueta. Por defecto el que esta
// corriendo este script; `NOXLOOP_SIDECAR_NODE` permite apuntar a otro sin
// cambiar el Node del desarrollo.
const ORIGEN = process.env.NOXLOOP_SIDECAR_NODE || process.execPath;

// Tauri exige que el `externalBin` lleve el sufijo del target triple. No es
// decoracion: es como el bundler elige, entre varios binarios, el de la
// plataforma que se esta construyendo. Sin el sufijo, `tauri build` falla con
// "binary not found" apuntando a un nombre que si existe en disco.
function targetTriple() {
  // La CLI de Tauri exporta esta variable para los hooks de build. Es la fuente
  // correcta en una compilacion cruzada, donde el triple de destino no es el de
  // la maquina que compila.
  if (process.env.TAURI_ENV_TARGET_TRIPLE) return process.env.TAURI_ENV_TARGET_TRIPLE;

  // Fuera de esos hooks (una invocacion a mano) se pregunta al compilador en vez
  // de derivarlo de `process.platform` y `process.arch`: la correspondencia no
  // es uno a uno y adivinarla produce un nombre que compila y no empaqueta.
  // El fallo que este try/catch evita ya ocurrio: `rustc` instalado por rustup
  // vive en `~/.cargo/bin`, que NO esta en el PATH de una shell que no cargo
  // `~/.cargo/env`. Sin esto, el script moria con `spawnSync rustc ENOENT` — un
  // error de Node crudo, sin causa ni accion, que se lee como "el script esta
  // roto" y no como "falta una ruta en el PATH".
  let salida;
  try {
    salida = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  } catch (e) {
    if (e?.code === "ENOENT") {
      throw new Error(
        "No se encontro `rustc`, y hace falta para saber con que sufijo nombrar el sidecar.\n" +
          "  Causa:  rustup lo instala en `~/.cargo/bin`, que no esta en el PATH de esta shell.\n" +
          "  Accion: ejecuta `source ~/.cargo/env` antes, o pasa el triple directamente\n" +
          "          con `TAURI_ENV_TARGET_TRIPLE=aarch64-apple-darwin`.\n" +
          "          Si Rust no esta instalado: https://rustup.rs"
      );
    }
    throw e;
  }

  const host = salida.split("\n").find((l) => l.startsWith("host:"));
  if (!host) {
    throw new Error(
      "`rustc -vV` respondio pero sin la linea `host:`, asi que no hay triple que usar.\n" +
        "  Accion: pasa el triple a mano con `TAURI_ENV_TARGET_TRIPLE=...`."
    );
  }
  return host.slice("host:".length).trim();
}

// Un Node enlazado dinamicamente contra bibliotecas que no vienen con el
// sistema **no se puede empaquetar**. El de Homebrew en macOS es el caso comun
// y el mas enganoso: `bin/node` son 68 KB que cargan `@rpath/libnode.N.dylib`
// mas una docena de dylibs bajo `/opt/homebrew`. Copiado tal cual, arranca
// perfecto en la maquina que lo construyo —las dylibs estan ahi— y muere con
// "image not found" en cualquier otra, incluida la del mismo desarrollador
// despues de un `brew upgrade` que mueva `libnode.147` a `libnode.148`.
//
// El fallo no aparece en el build ni en la prueba local: aparece en la maquina
// del operador, que es donde no hay nadie para leer el mensaje. Por eso se
// comprueba aca y no se confia en que salga en las pruebas.
//
// `research.md` §1 decide "binario de Node embebido" pero no dice **cual**: el
// que sirve es el de una distribucion oficial de nodejs.org, que esta enlazado
// de forma autocontenida. Esto es un anadido a esa investigacion, no algo que
// venga de ella.
function dependenciasAjenas(binario) {
  if (process.platform === "darwin") {
    const salida = execFileSync("otool", ["-L", binario], { encoding: "utf8" });
    return salida
      .split("\n")
      .slice(1)
      .map((l) => l.trim().split(" ")[0])
      .filter(Boolean)
      // `/usr/lib` y `/System` los provee macOS en toda instalacion.
      .filter((ruta) => !ruta.startsWith("/usr/lib/") && !ruta.startsWith("/System/"));
  }
  if (process.platform === "linux") {
    let salida;
    try {
      salida = execFileSync("ldd", [binario], { encoding: "utf8" });
    } catch {
      // `ldd` sobre un binario estatico devuelve error: es exactamente el caso
      // bueno.
      return [];
    }
    return salida
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes("=>") && !l.includes("not found"))
      .map((l) => l.split("=>")[1].trim().split(" ")[0])
      .filter(Boolean)
      // La libc y las que vienen con cualquier distribucion.
      .filter((ruta) => !/^\/(?:usr\/)?lib(?:64|\/x86_64-linux-gnu|\/aarch64-linux-gnu)?\//.test(ruta));
  }
  // En Windows no hay equivalente barato y el Node oficial es un `.exe` unico.
  return [];
}

function comprobarAutocontenido(binario) {
  const ajenas = dependenciasAjenas(binario);
  if (ajenas.length === 0) return;

  const mensaje =
    `El ejecutable de Node elegido para el sidecar no es autocontenido.\n` +
    `Binario: ${binario}\n` +
    `Depende de bibliotecas que no vienen con el sistema:\n` +
    ajenas.map((d) => `  - ${d}`).join("\n") +
    `\nAsi no funciona ni siquiera en esta maquina: Tauri copia el sidecar a ` +
    `target/debug/ (o al .app), lejos del @rpath desde el que se resolvian esas ` +
    `bibliotecas, y el proceso muere con SIGABRT antes de ejecutar una linea. ` +
    `Comprobado en esta maquina con el Node de Homebrew:\n` +
    `  dyld: Library not loaded: @rpath/libnode.147.dylib\n` +
    `Accion: apunta el sidecar a una distribucion oficial de nodejs.org con ` +
    `NOXLOOP_SIDECAR_NODE=/ruta/a/node, o instala Node desde nodejs.org en vez del ` +
    `gestor de paquetes del sistema. Las distribuciones oficiales solo dependen de ` +
    `/usr/lib y /System.`;

  // Se corta siempre, tambien en desarrollo. La primera version de este script
  // solo avisaba en `tauri dev` —el razonamiento era que un bundle sale de la
  // maquina y un `tauri dev` no— y la prueba lo desmintio: con el Node de
  // Homebrew el sidecar no arranca tampoco en desarrollo. Un aviso que precede
  // a un fallo seguro es un fallo con ruido delante.
  //
  // `NOXLOOP_SIDECAR_ENLAZADO_OK=1` es la unica salida, y existe por un caso
  // concreto: `tauri-build` aborta si el `externalBin` no esta en disco, asi que
  // un `cargo check` o un `cargo fmt` necesitan el archivo aunque no lo vayan a
  // ejecutar. Sigue imprimiendo el aviso entero: no es un modo silencioso.
  if (process.env.NOXLOOP_SIDECAR_ENLAZADO_OK === "1") {
    console.warn(
      `AVISO: ${mensaje}\n` +
        `Se continua porque NOXLOOP_SIDECAR_ENLAZADO_OK=1. El binario resultante ` +
        `sirve para que compile, no para ejecutarse.`
    );
    return;
  }
  throw new Error(mensaje);
}

function preparar() {
  const triple = targetTriple();
  const destino = join(DESTINO, `${NOMBRE}-${triple}`);
  const origen = ORIGEN;

  comprobarAutocontenido(origen);

  mkdirSync(DESTINO, { recursive: true });

  // Se borra antes de copiar. Sobrescribir un binario que el sistema pudo haber
  // mapeado en memoria da `ETXTBSY` en Linux y deja una firma invalida en macOS;
  // copiar sobre un archivo nuevo no tiene ninguno de los dos problemas.
  rmSync(destino, { force: true });
  copyFileSync(origen, destino);
  chmodSync(destino, 0o755);

  // En macOS con Apple Silicon, el cargador del sistema **exige** una firma valida
  // en todo ejecutable: uno sin firmar se mata con SIGKILL al arrancar, no da
  // error. Y aunque la copia conserve los bytes de la firma del Node de origen,
  // el bundler de Tauri vuelve a firmar el `.app` entero y una firma anidada que
  // no cuadra invalida el conjunto: Gatekeeper mata la aplicacion sin mensaje.
  // Refirmar ad-hoc (`--sign -`) aca deja el binario en un estado que la firma
  // posterior del bundle puede reemplazar limpiamente.
  if (process.platform === "darwin") {
    try {
      execFileSync("codesign", ["--force", "--sign", "-", destino], { stdio: "pipe" });
    } catch (e) {
      const detalle = e?.stderr?.toString().trim() || e?.message || String(e);
      throw new Error(
        `No se pudo firmar el sidecar (${destino}).\n` +
          `Causa: ${detalle}\n` +
          "Accion: instala las Command Line Tools de Xcode (`xcode-select --install`), " +
          "que es lo que provee `codesign`. Sin firma, Gatekeeper mata la aplicacion al " +
          "arrancar y no queda rastro de por que."
      );
    }
}

const tamano = statSync(destino).size;
console.log(
  `sidecar listo: ${destino} (${(tamano / 1024 / 1024).toFixed(1)} MB, copiado de ${origen})`
);
}

// El fallo de este script se lee en la consola de un `tauri build`, entre cientos
// de lineas de cargo. Una traza de pila ahi no dice nada util; el mensaje con su
// causa y su accion, si.
try {
  preparar();
} catch (e) {
  console.error(`\nNo se pudo preparar el sidecar.\n${e?.message || e}\n`);
  process.exit(1);
}
