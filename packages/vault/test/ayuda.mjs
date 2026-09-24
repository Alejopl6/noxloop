// Utilidades de las pruebas de la boveda.
//
// EL CENTINELA. Ninguna prueba de este paquete verifica la intencion: se guarda
// un valor improbable, se serializa el objeto real y se busca ese valor dentro.
// El valor se genera por prueba y no es una constante compartida, porque una
// constante que aparece en varios archivos acaba coincidiendo con algo por
// casualidad, y entonces la prueba falla sin que haya una fuga.

import { randomBytes } from "node:crypto";

/**
 * Un valor que no puede aparecer en ningun sitio por casualidad.
 *
 * @param {string} [etiqueta] para reconocer en el volcado cual de los varios era
 * @returns {string}
 */
export function centinela(etiqueta = "x") {
  return `NOXLOOP-CENTINELA-${etiqueta}-${randomBytes(24).toString("hex")}`;
}

/**
 * Busca el centinela ENTERO o cualquier trozo contiguo suyo de al menos
 * `minimo` caracteres.
 *
 * POR QUE TAMBIEN TRUNCADO. El contrato dice "ni truncado" y la palabra tiene un
 * fallo concreto detras: un campo que recorta a 32 caracteres para "no ocupar
 * tanto en el log" deja los 32 primeros de la credencial en disco. Contra un
 * token con prefijo fijo, esos 32 caracteres son casi todo lo que hace falta.
 *
 * @param {string} texto
 * @param {string} valor
 * @param {number} [minimo]
 * @returns {string|null} el trozo encontrado, o null
 */
export function trozoDelCentinela(texto, valor, minimo = 12) {
  // Se busca sobre la PARTE ALEATORIA, no sobre el centinela entero. El prefijo
  // `NOXLOOP-CENTINELA-` es comun a todos, y buscando trozos del valor completo
  // un centinela encuentra el prefijo de otro: la prueba del entorno daba una
  // fuga que no existia, y una prueba que grita sin motivo se acaba apagando.
  // Doce caracteres hexadecimales son 48 bits: una coincidencia casual no
  // ocurre.
  const aleatorio = valor.slice(valor.lastIndexOf("-") + 1);
  for (let largo = aleatorio.length; largo >= minimo; largo--) {
    for (let i = 0; i + largo <= aleatorio.length; i++) {
      const trozo = aleatorio.slice(i, i + largo);
      if (texto.includes(trozo)) return trozo;
    }
  }
  return null;
}

/**
 * Un motivo de acceso completo, para las pruebas que no lo estan ejercitando.
 *
 * @param {Record<string, any>} [cambios]
 * @returns {any}
 */
export function motivoDePrueba(cambios = {}) {
  return {
    grant_id: "g1",
    project_id: "p1",
    agent_id: "a1",
    proposito: "lanzar_runner",
    ...cambios,
  };
}
