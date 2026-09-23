# Adoptar noxloop

Para quien no escribió esto y tiene que decidir si lo corre en su organización.

El objetivo de este documento es uno y concreto: **de una máquina limpia al
primer ticket cerrado**, sin leer el código del motor y sin preguntarle nada a
quien lo escribió. Si en algún paso hay que hacer cualquiera de esas dos cosas,
el documento está roto y eso es un bug de este archivo.

"Ticket cerrado" acá significa **pull request abierto**. noxloop no mergea, no
despliega y no cierra el ticket: ahí termina, a propósito, y el
[principio IV](../.specify/memory/constitution.md) lo fuerza con un hook. Si lo
que buscás es algo que mergee solo, este proyecto no es eso y no tiene una
bandera para volverlo eso.

El [README](../README.md) dice qué es y por qué. Este documento continúa desde
ahí y no lo repite. Tres vecinos que tampoco repite, y a los que conviene ir
cuando una decisión de acá parezca arbitraria:

- [`docs/PARALLELISM.md`](PARALLELISM.md) — el DAG, la cola de integración y el
  fallo medido que las dos evitan.
- [`docs/AUTONOMY.md`](AUTONOMY.md) — dónde termina la autonomía, cómo está
  forzado, y qué huecos siguen abiertos.
- [`docs/MIGRATING.md`](MIGRATING.md) — si ya tenés un harness atado a un
  gestor, empezá por ahí y volvé acá para la configuración.

---

## 1. Requisitos reales

| Qué | Versión | Por qué, y qué pasa si falta |
|---|---|---|
| **Node** | ≥ 20 | Está en `engines` y en `.nvmrc`; CI corre 20 y 22. Por debajo, `node --test` y el runner de tests no se comportan igual. |
| **git** | ≥ 2.30 | El aislamiento es `git worktree` y la integración es rebase + fast-forward. Sin git el motor no arranca, y `doctor` lo reporta como problema. |
| **git con identidad** | `user.name` y `user.email` | El motor **commitea**: dos commits por tarea. Sin identidad configurada, `git commit` falla dentro de la tarea y el fallo aparece a mitad del recorrido, no al arrancar. `doctor` no lo comprueba. |
| **CLI del forge** | `gh` (o el que declares en `forge.cli`) | Es quien abre el PR. Tiene que estar en el PATH **y autenticado** (`gh auth status`): `doctor` comprueba que el binario exista, no que tenga sesión. |
| **Claude Code, con el plugin instalado** | — | El motor invoca fases mandando `/noxloop-plan` y `/noxloop-task`, que son **comandos del plugin**. Sin el plugin, la sesión recibe un comando que no existe y la fase termina sin hacer nada. Ver abajo. |
| **`@anthropic-ai/claude-agent-sdk`** | opcional | Es `optionalDependency` del motor. El motor **retoma** la sesión entre las fases de una tarea por los dos caminos. Sin el SDK degrada a invocar el CLI `claude`, y lo declara (`via: "cli"`); lo que se pierde ahí es el seguimiento en vivo, no la sesión. Ver abajo. |

### Por qué el SDK es opcional, y qué se pierde sin él

Para que alguien que clona el repositorio pueda correr algo antes de instalar
nada.

Qué se pierde, exactamente, y conviene ser preciso porque es poco: **el
seguimiento en vivo**. Por el camino del CLI cada fase es un proceso aparte
(`claude -p`, una espera, y el JSON del final), así que la bitácora no tiene una
línea por herramienta usada: llega el resultado o no llega. Lo que **no** se
pierde es la sesión — el motor pasa `--resume <id>` también por este camino y
guarda el id de sesión de la tarea, igual que con el SDK.

Lo que sí está medido, y es lo que motivó retomar la sesión entre fases, es el
harness anterior a este, que abría una sesión nueva en cada una: 133
invocaciones, 14,5 min y $5,59 de media por invocación, cada fase reconstruyendo
desde cero el prompt de sistema, las skills, los agentes y el esquema de
herramientas. Con 14,5 min entre invocaciones, el caché de prompt —cuyo TTL por
defecto es de 5 minutos— nunca llega a servir.

`doctor` reporta la ausencia del SDK como **aviso**, nunca como problema: el
motor arranca igual.

### El plugin: cómo se instala, y qué no depende de él

```
/plugin marketplace add <tu-usuario>/noxloop
/plugin install noxloop
```

Lo que **sí** depende del plugin: los comandos que el motor manda en cada fase
(`/noxloop-plan`, `/noxloop-task`) y los agentes y skills que usan.

Lo que **no**: las guardas. Los hooks que fuerzan el orden test-primero y el
límite de autonomía los entrega el propio motor en la invocación
(`--settings` en el CLI, `options.settings` en el SDK), y está verificado en una
sesión real —dentro de un subagente y en una sesión retomada— **con el plugin
sin instalar**. El motor se niega a lanzar una sesión si no puede armarlas: una
sesión sin guardas se saltea el paso RED y el límite del PR, las dos cosas en
silencio, y eso es peor que no correr.

