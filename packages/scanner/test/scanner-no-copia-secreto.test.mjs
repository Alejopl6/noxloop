// Principio IX, en el unico sitio del scanner donde se puede violar.
//
// EL FALLO QUE EVITA. El scanner es lo unico de este producto que lee, linea a
// linea, archivos que no son suyos. Si encuentra una credencial y la transcribe
// al hallazgo "para que se vea el contexto", acaba de crear una segunda copia
// del problema en un almacen nuevo — uno que ademas se sincroniza, se indexa y
// se muestra en una pantalla. Un snapshot que dice "hay una clave en `.env:3`"
// es util; uno que ademas la copia es un incidente.
//
// POR QUE CON CENTINELA Y SOBRE EL SNAPSHOT SERIALIZADO. Porque la redaccion se
// prueba sobre el objeto que se persiste, no sobre la intencion del codigo que
// lo construyo. Se planta un valor imposible de encontrar por accidente y se
// busca ESE valor en el JSON completo. Da igual por que campo se hubiera
// filtrado: truncado, ofuscado, dentro de un extracto de otro detector o en un
// comando de CI. Si aparece, el test cae.

import { test } from "node:test";
import assert from "node:assert/strict";

import { escanear } from "../src/index.mjs";
import { arbolTemporal } from "./ayuda.mjs";

const CENTINELA = "zqx7CENTINELAsinSegundaCopia9f4d2b1e8a";

const CON_SECRETOS = {
  "package.json": JSON.stringify({ name: "ejemplo", type: "module" }, null, 2),
  ".env": `PUERTO=3000\nCLAVE_DE_API=${CENTINELA}\n`,
  "src/config.js": `export const token = "${CENTINELA}";\n`,
  "despliegue/llave.pem": `-----BEGIN RSA PRIVATE KEY-----\n${CENTINELA}\n-----END RSA PRIVATE KEY-----\n`,
  // El mismo valor por un camino que NO es el detector de riesgos: si un
  // extracto de CI lo arrastrara, la fuga entraria por la puerta de al lado.
  ".github/workflows/ci.yml": `name: ci\non: [push]\njobs:\n  d:\n    steps:\n      - run: desplegar --token ${CENTINELA}\n`,
  "README.md": `Configura la clave asi: \`export CLAVE_DE_API=${CENTINELA}\`\n`,
};

test("el centinela no aparece en ninguna parte del snapshot serializado", async () => {
  const raiz = arbolTemporal(CON_SECRETOS);
  const snapshot = await escanear({ ruta: raiz });

  const serializado = JSON.stringify(snapshot);
  assert.ok(
    !serializado.includes(CENTINELA),
    "el valor del secreto viajo dentro del snapshot: hay una segunda copia del problema",
  );
  // Ni siquiera un trozo: truncar no es redactar.
  assert.ok(!serializado.includes(CENTINELA.slice(0, 12)), "el secreto viajo truncado, que sigue siendo copiarlo");
});

test("tampoco aparece en los hallazgos que se emiten en vivo", async () => {
  // La lista crece mientras corre, asi que el camino en vivo es un segundo
  // sitio por donde el valor puede salir antes de que nadie mire el snapshot.
  const raiz = arbolTemporal(CON_SECRETOS);
  /** @type {any[]} */
  const enVivo = [];
  await escanear({ ruta: raiz, alHallar: (h) => enVivo.push(h) });

  assert.ok(enVivo.length > 0, "no se emitio nada en vivo: el test no estaria probando nada");
  assert.ok(!JSON.stringify(enVivo).includes(CENTINELA));
});

