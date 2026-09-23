// Etapa 00 — los tres origenes de un proyecto, y los dos "no" que tienen que
// decir que hacer.
//
// LOS DOS RECHAZOS SON LA PARTE QUE IMPORTA. `no_es_repositorio` y
// `destino_no_vacio` son los dos primeros "no" que este producto le dice a
// alguien, y los dos llegan cuando la persona YA decidio que carpeta quiere.
// "No es un repositorio" a secas la manda a adivinar; el que nombra `git init`
// con su ruta adentro la devuelve al trabajo. Y el de destino no vacio ofrece
// adoptarlo porque la alternativa real —la que hace el operador cuando el error
// no ofrece nada— es borrar la carpeta para poder seguir.
//
// POR QUE `DELETE` NO TOCA EL REPOSITORIO. Dejar de gestionar un proyecto es
// una operacion del almacen; borrar el trabajo de alguien no se deshace con un
// ctrl-z, y un producto que lo hace una vez no se vuelve a apuntar a un
// repositorio que importe. Hay un test que mide el arbol antes y despues.
//
// POR QUE `PATCH` NO CAMBIA `estado`. El almacen es el escritor unico de la
// maquina de estados y sus guardas VAN A BUSCAR el artefacto en la base. Un
// `PATCH` que acepte `estado` es un segundo escritor que saltea las guardas —
// principio VIII, y el sintoma aparece tres etapas despues sin forma de saber
// quien lo puso ahi.

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";

import { ENUMS } from "../../store/src/index.mjs";

import { coleccion, comprobarIfMatch, etagDe, exigir, exigirProyecto, slugDe } from "./comun.mjs";
import { ErrorDeServicio } from "./errores.mjs";

/** Los tres origenes, tal como los declara el modelo de datos. */
const ORIGENES = ENUMS["project.origen"];

/** Cuantas entradas del destino se nombran en el error. Mas es una pared de texto. */
const MUESTRA = 3;

/**
 * Lo que hay dentro de una carpeta, o `null` si no existe.
 *
 * @param {string} ruta
 */
function contenidoDe(ruta) {
  if (!existsSync(ruta)) return null;
  try {
    return readdirSync(ruta);
  } catch {
    // Una carpeta que no se puede listar no es una carpeta vacia: tratarla como
    // vacia deja que `origen: "nuevo"` escriba dentro de algo que no se leyo.
    return [];
  }
}

/**
 * Valida el origen y prepara el destino. Lo unico que escribe fuera del home, y
 * solo para `nuevo`: una carpeta vacia que el operador pidio.
 *
 * @param {{origen: string, ruta_local: string, remoto?: string|null}} datos
 */
function prepararDestino(datos) {
  // RELATIVA NO: `resolve` la resolveria contra el directorio del proceso, que
  // con `npm run service` es la raiz de noxloop. Asi termino un proyecto nuevo
  // con sus guidelines commiteadas dentro de este repositorio.
  if (!isAbsolute(datos.ruta_local)) {
    throw new ErrorDeServicio("ruta_relativa", {
      ruta: datos.ruta_local,
      ejemplo: join(homedir(), datos.ruta_local),
    });
  }
  const ruta = resolve(datos.ruta_local);

  if (datos.origen === "local") {
    // `.git` puede ser un directorio o —en un worktree— un archivo. `existsSync`
    // cubre los dos; comprobar que sea directorio dejaria fuera los worktrees,
    // que es justo como trabaja quien tiene varias ramas abiertas.
    if (!existsSync(join(ruta, ".git"))) throw new ErrorDeServicio("no_es_repositorio", { ruta });
    return ruta;
  }

  if (datos.origen === "nuevo") {
    const contenido = contenidoDe(ruta);
    if (contenido && contenido.length > 0) {
      throw new ErrorDeServicio("destino_no_vacio", {
        ruta,
        cuantas: contenido.length,
        muestra: contenido
          .slice(0, MUESTRA)
          .map((e) => `\`${e}\``)
          .join(", "),
      });
    }
    mkdirSync(ruta, { recursive: true });
    return ruta;
  }

  // `remoto`. El clon lo hace el motor cuando le toca: este servicio no lanza
  // subprocesos, y un clon a medias dentro de una peticion HTTP deja una
  // carpeta que no es ni un proyecto ni un destino vacio.
  mkdirSync(ruta, { recursive: true });
  return ruta;
}

