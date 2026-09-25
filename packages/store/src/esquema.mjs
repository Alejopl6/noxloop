// El esquema del almacen consultable: las 14 entidades de `data-model.md`.
//
// SON 16 TABLAS PARA 14 ENTIDADES, Y NO ES UN DESCUADRE. `AutonomyLevel` es
// "propiedad del proyecto, no tabla propia" y vive como columna de `project`;
// `SnapshotFinding`, `ConstitutionAmendment` y `SshAccess` se documentan como
// sub-entidades y necesitan su tabla.
//
// LOS NOMBRES DE CAMPO SON LOS DE `data-model.md`, LETRA POR LETRA. Un campo
// renombrado "para que quede mejor" obliga a una traduccion en cada lectura, y
// la traduccion es donde se pierden los invariantes: el dia que alguien mapea
// `vigencia_hasta` a `expira` porque suenan parecido, la vista inversa empieza
// a contestar sobre otra cosa.
//
// POR QUE LOS INVARIANTES ESTAN EN LA BASE Y NO SOLO EN LOS REPOSITORIOS. Un
// invariante comprobado en el repositorio protege a quien entra por el
// repositorio. Esta base la abre tambien una migracion, una consola de soporte
// y el proximo frente que escriba su propio SQL porque "es una consulta
// tonta". Un `CHECK` y un disparador se cumplen para todos y sobreviven a que
// alguien reescriba el repositorio entero.
//
// POR QUE TODAS LAS TABLAS SON `STRICT`. Sin `STRICT`, SQLite guarda en una
// columna TEXT lo que le echen. Un `estado` escrito como entero por un cliente
// descuidado no casa con ningun `WHERE estado = 'viva'`: el proyecto
// desaparece de la bandeja y no hay ningun error por ningun lado.
//
// LOS INSTANTES SON TEXTO ISO-8601 EN UTC. Comparan y ordenan como cadenas, que
// es lo que permite que los indices sirvan para el orden, y se leen tal cual en
// un volcado. Un entero de milisegundos obliga a convertir para mirarlo, y una
// fecha mal convertida en una consulta de vigencia es un grant que autoriza un
// dia de mas.

/** Los nombres de tabla, para las guardas y las consultas de mantenimiento. */
export const TABLAS = Object.freeze([
  "workspace",
  "project",
  "project_snapshot",
  "snapshot_finding",
  "constitution",
  "constitution_amendment",
  "guideline",
  "recommendation",
  "credential",
  "ssh_access",
  "connection",
  "agent",
  "grant",
  "inbox_entry",
  "audit_event",
  "danger_policy",
  // Spec 003 (FR-030): el gestor de tareas local. Tres tablas para UNA entidad
  // —la tarea—, y no es un descuadre: la numeracion por proyecto y los
  // comentarios son sub-entidades que necesitan su fila.
  "local_task",
  "local_task_comment",
  "local_task_sequence",
  // Spec 005 (FR-005..006): el orden a mano del board y los ajustes del
  // servicio (el limite de runs simultaneos).
  "card_order",
  "service_setting",
  // Spec 005 (US1 esc. 4, FR-004): lo que el operador decidio sobre una tarjeta
  // «movida» — seguir aqui o soltarla.
  "movida_decision",
]);

/** Los enums de `data-model.md`, en un solo sitio. */
export const ENUMS = Object.freeze({
  "project.origen": ["nuevo", "local", "remoto"],
  "project.estado": ["CREATED", "DISCOVERED", "CONSTITUTED", "BOOTSTRAPPED", "CONNECTED", "ACTIVE"],
  "project.autonomia": ["L0", "L1", "L2"],
  "project_snapshot.estado": ["en_curso", "completo", "cancelado"],
  "snapshot_finding.categoria": [
    "stack",
    "arquitectura",
    "patrones",
    "testing",
    "ci",
    "dependencias",
    "guidelines",
    "agentes",
    "riesgos",
  ],
  "snapshot_finding.origen": ["detectado", "inferido", "declarado"],
  "snapshot_finding.confianza": ["alta", "media", "baja"],
  "snapshot_finding.decision": ["pendiente", "aceptado", "corregido", "descartado"],
  "guideline.area": ["frontend", "backend", "testing", "git", "seguridad", "agentes", "diseno"],
  "recommendation.tipo": ["hook", "skill", "mcp", "tool", "subagente", "validacion", "ci"],
  "recommendation.decision": ["pendiente", "aplicada", "personalizada", "omitida"],
  "connection.clase": ["tracker", "scm", "infra", "integracion"],
  "connection.estado": ["pendiente", "viva", "expirada", "revocada", "fallida"],
  "credential.tipo": ["api_token", "tracker", "scm", "modelo", "ssh"],
  "credential.ambito": ["global", "proyecto"],
  "credential.backend": ["keychain_so", "archivo_cifrado"],
  "credential.estado": ["activa", "por_expirar", "expirada", "revocada"],
  "agent.rol": ["implementador", "revisor", "planificador", "verificador"],
  "inbox_entry.tipo": [
    "pregunta_agente",
    "autorizacion_credencial",
    "permiso_tool",
    "gate_rojo",
    "conflicto_integracion",
    "hallazgo_revision",
    "decision_merge",
    "decision_despliegue",
  ],
  "inbox_entry.estado": ["esperando", "aprobada", "rechazada", "cambios_solicitados", "caducada"],
  "audit_event.resultado": ["permitido", "denegado", "error"],
  // Los cinco canonicos del contrato de proveedor mas `backlog`, que es el
  // estado de LECTURA del board (ver `LISTED_STATES` en providers/contract.mjs).
  // Aqui si se escribe: el gestor local distingue backlog de todo porque el
  // operador lo decide al crear la tarea.
  "local_task.estado": ["backlog", "todo", "in_progress", "blocked", "in_review", "done"],
  // Como termina la tarea (FR-032). NINGUNO mergea: la autonomia termina en el
  // PR abierto (principio IV), y un valor `merge` que el CHECK aceptara seria
  // un valor que alguien acabaria poniendo.
  "local_task.termino": ["changes", "commit", "pr"],
  // Una tarjeta «movida» (spec 005, FR-004) se queda en este board sin el chip
  // (`seguir`) o deja de pintarse en el (`soltar`). No hay un tercero: «volver
  // a preguntar» es borrar la fila, y el board vuelve a pintar el chip.
  "movida_decision.decision": ["seguir", "soltar"],
  "danger_policy.capacidad": [
    "merge_autonomo",
    "despliegue",
    "bd_produccion",
    "comandos_destructivos",
    "infraestructura",
    "cuentas_externas",
  ],
});

