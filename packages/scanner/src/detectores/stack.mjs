// Detector de stack: que ecosistemas hay, con que version del runtime y con
// que gestor de paquetes.
//
// POR QUE EL CONOCIMIENTO ESTA EN UNA TABLA Y NO EN EL CODIGO. Porque soportar
// un ecosistema mas tiene que ser una fila, no una rama. Es el principio VII
// —la configuracion es datos, el motor es codigo— aplicado al unico sitio del
// scanner donde se acumula conocimiento del mundo exterior. Un detector escrito
// con `if (existe("package.json")) ... else if (existe("Cargo.toml"))` crece a
// doce ramas y la trece se escribe copiando la doce.
//
// LO QUE ESTE DETECTOR NO HACE, Y ES LA MITAD DE SU VALOR. No resuelve
// dependencias, no consulta un registro, no corre el gestor de paquetes. Un
// `npm ls` para saber que versiones hay de verdad escribiria en el arbol,
// tardaria minutos y puede ejecutar scripts de instalacion. Lo que dice el
// manifiesto es lo que se detecta; lo que esta instalado no se sabe, y no se
// inventa.

import { detectado, inferido, vacio } from "../hallazgo.mjs";

/**
 * @typedef {object} Ecosistema
 * @property {string} id
 * @property {string[]} manifiestos nombres de archivo que lo declaran
 * @property {Record<string, string>} lockfiles archivo -> gestor que lo escribe
 * @property {{archivo: string, re: RegExp}[]} [versiones] donde se fija la version del runtime
 */

/**
 * Tipa cada fila de la tabla por separado.
 *
 * POR QUE EL RODEO. Sin el, el tipo de la tabla es la union de nueve literales
 * distintos y cada campo que no aparece en todos se contamina con `undefined`:
 * el comprobador deja de validar las filas contra `Ecosistema`, que es
 * exactamente lo unico que esta tabla tiene que garantizar. Una fila nueva mal
 * escrita pasaria sin que nadie se enterara hasta que el detector devuelve
 * `undefined` en tiempo de ejecucion.
 *
 * @param {Ecosistema} ecosistema
 * @returns {Ecosistema}
 */
const fila = (ecosistema) => ecosistema;

/** @type {readonly Ecosistema[]} */
export const ECOSISTEMAS = Object.freeze([
  fila({
    id: "node",
    manifiestos: ["package.json"],
    lockfiles: {
      "package-lock.json": "npm",
      "npm-shrinkwrap.json": "npm",
      "yarn.lock": "yarn",
      "pnpm-lock.yaml": "pnpm",
      "bun.lockb": "bun",
      "bun.lock": "bun",
    },
    versiones: [
      { archivo: "package.json", re: /^\s*"node"\s*:\s*"([^"]+)"/ },
      { archivo: ".nvmrc", re: /^\s*v?([0-9][^\s]*)/ },
      { archivo: ".node-version", re: /^\s*v?([0-9][^\s]*)/ },
    ],
  }),
  fila({
    id: "rust",
    manifiestos: ["Cargo.toml"],
    lockfiles: { "Cargo.lock": "cargo" },
    versiones: [
      { archivo: "Cargo.toml", re: /^\s*rust-version\s*=\s*"([^"]+)"/ },
      { archivo: "rust-toolchain.toml", re: /^\s*channel\s*=\s*"([^"]+)"/ },
    ],
  }),
  fila({
    id: "go",
    manifiestos: ["go.mod"],
    lockfiles: { "go.sum": "go" },
    versiones: [{ archivo: "go.mod", re: /^\s*go\s+([0-9][^\s]*)/ }],
  }),
  fila({
    id: "python",
    manifiestos: ["pyproject.toml", "requirements.txt", "Pipfile", "setup.py", "setup.cfg"],
    lockfiles: { "poetry.lock": "poetry", "Pipfile.lock": "pipenv", "uv.lock": "uv", "pdm.lock": "pdm" },
    versiones: [
      { archivo: "pyproject.toml", re: /^\s*requires-python\s*=\s*"([^"]+)"/ },
      { archivo: "setup.cfg", re: /^\s*python_requires\s*=\s*(.+)$/ },
      { archivo: ".python-version", re: /^\s*([0-9][^\s]*)/ },
    ],
  }),
  fila({
    id: "java",
    manifiestos: ["pom.xml", "build.gradle", "build.gradle.kts"],
    lockfiles: { "gradle.lockfile": "gradle" },
    versiones: [{ archivo: ".java-version", re: /^\s*([0-9][^\s]*)/ }],
  }),
  fila({
    id: "ruby",
    manifiestos: ["Gemfile"],
    lockfiles: { "Gemfile.lock": "bundler" },
    versiones: [{ archivo: ".ruby-version", re: /^\s*([0-9][^\s]*)/ }],
  }),
  fila({ id: "php", manifiestos: ["composer.json"], lockfiles: { "composer.lock": "composer" }, versiones: [] }),
  fila({ id: "elixir", manifiestos: ["mix.exs"], lockfiles: { "mix.lock": "hex" }, versiones: [] }),
  fila({ id: "dart", manifiestos: ["pubspec.yaml"], lockfiles: { "pubspec.lock": "pub" }, versiones: [] }),
]);

