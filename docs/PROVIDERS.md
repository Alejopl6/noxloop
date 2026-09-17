# Proveedores: la interfaz, y qué decisión evita cada parte

Para quien quiere agregar su gestor y no escribió este proyecto.

Hay tres documentos y no se solapan:

- [`providers/README.md`](../providers/README.md) — **los cinco pasos**, con Jira
  como ejemplo trabajado. Es el que se sigue con las manos.
- [`specs/001-parallel-ticket-orchestrator/contracts/provider.md`](../specs/001-parallel-ticket-orchestrator/contracts/provider.md)
  — **el contrato formal**: la forma del módulo, la tabla de degradación, el
  contrato de errores, los ocho chequeos. Es el que manda si algo discrepa.
- este — **el por qué**: qué fallo concreto evita cada parte de la interfaz.
  Nada de acá es normativo. Sirve para no "arreglar" una restricción que parece
  arbitraria hasta que se sabe qué se rompió una vez sin ella.

La segunda mitad del documento es el registro por gestor: qué soporta cada uno
de los tres incluidos y **por qué cada `false` es un `false`**, que es la parte
que no se reconstruye leyendo el código.

---

## Por qué el motor pregunta capacidades en vez de asumirlas

El principio VI de la constitución dice que el gestor es un detalle y que se
prueba que lo es. La forma barata de conseguir eso es no conseguirlo: el motor
sabe qué gestor hay del otro lado y se ramifica. Termina siempre igual —
`if (gestor === "jira")` en el planificador, otro en el driver, otro en el
reporte — y el cuarto gestor toca el motor en cinco lugares, cada uno con su
propio olvido. El motor no conoce ningún nombre de gestor: carga el módulo por
la ruta que dice `provider.module` (que puede vivir fuera de este repositorio),
le pregunta `capabilities()` y actúa sobre lo que hay.

Preguntar tiene dos mitades, y las dos existen por un fallo distinto.

**Preguntar antes de arrancar.** `validateProvider(mod)` corre al cargar, no al
usar. Lo que atrapa es una capacidad declarada en `true` sin su función: sin esa
validación no falla al cargar —falla a mitad de un recorrido, exactamente como
una capacidad que no está, pero cuando ya hay rama, worktree y tres commits, y
el mensaje no dice que lo que está mal es el proveedor—. El validador también
rechaza un mapa **incompleto** y una clave **inventada**: una capacidad sin
declarar es una capacidad de la que el motor no sabe si puede usar, y
`telepatia: true` en el mapa es un tipeo que de otro modo se lee como "no
soportada" para siempre.

**Preguntar en cada punto de uso.** `can(mod, cap)` devuelve
`{available: false, reason}` en vez de lanzar, porque la ausencia de una
capacidad no es un error: es una rama del recorrido. Del lado del proveedor, la
contraparte es `NotSupportedError`: una función que existe pero cuya capacidad
está en `false` **tiene que lanzarla** (es el chequeo 3 de la suite). El fallo
que eso evita es el peor de todos: una función que existe, devuelve `{ok: true}`
y no hace nada. El motor la llama, anota el PR como enlazado, el tablero queda
mudo y nadie se entera hasta que alguien mira el ticket a mano.

### Por qué una capacidad en `false` produce un recorrido que funciona igual

Porque lo que el usuario pide es un pull request, y ninguna de las diez
capacidades participa de abrirlo. Las capacidades deciden **cuánto del recorrido
queda reflejado en el tablero**, no si el recorrido ocurre. Un proveedor que
solo exporta `meta`, `capabilities` y `getItem` —las tres obligatorias— alcanza
para leer un ticket, planificar, correr el ciclo rojo/verde y abrir el PR. Lo
que se pierde es el ticket movido, el comentario, la etiqueta y el hijo en el
tablero; lo que no se pierde nunca es el PR, que enumera las tareas en el
cuerpo.

Eso no es una promesa de diseño: es cómo corren los tests del motor. El
proveedor falso tiene **tres capacidades en `false`** (`linkUrl`, `labels`,
`boardFields`) y contra él corre todo el paralelismo, la cola de integración y
la máquina de estados, sin red y sin credenciales.

Por eso el paso 2 del README dice "empezá con casi todo en `false`". No es
prudencia: un proveedor que declara poco y dice la verdad produce recorridos
completos, y uno que declara de más produce recorridos que mueren en el paso más
inocente que tienen.

---

## La tabla de degradación, con lo que el usuario ve

La tabla normativa está en el contrato. Esta agrega la columna que importa a
quien va a escribir el proveedor: **qué ve la persona** cuando su gestor no
sabe hacer algo. Si un `false` produce silencio, el proveedor está mal escrito o
el motor le debe un aviso.

| Capacidad en `false` | Qué hace el motor | Qué ve el usuario |
|---|---|---|
| `children` | No acepta items de nivel `epic`/`feature` | `noxloop dispatch` se niega **antes de empezar**, con las tres líneas: `… es de nivel "epic", que se recorre como hito,` / `pero el gestor X no soporta leer hijos (capabilities().children es false).` / `Se dice ahora y no a mitad del recorrido.` Y `noxloop doctor` avisa: `el proveedor no sabe leer hijos: no se van a poder recorrer hitos, solo tickets sueltos` |
| `dependencies` | Serializa el orden y lo declara | `noxloop doctor`: `el proveedor no soporta dependencias entre tickets: el orden de un hito se va a serializar y quedar declarado`. El orden serializado queda escrito en el plan, no deducido |
| `createChild` | Las tareas viven solo en el recorrido | `noxloop plan` devuelve la nota: `el gestor no soporta createChild (…): las tareas viven solo en el recorrido, y el PR las enumera`. El cuerpo del PR trae `### Tareas (N de M integradas)` con cada una — eso sale igual, con la capacidad en `true` o en `false`. Lo que el PR **no** enumera es una tarea que terminó fuera de `integrated`/`blocked`: `prBody` recorre esas dos listas y nada más, así que una tarea arrastrada por una dependencia bloqueada —la categoría que el scheduler llama `unreachable`, que calcula y que **nadie consume**— aparece solo en el conteo `N de M`. Con `createChild` en `false` esa tarea no existe en ningún lado: ni ticket hijo, ni bloque en el PR |
| `setState` | No mueve el ticket | Nada en el tablero, y la bitácora lo dice cuando el mapa tiene el estado en `null`: `el gestor no tiene estado para "in_review": no se escribio nada`. La señal real pasa a ser el comentario |
| `comment` | Nada bloquea | El recorrido queda en el PR y en el reporte local. Si además falta `linkUrl`, el ticket no recibe **nada** y la URL del PR vive solo en el reporte |
| `linkUrl` | El PR va como comentario | Un comentario en el ticket: `Pull request abierto por noxloop: <url>`. Texto, no adjunto: no hay estado del PR sincronizado en el ticket |
| `labels` | Se omiten las etiquetas de progreso | Nada. **Y hoy tampoco cambia nada con la capacidad en `true`**: el motor no llama `addLabel` en ningún punto del recorrido. La fila es contrato para código que todavía no existe |
| `searchAssigned` / `searchMentioned` | Se desactiva el disparo | Con las dos en `false`, `noxloop doctor` avisa: `el proveedor no soporta ninguna forma de disparo automatico: el modo daemon no va a arrancar`. Con una sola en `false`, el otro disparo sigue y `searchInbox` devuelve ese balde vacío |
| `boardFields` | Las tareas hijas no heredan campos de tablero | El hijo nace sin iteración, sin área y sin responsable: **no aparece en ningún taskboard**, que es un síntoma que no se lee como un error. El contrato promete un aviso por recorrido y **el motor no lo emite hoy**: el planificador pasa `boardFields ?? null` en silencio |

Las dos últimas filas son las que quedan en deuda, y están escritas acá para que
quien las cierre sepa que no son una idea nueva sino una fila del contrato sin
código.

### Qué camino degradado se ejercita de verdad hoy

Entre los tres proveedores incluidos hay treinta declaraciones de capacidad, y
**tres** son `false`. Sumando el falso, los caminos degradados que algún
proveedor incluido recorre son cuatro: `linkUrl`, `labels`, `boardFields` y
`searchMentioned`. Los otros seis —`children`, `dependencies`, `createChild`,
`setState`, `comment`, `searchAssigned`— no los ejercita ningún proveedor
incluido, y el falso tampoco.

No se arregla bajando a `false` una capacidad que el gestor sí tiene: eso apaga
trabajo real y miente sobre el gestor para conservar un escenario de prueba. Se
arregla con un segundo juego de capacidades reducidas, y **ya existe**:
[`providers/degradation.test.mjs`](../providers/degradation.test.mjs) (T059) con
las fábricas de [`providers/degradation-fakes.mjs`](../providers/degradation-fakes.mjs).
Son diez gestores falsos mínimos, uno por capacidad apagada, y ninguno toca el
motor.

Tres decisiones de ese test, con el fallo que evita cada una:

1. **Cada fake pasa los ocho chequeos de `contractChecks`**, los mismos que los
   tres incluidos. Un módulo a medias que se rompe al llamarlo no prueba nada
   sobre la degradación: prueba que un módulo roto se rompe. Lo que se quiere
   probar es que un gestor honesto, que declara poco, produce un recorrido que
   funciona.
