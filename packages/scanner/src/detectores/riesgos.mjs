// Detector de riesgos: secretos en claro, `.env` versionado, dependencias sin
// fijar y ausencia de tests.
//
// EL CASO DEL SECRETO ENCONTRADO, QUE ES LA RAZON DE QUE ESTA FASE EXISTA. Este
// detector emite la ruta y la linea. NO copia el valor: ni al hallazgo, ni al
// log, ni truncado, ni ofuscado. Un snapshot que dice "hay una credencial en
// `.env:3`" es util; uno que ademas la transcribe acaba de crear una segunda
// copia del problema en un almacen nuevo —uno que se sincroniza, se indexa y se
// pinta en una pantalla— y el principio IX dice que ese es el unico fallo de
// este producto sin segundo intento.
//
// Por eso el hallazgo no lleva `extracto`, y por eso el nucleo ademas lo
// arranca por si alguien edita esto sin acordarse: dos capas para el unico
// invariante que no se puede corregir en el ciclo siguiente.
//
// POR QUE HAY UN PREFILTRO BARATO ANTES DE LOS PATRONES. Porque esta fase es la
// unica que mira TODAS las lineas de TODOS los archivos de texto, y NFR-001 da
// sesenta segundos para diez mil archivos. Cinco expresiones regulares por
// linea sobre trescientas mil lineas es donde se va el minuto; una busqueda de
// subcadena que descarta el 95% de las lineas antes de mirarlas, no.

import { detectado, vacio } from "../hallazgo.mjs";
import { formaDeSecreto } from "../redaccion.mjs";

/** La criba barata: si la linea no tiene nada de esto, no puede tener un secreto. */
const PREFILTRO = /secret|token|passwd|password|api|key|clave|contrasena|credential|auth|BEGIN |eyJ|:\/\//i;

/** Archivos que se saltan: su contenido es ruido generado, no codigo de nadie. */
const GENERADOS = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.lock",
  "poetry.lock",
  "Pipfile.lock",
  "composer.lock",
  "Gemfile.lock",
  "go.sum",
  "uv.lock",
  "pdm.lock",
]);

/** Un `.env` de verdad frente a una plantilla para rellenar. */
const ES_ENV = /(?:^|\/)\.env(?:\.[A-Za-z0-9_-]+)*$/;
const ES_PLANTILLA = /\.(?:example|sample|template|dist|tpl)$/i;

/** Mas alla de esto la lista deja de ayudar y empieza a esconder los primeros. */
const MAXIMOS_SECRETOS = 200;
/** Una linea por debajo de esto no cabe una credencial; por encima, es un bundle. */
const LINEAS_POR_ARCHIVO = 5000;

/** Un rango que flota: lo que hoy instala 1.2.3 manana instala 1.3.0 sin que nadie lo decida. */
const RANGO_FLOTANTE = /^(?:\^|~|>=?|<|\*|x|latest|next|\d+\.x|\d+\.\d+\.x)|\|\|/;

/**
 * @param {import("../contexto.mjs").Contexto} ctx
 */
function secretos(ctx) {
  const hallazgos = [];
  let encontrados = 0;

  for (const archivo of ctx.archivos) {
    if (encontrados >= MAXIMOS_SECRETOS) break;
    if (GENERADOS.has(archivo.nombre)) continue;
    if (/\.min\.(?:js|css)$|\.map$/.test(archivo.nombre)) continue;
    if (ctx.señales?.aborted) break;

    const lineas = ctx.lineas(archivo.ruta);
    const tope = Math.min(lineas.length, LINEAS_POR_ARCHIVO);
    for (let i = 0; i < tope && encontrados < MAXIMOS_SECRETOS; i++) {
      if (!PREFILTRO.test(lineas[i])) continue;
      const forma = formaDeSecreto(lineas[i]);
      if (!forma) continue;
      encontrados += 1;
      hallazgos.push(
        detectado(
          "riesgos",
          "riesgos.secreto",
          { tipo: forma.tipo, severidad: forma.confianza === "alta" ? "alta" : "media" },
          // Ruta y linea. El valor no viaja: ni aqui, ni en un extracto.
          [{ ruta: archivo.ruta, linea: i + 1 }],
          forma.confianza,
        ),
      );
    }
  }

  if (hallazgos.length === 0) {
    return [
      vacio(
        "riesgos",
        "riesgos.secretos",
        [{ ruta: "." }],
        "Se recorrio linea a linea cada archivo de texto del arbol buscando claves privadas, tokens firmados, " +
          "credenciales dentro de URLs, tokens con prefijo de emisor y asignaciones a variables con nombre de " +
          "credencial, y no hay ninguna coincidencia. Los binarios se cuentan pero no se leen, asi que de su " +
          "contenido este scanner no dice nada.",
        [],
      ),
    ];
  }
  return hallazgos;
}

/**
 * @param {import("../contexto.mjs").Contexto} ctx
 */