`doctor` no comprueba que el plugin esté instalado ni que `claude` esté en el
PATH. Si `plan` termina sin plan, ese es el primer lugar donde mirar (§7).

### Dejar `noxloop` invocable

El paquete no está publicado: `npx noxloop` funciona **dentro del clon** y
falla con un 404 del registro fuera de él.

```bash
git clone https://github.com/<tu-usuario>/noxloop && cd noxloop
npm install                      # solo dependencias de desarrollo
export PATH="$PWD/node_modules/.bin:$PATH"
noxloop version
```

Dejalo en el PATH del shell donde vas a correr los recorridos, y no solo en el
de la terminal actual: el comando de fase del plugin arranca leyendo
`noxloop status <item>` desde el worktree de la tarea, así que ahí también tiene
que resolver. Ojo con lo que dice §6 sobre el shell de una tarea: hoy eso no
alcanza.

---

## 2. La configuración

El archivo es `noxloop.config.json` y se busca **en el directorio desde el que
corrés `noxloop`**, o donde diga `--config <ruta>`. Es el único lugar donde
viven nombres propios: el motor no contiene ninguno, y hay un test que lo
verifica.

```bash
cp examples/noxloop.config.json ./noxloop.config.json
$EDITOR ./noxloop.config.json
```

El ejemplo **no queda usable recién copiado**, y son dos cosas, no una. Las dos
las reporta `doctor` como problema, así que no hay forma de descubrirlas a mitad
de un recorrido — pero conviene saber que vienen.

> **1. Las dos rutas relativas.** `$schema` y `provider.module` son rutas
> **relativas al archivo de configuración** (`../providers/fake/index.mjs`),
> escritas para cuando el archivo vive en `examples/`. Copiado a otro directorio
> apuntan a un lugar que no existe, y `doctor` responde `no se pudo cargar el
> proveedor desde ...`. Reescribilas: desde la raíz del clon,
> `./providers/fake/index.mjs` y
> `./packages/engine/schemas/config.schema.json`; desde cualquier otro lado, la
> ruta absoluta.

> **2. El repositorio de trabajo, que es tuyo y no del ejemplo.** El bloque
> `repos.app` del ejemplo declara `path: "~/proyects/app"` y
> `remote: "git@github.com:mi-org/app.git"`, que son un nombre propio puesto ahí
> para que se vea la forma. En una máquina limpia no existen, y `doctor`
> responde `repositorio "app": no se encontro un checkout valido de "app"`.
>
> Cambialos por un repositorio tuyo: `path` al checkout local y `remote` al
> remote que ese checkout **de verdad** tiene. `doctor` compara
> `git remote get-url origin` contra lo declarado y no acepta un directorio
> porque se llame igual (§4), así que si los dos no coinciden vas a seguir sin
> arrancar. Para el primer recorrido alcanza un repositorio desechable; la
> receta exacta está en §5.1.

### Bloque por bloque

