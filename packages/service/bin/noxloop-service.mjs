#!/usr/bin/env node
// El ejecutable del servicio de control.
//
// POR QUE LA LINEA DE LISTO ES UN CONTRATO. El shell de escritorio arranca este
// proceso como sidecar y aprende su URL leyendo `NOXLOOP_READY <url>` en
// stdout. Si cambia el formato de esa linea, la aplicacion abre una ventana que
// no encuentra a su propio servicio, y el sintoma es una pantalla vacia sin
// ningun error visible. Hay un test que la compara letra por letra.
//
// POR QUE STDOUT SOLO LLEVA ESA LINEA. Todo lo demas va a stderr. Un log
// informativo en stdout se mete en medio del parseo del shell.

import { resolverHome } from "../src/home.mjs";
import { ErrorDeServicio } from "../src/errores.mjs";
import { arrancar } from "../src/servidor.mjs";

const AYUDA = `noxloop-service — el servicio de control: unico escritor del almacen.

Uso: noxloop-service [opciones]

  --home <ruta>       directorio de estado. Por defecto NOXLOOP_HOME, y si no ~/.noxloop
  --token <token>     token de sesion. Si no se pasa, se genera uno y se escribe
                      en <home>/servicio/sesion.json con permisos 0600
  --port <puerto>     por defecto uno efimero, para no chocar con nada
  --origen <origen>   se puede repetir. Reemplaza la allowlist por defecto
  --parent-pid <pid>  si ese proceso desaparece, este se apaga solo
  --watchdog-ms <ms>  cada cuanto se comprueba el padre (por defecto 2000)

Escucha SIEMPRE en 127.0.0.1. No hay bandera para cambiarlo.
`;

/**
 * Las banderas repetibles se acumulan; el resto gana la ultima. Es la misma
 * forma de parsear que la CLI del motor, para que las dos se lean igual.
 *
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {Record<string, any>} */
  const flags = {};
  const repetibles = new Set(["origen"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const nombre = a.slice(2);
    const siguiente = argv[i + 1];
    const valor = siguiente && !siguiente.startsWith("--") ? (i++, siguiente) : true;
    if (repetibles.has(nombre)) (flags[nombre] ||= []).push(valor);
    else flags[nombre] = valor;
  }
  return flags;
}

const aviso = (texto) => process.stderr.write(texto + "\n");

/**
 * Un numero de bandera, o nada.
 *
 * EL FALLO QUE EVITA. `Number("sesenta")` es NaN y `Number(true)` —lo que deja
 * una bandera escrita sin valor— es 1. Sin comprobarlo, `--port` a secas
 * arranca el servicio en el puerto 1 y muere con un EACCES que no menciona
 * ninguna bandera: el operador mira la que escribio y la ve bien.
 */
function numero(flags, nombre) {
  if (flags[nombre] === undefined) return undefined;
  const crudo = flags[nombre];
  const n = typeof crudo === "string" ? Number(crudo) : NaN;
  if (!Number.isInteger(n) || n < 0) {
    aviso(`--${nombre} tiene que ser un numero entero, y llego \`${crudo === true ? "" : crudo}\`.`);
    process.exit(2);
  }
  return n;
}

/** Lo mismo para las banderas repetibles: una allowlist con `true` adentro no bloquea, confunde. */
function textos(flags, nombre) {
  if (flags[nombre] === undefined) return undefined;
  const valores = /** @type {any[]} */ (flags[nombre]);
  if (valores.some((v) => typeof v !== "string" || !v.trim())) {
    aviso(`--${nombre} necesita un valor, y una de las veces llego vacia.`);
    process.exit(2);
  }
  return valores;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    aviso(AYUDA);
    return;
  }

  const { home, de } = resolverHome(flags, process.env);

  const svc = await arrancar({
    home,
    token: typeof flags.token === "string" ? flags.token : undefined,
    port: numero(flags, "port"),
    parentPid: numero(flags, "parent-pid"),
    watchdogMs: numero(flags, "watchdog-ms"),
    origenes: textos(flags, "origen"),
  });

  aviso(`home: ${svc.home} (de ${de})`);
  process.stdout.write(`NOXLOOP_READY ${svc.url}\n`);

  // Cierre limpio: se avisa por el canal de eventos, se sueltan las conexiones
  // y se libera el lock. Salir con codigo 0 porque un cierre PEDIDO no es una
  // caida: si saliera con 1, el escritorio informaria una caida cada vez que el
  // operador cierra la ventana, y un informe de caidas que siempre tiene
  // caidas deja de mirarse.
  let saliendo = false;
  for (const senial of ["SIGTERM", "SIGINT"]) {
    process.on(senial, () => {
      if (saliendo) return;
      saliendo = true;
      svc.detener().then(() => process.exit(0), () => process.exit(0));
    });
  }
}

main().catch((e) => {
  if (e instanceof ErrorDeServicio) {
    // Causa y accion, las dos. Un "no pude arrancar" sin el motivo manda a
    // adivinar, y sin la accion manda a reinstalar.
    aviso(`no pude arrancar: ${e.causa}`);
    aviso(`que hacer: ${e.accion}`);
    process.exit(1);
  }
  aviso(`no pude arrancar: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