/**
 * Las plantillas para `origen: "nuevo"`.
 *
 * POR QUE ESTA RUTA EXISTE Y DEVUELVE UNA LISTA VACIA. El contrato declaraba
 * que `POST /v1/projects` acepta `plantilla` y no decia donde se enumeran. Quien
 * construyo la pantalla se encontro con dos salidas y las dos malas: inventar la
 * lista en el cliente —la interfaz decidiendo producto— o pedirle al operador un
 * identificador que no puede conocer.
 *
 * Este servicio no trae catalogo de plantillas, y eso es un hecho, no un fallo.
 * Lo que NO se hace es devolver tres plantillas plausibles para que la pantalla
 * se vea completa: el operador elegiria una que no existe y el proyecto nuevo
 * saldria vacio sin que nadie entienda por que. La lista vacia viaja con su
 * aviso, y la interfaz lo dice con esas palabras y deja escribir el
 * identificador a mano. Degradar visible, no fingir.
 *
 * @param {import("./rutas.mjs").Peticion} p
 */
export async function plantillas(p) {
  void p;
  return {
    cuerpo: coleccion([], {
      avisos: [
        {
          codigo: "sin_catalogo_de_plantillas",
          causa:
            "este servicio no tiene ningun catalogo de plantillas montado, asi que no hay ninguna que ofrecer. " +
            "No es que esten vacias: es que no hay catalogo.",
          accion:
            "Da de alta el proyecto con `origen: \"nuevo\"` sin `plantilla` —queda un destino preparado y vacio— " +
            "o con `origen: \"local\"` sobre un repositorio que ya tengas.",
        },
      ],
    }),
  };
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function lista(p) {
  if (p.metodo === "POST") return crear(p);

  // NFR-002: los contadores vienen en la MISMA consulta. Devolver solo los
  // proyectos obliga a la interfaz a pedir despues la bandeja de cada uno —21
  // viajes— y el presupuesto de un segundo se gasta en los viajes.
  return { cuerpo: coleccion(p.dep.almacen.inicio.proyectos().map(conContadores)) };
}

/**
 * Los agregados salen ANIDADOS bajo `contadores`, que es como el contrato los
 * declara.
 *
 * EL FALLO QUE ESTO CIERRA, y estaba en produccion sin dar ningun error. El
 * almacen los devuelve planos y con otros nombres (`bandeja_esperando`,
 * `recomendaciones_pendientes`); la interfaz lee `contadores.entradas_bandeja`.
 * Dos desacuerdos a la vez —anidamiento y nombre— asi que los badges de "N en
 * bandeja" y "N agentes" de la lista NO SE PINTABAN NUNCA.
 *
 * Y el sintoma es lo peor: no es una pantalla rota, es una fila que parece no
 * tener nada pendiente. El operador no ve un hueco, ve un proyecto tranquilo.
 *
 * La traduccion vive aqui y no en el almacen porque los nombres del almacen
 * describen SU consulta —`bandeja_esperando` dice que filtra por `esperando`—
 * y son los correctos ahi. Lo que cambia al cruzar la frontera es el
 * vocabulario publico, que es justo lo que un contrato define.
 *
 * @param {any} fila
 */
function conContadores(fila) {
  const {
    bandeja_esperando,
    agentes,
    conexiones_vivas,
    recomendaciones_pendientes,
    hallazgos_pendientes,
    ...proyecto
  } = fila;
  return {
    ...proyecto,
    contadores: {
      entradas_bandeja: bandeja_esperando ?? 0,
      agentes: agentes ?? 0,
      conexiones: conexiones_vivas ?? 0,
      recomendaciones_pendientes: recomendaciones_pendientes ?? 0,
      hallazgos_pendientes: hallazgos_pendientes ?? 0,
    },
  };
}

/** @param {import("./rutas.mjs").Peticion} p */
async function crear(p) {
  const cuerpo = await p.cuerpo();
  exigir(cuerpo, ["origen", "nombre"]);

  if (!ORIGENES.includes(cuerpo.origen)) {
    throw new ErrorDeServicio("cuerpo_invalido", {
      detalle:
        `\`origen\` vale \`${cuerpo.origen}\` y solo hay tres: ${ORIGENES.map((o) => `\`${o}\``).join(", ")}. ` +
        "`local` adopta un repositorio que ya existe, `nuevo` prepara uno desde cero y `remoto` declara uno " +
        "que vive en otro sitio",
      campos: ["origen"],
    });
  }

  exigir(
    cuerpo,
    ["ruta_local"],
    "Todo proyecto tiene una ruta en esta maquina, tambien el remoto: es donde va a vivir el clon.",
  );
  if (cuerpo.origen === "remoto") {
    exigir(cuerpo, ["remoto"], "Un proyecto de origen `remoto` sin remoto no se distingue de uno `nuevo`.");
  }

  const ruta = prepararDestino({ origen: cuerpo.origen, ruta_local: cuerpo.ruta_local, remoto: cuerpo.remoto });

  const proyecto = p.dep.almacen.proyectos.crear({
    workspace_id: p.dep.workspace.id,
    nombre: cuerpo.nombre,
    slug: cuerpo.slug || slugDe(cuerpo.nombre),
    origen: cuerpo.origen,
    ruta_local: ruta,
    remoto: cuerpo.remoto ?? null,
    autonomia: cuerpo.autonomia ?? "L0",
  });

  // Sin este evento, la otra ventana sobre el mismo home no se entera de que
  // hay un proyecto nuevo hasta que alguien recarga — y entonces "la interfaz
  // no se actualiza" se lee como un fallo de la interfaz.
  p.estado.bus.emitir("proyecto.estado", { estado: proyecto.estado, motivo: "alta" }, { project_id: proyecto.id });

  return { codigo: 201, cuerpo: { proyecto }, cabeceras: { etag: etagDe(proyecto) } };
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function uno(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);
  if (p.metodo === "GET") return detalle(p, proyecto);
  if (p.metodo === "PATCH") return modificar(p, proyecto);
  return dejarDeGestionar(p, proyecto);
}

/**
 * @param {import("./rutas.mjs").Peticion} p
 * @param {any} proyecto
 */
function detalle(p, proyecto) {
  return {
    cuerpo: {
      proyecto,
      // El estado de cada artefacto, que es lo que la pantalla necesita para
      // explicar POR QUE el proyecto no avanza. Sin esto, la etapa bloqueada se
      // ve como una cruz roja sin texto.
      artefactos: p.dep.almacen.proyectos.artefactos(proyecto.id),
      snapshots: p.dep.almacen.snapshots.porProyecto(proyecto.id),
    },
    cabeceras: { etag: etagDe(proyecto) },
  };
}

/**
 * @param {import("./rutas.mjs").Peticion} p
 * @param {any} proyecto
 */
async function modificar(p, proyecto) {
  comprobarIfMatch(p.req, { tipo: "proyecto", id: proyecto.id, actual: etagDe(proyecto) });
  const cuerpo = await p.cuerpo();

  // La lista es la lista. Un `UPDATE` armado con las claves del objeto escribe
  // lo que le llegue, y el camino real de un `estado` cambiado por la puerta de
  // atras no es `SET estado = ...`: es `{...cuerpo}` escrito donde el estado
  // estaba a mano.
  const EDITABLES = ["nombre", "slug", "remoto", "autonomia", "ruta_local"];
  const asignaciones = [];
  const valores = [];
  for (const campo of EDITABLES) {
    if (cuerpo[campo] === undefined) continue;
    if (campo === "autonomia" && !ENUMS["project.autonomia"].includes(cuerpo[campo])) {
      throw new ErrorDeServicio("cuerpo_invalido", {
        detalle:
          `\`autonomia\` vale \`${cuerpo[campo]}\` y los niveles declarados son ` +
          `${ENUMS["project.autonomia"].map((a) => `\`${a}\``).join(", ")}. El maximo es L2 porque el principio ` +
          "IV dice que la autonomia termina en el PR abierto",
        campos: ["autonomia"],
      });
    }
    asignaciones.push(`${campo} = ?`);
    valores.push(cuerpo[campo]);
  }

  if (asignaciones.length === 0) {
    throw new ErrorDeServicio("cuerpo_invalido", {
      detalle:
        "la peticion no trae ningun campo editable. `estado` no lo es: lo escribe la maquina de estados del " +
        "almacen, que es la unica que comprueba que el artefacto de la etapa existe de verdad",
      campos: EDITABLES,
    });
  }

  const ahora = new Date().toISOString();
  p.dep.almacen.base.escribir(`UPDATE project SET ${asignaciones.join(", ")}, actualizado = ? WHERE id = ?`, [
    ...valores,
    ahora,
    proyecto.id,
  ]);

  const actualizado = p.dep.almacen.proyectos.porId(proyecto.id);
  return { cuerpo: { proyecto: actualizado }, cabeceras: { etag: etagDe(actualizado) } };
}

/**
 * @param {import("./rutas.mjs").Peticion} p
 * @param {any} proyecto
 */
async function dejarDeGestionar(p, proyecto) {
  comprobarIfMatch(p.req, { tipo: "proyecto", id: proyecto.id, actual: etagDe(proyecto) });

  // Los escaneos EN VUELO de este proyecto se paran ANTES de borrar la fila.
  // No es una cortesia: un recorrido que sigue trabajando sobre un proyecto que
  // ya nadie gestiona termina intentando guardar su snapshot contra una fila
  // que no existe, y eso ocurre dentro de un manejador de eventos del hilo
  // —fuera de toda peticion— donde una excepcion se lleva el proceso entero.
  // Con dos ventanas abiertas, una escaneando y otra dando de baja, el caso no
  // es raro: es la tarde de cualquiera.
  for (const [id, escaneo] of p.dep.escaneos) {
    if (escaneo.project_id !== proyecto.id) continue;
    p.dep.escaneos.delete(id);
    try {
      await escaneo.hilo.terminate();
    } catch {
      /* un hilo que ya murio no impide dar de baja el proyecto */
    }
    p.estado.bus.emitir(
      "scan.cancelado",
      { snapshot_id: id, motivo: "el proyecto se dejo de gestionar mientras el recorrido corria" },
      { project_id: proyecto.id },
    );
  }

  // Se borra la FILA. El repositorio del operador no se toca, y no es un olvido
  // ni una version reducida de la operacion: es lo que la operacion es. Hay un
  // test que mide el arbol antes y despues.
  p.dep.almacen.base.escribir("DELETE FROM project WHERE id = ?", [proyecto.id]);

  p.estado.bus.emitir(
    "proyecto.estado",
    { estado: null, motivo: "se dejo de gestionar", ruta_local: proyecto.ruta_local },
    { project_id: proyecto.id },
  );

  return {
    cuerpo: {
      dejado_de_gestionar: proyecto.id,
      ruta_local: proyecto.ruta_local,
      // Se dice explicitamente en la RESPUESTA y no solo en la documentacion:
      // es la frase que la interfaz puede mostrar para que nadie se quede con
      // la duda de si le borraron el trabajo.
      nota:
        `El repositorio en \`${proyecto.ruta_local}\` sigue intacto: esta operacion solo deja de gestionarlo. ` +
        "Para volver a darlo de alta, creal de nuevo con `origen: \"local\"` y la misma ruta.",
    },
  };
}
