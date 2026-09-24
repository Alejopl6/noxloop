// Arrancar es correr el preflight y negarse a seguir si algo falta.
//
// POR QUE ES UNA FUNCION APARTE Y NO ALGO QUE HAGA `crearProveedor...`. El
// preflight toca el sistema —sondea un puerto— y construir un objeto no deberia
// hacer eso: la construccion ocurre en cada prueba, en cada importacion y en
// cualquier herramienta que cargue el modulo para mirarlo. Separar las dos
// cosas es lo que permite que el preflight sea de verdad "al arrancar" y no
// "cada vez que alguien menciona el paquete".
//
// POR QUE FALLA RUIDOSAMENTE EN VEZ DE DEGRADAR. Con el puerto del callback
// ocupado no hay degradacion posible: todos los flujos OAuth quedan rotos y el
// error que devuelve cada proveedor no menciona ningun puerto. Arrancar "a
// medias" convierte un fallo de arranque en cinco tickets distintos.

import { fallar } from "./errores.mjs";

/**
 * @param {{ preflight: () => Promise<{ ok: boolean, problemas: Array<{codigo:string,causa:string,accion:string}>, requisitos: any[] }> }} proveedor
 * @returns {Promise<any>}
 */
export async function arrancar(proveedor) {
  const estado = await proveedor.preflight();
  if (!estado.ok) {
    fallar(
      "preflight_fallido",
      estado.problemas.map((p) => `${p.codigo}: ${p.causa}`).join(" | "),
      estado.problemas.map((p) => p.accion).join(" | "),
    );
  }
  return estado;
}