2. **La función de una capacidad en `false` lanza `NotSupportedError`**; no
   devuelve `[]`, ni `null`, ni `{ok: true}`. Un `[]` de `children` es
   indistinguible de "un hito sin hijos" y el recorrido terminaría informando
   que no había nada que hacer — el mismo fallo que las dos escrituras de Azure
   DevOps que decían "listo" sin escribir. La excepción son las dos búsquedas,
   que comparten `searchInbox`: apagar una devuelve esa mitad vacía; apagadas
   las dos, la función **no se exporta**.
3. **La tabla del contrato se lee en tiempo de test.** Un test parsea la primera
   columna de la tabla de `contracts/provider.md` y falla si aparece una fila sin
   test o una capacidad sin fila. Es lo que evita que la tabla y la suite se
   desincronicen en silencio, que es como una fila se vuelve decorativa.

Qué queda fuera de alcance desde `providers/`, y por qué: el **mensaje** con el
que `noxloop dispatch` se niega vive en `comandos.mjs`, que arrastra
`wiring.mjs` → `runner.mjs`, y hoy no tiene ningún test. Que el motor **elija**
el camino degradado —comentario en vez de enlace, no mover el ticket— lo cubre
`packages/engine/test/provider-writes.test.mjs`. De las dos mitades que sí se
observan sin levantar git ni el SDK, `prBody` y `doctor`, `doctor` no tenía
test: el test de degradación es el primero que lo ejercita.

---

## Por qué el nivel sale de un mapa de tipos y nunca de comparar el nombre

Es la regla que más parece burocracia y la que evita el fallo más caro del
repositorio, porque no falla: calla.

Un despachador que compara el tipo del ticket contra `"User Story"` funciona en
un proyecto Agile. En un proyecto Scrum el mismo nivel se llama
`Product Backlog Item`, en Basic `Issue`, en CMMI `Requirement`, y un proceso
heredado puede llamarlo `Ticket`. La comparación no coincide, no hay excepción,
no hay log: el despachador **no hace nada** y el ticket parece no ser
despachable. El mismo código, el mismo gestor, la misma credencial, dos
proyectos, y en uno anda.

De ahí salen las tres piezas:

1. **El mapa vive en la configuración**, no en el proveedor: dos proyectos del
   mismo gestor tienen plantillas distintas, así que el nombre nativo es dato y
   no código (principio VII).
2. **La entrada `default` es obligatoria y explícita.** Un mapa sin `default` se
   rechaza en vez de adivinar uno — el proveedor de Azure DevOps lanza citando
   la opción. Adivinar "lo que no conozco es una historia" es la misma
   deducción, con otro nombre.
3. **El chequeo 6 de la suite** le pasa un tipo nativo desconocido y espera el
   nivel por defecto **declarado en los fixtures**, no un fallo.

El chequeo 6 tiene una trampa, y está documentada porque se cayó en ella: con un
solo `defaultLevel` igual al nivel al que mapea la mayoría de los tipos de los
fixtures, el chequeo lo aprueba también un proveedor que devuelva ese nivel
**fijo** y que no mire el mapa. Se comprobó con un impostor de quince líneas que
pasaba los ocho chequeos. La salida: `github` y `linear` corren la suite entera
**dos veces** con dos defaults distintos, y `azure-devops` lo cubre con un test
propio y un mapa absurdo a propósito —`{"User Story": "epic", default: "task"}`—
donde un nivel deducido del nombre devolvería `story` y el test lo delata.

Dos corolarios que no son obvios hasta que se escribe un proveedor:

- **Deducir el nivel de la estructura es la misma prohibición con otro
  disfraz.** `parent == null → epic` parece sólido y no lo es: un sub-issue de un
  sub-issue queda `task` por accidente, y un issue suelto que es una historia
  pasa a `epic` sin que nadie lo haya declarado. Linear no tiene modelo de tipos
  y la tentación era esa; se eligió la etiqueta, que alguien declara.
- **En JavaScript, el mapa se consulta con `Object.hasOwn`.** Un tipo o una
  etiqueta que se llame `constructor`, `toString` o `valueOf` devuelve con
  `mapa[nombre]` una función **heredada del prototipo de `Object`**, y el `Item`
  vuelve con `level: [Function]`; con `__proto__` vuelve `{}`. El motor descarta
  un ticket válido por "level inválido" sin decir de dónde salió el valor. No
  hace falta ninguna respuesta rara del gestor: alcanza una etiqueta, y los
  nombres de etiqueta son texto libre.

---

## Por qué `ctx` se inyecta y el proveedor no lee el entorno

```js
ctx = { options, env, log, fetch }
```

El proveedor no lee la configuración ni `process.env`: recibe lo que necesita.
La razón no es purismo — es la única forma de que la regla del encargo se pueda
cumplir: **un test que necesita una cuenta no lo puede correr quien adopte el
proyecto**. Un proveedor que lee el entorno por su cuenta solo se puede probar
con credenciales, o con un test que ensucia `process.env` global y se pisa con
el de al lado cuando el runner corre en paralelo. Un proveedor que recibe `ctx`
se prueba pasándole un `ctx` de mentira: los 396 tests de este repositorio
corren sin una sola credencial y sin salir a la red.

Las cuatro piezas, y qué se gana con cada una:

- **`options`** — el bloque `provider.options` de la configuración. Los mapas de
  tipos y de estados viven acá, que es lo que permite que dos proyectos del
  mismo gestor usen el mismo proveedor.
- **`env`** — solo las variables que el proveedor declara en `requiredEnv`.
  Declararlas es lo que le da a `noxloop doctor` con qué avisar `falta la
  variable de entorno X, que el proveedor Y necesita` antes de un recorrido, en
  vez de un 401 a mitad de camino.
- **`log`** — la bitácora del recorrido. Un `console.log` del proveedor sale
  fuera del recorrido al que pertenece y no se puede correlacionar.
- **`fetch`** — cliente con reintentos y respeto de límite de tasa. Que la
  espera viva acá y no en cada proveedor es lo que evita tres políticas de
  reintento distintas, y es también el punto donde se ve una limitación real:
  `ctx.fetch` reintenta mirando el status, así que el 429 clásico lo cubre, y el
  límite de tasa de Linear —que llega como **HTTP 400** con
  `errors[].code == "RATELIMITED"`— no. El arreglo es del motor, no del
  proveedor, y está anotado donde importa.

**Y hay un chequeo que lee el fuente para que no se pueda saltear en silencio.**
El chequeo 8 abre el archivo del proveedor, le saca los comentarios y busca
`process.env`. Lee el fuente y no ejecuta a propósito: ejecutar no puede probar
una ausencia. Un `process.env.TOKEN ?? ctx.env.TOKEN` en la rama que los
fixtures no tocan pasa todos los tests de comportamiento, y el día que alguien
corre el proveedor sin esa variable el fallo aparece en el gestor y no en la
suite. Por eso el chequeo 8 es el único que mira el código y no el resultado, y
por eso cada proveedor tiene que pasarle su `sourceUrl` en los fixtures.

La contracara para quien escribe los fixtures: **el `ctx` de los fixtures que
vive en `index.mjs` tiene que negar la red.** El falso lo hace literalmente
(`throw new Error("el proveedor falso no hace red")`). Los tres reales lo
resuelven de tres maneras, todas offline: `github` exporta `fixtures` desde
`index.mjs` y el test reemplaza el `ctx` por uno que sirve respuestas grabadas,
`azure-devops` arma el `ctx` grabado dentro del test, y `linear` tiene un
`fixtures.mjs` aparte que `index.mjs` **no importa** —para que el módulo de
producción no cargue datos de prueba en cada arranque del motor—.

---

## Por qué los estados canónicos son cinco, y por qué el motor nunca escribe `done`

`todo`, `in_progress`, `blocked`, `in_review`, `done`. No son un denominador
común de los gestores: son **los estados por los que pasa un recorrido**. Hay
uno por transición que el motor sabe provocar —empieza, avanza, se traba, abre
el PR— y `done`, que es el único que el motor sabe **reconocer** y no escribir.
Cinco es la lista completa de lo que la autonomía puede afirmar. Cualquier
sexto estado sería vocabulario de un tablero, y el vocabulario de los tableros
es lo que vive en el mapa.

Tres consecuencias:

**`null` es una respuesta, no un hueco.** Un estado canónico que el proyecto no
tiene se declara `null` en el mapa y el motor no lo escribe. `in_review: null`
es el caso normal y no la excepción: Basic no tiene **ningún** estado en la
categoría Resolved, y el set por defecto de un equipo nuevo de Linear es
"Backlog > Todo > In Progress > Done > Canceled". Un `null` además no cuesta un
viaje: el mapa ya dijo que ese estado no existe, y el proveedor devuelve
`{written: null, skipped: <canónico>}` sin preguntarle nada al gestor.

**El mapa tiene que ser total.** El chequeo 7 exige que los cinco canónicos
tengan entrada, aunque sea `null`. Lo que separa "este proyecto no tiene ese
estado" de "me olvidé de mapearlo" es una entrada escrita, y sin esa distinción
las dos cosas se ven igual: un tablero que no se mueve.

