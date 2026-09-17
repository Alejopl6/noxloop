# La autonomía termina en el PR abierto: dónde, y cómo está forzado

Para quien va a dejar esto corriendo sobre sus repositorios sin mirar la
pantalla.

Hay tres documentos y no se solapan:

- [`README.md`](../README.md) — **el argumento** en cinco líneas.
- [`.specify/memory/constitution.md`](../.specify/memory/constitution.md) — **la
  norma**: el principio IV y la enmienda 1.1.0. Manda si algo discrepa.
- este — **el mecanismo y la historia**: qué frena cada pieza, cómo se descubrió
  que la promesa era falsa, y qué huecos siguen abiertos. La última sección es
  la que importa más: una guarda de la que no se declaran los límites se lee
  como una garantía, y una garantía falsa es peor que ninguna.

---

## Dónde termina, exactamente

noxloop **no** mergea a una rama protegida, **no** despliega, **no** hace force
push y **no** ejecuta operaciones destructivas sobre un entorno remoto. Termina
en el pull request abierto, y no por falta de capacidad: por diseño.

La doctrina completa, que es la que decide los casos dudosos:

> Un recorrido que llega a PR abierto con tres tareas bloqueadas y un
> diagnóstico honesto es un **éxito**. Uno que llega a PR mergeado sin revisión
> humana es un **incidente**, aunque el código esté bien.

Y un detalle que sorprende a quien viene de un harness conversacional: **el PR
lo abre el motor, no el modelo.** `forge.mjs` arma el cuerpo a partir del estado
del recorrido —criterios de aceptación, el exit code textual del gate, los
huecos declarados del repositorio, las ampliaciones de alcance, las tareas
bloqueadas— y una sesión de tarea que intenta `gh pr create` se rechaza. No es
un descuido: un modelo que abre su propio PR se saltea la máquina de estados y
el cuerpo deja de ser comparable entre recorridos.

---

## Cómo se descubrió que la promesa era falsa

Esta sección es la más incómoda del proyecto y es la que más vale publicar.

El límite estaba implementado como se implementa siempre: **una lista de
comandos prohibidos**. `git push --force`, `gh pr merge`, `kubectl apply`,
`terraform apply`. Los tests pasaban. La promesa estaba escrita en el README y
en la constitución.

Después se le pidió a una revisión adversarial que la rompiera, con acceso al
código de la guarda y una sola instrucción: hacer pasar un comando prohibido.
**De 57 grafías de comando prohibido, 45 sortearon la guarda.** Y no hacía falta
nada exótico; alcanzaba con una de tres familias:

| Familia | Ejemplo | Por qué pasaba |
|---|---|---|
| Un **prefijo** que ejecuta otro comando | `env git push --force origin main`, `bash -c '…'`, `command`, `sudo`, `time`, `xargs` | el primer token no era `git`, así que la lista no reconocía nada |
| Una **comilla** | `git push origin "main"`, `git "push" --force origin main`, `"git" push …` | la comparación era contra el texto, y el shell quita las comillas pero el parser no |
| Un **intérprete** | `node -e "require('child_process').execSync('git push --force origin main')"`, `python3 -c "…"` | lo prohibido viajaba dentro de un argumento |

**Una de esas formas se ejecutó contra un remoto real y le movió la rama
principal.** No fue un hallazgo en papel: fue un repositorio con su rama
principal en otro lugar.

Escribir el test de punta a punta (T035) encontró además dos bugs propios, los
dos del mismo tipo —el parser leía el argumento equivocado—:

- **`git -C /ruta push --force origin main` no se frenaba.** El hook buscaba el
  subcomando en `args[0]` y encontraba `-C`, que no es `push` ni `merge`, así
  que permitía. El flag no tiene nada de exótico: **la propia cola de
  integración de este motor invoca a git con `-C` en cada llamada.** Lo mismo
  con `-c`, `--git-dir`, `--work-tree` y `--no-pager`.
- **`git push origin HEAD:refs/heads/production` tampoco.** El argumento es un
  refspec, no un nombre de rama, y la comparación contra la lista de protegidas
  no lo reconocía. Es la forma normal de empujar a una rama en la que no estás
  parado — o sea, exactamente la forma que importa.

