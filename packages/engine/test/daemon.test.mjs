// El bucle: lo que hace que asignar un ticket sea todo lo que hay que hacer.
//
// POR QUE ESTE TEST EXISTE ANTES DEL MODULO. Un bucle temporal es la clase de
// codigo que se prueba mirandolo, y mirandolo se ven bien las ocho formas de
// romperlo que estan abajo: dos daemons produciendo dos veces el mismo
// recorrido, un ticket que falla y se relanza cada dos minutos pagando el
// modelo cada vez, un ticket que falla y para el bucle entero, mas recorridos
// concurrentes que maquina, un gestor caido al que se le martilla la API, una
// senial de terminacion que deja un despacho a mitad sin registro, y un
// despacho de algo que el gestor no puede recorrer.
//
// POR QUE `dormir` Y `ahora` SE INYECTAN. Con el intervalo real —dos minutos
// por vuelta, por defecto— probar tres vueltas cuesta seis minutos, y probar el
// retroceso ante un gestor caido cuesta media hora. Un bucle que no se puede
// probar en milisegundos no se prueba: se mira. Con el reloj inyectado, toda
// esta suite corre en menos de un segundo.
//
// Sin red, sin credenciales y sin modelo: el proveedor es falso y el
// despachador tambien.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import * as fake from "../../../providers/fake/index.mjs";
import { gestorFalso, sinCapacidad, sinDisparo } from "../../../providers/degradation-fakes.mjs";
import { createRun, transition } from "../src/state.mjs";
import { leerMemoria, BandejaError } from "../src/inbox.mjs";
import { acquire, inspect } from "../src/lock.mjs";
import { correrDaemon, unaVuelta, confirmarLockPropio, DaemonError } from "../src/daemon.mjs";

const home = () => mkdtempSync(join(tmpdir(), "noxloop-daemon-"));

/** Un log que se puede interrogar: el daemon tiene que DECIR lo que decide. */
function bitacora() {
  const lineas = { info: [], warn: [], error: [] };
  const log = {
    info: (m) => lineas.info.push(String(m)),
    warn: (m) => lineas.warn.push(String(m)),
    error: (m) => lineas.error.push(String(m)),
    child: () => log,
  };
  return { lineas, log };
}

/**
 * El reloj inyectado. `dormir` no duerme: anota cuanto le pidieron y adelanta
 * la hora, que es todo lo que el bucle observa del tiempo.
 */
function reloj() {
  let t = 1_000_000;
  const esperas = [];
  return {
    esperas,
    ahora: () => t,
    dormir: async (ms) => {
      esperas.push(ms);
      t += ms;
    },
  };
}

/** Cuenta las consultas al gestor: una por vuelta, no una por senial. */
function contando(mod) {
  let veces = 0;
  return {
    veces: () => veces,
    mod: { ...mod, searchInbox: async (ctx) => { veces++; return mod.searchInbox(ctx); } },
  };
}

/** Un gestor falso a medida, con la bandeja que pida el caso. */
function conBandeja(g, { assigned = [], mentioned = [] }) {
  return {
    ...g.mod,
    searchInbox: async (ctx) => ({
      assigned: await Promise.all(assigned.map((i) => g.mod.getItem(i, ctx))),
      mentioned: await Promise.all(mentioned.map((i) => g.mod.getItem(i, ctx))),
    }),
  };
}

const unPlan = (id) => ({
  item: { id, title: "una historia", level: "story", url: `fake://items/${id}`, provider: "fake" },
  repoScope: ["app"],
  tasks: [{
    id: "T001", repo: "app", title: "la tarea", acceptance: "criterio",
    targetFiles: ["src/a.mjs"], testFiles: ["test/a.test.mjs"],
    tier: "small", dependsOn: [], dependencyKind: "hard",
  }],
});

/**
 * Un despachador falso.
 *
 * Mide el PICO de despachos simultaneos, que es la unica forma de afirmar el
 * limite de concurrencia: contar los despachos de una vuelta no dice cuantos
 * corrieron a la vez.
 */
function despachador({ fallaCon = {}, crearRecorrido = false, home: h, alEntrar } = {}) {
  const llamadas = [];
  let enVuelo = 0;
  let pico = 0;
  return {
    llamadas,
    pico: () => pico,
    despachar: async (item) => {
      const id = String(item.id);
      llamadas.push(id);
      enVuelo++;
      pico = Math.max(pico, enVuelo);
      try {
        if (alEntrar) await alEntrar(item);
        await new Promise((r) => setImmediate(r)); // un await real: sin esto no hay concurrencia que medir
        if (fallaCon[id]) throw new Error(fallaCon[id]);
        if (crearRecorrido) createRun(unPlan(id), { home: h });
        return { ok: true, pr: `fake://pr/${id}` };
      } finally {
        enVuelo--;
      }
    },
  };
}

/** Los tickets de mas que hacen falta para pasarse del cupo. */
function tickets(ids) {
  for (const id of ids) {
    fake.db.items[id] = { type: "Historia", title: `historia ${id}`, state: "Nuevo", parentId: null, children: [] };
  }
}

const conFake = (h, extra = {}) => {
  const b = bitacora();
  const r = reloj();
  return {
    b,
    r,
    config: { home: h, limits: { pollIntervalSec: 120, maxParallelItems: 2 } },
    deps: {
      provider: fake, providerCtx: fake.fixtures.ctx, home: h, log: b.log,
      dormir: r.dormir, ahora: r.ahora, ...extra,
    },
  };
};

// ------------------------------------------------------ 1. instancia unica