/** Cuantos manifiestos se citan como evidencia antes de que la lista deje de aportar. */
const MAXIMA_EVIDENCIA = 5;

/**
 * @param {import("../contexto.mjs").Contexto} ctx
 */
function detectar(ctx) {
  const hallazgos = [];

  /** @type {string[]} */
  const presentes = [];
  /** @type {any[]} */
  const evidenciaDeStack = [];
  /** @type {Map<string, string[]>} */
  const manifiestosDe = new Map();

  for (const eco of ECOSISTEMAS) {
    const encontrados = eco.manifiestos.flatMap((nombre) => ctx.porNombre(nombre));
    if (encontrados.length === 0) continue;
    presentes.push(eco.id);
    manifiestosDe.set(eco.id, encontrados);
    // La raiz primero: en un monorepo es la que define el proyecto, y una
    // evidencia que apunta a `apps/algo/package.json` no dice lo mismo.
    for (const ruta of encontrados.sort((a, b) => a.split("/").length - b.split("/").length).slice(0, MAXIMA_EVIDENCIA)) {
      evidenciaDeStack.push({ ruta });
    }
  }

  if (presentes.length === 0) {
    hallazgos.push(
      vacio(
        "stack",
        "stack.ecosistemas",
        [{ ruta: "." }],
        `Se busco en todo el arbol cualquiera de los ${ECOSISTEMAS.length} manifiestos conocidos ` +
          `(${ECOSISTEMAS.flatMap((e) => e.manifiestos).join(", ")}) y no hay ninguno. El proyecto usa un ` +
          "ecosistema que este scanner todavia no conoce, o todavia no tiene manifiesto.",
        [],
      ),
    );
  } else {
    hallazgos.push(detectado("stack", "stack.ecosistemas", presentes, evidenciaDeStack));
  }

  // --- Version del runtime, por ecosistema presente -----------------------
  for (const eco of ECOSISTEMAS) {
    if (!presentes.includes(eco.id)) continue;
    /** @type {any} */
    let encontrada = null;
    for (const { archivo, re } of eco.versiones ?? []) {
      for (const ruta of ctx.porNombre(archivo)) {
        const linea = ctx.buscarTodas(ruta, re, 1)[0];
        if (linea) {
          encontrada = { version: linea.captura[1].trim(), ruta, linea: linea.linea, extracto: linea.extracto };
          break;
        }
      }
      if (encontrada) break;
    }
    if (encontrada) {
      hallazgos.push(
        detectado("stack", `runtime.${eco.id}`, encontrada.version, [
          { ruta: encontrada.ruta, linea: encontrada.linea, extracto: encontrada.extracto },
        ]),
      );
    } else {
      hallazgos.push(
        vacio(
          "stack",
          `runtime.${eco.id}`,
          (manifiestosDe.get(eco.id) ?? []).slice(0, MAXIMA_EVIDENCIA).map((ruta) => ({ ruta })),
          `El proyecto usa ${eco.id} pero ningun archivo fija la version del runtime. Lo que este instalado ` +
            "en la maquina no se detecta: el scanner no ejecuta nada, y una version supuesta es peor que ninguna.",
        ),
      );
    }
  }

  // --- Modulos ES o CommonJS ----------------------------------------------
  if (presentes.includes("node")) {
    const manifiesto = ctx.tiene("package.json") ? "package.json" : (manifiestosDe.get("node") ?? [])[0];
    const paquete = manifiesto ? ctx.json(manifiesto) : null;
    if (paquete && typeof paquete.type === "string") {
      hallazgos.push(
        detectado("stack", "stack.modulos", paquete.type === "module" ? "esm" : "commonjs", [
          { ruta: manifiesto, linea: ctx.lineaDeClave(manifiesto, "type") },
        ]),
      );
    } else if (manifiesto) {
      // El defecto del runtime es CommonJS, pero eso es una regla del runtime,
      // no algo que el proyecto declare: va como inferido, que es lo que es.
      hallazgos.push(
        inferido("stack", "stack.modulos", "commonjs", [{ ruta: manifiesto }], "media"),
      );
    }
  }

  // --- Gestor de paquetes --------------------------------------------------
  /** @type {any[]} */
  const evidenciaGestores = [];
  /** @type {Set<string>} */
  const gestores = new Set();
  for (const eco of ECOSISTEMAS) {
    for (const [archivo, gestor] of Object.entries(eco.lockfiles)) {
      for (const ruta of ctx.porNombre(archivo)) {
        if (ruta.includes("/")) continue; // un lockfile anidado no define el proyecto
        gestores.add(gestor);
        evidenciaGestores.push({ ruta });
      }
    }
  }
  const declarado = ctx.tiene("package.json") ? ctx.json("package.json")?.packageManager : null;
  if (typeof declarado === "string") {
    gestores.add(declarado.split("@")[0]);
    evidenciaGestores.push({ ruta: "package.json", linea: ctx.lineaDeClave("package.json", "packageManager") });
  }

  if (gestores.size > 0) {
    hallazgos.push(
      detectado("stack", "stack.gestor_paquetes", [...gestores], evidenciaGestores, gestores.size > 1 ? "media" : "alta"),
    );
  } else if (presentes.length > 0) {
    hallazgos.push(
      vacio(
        "stack",
        "stack.gestor_paquetes",
        evidenciaDeStack.slice(0, MAXIMA_EVIDENCIA),
        "Hay manifiesto pero no hay lockfile en la raiz. Sin lockfile no se puede saber que gestor escribio las " +
          "versiones, y —mas importante— las dependencias no estan fijadas para quien clone el repositorio.",
        [],
      ),
    );
  }

  // --- Dependencias directas ----------------------------------------------
  hallazgos.push(...dependencias(ctx, presentes));

  return hallazgos;
}

