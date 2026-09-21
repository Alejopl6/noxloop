// T196 y T205 — el recorrido completo del producto, contra el servicio de
// verdad, sin red y sin modelo.
//
// POR QUE VIVE EN `packages/service/test/`. Porque el recorrido es del plano de
// control: las seis etapas que lo componen —alta, snapshot, constitution,
// bootstrap, conexion, flota— son rutas de este paquete, y los ayudantes que
// hacen falta para ejercerlas (`huellaDelArbol`, `leerFrames`, el repositorio
// de prueba) ya viven en `./ayuda.mjs`. El motor entra al final, igual que
// `packages/engine/test/e2e-asignar-a-pr.test.mjs` entra en `providers/`: un
// test de punta a punta cruza paquetes por definicion, y los guardas de
// autocontencion miran `src/`, que es donde el invariante importa.
//
// LO QUE ESTE ARCHIVO SE NIEGA A HACER. No prueba un camino feliz y ya. Un
// recorrido verde demuestra que las piezas se pueden llamar en orden, no que
// alguna de ellas sostenga algo. Por eso, DENTRO del mismo recorrido, se miden
// cinco cosas que solo se pueden medir mientras pasa:
//
//   1. El arbol del proyecto tras el escaneo, byte a byte y con `git status`.
//   2. Que ninguna transicion se salto, preguntandoselo al almacen.
//   3. Que la cadena de hash de la auditoria cierra, RECALCULANDOLA aqui.
//   4. Que un centinela plantado como credencial no sale por ninguna parte:
//      ni por una respuesta, ni por el canal de eventos, ni por un archivo del
//      home.
//   5. Que lanzar un ciclo antes de `ACTIVE` devuelve 409 nombrando la etapa.
//
// LAS COSTURAS QUE EL RECORRIDO ENCONTRO, y que este archivo NO parchea. Una
// pieza del producto no encaja cuando se la junta de verdad, y queda escrita
// como hecho medido en vez de como prosa en un informe, en el `puentes` que se
// imprime al final.
//
// Hubo otras dos y ya no estan:
//
//   - Conectar por HTTP no dejaba la conexion donde mira la guarda
//     `conexion_viva`, y ninguna ruta llevaba un proyecto a `CONNECTED`. La
//     etapa 06 la cruza el producto, mas abajo, sin puente.
//   - `driver.mjs` y `planner.mjs` invocaban `deps.runPhase(...)` sin `env` y,
//     en PLAN, sin `taskId`, asi que el adaptador `fake` no podia ser invocado
//     por el motor y este archivo tenia que rellenar los dos campos por el
//     camino. Ahora los dos call sites construyen la peticion entera y el
//     cableado monta el runtime por el contrato: abajo se le entrega al
//     adaptador lo que el motor construyo, tal cual.
//
//   - `GET /v1/projects/:id/runs` no reconoce como suyo un run que escribio el
//     motor de verdad, porque el estado del run no lleva `project_id` ni
//     `repoPath`.
//
// Donde el recorrido necesita cruzar una de esas costuras lo hace por el
// almacen —que es del producto, no del test— y lo APUNTA en `puentes`, que se
// imprime con la duracion. Un puente silencioso convertiria este archivo en la
// prueba de que el recorrido funciona cuando lo que prueba es que casi.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

import { arrancar } from "../src/servidor.mjs";
import { ESTADOS, GENESIS, TRANSICIONES, hashDeEvento } from "../../store/src/index.mjs";
import { crearAdaptadorFalso } from "../../connections/src/adaptadores/fake.mjs";
import { crearAdaptadorFake } from "../../adapters/src/adaptadores/fake.mjs";
import { ejecutarComando } from "../../engine/src/comandos.mjs";
import { loadRun } from "../../engine/src/state.mjs";
import * as gestorFalso from "../../../providers/fake/index.mjs";

import { FRASE, TOKEN, ORIGEN, diferencias, eventos, huellaDelArbol, leerFrames } from "./ayuda.mjs";

/** La raiz del repositorio, para que el motor cargue el proveedor falso por ruta. */
const RAIZ = new URL("../../../", import.meta.url).pathname;

const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/**
 * El centinela. Se planta COMO CREDENCIAL y en ningun otro sitio.
 *
 * POR QUE SOLO AHI. Porque lo que se afirma es que el valor de una credencial
 * no sale del servicio, y si el mismo texto estuviera ademas en el arbol del
 * proyecto, encontrarlo en un archivo del home no distinguiria una fuga de la
 * boveda de un hallazgo del scanner haciendo su trabajo. Un centinela que puede
 * llegar por dos caminos no prueba nada sobre ninguno de los dos.
 */
const CENTINELA = "zqx7-CENTINELA-DEL-RECORRIDO-COMPLETO-NO-DEBE-SALIR-9c4e1f";

/** Tambien los trozos: un redactor que corta el valor a la mitad filtra igual. */
const TROZOS = [CENTINELA, CENTINELA.slice(0, 32), CENTINELA.slice(0, 16), CENTINELA.slice(-24)];

/** @param {string} texto @param {string} donde */
function exigirSinCentinela(texto, donde) {
  for (const trozo of TROZOS) {
    assert.ok(
      !texto.includes(trozo),
      `${donde} llevaba el valor de una credencial (o un trozo de ${trozo.length} caracteres).\n` +
        "Es el unico fallo de este producto sin segundo intento: un secreto filtrado se rota, se audita y se " +
        `explica.\nLo que salio:\n${texto.slice(0, 2000)}`,
    );
  }
}

/**
 * Un repositorio de verdad con su remoto, como el de una organizacion.
 *
 * POR QUE CON REMOTO BARE Y CON UN COMMIT. Sin remoto, la cola de integracion
 * del motor no tiene donde empujar la rama del item y el recorrido se cae en el
 * ultimo paso — despues de haber gastado todo lo demas. Sin commit inicial,
 * `commitDe` del escaneo devuelve el centinela `sin-commit` y el snapshot deja
 * de ser reproducible, que es un camino legitimo del producto pero no el que
 * este recorrido afirma.
 */
