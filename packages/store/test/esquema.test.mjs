// El esquema real, leido de la base, no del codigo que lo crea.
//
// POR QUE SE LEE `PRAGMA table_info` Y NO EL ARCHIVO `esquema.mjs`. Una prueba
// que hace `assert.ok(!esquema.includes("valor"))` sobre el texto del modulo
// afirma que el autor no escribio esa palabra, que no es lo mismo que afirmar
// que la columna no existe. La columna puede llegar por una migracion
// posterior, por un `ALTER TABLE` en otro archivo o por un `CREATE TABLE` que
// el grep no ve porque parte el SQL en dos trozos. Lo que hay que interrogar es
// la base abierta: ahi esta la verdad, y ahi es donde va a escribir el servicio.

import { test } from "node:test";
import assert from "node:assert/strict";

import { almacenDePrueba, centinela, credencialDePrueba } from "./ayuda.mjs";

/** Las tablas que `data-model.md` obliga a que existan. */
const TABLAS_ESPERADAS = [
  "agent",
  "audit_event",
  // El orden a mano del board (spec 005, FR-005).
  "card_order",
  "connection",
  "constitution",
  "constitution_amendment",
  "credential",
  "danger_policy",
  "grant",
  "guideline",
  "inbox_entry",
  // Las tareas propias (spec 003, FR-030): el gestor local vive aqui, con su
  // numeracion por proyecto y sus comentarios.
  "local_task",
  "local_task_comment",
  "local_task_sequence",
  // La decision sobre una tarjeta «movida» (spec 005, FR-004).
  "movida_decision",
  "project",
  "project_snapshot",
  "recommendation",
  // Los ajustes del servicio (spec 005, FR-006): el limite de runs simultaneos.
  "service_setting",
  "snapshot_finding",
  "ssh_access",
  "workspace",
];

/** @param {any} base @param {string} tabla */
function columnas(base, tabla) {
  return base.consultar("SELECT name FROM pragma_table_info(?)", [tabla]).map((f) => f.name);
}

/** Todo lo que hay escrito en la base, esquema y filas, como un solo texto. */
function volcadoDeLaBase(base) {
  const trozos = base.consultar("SELECT COALESCE(sql, '') AS sql FROM sqlite_master").map((f) => f.sql);
  for (const tabla of [...TABLAS_ESPERADAS, "esquema_migracion"]) {
    for (const fila of base.consultar(`SELECT * FROM "${tabla}"`)) trozos.push(JSON.stringify(fila));
  }
  return trozos.join("\n");
}

