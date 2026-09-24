// El explorador de carpetas: navegar el disco del operador desde la interfaz.
//
// EL FALLO CONCRETO QUE CIERRA. Dar de alta un proyecto exigia ESCRIBIR la ruta
// absoluta a mano. En escritorio hay dialogo nativo de Tauri; en el navegador no
// lo hay —`webkitdirectory` entrega archivos sin ruta y `showDirectoryPicker`
// entrega un manejador que solo sirve dentro de esa pestaña— asi que se dejo un
// campo de texto y ahi quedo. Pero el servicio corre en la maquina del operador
// y SI puede leer el disco: la carpeta estaba a una llamada de distancia, y la
// unica persona que tenia que saberse la ruta de memoria era la que menos
// razones tenia para sabersela.
//
// ------------------------------------------------------------------------
// LA SEGURIDAD, Y POR QUE ES ASI. Esto es un lector del sistema de archivos
// que contesta a peticiones de una pagina web. Merece pensarse entero.
//
// LO QUE YA HABIA, y no se repite aqui: el servicio escucha en 127.0.0.1, exige
// el token de sesion en toda ruta que no sea `/v1/health`, y solo devuelve
// cabeceras de CORS a los origenes de la allowlist (`puerta.mjs`). Eso cierra el
// caso general —la pestaña de un anuncio no puede leer nada de aqui—.
//
// LO QUE HACE FALTA ADEMAS, y el motivo de cada cosa:
//
//   1. UN CONJUNTO DE RAICES, Y `/` NO ES UNA DE ELLAS. El caso general esta
//      cerrado hoy; el dia que la puerta tenga un fallo, la diferencia entre
//      «se filtro que carpetas hay bajo el home» y «se filtro el equipo entero,
//      `/etc` incluido» la decide esta linea. Las raices son el home del
//      operador mas la `ruta_local` de cada proyecto YA dado de alta — o sea,
//      sitios que el propio operador nombro.
//
//      Y confinar no le quita nada, que es lo que hace que la decision sea
//      barata: el campo de texto sigue existiendo y `POST /v1/projects` acepta
//      cualquier ruta. Lo que se acota no es lo que se puede registrar, es la
//      ENUMERACION — convertir «se una ruta» en «dime todo lo que hay» es la
//      capacidad que merece un limite, no la de abrir una carpeta concreta.
//
//   2. SOLO DIRECTORIOS. La pregunta que esta ruta contesta es «¿cual de estas
//      carpetas es tu proyecto?», y para eso los archivos sobran. Devolverlos
//      pondria los nombres de los documentos del operador a viajar por HTTP a
//      cambio de nada. Se cuentan —«3 archivos»— porque saber que una carpeta
//      no esta vacia si sirve para elegirla.
//
//   3. `realpath` ANTES DE COMPARAR. Sin resolver enlaces, un `ln -s / atajo`
//      dentro del home convierte la raiz en el disco entero, y la comprobacion
//      de contencion pasaria mirando una ruta que no es la que se va a leer. Un
//      enlace que apunta fuera de las raices NO se lista: es una puerta, no una
//      carpeta, y listarla es ofrecer un clic que lleva a un 403.
//
//   4. LAS OCULTAS, FUERA POR DEFECTO. `~/.ssh`, `~/.aws`, `~/.gnupg`: sus
//      NOMBRES son un mapa de lo que el operador tiene montado, y ninguna de
//      ellas es un proyecto. No es una medida fuerte —se piden con `?ocultas=si`
//      y ahi estan— es quitar de la respuesta por defecto lo que nadie vino a
//      buscar. Y se CUENTAN: omitir en silencio es la version de mentir que
//      este producto no se permite.
//
// LO QUE NO SE HIZO, dicho a proposito: listar todo el disco porque es mas
// facil, y dejar que la interfaz decida que enseñar. Lo que la interfaz filtra
// ya viajo por el cable.
// ------------------------------------------------------------------------
//
// NO ESCRIBE NADA. Ni una carpeta, ni un archivo temporal, ni una marca de
// acceso. Hay un test que mide el arbol del operador y el home del servicio
// antes y despues.

import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

import { coleccion, limiteDe } from "./comun.mjs";
import { ErrorDeServicio } from "./errores.mjs";

/** Cuantas carpetas se devuelven si nadie pide otra cosa. */
const POR_DEFECTO = 200;

