// Un home, un escritor.
//
// EL FALLO QUE EVITA. El principio VIII dice que el servicio es el unico
// escritor del almacen. Eso deja de ser cierto en el momento en que hay dos
// servicios sobre el mismo home, y llegar ahi es facil: el operador abre la
// aplicacion de escritorio, y ademas levanta el servicio a mano para usar la
// interfaz web desde el movil. Los dos escriben, ninguno ve las escrituras del
// otro, y la corrupcion aparece tres pantallas despues sin forma de saber cual
// de los dos la puso ahi.
//
// POR QUE SE NOMBRA EL PID. "El home esta en uso" manda a reiniciar la maquina.
// "lo tiene el pid 8412" se resuelve con un comando. Es la diferencia entre un
// error y una accion, que es lo que NFR-006 exige de todos los errores de este
// servicio.
//
// POR QUE EL MECANISMO ES EL DEL MOTOR Y AUN ASI VIVE AQUI. El motor ya pago
// el hallazgo —con la version ingenua, mirar si existe y escribir despues, 16
// de 25 arranques simultaneos se tomaron el mismo lock— y ese mecanismo se
// conserva tal cual: temporal + `link`, que falla si el nombre ya existe.
// Lo que no se puede es importarlo: al escritorio, este paquete viaja como
// recurso suelto (solo `package.json`, `bin/` y `src/`), asi que un import a
// `packages/engine` resuelve en desarrollo y muere en el binario empaquetado.
// Ese es el peor sitio donde descubrir una ruta rota.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { tomarHome, quienLoTiene } from "../src/lock.mjs";
import { arrancar } from "../src/servidor.mjs";
import { homeTemporal, TOKEN } from "./ayuda.mjs";

test("EL INVARIANTE: el segundo servicio sobre el mismo home se niega a arrancar", async () => {
  const home = homeTemporal();
  const primero = await arrancar({ home, token: TOKEN });
  try {
    await assert.rejects(
      () => arrancar({ home, token: TOKEN }),
      (e) => {
        assert.equal(e.codigo, "home_bloqueado");
        assert.match(e.causa, new RegExp(String(process.pid)), "el error tiene que nombrar el PID del primero");
        assert.match(e.causa, new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "y el home en disputa");
        assert.ok(e.accion, "negarse a arrancar sin decir que hacer deja al operador sin aplicacion");
        return true;
      },
    );
  } finally {
    await primero.detener();
  }
});

test("soltar el lock deja pasar al siguiente: cerrar y volver a abrir no necesita mantenimiento", async () => {
  const home = homeTemporal();
  const primero = await arrancar({ home, token: TOKEN });
  await primero.detener();

  const segundo = await arrancar({ home, token: TOKEN });
  await segundo.detener();
});

test("dos homes distintos conviven: dos proyectos abiertos a la vez no son un error", async () => {
  const uno = await arrancar({ home: homeTemporal(), token: TOKEN });
  const otro = await arrancar({ home: homeTemporal(), token: TOKEN });
  try {
    assert.notEqual(uno.puerto, otro.puerto);
  } finally {
    await uno.detener();
    await otro.detener();
  }
});

test("el servicio no importa nada de fuera de su paquete: al escritorio viaja solo", () => {
  // EL FALLO QUE EVITA. El escritorio empaqueta `packages/service/{package.json,
  // bin,src}` como recurso y nada mas. Un import relativo que salga del paquete
  // —a `packages/engine`, a `providers/`— resuelve perfectamente en el
  // repositorio y revienta al abrir la aplicacion instalada, con un
  // ERR_MODULE_NOT_FOUND que el operador ve como una ventana que no abre.
  const dir = new URL("../src/", import.meta.url).pathname;
  const bin = new URL("../bin/", import.meta.url).pathname;
  const fuera = [];
  for (const base of [dir, bin]) {
    for (const archivo of readdirRecursivo(base)) {
      const texto = readFileSync(archivo, "utf8");
      for (const m of texto.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)) {
        if (/(^|\/)\.\.\/\.\.\//.test(m[1])) fuera.push(`${archivo}: ${m[1]}`);
      }
    }
  }
  assert.deepEqual(fuera, [], `hay imports que salen del paquete:\n${fuera.join("\n")}`);
});

function readdirRecursivo(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) readdirRecursivo(p, acc);
    else if (p.endsWith(".mjs")) acc.push(p);
  }
  return acc;
}

test("un lock huerfano se recupera: un servicio matado con SIGKILL no deja el home inservible", () => {
  const home = homeTemporal();
  mkdirSync(join(home, "locks"), { recursive: true });
  writeFileSync(
    join(home, "locks", "servicio-control.json"),
    JSON.stringify({
      pid: 999999, // no existe: es lo que deja un SIGKILL
      host: hostname(),
      token: "de-otra-vida",
      resource: "servicio-control",
      acquiredAt: new Date().toISOString(),
    }),
  );

  const tomado = tomarHome(home);
  assert.equal(tomado.ok, true, "si no se recupera, el operador tiene que borrar un archivo a mano");
  assert.equal(tomado.recuperado, true, "y el servicio tiene que poder decir que lo recupero");
  tomado.release();
});

test("un lock de OTRA maquina no se roba: desde aqui no se puede saber si ese proceso vive", () => {
  // Un home en un volumen montado en dos maquinas es la forma real de llegar
  // aqui. `process.kill(pid, 0)` contesta sobre los procesos de ESTA maquina:
  // creerle sobre los de otra es como se acaban teniendo dos escritores.
  const home = homeTemporal();
  mkdirSync(join(home, "locks"), { recursive: true });
  writeFileSync(
    join(home, "locks", "servicio-control.json"),
    JSON.stringify({
      pid: 4321,
      host: `${hostname()}-pero-otra`,
      token: "de-otra-maquina",
      resource: "servicio-control",
      acquiredAt: new Date().toISOString(),
    }),
  );

  const tomado = tomarHome(home);
  assert.equal(tomado.ok, false);
  assert.match(tomado.razon, /4321/, "el motivo tiene que nombrar el pid");
  assert.match(tomado.razon, /otra/, "y decir que esta en otra maquina");
});

test("release() solo suelta el lock PROPIO: uno tardio no desbloquea al que lo tiene ahora", () => {
  const home = homeTemporal();
  const primero = tomarHome(home);
  assert.equal(primero.ok, true);
  primero.release();

  const segundo = tomarHome(home);
  assert.equal(segundo.ok, true);
  primero.release(); // tardio, de un duenio anterior

  const duenio = quienLoTiene(home);
  assert.ok(duenio, "el release tardio le quito el lock al que lo tenia");
  assert.equal(duenio.pid, process.pid);
  segundo.release();
});

test("la sesion queda en el home y desaparece al cerrar, para que el shell la pueda leer", async () => {
  const home = homeTemporal();
  const svc = await arrancar({ home, token: TOKEN });
  const archivo = join(home, "servicio", "sesion.json");
  assert.ok(existsSync(archivo), "sin archivo de sesion la interfaz web no tiene de donde sacar el token");

  // El token abre TODO este servicio. Un archivo legible por cualquier usuario
  // de la maquina lo entrega sin pedir nada, y en una maquina compartida eso es
  // el inventario entero de proyectos del operador.
  assert.equal(statSync(archivo).mode & 0o777, 0o600, "la sesion no puede ser legible por nadie mas");

  await svc.detener();
  assert.equal(existsSync(archivo), false, "una sesion que sobrevive al proceso es un token valido sin duenio");
});