| Bloque | Qué decide | Notas |
|---|---|---|
| `version` | La versión del formato. Hoy `1`. | El esquema rechaza cualquier otra. |
| `home` | Dónde vive el estado. Por defecto `~/.noxloop`. | Fuera de los repos a propósito: un ticket puede abarcar varios, y los hooks que corren dentro de uno tienen que ver la misma tarea activa que los de otro. `NOXLOOP_HOME` gana sobre este campo. |
| `provider.name` / `.module` | Qué gestor de tickets hay del otro lado. `module` es una ruta o especificador de módulo, y **puede vivir fuera de este repositorio**. | El motor no conoce ningún gestor por nombre: carga el módulo y le pregunta `capabilities()`. |
| `provider.options` | Lo que ese gestor necesita para ubicarse: organización, proyecto, `owner`/`repo`, equipo. | Es un objeto libre: el esquema no lo describe, así que un error de nombre acá no lo atrapa `validate` — lo atrapa el proveedor al primer uso. §3. |
| `provider.stateMap` | Estado canónico → estado nativo, para los cinco canónicos. | Total y obligatorio en sus cinco claves. `null` es una respuesta válida y significa "este proyecto no tiene ese estado, no lo escribas". |
| `provider.levelMap` | Tipo nativo → nivel canónico (`epic`, `feature`, `story`, `task`), con `default` **obligatorio**. | El nivel nunca se deduce comparando el nombre del tipo: un gestor llama "Product Backlog Item" a lo que otro llama "User Story", y comparar nombres funciona en un proyecto y calla en otro. |
| `forge.kind` / `.cli` | Dónde viven el código y los PRs (`github`, `azure-repos`, `gitlab`) y con qué binario se hablan. | Puede ser distinto del gestor de tickets, y es lo normal. |
| `identity.assignee` / `.mention` | Cómo se reconoce a noxloop en el gestor, para el disparo automático. | `assignee` llega al contexto del proveedor y lo usa quien pueda: Azure DevOps lo mete en su WIQL, GitHub y Linear **no pueden** —sus consultas son del dueño del token— y lo declaran con `identityAssignee: false`, así que la bandeja lo avisa nombrando el responsable que ignora en vez de quedarse muda. `mention` no lo usa ningún proveedor todavía: las menciones salen del token en los tres. Y si tu proveedor no declara `searchAssigned` ni `searchMentioned`, la bandeja no encuentra nada y `doctor` lo avisa: los tickets se lanzan a mano. |
| `repos.<clave>` | Un repositorio de trabajo. La clave es como lo nombran las tareas del plan, **y también como se lo busca en disco** si no declarás `path` (§4). | `path` (checkout local; si falta se prueba `<dir de --search>/<clave>` y **siempre** se verifica contra el remote), `remote`, `baseBranch`, `gate`, `fastGate`, `runners`, `env`, `gaps`, `timeoutMs`. |
| `limits` | El ancho y los cortes: `maxParallelTasks`, `stallRounds`, `phaseTimeoutMin`, y los que consumen los recorridos de hito y de bandeja. | No hay techo por invocación, a propósito: el techo por invocación se midió como amputación —13 de 71 invocaciones aterrizaron entre $7,50 y $7,99 contra un techo de $8, se registraron como `exit 0`, y el trabajo cortado volvió como reintento más caro que lo ahorrado. |
| `budgets` | Intentos por bucle y por tarea: `red`, `green`, `gate`, `review`. | Son **por bucle**: agotar GREEN no consume GATE. Agotado cualquiera, la tarea se bloquea. Retomar no los devuelve. |
| `tiers` | Qué abarata cada tier: `model`, `effort`, `gate` (`fast`/`full`), `review`, `fanout`. | El paso RED no figura porque no es configurable. Un tier con `review: false` deja constancia en la tarea y se reporta en el PR. |

### Las tres que conviene no dejar por defecto

`repos.<x>.gate`, `repos.<x>.gaps` y `repos.<x>.runners`. El motivo de cada una
está en [`examples/README.md`](../examples/README.md) y no se repite acá. Lo que
agrega este documento es cómo se comporta el motor si las dejás así:

- **`gate` es obligatorio** por esquema: un repositorio sin él no valida. Y si
  el objeto llegara igual sin `gate`, el ejecutor de verificación lanza un error
  de configuración en vez de producir un verde vacío.
- **`fastGate` ausente** no inventa una versión corta: el gate rápido **cae al
  completo**. Eso significa que el rechequeo después del rebase corre el gate
  entero, para cada tarea que entra a la cola.
- **`gaps` vacío** es un aviso de `doctor` en cada arranque, y con razón: la
  versión anterior de este harness produjo una configuración que mentía —un
  campo de carencias vacío que el reporte del PR leía como "este gate no tiene
  huecos"— y el fallo apareció a mitad de un recorrido.
- **`runners` vacío** no rompe el arranque pero rompe el bucle: el veredicto de
  RED/GREEN se saca de correr **un** test suelto, y sin runner declarado el
  motor lanza `el repositorio "<x>" no declara un runner para correr un test
  suelto`. Declaralo antes del primer `run`.

### Variables de entorno en la configuración

`repos` y `provider.options` admiten `${VAR}` y `${VAR:-default}`. Una variable
sin valor **y sin default** hace fallar la carga con el nombre de la variable,
en vez de resolverse a cadena vacía: un gate que corre con la cadena de conexión
vacía falla con un error que no se lee como lo que es —se lee como tests rotos.

---

## 3. Elegir el gestor de tickets

| Gestor | `provider.module` | Credencial | Qué más necesita en `provider.options` |
|---|---|---|---|
| **fake** | `./providers/fake/index.mjs` | ninguna | nada. No toca la red; sus tickets viven en memoria |
| **Azure DevOps** | `./providers/azure-devops/index.mjs` | `AZURE_DEVOPS_EXT_PAT` | `organization` siempre; `project` para comentarios y consultas WIQL; `team` para los campos de tablero |
| **GitHub Issues** | `./providers/github/index.mjs` | `GITHUB_TOKEN`, y solo ese nombre: el proveedor tiene un `GH_TOKEN` de respaldo en el código, pero el motor le inyecta únicamente las variables que declara en `requiredEnv`, así que exportar `GH_TOKEN` a secas **no alcanza** y `doctor` pide `GITHUB_TOKEN` por su nombre | `owner` y `repo`. Con token fine-grained alcanza *Issues: read and write* + *Metadata: read-only*; con PAT clásico, `repo` |
| **Linear** | `./providers/linear/index.mjs` | `LINEAR_API_KEY` | `teamId` si querés fijar el equipo donde se crean los hijos; el `stateMap` guarda **nombres** de estado, que en Linear son por equipo |

