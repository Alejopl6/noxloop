// Una conexion puede ser DEL ESPACIO DE TRABAJO, y no solo de un proyecto.
//
// EL FALLO QUE MOTIVA ESTO, VISTO EN PANTALLA. En «Anadir proyecto» ->
// «Repositorio remoto», la pantalla decia «Sin cuenta de codigo conectada» y
// ofrecia un boton: «Ir a un proyecto y conectar». Es decir, para dar de alta
// un proyecto habia que salir a otro proyecto, conectar ahi la cuenta, y
// volver. Y no era un descuido de la pantalla: `connection.project_id` era
// `NOT NULL REFERENCES project(id)`, asi que en el alta —donde el proyecto
// todavia no existe— no habia ninguna fila que escribir. La pantalla doblaba al
// operador para que encajara en el modelo de datos.
//
// LA CORRECCION ES DEL MODELO, no de la pantalla. Un operador tiene UNA cuenta
// de codigo y muchos repositorios: la conecta una vez y todos sus proyectos
// eligen de ahi. Un tracker si puede ser por proyecto —dos proyectos pueden
// vivir en dos Jira distintos— pero la cuenta de codigo no lo es en la
// practica. Asi que `project_id` pasa a ser opcional, y una fila con
// `project_id = NULL` es una conexion del espacio de trabajo.
//
// POR QUE ENTONCES APARECE `workspace_id`, Y NO ES UN CAMPO DE MAS. Hoy la
// conexion sabe a que espacio de trabajo pertenece POR SU PROYECTO. Con
// `project_id` en `NULL` esa cadena se corta, y una conexion sin espacio de
// trabajo flota: la guarda de un proyecto del espacio A contaria una conexion
// creada en el espacio B. El campo no agrega informacion nueva —la que habia
// estaba implicita— sino que la deja donde se puede consultar.

import { test } from "node:test";
import assert from "node:assert/strict";

import { abrirBase, aplicarMigraciones, MIGRACIONES } from "../src/index.mjs";
import { almacenDePrueba, capturar, llevarHasta, proyectoDePrueba } from "./ayuda.mjs";

/** Lleva un proyecto hasta `BOOTSTRAPPED`: la etapa desde la que se sale a `CONNECTED`. */
function alBordeDeLaEtapa06(almacen, workspace) {
  const proyecto = proyectoDePrueba(almacen, workspace.id);
  return llevarHasta(almacen, proyecto, "BOOTSTRAPPED");
}

test("una conexion sin proyecto se guarda: es la del espacio de trabajo", () => {
  const { almacen, workspace } = almacenDePrueba();

  const conexion = almacen.conexiones.crear({
    workspace_id: workspace.id,
    clase: "scm",
    proveedor: "github-pat",
    estado: "viva",
  });

  assert.equal(conexion.project_id, null, "una conexion del espacio de trabajo no cuelga de ningun proyecto");
  assert.equal(conexion.workspace_id, workspace.id);
  assert.deepEqual(
    almacen.conexiones.delEspacioDeTrabajo(workspace.id).map((c) => c.id),
    [conexion.id],
  );
  almacen.cerrar();
});

test("una conexion sin proyecto Y sin espacio de trabajo no se guarda: diria a quien pertenece ninguno de los dos", () => {
  const { almacen } = almacenDePrueba();
  const e = capturar(() => almacen.conexiones.crear({ clase: "scm", proveedor: "github-pat", estado: "viva" }));
  assert.match(String(e.message), /workspace_id/i, `el error no nombra el campo que falta: ${e.message}`);
  almacen.cerrar();
});