function organizacion() {
  const raiz = mkdtempSync(join(tmpdir(), "noxloop-p2p-"));
  const remoto = join(raiz, "origin.git");
  mkdirSync(remoto);
  git(remoto, "init", "-q", "--bare", "-b", "main");

  const repo = join(raiz, "app");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "equipo@example.test");
  git(repo, "config", "user.name", "El equipo");
  git(repo, "remote", "add", "origin", remoto);
  mkdirSync(join(repo, "src"));
  mkdirSync(join(repo, "test"));
  writeFileSync(join(repo, "README.md"), "# la app del operador\n");
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({ name: "app", version: "1.0.0", type: "module", scripts: { test: "node --test" } }, null, 2) + "\n",
  );
  writeFileSync(join(repo, "src", "index.mjs"), "export const version = 1;\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "chore: inicial");
  git(repo, "push", "-q", "origin", "main");

  return { raiz, repo, remoto };
}

/** Todo lo que hay bajo un directorio, como bytes. Para buscar el centinela en el home. */
function archivosDe(raiz, acc = []) {
  for (const nombre of readdirSync(raiz)) {
    const p = join(raiz, nombre);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) archivosDe(p, acc);
    else acc.push(p);
  }
  return acc;
}

/**
 * La configuracion del motor, apuntada al MISMO home que el servicio.
 *
 * Que el home sea el mismo no es un detalle de montaje: es lo que hace que
 * `GET /v1/runs/:id` pueda proyectar lo que el motor escribio. El servicio lee
 * `<home>/runs/run-*.json` y el motor los escribe ahi; los locks de los dos
 * viven en `<home>/locks/` con nombres distintos y no se pisan.
 */
function configDelMotor({ home, repo, remoto }) {
  return {
    home,
    version: 1,
    provider: {
      name: "fake",
      module: join(RAIZ, "providers/fake/index.mjs"),
      stateMap: { todo: "Nuevo", in_progress: "En curso", blocked: "Bloqueado", in_review: null, done: null },
    },
    forge: { kind: "github", cli: "gh" },
    identity: { assignee: "noxloop[bot]", mention: "@noxloop" },
    repos: {
      app: {
        name: "app",
        path: repo,
        remote: remoto,
        baseBranch: "main",
        // Gates REALES: comandos de shell que corren de verdad contra el
        // worktree. Un gate `true` probaria que el motor sabe llamar a `true`.
        gate: "test -f src/permisos.mjs",
        fastGate: "test -f src/permisos.mjs",
        runners: { node: "node {file}" },
        env: {},
        gaps: ["sin cobertura de e2e"],
      },
    },
    limits: { maxParallelTasks: 4, maxParallelItems: 2, phaseTimeoutMin: 5, callsPerItem: 60, stallRounds: 2, pollIntervalSec: 120 },
    budgets: { red: 2, green: 3, gate: 3, review: 2 },
    tiers: { small: { model: null, effort: "medium", gate: "fast", review: true, fanout: false } },
    unmappedStates: ["in_review", "done"],
  };
}

/**
 * El modelo es lo unico que no existe, asi que el test escribe lo que un modelo
 * escribiria y el adaptador `fake` corre de verdad la fase.
 *
 * LO QUE ESTA FUNCION YA NO HACE, y es el punto. Antes traducia la peticion del
 * motor a la que el contrato exige, porque `driver.mjs` no mandaba `env` y
 * `planner.mjs` tampoco `taskId`. Ese puente tapaba que el adaptador `fake` no
 * podia ser invocado por el motor. Ahora la peticion se le pasa TAL CUAL: si a
 * algun call site del motor le faltara un campo, el adaptador responderia
 * `entorno_ausente` o `peticion_invalida` y el recorrido se caeria aqui.
 *
 * @param {any} adaptador
 * @param {string[]} registro
 */
function runPhaseConAdaptadorFake(adaptador, registro) {
  return async (fase) => {
    registro.push(`${fase.phase}${fase.taskId ? `:${fase.taskId}` : ""}`);

    if (fase.phase === "PLAN") {
      const ruta = /--out (\S+)/.exec(fase.prompt)?.[1];
      assert.ok(ruta, `el prompt de PLAN tiene que decir donde escribir el plan: ${fase.prompt}`);
      mkdirSync(join(ruta, ".."), { recursive: true });
      writeFileSync(
        ruta,
        JSON.stringify({
          repoScope: ["app"],
          evidence: [{ repo: "app", why: "los permisos viven en src/" }],
          tasks: [
            {
              id: "T001",
              repo: "app",
              title: "publicar el catalogo de permisos",
              acceptance: "el modulo de permisos exporta el catalogo",
              targetFiles: ["src/permisos.mjs"],
              testFiles: ["test/permisos.test.mjs"],
              tier: "small",
              dependsOn: [],
              dependencyKind: "hard",
            },
          ],
        }),
      );
    }

    const t = fase.task;
    if (fase.phase === "RED") {
      mkdirSync(join(fase.cwd, "test"), { recursive: true });
      // Un test que falla porque el modulo todavia no existe: es lo que hace
      // que el paso RED del motor tenga algo que verificar en rojo.
      writeFileSync(
        join(fase.cwd, t.testFiles[0]),
        `import { catalogo } from "../${t.targetFiles[0]}";\nif (!Array.isArray(catalogo)) throw new Error("rojo");\n`,
      );
    }
    if (fase.phase === "GREEN") {
      mkdirSync(join(fase.cwd, "src"), { recursive: true });
      writeFileSync(join(fase.cwd, t.targetFiles[0]), 'export const catalogo = ["leer", "escribir"];\n');
    }

    return await adaptador.runPhase(fase);
  };
}

// ---------------------------------------------------------------------------
// T196 + T205 · el recorrido
// ---------------------------------------------------------------------------

