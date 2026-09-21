// T194 — el compilador de contexto, y su PRECEDENCIA escrita como dato.
//
// POR QUE LA PRECEDENCIA ES UNA TABLA Y NO UNA CADENA DE `if`s. Es una de las
// decisiones que §20 marcaba para congelar: tiene que poder leerse y discutirse
// sin leer el compilador. Escondida en el codigo, cada nueva fuente la reabre
// sin que nadie lo note, y dos meses despues nadie sabe por que una guideline
// gana a un work item — ni si eso se decidio o simplemente salio asi.

import { test } from "node:test";
import assert from "node:assert/strict";

import { PRECEDENCIA, compilarContexto, fuenteQueGana } from "../src/contexto/compilador.mjs";

const CONSTITUTION = {
  version: "1.2.0",
  ruta_en_repo: "CONSTITUTION.md",
  contenido: "# Constitution\n\nI. El test primero.",
  invariantes: [{ id: "tdd", enunciado: "ninguna escritura antes del rojo" }],
};

const GUIDELINES = [
  {
    area: "backend",
    ruta_en_repo: "guidelines/backend.md",
    documento: "# backend\n- usa fastify",
    reglas_aplicables: [{ id: "cobertura", enunciado: "cobertura minima 80", comprobacion: { tipo: "comando", comando: "npm run cov" } }],
    documentacion: [],
  },
  {
    area: "testing",
    ruta_en_repo: "guidelines/testing.md",
    documento: "# testing\n- node:test",
    reglas_aplicables: [],
    documentacion: [{ id: "estilo", enunciado: "tests legibles", motivo: "no se puede comprobar sola" }],
  },
];

const DISENO = {
  area: "diseno",
  ruta_en_repo: "guidelines/diseno.md",
  documento: "# diseno\n- tokens",
  reglas_aplicables: [],
  documentacion: [],
};

const WORK_ITEM = {
  id: "IT-7",
  title: "arreglar el importador",
  level: "story",
  url: "https://ejemplo/IT-7",
  acceptance: ["el importador no pierde filas"],
};

test("la precedencia es un dato legible, con su motivo escrito al lado", () => {
  assert.ok(Array.isArray(PRECEDENCIA));
  assert.deepEqual(
    PRECEDENCIA.map((f) => f.fuente),
    ["constitution", "guidelines", "diseno", "work_item"],
  );
  // Menor peso = manda. Estrictamente creciente: dos fuentes con el mismo peso
  // es un empate sin arbitro, y un empate se resuelve por el orden en que se
  // leyo — o sea, por casualidad.
  const pesos = PRECEDENCIA.map((f) => f.peso);
  assert.deepEqual(pesos, [...pesos].sort((a, b) => a - b));
  assert.equal(new Set(pesos).size, pesos.length);

  for (const f of PRECEDENCIA) {
    assert.ok(f.porque && f.porque.length > 40, `\`${f.fuente}\` no dice por que esta donde esta`);
    assert.ok(Number.isInteger(f.orden), `\`${f.fuente}\` no declara su orden de presentacion`);
  }

  // Normativa y presentacion son dos cosas distintas y estan separadas a
  // proposito: la constitution MANDA, pero el work item es lo ultimo que lee
  // quien va a trabajar. Fundirlas obliga a elegir una y perder la otra.
  assert.equal(fuenteQueGana("constitution", "work_item"), "constitution");
  assert.equal(fuenteQueGana("work_item", "guidelines"), "guidelines");
  assert.equal(fuenteQueGana("guidelines", "diseno"), "guidelines");
});

test("el contexto compilado presenta las cuatro fuentes en el orden declarado", () => {
  const ctx = compilarContexto({
    constitution: CONSTITUTION,
    guidelines: GUIDELINES,
    diseno: DISENO,
    work_item: WORK_ITEM,
  });

  assert.deepEqual(
    ctx.secciones.map((s) => s.fuente),
    PRECEDENCIA.slice().sort((a, b) => a.orden - b.orden).map((f) => f.fuente),
  );
  const texto = ctx.documento;
  assert.ok(texto.indexOf("CONSTITUTION.md") < texto.indexOf("IT-7"), "el work item quedo antes que la constitution");
  assert.ok(texto.includes("arreglar el importador"));
  assert.ok(texto.includes("cobertura minima 80"));
});

