// Lo que comparten las pruebas de este paquete.
//
// AQUI ESTA EL PROVEEDOR FALSO, Y ES LA PIEZA QUE HACE QUE ESTAS PRUEBAS NO
// LLAMEN A NINGUN MODELO. El contrato del proveedor es una funcion: recibe el
// esquema y el texto, devuelve un objeto. La implementacion de verdad
// —`proveedor-ai-sdk.mjs`— es una de las que cumplen ese contrato; estas
// pruebas usan otra, que devuelve lo que el caso necesita probar, incluido lo
// que un modelo NO deberia devolver.
//
// Es el mismo criterio que los adaptadores de runtime: un test que necesita la
// red para correr es un test que no corre en la maquina del operador, y el que
// no corre es el que se desactiva.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Un snapshot minimo con hallazgos de verdad en la forma que el servicio pasa.
 *
 * @param {any[]} [extras]
 */
export function snapshotDePrueba(extras = []) {
  return {
    id: "snap-1",
    project_id: "proj-1",
    commit: "abc123",
    hallazgos: [
      {
        categoria: "testing",
        clave: "testing.runner",
        valor: "node:test",
        origen: "detectado",
        evidencia: [{ ruta: "package.json", linea: 12 }],
        confianza: "alta",
      },
      {
        categoria: "testing",
        clave: "testing.cobertura",
        valor: null,
        origen: "detectado",
        evidencia: [{ ruta: "." }],
        confianza: "alta",
      },
      {
        categoria: "ci",
        clave: "ci.plataforma",
        valor: "github-actions",
        origen: "detectado",
        evidencia: [{ ruta: ".github/workflows/ci.yml" }],
        confianza: "alta",
      },
      {
        categoria: "riesgos",
        clave: "riesgos.secreto_en_arbol",
        valor: [".env"],
        origen: "inferido",
        evidencia: [{ ruta: ".env" }],
        confianza: "media",
      },
      ...extras,
    ],
  };
}

/**
 * Un proveedor que devuelve SIEMPRE lo mismo. Lo que devuelve lo decide el
 * caso: por eso se puede probar que pasa cuando un modelo miente.
 *
 * @param {any} objeto
 * @param {{modelo?: string, proveedor?: string}} [quien]
 */
export function proveedorFijo(objeto, quien = {}) {
  /** @type {any} */
  const llamadas = [];
  /** @type {any} */
  const fn = async (peticion) => {
    llamadas.push(peticion);
    return {
      objeto: typeof objeto === "function" ? objeto(peticion) : objeto,
      modelo: quien.modelo ?? "modelo-de-prueba",
      proveedor: quien.proveedor ?? "proveedor-de-prueba",
    };
  };
  fn.llamadas = llamadas;
  return fn;
}

/** Un proveedor que revienta, para el camino en el que el modelo no contesta. */
export function proveedorQueFalla(mensaje) {
  return async () => {
    throw new Error(mensaje);
  };
}

/**
 * Todos los `.mjs` de un directorio, recursivo.
 *
 * @param {string} dir
 * @param {string[]} [acc]
 * @returns {string[]}
 */
export function fuentes(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) fuentes(p, acc);
    else if (p.endsWith(".mjs")) acc.push(p);
  }
  return acc;
}
