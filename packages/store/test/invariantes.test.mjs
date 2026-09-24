// Los invariantes que `data-model.md` marca en negrita, puestos donde no se
// pueden rodear: en la propia base.
//
// POR QUE EN LA BASE Y NO EN EL REPOSITORIO. Un invariante comprobado en el
// repositorio protege al que entra por el repositorio. El almacen lo abre
// tambien una migracion, una consola de soporte y el proximo frente que
// escriba su propio SQL porque "es una consulta tonta". Un `CHECK` y un
// disparador se cumplen para todos, y sobreviven a que alguien reescriba el
// repositorio entero.

import { test } from "node:test";
import assert from "node:assert/strict";

import { almacenDePrueba, capturar, proyectoDePrueba } from "./ayuda.mjs";
import { ErrorDeAlmacen } from "../src/errores.mjs";

test("FR-013: un hallazgo `detectado` SIN evidencia no se persiste", () => {
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = proyectoDePrueba(almacen, workspace.id);
  const s = almacen.snapshots.crear({ project_id: proyecto.id, commit: "a".repeat(40) });

  const error = capturar(() =>
    almacen.snapshots.agregarHallazgo({
      snapshot_id: s.id,
      categoria: "arquitectura",
      clave: "arquitectura.estilo",
      valor: { estilo: "hexagonal" },
      origen: "detectado",
      evidencia: [],
      confianza: "alta",
    }),
  );
  assert.ok(error instanceof ErrorDeAlmacen);
  assert.equal(error.codigo, "hallazgo_sin_evidencia");
  assert.match(error.causa, /detectado/);
  assert.equal(almacen.base.consultarUno("SELECT count(*) AS n FROM snapshot_finding").n, 0);
  almacen.cerrar();
});

test("FR-013 en la base: el INSERT crudo de un `detectado` sin evidencia tambien se aborta", () => {
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = proyectoDePrueba(almacen, workspace.id);
  const s = almacen.snapshots.crear({ project_id: proyecto.id, commit: "a".repeat(40) });
  assert.throws(
    () =>
      almacen.base.escribir(
        "INSERT INTO snapshot_finding (id, snapshot_id, categoria, clave, valor, origen, evidencia, confianza) " +
          "VALUES (?,?,?,?,?,?,?,?)",
        ["h1", s.id, "arquitectura", "arquitectura.estilo", "{}", "detectado", "[]", "alta"],
      ),
    /CHECK/i,
  );
  almacen.cerrar();
});

test("un hallazgo `inferido` SI puede no traer evidencia: lo que declara es su confianza", () => {
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = proyectoDePrueba(almacen, workspace.id);
  const s = almacen.snapshots.crear({ project_id: proyecto.id, commit: "a".repeat(40) });
  const h = almacen.snapshots.agregarHallazgo({
    snapshot_id: s.id,
    categoria: "patrones",
    clave: "patrones.capas",
    valor: { capas: 3 },
    origen: "inferido",
    evidencia: [],
    confianza: "baja",
  });
  assert.equal(h.origen, "inferido");
  assert.equal(h.confianza, "baja");
  almacen.cerrar();
});

test("FR-051: una `danger_policy` no puede NACER habilitada, ni por el repositorio ni por SQL crudo", () => {
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = proyectoDePrueba(almacen, workspace.id);

  const politica = almacen.politicas.declarar({ project_id: proyecto.id, capacidad: "despliegue" });
  assert.equal(politica.habilitada, 0);

  assert.throws(
    () =>
      almacen.base.escribir(
        "INSERT INTO danger_policy (id, project_id, capacidad, habilitada, habilitada_por, habilitada_en) " +
          "VALUES (?,?,?,?,?,?)",
        ["d2", proyecto.id, "merge_autonomo", 1, "alguien", "2026-01-01T00:00:00.000Z"],
      ),
    /FR-051/,
  );
  almacen.cerrar();
});

