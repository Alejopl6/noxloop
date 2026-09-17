// La bandeja: el disparo por asignacion y por mencion, con deduplicacion.
//
// POR QUE ESTE TEST EXISTE ANTES DEL MODULO. Los seis casos de abajo son seis
// formas de que un daemon se rompa en silencio, y ninguna de las seis se ve
// mirando la salida: despachar dos veces el mismo ticket, volver a despachar
// uno que ya tiene recorrido, girar en el vacio porque las dos busquedas estan
// apagadas, aceptar un nivel que el gestor no puede recorrer, reintentar en
// bucle lo que ya se omitio, y —el peor— leer un fallo del gestor como "no hay
// trabajo".
//
// Se prueba contra el proveedor falso y contra gestores falsos a medida: sin
// red, sin credenciales y sin costo.
//
// LOS BLOQUES 7 Y 8 SE AGREGARON DESPUES, intentando romper el modulo a
// proposito en vez de confirmarlo. Lo que los motiva es que las seis formas de
// arriba son las que la bandeja ELIGE —niveles, capacidades, memoria—, y
// ninguna de ellas cubre lo que el gestor devuelve MAL, ni cuanto cuesta: el
// mismo ticket dos veces en la misma lista, el mismo id como numero y como
// string, un item sin id, un id en blanco, una respuesta con otra forma, mil
// tickets de una vez, una memoria cortada a mitad de la escritura, y una
// memoria que crece sin techo.
//
// Lo que encontraron: dos roturas —un id en blanco llegaba hasta el despacho, y
// una respuesta con otra forma se leia como "no hay trabajo"— y dos costos que
// nadie habia medido: mil omisiones tardaban 1525ms por escribir la memoria mil
// veces, y las entradas no se podaban nunca.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, writeFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fake from "../../../providers/fake/index.mjs";
import { gestorFalso, sinCapacidad, sinDisparo } from "../../../providers/degradation-fakes.mjs";
import { createRun, setTaskFields, transition, bump } from "../src/state.mjs";
import { revisarBandeja, recordarOmision, olvidar, leerMemoria, huellaDeItem, BandejaError } from "../src/inbox.mjs";

const home = () => mkdtempSync(join(tmpdir(), "noxloop-inbox-"));

/** Un log que se puede interrogar: la bandeja tiene que DECIR lo que degrada. */
function bitacora() {
  const lineas = { info: [], warn: [], error: [] };
  return {
    lineas,
    log: {
      info: (m) => lineas.info.push(String(m)),
      warn: (m) => lineas.warn.push(String(m)),
      error: (m) => lineas.error.push(String(m)),
      child: () => bitacora().log,
    },
  };
}

/** Cuenta las consultas al gestor: la bandeja consulta UNA vez por pasada. */
function contando(mod) {
  let veces = 0;
  return {
    veces: () => veces,
    mod: {
      ...mod,
      searchInbox: async (/** @type {any} */ ctx) => {
        veces++;
        return mod.searchInbox(ctx);
      },
    },
  };
}

/** Un gestor falso a medida, con la bandeja que pida el caso. */
function conBandeja(g, { assigned = [], mentioned = [] }) {
  return {
    ...g.mod,
    searchInbox: async (/** @type {any} */ ctx) => ({
      assigned: await Promise.all(assigned.map((i) => g.mod.getItem(i, ctx))),
      mentioned: await Promise.all(mentioned.map((i) => g.mod.getItem(i, ctx))),
    }),
  };
}

const conFake = (h, extra = {}) => {
  const b = bitacora();
  return {
    b,
    config: { home: h },
    deps: { provider: fake, providerCtx: fake.fixtures.ctx, home: h, log: b.log, ...extra },
  };
};

const unPlan = (id, tasks) => ({
  item: { id, title: "una historia", level: "story", url: `fake://items/${id}`, provider: "fake" },
  repoScope: ["app"],
  tasks: tasks || [{
    id: "T001", repo: "app", title: "la tarea", acceptance: "criterio",
    targetFiles: ["src/a.mjs"], testFiles: ["test/a.test.mjs"],
    tier: "small", dependsOn: [], dependencyKind: "hard",
  }],
});

// ------------------------------------------------- 1. deduplicacion por ticket

test("un ticket asignado Y mencionado produce UN solo recorrido", async () => {
  fake.reset();
  fake.db.inbox = { assigned: ["2"], mentioned: ["2"] };
  const h = home();
  const c = contando(fake);
  const { config, deps } = conFake(h);

  const r = await revisarBandeja(config, { ...deps, provider: c.mod });

  assert.equal(r.nuevos.length, 1, "dos seniales sobre el mismo ticket son un despacho");
  assert.equal(r.nuevos[0].id, "2");
  assert.deepEqual(r.nuevos[0].disparos, ["assigned", "mentioned"], "las dos seniales quedan registradas");
  assert.equal(c.veces(), 1, "una sola consulta al gestor por pasada");
});

