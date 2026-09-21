// T103 / FR-021 / FR-022 — la constitution se escribe versionada en el
// repositorio del proyecto y el proyecto pasa a `CONSTITUTED`.
//
// POR QUE EN EL REPOSITORIO Y NO SOLO EN EL ALMACEN. Porque un proyecto clonado
// en otra maquina tiene que traer su contexto sin traer la base de datos. El
// almacen guarda el puntero y la copia indexada; el repositorio guarda la
// verdad. Si la constitution vive solo en el almacen, el runtime que corre en
// otra maquina —o en CI— trabaja sin las reglas del proyecto y nadie se entera:
// simplemente produce codigo que las ignora.
//
// Y por eso la version anterior tambien se archiva en el arbol: "recuperable"
// no puede depender de que la base de datos siga existiendo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  arbolDeDisco,
  repositorioEnMemoria,
  fijarConstitution,
  aplicarEnmienda,
  rutaDeConstitution,
} from "../src/index.mjs";
import { hallazgo, snapshotDe, directorioDePrueba } from "./ayuda.mjs";

const AHORA = Date.parse("2026-09-20T10:00:00.000Z");
const DESPUES = Date.parse("2026-10-01T10:00:00.000Z");

const CONTENIDO = "# Constitution\n\n### I. El test primero\n\nNinguna escritura antes del rojo.\n";

const TRES_CAMPOS = {
  principio: "El criterio de exito es un exit code",
  fallo_que_motiva: "un agente declaro verde un gate que nunca corrio y el fallo llego a la rama principal",
  que_se_rompe_si_no: "un verde inventado se mergea, que es peor que un rojo porque nadie lo mira otra vez",
};

/**
 * @param {import("node:test").TestContext} t
 */
function montar(t) {
  const raiz = directorioDePrueba(t);
  const arbol = arbolDeDisco(raiz);
  const repositorio = repositorioEnMemoria();
  repositorio.guardarProyecto({ id: "prj_1", nombre: "proyecto", origen: "local", estado: "DISCOVERED" });
  return { raiz, arbol, repositorio };
}

test("la ruta sale de donde el snapshot la encontro, no de un default", () => {
  // EL FALLO QUE EVITA: adoptar un proyecto que ya tiene su constitution en un
  // sitio y escribirle otra al lado. A partir de ahi hay dos, y el runtime lee
  // la que no es.
  const conDeteccion = snapshotDe([
    hallazgo("guidelines.constitution", { ruta: "docs/reglas.md", version: "2.1.0" }, {
      evidencia: [{ ruta: "docs/reglas.md" }],
    }),
  ]);
  assert.equal(rutaDeConstitution(conDeteccion).ruta, "docs/reglas.md");
  assert.equal(rutaDeConstitution(conDeteccion).origen, "detectado");

  const sinDeteccion = rutaDeConstitution(snapshotDe([]));
  assert.equal(sinDeteccion.origen, "inferido", "una ruta que nadie detecto no puede presentarse como detectada");
  assert.ok(sinDeteccion.ruta.length > 0);
});