test("habilitar una capacidad peligrosa exige quien y cuando: sin eso la fila no vale", () => {
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = proyectoDePrueba(almacen, workspace.id);
  almacen.politicas.declarar({ project_id: proyecto.id, capacidad: "bd_produccion" });

  assert.throws(
    () => almacen.base.escribir("UPDATE danger_policy SET habilitada = 1 WHERE project_id = ?", [proyecto.id]),
    /CHECK/i,
  );

  const habilitada = almacen.politicas.habilitar({
    project_id: proyecto.id,
    capacidad: "bd_produccion",
    habilitada_por: "la operadora",
  });
  assert.equal(habilitada.habilitada, 1);
  assert.equal(habilitada.habilitada_por, "la operadora");
  assert.ok(habilitada.habilitada_en);
  almacen.cerrar();
});

test("FR-034: en un proyecto, el `revisor` no comparte `runtime` con el `implementador`. Se valida AL GUARDAR", () => {
  // "Se valida al guardar, no al ejecutar" esta en `data-model.md` con esas
  // palabras. Validarlo al ejecutar significa descubrir en mitad de un
  // recorrido que quien revisa es el mismo que escribio, cuando ya hay un PR.
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = proyectoDePrueba(almacen, workspace.id);
  almacen.agentes.crear({
    project_id: proyecto.id,
    nombre: "implementador",
    rol: "implementador",
    runtime: "runtime-a",
    modelo: "m",
  });

  assert.throws(
    () =>
      almacen.agentes.crear({
        project_id: proyecto.id,
        nombre: "revisor",
        rol: "revisor",
        runtime: "runtime-a",
        modelo: "m",
      }),
    /FR-034/,
  );

  // Con otro runtime pasa, y en OTRO proyecto el mismo runtime tambien: el
  // invariante es por proyecto.
  almacen.agentes.crear({
    project_id: proyecto.id,
    nombre: "revisor",
    rol: "revisor",
    runtime: "runtime-b",
    modelo: "m",
  });
  const otro = proyectoDePrueba(almacen, workspace.id, { slug: "otro" });
  almacen.agentes.crear({ project_id: otro.id, nombre: "revisor", rol: "revisor", runtime: "runtime-a", modelo: "m" });
  almacen.cerrar();
});

test("FR-034 tambien al mover un agente de runtime, no solo al crearlo", () => {
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = proyectoDePrueba(almacen, workspace.id);
  almacen.agentes.crear({ project_id: proyecto.id, nombre: "impl", rol: "implementador", runtime: "a", modelo: "m" });
  const revisor = almacen.agentes.crear({
    project_id: proyecto.id,
    nombre: "rev",
    rol: "revisor",
    runtime: "b",
    modelo: "m",
  });
  assert.throws(() => almacen.base.escribir("UPDATE agent SET runtime = 'a' WHERE id = ?", [revisor.id]), /FR-034/);
  almacen.cerrar();
});

test("una sola constitution vigente por proyecto: la segunda desplaza a la primera, no convive", () => {
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = proyectoDePrueba(almacen, workspace.id);
  almacen.constituciones.fijar({ project_id: proyecto.id, version: "1.0.0", ruta_en_repo: "c.md", contenido: "# 1" });
  almacen.constituciones.fijar({ project_id: proyecto.id, version: "1.1.0", ruta_en_repo: "c.md", contenido: "# 2" });

  assert.equal(almacen.base.consultarUno("SELECT count(*) AS n FROM constitution").n, 2);
  assert.equal(almacen.constituciones.vigenteDe(proyecto.id).version, "1.1.0");

  // Y la base lo impide aunque alguien escriba el UPDATE a mano.
  const vieja = almacen.base.consultarUno("SELECT id FROM constitution WHERE version = '1.0.0'");
  assert.throws(() => almacen.base.escribir("UPDATE constitution SET vigente = 1 WHERE id = ?", [vieja.id]), /UNIQUE/i);
  almacen.cerrar();
});

