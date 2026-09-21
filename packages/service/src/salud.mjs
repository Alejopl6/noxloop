// Salud, capacidades y el canal de eventos.
//
// `/v1/health` es lo primero que pide la interfaz. Si no responde, la interfaz
// muestra "el servicio no esta corriendo" con la accion concreta (FR-005) — y
// nunca una pantalla en blanco ni datos rancios.

import { capacidades as capacidadesDelServicio } from "./capacidades.mjs";
import { descripcionParaCapacidades } from "../../vault/src/index.mjs";
import { ESQUEMA } from "./esquema-de-respuesta.mjs";
import { VERSION } from "./version.mjs";

/** @param {import("./rutas.mjs").Peticion} p */
export function salud(p) {
  return {
    cuerpo: {
      version: VERSION,
      esquema: ESQUEMA,
      home: p.estado.home,
      // El principio VIII no es una promesa del diseño si la interfaz no lo
      // puede comprobar al conectarse: sin esto, una ventana no distingue el
      // servicio de control de cualquier otra cosa escuchando en ese puerto.
      escritorUnico: true,
      arranque: p.estado.arranque,
    },
  };
}

/**
 * Lo que este servicio sabe hacer, y —sobre todo— lo que todavia no.
 *
 * POR QUE LA BOVEDA Y LAS CONEXIONES SE RELLENAN AQUI Y NO EN `capacidades.mjs`.
 * Ese archivo no conoce las dependencias: es una funcion pura que declara los
 * huecos. Lo que se sabe de verdad —que backend quedo elegido, y por que— solo
 * lo sabe el cableado, y es exactamente el dato que el principio X prohibe
 * inventar: la interfaz dibuja un llavero que nadie ejercio, el operador guarda
 * una credencial creyendo que va ahi, y el hueco se descubre cuando ya hay
 * secretos adentro.
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export function capacidades(p) {
  const base = capacidadesDelServicio();
  const dep = p.dep;

  const boveda = dep.backend
    ? descripcionParaCapacidades({ tipo: dep.backend.tipo, motivo: dep.backend.motivo, evidencia: dep.backend.evidencia })
    : { valor: null, origen: "vacio", motivo: dep.ausenciaDeLaBoveda.porque };

  const conexiones = dep.conexiones
    ? { valor: { adaptador: dep.conexiones.id }, origen: "detectado", evidencia: `adaptador \`${dep.conexiones.id}\`` }
    : { valor: null, origen: "vacio", motivo: dep.ausenciaDeConexiones.porque };

  return {
    cuerpo: {
      ...base,
      boveda,
      conexiones,
      almacen: {
        valor: { version_esquema: dep.almacen.version, workspace: dep.workspace.id },
        origen: "detectado",
        evidencia: dep.home,
      },
    },
  };
}

/** @param {import("./rutas.mjs").Peticion} p */
export function eventos(p) {
  p.res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    // Sin esto, un proxy que vaya en medio acumula el stream en un buffer y la
    // interfaz no recibe nada hasta que hay varios kilobytes.
    "x-accel-buffering": "no",
    ...p.cors,
  });
  // `Last-Event-ID` lo manda EventSource solo al reconectar. El parametro de
  // query es para el cliente que reconecta a mano despues de un cierre.
  const desde = p.req.headers["last-event-id"] ?? p.url.searchParams.get("ultimo_evento");
  p.estado.bus.suscribir(p.res, /** @type {any} */ (desde));
}
