// El orquestador: insumo, proveedor, esquema, sellado. En ese orden y sin
// atajos.
//
// POR QUE EL PROVEEDOR SE INYECTA. Es el mismo criterio que los adaptadores de
// runtime y el proveedor de conexiones: construir el cliente del modelo decide
// la clave, el modelo y el transporte, y eso lo sabe quien monta el servicio, no
// este paquete. El efecto que importa es otro: con el proveedor inyectado, las
// pruebas de este paquete no llaman a ningun modelo. Una suite que necesita red
// tarda, cuesta, falla cuando no hay red — y lo que falla cuando no hay red se
// acaba desactivando. Ademas seria no determinista: el fallo aparece el dia que
// el modelo devuelve algo distinto, sin que nadie haya tocado nada.
//
// EL ORDEN NO ES CASUAL, Y CADA PASO CORTA ANTES DE GASTAR:
//
//   1. La tarea y su insumo. Si falta el area, las formas de comprobacion o los
//      hallazgos, se corta AQUI: sin insumo lo que volveria seria texto sobre
//      proyectos en general, y ademas se habria pagado una llamada por el.
//   2. El proveedor, con el esquema delante.
//   3. La validacion contra el mismo esquema, en este codigo. Ver `esquema.mjs`.
//   4. El sellado, que marca y comprueba las citas. Ver `marca.mjs`.
//
// LO QUE ESTE PAQUETE NO HACE EN NINGUN PASO: escribir. Propone. La escritura
// de una guideline o de una constitution pasa por su `PUT` y por una persona.

import { modeloNoContesto, salidaNoEncaja, tareaDesconocida } from "./errores.mjs";
import { problemasDe } from "./esquema.mjs";
import { sellar } from "./marca.mjs";
import { TAREAS, tareaPorClave } from "./tareas.mjs";

/**
 * @typedef {(peticion: {esquema: any, sistema: string, instruccion: string}) => Promise<{objeto: any, modelo: string, proveedor: string}>} ProveedorDeModelo
 */

/**
 * @param {{proveedor: ProveedorDeModelo, reloj?: () => number}} piezas
 */
export function crearAsistencia({ proveedor, reloj = () => Date.now() }) {
  if (typeof proveedor !== "function") {
    // Se rompe al construir y no en la primera peticion. Un `null` aqui saldria
    // como un `TypeError` dentro de un manejador HTTP, o sea como un 500 sin
    // causa, y en el peor momento: cuando el operador acaba de configurar la
    // credencial y espera que funcione.
    throw new TypeError(
      "la asistencia necesita un proveedor de modelo inyectado: es una funcion `(peticion) => {objeto, modelo, proveedor}`. " +
        "No se construye aqui porque construirlo decide la clave, el modelo y el transporte, y eso lo sabe " +
        "quien monta el servicio.",
    );
  }

  return {
    /** Lo que esta asistencia sabe proponer, y por que cada cosa no es determinista. */
    tareas() {
      return TAREAS.map((t) => ({
        clave: t.clave,
        titulo: t.titulo,
        para_que: t.para_que,
        por_que_no_es_determinista: t.por_que_no_es_determinista,
        esquema: t.esquema_id,
      }));
    },

    /**
     * @param {{tarea: string, snapshot: any, opciones?: any}} peticion
     */
    async sugerir({ tarea, snapshot, opciones = {} }) {
      const declarada = tareaPorClave(tarea);
      if (!declarada) throw tareaDesconocida(tarea, TAREAS.map((t) => t.clave));

      // 1. El insumo. Lanza con su causa si falta algo, ANTES de gastar una
      // llamada al modelo.
      const { sistema, instruccion } = declarada.preparar({ snapshot, opciones });
      const esquema = declarada.esquema(opciones);

      // 2. El proveedor.
      let respuesta;
      try {
        respuesta = await proveedor({ esquema, sistema, instruccion });
      } catch (e) {
        // Un error que ya sabe decir su causa y su accion pasa tal cual: es el
        // caso del SDK ausente, que necesita una accion propia —revisar el
        // empaquetado— y no la de «el modelo no contesto».
        if (e && typeof (/** @type {any} */ (e).codigo) === "string") throw e;
        throw modeloNoContesto(/** @type {any} */ (e)?.message ?? e);
      }

      if (!respuesta || typeof respuesta.objeto !== "object" || respuesta.objeto === null) {
        throw salidaNoEncaja("el proveedor no devolvio ningun objeto");
      }

      // 3. La validacion, contra el mismo esquema que viajo.
      const problemas = problemasDe(respuesta.objeto, esquema, "la sugerencia");
      if (problemas.length > 0) {
        throw salidaNoEncaja(problemas, opciones.formas_de_comprobacion);
      }

      // 4. El sellado: limpiar, comprobar citas, marcar.
      return sellar({
        tarea: declarada.clave,
        esquema,
        esquemaId: declarada.esquema_id,
        objeto: respuesta.objeto,
        snapshot,
        procedencia: {
          modelo: respuesta.modelo,
          proveedor: respuesta.proveedor,
          generado: new Date(reloj()).toISOString(),
        },
      });
    },
  };
}