/** @param {string} campo @returns {string} el `IN (...)` del CHECK, generado del mismo sitio que valida el repositorio */
const en = (campo) => `IN (${ENUMS[campo].map((v) => `'${v}'`).join(", ")})`;

const TABLAS_SQL = `
CREATE TABLE workspace (
  id              TEXT PRIMARY KEY,
  home            TEXT NOT NULL,
  creado          TEXT NOT NULL,
  version_esquema INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE project (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  nombre       TEXT NOT NULL,
  slug         TEXT NOT NULL,
  origen       TEXT NOT NULL CHECK (origen ${en("project.origen")}),
  ruta_local   TEXT NOT NULL,
  remoto       TEXT,
  estado       TEXT NOT NULL CHECK (estado ${en("project.estado")}),
  -- AutonomyLevel: propiedad del proyecto, no tabla propia. El CHECK corta en
  -- L2 porque es el maximo alcanzable en esta feature: L3 es merge sin persona,
  -- y el principio IV dice que la autonomia termina en el PR abierto. Una
  -- columna que acepta L3 hoy es una columna que alguien pone a L3.
  autonomia    TEXT NOT NULL DEFAULT 'L0' CHECK (autonomia ${en("project.autonomia")}),
  creado       TEXT NOT NULL,
  actualizado  TEXT NOT NULL,
  -- Unico EN EL WORKSPACE, no globalmente: dos instalaciones distintas pueden
  -- tener un proyecto con el mismo slug y no es un conflicto.
  UNIQUE (workspace_id, slug)
) STRICT;

CREATE TABLE project_snapshot (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  -- "commit" entrecomillado: es palabra reservada de SQL y el nombre del campo
  -- en \`data-model.md\` es ese. Se respeta el nombre y se paga la comilla.
  "commit"    TEXT NOT NULL,
  creado      TEXT NOT NULL,
  estado      TEXT NOT NULL DEFAULT 'en_curso' CHECK (estado ${en("project_snapshot.estado")}),
  duracion_ms INTEGER,
  -- NFR-001 se mide con \`duracion_ms\`, y una medida que falta no es cero: un
  -- snapshot \`completo\` sin duracion deja la metrica contando de menos.
  CHECK (estado <> 'completo' OR duracion_ms IS NOT NULL)
) STRICT;

CREATE TABLE snapshot_finding (
  id              TEXT PRIMARY KEY,
  snapshot_id     TEXT NOT NULL REFERENCES project_snapshot(id) ON DELETE CASCADE,
  categoria       TEXT NOT NULL CHECK (categoria ${en("snapshot_finding.categoria")}),
  clave           TEXT NOT NULL,
  -- \`valor\` aqui es el dato tecnico leido del proyecto ("runtime.node": "22"),
  -- no un secreto. Si el scanner encuentra uno, emite un hallazgo
  -- \`categoria = riesgos\` con la RUTA y nunca el valor, ni truncado.
  valor           TEXT NOT NULL CHECK (json_valid(valor)),
  origen          TEXT NOT NULL CHECK (origen ${en("snapshot_finding.origen")}),
  evidencia       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidencia)),
  confianza       TEXT NOT NULL CHECK (confianza ${en("snapshot_finding.confianza")}),
  decision        TEXT NOT NULL DEFAULT 'pendiente' CHECK (decision ${en("snapshot_finding.decision")}),
  valor_corregido TEXT CHECK (valor_corregido IS NULL OR json_valid(valor_corregido)),
  -- FR-013, y es el principio X escrito en SQL: un hallazgo \`detectado\` sin
  -- evidencia NO SE PERSISTE. No se guarda marcado, no se guarda con aviso: no
  -- se guarda. El verde inventado se descubre cuando el codigo falla; el
  -- contexto inventado no se descubre nunca, porque se vuelve la constitution
  -- del proyecto y el runtime la aplica durante meses.
  CHECK (origen <> 'detectado' OR json_array_length(evidencia) > 0)
) STRICT;

CREATE TABLE constitution (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  version      TEXT NOT NULL,
  ruta_en_repo TEXT NOT NULL,
  contenido    TEXT NOT NULL,
  ratificada   TEXT NOT NULL,
  enmendada    TEXT,
  vigente      INTEGER NOT NULL DEFAULT 0 CHECK (vigente IN (0, 1))
) STRICT;

CREATE TABLE constitution_amendment (
  id                 TEXT PRIMARY KEY,
  constitution_id    TEXT NOT NULL REFERENCES constitution(id) ON DELETE CASCADE,
  version_anterior   TEXT NOT NULL,
  version_nueva      TEXT NOT NULL,
  principio          TEXT NOT NULL,
  -- Los dos CHECK de longitud son el invariante de la propia constitution del
  -- repositorio: "una enmienda sin un fallo detras no es una enmienda, es una
  -- preferencia". Lo que exigimos de nosotros lo exigimos del producto.
  fallo_que_motiva   TEXT NOT NULL CHECK (length(trim(fallo_que_motiva)) > 0),
  que_se_rompe_si_no TEXT NOT NULL CHECK (length(trim(que_se_rompe_si_no)) > 0),
  fecha              TEXT NOT NULL
) STRICT;

CREATE TABLE guideline (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  area              TEXT NOT NULL CHECK (area ${en("guideline.area")}),
  ruta_en_repo      TEXT NOT NULL,
  contenido         TEXT NOT NULL,
  reglas_aplicables TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reglas_aplicables))
) STRICT;

CREATE TABLE recommendation (
  id                     TEXT PRIMARY KEY,
  project_id             TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  tipo                   TEXT NOT NULL CHECK (tipo ${en("recommendation.tipo")}),
  titulo                 TEXT NOT NULL,
  justificacion          TEXT NOT NULL,
  -- FR-026: el diff se calcula ANTES de proponer, asi que no es nullable. Una
  -- recomendacion sin diff es una idea, y una idea no se puede aplicar ni
  -- revisar: el operador tendria que confiar en el titulo.
  diff                   TEXT NOT NULL,
  conflicto_constitution TEXT,
  decision               TEXT NOT NULL DEFAULT 'pendiente' CHECK (decision ${en("recommendation.decision")}),
  motivo_decision        TEXT,
  decidida               TEXT,
  CHECK (decision = 'pendiente' OR decidida IS NOT NULL)
) STRICT;

CREATE TABLE credential (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  nombre            TEXT NOT NULL,
  proveedor         TEXT NOT NULL,
  tipo              TEXT NOT NULL CHECK (tipo ${en("credential.tipo")}),
  ambito            TEXT NOT NULL CHECK (ambito ${en("credential.ambito")}),
  project_id        TEXT REFERENCES project(id) ON DELETE CASCADE,
  alcance_declarado TEXT NOT NULL,
  -- \`huella\` es el HASH del valor, y cambia al rotar. No es el valor ni un
  -- trozo suyo: contra un token con prefijo fijo, 32 caracteres del principio
  -- son casi todo lo que hace falta.
  huella            TEXT,
  -- \`ref_boveda\` es un PUNTERO al backend de secretos. Pedirle el valor es una
  -- llamada a la boveda con grant vigente, no una lectura de esta tabla.
  ref_boveda        TEXT NOT NULL UNIQUE,
  backend           TEXT NOT NULL CHECK (backend ${en("credential.backend")}),
  creada            TEXT NOT NULL,
  rotada            TEXT,
  expira            TEXT,
  aviso_dias_antes  INTEGER NOT NULL DEFAULT 14 CHECK (aviso_dias_antes >= 0),
  estado            TEXT NOT NULL DEFAULT 'activa' CHECK (estado ${en("credential.estado")}),
  -- El ambito y el proyecto tienen que decir lo mismo. Una credencial 'global'
  -- con proyecto es una credencial que dos pantallas cuentan distinto.
  CHECK ((ambito = 'global' AND project_id IS NULL) OR (ambito = 'proyecto' AND project_id IS NOT NULL))
) STRICT;
-- NO HAY COLUMNA PARA EL VALOR, Y NO LA HAY A PROPOSITO (FR-041, principio IX).
-- Una columna \`valor\` hoy a NULL es una invitacion: la proxima persona que
-- necesite el valor a mano lo rellena, porque el sitio ya estaba hecho. Si la
-- columna no existe, agregarla es una decision visible en el diff y cae la
-- prueba que enumera las columnas de esta tabla.

CREATE TABLE ssh_access (
  id                   TEXT PRIMARY KEY,
  credential_id        TEXT NOT NULL REFERENCES credential(id) ON DELETE CASCADE,
  host                 TEXT NOT NULL,
  usuario              TEXT NOT NULL,
  puerto               INTEGER NOT NULL DEFAULT 22,
  -- Fijada, sin aceptacion silenciosa de hosts desconocidos: un SSH que acepta
  -- la huella que le llegue es un SSH que se deja suplantar el destino, y del
  -- otro lado hay un shell remoto donde no llegan los hooks locales.
  huella_host          TEXT NOT NULL CHECK (length(trim(huella_host)) > 0),
  comandos_permitidos  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(comandos_permitidos)),
  escritura_autorizada INTEGER NOT NULL DEFAULT 0 CHECK (escritura_autorizada IN (0, 1))
) STRICT;

CREATE TABLE connection (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  clase         TEXT NOT NULL CHECK (clase ${en("connection.clase")}),
  proveedor     TEXT NOT NULL,
  id_externo    TEXT,
  estado        TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado ${en("connection.estado")}),
  credential_id TEXT REFERENCES credential(id) ON DELETE RESTRICT,
  capacidades   TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(capacidades)),
  -- FR-032: \`scm\` no es una integracion. Git se habla directo y la capa de
  -- integracion no se interpone, asi que una conexion \`scm\` no tiene
  -- identificador EN esa capa. Un \`id_externo\` ahi es la senal de que alguien
  -- metio el repositorio por el proveedor, y a partir de ese dia clonar
  -- depende de que el proveedor conteste.
  CHECK (clase <> 'scm' OR id_externo IS NULL)
) STRICT;

CREATE TABLE agent (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  rol         TEXT NOT NULL CHECK (rol ${en("agent.rol")}),
  runtime     TEXT NOT NULL,
  modelo      TEXT NOT NULL,
  skills      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(skills)),
  tools       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tools)),
  mcps        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(mcps)),
  permisos    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(permisos)),
  presupuesto TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(presupuesto)),
  contexto    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(contexto)),
  UNIQUE (project_id, nombre)
) STRICT;

CREATE TABLE "grant" (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  agent_id       TEXT NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
  credential_id  TEXT NOT NULL REFERENCES credential(id) ON DELETE CASCADE,
  vigencia_desde TEXT NOT NULL,
  vigencia_hasta TEXT,
  -- "Siempre una persona": un grant concedido por "el sistema" no se le puede
  -- preguntar a nadie por que existe.
  concedido_por  TEXT NOT NULL CHECK (length(trim(concedido_por)) > 0),
  concedido_en   TEXT NOT NULL,
  revocado_en    TEXT,
  -- La tripleta (FR-042) es la unidad: dos filas identicas son dos veces el
  -- mismo permiso, y revocar una deja la otra viva sin que nadie lo vea.
  UNIQUE (project_id, agent_id, credential_id, concedido_en)
) STRICT;

CREATE TABLE inbox_entry (
  id                  TEXT PRIMARY KEY,
  workspace_id        TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  project_id          TEXT REFERENCES project(id) ON DELETE CASCADE,
  tipo                TEXT NOT NULL CHECK (tipo ${en("inbox_entry.tipo")}),
  -- FR-062: textual y COMPLETA, no un resumen generado. Una causa vacia
  -- convierte la bandeja en una lista de titulos sin nada que decidir, y el
  -- operador tiene que salir de la aplicacion a buscar el contexto.
  causa               TEXT NOT NULL CHECK (length(trim(causa)) > 0),
  contexto            TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(contexto)),
  decisiones_posibles TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(decisiones_posibles)),
  estado              TEXT NOT NULL DEFAULT 'esperando' CHECK (estado ${en("inbox_entry.estado")}),
  creada              TEXT NOT NULL,
  resuelta            TEXT,
  resuelta_por        TEXT,
  -- La metrica que esta tabla habilita es \`resuelta - creada\`. Una entrada
  -- resuelta sin \`resuelta\` no da error: da una media que se deja fuera justo
  -- los casos que mas tardaron. \`caducada\` no lleva \`resuelta_por\` porque no
  -- la resolvio nadie, y eso es precisamente lo que hay que poder contar.
  CHECK (
    (estado = 'esperando' AND resuelta IS NULL AND resuelta_por IS NULL)
    OR (estado = 'caducada' AND resuelta IS NOT NULL AND resuelta_por IS NULL)
    OR (estado IN ('aprobada', 'rechazada', 'cambios_solicitados') AND resuelta IS NOT NULL AND resuelta_por IS NOT NULL)
  )
) STRICT;

CREATE TABLE audit_event (
  -- Entero y creciente: el ORDEN es parte de lo que se firma. El id lo asigna
  -- el repositorio dentro de la transaccion en vez de dejarlo a AUTOINCREMENT
  -- porque el hash lo incluye, y para incluirlo hay que conocerlo antes de
  -- escribir la fila (la tabla no admite el UPDATE posterior que lo arreglaria).
  id            INTEGER PRIMARY KEY,
  instante      TEXT NOT NULL,
  actor         TEXT NOT NULL,
  accion        TEXT NOT NULL,
  objeto_tipo   TEXT NOT NULL,
  objeto_id     TEXT NOT NULL,
  resultado     TEXT NOT NULL CHECK (resultado ${en("audit_event.resultado")}),
  -- Redactado contra la boveda ANTES de escribir (FR-050, principio IX). La
  -- redaccion posterior no sirve: hubo un instante en que estuvo en disco, y un
  -- instante es todo lo que hace falta.
  detalle       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detalle)),
  hash_anterior TEXT NOT NULL,
  hash          TEXT NOT NULL UNIQUE
) STRICT;
-- Sin NINGUNA clave foranea, y es deliberado: con \`ON DELETE CASCADE\` sobre el
-- proyecto, dar de baja un proyecto borraria justo los eventos que explican por
-- que se dio de baja.

CREATE TABLE danger_policy (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  capacidad      TEXT NOT NULL CHECK (capacidad ${en("danger_policy.capacidad")}),
  habilitada     INTEGER NOT NULL DEFAULT 0 CHECK (habilitada IN (0, 1)),
  habilitada_por TEXT,
  habilitada_en  TEXT,
  condiciones    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(condiciones)),
  UNIQUE (project_id, capacidad),
  -- Habilitar una capacidad de alto impacto sin quien ni cuando deja la
  -- decision sin dueno, que es lo contrario de lo que pide FR-051.
  CHECK (habilitada = 0 OR (habilitada_por IS NOT NULL AND habilitada_en IS NOT NULL))
) STRICT;

-- FR-034: en un mismo proyecto, el \`revisor\` no comparte \`runtime\` con el
-- \`implementador\`. "Se valida al guardar, no al ejecutar": validarlo al
-- ejecutar significa descubrir a mitad de un recorrido que quien revisa es el
-- mismo que escribio, cuando ya hay un PR abierto y una revision firmada que no
-- vale nada. Es un disparador y no un CHECK porque mira otras filas.
CREATE TRIGGER agent_runtime_separado_insert
BEFORE INSERT ON agent
WHEN EXISTS (
  SELECT 1 FROM agent a
  WHERE a.project_id = NEW.project_id
    AND a.runtime = NEW.runtime
    AND ((NEW.rol = 'revisor' AND a.rol = 'implementador') OR (NEW.rol = 'implementador' AND a.rol = 'revisor'))
)
BEGIN
  SELECT RAISE(ABORT, 'FR-034: en un proyecto el revisor no puede compartir runtime con el implementador');
END;

CREATE TRIGGER agent_runtime_separado_update
BEFORE UPDATE OF runtime, rol, project_id ON agent
WHEN EXISTS (
  SELECT 1 FROM agent a
  WHERE a.project_id = NEW.project_id
    AND a.id <> NEW.id
    AND a.runtime = NEW.runtime
    AND ((NEW.rol = 'revisor' AND a.rol = 'implementador') OR (NEW.rol = 'implementador' AND a.rol = 'revisor'))
)
BEGIN
  SELECT RAISE(ABORT, 'FR-034: en un proyecto el revisor no puede compartir runtime con el implementador');
END;

-- FR-051: no hay camino en la aplicacion que CREE una politica peligrosa
-- habilitada. El CHECK de arriba deja habilitarla con quien y cuando; este
-- disparador impide que nazca asi. La diferencia importa: una fila que nace
-- habilitada no tiene el momento en que alguien decidio habilitarla, y ese
-- momento es lo unico que hace auditable la decision.
CREATE TRIGGER danger_policy_nace_apagada
BEFORE INSERT ON danger_policy
WHEN NEW.habilitada <> 0
BEGIN
  SELECT RAISE(ABORT, 'FR-051: una capacidad de alto impacto nace desactivada; habilitala despues, con quien y cuando');
END;
`;

