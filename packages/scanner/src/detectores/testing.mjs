// Detector de testing: runner, donde viven los tests, umbral de cobertura
// declarado y proporcion entre test y produccion.
//
// ESTE ES EL DETECTOR DONDE LA TERCERA REGLA IMPORTA MAS. Un repositorio sin
// tests emite `testing.runner = null` con la constancia de que se busco. La
// tentacion de rellenar es enorme justamente aqui: casi todos los proyectos de
// Node usan uno de cuatro runners, y acertar por probabilidad funciona muchas
// veces. Las veces que falla, el resultado no es un dato equivocado: es una
// constitution que le exige al proyecto correr un runner que no tiene, y un
// gate que nunca va a poder pasar.
//
// POR QUE EL RUNNER SE LEE DEL SCRIPT Y NO SE PRUEBA. Porque probarlo seria
// ejecutar los tests del proyecto, que es lo primero que el contrato prohibe:
// ejecutar codigo ajeno con los permisos del operador. Lo que el manifiesto
// declara es lo que hay; lo que pase al correrlo no se sabe, y no se supone.

import { detectado, inferido, vacio } from "../hallazgo.mjs";

/** Como se reconoce un runner en la linea de comandos que lo lanza. */
const RUNNERS = Object.freeze([
  { id: "node --test", re: /\bnode\b[^&|]*--test\b/ },
  { id: "vitest", re: /\bvitest\b/ },
  { id: "jest", re: /\bjest\b/ },
  { id: "mocha", re: /\bmocha\b/ },
  { id: "ava", re: /\bava\b/ },
  { id: "tap", re: /\btap\b/ },
  { id: "playwright", re: /\bplaywright\s+test\b/ },
  { id: "cypress", re: /\bcypress\s+run\b/ },
  { id: "pytest", re: /\bpytest\b/ },
  { id: "unittest", re: /\bpython\b[^&|]*-m\s+unittest\b/ },
  { id: "cargo test", re: /\bcargo\s+test\b/ },
  { id: "go test", re: /\bgo\s+test\b/ },
  { id: "maven", re: /\bmvn\b[^&|]*\b(?:test|verify)\b/ },
  { id: "gradle", re: /\bgradle\w*\b[^&|]*\btest\b/ },
  { id: "rspec", re: /\brspec\b/ },
  { id: "phpunit", re: /\bphpunit\b/ },
  { id: "dotnet test", re: /\bdotnet\s+test\b/ },
]);

/** Donde se declara un umbral de cobertura, por archivo y por forma. */
const UMBRALES = Object.freeze([
  { archivo: "package.json", re: /"(?:lines|statements|branches|functions|global)"\s*:\s*([0-9]{1,3})/ },
  { archivo: "package.json", re: /--test-coverage-lines[= ]([0-9]{1,3})/ },
  { archivo: "package.json", re: /--(?:lines|branches|functions|statements)[= ]([0-9]{1,3})/ },
  { archivo: "pyproject.toml", re: /^\s*fail_under\s*=\s*([0-9]{1,3})/ },
  { archivo: "setup.cfg", re: /^\s*fail_under\s*=\s*([0-9]{1,3})/ },
  { archivo: ".coveragerc", re: /^\s*fail_under\s*=\s*([0-9]{1,3})/ },
  { archivo: ".nycrc", re: /"(?:lines|statements|branches|functions)"\s*:\s*([0-9]{1,3})/ },
  { archivo: "codecov.yml", re: /^\s*target:\s*([0-9]{1,3})/ },
  { archivo: ".codecov.yml", re: /^\s*target:\s*([0-9]{1,3})/ },
]);

const CONFIGURACIONES_DE_TEST = ["jest.config", "vitest.config", "karma.conf", "playwright.config", "cypress.config", "ava.config"];

/** Como se reconoce un archivo de test por su nombre, en cualquier ecosistema. */
const NOMBRE_DE_TEST = /(?:^|[/.])(?:test|spec)[_.-]|[_.-](?:test|spec)\.|^test_|_test\.|\.(?:test|spec)\./i;
const DIRECTORIO_DE_TEST = /(?:^|\/)(?:tests?|spec|specs|__tests__)(?:\/|$)/;

/** Extensiones que cuentan como codigo a la hora de medir la proporcion. */
const CODIGO = new Set([".mjs", ".cjs", ".js", ".jsx", ".ts", ".tsx", ".py", ".rs", ".go", ".rb", ".java", ".kt", ".php", ".cs", ".swift", ".ex"]);

/**
 * @param {import("../contexto.mjs").Contexto} ctx
 */
function archivosDeTest(ctx) {
  return ctx.archivos.filter(
    (a) => CODIGO.has(a.ext) && (NOMBRE_DE_TEST.test(a.nombre) || DIRECTORIO_DE_TEST.test(a.ruta)),
  );
}

/**
 * @param {import("../contexto.mjs").Contexto} ctx
 * @param {ReturnType<typeof archivosDeTest>} tests
 */
