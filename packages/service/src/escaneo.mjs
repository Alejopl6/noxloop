// Etapa 01 — el escaneo: respuesta inmediata, progreso por el canal, y una
// cancelacion que no deja nada a medias.
//
// POR QUE `POST /scan` NO ESPERA AL SNAPSHOT. Un recorrido de un repositorio
// real tarda. Una peticion HTTP abierta todo ese rato es una pantalla congelada
// —y una pantalla congelada se mata y se vuelve a apretar, con lo que arrancan
// dos escaneos—. Devolver `{snapshot_id}` de inmediato y mandar el progreso por
// SSE tiene ademas un segundo efecto que la respuesta sincrona no puede dar: la
// SEGUNDA ventana ve el mismo escaneo sin haberlo pedido.
//
// POR QUE LOS HALLAZGOS PARCIALES NO SE PERSISTEN NUNCA. FR-015 dice "sin dejar
// estado parcial" y el scanner ya lo cumple por su cuenta: un recorrido
// cancelado devuelve `hallazgos: []`, no los que alcanzo. El motivo esta escrito
// en su propio codigo y vale igual aqui — no hay forma de saber cuales
// faltaban, y una lista a medias se acaba usando como si fuera entera. Asi que
// este archivo escribe la fila del snapshot cuando el recorrido TERMINA, no
// mientras corre.
//
// POR QUE EL EVENTO DE PROGRESO SE ACOTA. Un escaneo de diez mil archivos emite
// diez mil eventos de progreso, y el buffer del canal —que es acotado a
// proposito— se vacia de todo lo demas: las transiciones de estado que la
// interfaz necesita se pierden detras de una barra que avanza.

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

import { ENUMS } from "../../store/src/index.mjs";

import { coleccion, exigir, exigirProyecto, noEsta } from "./comun.mjs";
import { ErrorDeServicio } from "./errores.mjs";

/** Las categorias que el almacen sabe guardar. */
const CATEGORIAS_DEL_ALMACEN = ENUMS["snapshot_finding.categoria"];

/** Las decisiones que un hallazgo admite. */
const DECISIONES = ENUMS["snapshot_finding.decision"];

/**
 * El commit de un repositorio que todavia no tiene ninguno.
 *
 * `project_snapshot.commit` es NOT NULL porque es el punto exacto del analisis.
 * Un repositorio recien inicializado no tiene ninguno, y eso es un hecho, no un
 * fallo: lo que NO se puede hacer es inventar un hash. Este centinela no se
 * puede confundir con uno real —no es hexadecimal y no mide 40— y el motivo
 * completo viaja en la respuesta.
 */
export const SIN_COMMIT = "sin-commit";

/** Cada cuantos eventos de progreso se manda uno. Ver la cabecera. */
const CADA_CUANTOS_PROGRESOS = 1;

/** Cuanto se deja pasar entre dos eventos de progreso, en ms. */
const MINIMO_ENTRE_PROGRESOS_MS = 120;

/**
 * El commit de HEAD, leyendo archivos y sin lanzar `git`.
 *
 * POR QUE NO SE LLAMA A `git`. Un subproceso por escaneo es lento, depende de
 * que `git` este en el PATH del servicio —que no es el del operador— y, sobre
 * todo, `git` ESCRIBE: refresca `.git/index` al consultarlo. FR-011 promete que
 * este servicio no toca el repositorio de nadie, y el instrumento de medida no
 * puede ser lo que lo rompa.
 *
 * @param {string} raiz
 * @returns {{commit: string, motivo: string}}
 */
export function commitDe(raiz) {
  const head = join(raiz, ".git", "HEAD");
  if (!existsSync(head)) {
    return { commit: SIN_COMMIT, motivo: `no hay \`.git/HEAD\` en \`${raiz}\`: el snapshot no se puede reproducir` };
  }
  try {
    const contenido = readFileSync(head, "utf8").trim();
    if (/^[0-9a-f]{40}$/i.test(contenido)) return { commit: contenido, motivo: "" };

    const ref = contenido.replace(/^ref:\s*/, "");
    const suelta = join(raiz, ".git", ref);
    if (existsSync(suelta)) return { commit: readFileSync(suelta, "utf8").trim(), motivo: "" };

    const empaquetadas = join(raiz, ".git", "packed-refs");
    if (existsSync(empaquetadas)) {
      for (const linea of readFileSync(empaquetadas, "utf8").split("\n")) {
        const [hash, nombre] = linea.trim().split(/\s+/);
        if (nombre === ref) return { commit: hash, motivo: "" };
      }
    }
    return {
      commit: SIN_COMMIT,
      motivo:
        `\`${ref}\` todavia no apunta a ningun commit: el repositorio esta inicializado y no tiene historia. ` +
        "El snapshot vale igual para decidir, pero no se puede volver a reproducir en este punto.",
    };
  } catch (e) {
    return { commit: SIN_COMMIT, motivo: `no se pudo leer \`.git/HEAD\`: ${e.message}` };
  }
}