const INDICES_SQL = `
-- La vista de inicio (NFR-002). Cada subconsulta por proyecto entra por
-- (project_id, <lo que filtra>) para que sea una busqueda y no un recorrido.
-- Con 20 proyectos y dos anos de bandeja, la diferencia entre buscar y recorrer
-- es la diferencia entre la pantalla que abre y la que el operador cierra.
CREATE INDEX project_por_workspace       ON project(workspace_id, actualizado DESC);
CREATE INDEX inbox_por_proyecto_estado   ON inbox_entry(project_id, estado);
CREATE INDEX inbox_por_workspace_estado  ON inbox_entry(workspace_id, estado);
CREATE INDEX recomendacion_por_proyecto  ON recommendation(project_id, decision);
CREATE INDEX agente_por_proyecto         ON agent(project_id);
CREATE INDEX snapshot_por_proyecto       ON project_snapshot(project_id, creado DESC);
CREATE INDEX hallazgo_por_snapshot       ON snapshot_finding(snapshot_id, decision);
CREATE INDEX conexion_por_proyecto       ON connection(project_id, estado);
CREATE INDEX constitution_por_proyecto   ON constitution(project_id, vigente);

-- "Una sola por proyecto" como indice unico parcial: la base lo impide, no el
-- repositorio. Dos constitutions vigentes a la vez es un proyecto donde cada
-- lector aplica una distinta segun como ordene la consulta.
CREATE UNIQUE INDEX constitution_vigente_unica ON constitution(project_id) WHERE vigente = 1;

-- La vista inversa (FR-045). Se consulta desde la pantalla de una credencial,
-- que es donde el operador esta decidiendo si revocar: un recorrido completo de
-- \`grant\` ahi se nota igual que en el inicio.
CREATE INDEX grant_por_credencial ON "grant"(credential_id, revocado_en, vigencia_hasta);
CREATE INDEX grant_por_agente     ON "grant"(agent_id, revocado_en);
CREATE INDEX grant_por_proyecto   ON "grant"(project_id, revocado_en);

CREATE INDEX credencial_por_workspace  ON credential(workspace_id, estado);
CREATE INDEX credencial_por_expiracion ON credential(expira) WHERE expira IS NOT NULL;
CREATE INDEX auditoria_por_objeto      ON audit_event(objeto_tipo, objeto_id);
CREATE INDEX politica_por_proyecto     ON danger_policy(project_id, capacidad);
`;