**El motor nunca pide `done`.** Cerrar un ticket afirma que el trabajo está
integrado, y la autonomía termina en el PR **abierto**: quien revisa y mergea es
una persona. Un motor que cierra el ticket al abrir el PR deja un tablero en
verde con el trabajo sin revisar, que es la clase de mentira más difícil de
detectar porque nadie la audita. `noxloop doctor` avisa incluso si el mapa lo
declara: `el stateMap declara "done", pero noxloop nunca lo escribe: cerrar un
ticket dice que esta integrado, y la autonomia termina en el PR abierto.`

Dos detalles de la escritura, por si el proveedor parece no escribir:

- El motor **no escribe hacia atrás ni dos veces**. `providerStateWritten` es la
  marca de agua: relanzar un recorrido terminado no puede devolver el ticket de
  "en revisión" a "en curso". `blocked` no tiene rango, porque es una señal
  lateral de la que se puede volver.
- Al **leer**, un estado nativo que el mapa no declara devuelve
  `canonicalState: null`, y no `"todo"`. Un item en `Removed` reportado como
  `todo` es un item que el motor vuelve a despachar.

---

## Los tres incluidos, capacidad por capacidad

Lo que cada uno declara hoy, leído de su `capabilities()` y no del plan.

| Capacidad | `github` | `azure-devops` | `linear` | `fake` (referencia) |
|---|---|---|---|---|
| `children` | ✅ | ✅ | ✅ | ✅ |
| `dependencies` | ✅ | ✅ | ✅ | ✅ |
| `createChild` | ✅ | ✅ | ✅ | ✅ |
| `setState` | ✅ ⚠️ | ✅ | ✅ | ✅ |
| `comment` | ✅ | ✅ | ✅ | ✅ |
| `linkUrl` | ❌ | ✅ | ✅ | ❌ |
| `labels` | ✅ | ✅ | ✅ | ❌ |
| `searchAssigned` | ✅ | ✅ | ✅ | ✅ |
| `searchMentioned` | ✅ | ✅ ⚠️ | ❌ | ✅ |
| `boardFields` | ❌ | ✅ | ✅ | ❌ |
| | **8 de 10** | **10 de 10** | **9 de 10** | 7 de 10 |

Cada `false` y cada ⚠️, con su degradación:

| Gestor | Capacidad | Por qué | Cómo degrada, y qué se ve |
|---|---|---|---|
| `github` | `linkUrl: false` | No existe el endpoint. La API de Issues no tiene remote links ni linked PRs; enlazar se hace a mano en la interfaz, o por `Closes #42` en el cuerpo del PR, que además solo se interpreta contra la rama por defecto — y el motor abre PRs contra la rama del ticket. Los issue fields no tienen tipo URL | El PR va como comentario. Es el camino que este gestor recorre **siempre**, así que conviene que sea el mejor probado del motor y no el de excepción |
| `github` | `boardFields: false` | Projects v2 —Status, Sprint, Iteration— solo vive en GraphQL, y el proveedor es REST | El hijo nace sin campos de tablero y no aparece en ningún taskboard. El aviso por recorrido que el contrato promete todavía no lo emite el motor |
| `github` | `setState: true` ⚠️ | La capacidad es real pero el gestor tiene **un** estado: `open`/`closed`. Tres de los cinco canónicos quedan en `null` en el mapa | `setState` devuelve `{written: null, skipped}` tres veces de cada cinco, y como el motor nunca pide `done`, en la práctica no escribe nada: es la fila "`setState` en `false`" ocurriendo con la capacidad en `true`. La señal real es el comentario |
| `azure-devops` | — | Diez en `true`: jerarquía nativa, dependencias acíclicas, transiciones, comentarios, hipervínculos, etiquetas, consultas y campos de tablero comunes | **No ejercita ningún camino degradado.** No es una virtud del proveedor: es una propiedad del gestor, y deja un hueco de cobertura que se cierra con fixtures de capacidades reducidas, nunca bajando un `true` a `false` |
| `azure-devops` | `searchMentioned: true` ⚠️ | El macro WIQL `@RecentMentions` mira los **últimos 30 días** | Capacidad con ventana, no a medias. Un daemon caído una semana no pierde nada; uno caído un mes sí. El disparo por mención no es memoria infinita, y eso no se ve en el booleano |
| `linear` | `searchMentioned: false` | Alcanzable —el corte por `category == "mentions"` es un enum documentado—, pero es la única señal que se apoya en una pieza del inbox que no se puede verificar sin una cuenta real, y eso el encargo lo prohíbe con razón. Declararla en `true` sin probarla sería afirmar un disparo que no probamos | `searchInbox` devuelve `mentioned: []` y la capacidad dice `false`. El daemon igual arranca: el motor solo se niega si las dos búsquedas están en `false`. Para pasarla a `true` hay un procedimiento escrito en la sección de Linear |
| `fake` | `linkUrl`, `labels`, `boardFields` en `false` | Es el ejemplo mínimo y el proveedor de los tests del motor: declarar poco es parte de lo que enseña | Las tres funciones **existen y lanzan `NotSupportedError`**, que es lo que exige el chequeo 3. Son los únicos caminos degradados que los tests del motor recorren |

Y lo que la tabla no dice pero conviene saber antes de elegir un gestor de
referencia para copiar: los tres resuelven el nivel con un mapa de tipos, los
tres reciben todo por `ctx`, y ninguno de los tres tiene un `stateMap` con
`done` mapeado.

---

# El registro por gestor

Lo que sigue es, para cada uno de los tres incluidos, cómo está implementado,
qué se confirmó contra la documentación vigente, qué quedó sin confirmar y qué
fallo concreto atajó cada decisión. Es el material que no se reconstruye leyendo
el código.

## GitHub Issues — `providers/github/`

Es el gestor más probable de quien adopte este proyecto, y el que cambió de
modelo más recientemente de los tres. La forma de la API se confirmó contra la
API vigente antes de escribir una línea, no de memoria.

| Capacidad | | Cómo |
|---|---|---|
| `children` | ✅ | `GET /repos/{owner}/{repo}/issues/{n}/sub_issues`, paginado. La inversa es `GET .../parent`. |
| `dependencies` | ✅ | `GET .../dependencies/blocked_by` (predecesores) y `.../blocking` (sucesores). |
| `createChild` | ✅ | `POST /repos/{owner}/{repo}/issues` con `parent_issue_id`: una sola llamada. |
| `setState` | ⚠️ | Existe, pero GitHub solo tiene `open`/`closed`. Ver abajo. |
| `comment` | ✅ | `POST .../comments`. |
| `labels` | ✅ | `POST .../labels`, que **suma**. Nunca `PUT`, que reemplaza el conjunto entero. |
| `searchAssigned` | ✅ | `GET /issues?filter=assigned&state=open`. |
| `searchMentioned` | ✅ | `GET /issues?filter=mentioned&state=open`. |
| `linkUrl` | ❌ | No existe el endpoint. Ver abajo. |
| `boardFields` | ❌ | Projects v2 (Status, Sprint, Iteration) solo vive en GraphQL. |

**Configuración.** Un solo secreto: `GITHUB_TOKEN` (`GH_TOKEN` se acepta como
alias al leer `ctx.env`, pero no es una segunda variable obligatoria: el
cargador exige que *toda* variable de `requiredEnv` esté presente). Todo lo
demás va por `provider.options`: `owner`, `repo`, `stateMap`, `typeMap`,
`typeMapById` (opcional), `childType`, `childLabels`, y `apiVersion` /
`apiBase` / `webBase` / `perPage` / `maxPages` para casos de borde.
(`webBase` es el host de la interfaz web —`https://github.com` salvo en GitHub
Enterprise— y solo se usa como respaldo de `html_url`.)

**Permisos.** Con token fine-grained alcanza `Issues: read and write` más
`Metadata: read-only` para las nueve operaciones. Con PAT clásico hace falta
`repo`. `read:org` no hace falta: sería solo para resolver el catálogo de issue
types con `GET /orgs/{org}/issue-types`, y eso lo reemplaza el `typeMap` de la
configuración sin gastar una llamada por recorrido.

**La versión de la API se pinnea y no es cosmético.** `X-GitHub-Api-Version:
2026-03-10` en todos los pedidos. Omitir el header cae en `2022-11-28`, y los
endpoints nuevos —`dependencies`, issue field values— están documentados bajo
`2026-03-10`.

### `linkUrl: false` es el camino normal de este gestor, no una excepción

No hay endpoint. El índice de la API de Issues lista Assignees, Comments,
Events, Issue dependencies, Issue field values, Issues, Labels, Milestones,
Sub-issues y Timeline events: no hay grupo de remote links ni de linked pull
requests. Enlazar un PR a un issue se puede de dos maneras, y ninguna sirve para
un orquestador:

- a mano, desde la barra *Development* de la interfaz (tope de 10 issues por PR);
- por palabra clave en el **cuerpo del PR** (`Closes #42`), que además solo se
  interpreta si el PR apunta a la rama por defecto — y el motor abre PRs contra
  la rama del ticket.

Los issue fields tampoco ayudan: los tipos son `text`, `date`, `single_select`,
`multi_select` y `number`. No hay tipo URL.

Conclusión: la fila "`linkUrl` en `false` → el PR se deja como texto en un
comentario" de la tabla de degradación es el camino que este gestor recorre
**siempre**. Conviene que sea el camino mejor probado del motor, no el de
excepción.

