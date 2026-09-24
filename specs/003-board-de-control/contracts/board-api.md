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

Sin `project` = board general (todos los proyectos `ACTIVE`).

```jsonc
{
  "columnas": [
    { "id": "backlog",     "titulo": "Backlog",     "total": 4, "nota": null },
    { "id": "todo",        "titulo": "Todo",        "total": 4, "nota": null },
    { "id": "in_progress", "titulo": "En curso",    "total": 4, "nota": null },
    { "id": "in_review",   "titulo": "En revisión", "total": 2, "nota": null }
  ],
  "tarjetas": [ /* Tarjeta[] */ ],
  "resumen": { "enCurso": 4, "teNecesitan": 3, "enCola": 1 },
  "proyectos": [ { "id", "nombre", "estado", "color": "#hex|null", "gestor": "github|linear|azure-devops|fake|null", "listItems": true } ],
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
  "ticket": { "id", "key": "CORE-142|null", "titulo", "url", "prioridad": 0, "equipo": "Core|null",
              "etiquetas": ["api"], "asignado": { "nombre", "iniciales", "avatarUrl" } },
  "columna": "backlog|todo|in_progress|in_review",
  "chip": null | { "tipo": "en_cola|necesita_permiso|necesita_criterios|plan_listo|fase|bloqueado|fallido|interrumpido|pr_listo|sin_repo",
                   "texto": "Needs permission", "detalle": "causa textual completa|null", "posicion": 1 },
  "avance": null | { "hechas": 3, "total": 9, "fase": "Leer|Test|Implementar|Gate|Revisión" },
  "accion": { "tipo": "run|open_run|retry|approve|ninguna", "habilitada": true, "motivo": null },
  "run": null | { "itemId", "estado", "pr": "https://...|null", "gasto": { "usd": 1.2, "calls": 14, "medido": true } },
  "tieneRepo": true
}
```

Precedencia de columna (FR-003): PR abierto → `in_review`; run en vuelo, en
cola o detenido → `in_progress`; si no, `canonicalState` del gestor
(`blocked` → `in_progress` con chip `bloqueado`; `done` solo con
`includeDone=1`, en `in_review`).

### `POST /v1/projects/:id/runs` — cuerpo `{ "itemId": "..." }`

`202 { "run": { "itemId", "estado": "planificando|en_cola|corriendo" , "posicion": null|n } }`.
Idempotente: si ya existe, `200` con el existente. Proyecto no `ACTIVE` → `409 proyecto_no_activo`
(ya existe). Sin gate → `409 sin_gate`. Sin repo → `409 sin_repo`.

### `POST /v1/runs/:itemId/approve` · `POST /v1/runs/:itemId/retry`

`202` con el mismo cuerpo. `approve` sobre un run que no está en `plan_listo` → `409`.

### `GET /v1/runs?project=<id>&estado=...`

Lista de runs de todos los proyectos: `{ items: [{ itemId, proyecto, titulo, estado, avance, pr, gasto, creado, actualizado }] }`.

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
                 "archivos": [ { "ruta", "estado": "A|M|D|R", "mas": 12, "menos": 3, "parche": "@@ ..." } ] } ],
  "sinCommitear": null | { "archivos": [ /* mismo formato */ ] } }
```

Solo lectura (`git log`/`git diff` sobre la rama y el worktree de la tarea). Parches de más de 200 KB se cortan y lo dicen.

### Eventos SSE nuevos (`/v1/events`)

- `run.cambio` `{ projectId, itemId, estado }`: al lanzar, encolar, cambiar de fase, terminar.
- `board.invalidado` `{ projectId|null }`: cuando cambia algo que el board lee.