// LA CONEXION PASA A PODER SER DEL ESPACIO DE TRABAJO (`project_id` opcional).
//
// EL FALLO CONCRETO, VISTO EN PANTALLA. En «Anadir proyecto» -> «Repositorio
// remoto» la pantalla decia «Sin cuenta de codigo conectada» y ofrecia un
// boton: «Ir a un proyecto y conectar». Para dar de alta un proyecto habia que
// salir a otro proyecto, conectar ahi la cuenta de codigo, y volver. La
// pantalla no se equivocaba sola: `connection.project_id` era `NOT NULL
// REFERENCES project(id)`, y en el alta el proyecto todavia no existe, asi que
// no habia fila que escribir. El codigo resolvio el conflicto mandando fuera al
// operador — doblarlo para que encaje en el modelo de datos.
//
// POR QUE LA CORRECCION ES DEL MODELO Y NO DE LA PANTALLA. Un operador tiene
// UNA cuenta de codigo y muchos repositorios: la conecta una vez y todos sus
// proyectos eligen de ahi. Un `tracker` si puede ser por proyecto —dos
// proyectos pueden vivir en dos Jira distintos— pero la cuenta de codigo no lo
// es en la practica, y modelarla por proyecto obliga a reconectarla N veces
// guardando N copias del mismo token en la boveda.
//
// POR QUE APARECE `workspace_id`, Y NO ES UN CAMPO DE MAS. Hasta aqui la
// conexion sabia a que espacio de trabajo pertenece POR SU PROYECTO. Con
// `project_id` en `NULL` esa cadena se corta y la fila queda flotando: la
// guarda de un proyecto del espacio A contaria una conexion creada en el
// espacio B. El campo no agrega informacion —la que habia estaba implicita—
// sino que la deja donde se puede consultar, que es lo que la guarda necesita.
//
// POR QUE SE RECONSTRUYE LA TABLA ENTERA. SQLite no sabe quitarle el `NOT NULL`
// a una columna ni agregar una `NOT NULL` sin valor constante por defecto: la
// unica via es tabla nueva, copia, `DROP` y `RENAME`. Y la migracion 1 no se
// edita —su huella esta escrita en la base del operador— asi que esto es una
// version nueva, no un retoque de la que ya corrio.
//
// EL `CHECK` DE FR-032 SE QUEDA TAL CUAL. `scm` sigue sin `id_externo`: git se
// habla directo y la capa de integracion no se interpone. El alcance de la
// conexion no cambia nada de eso, y quitarlo "de paso" al reconstruir la tabla
// seria perder un invariante en una migracion que no venia a tocarlo.
const CONEXION_DEL_ESPACIO_SQL = `
CREATE TABLE connection_nueva (
  id            TEXT PRIMARY KEY,
  -- Una conexion pertenece SIEMPRE a un espacio de trabajo. Lo que es opcional
  -- es el proyecto.
  workspace_id  TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  -- \`NULL\` = del espacio de trabajo. No es "sin proyecto todavia": es un
  -- alcance distinto, y las dos pantallas que lo pintan tienen que poder
  -- distinguirlo sin adivinar.
  project_id    TEXT REFERENCES project(id) ON DELETE CASCADE,
  clase         TEXT NOT NULL CHECK (clase ${en("connection.clase")}),
  proveedor     TEXT NOT NULL,
  id_externo    TEXT,
  estado        TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado ${en("connection.estado")}),
  credential_id TEXT REFERENCES credential(id) ON DELETE RESTRICT,
  capacidades   TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(capacidades)),
  -- FR-032, palabra por palabra igual que antes: \`scm\` no es una integracion.
  CHECK (clase <> 'scm' OR id_externo IS NULL)
) STRICT;

-- El \`JOIN\` es lo que rellena \`workspace_id\` de lo que ya habia: hasta ahora
-- toda conexion tenia proyecto, asi que su espacio de trabajo es el de su
-- proyecto y no hay que inventar ninguno. Es un \`JOIN\` y no un \`LEFT JOIN\` a
-- proposito: una conexion que apuntara a un proyecto inexistente no puede
-- entrar con \`workspace_id\` en NULL a una columna \`NOT NULL\` —la migracion
-- moriria a mitad— y ademas no deberia existir, porque la clave foranea la
-- impedia.
INSERT INTO connection_nueva (id, workspace_id, project_id, clase, proveedor, id_externo, estado, credential_id, capacidades)
SELECT c.id, p.workspace_id, c.project_id, c.clase, c.proveedor, c.id_externo, c.estado, c.credential_id, c.capacidades
FROM connection c JOIN project p ON p.id = c.project_id;

DROP TABLE connection;
ALTER TABLE connection_nueva RENAME TO connection;

-- El \`DROP\` se llevo el indice que creo la migracion 2, asi que se rehace con
-- el mismo nombre. Sin esta linea la vista de inicio pasa de buscar a recorrer
-- y nadie se entera hasta que el operador tiene dos anos de uso encima.
CREATE INDEX conexion_por_proyecto ON connection(project_id, estado);
-- El de la guarda y el del selector de repositorios: «las conexiones vivas de
-- ESTE espacio de trabajo que no son de ningun proyecto».
CREATE INDEX conexion_por_espacio ON connection(workspace_id, estado, project_id);
`;

