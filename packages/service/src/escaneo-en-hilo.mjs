// El recorrido del scanner, en un hilo aparte.
//
// POR QUE UN HILO Y NO UNA LLAMADA NORMAL. Esto se descubrio con una prueba que
// fallaba y costo encontrarlo: `escanear` es `async`, pero su fase de
// inventario es SINCRONA de punta a punta —recorre el arbol entero con
// `readdirSync` antes de llegar a su primer `await`— y sus fases de detectores
// solo ceden a microtareas, que no dejan correr la E/S. El efecto sobre un
// repositorio real es doble y los dos son graves:
//
//   1. El servicio deja de atender a TODO el mundo mientras dura el recorrido.
//      Las otras ventanas se congelan, el canal de eventos no vacia, y los
//      eventos de progreso —que existen precisamente para que se vea que algo
//      pasa— salen todos de golpe al final.
//   2. `DELETE /v1/scans/:id` no puede llegar nunca. La peticion de cancelar
//      se queda en la cola del socket hasta que el recorrido termina, y para
//      entonces ya no hay nada que cancelar. La cancelacion existia en el
//      contrato y no existia en la practica.
//
// En un hilo, el bucle del servicio sigue libre: el progreso sale segun se
// produce y la cancelacion llega a tiempo.
//
// POR QUE CANCELAR ES `terminate()` Y NO UN `AbortSignal`. Una señal no cruza
// la frontera del hilo, y lo que hay que garantizar es mas fuerte que parar
// pronto: FR-015 dice "sin dejar estado parcial". Matar el hilo no deja nada a
// medias por construccion — lo que hubiera leido muere con el— y quien persiste
// es el hilo principal, que escribe un snapshot `cancelado` sin un solo
// hallazgo. Es la misma razon por la que el scanner devuelve `hallazgos: []` al
// cancelarse: no hay forma de saber cuales faltaban, y una lista a medias se
// acaba usando como si fuera entera.

import { parentPort, workerData } from "node:worker_threads";

import { escanear } from "../../scanner/src/index.mjs";

const puerto = /** @type {any} */ (parentPort);

escanear({
  ruta: workerData.ruta,
  alProgresar: (progreso) => puerto.postMessage({ tipo: "progreso", datos: progreso }),
  alHallar: (hallazgo) => puerto.postMessage({ tipo: "hallazgo", datos: hallazgo }),
})
  .then((snapshot) => puerto.postMessage({ tipo: "listo", snapshot }))
  .catch((e) => {
    // Un error del scanner ya viene con causa y accion. Se reenvia como datos
    // —no como una excepcion del hilo— porque una excepcion cruzando la
    // frontera pierde los campos propios y llega como un `Error` pelado, que es
    // justo lo que NFR-006 prohibe devolver.
    puerto.postMessage({
      tipo: "error",
      error: {
        codigo: e && e.codigo ? e.codigo : "recorrido_fallido",
        causa: e && e.causa ? e.causa : String(e && e.message ? e.message : e),
        accion:
          e && e.accion
            ? e.accion
            : "Comprueba que la ruta del proyecto siga existiendo y se pueda leer, y vuelve a escanear.",
      },
    });
  });