test("las reglas verificables se juntan, y la fuente de mas peso gana el choque de ids", () => {
  const guidelinesQueContradicen = [
    ...GUIDELINES,
    {
      area: "agentes",
      ruta_en_repo: "guidelines/agentes.md",
      documento: "# agentes",
      // Mismo id que un invariante de la constitution: la guideline pierde.
      reglas_aplicables: [{ id: "tdd", enunciado: "se puede escribir antes del test si urge", comprobacion: { tipo: "comando", comando: "true" } }],
      documentacion: [],
    },
  ];

  const ctx = compilarContexto({
    constitution: CONSTITUTION,
    guidelines: guidelinesQueContradicen,
    diseno: DISENO,
    work_item: WORK_ITEM,
  });

  const tdd = ctx.reglas.find((r) => r.id === "tdd");
  assert.equal(tdd.fuente, "constitution");
  assert.equal(tdd.enunciado, "ninguna escritura antes del rojo");

  // Y NO se descarta en silencio: la regla que perdio queda anotada con quien
  // le gano y por que. Silenciarla deja a quien la escribio creyendo que esta
  // vigente, que es el mismo fallo que las guidelines no verificables cierran.
  assert.equal(ctx.conflictos.length, 1);
  assert.equal(ctx.conflictos[0].id, "tdd");
  assert.equal(ctx.conflictos[0].gana, "constitution");
  assert.equal(ctx.conflictos[0].pierde, "guidelines");
  assert.ok(ctx.conflictos[0].porque.length > 20);
  assert.ok(ctx.documento.includes("tdd"), "el conflicto no aparece en el documento que recibe el run");
});

test("principio X — una fuente que falta se declara hueco, no se omite", () => {
  const ctx = compilarContexto({
    constitution: CONSTITUTION,
    guidelines: [],
    diseno: null,
    work_item: WORK_ITEM,
  });

  const huecos = ctx.secciones.filter((s) => s.estado === "vacio").map((s) => s.fuente).sort();
  assert.deepEqual(huecos, ["diseno", "guidelines"]);
  for (const s of ctx.secciones.filter((x) => x.estado === "vacio")) {
    assert.ok(s.constancia.length > 20, `\`${s.fuente}\` esta vacia sin constancia de que se busco`);
    assert.ok(ctx.documento.includes(s.constancia), "la constancia del hueco no llega al run");
  }
  assert.equal(ctx.secciones.find((s) => s.fuente === "constitution").estado, "presente");
});

test("el diseño omitido se distingue de el diseño que nadie miro", () => {
  // FR-023: la etapa es omitible sin penalizacion. Pero "omitida a proposito" y
  // "vacia" no son lo mismo: la primera es una decision registrada, la segunda
  // es un hueco. Fundirlas hace que el runtime no pueda decir cual fue.
  const ctx = compilarContexto({
    constitution: CONSTITUTION,
    guidelines: GUIDELINES,
    diseno: { omitida: true, motivo: "el proyecto no tiene superficie visual" },
    work_item: WORK_ITEM,
  });
  const s = ctx.secciones.find((x) => x.fuente === "diseno");
  assert.equal(s.estado, "omitida");
  assert.ok(s.constancia.includes("no tiene superficie visual"));
});

test("sin work item no se compila: un contexto sin trabajo no es un contexto", () => {
  assert.throws(
    () => compilarContexto({ constitution: CONSTITUTION, guidelines: [], diseno: null, work_item: null }),
    /work_item/,
  );
});

test("sin constitution no se compila: es la fuente que manda, y un hueco ahi no es un hueco", () => {
  // Las otras tres pueden faltar y declararse vacias. Esta no: si la fuente de
  // mas peso falta, lo que queda no es "un contexto con menos", es un contexto
  // donde la siguiente fuente manda sin que nadie lo haya decidido.
  assert.throws(
    () => compilarContexto({ constitution: null, guidelines: [], diseno: null, work_item: WORK_ITEM }),
    /constitution/,
  );
});

test("el contexto compilado es serializable y no arrastra funciones ni objetos vivos", () => {
  const ctx = compilarContexto({
    constitution: CONSTITUTION, guidelines: GUIDELINES, diseno: DISENO, work_item: WORK_ITEM,
  });
  const ida = JSON.parse(JSON.stringify(ctx));
  assert.deepEqual(ida.reglas, ctx.reglas);
  assert.equal(ida.documento, ctx.documento);
  assert.equal(typeof ctx.huella, "string", "el contexto no lleva huella: no se puede saber si dos runs vieron lo mismo");
  assert.notEqual(
    ctx.huella,
    compilarContexto({ constitution: CONSTITUTION, guidelines: [], diseno: DISENO, work_item: WORK_ITEM }).huella,
    "la huella no cambia al cambiar el contexto: no sirve para comparar dos runs",
  );
});