const APPEND_ONLY_SQL = `
-- \`AuditEvent\` es append-only: sin UPDATE, sin DELETE (FR-049).
--
-- POR QUE UN DISPARADOR Y NO "no exponemos el metodo". No exponer el metodo
-- protege de la ruta que hoy no existe; no protege del \`UPDATE\` escrito sin
-- mala intencion en una migracion futura ("corrijo el actor de esos eventos,
-- que salio mal"), que borra la unica constancia de quien hizo que.
--
-- Contra quien tiene el archivo esto no protege —un \`DROP TRIGGER\` lo quita—
-- y por eso ademas esta el encadenamiento de hash. Son dos mecanismos contra
-- dos atacantes distintos, y ninguno sustituye al otro.
CREATE TRIGGER audit_event_sin_update
BEFORE UPDATE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'audit_event es append-only (FR-049): no se edita, se escribe un evento nuevo');
END;

CREATE TRIGGER audit_event_sin_delete
BEFORE DELETE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'audit_event es append-only (FR-049): no se borra, ni siquiera para limpiar');
END;
`;

// LAS TAREAS PROPIAS (spec 003, FR-030..032). Una version nueva y no un
// retoque de la 1: la huella de la 1 esta escrita en la base del operador.
//
// POR QUE `local_task` Y NO `task`. Una tabla `task` es exactamente la senal que
// la guarda de `paquete-autocontenido.test.mjs` busca para detectar que el
// almacen empezo a guardar las tareas DEL RUN (T001, T002...), que son del
// motor y viven en archivos (principio III). Esto es otra cosa —un ticket del
// gestor local, lo que el motor RECIBE para planificar— y el nombre tiene que
// decirlo: con `task` a secas, el proximo que lea el esquema creeria que el
// run se proyecta aqui.
//
// POR QUE LA NUMERACION TIENE TABLA PROPIA Y NO ES UN `MAX(numero) + 1`. Con
// `MAX + 1`, borrar la ultima tarea devuelve su numero a la siguiente, y
// `PAY-12` pasa a nombrar dos cosas distintas en dos momentos: el comentario
// de un PR viejo que dice «cierra PAY-12» apunta a la tarea equivocada. La
// secuencia solo avanza. Y el prefijo vive con ella porque es del PROYECTO, no
// de cada tarea: cambiarlo afecta a las siguientes y no reescribe las claves
// que ya se citaron en algun sitio.
//
// POR QUE `clave` SE GUARDA ENTERA ademas del numero. Es lo que se busca, se
// cita y se muestra; recomponerla del prefijo ACTUAL cambiaria la clave de las
// tareas viejas el dia que el operador cambie el prefijo.
const TAREAS_SQL = `
CREATE TABLE local_task_sequence (
  project_id TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
  -- Mayusculas y digitos, empezando por letra: viaja en nombres de rama y en
  -- mensajes de commit, donde un espacio o una barra rompen algo.
  prefijo    TEXT NOT NULL CHECK (prefijo GLOB '[A-Z]*' AND prefijo NOT GLOB '*[^A-Z0-9]*' AND length(prefijo) <= 10),
  ultimo     INTEGER NOT NULL DEFAULT 0 CHECK (ultimo >= 0)
) STRICT;

CREATE TABLE local_task (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  -- \`NULL\` = el repositorio del proyecto. Un proyecto de varios repos lo
  -- concreta; hoy el motor corre sobre el unico que tiene.
  repo        TEXT,
  numero      INTEGER NOT NULL CHECK (numero > 0),
  clave       TEXT NOT NULL,
  titulo      TEXT NOT NULL CHECK (length(trim(titulo)) > 0),
  -- Markdown. Es el cuerpo que el planificador lee.
  plan        TEXT NOT NULL DEFAULT '',
  criterios   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(criterios) AND json_type(criterios) = 'array'),
  -- 0 urgente ... 4 baja, la escala del contrato de proveedor. \`NULL\` es «sin
  -- prioridad», que no es lo mismo que la mas baja.
  prioridad   INTEGER CHECK (prioridad IS NULL OR prioridad BETWEEN 0 AND 4),
  etiquetas   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(etiquetas) AND json_type(etiquetas) = 'array'),
  -- {runtime, agente?} o \`NULL\`: sin ejecutor propio la tarea hereda en
  -- cascada (FR-031), y la cascada se resuelve al lanzar, no se copia aqui.
  ejecutor    TEXT CHECK (ejecutor IS NULL OR (json_valid(ejecutor) AND json_type(ejecutor, '$.runtime') = 'text')),
  termino     TEXT NOT NULL DEFAULT 'pr' CHECK (termino ${en("local_task.termino")}),
  estado      TEXT NOT NULL DEFAULT 'todo' CHECK (estado ${en("local_task.estado")}),
  creado      TEXT NOT NULL,
  actualizado TEXT NOT NULL,
  UNIQUE (project_id, numero),
  UNIQUE (project_id, clave)
) STRICT;

CREATE INDEX tarea_por_proyecto ON local_task(project_id, estado, numero);

-- Lo que el motor deja dicho sobre la tarea (el enlace al PR, el resumen del
-- plan). Append-only en la practica: nadie edita lo que el motor dijo.
CREATE TABLE local_task_comment (
  id      TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES local_task(id) ON DELETE CASCADE,
  texto   TEXT NOT NULL,
  creado  TEXT NOT NULL
) STRICT;

CREATE INDEX comentario_por_tarea ON local_task_comment(task_id, creado);
`;

