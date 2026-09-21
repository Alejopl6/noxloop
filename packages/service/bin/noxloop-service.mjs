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

import {
  crearAdaptadorClaude,
  crearAdaptadorCodex,
  registroDeAdaptadores,
} from "../../adapters/src/index.mjs";
import { buildHookSettings, validateHookSettings } from "../../engine/src/session-settings.mjs";

import { crearAdaptadorLocal } from "../../connections/src/adaptadores/local.mjs";

import { resolverHome } from "../src/home.mjs";
import { ErrorDeServicio } from "../src/errores.mjs";
import { arrancar } from "../src/servidor.mjs";

/**
 * El registro de runtimes que este binario monta.
 *
 * POR QUE VIVE AQUI Y NO EN EL SERVICIO. Construir un adaptador decide el
 * binario que se lanza, sus hooks y su home — cosas de la maquina del operador,
 * no del proceso. El servicio los recibe inyectados a proposito, y ese diseño
 * es correcto.
 *
 * EL HUECO QUE ESTO CIERRA. Nadie los inyectaba. `GET /agents/suggest`
 * devolvia 503 `pieza_ausente` con un mensaje impecable —nombraba la pieza, el
 * porque y la alternativa— y era inalcanzable desde el producto: Tauri lanza
 * ESTE binario como sidecar, asi que la aplicacion de escritorio recibia el
 * mismo 503. La sugerencia de flota existia, estaba probada, y no habia forma
 * de llegar a ella.
 *
 * Es el fallo de las costuras otra vez: dos piezas correctas y nadie
 * conectandolas. Salio al levantar el servicio para mirarlo, no de un test —
 * cada lado pasaba los suyos.
 *
 * NO SE COMPRUEBA SI ESTAN INSTALADOS. Registrar no es prometer: cada adaptador
 * declara en `capabilities()` lo que sabe hacer y `preflight()` contesta si
 * puede aqui y ahora. Sondearlos al arrancar significaria lanzar procesos antes
 * de escuchar en ningun puerto, y retrasar el `NOXLOOP_READY` que la cascara
 * espera.
 *
 * SE MONTAN CON LAS GUARDAS PUESTAS, y esto no es un detalle de configuracion.
 * La primera version los construia desnudos y el resultado fue instructivo: la
 * sugerencia de flota devolvia `sugerida: false` y se negaba a proponer un
 * implementador, diciendo que ningun runtime declara `hooks: true` y que sin
 * hooks no se puede correr la guarda del paso RED dentro del subproceso.
 *
 * Tenia razon. Un implementador sin el hook del TDD depende de que el prompt se
 * acuerde, y el principio I ya lo midio: un prompt funciona en las dos primeras
 * iteraciones y deja de funcionar en la tercera. El rechazo era el
 * comportamiento correcto ante un montaje incorrecto.
 *
 * `validateHookSettings` corta si los hooks declarados no estan en disco. Se
 * prefiere no registrar a registrar sin guardas: un runtime que dice poder
 * implementar y no puede hacer cumplir el rojo es peor que ninguno.
 *
 * @param {string} home
 */
function registroDeRuntimes(home) {
  const guardas = buildHookSettings();
  const v = validateHookSettings(guardas);
  if (!v.ok) {
    aviso(
      "runtimes sin registrar: las guardas de los hooks no validan" +
        (v.missing?.length ? ` (faltan en disco: ${v.missing.join(", ")})` : "") +
        ". La sugerencia de flota lo dira con su causa en vez de proponer agentes sin guardas.",
    );
    return null;
  }
  return registroDeAdaptadores([
    crearAdaptadorClaude({ home, hooks: guardas, directoriosExtra: [home] }),
    crearAdaptadorCodex(),
  ]);
}