test("un segundo daemon informa quien tiene el lock y termina: no espera", async () => {
  // EL FALLO QUE EVITA: dos daemons sobre la misma configuracion no producen el
  // doble de trabajo. Producen dos veces el MISMO recorrido, dos ramas y dos PR
  // sobre el mismo ticket, porque los dos ven la misma bandeja al mismo tiempo.
  fake.reset();
  fake.db.inbox = { assigned: ["2"], mentioned: [] };
  const h = home();
  const primero = acquire("daemon", { home: h });
  assert.ok(primero.ok, "el primero lo toma");

  const d = despachador({ home: h });
  const { config, deps, r } = conFake(h, { despachar: d.despachar });

  const res = await correrDaemon(config, { ...deps, maxVueltas: 5 });

  assert.equal(res.ok, false);
  assert.equal(res.codigo, "lock_tomado");
  assert.equal(res.heldBy.pid, process.pid, "dice QUIEN lo tiene, no solo que esta tomado");
  assert.deepEqual(d.llamadas, [], "no despacha nada");
  assert.deepEqual(r.esperas, [], "termina en vez de esperar su turno");
  assert.equal(res.vueltas, 0);
  assert.ok(res.humano.join(" ").includes(String(process.pid)));

  primero.release();
});

test("el daemon libera el lock al terminar, y el siguiente puede arrancar", async () => {
  fake.reset();
  const h = home();
  const d = despachador({ home: h });
  const { config, deps } = conFake(h, { despachar: d.despachar });

  const uno = await correrDaemon(config, { ...deps, maxVueltas: 1 });
  assert.equal(uno.ok, true);
  assert.equal(inspect("daemon", { home: h }), null, "el lock no queda tirado");

  const dos = await correrDaemon(config, { ...deps, maxVueltas: 1 });
  assert.equal(dos.ok, true, "el siguiente arranca sin tener que destrabar nada a mano");
});

// ------------------------------------------- 2. el intervalo y las vueltas

test("el bucle da varias vueltas, consulta una vez por vuelta y duerme el intervalo de la configuracion", async () => {
  fake.reset();
  fake.db.inbox = { assigned: ["2"], mentioned: [] };
  const h = home();
  const c = contando(fake);
  const d = despachador({ home: h, crearRecorrido: true });
  const { config, deps, r } = conFake(h, { provider: c.mod, despachar: d.despachar });

  const res = await correrDaemon(config, { ...deps, maxVueltas: 3 });

  assert.equal(res.vueltas, 3);
  assert.equal(c.veces(), 3, "una consulta al gestor por vuelta");
  assert.deepEqual(r.esperas, [120_000, 120_000], "duerme ENTRE vueltas, y no despues de la ultima");
  assert.deepEqual(d.llamadas, ["2"], "el ticket se despacha una vez, no una por vuelta");
  assert.equal(res.terminadoPor, "vueltas");
});

test("sin bloque limits el intervalo es el del schema, no cero", async () => {
  // EL FALLO QUE EVITA: un intervalo que cae en 0 o en NaN convierte la consulta
  // periodica en un bucle cerrado contra la API del gestor.
  fake.reset();
  const h = home();
  const d = despachador({ home: h });
  const { deps, r } = conFake(h, { despachar: d.despachar });

  await correrDaemon({ home: h }, { ...deps, maxVueltas: 2 });

  assert.deepEqual(r.esperas, [120_000]);
});

// -------------------------------------- 3. un ticket que falla no para el bucle

test("un despacho que lanza no detiene el bucle: se registra y se omite en las vueltas siguientes", async () => {
  // EL FALLO QUE EVITA, y son dos opuestos a la vez. Sin registro, el daemon
  // relanza el ticket cada dos minutos y paga el modelo en cada vuelta por el
  // mismo rechazo. Sin captura, un solo ticket con criterios ilegibles apaga la
  // bandeja entera para todos los demas.
  fake.reset();
  fake.db.inbox = { assigned: ["2", "3"], mentioned: [] };
  const h = home();
  const d = despachador({
    home: h,
    crearRecorrido: true,
    fallaCon: { "2": "el planificador rechazo el plan: sin criterios observables" },
  });
  const { config, deps, b } = conFake(h, { despachar: d.despachar });

  const res = await correrDaemon(config, { ...deps, maxVueltas: 2 });

  assert.equal(res.ok, true, "el bucle sobrevive al ticket que falla");
  assert.equal(res.vueltas, 2);
  assert.deepEqual(res.fallados.map((f) => String(f.item.id)), ["2"]);
  assert.match(res.fallados[0].porque, /criterios observables/, "la causa real, sin resumir a 'no se pudo'");
  assert.deepEqual(res.despachados, ["3"], "el otro ticket se despacho igual");

  assert.deepEqual(d.llamadas, ["2", "3"], "en la segunda vuelta el que fallo NO se reintenta");
  assert.match(leerMemoria({ home: h }).items["2"].porque, /criterios observables/,
    "el motivo queda en la memoria de la bandeja, que es quien lo omite despues");
  assert.ok(b.lineas.error.some((l) => /criterios observables/.test(l)), "y queda dicho en la bitacora");
});

test("un ticket corregido despues de fallar vuelve a entrar", async () => {
  fake.reset();
  fake.db.inbox = { assigned: ["2"], mentioned: [] };
  const h = home();
  const d = despachador({ home: h, fallaCon: { "2": "sin criterios de aceptacion observables" } });
  const { config, deps } = conFake(h, { despachar: d.despachar });

  await correrDaemon(config, { ...deps, maxVueltas: 2 });
  assert.deepEqual(d.llamadas, ["2"], "dos vueltas, un intento");

  // Le agregan los criterios que le faltaban: cambia la huella del contenido.
  fake.db.items["2"].acceptance = ["dado un carrito vacio, cuando agrego, entonces hay uno"];
  await correrDaemon(config, { ...deps, maxVueltas: 1 });

  assert.deepEqual(d.llamadas, ["2", "2"], "un ticket arreglado se reintenta sin que nadie destrabe nada");
});

// -------------------------------------------- 4. el limite de concurrencia

