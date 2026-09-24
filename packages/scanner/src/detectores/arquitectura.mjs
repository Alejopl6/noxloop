// Detector de arquitectura: monorepo y workspaces, raiz del codigo, capas,
// puntos de extension y convencion de nombres.
//
// ESTE DETECTOR ES DONDE EL PRINCIPIO X SE GANA O SE PIERDE. Es el unico que
// mira formas en vez de archivos, y "esto parece hexagonal" es exactamente la
// frase que acaba en una constitution que el proyecto nunca tuvo. Por eso aqui
// hay dos clases de hallazgo bien separadas:
//
//   - Lo que esta escrito en un archivo —los workspaces de un manifiesto— sale
//     como DETECTADO, con su linea.
//   - Lo que se lee de la forma del arbol —tres directorios con nombres de
//     capa— sale como INFERIDO, con confianza media o baja y nunca alta.
//
// La diferencia no es cosmetica: el primero se puede comprobar abriendo el
// archivo, el segundo no. Un snapshot que los mezcla produce una constitution
// que el runtime aplica durante meses sobre una arquitectura supuesta.

import { detectado, inferido, vacio } from "../hallazgo.mjs";

/** Nombres que, juntos, sugieren puertos y adaptadores. Sueltos no dicen nada. */
const NOMBRES_DE_CAPA = Object.freeze({
  dominio: ["domain", "dominio", "entities", "entidades", "model", "modelo", "core", "nucleo"],
  aplicacion: ["application", "aplicacion", "usecases", "use_cases", "casos_de_uso", "services", "servicios"],
  infraestructura: ["infrastructure", "infraestructura", "adapters", "adaptadores", "persistence", "repositories", "repositorios"],
  puertos: ["ports", "puertos", "interfaces", "interfaz", "contracts", "contratos"],
  presentacion: ["presentation", "presentacion", "ui", "web", "api", "http", "controllers", "controladores"],
});

/** Basenames que declaran un contrato con implementaciones hermanas al lado. */
const NOMBRES_DE_CONTRATO = new Set(["contract", "contrato", "interface", "interfaz", "spi", "protocol", "protocolo"]);

/** Directorios que suelen ser la raiz del codigo de produccion. */
const RAICES_DE_CODIGO = ["src", "lib", "app", "pkg", "cmd", "internal", "source"];

/** Extensiones que cuentan como codigo a la hora de medir convenciones. */
const CODIGO = new Set([".mjs", ".cjs", ".js", ".jsx", ".ts", ".tsx", ".py", ".rs", ".go", ".rb", ".java", ".kt", ".php", ".cs", ".swift", ".ex"]);

/**
 * Traduce un patron de workspace (`packages/*`) a una expresion regular sobre
 * rutas relativas. Sin esto, los miembros del monorepo serian los patrones
 * literales, que es justo lo que no sirve para nada.
 *
 * @param {string} patron
 */
function comoRegExp(patron) {
  const cuerpo = patron
    .replace(/^\.\//, "")
    .replace(/\/$/, "")
    .split("/")
    .map((segmento) =>
      segmento === "**"
        ? ".*"
        : segmento.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]"),
    )
    .join("/");
  return new RegExp(`^${cuerpo}$`);
}

/**
 * @param {import("../contexto.mjs").Contexto} ctx
 */
