// La carrera del lock, con dos procesos DE VERDAD.
//
// POR QUE ESTE ARCHIVO EXISTE, con su medicion. `acquire` decidia con
// `existsSync` y escribia despues. Entre esas dos operaciones hay una ventana, y
// dos daemons que arrancan juntos caen los dos adentro: se toman el mismo lock y
// recorren la misma bandeja. Medido con dos procesos reales sobre el mismo home:
// **16 de 25 arranques simultaneos duplicaban**.
//
// El test unitario anterior no podia verlo: un solo proceso llamando dos veces a
// `acquire` ve el archivo ya escrito por su primera llamada. La carrera solo
// existe entre procesos, asi que el test tiene que usar procesos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { acquire, inspect } from "../src/lock.mjs";

const RAIZ = new URL("../", import.meta.url).pathname;

/**
 * Un programa que intenta tomar el lock EN UN INSTANTE ACORDADO y lo retiene un
 * rato antes de salir.
 *
 * Las dos cosas son necesarias para que la carrera exista de verdad:
 *   - el instante acordado, porque si uno arranca despues del otro no hay
 *     simultaneidad y el test no prueba nada;
 *   - retener, porque si el primero YA SALIO cuando el segundo pregunta, su lock
 *     esta legitimamente huerfano y el segundo lo recupera con razon. La primera
 *     version de este test usaba `spawnSync` —que es sincronico— y medía
 *     exactamente eso: 25 de 25 "duplicados" que en realidad eran 25 de 25
 *     recuperaciones correctas.
 */
const TOMADOR = `
import { acquire } from "${join(RAIZ, "src/lock.mjs")}";
const [, , recurso, home, desde] = process.argv;
while (Date.now() < Number(desde)) { /* espera activa: el sleep no es preciso */ }
const r = acquire(recurso, { home });
process.stdout.write(r.ok ? "TOMADO" : "NO");
// Retiene: si saliera ya, su lock quedaria huerfano y el otro lo recuperaria
// con razon, que no es la carrera que se quiere medir.
const hasta = Date.now() + 200;
while (Date.now() < hasta) { /* retiene */ }
`;

test("dos procesos simultaneos: exactamente UNO se lleva el lock, 20 de 20 veces", async () => {
  const dir = mkdtempSync(join(tmpdir(), "noxloop-carrera-"));
  const programa = join(dir, "tomador.mjs");
  writeFileSync(programa, TOMADOR);

  let duplicados = 0;
  let ninguno = 0;
  const VUELTAS = 20;

  for (let i = 0; i < VUELTAS; i++) {
    const home = join(dir, `home-${i}`);
    mkdirSync(home, { recursive: true });

    // Los dos apuntan al MISMO instante, y se lanzan asincronicos para que los
    // dos esten vivos y esperando cuando llegue.
    const desde = Date.now() + 300;
    const [a, b] = await Promise.all([
      correr(programa, ["run-1", home, String(desde)]),
      correr(programa, ["run-1", home, String(desde)]),
    ]);

    const tomaron = [a, b].filter((s) => s.trim() === "TOMADO").length;
    if (tomaron > 1) duplicados++;
    if (tomaron === 0) ninguno++;
  }

  assert.equal(duplicados, 0, `${duplicados} de ${VUELTAS} arranques tomaron el lock DOS veces`);
  assert.equal(ninguno, 0, `${ninguno} de ${VUELTAS} arranques no se lo llevo nadie`);
});

function correr(programa, args) {
  return new Promise((resolve, reject) => {
    const p = spawn("node", [programa, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let salida = "";
    p.stdout.on("data", (d) => { salida += d; });
    p.on("error", reject);
    p.on("close", () => resolve(salida));
  });
}

test("el ganador es el que escribio: el perdedor informa el pid ajeno", () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-carrera2-"));
  const a = acquire("run-1", { home });
  assert.equal(a.ok, true);
  const b = acquire("run-1", { home });
  assert.equal(b.ok, false);
  assert.equal(b.heldBy.pid, process.pid);
  a.release();
});

test("un lock de OTRA maquina no se roba: se informa y se respeta", () => {
  // El fallo que evita: `lock.mjs` trataba como huerfano cualquier lock cuyo
  // `host` no fuera el propio, y se lo quedaba. Con un NOXLOOP_HOME compartido
  // —un volumen montado en dos maquinas, NFS— corren dos daemons sobre la misma
  // bandeja y ninguno de los dos se entera.
  const home = mkdtempSync(join(tmpdir(), "noxloop-carrera3-"));
  mkdirSync(join(home, "locks"), { recursive: true });
  writeFileSync(join(home, "locks", "run-1.json"), JSON.stringify({
    pid: 4242, host: "otra-maquina", token: "x", resource: "run-1",
    acquiredAt: new Date().toISOString(),
  }));

  const r = acquire("run-1", { home });
  assert.equal(r.ok, false, "se robo el lock de otra maquina");
  assert.equal(r.heldBy.host, "otra-maquina");
  assert.match(r.reason || "", /otra maquina|host/i, "tiene que decir por que no lo toma");
});

test("un lock viejo de otra maquina SI se recupera: si no, queda trabado para siempre", () => {
  // La contracara: respetar un lock ajeno para siempre significa que si esa
  // maquina se murio, el recurso queda trabado y nadie lo puede destrabar salvo
  // borrando el archivo a mano. Se recupera por antiguedad, que es lo unico
  // observable desde aca.
  const home = mkdtempSync(join(tmpdir(), "noxloop-carrera4-"));
  mkdirSync(join(home, "locks"), { recursive: true });
  const hace3dias = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  writeFileSync(join(home, "locks", "run-1.json"), JSON.stringify({
    pid: 4242, host: "otra-maquina", token: "x", resource: "run-1", acquiredAt: hace3dias,
  }));
  const r = acquire("run-1", { home, maxEdadMs: 24 * 3600 * 1000 });
  assert.equal(r.ok, true);
  assert.equal(r.recovered, true);
  r.release();
});

test("un pid reusado no traba el recurso para siempre", () => {
  // `process.kill(pid, 0)` dice "vivo" si el sistema reasigno ese pid a
  // cualquier otro programa. Sin un techo de antiguedad, el lock de un daemon
  // muerto cuyo pid se reciclo parece tomado para siempre, y el mensaje culpa a
  // un pid que no es un daemon.
  const home = mkdtempSync(join(tmpdir(), "noxloop-carrera5-"));
  mkdirSync(join(home, "locks"), { recursive: true });
  writeFileSync(join(home, "locks", "run-1.json"), JSON.stringify({
    pid: process.pid, host: hostname(), token: "viejo",
    resource: "run-1", acquiredAt: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString(),
  }));
  const r = acquire("run-1", { home, maxEdadMs: 24 * 3600 * 1000 });
  assert.equal(r.ok, true, "un lock de hace ocho dias no puede seguir en pie");
  r.release();
});

test("inspect dice si el que lo tiene esta vivo, sin intentar tomarlo", () => {
  const home = mkdtempSync(join(tmpdir(), "noxloop-carrera6-"));
  assert.equal(inspect("run-1", { home }), null);
  const a = acquire("run-1", { home });
  const i = inspect("run-1", { home });
  assert.equal(i.pid, process.pid);
  assert.equal(i.alive, true);
  a.release();
});
