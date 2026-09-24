// T161 · la licencia de la capa de integracion queda declarada, con lo que
// implica para quien redistribuya.
//
// POR QUE ESTO ES UNA PRUEBA Y NO UN PARRAFO EN UN documento. La decision de
// meter una dependencia Elastic 2.0 en el nucleo esta tomada; lo que esta
// prueba protege es que no sea una sorpresa. Un usuario que descubre la licencia
// despues de adoptar el producto tiene un problema que le creamos nosotros en
// silencio, y el texto que lo evita es justo el que se borra en la primera
// limpieza de documentacion si nadie lo mide.
//
// El texto vive aqui dentro y se integra a mano en `LICENSE` y `README.md`:
// este paquete no edita archivos de la raiz.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const DOC = readFileSync(new URL("../docs/licencia-de-integraciones.md", import.meta.url), "utf8");

test("EL INVARIANTE: el documento nombra la licencia, los paquetes y las tres consecuencias", () => {
  const OBLIGATORIO = [
    [/Elastic License 2\.0/, "el nombre de la licencia"],
    [/ELv2/, "la abreviatura con la que se la nombra en el resto del repositorio"],
    [/@nangohq\/node/, "el SDK de servidor"],
    [/@nangohq\/frontend/, "el SDK de cliente"],
    [/OSI/, "que no esta aprobada por la OSI"],
    [/GPL|AGPL/, "la incompatibilidad con GPL/AGPL"],
    [/MIT/, "que el repositorio sigue siendo MIT y la dependencia no"],
    [/redistribu/i, "la obligacion de quien redistribuye"],
    [/Debian|Fedora/, "los canales de empaquetado que la rechazan"],
    [/servicio alojado|alojad/i, "la clausula de no ofrecerlo como servicio alojado a terceros"],
  ];
  const faltan = OBLIGATORIO.filter(([re]) => !re.test(DOC)).map(([, que]) => que);
  assert.deepEqual(faltan, [], `al documento de licencia le falta:\n- ${faltan.join("\n- ")}`);
});

test("trae los dos textos listos para pegar, cada uno en su bloque", () => {
  // Sin el texto literal, "declarar la licencia" se convierte en una tarea de
  // redaccion que se pospone. Con el texto, es un copiar y pegar.
  assert.match(DOC, /##\s+Para\s+`LICENSE`/, "no hay bloque para LICENSE");
  assert.match(DOC, /##\s+Para\s+`README\.md`/, "no hay bloque para README.md");
  const bloques = [...DOC.matchAll(/```text\n([\s\S]*?)```/g)].map((m) => m[1].trim());
  assert.ok(bloques.length >= 2, `hay ${bloques.length} bloques de texto listos para pegar, se esperaban dos`);
  for (const bloque of bloques) {
    assert.ok(bloque.length > 200, "un bloque de dos lineas no alcanza para explicar lo que implica");
    assert.match(bloque, /Elastic License 2\.0/);
  }
});

test("el documento dice tambien lo que la decision obliga a hacer, no solo lo que pasa", () => {
  // Las dos consecuencias operativas del hallazgo: las aplicaciones OAuth
  // propias desde el dia uno (el seguro de portabilidad) y la fachada.
  assert.match(DOC, /aplicaciones OAuth propias|aplicacion OAuth propia|aplicación OAuth propia/i);
  assert.match(DOC, /portabilidad/i, "sin nombrar por que se registran, las aplicaciones propias parecen burocracia");
  assert.match(DOC, /fachada|ConnectionProvider/);
});

test("el adaptador que trae la dependencia apunta al documento", () => {
  const nango = readFileSync(new URL("../src/adaptadores/nango.mjs", import.meta.url), "utf8");
  assert.match(
    nango,
    /licencia-de-integraciones\.md/,
    "el archivo que va a traer la dependencia ELv2 no menciona donde esta declarada",
  );
  assert.match(nango, /Elastic License 2\.0/);
});