Y hay un fallo anterior, en la dirección opuesta, que explica por qué el hook
está escrito como está: **bloqueaba comandos legítimos que solo mencionaban la
frase prohibida** — un `echo` con una advertencia, un `grep` buscando en la
documentación. Un hook que bloquea de más deja a una persona sin poder trabajar,
y una guarda que molesta se apaga. Por eso hoy el comando se parte en segmentos
reales respetando comillas y se mira **el primer token de cada segmento**: lo
que se ejecuta, no lo que se nombra.

---

## Por qué el arreglo no fue alargar la lista

Porque alargar la lista habría producido exactamente el **verde inventado** que
prohíbe el principio II, y en su forma más difícil de ver.

Una lista de prohibidos más larga tiene dos propiedades, y la segunda es la
grave:

1. Sigue cayendo con la grafía siguiente. Lo que falló no fueron 45 entradas
   ausentes: fue el **método**. Enumerar formas de escribir algo es una carrera
   contra un espacio infinito, y el atacante elige después que vos.
2. Viene con tests que afirman que está completa. Cada grafía agregada suma un
   caso verde, la suite crece, y el proyecto queda **más confiado y igual de
   roto**. Un rojo se arregla; un verde falso se publica.

El arreglo fue cambiar **el punto de aplicación**, no el tamaño del inventario.

---

## La inversión: dentro de una tarea, el shell es denegar por defecto

Adentro de una tarea que el motor lanzó **no hay nadie del otro lado**. El
argumento que sostiene la permisividad —"un bloqueo por error deja a una persona
sin poder trabajar"— no aplica, porque no hay ninguna persona esperando. Así que
ahí la regla se da vuelta: **se permite lo que la tarea necesita y se rechaza
todo lo demás**, diciendo cómo pedirlo.

**Lo permitido lo declara el repositorio, no el hook.** `comandosPermitidos()`
lee el `gate`, el `fastGate` y los `runners` de ese repositorio en la
configuración, los parte por `&&`, `||`, `;` y `|`, y toma el primer token de
cada segmento. Un repositorio cuyo gate es
`pnpm run lint && pnpm typecheck && pnpm test`, con un runner
`node --test {file}`, habilita `pnpm` y `node`, y nada más. `curl` no está
porque el repositorio no dijo que lo necesitara.

Sobre esa lista hay dos capas y una base:

- **Capa 1 — la lista de prohibidos.** No desapareció: dejó de ser el piso y
  quedó como red. Corre primero en cada segmento, y es la única capa disponible
  cuando hay una sesión del motor pero la tarea activa no se resuelve
  (`NOXLOOP_GUARD_ALWAYS=1`, más abajo).
- **Capa 2 — la lista de permitidos, solo dentro de una tarea.** Lo que no está,
  se rechaza.

  Y una precisión que importa más que las dos capas juntas: **sin tarea activa y
  sin `NOXLOOP_GUARD_ALWAYS`, no corre ninguna de las dos.** El hook devuelve
  "permitir" antes de mirar el comando. No es que quede solo la capa 1: queda
  nada, y es deliberado — esa sesión es de una persona y no es asunto del hook.
  Es la mitad de la enmienda 1.1.0 que sigue valiendo entera, y está más abajo
  con su test.
- **La base** son los comandos de **lectura** (`cat`, `grep`, `ls`, `sed`, `jq`,
  …) más `git`. El trabajo de una tarea es mirar antes de tocar, y `git`
  necesita leer su propio diff. Ojo con la diferencia: `git` está en la base de
  permitidos pero **no** en la lista de lectores, y eso no es un detalle —
  meterlo entre los lectores haría que la capa 1 se saltee, y con ella cualquier
  `git push`.

Dos reglas más que son **sobre la forma y no sobre la grafía**, que es lo que
las hace resistentes:

- **Un prefijo que ejecuta otro comando se rechaza siempre, sin mirar qué trae
  detrás** (`env`, `sudo`, `bash`, `sh`, `command`, `exec`, `eval`, `time`,
  `xargs`, `ssh`, `timeout`, `nohup`…). Mirar lo que traen detrás es volver al
  parser que ya falló. Y no entran a la lista de permitidos **ni
  declarándolos**: `comandosPermitidos()` los filtra aunque aparezcan en un
  `gate`.
- **Un intérprete con un flag de evaluación se rechaza**: `node -e`,
  `python3 -c`, `ruby -e`, `--eval`, `--print`. Dentro de un `-e` puede vivir
  cualquier cosa, así que ninguna guarda puede revisarlo. El mismo intérprete
  corriendo un archivo de la tarea pasa sin problema.

