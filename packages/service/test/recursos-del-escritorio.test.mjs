// Lo que el escritorio empaqueta es un ARBOL QUE FUNCIONA SOLO, no una lista de
// archivos que casualmente estan.
//
// EL FALLO QUE ESTO CIERRA, Y YA OCURRIO TRES VECES CON TRES FORMAS DISTINTAS.
// El escritorio empaqueta los recursos que `tauri.conf.json` declara y nada mas.
// Cualquier ruta que el codigo resuelva y que no aterrice dentro de lo declarado
// resuelve perfectamente en el repositorio y revienta en la aplicacion
// instalada, sin ningun mensaje que el operador pueda relacionar con la causa:
//
//   1. Un paquete importado y no declarado: `ERR_MODULE_NOT_FOUND` y una ventana
//      que no abre. Paso con el lock.
//   2. Un especificador desnudo (`import("ai")`) que resuelve por el
//      `node_modules` de la raiz del repo, que el bundle no lleva.
//   3. Una ruta relativa que asume la forma del REPOSITORIO: `motor.mjs` busca
//      `../../../providers/`, `lanzador.mjs` busca `../../engine/bin/`, y el
//      motor importa `../../../providers/contract.mjs`. El bundle mapeaba cada
//      paquete a la raiz de recursos (`servicio/`, `engine/`...), asi que esas
//      rutas salian del arbol empaquetado — y ademas `providers/` y
//      `engine/bin/` ni viajaban. El servicio arrancaba, el board se pintaba, y
//      Run devolvia `pieza_ausente` en el `.app`.
//
// Y UN CUARTO QUE NINGUNA GUARDA VEIA: en la forma de mapa, Tauri APLANA los
// globs. `"src/**/*": "servicio/src/"` copia `src/adaptadores/codex.mjs` a
// `servicio/src/codex.mjs` (tauri-utils `resources.rs`: para un glob el destino
// es `dest.join(file_name)`). Todo import a un subdirectorio se rompia igual de
// mudo. Solo la forma de DIRECTORIO (clave sin `*`) conserva la estructura.
//
// LA REGLA QUE SALE DE LAS CUATRO: el bundle REPLICA la estructura del
// repositorio bajo un prefijo (`app/`). Con eso cada ruta relativa del codigo
// significa exactamente lo mismo en el repo y en el `.app`, y la guarda deja de
// tener que saber como importa cada paquete: basta con emular el mapeo de Tauri
// y comprobar que toda referencia relativa de lo empaquetado cae DENTRO de lo
// empaquetado.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { constants, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";

const RAIZ = new URL("../../../", import.meta.url).pathname;
const SRC_TAURI = join(RAIZ, "apps/desktop/src-tauri");
const CONFIG = join(SRC_TAURI, "tauri.conf.json");

/** Todo lo que viaja cuelga de aca dentro de los recursos del `.app`. */
const PREFIJO = "app/";
/** Las claves de `bundle.resources` son relativas a `src-tauri`, tres niveles bajo la raiz. */
const SUBIR = "../../../";

const leerRecursos = () => JSON.parse(readFileSync(CONFIG, "utf8")).bundle?.resources ?? {};

/** Todos los archivos de un directorio, recursivo. */
function archivos(dir, acc = []) {
  for (const entrada of readdirSync(dir)) {
    const p = join(dir, entrada);
    if (statSync(p).isDirectory()) archivos(p, acc);
    else acc.push(p);
  }
  return acc;
}

const fuentes = (dir) => archivos(dir).filter((p) => p.endsWith(".mjs"));

/**
 * El arbol empaquetado, emulando a tauri-utils (`resources.rs`): destino
 * relativo a la raiz de recursos -> archivo de origen en disco.
 *
 * - Clave con `*` (glob): cada coincidencia va a `dest/<nombre>` — APLANADA.
 *   Solo se emula `<dir>/**\/*`, que es la forma que se uso; cualquier otra hace
 *   fallar la guarda de mas abajo antes de llegar aca.
 * - Clave que es un directorio: se recorre y se conserva la estructura.
 * - Clave que es un archivo: va exactamente a `dest`.
 */
