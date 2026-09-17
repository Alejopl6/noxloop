# Phase 1 — Data Model

Cuatro entidades persistidas y dos derivadas. Todo lo persistido vive en
`NOXLOOP_HOME` y se escribe de forma atómica; nada del modelo vive dentro de un
repositorio de trabajo.

---

## Item (canónico)

Lo que el motor ve de un ticket, después de que el proveedor lo traduce. El
motor **nunca** consume la forma nativa del gestor.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string | Identidad en el gestor. String, no número: Linear usa UUID y GitHub usa número. |
| `key` | string \| null | Identificador legible (`AUT-12`, `#279`). Solo para mostrar. |
| `title` | string | |
| `body` | string | Descripción cruda. |
| `acceptance` | string[] | Criterios de aceptación **ya extraídos**. Vacío es un hecho, no un error: lo decide el planificador. |
| `level` | `epic` \| `feature` \| `story` \| `task` | Lo resuelve el proveedor desde su propio modelo de tipos. Jamás por comparación de nombres. |
| `state` | string | El estado nativo, tal cual. |
| `canonicalState` | `todo` \| `in_progress` \| `blocked` \| `in_review` \| `done` | Traducido por el mapa de estados del proveedor. |
| `assignee` | string \| null | |
| `parentId` | string \| null | |
| `labels` | string[] | |
| `url` | string | Enlace humano al ticket. |
| `boardFields` | object \| null | Campos que las tareas hijas heredan (iteración, área, responsable). `null` si el gestor no los tiene. |
| `raw` | object | La respuesta nativa. El motor no la lee; existe para depurar. |

**Reglas de validación**: `id`, `title`, `level` y `url` son obligatorios. Un
`level` fuera del enum es un error del proveedor, no del ticket: se reporta como
tal para que el fallo aterrice donde se puede arreglar.

**El motor no es dueño de esta entidad**: la lee y la anota. No la borra, no la
cierra y no la mueve hacia atrás.

---

## Plan

El contrato entre la fase que entiende y la fase que ejecuta. Se genera una vez
por item de nivel `story` (o `task` suelta) y se valida contra
`contracts/plan.schema.json` antes de crear el recorrido.

| Campo | Tipo | Notas |
|---|---|---|
| `item` | `{id, key, title, url, level, provider}` | De qué ticket salió. |
| `repoScope` | string[] | Repositorios que el plan puede tocar. Una tarea fuera de esta lista no se planifica. |
| `evidence` | `{repo, why}[]` | Por qué cada repositorio está en el alcance. Sin evidencia no entra. |
| `outOfScope` | string[] | Lo que quedó afuera a propósito. Va al PR. |
| `tasks` | Task[] | El DAG. |

**Reglas de validación**:
- `tasks` no vacío. Un plan sin tareas no es un plan: es un ticket que hay que
  aclarar.
- Los `id` de tarea son únicos dentro del plan.
- Todo `dependsOn` apunta a un `id` que existe en el mismo plan.
- **El grafo es acíclico.** Un ciclo se rechaza nombrando el ciclo, no con "plan
  inválido".
- Toda tarea con `testFiles` vacío lleva una justificación en su título; el
  planificador no puede dejarla en silencio.
- El `repo` de toda tarea pertenece a `repoScope`.

---

## Task

Unidad atómica. Una tarea = un repositorio; si el cambio cruza repositorios, son
dos tareas con una dependencia entre ellas.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string | `T001`, único en el plan. |
| `repo` | string | Clave en la configuración de repositorios. |
| `title` | string | |
| `acceptance` | string | Redactado como el test que lo prueba. |
| `targetFiles` | string[] | **No es documentación**: el guardián de alcance bloquea escrituras fuera de esta lista. |
| `testFiles` | string[] | El guardián de orden exige que estos existan y fallen antes de tocar `targetFiles`. |
| `tier` | `trivial` \| `small` \| `medium` \| `large` | Modula revisión, modelo, effort y alcance del gate. **Nunca el paso RED.** |
| `specialist` | string \| null | Agente especializado sugerido. |
| `dependsOn` | string[] | |
| `dependencyKind` | `hard` \| `soft` | `hard` no arranca sin la anterior integrada; `soft` asume el contrato y lo declara en el PR. Ante la duda, `hard`. |
| `providerItemId` | string \| null | El ticket hijo materializado, si el gestor lo soporta. |

---

## Run

