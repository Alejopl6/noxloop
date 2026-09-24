# Contrato: el gestor de un proyecto (frente A · Linear completo)

Lo que comparten el proveedor, el servicio y la interfaz para FR-001..004.
Cambiarlo es cambiar este archivo primero.

## 1. Reglas de ruteo (FR-001)

Opción del proveedor, validada contra su `optionsSchema` al guardar
(`PATCH /v1/projects/:id/tracker`) y aplicada por `listItems` **en el filtro
del gestor** (no después: filtrar del lado de noxloop con una página de N
perdería en silencio lo que cae fuera de ella).

Linear:

```jsonc
"opciones": {
  "teamKey": "ENG",                 // o teamId (gana)
  "reglas": {
    "proyecto": "Pagos",            // nombre o UUID del proyecto de Linear → project.{name|id}.eq
    "etiquetas": ["backend", "api"] // basta UNA → labels.some.name.in
  }
}
```

Proyecto **y** alguna etiqueta. Reglas vacías (`{}` o `etiquetas: []`) no
filtran. Una regla que no deja pasar nada devuelve una página vacía, y el board
lo **dice** en la nota de Backlog y Todo (no se queda vacío en silencio).

El `Item` de Linear trae además `project: {id, name} | null`: dónde vive hoy la
issue, que es el destino de una tarjeta «movida» (§4).

## 2. Capacidad de proveedor `listStates` (FR-002)

```js
// capabilities().listStates: boolean   (OPCIONAL: ausente vale false)
export async function listStates(ctx)
// => Array<{ id: string, name: string, category: string|null, suggested: LISTED_STATE|null }>
```

- `name` es lo que guarda el `stateMap` (el mapa es por NOMBRE); no se repite.
- `category` es el enum del gestor si lo tiene (Linear: `type`), o `null`.
- `suggested` es la columna en que el proveedor LEERÍA el estado sin mapa; el
  editor lo propone, nunca lo guarda solo.
- Implementada en Linear (`workflowStates(filter: {team})`). GitHub, Azure
  DevOps, local y el falso no la declaran.

Sin la capacidad: `capabilities().listStates === false` y la suite de contrato
comprueba que la degradación está declarada (`can(provider, "listStates")`
devuelve `reason`). El editor no inventa la lista: ofrece los nombres que el
`stateMap` vigente ya declara y deja escribir uno a mano, con una nota que
nombra al proveedor y la capacidad.

## 3. HTTP

### `GET /v1/projects/:id/tracker/estados`

Solo lectura (lee la credencial del gestor por la bóveda, con su evento de
auditoría, como el board).

```jsonc
{
  "gestor": { "nombre": "linear", "conexion": "c1", "opciones": { "teamKey": "ENG" } },
  "editable": true,            // false si la conexión es del espacio (el PATCH daría 409)
  "motivo": null,              // por qué no es editable, o por qué no hay lista
  "listStates": true,
  "estados": [
    { "id": "st-todo", "name": "Todo", "category": "unstarted", "suggested": "todo", "asignado": "todo" },
    { "id": "st-qa", "name": "Listo para QA", "category": "started", "suggested": "in_progress", "asignado": null }
  ],
  "stateMap": { "todo": "Todo", "in_progress": "In Progress", "blocked": null, "in_review": null, "done": null },
  "sinAsignar": ["Listo para QA"],                               // estados reales que ningún canónico nombra
  "desconocidos": [{ "canonico": "blocked", "nombre": "Blocked" }], // nombres del mapa que el gestor no tiene
  "nota": null                  // la degradación o la caída del gestor, con su causa textual
}
```

Errores: `404` proyecto; `409 sin_gestor` si el proyecto usa el gestor local o
ninguno.

### `PATCH /v1/projects/:id/tracker` (ya existía)

`{opciones?, stateMap?}`; `opciones` contra el `optionsSchema` del proveedor
(ahora con `reglas`), `stateMap` con los cinco canónicos (`null` = no existe).
`backlog` no se escribe: es de lectura y el gestor lo reconoce por su tipo.

## 4. Tarjeta «movida» (FR-004)

