// LA PROMESA. Es el test que le da sentido al paquete entero.
//
// EL FALLO QUE EVITA. La primera accion del producto sobre el proyecto de
// alguien es este scanner. Si el snapshot modificara algo —un lockfile
// resuelto, una cache de un formateador, un `.DS_Store` de un recorrido mal
// hecho— nadie lo apuntaria a un repositorio que le importa, y el producto se
// queda sin primera etapa. No hay segunda oportunidad para esa impresion.
//
// POR QUE ESTE TEST Y NO UNA REVISION DEL CODIGO. Porque "no escribe nada" es
// prosa hasta que existe el objeto que lo prueba, igual que un gate no paso
// hasta que existe su exit code (principio II). Aqui el objeto es la salida de
// `git status --porcelain` antes y despues, que tiene que ser identica.
//
// POR QUE SOBRE VARIOS ECOSISTEMAS. Porque cada manifiesto despierta a un
// detector distinto, y un detector que escribe solo aparece cuando el
// manifiesto que lo llama esta presente. Probarlo solo sobre Node deja a los
// otros cinco sin cubrir.

import { test } from "node:test";
import assert from "node:assert/strict";

import { escanear } from "../src/index.mjs";
import { ECOSISTEMAS, estadoGit, huellaDelArbol, diferencias, repoDe } from "./ayuda.mjs";

for (const nombre of Object.keys(ECOSISTEMAS)) {
  test(`el scanner no escribe nada en un repositorio de ${nombre}`, async () => {
    const raiz = repoDe(nombre);

    // EL ORDEN DE ESTAS CUATRO LINEAS IMPORTA, Y COSTO ENCONTRARLO. `git
    // status` refresca `.git/index` y lo reescribe: el instrumento de medida
    // escribe. Si la huella de despues se tomara detras del segundo
    // `git status`, el test acusaria al scanner de tocar `.git/index` en todos
    // los ecosistemas. Se mide el arbol justo antes y justo despues del
    // recorrido, y git se consulta fuera de esa ventana.
    const gitAntes = estadoGit(raiz);
    const huellaAntes = huellaDelArbol(raiz);

    const snapshot = await escanear({ ruta: raiz });
    assert.equal(snapshot.estado, "completo", "el scanner tiene que haber terminado para que el test valga");

    const huellaDespues = huellaDelArbol(raiz);
    const gitDespues = estadoGit(raiz);

    assert.equal(
      gitDespues,
      gitAntes,
      `el scanner dejo cambios en el arbol de ${nombre}:\n${gitDespues}\n` +
        "la promesa del producto es que la primera accion sobre el repositorio de alguien no lo toca",
    );
    assert.deepEqual(
      diferencias(huellaAntes, huellaDespues),
      [],
      `el scanner toco archivos del arbol de ${nombre}`,
    );
  });
}

test("cien recorridos seguidos siguen sin tocar nada: la promesa es por ejecucion, no en promedio", async () => {
  // SC-002 dice "en 100 de 100 ejecuciones". Un scanner que escribe una cache
  // la primera vez y la reutiliza despues pasaria un test de una sola pasada.
  const raiz = repoDe("node");
  const gitAntes = estadoGit(raiz);
  const antes = huellaDelArbol(raiz);

  for (let i = 0; i < 100; i++) await escanear({ ruta: raiz });

  assert.deepEqual(diferencias(antes, huellaDelArbol(raiz)), []);
  assert.equal(estadoGit(raiz), gitAntes);
});

test("un directorio de solo lectura no se le atraganta: si no puede escribir, es que no lo necesita", async () => {
  // La prueba mas dura de la promesa: si el scanner necesitara escribir algo,
  // aqui fallaria con EACCES en vez de pasar. Es el mismo criterio del exit
  // code: el sistema operativo es quien contesta, no el codigo.
  const { chmodSync } = await import("node:fs");
  const raiz = repoDe("node");
  chmodSync(raiz, 0o555);
  try {
    const snapshot = await escanear({ ruta: raiz });
    assert.equal(snapshot.estado, "completo");
  } finally {
    chmodSync(raiz, 0o755);
  }
});