function monorepo(ctx) {
  /** @type {{herramienta: string, patrones: string[], evidencia: any}|null} */
  let declaracion = null;

  const paquete = ctx.tiene("package.json") ? ctx.json("package.json") : null;
  if (paquete) {
    const bruto = Array.isArray(paquete.workspaces) ? paquete.workspaces : paquete.workspaces?.packages;
    if (Array.isArray(bruto) && bruto.length > 0) {
      declaracion = {
        herramienta: "workspaces del manifiesto",
        patrones: bruto,
        evidencia: { ruta: "package.json", linea: ctx.lineaDeClave("package.json", "workspaces") },
      };
    }
  }
  if (!declaracion && ctx.tiene("pnpm-workspace.yaml")) {
    const patrones = ctx
      .buscarTodas("pnpm-workspace.yaml", /^\s*-\s*["']?([^"'\s#]+)["']?/)
      .map((l) => l.captura[1]);
    if (patrones.length > 0) {
      declaracion = { herramienta: "workspace de pnpm", patrones, evidencia: { ruta: "pnpm-workspace.yaml", linea: 1 } };
    }
  }
  if (!declaracion && ctx.tiene("Cargo.toml")) {
    const lineas = ctx.lineas("Cargo.toml");
    const inicio = lineas.findIndex((l) => /^\s*\[workspace\]/.test(l));
    if (inicio !== -1) {
      const patrones = [];
      for (let i = inicio + 1; i < lineas.length && !/^\s*\[/.test(lineas[i]); i++) {
        for (const m of lineas[i].matchAll(/"([^"]+)"/g)) patrones.push(m[1]);
      }
      if (patrones.length > 0) {
        declaracion = { herramienta: "workspace de cargo", patrones, evidencia: { ruta: "Cargo.toml", linea: inicio + 1 } };
      }
    }
  }
  if (!declaracion && ctx.tiene("go.work")) {
    const patrones = ctx.buscarTodas("go.work", /^\s*\.?\/?([^\s()]+)\s*$/).map((l) => l.captura[1]).filter((p) => p !== "use");
    declaracion = { herramienta: "go.work", patrones, evidencia: { ruta: "go.work", linea: 1 } };
  }

  if (!declaracion) {
    return vacio(
      "arquitectura",
      "arquitectura.monorepo",
      [{ ruta: "." }],
      "Ningun manifiesto de la raiz declara workspaces. El proyecto es un repositorio de un solo paquete, o " +
        "reparte sus modulos con una herramienta que este scanner no conoce.",
    );
  }

  const expresiones = declaracion.patrones.map(comoRegExp);
  const miembros = ctx.directorios.filter((d) => expresiones.some((re) => re.test(d))).sort();
  return detectado(
    "arquitectura",
    "arquitectura.monorepo",
    { herramienta: declaracion.herramienta, patrones: declaracion.patrones, miembros },
    [declaracion.evidencia],
  );
}

/**
 * Un punto de extension: un contrato arriba, implementaciones hermanas debajo.
 *
 * POR QUE SE BUSCA LA FORMA Y NO EL NOMBRE DEL DIRECTORIO. Porque el nombre
 * cambia con el proyecto y con el idioma, y una lista de nombres conocidos es
 * la clase de cosa que funciona para el repositorio de quien la escribio. La
 * forma —un archivo que declara un contrato, y directorios hermanos que lo
 * implementan— es la misma en todos los sitios donde esta el patron.
 *
 * @param {import("../contexto.mjs").Contexto} ctx
 */
function puntosDeExtension(ctx) {
  /** @type {any[]} */
  const puntos = [];
  /** @type {any[]} */
  const evidencia = [];

  for (const archivo of ctx.archivos) {
    const sinExtension = archivo.nombre.slice(0, archivo.nombre.length - archivo.ext.length).toLowerCase();
    if (!NOMBRES_DE_CONTRATO.has(sinExtension)) continue;
    const directorio = archivo.ruta.includes("/") ? archivo.ruta.slice(0, archivo.ruta.lastIndexOf("/")) : "";

    const prefijo = directorio ? `${directorio}/` : "";
    const hijos = ctx.directorios
      .filter((d) => d.startsWith(prefijo) && !d.slice(prefijo.length).includes("/") && d !== directorio)
      .filter((d) => ctx.archivos.some((a) => a.ruta.startsWith(`${d}/`)));
    if (hijos.length < 2) continue;

    puntos.push({
      contrato: archivo.ruta,
      directorio: directorio || ".",
      implementaciones: hijos.map((h) => h.slice(prefijo.length)).sort(),
    });
    evidencia.push({ ruta: archivo.ruta });
    for (const hijo of hijos) {
      const entrada = ctx.archivos.find((a) => a.ruta.startsWith(`${hijo}/`) && CODIGO.has(a.ext));
      if (entrada) evidencia.push({ ruta: entrada.ruta });
    }
  }

  if (puntos.length === 0) {
    return vacio(
      "arquitectura",
      "arquitectura.puntos_de_extension",
      [{ ruta: "." }],
      "No hay ningun archivo que declare un contrato con implementaciones hermanas al lado. El proyecto no usa " +
        "ese patron, o lo usa con una forma que este scanner no reconoce.",
      [],
    );
  }
  return detectado("arquitectura", "arquitectura.puntos_de_extension", puntos, evidencia);
}

/**
 * @param {import("../contexto.mjs").Contexto} ctx
 */
function capas(ctx) {
  /** @type {Record<string, string[]>} */
  const encontradas = {};
  for (const directorio of ctx.directorios) {
    const base = directorio.slice(directorio.lastIndexOf("/") + 1).toLowerCase();
    for (const [capa, nombres] of Object.entries(NOMBRES_DE_CAPA)) {
      if (!nombres.includes(base)) continue;
      encontradas[capa] = [...(encontradas[capa] ?? []), directorio];
    }
  }

  const distintas = Object.keys(encontradas);
  if (distintas.length < 2) {
    return vacio(
      "arquitectura",
      "arquitectura.capas",
      [{ ruta: "." }],
      "Se recorrieron los nombres de todos los directorios del arbol buscando los de una separacion por capas " +
        "(dominio, aplicacion, infraestructura, puertos, presentacion) y no aparecen suficientes juntos. El " +
        "proyecto no las separa por directorio, o las llama de otra forma: lo que no se hace es adivinarlas.",
      [],
    );
  }

  const evidencia = Object.values(encontradas).flat().slice(0, 8).map((ruta) => ({ ruta }));
  // Tres capas o mas es una señal; dos es una coincidencia frecuente. Ni una ni
  // otra es un hecho, y por eso ninguna sale como detectada.
  return inferido(
    "arquitectura",
    "arquitectura.capas",
    { capas: distintas, directorios: encontradas },
    evidencia,
    distintas.length >= 3 ? "media" : "baja",
  );
}

/**
 * @param {import("../contexto.mjs").Contexto} ctx
 */
function convencionDeNombres(ctx) {
  const estilos = { kebab: 0, snake: 0, camel: 0, plano: 0 };
  /** @type {Record<string, string[]>} */
  const ejemplos = { kebab: [], snake: [], camel: [], plano: [] };
  for (const archivo of ctx.archivos) {
    if (!CODIGO.has(archivo.ext)) continue;
    const base = archivo.nombre.slice(0, archivo.nombre.length - archivo.ext.length).split(".")[0];
    /** @type {keyof typeof estilos} */
    let estilo = "plano";
    if (base.includes("-")) estilo = "kebab";
    else if (base.includes("_")) estilo = "snake";
    else if (/[a-z][A-Z]|^[A-Z]/.test(base)) estilo = "camel";
    estilos[estilo] += 1;
    if (ejemplos[estilo].length < 3) ejemplos[estilo].push(archivo.ruta);
  }

  const total = Object.values(estilos).reduce((a, b) => a + b, 0);
  if (total === 0) {
    return vacio(
      "patrones",
      "patrones.convencion_de_nombres",
      [{ ruta: "." }],
      "No hay archivos de codigo en el arbol, asi que no hay convencion de nombres que medir. Es un hueco de " +
        "verdad, no un estilo por defecto.",
    );
  }
  const [dominante, cuenta] = Object.entries(estilos).sort((a, b) => b[1] - a[1])[0];
  const proporcion = Math.round((cuenta / total) * 100) / 100;
  return detectado(
    "patrones",
    "patrones.convencion_de_nombres",
    { estilo: dominante, proporcion, cuentas: estilos },
    ejemplos[dominante].map((ruta) => ({ ruta })),
    proporcion >= 0.7 ? "alta" : "media",
  );
}

/**
 * @param {import("../contexto.mjs").Contexto} ctx
 */
function detectar(ctx) {
  const hallazgos = [monorepo(ctx), puntosDeExtension(ctx), capas(ctx), convencionDeNombres(ctx)];

  const raices = RAICES_DE_CODIGO.filter((nombre) => ctx.directorios.includes(nombre));
  const anidadas = ctx.directorios.filter((d) => {
    const partes = d.split("/");
    return partes.length > 1 && RAICES_DE_CODIGO.includes(partes[partes.length - 1]);
  });
  const todas = [...raices, ...anidadas];
  if (todas.length > 0) {
    hallazgos.push(
      detectado("arquitectura", "arquitectura.raiz_de_codigo", todas.slice(0, 50), todas.slice(0, 8).map((ruta) => ({ ruta }))),
    );
  } else {
    hallazgos.push(
      vacio(
        "arquitectura",
        "arquitectura.raiz_de_codigo",
        [{ ruta: "." }],
        `Se busco un directorio de codigo con los nombres habituales (${RAICES_DE_CODIGO.join(", ")}) y no hay ` +
          "ninguno. El codigo cuelga de la raiz, o el proyecto lo organiza de otra forma.",
        [],
      ),
    );
  }

  return hallazgos;
}

/** @type {import("../scanner.mjs").Detector} */
const detector = { nombre: "arquitectura", fase: "estructura", detectar };
export default detector;