La credencial va **en el entorno**, nunca en el archivo: el motor exige toda
variable que el proveedor declara en `requiredEnv` antes de arrancar, la inyecta
en el contexto del proveedor, y hay un chequeo del contrato que verifica que
ningún proveedor lea `process.env` por su cuenta.

```bash
export GITHUB_TOKEN=...      # el que corresponda a tu gestor
noxloop doctor               # reporta por nombre la que falte
```

Qué soporta cada uno, y **por qué cada `false` es un `false`**, está en
[`docs/PROVIDERS.md`](PROVIDERS.md). Para agregar el tuyo son cinco pasos y
ninguno toca el motor: [`providers/README.md`](../providers/README.md).

Una capacidad ausente no rompe el recorrido: el motor la declara y degrada. Sin
`children` no se pueden recorrer hitos, solo tickets sueltos; sin
`dependencies` el orden se serializa y queda dicho; sin `linkUrl` el PR va como
comentario; sin `setState` no se mueve ningún estado. `doctor` avisa de las
cuatro cosas antes de que te enteres a mitad de un recorrido.

---

## 4. `doctor`, y cómo se lee su salida

```bash
noxloop doctor
noxloop doctor --search ~/proyects     # para los repos sin `path` declarado
```

Sale JSON por stdout y la lectura para personas por stderr. **Exit ≠ 0 si
`ready` es `false`.**

> **`--search` no recorre nada, y el nombre engaña.** Para un repositorio con
> clave `app` prueba **exactamente** `~/proyects/app`, un candidato por
> directorio pasado, sin bajar un nivel más. Si tu checkout está en
> `~/proyects/mi-app` y la clave es `app`, no lo encuentra — declarale `path` o
> renombrá la clave. Y el CLI acepta **un solo** `--search`: el último gana.
>
> Lo que sí hace, y es el punto, es verificar: el candidato solo vale si su
> `origin` coincide con el `remote` declarado.

La única distinción que hay que entender es esta:

- **problema** (`✗`) — baja `ready` y el recorrido no arranca.
- **aviso** (`·`) — arranca igual, con menos garantías. Ningún aviso baja
  `ready`, y hay un test que lo fija.

### Los problemas, y qué hacer con cada uno

| Lo que dice | Qué hacer |
|---|---|
| `git no esta disponible en el PATH` | Instalar git. El motor no funciona sin él. |
| `el CLI del forge (\`gh\`) no esta en el PATH` | Instalarlo, o declarar el que uses en `forge.cli`. |
| `no se pudo cargar el proveedor desde "<ruta>"` | La ruta de `provider.module`. Es el error típico de copiar el ejemplo sin reescribir la ruta relativa (§2). |
| `proveedor <x>: ...` | El módulo no cumple el contrato — normalmente una capacidad en `true` sin su función. |
| `falta la variable de entorno <NOMBRE>` | Exportarla. Viene **una por variable que falta**, con su nombre: la que sí está no se reporta. |
| `repositorio "<x>": ...` | Un repositorio por línea, con su causa propia. Las tres causas reales: la ruta no existe, no es un repositorio git, o **el remote no coincide**. |

Ese último merece su párrafo. `doctor` no acepta un directorio porque se llame
como el repositorio: compara `git remote get-url origin` contra el `remote`
declarado, normalizando las formas equivalentes (`git@host:org/repo.git`,
`https://host/org/repo`). El fallo que eso evita ya ocurrió: un directorio dejó
de corresponder al repositorio que su nombre decía, y el orquestador trabajó en
el equivocado sin que nada avisara. Un repositorio **sin `path`** y sin
`--search` también es un problema, no un aviso, y la respuesta es `path: null`:
**`doctor` no adivina rutas**, porque un default razonable para la ruta de un
repositorio es cómo se trabaja en el repositorio equivocado.

### Los avisos que vas a ver, y qué significan

| Lo que dice | Qué significa |
|---|---|
| `el Claude Agent SDK no esta instalado` | Se va a invocar el CLI: un proceso por fase y sin seguimiento en vivo, con la sesión retomada igual (§1). |
| `estados canonicos sin mapear (...)` | Esos estados no se van a escribir. Que `done` no esté mapeado **es lo normal**: noxloop no cierra tickets. |
| `el stateMap declara "done", pero noxloop nunca lo escribe` | Mapearlo no impide arrancar; simplemente no se usa. Cerrar un ticket dice que está integrado, y la autonomía termina en el PR abierto. |
| `el proveedor no soporta ninguna forma de disparo automatico` | El recorrido por bandeja no va a encontrar nada; los tickets se lanzan a mano. |
| `el proveedor no sabe leer hijos` / `no soporta dependencias` | Sin hitos, o con el orden serializado y declarado. |
| `sin \`fastGate\`` / `\`gaps\` esta vacio` / `sin \`runners\`` | Las tres del §2, una por repositorio. |

