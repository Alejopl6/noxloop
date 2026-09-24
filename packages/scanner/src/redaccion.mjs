// La redaccion, y el catalogo de formas que tiene un secreto en un archivo.
//
// POR QUE LA REDACCION ES DEL NUCLEO Y NO DEL DETECTOR DE RIESGOS. Principio
// IX: la redaccion ocurre ANTES de persistir, no despues, y tiene que cubrir
// TODOS los caminos por los que un valor puede salir — no solo el del detector
// que busca secretos. El vector real no es ese detector, que sabe lo que tiene
// entre manos y nunca copia el valor: es el de al lado. El detector de CI
// extrae la linea `- run: desplegar --token ghp_...` porque su trabajo es decir
// que comandos corren, y esa linea lleva el secreto dentro. Si la redaccion
// viviera en el detector de riesgos, esa fuga entraria por la puerta contigua
// y el test del centinela la encontraria en el snapshot serializado.
//
// Por eso cada `extracto` que sale de un detector pasa por aqui, sea cual sea
// el detector, y por eso el catalogo de patrones vive junto a la redaccion en
// vez de dentro del detector que los busca.

/**
 * @typedef {object} Patron
 * @property {string} tipo etiqueta del hallazgo: nombra la FORMA, nunca el valor
 * @property {RegExp} re
 * @property {'alta'|'media'} confianza
 * @property {(m: RegExpMatchArray) => string|null} [valorDe] que parte del match es el secreto
 * @property {(valor: string, m: RegExpMatchArray) => boolean} [pareceCredencial] filtro extra para los patrones laxos
 */

