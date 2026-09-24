# Contrato: el board

Lo único que comparten los tres frentes. Cambiarlo es cambiar este archivo primero.

## 1. Capacidad de proveedor `listItems` (frente A)

```js
// capabilities().listItems: boolean
// Lista los tickets ABIERTOS del espacio del proyecto en el gestor.
export async function listItems(query, ctx)
// query: { limit?: number (default 100, max 500), cursor?: string|null, includeDone?: boolean }
// ctx:   el mismo contexto que el resto del contrato (options con owner/repo, team, project, stateMap...)
// => { items: ListedItem[], nextCursor: string|null, total: number|null }
```

`ListedItem` = el `Item` que ya valida `validateItem`, más:

| Campo | Tipo | Nota |
|---|---|---|
| `canonicalState` | `"backlog"\|"todo"\|"in_progress"\|"blocked"\|"in_review"\|"done"` | `backlog` solo si el gestor lo distingue (Linear: tipo de estado `backlog`; ADO: estado `New` sin iteración o mapeo explícito; GitHub: nunca, salvo `stateMap.backlog` por etiqueta). |
| `priority` | `0..4` o `null` | 0 urgente … 4 baja. Sin dato, `null`; no se inventa. |
| `assignee` | `{ id, name, avatarUrl? }` o `null` | |
| `team` | `string` o `null` | Equipo de Linear, área de ADO, `owner/repo` en GitHub. |
| `labels` | `string[]` | |
| `updatedAt` | ISO 8601 | |

Sin la capacidad: `capabilities().listItems === false` y la suite de contrato
comprueba que la degradación está declarada (`can(provider, "listItems")`
devuelve `reason`).

## 2. HTTP (frente B → frente C)

Todas con el token de sesión y el formato de error único (`error.codigo`,
`causa`, `accion`) que ya existe.

### `GET /v1/board?project=<id>&includeDone=0|1`

Sin `project` = board general: TODAS las tarjetas de todos los proyectos
`ACTIVE` (la interfaz lo pide así y filtra en cliente).

Columnas (FR-001 revisado el 2026-09-24): `backlog, todo, in_progress,
in_review, blocked, done`, en ese orden; la interfaz pliega `backlog` a la
izquierda. `done` sale SIEMPRE con los últimos 20 cerrados (por `updatedAt`) y
su `nota` dice el corte; `includeDone=1` trae todos. Al gestor se le piden
siempre los cerrados.

```jsonc
{
  "columnas": [
    { "id": "backlog",     "titulo": "Backlog",     "total": 4, "nota": null },
    { "id": "todo",        "titulo": "Todo",        "total": 4, "nota": null },
    { "id": "in_progress", "titulo": "En curso",    "total": 4, "nota": null },
    { "id": "in_review",   "titulo": "En revisión", "total": 2, "nota": null },
    { "id": "blocked",     "titulo": "Bloqueado",   "total": 1, "nota": null },
    { "id": "done",        "titulo": "Hecho",       "total": 20,
      "nota": "Se muestran los 20 de 57 cerrados mas recientes; «incluir terminados» (`includeDone=1`) los trae todos." }
  ],
  "tarjetas": [ /* Tarjeta[] */ ],
  "resumen": { "enCurso": 4, "teNecesitan": 3, "enCola": 1 },
  "proyectos": [ { "id", "nombre", "estado", "color": "#hex|null", "gestor": "local|github|linear|azure-devops|fake|null", "listItems": true } ],
  "avisos": [ { "proyecto": "<id>|null", "nivel": "error|aviso", "causa": "...", "accion": "..." } ]
}
```

`nota` de columna: texto cuando la columna está incompleta (proveedor sin
`listItems`, gestor caído, más tickets de los mostrados).

**Tarjeta**

