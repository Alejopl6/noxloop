// Utilidades de los tests del scanner. Nada de esto es codigo del paquete: son
// los andamios que montan repositorios de verdad para ejercerlo.
//
// POR QUE REPOSITORIOS DE VERDAD Y NO UN FALSO SISTEMA DE ARCHIVOS. Porque la
// promesa del scanner —que no escribe— solo se puede probar contra un disco
// real: un doble de `fs` prueba que el scanner no llama a las funciones que el
// doble conoce, que es una afirmacion mucho mas pobre. El test tiene que poder
// mirar inodos y mtime despues, y eso exige archivos.

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readdirSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative, sep } from "node:path";

/** Identidad fija para los commits de los fixtures: sin ella `git commit` falla en CI. */
const IDENTIDAD = ["-c", "user.email=scanner@test.invalid", "-c", "user.name=scanner"];

/**
 * @param {string[]} args
 * @param {string} cwd
 */
export function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Crea un arbol de archivos en un directorio temporal.
 *
 * @param {Record<string, string>} archivos ruta relativa -> contenido
 * @param {{ git?: boolean }} [opts]
 * @returns {string} la raiz
 */
export function arbolTemporal(archivos, opts = {}) {
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-scanner-"));
  escribir(raiz, archivos);
  if (opts.git !== false) {
    git(["init", "-q", "-b", "main"], raiz);
    git([...IDENTIDAD, "add", "-A"], raiz);
    git([...IDENTIDAD, "commit", "-q", "-m", "fixture"], raiz);
  }
  return raiz;
}

/**
 * @param {string} raiz
 * @param {Record<string, string>} archivos
 */
export function escribir(raiz, archivos) {
  for (const [ruta, contenido] of Object.entries(archivos)) {
    const destino = join(raiz, ruta);
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, contenido);
  }
}

/**
 * @param {string} raiz
 * @param {string} destino
 * @param {string} enlace
 */
export function enlazar(raiz, destino, enlace) {
  const ruta = join(raiz, enlace);
  mkdirSync(dirname(ruta), { recursive: true });
  symlinkSync(destino, ruta);
}

/** El estado de git tal cual, que es el objeto que prueba la promesa. */
export function estadoGit(raiz) {
  return git(["status", "--porcelain"], raiz);
}

/**
 * Huella del arbol COMPLETO, incluidos los archivos que git ignora.
 *
 * `git status` no ve lo ignorado, asi que por si solo no puede probar que el
 * scanner no toco `node_modules/` o un `.env`. Inodo, mtime, tamano y modo si
 * lo ven: un archivo reescrito con el mismo contenido cambia mtime, y uno
 * reemplazado por un temporal + rename cambia el inodo.
 *
 * `atime` queda deliberadamente fuera: leer un archivo lo mueve, y leer es
 * exactamente lo que el scanner tiene permitido hacer.
 *
 * @param {string} raiz
 * @returns {Map<string, string>}
 */
export function huellaDelArbol(raiz) {
  /** @type {Map<string, string>} */
  const huella = new Map();
  /** @param {string} dir */
  const recorrer = (dir) => {
    for (const nombre of readdirSync(dir).sort()) {
      const p = join(dir, nombre);
      const st = lstatSync(p);
      const clave = relative(raiz, p).split(sep).join("/");
      huella.set(clave, `${st.ino}:${st.mtimeMs}:${st.size}:${st.mode}:${st.isDirectory() ? "d" : "f"}`);
      if (st.isDirectory() && !st.isSymbolicLink()) recorrer(p);
    }
  };
  recorrer(raiz);
  return huella;
}

/** La diferencia entre dos huellas, en texto, para que el fallo diga QUE se toco. */
export function diferencias(antes, despues) {
  const cambios = [];
  for (const [ruta, valor] of despues) {
    if (!antes.has(ruta)) cambios.push(`creado: ${ruta}`);
    else if (antes.get(ruta) !== valor) cambios.push(`modificado: ${ruta} (${antes.get(ruta)} -> ${valor})`);
  }
  for (const ruta of antes.keys()) if (!despues.has(ruta)) cambios.push(`borrado: ${ruta}`);
  return cambios;
}

// ---------------------------------------------------------------------------
// Fixtures por ecosistema. La promesa se prueba "sobre repositorios de varios
// ecosistemas" porque cada ecosistema tiene un detector distinto leyendolo, y
// un detector que escribe —una cache, un lockfile resuelto— solo aparece
// cuando el manifiesto que lo despierta esta presente.
// ---------------------------------------------------------------------------

/** @type {Record<string, Record<string, string>>} */
export const ECOSISTEMAS = {
  node: {
    "package.json": JSON.stringify(
      {
        name: "ejemplo",
        version: "1.0.0",
        type: "module",
        engines: { node: ">=20" },
        scripts: { test: "node --test" },
        dependencies: { izquierda: "1.2.3" },
        devDependencies: { derecha: "^4.0.0" },
      },
      null,
      2,
    ),
    "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: {} }, null, 2),
    "src/index.mjs": "export const saludo = () => 'hola';\n",
    "test/index.test.mjs": "import { test } from 'node:test';\ntest('vive', () => {});\n",
    ".github/workflows/ci.yml": "name: ci\non:\n  pull_request:\njobs:\n  test:\n    steps:\n      - run: npm test\n",
    "CONTRIBUTING.md": "# Como contribuir\n",
  },
  rust: {
    "Cargo.toml": '[package]\nname = "ejemplo"\nversion = "0.1.0"\nrust-version = "1.75"\n\n[dependencies]\nserde = "1"\n',
    "Cargo.lock": '# generado\n[[package]]\nname = "ejemplo"\n',
    "src/main.rs": "fn main() { println!(\"hola\"); }\n",
    "tests/integracion.rs": "#[test]\nfn vive() {}\n",
  },
  go: {
    "go.mod": "module ejemplo\n\ngo 1.22\n\nrequire otra/cosa v1.4.0\n",
    "go.sum": "otra/cosa v1.4.0 h1:xxxx=\n",
    "main.go": "package main\n\nfunc main() {}\n",
    "main_test.go": "package main\n\nimport \"testing\"\n\nfunc TestVive(t *testing.T) {}\n",
  },
  python: {
    "pyproject.toml":
      '[project]\nname = "ejemplo"\nrequires-python = ">=3.11"\ndependencies = ["peticiones==2.31.0"]\n\n[tool.coverage.report]\nfail_under = 85\n',
    "requirements.txt": "peticiones==2.31.0\notra>=1.0\n",
    "src/ejemplo/__init__.py": "VALOR = 1\n",
    "tests/test_ejemplo.py": "def test_vive():\n    assert True\n",
  },
  vacio: {
    ".vacio": "",
  },
};

/**
 * @param {string} nombre
 * @param {Record<string, string>} [extra]
 */
export function repoDe(nombre, extra = {}) {
  return arbolTemporal({ ...ECOSISTEMAS[nombre], ...extra });
}