test("T196 y T205 — de un repositorio de verdad a un PR abierto, sin editar un archivo a mano", async (t) => {
  const arrancado = Date.now();

  /** Cada paso del recorrido, con quien lo hizo. Es la evidencia de T205. */
  const pasos = [];
  /** Las costuras que el producto no tiene y el recorrido tuvo que cruzar a mano. */
  const puentes = [];
  /** Todo lo que salio por el cable, para la busqueda del centinela. */
  const porElCable = [];

  const org = organizacion();
  const home = mkdtempSync(join(tmpdir(), "noxloop-p2p-home-"));

  const svc = await arrancar({
    home,
    token: TOKEN,
    frase: FRASE,
    // El adaptador `fake` de conexiones: sin red, sin contenedores y sin
    // credenciales de nadie.
    proveedorDeConexiones: crearAdaptadorFalso(),
  });

  /**
   * Una peticion como la hace la interfaz, con la ultima puerta puesta: TODO lo
   * que vuelve —estado, cabeceras y cuerpo— se serializa y se busca el
   * centinela dentro antes de devolverlo a quien pidio.
   */
  const pedir = async (ruta, init = {}) => {
    const r = await fetch(`${svc.url}${ruta}`, {
      ...init,
      headers: { "x-noxloop-token": TOKEN, origin: ORIGEN, "content-type": "application/json", ...(init.headers || {}) },
    });
    const cabeceras = {};
    for (const [k, v] of r.headers) cabeceras[k] = v;
    const texto = await r.text();
    const salida = JSON.stringify({ ruta, estado: r.status, cabeceras, cuerpo: texto });
    porElCable.push(salida);
    exigirSinCentinela(salida, `${init.method || "GET"} ${ruta}`);
    pasos.push(`HTTP ${init.method || "GET"} ${ruta} -> ${r.status}`);
    let cuerpo;
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      cuerpo = texto;
    }
    return { status: r.status, cuerpo };
  };

  const POST = (ruta, cuerpo) => pedir(ruta, { method: "POST", ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) });
  const PUT = (ruta, cuerpo) => pedir(ruta, { method: "PUT", body: JSON.stringify(cuerpo) });
  const PATCH = (ruta, cuerpo) => pedir(ruta, { method: "PATCH", body: JSON.stringify(cuerpo) });

  /** El canal de eventos, abierto ANTES del primer paso y drenado en paralelo. */
  const canal = await fetch(`${svc.url}/v1/events`, { headers: { "x-noxloop-token": TOKEN, origin: ORIGEN } });
  // El cuerpo de un frame es el evento ENTERO —`{id, tipo, project_id, datos,
  // ts}`— asi que la carga util esta en `datos.datos`. Mirar `datos.estado`
  // no lanza: devuelve `undefined`, la condicion no se cumple nunca y el
  // recorrido paga el tiempo de espera entero creyendo que espera un evento.
  const esActivado = (e) => e.tipo === "proyecto.estado" && e.datos && e.datos.datos && e.datos.datos.estado === "ACTIVE";
  const framesPendientes = leerFrames(canal, (f) => eventos(f).some(esActivado), 30_000);

  /** Los estados por los que pasa el proyecto, en el orden en que se observan. */
  const recorrido = [];
  /** Las guardas que el almacen da por buenas, muestreadas en cada frontera. */
  const artefactosPorEtapa = [];

  try {
    // ---- el centinela entra al sistema como credencial ---------------------
    const alta = await POST("/v1/credentials", {
      nombre: "token-del-gestor-de-tickets",
      proveedor: "un-gestor-de-tickets",
      tipo: "api_token",
      alcance_declarado: "leer y comentar tickets del equipo",
      valor: CENTINELA,
    });
    assert.equal(alta.status, 201, JSON.stringify(alta.cuerpo));
    assert.ok(alta.cuerpo.credencial.id, "sin id no hay grant que conceder despues");
    assert.equal(
      alta.cuerpo.credencial.valor,
      undefined,
      "la fila del inventario no tiene campo `valor`: si lo tuviera, el inventario seria el primer camino de fuga",
    );

    // ---- 1. alta del proyecto ---------------------------------------------
    const creado = await POST("/v1/projects", { origen: "local", nombre: "La App Del Operador", ruta_local: org.repo });
    assert.equal(creado.status, 201, JSON.stringify(creado.cuerpo));
    const proyecto = creado.cuerpo.proyecto;
    recorrido.push(proyecto.estado);
    assert.equal(proyecto.estado, "CREATED");

    // La huella se toma AQUI y no antes: lo que se afirma es que el producto no
    // toca el arbol, y el arbol de referencia es el que el producto recibio.
    const huellaInicial = huellaDelArbol(org.repo);

    // ---- 2. escaneo --------------------------------------------------------
    const scan = await POST(`/v1/projects/${proyecto.id}/scan`);
    assert.equal(scan.status, 202, JSON.stringify(scan.cuerpo));
    assert.ok(scan.cuerpo.snapshot_id, "sin `snapshot_id` la interfaz no puede cancelar el recorrido que arranco");

    let snapshot = null;
    for (let i = 0; i < 800 && !snapshot; i++) {
      const s = await pedir(`/v1/projects/${proyecto.id}/snapshot`);
      if (s.status === 200 && s.cuerpo.snapshot && s.cuerpo.snapshot.estado !== "en_curso") snapshot = s.cuerpo;
      else await new Promise((listo) => setTimeout(listo, 25));
    }
    assert.ok(snapshot, "el snapshot no termino a tiempo y el recorrido se quedaria sin nada que aceptar");
    assert.equal(snapshot.snapshot.estado, "completo");
    assert.ok(snapshot.items.length > 0, "un snapshot sin hallazgos es un escaneo que no leyo nada");

    // EL INVARIANTE DE FR-011, medido dos veces y de dos maneras distintas.
    // `git status` es la comprobacion que el operador haria; la huella ve
    // ademas lo que git ignora, un archivo reescrito con el mismo contenido
    // (cambia mtime) y uno reemplazado por temporal + rename (cambia el inodo).
    //
    // EL ORDEN DE LAS DOS NO ES INDIFERENTE, y costo un fallo. `git status`
    // ESCRIBE: refresca `.git/index` con solo consultarlo, asi que medido
    // despues de el, el inodo de `.git/index` aparece cambiado y el culpable es
    // el instrumento. Es el mismo motivo por el que `commitDe` lee `.git/HEAD`
    // a mano en vez de llamar a `git`, escrito en su cabecera. La medida fina
    // va primera; la que ensucia, despues.
    assert.deepEqual(
      diferencias(huellaInicial, huellaDelArbol(org.repo)),
      [],
      "el escaneo toco archivos del proyecto (inodo, mtime, tamaño o modo)",
    );
    assert.equal(
      git(org.repo, "status", "--porcelain"),
      "",
      "el escaneo dejo el arbol del operador sucio: leer es lo unico que estas rutas tienen permitido hacer",
    );

    // EL 409 QUE NOMBRA LA ETAPA, a proposito y en un punto intermedio (FR-064).
    // Aqui la etapa que falta es inequivoca: el snapshot todavia no se acepto,
    // asi que la primera guarda del orden es la que tiene que aparecer.
    const prematuro = await POST(`/v1/projects/${proyecto.id}/runs`, {});
    assert.equal(prematuro.status, 409, JSON.stringify(prematuro.cuerpo));
    assert.equal(prematuro.cuerpo.error.codigo, "proyecto_no_activo");
    assert.match(prematuro.cuerpo.error.causa, /snapshot_aceptado/, "el 409 no nombra la etapa que falta");
    assert.match(prematuro.cuerpo.error.causa, /CREATED/, "el 409 no dice en que estado esta el proyecto");
    assert.ok(
      prematuro.cuerpo.error.accion && prematuro.cuerpo.error.accion.length > 0,
      "un 409 que explica y no dice que hacer deja al operador igual de atascado (NFR-006)",
    );

    // Y la misma negativa por la otra puerta: activar salta la maquina de
    // estados entera, y tiene que rebotar con su propia causa.
    const activarPronto = await POST(`/v1/projects/${proyecto.id}/activate`);
    assert.equal(activarPronto.status >= 400, true, JSON.stringify(activarPronto.cuerpo));
    assert.match(
      JSON.stringify(activarPronto.cuerpo),
      /transicion_no_declarada|flota|CREATED/,
      "activar desde `CREATED` tiene que rebotar diciendo por que",
    );

    artefactosPorEtapa.push(listas((await pedir(`/v1/projects/${proyecto.id}`)).cuerpo.artefactos));

    for (const hallazgo of snapshot.items) {
      const d = await PATCH(`/v1/snapshots/${snapshot.snapshot.id}/findings/${hallazgo.id}`, { decision: "aceptado" });
      assert.equal(d.status, 200, `no se pudo decidir el hallazgo ${hallazgo.clave}: ${JSON.stringify(d.cuerpo)}`);
    }

    const aceptado = await POST(`/v1/snapshots/${snapshot.snapshot.id}/accept`);
    assert.equal(aceptado.status, 200, JSON.stringify(aceptado.cuerpo));
    recorrido.push(aceptado.cuerpo.proyecto.estado);
    artefactosPorEtapa.push(listas((await pedir(`/v1/projects/${proyecto.id}`)).cuerpo.artefactos));

    // ---- 3. constitution ---------------------------------------------------
    const propuesta = (await POST(`/v1/projects/${proyecto.id}/constitution/propose`)).cuerpo.propuesta;
    assert.ok(propuesta.documento, "la propuesta tiene que traer el documento: sin el no hay nada que fijar");
    const fijada = await PUT(`/v1/projects/${proyecto.id}/constitution`, {
      markdown: propuesta.documento,
      ruta_en_repo: propuesta.ruta_en_repo,
      version: propuesta.version,
      // El ORIGEN de cada apartado viaja tal como lo produjo el nucleo. Es la
      // parte que no se puede deducir de la prosa: un apartado inferido que
      // llega marcado como detectado se convierte en la regla del proyecto.
      apartados: propuesta.apartados.map((a) => ({
        clave: a.id,
        contenido: a.contenido ?? "",
        origen: a.origen,
        evidencia: a.evidencia ?? [],
      })),
    });
    assert.equal(fijada.status, 200, JSON.stringify(fijada.cuerpo));
    recorrido.push(fijada.cuerpo.proyecto.estado);
    artefactosPorEtapa.push(listas((await pedir(`/v1/projects/${proyecto.id}`)).cuerpo.artefactos));

    /** Lo que el producto DECLARA haber escrito en el arbol. Se compara contra el disco. */
    const escrituras = [...fijada.cuerpo.escrituras];

    // ---- 4. bootstrap ------------------------------------------------------
    const analisis = await POST(`/v1/projects/${proyecto.id}/bootstrap/analyze`);
    assert.equal(analisis.status, 200, JSON.stringify(analisis.cuerpo));

    const recomendaciones = (await pedir(`/v1/projects/${proyecto.id}/recommendations`)).cuerpo.items;
    assert.ok(recomendaciones.length > 0, "un bootstrap sin recomendaciones no se distingue de uno que no corrio");

    // Una se APLICA y el resto se omite: aplicar es el unico camino del
    // recorrido que escribe en el arbol del operador, y un recorrido que las
    // omite todas no lo ejercita nunca.
    for (const [i, rec] of recomendaciones.entries()) {
      const r =
        i === 0
          ? await POST(`/v1/recommendations/${rec.id}/apply`, { motivo: "el recorrido la acepta tal como viene" })
          : await POST(`/v1/recommendations/${rec.id}/skip`, { motivo: "no hace falta para este recorrido" });
      assert.equal(r.status, 200, `no se pudo decidir ${rec.id}: ${JSON.stringify(r.cuerpo)}`);
      escrituras.push(...(r.cuerpo.escrituras ?? []));
    }

    const bootstrapListo = await POST(`/v1/projects/${proyecto.id}/bootstrap/complete`);
    assert.equal(bootstrapListo.status, 200, JSON.stringify(bootstrapListo.cuerpo));
    recorrido.push(bootstrapListo.cuerpo.proyecto.estado);
    artefactosPorEtapa.push(listas((await pedir(`/v1/projects/${proyecto.id}`)).cuerpo.artefactos));

    // T205, LA PARTE MEDIBLE. Lo que cambio en el arbol del operador es
    // EXACTAMENTE lo que el producto dijo que iba a escribir, ni un archivo
    // mas. Es la unica forma de comprobar "sin editar un archivo a mano" que no
    // sea una afirmacion sobre lo que el autor del test recuerda haber hecho:
    // si el recorrido hubiera tocado algo de su cuenta, aparece aqui sin firma.
    const tocados = git(org.repo, "status", "--porcelain")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => l.slice(3).trim());
    assert.deepEqual(
      [...tocados].sort(),
      [...new Set(escrituras)].sort(),
      "el arbol cambio en archivos que ningun paso del producto declaro escribir",
    );

    // ---- 5. conexion con el adaptador `fake` -------------------------------
    // El catalogo del falso trae los DOS caminos a proposito, porque esta
    // verificado que dos de los proveedores objetivo no usan OAuth. El
    // recorrido ejerce los dos: el gestor de tickets por autorizacion —que es
    // el que despues habilita la etapa— y el de clave de API, que es donde se
    // puede comprobar que un campo declarado secreto no vuelve por el cable.
    const catalogo = (await pedir(`/v1/projects/${proyecto.id}/connections`)).cuerpo.catalogo;
    const tracker = catalogo.find((c) => c.modo === "oauth2");
    const conClave = catalogo.find((c) => c.modo === "api_key");
    assert.ok(tracker && conClave, "el adaptador falso tiene que declarar los dos caminos, con y sin autorizacion");

    const autorizacion = await POST(`/v1/projects/${proyecto.id}/connections/authorize`, { proveedor: tracker.slug });
    assert.equal(autorizacion.status, 201, JSON.stringify(autorizacion.cuerpo));
    assert.ok(autorizacion.cuerpo.url_autorizacion, "sin URL no hay autorizacion que completar");
    assert.equal(
      autorizacion.cuerpo.abrir_en,
      "navegador_del_sistema",
      "una URL a secas no dice donde abrirla, y varios proveedores bloquean el webview embebido por politica",
    );

    const callback = await POST(`/v1/connections/${autorizacion.cuerpo.session_token}/callback`, {});
    assert.equal(callback.status, 200, JSON.stringify(callback.cuerpo));
    assert.equal(callback.cuerpo.conexion.estado, "conectada");
    const conexionViva = callback.cuerpo.conexion;

    // LA ETAPA 06, POR SU PROPIO CAMINO. Completar la autorizacion deja la fila
    // en `connection` —la tabla donde mira la guarda `conexion_viva`, con el
    // vocabulario del almacen— y con ella el proyecto avanza. Hasta que esto
    // existio, el recorrido cruzaba la costura a mano por el almacen y lo
    // apuntaba en `puentes`; ahora el puente ya no esta, y si alguien deshace la
    // traduccion el recorrido se cae aqui en vez de seguir verde afirmando una
    // etapa que no ocurrio.
    assert.ok(
      callback.cuerpo.proyecto,
      "el `callback` conecto y no dijo que paso con el proyecto: la pantalla de conexiones no tiene forma de " +
        "saber que la etapa avanzo, y el operador se queda mirando un estado viejo",
    );
    recorrido.push(callback.cuerpo.proyecto.estado);

    const filaDeLaConexion = svc.dep.almacen.conexiones
      .porProyecto(proyecto.id)
      .find((/** @type {any} */ f) => f.id === conexionViva.id);
    assert.ok(filaDeLaConexion, "la conexion que devolvio el servicio no tiene fila en el almacen");
    assert.equal(
      filaDeLaConexion.estado,
      "viva",
      "la fila quedo con el vocabulario de `packages/connections` (`conectada`) en una columna que solo entiende " +
        "el del almacen (`viva`), y la guarda mira esa columna",
    );

    const SECRETO_DE_LA_CLAVE = "una-clave-de-api-que-no-puede-volver";
    const porClave = await POST(`/v1/projects/${proyecto.id}/connections/authorize`, {
      proveedor: conClave.slug,
      valores: { api_key: SECRETO_DE_LA_CLAVE },
    });
    assert.equal(porClave.status, 201, JSON.stringify(porClave.cuerpo));
    assert.equal(
      JSON.stringify(porClave.cuerpo).includes(SECRETO_DE_LA_CLAVE),
      false,
      "la fila de la conexion llevaba el valor del campo secreto: el valor va al deposito y la fila guarda la referencia",
    );

    // Y la guarda lo da por bueno yendo a buscarlo, que es la unica forma de
    // que el estado del proyecto y lo que hay en la base no puedan separarse.
    const estadoDeLaGuarda = svc.dep.almacen.proyectos.artefactos(proyecto.id).conexion_viva;
    assert.equal(estadoDeLaGuarda.listo, true, `la guarda \`conexion_viva\` dice: ${estadoDeLaGuarda.hallado}`);
    artefactosPorEtapa.push(listas((await pedir(`/v1/projects/${proyecto.id}`)).cuerpo.artefactos));

    // ---- 6. flota ----------------------------------------------------------
    const implementador = await POST(`/v1/projects/${proyecto.id}/agents`, {
      nombre: "quien implementa",
      rol: "implementador",
      runtime: "fake",
      modelo: "fake",
    });
    assert.equal(implementador.status, 201, JSON.stringify(implementador.cuerpo));

    // FR-034 comprobado EN EL RECORRIDO y no solo en su test unitario: un
    // revisor con el runtime del implementador aprueba sus propios puntos
    // ciegos, y cuesta exactamente lo mismo que una revision de verdad.
    const revisorClonado = await POST(`/v1/projects/${proyecto.id}/agents`, {
      nombre: "quien revisa, mal",
      rol: "revisor",
      runtime: "fake",
      modelo: "fake",
    });
    assert.equal(revisorClonado.status, 409, JSON.stringify(revisorClonado.cuerpo));
    assert.equal(revisorClonado.cuerpo.error.codigo, "revisor_comparte_runtime");
    assert.match(revisorClonado.cuerpo.error.causa, /quien implementa/, "el error no dice con quien choca");

    const revisor = await POST(`/v1/projects/${proyecto.id}/agents`, {
      nombre: "quien revisa",
      rol: "revisor",
      runtime: "guionado",
      modelo: "guionado",
    });
    assert.equal(revisor.status, 201, JSON.stringify(revisor.cuerpo));

    // El grant: la credencial del centinela alcanzable por el implementador.
    // Es lo que hace que la auditoria tenga algo que registrar mas alla del
    // alta, y lo que pone al centinela en el camino de la vista inversa.
    const grant = await POST("/v1/grants", {
      project_id: proyecto.id,
      agent_id: implementador.cuerpo.agente.id,
      credential_id: alta.cuerpo.credencial.id,
      concedido_por: "la persona que decidio",
    });
    assert.equal(grant.status, 201, JSON.stringify(grant.cuerpo));

    const activo = await POST(`/v1/projects/${proyecto.id}/activate`);
    assert.equal(activo.status, 200, JSON.stringify(activo.cuerpo));
    recorrido.push(activo.cuerpo.proyecto.estado);
    artefactosPorEtapa.push(listas((await pedir(`/v1/projects/${proyecto.id}`)).cuerpo.artefactos));

    // ---- NINGUNA TRANSICION SE SALTO --------------------------------------
    assert.deepEqual(
      recorrido,
      [...ESTADOS],
      "el proyecto no paso por los seis estados en orden: " + recorrido.join(" -> "),
    );
    for (let i = 1; i < recorrido.length; i++) {
      const arista = TRANSICIONES.find((tr) => tr.desde === recorrido[i - 1] && tr.hasta === recorrido[i]);
      assert.ok(arista, `\`${recorrido[i - 1]} -> ${recorrido[i]}\` no es una arista declarada del diagrama`);
      assert.ok(arista.artefacto, `la arista \`${recorrido[i - 1]} -> ${recorrido[i]}\` avanzo sin exigir artefacto`);
    }
    // Y EL ALMACEN LO DEMUESTRA: las guardas se pusieron en verde de a una y en
    // el orden del recorrido. Comprobar solo la cadena de estados dejaria pasar
    // un proyecto que llego a `ACTIVE` con la guarda de una etapa anterior en
    // rojo — que es justo lo que un segundo escritor produce.
    assert.deepEqual(
      artefactosPorEtapa,
      [
        [],
        ["snapshot_aceptado"],
        ["snapshot_aceptado", "constitution_vigente"],
        ["snapshot_aceptado", "constitution_vigente", "bootstrap_resuelto"],
        ["snapshot_aceptado", "constitution_vigente", "bootstrap_resuelto", "conexion_viva"],
        ["snapshot_aceptado", "constitution_vigente", "bootstrap_resuelto", "conexion_viva", "flota_declarada"],
      ],
      "las guardas del almacen no se fueron poniendo en verde de a una en el orden del recorrido",
    );

    // ---- 7. el ciclo: de ticket a PR abierto -------------------------------
    // Hasta aqui llega lo que el servicio puede hacer solo: `POST /runs` sobre
    // un proyecto ACTIVE contesta `pieza_ausente` DICIENDOLO, en vez de
    // devolver un `run_id` inventado que la interfaz pintaria en curso.
    const lanzar = await POST(`/v1/projects/${proyecto.id}/runs`, {});
    assert.equal(lanzar.status >= 400, true, JSON.stringify(lanzar.cuerpo));
    assert.equal(lanzar.cuerpo.error.codigo, "pieza_ausente");
    assert.match(lanzar.cuerpo.error.causa, /ACTIVE/, "el proyecto esta listo y la respuesta tiene que decirlo");
    assert.match(lanzar.cuerpo.error.accion, /home/, "la accion tiene que decir sobre que home lanzar el motor");

    const adaptadorDeAgente = crearAdaptadorFake();
    const preflight = await adaptadorDeAgente.preflight();
    assert.equal(preflight.ok, true, JSON.stringify(preflight));
    assert.equal(adaptadorDeAgente.capabilities().cost, false, "el adaptador fake no gasta, y no puede fingir que mide");

    const config = configDelMotor({ home: svc.home, repo: org.repo, remoto: org.remoto });
    const fases = [];
    const prs = [];
    const inject = {
      runPhase: runPhaseConAdaptadorFake(adaptadorDeAgente, fases),
      // El forge. Es lo unico que ademas del modelo no puede existir sin red ni
      // cuenta; todo lo demas —worktrees, gate, commits, cola de integracion—
      // corre de verdad.
      createPR: async (run, opts) => {
        prs.push({ base: opts.base, rama: run.item.branch, gaps: opts.gaps });
        return { url: "https://forge.test/pr/1", alreadyExisted: false };
      },
    };

    gestorFalso.reset();
    // Alguien asigna el ticket en el gestor. Eso es TODO lo que hace una persona
    // a partir de aqui.
    gestorFalso.db.inbox = { assigned: ["2"], mentioned: [] };
    pasos.push("MOTOR ticket asignado en el gestor falso");

    const bandeja = await ejecutarComando("inbox", null, config, { inject });
    pasos.push("MOTOR inbox");
    assert.equal(bandeja.nuevos.length, 1, `la bandeja no vio el ticket: ${JSON.stringify(bandeja)}`);

    const despacho = await ejecutarComando("dispatch", "2", config, { inject });
    pasos.push("MOTOR dispatch");
    assert.equal(despacho.level, "story", "el nivel se le pregunta al proveedor, no se adivina del titulo");

    const plan = await ejecutarComando("plan", "2", config, { inject });
    pasos.push("MOTOR plan");
    assert.equal(plan.ok, true, `no planifico: ${JSON.stringify(plan)}`);

    const corrida = await ejecutarComando("run", "2", config, { inject });
    pasos.push("MOTOR run");
    assert.equal(corrida.pr, "https://forge.test/pr/1", `no llego al PR: ${JSON.stringify(corrida)}`);
    assert.deepEqual(corrida.blocked, [], "quedaron tareas bloqueadas");
    // La planificacion ya no llega sin identificar. Decia `PLAN` a secas porque
    // el motor no mandaba `taskId`, que es lo que el contrato exige para poder
    // invocar; ahora dice a que item pertenece la invocacion, y `plan:` no
    // puede confundirse con una tarea del plan (`^T[0-9]{3,}$`), que todavia no
    // existe cuando esta fase corre.
    assert.deepEqual(
      fases,
      ["PLAN:plan:2", "RED:T001", "GREEN:T001", "REVIEW:T001"],
      "el ciclo no recorrio las fases",
    );

    // LO QUE QUEDO, que es lo que de verdad importa.
    const run = loadRun("2", { home: svc.home });
    const rama = run.item.branch;
    const historial = git(org.repo, "log", "--format=%s", "--reverse", rama).split("\n");
    const iTest = historial.findIndex((l) => l.startsWith("test("));
    const iImpl = historial.findIndex((l) => l.startsWith("feat("));
    assert.ok(iTest >= 0, `no hay commit de test: ${historial.join(" | ")}`);
    assert.ok(iImpl > iTest, `el test no existio antes que la implementacion: ${historial.join(" | ")}`);
    assert.match(git(org.repo, "show", `${rama}:src/permisos.mjs`), /catalogo/);
    // La autonomia termina en el PR abierto: la base NO se movio, ni aqui ni en
    // el remoto. Es el limite que el producto promete y el unico que no se
    // puede comprobar despues.
    assert.equal(git(org.repo, "log", "--oneline", "main").split("\n").length, 1);
    assert.equal(git(org.remoto, "log", "--oneline", "main").split("\n").length, 1);
    assert.equal(prs.length, 1);
    assert.equal(prs[0].base, "main");

    // Y el servicio lo PROYECTA: el archivo que escribio el motor se lee desde
    // la interfaz, sin que este proceso lo haya escrito nunca.
    const proyectado = await pedir(`/v1/runs/${run.item.id}`);
    assert.equal(proyectado.status, 200, JSON.stringify(proyectado.cuerpo));
    assert.equal(proyectado.cuerpo.run.item.pr, "https://forge.test/pr/1");
    assert.deepEqual(proyectado.cuerpo.avisos, [], "el servicio no pudo leer algun archivo de run");

    // LA OTRA COSTURA: el mismo run, pedido por proyecto, no aparece.
    const delProyecto = await pedir(`/v1/projects/${proyecto.id}/runs`);
    assert.equal(delProyecto.status, 200);
    if (delProyecto.cuerpo.items.length === 0) {
      puentes.push(
        "GET /v1/projects/:id/runs: el motor escribio `run-2.json` en el mismo home y el servicio no lo atribuye " +
          "a ningun proyecto. `esDelProyecto` mira `run.project_id` o `run.tasks[].repoPath`, y `createRun` no " +
          "escribe ninguno de los dos.",
      );
    }

    // ---- la auditoria ------------------------------------------------------
    const auditoria = await pedir("/v1/audit");
    assert.equal(auditoria.status, 200);
    assert.equal(auditoria.cuerpo.cadena.intacta, true, JSON.stringify(auditoria.cuerpo.cadena));

    // Se RECALCULA aqui, con los eslabones crudos del almacen. Preguntarle a
    // `verificarCadena` si la cadena esta bien y creerle es comprobar que la
    // funcion devuelve `true`, no que la cadena cierra: si el material firmado
    // cambiara y `hashDeEvento` cambiara con el, la verificacion interna
    // seguiria diciendo que si.
    const crudos = svc.dep.almacen.base.consultar("SELECT * FROM audit_event ORDER BY id ASC");
    let anterior = GENESIS;
    for (const fila of crudos) {
      assert.equal(String(fila.hash_anterior), anterior, `el evento ${fila.id} no encadena con el anterior`);
      const recalculado = hashDeEvento({
        id: Number(fila.id),
        instante: String(fila.instante),
        actor: String(fila.actor),
        accion: String(fila.accion),
        objeto_tipo: String(fila.objeto_tipo),
        objeto_id: String(fila.objeto_id),
        resultado: String(fila.resultado),
        detalle: String(fila.detalle),
        hash_anterior: String(fila.hash_anterior),
      });
      assert.equal(recalculado, String(fila.hash), `el hash del evento ${fila.id} no corresponde a su contenido`);
      anterior = String(fila.hash);
    }

    // Y REGISTRO LO QUE TENIA QUE REGISTRAR: las dos operaciones del recorrido
    // que tocan una credencial. Una cadena intacta sobre un registro vacio
    // verifica igual de bien y no explica nada.
    const acciones = crudos.map((f) => String(f.accion));
    assert.ok(
      acciones.some((a) => /credencial/.test(a)),
      `el alta de la credencial no dejo evento: ${acciones.join(", ")}`,
    );
    assert.ok(acciones.some((a) => /grant/.test(a)), `el grant no dejo evento: ${acciones.join(", ")}`);
    assert.ok(
      crudos.every((f) => String(f.actor).length > 0),
      "hay eventos sin actor: un acceso que no se le puede preguntar a nadie no explica nada despues",
    );
    exigirSinCentinela(JSON.stringify(crudos), "las filas crudas de la auditoria");

    // ---- el canal de eventos ----------------------------------------------
    const frames = await framesPendientes;
    assert.ok(eventos(frames).length > 0, "el canal no emitio nada en todo el recorrido");
    // La condicion que corta la lectura se AFIRMA. `leerFrames` devuelve lo
    // leido igual si se le acaba el tiempo —para que el fallo diga que falta en
    // vez de colgarse— y sin esta linea una condicion mal escrita pasaria
    // inadvertida: el recorrido se comeria la espera entera y seguiria verde.
    assert.ok(
      eventos(frames).some(esActivado),
      `la activacion del proyecto no llego por el canal: ${JSON.stringify(eventos(frames).map((e) => e.tipo))}`,
    );
    assert.ok(
      eventos(frames).some((e) => e.tipo === "scan.terminado"),
      "el fin del escaneo no llego por el canal, y es lo unico que le dice a la interfaz que puede pedir el snapshot",
    );
    exigirSinCentinela(JSON.stringify(frames), "el canal de eventos durante el recorrido completo");
  } finally {
    await svc.detener();
  }

  // ---- el centinela en el disco del home ---------------------------------
  // Se mira DESPUES de apagar: con la base abierta, lo que todavia esta en el
  // WAL no esta en ningun archivo que se pueda leer, y el recorrido pasaria por
  // no haber mirado donde estaba.
  for (const archivo of archivosDe(home)) {
    const bytes = readFileSync(archivo);
    for (const trozo of TROZOS) {
      assert.equal(
        bytes.includes(trozo),
        false,
        `\`${relative(home, archivo).split(sep).join("/")}\` del home contiene el valor de la credencial en claro. ` +
          "La boveda cifra su archivo y el almacen guarda solo la referencia y la huella: un valor legible aqui es " +
          "una fuga a cualquiera que tenga la carpeta.",
      );
    }
  }

  // ---- T205 --------------------------------------------------------------
  const duracionMs = Date.now() - arrancado;
  const manuales = pasos.filter((p) => !p.startsWith("HTTP ") && !p.startsWith("MOTOR "));
  assert.deepEqual(
    manuales,
    [],
    "hubo pasos del recorrido que no fueron ni una peticion al servicio ni un comando del motor",
  );

  // El numero, en la salida del test. El criterio publicado —15 minutos para
  // una persona— no es este numero y no se finge que lo sea: lo que un test
  // mide es el reloj de una maquina sin nadie leyendo ni decidiendo. Lo que SI
  // es comprobable, y es lo que de verdad se afirma, es la ausencia de pasos
  // manuales: cada cambio en el arbol del operador lleva la firma del paso del
  // producto que lo declaro, y esa comprobacion esta arriba.
  const linea =
    `T205 · recorrido completo en ${duracionMs} ms (${(duracionMs / 1000).toFixed(1)} s), ` +
    `${pasos.length} pasos, 0 ediciones a mano` +
    (puentes.length ? `, ${puentes.length} costura(s) cruzada(s) a mano:\n  - ${puentes.join("\n  - ")}` : "");
  t.diagnostic(linea);
  console.log(linea);
});