/**
 * El proveedor de conexiones que este binario monta.
 *
 * EL HUECO QUE ESTO CIERRA, Y ES EL MISMO PATRON QUE YA PASO CON LOS RUNTIMES.
 * Nadie lo inyectaba. `GET /v1/projects/:id/connections`, `authorize`, el
 * callback y `DELETE /v1/connections/:id` devolvian 503 `pieza_ausente` con un
 * mensaje impecable — y como el escritorio lanza ESTE binario como sidecar, la
 * aplicacion recibia el mismo 503 en las cuatro. Medido con curl contra el
 * servicio corriendo antes de tocar nada: la pantalla de conexiones tenia
 * botones y ninguno podia hacer nada.
 *
 * POR QUE ES UNA FABRICA Y NO UN ADAPTADOR YA CONSTRUIDO. El adaptador que
 * guarda tokens personales necesita el deposito de secretos, y ese nace dentro
 * del cableado, a partir del home y de la frase de paso. Aqui no hay forma de
 * tenerlo antes; se declara COMO construirlo y el cableado lo llama con la
 * boveda ya montada.
 *
 * POR QUE ESTE ADAPTADOR Y NO EL ALOJADO. No es una preferencia: es el reparto
 * que decide el catalogo. El alojado atiende los modos con flujo de
 * autorizacion y necesita tres contenedores levantados y una aplicacion propia
 * registrada con cada proveedor — dos cosas que no se pueden montar desde un
 * ejecutable. Este atiende los modos que se conectan pegando un valor, que es
 * lo que se puede hacer hoy, sin Docker y sin registrar nada.
 *
 * SIN BOVEDA NO SE MONTA, y no es una degradacion silenciosa: un adaptador que
 * acepta el token y no tiene donde guardarlo lo pediria para tirarlo. El
 * cableado declara esa ausencia con su causa y su accion.
 *
 * @param {{boveda: any, workspace: any}} piezas
 */
function proveedorDeConexiones({ boveda, workspace }) {
  if (!boveda) return null;
  // El espacio de trabajo viaja porque el deposito indexa por el, y porque un
  // proyecto NO es un espacio de trabajo: pasarle el proyecto es lo que hacia
  // que guardar el primer token muriera con un error de clave foranea.
  return crearAdaptadorLocal({ boveda, workspaceId: workspace.id });
}

const AYUDA = `noxloop-service — el servicio de control: unico escritor del almacen.

Uso: noxloop-service [opciones]

  --home <ruta>       directorio de estado. Por defecto NOXLOOP_HOME, y si no ~/.noxloop
  --token <token>     token de sesion. Si no se pasa, se genera uno y se escribe
                      en <home>/servicio/sesion.json con permisos 0600
  --port <puerto>     por defecto uno efimero, para no chocar con nada
  --origen <origen>   se puede repetir. Reemplaza la allowlist por defecto
  --raiz <ruta>       desde donde se puede explorar el disco en la pantalla de
                      alta. Se puede repetir. Por defecto, el home del operador —
                      nunca la raiz del sistema de archivos. Las carpetas de los
                      proyectos ya dados de alta son raices siempre
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
  const repetibles = new Set(["origen", "raiz"]);
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
    raicesDeExploracion: textos(flags, "raiz"),
    adaptadores: registroDeRuntimes(home),
    proveedorDeConexiones,
  });

  aviso(`home: ${svc.home} (de ${de})`);

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

  // LA MARCA DE LISTO VA DESPUES DE LOS MANEJADORES, y el orden no es estetico.
  //
  // EL FALLO QUE EVITA, medido: estaba al reves, y la prueba de cierre limpio
  // fallaba una de cada cuatro corridas de la suite completa. Quien lee esta
  // linea —el escritorio, una prueba— sabe que el servicio esta en pie y puede
  // mandarle una senal en el instante siguiente. Con los manejadores sin
  // instalar todavia, esa senal la atiende el comportamiento por defecto: el
  // proceso muere sin soltar el lock y sale por senal, no con codigo 0. El
  // sintoma es un lock huerfano que impide el siguiente arranque, y el operador
  // tiene que borrar un archivo a mano para volver a abrir la aplicacion.
  //
  // La ventana es de microsegundos y por eso solo se veia bajo carga. La
  // propiedad que este orden garantiza se dice en una linea: si puedes verme,
  // puedes pararme limpio.
  process.stdout.write(`NOXLOOP_READY ${svc.url}\n`);
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
