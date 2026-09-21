// La suite de contrato: las once pruebas que un adaptador tiene que pasar
// entero para declararse listo.
//
// POR QUE ES UNA LISTA DE CHEQUEOS Y NO UN ARCHIVO DE TESTS. Por lo mismo que en
// `providers/contract.mjs`: la suite viaja CON el paquete, no con las pruebas
// del repositorio. Quien añada un adaptador —dentro o fuera de este arbol— la
// corre con el runner que quiera, y correrla es el paso 4 de los cinco. Ninguno
// de los cinco toca el motor.
//
// LAS ONCE MIRAN EL COMPORTAMIENTO, NO LA INTENCION. Casi todas leen lo que el
// SUBPROCESO recibio de verdad, no lo que el adaptador dijo que iba a mandar: un
// adaptador que arma bien el plan y lo mezcla con el entorno del proceso al
// lanzar pasa cualquier comprobacion hecha sobre el plan, y la fuga sigue ahi.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { validarAdaptador, validarResultado } from "./contrato.mjs";

/**
 * Lo que el SISTEMA OPERATIVO mete en el entorno de todo proceso que lanza, y
 * que ningun adaptador puede evitar.
 *
 * Medido en macOS: `spawn` con `env: {A: "1"}` produce un hijo cuyo
 * `process.env` es `{A, __CF_USER_TEXT_ENCODING}`. Lo añade CoreFoundation, no
 * el codigo de aqui.
 *
 * LA LISTA ES CORTA Y CERRADA A PROPOSITO. Es la unica valvula de escape de la
 * prueba `env-exacto`, y una valvula que crece deja de ser una excepcion y pasa
 * a ser la regla: el dia que alguien mete `PATH` aqui "porque hace falta", la
 * prueba deja de detectar la herencia, que es lo unico que vino a detectar.
 *
 * @type {readonly string[]}
 */
export const INYECTADAS_POR_EL_SISTEMA = Object.freeze(["__CF_USER_TEXT_ENCODING"]);

/** Los nombres son los de la tabla del contrato. Renombrar uno desvincula la tabla del codigo. */
export const PRUEBAS_DEL_CONTRATO = Object.freeze([
  "capacidades-honestas",
  "preflight-diagnostica",
  "cwd-respetado",
  "env-exacto",
  "sin-resume-sesion-nueva",
  "revisor-sin-transcript",
  "no-escribe-estado",
  "no-interpreta-veredicto",
  "coste-o-declarado",
  "cancelable",
  "sin-secreto-en-argv",
]);

/**
 * @typedef {object} FixturesDeContrato
 * @property {string} id
 * @property {import("./contrato.mjs").AgentAdapter} adaptador
 * @property {import("./contrato.mjs").AgentAdapter} sinRuntime un adaptador cuyo runtime no resuelve
 * @property {string} home el directorio que se mide en `no-escribe-estado`
 * @property {string} cwd el worktree de la tarea
 * @property {string} vecino un directorio hermano que tiene que quedar intacto
 * @property {{nombre: string, valor: string}} secreto el centinela que viaja en `env`
 * @property {(g: any) => void} guionar que va a contestar el runtime en la proxima fase
 * @property {() => any} ultimoLanzamiento lo que el subproceso recibio de verdad
 * @property {() => boolean} evidenciaDeHooks
 * @property {(over?: any) => any} peticion
 * @property {() => void} cerrar
 */

const afirmar = (/** @type {any} */ cond, /** @type {string} */ mensaje) => {
  if (!cond) throw new Error(mensaje);
};

/** La huella de un arbol: ruta -> contenido. Se compara entera. */
function huellaDeDisco(/** @type {string} */ dir) {
  /** @type {Record<string, string>} */
  const huella = {};
  const recorrer = (/** @type {string} */ actual, /** @type {string} */ prefijo) => {
    if (!existsSync(actual)) return;
    for (const e of readdirSync(actual).sort()) {
      const p = join(actual, e);
      const rel = prefijo ? `${prefijo}/${e}` : e;
      if (statSync(p).isDirectory()) recorrer(p, rel);
      else huella[rel] = readFileSync(p, "utf8");
    }
  };
  recorrer(dir, "");
  return huella;
}