### `setState: true`, honesto hasta el hueso

GitHub Issues tiene un solo estado nativo —`open`/`closed`, más un
`state_reason` de `completed`/`not_planned`/`duplicate`/`reopened`— y eso es
todo: no hay `in_progress`, ni `blocked`, ni `in_review`. El `stateMap` deja
tres de los cinco canónicos en `null` y `setState` devuelve
`{written: null, skipped: <canónico>}` tres veces de cada cinco. Como el motor
**nunca** pide `done`, en la práctica no escribe nada y la señal real es el
comentario: es la fila "`setState` en `false`" de la tabla, ocurriendo con la
capacidad en `true`.

Declararla en `false` también sería defendible, pero perdería el único caso que
sí funciona —abrir— y el reabrir, que necesita `state_reason: "reopened"`: un
`PATCH` con solo `{state: "open"}` sobre un issue cerrado como `not_planned` lo
deja abierto y todavía marcado como descartado. Por eso el proveedor paga un
`GET` antes de abrir, y solo antes de abrir.

**El único lugar donde aparece un nombre nativo en el código, y por qué se
permite.** `open` y `closed` no son nombres de plantilla escritos de memoria
—eso es lo que el contrato prohíbe, y es el motivo de que el mapa viva en la
configuración—: son el enum cerrado del campo `state` de la API REST, que
ninguna organización puede renombrar. Por eso el proveedor **valida** el
`stateMap` contra esos dos valores en vez de asumirlos, y normaliza la
capitalización. El fallo que eso evita, que estaba: un `done: "Closed"` en la
configuración no coincidía con la comparación `=== "closed"`, así que caía en la
rama de *abrir*, pagaba un `GET` de más y mandaba un `PATCH` con
`{state: "Closed"}` que GitHub rechaza con `422 Invalid value` — sin que nada
dijera que lo que estaba mal era el mapa. Un valor que no sea ninguno de los dos
—`"Cerrado"`— ahora lanza citando `stateMap.<canónico>` antes de gastar una
llamada.

### El cambio de premisa: GitHub **sí** tiene dependencias nativas

`research.md` (D4) y el encargo de la tarea T061 asumían que GitHub Issues no
tiene relación de bloqueo nativa, y que por eso `dependencies` iba en `false`
con el motor serializando y declarándolo. **Eso dejó de ser cierto el
2025-08-21**: las dependencias entre issues salieron a GA con REST, GraphQL y
webhooks.

- Leer: `GET /repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by` y
  `.../blocking`, las dos paginadas.
- Escribir: `POST .../dependencies/blocked_by` con `{issue_id: <id global>}`,
  `DELETE .../dependencies/blocked_by/{issue_id}`.
- Tope de 50 issues por tipo de relación (eso sale del changelog, no de la
  página de referencia).

**Decisión: `dependencies: true`.** El contrato dice que el motor no deduce un
orden que el gestor no afirma; acá el gestor lo afirma, y declararlo en `false`
sería mentir sobre el gestor para conservar un escenario de prueba. El proveedor
solo **lee** las dependencias: el motor las usa para ordenar y nunca escribe
precedencias, y exportar una escritura que nadie llama es superficie que se rompe
sin que ningún test lo note.

**Lo que esta decisión cuesta, dicho en voz alta:** el escenario US3-AC2 —el
camino degradado de `dependencies: false`, con el motor serializando y
declarándolo en el plan— deja de ejercitarse contra el gestor más probable de
quien adopte el proyecto. Y no queda cubierto por otro proveedor: **el falso
también declara `dependencies: true`**, y `linear` tiene la relación nativa, así
que hoy ningún proveedor incluido recorre ese camino. La salida es un segundo
juego de fixtures con capacidades reducidas sobre el mismo proveedor — nunca
bajar a `false` una capacidad que el gestor sí tiene. **Eso toca al motor y no
se decidió acá.**

### Los dos identificadores, que no son intercambiables

Cada issue tiene `number` —el que va en la **ruta**— y `id`, un entero global
que es el que piden los **cuerpos** de sub-issues y de dependencies
(`sub_issue_id`, `issue_id`, `parent_issue_id`). Los dos son enteros, así que
confundirlos no da un error de tipo: da un 404 o, peor, engancha un issue ajeno
que casualmente tenga ese id global. El `Item` canónico lleva el número en `id`
(es lo que una persona escribe y lo que queda legible en el nombre de una rama)
y el global aparte, en `gid`.

El `id` canónico se **califica** como `owner/repo#numero` cuando el issue no
vive en el repositorio configurado. Solo `searchInbox` puede devolver eso, porque
`GET /issues` barre todos los repositorios visibles: dos repos pueden tener el
issue 12, y un número pelado haría que el daemon despache el equivocado.

"El repositorio configurado" se decide comparando `owner` y `repo` **sin
distinguir mayúsculas**, como los compara GitHub: `Acme/Tienda` y `acme/tienda`
son el mismo repositorio, y la API responde siempre con la capitalización
canónica y no con la que se escribió en la configuración. Con la comparación
sensible —como estaba— un `owner: "Acme"` hacía que `getItem("42")` devolviera
`id: "acme/tienda#42"` para el repositorio propio: el motor despachó `"42"`,
guardaba el estado bajo otro id y los hijos y las dependencias no matcheaban con
nada, sin un solo error.

### El nivel sale del mapa, y el default es el caso común

El nivel viene del campo `type` del issue, que es un objeto
`{id, node_id, name, ...}` o `null`, y está definido a nivel **organización**
(`GET /orgs/{org}/issue-types`), no de repositorio. La entrada `default` del
`typeMap` cubre tres situaciones que en GitHub son la norma:

1. `type: null`, que es lo que devuelve todo issue de un repo de cuenta personal;
2. un tipo que la organización inventó y el mapa no conoce;
3. un tipo que la organización renombró — los tres por defecto (`task`, `bug`,
   `feature`) se pueden renombrar, deshabilitar y borrar.

Para el caso 3 existe `typeMapById`, opcional y keyeado por `type.id`: el id es
estable dentro de la organización y sobrevive a un rename. Si está, gana sobre
el nombre.

### Por qué la bandeja son dos llamadas y no una

`GET /search/issues?q=...&advanced_search=true` resolvería asignados y
mencionados en una sola consulta, pero el buscador va a **30 pedidos por
minuto** contra los 5000 por hora del core, y una sola consulta no permite
distinguir el balde `assigned` del `mentioned` —que son dos capacidades
separadas del contrato, con dos disparos distintos—. Dos llamadas al core cuestan
menos cuota que una al buscador y no pierden la distinción.

De la bandeja se descartan los pull requests filtrando por la clave
`pull_request` de cada item: la REST API de GitHub considera issue a todo pull
request, y sin ese filtro el daemon dispara un recorrido sobre una revisión y el
motor busca criterios de aceptación en un diff.

### Cuando el gestor no devuelve lo que promete

Ninguno de estos casos es hipotético en una API del tamaño de la de GitHub: un
issue transferido a mitad de una paginación, un proxy corporativo que devuelve
una página de error con `200`, un endpoint nuevo que devuelve un envoltorio en
vez de una lista. El fallo era siempre el mismo —un
`TypeError: Cannot read properties of null (reading 'number')` que el motor
reporta como causa del recorrido, sin decir contra qué gestor ni contra qué ruta
pasó—, y la regla quedó así:

- **En una lista** (`children`, `dependencies`, `searchInbox`) lo que no es un
  issue se **saltea y se avisa** por `ctx.log.warn`. Un hueco en los sub-issues
  no puede tirar un hito de veinte historias; saltear *en silencio* sería la
  otra mitad del fallo, un hijo que desaparece del plan sin que nadie se entere.
- **En un objeto** (`getItem`) se **lanza** con la ruta adentro. El único campo
  que se exige es `number`, porque es el que se vuelve el `id` canónico: sin él
  la traducción fabricaba un `Item` con `id: "undefined"` y sin `url` que no
  valida contra el modelo canónico, y el motor guardaba el estado del recorrido
  bajo esa clave.
- **Después de una escritura que ya ocurrió** no se lanza por no poder leer la
  respuesta: `comment` devuelve `{id: null, url: null}` con el `201` ya dado,
  porque el reintento natural dejaría el mismo comentario dos veces en un
  tablero ajeno. `createChild` sí lanza —no puede inventar el `Item` que el
  contrato promete— pero el mensaje **dice que la tarea ya quedó creada**, para
  que nadie reintente y duplique el ticket.
- `html_url` lo manda GitHub siempre; el respaldo derivado de `webBase` existe
  para que un `Item` nunca salga sin `url` y el fallo no aparezca lejos de donde
  nació.

### Lo que quedó sin confirmar

Está anotado en el código, junto al lugar donde importa. Resumido:

1. Si el issue **bloqueante** de una dependencia puede vivir en otro
   repositorio: la página de referencia no lo dice. Se confirma con un fixture
   grabado de una dependencia cross-repo.
2. El tope de 50 por tipo de relación sale del changelog. Si un hito lo supera,
   el proveedor devuelve los primeros 50 y GitHub no avisa. Se confirma contando
   `blocked_by` contra un issue preparado con 51.
