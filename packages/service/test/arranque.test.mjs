// El arranque del servicio de control.
//
// POR QUE 127.0.0.1 Y NO 0.0.0.0. Este servicio es el unico escritor del
// almacen: enumera proyectos, credenciales por huella y la bandeja entera.
// Escuchar en 0.0.0.0 publica todo eso en la red local sin que nadie lo pida,
// y en una cafeteria eso es cualquier maquina de la wifi. Hay un test que mira
// la direccion real del socket, no la que dice la configuracion.
//
// POR QUE LA LINEA DE STDOUT SE PRUEBA LETRA POR LETRA. El shell de escritorio
// arranca este proceso como sidecar y aprende la URL parseando esa linea. Si
// cambia el formato, la aplicacion abre una ventana que no encuentra a su
// propio servicio y el sintoma es una pantalla vacia sin ningun error.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { conServicio, homeTemporal, pedir, TOKEN } from "./ayuda.mjs";

const BIN = new URL("../bin/noxloop-service.mjs", import.meta.url).pathname;

/**
 * Levanta el binario de verdad y espera su linea de listo. Devuelve tambien el
 * proceso para poder matarlo.
 */
function levantarProceso(args, ms = 10000) {
  const hijo = spawn(process.execPath, [BIN, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let salida = "";
  let err = "";
  hijo.stderr.setEncoding("utf8");
  hijo.stderr.on("data", (d) => { err += d; });
  return new Promise((resolve, reject) => {
    const limite = setTimeout(() => reject(new Error(`no dijo estar listo en ${ms}ms: ${salida}${err}`)), ms);
    hijo.stdout.setEncoding("utf8");
    hijo.stdout.on("data", (d) => {
      salida += d;
      const linea = salida.split("\n").find((l) => l.startsWith("NOXLOOP_READY"));
      if (linea) {
        clearTimeout(limite);
        resolve({ hijo, linea, salida: () => salida, err: () => err });
      }
    });
    hijo.on("exit", (codigo) => {
      clearTimeout(limite);
      reject(new Error(`murio con codigo ${codigo} antes de estar listo: ${err}`));
    });
  });
}

/** Huella del arbol: ruta, tamanio y mtime de cada archivo. */
function huella(dir, excluir = [], acc = {}) {
  for (const entrada of readdirSync(dir)) {
    const p = join(dir, entrada);
    if (excluir.includes(p)) continue;
    const st = statSync(p);
    if (st.isDirectory()) huella(p, excluir, acc);
    else acc[p] = `${st.size}:${st.mtimeMs}`;
  }
  return acc;
}

test("escucha SOLO en loopback: el almacen no se publica en la red local", async () => {
  await conServicio({}, (svc) => {
    assert.equal(svc.direccion.address, "127.0.0.1");
    assert.match(svc.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  });
});

test("sin --port toma un puerto efimero: dos servicios no se pelean el mismo", async () => {
  await conServicio({}, async (uno) => {
    await conServicio({}, (otro) => {
      assert.notEqual(uno.puerto, otro.puerto);
      assert.ok(uno.puerto > 0 && otro.puerto > 0);
    });
  });
});

test("--port fija el puerto, que es lo que hace reproducible un test de la interfaz", async () => {
  // Se pide uno efimero primero y se reusa su numero: elegir uno a mano es como
  // se consigue un test que falla solo en la maquina que ya lo tenia ocupado.
  const libre = await conServicio({}, (svc) => svc.puerto);
  await conServicio({ port: libre }, (svc) => {
    assert.equal(svc.puerto, libre);
  });
});

test("el binario imprime NOXLOOP_READY con la URL, que es lo que parsea el escritorio", async () => {
  const { hijo, linea } = await levantarProceso(["--home", homeTemporal(), "--token", TOKEN]);
  try {
    assert.match(linea, /^NOXLOOP_READY http:\/\/127\.0\.0\.1:\d+$/);
    const url = linea.slice("NOXLOOP_READY ".length);
    const r = await fetch(`${url}/v1/health`);
    assert.equal(r.status, 200, "la URL que anuncia tiene que contestar");
  } finally {
    hijo.kill("SIGTERM");
  }
});

test("SIGTERM apaga limpio: sale con 0 y suelta el lock del home", async () => {
  const home = homeTemporal();
  const { hijo } = await levantarProceso(["--home", home, "--token", TOKEN]);
  const codigo = await new Promise((resolve) => {
    hijo.on("exit", resolve);
    hijo.kill("SIGTERM");
  });
  assert.equal(codigo, 0, "un cierre pedido no es una caida");

  // Si el lock quedo puesto, el siguiente arranque sobre el mismo home no entra
  // y el operador tiene que borrar un archivo a mano para volver a abrir la app.
  const { hijo: segundo } = await levantarProceso(["--home", home, "--token", TOKEN]);
  segundo.kill("SIGTERM");
});

/** Corre el binario hasta que termina y devuelve como termino. */
function correrHastaSalir(args, ms = 10000) {
  const hijo = spawn(process.execPath, [BIN, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  hijo.stderr.setEncoding("utf8");
  hijo.stderr.on("data", (d) => { err += d; });
  return new Promise((resolve, reject) => {
    const limite = setTimeout(() => { hijo.kill("SIGKILL"); reject(new Error("no termino")); }, ms);
    hijo.on("exit", (codigo) => {
      clearTimeout(limite);
      resolve({ codigo, err });
    });
  });
}

test("una bandera numerica mal escrita se dice nombrandola, no se ignora", async () => {
  // EL FALLO QUE EVITA. `Number("sesenta")` es NaN y `Number(true)` es 1: sin
  // comprobarlo, `--port sesenta` y `--port` a secas arrancan el servicio en
  // algun puerto que nadie pidio, o mueren con un EACCES que no menciona la
  // bandera. El operador mira la bandera que escribio y la ve bien.
  const malos = [
    ["--port", "sesenta"],
    ["--port"],
    ["--parent-pid", "el-padre"],
  ];
  for (const bandera of malos) {
    const { codigo, err } = await correrHastaSalir(["--home", homeTemporal(), "--token", TOKEN, ...bandera]);
    assert.equal(codigo, 2, `${bandera.join(" ")} tendria que fallar diciendo por que`);
    assert.match(err, new RegExp(bandera[0].replace(/-/g, "\\-")), "el mensaje tiene que nombrar la bandera");
  }
});

test("--origen sin valor tampoco pasa: una allowlist con basura adentro no bloquea, confunde", async () => {
  const { codigo, err } = await correrHastaSalir(["--home", homeTemporal(), "--token", TOKEN, "--origen"]);
  assert.equal(codigo, 2);
  assert.match(err, /--origen/);
});

test("EL INVARIANTE DEL PRINCIPIO VIII: no escribe un solo byte fuera de su home", async () => {
  const raiz = homeTemporal("noxloop-svc-raiz-");
  const home = join(raiz, "home");
  const vecino = join(raiz, "vecino");
  mkdirSync(vecino, { recursive: true });
  writeFileSync(join(vecino, "no-me-toques.txt"), "el servicio no es duenio de esto\n");

  const antes = huella(raiz, [home]);
  await conServicio({ home }, async (svc) => {
    // Se recorre toda la superficie de la fase A, no solo una ruta: el byte de
    // mas suele salir del endpoint que nadie miro.
    await pedir(svc, "/v1/health");
    await pedir(svc, "/v1/capabilities");
    await pedir(svc, "/v1/no-existe");
    svc.emitir("bandeja.entrada", { id: "inb_1" });
  });
  const despues = huella(raiz, [home]);

  assert.deepEqual(despues, antes, "el servicio escribio fuera de su home");
});