test("asignado y mencionado distintos son dos, cada uno con su disparo", async () => {
  fake.reset();
  fake.db.inbox = { assigned: ["2"], mentioned: ["3"] };
  const { config, deps } = conFake(home());

  const r = await revisarBandeja(config, deps);

  assert.deepEqual(r.nuevos.map((i) => i.id), ["2", "3"]);
  assert.deepEqual(r.nuevos[0].disparos, ["assigned"]);
  assert.deepEqual(r.nuevos[1].disparos, ["mentioned"]);
});

// ------------------------------------------- 2. lo que ya tiene recorrido

test("un ticket con recorrido no es nuevo: se reporta en vistos con su estado", async () => {
  fake.reset();
  fake.db.inbox = { assigned: ["2", "3"], mentioned: [] };
  const h = home();
  createRun(unPlan("2"), { home: h });
  const { config, deps } = conFake(h);

  const r = await revisarBandeja(config, deps);

  assert.deepEqual(r.nuevos.map((i) => i.id), ["3"], "solo el que no tiene recorrido");
  assert.deepEqual(r.vistos.map((v) => v.item.id), ["2"]);
  assert.equal(r.vistos[0].estado, "en_curso");
  assert.equal(r.vistos[0].recorrido, "2");
});

test("un recorrido con todo bloqueado se reporta bloqueado, y sigue sin ser nuevo", async () => {
  fake.reset();
  fake.db.inbox = { assigned: ["2"], mentioned: [] };
  const h = home();
  const run = createRun(unPlan("2"), { home: h });
  transition(run, "T001", "blocked", { home: h, failure: "el gate del repositorio ya estaba roto" });
  const { config, deps } = conFake(h);

  const r = await revisarBandeja(config, deps);

  assert.deepEqual(r.nuevos, []);
  assert.equal(r.vistos[0].estado, "bloqueado");
});

test("un recorrido corrupto NO vuelve a despacharse: replanificar encima seria peor", async () => {
  fake.reset();
  fake.db.inbox = { assigned: ["2"], mentioned: [] };
  const h = home();
  mkdirSync(join(h, "runs"), { recursive: true });
  writeFileSync(join(h, "runs", "run-2.json"), "{esto no es json");
  const { config, deps } = conFake(h);

  const r = await revisarBandeja(config, deps);

  assert.deepEqual(r.nuevos, [], "hay trabajo en disco, aunque no se pueda leer");
  assert.equal(r.vistos[0].estado, "corrupto");
});

test("un ticket que el motor creo como tarea hija de otro recorrido no es nuevo", async () => {
  // EL FALLO CONCRETO: `createChild` materializa las tareas como tickets, y si
  // esos hijos quedan asignados a la identidad de noxloop, la vuelta siguiente
  // del daemon los ve en la bandeja y arranca un recorrido por cada tarea del
  // recorrido que ya esta corriendo.
  fake.reset();
  fake.db.inbox = { assigned: ["3"], mentioned: [] };
  const h = home();
  const run = createRun(unPlan("2"), { home: h });
  setTaskFields(run, "T001", { providerItemId: "3" }, { home: h });
  const { config, deps } = conFake(h);

  const r = await revisarBandeja(config, deps);

  assert.deepEqual(r.nuevos, []);
  assert.equal(r.vistos[0].recorrido, "2");
  assert.match(r.vistos[0].porque, /T001/, "dice de que tarea de que recorrido es");
});

// ------------------------------------------------- 3. degradacion declarada

test("sin searchMentioned la bandeja anda con las asignaciones, y lo dice", async () => {
  const g = sinCapacidad("searchMentioned");
  const b = bitacora();
  const h = home();

  const r = await revisarBandeja({ home: h }, {
    provider: g.mod, providerCtx: g.fixtures.ctx, home: h, log: b.log,
  });

  assert.deepEqual(r.nuevos.map((i) => i.id), ["s1"], "la mitad que el gestor sabe hacer");
  assert.equal(r.degradaciones.length, 1);
  assert.match(r.degradaciones[0], /menci/i);
  assert.ok(b.lineas.warn.some((l) => /menci/i.test(l)), "la degradacion se dice, no se calla");
});

test("sin searchAssigned la bandeja anda con las menciones, y lo dice", async () => {
  const g = sinCapacidad("searchAssigned");
  const h = home();
  const b = bitacora();

  const r = await revisarBandeja({ home: h }, {
    provider: g.mod, providerCtx: g.fixtures.ctx, home: h, log: b.log,
  });

  assert.deepEqual(r.nuevos.map((i) => i.id), ["s2"]);
  assert.equal(r.degradaciones.length, 1);
  assert.match(r.degradaciones[0], /asigna/i);
});

test("las dos busquedas en false es un error de arranque, no una bandeja vacia", async () => {
  const g = sinDisparo();
  const h = home();
  const b = bitacora();

  await assert.rejects(
    () => revisarBandeja({ home: h }, { provider: g.mod, providerCtx: g.fixtures.ctx, home: h, log: b.log }),
    (e) => {
      assert.ok(e instanceof BandejaError);
      assert.equal(e.codigo, "sin_disparo");
      assert.match(e.message, /searchAssigned/);
      assert.match(e.message, /searchMentioned/);
      return true;
    },
  );
});

// --------------------------------------- 4. un nivel que el gestor no recorre