function envVersionado(ctx) {
  // Si el archivo aparece en el recorrido es que git NO lo ignora: las
  // exclusiones del inventario ya aplicaron el `.gitignore`. Un `.env` que git
  // ignora no es un riesgo de versionado, y avisar de el entrena al operador a
  // ignorar los avisos.
  const rutas = ctx.archivos
    .filter((a) => ES_ENV.test(a.ruta) && !ES_PLANTILLA.test(a.nombre))
    .map((a) => a.ruta)
    .sort();

  if (rutas.length === 0) {
    return vacio(
      "riesgos",
      "riesgos.env_versionado",
      [{ ruta: "." }],
      "Se busco un archivo `.env` que git NO ignore y no hay ninguno. Los que existan estan excluidos por " +
        "`.gitignore`, que es exactamente donde tienen que estar.",
    );
  }
  return detectado(
    "riesgos",
    "riesgos.env_versionado",
    { rutas, severidad: "alta" },
    rutas.map((ruta) => ({ ruta })),
  );
}

/**
 * @param {import("../contexto.mjs").Contexto} ctx
 */
function dependenciasSinFijar(ctx) {
  /** @type {any[]} */
  const flotantes = [];
  /** @type {any[]} */
  const evidencia = [];

  for (const ruta of ctx.porNombre("package.json")) {
    const paquete = ctx.json(ruta);
    if (!paquete) continue;
    for (const bloque of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const [nombre, rango] of Object.entries(paquete[bloque] ?? {})) {
        if (typeof rango !== "string" || !RANGO_FLOTANTE.test(rango.trim())) continue;
        const linea = ctx.lineaDeClave(ruta, nombre);
        flotantes.push({ ruta, paquete: nombre, rango, linea: linea ?? null });
        if (evidencia.length < 10) evidencia.push({ ruta, linea });
      }
    }
  }

  for (const ruta of ctx.porNombre("requirements.txt")) {
    for (const linea of ctx.buscarTodas(ruta, /^\s*([A-Za-z0-9._-]+)\s*(?:$|[<>~!]=?|\*)/)) {
      if (/==/.test(linea.extracto)) continue;
      flotantes.push({ ruta, paquete: linea.captura[1], rango: linea.extracto.slice(linea.captura[1].length).trim() || "sin version", linea: linea.linea });
      if (evidencia.length < 10) evidencia.push({ ruta, linea: linea.linea });
    }
  }

  if (flotantes.length === 0) {
    return vacio(
      "riesgos",
      "riesgos.dependencias_sin_fijar",
      [{ ruta: "." }],
      "Se leyeron los manifiestos y todas las dependencias declaradas estan fijadas a una version exacta, o no " +
        "hay dependencias. Nada de lo que instale este proyecto puede cambiar sin que alguien lo decida.",
      [],
    );
  }
  return detectado(
    "riesgos",
    "riesgos.dependencias_sin_fijar",
    { total: flotantes.length, ejemplos: flotantes.slice(0, 30), severidad: "media" },
    evidencia,
  );
}

/**
 * @param {import("../contexto.mjs").Contexto} ctx
 */
/**
 * @param {import("../contexto.mjs").Contexto} ctx
 */
function testsAusentes(ctx) {
  // Se vuelve a mirar aqui en vez de leer el hallazgo del detector de testing:
  // un detector que dependa de la salida de otro deja de poder correr solo, y
  // entonces el orden de la lista pasa a ser parte del contrato sin que nadie
  // lo haya escrito.
  const tests = ctx.archivos.filter(
    (a) => /(?:^|\/)(?:tests?|spec|specs|__tests__)(?:\/|$)/.test(a.ruta) || /[_.-](?:test|spec)\.|^test_/i.test(a.nombre),
  );
  const codigo = ctx.archivos.filter((a) => /\.(?:mjs|cjs|js|jsx|ts|tsx|py|rs|go|rb|java|kt|php|cs)$/.test(a.nombre));
  if (tests.length > 0 || codigo.length === 0) {
    return vacio(
      "riesgos",
      "riesgos.tests_ausentes",
      [{ ruta: "." }],
      tests.length > 0
        ? `Hay ${tests.length} archivos con forma de test en el arbol, asi que el riesgo de no tener ninguno no ` +
          "aplica. Si esos tests prueban algo es otra pregunta, y esta fuera de lo que se puede leer sin ejecutarlos."
        : "No hay archivos de codigo en el arbol, asi que la ausencia de tests no es un riesgo: no hay nada que " +
          "probar todavia.",
      false,
    );
  }
  return detectado(
    "riesgos",
    "riesgos.tests_ausentes",
    { archivos_de_codigo: codigo.length, severidad: "alta" },
    codigo.slice(0, 5).map((a) => ({ ruta: a.ruta })),
  );
}

/**
 * @param {import("../contexto.mjs").Contexto} ctx
 */
function detectar(ctx) {
  return [...secretos(ctx), envVersionado(ctx), dependenciasSinFijar(ctx), testsAusentes(ctx)];
}

/** @type {import("../scanner.mjs").Detector} */
const detector = { nombre: "riesgos", fase: "riesgos", detectar };
export default detector;