/** El techo, aunque lo pidan mayor. Una carpeta con 5000 entradas no es una pantalla. */
const MAXIMO = 1000;

/**
 * La ruta real, o `null` si no se puede resolver.
 *
 * `realpathSync` y no `resolve`: lo que hay que comparar contra las raices es
 * lo que se va a LEER de verdad. Con `resolve`, un enlace dentro del home que
 * apunta a `/` pasaria la comprobacion de contencion y despues leeria la raiz
 * del disco.
 *
 * @param {string} ruta
 * @returns {string|null}
 */
function real(ruta) {
  try {
    return realpathSync(resolve(ruta));
  } catch {
    // No existe, o un tramo del camino no se puede atravesar. Las dos son
    // respuestas, no fallos del servicio: quien llama las distingue.
    return null;
  }
}

/**
 * Si `ruta` esta dentro de `raiz` —o ES `raiz`—, comparando por SEGMENTOS.
 *
 * EL FALLO QUE EL SEPARADOR EVITA, y es el clasico de esta comprobacion:
 * `"/home/ana-secreta".startsWith("/home/ana")` es cierto, y son dos
 * directorios distintos. Con el separador pegado al prefijo, no.
 *
 * @param {string} ruta
 * @param {string} raiz
 */
function dentroDe(ruta, raiz) {
  return ruta === raiz || ruta.startsWith(raiz.endsWith(sep) ? raiz : raiz + sep);
}

/**
 * Las raices de esta instalacion, con el motivo de cada una.
 *
 * EL MOTIVO VIAJA EN LA RESPUESTA y no solo en este comentario: el operador que
 * se topa con el limite tiene que poder leer POR QUE esa carpeta esta fuera y
 * que hacer —dar de alta el proyecto por su ruta, que es la salida que siempre
 * queda abierta—. Un limite sin explicacion se lee como un fallo del producto.
 *
 * @param {any} estado el estado del servidor, que trae las raices configuradas
 * @param {any} dep las dependencias, de donde salen los proyectos ya gestionados
 * @returns {Array<{ruta: string, motivo: string, proyecto?: {id: string, nombre: string}}>}
 */
function raicesDe(estado, dep) {
  /** @type {Array<{ruta: string, motivo: string, proyecto?: any}>} */
  const raices = [];
  const vistas = new Set();

  const anadir = (ruta, motivo, proyecto) => {
    const resuelta = real(ruta);
    // Una raiz que no existe no se declara: enseñarla produce un boton que
    // siempre falla, y el operador no tiene forma de saber que la carpeta se
    // borro fuera de la aplicacion.
    if (!resuelta || vistas.has(resuelta)) return;
    vistas.add(resuelta);
    raices.push(proyecto ? { ruta: resuelta, motivo, proyecto } : { ruta: resuelta, motivo });
  };

  for (const ruta of estado.raicesDeExploracion ?? []) {
    anadir(
      ruta,
      "es una raiz declarada al arrancar este servicio: quien lo arranco decidio que se puede explorar desde ahi.",
    );
  }

  for (const proyecto of dep.almacen.proyectos.listar(dep.workspace.id)) {
    anadir(
      proyecto.ruta_local,
      `es la carpeta del proyecto \`${proyecto.nombre}\`, que ya esta dado de alta en este home: explorarla ` +
        "es mirar lo que el operador ya nombro.",
      { id: proyecto.id, nombre: proyecto.nombre },
    );
  }

  return raices;
}

/**
 * La raiz que contiene esta ruta, o `null`.
 *
 * @param {string} ruta ya resuelta con `realpath`
 * @param {Array<{ruta: string}>} raices
 */
function raizDe(ruta, raices) {
  // La MAS LARGA gana. Con un proyecto dentro del home, las dos raices
  // contienen la ruta y la que importa es la mas cercana: de ella depende
  // `es_raiz`, y con la otra el explorador dejaria subir por encima del
  // proyecto hasta el home sin que eso lo autorizara nadie... al reves: con la
  // mas corta dejaria subir de mas solo si la mas corta es la unica. Se elige
  // la mas especifica porque es la que describe mejor donde se esta.
  let elegida = null;
  for (const raiz of raices) {
    if (!dentroDe(ruta, raiz.ruta)) continue;
    if (!elegida || raiz.ruta.length > elegida.ruta.length) elegida = raiz;
  }
  return elegida;
}

