// T131/T132 — el backend elegido se declara. Nunca se cae en silencio.
//
// EL FALLO QUE EVITA. En un servidor Linux sin Secret Service, el llavero del
// sistema no existe. Una boveda que lo detecta y pasa al archivo cifrado sin
// decirlo le cambia el modelo de amenaza al operador sin avisarle: el creia que
// el secreto lo protege el sistema operativo con la sesion del usuario, y en
// realidad lo protege una frase de paso que quiza esta en un `.env` al lado.
// Esa diferencia no se descubre mirando la interfaz: hay que declararla.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, chmodSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { elegirBackend, descripcionParaCapacidades } from "../src/backends/seleccion.mjs";
import { crearBackendDeArchivo } from "../src/backends/archivo.mjs";
import { crearBackendDeLlavero } from "../src/backends/llavero.mjs";
import { crearBoveda } from "../src/boveda.mjs";
import { repositorioEnMemoria } from "../src/repositorio.mjs";
import { crearAuditoria } from "../src/auditoria.mjs";
import { centinela, trozoDelCentinela } from "./ayuda.mjs";

test("EL INVARIANTE: la seleccion nunca es silenciosa — siempre trae tipo y motivo", () => {
  const conLlavero = elegirBackend({ llavero: { disponible: true, evidencia: "/usr/bin/llavero" } });
  assert.equal(conLlavero.tipo, "keychain_so");
  assert.ok(conLlavero.motivo.length > 20, "elegir el llavero tambien se explica");

  const sinLlavero = elegirBackend({
    llavero: { disponible: false, causa: "no hay Secret Service en este equipo" },
  });
  assert.equal(sinLlavero.tipo, "archivo_cifrado");
  assert.match(sinLlavero.motivo, /Secret Service/, "el motivo tiene que nombrar la causa concreta");
});

test("una boveda no arranca con un backend que no declara por que es el elegido", () => {
  const base = { repositorio: repositorioEnMemoria(), auditoria: crearAuditoria() };
  assert.throws(
    () => crearBoveda({ ...base, backend: { tipo: "archivo_cifrado", motivo: "" } }),
    (e) => e.codigo === "backend_sin_motivo",
  );
  assert.throws(
    () => crearBoveda({ ...base, backend: { tipo: "inventado", motivo: "un motivo suficientemente largo" } }),
    (e) => e.codigo === "backend_desconocido",
  );
});

test("`backend()` devuelve lo que la interfaz muestra, y la forma que /v1/capabilities espera", () => {
  const dir = mkdtempSync(join(tmpdir(), "noxloop-backend-"));
  const backend = crearBackendDeArchivo({
    ruta: join(dir, "c.cifrado"),
    passphrase: "frase",
    motivo: "no hay Secret Service en este equipo, asi que el respaldo cifrado es el unico camino",
  });
  const boveda = crearBoveda({ backend, repositorio: repositorioEnMemoria(), auditoria: crearAuditoria() });
  const declarado = boveda.backend();
  assert.equal(declarado.tipo, "archivo_cifrado");
  assert.match(declarado.motivo, /Secret Service/);

  // El principio X: la capacidad viaja con su origen y con la evidencia o el
  // motivo. Esta funcion existe para que el servicio no tenga que reconstruir
  // esa forma —ni inventarla— cuando conecte la boveda a `/v1/capabilities`.
  const cap = descripcionParaCapacidades(declarado);
  assert.equal(cap.origen, "detectado");
  assert.equal(cap.valor.tipo, "archivo_cifrado");
  assert.ok(cap.evidencia || cap.motivo);
});