// EL ORDEN A MANO Y LOS AJUSTES (spec 005, FR-005..006). Una version nueva y
// no un retoque de la 5, por lo mismo de siempre: su huella ya esta escrita en
// la base del operador.
//
// POR QUE EL ORDEN VIVE AQUI Y NO EN EL GESTOR. El operador ordena para decidir
// que va primero EN SU PANTALLA; escribirlo en Linear o en ADO seria cambiar la
// prioridad que ve todo su equipo porque alguien arrastro una tarjeta. Es dato
// del servicio, por proyecto, y el gestor no se entera (principio VI).
//
// POR QUE LA CLAVE ES (proyecto, item) Y NO (proyecto, columna, item). Una
// tarjeta esta en UNA columna; con la columna en la clave, una tarjeta que pasa
// de Todo a En revision y vuelve arrastraria dos posiciones contradictorias y
// ganaria la que nadie recuerda haber puesto. La columna se guarda para saber
// DONDE vale la posicion: si la tarjeta ya no esta ahi, la posicion no se
// aplica (y la siguiente vez que se ordene su columna, se reemplaza).
//
// `item_id` ES EL ID DEL TICKET EN EL GESTOR, texto opaco. No hay clave foranea
// a `local_task` porque casi nunca es una tarea local: es un issue de Linear.
// Una tarjeta que desaparece del gestor deja una fila que simplemente no casa
// con nada; no se borra al pintar, porque pintar no escribe (SC-007).
//
// LOS AJUSTES, CLAVE -> JSON. Hoy es uno (`runsSimultaneos`); una tabla con una
// columna por ajuste obligaria a una migracion por cada ajuste nuevo, y lo que
// se guarda aqui es preferencia del operador, no una entidad con invariantes.
const ORDEN_Y_AJUSTES_SQL = `
CREATE TABLE card_order (
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  item_id    TEXT NOT NULL CHECK (length(item_id) > 0),
  columna    TEXT NOT NULL CHECK (length(columna) > 0),
  posicion   INTEGER NOT NULL CHECK (posicion >= 0),
  PRIMARY KEY (project_id, item_id)
) STRICT;

CREATE INDEX orden_por_columna ON card_order(project_id, columna, posicion);

CREATE TABLE service_setting (
  clave TEXT PRIMARY KEY CHECK (length(clave) > 0),
  valor TEXT NOT NULL CHECK (json_valid(valor))
) STRICT;
`;