3. De sub-issues está escrita la restricción *"the sub-issue must belong to the
   same repository owner as the parent issue"*, pero no si eso habilita cross-repo
   dentro del mismo owner. Se asume el mismo repo hasta tener un fixture que lo
   contradiga; el `id` canónico ya se califica solo cuando el repo difiere, así
   que un caso cross-repo se reflejaría sin cambiar código.
4. Si los endpoints de `dependencies` responden igual bajo `2022-11-28`. Se
   confirma con un `curl -i` al mismo endpoint cambiando solo el header. Mientras
   no esté confirmado, `2026-03-10` es el único valor en el que se sabe que andan.
5. Que los repos de cuenta personal no tengan issue types está **inferido** de
   que el catálogo es de la organización, no documentado explícitamente. La
   inferencia no es carga: es el caso 1 del default del `typeMap`.
6. Un issue field de tipo `single_select` podría alojar un "Status" de verdad y
   darle a `setState` los cinco estados, pero definirlo exige `admin:org` y
   ninguna página lo plantea como sustituto del estado del issue. Queda afuera, y
   queda escrito para que nadie lo descubra a mitad de un recorrido.

### Los criterios de aceptación no tienen campo

GitHub Issues no tiene dónde ponerlos: los issue fields son `text`, `date`,
`single_select`, `multi_select` y `number`, y ninguno es una lista. El proveedor
lee la **lista de tareas del cuerpo** (`- [ ] ...`), que es la convención más
duradera. Si no hay ninguna, devuelve vacío y el motor lo ve: mejor que devolver
un criterio inventado.

---

## Azure DevOps Boards — `providers/azure-devops/`

El único de los tres con las **diez capacidades en `true`**. No es una virtud
del proveedor: el gestor tiene jerarquía nativa, dependencias nativas acíclicas,
transiciones, comentarios, hipervínculos, etiquetas, consultas y campos de
tablero comunes. La consecuencia importa para los tests: este proveedor **no
ejercita ningún camino degradado** de la tabla del contrato, y el que prueba
alguno sigue siendo el falso — con tres en `false` (`linkUrl`, `labels`,
`boardFields`), que son los únicos caminos degradados que los tests del motor
recorren. Si alguien quiere
probar la degradación con este gestor, se hace con un segundo juego de fixtures
que declare capacidades reducidas — nunca bajando a `false` una capacidad que el
gestor sí tiene, porque eso apaga trabajo real.

| Capacidad | | Cómo |
|---|---|---|
| `children` | ✅ | Del **mismo** `getItem` con `$expand=all`, filtrando `relations` por `System.LinkTypes.Hierarchy-Forward`. No hay endpoint de hijos y no hace falta. |
| `dependencies` | ✅ | Del mismo `getItem`: `Dependency-Reverse` = predecesores, `Dependency-Forward` = sucesores. `acyclic: true`, así que el DAG llega sin lazos. |
| `createChild` | ✅ | `POST .../workitems/${type}` con la relación `Hierarchy-Reverse` en el mismo patch: el hijo nace colgado, sin una segunda escritura que pueda quedar a medias. |
| `setState` | ✅ | `PATCH /fields/System.State` con el nombre nativo del `stateMap`. |
| `comment` | ✅ | `POST .../workItems/{id}/comments`, con `project` **obligatorio** en la ruta. |
| `linkUrl` | ✅ | Relación `Hyperlink`. Ver abajo por qué no es un enlace de artefacto. |
| `labels` | ✅ | `System.Tags`, que es **un** campo String con punto y coma: leer-modificar-escribir. |
| `searchAssigned` | ✅ | WIQL con `[System.AssignedTo] = @Me`. |
| `searchMentioned` | ⚠️ | WIQL con `[System.Id] IN @RecentMentions`. Capacidad **con ventana**: 30 días. Ver abajo. |
| `boardFields` | ✅ | `System.IterationPath`, `System.AreaPath` y `System.AssignedTo` son campos comunes: la herencia no cuesta un viaje aparte. |

**Configuración.** Un solo secreto: `AZURE_DEVOPS_EXT_PAT`, que es el nombre que
Microsoft documenta para pasar un PAT de forma no interactiva — usar el oficial
evita exportar la misma credencial dos veces a quien ya tenga la CLI. Todo lo
demás va por `provider.options`: `organization`, `project`, `team`, `levelMap`,
`stateMap`, y `apiVersion` / `commentApiVersion` / `baseUrl` / `childType` /
`wiql` para casos de borde. Autenticación: PAT por Basic con usuario **vacío**
(`base64(":" + PAT)`). Scopes mínimos: `vso.work` para leer, `vso.work_write`
para escribir.

El formato del PAT **no** se valida (hoy miden 84 caracteres con la firma `AZDO`
en las posiciones 76-80): un PAT de otra época, o un token de Entra ID, no
tienen por qué cumplirlo, y rechazar localmente una credencial que el gestor
aceptaría es peor que gastar un viaje para enterarse.

### El nivel sale del `levelMap`, y el mapa se puede verificar contra el gestor

Es la trampa central de este gestor: el nombre del tipo cambia por plantilla de
proceso —Agile dice `User Story`, Scrum `Product Backlog Item`, Basic `Issue`,
CMMI `Requirement`, y un proceso heredado puede decir `Ticket`—. Un despachador
que compara contra `"User Story"` anda en Agile y en Scrum **no hace nada**, sin
error y sin aviso.

Por eso hay dos fuentes, y ninguna es el nombre del tipo:

1. `provider.options.levelMap`, con entrada `default` **obligatoria**, que es lo
   que el proveedor usa en caliente. Un mapa declarado sin `default` se rechaza
   en vez de adivinar uno.
2. `verifyLevelMap(ctx)` —diagnóstico, no parte del contrato— que lee
   `GET .../work/backlogconfiguration` y compara el mapa declarado contra el
   proyecto vivo. El mapeo canónico es por **id de categoría**
   (`Microsoft.TaskCategory`, `RequirementCategory`, `FeatureCategory`,
   `EpicCategory`), que es estable; no por nombre de tipo, que no lo es, ni por
   `rank`, que tampoco: la definición dice "Taskbacklog is 0" y el ejemplo de la
   misma página muestra `rank: 1`. Devuelve además `bugsBehavior` —la respuesta
   de *ese* proyecto a si un Bug es story o task— y los niveles apagados
   (`hiddenBacklogs`: hay proyectos con el nivel epic apagado).

### `linkUrl` usa `Hyperlink` y no un enlace de artefacto

`GET /_apis/wit/artifactlinktypes` devuelve 16 tipos y **ninguno** es de GitHub;
el único de PR es `PullRequestId`, que es Azure Repos. Existe un tipo "GitHub
Pull Request", pero la doc avisa que solo sirve *"for repositories connected to
Azure Boards"*: exige la conexión Boards-GitHub y no es portable. La propia
documentación lo dice textual: *"To link work items to objects outside Azure
DevOps, use a hyperlink"*.

El proveedor además **no reescribe** un hipervínculo que ya está: Azure DevOps
rechaza una relación duplicada con un 400, y un recorrido relanzado moriría en
el paso más inocente que tiene.

### `searchMentioned` es una capacidad con ventana, no a medias

`@RecentMentions` está documentado como *"Items with an @mention for you in the
last 30 days"* y solo es válido con el campo ID y los operadores `In`/`Not In`.
Un daemon que se cae una semana no pierde nada; uno que se cae un mes sí. No
alcanza con declararla `true`: hay que saber que el disparo por mención no es
memoria infinita.

Las dos consultas WIQL devuelven **solo ids** —*"The API only returns work item
IDs, regardless of which fields you include in the SELECT statement"*—, así que
la hidratación con `workitemsbatch` no es una optimización: es el único modo de
tener título, tipo y estado. Se hidrata la **unión** de las dos consultas en un
lote, y el lote se parte en trozos de **200**, que es el máximo que declara el
propio título del endpoint.

### Cuando un 200 no es un work item

Un status 200 no garantiza que el cuerpo sea un ticket, y el proveedor distingue
tres respuestas que antes se confundían en una: **no existe** (→ `null`),
**respuesta rota** (→ lanza con la causa) y **ticket**. Las cuatro formas, todas
observables:

| Respuesta | Qué hace el proveedor |
|---|---|
| 404 con `TF401232` | `null`. "No existe" es una respuesta, no un fallo. |
| 200 con el cuerpo **vacío** | `null`. Antes llegaba a `res.json()` y salía como `SyntaxError: Unexpected end of JSON input`: un error de parseo que no nombra el método, la URL ni el status, y que el motor recibe como si el proveedor tuviera un bug. |
| 200 (o 203) con **HTML** | Lanza nombrando método, URL, status y un pedazo del cuerpo. Es la página de login que devuelve la puerta de entrada cuando la credencial no sirve y el pedido cae en la interfaz web en vez de la API. |
| 200 con JSON **sin `id`** | Lanza. `String(undefined)` producía el id `"undefined"`, un string **no vacío** que pasa el `validateItem` del contrato y se persiste en el estado del recorrido como si fuera un ticket. |

El cuerpo se lee como texto y se parsea a mano justamente para poder separar
esos casos; `res.json()` no deja. **El chequeo 4 de la suite no cubre ninguno de
los tres últimos**: solo ejercita el 404. Los cubren tests propios de este
proveedor.