Un run en disco cuyo ticket ya no devuelve `listItems` del proyecto (con sus
reglas), **con la página completa** (`nextCursor: null`), se consulta con
`getItem` (cacheado con la misma entrada de 30 s del board, y con tope por
pintada). Si existe y sigue abierto (`canonicalState` no nulo):

```jsonc
"chip": {
  "tipo": "movida",
  "texto": "Movida · Pagos",
  "detalle": "ENG-124 ya no cumple las reglas de este proyecto: ahora esta en el proyecto «Pagos» de Linear. …",
  "posicion": null,
  "destino": "Pagos"
},
"movida": { "destino": "Pagos", "detalle": "…" }
```

El chip reemplaza al del run (la columna y `run.estado` siguen diciendo en qué
va el run). En la interfaz es un `TipoDeChip` más, en **ámbar** (pide una
decisión, nada falló), y el detalle de la tarjeta ofrece las dos acciones.

Si `getItem` devuelve `null` (borrada) o un estado sin canónico (cancelada), no
hay chip: la tarjeta del run sigue como siempre.

### 4.1 «Seguir aquí» o «Soltarla»: `POST /v1/projects/:id/board/movidas/:itemId`

```jsonc
// pedido
{ "decision": "seguir" | "soltar", "destino": "Pagos" }   // destino opcional (string|null)
// 200
{ "decision": { "itemId": "…", "decision": "seguir", "destino": "Pagos", "decidida": "2026-09-24T10:00:00.000Z" } }
```

- `seguir`: la tarjeta se queda en este board **sin** el chip «movida» (ni el
  campo `movida`), con el chip de su run. Sigue siendo del proyecto aunque ya
  no cumpla las reglas.
- `soltar`: la tarjeta **deja de pintarse** en este board (y no cuenta en
  `resumen` ni en el `total` de su columna). El run en disco **no se toca**:
  es del motor, sigue en `/v1/runs` y en la cola si estaba en ella; soltar una
  tarjeta no es cancelar un trabajo.
- **El gestor no se entera** (principio VI): ni `setState` ni `comment` ni
  nada. La decisión es dato del servicio, en el almacén
  (`movida_decision(project_id FK cascade, item_id, decision, destino, decidida)`,
  migración 7), y el test cuenta cada llamada al proveedor.
- `destino` es para dónde se decidió: el que el board acaba de pintar (de su
  caché), o el que manda la interfaz si la caché venció; `null` si el gestor no
  lo dijo. Decidir otra vez reemplaza (una decisión vigente por tarjeta).
- Emite `board.invalidado` (sin invalidar la caché del gestor: lo que cambió no
  viene de él).

Errores: `404 proyecto_desconocido`; `400 cuerpo_invalido` (falta `decision`,
o no es `seguir|soltar` — la acción nombra las dos —, o `destino` no es texto);
`404 recurso_desconocido` (`tipo: "run"`) si el item no tiene run en ESTE
proyecto: sin run no hay tarjeta movida a la que aplicar nada.

**Cuándo se olvida.** Pintar no escribe (spec 003, SC-007), así que el board solo
LEE las decisiones:

- si la issue vuelve a cumplir las reglas, entra por el listado y se pinta como
  una más: la decisión no se mira (tampoco `soltar` la esconde);
- si la issue se va a **otro** destino, la decisión no vale y el chip vuelve a
  preguntar (sin destino guardado vale para cualquiera);
- `PATCH /v1/projects/:id/tracker` con `opciones` **borra** las decisiones del
  proyecto: reglas nuevas, preguntas nuevas.

**Límite declarado:** una issue que vuelve a cumplir las reglas SIN que cambien
(la devolvieron en el gestor) y después sale otra vez al MISMO destino
encuentra su decisión vieja, porque nadie escribió entre medias.

## 5. Empuje y cierre (FR-003)

Al abrir el PR el motor, en este orden y cada paso con su degradación y su
propio `try`: `linkUrl` (adjunto nativo), un **comentario de cierre** con el
enlace al PR y lo integrado/bloqueado si el gestor declara `comment`, y
`setState(in_review)` si el mapa lo nombra. Sin `comment`, se omite y se anota en el log. Un PR
que ya existía (relanzamiento) no repite el comentario.