/**
 * Si una carpeta es un repositorio git, y la evidencia que lo respalda.
 *
 * `.git` puede ser un directorio o —en un worktree— un archivo. `existsSync`
 * cubre los dos; comprobar que sea directorio dejaria fuera los worktrees, que
 * es justo como trabaja quien tiene varias ramas abiertas. Es el MISMO
 * criterio que usa `prepararDestino` en `proyectos.mjs` al aceptar un alta: si
 * el explorador dijera que si donde el alta dice que no, el operador elegiria
 * una carpeta que el paso siguiente rechaza.
 *
 * @param {string} ruta
 */
function repositorio(ruta) {
  const marca = join(ruta, ".git");
  if (existsSync(marca)) {
    return {
      es_repositorio: true,
      procedencia: {
        origen: "detectado",
        porque: "tiene `.git` dentro, que es el mismo criterio con el que el alta de un proyecto `local` la acepta.",
        evidencia: [{ ruta: marca }],
      },
    };
  }
  return {
    es_repositorio: false,
    procedencia: {
      origen: "vacio",
      porque:
        "no se encontro `.git` dentro, asi que no es un repositorio todavia. Darla de alta con origen `local` " +
        "se rechaza; con origen `nuevo` se prepara desde cero.",
      evidencia: [],
    },
  };
}