/** Los nombres de las guardas que el almacen da por buenas, en el orden que declara. */
function listas(artefactos) {
  return Object.entries(artefactos)
    .filter(([, v]) => v.listo)
    .map(([k]) => k);
}

// ---------------------------------------------------------------------------
// Las costuras, escritas como hechos medidos
// ---------------------------------------------------------------------------

// La costura de la etapa 06 —`authorize` conectaba y no dejaba fila en
// `connection`, y ninguna ruta llevaba un proyecto a `CONNECTED`— estaba escrita
// aqui como hecho medido. Se cerro: la traduccion entre los dos vocabularios
// vive en `packages/service/src/credenciales.mjs` y el recorrido de arriba pasa
// por `CONNECTED` por su propio camino. El test que la documentaba se borro con
// ella, porque un test que describe un hueco ya tapado miente sobre el estado
// del producto. Lo que lo sostiene ahora esta en el recorrido y en
// `credenciales.test.mjs`.

test("el recorrido discrimina: las dos busquedas del centinela SI lo encuentran cuando esta", () => {
  // EL CONTROL. Sin el, "no aparece en ninguna respuesta ni en ningun archivo"
  // puede significar que nadie estaba mirando: una asercion que nunca falla y
  // una que no se ejecuta se ven igual desde el informe de tests. Se prueban
  // los dos instrumentos del recorrido —el de texto sobre lo que sale por el
  // cable y el de bytes sobre los archivos del home— porque son distintos y
  // cada uno se puede romper por su cuenta.
  assert.throws(
    () => exigirSinCentinela(`{"cuerpo":"${CENTINELA}"}`, "una respuesta con el centinela plantado"),
    /sin segundo intento/,
    "la busqueda sobre lo que sale por el cable no ve el centinela ni cuando esta",
  );
  // Tambien partido: un redactor que corta el valor a la mitad y deja la cola
  // suelta pasaria una comparacion exacta y filtraria igual.
  assert.throws(
    () => exigirSinCentinela(`ruido ${CENTINELA.slice(-24)} mas ruido`, "una respuesta con media cola del centinela"),
    /sin segundo intento/,
    "la busqueda solo reconoce el valor entero: un valor partido pasa",
  );

  const archivo = join(mkdtempSync(join(tmpdir(), "noxloop-p2p-control-")), "un-archivo-del-home.bin");
  writeFileSync(archivo, Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(CENTINELA, "utf8")]));
  assert.equal(
    readFileSync(archivo).includes(CENTINELA),
    true,
    "la busqueda en bytes no encuentra el centinela en un archivo que lo tiene: el recorrido del home no prueba nada",
  );
});