test("una conexion de proyecto hereda el espacio de trabajo del proyecto, sin que nadie lo declare", () => {
  // Las llamadas que ya existen no pasan `workspace_id`, y no tienen por que:
  // el proyecto ya dice cual es. Derivarlo aqui es lo que impide que dos filas
  // del mismo proyecto acaben en espacios distintos por un olvido.
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = proyectoDePrueba(almacen, workspace.id);

  const conexion = almacen.conexiones.crear({
    project_id: proyecto.id,
    clase: "tracker",
    proveedor: "fake",
    estado: "viva",
  });

  assert.equal(conexion.workspace_id, workspace.id);
  assert.equal(conexion.project_id, proyecto.id);
  almacen.cerrar();
});

test("FR-032 sigue en pie para una conexion del espacio de trabajo: `scm` no lleva `id_externo`", () => {
  // Que el alcance cambie no cambia esto. Git se habla directo y la capa de
  // integracion no se interpone: un `id_externo` en una conexion `scm` es la
  // senal de que clonar empezo a depender de que el proveedor conteste.
  const { almacen, workspace } = almacenDePrueba();
  assert.throws(
    () =>
      almacen.conexiones.crear({
        workspace_id: workspace.id,
        clase: "scm",
        proveedor: "github-pat",
        id_externo: "repo-123",
        estado: "viva",
      }),
    /CHECK|FR-032/i,
  );
  almacen.cerrar();
});

test("LA GUARDA DE LA ETAPA 06: una conexion del espacio de trabajo la satisface, y dice que es del espacio", () => {
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = alBordeDeLaEtapa06(almacen, workspace);

  // Sin ninguna conexion: la etapa esta en rojo, como siempre.
  assert.equal(almacen.proyectos.artefactos(proyecto.id).conexion_viva.listo, false);

  almacen.conexiones.crear({
    workspace_id: workspace.id,
    clase: "scm",
    proveedor: "github-pat",
    estado: "viva",
  });

  const guarda = almacen.proyectos.artefactos(proyecto.id).conexion_viva;
  assert.equal(guarda.listo, true, `la guarda sigue en rojo: ${guarda.hallado}`);
  assert.match(
    guarda.hallado,
    /espacio de trabajo/i,
    "la guarda da por buena una conexion del espacio y no lo dice: quien lea la etapa creera que este proyecto " +
      `conecto algo suyo — ${guarda.hallado}`,
  );

  // Y la transicion ocurre de verdad, que es lo unico que demuestra que la
  // guarda no solo contesta bien sino que deja pasar.
  const conectado = almacen.proyectos.transicionar(proyecto.id, "CONNECTED", { actor: "operador de prueba" });
  assert.equal(conectado.estado, "CONNECTED");
  almacen.cerrar();
});

test("la guarda prefiere la conexion PROPIA del proyecto y lo dice, cuando hay de las dos", () => {
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = alBordeDeLaEtapa06(almacen, workspace);

  almacen.conexiones.crear({ workspace_id: workspace.id, clase: "scm", proveedor: "github-pat", estado: "viva" });
  almacen.conexiones.crear({ project_id: proyecto.id, clase: "tracker", proveedor: "fake", estado: "viva" });

  const guarda = almacen.proyectos.artefactos(proyecto.id).conexion_viva;
  assert.equal(guarda.listo, true);
  assert.match(guarda.hallado, /este proyecto/i, `la guarda no distingue de quien es la conexion: ${guarda.hallado}`);
  almacen.cerrar();
});

test("la conexion del espacio de trabajo de OTRO espacio no satisface la guarda", () => {
  // Es el fallo que `workspace_id` existe para impedir. Sin el campo, una fila
  // con `project_id = NULL` vale para cualquier proyecto de cualquier
  // instalacion que comparta el archivo.
  const { almacen, workspace } = almacenDePrueba();
  const otro = almacen.workspaces.crear({ home: "/tmp/noxloop-otro" });
  const proyecto = alBordeDeLaEtapa06(almacen, workspace);

  almacen.conexiones.crear({ workspace_id: otro.id, clase: "scm", proveedor: "github-pat", estado: "viva" });

  const guarda = almacen.proyectos.artefactos(proyecto.id).conexion_viva;
  assert.equal(guarda.listo, false, `una conexion de otro espacio de trabajo puso la etapa en verde: ${guarda.hallado}`);
  almacen.cerrar();
});