Un `doctor` que dijera "configuración inválida" y nada más obligaría a adivinar.
Por eso cada carencia es una línea, con su nombre y su repositorio: se arregla
una y se vuelve a correr, en vez de descubrir la siguiente a mitad de un
recorrido.

---

## 5. El primer ticket

### 5.1 Primero sin red, sin credenciales y sin gestor

Con el proveedor falso, que no toca ninguna red. Sirve para ver que el cableado
funciona antes de poner una credencial encima.

Hace falta un repositorio de trabajo que exista, porque `doctor` no arranca sin
uno (§2, punto 2). Para este primer recorrido sirve uno desechable, y el
`remote` no tiene que ser alcanzable: `doctor` compara el texto del `origin`
contra el declarado, no habla con ningún servidor.

```bash
# un checkout desechable cuyo `origin` sea EL QUE EL EJEMPLO YA DECLARA,
# para no tener que tocar `remote`: solo se cambia `path`
mkdir -p ~/tmp/app
git init -q -b main ~/tmp/app
git -C ~/tmp/app remote add origin git@github.com:mi-org/app.git
touch ~/tmp/app/a.txt
git -C ~/tmp/app add a.txt
git -C ~/tmp/app commit -qm "checkout de prueba"

# y en noxloop.config.json: "path": "~/tmp/app"
```

Con eso:

```bash
npm test                     # la suite completa: sin red, sin credenciales, sin modelo
noxloop doctor               # ahora sí: "listo para usar", y exit 0
noxloop dispatch 2
```

Si `doctor` sigue en rojo, la línea con `✗` dice exactamente qué falta: la tabla
de arriba tiene las seis formas. Lo que **no** hay que hacer es seguir a §5.2
con `doctor` en rojo — `plan` invoca al modelo, y una invocación gastada para
descubrir que la ruta de un repositorio estaba mal es la que este comando existe
para no gastar.

`dispatch` es el comando más barato que habla con el gestor: resuelve el nivel
del ticket con el mapa de tipos y dice a qué recorrido corresponde. No invoca al
modelo y no escribe nada — y **no** necesita que `doctor` esté en verde, así que
sirve para ver que el proveedor responde incluso antes de resolver los
repositorios.

```
FAKE-2 — La primera historia
nivel: story → plan+run  (una historia se planifica y se ejecuta)
corre: noxloop plan 2  y despues  noxloop run 2
```

El gestor falso trae cuatro tickets fijos y en memoria: `1` (épica, con `2` y
`3` como hijas), `2` y `3` (historias) y `tipo-raro`, que existe para ver qué
hace el motor con un tipo que el mapa no conoce. Nada de eso persiste entre
procesos.

**Qué queda probado con estos tres comandos, y qué no.** `doctor` y `dispatch`
prueban lo de afuera: que la configuración carga, que el proveedor cumple el
contrato y responde, que los repositorios resuelven contra su remote. El
worktree, la cola de integración y el cuerpo del PR los prueba `npm test`, contra
repositorios git desechables y sin red — no este recorrido, que no llega a
crear ninguno.

Y lo que no prueba nada de esto es **la calidad del plan**: el criterio de
aceptación del ticket falso es un marcador de posición, así que lo que el modelo
devuelva en §5.2 va a ser de juguete. Sirve para ver el mecanismo, no el
resultado.

### 5.2 El plan, que es el único punto de aprobación humana

```bash
noxloop plan 2
```

Esto **sí** invoca al modelo (y por lo tanto necesita el plugin instalado y el
SDK o el CLI `claude`). Lee el ticket, verifica que tenga criterios de
aceptación **antes** de gastar una invocación, corre la fase de planificación
dentro del worktree de la rama del ticket, valida el DAG que vuelve, y para.

Sale el plan por stdout y su lectura por stderr: una línea por tarea con su
tier, su repositorio, su criterio y sus dependencias. Revisalo. Es el único
lugar donde todavía hay una persona mirando, y una suposición de esta fase se
convierte en código, PR y tickets hijos antes de que nadie la revise.

Dos cosas que conviene saber acá:

- `plan` es **idempotente**: si ya hay un recorrido para ese ticket no
  replanifica ni duplica los tickets hijos; te dice cuántas tareas tiene y que
  corras `run`.
- Si el ticket no tiene criterios verificables, no se escribe una línea de
  código: el comando termina con **la pregunta concreta** que hay que responder.
  No se rellena, porque un criterio inventado en esta fase es código y PR antes
  de que nadie lo mire.

### 5.3 La ejecución

```bash
noxloop run 2 --dry-run      # cada paso que daría, sin ejecutar ninguno ni escribir nada
noxloop run 2
```

`run` **nunca replanifica**. Si no hay plan, falla y te manda a `plan`: un
recorrido que arma su propio plan puede cambiar el alcance sin que nadie lo
apruebe.

