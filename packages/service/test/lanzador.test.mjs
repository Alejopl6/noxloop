// El lanzador: el servicio arranca el motor como subproceso, con cola por
// proyecto, y sigue la autonomia del proyecto.
//
// POR QUE EL SPAWN SE INYECTA. Lo que se prueba aqui es la politica —que
// comando, con que argumentos, con que entorno, cuantos a la vez, que pasa al
// terminar— y no que Node sepa lanzar procesos. Con procesos de verdad cada
// test tardaria lo que tarda el motor y los fallos serian carreras. El proceso
// de verdad tiene su propio test (`lanzar-motor-real.test.mjs`).
//
// LO QUE MAS IMPORTA DE ESTE ARCHIVO es el entorno: el secreto del gestor va
// en el entorno del subproceso y NO en sus argumentos (principio IX), y el
// entorno es el declarado y no el del servicio heredado.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { crearLanzador } from "../src/lanzador.mjs";
import { homeTemporal } from "./ayuda.mjs";
import { runEnDisco } from "./ayuda-motor.mjs";

const SECRETO = "zqx7-SECRETO-DEL-GESTOR-QUE-NO-VA-POR-ARGV-81f";

/** Un spawn de mentira: registra cada llamada y deja al test decidir cuando termina. */
function spawnFalso() {
  /** @type {Array<{comando: string, args: string[], opciones: any, hijo: any, terminar: (code: number, salida?: any, err?: string) => void}>} */
  const llamadas = [];
  const spawn = (comando, args, opciones) => {
    const hijo = /** @type {any} */ (new EventEmitter());
    hijo.stdout = new PassThrough();
    hijo.stderr = new PassThrough();
    hijo.matado = null;
    hijo.kill = (senial) => {
      hijo.matado = senial ?? "SIGTERM";
      setImmediate(() => hijo.emit("close", null, hijo.matado));
      return true;
    };
    const llamada = {
      comando,
      args,
      opciones,
      hijo,
      terminar: (code, salida = { ok: true }, err = "") => {
        if (salida !== undefined) hijo.stdout.end(JSON.stringify(salida, null, 2) + "\n");
        else hijo.stdout.end();
        hijo.stderr.end(err);
        setImmediate(() => hijo.emit("close", code, null));
      },
    };
    llamadas.push(llamada);
    return hijo;
  };
  return { spawn, llamadas };
}

const espera = (ms = 5) => new Promise((r) => setTimeout(r, ms));

/** Espera hasta que se cumpla, o falla diciendo que esperaba. */
async function hasta(cond, que, ms = 2000) {
  const fin = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fin) assert.fail(`no paso a tiempo: ${que}`);
    await espera();
  }
}

function montar(extra = {}) {
  const home = homeTemporal();
  const falso = spawnFalso();
  const eventos = [];
  const lanzador = crearLanzador({
    home,
    spawn: falso.spawn,
    binDelMotor: "/opt/noxloop/engine/bin/noxloop.mjs",
    nodo: "/usr/bin/node",
    entornoBase: { PATH: "/usr/bin:/bin", HOME: "/home/operador" },
    emitir: (tipo, datos, extra2) => eventos.push({ tipo, datos, project_id: extra2?.project_id ?? null }),
    intervaloMs: 0,
    ...extra,
  });
  const preparacion = { rutaConfig: "/h/motor/prj-1.config.json", secretos: { GITHUB_TOKEN: SECRETO } };
  const pedido = (itemId, mas = {}) => ({
    projectId: "prj-1",
    itemId,
    autonomia: "L2",
    maxParalelo: 2,
    preparado: preparacion,
    preparar: async () => preparacion,
    ...mas,
  });
  return { home, falso, eventos, lanzador, pedido };
}

