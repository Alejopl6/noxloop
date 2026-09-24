// El redactor (T139): busca POR VALOR y nombra la credencial.
//
// EL FALLO QUE EVITA, con nombre propio. Un agente lee una credencial durante
// la ejecucion y la reproduce a mitad de una frase de su transcript. Ahi no hay
// nombre de variable, ni comillas, ni un `API_KEY=` delante: hay cuarenta
// caracteres sueltos dentro de un parrafo. Un redactor que busque por el nombre
// de la variable no ve nada y deja pasar el texto entero.
//
// POR QUE ANTES DE PERSISTIR Y NO DESPUES. FR-050 dice "antes" y la palabra es
// el contrato: redactar despues significa que hubo un instante en que el secreto
// estuvo en disco, y un instante es todo lo que hace falta.
//
// POR QUE SE NOMBRA LA CREDENCIAL EN LA MARCA. `[redactado]` a secas obliga a
// adivinar cual de las cuatro credenciales del proyecto fue la que devolvio 401.
// `[redactado:token-del-gestor]` deja el log util para diagnosticar sin revelar
// nada: el nombre ya se ve en la interfaz.
//
// DECISION, Y ES LA PARTE INCOMODA. Para reconocer un valor hay que tener con
// que compararlo, asi que este modulo —y solo este— mantiene los valores en
// memoria mientras el servicio vive. Se consideró la alternativa de no tenerlos:
// guardar solo la huella y la longitud, y recorrer el texto calculando el HMAC
// de cada ventana de esa longitud. Es exacta y no guarda ningun valor, pero
// cuesta un HMAC por caracter y por credencial, y sobre un transcript de 100 KB
// con cuatro credenciales se va a segundos por documento — es decir, se acaba
// apagando. Lo que si se hace es que los valores vivan en el cierre y no en un
// campo: asi no hay `JSON.stringify` ni `inspect` que los alcance, que es la via
// por la que de verdad se escapan.

import { fallar } from "./errores.mjs";

/**
 * @param {{ backend: any, repositorio: any, auditoria: any }} piezas
 */
export function crearRedactor({ backend, repositorio, auditoria }) {
  /** @type {{ valor: string, nombre: string }[]|null} */
  let indice = null;

  function exigirCargado() {
    if (indice === null) {
      fallar(
        "redactor_sin_cargar",
        "se pidio redactar antes de cargar las huellas de la boveda",
        "llama a `cargarHuellas()` al arrancar: un redactor vacio devuelve el texto tal cual y parece que funciono",
      );
    }
  }

  return {
    /** Trae de la boveda con que comparar. Hay que volver a llamarla tras una rotacion o un alta. */
    async cargarHuellas() {
      const cargado = [];
      for (const credencial of repositorio.credenciales()) {
        const valor = await backend.recuperar(credencial.ref_boveda);
        if (typeof valor === "string" && valor.length > 0) {
          cargado.push({ valor, nombre: credencial.nombre });
        }
      }
      // La mas larga primero: si una credencial contiene a otra (un token y su
      // prefijo), redactar la corta antes parte la larga y deja la cola suelta.
      cargado.sort((a, b) => b.valor.length - a.valor.length);
      indice = cargado;
      auditoria.registrar({
        tipo: "redaccion_cargada",
        resultado: "ok",
        cuantas: cargado.length,
        credenciales: cargado.map((c) => c.nombre),
      });
    },

    /**
     * @param {string} texto
     * @returns {string}
     */
    redactar(texto) {
      exigirCargado();
      if (typeof texto !== "string" || texto.length === 0) return texto;
      let salida = texto;
      for (const { valor, nombre } of /** @type {any[]} */ (indice)) {
        // `split`/`join` y no una expresion regular: el valor es texto
        // arbitrario y un caracter especial sin escapar convierte la redaccion
        // en una expresion que no coincide con nada.
        if (salida.includes(valor)) salida = salida.split(valor).join(`[redactado:${nombre}]`);
      }
      return salida;
    },

    /**
     * Igual sobre estructuras, recursivo. Devuelve una copia: el llamante puede
     * seguir necesitando el original para inyectar, y mutarselo por la espalda
     * rompe el lanzamiento.
     *
     * @template T
     * @param {T} obj
     * @returns {T}
     */
    redactarObjeto(obj) {
      exigirCargado();
      const yo = this;
      /** @param {any} v */
      const recorrer = (v) => {
        if (typeof v === "string") return yo.redactar(v);
        if (Array.isArray(v)) return v.map(recorrer);
        if (v instanceof Date || v === null || typeof v !== "object") return v;
        const salida = {};
        for (const [clave, valor] of Object.entries(v)) {
          // La clave tambien es texto que se persiste: un objeto indexado por el
          // valor de la credencial la deja en disco en el nombre del campo.
          salida[yo.redactar(clave)] = recorrer(valor);
        }
        return salida;
      };
      return recorrer(obj);
    },
  };
}