El estado de una ejecución. Es la fuente de verdad; la conversación no.
`NOXLOOP_HOME/runs/run-<itemId>.json`, validado contra
`contracts/run.schema.json`.

| Campo | Tipo | Notas |
|---|---|---|
| `schemaVersion` | number | Para poder migrar sin adivinar. |
| `item` | Item + `{branch, worktreeBase, pr, providerStateWritten}` | `providerStateWritten` es lo que vuelve idempotente la escritura al gestor: relanzar no mueve el ticket dos veces. |
| `tasks` | RunTask[] | |
| `createdAt` / `updatedAt` | ISO 8601 | |
| `milestoneId` | string \| null | A qué hito pertenece, si viene de uno. |

### RunTask

Los campos del `Task` del plan, más el estado de ejecución:

| Campo | Tipo | Notas |
|---|---|---|
| `status` | ver máquina de estados | |
| `attempts` | `{red, green, gate, review}` | Contadores por bucle. Se consumen explícitamente: un intento que no se registra no existe. |
| `redVerified` | boolean | **Solo se pone después de una corrida real que falló.** Escribir texto no la concede. |
| `worktree` | string \| null | Ruta del espacio aislado. |
| `branch` | string \| null | Rama de la tarea. |
| `gateEvidence` | `{command, exitCode, durationMs, output, timedOut}` \| null | Sin este objeto no hay veredicto. |
| `addedTargets` | `{path, why}[]` | Ampliaciones de alcance. Van al PR. |
| `sessionId` | string \| null | Para retomar la sesión entre fases de esta tarea. |
| `lastFailure` | string \| null | La causa **real**, textual. Nunca "falla el build". |
| `integratedAt` | ISO 8601 \| null | |

### Máquina de estados de una tarea

```
pending ──> in_progress ──> red ──> green ──> gated ──> reviewed ──> queued ──> integrated
   │             │           │        │         │          │            │
   └─────────────┴───────────┴────────┴─────────┴──────────┴────────────┴──> blocked
```

Transiciones con guarda, forzadas por el estado y no por confianza:

- `in_progress → red` exige `redVerified: true`, que a su vez exige una corrida
  con exit code distinto de cero sobre `testFiles`.
- `green → gated` exige `gateEvidence` con `exitCode: 0`. Sin el objeto, la
  transición se rechaza.
- `reviewed → queued` exige `attempts.review > 0`. El contador **es** la
  constancia de que la revisión ocurrió; dejarlo en cero equivale a no haberla
  hecho.
- `queued → integrated` solo la escribe la cola de integración, después de
  rebasar y volver a verificar.
- Cualquier estado `→ blocked` exige `lastFailure` no vacío.
- Ninguna transición retrocede salvo `gated|reviewed|queued → green`, que es lo
  que hace la revisión cuando encuentra algo bloqueante, y el rebase cuando
  entra en conflicto.

---

## Milestone

El recorrido de un item de nivel `epic` o `feature`.
`NOXLOOP_HOME/milestones/milestone-<id>.json`.

| Campo | Tipo | Notas |
|---|---|---|
| `item` | Item | El hito. |
| `branch` | string | Rama de integración del hito. |
| `baseBranch` | string | Sobre qué nace. |
| `repo` | string | La rama del hito vive en un repositorio. |
| `order` | string[] | Orden de recorrido de los items hijos. |
| `items` | `{id, status, pr, reason, notes}[]` | `notes` es el canal de vuelta: cuando la planificación se detiene a preguntar, la respuesta entra por acá. |
| `skipped` | `{id, why}[]` | Declarado **antes** de arrancar, no sobre la marcha. |
| `spent` | `{usd, calls}` | Para el techo por hito. |

Estados de un item dentro del hito: `pending → planned → running → pr_open →
integrated`, más `blocked` y `unreachable` (bloqueado por depender de uno
bloqueado, que es distinto de haber fallado).

---

## Entidades derivadas, no persistidas

**ReadySet** — lo que devuelve el scheduler: las tareas cuyas dependencias
duras están `integrated`, menos las que ya corren, recortado por
`maxParallelTasks`. Se recalcula siempre desde el disco; no se cachea, porque
cachearlo es cómo un scheduler lanza dos veces la misma tarea.

**GateResult** — lo que devuelve el ejecutor de gates. Es la única fuente de un
veredicto, y se persiste dentro de la tarea como `gateEvidence` justamente para
que el veredicto sobreviva a la sesión que lo produjo.