test("L2: planifica y ejecuta encadenados, con la opcion `--project` y el home del servicio", async (t) => {
  const { home, falso, lanzador, pedido } = montar();
  t.after(() => lanzador.detener());

  const r = await lanzador.lanzar(pedido("2"));
  assert.equal(r.codigo, 202);
  assert.deepEqual(r.run, { itemId: "2", estado: "planificando", posicion: null });

  await hasta(() => falso.llamadas.length === 1, "que se lance `plan`");
  const plan = falso.llamadas[0];
  assert.equal(plan.comando, "/usr/bin/node");
  assert.deepEqual(plan.args, [
    "/opt/noxloop/engine/bin/noxloop.mjs",
    "plan",
    "2",
    "--config",
    "/h/motor/prj-1.config.json",
    "--project",
    "prj-1",
  ]);
  assert.equal(plan.opciones.env.NOXLOOP_HOME, home, "el motor tiene que escribir en el home que el servicio lee");

  plan.terminar(0, { ok: true, tasks: 1 });
  await hasta(() => falso.llamadas.length === 2, "que tras el plan se lance `run` (L2)");
  assert.deepEqual(falso.llamadas[1].args.slice(1, 3), ["run", "2"]);
  assert.equal(lanzador.estado("2").estado, "corriendo");

  falso.llamadas[1].terminar(0, { pr: "https://forge.test/pr/1", blocked: [] });
  await hasta(() => lanzador.estado("2").estado === "terminado", "que el run termine");
});

test("PRINCIPIO IX: el secreto va en el entorno del subproceso, nunca en argv, y el entorno es el declarado", async (t) => {
  process.env.NOXLOOP_VARIABLE_DEL_SERVICIO = "no-tiene-que-heredarse";
  t.after(() => delete process.env.NOXLOOP_VARIABLE_DEL_SERVICIO);
  const { falso, lanzador, pedido } = montar();
  t.after(() => lanzador.detener());

  await lanzador.lanzar(pedido("2"));
  await hasta(() => falso.llamadas.length === 1, "el lanzamiento");
  const { comando, args, opciones } = falso.llamadas[0];

  assert.ok(![comando, ...args].some((a) => a.includes(SECRETO)), "el secreto aparecio en la linea de comandos");
  assert.equal(opciones.env.GITHUB_TOKEN, SECRETO, "el motor no recibiria la credencial del gestor");
  assert.equal(
    opciones.env.NOXLOOP_VARIABLE_DEL_SERVICIO,
    undefined,
    "el subproceso heredo el entorno del servicio: el grant autorizo una credencial y recibio todas",
  );
  assert.deepEqual(Object.keys(opciones.env).sort(), ["GITHUB_TOKEN", "HOME", "NOXLOOP_HOME", "PATH"]);
});

// DESDE LA APP INSTALADA el servicio hereda el PATH minimo de una app GUI de
// macOS (`/usr/bin:/bin`), y el motor corre el gate (`npm test`) y `gh` en su
// propio proceso: sin ampliar el PATH no encuentra ninguno de los dos.
test("el motor recibe el PATH ampliado: con el PATH de una app GUI igual encuentra npm y gh de Homebrew", async (t) => {
  const { falso, lanzador, pedido } = montar();
  t.after(() => lanzador.detener());
  await lanzador.lanzar(pedido("2"));
  await hasta(() => falso.llamadas.length === 1, "el plan");
  const path = falso.llamadas[0].opciones.env.PATH.split(":");
  assert.equal(path[0], "/usr/bin", "el PATH recibido va primero");
  assert.ok(path.includes("/opt/homebrew/bin"), `el motor no vera npm ni gh de Homebrew: ${path.join(":")}`);
});

test("L0/L1: planifica y PARA en `plan_listo`; aprobar lanza `run`", async (t) => {
  const { falso, lanzador, pedido } = montar();
  t.after(() => lanzador.detener());

  await lanzador.lanzar(pedido("2", { autonomia: "L1" }));
  await hasta(() => falso.llamadas.length === 1, "el plan");
  falso.llamadas[0].terminar(0, { ok: true, tasks: 3 });
  await hasta(() => lanzador.estado("2").estado === "plan_listo", "que pare en plan_listo");
  await espera(20);
  assert.equal(falso.llamadas.length, 1, "en L1 el motor no puede ejecutar sin que alguien apruebe el plan");

  const r = await lanzador.aprobar(pedido("2"));
  assert.equal(r.codigo, 202);
  await hasta(() => falso.llamadas.length === 2, "que aprobar lance `run`");
  assert.deepEqual(falso.llamadas[1].args.slice(1, 3), ["run", "2"]);
  assert.ok(!falso.llamadas[1].args.includes("--project"), "`run` no crea el run: `--project` solo va en `plan`");
});