/**
 * Persiste el resultado del recorrido, entero o cancelado.
 *
 * @param {any} dep
 * @param {any} proyecto
 * @param {string} snapshotId
 * @param {any} resultado lo que devolvio `escanear`
 * @param {{commit: string, motivo: string}} punto
 */
function guardarSnapshot(dep, proyecto, snapshotId, resultado, punto) {
  return dep.almacen.base.enTransaccion(() => {
    /** @type {Array<{clave: string, categoria: string, motivo: string}>} */
    const noPersistidos = [];

    // La comprobacion va ANTES de insertar, y la primera version la puso
    // despues: entonces la consulta encontraba SIEMPRE la fila que acababa de
    // crear y salia sin guardar un solo hallazgo, dejando todos los snapshots
    // en `en_curso` para siempre. Un snapshot ya persistido no se vuelve a
    // escribir porque el `exit` del hilo y su ultimo mensaje pueden llegar casi
    // a la vez, y la segunda insercion revienta por clave primaria dentro de
    // una transaccion que ya no tiene a nadie escuchando.
    if (dep.almacen.base.consultarUno("SELECT id FROM project_snapshot WHERE id = ?", [snapshotId])) {
      return noPersistidos;
    }

    dep.almacen.snapshots.crear({
      id: snapshotId,
      project_id: proyecto.id,
      commit: punto.commit,
      estado: "en_curso",
    });

    if (resultado.estado === "completo") {
      for (const hallazgo of resultado.hallazgos) {
        // El scanner declara doce categorias y el modelo de datos nueve: las
        // tres que sobran son fases del recorrido (`inventario`,
        // `manifiestos`, `estructura`) que ningun detector emite hoy. Una que
        // llegue se DECLARA en vez de guardarse en la casilla mas parecida:
        // una categoria traducida a ojo se lee despues como un dato del
        // proyecto, y ese es el fallo entero del principio X.
        if (!CATEGORIAS_DEL_ALMACEN.includes(hallazgo.categoria)) {
          noPersistidos.push({
            clave: hallazgo.clave,
            categoria: hallazgo.categoria,
            motivo:
              `el modelo de datos no declara la categoria \`${hallazgo.categoria}\` ` +
              `(las que hay son ${CATEGORIAS_DEL_ALMACEN.join(", ")})`,
          });
          continue;
        }
        dep.almacen.snapshots.agregarHallazgo({
          snapshot_id: snapshotId,
          categoria: hallazgo.categoria,
          clave: hallazgo.clave,
          valor: hallazgo.valor,
          origen: hallazgo.origen,
          evidencia: hallazgo.evidencia,
          confianza: hallazgo.confianza,
        });
      }
      dep.almacen.snapshots.completar(snapshotId, { duracion_ms: resultado.duracion_ms });
    } else {
      // Cancelado: la fila queda para que el operador vea QUE se cancelo y
      // cuando, y sin un solo hallazgo. El scanner ya devuelve la lista vacia;
      // aqui no se agrega ninguno, que es la otra mitad de la misma promesa.
      dep.almacen.base.escribir("UPDATE project_snapshot SET estado = 'cancelado' WHERE id = ?", [snapshotId]);
    }

    return noPersistidos;
  });
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function arrancarEscaneo(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);
  const snapshotId = randomUUID();
  const punto = commitDe(proyecto.ruta_local);

  const bus = p.estado.bus;
  const deEsteProyecto = { project_id: proyecto.id };

  let ultimoProgreso = 0;
  let cuantos = 0;
  let cerrado = false;

  // El recorrido va en un hilo. El por que esta entero en la cabecera de
  // `escaneo-en-hilo.mjs`, y se resume en dos frases: el inventario del scanner
  // es sincrono, asi que en el hilo principal congela el servicio para todas
  // las ventanas; y mientras congela, la peticion de cancelar no puede llegar
  // — la cancelacion estaba en el contrato y no existia en la practica.
  const hilo = new Worker(new URL("./escaneo-en-hilo.mjs", import.meta.url), {
    workerData: { ruta: proyecto.ruta_local },
  });

  const registro = { project_id: proyecto.id, hilo, arrancado: Date.now(), cancelado: false };
  p.dep.escaneos.set(snapshotId, registro);


  /**
   * Cierra el escaneo UNA sola vez.
   *
   * Dos motivos para el candado, y los dos se vieron. El hilo puede mandar su
   * ultimo mensaje y salir casi a la vez, con lo que se intentaria persistir el
   * mismo snapshot dos veces. Y el servicio, al apagarse, mata los hilos que
   * queden: entonces el `exit` llega cuando el almacen ya no esta, y escribir
   * ahi sale como un `uncaughtException` con "database is not open" fuera de
   * toda peticion. Si este escaneo ya no figura en el registro del servicio, es
   * que el servicio se esta yendo y no hay nada que guardar.
   */
  const cerrar = (fn) => {
    if (cerrado || p.dep.escaneos.get(snapshotId) !== registro) return;
    cerrado = true;
    p.dep.escaneos.delete(snapshotId);
    fn();
  };

  /**
   * Persiste sin poder tumbar el servicio.
   *
   * EL FALLO QUE EVITA, Y COSTO UN PROCESO MUERTO. Esto corre dentro de un
   * manejador de eventos del hilo, no dentro de una peticion: no hay ningun
   * `try` de HTTP encima, asi que una excepcion aqui es un `uncaughtException`
   * y se lleva el servicio entero — con todas las ventanas abiertas. Y el caso
   * que lo dispara es normal, no exotico: mientras un escaneo corre, otra
   * ventana deja de gestionar el proyecto, y el snapshot que llega despues
   * apunta a una fila que ya no existe. Lo que corresponde entonces es que el
   * escaneo se pierda —su proyecto ya no se gestiona— y que se diga por el
   * canal, no que se caiga el proceso.
   *
   * @param {any} resultado
   */
  const persistir = (resultado) => {
    try {
      return { ok: true, noPersistidos: guardarSnapshot(p.dep, proyecto, snapshotId, resultado, punto) };
    } catch (e) {
      bus.emitir(
        "scan.cancelado",
        {
          snapshot_id: snapshotId,
          codigo: e && e.codigo ? e.codigo : "snapshot_no_persistido",
          causa:
            `el recorrido termino pero su snapshot no se pudo guardar: ${e && e.causa ? e.causa : e.message}. ` +
            "Lo mas probable es que el proyecto se haya dejado de gestionar mientras el escaneo corria.",
          accion:
            e && e.accion
              ? e.accion
              : "Comprueba en `GET /v1/projects` que el proyecto siga dado de alta y vuelve a escanear.",
        },
        deEsteProyecto,
      );
      return { ok: false, noPersistidos: [] };
    }
  };

  const guardarCancelado = () => {
    if (!persistir({ estado: "cancelado" }).ok) return;
    bus.emitir(
      "scan.cancelado",
      {
        snapshot_id: snapshotId,
        motivo:
          "se pidio cancelar el recorrido. Los hallazgos parciales no se persisten a proposito: no hay forma " +
          "de saber cuales faltaban, y una lista a medias se acaba usando como si fuera entera.",
      },
      deEsteProyecto,
    );
  };

  hilo.on("message", (mensaje) => {
    if (mensaje.tipo === "progreso") {
      cuantos++;
      const ahora = Date.now();
      // Acotado: un escaneo de diez mil archivos emite diez mil eventos y el
      // buffer del canal —acotado a proposito— se vacia de todo lo demas. Las
      // transiciones de estado que la interfaz necesita se perderian detras de
      // una barra que avanza.
      if (cuantos % CADA_CUANTOS_PROGRESOS === 0 && ahora - ultimoProgreso >= MINIMO_ENTRE_PROGRESOS_MS) {
        ultimoProgreso = ahora;
        bus.emitir("scan.progreso", { snapshot_id: snapshotId, ...mensaje.datos }, deEsteProyecto);
      }
      return;
    }

    if (mensaje.tipo === "hallazgo") {
      // Sale segun aparece: una lista que crece en vivo es la diferencia entre
      // "esta trabajando" y "parece colgado".
      bus.emitir("scan.hallazgo", { snapshot_id: snapshotId, hallazgo: mensaje.datos }, deEsteProyecto);
      return;
    }

    if (mensaje.tipo === "error") {
      // Un escaneo que se cae se DECLARA por el canal. Tragarselo deja a la
      // interfaz esperando para siempre un `scan.terminado` que no llega, y el
      // sintoma es una barra parada al 40% sin ningun error a la vista.
      cerrar(() =>
        bus.emitir("scan.cancelado", { snapshot_id: snapshotId, ...mensaje.error }, deEsteProyecto),
      );
      return;
    }

    if (mensaje.tipo === "listo") {
      cerrar(() => {
        if (mensaje.snapshot.estado === "cancelado") return guardarCancelado();
        const { ok, noPersistidos } = persistir(mensaje.snapshot);
        if (!ok) return;
        bus.emitir(
          "scan.terminado",
          {
            snapshot_id: snapshotId,
            duracion_ms: mensaje.snapshot.duracion_ms,
            hallazgos: mensaje.snapshot.hallazgos.length,
            descartados: mensaje.snapshot.descartados,
            detectores_caidos: mensaje.snapshot.detectores_caidos,
            no_persistidos: noPersistidos,
            commit_motivo: punto.motivo,
          },
          deEsteProyecto,
        );
      });
    }
  });

  hilo.on("error", (e) => {
    cerrar(() =>
      bus.emitir(
        "scan.cancelado",
        {
          snapshot_id: snapshotId,
          codigo: "recorrido_fallido",
          causa: `el hilo del recorrido se cayo: ${e && e.message ? e.message : String(e)}`,
          accion: "Comprueba que la ruta del proyecto se pueda leer y vuelve a escanear.",
        },
        deEsteProyecto,
      ),
    );
  });

  hilo.on("exit", () => {
    // Si el hilo se fue sin haber mandado nada, fue porque lo mataron: eso es
    // exactamente la cancelacion, y se persiste como tal. Ponerlo aqui y no en
    // el `DELETE` es lo que garantiza que un hilo muerto por cualquier otra via
    // tampoco deje un snapshot colgado en `en_curso` para siempre.
    cerrar(guardarCancelado);
  });

  return {
    codigo: 202,
    cuerpo: {
      snapshot_id: snapshotId,
      // El punto se declara aqui y no cuando termina: si el repositorio no
      // tiene commit, quien lanzo el escaneo tiene que saberlo ANTES de basar
      // una constitution en el.
      commit: punto.commit,
      commit_motivo: punto.motivo,
      progreso: "por el canal de eventos: scan.progreso, scan.hallazgo, scan.terminado, scan.cancelado",
    },
  };
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function cancelarEscaneo(p) {
  const id = p.parametros.snapshot_id;
  const enVuelo = p.dep.escaneos.get(id);

  if (!enVuelo) {
    const yaEsta = p.dep.almacen.base.consultarUno("SELECT id, estado FROM project_snapshot WHERE id = ?", [id]);
    if (!yaEsta) throw noEsta("escaneo", id, "`POST /v1/projects/:id/scan`, que devuelve el `snapshot_id`");
    // Ya habia terminado. No es un error: es una carrera normal entre la
    // pantalla y el recorrido, y decirlo es mas util que un 404 o un 409 —
    // cancelar algo que ya acabo deja el mismo estado final que no cancelarlo.
    return { cuerpo: { snapshot_id: id, cancelado: false, estado: yaEsta.estado, nota: "el recorrido ya habia terminado" } };
  }

  enVuelo.cancelado = true;
  // Matar el hilo, y no pedirle que pare. Lo segundo es mas elegante y mas
  // debil: el scanner solo mira su señal entre fases, asi que "para cuando
  // puedas" sobre un inventario de cien mil archivos tarda lo que tarde el
  // inventario. Y sobre todo, `terminate` garantiza lo que FR-015 pide sin
  // depender de nadie: lo que el recorrido llevara leido muere con el hilo, y
  // el snapshot `cancelado` lo escribe este proceso, sin un solo hallazgo.
  await enVuelo.hilo.terminate();

  return {
    cuerpo: {
      snapshot_id: id,
      cancelado: true,
      nota: "los hallazgos parciales no se persisten: el snapshot queda `cancelado` y vacio",
    },
  };
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function snapshotVigente(p) {
  const proyecto = exigirProyecto(p.dep, p.parametros.id);
  const todos = p.dep.almacen.snapshots.porProyecto(proyecto.id);
  const snapshot = todos[0] ?? null;

  if (!snapshot) {
    const enVuelo = [...p.dep.escaneos.entries()].find(([, e]) => e.project_id === proyecto.id);
    if (enVuelo) {
      // Todavia corriendo. Se declara asi en vez de devolver 404: un 404
      // mientras el escaneo trabaja se lee como "no hay nada que escanear".
      return {
        codigo: 202,
        cuerpo: coleccion([], {}, { snapshot: { id: enVuelo[0], estado: "en_curso" }, nota: "el recorrido sigue en curso" }),
      };
    }
    throw noEsta("snapshot", proyecto.id, "`POST /v1/projects/:id/scan`", `el proyecto \`${proyecto.nombre}\``);
  }

  return { cuerpo: coleccion(hallazgosDe(p.dep, snapshot.id), {}, { snapshot }) };
}

/**
 * @param {any} dep
 * @param {string} snapshotId
 */
function hallazgosDe(dep, snapshotId) {
  return dep.almacen.snapshots.hallazgos(snapshotId).map((/** @type {any} */ h) => ({
    ...h,
    valor: JSON.parse(String(h.valor)),
    evidencia: JSON.parse(String(h.evidencia)),
    valor_corregido: h.valor_corregido === null ? null : JSON.parse(String(h.valor_corregido)),
  }));
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function decidirHallazgo(p) {
  const snapshot = p.dep.almacen.base.consultarUno("SELECT * FROM project_snapshot WHERE id = ?", [p.parametros.id]);
  if (!snapshot) throw noEsta("snapshot", p.parametros.id, "`GET /v1/projects/:id/snapshot`");

  const hallazgo = p.dep.almacen.base.consultarUno("SELECT * FROM snapshot_finding WHERE id = ? AND snapshot_id = ?", [
    p.parametros.finding_id,
    p.parametros.id,
  ]);
  if (!hallazgo) {
    throw noEsta(
      "hallazgo",
      p.parametros.finding_id,
      "`GET /v1/projects/:id/snapshot`",
      `el snapshot \`${p.parametros.id}\``,
    );
  }

  const cuerpo = await p.cuerpo();
  exigir(cuerpo, ["decision"]);
  if (!DECISIONES.includes(cuerpo.decision)) {
    throw new ErrorDeServicio("cuerpo_invalido", {
      detalle:
        `\`decision\` vale \`${cuerpo.decision}\` y las que existen son ${DECISIONES.map((d) => `\`${d}\``).join(", ")}. ` +
        "`corregido` es la que lleva `valor_corregido`: lo que el operador sabe y la maquina leyo mal",
      campos: ["decision"],
    });
  }
  if (cuerpo.decision === "corregido" && cuerpo.valor_corregido === undefined) {
    throw new ErrorDeServicio("cuerpo_invalido", {
      detalle:
        "la decision es `corregido` y no viene `valor_corregido`. Corregir sin decir a que deja el hallazgo " +
        "marcado como revisado con el valor equivocado adentro, que es peor que dejarlo pendiente",
      campos: ["valor_corregido"],
    });
  }

  p.dep.almacen.snapshots.decidirHallazgo(p.parametros.finding_id, {
    decision: cuerpo.decision,
    valor_corregido: cuerpo.valor_corregido,
  });

  const actualizado = hallazgosDe(p.dep, p.parametros.id).find((h) => h.id === p.parametros.finding_id);
  return { cuerpo: { hallazgo: actualizado } };
}

/** @param {import("./rutas.mjs").Peticion} p */
export async function aceptarSnapshot(p) {
  const snapshot = p.dep.almacen.base.consultarUno("SELECT * FROM project_snapshot WHERE id = ?", [p.parametros.id]);
  if (!snapshot) throw noEsta("snapshot", p.parametros.id, "`GET /v1/projects/:id/snapshot`");

  const proyecto = exigirProyecto(p.dep, String(snapshot.project_id));

  // La transicion la decide el almacen, con su guarda, que VA A BUSCAR: cuenta
  // los hallazgos sin decidir y se niega nombrando cuantos quedan. Comprobarlo
  // aqui y volver a comprobarlo alli serian dos verdades que se pueden separar.
  const actualizado = p.dep.almacen.proyectos.transicionar(proyecto.id, "DISCOVERED", { actor: "operador" });

  p.estado.bus.emitir(
    "proyecto.estado",
    { estado: actualizado.estado, motivo: `se acepto el snapshot ${snapshot.id}` },
    { project_id: proyecto.id },
  );

  return { cuerpo: { proyecto: actualizado, snapshot } };
}