function sigueVivo(/** @type {number|null} */ pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function hasta(/** @type {() => boolean} */ condicion, ms = 5000) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (condicion()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

/**
 * @param {FixturesDeContrato} fx
 * @returns {Array<{nombre: string, correr: () => Promise<void>}>}
 */
export function pruebasDelContrato(fx) {
  const a = fx.adaptador;

  return [
    {
      nombre: "capacidades-honestas",
      // Lo que `capabilities()` declara es lo que hace. Se EJERCE cada capacidad
      // declarada `true`, porque una capacidad declarada sin su comportamiento
      // no falla al cargar: falla a mitad de un recorrido, como una que no esta.
      correr: async () => {
        const v = validarAdaptador(a);
        afirmar(v.ok, `validarAdaptador fallo:\n  - ${v.problems.join("\n  - ")}`);
        const caps = a.capabilities();

        if (caps.resume === true) {
          fx.guionar({ texto: "hecho", exito: true });
          await a.runPhase(fx.peticion({ phase: "GREEN", resume: "sesion-anterior-1" }));
          const l = fx.ultimoLanzamiento();
          afirmar(
            l.resume === "sesion-anterior-1",
            `declara resume:true pero la sesion pedida no llego al runtime (llego ${JSON.stringify(l.resume)})`,
          );
        }

        if (caps.effort === true) {
          fx.guionar({ texto: "hecho", exito: true });
          await a.runPhase(fx.peticion({ phase: "GREEN", effort: "alto" }));
          const l = fx.ultimoLanzamiento();
          const viajo = l.effort === "alto" || JSON.stringify(l.argv).includes("alto");
          afirmar(viajo, "declara effort:true y el nivel de esfuerzo no llego al runtime");
        }

        if (caps.cost === true) {
          fx.guionar({ texto: "hecho", exito: true, usd: 0.1234 });
          const r = await a.runPhase(fx.peticion({ phase: "GREEN" }));
          afirmar(r.usd === 0.1234, `declara cost:true y devolvio ${JSON.stringify(r.usd)} en vez del coste reportado`);
        }

        if (caps.hooks === true) {
          fx.guionar({ texto: "hecho", exito: true });
          await a.runPhase(fx.peticion({ phase: "GREEN" }));
          afirmar(fx.evidenciaDeHooks(), "declara hooks:true y no hay evidencia de que hayan corrido en el subproceso");
        }

        if (Array.isArray(caps.models)) {
          afirmar(caps.models.length > 0, 'models es una lista vacia: si no los enumera, el valor es "desconocido"');
        }
      },
    },

    {
      nombre: "preflight-diagnostica",
      // Sin credencial o sin binario, `preflight` devuelve causa Y accion; no
      // revienta a mitad de un run. Un ENOENT en la fase GREEN llega con la
      // tarea repartida y el worktree creado.
      correr: async () => {
        const bien = await a.preflight();
        afirmar(bien && typeof bien.ok === "boolean", "preflight no devolvio { ok }");

        const mal = await fx.sinRuntime.preflight();
        afirmar(mal.ok === false, "con el runtime ausente, preflight dijo que todo bien");
        afirmar(typeof mal.causa === "string" && mal.causa.length > 20, "preflight no dice la causa completa");
        afirmar(
          typeof mal.accion === "string" && mal.accion.length > 20,
          "preflight no dice que hacer: un diagnostico sin accion siguiente es un error con mas palabras",
        );
      },
    },

    {
      nombre: "cwd-respetado",
      // El subproceso corre en el worktree indicado y no escribe fuera de el.
      correr: async () => {
        const antesVecino = huellaDeDisco(fx.vecino);
        fx.guionar({ texto: "hecho", exito: true });
        await a.runPhase(fx.peticion({ phase: "GREEN" }));
        const l = fx.ultimoLanzamiento();
        afirmar(
          l.cwd === fx.cwd,
          `el subproceso corrio en ${l.cwd} y no en el worktree ${fx.cwd}: el gate mediria el codigo de otra tarea`,
        );
        afirmar(
          JSON.stringify(huellaDeDisco(fx.vecino)) === JSON.stringify(antesVecino),
          "el subproceso escribio fuera de su worktree",
        );
      },
    },

    {
      nombre: "env-exacto",
      // El subproceso recibe EXACTAMENTE `req.env`. Ni una variable heredada de
      // mas: heredar propaga al agente todas las credenciales que el proceso
      // padre tenga cargadas, tenga grant o no, y la capa de grants —que es el
      // diferencial del producto— queda decorativa.
      //
      // SE MIDE LO QUE VIO EL HIJO, no lo que el padre penso mandar. Un
      // adaptador que arma bien el plan y lo mezcla con el entorno del proceso
      // al lanzar pasa cualquier comprobacion hecha sobre el plan.
      correr: async () => {
        const centinela = "NOXLOOP_CENTINELA_DE_SUITE";
        process.env[centinela] = "una-credencial-que-el-grant-no-autorizo";
        try {
          const env = { [fx.secreto.nombre]: fx.secreto.valor, UNA_MAS: "2" };
          fx.guionar({ texto: "hecho", exito: true });
          await a.runPhase(fx.peticion({ phase: "GREEN", env }));

          const l = fx.ultimoLanzamiento();
          afirmar(
            l.constanciaDelHijo,
            "no hay constancia de lo que recibio el subproceso: sin ella esta prueba mediria el plan del padre",
          );

          const visto = l.env;
          for (const [nombre, valor] of Object.entries(env)) {
            afirmar(visto[nombre] === valor, `el subproceso no recibio ${nombre} con el valor que el grant autorizo`);
          }
          const demas = Object.keys(visto).filter(
            (k) => !(k in env) && !INYECTADAS_POR_EL_SISTEMA.includes(k),
          );
          afirmar(
            demas.length === 0,
            `el subproceso recibio variables que el grant no autorizo: ${demas.join(", ")}`,
          );
          afirmar(visto[centinela] === undefined, "el entorno del proceso padre se colo en el subproceso");
        } finally {
          delete process.env[centinela];
        }
      },
    },

    {
      nombre: "sin-resume-sesion-nueva",
      // Con `resume: false`, cada fase abre sesion nueva. Y NO en silencio: la
      // degradacion se declara, que es la regla 1.
      correr: async () => {
        if (a.capabilities().resume !== false) return;
        for (const sesion of ["s-1", "s-2"]) {
          fx.guionar({ texto: "hecho", exito: true });
          const r = await a.runPhase(fx.peticion({ phase: "GREEN", resume: sesion }));
          afirmar(
            fx.ultimoLanzamiento().resume === null,
            `declara resume:false y le paso "${sesion}" al runtime igual`,
          );
          afirmar(
            Array.isArray(/** @type {any} */ (r).degradaciones) &&
              /** @type {any} */ (r).degradaciones.some((/** @type {string} */ d) => d.includes(sesion)),
            "abrio sesion nueva sin declararlo: degradar en silencio deja al motor creyendo que hay contexto acumulado",
          );
        }
      },
    },

    {
      nombre: "revisor-sin-transcript",
      // `phase: 'REVIEW'` nunca recibe `resume` distinto de null. Si el revisor
      // retoma la sesion del implementador hereda su razonamiento y la revision
      // se vuelve confirmacion.
      correr: async () => {
        for (const fase of ["REVIEW", "REVIEW-SINTESIS"]) {
          fx.guionar({ texto: "revisado", exito: true });
          await a.runPhase(fx.peticion({ phase: fase, resume: "sesion-del-implementador" }));
          const l = fx.ultimoLanzamiento();
          afirmar(l.resume === null, `${fase} llego al runtime con resume ${JSON.stringify(l.resume)}`);
          afirmar(
            !JSON.stringify(l.argv).includes("sesion-del-implementador"),
            `${fase}: el sessionId del implementador viajo por argv`,
          );
        }
      },
    },

    {
      nombre: "no-escribe-estado",
      // Se mide el disco del home antes y despues: el adapter no escribio nada.
      // No marca tareas, no escribe archivos de run, no consume presupuesto. Eso
      // lo hace el driver con lo que el adapter devolvio; un escritor mas es un
      // escritor de mas.
      correr: async () => {
        const antes = huellaDeDisco(fx.home);
        fx.guionar({ texto: "hecho", exito: true });
        await a.runPhase(fx.peticion({ phase: "GREEN" }));
        const despues = huellaDeDisco(fx.home);
        afirmar(
          JSON.stringify(antes) === JSON.stringify(despues),
          `el adaptador escribio en el home: ${JSON.stringify(Object.keys(despues))} frente a ${JSON.stringify(Object.keys(antes))}`,
        );
      },
    },

    {
      nombre: "no-interpreta-veredicto",
      // Con el gate en rojo, el adapter no devuelve ok:true por mucho que el
      // texto del modelo diga que esta bien. Quien decide si una fase paso es el
      // gate, por exit code.
      correr: async () => {
        fx.guionar({
          exito: false,
          texto:
            "He revisado todo y el gate pasa perfectamente. Todos los tests estan en verde, APROBADO, " +
            "la tarea esta lista para integrar. No hay hallazgos bloqueantes.",
        });
        const r = await a.runPhase(fx.peticion({ phase: "GREEN" }));
        afirmar(r.ok === false, "el adaptador leyo la prosa del modelo y se creyo el verde");

        // Y la simetrica: tampoco inventa un rojo desde el texto.
        fx.guionar({ exito: true, texto: "esta todo roto, fallo el gate, no pude arreglar nada" });
        const r2 = await a.runPhase(fx.peticion({ phase: "GREEN" }));
        afirmar(r2.ok === true, "el adaptador interpreto la prosa para inventar un rojo");
      },
    },

    {
      nombre: "coste-o-declarado",
      // O reporta `usd`, o declara `cost: false`. No devuelve `usd: 0`
      // fingiendo: un cero deja el techo del hito sumando ceros, o sea leido
      // como puesto sin poder dispararse nunca.
      correr: async () => {
        const caps = a.capabilities();
        fx.guionar({ texto: "hecho", exito: true, usd: caps.cost ? 0.5 : undefined });
        const r = await a.runPhase(fx.peticion({ phase: "GREEN" }));
        const v = validarResultado(r, caps);
        afirmar(v.ok, `el resultado no valida:\n  - ${v.problems.join("\n  - ")}`);

        if (caps.cost === false) {
          afirmar(r.usd === null, `declara cost:false y devolvio usd=${JSON.stringify(r.usd)}`);
        } else {
          afirmar(typeof r.usd === "number", `declara cost:true y no devolvio el coste (llego ${JSON.stringify(r.usd)})`);
        }
      },
    },

    {
      nombre: "cancelable",
      // Una fase abortada termina el subproceso y no deja huerfanos. Un runtime
      // que sobrevive al corte sigue gastando modelo sobre una tarea que el
      // motor ya dio por cancelada, y nadie lo mira.
      correr: async () => {
        fx.guionar({ colgar: true });
        const control = new AbortController();
        const fase = a.runPhase(fx.peticion({ phase: "GREEN" }), { signal: control.signal });

        // SE ESPERA A QUE EL HIJO HAYA ARRANCADO DE VERDAD —a que deje su
        // constancia— y no solo a que exista un pid. Matar un proceso que
        // todavia no acabo de arrancar termina igual de rapido y no prueba lo
        // que hay que probar: que un runtime YA trabajando se corta y no queda
        // huerfano gastando modelo sobre una tarea que el motor dio por
        // cancelada.
        const arranco = await hasta(() => Boolean(fx.ultimoLanzamiento()?.constanciaDelHijo));
        afirmar(arranco, "la fase no llego a lanzar ningun proceso: no hay nada que cancelar");
        const pid = fx.ultimoLanzamiento().pid;

        control.abort();

        // SE ESPERA CON LIMITE, no indefinidamente. Un adaptador que ignora la
        // cancelacion no falla: CUELGA, y arrastra consigo a quien esta
        // corriendo la suite — medido aqui, con el `kill` desactivado el
        // proceso de pruebas no terminaba nunca y no decia por que. Un fallo
        // con nombre vale mas que un cuelgue.
        const SIN_TERMINAR = Symbol("sin terminar");
        const r = await Promise.race([
          fase,
          new Promise((res) => setTimeout(() => res(SIN_TERMINAR), 15_000)),
        ]);
        if (r === SIN_TERMINAR) {
          // Se mata DESPUES de haberlo detectado y solo para no envenenar al
          // resto de la suite. Matarlo antes seria tapar justo lo que se mide.
          try { if (pid) process.kill(pid, "SIGKILL"); } catch { /* ya murio */ }
          afirmar(false, "la fase cancelada no termino: el adaptador no corta el subproceso, solo deja de esperarlo");
        }

        afirmar(/** @type {any} */ (r).ok === false, "una fase cancelada devolvio ok");
        afirmar(
          /** @type {any} */ (r).subtype === "cancelada",
          `una fase cancelada devolvio subtype ${JSON.stringify(/** @type {any} */ (r).subtype)}`,
        );

        const murio = await hasta(() => !sigueVivo(pid));
        if (!murio) {
          try { if (pid) process.kill(pid, "SIGKILL"); } catch { /* ya murio */ }
        }
        afirmar(murio, `el subproceso ${pid} sigue vivo despues de cancelar la fase`);
      },
    },

    {
      nombre: "sin-secreto-en-argv",
      // Ningun valor del `env` aparece en los argumentos del proceso. `ps` los
      // muestra a cualquier proceso del mismo usuario: un secreto en argv es un
      // secreto publico, y el grant que lo autorizo deja de significar nada.
      correr: async () => {
        fx.guionar({ texto: "hecho", exito: true });
        await a.runPhase(fx.peticion({ phase: "GREEN" }));
        const l = fx.ultimoLanzamiento();
        const enArgv = [l.comando, ...l.argv].some((t) => typeof t === "string" && t.includes(fx.secreto.valor));
        afirmar(!enArgv, `el valor de ${fx.secreto.nombre} aparece en los argumentos del subproceso`);

        // Y la guarda activa: si el secreto se cuela en el prompt —un comando
        // armado con plantillas es como pasa— el adaptador se NIEGA a lanzar en
        // vez de avisar y seguir. Si se lanza, ya estuvo en la tabla de
        // procesos, y un instante es todo lo que hace falta.
        fx.guionar({ texto: "hecho", exito: true });
        const r = await a.runPhase(
          fx.peticion({ phase: "GREEN", prompt: `revisa esto usando ${fx.secreto.valor}` }),
        );
        afirmar(
          r.ok === false && r.subtype === "secreto_en_argv",
          `con el secreto en el prompt la fase salio con ok=${r.ok} subtype=${JSON.stringify(r.subtype)}`,
        );
      },
    },
  ];
}