// LA DECISION SOBRE UNA «MOVIDA» (spec 005, US1 esc. 4, FR-004). Una version
// nueva y no un retoque de la 6, por lo de siempre.
//
// QUE SE GUARDA. Una issue con run que sale de las reglas del proyecto se pinta
// con el chip «movida», y el operador contesta: `seguir` (la tarjeta se queda
// aqui, sin chip: sigue siendo del proyecto aunque ya no cumpla las reglas) o
// `soltar` (deja de pintarse en este board). Es dato del servicio, por
// proyecto: el gestor NO se entera (principio VI) — soltar una tarjeta aqui no
// es moverla ni cerrarla en Linear, que es del equipo.
//
// `destino` ES PARA DONDE SE DECIDIO. «Seguir aunque este en Pagos» no dice
// nada de si la issue se va luego a otro sitio; con el destino guardado, una
// movida a un sitio distinto vuelve a preguntar. `NULL` si el gestor no lo dijo.
//
// `item_id` es el id del ticket en el gestor, texto opaco, como en
// `card_order`: sin clave foranea, porque casi nunca es una tarea local.
const DECISION_DE_MOVIDA_SQL = `
CREATE TABLE movida_decision (
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  item_id    TEXT NOT NULL CHECK (length(trim(item_id)) > 0),
  decision   TEXT NOT NULL CHECK (decision ${en("movida_decision.decision")}),
  destino    TEXT,
  decidida   TEXT NOT NULL,
  PRIMARY KEY (project_id, item_id)
) STRICT;
`;

/**
 * Las migraciones, en orden.
 *
 * SE PARTEN EN TRES Y NO EN UNA. No por estetica: una base ya creada solo
 * aplica lo que le falta, y tener los indices y los disparadores en su propia
 * version permite corregir un indice mal elegido sin tocar la migracion que
 * creo las tablas — que es lo que nunca se puede editar (ver
 * `migraciones.mjs`).
 *
 * @type {ReadonlyArray<{version: number, nombre: string, sql: string}>}
 */
export const MIGRACIONES = Object.freeze([
  { version: 1, nombre: "las-entidades", sql: TABLAS_SQL },
  { version: 2, nombre: "indices-de-consulta", sql: INDICES_SQL },
  { version: 3, nombre: "auditoria-append-only", sql: APPEND_ONLY_SQL },
  { version: 4, nombre: "conexion-del-espacio-de-trabajo", sql: CONEXION_DEL_ESPACIO_SQL },
  { version: 5, nombre: "tareas-propias", sql: TAREAS_SQL },
  { version: 6, nombre: "orden-y-ajustes", sql: ORDEN_Y_AJUSTES_SQL },
  { version: 7, nombre: "decision-de-movida", sql: DECISION_DE_MOVIDA_SQL },
]);
