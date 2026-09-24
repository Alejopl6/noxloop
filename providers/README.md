# providers

Un archivo = un gestor de tickets. Plano a propósito: agregar uno es agregar un
archivo acá, no navegar la estructura interna de un paquete.

El motor **no conoce ningún gestor**. Habla con la interfaz de
[`contract.mjs`](contract.mjs) y le pregunta qué sabe hacer (`capabilities()`)
antes de usar cada cosa. El contrato completo, con la tabla de cómo degrada el
motor capacidad por capacidad, está en
[`specs/001-parallel-ticket-orchestrator/contracts/provider.md`](../specs/001-parallel-ticket-orchestrator/contracts/provider.md).

## Los cinco pasos

1. **Copiá `fake/index.mjs`.** Es el ejemplo mínimo, y está comentado como
   documentación y no como código de prueba.

2. **Declará `capabilities()` con la verdad.** Empezar con casi todo en `false`
   es correcto y produce un recorrido que funciona: el motor serializa, deja el
   PR en un comentario, no mueve estados, y lo dice. Un `true` sin su función es
   lo único que el validador rechaza.

3. **Escribí el mapa de tipos y el de estados.** El mapa de tipos necesita una
   entrada `default` explícita. El nivel de un ticket **nunca** se deduce
   comparando el nombre del tipo: un gestor llama "Product Backlog Item" a lo
   que otro llama "User Story", y un motor que compare nombres funciona en uno y
   calla en el otro. El mapa de estados es total: todo estado canónico tiene
   entrada, y `null` es una respuesta válida —significa "este proyecto no tiene
   ese estado, no lo escribas".

4. **Corré la suite de contrato hasta verde.**

   ```js
   // providers/mi-gestor/index.test.mjs
   import { test } from "node:test";
   import { contractChecks } from "../contract.mjs";
   import * as mio from "./index.mjs";

   test("pasa el contrato", async () => {
     for (const check of contractChecks(mio, mio.fixtures)) await check.run();
   });
   ```

   Son nueve chequeos. El octavo lee tu fuente para verificar que no tocás
   `process.env`: las credenciales y las opciones llegan por `ctx`, y esa es la
   única garantía de que no se pueda saltear la inyección en silencio. El
   noveno es `listItems` (el listado del board, spec 003): si la declarás en
   `true`, pide una página con `limit: 2`, la valida con `validateListPage` y
   sigue el cursor exigiendo que no repita tickets; si no la declarás —es la
   única capacidad que se puede omitir, porque llegó después y omitirla vale
   `false`— exige que `can()` lo diga.

   Ese snippet alcanza para un gestor sin red, como `fake`. Si el tuyo habla
   HTTP, el `ctx.fetch` de tus `fixtures` tiene que **negar** la red y el test
   le pasa uno propio que sirve respuestas grabadas
   —`contractChecks(mio, { ...mio.fixtures, ctx: miCtxGrabado })`, como hace
   `github/index.test.mjs`—: un test que necesita una cuenta no lo puede correr
   quien adopte el proyecto.

   La otra forma, igual de offline, es que los `fixtures` vivan en un archivo
   aparte que `index.mjs` **no** importe y que ya traigan el `ctx` que sirve las
   respuestas grabadas —`contractChecks(mio, fixtures)`, como hace `linear/`—.
   Lo que no puede pasar es que el módulo de producción cargue datos de prueba.

   Y declará el `defaultLevel` de tus fixtures **distinto** del nivel al que
   mapea la mayoría de tus tipos, o corré la suite dos veces con dos defaults:
   si coinciden, el chequeo 6 lo aprueba igual un proveedor que devuelva ese
   nivel fijo, que es justo el fallo que el chequeo busca. `linear/` corre las
   dos vueltas, y el impostor que pasaba los ocho chequeos con una sola está
   contado en [docs/PROVIDERS.md](../docs/PROVIDERS.md).

5. **Apuntá `provider.module`** en tu `noxloop.config.json`. La ruta puede estar
   fuera de este repositorio: el motor carga el módulo por configuración.

## Ejemplo trabajado: Jira

Jira tiene jerarquía (`parent`), enlaces de tipo `Blocks`, transiciones por
workflow y campos de tablero. Un primer proveedor honesto sería:

```js
export function capabilities() {
  return {
    children: true,          // búsqueda JQL por parent
    dependencies: true,      // issue links de tipo Blocks
    createChild: true,
    setState: true,          // transiciones: ojo, son ids, no nombres
    comment: true,
    linkUrl: true,           // remote links acepta cualquier URL
    labels: true,
    searchAssigned: true,    // JQL: assignee = ...
    searchMentioned: false,  // arrancá en false y sumalo después
    boardFields: true,       // sprint, epic link
  };
}
```

Las dos trampas de Jira que conviene resolver en el paso 3 y no a mitad de un
recorrido: las transiciones se piden por **id de transición** y no por nombre de
estado, así que el `stateMap` guarda el destino y el proveedor resuelve la
transición que lleva ahí; y el nombre del tipo de issue es configurable por
proyecto, que es exactamente el motivo por el que el nivel sale del mapa.

## Los incluidos

| Proveedor | Estado |
|---|---|
| `fake` | ✅ completo — tests del motor y ejemplo mínimo |
| `azure-devops` | ✅ completo — las diez capacidades en `true`, así que no ejercita ningún camino degradado: ver [docs/PROVIDERS.md](../docs/PROVIDERS.md) |
| `github` | ✅ completo — `linkUrl`/`boardFields` en `false`, y con dependencias nativas: ver [docs/PROVIDERS.md](../docs/PROVIDERS.md) |
| `linear` | ✅ completo — todo en `true` menos `searchMentioned`; los estados se resuelven por equipo: ver [docs/PROVIDERS.md](../docs/PROVIDERS.md) |

### `listItems`: cómo mapea cada gestor

| Gestor | Espacio | `backlog` | Prioridad (board 0 urgente … 4 baja, `null` sin dato) | `total` |
|---|---|---|---|---|
| `github` | `owner/repo`; PRs descartados; paginado por `Link` | solo con `stateMap.backlog` = nombre de etiqueta | solo con `options.priorityLabels` (etiqueta → 0..4); gana la más urgente | `null` |
| `linear` | `teamId` o `teamKey` (obligatorio) | `state.type == "backlog"` | 1→0, 2→1, 3→2, 4→3; **0 (sin prioridad) → `null`** | `null` |
| `azure-devops` | proyecto, o `areaPath`; o `wiql.list` | `stateMap.backlog`, o estado `todo` en la raíz de iteraciones | `Microsoft.VSTS.Common.Priority` 1→0 … 4→3; sin campo → `null` | ids de la WIQL |
| `fake` | su `db` | solo con `stateMap.backlog` | la del item, si el test la pone | cuenta exacta |

Los estados que el `stateMap` no nombra salen del enum del gestor —`state.type`
en Linear, la **categoría** del estado en Azure DevOps (`GET
_apis/wit/workitemtypes`)—, nunca del nombre de la columna. Cancelados,
duplicados, `not_planned` y `Removed` no se listan nunca; `done` solo con
`includeDone`.