Las comillas se quitan antes de comparar, que es lo que el shell hace y el
parser anterior no.

**El precio, declarado:** un comando desconocido se rechaza aunque sea
inofensivo. Es el intercambio correcto — un rechazo de más le cuesta a la tarea
un mensaje que le dice cómo pedirlo; un permiso de más le cuesta a alguien su
rama principal.

**La lista viaja con el puntero de tarea activa**, no se lee de la
configuración: el hook corre como proceso aparte, con `NOXLOOP_HOME` y nada más.
Sin eso tendría que adivinar qué necesita la tarea, que es cómo se vuelve una
lista de prohibidos otra vez.

---

## La enmienda 1.1.0, y qué queda del "ante la duda, permitir"

La inversión **contradice** una restricción que la constitución ya tenía, así
que no se metió de contrabando: se enmendó la constitución a **1.1.0**, con el
fallo medido delante. Una enmienda sin un fallo detrás no es una enmienda: es
una preferencia.

Lo que la enmienda hace es **acotar** el principio anterior, no borrarlo:

- **Fuera de una tarea, ante la duda un hook permite.** Los hooks corren en cada
  operación de la sesión, también cuando noxloop no está activo. Un hook que
  bloquea por un error propio —un estado ilegible, un puntero corrupto, un
  worktree que no resuelve— deja a una persona sin poder trabajar en su propio
  repositorio, y eso es peor que el problema que evitaba. Ahí sigue valiendo
  entero, y hay tests que lo fijan: sin recorrido activo,
  `git push --force origin main` **pasa**, porque esa sesión no es asunto del
  hook.
- **Dentro de una tarea, no.** No hay nadie del otro lado, así que la duda se
  resuelve al revés.

---

## El resultado medido después del cambio

Con la guarda invertida, sobre el mismo inventario de grafías que había roto la
versión anterior:

- de **28** grafías prohibidas pasan **0**;
- de **8** comandos legítimos se bloquean **0**.

Lo que sostiene eso en el tiempo son dos suites:

- `packages/engine/test/guard-inversion.test.mjs` — **26 casos**, de los cuales
  **18 son las grafías que sorteaban la versión anterior**, cada una convertida
  en test de regresión con su nombre.
- `packages/engine/test/autonomy.test.mjs` — **16 casos en cuatro bloques**.
  Es uno de los **dos** tests que el proyecto no se publica sin pasar; el otro
  es `session-settings.test.mjs`, que es el que comprueba que las guardas
  lleguen a la sesión. Los dos, porque una guarda correcta que no viaja y una
  guarda que viaja pero no decide bien fallan igual y en silencio.

---

## Las dos líneas de defensa, y por qué hacen falta las dos

El hook es la segunda. La primera es que la operación **no exista**.

**A. El motor no tiene ninguna ruta de código capaz de hacerlo.** El bloque B de
`autonomy.test.mjs` recorre `packages/engine/src/**` y `bin/**` buscando las
operaciones prohibidas, y tiene un detalle que importa: busca también la forma
en **arreglo de argumentos** —`execFileSync("git", ["push", "--force"])`,
incluso partido en varias líneas—, que es como este motor invoca a git y que
**ninguna regex de texto plano encuentra**. Los comentarios no cuentan: los
comentarios de este motor explican el fallo que cada mecanismo evita, y explicar
un force push exige escribir "force push". Y el detector se verifica contra sí
mismo (B2): si sus regexes se rompen, B1 pasaría igual, y un test que no puede
fallar es el verde inventado.

El detector tiene **una sola exención, y hay que decirla**: el directorio de los
hooks queda fuera del barrido. Es el único lugar del motor donde estas cadenas
tienen un uso legítimo —una lista de prohibidos necesita nombrar lo que
prohíbe—, y por eso el límite ahí lo sostienen los bloques A y C, que ejercitan
el hook en vez de leerlo.

Esa línea importa porque **los hooks no ven al motor**: interceptan las
herramientas de una sesión, no los `execFileSync` del proceso que la lanzó.

**B. El hook sobre el shell de la sesión.** Es la línea que cubre lo que el
modelo decida escribir, que es lo que no se puede prever leyendo el motor.