test("una conexion del espacio PENDIENTE no basta, y el rojo la cuenta", () => {
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = alBordeDeLaEtapa06(almacen, workspace);
  almacen.conexiones.crear({ workspace_id: workspace.id, clase: "scm", proveedor: "github-pat", estado: "pendiente" });

  const guarda = almacen.proyectos.artefactos(proyecto.id).conexion_viva;
  assert.equal(guarda.listo, false);
  assert.match(
    guarda.hallado,
    /pendiente/,
    `el rojo no cuenta la conexion que esta esperando, y mandan al operador a sitios distintos: ${guarda.hallado}`,
  );
  almacen.cerrar();
});

test("la vista de inicio cuenta aparte las conexiones del espacio: un proyecto CONNECTED con 0 propias no miente", () => {
  const { almacen, workspace } = almacenDePrueba();
  const proyecto = alBordeDeLaEtapa06(almacen, workspace);
  almacen.conexiones.crear({ workspace_id: workspace.id, clase: "scm", proveedor: "github-pat", estado: "viva" });

  const fila = almacen.inicio.proyectos().find((p) => p.id === proyecto.id);
  assert.equal(fila.conexiones_vivas, 0, "una conexion del espacio no es una conexion DEL PROYECTO");
  assert.equal(
    fila.conexiones_del_espacio,
    1,
    "la pantalla de proyectos dice `0 conexiones` para un proyecto que si alcanza una: el operador lee que no " +
      "conecto nada justo despues de conectar",
  );
  almacen.cerrar();
});

test("LA MIGRACION: las filas que ya existian conservan su proyecto y ganan su espacio de trabajo", () => {
  // La base de un operador que ya venia usando el producto se abre con la
  // version anterior del esquema. Lo que no puede pasar es que la migracion
  // pierda una conexion o la deje sin espacio de trabajo: en el primer caso el
  // proyecto vuelve a `BOOTSTRAPPED` sin que nada falle, en el segundo la
  // guarda deja de encontrarla.
  const base = abrirBase(":memory:");
  const hastaLaAnterior = MIGRACIONES.filter((m) => m.version <= 3);
  aplicarMigraciones(base, hastaLaAnterior);

  base.escribir("INSERT INTO workspace (id, home, creado, version_esquema) VALUES (?, ?, ?, ?)", [
    "w-1",
    "/tmp/noxloop-viejo",
    "2026-01-01T00:00:00.000Z",
    3,
  ]);
  base.escribir(
    "INSERT INTO project (id, workspace_id, nombre, slug, origen, ruta_local, remoto, estado, autonomia, creado, " +
      "actualizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["p-1", "w-1", "viejo", "viejo", "local", "/tmp/viejo", null, "BOOTSTRAPPED", "L0", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"],
  );
  base.escribir(
    "INSERT INTO connection (id, project_id, clase, proveedor, id_externo, estado, credential_id, capacidades) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ["c-1", "p-1", "scm", "github-pat", null, "viva", null, "{}"],
  );

  const { aplicadas } = aplicarMigraciones(base, MIGRACIONES);
  assert.ok(aplicadas.length > 0, "la migracion nueva no se aplico sobre una base que venia de la version anterior");

  const fila = base.consultarUno("SELECT * FROM connection WHERE id = 'c-1'");
  assert.ok(fila, "la migracion perdio la conexion que ya existia");
  assert.equal(fila.project_id, "p-1", "la conexion dejo de pertenecer a su proyecto");
  assert.equal(fila.workspace_id, "w-1", "la conexion quedo sin espacio de trabajo: la guarda ya no la encuentra");
  assert.equal(fila.estado, "viva");
  base.cerrar();
});