```jsonc
{
  "id": "<projectId>:<itemId>",
  "proyecto": { "id", "nombre", "color" },
  "origen": "local|github|linear|azure-devops|fake",      // el proveedor del ticket; `local` = tarea propia (chip «Local»)
  "ejecutor": { "runtime": "claude-agent-sdk|codex", "agente": "string|null" },  // resuelto: tarea -> proyecto -> general
  "ticket": { "id", "key": "CORE-142|null", "titulo", "url", "prioridad": 0, "equipo": "Core|null",
              "etiquetas": ["api"], "asignado": { "nombre", "iniciales", "avatarUrl" } },
  "columna": "backlog|todo|in_progress|in_review|blocked|done",
  "chip": null | { "tipo": "en_cola|necesita_permiso|necesita_criterios|plan_listo|fase|bloqueado|fallido|interrumpido|pr_listo|sin_repo",
                   "texto": "Needs permission", "detalle": "causa textual completa|null", "posicion": 1 },
  "avance": null | { "hechas": 3, "total": 9, "fase": "Leer|Test|Implementar|Gate|Revisión" },
  "accion": { "tipo": "run|open_run|retry|approve|ninguna", "habilitada": true, "motivo": null },
  "run": null | { "itemId", "estado", "pr": "https://...|null", "gasto": { "usd": 1.2, "calls": 14, "medido": true } },
  "tieneRepo": true
}
```

Precedencia de columna (FR-003, con FR-001 revisado): PR abierto →
`in_review`; run `bloqueado` o `fallido` → `blocked` (con su chip y la causa);
run en vuelo, en cola o detenido por otra cosa (plan listo, permiso,
criterios, interrumpido) → `in_progress` con chip; si no hay run,
`canonicalState` del gestor (`backlog`, `todo`, `in_progress`, `in_review`,
`blocked` → `blocked`, `done` → `done`).

`accion.habilitada=false` en las acciones que lanzan el motor (`run`,
`approve`, `retry`) con `motivo`, en este orden: el proyecto no se puede lanzar
(sin repo, sin gate, `sin_gestor`); el ejecutor o el término que el motor no
sabe cumplir (mismo texto que el 409 `ejecutor_sin_soporte` /
`termino_sin_soporte`); el runtime del ejecutor sin sesión ni key →
`"Conecta un modelo en Settings → Modelos: <detalle>."`.

### `POST /v1/projects/:id/runs` — cuerpo `{ "itemId": "..." }`

`202 { "run": { "itemId", "estado": "planificando|en_cola|corriendo" , "posicion": null|n } }`.
Idempotente: si ya existe, `200` con el existente. Proyecto no `ACTIVE` → `409 proyecto_no_activo`
(ya existe). Sin gate → `409 sin_gate`. Sin repo → `409 sin_repo`. Tracker declarado sin
proveedor → `409 sin_gestor`. Ejecutor que el motor no monta → `409 ejecutor_sin_soporte`;
término distinto de `pr` → `409 termino_sin_soporte` (§3). Para una tarea local, `itemId` es el
`id` de la tarea (no su `key`).

### `POST /v1/runs/:itemId/approve` · `POST /v1/runs/:itemId/retry`

`202` con el mismo cuerpo. `approve` sobre un run que no está en `plan_listo` → `409`.

### `GET /v1/runs?project=<id>&estado=...`

Lista de runs de todos los proyectos: `{ items: [{ itemId, proyecto: { id, nombre, color }, titulo, estado, avance, pr, gasto, creado, actualizado }] }`.

### `GET /v1/usage?desde=<ISO>&hasta=<ISO>`

```jsonc
{ "total": { "usd": 12.3, "calls": 140, "sinMedir": 2 },
  "porProyecto": [ { "proyecto": {...}, "usd", "calls", "sinMedir" } ],
  "runs": [ { "itemId", "proyecto", "titulo", "usd", "calls", "medido" } ] }
```

### `GET /v1/runs/:itemId` (ya existe) y `GET /v1/runs/:itemId/tasks/:taskId/diff`