test("un epic con children en false se omite con su motivo", async () => {
  const g = sinCapacidad("children");
  const h = home();
  const b = bitacora();

  const r = await revisarBandeja({ home: h }, {
    provider: conBandeja(g, { assigned: ["h1"] }), providerCtx: g.fixtures.ctx, home: h, log: b.log,
  });

  assert.deepEqual(r.nuevos, [], "no se despacha lo que no se puede recorrer");
  assert.equal(r.omitidos.length, 1);
  assert.equal(r.omitidos[0].item.id, "h1");
  assert.match(r.omitidos[0].porque, /children/, "nombra la capacidad que falta");
  assert.match(r.omitidos[0].porque, /epic/, "y el nivel que no puede recorrer");
});

test("el mismo epic con children en true si entra", async () => {
  const g = gestorFalso();
  const h = home();
  const b = bitacora();

  const r = await revisarBandeja({ home: h }, {
    provider: conBandeja(g, { assigned: ["h1"] }), providerCtx: g.fixtures.ctx, home: h, log: b.log,
  });

  assert.deepEqual(r.nuevos.map((i) => i.id), ["h1"]);
  assert.deepEqual(r.omitidos, []);
});

// --------------------------------------------- 5. memoria de lo ya visto

test("lo omitido se recuerda en NOXLOOP_HOME, con su motivo", async () => {
  const g = sinCapacidad("children");
  const h = home();
  const b = bitacora();
  const deps = { provider: conBandeja(g, { assigned: ["h1"] }), providerCtx: g.fixtures.ctx, home: h, log: b.log };

  const primera = await revisarBandeja({ home: h }, deps);
  assert.equal(primera.omitidos[0].yaSabido, false, "la primera vez es noticia");
  assert.equal(primera.omitidos[0].vueltas, 1);

  const memoria = leerMemoria({ home: h });
  assert.match(memoria.items.h1.porque, /children/);
  assert.ok(memoria.items.h1.huella, "guarda con que contenido se lo omitio");

  const segunda = await revisarBandeja({ home: h }, deps);
  assert.deepEqual(segunda.nuevos, [], "no se reintenta en bucle");
  assert.equal(segunda.omitidos[0].yaSabido, true, "la segunda vez ya no es noticia");
  assert.equal(segunda.omitidos[0].vueltas, 2);
  assert.match(segunda.omitidos[0].porque, /children/, "el motivo sobrevive a la vuelta");
});

test("la memoria vive fuera de todo repositorio", async () => {
  const g = sinCapacidad("children");
  const h = home();
  const b = bitacora();
  await revisarBandeja({ home: h }, {
    provider: conBandeja(g, { assigned: ["h1"] }), providerCtx: g.fixtures.ctx, home: h, log: b.log,
  });
  assert.ok(existsSync(join(h, "inbox", "omitidos.json")), "el archivo esta en el home del motor");
});

test("un ticket que cambia vuelve a entrar: la huella es del contenido, no del reloj", async () => {
  fake.reset();
  fake.db.inbox = { assigned: ["2"], mentioned: [] };
  const h = home();
  const { config, deps } = conFake(h);

  // Lo omite quien lo despacha: al planificador le faltaban los criterios.
  const item = await fake.getItem("2", fake.fixtures.ctx);
  recordarOmision(item, "sin criterios de aceptacion observables", { home: h });

  const primera = await revisarBandeja(config, deps);
  assert.deepEqual(primera.nuevos, [], "lo ya omitido no se reintenta");
  assert.match(primera.omitidos[0].porque, /criterios/);

  // Le agregan los criterios que le faltaban: el contenido cambio.
  fake.db.items["2"].acceptance = ["dado un carrito vacio, cuando agrego, entonces hay uno"];

  const segunda = await revisarBandeja(config, deps);
  assert.deepEqual(segunda.nuevos.map((i) => i.id), ["2"], "un ticket corregido vuelve a entrar");
  assert.deepEqual(segunda.omitidos, []);
  assert.equal(leerMemoria({ home: h }).items["2"], undefined, "y se olvida el motivo viejo");
});

test("un comentario nuevo NO cambia la huella: si cambiara, el bucle vuelve", async () => {
  // El reloj del gestor (`updatedAt`) se mueve con cualquier comentario o
  // cambio de tablero. Usarlo como huella haria que cada comentario reabra un
  // ticket que se omitio con razon — que es el bucle que la memoria evita.
  const item = {
    id: "9", level: "story", title: "t", body: "b", acceptance: ["c"],
    state: "Nuevo", canonicalState: "todo", parentId: null, labels: [], assignee: null,
  };
  const antes = huellaDeItem(item);
  assert.equal(huellaDeItem({ ...item, raw: { updatedAt: "2026-09-17T10:00:00Z", comments: 3 } }), antes);
  assert.notEqual(huellaDeItem({ ...item, acceptance: ["c", "d"] }), antes, "los criterios SI cuentan");
  assert.notEqual(huellaDeItem({ ...item, title: "otro" }), antes, "el titulo SI cuenta");
});