/** Lo que delata a un hueco para rellenar en vez de a una credencial de verdad. */
const PLACEHOLDER =
  /^(?:\$\{|\$\(|<|\{\{|%|xxx+|\.\.\.|tu-|your|my-|mi-|change ?me|cambia|example|ejemplo|placeholder|sample|dummy|fake|test|todo|none|null|nil|true|false|0+|\*+|-+)/i;

/** Referencias a una variable de entorno: es lo contrario de un secreto en claro. */
const REFERENCIA = /process\.env|os\.environ|getenv|ENV\[|secrets\.|vars\.|\$\{\{|\$\{[A-Z_]/;

/** Un identificador a secas: el nombre de una variable, no su contenido. */
const ES_IDENTIFICADOR = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Codigo, no una credencial: una llamada, un acceso a propiedad, un literal de
 * objeto o de lista.
 */
const ES_EXPRESION =
  /^[({[]|^[A-Za-z_$][A-Za-z0-9_$]*\s*\(|^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+|^(?:new|await|require|import|typeof|function|return)\b/;

/**
 * El filtro que hace utilizable a la fase de riesgos sobre codigo de verdad.
 *
 * EL FALLO QUE EVITA, Y SE MIDIO SOBRE ESTE MISMO REPOSITORIO. El patron laxo
 * —una variable con nombre de credencial seguida de un valor— produjo 27
 * hallazgos aqui y NINGUNO era un secreto: `const clave = String(n.issue.id)`,
 * `const claves = Object.keys(valor)`, `clave: "guidelines.contributing"`. En
 * castellano `clave` es una palabra de todos los dias, y el detector la estaba
 * leyendo como si fuera `password`.
 *
 * Veintisiete avisos falsos no son un detector ruidoso: son un detector
 * apagado. El operador aprende en la primera pantalla que esta lista no se
 * mira, y el dia que aparezca la credencial de verdad estara en la linea 28 de
 * algo que ya nadie abre. Es el mismo fallo que el verde inventado, con el
 * signo cambiado.
 *
 * Las tres reglas son de forma, no de diccionario: lo que parece codigo no es
 * un valor; un identificador sin comillas es el nombre de una variable y no su
 * contenido (`token: tokenDeSesionEnMemoria` no filtra nada); y un valor sin
 * una sola mayuscula ni un solo digito no es una credencial de ningun emisor
 * conocido.
 *
 * @param {string} valor
 * @param {RegExpMatchArray} m
 */
function pareceCredencial(valor, m) {
  if (ES_EXPRESION.test(valor)) return false;
  // La comilla invertida NO cuenta como comilla: en markdown delimita codigo en
  // linea, y con ella dentro cada `**Un solo secreto: \`API_KEY\`**` de la
  // documentacion se convertia en un hallazgo de credencial.
  const comillada = typeof m[m.length - 2] === "string" && /^["']$/.test(m[m.length - 2]);
  if (!comillada && ES_IDENTIFICADOR.test(valor) && !/[0-9]/.test(valor)) return false;
  return /[0-9]/.test(valor) || /[A-Z]/.test(valor);
}

/**
 * El catalogo. Cada entrada nombra una FORMA de secreto, y esa etiqueta es lo
 * unico que viaja al hallazgo: `clave privada`, no la clave.
 *
 * @type {readonly Patron[]}
 */
export const PATRONES = Object.freeze([
  {
    tipo: "clave privada",
    re: /-----BEGIN\s+(?:[A-Z]+\s+)?PRIVATE KEY-----/,
    confianza: "alta",
  },
  {
    tipo: "token firmado en tres partes",
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{5,}/,
    confianza: "alta",
    valorDe: (m) => m[0],
  },
  {
    tipo: "credencial dentro de una URL",
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:([^\s/@]{3,})@/i,
    confianza: "alta",
    valorDe: (m) => m[1],
  },
  {
    // Prefijos publicados por emisores de tokens. No se nombra a ninguno: la
    // etiqueta describe la forma, que es lo que el operador necesita para
    // reconocerlo, y ademas mantiene el paquete sin nombres propios.
    tipo: "token con prefijo de emisor",
    re: /\b(?:[A-Z]{4}[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})\b/,
    confianza: "alta",
    valorDe: (m) => m[0],
  },
  {
    // La forma que se cuela por la puerta de al lado. El detector de CI extrae
    // las lineas `run:` porque su trabajo es decir que comandos corren, y un
    // comando de despliegue lleva la credencial como argumento de una bandera,
    // separada por un espacio en vez de por un `=`. Sin esta entrada el valor
    // viaja dentro de un `extracto` que nadie miro como secreto.
    tipo: "credencial en un argumento",
    re: /(?:^|\s)--?[A-Za-z0-9-]*(?:token|secret|passwd|password|apikey|api-key|key|credential|auth|pass)[A-Za-z0-9-]*[=\s]+(["']?)([^\s"'`,;)]{8,})/i,
    confianza: "media",
    valorDe: (m) => m[2],
    pareceCredencial,
  },
  {
    tipo: "asignacion de credencial",
    re: /(?:^|[^A-Za-z0-9_])([A-Za-z0-9_.-]*(?:secret|token|passwd|password|api[_-]?key|apikey|private[_-]?key|access[_-]?key|credential|clave|contrasena)[A-Za-z0-9_.-]*)\s*[:=]\s*(["']?)([^\s"'`,;)#]{8,})/i,
    confianza: "media",
    valorDe: (m) => m[3],
    pareceCredencial,
  },
]);

/**
 * Busca un secreto en una linea. Devuelve la FORMA, nunca el valor.
 *
 * @param {string} linea
 * @returns {{tipo: string, confianza: 'alta'|'media'}|null}
 */
export function formaDeSecreto(linea) {
  if (linea.length > 4000) linea = linea.slice(0, 4000); // una linea minificada no es una credencial
  for (const patron of PATRONES) {
    const m = linea.match(patron.re);
    if (!m) continue;
    const valor = patron.valorDe ? patron.valorDe(m) : null;
    if (valor !== null) {
      // Un hueco para rellenar o una referencia a una variable de entorno no es
      // un secreto. Avisar de lo que no pasa entrena al operador a ignorar los
      // avisos, y el dia que uno es de verdad ya nadie los mira.
      if (PLACEHOLDER.test(valor)) continue;
      if (REFERENCIA.test(m[0])) continue;
      if (patron.pareceCredencial && !patron.pareceCredencial(valor, m)) continue;
    }
    return { tipo: patron.tipo, confianza: patron.confianza };
  }
  return null;
}

/**
 * La redaccion aplicada a un `valor` entero, por profundo que sea.
 *
 * POR QUE EL VALOR TAMBIEN, Y NO SOLO LOS EXTRACTOS. Porque el detector de CI
 * no guarda la linea del workflow en un `extracto`: la guarda en el `valor`,
 * que es donde vive la lista de comandos que corre la integracion continua. Un
 * embudo que solo cubriera los extractos dejaria pasar exactamente el caso que
 * el test del centinela busca, y la fuga entraria por la puerta de al lado sin
 * que ningun detector se hubiera equivocado.
 *
 * @param {any} valor
 * @returns {any}
 */
export function redactarProfundo(valor) {
  if (typeof valor === "string") return redactar(valor);
  if (Array.isArray(valor)) return valor.map(redactarProfundo);
  if (valor && typeof valor === "object") {
    /** @type {any} */
    const salida = {};
    for (const [k, v] of Object.entries(valor)) salida[k] = redactarProfundo(v);
    return salida;
  }
  return valor;
}

/**
 * Deja un texto en condiciones de persistirse: lo que parece un secreto se
 * sustituye por su forma. El texto sigue siendo util —se ve que comando corre,
 * que variable se asigna— y deja de ser una segunda copia del problema.
 *
 * @param {string} texto
 * @returns {string}
 */
export function redactar(texto) {
  if (!texto) return texto;
  let salida = texto;
  for (const patron of PATRONES) {
    const global = new RegExp(patron.re.source, patron.re.flags.includes("g") ? patron.re.flags : patron.re.flags + "g");
    salida = salida.replace(global, (coincidencia, ...grupos) => {
      /** @type {any} */
      const m = [coincidencia, ...grupos.filter((g) => typeof g === "string")];
      const valor = patron.valorDe ? patron.valorDe(m) : coincidencia;
      if (valor === null) return coincidencia;
      if (PLACEHOLDER.test(valor)) return coincidencia;
      if (REFERENCIA.test(coincidencia)) return coincidencia;
      if (patron.pareceCredencial && !patron.pareceCredencial(valor, m)) return coincidencia;
      return coincidencia.split(valor).join(`[${patron.tipo}: valor omitido]`);
    });
  }
  return salida;
}