Y una tercera propiedad, que es de arquitectura y no de guarda: **el PR se abre
con el CLI del forge y no con un servidor MCP.** No es una preferencia de
estilo. Los hooks interceptan `Bash` en `PreToolUse`, y **las llamadas a
herramientas MCP no pasan por ese hook**. Un servidor MCP con una herramienta de
merge devolvería el límite del principio IV a la buena voluntad del prompt, que
es justo aquello de lo que el motor existe para no depender.

### La distinción que hace usable a la guarda

`merge-queue.mjs` ejecuta `git merge --ff-only <rama-de-tarea>` en cada
integración. Si la guarda no distinguiera eso de un merge a una rama protegida,
bloquearía **el único mecanismo que noxloop tiene para entregar** — y una guarda
que bloquea de más se apaga, y una guarda apagada no protege nada.

La diferencia no es el flag: es **el destino**. `--ff-only` hacia `main` sigue
siendo mover una rama de la que depende otra gente. El bloque C del test fija
los dos lados del par: el comando textual de la cola pasa, y el mismo verbo
hacia `main` o `origin/master` se frena.

El cierre es un recorrido completo del driver sobre un repositorio git de verdad
(bloque D): dos tareas, PR abierto, y al final la rama base **en el mismo
commit, con el mismo reflog** —el reflog y no solo el SHA, porque un reset que
deshace un merge deja el SHA igual y el reflog distinto—, ninguna rama con
nombre protegido creada, y ningún remoto contactado.

---

## Los hooks: cuál mira qué

| Hook | Evento | Sobre qué | Qué frena |
|---|---|---|---|
| `tdd-order-guard` | `PreToolUse` | `Edit`, `Write`, `MultiEdit`, `NotebookEdit` | escribir un archivo de producción de la tarea sin rojo verificado. El test siempre se puede escribir: es la salida del bloqueo |
| `task-scope-guard` | `PreToolUse` | las mismas cuatro | escribir un archivo que la tarea no declaró; y siempre, aun declarándolo, migraciones, lockfiles y artefactos generados |
| `no-prod-writes` | `PreToolUse` | `Bash` | el límite de autonomía: las dos capas de esta página |
| `state-checkpoint` | `Stop` y `SubagentStop` | el fin del turno | no frena: **avisa** una vez por ciclo si la tarea tiene trabajo sin registrar, para que quien retome mañana pueda distinguir "no empezó" de "quedó a medias" |

`SubagentStop` está ahí porque el principio IV pide que la guarda corra también
en los subprocesos que nadie está mirando.

**Los tres guardianes de `PreToolUse` se apartan cuando noxloop no está
corriendo**: sin tarea activa devuelven "permitir" y no miran nada más. El
cuarto no tiene nada que decir sin una tarea. Es la mitad de la enmienda que
sigue valiendo, y está en los tests de los tres.

Con una excepción explícita: en las sesiones que **el motor mismo lanza** viaja
`NOXLOOP_GUARD_ALWAYS=1`, y entonces la capa 1 vale aunque la tarea activa no se
resuelva. Adentro de una sesión del motor no hay una persona a la que un bloqueo
de más pueda dejar sin trabajar. Los tests son explícitos en que ese modo es
**más débil** que la inversión: sin lista de permitidos que consultar, la única
capa disponible es la lista de prohibidos.

Cada hook tiene timeout propio —10 s los de `PreToolUse`, 15 s los de `Stop`—
porque un hook sin techo cuelga el turno entero.

---

## Cómo se le entregan las guardas a una sesión headless

Esta era la **pregunta abierta 3** de `research.md`, y bloqueaba la publicación
del modo daemon. Está cerrada y medida (T080).

Los hooks llegan a una sesión por dos vías y ninguna más: el **plugin
instalado**, o la **configuración pasada en la propia invocación**. El motor no
pasaba ninguna, así que toda sesión que lanzaba en una máquina sin el plugin
corría **sin guardas**: sin `tdd-order-guard` el paso RED se saltea, y sin
`no-prod-writes` el límite del principio IV simplemente no existe. Es el peor de
los dos mundos, porque la sesión arranca igual y el recorrido parece normal.

Las formas que funcionan, medidas:

| Vía | Cómo | Quién la usa hoy |
|---|---|---|
| `--settings <archivo-o-json>` | CLI | el transporte degradado, con el JSON inline |
| `options.settings` | SDK, el mismo JSON declarativo | el transporte del Agent SDK |
| `options.hooks` | SDK, callbacks en el propio proceso | nadie: el motor no la usa |

**No existe ningún flag `--hooks`.**