test("un ticket omitido que despues consiguio recorrido sale de la memoria", async () => {
  fake.reset();
  fake.db.inbox = { assigned: ["2"], mentioned: [] };
  const h = home();
  const { config, deps } = conFake(h);
  const item = await fake.getItem("2", fake.fixtures.ctx);
  recordarOmision(item, "sin criterios de aceptacion observables", { home: h });
  createRun(unPlan("2"), { home: h });

  const r = await revisarBandeja(config, deps);

  assert.equal(r.vistos[0].item.id, "2");
  assert.deepEqual(r.omitidos, [], "el recorrido gana sobre el motivo viejo");
  assert.equal(leerMemoria({ home: h }).items["2"], undefined);
});

// ------------------------------------ 6. un fallo del gestor no vacia la bandeja

test("si searchInbox lanza, se reporta el fallo y NUNCA una bandeja vacia", async () => {
  const h = home();
  const b = bitacora();
  const g = gestorFalso();
  const caido = {
    ...g.mod,
    searchInbox: async () => {
      throw new Error("429 despues de tres reintentos");
    },
  };

  await assert.rejects(
    () => revisarBandeja({ home: h }, { provider: caido, providerCtx: g.fixtures.ctx, home: h, log: b.log }),
    (e) => {
      assert.ok(e instanceof BandejaError);
      assert.equal(e.codigo, "consulta_fallida");
      assert.match(e.message, /429/, "la causa real viaja entera, sin resumir a 'no se pudo'");
      assert.ok(e.causa instanceof Error);
      return true;
    },
  );
  assert.ok(b.lineas.error.some((l) => /429/.test(l)), "queda en la bitacora");
});

test("un fallo del gestor no toca la memoria de omitidos", async () => {
  const h = home();
  const b = bitacora();
  const g = gestorFalso();
  const caido = { ...g.mod, searchInbox: async () => { throw new Error("la red no esta"); } };

  await assert.rejects(() => revisarBandeja({ home: h }, {
    provider: caido, providerCtx: g.fixtures.ctx, home: h, log: b.log,
  }));

  assert.deepEqual(leerMemoria({ home: h }).items, {}, "un fallo de lectura no es un motivo de omision");
});

// ------------------------------------------------------ forma de la salida

test("la salida tiene las cuatro listas siempre, aunque no haya nada", async () => {
  fake.reset();
  const { config, deps } = conFake(home());

  const r = await revisarBandeja(config, deps);

  assert.deepEqual(r, { nuevos: [], vistos: [], omitidos: [], degradaciones: [] });
});

// ===========================================================================
// 7. Lo que el gestor devuelve MAL. Todo lo de abajo es una respuesta que un
//    gestor real puede dar y que la bandeja no eligio: un id repetido, el mismo
//    id con dos tipos, un item sin id, una lista que no es una lista. Ninguna
//    de estas puede producir dos recorridos sobre un ticket ni una bandeja
//    vacia que se lea como "no hay trabajo".
// ===========================================================================

/**
 * Un gestor que devuelve EXACTAMENTE lo que se le pase, sin pasar por
 * `getItem`.
 *
 * POR QUE HACE FALTA, y por que no alcanza `conBandeja`: `getItem` normaliza el
 * item —le pone nivel del mapa, id string, criterios por defecto—, asi que un
 * fake que resuelve por id no puede expresar las respuestas que se quieren
 * probar aca. Los tres gestores incluidos arman el item a mano en su
 * `searchInbox`, y un error ahi produce justo esto.
 */
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

test("el mismo ticket dos veces en la MISMA lista es un solo despacho", async () => {
  // Pasa de verdad: una bandeja armada con dos consultas unidas (asignado por
  // mi + asignado a mi equipo) devuelve el mismo ticket dos veces.
  const h = home();
  const b = bitacora();
  const g = gestorCrudo({ assigned: [unTicket("7"), unTicket("7")], mentioned: [] });

  const r = await revisarBandeja({ home: h }, { provider: g, providerCtx: {}, home: h, log: b.log });

  assert.equal(r.nuevos.length, 1, "un ticket repetido no son dos recorridos");
  assert.deepEqual(r.nuevos[0].disparos, ["assigned"], "y tampoco dos disparos del mismo nombre");
});

test("el mismo id como numero y como string es UN ticket, no dos", async () => {
  // EL FALLO QUE EVITA: un gestor que trae el id numerico en una senial y
  // string en la otra. Con el id crudo como clave, el Map los cuenta como dos
  // tickets distintos, la deduplicacion no ocurre, y salen dos ramas y dos PR
  // para la misma historia.
  const h = home();
  const b = bitacora();
  const g = gestorCrudo({ assigned: [unTicket(7)], mentioned: [unTicket("7")] });

  const r = await revisarBandeja({ home: h }, { provider: g, providerCtx: {}, home: h, log: b.log });

  assert.equal(r.nuevos.length, 1, "el id canonico es string: 7 y \"7\" son el mismo ticket");
  assert.deepEqual(r.nuevos[0].disparos, ["assigned", "mentioned"]);
});