/**
 * @param {import("../contexto.mjs").Contexto} ctx
 * @param {string[]} presentes
 */
function dependencias(ctx, presentes) {
  /** @type {Record<string, string[]>} */
  const porEcosistema = {};
  /** @type {any[]} */
  const evidencia = [];

  if (presentes.includes("node") && ctx.tiene("package.json")) {
    const paquete = ctx.json("package.json") ?? {};
    const nombres = [
      ...Object.keys(paquete.dependencies ?? {}),
      ...Object.keys(paquete.devDependencies ?? {}),
      ...Object.keys(paquete.peerDependencies ?? {}),
      ...Object.keys(paquete.optionalDependencies ?? {}),
    ];
    if (nombres.length > 0) {
      porEcosistema.node = nombres;
      for (const bloque of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        const linea = ctx.lineaDeClave("package.json", bloque);
        if (linea) evidencia.push({ ruta: "package.json", linea });
      }
    }
  }
  if (presentes.includes("python")) {
    for (const ruta of ctx.porNombre("requirements.txt")) {
      const nombres = ctx
        .lineas(ruta)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#") && !l.startsWith("-"))
        .map((l) => l.split(/[<>=!~ ;[]/)[0]);
      if (nombres.length > 0) {
        porEcosistema.python = [...(porEcosistema.python ?? []), ...nombres];
        evidencia.push({ ruta, linea: 1 });
      }
    }
  }
  if (presentes.includes("rust")) {
    for (const ruta of ctx.porNombre("Cargo.toml")) {
      const lineas = ctx.lineas(ruta);
      const inicio = lineas.findIndex((l) => /^\s*\[dependencies\]/.test(l));
      if (inicio === -1) continue;
      const nombres = [];
      for (let i = inicio + 1; i < lineas.length && !/^\s*\[/.test(lineas[i]); i++) {
        const m = lineas[i].match(/^\s*([A-Za-z0-9_-]+)\s*=/);
        if (m) nombres.push(m[1]);
      }
      if (nombres.length > 0) {
        porEcosistema.rust = [...(porEcosistema.rust ?? []), ...nombres];
        evidencia.push({ ruta, linea: inicio + 1 });
      }
    }
  }
  if (presentes.includes("go")) {
    for (const ruta of ctx.porNombre("go.mod")) {
      const lineas = ctx.buscarTodas(ruta, /^\s*(?:require\s+)?([a-z0-9.-]+\/[^\s]+)\s+v[0-9]/);
      if (lineas.length > 0) {
        porEcosistema.go = [...(porEcosistema.go ?? []), ...lineas.map((l) => l.captura[1])];
        evidencia.push({ ruta, linea: lineas[0].linea });
      }
    }
  }

  const total = Object.values(porEcosistema).reduce((n, lista) => n + lista.length, 0);
  if (total === 0) {
    return [
      vacio(
        "dependencias",
        "dependencias.directas",
        [{ ruta: "." }],
        "Se leyeron los manifiestos presentes y ninguno declara dependencias directas. Lo que haya instalado " +
          "en la maquina no cuenta: el scanner no resuelve arboles de dependencias, porque hacerlo escribe.",
        [],
      ),
    ];
  }
  return [detectado("dependencias", "dependencias.directas", { total, por_ecosistema: porEcosistema }, evidencia)];
}

/** @type {import("../scanner.mjs").Detector} */
const detector = { nombre: "stack", fase: "manifiestos", detectar };
export default detector;