```jsonc
{ "tarea": { "id": "T001", "titulo", "estado", "agente": "claude-agent-sdk|codex|...", "rama" },
  "commits": [ { "sha", "mensaje", "tipo": "test|impl|otro",
                 "archivos": [ { "ruta", "estado": "A|M|D|R", "mas": 12, "menos": 3, "parche": "@@ ...", "cortado": false } ] } ],
  "sinCommitear": null | { "archivos": [ /* mismo formato */ ] } }
```

Solo lectura (`git log`/`git diff` sobre la rama y el worktree de la tarea),
con `--no-optional-locks` y `GIT_OPTIONAL_LOCKS=0`: ni el índice se refresca
(hay un test que mide repo, worktree y home antes y después). Los commits de la
tarea son los de su rama (o la del ticket) fuera de la base cuyo asunto lleva
`(<tarea>, <ticket>)`, como los escribe `mensajeDeFase`; `tipo` sale del
asunto (`test(` → `test`; `feat|fix|chore|refactor|perf(` → `impl`).
`sinCommitear` solo si la tarea no está `integrated` y su worktree existe; los
archivos nuevos se leen del disco (sin `git add -N`). Un parche de más de
200 KB se corta con `cortado: true` y una última línea `… (parche cortado: …)`;
`mas`/`menos` siguen siendo los reales. 404 `recurso_desconocido` si no hay run
o tarea.

### Eventos SSE nuevos (`/v1/events`)

- `run.cambio` `{ projectId, itemId, estado }`: al lanzar, encolar, cambiar de fase, terminar.
- `board.invalidado` `{ projectId|null }`: cuando cambia algo que el board lee.

## 3. Tareas propias: el gestor local (FR-030..032)

Proveedor `providers/local/` (el contrato completo; `capabilities`: `setState`,
`comment`, `listItems` en true; el resto en false). Sus tareas viven en el
almacén (`local_task`, `local_task_sequence`, `local_task_comment`; no `task`: la
guarda del almacén reserva ese nombre para las tareas del run). El ÚNICO
escritor es el servicio (principio VIII):

- Dentro del servicio (board), el proveedor recibe `ctx.tareas`: la interfaz
  `{obtener, listar, cambiarEstado, comentar}` sobre el almacén.
- Dentro del motor (subproceso), no hay interfaz inyectada: el proveedor llama
  a ESTAS rutas con `NOXLOOP_SERVICE_URL` (variable) y `NOXLOOP_SERVICE_TOKEN`
  (secreto: entorno, nunca argv) que el lanzador pone en el entorno del motor,
  y el token en la cabecera `x-noxloop-token`. Hueco declarado: es el token de
  la sesión entera, no uno acotado a tareas.

Un proyecto sin tracker ni forja con issues usa el gestor local (antes
`sin_gestor`). Con un tracker DECLARADO que el motor no sabe usar sigue siendo
`sin_gestor`: no se cambia por el local sin avisar.

**Tarea** (forma única para la interfaz, el board y el motor):

```jsonc
{ "id": "uuid", "projectId", "key": "PAY-12", "numero": 12, "repo": null,
  "titulo", "plan": "markdown", "criterios": ["..."], "prioridad": 0..4|null, "etiquetas": ["api"],
  "ejecutor": { "runtime": "claude-agent-sdk", "agente": "string|null" } | null,
  "termino": "changes|commit|pr", "estado": "backlog|todo|in_progress|blocked|in_review|done",
  "creado", "actualizado" }
```

- `POST /v1/projects/:id/tasks` `{titulo, plan?, criterios?, prioridad?, etiquetas?, repo?, ejecutor?, termino?, estado?, prefijo?}`
  → `201 { tarea }`. La clave es `<PREFIJO>-<n>`: prefijo derivado del nombre
  del proyecto (`Payments` → `PAY`, `Mi App Nueva` → `MAN`) o el `prefijo`
  enviado (1–10 mayúsculas/dígitos); la numeración nunca se reutiliza.
  Validado antes de escribir: `400 cuerpo_invalido` nombrando el campo, sin
  repetir el valor.