function runner(ctx, tests) {
  // 1. Lo que el manifiesto declara. Es lo unico que es un hecho.
  for (const manifiesto of ctx.porNombre("package.json")) {
    if (manifiesto.includes("/")) continue;
    const paquete = ctx.json(manifiesto);
    const script = paquete?.scripts?.test;
    if (typeof script !== "string" || !script.trim()) continue;
    const encontrado = RUNNERS.find((r) => r.re.test(script));
    const linea = ctx.lineaDeClave(manifiesto, "test");
    return detectado(
      "testing",
      "testing.runner",
      encontrado ? encontrado.id : script.trim(),
      [{ ruta: manifiesto, linea, extracto: script.trim() }],
      encontrado ? "alta" : "media",
    );
  }

  // 2. Un archivo de configuracion del runner: tambien es un hecho escrito.
  for (const { archivo, id } of [
    { archivo: "pytest.ini", id: "pytest" },
    { archivo: "tox.ini", id: "tox" },
    { archivo: "conftest.py", id: "pytest" },
    { archivo: "phpunit.xml", id: "phpunit" },
    { archivo: ".rspec", id: "rspec" },
  ]) {
    const [ruta] = ctx.porNombre(archivo);
    if (ruta) return detectado("testing", "testing.runner", id, [{ ruta }]);
  }
  for (const base of CONFIGURACIONES_DE_TEST) {
    const ruta = ctx.archivos.find((a) => a.nombre.startsWith(base))?.ruta;
    if (ruta) return detectado("testing", "testing.runner", base.split(".")[0], [{ ruta }]);
  }

  // 3. La forma del arbol. Aqui ya no hay nada escrito, asi que va inferido:
  // `cargo test` y `go test` son el runner por convencion del ecosistema, no
  // algo que este proyecto haya declarado en ningun sitio.
  if (ctx.porNombre("Cargo.toml").length > 0 && tests.length > 0) {
    return inferido("testing", "testing.runner", "cargo test", [{ ruta: ctx.porNombre("Cargo.toml")[0] }], "media");
  }
  if (ctx.porNombre("go.mod").length > 0 && tests.some((t) => t.nombre.endsWith("_test.go"))) {
    return inferido("testing", "testing.runner", "go test", [{ ruta: ctx.porNombre("go.mod")[0] }], "media");
  }

  return vacio(
    "testing",
    "testing.runner",
    [{ ruta: "." }],
    "Se busco un script `test` en los manifiestos de la raiz, los archivos de configuracion de los runners " +
      `conocidos (${RUNNERS.map((r) => r.id).slice(0, 6).join(", ")}...) y las convenciones de cada ecosistema, ` +
      "y no hay ninguno. El proyecto no declara como se corren sus tests. No se supone uno: un gate contra un " +
      "runner supuesto no puede pasar nunca.",
  );
}

/**
 * @param {import("../contexto.mjs").Contexto} ctx
 */
function umbralDeCobertura(ctx) {
  for (const { archivo, re } of UMBRALES) {
    for (const ruta of ctx.porNombre(archivo)) {
      if (ruta.includes("/")) continue;
      const encontrado = ctx.buscarTodas(ruta, re, 1)[0];
      if (!encontrado) continue;
      return detectado(
        "testing",
        "testing.umbral_cobertura",
        Number(encontrado.captura[1]),
        [{ ruta, linea: encontrado.linea, extracto: encontrado.extracto }],
      );
    }
  }
  return vacio(
    "testing",
    "testing.umbral_cobertura",
    [{ ruta: "." }],
    "Se busco un umbral de cobertura declarado en los sitios donde se declara " +
      `(${[...new Set(UMBRALES.map((u) => u.archivo))].join(", ")}) y no hay ninguno. El proyecto mide cobertura ` +
      "sin gatearla, o no la mide: las dos cosas son informacion, y una cifra inventada no lo seria.",
  );
}

/**
 * @param {import("../contexto.mjs").Contexto} ctx
 */
function detectar(ctx) {
  const tests = archivosDeTest(ctx);
  const hallazgos = [runner(ctx, tests), umbralDeCobertura(ctx)];

  if (tests.length === 0) {
    hallazgos.push(
      vacio(
        "testing",
        "testing.ubicacion",
        [{ ruta: "." }],
        "Se recorrio el arbol entero buscando archivos con forma de test (nombre con `test` o `spec`, o bajo un " +
          "directorio `test/`, `tests/`, `spec/` o `__tests__/`) y no hay ninguno. El proyecto no tiene tests, y " +
          "eso es un hecho comprobado, no un dato que falte.",
      ),
      vacio(
        "testing",
        "testing.proporcion",
        [{ ruta: "." }],
        "No hay archivos de test, asi que no hay proporcion que medir. Un cero aqui seria una medida; una " +
          "proporcion inventada no lo seria.",
      ),
    );
    return hallazgos;
  }

  const directorios = [...new Set(tests.map((t) => (t.ruta.includes("/") ? t.ruta.slice(0, t.ruta.lastIndexOf("/")) : ".")))].sort();
  hallazgos.push(
    detectado(
      "testing",
      "testing.ubicacion",
      { directorios, archivos: tests.length },
      tests.slice(0, 5).map((t) => ({ ruta: t.ruta })),
    ),
  );

  const produccion = ctx.archivos.filter((a) => CODIGO.has(a.ext)).length - tests.length;
  hallazgos.push(
    detectado(
      "testing",
      "testing.proporcion",
      {
        archivos_de_test: tests.length,
        archivos_de_produccion: Math.max(produccion, 0),
        proporcion: produccion > 0 ? Math.round((tests.length / produccion) * 100) / 100 : null,
      },
      tests.slice(0, 3).map((t) => ({ ruta: t.ruta })),
    ),
  );

  return hallazgos;
}

/** @type {import("../scanner.mjs").Detector} */
const detector = { nombre: "testing", fase: "testing", detectar };
export default detector;