test("fijar escribe el documento en el arbol del proyecto y deja el proyecto en CONSTITUTED", (t) => {
  const { raiz, arbol, repositorio } = montar(t);
  const { constitution, proyecto, escrituras } = fijarConstitution({
    project_id: "prj_1",
    contenido: CONTENIDO,
    ruta_en_repo: "docs/constitution.md",
    arbol,
    repositorio,
    ahora: AHORA,
  });

  assert.deepEqual(escrituras, ["docs/constitution.md"]);
  const enDisco = readFileSync(join(raiz, "docs/constitution.md"), "utf8");
  assert.match(enDisco, /### I\. El test primero/);
  assert.match(enDisco, /\*\*Version\*\*: 1\.0\.0/, "el archivo salio sin el pie que dice que version es");
  assert.equal(proyecto.estado, "CONSTITUTED");
  assert.equal(repositorio.constitutionVigente("prj_1").id, constitution.id);
});

test("no se transiciona sin el artefacto: fijar sobre un proyecto inexistente falla con causa", (t) => {
  const { arbol, repositorio } = montar(t);
  assert.throws(
    () =>
      fijarConstitution({
        project_id: "prj_ausente",
        contenido: CONTENIDO,
        ruta_en_repo: "CONSTITUTION.md",
        arbol,
        repositorio,
        ahora: AHORA,
      }),
    (/** @type {any} */ e) => e.codigo === "proyecto_desconocido" && e.accion.length > 20,
  );
});

test("un contenido vacio no se fija: una constitution en blanco es peor que ninguna", (t) => {
  const { arbol, repositorio } = montar(t);
  assert.throws(
    () =>
      fijarConstitution({
        project_id: "prj_1",
        contenido: "   \n",
        ruta_en_repo: "CONSTITUTION.md",
        arbol,
        repositorio,
        ahora: AHORA,
      }),
    (/** @type {any} */ e) => e.codigo === "constitution_vacia",
  );
});

test("la enmienda archiva la version anterior en el propio arbol y la deja recuperable sin el almacen", (t) => {
  const { raiz, arbol, repositorio } = montar(t);
  fijarConstitution({
    project_id: "prj_1",
    contenido: CONTENIDO,
    ruta_en_repo: "docs/constitution.md",
    arbol,
    repositorio,
    ahora: AHORA,
  });

  // Lo que se archiva es lo que HAY en el arbol, no lo que el almacen cree que
  // hay: el documento esta versionado junto al codigo y alguien puede haberlo
  // editado a mano, que es justo para lo que sirve tenerlo ahi.
  const antesDeEnmendar = readFileSync(join(raiz, "docs/constitution.md"), "utf8");

  const { constitution, enmienda, escrituras } = aplicarEnmienda({
    project_id: "prj_1",
    datos: { ...TRES_CAMPOS, contenido: CONTENIDO + "\n### II. El exit code\n" },
    arbol,
    repositorio,
    ahora: DESPUES,
  });

  assert.equal(constitution.version, "1.1.0");
  assert.ok(escrituras.includes("docs/constitution.md"));

  const archivada = escrituras.find((/** @type {string} */ r) => r.includes("1.0.0"));
  assert.ok(archivada, `la version anterior no se archivo en el arbol: ${JSON.stringify(escrituras)}`);
  assert.equal(readFileSync(join(raiz, archivada), "utf8"), antesDeEnmendar);

  const registro = escrituras.find((/** @type {string} */ r) => /enmienda/.test(r));
  assert.ok(registro, "la enmienda no dejo constancia en el arbol");
  const texto = readFileSync(join(raiz, registro), "utf8");
  for (const campo of ["principio", "fallo_que_motiva", "que_se_rompe_si_no"]) {
    assert.match(texto, new RegExp(campo.replace(/_/g, "[ _]")), `el registro no trae \`${campo}\``);
  }
  assert.match(texto, /2026-10-01/, "el registro no trae la fecha");
  assert.equal(enmienda.version_anterior, "1.0.0");
});

test("la escritura es atomica: no queda ningun temporal cuando termina", (t) => {
  const { raiz, arbol, repositorio } = montar(t);
  fijarConstitution({
    project_id: "prj_1",
    contenido: CONTENIDO,
    ruta_en_repo: "CONSTITUTION.md",
    arbol,
    repositorio,
    ahora: AHORA,
  });
  const sobrantes = readdirSync(raiz).filter((n) => /\.tmp|\.swp|~$/.test(n));
  assert.deepEqual(sobrantes, [], `quedaron temporales: ${sobrantes.join(", ")}`);
});

test("el arbol se niega a escribir fuera de la raiz del proyecto", (t) => {
  const { arbol } = montar(t);
  for (const ruta of ["../fuera.md", "/etc/passwd", "a/../../fuera.md"]) {
    assert.throws(
      () => arbol.escribir(ruta, "x"),
      (/** @type {any} */ e) => e.codigo === "ruta_fuera_del_proyecto",
      `\`${ruta}\` se escribio fuera del proyecto`,
    );
  }
});

test("fijar no pisa un archivo distinto que ya estuviera ahi sin decirlo", (t) => {
  // Adoptar un proyecto que ya tiene reglas escritas y sobreescribirlas sin
  // avisar es la primera forma de perder la confianza del operador.
  const { raiz, arbol, repositorio } = montar(t);
  mkdirSync(join(raiz, "docs"), { recursive: true });
  writeFileSync(join(raiz, "docs/constitution.md"), "# Las reglas que ya habia\n");

  assert.throws(
    () =>
      fijarConstitution({
        project_id: "prj_1",
        contenido: CONTENIDO,
        ruta_en_repo: "docs/constitution.md",
        arbol,
        repositorio,
        ahora: AHORA,
      }),
    (/** @type {any} */ e) => e.codigo === "constitution_ya_existe" && e.causa.includes("docs/constitution.md"),
  );

  // Con la sobreescritura declarada, se escribe.
  const { escrituras } = fijarConstitution({
    project_id: "prj_1",
    contenido: CONTENIDO,
    ruta_en_repo: "docs/constitution.md",
    arbol,
    repositorio,
    ahora: AHORA,
    sobreescribir: true,
  });
  assert.deepEqual(escrituras, ["docs/constitution.md"]);
});