test("un item sin id no rompe la pasada, y se dice en la bitacora", async () => {
  const h = home();
  const b = bitacora();
  const g = gestorCrudo({
    assigned: [null, { title: "sin id" }, unTicket("8")],
    mentioned: [undefined, { id: null, title: "id nulo" }],
  });

  const r = await revisarBandeja({ home: h }, { provider: g, providerCtx: {}, home: h, log: b.log });

  assert.deepEqual(r.nuevos.map((i) => i.id), ["8"], "lo que si tiene id se despacha igual");
  assert.equal(b.lineas.warn.filter((l) => /sin ticket detras/.test(l)).length, 4,
    "cada senial vacia queda dicha, y no se pierde el resto de la bandeja");
});

test("un id vacio o en blanco no se despacha: no hay recorrido que se pueda nombrar", async () => {
  // EL FALLO QUE EVITA: `""` pasa el chequeo de undefined/null y llega hasta el
  // despacho. El estado de ese recorrido seria `run-.json`, que `listRuns` no
  // reconoce (su patron exige al menos un caracter de id), asi que el ticket se
  // despacharia OTRA VEZ en cada vuelta: el recorrido existe en disco y la
  // bandeja no lo puede encontrar nunca.
  const h = home();
  const b = bitacora();
  const g = gestorCrudo({ assigned: [unTicket(""), unTicket("  "), unTicket("9")], mentioned: [] });

  const r = await revisarBandeja({ home: h }, { provider: g, providerCtx: {}, home: h, log: b.log });

  assert.deepEqual(r.nuevos.map((i) => i.id), ["9"]);
  assert.ok(b.lineas.warn.some((l) => /sin ticket detras/.test(l)), "y se dice");
});

test("un nivel que el motor no conoce se omite con su motivo, no se despacha a ver que pasa", async () => {
  const h = home();
  const b = bitacora();
  const g = gestorCrudo({
    assigned: [unTicket("10", { level: "iniciativa" }), unTicket("11", { level: undefined })],
    mentioned: [],
  });

  const r = await revisarBandeja({ home: h }, { provider: g, providerCtx: {}, home: h, log: b.log });

  assert.deepEqual(r.nuevos, []);
  assert.deepEqual(r.omitidos.map((o) => String(o.item.id)), ["10", "11"]);
  assert.match(r.omitidos[0].porque, /iniciativa/, "nombra el nivel que devolvio el proveedor");
  assert.match(r.omitidos[0].porque, /epic, feature, story, task/, "y los que el motor si conoce");
});

test("una respuesta con la forma equivocada es un FALLO, no una bandeja vacia", async () => {
  // EL FALLO QUE EVITA, y es el mismo que el 429 leido como "no hay trabajo",
  // por otra puerta: un proveedor que devuelve `undefined`, una lista pelada o
  // las claves con otro nombre deja una bandeja vacia en cada vuelta. El daemon
  // duerme el intervalo, vuelve, y se queda callado para siempre — con el
  // proceso vivo y la bitacora llena de vueltas sin un solo recorrido.
  const h = home();
  const b = bitacora();

  for (const mala of [undefined, null, [], "ok", { items: [unTicket("12")] }, { assigned: { id: "12" }, mentioned: [] }]) {
    await assert.rejects(
      () => revisarBandeja({ home: h }, { provider: gestorCrudo(mala), providerCtx: {}, home: h, log: b.log }),
      (e) => {
        assert.ok(e instanceof BandejaError, `${JSON.stringify(mala)} tiene que lanzar`);
        assert.equal(e.codigo, "respuesta_invalida");
        return true;
      },
      `la respuesta ${JSON.stringify(mala)} no puede leerse como "no hay trabajo"`,
    );
  }
});

test("la mitad apagada puede venir ausente: eso no es una respuesta invalida", async () => {
  // Un proveedor con `searchMentioned` en false no tiene por que devolver la
  // clave. Exigirsela seria rechazar a un gestor honesto que declara poco, que
  // es lo contrario de lo que pide la tabla de degradacion.
  const h = home();
  const b = bitacora();
  const g = gestorCrudo({ assigned: [unTicket("13")] }, { searchMentioned: false });

  const r = await revisarBandeja({ home: h }, { provider: g, providerCtx: {}, home: h, log: b.log });

  assert.deepEqual(r.nuevos.map((i) => i.id), ["13"]);
  assert.equal(r.degradaciones.length, 1);
});

test("mil tickets: una pasada, ninguno perdido, y sin colgarse", async () => {
  const h = home();
  const b = bitacora();
  const muchos = Array.from({ length: 1000 }, (_, i) => unTicket(`m${i}`));
  const g = gestorCrudo({ assigned: muchos, mentioned: [] });

  const t0 = Date.now();
  const r = await revisarBandeja({ home: h }, { provider: g, providerCtx: {}, home: h, log: b.log });
  const tardo = Date.now() - t0;

  assert.equal(r.nuevos.length, 1000, "no se pierde ninguno: el cupo lo aplica el daemon, no la bandeja");
  assert.ok(tardo < 3000, `una pasada de mil tickets tardo ${tardo}ms`);
});

