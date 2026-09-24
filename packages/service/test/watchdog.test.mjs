// El watchdog del proceso padre.
//
// EL FALLO QUE CUBRE, y es el motivo de que exista habiendo ya un cierre en
// `RunEvent::Exit` del escritorio: ese cierre solo corre si el shell llega a
// correrlo. Con SIGKILL, con un cuelgue del compositor o con un apagado forzado
// del sistema, el shell desaparece sin ejecutar nada y el servicio queda vivo —
// escuchando, con el lock del home tomado y con el token de sesion valido. El
// sintoma que produce es de los peores: la proxima vez que el operador abre la
// aplicacion, el servicio nuevo no arranca porque el home sigue bloqueado por
// un proceso del que ya nadie se acuerda.
//
// POR QUE `process.kill(pid, 0)` Y NO UN PING POR EL CANAL. Un canal se puede
// quedar abierto contra un padre zombi. La senial 0 pregunta al sistema
// operativo, que es el unico que sabe la verdad.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

import { vigilarAlPadre } from "../src/watchdog.mjs";
import { homeTemporal, TOKEN } from "./ayuda.mjs";

const BIN = new URL("../bin/noxloop-service.mjs", import.meta.url).pathname;

test("mientras el padre vive, el watchdog no hace nada", async () => {
  let muerto = false;
  const v = vigilarAlPadre({ pid: process.pid, intervaloMs: 5, vive: () => true, alMorir: () => { muerto = true; } });
  await new Promise((r) => setTimeout(r, 40));
  v.detener();
  assert.equal(muerto, false);
});

test("cuando el padre desaparece, el watchdog lo avisa una sola vez", async () => {
  let veces = 0;
  const v = vigilarAlPadre({ pid: 999999, intervaloMs: 5, vive: () => false, alMorir: () => { veces++; } });
  await new Promise((r) => setTimeout(r, 40));
  v.detener();
  assert.equal(veces, 1, "avisar N veces apaga el servicio N veces y ensucia el cierre");
});

test("detener() desarma el watchdog: un cierre limpio no tiene que competir con el", async () => {
  let muerto = false;
  const v = vigilarAlPadre({ pid: 999999, intervaloMs: 5, vive: () => false, alMorir: () => { muerto = true; } });
  v.detener();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(muerto, false);
});

test("EL CASO REAL: matado el padre con SIGKILL, el servicio sale solo y con codigo 0", async () => {
  // Un padre de mentira que no hace nada mas que existir, para poder matarlo
  // sin llevarse por delante al runner de tests.
  const padre = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  const servicio = spawn(
    process.execPath,
    [BIN, "--home", homeTemporal(), "--token", TOKEN, "--parent-pid", String(padre.pid), "--watchdog-ms", "50"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  await new Promise((resolve, reject) => {
    servicio.stdout.setEncoding("utf8");
    servicio.stdout.on("data", (d) => { if (d.includes("NOXLOOP_READY")) resolve(null); });
    servicio.on("exit", (c) => reject(new Error(`el servicio murio antes de estar listo (${c})`)));
    setTimeout(() => reject(new Error("el servicio no estuvo listo a tiempo")), 10000);
  });

  padre.kill("SIGKILL");
  const codigo = await new Promise((resolve) => {
    servicio.on("exit", resolve);
    setTimeout(() => { servicio.kill("SIGKILL"); resolve("no salio solo"); }, 8000);
  });

  assert.equal(codigo, 0, "quedarse huerfano no es un error del servicio: es su padre el que se fue");
});