function arbolEmpaquetado(recursos) {
  const arbol = new Map();
  for (const [clave, destino] of Object.entries(recursos)) {
    const dest = destino.replace(/\/+$/, "");
    if (clave.includes("*")) {
      const base = join(SRC_TAURI, clave.replace(/\/\*\*\/\*$/, ""));
      if (!existsSync(base)) continue;
      for (const p of archivos(base)) arbol.set(posix.join(dest, p.split("/").pop()), p);
      continue;
    }
    const origen = join(SRC_TAURI, clave);
    if (!existsSync(origen)) continue;
    if (statSync(origen).isDirectory()) {
      for (const p of archivos(origen)) arbol.set(posix.join(dest, p.slice(origen.length + 1)), p);
    } else {
      arbol.set(dest, origen);
    }
  }
  return arbol;
}

/** Quita comentarios de linea y de bloque, para no leer ejemplos como codigo. */
const sinComentarios = (texto) => texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Las referencias RELATIVAS que un modulo resuelve en runtime: imports
 * estaticos, imports dinamicos, y `new URL("...", import.meta.url)`, que es como
 * se nombran el motor, los proveedores, el worker del escaneo y los esquemas.
 */
function referenciasRelativas(texto) {
  const limpio = sinComentarios(texto);
  const refs = [];
  for (const m of limpio.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["'](\.\.?\/[^"']*)["']/g)) refs.push(m[1]);
  for (const m of limpio.matchAll(/new URL\(\s*["'](\.\.?\/[^"']*)["']\s*,\s*import\.meta\.url/g)) refs.push(m[1]);
  return refs;
}

/** La constante `ENTRADA_SERVICIO` de `lib.rs`, que es lo que la cascara resuelve en el `.app`. */
function entradaDelServicio() {
  const lib = readFileSync(join(SRC_TAURI, "src/lib.rs"), "utf8");
  const m = lib.match(/const ENTRADA_SERVICIO: &str = "([^"]+)";/);
  assert.ok(m, "no se encontro `ENTRADA_SERVICIO` en lib.rs: esta guarda dejo de mirar donde tiene que mirar");
  return m[1];
}

// ---------------------------------------------------------------------------
// LA FORMA: una replica del repositorio bajo `app/`
// ---------------------------------------------------------------------------

test("ningun recurso se declara con glob: en la forma de mapa Tauri APLANA los subdirectorios", () => {
  const conGlob = Object.keys(leerRecursos()).filter((k) => k.includes("*"));
  assert.deepEqual(
    conGlob,
    [],
    "estas entradas usan un glob, y Tauri copia cada coincidencia a `<destino>/<nombre>` sin su subdirectorio:\n" +
      conGlob.map((k) => `  ${k}`).join("\n") +
      "\nDeclara el directorio sin `*` (`\"../../../packages/x/src\": \"app/packages/x/src\"`), que se recorre conservando la estructura.",
  );
});

test("cada recurso aterriza en `app/` + su ruta en el repositorio, sin excepciones", () => {
  // Con la identidad bajo un prefijo, `../../engine/bin/` desde
  // `app/packages/service/src/` es `app/packages/engine/bin/`, igual que en el
  // repo. Una entrada que se desvie de la regla vuelve a hacer que una ruta
  // relativa signifique otra cosa en el `.app`.
  const recursos = leerRecursos();
  const desviados = [];
  for (const [clave, destino] of Object.entries(recursos)) {
    if (!clave.startsWith(SUBIR)) {
      desviados.push(`${clave}: no parte de la raiz del repositorio (${SUBIR})`);
      continue;
    }
    const esperado = PREFIJO + clave.slice(SUBIR.length);
    if (destino !== esperado) desviados.push(`${clave} -> ${destino} (tenia que ser ${esperado})`);
  }
  assert.deepEqual(desviados, [], `recursos que no replican la estructura del repositorio:\n${desviados.join("\n")}`);
});