test("T132: el archivo de respaldo esta cifrado — el centinela no esta en sus bytes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "noxloop-archivo-"));
  const ruta = join(dir, "c.cifrado");
  const valor = centinela("archivo");
  const backend = crearBackendDeArchivo({ ruta, passphrase: "frase", motivo: "prueba del respaldo cifrado" });

  await backend.guardar("noxloop:w1:abc", valor);
  const bytes = readFileSync(ruta);
  assert.equal(trozoDelCentinela(bytes.toString("latin1"), valor), null, "el valor esta en claro en el archivo");
  assert.equal(trozoDelCentinela(bytes.toString("utf8"), valor), null);
  assert.equal(await backend.recuperar("noxloop:w1:abc"), valor, "cifrar sin poder descifrar no sirve de nada");

  // El archivo solo lo puede leer su dueno: en un equipo compartido, 0644 hace
  // que el respaldo cifrado proteja menos que el llavero contra el vecino de
  // escritorio, que es justamente quien tiene cuenta en la misma maquina.
  assert.equal(statSync(ruta).mode & 0o077, 0, "el archivo de respaldo es legible por otros usuarios");
});

test("el respaldo cifrado no abre con otra frase de paso, y lo dice sin ambiguedad", async () => {
  const dir = mkdtempSync(join(tmpdir(), "noxloop-frase-"));
  const ruta = join(dir, "c.cifrado");
  const uno = crearBackendDeArchivo({ ruta, passphrase: "la-buena", motivo: "prueba del respaldo cifrado" });
  await uno.guardar("noxloop:w1:abc", centinela("frase"));

  const otro = crearBackendDeArchivo({ ruta, passphrase: "la-otra", motivo: "prueba del respaldo cifrado" });
  await assert.rejects(() => otro.recuperar("noxloop:w1:abc"), (e) => {
    assert.equal(e.codigo, "frase_incorrecta");
    assert.ok(e.accion);
    return true;
  });
});

test("el respaldo cifrado se niega a arrancar sin frase de paso, diciendo como darsela", () => {
  assert.throws(
    () => crearBackendDeArchivo({ ruta: "/tmp/no-importa", passphrase: "", motivo: "prueba" }),
    (e) => {
      assert.equal(e.codigo, "sin_frase_de_paso");
      assert.ok(e.accion, "un backend que no arranca sin decir que falta deja la aplicacion muerta");
      return true;
    },
  );
});

test("T130/T143: el llavero recibe el valor por la entrada estandar, nunca por argv", async () => {
  // EL FALLO QUE EVITA. `ps ax -o command` muestra los argumentos de cualquier
  // proceso a cualquier proceso del mismo usuario. Un `llavero guardar <valor>`
  // publica la credencial durante toda la vida del proceso hijo.
  const dir = mkdtempSync(join(tmpdir(), "noxloop-llavero-"));
  const espia = join(dir, "espia.mjs");
  const registro = join(dir, "visto.json");
  writeFileSync(
    espia,
    [
      "let entrada = '';",
      "for await (const t of process.stdin) entrada += t;",
      "const fs = await import('node:fs');",
      `fs.appendFileSync(${JSON.stringify(registro)}, JSON.stringify({ argv: process.argv.slice(2), entrada }) + '\\n');`,
      "const orden = process.argv[2];",
      "if (orden === 'recuperar') process.stdout.write(entrada || 'nada');",
      "if (orden === 'disponible') process.stdout.write(JSON.stringify({ disponible: true }));",
      "if (orden === 'existe') process.stdout.write(JSON.stringify({ existe: true }));",
    ].join("\n"),
  );

  const valor = centinela("llavero");
  const backend = crearBackendDeLlavero({
    ejecutable: process.execPath,
    argumentosPrevios: [espia],
    servicio: "noxloop",
    motivo: "prueba del canal con el comando del llavero",
  });
  await backend.guardar("noxloop:w1:abc", valor);

  const visto = readFileSync(registro, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  for (const llamada of visto) {
    assert.equal(
      trozoDelCentinela(JSON.stringify(llamada.argv), valor),
      null,
      `el valor viajo por argv: ${JSON.stringify(llamada.argv)}`,
    );
  }
  assert.ok(visto.some((l) => l.entrada.includes(valor)), "el valor tiene que llegar por stdin");
});