test("la cola: con el tope lleno el run queda `en_cola` con su posicion, y arranca al liberarse", async (t) => {
  const { falso, lanzador, pedido } = montar();
  t.after(() => lanzador.detener());

  await lanzador.lanzar(pedido("a", { maxParalelo: 1 }));
  const b = await lanzador.lanzar(pedido("b", { maxParalelo: 1 }));
  const c = await lanzador.lanzar(pedido("c", { maxParalelo: 1 }));
  assert.deepEqual(b.run, { itemId: "b", estado: "en_cola", posicion: 1 });
  assert.deepEqual(c.run, { itemId: "c", estado: "en_cola", posicion: 2 });

  // Otro proyecto no espera la cola de este: el tope es POR proyecto.
  await lanzador.lanzar(pedido("x", { projectId: "prj-2", maxParalelo: 1 }));
  await hasta(() => falso.llamadas.length === 2, "que el otro proyecto arranque sin esperar");

  falso.llamadas[0].terminar(1, { ok: false, reason: "el gestor no contesto" });
  await hasta(() => lanzador.estado("b").estado === "planificando", "que `b` salga de la cola");
  assert.equal(lanzador.estado("c").posicion, 1, "`c` sube un puesto");
});

test("idempotencia: el mismo ticket dos veces devuelve el run existente y no lanza otro", async (t) => {
  const { home, falso, lanzador, pedido } = montar();
  t.after(() => lanzador.detener());

  const primero = await lanzador.lanzar(pedido("2"));
  const segundo = await lanzador.lanzar(pedido("2"));
  assert.equal(primero.codigo, 202);
  assert.equal(segundo.codigo, 200);
  assert.equal(segundo.run.itemId, "2");
  await espera(20);
  assert.equal(falso.llamadas.length, 1, "el segundo clic lanzo un segundo motor sobre el mismo ticket");

  // Y un run que ya esta en disco —de otra sesion, o de antes de reiniciar—
  // tambien cuenta como existente.
  runEnDisco(home, "9", { item: { id: "9", title: "t", pr: "https://forge.test/pr/9" } });
  const enDisco = await lanzador.lanzar(pedido("9"));
  assert.equal(enDisco.codigo, 200);
  assert.equal(enDisco.run.estado, "pr_abierto");
});

test("un ticket sin criterios: `necesita_criterios` con la pregunta textual del planificador", async (t) => {
  const { falso, lanzador, pedido } = montar();
  t.after(() => lanzador.detener());

  await lanzador.lanzar(pedido("2"));
  await hasta(() => falso.llamadas.length === 1, "el plan");
  falso.llamadas[0].terminar(1, {
    ok: false,
    reason: "el ticket no tiene criterios de aceptacion verificables",
    question: "¿Que tiene que pasar para dar por buena la exportacion?",
  });
  await hasta(() => lanzador.estado("2").estado === "necesita_criterios", "el estado");
  assert.equal(lanzador.estado("2").detalle, "¿Que tiene que pasar para dar por buena la exportacion?");
  assert.equal(falso.llamadas.length, 1, "no se ejecuta un plan que no existe");
});

// Medido en el primer run real: la tarjeta decia «el plan no valida» y nada
// mas. El motor SI devolvia cual era el problema (`$.notes: no esta declarado`)
// y se tiraba al pasar al estado del run: el operador no tenia por donde seguir.
test("un plan que no valida guarda CADA problema en la causa, no solo «el plan no valida»", async (t) => {
  const { falso, lanzador, pedido } = montar();
  t.after(() => lanzador.detener());

  await lanzador.lanzar(pedido("2"));
  await hasta(() => falso.llamadas.length === 1, "el plan");
  falso.llamadas[0].terminar(1, { ok: false, reason: "el plan no valida", problems: ["$.notes: no esta declarado en el esquema"] });
  await hasta(() => lanzador.estado("2").estado === "fallido", "el fallo");
  assert.match(lanzador.estado("2").detalle, /\$\.notes: no esta declarado en el esquema/);
});