test("estan las tablas de las 14 entidades de `data-model.md`, con sus tres sub-entidades", () => {
  const { almacen } = almacenDePrueba();
  const presentes = almacen.base
    .consultar("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .map((f) => f.name)
    .filter((n) => n !== "esquema_migracion");
  assert.deepEqual(presentes, TABLAS_ESPERADAS);
  almacen.cerrar();
});

test("EL INVARIANTE (FR-041): `credential` no tiene NINGUNA columna donde quepa el valor", () => {
  const { almacen } = almacenDePrueba();

  // La lista se declara aqui, entera, a proposito: cualquier columna nueva en
  // `credential` rompe esta prueba y obliga a mirarla. Es el unico sitio del
  // repositorio donde agregar una columna tiene que costar una decision.
  assert.deepEqual(columnas(almacen.base, "credential"), [
    "id",
    "workspace_id",
    "nombre",
    "proveedor",
    "tipo",
    "ambito",
    "project_id",
    "alcance_declarado",
    "huella",
    "ref_boveda",
    "backend",
    "creada",
    "rotada",
    "expira",
    "aviso_dias_antes",
    "estado",
  ]);
  almacen.cerrar();
});

test("ninguna tabla del almacen tiene una columna con nombre de secreto", () => {
  // No solo `credential`: la fuga entra igual por un `token` en `connection` o
  // un `password` en `ssh_access`, y esos son los sitios donde nadie mira.
  //
  // `valor` NO esta en la lista global porque `snapshot_finding.valor` es un
  // uso legitimo —el dato tecnico leido del proyecto— y meterlo obligaria a
  // desactivar la guarda entera. Se prohibe `valor` solo en las tablas que
  // modelan credenciales y accesos, que es donde significaria lo otro.
  const { almacen } = almacenDePrueba();
  const SOSPECHOSAS =
    /^(secreto|secret|token|password|contrasena|clave_privada|private_key|api_key|credencial_valor|valor_credencial)$/i;
  const TABLAS_DE_SECRETO = ["credential", "ssh_access", "connection", "grant", "agent"];
  const hallazgos = [];
  for (const tabla of TABLAS_ESPERADAS) {
    for (const columna of columnas(almacen.base, tabla)) {
      if (SOSPECHOSAS.test(columna)) hallazgos.push(`${tabla}.${columna}`);
      if (TABLAS_DE_SECRETO.includes(tabla) && /^valor(_.*)?$/i.test(columna)) hallazgos.push(`${tabla}.${columna}`);
    }
  }
  assert.deepEqual(hallazgos, [], `hay columnas donde cabe un secreto:\n${hallazgos.join("\n")}`);
  almacen.cerrar();
});

test("un `valor` colado en el objeto que se guarda no llega a la base por ningun camino", () => {
  // EL FALLO QUE EVITA, Y ES EL CAMINO REAL. Nadie escribe `INSERT INTO
  // credential (valor)`. Lo que se escribe es `guardarCredencial({...credencial,
  // valor})` en un sitio donde el valor estaba a mano, y un repositorio que
  // arma el INSERT con `Object.keys(fila)` lo guarda sin que nadie lo vea. Por
  // eso el repositorio mapea campo por campo desde una lista declarada, y por
  // eso esta prueba busca el centinela en el VOLCADO ENTERO de la base: no en
  // la tabla `credential`, en todas.
  const { almacen, workspace } = almacenDePrueba();
  const valor = centinela("credencial");
  almacen.boveda.guardarCredencial({
    ...credencialDePrueba({ workspace_id: workspace.id }),
    valor,
    secreto: valor,
  });

  const filas = almacen.base.consultar("SELECT * FROM credential");
  assert.equal(filas.length, 1, "la credencial no se guardo, asi que la prueba no prueba nada");
  assert.ok(!("valor" in filas[0]), "la fila trae una propiedad `valor`");

  const volcado = volcadoDeLaBase(almacen.base);
  assert.ok(!volcado.includes(valor), "el centinela quedo escrito en la base");
  assert.ok(!JSON.stringify(almacen.boveda.instantanea()).includes(valor));
  almacen.cerrar();
});

test("intentar escribir el valor en `credential` es un error de SQL, no un campo que se ignora en silencio", () => {
  // EL FALLO QUE EVITA. Si el almacen aceptara `INSERT ... (valor)` y lo tirara,
  // quien lo escribio creeria que lo guardo y no volveria a mirarlo. Que
  // reviente es la unica forma de que el diff que lo intenta no se mergee.
  const { almacen, workspace } = almacenDePrueba();
  const c = credencialDePrueba({ workspace_id: workspace.id });
  assert.throws(
    () =>
      almacen.base.escribir(
        "INSERT INTO credential (id, workspace_id, nombre, proveedor, tipo, ambito, alcance_declarado, " +
          "ref_boveda, backend, creada, valor) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [
          c.id,
          workspace.id,
          c.nombre,
          c.proveedor,
          c.tipo,
          c.ambito,
          c.alcance_declarado,
          c.ref_boveda,
          c.backend,
          "2026-01-01T00:00:00.000Z",
          centinela("sql"),
        ],
      ),
    /valor/,
  );
  almacen.cerrar();
});

test("las tablas son STRICT: una columna de texto no acepta un numero que luego nadie sabe comparar", () => {
  // EL FALLO QUE EVITA. Sin STRICT, SQLite guarda en una columna TEXT lo que le
  // echen. Un `estado` guardado como entero por un cliente descuidado no casa
  // con ningun `WHERE estado = 'viva'` y el proyecto desaparece de la bandeja
  // sin ningun error por ningun lado.
  const { almacen } = almacenDePrueba();
  const sinStrict = [];
  for (const tabla of [...TABLAS_ESPERADAS, "esquema_migracion"]) {
    const fila = almacen.base.consultarUno("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", [tabla]);
    if (!/\bSTRICT\b/i.test(fila.sql)) sinStrict.push(tabla);
  }
  assert.deepEqual(sinStrict, [], `tablas sin STRICT:\n${sinStrict.join("\n")}`);
  almacen.cerrar();
});

test("las claves foraneas estan encendidas: un hijo huerfano se rechaza al escribirlo", () => {
  const { almacen } = almacenDePrueba();
  assert.throws(() => almacen.snapshots.crear({ project_id: "no-existe", commit: "b".repeat(40) }), /FOREIGN KEY/i);
  almacen.cerrar();
});

test("el workspace guarda la version de esquema que de verdad tiene la base", () => {
  const { almacen, workspace } = almacenDePrueba();
  assert.equal(workspace.version_esquema, almacen.version);
  assert.ok(almacen.version > 0);
  almacen.cerrar();
});