**El `op: "test"` sobre `/rev` no se puede apagar solo.** Si la lectura previa a
una escritura llega sin `rev`, la operación salía como
`{op: "test", path: "/rev", value: undefined}` — y `JSON.stringify` borra las
claves `undefined`, así que el `test` viajaba **sin valor**: el control de
concurrencia optimista desaparecía y la escritura pisaba el cambio ajeno sin que
el gestor tuviera con qué contestar 409, que es el fallo silencioso que el
`op: "test"` existe para atajar, escondido dentro de la guarda misma. Ahora
`setState`, `addLabel` y `linkUrl` se niegan a escribir sin un `rev` entero y lo
dicen.

**Los criterios de aceptación son HTML en las dos direcciones.**
`Microsoft.VSTS.Common.AcceptanceCriteria` guarda HTML, e `Item.acceptance` es un
**array** en el modelo canónico: `String(["a","b"])` es `"a,b"`, así que la
escritura colapsaba los criterios en una línea con comas y el ida y vuelta perdía
la separación — lo único que un planificador puede convertir en un test. Se
aceptan array y string, se separan con `<br>` y se **escapan**: sin escapar, un
criterio que diga `a < b` se lo come el borrado de etiquetas al leerlo de vuelta,
y un `<b>` que venga en el texto queda interpretado en el tablero.

**Un id que no es entero se nombra.** `workitemsbatch` toma enteros, y
`Number("abc")` es `NaN`, que `JSON.stringify` manda como `null`: el gestor
contesta un 400 que no nombra el id culpable. Se nombra antes de salir, donde
todavía se sabe cuál era. Por la misma línea, un `relations` que no llega como
lista devuelve vacío en vez de `TypeError`, y los arcos de dependencia se
**deduplican**: el `rel` viene escrito de dos maneras, y el mismo arco contado
dos veces le hace serializar al motor una espera que no existe.

### Lo que quedó sin confirmar

Anotado en el código, junto al lugar donde importa. Resumido:

1. **`api-version` de `comment`.** La operación no tiene página 7.1 ni 7.2: las
   dos redirigen a la de 7.0, que declara obligatorio `7.0-preview.3`. Circula
   `7.1-preview.4`, sin confirmar. Se usa el único valor documentado, y el string
   vive en `provider.options.commentApiVersion` para moverlo sin tocar código.
2. **`attributes.comment` sobre una relación `Hyperlink`.** El ejemplo oficial
   "Add a hyperlink" pasa solo `rel` y `url`; el que pasa `comment` es un
   workItemLink. Si el gestor lo rechaza, se pierde el título y queda el enlace.
   Se confirma con un PATCH contra un proyecto real.
3. **Mayúsculas del `rel` de dependencia.** El catálogo dice
   `Dependency-Forward` y un ejemplo de la página Update escribe
   `Dependency-forward`. Al leer se compara en minúsculas —cuesta nada y cubre
   las dos— y al escribir se usa la forma canónica del catálogo.
4. **Nombres de tipo de enlace en WIQL.** La misma página lista
   `Dependency-Predecessor`/`-Successor` y en un ejemplo usa `-Reverse`/`-Forward`.
   Por eso `dependencies` lee `relations` en vez de consultar enlaces: no hay que
   apostar a un nombre que la doc escribe de dos maneras.
5. **El 404 de `getItem`.** La tabla de Responses documenta solo el 200. Se trata
   el 404 como "no existe" (→ `null`, que es lo que el contrato exige) y cualquier
   otro `>= 400` como fallo que lanza. Lo que **no** está confirmado es con qué
   status llega la página de login cuando el PAT no sirve: se manejan 200 y 203
   igual, porque el proveedor decide por la forma del cuerpo y no por el status.
   Ver "Cuando un 200 no es un work item".
6. **`System.Tags`: reemplaza o fusiona.** El ejemplo oficial escribe la lista
   completa. Se asume que **reemplaza** y se hace leer-modificar-escribir con el
   `test /rev`: es correcto en los dos casos, y lo contrario borra etiquetas
   ajenas.
7. **`createChild` con el padre en el mismo POST.** El único ejemplo de la página
   Create pone solo el título. La forma se compuso del ejemplo de Update más el
   `referenceName` del catálogo. Plan B: dos llamadas, con el riesgo de dejar un
   hijo huérfano si la segunda no entra — que es lo que el POST único evita.
8. **`fields` junto con `$expand` en `workitemsbatch`.** El ejemplo documentado
   pasa los dos, pero con `fields` la respuesta no trae `_links`, y sin
   `_links.html.href` el hijo se queda sin URL humana. Se pide `$expand: "all"`
   sin `fields`; si un día hay que recortar el payload, se acepta que la URL del
   hijo sea la de la API.
9. **Límites de tasa.** No se verificó la política ni las cabeceras que la
   anuncian (`Retry-After`, `X-RateLimit-*`). Los reintentos viven en `ctx.fetch`
   por contrato, así que el proveedor no tiene que resolverlo; el presupuesto por
   organización queda sin afirmar.

### Dos correcciones a lo que el repo daba por sabido

- La nota interna decía "Dependency-Forward/Reverse (Predecessor/Successor)" y
  **el par va al revés**: Forward es *Successor* y Reverse es *Predecessor*,
  confirmado en `workitemrelationtypes` con `isForward` y
  `oppositeEndReferenceName`. Escrito en el orden equivocado, `dependencies`
  devuelve el DAG invertido y el motor serializa al revés **sin que nada falle**:
  exactamente la clase de fallo silencioso que el contrato existe para atajar.
  Hay un test que lo fija, y se verificó que ese test falla si se invierte el par.
- Los estados que el repo citaba como "Active/Resolved" de Agile no están en la
  misma categoría: `Resolved` es categoría *Resolved* solo para Bug, y para User
  Story y Feature está mapeado a *InProgress*. Y Basic no tiene **ningún** estado
  en la categoría Resolved, que es el caso que justifica `in_review: null` en el
  `stateMap` como situación normal y no como excepción. Un estado nativo que el
  mapa no declara devuelve `canonicalState: null` y no `"todo"`: un item en
  `Removed` reportado como `todo` es un item que el motor vuelve a despachar.

---

## Linear — `providers/linear/`

Nueve capacidades en `true` y una en `false`. La API es GraphQL y tiene **una
sola ruta**: `POST https://api.linear.app/graphql` con `{query, variables}`. No
hay endpoint por operación, así que lo único que cambia entre leer un ticket y
mover un estado es el documento que se manda.

| Capacidad | | Cómo |
|---|---|---|
| `children` | ✅ | `issue(id:){ children(first: 50, after:) }`, una `IssueConnection` paginada. |
| `dependencies` | ✅ | `IssueRelation` con el enum `blocks`, en las dos direcciones: `relations` + `inverseRelations` en el mismo viaje. |
| `createChild` | ✅ | `issueCreate(input: { teamId, parentId, ... })`. `teamId` es obligatorio y `parentId` **no** lo implica. |
| `setState` | ✅ | `issueUpdate(id:, input: { stateId })`, con `stateId` resuelto por equipo. |
| `comment` | ✅ | `commentCreate(input: { issueId, body })`, body markdown. |
| `linkUrl` | ✅ | `attachmentLinkGitHubPR` para un PR, `attachmentLinkURL` para el resto. |
| `labels` | ✅ | `issueAddLabel(id:, labelId:)`, que **suma**. |
| `searchAssigned` | ✅ | `notifications(first: 50)`, cortado por `category == "assignments"`. |
| `searchMentioned` | ❌ | Alcanzable, pero arranca en `false`. Ver abajo. |
| `boardFields` | ✅ | `cycleId`, `projectId`, `projectMilestoneId`, `assigneeId`, `estimate`: `IssueCreateInput` los acepta al crear el hijo. |

**Configuración.** Un solo secreto: `LINEAR_API_KEY`, que va en el header
`Authorization` **tal cual, sin `Bearer`** — el prefijo es solo para access
tokens de OAuth 2, y con una API key personal devuelve 401; el síntoma se lee
como "credencial mala" cuando la credencial está bien. El nombre de la variable
es convención nuestra: Linear documenta el header, no una variable de entorno.
Todo lo demás va por `provider.options`: `stateMap`, `levelMap`, y los
opcionales `teamKey` / `teamId` (ahorran un viaje en `setState` y `createChild`)
y `acceptanceHeading`.

### El "tipo" de un issue de Linear es una etiqueta, y eso hubo que decidirlo

Linear **no tiene modelo de tipos de issue**. En el esquema publicado, `type
Issue` no expone ningún campo de tipo (tiene `state`, `labels`, `estimate`,
`priority`, `parent`, `project` — nada parecido a `issueType`), no hay query
`issueTypes`, y la única aparición de `issueTypeId` en el esquema está dentro de
`ExternalEntityInfoJiraMetadata`, o sea metadata de un Jira importado. La
jerarquía de producto es Initiative > Project > (Milestone) > Issue > sub-issue,
y ni Initiative ni Project son issues.

Entonces el nivel podía salir de dos lugares, y la elección no es cosmética:

1. **del nombre de etiqueta** (`issue.labels.nodes[].name`), traducido por el
   `levelMap` con entrada `default` explícita — `{ Epic, Feature, Story, Task,
   default: "story" }`;