Verificado **en sesiones reales y con el plugin sin instalar**; el control fue
un `grep -ril noxloop ~/.claude/plugins` vacío. La intercepción ocurre en la
sesión, **dentro de un subagente**, y en una **sesión retomada** con `--resume`
—que es lo que hace el driver entre RED y GREEN, y una guarda que existe en RED
y desaparece en GATE sería el peor caso posible—.

Tres cosas que la medición dejó y que no estaban previstas:

- **`${CLAUDE_PLUGIN_ROOT}` solo lo expande el cargador de plugins.** Por esta
  vía es texto literal: apunta a un archivo que no existe, el hook no corre, y
  la sesión sigue sin guarda. El motor resuelve rutas absolutas él mismo.
- **`command` + `args` spawnea el binario directo, sin shell.** Es preferible a
  meter la ruta dentro de `command`: los worktrees viven en rutas generadas y el
  título del ticket entra en el nombre, así que la forma con shell se rompe el
  día que un título trae un `$`.
- **En modo `-p`, un archivo de settings que no valida se ignora en silencio.**
  Lo dice el propio help, y está medido: con un bloque `hooks` mal formado la
  sesión termina con exit 0, stderr vacío, `is_error: false`, y el `git merge`
  se ejecuta de verdad. El motor no va a recibir ningún aviso.

De ahí salen dos consecuencias que están en el código:

- **`validateHookSettings` exige las cuatro guardas, cada una en su evento y con
  su matcher, y comprueba en disco que su archivo exista.** La versión anterior
  juntaba strings que terminaran en `.mjs` y contaba: decía `ok: true` con el
  hook de Bash apuntando a un archivo inexistente, con el nombre del evento mal
  escrito, con `PreToolUse` vacío y con el matcher en minúscula. En los cuatro
  casos la sesión habría arrancado sin límite de autonomía **y con una
  validación diciendo que todo estaba bien**, que es peor que no validar porque
  produce confianza (T097).
- **Sin guardas no se lanza la sesión.** `runPhase` devuelve el subtipo
  `hooks_ausentes` y no invoca nada. Correr sin guarda es peor que no correr,
  porque el paso RED se saltea y el límite deja de existir, las dos cosas en
  silencio. No hay bandera que lo apague: las guardas no son un parámetro de la
  firma.

Y dos huecos más de la misma familia, encontrados en la segunda ronda de la
revisión adversarial:

- **`NOXLOOP_HOME` no se inyectaba en la sesión.** Pero `home` es un campo de la
  configuración: quien lo declaraba en el archivo en vez de exportarlo corría
  todas sus sesiones con los hooks mirando `~/.noxloop` — cero tareas activas,
  cero guarda (T095).
- **`runSingleTest` interpolaba la ruta del test en una plantilla y corría con
  `shell: true`.** Esa ruta la escribe el planificador, que es un modelo, sobre
  un esquema que aceptaba string libre: era **el único camino donde el motor
  ejecutaba algo arbitrario por su cuenta, sin pasar por ningún hook**. Hoy va
  por argv sin shell, y el esquema del plan exige que una ruta sea una ruta
  (T096).

**Lo que quedó sin medir**, y de lo que el motor no depende: la vía `plugins` /
`--plugin-dir`, y `pluginDelivery: "initialize"` (que exige una versión del CLI
más nueva que la del PATH).

---

## Los huecos que siguen abiertos

Declarados, porque una guarda cuyos límites no se publican se lee como una
garantía.

### 1. El merge local en dos tiempos

```bash
git checkout main        # paso 1: pararse en la rama protegida
git merge task/42-T001   # paso 2: mover la rama protegida
```

**El hook no lo frena.** Cada paso pasa por su cuenta:

- `git checkout main` no es ninguno de los verbos que la capa 1 mira, y `git`
  está en la base de permitidos de la capa 2;
- `git merge task/42-T001` es indistinguible del comando que **la propia cola de
  integración ejecuta** en cada integración legítima. El hook no sabe en qué
  rama está parado el worktree: solo ve el texto del comando.

La misma familia incluye `git switch main`, `git branch -f main <sha>` y un
`git reset --hard` dentro del checkout principal. Y un caso más: **`git push`
sin refspec** empuja la rama en la que el worktree esté parado, y el hook
tampoco sabe cuál es — así que si el paso 1 funcionara, la capa 1 no lo vería
salir.

**Por qué se decidió no cerrarlo:**