Mientras corre, la bitácora va a stderr y **completa** a
`$NOXLOOP_HOME/noxloop.log`. Desde otra terminal:

```bash
noxloop status 2             # solo lectura, no toca el gestor: corre con la red caída
noxloop board --open         # lo mismo, pero como tablero, y se actualiza solo
```

`board` levanta un tablero en `127.0.0.1:7777` (cambiable con `--port`) que
muestra en columnas todo lo que hay: por empezar, en curso, con PR abierto,
integrado y bloqueado — y arriba, separado, **lo que te necesita**. Lee
`$NOXLOOP_HOME` y nada más; no hay base de datos, no habla con el gestor y **no
escribe una sola cosa**, así que podés abrirlo con un recorrido corriendo sin
tocarlo. Escucha solo en loopback a propósito: lo que muestra son títulos de
tickets y texto de fallos de gate, o sea tu trabajo interno.

`board` es el único comando que **no necesita configuración**: con `--home
<ruta>` mira un directorio de estado y listo. Es a propósito — el escenario para
el que existe incluye "estoy en otra máquina sin los checkouts" y "el gestor
está caído", y exigirle un proveedor y un repo declarado lo habría dejado
inservible justo ahí.

### 5.4 Y después con el gestor real

Cambian tres cosas y ninguna es el motor:

```bash
# 1. el proveedor y sus opciones, en noxloop.config.json
#    provider.name, provider.module, provider.options, y el stateMap contra los
#    estados que tu proyecto tiene DE VERDAD
# 2. la credencial, en el entorno
export GITHUB_TOKEN=...
# 3. comprobar antes de gastar
noxloop doctor && noxloop dispatch <id-del-ticket>
noxloop plan <id-del-ticket>
noxloop run <id-del-ticket>
```

Para estrenarlo, un ticket de una sola tarea en un repositorio que no sea
crítico. El primero no es para producir trabajo: es para ver el historial de
commits y el cuerpo del PR con tus propios ojos.

---

## 6. Qué esperar

**Dos commits por tarea, el del test antes del de la implementación.** Es la
promesa central del proyecto y es verificable sin leer el motor:

```bash
git log --format='%h %s' --reverse <rama>
a1b2c3d  test(app): ocultar la columna costo (T001, FAKE-2)
e4f5g6h  feat(app): ocultar la columna costo (T001, FAKE-2)
```

Un commit único por tarea, aunque sea más prolijo, borra exactamente la
evidencia que hace creíble al sistema. Y se commitean **solo los archivos
declarados** en la tarea: un `git add -A` arrastraría al PR cualquier archivo
suelto del worktree.

**Dónde queda todo.** Bajo `$NOXLOOP_HOME` (por defecto `~/.noxloop`):

```
runs/run-<item>.json        el estado del recorrido: la fuente de verdad
plans/plan-<item>.json      el plan que produjo la fase de planificación
worktrees/<repo>/item-<id>  el worktree de la rama del ticket (donde integra la cola)
worktrees/<repo>/<id>-<T>   un worktree por tarea paralela
active-tasks/<worktree>.json  cuál es la tarea activa en cada worktree: es lo
                              único que los hooks pueden leer, y por eso son
                              varios archivos y no uno
locks/                      instancia única por recorrido
noxloop.log                 la bitácora completa
```

Las ramas son `feature/<id>-<slug-del-título>` para el ticket y
`task/<id>-<tarea>` para cada tarea. El checkout principal del repositorio
**no se toca**: puede tener trabajo de una persona.

**Un PR, y nada mergeado.** El cuerpo lo arma código desde el estado, no la
prosa del modelo: los criterios de aceptación, el comando del gate con su exit
code textual y su duración, las tareas que necesitaron más de un intento, el
alcance que se amplió durante la tarea y con qué motivo, las revisiones que un
tier declaró en `false`, lo que el gate declara **no** cubrir, y las tareas
bloqueadas con su causa real. Un cuerpo escrito por el modelo tiende a contar lo
que salió bien.

`pr create` es idempotente: relanzar un recorrido no abre un segundo PR para la
misma rama.

**La integración, tarea por tarea.** Cada tarea que termina entra a una cola
serial que rebasa sobre la punta actual de la rama del ticket, **vuelve a correr
el gate** y solo entonces integra con fast-forward. El orden importa: un verde
sobre una base vieja no dice nada sobre la base en la que el código va a vivir.
Si el rebase conflictúa o el gate falla, la tarea vuelve al bucle con la causa
textual y la rama del ticket queda **exactamente como estaba**. El fallo que eso
evita está medido —catorce ramas encadenadas, y cuando las diez primeras se
integraron las tres siguientes llegaron en conflicto— y está contado entero en
[`docs/PARALLELISM.md`](PARALLELISM.md).