test("una enmienda sin el fallo que la motiva no es una enmienda: la base la rechaza", () => {
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = proyectoDePrueba(almacen, workspace.id);
  const c = almacen.constituciones.fijar({
    project_id: proyecto.id,
    version: "1.0.0",
    ruta_en_repo: "c.md",
    contenido: "# 1",
  });
  assert.throws(
    () =>
      almacen.base.escribir(
        "INSERT INTO constitution_amendment (id, constitution_id, version_anterior, version_nueva, principio, " +
          "fallo_que_motiva, que_se_rompe_si_no, fecha) VALUES (?,?,?,?,?,?,?,?)",
        ["e1", c.id, "1.0.0", "1.1.0", "principio nuevo", "   ", "algo", "2026-01-01T00:00:00.000Z"],
      ),
    /CHECK/i,
  );
  almacen.cerrar();
});

test("FR-032: una conexion `scm` no lleva identificador en la capa de integracion", () => {
  // Git se habla directo. Un `id_externo` en una conexion `scm` es la senal de
  // que alguien metio el repositorio por el proveedor de integracion, y a
  // partir de ahi el motor depende de el para clonar.
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = proyectoDePrueba(almacen, workspace.id);
  assert.throws(
    () =>
      almacen.conexiones.crear({
        project_id: proyecto.id,
        clase: "scm",
        proveedor: "git",
        id_externo: "repo-123",
        estado: "viva",
      }),
    /CHECK|FR-032/i,
  );
  const directa = almacen.conexiones.crear({
    project_id: proyecto.id,
    clase: "scm",
    proveedor: "git",
    id_externo: null,
    estado: "viva",
  });
  assert.equal(directa.id_externo, null);
  almacen.cerrar();
});

test("FR-062: una entrada de bandeja sin causa no se guarda, y una resuelta sin quien tampoco", () => {
  // La metrica que esta tabla habilita es `resuelta - creada`. Una entrada
  // resuelta sin `resuelta` deja la metrica en silencio: no da error, da una
  // media que no cuenta los casos que mas tardaron.
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = proyectoDePrueba(almacen, workspace.id);
  assert.throws(
    () =>
      almacen.bandeja.crear({
        workspace_id: workspace.id,
        project_id: proyecto.id,
        tipo: "gate_rojo",
        causa: "  ",
      }),
    /CHECK|causa/i,
  );
  const entrada = almacen.bandeja.crear({
    workspace_id: workspace.id,
    project_id: proyecto.id,
    tipo: "gate_rojo",
    causa: "el gate de tipos volvio con exit code 2 sobre la tarea T012",
  });
  assert.throws(
    () => almacen.base.escribir("UPDATE inbox_entry SET estado = 'aprobada' WHERE id = ?", [entrada.id]),
    /CHECK/i,
  );
  const resuelta = almacen.bandeja.resolver(entrada.id, { estado: "aprobada", resuelta_por: "la operadora" });
  assert.equal(resuelta.estado, "aprobada");
  assert.ok(Date.parse(resuelta.resuelta) >= Date.parse(resuelta.creada));
  almacen.cerrar();
});

test("una entrada de bandeja puede ser del workspace y no de un proyecto", () => {
  const { almacen, workspace } = almacenDePrueba();
  const entrada = almacen.bandeja.crear({
    workspace_id: workspace.id,
    project_id: null,
    tipo: "autorizacion_credencial",
    causa: "el agente pidio la credencial del gestor y no hay grant vigente",
  });
  assert.equal(entrada.project_id, null);
  almacen.cerrar();
});

test("la autonomia del proyecto no pasa de L2 en esta feature", () => {
  // `data-model.md`: "En el alcance de esta feature el maximo alcanzable es L2".
  // Una columna que acepta L3 hoy es una columna que alguien pone a L3, y L3 es
  // merge sin persona — el principio IV de la constitution.
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = proyectoDePrueba(almacen, workspace.id);
  assert.equal(proyecto.autonomia, "L0");
  assert.throws(() => almacen.base.escribir("UPDATE project SET autonomia = 'L3' WHERE id = ?", [proyecto.id]), /CHECK/i);
  almacen.cerrar();
});