- Cerrarlo en el hook exige enumerar grafías de "pararse en una rama protegida"
  —`checkout`, `switch`, `checkout -B`, `@{-1}`, un nombre que llega por
  sustitución de comando— que es **exactamente el método que ya falló en 45 de
  57 grafías**. Un inventario nuevo compraría la misma confianza falsa.
- Lo que la segunda mitad haría es indistinguible del mecanismo de integración.
  Bloquearla por precaución apaga la cola, y noxloop deja de entregar.
- El daño que queda alcanzable es **local y reversible**: mueve una rama en el
  checkout de la máquina donde corre el motor. Publicarla sigue frenado en todas
  las grafías medidas, y el motor **no tiene ninguna ruta de código propia que
  empuje nada** (el único que habla con el remoto es el CLI del forge, desde
  `forge.mjs`).
- Hay además una barrera que no es del hook sino de git: **una rama no se puede
  checkoutear en dos worktrees a la vez.** Con el layout que arma el motor —el
  checkout principal en la rama base, la rama del ítem en su propio worktree, y
  la tarea en el suyo— el paso 1 falla solo:

  ```
  $ git checkout main
  fatal: 'main' is already used by worktree at '…/repo'
  ```

  (git 2.50.1). No es una guarda: es una propiedad del layout, y **deja de valer
  si la rama base no está checkouteada en ningún otro lado.** Por eso el hueco
  se declara y no se da por cerrado.

Lo que sí está cerrado es el lado estático: el detector del bloque B trata
`checkout`/`switch` a una rama protegida **en el fuente del motor** como una
violación, porque el primer paso no tiene ningún uso legítimo dentro de una
tarea — el trabajo vive en un worktree aparte, sobre la rama de la tarea.

Lo que lo cerraría de verdad, si alguna vez hace falta, no es una lista más
larga: es que el hook consulte el estado del worktree del que viene la operación
—la rama en la que está parado— en vez de leer solo el texto del comando. Es la
misma inversión que resolvió el resto, aplicada a un dato que hoy no se
consulta.

### 2. Lo que ningún hook puede vigilar

- **Lo que pasa del otro lado de un `ssh`.** Por eso `ssh <host> <comando>` se
  corta antes de salir: no es que sea peligroso en sí, es que el hook no puede
  seguirlo.
- **Las llamadas a herramientas MCP**, que no pasan por `PreToolUse` de `Bash`.
  El motor lo evita no usando ningún servidor MCP para el forge, pero la
  propiedad sigue ahí para cualquier servidor que alguien agregue a su propia
  configuración.
- **Lo que el motor ejecuta por su cuenta.** Ningún hook lo intercepta; lo cubre
  la primera línea de defensa (que la operación no exista en el fuente), y esa
  línea la sostiene un test, no una guarda en tiempo de ejecución.

### 3. Un hueco del recorrido, no de la guarda

Hoy **ninguna ruta del motor publica la rama del ítem en el remoto** antes de
pedirle el PR al CLI del forge. Contra un forge real eso hace fallar la apertura
del PR, no que se pase del límite — el límite queda del lado seguro—, pero es un
borde del recorrido que no está cerrado y conviene saberlo antes de apuntar esto
a un remoto de verdad.

---

## Cómo se verifica

```bash
node --test packages/engine/test/autonomy.test.mjs          # los 16 casos: T035
node --test packages/engine/test/guard-inversion.test.mjs   # los 26: la inversión
node --test packages/engine/test/huecos-guarda.test.mjs     # H2 a H5
node --test packages/engine/test/hook-cli.test.mjs          # el cableado: stdin, exit 2, stderr
node --test packages/engine/test/session-settings.test.mjs  # las guardas viajan con la sesión
```

Ninguno necesita red, credenciales ni modelo. Los de autonomía invocan el hook
**como lo invoca Claude Code**: proceso aparte, el evento por stdin, la decisión
en el exit code —2 bloquea, y el motivo por stderr es lo que el modelo lee—. Es
el único modo de probar que la última línea del archivo del hook está
enganchada: con `decide()` perfecto y esa línea rota, el hook permite todo.

Lo que **no** se puede verificar sin una sesión real, y por eso existe la
medición de T080 en `research.md`: que el motor de Claude Code **aplique** la
configuración que se le pasa. Pasar la configuración y que la configuración
sirva son cosas distintas, y el fallo de la segunda es silencioso.
