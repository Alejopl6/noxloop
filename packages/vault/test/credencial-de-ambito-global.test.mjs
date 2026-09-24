// Una credencial de ambito `global` se usa SIN proyecto, y su grant tampoco lo
// tiene.
//
// EL FALLO CONCRETO. La cuenta de codigo del operador pasa a conectarse a nivel
// de espacio de trabajo: una sola cuenta, muchos repositorios, todos los
// proyectos eligiendo de ahi. Su credencial es de ambito `global` —el enum
// `global | proyecto` existe justo para eso— y entonces el acceso no se hace a
// nombre de ningun proyecto, porque no hay ninguno: se conecta en el alta,
// antes de que el proyecto exista.
//
// Y ahi moria. `validarMotivo` exigia `project_id` con verdad simple
// (`!motivo[campo]`), asi que un motivo honesto —`project_id: null`, porque no
// hay proyecto— se rechazaba con `motivo_ausente`. El operador pegaba su token,
// la credencial entraba a la boveda con su huella, y al pedir la lista de
// repositorios el error hablaba de un campo del motivo de acceso. Es decir: la
// boveda distinguia `global` de `proyecto` en el alta y no lo distinguia en el
// uso.
//
// LO QUE NO SE AFLOJA. Una credencial de ambito `proyecto` SIGUE exigiendo su
// proyecto en el motivo, y ahora lo exige contra la credencial que se esta
// pidiendo en vez de contra la forma del objeto — que es mas estricto, no
// menos: antes bastaba con mandar cualquier cadena no vacia.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { crearBoveda } from "../src/boveda.mjs";
import { repositorioEnMemoria } from "../src/repositorio.mjs";
import { crearAuditoria } from "../src/auditoria.mjs";
import { crearBackendDeArchivo } from "../src/backends/archivo.mjs";
import { centinela, trozoDelCentinela } from "./ayuda.mjs";

function bovedaDePrueba() {
  const dir = mkdtempSync(join(tmpdir(), "noxloop-global-"));
  const backend = crearBackendDeArchivo({
    ruta: join(dir, "credenciales.cifrado"),
    passphrase: "frase-de-prueba",
    motivo: "prueba: no se ejercita el llavero del sistema operativo",
  });
  return { boveda: crearBoveda({ backend, repositorio: repositorioEnMemoria(), auditoria: crearAuditoria() }) };
}

test("EL CAMINO DE LA CUENTA DEL ESPACIO DE TRABAJO: registrar global, otorgar sin proyecto y recuperar", async () => {
  const { boveda } = bovedaDePrueba();
  const valor = centinela("cuenta-de-codigo");

  const { credencial } = await boveda.registrar({
    workspace: "w1",
    nombre: "github-pat-token",
    proveedor: "github-pat",
    tipo: "scm",
    ambito: "global",
    project_id: null,
    alcance_declarado: "leer los repositorios que la cuenta alcanza",
    valor,
  });
  assert.equal(credencial.ambito, "global");
  assert.equal(credencial.project_id, null);

  const grant = await boveda.otorgar({
    project_id: null,
    agent_id: "capa-de-conexiones",
    credential_id: credencial.id,
    concedido_por: "operador (alta de proyecto)",
  });
  assert.equal(grant.project_id, null, "un grant sobre una credencial global no se otorga a ningun proyecto");

  const recuperado = await boveda.recuperar(credencial.ref_boveda, {
    grant_id: grant.id,
    project_id: null,
    agent_id: "capa-de-conexiones",
    proposito: "llamar_api",
  });
  assert.equal(recuperado, valor);
});

test("el motivo tiene que DECLARAR `project_id`, aunque sea nulo: omitirlo sigue siendo un motivo incompleto", async () => {
  // La diferencia importa. `null` es «esta credencial no es de ningun
  // proyecto»; ausente es «quien llama se olvido de decirlo». Tratarlos igual
  // convertiria el olvido en una excepcion silenciosa, que es como se pierde la
  // unica parte del acceso que se audita.
  const { boveda } = bovedaDePrueba();
  const { credencial } = await boveda.registrar({
    workspace: "w1",
    nombre: "global",
    proveedor: "github-pat",
    tipo: "scm",
    ambito: "global",
    valor: centinela("sin-declarar"),
  });
  const grant = await boveda.otorgar({
    project_id: null,
    agent_id: "capa-de-conexiones",
    credential_id: credencial.id,
    concedido_por: "operador",
  });

  await assert.rejects(
    () =>
      boveda.recuperar(credencial.ref_boveda, {
        grant_id: grant.id,
        agent_id: "capa-de-conexiones",
        proposito: "llamar_api",
      }),
    (e) => {
      assert.equal(e.codigo, "motivo_ausente");
      assert.match(e.causa, /project_id/);
      return true;
    },
  );
});

test("EL LIMITE: una credencial de ambito `proyecto` no se entrega con un motivo sin proyecto", async () => {
  // Es la mitad que no se afloja. Si `project_id: null` valiera para todo, una
  // credencial declarada de un proyecto quedaria de hecho global — MAS permiso
  // del que se pidio, que es exactamente lo que `crearCredencial` ya impide en
  // el alta.
  const { boveda } = bovedaDePrueba();
  const valor = centinela("de-proyecto");
  const { credencial } = await boveda.registrar({
    workspace: "w1",
    nombre: "token-del-tracker",
    proveedor: "un-tracker",
    tipo: "tracker",
    ambito: "proyecto",
    project_id: "p1",
    valor,
  });
  const grant = await boveda.otorgar({
    project_id: null,
    agent_id: "a1",
    credential_id: credencial.id,
    concedido_por: "operador",
  });

  await assert.rejects(
    () =>
      boveda.recuperar(credencial.ref_boveda, {
        grant_id: grant.id,
        project_id: null,
        agent_id: "a1",
        proposito: "llamar_api",
      }),
    (e) => {
      assert.equal(e.codigo, "credencial_de_proyecto_sin_proyecto");
      assert.ok(e.accion, "denegar sin decir como arreglarlo deja la tarea bloqueada sin salida");
      assert.equal(
        trozoDelCentinela(`${e.message} ${e.causa ?? ""} ${e.accion}`, valor),
        null,
        "el error de denegacion llevaba el valor dentro",
      );
      return true;
    },
  );
});

test("un grant de OTRO proyecto tampoco alcanza una credencial global: el grant sigue siendo la unica llave", async () => {
  const { boveda } = bovedaDePrueba();
  const { credencial } = await boveda.registrar({
    workspace: "w1",
    nombre: "global",
    proveedor: "github-pat",
    tipo: "scm",
    ambito: "global",
    valor: centinela("llave"),
  });
  const grant = await boveda.otorgar({
    project_id: "p1",
    agent_id: "capa-de-conexiones",
    credential_id: credencial.id,
    concedido_por: "operador",
  });

  await assert.rejects(
    () =>
      boveda.recuperar(credencial.ref_boveda, {
        grant_id: grant.id,
        project_id: null,
        agent_id: "capa-de-conexiones",
        proposito: "llamar_api",
      }),
    (e) => {
      assert.equal(e.codigo, "sin_grant");
      return true;
    },
  );
});
