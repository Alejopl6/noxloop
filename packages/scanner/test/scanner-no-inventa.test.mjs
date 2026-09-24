// Principio X, la tercera regla: el hueco se declara hueco.
//
// EL FALLO QUE EVITA. Un repositorio vacio es el caso donde un scanner que
// rellena se delata. La tentacion es devolver lo probable —"seguro que usan
// Node, seguro que hay tests"— porque un snapshot lleno se ve mejor en la
// pantalla que uno lleno de nulos. Pero ese snapshot es la entrada de la
// constitution, y una constitution construida sobre lo probable se aplica
// durante meses sobre un proyecto que nunca fue asi.
//
// Un repositorio sin tests emite `testing.runner = null` CON la constancia de
// que se busco. No emite un runner plausible, y no se calla.

import { test } from "node:test";
import assert from "node:assert/strict";

import { escanear } from "../src/index.mjs";
import { arbolTemporal } from "./ayuda.mjs";

/** Lo minimo que hace falta para que `git init` tenga algo que versionar. */
const VACIO = { "LEEME.txt": "todavia no hay nada aqui\n" };

test("sobre un repositorio vacio no sale ni un hallazgo inferido con confianza alta", async () => {
  const raiz = arbolTemporal(VACIO);
  const snapshot = await escanear({ ruta: raiz });

  const inventados = snapshot.hallazgos.filter((h) => h.origen === "inferido" && h.confianza === "alta");
  assert.deepEqual(
    inventados.map((h) => `${h.clave}=${JSON.stringify(h.valor)}`),
    [],
    "hay suposiciones vendidas como certezas sobre un repositorio donde no hay nada que saber",
  );
});

test("los huecos se declaran, con la constancia de que se busco y no habia", async () => {
  const raiz = arbolTemporal(VACIO);
  const snapshot = await escanear({ ruta: raiz });

  // Estas son las preguntas que la constitution va a hacerle al snapshot. Todas
  // tienen que tener respuesta, aunque la respuesta sea "no hay".
  const OBLIGATORIAS = [
    "stack.ecosistemas",
    "testing.runner",
    "testing.umbral_cobertura",
    "ci.workflows",
    "agentes.instrucciones",
    "guidelines.contributing",
    "arquitectura.capas",
  ];

  for (const clave of OBLIGATORIAS) {
    const h = snapshot.hallazgos.find((x) => x.clave === clave);
    assert.ok(h, `\`${clave}\` no aparece ni como hueco: callarse es la otra forma de inventar`);
    assert.ok(h.valor === null || (Array.isArray(h.valor) && h.valor.length === 0), `\`${clave}\` se relleno`);
    assert.equal(h.origen, "detectado", `\`${clave}\` es un hecho comprobado: se miro y no habia`);
    assert.ok(
      h.motivo && h.motivo.length > 20,
      `\`${clave}\` declara el hueco sin decir donde se busco: ${h.motivo}`,
    );
    assert.ok(h.evidencia.length > 0, `\`${clave}\` no trae constancia de la busqueda`);
  }
});

test("un hallazgo sin origen no existe: todos declaran de donde salen", async () => {
  const raiz = arbolTemporal(VACIO);
  const snapshot = await escanear({ ruta: raiz });
  for (const h of snapshot.hallazgos) {
    assert.ok(["detectado", "inferido"].includes(h.origen), `${h.clave} tiene origen \`${h.origen}\``);
    assert.ok(["alta", "media", "baja"].includes(h.confianza), `${h.clave} no declara confianza`);
    assert.ok(h.categoria, `${h.clave} no declara categoria`);
  }
});

test("un directorio que no es un repositorio de git se escanea igual, y lo dice", async () => {
  // El operador apunta el producto a una carpeta antes de haberla versionado.
  // Negarse seria correcto y seria inutil; inventar un commit seria peor.
  const raiz = arbolTemporal({ "package.json": "{}" }, { git: false });
  const snapshot = await escanear({ ruta: raiz });
  assert.equal(snapshot.estado, "completo");
  assert.equal(snapshot.commit, null);
  assert.ok(snapshot.commit_motivo.length > 20, "no se dijo por que no hay commit");
});

test("una ruta que no existe falla con causa y accion, no con un snapshot vacio", async () => {
  await assert.rejects(() => escanear({ ruta: "/no/existe/este/arbol/de/aqui" }), (e) => {
    assert.ok(e.causa.length > 20, "el error no dice que paso");
    assert.ok(e.accion.length > 20, "el error no dice que hacer despues");
    return true;
  });
});
