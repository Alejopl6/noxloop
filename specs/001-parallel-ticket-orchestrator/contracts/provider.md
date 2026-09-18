# Contract — Provider

Un proveedor es **un archivo** que exporta este contrato. El motor lo carga por
la ruta que dice la configuración, así que un proveedor puede vivir fuera de
este repositorio.

El motor no conoce ningún gestor. Pregunta capacidades y actúa sobre lo que hay.

## Forma del módulo

```js
export const meta = { name: "github", version: "1.0.0" };
export function capabilities() { /* → Capabilities */ }
export async function getItem(id, ctx) { /* → Item */ }
export async function children(id, ctx) { /* → Item[] */ }
export async function dependencies(id, ctx) { /* → {predecessors, successors} */ }
export async function setState(id, canonicalState, ctx) { /* → {written} */ }
export async function comment(id, text, ctx) { /* → {id} */ }
export async function linkUrl(id, url, title, ctx) { /* → {ok} */ }
export async function addLabel(id, label, ctx) { /* → {ok} */ }
export async function createChild(parentId, spec, ctx) { /* → Item */ }
export async function searchInbox(ctx) { /* → {assigned, mentioned} */ }
```

Obligatorias: `meta`, `capabilities`, `getItem`. Todo lo demás es opcional y se
declara. **Una función ausente cuya capacidad está declarada en `true` es un
error del proveedor**, y el validador del contrato lo detecta al cargarlo — no a
mitad de un recorrido.

## `ctx`, y por qué se inyecta

```js
ctx = {
  options,   // el bloque `provider.options` de la configuración
  env,       // solo las variables que el proveedor declara necesitar
  log,       // bitácora estructurada del recorrido
  fetch,     // cliente HTTP con reintentos y respeto de límite de tasa
}
```

El proveedor **no lee la configuración ni el entorno por su cuenta**. Recibe lo
que necesita. Es lo que hace que un proveedor sea testeable sin red y sin
credenciales: la suite de contrato le pasa un `ctx` falso.

## `Capabilities`

```js
{
  children:        boolean,  // leer los hijos de un item — necesario para hitos
  dependencies:    boolean,  // relaciones de precedencia entre items
  createChild:     boolean,  // materializar tareas como tickets hijos
  setState:        boolean,
  comment:         boolean,
  linkUrl:         boolean,  // adjuntar la URL de un PR al item
  labels:          boolean,
  searchAssigned:  boolean,  // disparo por asignación
  searchMentioned: boolean,  // disparo por mención
  boardFields:     boolean,  // iteración/área/responsable heredables
  identityAssignee: boolean, // puede buscar por un responsable declarado, no solo el del token
}
```

**Cómo degrada el motor, capacidad por capacidad.** Esto es contrato, no
sugerencia: cada fila es un test.

| Capacidad en `false` | Qué hace el motor |
|---|---|
| `children` | No acepta items de nivel `epic`/`feature`. Lo dice al despachar, no a mitad del recorrido. |
| `dependencies` | **Serializa** el orden de los items y lo declara en el plan. No deduce un orden que el gestor no afirma. |
| `createChild` | Las tareas viven solo en el recorrido. El PR las enumera para que el tablero no quede mudo. |
| `setState` | No mueve el ticket. La señal es el comentario. |
| `comment` | Nada bloquea; el recorrido queda solo en el PR y en el reporte local. |
| `linkUrl` | El PR se deja como texto en un comentario. |
| `labels` | Se omiten las etiquetas de progreso. |
| `searchAssigned` / `searchMentioned` | El disparo correspondiente se desactiva; si los dos están en `false`, el modo daemon no arranca y lo dice al validar. |
| `boardFields` | Las tareas hijas no heredan campos de tablero. Se advierte una vez por recorrido. |
| `identityAssignee` | La bandeja busca por el dueño del token y no por el `identity.assignee` declarado. Se advierte al revisar la bandeja, nombrando el responsable que se ignora: si el trabajo se asigna a esa cuenta y no a la del token, la bandeja va a estar vacía. |