/**
 * `GET /v1/folders?ruta=&ocultas=&limite=`
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function explorar(p) {
  const raices = raicesDe(p.estado, p.dep);

  if (raices.length === 0) {
    // No puede pasar con el valor por defecto —el home del operador siempre
    // existe— pero si alguien arranca con `--raiz` apuntando a una carpeta que
    // ya no esta. Se dice en vez de contestar una lista vacia que se leeria
    // como «tu disco no tiene carpetas».
    throw new ErrorDeServicio("pieza_ausente", {
      pieza: "una raiz desde la que explorar",
      porque:
        "ninguna de las raices declaradas para este servicio existe en el disco, y no hay ningun proyecto dado " +
        "de alta cuya carpeta pudiera servir de raiz.",
      comoConseguirlo:
        "Da de alta un proyecto escribiendo su ruta absoluta en el campo de la pantalla de alta —el alta acepta " +
        "cualquier ruta— y a partir de ahi su carpeta queda explorable.",
    });
  }

  const pedida = p.url.searchParams.get("ruta");
  const resuelta = real(pedida || raices[0].ruta);

  if (!resuelta) {
    throw new ErrorDeServicio("carpeta_inexistente", { ruta: resolve(pedida || raices[0].ruta) });
  }

  const raiz = raizDe(resuelta, raices);
  if (!raiz) {
    throw new ErrorDeServicio("ruta_fuera_del_alcance", { ruta: resuelta, raices });
  }

  let entradas;
  try {
    const st = statSync(resuelta);
    if (!st.isDirectory()) throw new ErrorDeServicio("carpeta_inexistente", { ruta: resuelta, es_archivo: true });
    entradas = readdirSync(resuelta, { withFileTypes: true });
  } catch (e) {
    if (e instanceof ErrorDeServicio) throw e;
    // Una carpeta que el proceso no puede leer no es una carpeta vacia.
    // Devolverla vacia haria que el operador concluyera que su proyecto no
    // esta ahi, y lo que pasa es que este proceso no tiene permiso.
    throw new ErrorDeServicio("carpeta_ilegible", { ruta: resuelta, detalle: /** @type {any} */ (e).message });
  }

  const conOcultas = p.url.searchParams.get("ocultas") === "si";
  const proyectosPorRuta = new Map(raices.filter((r) => r.proyecto).map((r) => [r.ruta, r.proyecto]));

  const omitidas = { ocultas: 0, enlaces_fuera: 0, ilegibles: 0 };
  let archivos = 0;
  /** @type {any[]} */
  const carpetas = [];

  for (const entrada of entradas) {
    const hija = join(resuelta, entrada.name);
    const oculta = entrada.name.startsWith(".");

    // Un enlace hay que RESOLVERLO para saber si apunta a una carpeta, y de
    // paso para saber si apunta fuera. `entrada.isDirectory()` sobre un enlace
    // es `false` aunque el destino sea un directorio.
    let destino = hija;
    if (entrada.isSymbolicLink()) {
      const apunta = real(hija);
      if (!apunta) {
        omitidas.ilegibles += 1;
        continue;
      }
      destino = apunta;
    }

    let esDirectorio;
    try {
      esDirectorio = entrada.isSymbolicLink() ? statSync(destino).isDirectory() : entrada.isDirectory();
    } catch {
      omitidas.ilegibles += 1;
      continue;
    }

    if (!esDirectorio) {
      archivos += 1;
      continue;
    }

    // Un enlace que sale de las raices no se lista. Ver la cabecera: es una
    // puerta, y una puerta dibujada como carpeta es un clic que acaba en 403.
    if (destino !== hija && !raizDe(destino, raices)) {
      omitidas.enlaces_fuera += 1;
      continue;
    }

    if (oculta && !conOcultas) {
      omitidas.ocultas += 1;
      continue;
    }

    carpetas.push({
      nombre: entrada.name,
      ruta: hija,
      oculta,
      enlace: entrada.isSymbolicLink(),
      // El proyecto que ya gestiona esa carpeta, si lo hay. Sin esto el
      // operador la vuelve a dar de alta y el servicio la rechaza por slug
      // repetido, que es un error que no explica lo que pasa.
      proyecto: proyectosPorRuta.get(destino) ?? null,
      ...repositorio(destino),
    });
  }

  // Orden por nombre y sin `localeCompare`: el orden de una lista no puede
  // depender de la configuracion regional del proceso, porque entonces dos
  // maquinas contestan listas distintas a la misma peticion.
  carpetas.sort((a, b) => (a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0));

  const limite = limiteDe(p.url, POR_DEFECTO, MAXIMO);
  const mostradas = carpetas.slice(0, limite);
  const hayMas = carpetas.length > mostradas.length;

  const avisos = [];
  if (hayMas) {
    avisos.push({
      codigo: "carpeta_recortada",
      causa:
        `Esta carpeta tiene ${carpetas.length} subcarpetas y se devolvieron ${mostradas.length}. Una lista de ` +
        "cientos de elementos no es una interfaz: es el problema trasladado a quien la mira.",
      accion:
        "Entra en una subcarpeta para acotar, sube el tope con `?limite=` —el maximo de esta ruta es " +
        `${MAXIMO}— o escribe la ruta completa en el campo de la pantalla de alta, que sigue aceptando cualquiera.`,
    });
  }
  if (omitidas.ilegibles > 0) {
    avisos.push({
      codigo: "entradas_ilegibles",
      causa:
        `${omitidas.ilegibles} entrada(s) de esta carpeta no se pudieron leer: un enlace roto, o permisos que ` +
        "este proceso no tiene. No se omiten en silencio porque una lista incompleta que no lo dice es peor " +
        "que un error.",
      accion:
        "Si la carpeta que buscas es una de ellas, escribe su ruta absoluta en el campo de la pantalla de alta: " +
        "el alta la abre con los permisos de este mismo proceso y dira exactamente que le falta.",
    });
  }

  return {
    cuerpo: coleccion(mostradas, { avisos }, {
      ruta: resuelta,
      // `null` y no ausente: la interfaz pinta el boton de subir a partir de
      // esto, y un campo que a veces no esta obliga a distinguir «no hay padre»
      // de «esta ruta no informa del padre», que se ven igual desde el cliente.
      padre: resuelta === raiz.ruta ? null : dirname(resuelta),
      es_raiz: resuelta === raiz.ruta,
      raiz,
      raices,
      ...repositorio(resuelta),
      proyecto: proyectosPorRuta.get(resuelta) ?? null,
      archivos,
      omitidas,
      total: carpetas.length,
      mostradas: mostradas.length,
      hay_mas: hayMas,
      limite,
      ocultas_incluidas: conOcultas,
    }),
  };
}

/**
 * Las raices por defecto: el home del operador y nada mas.
 *
 * POR QUE EL HOME Y NO `/`. Porque los proyectos de alguien viven bajo su home,
 * y porque la diferencia entre las dos elecciones es exactamente la que separa
 * «se filtro que carpetas tengo» de «se filtro el equipo entero». Y porque `/`
 * no se elige nunca por necesidad: se elige porque es una linea menos.
 */
export const RAICES_POR_DEFECTO = () => [homedir()];