test("la entrada del servicio que resuelve lib.rs esta en el arbol empaquetado", () => {
  const entrada = entradaDelServicio();
  const arbol = arbolEmpaquetado(leerRecursos());
  assert.ok(
    arbol.has(entrada),
    `lib.rs lanza \`${entrada}\` desde los recursos y ese archivo no se empaqueta: la aplicacion abre sin servicio`,
  );
});

test("ningun archivo de pruebas viaja: `node --test` los encontraria en `target/` y en el `.app`", () => {
  // No es solo peso. `tauri-build` copia los recursos a `target/<perfil>/app/`
  // y el `.app` queda en `target/release/bundle/`, ambos DENTRO del repo: la
  // suite de la raiz (`node --test`) recogia esas copias y las corria desde un
  // sitio donde sus rutas no significan nada. Paso con `providers/` recorrido
  // entero.
  // `node_modules/` se excluye: `node --test` no entra ahi, y los paquetes de
  // terceros viajan enteros a proposito (ver la prueba de lo declarado basta).
  const pruebas = [...arbolEmpaquetado(leerRecursos()).keys()]
    .filter((d) => !d.startsWith(`${PREFIJO}node_modules/`))
    .filter((d) => /\.test\.[cm]?js$|(^|\/)test\//.test(d));
  assert.deepEqual(pruebas, [], `archivos de prueba empaquetados:\n${pruebas.join("\n")}`);
});

test("todo proveedor del motor viaja: cada `providers/<slug>/index.mjs` esta declarado", () => {
  // El motor carga los proveedores POR RUTA (`providers/<slug>/index.mjs`,
  // `motor.mjs`), no por import: la guarda de referencias no los ve. Agregar un
  // gestor sigue siendo agregar un directorio (principio VI) — mas una linea en
  // `bundle.resources`, que esta prueba exige para que no falte solo en el `.app`.
  const arbol = arbolEmpaquetado(leerRecursos());
  const dir = join(RAIZ, "providers");
  const slugs = readdirSync(dir).filter((d) => existsSync(join(dir, d, "index.mjs")));
  assert.ok(slugs.length >= 3, `solo ${slugs.length} proveedores en providers/: la forma del directorio cambio`);
  const faltan = slugs.filter((s) => !arbol.has(`${PREFIJO}providers/${s}/index.mjs`));
  assert.deepEqual(faltan, [], `proveedores que no viajan al escritorio: ${faltan.join(", ")}.\nDeclara \`${SUBIR}providers/<slug>/index.mjs\`.`);
});

// ---------------------------------------------------------------------------
// LA GUARDA QUE FALTABA: ninguna ruta relativa sale de lo empaquetado
// ---------------------------------------------------------------------------

test("LA GUARDA QUE FALTABA: toda referencia relativa de lo empaquetado cae dentro de lo empaquetado", () => {
  // Se razona en el espacio del BUNDLE, no en el del repo: cada modulo se ubica
  // donde Tauri lo va a dejar y cada `../` se resuelve desde ahi. Asi la guarda
  // sirve para cualquier forma de `bundle.resources`, y no solo para la que se
  // eligio: si alguien vuelve a mapear a la raiz, cae aqui.
  //
  // Los `*.test.mjs` no se miran: viajan con `providers/` pero nadie los ejecuta
  // en el `.app`, y sus fixtures apuntan a donde quieran.
  const arbol = arbolEmpaquetado(leerRecursos());
  const destinos = [...arbol.keys()];
  const hayDirectorio = (d) => destinos.some((x) => x.startsWith(d.endsWith("/") ? d : `${d}/`));

  const rotas = [];
  let miradas = 0;
  for (const [destino, origen] of arbol) {
    if (!destino.endsWith(".mjs") || destino.endsWith(".test.mjs")) continue;
    if (destino.startsWith(`${PREFIJO}node_modules/`)) continue;
    for (const ref of referenciasRelativas(readFileSync(origen, "utf8"))) {
      miradas++;
      const resuelta = posix.normalize(posix.join(posix.dirname(destino), ref));
      if (resuelta.startsWith("../") || resuelta === "..") {
        rotas.push(`${destino}: \`${ref}\` sale de la carpeta de recursos (${resuelta})`);
      } else if (ref.endsWith("/") ? !hayDirectorio(resuelta) : !arbol.has(resuelta)) {
        rotas.push(`${destino}: \`${ref}\` apunta a \`${resuelta}\`, que no se empaqueta`);
      }
    }
  }

  // Sin esto el test es vacio: si el arbol quedara a cero, no miraria nada.
  assert.ok(miradas > 50, `solo ${miradas} referencias relativas miradas: la configuracion o los imports cambiaron de forma`);
  assert.deepEqual(
    rotas,
    [],
    "hay rutas que resuelven en el repositorio y NO en la aplicacion instalada:\n" +
      rotas.join("\n") +
      "\nEn el `.app` lo que no se declara no existe, y el sintoma es `ERR_MODULE_NOT_FOUND` o `pieza_ausente`.",
  );
});

// ---------------------------------------------------------------------------
// Los paquetes del monorepo: ni de menos, ni de mas
// ---------------------------------------------------------------------------

/** Los paquetes del monorepo que el servicio importa de verdad, leidos del codigo. */
function paquetesImportados() {
  const encontrados = new Set();
  for (const base of ["src", "bin"]) {
    for (const archivo of fuentes(join(RAIZ, "packages/service", base))) {
      for (const m of readFileSync(archivo, "utf8").matchAll(/from\s+["']\.\.\/\.\.\/([a-z-]+)\//g)) {
        encontrados.add(m[1]);
      }
    }
  }
  return encontrados;
}

/** Los paquetes del monorepo cuyo `src` viaja, leidos de la propia configuracion. */
function paquetesQueViajan(recursos) {
  const encontrados = new Set();
  for (const origen of Object.keys(recursos)) {
    const m = origen.match(/^\.\.\/\.\.\/\.\.\/packages\/([a-z-]+)\/src$/);
    if (m) encontrados.add(m[1]);
  }
  return encontrados;
}

test("todo paquete que el servicio importa viaja con su package.json", () => {
  const recursos = leerRecursos();
  const importados = paquetesImportados();
  assert.ok(importados.size > 0, "el servicio no importa ningun paquete del monorepo, o cambio la forma de sus imports");

  const faltan = [];
  for (const paquete of importados) {
    if (!(`${SUBIR}packages/${paquete}/src` in recursos)) faltan.push(`${paquete}: falta ${SUBIR}packages/${paquete}/src`);
    if (!(`${SUBIR}packages/${paquete}/package.json` in recursos)) {
      faltan.push(`${paquete}: falta su package.json, y sin el Node no resuelve el paquete como modulo ES`);
    }
  }
  assert.deepEqual(faltan, [], `paquetes que el servicio importa y no viajan al escritorio:\n${faltan.join("\n")}`);
});

test("no se declara como recurso ningun paquete del monorepo que nadie importa", () => {
  // Un recurso de mas engorda el instalador con codigo muerto y hace creer que
  // ese paquete es parte de la superficie del escritorio. Los que el motor
  // importa por su cuenta (`adapters`, `vault`) tambien los importa el servicio.
  const sobran = [...paquetesQueViajan(leerRecursos())].filter((p) => p !== "service" && !paquetesImportados().has(p));
  assert.deepEqual(
    sobran,
    [],
    `declarados como recursos y no importados por el servicio: ${sobran.join(", ")}.\n` +
      "El orden correcto es al reves: primero el import, despues el recurso.",
  );
});

// ---------------------------------------------------------------------------
// Los especificadores DESNUDOS: lo de terceros tambien tiene que viajar
// ---------------------------------------------------------------------------

/** `ai/test` es `ai`, y `@ai-sdk/anthropic/internal` es `@ai-sdk/anthropic`. */
function paqueteDe(especificador) {
  const partes = especificador.split("/");
  return especificador.startsWith("@") ? `${partes[0]}/${partes[1]}` : partes[0];
}

/**
 * Los especificadores desnudos de todo lo empaquetado del monorepo, estaticos y
 * dinamicos: la frontera con el SDK usa `await import("ai")` a proposito.
 */
function desnudosEmpaquetados(arbol) {
  const encontrados = [];
  for (const [destino, origen] of arbol) {
    if (!destino.endsWith(".mjs") || destino.endsWith(".test.mjs")) continue;
    if (destino.startsWith(`${PREFIJO}node_modules/`)) continue;
    const texto = sinComentarios(readFileSync(origen, "utf8"));
    for (const m of texto.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g)) {
      if (m[1].startsWith(".") || m[1].startsWith("node:")) continue;
      encontrados.push({ archivo: destino, especificador: m[1] });
    }
  }
  return encontrados;
}

/** Los paquetes de terceros declarados como recursos. */
function tercerosDeclarados(recursos) {
  const encontrados = new Set();
  for (const origen of Object.keys(recursos)) {
    const m = origen.match(/^\.\.\/\.\.\/\.\.\/node_modules\/(.+)$/);
    if (m) encontrados.add(m[1]);
  }
  return encontrados;
}

test("un especificador desnudo en lo empaquetado tiene que estar declarado como recurso", () => {
  const recursos = leerRecursos();
  const declarados = tercerosDeclarados(recursos);
  const desnudos = desnudosEmpaquetados(arbolEmpaquetado(recursos));

  const faltan = desnudos
    .filter(({ especificador }) => !declarados.has(paqueteDe(especificador)))
    .map(
      ({ archivo, especificador }) =>
        `${archivo}: importa \`${especificador}\` y \`${paqueteDe(especificador)}\` no viaja.\n` +
        `  Declara \`${SUBIR}node_modules/${paqueteDe(especificador)}\` hacia \`${PREFIJO}node_modules/${paqueteDe(especificador)}\`.`,
    );
  assert.deepEqual(faltan, [], `especificadores desnudos que no resuelven en la aplicacion instalada:\n${faltan.join("\n")}`);

  if (declarados.size > 0) {
    assert.ok(desnudos.length > 0, "hay terceros declarados y ningun import desnudo que los justifique");
  }
});

// ---------------------------------------------------------------------------
// LA PRUEBA QUE NO SE PUEDE PASAR POR DESCUIDO: el arbol, fuera del repo
// ---------------------------------------------------------------------------

test("EL ARBOL EMPAQUETADO FUNCIONA SOLO: montado fuera del repositorio, importa, encuentra el motor y los proveedores", () => {
  // Todo lo de arriba compara listas. Esto monta el arbol tal como Tauri lo
  // deja y lo ejercita con un Node limpio, en `tmpdir`: dentro del repo, Node
  // subiria hasta `<repo>/node_modules` y encontraria TODO. La diferencia
  // importa porque `ai` importa `zod/v4`, que es un `peer` y no esta en
  // `dependencies`: una guarda que caminara manifiestos daria por cerrada una
  // lista a la que le falta un paquete.
  const recursos = leerRecursos();
  const arbol = arbolEmpaquetado(recursos);
  // `realpath` porque en macOS `tmpdir` es un enlace (`/var` -> `/private/var`)
  // y `import.meta.url` devuelve la ruta real: sin esto, comparar prefijos falla.
  const banco = realpathSync(mkdtempSync(join(tmpdir(), "noxloop-bundle-")));
  try {
    // Directorios enteros con `cpSync` (clon en escritura en APFS/btrfs) y no
    // archivo por archivo: son miles en `node_modules`.
    for (const [clave, destino] of Object.entries(recursos)) {
      const origen = join(SRC_TAURI, clave);
      assert.ok(existsSync(origen), `\`${clave}\` esta declarado como recurso y no existe`);
      mkdirSync(dirname(join(banco, destino)), { recursive: true });
      cpSync(origen, join(banco, destino), { recursive: true, mode: constants.COPYFILE_FICLONE });
    }
    const app = join(banco, PREFIJO);

    const especificadores = [...new Set(desnudosEmpaquetados(arbol).map((d) => d.especificador))];
    const guion = `
      import { existsSync } from "node:fs";
      const app = ${JSON.stringify(app)};
      for (const e of ${JSON.stringify(especificadores)}) await import(e);
      const motor = await import(app + "packages/service/src/motor.mjs");
      const lanzador = await import(app + "packages/service/src/lanzador.mjs");
      if (!motor.RAIZ_DE_PROVEEDORES.startsWith(app)) throw new Error("proveedores fuera del arbol: " + motor.RAIZ_DE_PROVEEDORES);
      if (!existsSync(motor.RAIZ_DE_PROVEEDORES + "contract.mjs")) throw new Error("sin providers/contract.mjs en " + motor.RAIZ_DE_PROVEEDORES);
      if (!existsSync(lanzador.BIN_DEL_MOTOR)) throw new Error("sin el binario del motor en " + lanzador.BIN_DEL_MOTOR);
      for (const p of ["fake", "local"]) await import(motor.RAIZ_DE_PROVEEDORES + p + "/index.mjs");
      await import(app + "packages/engine/src/wiring.mjs");
      console.log("ok");
    `;
    // El importador vive donde vivira en el bundle, para que los desnudos se
    // resuelvan subiendo desde un paquete del monorepo hasta `app/node_modules`.
    const importador = join(app, "packages/asistencia/src/__prueba-del-arbol.mjs");
    mkdirSync(dirname(importador), { recursive: true });
    writeFileSync(importador, guion);

    // Devuelve stdout + stderr: la ayuda del motor sale por stderr (su stdout
    // es solo para el JSON del resultado).
    const correr = (args) => {
      const r = spawnSync(process.execPath, args, { encoding: "utf8", cwd: banco });
      if (r.status !== 0) {
        assert.fail(`el arbol empaquetado no funciona solo (${args.join(" ")}):\n${String(r.stderr || r.error).slice(0, 2000)}`);
      }
      return r.stdout + r.stderr;
    };
    assert.match(correr([importador]), /ok/);
    // Y el motor arranca como lo arranca el lanzador: su bin, que importa estatico
    // `doctor.mjs` y con el `providers/contract.mjs`. (`help` y no `--help`: el
    // segundo sale con 1 por ser una opcion desconocida.)
    assert.match(correr([join(app, "packages/engine/bin/noxloop.mjs"), "help"]), /noxloop/i);
  } finally {
    rmSync(banco, { recursive: true, force: true });
  }
});

test("el coste del subarbol de terceros esta medido y acotado, no descubierto en el instalador", () => {
  // Cada paquete de terceros que viaja cuesta su subarbol entero en el
  // instalador. 30 MB sobre los ~20 que pesan hoy los paquetes del AI SDK: el
  // margen es para una version que crezca, no para una dependencia mas.
  const TOPE_MB = 30;
  const declarados = [...tercerosDeclarados(leerRecursos())];
  if (declarados.length === 0) return;

  const pesar = (dir) => archivos(dir).reduce((s, p) => s + statSync(p).size, 0);
  const detalle = declarados
    .map((p) => ({ p, mb: pesar(join(RAIZ, "node_modules", p)) / 1024 / 1024 }))
    .sort((a, b) => b.mb - a.mb);
  const total = detalle.reduce((s, d) => s + d.mb, 0);

  assert.ok(
    total <= TOPE_MB,
    `el subarbol de terceros que viaja al escritorio pesa ${total.toFixed(1)} MB y el tope es ${TOPE_MB} MB.\n` +
      detalle.map((d) => `  ${d.p}: ${d.mb.toFixed(1)} MB`).join("\n") +
      "\nSi la dependencia nueva hace falta, sube el tope EN ESTE TEST y di por que.",
  );
});