test("el slug es unico dentro del workspace, no globalmente", () => {
  const { almacen, workspace } = almacenDePrueba();
  proyectoDePrueba(almacen, workspace.id, { slug: "repetido" });
  assert.throws(() => proyectoDePrueba(almacen, workspace.id, { slug: "repetido" }), /UNIQUE/i);

  const otro = almacen.workspaces.crear({ home: "/tmp/otro-home" });
  const enOtro = proyectoDePrueba(almacen, otro.id, { slug: "repetido" });
  assert.equal(enOtro.slug, "repetido");
  almacen.cerrar();
});

test("una credencial de ambito `global` no puede traer proyecto, y una de `proyecto` no puede faltar", () => {
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = proyectoDePrueba(almacen, workspace.id);
  assert.throws(
    () =>
      almacen.base.escribir(
        "INSERT INTO credential (id, workspace_id, nombre, proveedor, tipo, ambito, project_id, " +
          "alcance_declarado, ref_boveda, backend, creada) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        ["c1", workspace.id, "n", "fake", "api_token", "global", proyecto.id, "leer", "r1", "keychain_so", "2026-01-01T00:00:00.000Z"],
      ),
    /CHECK/i,
  );
  assert.throws(
    () =>
      almacen.base.escribir(
        "INSERT INTO credential (id, workspace_id, nombre, proveedor, tipo, ambito, project_id, " +
          "alcance_declarado, ref_boveda, backend, creada) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        ["c2", workspace.id, "n", "fake", "api_token", "proyecto", null, "leer", "r2", "keychain_so", "2026-01-01T00:00:00.000Z"],
      ),
    /CHECK/i,
  );
  almacen.cerrar();
});

test("`SshAccess` exige la huella del host fijada: sin aceptacion silenciosa de desconocidos", () => {
  const { almacen, workspace } = almacenDePrueba();
  const credencial = almacen.boveda.guardarCredencial({
    id: "c-ssh",
    workspace_id: workspace.id,
    nombre: "acceso al bastion",
    proveedor: "ssh",
    tipo: "ssh",
    ambito: "global",
    project_id: null,
    alcance_declarado: "diagnostico",
    ref_boveda: "noxloop://ws/c-ssh",
    backend: "keychain_so",
  });
  assert.throws(
    () =>
      almacen.base.escribir(
        "INSERT INTO ssh_access (id, credential_id, host, usuario, puerto, huella_host) VALUES (?,?,?,?,?,?)",
        ["s1", credencial.id, "maquina.interna", "despliegue", 22, ""],
      ),
    /CHECK/i,
  );
  almacen.cerrar();
});

test("`escritura_autorizada` nace en falso", () => {
  const { almacen, workspace } = almacenDePrueba();
  const credencial = almacen.boveda.guardarCredencial({
    id: "c-ssh2",
    workspace_id: workspace.id,
    nombre: "acceso",
    proveedor: "ssh",
    tipo: "ssh",
    ambito: "global",
    project_id: null,
    alcance_declarado: "diagnostico",
    ref_boveda: "noxloop://ws/c-ssh2",
    backend: "keychain_so",
  });
  almacen.base.escribir(
    "INSERT INTO ssh_access (id, credential_id, host, usuario, puerto, huella_host) VALUES (?,?,?,?,?,?)",
    ["s2", credencial.id, "maquina.interna", "despliegue", 22, "SHA256:abc"],
  );
  const fila = almacen.base.consultarUno("SELECT escritura_autorizada, comandos_permitidos FROM ssh_access WHERE id = 's2'");
  assert.equal(fila.escritura_autorizada, 0);
  assert.equal(fila.comandos_permitidos, "[]");
  almacen.cerrar();
});
