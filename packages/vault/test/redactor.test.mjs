// T139 — el redactor busca POR VALOR y nombra la credencial.
//
// EL FALLO QUE EVITA. El vector no es hipotetico: un agente lee una credencial
// durante la ejecucion y la reproduce a mitad de una frase de su transcript.
// Ahi no hay nombre de variable, ni comillas, ni `API_KEY=`: hay 40 caracteres
// sueltos dentro de un parrafo. Un redactor que busca por el nombre de la
// variable no ve nada y deja pasar el texto entero.

import { test } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { crearBoveda } from "../src/boveda.mjs";
import { crearRedactor } from "../src/redactor.mjs";
import { repositorioEnMemoria } from "../src/repositorio.mjs";
import { crearAuditoria } from "../src/auditoria.mjs";
import { crearBackendDeArchivo } from "../src/backends/archivo.mjs";
import { centinela, trozoDelCentinela } from "./ayuda.mjs";

async function conRedactor(credenciales) {
  const dir = mkdtempSync(join(tmpdir(), "noxloop-redactor-"));
  const backend = crearBackendDeArchivo({
    ruta: join(dir, "c.cifrado"),
    passphrase: "frase",
    motivo: "prueba del respaldo cifrado",
  });
  const repositorio = repositorioEnMemoria();
  const auditoria = crearAuditoria();
  const boveda = crearBoveda({ backend, repositorio, auditoria });
  for (const [nombre, valor] of Object.entries(credenciales)) {
    await boveda.registrar({ workspace: "w1", nombre, proveedor: "proveedor-de-prueba", tipo: "api_token", valor });
  }
  const redactor = crearRedactor({ backend, repositorio, auditoria });
  await redactor.cargarHuellas();
  return { redactor, auditoria, boveda };
}

test("EL INVARIANTE: encuentra el valor suelto a mitad de una frase, sin etiqueta que lo delate", async () => {
  const valor = centinela("suelto");
  const { redactor } = await conRedactor({ "token-del-gestor": valor });

  const transcript = `Probe con el token ${valor} y el servidor devolvio 401, asi que sigo.`;
  const redactado = redactor.redactar(transcript);

  assert.equal(trozoDelCentinela(redactado, valor), null, "el valor sobrevivio a la redaccion");
  assert.match(redactado, /\[redactado:token-del-gestor\]/);
  // POR QUE SE NOMBRA LA CREDENCIAL: un `[redactado]` anonimo obliga a adivinar
  // cual de las cuatro credenciales del proyecto fue la que devolvio 401.
  assert.match(redactado, /devolvio 401/, "redactar no puede comerse el resto del texto");
});

test("redacta dentro de estructuras, en cualquier nivel, y tambien en las claves", async () => {
  const valor = centinela("objeto");
  const { redactor } = await conRedactor({ clave: valor });

  const evidencia = {
    salida: { lineas: [`export TOKEN=${valor}`, "ok"] },
    cabeceras: { authorization: `Bearer ${valor}` },
    [`indice-${valor}`]: "una clave tambien es texto que se persiste",
    numero: 7,
    nulo: null,
    fecha: new Date(0),
  };
  const limpio = redactor.redactarObjeto(evidencia);

  assert.equal(trozoDelCentinela(JSON.stringify(limpio), valor), null);
  assert.equal(limpio.numero, 7, "redactar no puede cambiar lo que no es texto");
  assert.equal(limpio.nulo, null);
  assert.equal(limpio.salida.lineas.length, 2);
  // El objeto original no se toca: el llamante puede seguir necesitandolo para
  // inyectar, y una mutacion silenciosa ahi rompe el lanzamiento.
  assert.ok(evidencia.cabeceras.authorization.includes(valor));
});

test("con varias credenciales redacta todas, y la mas larga primero", async () => {
  const corto = centinela("corto");
  const largo = `${corto}-extension-que-lo-hace-mas-largo`;
  const { redactor } = await conRedactor({ corta: corto, larga: largo });

  const redactado = redactor.redactar(`primero ${largo} y despues ${corto}`);
  assert.equal(trozoDelCentinela(redactado, largo), null);
  assert.match(redactado, /\[redactado:larga\]/, "una credencial que contiene a otra tiene que ganar la larga");
  assert.match(redactado, /\[redactado:corta\]/);
});

test("EL INVARIANTE: el redactor no expone los valores que carga", async () => {
  // El redactor es la unica pieza que tiene que reconocer el valor, asi que es
  // la unica que lo tiene en memoria fuera del instante de inyeccion. Que los
  // guarde en un campo lo pone a un `JSON.stringify` de distancia de un log.
  const valor = centinela("interno");
  const { redactor } = await conRedactor({ clave: valor });

  assert.equal(trozoDelCentinela(JSON.stringify(redactor), valor), null);
  assert.equal(trozoDelCentinela(inspect(redactor, { depth: Infinity, showHidden: true }), valor), null);
  assert.equal(trozoDelCentinela(JSON.stringify(Object.values(redactor)), valor), null);
});

test("cargar huellas queda en la bitacora: un valor sacado del backend se registra", async () => {
  const { auditoria } = await conRedactor({ clave: centinela("bitacora") });
  const carga = auditoria.listar().filter((e) => e.tipo === "redaccion_cargada");
  assert.equal(carga.length, 1);
  assert.equal(carga[0].cuantas, 1);
});

test("un texto sin secretos vuelve identico, y un redactor sin cargar no miente", async () => {
  const { redactor } = await conRedactor({ clave: centinela("nada") });
  assert.equal(redactor.redactar("todo bien por aqui"), "todo bien por aqui");

  const sinCargar = crearRedactor({
    backend: { tipo: "archivo_cifrado", motivo: "prueba", recuperar: async () => "" },
    repositorio: repositorioEnMemoria(),
    auditoria: crearAuditoria(),
  });
  assert.throws(() => sinCargar.redactar("algo"), (e) => e.codigo === "redactor_sin_cargar");
});
