// Un validador de JSON Schema con lo justo, y el motivo de que sea propio.
//
// POR QUE NO SE USA `ajv`, QUE ESTA EN LA RAIZ. Porque este paquete viaja al
// escritorio como recurso suelto y cada dependencia suya hay que declararla en
// `bundle.resources`, con su subarbol entero. La cuenta es concreta: el SDK del
// modelo ya obliga a mover doce paquetes y veintiseis megas al instalador, y
// este validador cubre en cien lineas el subconjunto que los dos esquemas de
// este paquete usan. Una dependencia mas por eso no sale a cuenta.
//
// POR QUE VALIDAR AQUI SI `generateObject` YA RESTRINGE. Porque `generateObject`
// es UNA implementacion del proveedor, y la garantia tiene que valer para todas
// —el proveedor falso de las pruebas incluido, y el que alguien cablee mañana—.
// Una comprobacion que solo existe dentro de la dependencia se evapora cuando
// la dependencia cambia, y lo hace en silencio: lo que llega es un objeto con
// la forma equivocada y el primer sitio donde se nota es la pantalla.
//
// LO QUE ESTE VALIDADOR NO HACE: `$ref`, `oneOf`, `allOf`, `pattern`,
// `dependencies`. No estan porque ningun esquema de aqui los usa, y un
// validador que acepta una palabra clave que no implementa es peor que uno que
// no la conoce: la primera pasa en silencio.

/** Las palabras clave que este validador sabe hacer cumplir. */
const CONOCIDAS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "minItems",
  "minLength",
  "description",
  "const",
]);

/** @param {unknown} v */
function tipoDe(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/**
 * Comprueba un valor contra un esquema. Devuelve TODOS los problemas, no el
 * primero: corregir de a uno obliga a tantos viajes como campos rotos haya, y
 * con un modelo al otro lado cada viaje cuesta una llamada.
 *
 * @param {any} valor
 * @param {any} esquema
 * @param {string} [donde]
 * @returns {string[]}
 */
export function problemasDe(valor, esquema, donde = "la respuesta") {
  /** @type {string[]} */
  const problemas = [];

  for (const clave of Object.keys(esquema)) {
    if (!CONOCIDAS.has(clave)) {
      // Una palabra clave desconocida es un esquema que promete algo que este
      // validador no comprueba. Se rompe aqui, al escribir el esquema, y no en
      // la respuesta que se cuela.
      throw new Error(
        `el esquema de \`${donde}\` usa \`${clave}\`, que este validador no implementa. ` +
          "Un validador que acepta lo que no hace cumplir deja pasar en silencio.",
      );
    }
  }

  if (esquema.type && tipoDe(valor) !== esquema.type) {
    problemas.push(`\`${donde}\` es ${tipoDe(valor)} y tiene que ser ${esquema.type}`);
    return problemas;
  }

  if (esquema.const !== undefined && valor !== esquema.const) {
    problemas.push(`\`${donde}\` vale ${JSON.stringify(valor)} y tiene que valer ${JSON.stringify(esquema.const)}`);
  }

  if (esquema.enum && !esquema.enum.includes(valor)) {
    problemas.push(
      `\`${donde}\` vale ${JSON.stringify(valor)}, que no es ninguno de ${esquema.enum.map((/** @type {any} */ e) => `\`${e}\``).join(", ")}`,
    );
  }

  if (esquema.type === "string" && typeof esquema.minLength === "number" && valor.length < esquema.minLength) {
    problemas.push(`\`${donde}\` viene vacio o mas corto de ${esquema.minLength} caracteres`);
  }

  if (esquema.type === "array") {
    if (typeof esquema.minItems === "number" && valor.length < esquema.minItems) {
      problemas.push(`\`${donde}\` trae ${valor.length} elementos y necesita al menos ${esquema.minItems}`);
    }
    if (esquema.items) {
      for (const [i, elemento] of valor.entries()) {
        problemas.push(...problemasDe(elemento, esquema.items, `${donde}[${i}]`));
      }
    }
  }

  if (esquema.type === "object") {
    for (const campo of esquema.required ?? []) {
      if (valor[campo] === undefined || valor[campo] === null) {
        problemas.push(`a \`${donde}\` le falta \`${campo}\``);
      }
    }
    // LOS CAMPOS DE MAS NO SE RECHAZAN AQUI: los borra `soloLoDeclarado`, mas
    // abajo. El caso real es un modelo que devuelve `origen: "detectado"` de su
    // cosecha — rechazar la respuesta entera por eso tiraria una sugerencia
    // buena por un campo que de todas formas no iba a viajar. Lo que no puede
    // pasar es que ese campo LLEGUE a la salida, y de eso se encarga el
    // sellado. `additionalProperties: false` sigue declarado en el esquema
    // porque es lo que restringe al modelo al generar.
    for (const [campo, subesquema] of Object.entries(esquema.properties ?? {})) {
      if (valor[campo] === undefined || valor[campo] === null) continue;
      problemas.push(...problemasDe(valor[campo], subesquema, `${donde}.${campo}`));
    }
  }

  return problemas;
}

/**
 * Los campos que el esquema declara, en profundidad. Es lo que el sellado usa
 * para quedarse SOLO con lo declarado: todo lo demas que el modelo haya metido
 * —un `origen`, una `evidencia`— no viaja.
 *
 * @param {any} valor
 * @param {any} esquema
 * @returns {any}
 */
export function soloLoDeclarado(valor, esquema) {
  if (esquema.type === "array") {
    return (valor ?? []).map((/** @type {any} */ e) => soloLoDeclarado(e, esquema.items ?? {}));
  }
  if (esquema.type === "object") {
    /** @type {Record<string, any>} */
    const limpio = {};
    for (const [campo, subesquema] of Object.entries(esquema.properties ?? {})) {
      if (valor[campo] === undefined) continue;
      limpio[campo] = soloLoDeclarado(valor[campo], subesquema);
    }
    return limpio;
  }
  return valor;
}