test("el limite de recorridos concurrentes: despacha hasta el cupo y aplaza el resto", async () => {
  fake.reset();
  tickets(["4", "5"]);
  fake.db.inbox = { assigned: ["2", "3", "4", "5"], mentioned: [] };
  const h = home();
  const d = despachador({ home: h, crearRecorrido: true });
  const { config, deps } = conFake(h, { despachar: d.despachar });

  const v = await unaVuelta({ ...config, limits: { pollIntervalSec: 120, maxParallelItems: 2 } }, deps);

  assert.equal(v.despachados.length, 2, "dos, que es el limite");
  assert.equal(v.aplazados.length, 2);
  assert.equal(d.pico(), 2, "y nunca hubo tres a la vez");
  assert.equal(v.cupo, 2);
  assert.deepEqual(leerMemoria({ home: h }).items, {},
    "un aplazado NO es una omision: no se recuerda, porque tiene que entrar en la vuelta siguiente");
});

test("los recorridos que ya estan en curso cuentan contra el cupo", async () => {
  fake.reset();
  tickets(["4", "5"]);
  fake.db.inbox = { assigned: ["2", "3", "4", "5"], mentioned: [] };
  const h = home();
  const d = despachador({ home: h, crearRecorrido: true });
  const { config, deps } = conFake(h, { despachar: d.despachar });

  const primera = await unaVuelta(config, deps);
  assert.deepEqual(primera.despachados, ["2", "3"]);

  const segunda = await unaVuelta(config, deps);
  assert.equal(segunda.enCurso, 2, "los dos recorridos de la primera vuelta siguen abiertos");
  assert.equal(segunda.cupo, 0);
  assert.deepEqual(segunda.despachados, [], "el cupo esta lleno: no se lanza un tercero");
  assert.equal(segunda.aplazados.length, 2);
  assert.deepEqual(d.llamadas, ["2", "3"]);

  // Los dos recorridos terminan (bloqueados, que tambien es terminar).
  for (const id of ["2", "3"]) {
    const run = createRun(unPlan(id), { home: h });
    transition(run, "T001", "blocked", { home: h, failure: "el gate del repositorio ya estaba roto" });
  }

  const tercera = await unaVuelta(config, deps);
  assert.equal(tercera.enCurso, 0, "un recorrido terminado no ocupa cupo para siempre");
  assert.deepEqual(tercera.despachados, ["4", "5"], "y los aplazados entran solos, sin que nadie los empuje");
});

test("un recorrido corrupto no ocupa cupo: un archivo ilegible no puede congelar el daemon", async () => {
  // EL FALLO QUE EVITA: con `maxParallelItems: 1`, contar un recorrido corrupto
  // como en curso deja al daemon sin despachar nunca mas, y sin decir por que.
  // Que no se vuelva a despachar ES trabajo de la bandeja, no del cupo.
  fake.reset();
  fake.db.inbox = { assigned: ["2", "3"], mentioned: [] };
  const h = home();
  mkdirSync(join(h, "runs"), { recursive: true });
  writeFileSync(join(h, "runs", "run-2.json"), "{esto no es json");
  const d = despachador({ home: h });
  const { deps } = conFake(h, { despachar: d.despachar });

  const v = await unaVuelta({ home: h, limits: { maxParallelItems: 1 } }, deps);

  assert.equal(v.enCurso, 0);
  assert.deepEqual(v.despachados, ["3"]);
  assert.ok(v.bandeja.vistos.some((x) => x.estado === "corrupto"), "y el corrupto sigue sin despacharse");
});

// ------------------------------- 5. el limite de tasa del gestor: esperar mas

test("si la consulta al gestor falla, se espera MAS antes de volver a preguntar", async () => {
  // EL FALLO QUE EVITA: un gestor que devuelve 429 y un daemon que le vuelve a
  // preguntar cada dos minutos exactos es un daemon que sostiene el limite de
  // tasa que lo esta frenando. El retroceso es lo que lo deja recuperarse.
  const h = home();
  const g = gestorFalso();
  const caido = { ...g.mod, searchInbox: async () => { throw new Error("429 despues de tres reintentos"); } };
  const b = bitacora();
  const r = reloj();
  const d = despachador({ home: h });

  const res = await correrDaemon({ home: h, limits: { pollIntervalSec: 120, maxParallelItems: 2 } }, {
    provider: caido, providerCtx: g.fixtures.ctx, home: h, log: b.log,
    despachar: d.despachar, dormir: r.dormir, ahora: r.ahora, maxVueltas: 3,
  });

  assert.equal(res.ok, true, "un gestor caido no mata al daemon: vuelve a intentar");
  assert.deepEqual(r.esperas, [240_000, 480_000], "cada fallo seguido duplica la espera");
  assert.equal(res.fallosDeConsulta, 3);
  assert.ok(b.lineas.error.some((l) => /429/.test(l)), "la causa real viaja a la bitacora");
  assert.deepEqual(d.llamadas, [], "y no se despacha nada a ciegas");
});

test("cuando el gestor vuelve, la espera vuelve al intervalo de la configuracion", async () => {
  fake.reset();
  fake.db.inbox = { assigned: ["2"], mentioned: [] };
  const h = home();
  let vez = 0;
  const intermitente = {
    ...fake,
    searchInbox: async (ctx) => {
      if (++vez === 1) throw new Error("la red no esta");
      return fake.searchInbox(ctx);
    },
  };
  const d = despachador({ home: h, crearRecorrido: true });
  const { config, deps, r } = conFake(h, { provider: intermitente, despachar: d.despachar });

  const res = await correrDaemon(config, { ...deps, maxVueltas: 3 });

  assert.deepEqual(r.esperas, [240_000, 120_000], "el retroceso se resetea con el primer exito");
  assert.deepEqual(res.despachados, ["2"], "y el trabajo que estaba esperando se despacha");
});

