# Changelog

Todos los cambios notables de este proyecto se registran acá.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y
el versionado, [SemVer](https://semver.org/lang/es/). Una regla propia del
repositorio: cada entrada nombra **qué le cambia a quien lo usa** y, cuando la
hay, la medición que la motiva. Un cambio sin un fallo concreto detrás no es una
entrada: es una preferencia.

## [No publicado]

La versión **0.1.0 todavía no se publicó**, así que todo lo de abajo es la
primera versión y no un delta contra nada instalado.

`noxloop help` es la lista vigente de lo que hay, y a esta altura no le falta
ningún subcomando: el recorrido de un hito (`milestone`), la bandeja y el
disparo automático (`inbox`, `daemon`), el destrabado con su nota (`unstick`),
`diagnose` y `prune` entraron todos.

Lo que **no** entra es un borde del recorrido, que **no** está cerrado. Se
lista acá y no en la documentación de cada tema porque quien evalúa si corre
esto necesita verlo antes de apuntarlo a un remoto de verdad:

- **Nada publica la rama del ítem.** El motor no hace `git push`, y `gh pr
  create` necesita que la rama exista en el remoto. Hay que empujarla a mano;
  `docs/ADOPTING.md` §6 tiene el comando. El límite del principio IV queda del
  lado seguro —el motor no empuja nada—, pero el PR no se abre solo. Lo que sí
  cambió: la causa textual del forge ahora llega al reporte (ver *Corregido*).

Y dos cierres del plano de control que necesitan una persona y no código:
registrar las aplicaciones OAuth propias en cada proveedor (T156), y el
recorrido a mano de SC-001 sobre un repositorio real (la mitad manual de T205).

### Añadido

- **El plano de control: una aplicación que lleva un repositorio hasta
  `ACTIVE`.** Escritorio con Tauri y la misma interfaz en el navegador, sobre un
  servicio local que escucha solo en `127.0.0.1`, pide token de sesión y es el
  único escritor de su almacén. El alta recorre siete etapas —escaneo,
  constitución, guidelines, diseño, bootstrap, conexiones, flota— y cada una
  tiene su guarda en el almacén: un proyecto no avanza porque la pantalla lo
  diga. Lanzar un ciclo sobre un proyecto que no está `ACTIVE` devuelve 409
  **nombrando la etapa que falta**. Cómo se levanta y se verifica cada pieza, en
  `specs/002-control-plane/quickstart.md`.
- **Un scanner que no escribe.** Lee el repositorio y devuelve hallazgos con su
  evidencia; lo que no puede probar no lo declara detectado. Un paso propio del
  CI comprueba que `git status --porcelain` queda vacío después de escanear.
- **La bóveda.** Credenciales con grants por proyecto y vigencia, un redactor
  que busca por valor y reemplaza por `[redactado:<nombre>]`, auditoría
  append-only con hash encadenado, y un subproceso que recibe **exactamente** el
  entorno declarado. Ningún valor viaja por `argv`, y un centinela plantado como
  credencial no aparece en ninguna respuesta de ningún endpoint, errores
  incluidos: se prueba en cada commit.
- **Conexiones con OAuth, sin perder el token personal.** Dos adaptadores
  montados a la vez y repartidos por el modo que declara el catálogo: Nango
  autoalojado para los flujos de autorización y el adaptador local para tokens
  personales y claves de API, que no necesita contenedores. La autorización se
  abre en el navegador del sistema y la pantalla sondea hasta que la conexión
  aparece. El registro de la aplicación OAuth propia viene guiado en cuatro
  pasos, porque en una instancia autoalojada no hay aplicaciones compartidas
  —medido contra Nango 0.71.10—.
- **La flota y los adaptadores de agente.** Un contrato `AgentAdapter` con su
  suite, y tres adaptadores: Claude Agent SDK, Codex y `fake`. El de Codex
  entró sin tocar `driver.mjs`, que era la prueba de que el contrato estaba
  bien. El revisor nunca retoma la sesión del implementador, y activar una flota
  cuyo revisor comparte runtime con el implementador se rechaza.
- **La bandeja como único elemento accionable** de la pantalla de inicio, con la
  causa textual completa y el estado "bandeja vacía" dicho como tal.

- **El recorrido completo de un ticket a un pull request.** `noxloop plan <id>`
  planifica y para —es el único punto de aprobación humana del flujo— y
  `noxloop run <id>` lo ejecuta hasta dejar un PR abierto. Cada tarea deja
  **dos commits**, el del test antes que el de la implementación, para que la
  promesa central del proyecto se pueda verificar con `git log` y sin leer el
  motor.
- **Paralelismo gobernado por el DAG.** Dos tareas corren a la vez si y solo si
  no hay arista de dependencia entre ellas, cada una en su propio worktree de
  git. La integración pasa por una cola serial que rebasa sobre la punta actual,
  **vuelve a correr el gate después del rebase** e integra con fast-forward. Un
  rechazo devuelve la tarea al bucle con la causa textual y deja la rama del
  ticket intacta. El fallo que esto evita está medido: un recorrido anterior
  encadenó catorce ramas una sobre otra y, cuando las diez primeras se
  integraron, las tres siguientes llegaron en conflicto.
- **Tres gestores de tickets, y un cuarto en un archivo.** Azure DevOps Boards,
  GitHub Issues y Linear, cada uno con su suite de contrato corriendo contra
  respuestas grabadas —sin red y sin credenciales—, más el proveedor `fake` en
  memoria, que es además el ejemplo mínimo que se copia para agregar uno nuevo.
  El motor pregunta `capabilities()` y degrada de forma visible: sin
  dependencias nativas serializa y lo declara, sin `linkUrl` el PR va como
  comentario, sin `setState` no mueve ningún estado.
- **`noxloop doctor`.** Qué está declarado, qué falta, qué credencial no está en
  el entorno, y si cada repositorio declarado tiene un checkout local que **de
  verdad** es ese repositorio (compara el remote). Una línea por carencia, con
  su nombre y su repositorio, y la distinción entre problema —baja `ready`— y
  aviso. No inventa ningún valor por defecto: un default razonable para la ruta
  de un repositorio es cómo se trabaja en el repositorio equivocado, y ya pasó.
- **El estado en disco, fuera de los repositorios**, bajo `NOXLOOP_HOME`, con
  escrituras atómicas. Es lo que hace que un recorrido sea retomable
  (`noxloop resume <id>`) después de una compactación de contexto, un error de
  red o una sesión matada, y lo que permite que los hooks que corren dentro de
  un repositorio vean la misma tarea activa que los que corren dentro de otro.
  Retomar no regala presupuesto: una tarea que consumió tres intentos los
  conserva.
- **El gate como único productor de veredictos.** Una tarea cumple si y solo si
  existe el objeto del ejecutor con su exit code real, su comando textual y su
  duración, persistido dentro de la tarea. El estado rechaza la transición sin
  esa evidencia.
- **Las cuatro guardas de sesión, entregadas por el motor.** Orden
  test-primero, alcance de la tarea, límite de autonomía y constancia al
  cerrar. Viajan en la propia invocación (`--settings` en el CLI,
  `options.settings` en el SDK), así que **funcionan con el plugin sin
  instalar** —verificado en una sesión real, dentro de un subagente y en una
  sesión retomada—. El motor se niega a lanzar una sesión si no puede armarlas.
- **El recorrido de un hito, la bandeja y el disparo automático.** `milestone`
  prepara el recorrido de una épica o feature y **para** —el orden de las
  historias, las exclusiones, la rama del hito— y solo lo lanza con `--go`;
  `inbox` dice qué tickets hay asignados o mencionados sin ejecutar nada, y
  `daemon` es el bucle que los despacha. El hito integra cada historia a su rama
  sin esperar revisión humana, y lo declara al pedir la aprobación: un error
  temprano viaja a las siguientes, y es el precio de no detenerse.
- **Retomar, destrabar y limpiar, cada uno con su decisión registrada.**
  `diagnose` dice qué quedó a medias y qué decisión hace falta, sin tocar nada;
  `resume` la ejecuta; `unstick <id> --task <t> --nota "..."` devuelve una tarea
  bloqueada al bucle **exigiendo la nota**, porque una tarea que vuelve sin que
  nadie diga por qué es un presupuesto regalado en silencio; y `prune` limpia
  worktrees huérfanos sin descartar trabajo sin commitear salvo con `--force`.
- **Resto de la superficie del CLI**: `validate` (un problema por campo, con su
  ruta), `status` (solo lectura, sin tocar el gestor: corre con la red caída),
  `dispatch` (resuelve el nivel del ticket con el mapa de tipos y delega),
  `add-target` (amplía el alcance de una tarea con su motivo, que queda
  registrado y se reporta en el PR) y `run --dry-run`, que no escribe nada.
- **El plugin de Claude Code**: cinco comandos, cinco agentes, dos skills y dos
  workflows (el fan-out de planificación y el de revisión).
- **Configuración validada contra JSON Schema**, con `${VAR:-default}`. Es el
  único lugar donde viven nombres propios; un test busca nombres propios en el
  motor y falla si encuentra alguno.
- **Cero dependencias de runtime obligatorias.** El motor corre con Node y git.
  El Claude Agent SDK es opcional y, si falta, el motor degrada a invocar el CLI
  y lo dice. Hasta el validador de JSON Schema es propio: esto se instala para
  orquestar los repositorios de otra persona, y cada dependencia es superficie
  que esa persona no eligió.
- **Documentación de adopción**: `docs/ADOPTING.md` (de una máquina limpia al
  primer PR), `docs/PARALLELISM.md` y `docs/AUTONOMY.md` (el DAG y la cola, y
  dónde termina la autonomía, cada uno con el fallo que evita),
  `docs/MIGRATING.md` (mover un harness atado a un gestor),
  `docs/PROVIDERS.md` (la interfaz y por qué cada `false` es un `false`),
  `providers/README.md` (los cinco pasos, con Jira como ejemplo trabajado),
  `examples/` y `CONTRIBUTING.md`.
- **El CI corre la documentación, no solo el código.** Dos pasos propios: el
  primer recorrido que manda `docs/ADOPTING.md` —copiar el ejemplo, corregir las
  rutas, `doctor` en verde, `dispatch`— y todos los `node --test <archivo>` que
  los bloques "Cómo se verifica" de las docs mandan correr. El fallo que evitan
  es de una clase propia: una doc puede romperse con la suite entera en verde
  —un archivo de test renombrado, una receta que dejó de alcanzar— y la doc es
  lo único que tiene quien no escribió esto.

### Cambiado

- **Dentro de una tarea que el motor lanzó, el shell pasa a ser denegar por
  defecto.** Es el cambio de comportamiento observable de la enmienda **1.1.0**
  de la constitución, y reemplaza a la lista de comandos prohibidos como primera
  capa. Lo que se permite es lo que la tarea declara necesitar —los binarios que
  aparecen en el `gate` y en los `runners` de su repositorio— más lectura; todo
  lo demás se rechaza diciendo cómo pedirlo. Los prefijos que ejecutan otro
  comando (`env`, `bash -c`, `sudo`, `xargs`…) y los intérpretes con un flag de
  evaluación (`node -e`) se rechazan siempre, incluso si el repositorio los
  declara.

  El fallo medido que lo hace obligatorio: con la lista de prohibidos, **45 de
  57 grafías la sortearon** —bastaba un prefijo, una comilla
  (`git push origin "main"`) o un intérprete— y una de esas formas **se ejecutó
  contra un remoto real y le movió la rama principal**. Alargar la lista
  producía exactamente el verde inventado que prohíbe el principio II. Después
  del cambio: de 28 grafías prohibidas pasan **0**, y de 8 comandos legítimos se
  bloquean **0**. La lista de prohibidos se conserva como segunda capa, no como
  la primera.

  La contrapartida es que "ante la duda, un hook permite" queda **acotado a las
  sesiones donde hay una persona del otro lado**: ahí un bloqueo de más deja a
  alguien sin poder trabajar, y eso es peor que el problema que evita. Adentro
  de una tarea no hay nadie, así que el argumento no aplica. En una sesión
  interactiva de una persona los hooks se comportan como antes.
- **Una sesión sin guardas no se lanza.** Antes el motor no pasaba ninguna
  configuración de hooks, así que toda sesión lanzada en una máquina sin el
  plugin instalado corría **sin** guardas: el paso RED se salteaba y el límite
  del PR no existía, las dos cosas en silencio y con el recorrido pareciendo
  normal. Ahora las guardas se comprueban en disco antes de invocar, y si falta
  alguna la fase devuelve `hooks_ausentes` en vez de correr.
- **El motor inyecta `NOXLOOP_HOME` en la sesión que lanza.** Quien declaraba
  `home` en el archivo en vez de exportarlo corría todas sus sesiones con los
  hooks mirando `~/.noxloop`, donde no hay ninguna tarea activa: cero guarda y
  cero aviso.
- **El corte por presupuesto viaja como campo propio y nunca como éxito.** El
  techo es por hito y por recorrido, no por invocación: el techo por invocación
  se midió como amputación —en un hito de 71 invocaciones, 13 aterrizaron entre
  $7,50 y $7,99 contra un techo de $8, se registraron como `exit 0`, y el
  trabajo cortado volvió como reintento más caro que lo ahorrado—.
- **Una fase retoma la sesión de la tarea; una tarea nueva abre sesión nueva.**
  Antes cada fase reconstruía desde cero el prompt de sistema, las skills, los
  agentes y el esquema de herramientas: 133 invocaciones, 14,5 min y $5,59 de
  media, con el caché de prompt —TTL de 5 minutos— nunca llegando a servir.
  Sesión nueva **entre** tareas se mantiene a propósito: evita la degradación
  por compactación que se observó al cerrar catorce tareas en un solo contexto,
  donde las cuatro últimas abrieron PR con los contadores en cero.
- **Un tier que renuncia a la revisión lo declara.** `review: false` ya no
  impide encolar la tarea, y la renuncia queda registrada en su estado y
  reportada en el PR: un tier abarata la revisión a la vista, no en silencio.
- **El cuerpo del pull request lo arma código desde el estado**, no la prosa del
  modelo: criterios, el gate con su exit code textual, los huecos declarados del
  gate, las iteraciones que costaron más de un intento, las ampliaciones de
  alcance con su motivo y las tareas bloqueadas con su causa real. Un cuerpo
  escrito por el modelo tiende a contar lo que salió bien.

### Corregido

- **Un run lanzado por el CLI no aparecía en los runs de su proyecto.** El
  motor no sabe de qué proyecto es un run, y las tareas no llevaban la ruta de
  su repositorio, así que `GET /v1/projects/:id/runs` devolvía vacío para un run
  de verdad. Era la última costura que el recorrido de punta a punta cruzaba a
  mano. El planner copia ahora la ruta de la configuración en cada tarea.
- **El error del forge se perdía.** Cuando la apertura del PR fallaba, el
  recorrido reportaba `sin PR: no se llego a abrir` y descartaba lo que dijo
  `gh`. Ahora la causa textual viaja en el resultado.
- **`noxloop run` no ponía la rama del ítem al día con su base.** Solo lo hacía
  `milestone`; un recorrido que entraba por `run` rebasaba las tareas sobre una
  base vieja. Ahora los dos llaman a `syncItemBranch`.
- **`noxloop dispatch` sobre una épica decía que `milestone` no existía**, con
  un mensaje que había quedado de antes de que existiera.
- **La plantilla del compose de Nango no viajaba en el repositorio.**
  `docs/CONEXIONES.md` manda copiar `.env.ejemplo`, y `.gitignore` lo ignoraba:
  en un clon limpio el primer paso fallaba.

Todo lo que sigue se corrigió antes de publicar. Se lista porque cada punto es una
garantía que el proyecto afirma y que en algún momento no cumplía — y porque
saber qué se rompió una vez es lo que evita "arreglar" la restricción que lo
impide.

- **El límite de autonomía se caía con un flag que no tiene nada de exótico.**
  La guarda leía el subcomando de git en el primer argumento, y
  `git -C /ruta push --force origin main` pone `-C` ahí: el segmento se
  permitía. La propia cola de integración de este motor invoca git con `-C` en
  cada llamada. Lo mismo con los flags globales del CLI del forge
  (`gh --repo o/r pr merge 7`).
- **Un refspec esquivaba la lista de ramas protegidas.** `git push origin
  HEAD:main` no se frenaba, porque el argumento es `HEAD:main` y no `main` — o
  sea, la forma normal de empujar a una rama en la que no estás parado. También
  faltaban `git update-ref`, `push --mirror/--all` y los alias de git, que mueven
  una rama sin nombrar `push` ni `merge`.
- **La guarda se apartaba justo cuando tenía que actuar.** Las rutas se
  comparaban sin resolver enlaces simbólicos, y con el estado bajo
  `/var/folders` (ruta real `/private/var/folders`) y dos tareas activas, el
  puntero de tarea activa no resolvía: el hook permitía todo.
- **`validateHookSettings` decía que todo estaba bien con la guarda de Bash
  ausente.** Juntaba rutas terminadas en `.mjs` y contaba, así que aprobaba un
  hook apuntando a un archivo inexistente, el nombre del evento mal escrito y el
  evento vacío. Una validación que produce confianza sin comprobar nada es peor
  que no validar. Ahora exige las cuatro guardas, cada una en su evento y su
  matcher, y nombra la que falta.
- **El único camino donde el motor ejecutaba algo arbitrario por su cuenta.**
  Correr un test suelto interpolaba `{file}` dentro de un comando con shell, y
  `{file}` lo escribe el planificador —un modelo— sobre un esquema que aceptaba
  texto libre. No pasaba por ningún hook, porque no pasa por la herramienta
  Bash. Ahora va por argv sin shell, y el esquema del plan exige que una ruta
  sea una ruta.
- **Dos tareas concurrentes se pisaban el estado.** Cada una sostenía su propia
  copia del recorrido entre `await`s y la última en guardar borraba lo de la
  otra. El síntoma observado: una tarea perdía su worktree, volvía a `pending` y
  moría intentando crearlo de nuevo.
- **El puntero de tarea activa era único**, así que con varias tareas en vuelo
  los hooks no podían saber cuál les tocaba: el guardián de alcance de una
  bloqueaba los archivos de otra. Ahora es por worktree. Lo destapó el
  paralelismo, no un test.
- **Relanzar un recorrido terminado movía el ticket hacia atrás**, de "en
  revisión" a "en curso": el tablero pasaba a mentir en la dirección más confusa
  posible, porque parece que el trabajo volvió a empezar.
- **La cola rebasaba ramas sin contenido.** El driver no commiteaba nada, y los
  tests pasaban porque solo miraban estados. Sin los dos commits por tarea, el
  orden test → implementación no se puede verificar en el historial del PR.
- **El archivo intermedio del plan se escribía dentro del worktree de quien
  corre el motor**, donde termina commiteado por accidente o ensuciando un
  `git status`. El estado y sus artefactos viven fuera de los repositorios.
- **La guarda de autonomía bloqueaba de más.** Frenaba comandos legítimos que
  solo *mencionaban* una frase prohibida: un `echo` con una advertencia, un
  `grep` buscando en la documentación. Ahora el comando se parte en segmentos
  reales respetando comillas y se mira el primer token de cada uno: lo que se
  ejecuta, no lo que se nombra.
- **El chequeo 7 de la suite de contrato validaba el fixture y no el
  proveedor.** Los tres proveedores ya pasaban, así que no cambió ningún
  comportamiento: cambió lo que el chequeo puede afirmar.
- **La documentación del contrato mandaba un comando que falla.**
  `node --test providers/<nuevo>/` termina en `MODULE_NOT_FOUND` en Node ≥ 22,
  porque el runner ya no expande directorios: quien adoptara el proyecto se
  comía un error ajeno a su proveedor en el paso 4 de cinco.
- **17 errores de tipos reales** que encontró `tsc --checkJs` al correr sobre el
  motor: acumuladores inferidos como `never`, un `home` opcional pasado a una
  firma que lo exige, el `code` de un error de spawn sin tipar.
- **Un test probaba el sistema operativo y no el código.** Se apoyaba en que el
  temporal del sistema fuera un enlace simbólico —cierto en macOS, falso en
  Linux—, así que pasaba en una máquina y fallaba en CI.
- **La documentación de adopción prometía un primer recorrido que no llegaba.**
  `docs/ADOPTING.md` mandaba copiar la configuración de ejemplo, corregir dos
  rutas relativas y esperar que `doctor` dijera "listo para usar". No llegaba:
  el ejemplo apunta `repos.app.path` a `~/proyects/app`, que en una máquina
  limpia no existe, así que `doctor` salía con exit 1 y el documento no decía
  por qué. Quien adoptaba el proyecto se quedaba en el paso 2 del primer
  recorrido, que es exactamente el fallo que ese documento existe para evitar.
  Nadie lo había notado porque ningún test corría la secuencia del documento:
  los tests prueban `doctor`, no la receta. Ahora la corre el CI, paso propio y
  con nombre, y el documento trae el checkout desechable que falta.
- **Dos afirmaciones de la documentación que el código no respaldaba.**
  `docs/ADOPTING.md` decía que por el camino del CLI "no hay sesión que
  retomar" —el motor pasa `--resume` por los dos transportes; lo que se pierde
  sin el SDK es el seguimiento en vivo— y ofrecía `GH_TOKEN` como alias usable
  de `GITHUB_TOKEN`, cuando el motor solo inyecta las variables que el proveedor
  declara en `requiredEnv` y ahí está únicamente `GITHUB_TOKEN`.
  `docs/PARALLELISM.md` afirmaba que `syncItemBranch` corría antes de cada
  recorrido. Una doc que promete lo que el código no hace es peor que no tener
  doc, porque se la cree.

### Seguridad

- La revisión adversarial del límite de autonomía **ejecutó un force push
  contra un remoto real** y le movió la rama principal. Es el fallo que motiva
  la inversión de la guarda de Bash y la enmienda 1.1.0 de la constitución (ver
  *Cambiado*). Es la única promesa del proyecto que, si es falsa, produce daño
  en el repositorio de otra persona, y por eso su test es de los dos que
  bloquean la publicación.
- El camino por el que un modelo podía hacer ejecutar código arbitrario al motor
  —`{file}` interpolado en un comando con shell, sin pasar por ningún hook— está
  cerrado (ver *Corregido*).

### Eliminado

- **El scaffolding de spec-kit salió del repositorio publicado.** 28 de los 90
  archivos versionados eran de terceros —10 skills de `.claude/skills/speckit-*`
  y 18 de `.specify/`—, y publicarlos bajo un `LICENSE` propio atribuía mal
  5.141 líneas que no son de este proyecto. Sigue en disco, así que el flujo
  local no cambia; `CONTRIBUTING.md` dice cómo instalarlo. Se versiona lo que sí
  es de este proyecto: la constitución y el ciclo completo de cada cambio en
  `specs/`.