2. de la **estructura** (`parent == null` → epic, `parent != null` → task).

Se eligió la primera. La segunda es la misma deducción que el contrato prohíbe,
con otro disfraz: un sub-issue de un sub-issue queda `task` por accidente, y un
issue suelto que es una historia pasa a `epic` sin que nadie lo haya declarado.
Hay un test que lo fija con un issue etiquetado `Epic` **y** con padre: sigue
siendo `epic`.

Consecuencia de alcance, que es correcta y no una falla: un workspace que no
etiquete sus issues solo produce items de nivel `story`/`task`, porque las
épicas y features de Linear viven normalmente como Initiative/Project. Y
`children: true` cubre parent/sub-issue: un hito que sea un Project queda fuera
del modelo `Item` salvo que se decida mapear `project(id:)`, que es decisión de
diseño y no un límite de la API.

Por el mismo motivo, `createChild` le pone al hijo la etiqueta que el `levelMap`
traduce a `task`, si el workspace la tiene: sin etiqueta, el hijo vuelve del
gestor con el nivel por defecto (`story`) y el tablero miente sobre lo que es.
Si esa etiqueta no existe, se anota en la bitácora y se sigue — no es un fallo.

### Los estados son por equipo, y el `stateMap` guarda el nombre

`IssueUpdateInput.stateId` es un **UUID de workflow state por equipo**, no un
nombre. El `stateMap` guarda el nombre destino —dos equipos del mismo workspace
pueden tener plantillas distintas— y el proveedor lo resuelve con
`workflowStates(filter: { team: { key: { eq } }, name: { eq } })` contra el
equipo del issue. Cachear el UUID de un equipo y aplicarlo a otro es el fallo
que esto evita; mandar el nombre en `stateId` es un input inválido.

El mapa es total y con los nulos declarados:

```json
{ "todo": "Todo", "in_progress": "In Progress", "blocked": null, "in_review": null, "done": null }
```

`blocked: null` no es pereza: Linear no tiene un estado "Blocked" en ninguna
plantilla — las categorías son Backlog/Unstarted/Started/Completed/Canceled más
el `Duplicate` reservado del sistema. `in_review: null` salvo que el equipo haya
creado un "In Review" a mano (el set por defecto de un equipo nuevo es
"Backlog > Todo > In Progress > Done > Canceled"). `done: null` porque el motor
nunca pide `done`. Un canónico en `null` devuelve
`{written: null, skipped: <canónico>}` **sin gastar un viaje**: el mapa ya dijo
que ese estado no existe.

Si el mapa promete un nombre que la plantilla del equipo no tiene, `setState`
**lanza** y dice qué nombre y qué equipo. Es un error de configuración, y
callarlo deja el tablero quieto sin que nadie se entere de por qué.

Al **leer**, el estado canónico sale primero de la búsqueda inversa en el
`stateMap` por `state.name`; si el nombre no está en el mapa, cae en
`state.type`, que es un enum documentado del gestor y no un nombre configurable:
`triage`/`backlog`/`unstarted` → `todo`, `started` → `in_progress`, `completed`
→ `done`, y `canceled`/`duplicate` → `null`. Es el único lugar donde mirar un
valor nativo es legítimo, porque `type` es del gestor y `name` es del equipo.

### "No existe" no se lee del texto de un error

`issue(id: String!): Issue!` **no es nulable**: un id inexistente devuelve
`errors[]`, nunca `null`. Devolver `null` desde ahí obligaría a leer el texto del
error —que no está documentado y que distingue mal "no existe" de "no tengo
permiso"—. Por eso `getItem` pregunta por filtro y mira la forma, no la prosa:

- UUID → `issues(filter: { id: { eq } }, first: 1)`;
- identificador humano → `issues(filter: { team: { key: { eq } }, number: { eq } }, first: 1)`,
  porque `IssueFilter.id` es un `IssueIDComparator` con `eq: ID`, o sea **solo
  UUID**: filtrar `"ENG-123"` por id no devuelve nada y el ticket parece no
  existir.

`nodes: []` significa que no existe. Un id que no es ni UUID ni identificador
devuelve `null` **sin gastar un viaje**: no hay filtro con el que preguntarlo.

El `id` canónico es `issue.id` (UUID → string), `key` es `issue.identifier` y
`url` es `issue.url`. Hay un chequeo de la suite que verifica que el `id` sea
string: un gestor con ids numéricos que devuelva números rompe toda comparación
contra el estado persistido en disco.

### Un error puede llegar con HTTP 200

`ctx.fetch` es del motor y reintenta 429 y 5xx mirando el status. No alcanza
acá, y por eso la inspección del cuerpo vive en el proveedor:

- un error de GraphQL llega con **HTTP 200** y `errors[]` en el cuerpo; un
  cliente que confía en el status lo toma como éxito y sigue con `data: null`,
  y el fallo aparece tres pasos después como "no se pudo leer una propiedad de
  null";
- el límite de tasa llega como **HTTP 400** con `errors[].code ==
  "RATELIMITED"`, que `ctx.fetch` **no** reintenta.

El mensaje que se propaga es el textual del gestor, en este orden:
`extensions.userPresentableMessage ?? message ?? extensions.type`. Nunca un
resumen propio: el resumen borra justo el dato que hace falta para arreglarlo.

Límites documentados, que son de `ctx.fetch` y no del proveedor: 2.500 req/hora
con API key personal y 5.000 con OAuth; complejidad 3.000.000 puntos/hora
(2.000.000 en OAuth) y máximo 10.000 por query. Para la espera:
`X-RateLimit-Requests-*` y `X-Complexity` / `X-RateLimit-Complexity-*`, con el
reset en epoch UTC en **milisegundos**. Que el 400 de `RATELIMITED` no se
reintente es una limitación conocida del `ctx.fetch` de hoy: el arreglo es del
motor, no de acá.

### `searchMentioned: false` es una decisión de honestidad, no un límite

Las dos señales salen del mismo viaje: `notifications(first: 50)` con
`... on IssueNotification { issue { ... } }`, cortado por `category`
(`assignments` → `assigned`, `mentions` → `mentioned`). El corte va del lado del
proveedor porque `NotificationFilter` solo expone `type: StringComparator` y
`Notification.type` es `String!` **sin valores documentados**.

`category` sí es un enum documentado, así que la mención es alcanzable — pero es
la única señal que se apoya en una pieza del inbox que no se puede verificar sin
una cuenta real, y el encargo prohíbe eso con razón: un test que necesita un
workspace no lo puede correr quien adopte el proyecto. Declararla en `true` sin
probarla sería afirmar un disparo que no probamos, así que `searchInbox`
devuelve `mentioned: []` y la capacidad dice `false`. El daemon igual arranca,
porque el motor solo se niega si las dos búsquedas están en `false`.

**Para pasarla a `true`:** contra un workspace real, mencionar al bot en un
comentario y comprobar que `notifications` trae ese nodo con
`category == "mentions"` y con `issue` poblado. Ruta alternativa confirmada, si
el inbox resulta ruidoso: `issues(filter: { assignee: { isMe: { eq: true } },
state: { type: { nin: ["completed","canceled"] } } }, first: 50)` —
`NullableUserFilter` expone `isMe: BooleanComparator`.

La bandeja se deduplica **por issue** y no por notificación: dos notificaciones
del mismo ticket son un item, y despacharlo dos veces arranca dos recorridos
sobre el mismo ticket.

### El PR va como adjunto rico, no como comentario

Para el caso exacto del encargo —un PR de GitHub— existe
`attachmentLinkGitHubPR(issueId:, url:, title:)`, que crea el adjunto del
integrador y **sincroniza el estado del PR** en el ticket. Usar el genérico
funciona pero pierde esa sincronización, y después el ticket muestra un enlace
muerto cuando el PR se cierra. Cualquier otra URL va por `attachmentLinkURL`.

`labels` usa `issueAddLabel` y no `issueUpdate(input: { labelIds })`: `labelIds`
**reemplaza** las etiquetas del issue entero, y una etiqueta de progreso no
puede borrar las que puso el equipo. (`addedLabelIds`/`removedLabelIds` de
`issueUpdate` también suman, si algún día conviene hacerlo en una sola
mutación.)

### Los criterios de aceptación no tienen campo

Como en GitHub: Linear no tiene un campo de criterios, así que salen de la
**descripción markdown**. Se toman las viñetas que están bajo el encabezado de
criterios (`## Criterios de aceptación` / `## Acceptance criteria`, o el que
diga `options.acceptanceHeading`) y se corta en el encabezado siguiente — sin
ese corte, las "Notas" entran como criterios y el planificador arma tareas para
verificar una nota. Si no hay encabezado, se toman solo las casillas
(`- [ ] ...`). Si no hay ninguna, la lista vuelve vacía y el motor pregunta: un
criterio inventado es peor que una pregunta.

`createChild` escribe los criterios del hijo con ese mismo formato, así que el
sub-issue vuelve del gestor con sus criterios leíbles y el recorrido es
retomable desde el tablero y no solo desde el estado en disco.

### Cuando el gestor no devuelve lo que promete