test("mil tickets omitidos no escriben la memoria mil veces", async () => {
  // EL FALLO QUE EVITA: con una escritura por omision, la memoria se serializa
  // entera en cada una — mil omisiones son mil escrituras de un archivo que
  // crece, y eso es tiempo cuadratico en cada vuelta, cada dos minutos.
  const h = home();
  const b = bitacora();
  const muchos = Array.from({ length: 1000 }, (_, i) => unTicket(`x${i}`, { level: "iniciativa" }));
  const g = gestorCrudo({ assigned: muchos, mentioned: [] });

  const t0 = Date.now();
  const r = await revisarBandeja({ home: h }, { provider: g, providerCtx: {}, home: h, log: b.log });
  const tardo = Date.now() - t0;

  assert.equal(r.omitidos.length, 1000);
  assert.equal(Object.keys(leerMemoria({ home: h }).items).length, 1000, "y los mil quedan recordados");
  assert.ok(tardo < 3000, `mil omisiones tardaron ${tardo}ms`);

  // La segunda pasada los tiene que reconocer a todos, con su cuenta de vueltas.
  const segunda = await revisarBandeja({ home: h }, { provider: g, providerCtx: {}, home: h, log: b.log });
  assert.equal(segunda.nuevos.length, 0, "ninguno se reintenta");
  assert.ok(segunda.omitidos.every((o) => o.yaSabido && o.vueltas === 2));
});

// ===========================================================================
// 8. La memoria: si se corta la escritura a mitad, si crece, si se puede leer.
// ===========================================================================

test("una memoria corrupta no cuelga la bandeja, y la pasada la deja legible", async () => {
  // Un corte a mitad de la escritura es el momento en que el daemon vuelve a
  // arrancar y la necesita. Que sea una AYUDA y no una fuente de verdad es lo
  // que permite tratarla como vacia: el peor caso es volver a reportar una
  // omision que ya se habia reportado.
  const h = home();
  const b = bitacora();
  mkdirSync(join(h, "inbox"), { recursive: true });
  writeFileSync(join(h, "inbox", "omitidos.json"), '{"schemaVersion":1,"items":{"x":{"hue');
  const g = gestorCrudo({ assigned: [unTicket("14", { level: "iniciativa" })], mentioned: [] });

  const r = await revisarBandeja({ home: h }, { provider: g, providerCtx: {}, home: h, log: b.log });

  assert.equal(r.omitidos.length, 1, "la pasada sigue adelante");
  const crudo = readFileSync(join(h, "inbox", "omitidos.json"), "utf8");
  assert.doesNotThrow(() => JSON.parse(crudo), "y la memoria queda legible para la vuelta siguiente");
  assert.equal(leerMemoria({ home: h }).items["14"].vueltas, 1);
});

test("la escritura de la memoria no deja temporales tirados", async () => {
  const h = home();
  const b = bitacora();
  const g = gestorCrudo({ assigned: [unTicket("15", { level: "iniciativa" })], mentioned: [] });

  await revisarBandeja({ home: h }, { provider: g, providerCtx: {}, home: h, log: b.log });

  const sobras = readdirSync(join(h, "inbox")).filter((f) => f.includes(".tmp-"));
  assert.deepEqual(sobras, [], "el temporal se renombra; si queda, la escritura no fue atomica");
});

test("olvidar es el inverso de recordar, y no miente cuando no habia nada", async () => {
  // `olvidar` es la otra mitad de la API de la memoria: la pasada ya olvida
  // sola lo que consiguio recorrido, y esto es para el llamador que despacha un
  // ticket a mano. Se prueba porque va exportado: una funcion exportada sin un
  // test es una funcion que nadie vio correr.
  const h = home();
  const item = { id: "18", level: "story", title: "t", body: "", acceptance: ["c"], labels: [] };
  recordarOmision(item, "sin criterios de aceptacion observables", { home: h });
  assert.ok(leerMemoria({ home: h }).items["18"]);

  assert.equal(olvidar("18", { home: h }), true);
  assert.deepEqual(leerMemoria({ home: h }).items, {});
  assert.equal(existsSync(join(h, "inbox", "omitidos.json")), false,
    "sin entradas, el archivo se borra en vez de quedar diciendo que no hay nada");
  assert.equal(olvidar("18", { home: h }), false, "olvidar lo que no estaba devuelve false, no true");
  assert.equal(olvidar("nunca-existio", { home: h }), false);
});

