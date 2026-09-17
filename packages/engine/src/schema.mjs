// Validador de JSON Schema, del subconjunto que usan los esquemas de noxloop.
//
// POR QUE EXISTE en vez de traer `ajv`. El principio de cero dependencias en el
// camino critico no es estetico: esto se instala para orquestar los
// repositorios de otra persona, y cada dependencia de runtime es superficie que
// esa persona no eligio. Los esquemas de este proyecto usan una decima parte de
// JSON Schema, y esa decima parte cabe en un archivo.
//
// LO QUE NO HACE. No pretende ser conforme. Lo que no entiende lo IGNORA en vez
// de rechazarlo, para no inventar errores — y hay un test que compara sus
// veredictos con los de `ajv` sobre los esquemas reales, para que la diferencia
// entre "no lo entiende" y "lo aprueba" no quede escondida.
//
// Los problemas se devuelven UNO POR CAMPO, con su ruta. Un error agregado
// ("configuracion invalida") obliga a adivinar; una lista de rutas se arregla.

/**
 * @param {object} schema
 * @param {unknown} data
 * @param {{path?: string}} [opts]
 * @returns {string[]} problemas, vacio si valida
 */
export function validate(schema, data, opts = {}) {
  const path = opts.path || "$";
  const problems = [];
  check(schema, data, path, problems);
  return problems;
}

function tipoDe(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v === "number" && Number.isInteger(v) ? "integer" : typeof v;
}

function coincideTipo(esperado, valor) {
  const t = tipoDe(valor);
  if (esperado === "number") return t === "number" || t === "integer";
  if (esperado === "integer") return t === "integer";
  return t === esperado;
}

function check(schema, data, path, problems) {
  if (!schema || typeof schema !== "object") return;

  if ("const" in schema && data !== schema.const) {
    problems.push(`${path}: tiene que ser ${JSON.stringify(schema.const)}, llego ${JSON.stringify(data)}`);
    return;
  }

  if (schema.enum && !schema.enum.includes(data)) {
    problems.push(`${path}: tiene que ser uno de ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}, llego ${JSON.stringify(data)}`);
    return;
  }

  if (schema.type) {
    const tipos = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!tipos.some((t) => coincideTipo(t, data))) {
      problems.push(`${path}: tiene que ser ${tipos.join(" o ")}, llego ${tipoDe(data)}`);
      return;
    }
  }

  if (typeof data === "string") {
    if (schema.pattern && !new RegExp(schema.pattern).test(data)) {
      problems.push(`${path}: "${data}" no cumple el patron ${schema.pattern}`);
    }
    if (schema.minLength != null && data.length < schema.minLength) {
      problems.push(`${path}: no puede estar vacio`);
    }
  }

  if (typeof data === "number" && schema.minimum != null && data < schema.minimum) {
    problems.push(`${path}: tiene que ser >= ${schema.minimum}, llego ${data}`);
  }

  if (Array.isArray(data)) {
    if (schema.minItems != null && data.length < schema.minItems) {
      problems.push(`${path}: necesita al menos ${schema.minItems} elemento(s), llego ${data.length}`);
    }
    if (schema.items) {
      data.forEach((v, i) => check(schema.items, v, `${path}[${i}]`, problems));
    }
    return;
  }

  if (data && typeof data === "object") {
    for (const req of schema.required || []) {
      if (!(req in data)) problems.push(`${path}.${req}: falta y es obligatorio`);
    }
    if (schema.minProperties != null && Object.keys(data).length < schema.minProperties) {
      problems.push(`${path}: necesita al menos ${schema.minProperties} entrada(s); esta vacio`);
    }
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(data)) {
      if (props[k]) {
        check(props[k], v, `${path}.${k}`, problems);
      } else if (schema.additionalProperties === false) {
        problems.push(`${path}.${k}: no esta declarado en el esquema`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        check(schema.additionalProperties, v, `${path}.${k}`, problems);
      }
    }
    if (schema.propertyNames) {
      for (const k of Object.keys(data)) check(schema.propertyNames, k, `${path}.${k} (clave)`, problems);
    }
  }
}

/**
 * Rellena los `default` del esquema sobre una copia de los datos.
 *
 * Crea los objetos intermedios ausentes SI alguna de sus propiedades tiene
 * default. Es lo que hace que una configuracion sin bloque `limits` termine con
 * los limites puestos, en vez de con `undefined` reventando en la primera
 * comparacion.
 */
export function applyDefaults(schema, data) {
  if (!schema || typeof schema !== "object") return data;

  if (schema.type === "object" || schema.properties) {
    const props = schema.properties || {};
    const salida = data && typeof data === "object" && !Array.isArray(data) ? { ...data } : undefined;
    const base = salida ?? (tieneDefaults(schema) ? {} : undefined);
    if (base === undefined) return data;
    for (const [k, sub] of Object.entries(props)) {
      if (k in base) {
        base[k] = applyDefaults(sub, base[k]);
      } else if ("default" in sub) {
        base[k] = sub.default;
      } else if (tieneDefaults(sub)) {
        const creado = applyDefaults(sub, undefined);
        if (creado !== undefined) base[k] = creado;
      }
    }
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      for (const k of Object.keys(base)) {
        if (!props[k]) base[k] = applyDefaults(schema.additionalProperties, base[k]);
      }
    }
    return base;
  }

  if (data === undefined && "default" in schema) return schema.default;
  return data;
}

function tieneDefaults(schema) {
  if (!schema || typeof schema !== "object") return false;
  if ("default" in schema) return true;
  return Object.values(schema.properties || {}).some(tieneDefaults);
}