test("una bandeja que no puede arrancar termina el daemon y libera el lock", async () => {
  // Las dos busquedas en false no es un gestor caido: es un arranque imposible.
  // Reintentarlo cada dos minutos para siempre es la version silenciosa del
  // mismo error, y la peor, porque parece que funciona.
  const h = home();
  const g = sinDisparo();
  const b = bitacora();
  const r = reloj();
  const d = despachador({ home: h });

  await assert.rejects(
    () => correrDaemon({ home: h }, {
      provider: g.mod, providerCtx: g.fixtures.ctx, home: h, log: b.log,
      despachar: d.despachar, dormir: r.dormir, ahora: r.ahora, maxVueltas: 10,
    }),
    (e) => {
      assert.ok(e instanceof DaemonError);
      assert.equal(e.codigo, "arranque_imposible");
      assert.ok(e.causa instanceof BandejaError, "la causa real llega entera");
      assert.equal(e.causa.codigo, "sin_disparo");
      return true;
    },
  );

  assert.deepEqual(r.esperas, [], "no reintenta lo que no puede funcionar");
  assert.equal(inspect("daemon", { home: h }), null, "y el lock queda libre aunque haya salido por un error");
});

// ------------------------------------------------------- 6. apagado limpio

test("una senial de terminacion no deja un despacho a medias sin registro, y libera el lock", async () => {
  // EL FALLO QUE EVITA: un supervisor manda SIGTERM, el daemon corta en el
  // medio y el recorrido queda con una rama y un worktree que nadie sabe que
  // existen. Terminar limpio es terminar el despacho en vuelo y recien
  // entonces salir.
  fake.reset();
  fake.db.inbox = { assigned: ["2"], mentioned: [] };
  const h = home();
  const ac = new AbortController();
  const d = despachador({
    home: h,
    crearRecorrido: true,
    // La senial llega MIENTRAS el despacho esta corriendo.
    alEntrar: async () => ac.abort(),
  });
  const { config, deps, r, b } = conFake(h, { despachar: d.despachar });

  const res = await correrDaemon(config, { ...deps, maxVueltas: 10, signal: ac.signal });

  assert.equal(res.ok, true);
  assert.equal(res.terminadoPor, "senial");
  assert.equal(res.vueltas, 1, "no arranca una vuelta nueva despues de la senial");
  assert.deepEqual(res.despachados, ["2"], "el despacho en vuelo se termino y quedo registrado");
  assert.deepEqual(r.esperas, [], "no duerme dos minutos para despues salir");
  assert.equal(inspect("daemon", { home: h }), null, "el lock se libera");
  assert.ok(b.lineas.info.some((l) => /termin/i.test(l)), "y el apagado se dice");
});

test("una senial anterior al arranque no despacha nada", async () => {
  fake.reset();
  fake.db.inbox = { assigned: ["2"], mentioned: [] };
  const h = home();
  const ac = new AbortController();
  ac.abort();
  const d = despachador({ home: h });
  const { config, deps } = conFake(h, { despachar: d.despachar });

  const res = await correrDaemon(config, { ...deps, maxVueltas: 10, signal: ac.signal });

  assert.equal(res.vueltas, 0);
  assert.deepEqual(d.llamadas, []);
  assert.equal(res.terminadoPor, "senial");
});

// --------------------------- 7. no se despacha lo que no se puede recorrer

test("no despacha un nivel que el gestor no puede recorrer, y respeta lo que la bandeja omitio", async () => {
  const h = home();
  const g = sinCapacidad("children");
  const b = bitacora();
  const r = reloj();
  const d = despachador({ home: h });

  const v = await unaVuelta({ home: h, limits: { maxParallelItems: 4 } }, {
    provider: conBandeja(g, { assigned: ["h1", "s1"] }), providerCtx: g.fixtures.ctx,
    home: h, log: b.log, despachar: d.despachar, dormir: r.dormir, ahora: r.ahora,
  });

  assert.deepEqual(d.llamadas, ["s1"], "el hito que el gestor no sabe recorrer no se despacha");
  assert.deepEqual(v.bandeja.omitidos.map((o) => o.item.id), ["h1"]);
  assert.match(v.bandeja.omitidos[0].porque, /children/);
});

test("un ticket que ya tiene recorrido no se vuelve a despachar", async () => {
  fake.reset();
  fake.db.inbox = { assigned: ["2"], mentioned: [] };
  const h = home();
  createRun(unPlan("2"), { home: h });
  const d = despachador({ home: h });
  const { config, deps } = conFake(h, { despachar: d.despachar });

  const v = await unaVuelta(config, deps);

  assert.deepEqual(d.llamadas, [], "despachar de nuevo pisaria el avance que ya hay en disco");
  assert.equal(v.bandeja.vistos[0].item.id, "2");
});

// ------------------------------------------------------- forma de la salida

test("las degradaciones del gestor se dicen una vez por daemon, no una por vuelta", async () => {
  // Un aviso repetido cada dos minutos todo el dia es un aviso que nadie lee, y
  // entonces la degradacion vuelve a ser invisible.
  const h = home();
  const g = sinCapacidad("searchMentioned");
  const b = bitacora();
  const r = reloj();
  const d = despachador({ home: h, crearRecorrido: true });

  const res = await correrDaemon({ home: h }, {
    provider: g.mod, providerCtx: g.fixtures.ctx, home: h, log: b.log,
    despachar: d.despachar, dormir: r.dormir, ahora: r.ahora, maxVueltas: 3,
  });

  assert.equal(b.lineas.warn.filter((l) => /menci/i.test(l)).length, 1, "se dice una sola vez");
  assert.equal(res.degradaciones.length, 1, "y se reporta en el resumen");
});

test("una vuelta sin nada devuelve todas las listas igual", async () => {
  fake.reset();
  const h = home();
  const d = despachador({ home: h });
  const { config, deps } = conFake(h, { despachar: d.despachar });

  const v = await unaVuelta(config, deps);

  assert.deepEqual(v, {
    bandeja: { nuevos: [], vistos: [], omitidos: [], degradaciones: [] },
    despachados: [],
    fallados: [],
    aplazados: [],
    enCurso: 0,
    cupo: 2,
  });
});