**El estado del ticket se mueve hacia adelante y una sola vez.** A "en curso" al
arrancar, y a "en revisión" al abrir el PR si tu proyecto tiene ese estado.
Nunca hacia atrás: relanzar un recorrido terminado no devuelve el ticket a "en
curso". `done` no se escribe nunca.

La única escritura que no obedece ese orden es **"bloqueado"**, y se escribe
cuando ninguna de las tareas llegó a terminar: ahí no hay PR que abrir, y dejar
el ticket en "en curso" diría que algo sigue avanzando. Está exceptuada de la
marca de agua a propósito, así que un recorrido que vuelve a fallar vuelve a
escribirla.

**Un recorrido con tareas bloqueadas es un éxito.** Si tres tareas cerraron y
dos se bloquearon, el PR se abre con las tres y enumera las dos con su
diagnóstico. Una bloqueada con una causa honesta vale más que un verde
inventado, que es peor que un rojo porque un rojo se arregla y un verde falso se
mergea.

### Lo que hoy hay que hacer a mano: empujar la rama

El motor **no hace `git push`** de la rama del ticket, y `gh pr create` necesita
que la rama exista en el remoto. Si no está, el paso del PR falla y el recorrido
termina en `sin PR: <lo que dijo gh>`, con las tareas integradas igual en la
rama local. La causa es la textual del forge, así que la rama que no existe en
el remoto aparece nombrada en el reporte.

Hasta que eso se resuelva, empujá la rama del ticket desde su worktree de
integración antes de que el recorrido llegue al PR —o después, y volvé a correr
`run`, que es idempotente:

```bash
git -C "$NOXLOOP_HOME/worktrees/<repo>/item-<id>" push -u origin feature/<id>-<slug>
noxloop run <id>     # el PR se abre sobre la rama que ya está en el remoto
```

Empujar la rama de un ticket está permitido y no roza el límite de autonomía: lo
que el hook bloquea es empujar a una rama protegida, borrarla, forzarla, mergear
el PR o desplegar.

### El shell de una tarea deniega por defecto, y eso se nota

Dentro de una tarea que el motor lanzó, el shell es **denegar por defecto**: se
permite lectura, `git` (con sus verbos peligrosos vigilados aparte) y los
binarios que aparecen en el `gate`, el `fastGate` y los `runners` **de ese
repositorio**. Todo lo demás se rechaza con un mensaje que nombra el comando,
lista lo permitido y dice dónde se declara. Con el ejemplo de configuración,
"lo permitido" son `npm` y `node`.

Eso es deliberado y tiene su medición detrás —está contada en
[`docs/AUTONOMY.md`](AUTONOMY.md)—, pero conviene saber qué vas a ver en la
bitácora del primer recorrido: **`noxloop` y `npx` no están en esa lista**, y el comando de
fase del plugin arranca pidiendo `noxloop status <item> --json`. Ese primer
intento se rechaza, y la sesión tiene que llegar al estado por un camino que sí
esté permitido. No es un fallo de tu configuración y no se arregla declarando
comandos en un lugar que no existe: si lo ves, es esto.

Lo que **no** conviene hacer es meter binarios en el `gate` para abrirle la
puerta a la sesión. El `gate` es el comando cuyo exit code decide si una tarea
cumple; usarlo como lista de permisos lo convierte en otra cosa.

---

## 7. Cuando algo no sale

### `doctor` dice que no está listo

Es el caso más común y el más barato: no gastaste una invocación. Cada línea con
`✗` es una carencia independiente, con su causa y su repositorio. La tabla del
§4 tiene las seis formas que puede tomar.

```bash
noxloop doctor                       # la lista entera
noxloop validate                     # solo la forma del archivo, contra el esquema
noxloop doctor --search ~/proyects    # si los repos no declaran `path`
```

`validate` es útil cuando el problema es de forma: devuelve **un problema por
campo, con su ruta**, y sale con exit ≠ 0. Si `validate` está en verde y
`doctor` no, el problema es del entorno —una ruta, un remote, una credencial— y
no del archivo.

### `plan` termina sin plan

El mensaje es `la fase de planificacion termino sin dejar el plan en
$NOXLOOP_HOME/plans/plan-<id>.json`, seguido de lo que la sesión dijo. Los tres
motivos, en orden de probabilidad:

1. **El plugin no está instalado.** El motor mandó `/noxloop-plan`, que es un
   comando del plugin, y la sesión no lo conoce. Instalalo (§1) y volvé a
   correr.
2. **No hay con qué invocar al modelo.** Sin el SDK, el motor busca `claude` en
   el PATH; si no está, la fase vuelve sin resultado. `noxloop doctor` te dice
   si el SDK está (`entorno.sdkPresente`), pero **no** comprueba el CLI: eso es
   un `which claude`.
3. **La invocación se cortó por presupuesto.** El mensaje lo distingue: `la
   planificacion se corto por presupuesto (...) antes de terminar; no es que el
   ticket no se pueda planificar`. Es otra cosa y manda a otro lugar.