test("la memoria no crece para siempre: lo que nadie ve hace un mes se poda", async () => {
  // EL FALLO QUE EVITA: la memoria solo crecia. Un ticket omitido una vez y
  // cerrado despues dejaba su entrada ahi, y el archivo se lee ENTERO en cada
  // vuelta —720 veces por dia—. Podar es seguro porque solo cae la entrada de
  // un ticket que no aparecio en la bandeja en todo ese tiempo, y un ticket que
  // no aparece no se puede despachar.
  const h = home();
  const b = bitacora();
  mkdirSync(join(h, "inbox"), { recursive: true });
  writeFileSync(join(h, "inbox", "omitidos.json"), JSON.stringify({
    schemaVersion: 1,
    items: {
      viejo: { huella: "aaa", porque: "sin criterios", desde: "2024-01-01T00:00:00.000Z", ultimaVez: "2024-01-01T00:00:00.000Z", vueltas: 3 },
      sinFecha: { huella: "bbb", porque: "de una version anterior del archivo", vueltas: 1 },
      ayer: { huella: "ccc", porque: "sin criterios", desde: new Date(Date.now() - 86_400_000).toISOString(), ultimaVez: new Date(Date.now() - 86_400_000).toISOString(), vueltas: 2 },
    },
  }));
  const g = gestorCrudo({ assigned: [unTicket("16", { level: "iniciativa" })], mentioned: [] });

  await revisarBandeja({ home: h }, { provider: g, providerCtx: {}, home: h, log: b.log });

  const items = leerMemoria({ home: h }).items;
  assert.equal(items.viejo, undefined, "el de hace dos anios se va");
  assert.ok(items.ayer, "el de ayer se queda");
  assert.ok(items.sinFecha, "y el que no tiene fecha legible no se tira: no se decide sobre un dato que no se pudo leer");
  assert.ok(items["16"], "el de esta pasada queda recordado");
});

test("una pasada sin novedades igual poda: no hace falta una omision nueva para limpiar", async () => {
  const h = home();
  const b = bitacora();
  mkdirSync(join(h, "inbox"), { recursive: true });
  writeFileSync(join(h, "inbox", "omitidos.json"), JSON.stringify({
    schemaVersion: 1,
    items: { viejo: { huella: "aaa", porque: "sin criterios", ultimaVez: "2024-01-01T00:00:00.000Z", vueltas: 3 } },
  }));
  const g = gestorCrudo({ assigned: [], mentioned: [] });

  const r = await revisarBandeja({ home: h }, { provider: g, providerCtx: {}, home: h, log: b.log });

  assert.deepEqual(r, { nuevos: [], vistos: [], omitidos: [], degradaciones: [] });
  assert.deepEqual(leerMemoria({ home: h }).items, {}, "la unica entrada estaba vencida");
  assert.equal(existsSync(join(h, "inbox", "omitidos.json")), false,
    "y una memoria vacia se borra en vez de quedar como un archivo que solo dice que no hay nada");
});

test("un ticket que sigue asignado no envejece: cada pasada le corre la fecha", async () => {
  const h = home();
  const b = bitacora();
  const g = gestorCrudo({ assigned: [unTicket("17", { level: "iniciativa" })], mentioned: [] });
  const deps = { provider: g, providerCtx: {}, home: h, log: b.log };

  await revisarBandeja({ home: h }, deps);
  const primera = leerMemoria({ home: h }).items["17"].ultimaVez;
  await new Promise((res) => setTimeout(res, 5));
  await revisarBandeja({ home: h }, deps);
  const segunda = leerMemoria({ home: h }).items["17"];

  assert.equal(segunda.vueltas, 2);
  assert.ok(segunda.ultimaVez > primera, "la fecha avanza, asi que la poda no lo va a alcanzar nunca");
  assert.equal(segunda.desde, leerMemoria({ home: h }).items["17"].desde, "y desde cuando se omite no se pierde");
});

test("un recorrido ya integrado no vuelve a entrar aunque reasignen el ticket", async () => {
  // Reasignar un ticket terminado es la forma mas facil de pedir un segundo
  // recorrido sobre el mismo trabajo. No hay uno: `run` no replanifica, y el
  // estado en disco es lo que lo dice.
  fake.reset();
  fake.db.inbox = { assigned: ["2"], mentioned: ["2"] };
  const h = home();
  const run = createRun(unPlan("2"), { home: h });
  transition(run, "T001", "in_progress", { home: h });
  transition(run, "T001", "red", { home: h, redVerified: { exitCode: 1 } });
  transition(run, "T001", "green", { home: h });
  transition(run, "T001", "gated", { home: h, evidence: { exitCode: 0 } });
  transition(run, "T001", "reviewed", { home: h });
  bump(run, "T001", "review", { home: h });
  transition(run, "T001", "queued", { home: h });
  transition(run, "T001", "integrated", { home: h, actor: "merge-queue" });
  const { config, deps } = conFake(h);

  const r = await revisarBandeja(config, deps);

  assert.deepEqual(r.nuevos, [], "un ticket terminado no arranca un segundo recorrido");
  assert.equal(r.vistos[0].estado, "integrado");
  assert.deepEqual(r.vistos[0].tareas, { total: 1, integradas: 1, bloqueadas: 0 });
});

// ---------------------------------------------------------------------------
// Un fallo transitorio no es un rechazo.
//
// EL HUECO QUE ESTO CIERRA, declarado por la revision adversarial del daemon: la
// memoria de omitidos se indexa por la huella del contenido del ticket, asi que
// un fallo de infraestructura —un 502 del gestor a mitad del despacho, un
// `git fetch` sin red— dejaba el ticket parado hasta que alguien le cambiara el
// titulo. El daemon no distinguia dos cosas que no se parecen:
//
//   PERMANENTE   el planificador rechazo el ticket (no tiene criterios
//                verificables). Reintentar sin que el ticket cambie es pagar el
//                modelo para llegar al mismo rechazo, 720 veces por dia.
//   TRANSITORIO  el gestor se cayo, la red no estaba, el disco estaba lleno. El
//                ticket esta bien; lo que fallo fue el mundo. Reintentar es
//                exactamente lo que hay que hacer.
// ---------------------------------------------------------------------------