test("un daemon sin despachador no gira en el vacio: lo dice al arrancar", async () => {
  // Un bucle que lee la bandeja y no despacha nada se ve, desde afuera, igual
  // que un bucle que no encuentra trabajo.
  fake.reset();
  const h = home();
  const { config, deps } = conFake(h);

  await assert.rejects(
    () => correrDaemon(config, { ...deps, maxVueltas: 1 }),
    (e) => {
      assert.ok(e instanceof DaemonError);
      assert.equal(e.codigo, "sin_despachador");
      return true;
    },
  );
  assert.equal(inspect("daemon", { home: h }), null);
});

// ===========================================================================
// 8. Lo que se intento para ROMPERLO, y no para confirmarlo.
//
//    Las siete formas de arriba son las que el bucle eligio mirar. Las de abajo
//    son las que le pasan sin que las elija: un despachador que lanza antes de
//    devolver la promesa, uno que devuelve `ok: false` sin lanzar, uno que
//    nunca termina, uno que vuelve bien sin dejar recorrido, un cupo o un
//    intervalo invalidos, mil tickets en una vuelta, un lock viejo que quiere
//    liberar el del nuevo.
//
//    Siete de esas estaban rotas, y ninguna se veia desde la salida: el bucle
//    devolvia `ok: true` en todas. Dos quedan declaradas como huecos y con su
//    medicion, no como resueltas: la carrera del lock entre dos procesos
//    (16 de 25 antes, 3 de 25 despues) y el despacho colgado, que se ve pero no
//    se puede cancelar.
// ===========================================================================

/** Un gestor que devuelve exactamente lo que se le pase, sin pasar por getItem. */
function gestorCrudo(respuesta, caps = {}) {
  return {
    meta: { name: "crudo", version: "1.0.0" },
    capabilities: () => ({
      children: true, dependencies: true, createChild: true, setState: true, comment: true,
      linkUrl: true, labels: true, searchAssigned: true, searchMentioned: true, boardFields: true,
      ...caps,
    }),
    getItem: async () => null,
    searchInbox: async () => (typeof respuesta === "function" ? respuesta() : respuesta),
  };
}

const unTicket = (id, extra = {}) => ({
  id, level: "story", title: `ticket ${id}`, body: "", acceptance: ["dado algo, cuando algo, entonces algo"],
  canonicalState: "todo", parentId: null, labels: [], assignee: null, ...extra,
});

test("un despachador que lanza ANTES de devolver la promesa no se confunde con un gestor caido", async () => {
  // EL FALLO QUE EVITA: `aDespachar.map(item => despachar(item))` propaga un
  // throw sincrono hacia afuera de la vuelta entera. Ahi el bucle lo lee como
  // "la consulta a la bandeja fallo": duplica la espera, no despacha a NINGUNO
  // de los otros tickets de esa vuelta, no registra la omision del que fallo, y
  // el mensaje culpa al gestor de un error que es del cableado. Un TypeError en
  // el despachador —un `undefined` en la configuracion, una funcion que cambio
  // de firma— entra justo por aca.
  fake.reset();
  fake.db.inbox = { assigned: ["2", "3"], mentioned: [] };
  const h = home();
  const llamadas = [];
  const despachar = (item) => {
    llamadas.push(String(item.id));
    if (String(item.id) === "2") throw new TypeError("no se puede leer 'repos' de undefined");
    return Promise.resolve({ ok: true });
  };
  const { config, deps, r, b } = conFake(h, { despachar });

  const res = await correrDaemon(config, { ...deps, maxVueltas: 1 });

  assert.equal(res.ok, true, "un cableado roto no es un gestor caido");
  assert.equal(res.fallosDeConsulta, 0, "y no se le cuenta a la consulta");
  assert.deepEqual(res.fallados.map((f) => String(f.item.id)), ["2"]);
  assert.match(res.fallados[0].porque, /repos/, "la causa real, entera");
  assert.deepEqual(res.despachados, ["3"], "el otro ticket de la misma vuelta se despacha igual");
  assert.deepEqual(r.esperas, [], "una sola vuelta: no hay retroceso que aplicar");
  assert.match(leerMemoria({ home: h }).items["2"].porque, /repos/, "queda recordado para la vuelta siguiente");
  assert.ok(b.lineas.error.some((l) => /repos/.test(l)));
});

test("un despacho que resuelve con ok:false no es un despacho: se registra y no se relanza", async () => {
  // EL FALLO QUE EVITA: el cableado del CLI no lanza cuando no puede despachar
  // —devuelve `{ok: false, humano: [...]}`, que es la convencion de
  // `comandos.mjs` para "el ticket no existe" y para "este nivel no se puede
  // recorrer"—. Contando eso como exito, el ticket no queda registrado en
  // ninguna parte y se relanza en cada vuelta: 720 despachos por dia, cada uno
  // pagando lo que cueste llegar hasta el rechazo.
  fake.reset();
  fake.db.inbox = { assigned: ["2"], mentioned: [] };
  const h = home();
  const llamadas = [];
  const despachar = async (item) => {
    llamadas.push(String(item.id));
    return { ok: false, humano: [`el ticket ${item.id} no existe en el gestor fake`] };
  };
  const { config, deps } = conFake(h, { despachar });

  const res = await correrDaemon(config, { ...deps, maxVueltas: 3 });

  assert.deepEqual(llamadas, ["2"], "tres vueltas, un solo intento");
  assert.deepEqual(res.despachados, [], "un ok:false no es un despacho");
  assert.deepEqual(res.fallados.map((f) => String(f.item.id)), ["2"]);
  assert.match(res.fallados[0].porque, /no existe/, "el motivo es el que dio el despachador");
  assert.match(leerMemoria({ home: h }).items["2"].porque, /no existe/);
});

