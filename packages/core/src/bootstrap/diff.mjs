// FR-026 — el diff exacto, calculado contra el arbol de ahora, antes de
// proponer.
//
// EL FALLO QUE EVITA. Un instalador que dice "voy a configurar tu proyecto" y
// enseña una lista de titulos pide fe. El diff exacto convierte la aprobacion
// en una revision: el operador lee lo que va a pasar, archivo por archivo y
// linea por linea, y aprueba eso. Sin el, la primera sorpresa —un archivo suyo
// modificado que no esperaba— se paga con la confianza entera del producto.
//
// POR QUE LA HUELLA VIAJA CON EL CAMBIO. Porque es lo unico que permite
// comprobar despues que el arbol no se movio sin tener que recalcular el diff,
// y recalcular es justo lo que `aplicar` no puede hacer. La huella de un
// archivo que no existe es `null`, y `null` tambien es un estado que se
// compara: "no estaba" es una afirmacion sobre el arbol tan concreta como un
// hash.
//
// POR QUE EL DIFF NO USA LA GRAFIA `---`/`+++` DE UNIFIED DIFF. Porque una
// cabecera que empieza por `-` es indistinguible de una linea borrada cuando se
// busca en el texto, y el texto es lo que se muestra y lo que se prueba. La
// cabecera dice `archivo: <ruta> (<accion>)` y el cuerpo usa ` `, `-` y `+`.

import { createHash } from "node:crypto";

/** Por encima de esto el diff linea a linea deja de ser util y cuesta O(n²). */
const MAXIMO_LINEAS = 2000;

/**
 * @param {string|null} texto
 * @returns {string|null}
 */
export function huellaDe(texto) {
  if (texto === null || texto === undefined) return null;
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

/**
 * @param {string} texto
 * @returns {string[]}
 */
function lineas(texto) {
  const partes = texto.split("\n");
  // Un archivo que termina en salto de linea no tiene una ultima linea vacia:
  // tiene un final de archivo. Sin esto, cada diff arrastra un `+` fantasma.
  if (partes.length > 0 && partes[partes.length - 1] === "") partes.pop();
  return partes;
}

/**
 * Diff linea a linea por subsecuencia comun mas larga.
 *
 * @param {string[]} antes
 * @param {string[]} despues
 * @returns {string[]}
 */
function porLineas(antes, despues) {
  const n = antes.length;
  const m = despues.length;
  /** @type {number[][]} */
  const tabla = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      tabla[i][j] = antes[i] === despues[j] ? tabla[i + 1][j + 1] + 1 : Math.max(tabla[i + 1][j], tabla[i][j + 1]);
    }
  }

  const salida = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (antes[i] === despues[j]) {
      salida.push(` ${antes[i]}`);
      i++;
      j++;
    } else if (tabla[i + 1][j] >= tabla[i][j + 1]) {
      salida.push(`-${antes[i]}`);
      i++;
    } else {
      salida.push(`+${despues[j]}`);
      j++;
    }
  }
  while (i < n) salida.push(`-${antes[i++]}`);
  while (j < m) salida.push(`+${despues[j++]}`);
  return salida;
}

/**
 * @param {string} ruta
 * @param {string|null} antes
 * @param {string} despues
 * @returns {string}
 */
export function diffDeArchivo(ruta, antes, despues) {
  const accion = antes === null ? "crear" : "modificar";
  const cabecera = `archivo: ${ruta} (${accion})`;

  if (antes === null) return [cabecera, ...lineas(despues).map((l) => `+${l}`)].join("\n");

  const viejas = lineas(antes);
  const nuevas = lineas(despues);
  if (viejas.length > MAXIMO_LINEAS || nuevas.length > MAXIMO_LINEAS) {
    return [
      cabecera,
      `(el archivo tiene ${viejas.length} lineas y pasa a ${nuevas.length}: se reemplaza entero)`,
      `-(${viejas.length} lineas)`,
      `+(${nuevas.length} lineas)`,
    ].join("\n");
  }
  return [cabecera, ...porLineas(viejas, nuevas)].join("\n");
}

/**
 * Convierte la lista de archivos que una entrada del catalogo quiere escribir
 * en cambios con su diff, su accion y su huella de partida.
 *
 * Un archivo que ya tiene exactamente ese contenido no produce cambio: no hay
 * nada que aprobar ni que escribir, y proponerlo seria la version en pequeño de
 * proponerle a alguien lo que ya hizo.
 *
 * @param {import("../arbol.mjs").Arbol} arbol
 * @param {Array<{ruta: string, contenido: string}>} pedidos
 */
export function calcularCambios(arbol, pedidos) {
  /** @type {any[]} */
  const cambios = [];
  /** @type {string[]} */
  const identicos = [];

  for (const pedido of pedidos) {
    // `leer` valida la ruta: un cambio que sale del proyecto no llega a
    // proponerse, porque el diff que el operador aprueba habla de SU arbol.
    const antes = arbol.leer(pedido.ruta);
    if (antes === pedido.contenido) {
      identicos.push(pedido.ruta);
      continue;
    }
    cambios.push(
      Object.freeze({
        ruta: pedido.ruta,
        accion: antes === null ? "crear" : "modificar",
        contenido: pedido.contenido,
        huella_antes: huellaDe(antes),
        huella_despues: huellaDe(pedido.contenido),
        diff: diffDeArchivo(pedido.ruta, antes, pedido.contenido),
      }),
    );
  }

  return {
    cambios,
    identicos,
    base: cambios.map((c) => Object.freeze({ ruta: c.ruta, huella_antes: c.huella_antes })),
    diff: cambios.map((c) => c.diff).join("\n\n"),
  };
}