- `GET /v1/projects/:id/tasks?limit=&desde=&includeDone=1` → `{ items: Tarea[], cursor, avisos, total, prefijo }` (más nuevas primero).
- `GET /v1/tasks/:id` → `{ tarea, comentarios: [{ id, texto, creado }] }`.
- `PATCH /v1/tasks/:id` (mismos campos, parcial; `key`/`projectId` no se editan) → `{ tarea }`.
- `DELETE /v1/tasks/:id` → `{ borrada, key }`; con run (en disco o en la cola) → `409 tarea_con_run`.
- `POST /v1/tasks/:id/comments` `{texto}` → `201 { comentario: { id, creado } }` (el motor deja aquí el enlace al PR).

Cascada del ejecutor (FR-031): tarea → proyecto (runtime del agente
`implementador` de la flota, `agente: null`) → general (`claude-agent-sdk`).
El escalón «repo» no existe todavía (un repo por proyecto; hueco). El
resuelto viaja al motor como `config.runtime` (campo nuevo del esquema del
motor); un `agente` con nombre se declara en `repos.<x>.gaps` («el motor
todavía no sabe entregarle un agente al runtime»). El motor solo monta como
implementador runtimes con hooks: `codex` → `409 ejecutor_sin_soporte`.
Término (FR-032): el motor solo sabe terminar en `pr`; `changes`/`commit` se
guardan y al lanzar dan `409 termino_sin_soporte` (hueco). Ninguno mergea.

## 4. Settings → Modelos

- `GET /v1/runtimes` → `{ items: [{ runtime, nombre, conectado, metodo: "suscripcion_claude|cuenta_chatgpt|api_key"|null, detalle, binarioPresente, claveGuardada, comoIniciarSesion: { comando, abreNavegador }, causa?, accion? }] }`.
  Pregunta con `estadoDeAutenticacion` (`claude auth status`, `codex login status`) y el entorno de la máquina FILTRADO
  (el mismo que recibe el motor); una key en el shell del operador no cuenta.
- `POST /v1/runtimes/:id/login` → `202 { iniciado: true, runtime, comando, abreNavegador }`. Lanza
  `claude auth login` / `codex login` desacoplado (`detached`, sin stdio, `unref`) y no lo espera. Runtime
  desconocido → 404; binario ausente → `503 pieza_ausente`.
- `POST /v1/runtimes/:id/api-key {valor}` → `201` (o `200` si rota) con el estado del runtime. Credencial
  `tipo: "modelo"`, `proveedor: <runtime>`, ámbito global, en la bóveda; grant para el implementador de cada
  proyecto existente (`concedido_por`: el operador desde Settings → Modelos). Nunca vuelve el valor.
- `DELETE /v1/runtimes/:id/api-key` → `{ quitada: true, runtime }`.

El lanzador pasa `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` de la bóveda (con el grant del proyecto, en cada paso)
al entorno del motor, nunca a argv. Hueco: un proyecto creado después de guardar la key no tiene grant hasta
volver a guardarla o concederlo en Credenciales; su runtime usa la sesión local.

## 5. `PATCH /v1/projects/:id/tracker {opciones?, stateMap?}`

Escribe `connection.capacidades.opcionesDelGestor` y `.stateMap` de la conexión del gestor DEL PROYECTO,
validadas contra el `optionsSchema` del proveedor (clave desconocida, tipo, `required`) y con el `stateMap`
total sobre los cinco canónicos (sin `backlog`). → `{ gestor: { nombre, conexion, opciones, stateMap } }`.
Conexión del espacio de trabajo → `409 gestor_compartido`; gestor local o ninguno → `409 sin_gestor`.