## Estados canónicos

El motor solo conoce cinco: `todo`, `in_progress`, `blocked`, `in_review`,
`done`. El proveedor traduce en los dos sentidos.

**Ningún nombre de estado nativo se escribe de memoria.** El mapa vive en la
configuración del proveedor, porque dos proyectos del mismo gestor pueden tener
plantillas distintas — Agile usa `Active`/`Resolved`, Scrum usa
`Committed`, Basic usa `Doing`.

Un estado canónico que el proyecto no tenga se declara `null` en el mapa, y el
motor no lo escribe. `in_review` nulo es el caso normal, no una excepción: en
varias plantillas no existe.

El motor **nunca** pide `done`: cerrar un ticket dice que está integrado, y la
autonomía termina en el PR abierto.

## Resolución de nivel

`level` lo resuelve el proveedor desde su propio modelo de tipos, y **nunca por
comparación del nombre del tipo**. El fallo que esto evita está observado: un
despachador que compara contra `"User Story"` funciona en un proyecto Agile y no
hace nada en uno Scrum —donde el tipo se llama `Product Backlog Item`— sin error
y sin aviso.

Cada proveedor declara su mapa de tipos, con una entrada por defecto explícita.

## Contrato de errores

- Un fallo de red o un límite de tasa se reintenta con espera dentro de
  `ctx.fetch`. Si persiste, el proveedor **lanza**: el motor detiene el
  recorrido con la causa real y no marca nada como terminado.
- Un item que no existe devuelve `null` desde `getItem`. No lanza: "no existe"
  es una respuesta, no un fallo.
- Una escritura rechazada por permisos lanza con el mensaje textual del gestor.
  Nunca se resume a "no se pudo".

## La suite de contrato

`providers/contract.mjs` exporta `runContractSuite(provider, fixtures)`. Todo
proveedor —incluidos los tres incluidos y el falso— corre la misma suite. La
suite verifica, entre otras cosas:

1. `capabilities()` devuelve todas las claves del enum, sin extras.
2. Cada capacidad en `true` tiene su función exportada.
3. Cada capacidad en `false` **no** rompe el motor: se ejercita el camino
   degradado de la tabla de arriba.
4. `getItem` de un id inexistente devuelve `null`, no lanza.
5. Todo `Item` devuelto valida contra el modelo canónico.
6. `level` sale del mapa de tipos y no de comparar nombres: se le pasa un tipo
   desconocido y se espera el nivel por defecto declarado, no un fallo.
7. El mapa de estados es total: todo estado canónico tiene entrada (posiblemente
   `null`), y ningún nativo se inventa.
8. Ninguna función lee `process.env` directamente.

El punto 8 se verifica leyendo el fuente del proveedor, no ejecutándolo: es la
única garantía de que la inyección de `ctx` no se puede saltear en silencio.

## Agregar un gestor nuevo

Cinco pasos, y ninguno toca el motor:

1. Copiar `providers/fake/index.mjs` como punto de partida.
2. Declarar `capabilities()` con la verdad — empezar con casi todo en `false`
   es correcto y produce un recorrido que funciona.
3. Escribir el mapa de tipos y el mapa de estados.
4. Correr `node --test providers/<nuevo>/*.test.mjs` con la suite de contrato hasta
   verde. **El glob no es decorativo**: desde Node 22, `node --test <directorio>/`
   trata el directorio como un modulo y falla con `MODULE_NOT_FOUND`, un error que
   no tiene nada que ver con tu proveedor. `npm test` desde la raiz tambien anda.
5. Apuntar `provider.module` en la configuración.

Si hace falta un cambio en el motor para soportar un gestor, la interfaz está
mal: se arregla la interfaz y se agrega el caso a la suite. No se ramifica el
motor con un `if`.