test("un despacho que vuelve bien sin dejar recorrido se DICE: si no, se repite para siempre", async () => {
  // EL FALLO QUE EVITA: la bandeja deduplica mirando el recorrido en disco, asi
  // que un despacho que no lo deja se vuelve a despachar en cada vuelta, 720
  // veces por dia, y desde afuera parece que el daemon trabaja. No es
  // hipotetico: hoy mismo el cableado devuelve `ok: true` con "todavia no
  // implementado" para el nivel de hito, y ese ticket entraria en cada vuelta.
  //
  // No se convierte en omision: un despachador puede tener razones para no
  // dejar estado, y pararle el ticket seria peor que repetirlo. Lo que falta es
  // decirlo.
  fake.reset();
  fake.db.inbox = { assigned: ["2"], mentioned: [] };
  const h = home();
  const sinEstado = despachador({ home: h });
  const a = conFake(h, { despachar: sinEstado.despachar });

  const res = await correrDaemon(a.config, { ...a.deps, maxVueltas: 2 });

  assert.deepEqual(res.despachados, ["2", "2"], "en efecto, se despacho dos veces");
  assert.ok(
    a.b.lineas.warn.some((l) => /sin dejar recorrido/.test(l)),
    "y quedo dicho, en vez de parecer trabajo",
  );

  fake.reset();
  fake.db.inbox = { assigned: ["2"], mentioned: [] };
  const h2 = home();
  const conEstado = despachador({ home: h2, crearRecorrido: true });
  const b2 = conFake(h2, { despachar: conEstado.despachar });

  await correrDaemon(b2.config, { ...b2.deps, maxVueltas: 2 });

  assert.equal(b2.b.lineas.warn.some((l) => /sin dejar recorrido/.test(l)), false,
    "y no se dice cuando el despacho si dejo su recorrido: seria ruido en cada vuelta");
});

test("un despacho que nunca termina no deja al daemon en silencio", { timeout: 10_000 }, async () => {
  // EL FALLO QUE EVITA: el bucle espera los despachos de la vuelta enteros —es
  // lo que sostiene el apagado limpio—, asi que un despacho colgado (una
  // llamada al modelo sin timeout, un git esperando una credencial que nadie va
  // a escribir) congela el daemon para siempre. No hay consulta, no hay
  // despacho y no hay una sola linea: desde afuera es identico a una bandeja
  // vacia, que es el modo de fallo que este modulo entero existe para matar.
  //
  // No se mata el despacho: no se puede cancelar lo que ya lanzo worktrees y
  // sesiones, y abandonarlo produciria el despacho en vuelo que nadie sabe que
  // existe. Lo que se arregla es el silencio.
  fake.reset();
  fake.db.inbox = { assigned: ["2"], mentioned: [] };
  const h = home();
  const b = bitacora();
  let termino = false;
  const latido = () => b.lineas.info.find((l) => /sigue corriendo/.test(l));
  const despachar = async () => {
    // "Nunca termina" hasta que el latido aparece. El corte a los tres
    // segundos es para que este test falle en vez de colgar el runner: si el
    // latido no existe, `latido()` es undefined y la asercion de abajo se pone
    // roja. Ese es justo el silencio que se esta probando.
    const hasta = Date.now() + 3000;
    while (!latido() && Date.now() < hasta) await new Promise((res) => setTimeout(res, 2));
    termino = true;
    return { ok: true };
  };

  const v = await unaVuelta({ home: h, limits: { maxParallelItems: 2 } }, {
    provider: fake, providerCtx: fake.fixtures.ctx, home: h, log: b.log, despachar, latidoMs: 5,
  });

  assert.ok(termino, "el despacho se espera entero: no se abandona a mitad");
  assert.deepEqual(v.despachados, ["2"]);
  assert.match(latido(), /\b2\b/, "el latido nombra el ticket que no vuelve");
  assert.match(latido(), /[0-9]+(\.[0-9]+)?s/, "y cuanto lleva esperando");
});

test("mil tickets en una vuelta: se despacha el cupo y el aviso no vuelca mil ids", async () => {
  const h = home();
  const b = bitacora();
  const muchos = Array.from({ length: 1000 }, (_, i) => unTicket(`m${i}`));
  const d = despachador({ home: h, crearRecorrido: true });

  const v = await unaVuelta({ home: h, limits: { maxParallelItems: 2 } }, {
    provider: gestorCrudo({ assigned: muchos, mentioned: [] }), providerCtx: {},
    home: h, log: b.log, despachar: d.despachar,
  });

  assert.equal(v.despachados.length, 2, "el cupo se respeta con mil tickets igual que con dos");
  assert.equal(v.aplazados.length, 998);
  assert.equal(d.pico(), 2);
  const aviso = b.lineas.info.find((l) => /esperan cupo/.test(l));
  assert.ok(aviso, "los aplazados se dicen");
  assert.ok(aviso.length < 400, `el aviso de aplazados mide ${aviso.length} caracteres: es una linea por vuelta, 720 por dia`);
  assert.match(aviso, /998/, "y dice cuantos son, aunque no los nombre a todos");
});

test("un item invalido del gestor no tumba el bucle ni se despacha a ver que pasa", async () => {
  const h = home();
  const b = bitacora();
  const r = reloj();
  const d = despachador({ home: h });

  const res = await correrDaemon({ home: h }, {
    provider: gestorCrudo({
      assigned: [unTicket("raro", { level: "iniciativa" }), null, unTicket(""), unTicket("bueno")],
      mentioned: [],
    }),
    providerCtx: {}, home: h, log: b.log, despachar: d.despachar,
    dormir: r.dormir, ahora: r.ahora, maxVueltas: 2,
  });

  assert.equal(res.ok, true);
  assert.deepEqual(d.llamadas, ["bueno", "bueno"],
    "solo el que se puede recorrer; y vuelve a entrar porque este despachador no deja recorrido en disco");
  assert.deepEqual(res.despachados, ["bueno", "bueno"]);
});

