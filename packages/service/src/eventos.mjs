// El canal de eventos: un solo stream para toda la interfaz.
//
// POR QUE UNO SOLO. Los navegadores limitan las conexiones simultaneas por
// origen (seis en HTTP/1.1). Un canal por pantalla deja a la septima pestaña
// colgada esperando un socket que no llega, y el sintoma es una pantalla que se
// queda quieta sin ningun error.
//
// POR QUE EL BUFFER ES ACOTADO. Guardar todos los eventos de una sesion larga
// es una fuga de memoria con forma de feature: un scan de diez mil archivos
// emite diez mil eventos de progreso.
//
// POR QUE EL HUECO SE DECLARA EN VEZ DE MANDAR LO QUE QUEDE. Si al reconectar
// falta mas de lo que el buffer guarda, reenviar lo que hay le deja a la
// interfaz un estado al que le faltan transiciones SIN forma de saberlo: pinta
// un proyecto en la etapa equivocada y se queda ahi. FR-005 lo prohibe en una
// linea: nunca se muestra estado rancio como si fuera fresco. Por eso el
// servicio dice `sincronizar_completo` y la interfaz vuelve a pedir el estado.

/** Cuantos eventos se guardan para reenviar tras una reconexion. */
export const CAPACIDAD_POR_DEFECTO = 256;

/**
 * Cada cuanto se manda un comentario SSE. Un proxy o un NAT corta las
 * conexiones calladas, y el corte no produce ningun error visible: la interfaz
 * cree seguir conectada y deja de recibir.
 */
export const LATIDO_POR_DEFECTO_MS = 15000;

/**
 * @typedef {object} Evento
 * @property {string} id
 * @property {string} tipo
 * @property {string|null} project_id
 * @property {any} datos
 * @property {string} ts
 */

/**
 * @param {{capacidad?: number, latidoMs?: number}} [opts]
 */
export function crearBus(opts = {}) {
  const capacidad = opts.capacidad ?? CAPACIDAD_POR_DEFECTO;
  const latidoMs = opts.latidoMs ?? LATIDO_POR_DEFECTO_MS;

  let ultimo = 0;
  /** @type {Evento[]} */
  const buffer = [];
  /** @type {Set<{res: any, latido: any}>} */
  const clientes = new Set();

  const escribir = (res, evento) => {
    // El `event:` va ademas del `tipo` del cuerpo para que `addEventListener`
    // del cliente funcione sin parsear el JSON. El `id:` es lo que el navegador
    // devuelve como `Last-Event-ID` al reconectar: sin el, la reconexion
    // automatica de EventSource pierde todo lo de la caida.
    res.write(`id: ${evento.id}\nevent: ${evento.tipo}\ndata: ${JSON.stringify(evento)}\n\n`);
  };

  /** @param {string} desde */
  const sincronizacion = (desde) => ({
    id: String(ultimo),
    tipo: "sincronizar_completo",
    project_id: null,
    // El id viaja al dia a proposito: si se dejara el del cliente, la proxima
    // reconexion volveria a pedir sincronizacion completa, y la siguiente
    // tambien, para siempre.
    datos: { desde, ultimo: String(ultimo), capacidad },
    ts: new Date().toISOString(),
  });

  return {
    capacidad,
    latidoMs,
    ultimoId: () => ultimo,

    /**
     * @param {string} tipo
     * @param {any} [datos]
     * @param {{project_id?: string|null}} [extra]
     */
    emitir(tipo, datos = {}, extra = {}) {
      const evento = {
        id: String(++ultimo),
        tipo,
        project_id: extra.project_id ?? null,
        datos,
        ts: new Date().toISOString(),
      };
      buffer.push(evento);
      while (buffer.length > capacidad) buffer.shift();
      for (const c of clientes) {
        try {
          escribir(c.res, evento);
        } catch {
          // Un cliente que ya no esta no puede tumbar a los demas ni al emisor.
        }
      }
      return evento;
    },

    /**
     * Engancha una respuesta HTTP ya con cabeceras al canal.
     *
     * @param {any} res
     * @param {string|null|undefined} desde valor de `Last-Event-ID` o de la query
     */
    suscribir(res, desde) {
      // El primer comentario sale sin esperar nada: fuerza el vaciado de las
      // cabeceras, que es lo que hace que `fetch` resuelva y que EventSource
      // dispare `onopen`. Sin el, un canal sin eventos parece un canal caido.
      res.write(": conectado\n\n");

      const crudo = desde == null ? "" : String(desde).trim();
      if (crudo) {
        const numero = /^\d+$/.test(crudo) ? Number(crudo) : null;
        const primero = buffer.length ? Number(buffer[0].id) : ultimo + 1;
        // Un id ilegible, o uno de una sesion anterior con la numeracion mas
        // alta, es un hueco: tratarlo como "al dia" es la forma callada de
        // dejar a la interfaz sin las transiciones que se perdio.
        const hueco = numero === null || numero > ultimo || numero < primero - 1;
        if (hueco) escribir(res, sincronizacion(crudo));
        else for (const e of buffer) if (Number(e.id) > numero) escribir(res, e);
      }

      const latido = setInterval(() => {
        try {
          res.write(": latido\n\n");
        } catch {
          /* la conexion ya no esta: el cierre lo hace el evento `close` */
        }
      }, latidoMs);
      if (typeof latido.unref === "function") latido.unref();

      const cliente = { res, latido };
      clientes.add(cliente);

      const soltar = () => {
        clearInterval(latido);
        clientes.delete(cliente);
      };
      res.on("close", soltar);
      res.on("error", soltar);
      return cliente;
    },

    /**
     * Cierre limpio: se avisa y despues se corta. Al reves, la interfaz ve una
     * conexion caida y no puede distinguir un apagado de un proceso muerto —
     * que es justo lo que el evento `servicio.parando` existe para decir.
     */
    cerrarTodo() {
      this.emitir("servicio.parando", { motivo: "cierre limpio" });
      for (const c of [...clientes]) {
        clearInterval(c.latido);
        clientes.delete(c);
        try {
          c.res.end();
        } catch {
          /* ya estaba cerrada */
        }
      }
    },

    /** Cuantos clientes hay enganchados. Para tests y para `/v1/health`. */
    conectados: () => clientes.size,
  };
}
