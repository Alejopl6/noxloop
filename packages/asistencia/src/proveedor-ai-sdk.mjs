// LA FRONTERA. El unico archivo de este paquete que nombra un paquete de
// terceros, y el unico que llama a un modelo de verdad.
//
// POR QUE HAY UNA FRONTERA Y NO ESTA REPARTIDO. Porque el resto del paquete
// —los esquemas, el sellado, la comprobacion de citas, el recorte del insumo—
// es donde vive lo que hace que una sugerencia se pueda enseñar sin mentir, y
// todo eso tiene que poder probarse sin red y seguir funcionando cuando el SDK
// no esta. Con la llamada repartida, cualquier prueba de cualquier pieza acaba
// necesitando una clave.
//
// POR QUE EL IMPORT ES DINAMICO, Y ES LA DECISION QUE MAS PESA AQUI. Con un
// `import` estatico, cargar este modulo revienta si el SDK no esta — y entonces
// la asistencia no puede declarar su ausencia, porque el modulo que la
// declararia no llega a cargarse. En la aplicacion instalada eso es una ventana
// que no abre y una traza que el operador no puede usar. Con el import dinamico
// el fallo llega donde se puede convertir en una causa y una accion.
//
// EL FALLO CONCRETO QUE ESTO HACE VISIBLE, Y QUE YA MORDIO DOS VECES EN ESTE
// REPOSITORIO: al escritorio viaja lo que `tauri.conf.json` declara y nada mas,
// y el bundle no lleva `node_modules`. `import { generateObject } from "ai"`
// resuelve perfectamente en desarrollo y muere con `ERR_MODULE_NOT_FOUND` en la
// aplicacion instalada. Lo que lo cierra de verdad es la declaracion del
// subarbol en `bundle.resources` y la guarda que la ata a estos imports
// (`packages/service/test/recursos-del-escritorio.test.mjs`). Esto de aqui es
// la red debajo: si alguien deshace esa declaracion, el operador lee por que.
//
// POR QUE `cargar` SE PUEDE INYECTAR. Para poder probar la degradacion sin
// desinstalar nada y sin red: la prueba pasa un cargador que falla igual que
// fallaria el bundle roto. Por defecto es el import de verdad.

import { modeloNoContesto, sdkAusente } from "./errores.mjs";

/**
 * El modelo por defecto.
 *
 * Se declara aqui y viaja en la `procedencia` de cada sugerencia: sin saber que
 * modelo la produjo, «esto lo sugirio un modelo» no se puede auditar despues.
 */
export const MODELO_POR_DEFECTO = "claude-opus-5";

/** Lo que se carga, y de donde. La lista es la que la guarda de empaquetado mira. */
const PAQUETES = Object.freeze(["ai", "@ai-sdk/anthropic"]);

/**
 * El cargador de verdad. Separado para poder sustituirlo en las pruebas.
 *
 * @param {string} especificador
 */
async function cargarDeVerdad(especificador) {
  if (especificador === "ai") return await import("ai");
  return await import("@ai-sdk/anthropic");
}

/**
 * Un proveedor de modelo sobre el AI SDK.
 *
 * LA CLAVE ENTRA Y NO SALE. Llega por parametro —la saca de la boveda quien
 * monta esto, con su grant y su motivo— vive en el cliente que se construye
 * aqui, y no se copia a ningun sitio. Los errores del SDK se reescriben en vez
 * de propagarse: un cliente HTTP que falla suele serializar su configuracion
 * dentro del mensaje, y ahi es donde la clave volveria.
 *
 * @param {{clave: string, modelo?: string, cargar?: (especificador: string) => Promise<any>}} opts
 * @returns {import("./asistencia.mjs").ProveedorDeModelo}
 */
export function crearProveedorDeAiSdk({ clave, modelo = MODELO_POR_DEFECTO, cargar = cargarDeVerdad }) {
  if (typeof clave !== "string" || clave.length === 0) {
    throw new TypeError(
      "el proveedor del AI SDK necesita la clave del modelo. No la busca en el entorno a proposito: en este " +
        "producto la clave es una credencial de la boveda y se recupera con su grant y su motivo, que es lo " +
        "que deja el rastro en la auditoria.",
    );
  }

  return async ({ esquema, sistema, instruccion }) => {
    /** @type {any} */
    let ai;
    /** @type {any} */
    let anthropic;
    for (const paquete of PAQUETES) {
      try {
        const cargado = await cargar(paquete);
        if (paquete === "ai") ai = cargado;
        else anthropic = cargado;
      } catch (e) {
        // Se distingue «no esta» de «esta y fallo». Si las dos salieran igual,
        // la accion mandaria al operador a revisar el empaquetado por un
        // problema de credencial, o al reves.
        throw sdkAusente(paquete, /** @type {any} */ (e)?.message ?? e);
      }
    }

    try {
      const cliente = anthropic.createAnthropic({ apiKey: clave });
      const salida = await ai.generateObject({
        model: cliente(modelo),
        // `jsonSchema` es lo que permite pasar un esquema JSON plano en vez de
        // uno de zod. No es una comodidad: es lo que mantiene a zod fuera de
        // los esquemas de este paquete, que se validan tambien sin el SDK.
        schema: ai.jsonSchema(esquema),
        system: sistema,
        prompt: instruccion,
      });
      return { objeto: salida.object, modelo, proveedor: "anthropic" };
    } catch (e) {
      // EL MENSAJE ORIGINAL NO SE PROPAGA TAL CUAL. Un cliente HTTP que falla
      // serializa sus cabeceras dentro del mensaje con frecuencia, y ahi va la
      // clave. Se conserva lo que sirve para diagnosticar y se corta el resto.
      throw modeloNoContesto(sinLaClave(/** @type {any} */ (e)?.message ?? String(e), clave));
    }
  };
}

/**
 * El mensaje de un fallo, con la clave fuera.
 *
 * POR QUE NO BASTA CON CONFIAR EN QUE EL SDK NO LA METE. El principio IX no se
 * sostiene revisando lo que hace cada dependencia en cada version: se sostiene
 * si hay un punto por el que pasa todo lo que sale de aqui. Este es ese punto
 * para esta frontera; el otro es el redactor de la boveda, que vuelve a mirar
 * la respuesta entera antes de que salga por el cable.
 *
 * @param {string} mensaje
 * @param {string} clave
 */
function sinLaClave(mensaje, clave) {
  const limpio = mensaje.split(clave).join("[redactado:clave-del-modelo]");
  // Y un tope: un mensaje de varios kilobytes no diagnostica nada y si arrastra
  // el cuerpo entero de la peticion, que es donde va el insumo del proyecto.
  return limpio.length > 400 ? `${limpio.slice(0, 400)}…` : limpio;
}
