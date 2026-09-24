// T145 — SSH: huella fijada, allowlist de lectura, bitacora de cada comando,
// sin reenvio del agente.
//
// EL FALLO QUE EVITA. Dentro de una sesion SSH no corre ningun hook local y la
// lista de comandos permitidos del shell local deja de aplicar: la gobernanza
// entera se queda de este lado del tunel. Por eso el control no puede estar en
// "que comandos deja escribir la sesion", sino en que comandos se declaran y se
// construyen aqui, uno por uno, y cada uno queda anotado antes de salir.

import { test } from "node:test";
import assert from "node:assert/strict";

import { crearSesionSsh, ALLOWLIST_DE_LECTURA } from "../src/ssh.mjs";

function sesionDePrueba(extra = {}) {
  const ejecutados = [];
  const sesion = crearSesionSsh({
    host: "un-host",
    usuario: "operador",
    huellaDeHost: "SHA256:AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKK",
    archivoDeHostsConocidos: "/tmp/noxloop-hosts-conocidos",
    comandosDeclarados: [["git", "status"], ["ls"], ["systemctl", "restart"]],
    ejecutar: async (comando, args) => {
      ejecutados.push([comando, ...args]);
      return { code: 0, stdout: "", stderr: "" };
    },
    ...extra,
  });
  return { sesion, ejecutados };
}

test("EL INVARIANTE: sin huella de host fijada la sesion no se crea", () => {
  // Aceptar un host desconocido "solo esta vez" es exactamente como se acepta un
  // intermediario. No hay modo interactivo que lo permita porque no hay nadie
  // del otro lado dentro de una tarea del motor.
  assert.throws(
    () => sesionDePrueba({ huellaDeHost: undefined }),
    (e) => {
      assert.equal(e.codigo, "host_sin_huella");
      assert.ok(e.accion, "bloquear sin decir como registrar la huella deja la tarea muerta");
      return true;
    },
  );
});

test("EL INVARIANTE: las opciones fijas cierran el reenvio del agente y la aceptacion automatica", () => {
  const { sesion } = sesionDePrueba();
  const args = sesion.argumentosDe(["git", "status"]);
  const linea = args.join(" ");

  assert.match(linea, /StrictHostKeyChecking=yes/);
  assert.match(linea, /ForwardAgent=no/);
  assert.match(linea, /UserKnownHostsFile=\/tmp\/noxloop-hosts-conocidos/);
  assert.match(linea, /BatchMode=yes/, "sin esto, un host que pide contrasena cuelga la tarea para siempre");
  assert.equal(/StrictHostKeyChecking=(no|accept-new)/.test(linea), false);
  assert.equal(/ForwardAgent=yes/.test(linea), false);
  assert.equal(linea.includes("-A"), false, "`-A` es el reenvio del agente con otra grafia");
});

test("EL INVARIANTE: cada comando ejecutado queda en la bitacora, no la apertura de la sesion", async () => {
  const { sesion } = sesionDePrueba();
  await sesion.ejecutar(["git", "status"]);
  await sesion.ejecutar(["ls"]);

  const bitacora = sesion.bitacora();
  assert.equal(bitacora.length, 2, "la bitacora de una sesion con dos comandos tiene dos lineas");
  assert.deepEqual(bitacora.map((e) => e.comando), [["git", "status"], ["ls"]]);
  assert.ok(bitacora.every((e) => e.host === "un-host" && e.ts && e.resultado === "ejecutado"));
});

test("el comando se declara primero y la allowlist decide despues: dos capas, en ese orden", async () => {
  const { sesion, ejecutados } = sesionDePrueba();

  // Primera capa: lo que la tarea NO declaro no pasa, este o no en la allowlist.
  await assert.rejects(
    () => sesion.ejecutar(["cat", "/etc/passwd"]),
    (e) => {
      assert.equal(e.codigo, "comando_no_declarado");
      assert.match(e.accion, /declar/i, "rechazar sin decir como pedirlo alarga la lista de prohibidos");
      return true;
    },
  );

  // Segunda capa: declarado, pero no es de solo lectura. Escribir o desplegar
  // necesita autorizacion explicita por sesion, no permanente.
  await assert.rejects(
    () => sesion.ejecutar(["systemctl", "restart"]),
    (e) => e.codigo === "comando_no_permitido",
  );

  assert.deepEqual(ejecutados, [], "ninguno de los dos llego a salir a la red");
  assert.deepEqual(
    sesion.bitacora().map((e) => e.resultado),
    ["rechazado", "rechazado"],
    "un comando rechazado tambien es un comando que alguien intento",
  );
});

test("la autorizacion de escritura es por sesion y se anota como tal", async () => {
  const { sesion, ejecutados } = sesionDePrueba();
  sesion.autorizar(["systemctl", "restart"], { por: "bandeja", solicitud: "s-1" });
  await sesion.ejecutar(["systemctl", "restart"]);

  assert.equal(ejecutados.length, 1);
  const linea = sesion.bitacora().at(-1);
  assert.equal(linea.resultado, "ejecutado");
  assert.deepEqual(linea.autorizacion, { por: "bandeja", solicitud: "s-1" });

  // Otra sesion sobre el mismo host no hereda la autorizacion.
  const otra = sesionDePrueba().sesion;
  await assert.rejects(() => otra.ejecutar(["systemctl", "restart"]), (e) => e.codigo === "comando_no_permitido");
});

test("EL INVARIANTE: la allowlist compara el comando como lista, no como linea de texto", async () => {
  // POR QUE IMPORTA: la constitution lo midio en este repositorio — con una
  // lista de PROHIBIDOS, 45 de 57 grafias la sortearon: un prefijo (`env`,
  // `bash -c`, `sudo`), una comilla o un interprete. Comparar cadenas invita a
  // la misma derrota desde el otro lado. Aqui el comando es un vector, el
  // primer elemento se compara exacto, y una cadena no se acepta siquiera.
  const { sesion } = sesionDePrueba({ comandosDeclarados: [["git", "status"]] });

  await assert.rejects(
    () => sesion.ejecutar(/** @type {any} */ ("git status")),
    (e) => e.codigo === "comando_no_es_lista",
  );
  for (const grafia of [["env", "git", "status"], ["bash", "-c", "git status"], ["sudo", "git", "status"], ["git status"]]) {
    await assert.rejects(
      () => sesion.ejecutar(grafia),
      (e) => e.codigo === "comando_no_declarado" || e.codigo === "comando_no_permitido",
      `la grafia ${JSON.stringify(grafia)} paso`,
    );
  }
});

test("la allowlist por defecto es de lectura y diagnostico, y no contiene nada que escriba", () => {
  const escriben = ALLOWLIST_DE_LECTURA.filter((c) =>
    ["rm", "systemctl", "docker", "kubectl", "apt", "yum", "dd", "mv", "chown", "chmod", "sh", "bash", "sudo"].includes(c),
  );
  assert.deepEqual(escriben, [], `la allowlist por defecto dejo entrar: ${escriben.join(", ")}`);
});