Un cuarto caso que **no** es este: si el ticket no tiene criterios de
aceptación, `plan` no llega a invocar nada y termina con la pregunta concreta.
Eso no es un fallo del motor, es el ticket.

La bitácora completa de la fase está en `$NOXLOOP_HOME/noxloop.log`, una línea
por hecho con el recorrido y la tarea adelante.

### Una tarea bloqueada, o el recorrido que dejó de avanzar

```bash
noxloop status <id>
```

Es solo lectura y no toca el gestor, así que funciona con la red caída. Por cada
tarea trae el estado, el tier, los intentos consumidos por bucle, si el rojo
está verificado, el gate con su exit code y su hora, el alcance que se amplió y
**`lastFailure`**, que es la causa textual. Ahí se lee la diferencia que hace
útil el reporte: una tarea `blocked` falló; una `unreachable` nunca pudo
intentarse porque su dependencia no llegó.

Según lo que diga `lastFailure`:

- **`el gate no paso (exit N)`** con la salida real → es el gate del
  repositorio, y el arreglo va en el código o en el `gate` declarado. Corré el
  mismo comando a mano en el worktree de la tarea: es el mismo texto.
- **un archivo que la tarea no declaró** → el alcance. Se amplía con su motivo,
  y queda registrado y reportado en el PR:
  ```bash
  noxloop add-target <id> <tarea> <ruta> "por qué"
  ```
- **`presupuesto agotado`** en cualquiera de los cuatro bucles → la tarea no
  vuelve sola, y eso es deliberado: retomar no regala presupuesto. Devolverla al
  bucle exige **registrar la decisión**, que es todo el punto del comando:
  ```bash
  noxloop unstick <id> --task <tarea> --nota "qué se decidió"
  ```
  La nota no es opcional: sin ella el comando solo imprime su uso. Una tarea que
  vuelve al bucle sin que nadie diga por qué es un presupuesto regalado en
  silencio.
- **`el estado dejo de avanzar; corto el recorrido`** en la bitácora → el motor
  cortó tras `limits.stallRounds` vueltas sin cambios. Es un corte, no un
  resultado: `status` dice en qué estado quedó cada tarea.

Si en cambio el comando ni arranca y dice que **otro proceso está recorriendo el
item**, con un pid y un host: es el lock, y es a propósito. Dos recorridos sobre
el mismo ticket no producen el doble de trabajo, producen dos veces la misma
tarea. `status` muestra quién lo tiene; un lock de un proceso que ya murió se
recupera solo.

```bash
noxloop diagnose <id>    # qué quedó a medias, y qué decisión hace falta
noxloop resume <id>      # retoma desde el disco lo que quedó en vuelo
noxloop prune            # worktrees huérfanos; sin --force no descarta trabajo
```

Ese es el orden y no es casual. `diagnose` es solo lectura y dice qué decisión
hace falta; `resume` la ejecuta. Retomar es gratis porque el estado vive en
disco y el motor no tiene ningún "dónde iba" en memoria: no repite ninguna tarea
integrada, y las que quedaron a medias conservan sus intentos consumidos.

`prune` limpia lo que quedó tirado de un recorrido que murió. **Sin `--force` no
descarta nada**: un worktree con cambios sin commitear puede ser la única copia
de un trabajo, y borrarlo por prolijidad es el peor intercambio posible.

---

## Lo que todavía no está

El CLI es la fuente de verdad y lo declara al arrancar: los subcomandos que no
existen dicen **qué tarea los trae** en vez de fallar raro.

```bash
noxloop help
```

Al momento de escribir esto **no queda ningún subcomando ausente**: el recorrido
de un hito (`milestone`), la bandeja y el disparo automático (`inbox`, `daemon`)
y el destrabado por comando (`unstick`) están los cuatro, junto con `diagnose` y
`prune`. Lo que sigue valiendo es la regla que produjo esa lista: un comando que
existe a medias y falla raro es peor que uno que todavía no está.

Lo que queda abierto no es un comando, es un borde del recorrido: **nada
publica la rama del ítem**. Está en §6 y en el `CHANGELOG.md`. Los otros dos que
se declaraban acá —el error del forge que se perdía, y `run` que no ponía la
rama del ítem al día con su base— están cerrados, igual que el mensaje viejo de
`dispatch` sobre una épica: ahora manda a `noxloop milestone <id>`.

El plan de trabajo completo está en
[`specs/001-parallel-ticket-orchestrator/tasks.md`](../specs/001-parallel-ticket-orchestrator/tasks.md):
las 84 tareas que el plan previó, más 15 que no había previsto y salieron de las
dos rondas de revisión adversarial — 99 en total, cada una con su estado.
Para trabajar sobre el proyecto en vez de usarlo:
[`CONTRIBUTING.md`](../CONTRIBUTING.md).
