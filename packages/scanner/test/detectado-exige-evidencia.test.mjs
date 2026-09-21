// Principio X, la primera de las tres reglas del hallazgo.
//
// EL FALLO QUE EVITA. Un hallazgo `detectado` sin evidencia es una opinion
// vestida de hecho, y su precio es peor que el del verde inventado: el verde
// inventado se descubre cuando el codigo falla, pero un snapshot que afirma
// "arquitectura hexagonal" sin un directorio detras se convierte en la
// constitution del proyecto y el runtime la aplica durante meses. Cada tarea
// hereda la suposicion como si fuera un hecho verificado, y nadie vuelve a
// mirar de donde salio.
//
// POR QUE LA GUARDA VIVE EN EL NUCLEO Y NO EN CADA DETECTOR. Porque los
// detectores son el punto de extension: manana hay uno mas para un ecosistema
// que hoy no existe, escrito por alguien que no leyo esto. Una regla que
// depende de que cada autor se acuerde ya fallo en la tercera iteracion.

import { test } from "node:test";
import assert from "node:assert/strict";

import { escanear } from "../src/index.mjs";
import { DETECTORES } from "../src/detectores/index.mjs";
import { repoDe, ECOSISTEMAS, arbolTemporal } from "./ayuda.mjs";

/** Un detector que miente: afirma haber detectado algo y no trae con que. */
const MENTIROSO = {
  nombre: "mentiroso",
  fase: "estructura",
  detectar: () => [
    {
      categoria: "arquitectura",
      clave: "arquitectura.inventada",
      valor: "hexagonal",
      origen: "detectado",
      evidencia: [],
      confianza: "alta",
    },
    {
      categoria: "arquitectura",
      clave: "arquitectura.sin_campo",
      valor: "capas",
      origen: "detectado",
      confianza: "alta",
    },
    {
      categoria: "arquitectura",
      clave: "arquitectura.evidencia_vacia",
      valor: "microservicios",
      origen: "detectado",
      evidencia: [{ ruta: "" }],
      confianza: "alta",
    },
  ],
};

test("un hallazgo detectado sin evidencia no sale del scanner", async () => {
  const raiz = repoDe("node");
  /** @type {any[]} */
  const enVivo = [];
  const snapshot = await escanear({
    ruta: raiz,
    detectores: [MENTIROSO],
    alHallar: (h) => enVivo.push(h),
  });

  const claves = snapshot.hallazgos.map((h) => h.clave);
  assert.deepEqual(claves, [], `salieron hallazgos sin evidencia: ${claves.join(", ")}`);
  assert.deepEqual(enVivo, [], "un hallazgo sin evidencia se emitio en vivo aunque no llegara al snapshot");
});

test("lo descartado se declara descartado: no se pierde en silencio", async () => {
  // Filtrar sin decirlo es otra forma de inventar contexto, solo que hacia el
  // otro lado: el autor del detector no se entera de que su hallazgo no existe.
  const raiz = repoDe("node");
  const snapshot = await escanear({ ruta: raiz, detectores: [MENTIROSO] });

  assert.equal(snapshot.descartados.length, 3);
  for (const d of snapshot.descartados) {
    assert.equal(d.detector, "mentiroso");
    assert.ok(d.motivo.includes("evidencia"), `el motivo no nombra la causa: ${d.motivo}`);
    assert.ok(!("valor" in d), "el descarte arrastra el valor del hallazgo que se rechazo");
  }
});

test("ningun detector de verdad emite detectado sin evidencia, y la evidencia existe en el disco", async () => {
  // La guarda del nucleo protege del detector futuro. Este test protege de los
  // seis de hoy: una ruta de evidencia que no existe es una cita inventada.
  for (const nombre of Object.keys(ECOSISTEMAS)) {
    const raiz = repoDe(nombre);
    const snapshot = await escanear({ ruta: raiz });
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");

    for (const h of snapshot.hallazgos) {
      if (h.origen !== "detectado") continue;
      assert.ok(h.evidencia.length > 0, `${nombre}: ${h.clave} dice detectado sin evidencia`);
      for (const e of h.evidencia) {
        assert.ok(e.ruta, `${nombre}: ${h.clave} trae una evidencia sin ruta`);
        assert.ok(
          existsSync(join(raiz, e.ruta)),
          `${nombre}: ${h.clave} cita \`${e.ruta}\`, que no existe en el arbol`,
        );
      }
    }
  }
});

test("un hallazgo inferido no puede declararse con confianza alta", async () => {
  // Si estas seguro, detectalo con su ruta y su linea. "Inferido con confianza
  // alta" es la grafia con la que una suposicion se cuela como un hecho.
  const { inferido } = await import("../src/hallazgo.mjs");
  assert.throws(
    () => inferido("arquitectura", "arquitectura.capas", "hexagonal", [{ ruta: "src/" }], "alta"),
    /confianza alta/i,
  );
});

test("un detector que revienta no tumba el recorrido: se declara caido y el resto sigue", async () => {
  // Un ecosistema raro rompe a un detector, y el operador se queda sin snapshot
  // entero por un manifiesto mal formado que ni le importaba.
  const raiz = arbolTemporal({ "package.json": "{ esto no es json" });
  const explosivo = {
    nombre: "explosivo",
    fase: "estructura",
    detectar: () => {
      throw new Error("manifiesto imposible");
    },
  };
  const snapshot = await escanear({ ruta: raiz, detectores: [...DETECTORES, explosivo] });

  assert.equal(snapshot.estado, "completo");
  assert.equal(snapshot.detectores_caidos.length, 1);
  assert.equal(snapshot.detectores_caidos[0].detector, "explosivo");
  assert.match(snapshot.detectores_caidos[0].causa, /manifiesto imposible/);
  assert.ok(snapshot.hallazgos.length > 0, "el resto de los detectores tenia que haber corrido igual");
});