test("un fallo guarda la causa; si la causa trae el secreto, el secreto NO se guarda", async (t) => {
  const { falso, lanzador, pedido } = montar();
  t.after(() => lanzador.detener());

  await lanzador.lanzar(pedido("2"));
  await hasta(() => falso.llamadas.length === 1, "el plan");
  falso.llamadas[0].terminar(1, undefined, `error: 401 con el token ${SECRETO}\n`);
  await hasta(() => lanzador.estado("2").estado === "fallido", "el fallo");
  const detalle = lanzador.estado("2").detalle;
  assert.ok(detalle.length > 10, "un fallo sin causa deja al operador adivinando");
  assert.ok(!detalle.includes(SECRETO), "la causa del fallo llevaba el valor de la credencial");
  assert.match(detalle, /GITHUB_TOKEN/, "tiene que decir QUE variable aparecio, sin su valor");
});

test("reintentar: con run en disco retoma (`resume`), sin run vuelve a planificar", async (t) => {
  const { home, falso, lanzador, pedido } = montar();
  t.after(() => lanzador.detener());

  runEnDisco(home, "5", { tasks: [{ id: "T001", status: "blocked", lastFailure: "gate rojo" }] });
  await lanzador.reintentar(pedido("5"));
  await hasta(() => falso.llamadas.length === 1, "el resume");
  assert.deepEqual(falso.llamadas[0].args.slice(1, 3), ["resume", "5"]);

  await lanzador.reintentar(pedido("6"));
  await hasta(() => falso.llamadas.length === 2, "el replan");
  assert.deepEqual(falso.llamadas[1].args.slice(1, 3), ["plan", "6"]);
});

test("eventos: `run.cambio` en cada transicion y `board.invalidado` con el proyecto", async (t) => {
  const { falso, lanzador, pedido, eventos } = montar();
  t.after(() => lanzador.detener());

  await lanzador.lanzar(pedido("2", { autonomia: "L0" }));
  await hasta(() => falso.llamadas.length === 1, "el plan");
  falso.llamadas[0].terminar(0, { ok: true });
  await hasta(() => lanzador.estado("2").estado === "plan_listo", "plan_listo");

  const cambios = eventos.filter((e) => e.tipo === "run.cambio").map((e) => e.datos.estado);
  assert.deepEqual(cambios, ["planificando", "plan_listo"]);
  for (const e of eventos.filter((x) => x.tipo === "run.cambio")) {
    assert.deepEqual(Object.keys(e.datos).sort(), ["estado", "itemId", "projectId"]);
    assert.equal(e.project_id, "prj-1");
  }
  assert.ok(
    eventos.some((e) => e.tipo === "board.invalidado" && e.datos.projectId === "prj-1"),
    "sin `board.invalidado` la interfaz no sabe que tiene que volver a pedir el board",
  );
});

test("detener mata los subprocesos: un run no sobrevive al servicio que lo lanzo", async () => {
  const { falso, lanzador, pedido } = montar();
  await lanzador.lanzar(pedido("2"));
  await hasta(() => falso.llamadas.length === 1, "el plan");
  await lanzador.detener();
  assert.equal(falso.llamadas[0].hijo.matado, "SIGTERM");
  assert.equal(lanzador.estado("2").estado, "interrumpido");
});

// ---------------------------------------------------------------------------
// LA COLA GLOBAL (spec 005, FR-006)
// ---------------------------------------------------------------------------
//
// El limite es de la MAQUINA, no del proyecto: cuatro proyectos con tope 2
// cada uno son ocho agentes a la vez sobre el mismo portatil y la misma cuota
// del modelo. El tope por proyecto sigue valiendo ademas (un proyecto no se
// come el limite entero si su config dice 1).

test("cola global: con limite 2 y cuatro pedidos de dos proyectos, 2 corren y 2 esperan con su posicion", async (t) => {
  const { falso, lanzador, pedido } = montar({ limite: () => 2 });
  t.after(() => lanzador.detener());

  await lanzador.lanzar(pedido("a", { maxParalelo: 5 }));
  await lanzador.lanzar(pedido("b", { projectId: "prj-2", maxParalelo: 5 }));
  const c = await lanzador.lanzar(pedido("c", { maxParalelo: 5 }));
  const d = await lanzador.lanzar(pedido("d", { projectId: "prj-2", maxParalelo: 5 }));
  await hasta(() => falso.llamadas.length === 2, "los dos primeros");
  await espera(20);
  assert.equal(falso.llamadas.length, 2, "el limite global es 2: no puede haber un tercer motor");
  assert.deepEqual(c.run, { itemId: "c", estado: "en_cola", posicion: 1 });
  assert.deepEqual(d.run, { itemId: "d", estado: "en_cola", posicion: 2 });

  const cola = lanzador.cola();
  assert.equal(cola.limite, 2);
  assert.deepEqual(cola.corriendo.map((r) => r.itemId).sort(), ["a", "b"]);
  assert.deepEqual(cola.esperando, [
    { itemId: "c", projectId: "prj-1", posicion: 1 },
    { itemId: "d", projectId: "prj-2", posicion: 2 },
  ]);
});