test("el hallazgo trae la ruta y la linea, que es lo unico que hace falta para arreglarlo", async () => {
  const raiz = arbolTemporal(CON_SECRETOS);
  const snapshot = await escanear({ ruta: raiz });

  const secretos = snapshot.hallazgos.filter((h) => h.clave === "riesgos.secreto");
  assert.ok(secretos.length >= 3, `se esperaban al menos tres secretos, salieron ${secretos.length}`);

  const rutas = secretos.flatMap((h) => h.evidencia.map((e) => e.ruta));
  assert.ok(rutas.includes(".env"), "no se vio el secreto del .env");
  assert.ok(rutas.includes("src/config.js"), "no se vio el secreto del codigo");
  assert.ok(rutas.includes("despliegue/llave.pem"), "no se vio la clave privada");

  for (const h of secretos) {
    assert.equal(h.origen, "detectado");
    for (const e of h.evidencia) {
      assert.equal(typeof e.linea, "number", `${e.ruta}: un secreto sin linea obliga a buscarlo a mano`);
      assert.ok(e.linea > 0);
      assert.equal(e.extracto, undefined, `${e.ruta}: un extracto en un hallazgo de secreto es el valor otra vez`);
    }
    assert.ok(h.valor.tipo, "el hallazgo no dice que clase de secreto es");
  }
});

test("un .env que git ignora no es un riesgo de versionado, y uno versionado si", async () => {
  const versionado = arbolTemporal({ ".env": "CLAVE=x\n", "package.json": "{}" });
  const ignorado = arbolTemporal({ ".gitignore": ".env\n", ".env": "CLAVE=x\n", "package.json": "{}" });

  const conRiesgo = await escanear({ ruta: versionado });
  const sinRiesgo = await escanear({ ruta: ignorado });

  const halla = (s, clave) => s.hallazgos.find((h) => h.clave === clave);
  assert.ok(halla(conRiesgo, "riesgos.env_versionado").valor.rutas.includes(".env"));
  assert.equal(halla(sinRiesgo, "riesgos.env_versionado").valor, null);
  assert.ok(
    halla(sinRiesgo, "riesgos.env_versionado").motivo.length > 20,
    "el hueco se declara con la constancia de que se busco",
  );
});

test("`clave` es una palabra de todos los dias: el codigo en castellano no es una lista de secretos", async () => {
  // EL FALLO QUE ESTE TEST FIJA, MEDIDO SOBRE ESTE MISMO REPOSITORIO. La
  // primera version del detector emitio 27 hallazgos de secreto aqui y ninguno
  // lo era: `const clave = String(n.issue.id)`, `const claves =
  // Object.keys(valor)`, `clave: "guidelines.contributing"`. Veintisiete avisos
  // falsos no son un detector ruidoso, son un detector apagado: el operador
  // aprende en la primera pantalla que esa lista no se mira, y el dia que
  // aparezca la credencial de verdad estara en la linea 28 de algo que ya nadie
  // abre.
  const raiz = arbolTemporal({
    "package.json": "{}",
    "src/indice.mjs": [
      "const clave = String(nodo.issue.id);",
      "const claves = Object.keys(valor).sort();",
      "export const porClave = { clave: 'guidelines.contributing' };",
      "return { modo: 'web', token: tokenDeSesionEnMemoria };",
      "const secretoDerivado = scryptSync(frase, sal, largo);",
      "nombresSecretos: Object.keys(privadas).sort(),",
      "const apiKey = configuracion.apiKey;",
    ].join("\n"),
    "docs/GUIA.md": "**Configuracion.** Un solo secreto: `TOKEN_DE_API`, que va en la cabecera.\n",
  });

  const snapshot = await escanear({ ruta: raiz });
  const secretos = snapshot.hallazgos
    .filter((h) => h.clave === "riesgos.secreto")
    .map((h) => `${h.evidencia[0].ruta}:${h.evidencia[0].linea}`);
  assert.deepEqual(secretos, [], `el detector confundio codigo con credenciales en: ${secretos.join(", ")}`);
});

test("un placeholder no es un secreto: avisar de lo que no pasa entrena a ignorar los avisos", async () => {
  const raiz = arbolTemporal({
    "package.json": "{}",
    ".env.example": "CLAVE_DE_API=tu-clave-aqui\nTOKEN=${TOKEN}\nSECRETO=changeme\n",
    "src/leer.js": "const clave = process.env.CLAVE_DE_API;\n",
  });
  const snapshot = await escanear({ ruta: raiz });
  const secretos = snapshot.hallazgos.filter((h) => h.clave === "riesgos.secreto");
  assert.deepEqual(
    secretos.map((h) => h.evidencia[0].ruta),
    [],
    "se reporto como secreto un valor que claramente es un hueco para rellenar",
  );
});