Ocho fallos que encontró la revisión escéptica sondeando el proveedor con
cuerpos que el esquema de Linear dice que no pueden llegar —y que llegan igual
cuando en el medio hay un proxy, una caché o una versión nueva del esquema—; los
dos primeros y el último no necesitan ninguna respuesta rara. Cada uno tiene su
test:

1. **Una etiqueta llamada `constructor`.** El nivel se buscaba con
   `mapa[nombre]`, así que una etiqueta llamada `constructor`, `toString`,
   `valueOf` o `hasOwnProperty` devolvía una función **heredada del prototipo de
   `Object`** y el `Item` volvía con `level: [Function]`; con `__proto__` volvía
   `{}`. El motor descartaba un ticket perfectamente válido por "level inválido"
   sin decir de dónde salía. Los nombres de etiqueta en Linear son texto libre y
   en un repo de JS nadie lo piensa dos veces: ahora la clave tiene que ser
   **propia** (`Object.hasOwn`). No hace falta ninguna respuesta rara para
   provocarlo: alcanza una etiqueta.
2. **Un `levelMap` con un valor que no es un nivel canónico.** `{"Bug":
   "defecto"}` —un tipeo en la configuración— pasaba tal cual al `Item`. Ahora el
   valor se valida contra el enum `LEVELS`, que se **importa** del contrato en
   vez de copiarse, y se cae en el default declarado avisando por
   `ctx.log.warn`. Igual si el `default` configurado no es canónico: gana el del
   proveedor (`story`).
3. **Un `null` en la lista de hijos.** `children` reventaba con
   `TypeError: Cannot read properties of null (reading 'id')`, un mensaje que no
   nombra ni el gestor ni el ticket. Ahora, como en GitHub: lo que no trae `id`
   se saltea y se avisa. Un hijo de menos en el plan se ve; un recorrido muerto a
   mitad de camino cuesta la invocación entera.
4. **`labels.nodes` que no es una lista.** El `for...of` moría con "object is not
   iterable" desde dentro de `getItem`. Ahora se exige `Array.isArray` en los
   tres lugares que recorren una conexión (`labels`, `children`,
   `notifications`).
5. **La deduplicación de la bandeja usaba el id crudo.** Si el mismo ticket
   llegara con el id como número en una notificación y como string en otra, el
   `Map` las contaba como dos items: dos ramas y dos PR para una historia, que es
   exactamente el fallo que la deduplicación existe para evitar. La clave es el
   **id canónico** (`String(...)`), el mismo que va en el `Item`.
6. **Dos escrituras que decían "listo" sin escribir.** `addLabel` mandaba el
   string `"undefined"` como `labelId` y devolvía `{ok: true}` cuando la etiqueta
   volvía sin `id`; `setState` mandaba `stateId: undefined` y anotaba el estado
   como escrito. Las dos lanzan ahora, y `createChild` ya no arma
   `labelIds: ["undefined"]` —un input inválido que tiraría abajo la creación del
   ticket entero por un adorno—.
7. **Un `acceptanceHeading` que no compila.** `"criterios("` en la configuración
   salía como `SyntaxError: Invalid regular expression` desde `getItem`, sin
   nombrar la opción ni el proveedor: parecía un bug del motor. Ahora lanza
   citando `options.acceptanceHeading` y el valor.
8. **El mismo choque con el prototipo, una línea más abajo.**
   `TIPOS_DE_ESTADO[state.type]` con un `type` llamado `constructor` devolvía una
   función, y `?? null` no la atrapa —una función no es nullish—, así que el
   `Item` volvía con `canonicalState: [Function]`. Acá hace falta que Linear
   agregue o renombre un valor de su enum, no alcanza con que alguien escriba
   una etiqueta; el guard (`Object.hasOwn`) cuesta una línea y el fallo cuesta el
   recorrido.

**El hueco que queda declarado.** Un issue que llegue sin `url` (o con
`url: null`) produce un `Item` que `validateItem` rechaza con "url: tiene que
ser un string no vacío". El proveedor **no** revienta y el mensaje es exacto,
pero el `Item` no sirve. No se rellena con una URL armada a mano a propósito:
`Issue.url` es `String!` en el esquema, así que si falta es que la respuesta está
rota, y fabricar `https://linear.app/<algo>/issue/ENG-123` necesita el slug del
workspace —que el proveedor no tiene, y que inventar sería peor que el hueco—.

### Sobre el camino degradado de `dependencies`

Declarar `dependencies: false` acá para recuperar el escenario degradado **sería
mentir**: `IssueRelation` con el enum `blocks` más el par
`relations`/`inverseRelations` da predecesores y sucesores sin deducir nada. Los
tipos `related`, `similar` y `duplicate` se dejan afuera a propósito: no afirman
precedencia, y tratarlos como dependencia serializa trabajo que el gestor nunca
ordenó.

Y el falso tampoco lo cubre —también declara `dependencies: true`—, así que hoy
**ningún proveedor incluido recorre ese camino**: queda un segundo juego de
fixtures con capacidades reducidas, que es decisión del motor.

### Los fixtures, y por qué están en un archivo aparte

`providers/linear/fixtures.mjs` tiene las respuestas **grabadas** —cuerpos tal
como los devuelve `api.linear.app`, con UUID de mentira— y el `ctx` falso que
las sirve. A diferencia del proveedor falso, que mete sus fixtures en
`index.mjs` porque no hace red, acá son un servidor grabado: dejarlas en
`index.mjs` haría que el módulo de producción cargue datos de prueba en cada
arranque del motor. `index.mjs` **no** importa `fixtures.mjs`; el test importa
los dos, y la suite se invoca como `contractChecks(linear, fixtures)`.

El `ctx` falso también verifica lo que es fácil de romper sin que nada falle: que
todo vaya al mismo POST, y que el header `Authorization` lleve la key **sin**
`Bearer`.

Las respuestas que Linear **no puede** devolver —un `null` en una lista, una
conexión sin `nodes`, un id numérico— no están acá: viven en el test, con un
`ctx` que devuelve el cuerpo que se le diga. Este archivo son respuestas
grabadas, y mezclarlas con cuerpos imposibles haría dudar de las dos.

**La suite corre dos veces, con dos `defaultLevel` distintos.** No es
redundancia. Con un solo `defaultLevel: "story"` —el nivel al que mapea la
etiqueta `Story`, la de la mayoría de los issues grabados— el chequeo 6 lo
aprueba también un proveedor que devuelva `level: "story"` fijo y que no mire el
mapa de tipos: se comprobó con un impostor de quince líneas, que pasaba los ocho
chequeos con estos fixtures. Es exactamente el fallo que el chequeo 6 existe
para detectar, y el aviso ya estaba escrito en el paso 4 de
[`providers/README.md`](../providers/README.md). La segunda corrida declara
`default: "task"` en el `levelMap`, y un nivel fijo no puede pasar las dos.

### Lo que quedó sin confirmar

Anotado en el código, junto al lugar donde importa. Resumido:

1. **Los valores literales de `Notification.type`** (los típicos
   `issueMention` / `issueCommentMention`). El esquema lo declara `String!` sin
   enumerar, la página de webhooks no los lista y `NotificationFilter` no expone
   `category`. Es el motivo de `searchMentioned: false` y del corte por
   `category` del lado del proveedor. Se confirma con una cuenta real.
2. **El cuerpo exacto del error de un issue inexistente.** El mapa de errores
   del SDK no tiene un tipo "not found"; lo más probable es que llegue como
   `invalid input` con un `userPresentableMessage` tipo "Entity not found". Por
   eso `getItem` no depende del texto y pregunta por filtro.
3. **La fecha del esquema.** Lo leído es `packages/sdk/src/schema.graphql` de la
   rama master del repo oficial `linear/linear`, no una introspección de la API
   en vivo (no se usaron credenciales). Endpoint, autenticación, adjuntos,
   límites de tasa y estados se cruzaron contra la documentación; la fecha del
   snapshot no se puede fijar.
4. **`LINEAR_API_KEY` es convención**, no contrato del gestor: Linear no
   documenta un nombre de variable de entorno.
5. **Idempotencia de los adjuntos.** `attachmentCreate` documenta que actualiza
   en vez de duplicar si se repiten `url` e `issueId`; esa garantía no está
   escrita para `attachmentLinkURL` ni para `attachmentLinkGitHubPR`. Si un
   reintento duplicara el adjunto, el arreglo es pasar el genérico por
   `attachmentCreate`. Se confirma adjuntando dos veces la misma URL y contando.
6. **Si los `issueId` de los inputs aceptan el identificador humano.** El
   argumento `id` de las mutaciones lo acepta ("Can be a UUID or issue
   identifier"); para `CommentCreateInput.issueId` y los `issueId` de adjuntos no
   lo encontré documentado. No nos toca: el motor pasa siempre `item.id`, que es
   el UUID.
7. **Etiquetas homónimas en dos equipos.** `addLabel` resuelve por nombre con
   `issueLabels(filter: { name: { eq } }, first: 1)`; `IssueLabelFilter` también
   expone `team`, así que un workspace con dos etiquetas del mismo nombre en
   equipos distintos podría resolver la del equipo equivocado. Acotarlo cuesta un
   viaje extra para leer el equipo del issue. El síntoma es visible —la etiqueta
   se agrega y no se ve en el tablero del equipo—, así que se acota cuando
   aparezca.
