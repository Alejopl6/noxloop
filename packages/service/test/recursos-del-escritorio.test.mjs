// Cada paquete que el servicio importa viaja con el al escritorio, y en la
// posicion exacta que sus imports esperan.
//
// EL FALLO QUE ESTO CIERRA, Y YA OCURRIO. El escritorio empaqueta los recursos
// que `tauri.conf.json` declara y nada mas. Un paquete importado y no declarado
// resuelve perfectamente en el repositorio y revienta al abrir la aplicacion
// instalada, con un `ERR_MODULE_NOT_FOUND` que el operador ve como una ventana
// que no abre, sin ningun mensaje que lo explique. Paso con el lock, y el
// arreglo de entonces fue copiar el mecanismo dentro del paquete.
//
// Ese arreglo no escala: cablear cuatro paquetes ES el trabajo de este
// servicio. Asi que en vez de prohibir los imports de fuera, se ata la lista de
// imports a la lista de recursos, y si se separan falla aqui.
//
// LA SEGUNDA MITAD IMPORTA TANTO COMO LA PRIMERA: no basta con que el paquete
// viaje, tiene que aterrizar donde el import lo busca. El servicio hace
// `../../store/src/...` desde `servicio/src/`, que en el bundle resuelve a la
// RAIZ de recursos — no a `packages/`. Declararlo en `packages/store/src/`
// empaqueta el archivo correcto en el sitio equivocado, y el sintoma es
// identico al de no empaquetarlo: exactamente igual de mudo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { constants, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const RAIZ = new URL("../../../", import.meta.url).pathname;
const CONFIG = join(RAIZ, "apps/desktop/src-tauri/tauri.conf.json");

/** Todos los `.mjs` de un directorio, recursivo. */
function fuentes(dir, acc = []) {
  for (const entrada of readdirSync(dir)) {
    const p = join(dir, entrada);
    if (statSync(p).isDirectory()) fuentes(p, acc);
    else if (entrada.endsWith(".mjs")) acc.push(p);
  }
  return acc;
}