test("cola global: reordenar lo que espera hace que el movido arranque antes", async (t) => {
  const { falso, lanzador, pedido, eventos } = montar({ limite: () => 2 });
  t.after(() => lanzador.detener());

  for (const id of ["a", "b", "c", "d"]) await lanzador.lanzar(pedido(id, { maxParalelo: 5 }));
  await hasta(() => falso.llamadas.length === 2, "los dos primeros");

  eventos.length = 0;
  const r = lanzador.reordenar(["d"]);
  assert.deepEqual(
    r.esperando.map((x) => [x.itemId, x.posicion]),
    [
      ["d", 1],
      ["c", 2],
    ],
    "lo no listado conserva su orden relativo, detras de lo listado",
  );
  assert.ok(eventos.some((e) => e.tipo === "run.cambio" && e.datos.itemId === "d"), "la interfaz tiene que enterarse");
  assert.ok(eventos.some((e) => e.tipo === "board.invalidado"));

  falso.llamadas[0].terminar(1, { ok: false, reason: "x" });
  await hasta(() => falso.llamadas.length === 3, "que se libere un hueco");
  assert.deepEqual(falso.llamadas[2].args.slice(1, 3), ["plan", "d"], "arranca el movido, no el que llego antes");
  assert.equal(lanzador.estado("c").posicion, 1);
});

test("cola global: reordenar ignora ids que no esperan (corriendo o desconocidos) sin fallar", async (t) => {
  const { lanzador, pedido } = montar({ limite: () => 1 });
  t.after(() => lanzador.detener());
  for (const id of ["a", "b", "c"]) await lanzador.lanzar(pedido(id, { maxParalelo: 5 }));
  const r = lanzador.reordenar(["zzz", "a", "c"]);
  assert.deepEqual(r.esperando.map((x) => x.itemId), ["c", "b"]);
});

test("cola global: el tope POR proyecto sigue valiendo, y no bloquea a los de otro proyecto", async (t) => {
  const { falso, lanzador, pedido } = montar({ limite: () => 3 });
  t.after(() => lanzador.detener());

  await lanzador.lanzar(pedido("a1", { maxParalelo: 1 }));
  const a2 = await lanzador.lanzar(pedido("a2", { maxParalelo: 1 }));
  await lanzador.lanzar(pedido("b1", { projectId: "prj-2", maxParalelo: 1 }));
  await hasta(() => falso.llamadas.length === 2, "a1 y b1");
  assert.equal(a2.run.estado, "en_cola", "prj-1 tiene tope 1 aunque el global deje 3");
  assert.equal(lanzador.estado("b1").estado, "planificando", "b1 adelanta a a2: a2 espera por SU proyecto, no por el limite");
});

test("cola global: subir el limite arranca lo que esperaba sin esperar a que termine nadie", async (t) => {
  let limite = 1;
  const { falso, lanzador, pedido } = montar({ limite: () => limite });
  t.after(() => lanzador.detener());

  for (const id of ["a", "b", "c"]) await lanzador.lanzar(pedido(id, { maxParalelo: 5 }));
  await hasta(() => falso.llamadas.length === 1, "uno");
  limite = 3;
  lanzador.revisar();
  await hasta(() => falso.llamadas.length === 3, "que arranquen los que esperaban");
  assert.equal(lanzador.cola().esperando.length, 0);
});

test("cola global: sin limite inyectado, el defecto es 3", async (t) => {
  const { falso, lanzador, pedido } = montar();
  t.after(() => lanzador.detener());
  for (const id of ["a", "b", "c", "d"]) {
    await lanzador.lanzar(pedido(id, { projectId: `prj-${id}`, maxParalelo: 5 }));
  }
  await hasta(() => falso.llamadas.length === 3, "tres");
  await espera(20);
  assert.equal(falso.llamadas.length, 3);
  assert.equal(lanzador.cola().limite, 3);
});