test("una respuesta con la forma equivocada termina el daemon en vez de girar en el vacio", async () => {
  // Un proveedor que devuelve otra forma no es un gestor caido: es codigo roto.
  // Reintentarlo cada dos minutos deja el proceso vivo, la bitacora con lineas
  // y cero recorridos — la version silenciosa del mismo error.
  const h = home();
  const b = bitacora();
  const r = reloj();
  const d = despachador({ home: h });

  await assert.rejects(
    () => correrDaemon({ home: h }, {
      provider: gestorCrudo({ items: [] }), providerCtx: {}, home: h, log: b.log,
      despachar: d.despachar, dormir: r.dormir, ahora: r.ahora, maxVueltas: 10,
    }),
    (e) => {
      assert.ok(e instanceof DaemonError);
      assert.equal(e.codigo, "arranque_imposible");
      assert.ok(e.causa instanceof BandejaError);
      assert.equal(e.causa.codigo, "respuesta_invalida");
      return true;
    },
  );
  assert.deepEqual(r.esperas, [], "no reintenta lo que no puede funcionar");
  assert.equal(inspect("daemon", { home: h }), null, "y el lock queda libre");
});

test("un intervalo invalido cae en el del schema, no en un bucle cerrado contra la API", async () => {
  // EL FALLO QUE EVITA: `?? ` no atrapa el 0 ni el NaN. Un `pollIntervalSec: 0`
  // —o un "120" que salio de una variable de entorno— convierte la consulta
  // periodica en un bucle cerrado contra la API del gestor: el fallo mas caro
  // que este modulo puede producir, y el mas silencioso, porque desde afuera
  // parece que anda rapido.
  for (const malo of [0, -5, NaN, "120", null, undefined, {}]) {
    fake.reset();
    const h = home();
    const d = despachador({ home: h });
    const { deps, r } = conFake(h, { despachar: d.despachar });

    await correrDaemon({ home: h, limits: { pollIntervalSec: malo } }, { ...deps, maxVueltas: 2 });

    assert.deepEqual(r.esperas, [120_000], `pollIntervalSec ${JSON.stringify(malo)} tiene que caer en el default`);
  }
});

test("un cupo invalido no apaga el despacho en silencio", async () => {
  // Un cupo en 0 es un daemon que consulta y no despacha nunca: desde afuera,
  // otra vez, indistinguible de una bandeja vacia. El schema declara minimo 1,
  // asi que un 0 es configuracion invalida y no una forma de pausar nada.
  for (const malo of [0, -1, NaN, "2"]) {
    fake.reset();
    fake.db.inbox = { assigned: ["2"], mentioned: [] };
    const h = home();
    const d = despachador({ home: h, crearRecorrido: true });
    const { deps, b } = conFake(h, { despachar: d.despachar });

    const v = await unaVuelta({ home: h, limits: { maxParallelItems: malo } }, deps);

    assert.deepEqual(v.despachados, ["2"], `maxParallelItems ${JSON.stringify(malo)} no puede apagar el despacho`);
    assert.ok(b.lineas.warn.some((l) => /maxParallelItems/.test(l)), "y se dice que la configuracion no sirve");
  }
});

test("un ticket que entra mientras el daemon despacha otro se despacha en la vuelta siguiente", async () => {
  // EL FALLO QUE EVITA: perder un ticket. La consulta de la vuelta ya ocurrio
  // cuando el ticket aparece, asi que la unica garantia de que no se pierda es
  // que la vuelta siguiente vuelva a preguntar de verdad.
  fake.reset();
  fake.db.inbox = { assigned: ["2"], mentioned: [] };
  const h = home();
  const d = despachador({
    home: h,
    crearRecorrido: true,
    alEntrar: async () => { fake.db.inbox.assigned = ["2", "3"]; },
  });
  const { config, deps } = conFake(h, { despachar: d.despachar });

  const res = await correrDaemon(config, { ...deps, maxVueltas: 2 });

  assert.deepEqual(d.llamadas, ["2", "3"], "el que llego tarde entra solo");
  assert.deepEqual(res.despachados, ["2", "3"]);
});

test("el mismo ticket asignado Y mencionado es un despacho, no dos", async () => {
  fake.reset();
  fake.db.inbox = { assigned: ["2"], mentioned: ["2"] };
  const h = home();
  const d = despachador({ home: h, crearRecorrido: true });
  const { config, deps } = conFake(h, { despachar: d.despachar });

  const res = await correrDaemon(config, { ...deps, maxVueltas: 2 });

  assert.deepEqual(d.llamadas, ["2"], "dos seniales y dos vueltas: un solo recorrido");
  assert.deepEqual(res.despachados, ["2"]);
});

// --------------------------------------------------------- 9. el lock, de cerca

test("un lock huerfano de un proceso que ya no existe se recupera, y se dice", async () => {
  // EL FALLO QUE EVITA: un corte de luz deja el archivo del lock tirado. Si no
  // se recuperara, el daemon no arrancaria nunca mas y habria que borrar un
  // archivo a mano para que el sistema vuelva a andar.
  fake.reset();
  const h = home();
  mkdirSync(join(h, "locks"), { recursive: true });
  writeFileSync(join(h, "locks", "daemon.json"), JSON.stringify({
    // Un pid que no existe: el maximo de Linux es 2^22, y en macOS es menor.
    pid: 4_194_304, host: hostname(), token: "de-un-proceso-muerto",
    resource: "daemon", acquiredAt: "2026-09-16T10:00:00.000Z",
  }));
  const d = despachador({ home: h });
  const { config, deps, b } = conFake(h, { despachar: d.despachar });

  const res = await correrDaemon(config, { ...deps, maxVueltas: 1 });

  assert.equal(res.ok, true, "el daemon arranca igual");
  assert.ok(b.lineas.warn.some((l) => /huerfano/.test(l)), "y no en silencio: un lock recuperado se dice");
  assert.equal(inspect("daemon", { home: h }), null);
});