/** Los paquetes del monorepo que el servicio importa de verdad, leidos del codigo. */
function paquetesImportados() {
  const encontrados = new Set();
  for (const base of ["src", "bin"]) {
    for (const archivo of fuentes(join(RAIZ, "packages/service", base))) {
      const texto = readFileSync(archivo, "utf8");
      // `../../<paquete>/` desde `packages/service/<base>/` es `packages/<paquete>/`.
      for (const m of texto.matchAll(/from\s+["']\.\.\/\.\.\/([a-z-]+)\//g)) {
        encontrados.add(m[1]);
      }
    }
  }
  return encontrados;
}

test("todo paquete que el servicio importa esta declarado como recurso del escritorio", () => {
  const recursos = JSON.parse(readFileSync(CONFIG, "utf8")).bundle?.resources ?? {};
  const importados = paquetesImportados();

  // Sin esta guarda el test es vacio: si los imports cambiaran de forma, el
  // conjunto quedaria a cero y el bucle no comprobaria nada.
  assert.ok(
    importados.size > 0,
    "el servicio no importa ningun paquete del monorepo, o cambio la forma de sus imports y este test dejo de mirar donde tiene que mirar",
  );

  const faltan = [];
  for (const paquete of importados) {
    const origen = `../../../packages/${paquete}/src/**/*`;
    if (!(origen in recursos)) {
      faltan.push(`${paquete}: falta la entrada ${origen} en bundle.resources`);
      continue;
    }
    // Y aterriza donde el import lo busca: raiz de recursos, no `packages/`.
    const destino = recursos[origen];
    assert.equal(
      destino,
      `${paquete}/src/`,
      `el recurso de '${paquete}' viaja a '${destino}', pero el servicio lo importa como '../../${paquete}/src/...', que en el bundle resuelve a '${paquete}/src/'`,
    );
    const manifiesto = `../../../packages/${paquete}/package.json`;
    if (!(manifiesto in recursos)) {
      faltan.push(`${paquete}: falta su package.json, y sin el Node no resuelve el paquete como modulo ES`);
    }
  }

  assert.deepEqual(faltan, [], `paquetes que el servicio importa y no viajan al escritorio:\n${faltan.join("\n")}`);
});

test("no se declara como recurso ningun paquete que el servicio no importa", () => {
  // La direccion contraria, y no es simetria por gusto: un recurso declarado de
  // mas engorda el instalador con codigo muerto y, peor, hace creer que ese
  // paquete forma parte de la superficie del escritorio. Quien lea la
  // configuracion para saber que viaja obtendria una respuesta falsa.
  const recursos = JSON.parse(readFileSync(CONFIG, "utf8")).bundle?.resources ?? {};
  const importados = paquetesImportados();

  const sobran = [];
  for (const origen of Object.keys(recursos)) {
    const m = origen.match(/^\.\.\/\.\.\/\.\.\/packages\/([a-z-]+)\/src\/\*\*\/\*$/);
    if (!m) continue;
    // El propio servicio viaja siempre; es el sidecar.
    if (m[1] === "service") continue;
    if (!importados.has(m[1])) sobran.push(m[1]);
  }

  assert.deepEqual(
    sobran,
    [],
    `declarados como recursos y no importados por el servicio: ${sobran.join(", ")}.\n` +
      "Si se anadieron previendo un cableado futuro, el orden correcto es al reves: primero el import, despues el recurso.",
  );
});

// ---------------------------------------------------------------------------
// LA MITAD QUE FALTABA: los especificadores DESNUDOS
// ---------------------------------------------------------------------------
//
// EL AGUJERO QUE ESTO CIERRA, Y ESTABA ABIERTO DE PAR EN PAR. Todo lo de arriba
// mira imports RELATIVOS: `../../store/src/...`. Un especificador desnudo
// —`import { generateObject } from "ai"`— no empareja con ninguna de esas
// expresiones y pasaba sin que nadie lo mirara. Y es exactamente el mismo fallo
// que todo este archivo existe para impedir, con una forma distinta: resuelve
// perfectamente en el repositorio, donde hay un `node_modules` en la raiz, y
// muere con `ERR_MODULE_NOT_FOUND` en la aplicacion instalada, donde no lo hay.
// El operador lo ve como una ventana que no abre.
//
// POR QUE LA GUARDA DISTINGUE LO DECLARADO DE LO COLADO EN VEZ DE PROHIBIR. Se
// penso en prohibir los desnudos y no sirve: la asistencia con IA ES una
// llamada a un SDK, asi que la prohibicion habria que romperla el primer dia.
// Lo que se hace es lo mismo que con los paquetes del monorepo — atar la lista
// de imports a la lista de recursos — y sumarle una prueba que NO se puede
// pasar por descuido: se monta el subarbol declarado en un directorio de usar y
// tirar FUERA del repositorio, y se importa desde ahi con un Node limpio. Si lo
// declarado no basta, el import falla ahi y no en la maquina del operador.
//
// EL COSTE ESTA DECLARADO Y NO ESCONDIDO: cada paquete de terceros que entre
// aqui engorda el instalador con su subarbol entero, y la prueba de mas abajo
// lo mide y lo dice.

/** Los paquetes del monorepo que viajan, leidos de la propia configuracion. */
function paquetesQueViajan(recursos) {
  const encontrados = new Set();
  for (const origen of Object.keys(recursos)) {
    const m = origen.match(/^\.\.\/\.\.\/\.\.\/packages\/([a-z-]+)\/src\/\*\*\/\*$/);
    if (m) encontrados.add(m[1]);
  }
  return encontrados;
}

/**
 * El nombre del paquete de un especificador desnudo: `ai/test` es `ai`, y
 * `@ai-sdk/anthropic/internal` es `@ai-sdk/anthropic`.
 */
function paqueteDe(especificador) {
  const partes = especificador.split("/");
  return especificador.startsWith("@") ? `${partes[0]}/${partes[1]}` : partes[0];
}

/**
 * Los especificadores desnudos de un paquete que viaja, con el archivo donde
 * estan. Mira imports ESTATICOS Y DINAMICOS: la frontera con el SDK usa
 * `await import("ai")` a proposito —para poder declarar su ausencia en vez de
 * reventar al cargar— y una guarda que solo mirase los estaticos no veria
 * ninguno de los dos paquetes que de verdad tienen que viajar.
 */
function desnudosDe(paquete) {
  const encontrados = [];
  for (const base of ["src", "bin"]) {
    const dir = join(RAIZ, "packages", paquete, base);
    if (!existsSync(dir)) continue;
    for (const archivo of fuentes(dir)) {
      const texto = readFileSync(archivo, "utf8")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of texto.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
        if (m[1].startsWith(".") || m[1].startsWith("node:")) continue;
        encontrados.push({ archivo: archivo.slice(RAIZ.length), especificador: m[1] });
      }
    }
  }
  return encontrados;
}

/** La entrada de recurso que le corresponde a un paquete de `node_modules`. */
const origenDeTercero = (paquete) => `../../../node_modules/${paquete}/**/*`;
const destinoDeTercero = (paquete) => `node_modules/${paquete}/`;

/** Los paquetes de terceros declarados como recursos, leidos de la configuracion. */
function tercerosDeclarados(recursos) {
  const encontrados = new Set();
  for (const origen of Object.keys(recursos)) {
    const m = origen.match(/^\.\.\/\.\.\/\.\.\/node_modules\/(.+)\/\*\*\/\*$/);
    if (m) encontrados.add(m[1]);
  }
  return encontrados;
}

test("EL AGUJERO: un especificador desnudo en un paquete que viaja tiene que estar declarado como recurso", () => {
  const recursos = JSON.parse(readFileSync(CONFIG, "utf8")).bundle?.resources ?? {};
  const viajan = paquetesQueViajan(recursos);
  const declarados = tercerosDeclarados(recursos);

  // Sin esto el test es vacio: si `paquetesQueViajan` dejara de emparejar, no
  // habria donde buscar y el bucle no comprobaria nada.
  assert.ok(viajan.size >= 5, `solo ${viajan.size} paquetes viajan al escritorio: la configuracion cambio de forma`);

  const faltan = [];
  let mirados = 0;
  for (const paquete of viajan) {
    for (const { archivo, especificador } of desnudosDe(paquete)) {
      mirados++;
      const tercero = paqueteDe(especificador);
      if (declarados.has(tercero)) continue;
      faltan.push(
        `${archivo}: importa \`${especificador}\` y \`${tercero}\` no viaja al escritorio.\n` +
          `  Declara \`${origenDeTercero(tercero)}\` hacia \`${destinoDeTercero(tercero)}\` en bundle.resources, ` +
          "o saca el import del paquete que viaja.",
      );
    }
  }

  assert.deepEqual(
    faltan,
    [],
    "hay especificadores desnudos que resuelven en el repositorio y no en la aplicacion instalada:\n" +
      faltan.join("\n") +
      "\nEn el bundle no hay `node_modules`: lo que no se declara no viaja, y el sintoma es " +
      "`ERR_MODULE_NOT_FOUND` al abrir la aplicacion, que el operador ve como una ventana que no abre.",
  );

  // El contador se afirma DESPUES de la comprobacion util, y solo si hay algun
  // tercero declarado: mientras no haya ninguno, cero desnudos es la verdad.
  if (declarados.size > 0) {
    assert.ok(
      mirados > 0,
      "hay paquetes de terceros declarados como recursos y ningun import desnudo que los justifique: " +
        "o esta guarda dejo de encontrar los imports, o el instalador esta engordando con codigo muerto",
    );
  }
});

test("cada tercero declarado aterriza donde el import lo busca: la RAIZ de recursos, no `packages/`", () => {
  // La misma mitad que ya costo algo con los paquetes del monorepo. Node
  // resuelve un especificador desnudo subiendo directorios desde el archivo que
  // lo importa: desde `<recursos>/asistencia/src/` sube a
  // `<recursos>/asistencia/node_modules`, luego a `<recursos>/node_modules`.
  // Declararlo en cualquier otro destino empaqueta el archivo correcto en el
  // sitio equivocado, y el sintoma es identico al de no empaquetarlo.
  const recursos = JSON.parse(readFileSync(CONFIG, "utf8")).bundle?.resources ?? {};
  for (const paquete of tercerosDeclarados(recursos)) {
    assert.equal(
      recursos[origenDeTercero(paquete)],
      destinoDeTercero(paquete),
      `el recurso de \`${paquete}\` no aterriza en \`${destinoDeTercero(paquete)}\`, que es donde Node lo busca`,
    );
  }
});

test("LO DECLARADO BASTA: el subarbol declarado se importa FUERA del repositorio, con un Node limpio", () => {
  // Esta es la unica prueba de este archivo que no se puede pasar por descuido.
  // Todo lo demas compara dos listas; esto monta el bundle y lo ejercita. La
  // diferencia importa porque la dependencia de un paquete de terceros no se
  // lee de su `package.json` y ya: `ai` importa `zod/v4`, que es un `peer` y no
  // aparece en `dependencies`. Una guarda que caminara los manifiestos daria
  // por cerrada una lista a la que le falta un paquete de ocho megas, y el
  // fallo volveria a aparecer solo en la aplicacion instalada.
  const recursos = JSON.parse(readFileSync(CONFIG, "utf8")).bundle?.resources ?? {};
  const declarados = [...tercerosDeclarados(recursos)];
  const viajan = paquetesQueViajan(recursos);

  const especificadores = new Set();
  for (const paquete of viajan) for (const d of desnudosDe(paquete)) especificadores.add(d.especificador);

  if (declarados.length === 0 && especificadores.size === 0) {
    // Nada que probar todavia, y eso es un estado legitimo: hasta la
    // asistencia con IA, al escritorio no viajaba ni una linea de terceros.
    return;
  }
  assert.ok(especificadores.size > 0, "hay terceros declarados y ningun import que los use");

  // El banco de pruebas va en `tmpdir` a proposito: dentro del repositorio,
  // Node subiria hasta `<repo>/node_modules` y encontraria TODO, con lo que la
  // prueba pasaria siempre y no probaria nada.
  const banco = mkdtempSync(join(tmpdir(), "noxloop-bundle-"));
  try {
    for (const paquete of declarados) {
      const origen = join(RAIZ, "node_modules", paquete);
      assert.ok(existsSync(origen), `\`${paquete}\` esta declarado como recurso y no esta en node_modules`);
      const destino = join(banco, "node_modules", paquete);
      mkdirSync(dirname(destino), { recursive: true });
      // `COPYFILE_FICLONE` para que copiar veintitantos megas en cada `npm test`
      // no se note: en APFS y en btrfs es copia en escritura.
      cpSync(origen, destino, { recursive: true, mode: constants.COPYFILE_FICLONE });
    }

    // El archivo que importa vive donde vivira en el bundle: un paquete del
    // monorepo colgando de la raiz de recursos, no dentro de `node_modules`.
    const comoEnElBundle = join(banco, "asistencia", "src");
    mkdirSync(comoEnElBundle, { recursive: true });
    const importador = join(comoEnElBundle, "importa.mjs");
    writeFileSync(
      importador,
      [...especificadores].map((e) => `await import(${JSON.stringify(e)});`).join("\n") + "\nconsole.log('ok');\n",
    );

    let salida;
    try {
      salida = execFileSync(process.execPath, [importador], { encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      assert.fail(
        "lo declarado en `bundle.resources` NO basta para importar lo que el sidecar importa.\n" +
          `Especificadores: ${[...especificadores].join(", ")}\n` +
          `Declarados: ${declarados.join(", ")}\n` +
          `Node dijo:\n${String(e.stderr || e.message).slice(0, 1500)}\n` +
          "Declara tambien el paquete que falta. No lo busques en `dependencies`: los `peer` no estan ahi.",
      );
    }
    assert.match(salida, /ok/);
  } finally {
    rmSync(banco, { recursive: true, force: true });
  }
});

test("el coste del subarbol de terceros esta medido y acotado, no descubierto en el instalador", () => {
  // Un paquete de terceros que viaja no cuesta una linea de configuracion:
  // cuesta su subarbol entero dentro del instalador que el operador descarga.
  // El tope no es un numero bonito — es lo que obliga a que la proxima
  // dependencia sea una decision con su cuenta delante, en vez de una entrada
  // mas en una lista que ya nadie lee.
  // 30 MB sobre los 19.7 que pesan hoy los doce paquetes del AI SDK. El margen
  // es para una version que crezca, no para una dependencia mas: la siguiente
  // tiene que tocar este numero, y tocarlo es la conversacion.
  const TOPE_MB = 30;
  const recursos = JSON.parse(readFileSync(CONFIG, "utf8")).bundle?.resources ?? {};
  const declarados = [...tercerosDeclarados(recursos)];
  if (declarados.length === 0) return;

  /** @param {string} dir */
  const pesar = (dir) => {
    let total = 0;
    for (const entrada of readdirSync(dir)) {
      const p = join(dir, entrada);
      const st = statSync(p);
      total += st.isDirectory() ? pesar(p) : st.size;
    }
    return total;
  };

  const detalle = declarados
    .map((p) => ({ p, mb: pesar(join(RAIZ, "node_modules", p)) / 1024 / 1024 }))
    .sort((a, b) => b.mb - a.mb);
  const total = detalle.reduce((s, d) => s + d.mb, 0);

  assert.ok(
    total <= TOPE_MB,
    `el subarbol de terceros que viaja al escritorio pesa ${total.toFixed(1)} MB y el tope declarado es ` +
      `${TOPE_MB} MB.\n${detalle.map((d) => `  ${d.p}: ${d.mb.toFixed(1)} MB`).join("\n")}\n` +
      "Si la dependencia nueva hace falta, sube el tope EN ESTE TEST y di por que en el informe: lo que no " +
      "puede pasar es que el instalador crezca sin que nadie lo decida.",
  );
});
