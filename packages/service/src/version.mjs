// La version que `/v1/health` anuncia sale del manifiesto, no de una constante
// copiada aqui.
//
// EL FALLO QUE EVITA. Una constante duplicada se olvida en el `npm version` que
// viene, y entonces el servicio dice una version y el paquete instalado es
// otra. La interfaz usa ese numero para decidir si el servicio que tiene
// delante entiende sus rutas: con el numero equivocado, el diagnostico que
// deberia decir "el servicio es viejo" dice "todo bien" y el fallo real aparece
// tres pantallas despues, como un 404 sin explicacion.
//
// Se lee con `readFileSync` y no con un `import ... with { type: "json" }`
// porque la forma de importar JSON sigue moviendose entre versiones de Node, y
// el motor de este repositorio corre con Node 20 como minimo.

import { readFileSync } from "node:fs";

/** @type {string} */
export const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  } catch {
    return "0.0.0";
  }
})();