test("un fallo transitorio se reintenta cuando pasa su espera, sin que el ticket cambie", async () => {
  fake.reset();
  fake.db.inbox = { assigned: ["2"], mentioned: [] };
  const h = home();
  const { config, deps } = conFake(h);

  let ahora = Date.parse("2026-09-17T10:00:00Z");
  const reloj = () => ahora;

  // El item REAL, el que el gestor devuelve: su huella es la que la memoria va
  // a comparar despues.
  const real = await fake.getItem("2", fake.fixtures.ctx);
  recordarOmision(real, "el gestor contesto 502 al planificar",
    { home: h, clase: "transitorio", esperaMs: 300_000, ahora: reloj });

  // Inmediatamente despues: no se reintenta, y se dice hasta cuando.
  const primera = await revisarBandeja(config, { ...deps, ahora: reloj });
  assert.equal(primera.nuevos.length, 0, "no puede reintentar antes de su espera");
  assert.equal(primera.omitidos.length, 1);
  assert.match(String(primera.omitidos[0].porque), /502|transitorio|espera/i);

  // Pasada la espera, el MISMO ticket sin cambios vuelve a entrar.
  ahora += 400_000;
  const segunda = await revisarBandeja(config, { ...deps, ahora: reloj });
  assert.equal(segunda.nuevos.length, 1, "pasada la espera tiene que reintentarse");
  assert.equal(segunda.nuevos[0].id, "2");
});

test("un rechazo permanente NO se reintenta por mas tiempo que pase", async () => {
  fake.reset();
  fake.db.inbox = { assigned: ["2"], mentioned: [] };
  const h = home();
  const { config, deps } = conFake(h);

  let ahora = Date.parse("2026-09-17T10:00:00Z");
  const reloj = () => ahora;

  const real = await fake.getItem("2", fake.fixtures.ctx);
  recordarOmision(real, "no tiene criterios de aceptacion verificables",
    { home: h, clase: "permanente", ahora: reloj });

  // Una semana, no un mes: a los 30 dias la memoria poda la entrada a
  // proposito, y el ticket recibe otra oportunidad. Eso es deliberado y esta
  // documentado — un mes despues, volver a mirar es razonable.
  ahora += 7 * 24 * 3600 * 1000;
  const r = await revisarBandeja(config, { ...deps, ahora: reloj });
  assert.equal(r.nuevos.length, 0, "un rechazo del planificador no se arregla esperando");
  assert.equal(r.omitidos.length, 1);
});

test("la espera de un transitorio crece con los reintentos, y tiene techo", async () => {
  const h = home();
  let ahora = Date.parse("2026-09-17T10:00:00Z");
  const reloj = () => ahora;
  const item = await fake.getItem("2", fake.fixtures.ctx);

  const esperas = [];
  for (let i = 0; i < 8; i++) {
    recordarOmision(item, "502 otra vez", { home: h, clase: "transitorio", ahora: reloj });
    const e = leerMemoria({ home: h }).items["2"];
    esperas.push(Date.parse(e.reintentarDespues) - ahora);
    ahora += 60_000; // solo lo justo: la huella no cambia, asi que cuenta como reintento
  }

  // Crece: martillar al gestor cada dos minutos cuando esta caido es parte del
  // problema, no del arreglo.
  assert.ok(esperas[1] > esperas[0], `no crece: ${esperas.join(", ")}`);
  assert.ok(esperas[3] > esperas[2], `no crece: ${esperas.join(", ")}`);
  // Y tiene techo: sin techo, a la decima vez el ticket queda parado meses.
  const techo = Math.max(...esperas);
  assert.ok(techo <= 6 * 3600 * 1000, `la espera llego a ${techo}ms, sin techo util`);
  assert.equal(esperas[7], techo, "una vez en el techo, se queda ahi");
});

test("un transitorio se olvida si el ticket consigue recorrido", async () => {
  fake.reset();
  fake.db.inbox = { assigned: ["2"], mentioned: [] };
  const h = home();
  const { config, deps } = conFake(h);
  const reloj = () => Date.parse("2026-09-17T10:00:00Z");

  const real = await fake.getItem("2", fake.fixtures.ctx);
  recordarOmision(real, "502", { home: h, clase: "transitorio", ahora: reloj });
  createRun({
    item: { id: "2", title: "t", level: "story", url: "u", provider: "fake" },
    repoScope: ["app"],
    tasks: [{ id: "T1", repo: "app", title: "t", acceptance: "c", targetFiles: ["a.mjs"],
              testFiles: ["a.test.mjs"], tier: "small", dependsOn: [], dependencyKind: "hard" }],
  }, { home: h });

  const r = await revisarBandeja(config, { ...deps, ahora: reloj });
  assert.equal(r.nuevos.length, 0);
  assert.equal(r.vistos.length, 1);
  assert.ok(!leerMemoria({ home: h }).items["2"], "el recorrido gana sobre la espera vieja");
});
