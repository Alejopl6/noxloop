// Las reglas del lenguaje visual, como contrato.
//
// POR QUE ESTO ES UN TEST Y NO UN COMENTARIO. Un lenguaje visual se pierde de a
// una excepcion: alguien pinta una columna de rojo "para que se vea", otro pone
// un bold "porque no se lee", y a las diez ediciones queda un tablero que grita
// cinco cosas a la vez. Las tres reglas de abajo son las que sostienen el resto,
// y son verificables sobre el texto de la pagina.
//
// LO QUE NO SE TESTEA: que quede lindo. Eso no es verificable y pretender que si
// seria el mismo verde inventado, en otro plano.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGINA } from "../src/board-page.mjs";

/** Solo la hoja de estilos, sin el script ni el marcado. */
function css() {
  const m = PAGINA.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(m, "la pagina tiene que traer su hoja de estilos");
  return m[1];
}

test("la regla de los tres pesos: 400, 500, 600 — y nunca 700", () => {
  const pesos = new Set([...css().matchAll(/font-weight:\s*(\d{3})/g)].map((m) => m[1]));
  for (const p of pesos) {
    assert.ok(["400", "500", "600"].includes(p), `peso ${p}: el enfasis sale del tamaño y del espacio, no del grosor`);
  }
  assert.doesNotMatch(css(), /font-weight:\s*bold/, "`bold` es 700 escrito de otra forma");
  // Y el atajo `font:` tampoco puede meter un 700 por la ventana.
  assert.doesNotMatch(css(), /font:\s*(?:700|bold)\b/);
});

test("EL COLOR DE ESTADO SOLO VIVE EN PUNTOS: nunca es el fondo de algo grande", () => {
  // Es la regla que sostiene todo el resto. Los colores de estado se declaran
  // como variables y el UNICO lugar que los aplica es el punto de 10px, que se
  // pinta desde el script. Si aparecen en un `background` de la hoja, alguien
  // convirtio una señal en una franja.
  const hoja = css();
  const enFondos = [...hoja.matchAll(/background:[^;]*var\(--e-[a-z]+\)/g)].map((m) => m[0]);

  // Las dos excepciones son los dos estados del propio punto.
  const permitidas = enFondos.filter((x) => !/--e-ok|--e-mal/.test(x));
  assert.deepEqual(permitidas, [],
    `un color de estado se uso como fondo: ${permitidas.join(" | ")}`);
});

test("el azul es el UNICO acento interactivo: enlaces, foco y nada mas", () => {
  const hoja = css();
  // Cada uso de `--azul` tiene que estar en una regla de enlace, de foco, o en
  // la etiqueta de "viva" —que es un anillo de color, no un relleno—.
  const lineas = hoja.split("\n").filter((l) => /var\(--azul\)/.test(l) && !/^\s*--azul/.test(l));
  assert.ok(lineas.length > 0, "el acento tiene que usarse en algun lado");

  for (const l of lineas) {
    const ok = /color:|outline|--foco|box-shadow/.test(l);
    assert.ok(ok, `el azul se uso fuera de un enlace o un foco: ${l.trim()}`);
  }
  assert.doesNotMatch(hoja, /background:\s*var\(--azul\)/,
    "el azul como relleno lo convierte en decoracion; es el unico acento y se reserva");
});

test("sombra en lugar de borde: nada usa la propiedad `border` para dibujar una linea", () => {
  const hoja = css();
  // `border: 0` es quitar el borde por omision de un control, no dibujar uno.
  const bordes = [...hoja.matchAll(/^\s*border:\s*([^;]+);/gm)].map((m) => m[1].trim());
  for (const b of bordes) {
    assert.match(b, /^(0|none)$/,
      `\`border: ${b}\` cambia el modelo de caja y mueve el contenido un pixel al pasar el mouse; se usa box-shadow`);
  }
});

test("la paleta de grises es acromatica de verdad: r = g = b", () => {
  // Un gris con una pizca de color tiñe la pantalla entera y no se nota hasta
  // que se lo compara. Se verifica sobre las variables de superficie y texto.
  const hoja = css();
  const grises = [...hoja.matchAll(/--(?:fondo|panel|hundido|linea|texto|texto-2|texto-3):\s*#([0-9a-f]{6})/gi)];
  assert.ok(grises.length >= 7, `se esperaban las dos paletas y se encontraron ${grises.length} valores`);

  for (const [, hex] of grises) {
    const [r, g, b] = [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)];
    assert.ok(r === g && g === b, `#${hex} no es un gris puro (${r}/${g}/${b})`);
  }
});

test("el espacio sale de la escala de 4: no hay valores sueltos en pixeles impares", () => {
  const hoja = css();
  const sueltos = [...hoja.matchAll(/(?:padding|margin|gap):\s*([^;]+);/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter((v) => /^\d+px$/.test(v))
    .map((v) => parseInt(v, 10))
    .filter((n) => n !== 0 && n % 4 !== 0);
  assert.deepEqual([...new Set(sueltos)], [],
    "hay espacios fuera de la escala de 4px: la escala existe para que no haya que decidir cada vez");
});

test("la pagina sigue sin pedir nada a la red, tambien despues del rediseño", () => {
  // Ya lo cubre el test del servidor; se repite aca porque el rediseño es
  // justamente cuando aparece la tentacion de traer una fuente.
  assert.doesNotMatch(PAGINA, /https?:\/\/(?!127\.0\.0\.1)[a-z]/i);
  assert.doesNotMatch(PAGINA, /@import|fonts\.googleapis|fonts\.gstatic/i);
});