test("un daemon viejo no puede liberar el lock del nuevo", async () => {
  // EL FALLO QUE EVITA: el `release()` tardio de un proceso que ya perdio el
  // lock. Sin el token, deja el recurso libre mientras el nuevo duenio sigue
  // trabajando — y el tercero que llegue arranca un segundo daemon sobre la
  // misma bandeja.
  fake.reset();
  const h = home();
  const viejo = acquire("daemon", { home: h });
  assert.ok(viejo.ok);
  viejo.release();

  const nuevo = acquire("daemon", { home: h });
  assert.ok(nuevo.ok, "el nuevo lo toma despues");
  viejo.release(); // el tardio: su token ya no es el del archivo

  assert.ok(inspect("daemon", { home: h }), "el lock del nuevo sigue puesto");

  const d = despachador({ home: h });
  const { config, deps } = conFake(h, { despachar: d.despachar });
  const res = await correrDaemon(config, { ...deps, maxVueltas: 1 });

  assert.equal(res.ok, false, "y un tercero sigue viendo el lock tomado");
  assert.equal(res.codigo, "lock_tomado");
  nuevo.release();
});

test("el que perdio la carrera del lock se va, aunque acquire le haya dicho que si", async () => {
  // EL FALLO QUE EVITA ESTA MEDIDO, y es el peor de este modulo. `acquire`
  // decide con `existsSync` y escribe despues: dos daemons que arrancan al
  // mismo tiempo ven los dos que no hay lock y los dos se lo toman. Con dos
  // procesos de verdad sobre el mismo home, 16 de 25 arranques simultaneos
  // despacharon el MISMO ticket dos veces, y los dos informaron ok.
  //
  // Aca se prueba la mitad que se puede probar sin carrera: dado el archivo
  // que deja el que GANO el rename, el que perdio tiene que reconocerlo.
  //
  // LO QUE ESTE TEST NO AFIRMA: que la carrera este resuelta. Con la
  // relectura, el mismo experimento bajo de 16 a 3 de 25 — mejor, y todavia
  // roto. El arreglo atomico (O_EXCL) va en `lock.mjs`, y queda declarado como
  // hueco. Un test que dijera "no hay carrera" seria un verde inventado.
  const h = home();
  mkdirSync(join(h, "locks"), { recursive: true });
  const archivo = join(h, "locks", "daemon.json");
  const escribir = (pid) => writeFileSync(archivo, JSON.stringify({
    pid, host: hostname(), token: `de-${pid}`, resource: "daemon", acquiredAt: new Date().toISOString(),
  }));

  escribir(process.pid + 1);
  const ajeno = confirmarLockPropio(h);
  assert.equal(ajeno.ok, false, "el archivo quedo con el token del otro: el lock no es nuestro");
  assert.equal(ajeno.heldBy.pid, process.pid + 1, "y se sabe de quien es");

  escribir(process.pid);
  assert.equal(confirmarLockPropio(h).ok, true, "con el nuestro puesto, si");

  writeFileSync(archivo, "{esto no es json");
  assert.equal(confirmarLockPropio(h).ok, false, "un lock ilegible tampoco es nuestro");

  rmSync(archivo);
  assert.equal(confirmarLockPropio(h).ok, false,
    "y si no esta, no arrancamos: es mejor no arrancar que arrancar un segundo daemon sobre la misma bandeja");
});

test("la espera se interrumpe con la senial: un apagado no tarda el intervalo entero", { timeout: 10_000 }, async () => {
  // Sin `dormir` inyectado: aca se prueba la espera de verdad. Un supervisor
  // que manda SIGTERM y espera diez segundos antes del SIGKILL mata dormido a
  // un daemon cuya espera no mira la senial — y ahi si queda un despacho a
  // medias, producido por la propia espera.
  fake.reset();
  const h = home();
  const b = bitacora();
  const ac = new AbortController();
  const d = despachador({ home: h });
  const t0 = Date.now();
  const cortar = setTimeout(() => ac.abort(), 10);

  const res = await correrDaemon({ home: h, limits: { pollIntervalSec: 5 } }, {
    provider: fake, providerCtx: fake.fixtures.ctx, home: h, log: b.log,
    despachar: d.despachar, maxVueltas: 3, signal: ac.signal,
  });
  const tardo = Date.now() - t0;
  clearTimeout(cortar);

  assert.equal(res.terminadoPor, "senial");
  assert.ok(tardo < 2000, `tardo ${tardo}ms: la espera de 5s no miro la senial`);
  assert.equal(inspect("daemon", { home: h }), null, "y el lock se libera igual");
});

// --------------------------------------------------- 10. lo que queda declarado

test("un fallo transitorio de despacho deja el ticket parado hasta que alguien lo toque", async () => {
  // ESTE TEST NO CELEBRA: DECLARA. La memoria de la bandeja se indexa por el
  // CONTENIDO del ticket, asi que un fallo que no tiene nada que ver con el
  // contenido —un 502 del gestor a mitad del despacho, un git fetch sin red—
  // deja el ticket omitido hasta que alguien le edite el titulo o los
  // criterios. El daemon no distingue un rechazo del planificador (que no hay
  // que reintentar) de un fallo de infraestructura (que si).
  //
  // Se deja asi a proposito: el reintento ciego cada dos minutos es el fallo
  // que la memoria existe para cortar, y elegir entre los dos necesita una
  // decision que no es de este modulo. Queda escrito para que nadie lo
  // descubra en produccion.
  fake.reset();
  fake.db.inbox = { assigned: ["2"], mentioned: [] };
  const h = home();
  let vez = 0;
  const llamadas = [];
  const despachar = async (item) => {
    llamadas.push(String(item.id));
    if (++vez === 1) throw new Error("502 del gestor a mitad del despacho");
    return { ok: true };
  };
  const { config, deps } = conFake(h, { despachar });

  await correrDaemon(config, { ...deps, maxVueltas: 5 });

  assert.deepEqual(llamadas, ["2"], "cinco vueltas y un solo intento, aunque el fallo fuera pasajero");
  assert.match(leerMemoria({ home: h }).items["2"].porque, /502/);
});
