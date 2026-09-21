// Que backend guarda los secretos, y por que ese.
//
// EL FALLO QUE EVITA (T131). En un servidor Linux sin Secret Service —o en un
// contenedor, o en CI— el llavero del sistema no existe. Una boveda que lo
// detecta y pasa al archivo cifrado sin decirlo le cambia el modelo de amenaza
// al operador sin avisarle: el cree que el secreto lo protege el sistema
// operativo junto con su sesion, y en realidad lo protege una frase de paso que
// quiza esta en un `.env` al lado. Esa diferencia no se ve en ninguna pantalla
// si nadie la declara, y es exactamente el caso donde mas importa.
//
// Por eso esta funcion no devuelve un tipo: devuelve un tipo Y un motivo, y la
// boveda se niega a arrancar con un backend que no traiga el suyo.

import { BACKENDS } from "../modelo.mjs";

/**
 * @param {{ llavero: { disponible: boolean, evidencia?: string, causa?: string } }} sondeo
 * @returns {{ tipo: string, motivo: string, evidencia?: string }}
 */
export function elegirBackend({ llavero }) {
  if (llavero?.disponible) {
    return {
      tipo: "keychain_so",
      motivo:
        "el llavero del sistema operativo respondio al sondeo, asi que el valor lo guarda el sistema " +
        "y no un archivo de esta aplicacion",
      evidencia: llavero.evidencia,
    };
  }
  const causa = llavero?.causa ?? "el sondeo del llavero del sistema no respondio y no dijo por que";
  return {
    tipo: "archivo_cifrado",
    motivo:
      `no se pudo usar el llavero del sistema operativo: ${causa}. Los secretos quedan en un archivo ` +
      "cifrado con una clave derivada de la frase de paso, que es un modelo de amenaza distinto: " +
      "quien tenga el archivo y la frase tiene los secretos",
  };
}

/**
 * La forma que `/v1/capabilities` espera, con el origen declarado (principio X).
 *
 * Existe aqui para que el servicio no tenga que reconstruirla —ni inventarla—
 * cuando conecte la boveda. Una capacidad sin origen es una capacidad inventada,
 * y la de la boveda es la peor de todas para inventar: la interfaz dibuja un
 * llavero que nadie ejercio y el operador guarda una credencial creyendo que va
 * ahi.
 *
 * @param {{ tipo: string, motivo: string, evidencia?: string }} declarado
 * @returns {Record<string, any>}
 */
export function descripcionParaCapacidades(declarado) {
  const base = { valor: { tipo: declarado.tipo, motivo: declarado.motivo }, origen: "detectado" };
  return declarado.evidencia ? { ...base, evidencia: declarado.evidencia } : { ...base, motivo: declarado.motivo };
}

/**
 * @param {string} tipo
 * @returns {boolean}
 */
export function esBackendConocido(tipo) {
  return BACKENDS.includes(tipo);
}
