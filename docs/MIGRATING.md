# Migrar un harness atado a un gestor

Este proyecto salió de uno. El motor que estás leyendo es el port de un harness
de ~4.000 líneas que corrió seis semanas en producción contra un solo gestor de
tickets: 133 invocaciones registradas, 14,5 min y $5,59 de media por invocación,
32 h de reloj y $743,61 de consumo real.

Ese origen es el material de este documento. No es una guía de cómo se haría:
es el orden en que se hizo, y los fallos que aparecieron cuando se hizo en otro
orden. Si tenés un harness propio —uno que funciona, que ya cerró tickets, y que
solo sirve en la organización donde nació— lo que sigue te ahorra descubrirlos
de nuevo.

La instalación desde cero es otro documento
([`docs/ADOPTING.md`](ADOPTING.md)). Acá se asume que ya tenés algo corriendo, y
que el problema es despegarlo de dónde nació.

---

## 1. Cómo reconocer que tenés el problema

Los cuatro síntomas son verificables con un grep. Corrélos sobre el motor de tu
harness —el código que orquesta, no los proveedores ni los tests— antes de
decidir cuánto trabajo es.

### a. Nombres propios en el código del motor

```bash
grep -rniE '<tu-organizacion>|<tu-producto>|<host-de-tu-gestor>|_TOKEN|^[A-Z]+_' \
  ruta/a/tu/motor/
```

En el harness de origen esto devolvía: el nombre de la organización, el nombre
del producto, el host del gestor, el prefijo de sus variables de entorno y dos
nombres de repositorio incrustados en el armado de rutas. Cada uno es una línea
que solo funciona en una organización.

El síntoma no es estético. Es que no podés saber si el motor es genérico: un
motor con un nombre propio adentro puede tener diez más, y no hay forma mecánica
de contarlos mientras el primero siga ahí.

### b. Estados del gestor escritos en el motor

```bash
grep -rniE '"(En curso|In Progress|Nuevo|Active|Resolved|Closed)"' \
  ruta/a/tu/motor/
grep -rniE '"(User Story|Product Backlog Item|Task|Bug|Feature|Epic)"' \
  ruta/a/tu/motor/
```

Dos fallos distintos viven acá. El primero es escribir un nombre de estado de
memoria: si el proyecto lo renombró, el motor escribe un estado que no existe y
la escritura falla a mitad del recorrido. El segundo es peor porque no falla:
deducir el nivel de un ticket comparando el nombre de su tipo. Un gestor llama
"Product Backlog Item" a lo que otro llama "User Story", y un motor que compara
nombres funciona en uno y **calla** en el otro — trata una historia como una
tarea y planifica mal, sin error.

Los dos se arreglan igual: el estado y el nivel salen de un mapa en la
configuración, y el mapa es total (todo estado canónico tiene entrada, y `null`
es una respuesta válida que significa "este proyecto no tiene ese estado, no lo
escribas").

> **Estos dos greps dan falsos positivos, y conviene saberlo antes de
> calibrarlos contra este motor.** Corridos sobre `packages/engine/src/` no
> vuelven vacíos: con `-i` pescan comentarios que explican el fallo en prosa
> ("de «en revision» a «en curso»"), y sin `-i` `"Task"` pesca el nombre de una
> herramienta de Claude Code en la lista de permitidos del runner. Son greps
> para **encontrar candidatos en tu motor**, no un veredicto. El veredicto
> mecánico es el de la §3, que descarta los comentarios antes de buscar.

### c. Un comando de verificación único, asumido para todos los repositorios

```bash
grep -rnE 'npm (test|run ci)|make test|pytest|dotnet test' ruta/a/tu/motor/
```

Si el comando de verificación está escrito en el motor, está escrito el del
repositorio donde nació el harness. Es el síntoma más caro y tiene su propia
sección abajo (§5).

### d. El estado del orquestador viviendo dentro de un repositorio de trabajo

```bash
grep -rn '\.git/\|process.cwd()\|repoPath.*state\|\.harness/\|\.orquestador/' \
  ruta/a/tu/motor/
```

Un estado que vive en `<repo>/.harness/` funciona mientras el harness trabaje en
un repositorio a la vez. Rompe de tres formas conocidas:

- Un ticket abarca varios repositorios, y los hooks que corren dentro de uno
  tienen que ver la **misma** tarea activa que los que corren dentro de otro. Un
  directorio de estado por repositorio no puede dar eso.
- El estado entra en el diff, o se lo lleva un `git clean`, o desaparece con el
  worktree que lo contenía.
- Con paralelismo, dos tareas del mismo repositorio comparten el archivo.

En este port el caso quedó medido: el archivo de handoff del plan seguía
escribiéndose dentro del worktree del usuario, y no lo encontró una revisión —lo
atrapó la guarda de constitución del principio III, que busca escrituras de
estado dentro de un repositorio de trabajo (T092).

---

## 2. El orden de la migración, y por qué ese orden

Cuatro pasos. El orden no es una preferencia: cada paso es lo que hace
verificable al siguiente.

### Paso 1 — La configuración sale del código

Primero, y no por ser lo más fácil: es lo único que permite **verificar** el
resto. Hasta que los nombres propios estén afuera, el grep de la §1 no puede
volver vacío, y sin ese grep en cero no sabés qué parte del motor sigue atada.

Lo que sale: organizaciones, repositorios, rutas, remotes, ramas base, comandos
de verificación, mapas de estado y de tipos, límites, presupuestos y
credenciales. Lo que queda: el motor. Validá la configuración contra un JSON
Schema desde el primer día —la validación a mano es cómo el harness de origen
produjo una configuración que **mentía**: un campo de carencias vacío que el
reporte del PR leía como "este gate no tiene huecos", y el fallo apareció a
mitad de un recorrido.

Hay una dependencia menos obvia que obliga a que este paso vaya primero. La
guarda de shell de una tarea funciona con una lista de **permitidos**, y esa
lista se deriva de lo que el repositorio declara necesitar: los binarios que
aparecen en su `gate`, su `fastGate` y sus `runners`. Sin la configuración
afuera, no hay de dónde derivarla, y lo único que queda es una lista de
prohibidos — que es exactamente el mecanismo que se midió roto (§4).

Poné también el chequeo de tipos en el CI acá, aunque el motor todavía no sea
genérico. En este port corrió contra el código de la primera fase y encontró 17
errores reales (acumuladores inferidos como `never`, un parámetro opcional
pasado a una firma que lo exige, el `code` de un error de spawn sin tipar).
Arreglarlos con el port terminado habría sido arqueología.

### Paso 2 — La interfaz de proveedor

Recién ahora, porque una interfaz se diseña contra los datos que el motor
necesita, y esos datos no se ven mientras el gestor esté cableado adentro.

Tres reglas que este port pagó por aprender:

1. **El proveedor declara capacidades y el motor las consulta.** Nunca las
   asume. Un gestor sin dependencias explícitas entre tickets no degrada el
   recorrido: lo declara, y el motor serializa y lo dice en el plan en vez de
   inventar un orden que el gestor no afirma.
2. **El proveedor no lee la configuración ni el entorno por su cuenta.** Recibe
   un `ctx` con sus opciones, solo las variables que declaró necesitar, la
   bitácora y un cliente HTTP. Es lo que lo hace testeable sin red y sin
   credenciales.
3. **Escribí el segundo proveedor antes de dar la interfaz por buena.** Una
   interfaz con una sola implementación filtra el modelo de esa implementación,
   y el segundo proveedor lo descubre rompiéndola. Acá entraron tres en la
   primera entrega por ese motivo, no por cobertura.

La interfaz completa, con la tabla de qué hace el motor por cada capacidad en
`false`, está en
[`contracts/provider.md`](../specs/001-parallel-ticket-orchestrator/contracts/provider.md);
el registro de las decisiones de cada uno de los tres incluidos, en
[`docs/PROVIDERS.md`](PROVIDERS.md); los cinco pasos para agregar el tuyo, en
[`providers/README.md`](../providers/README.md).

### Paso 3 — El estado fuera de los repositorios, y el bucle de una tarea sólido

El estado se muda a un directorio propio, fuera de todo repositorio de trabajo,
con escrituras atómicas (temporal + `rename`). Y el bucle de una tarea queda
sólido antes de que haya dos: el veredicto es un exit code y nada más, los
presupuestos se consumen por bucle y se registran en el momento del intento, y
retomar no devuelve intentos.

Dos cosas que en el harness de origen se veían bien y no lo estaban:

- **El techo de costo por invocación.** En un hito de 71 invocaciones, 13
  aterrizaron entre $7,50 y $7,99 contra un techo de $8, se registraron como
  `exit 0`, y el trabajo cortado volvió como reintento que costó más que lo que
  el techo ahorró. El corte tiene que viajar como corte, en un campo propio, y
  el techo va por hito y por recorrido — nunca a mitad de una unidad de trabajo
  indivisible.
- **Relanzar un recorrido terminado movía el ticket hacia atrás**, de "en
  revisión" a "en curso". Lo cachó un test de idempotencia, no una revisión: la
  escritura en el gestor necesita una marca de agua.

### Paso 4 — El paralelismo, al final

Implementar concurrencia sobre un bucle de tarea que todavía no es sólido
multiplica los fallos del bucle en vez de multiplicar el trabajo. Acá se vio:
al encender el paralelismo aparecieron dos bugs que el bucle serial tenía
escondidos, y a ninguno de los dos lo encontró un test — los destapó el
paralelismo mismo, corriendo.

- El puntero de tarea activa era **único**. Con N tareas a la vez los hooks no
  podían saber cuál les tocaba, y el guardián de alcance de una bloqueaba los
  archivos de otra.
- Toda mutación de estado perdía actualizaciones: dos tareas sostenían su propia
  copia del recorrido entre `await`s y la última en guardar borraba lo de la
  otra. El síntoma observado fue una tarea que perdía su worktree, volvía a
  `pending` y moría intentando crearlo de nuevo.

Los dos son bugs del bucle, no del paralelismo. Con el bucle serial estaban ahí
y no se veían.

Lo que **sí** se puede construir temprano es el scheduler y la cola de
integración: son funciones sobre el estado y sobre git, probables de forma
aislada, sin red y sin modelo. Adelantarlas baja el riesgo en vez de subirlo —
son la parte que hace seguro el único punto donde entra la concurrencia. Lo que
no se adelanta es *lanzar* dos tareas a la vez.

Y cuando lo enciendas, que sea con una cola de integración serial: rebase sobre
la punta actual, gate **después** del rebase, y fast-forward. El fallo que evita
está medido: un recorrido encadenó 14 ramas una sobre otra y, cuando las diez
primeras se integraron, las tres siguientes llegaron en conflicto porque la base
se había movido debajo de ellas. Un verde sobre una base vieja no dice nada
sobre la base en la que el código va a vivir. El detalle está en
[`docs/PARALLELISM.md`](PARALLELISM.md).

---

## 3. La prueba mecánica de que la migración funcionó

Un grep de nombres propios sobre el motor vuelve vacío, y hay un test que lo
verifica:

```bash
npm run guard    # packages/engine/test/constitution.test.mjs
```

En el CI corre además como paso propio y con nombre, para que cuando falle se
lea como lo que es y no como "un test rojo". Lo que afirma no es una opinión:
`packages/engine/src/**` y `packages/engine/bin/**` no contienen ningún nombre
de organización, de repositorio ni de host, y la lista concreta que busca es la
de los nombres del harness del que salió este motor.

Esa guarda es la única del archivo donde los **comentarios también cuentan**. En
las otras se los descarta antes de buscar, porque los comentarios de este motor
explican los fallos que cada mecanismo evita y explicarlos exige nombrarlos. En
la de nombres propios no: un comentario que menciona una organización concreta
es exactamente la fuga de genericidad que se quiere atrapar.

El mismo archivo lleva otras cinco guardas, y conviene portarlas juntas porque
cada una cubre una violación que puede ocurrir en silencio: que el motor importe
un proveedor por nombre, que un archivo distinto de `state.mjs` escriba el
estado de una tarea, que aparezca un verbo de merge o de deploy fuera del hook
que los prohíbe, que el estado se escriba dentro de un repositorio de trabajo, y
que alguien conceda el rojo verificado sin una corrida.

**Lo que el grep no prueba.** Que vuelva vacío significa que no quedó ningún
nombre, no que el motor sea genérico. La genericidad se prueba con la suite de
contrato corriendo contra dos proveedores distintos, y el criterio es el del
objetivo: agregar un gestor nuevo requiere un archivo nuevo y cero líneas
modificadas en el motor, comprobable porque el motor no tiene cambios sin
commitear.

---

## 4. Qué NO migrar

**Los comentarios que citan una medición no se resumen.** Son la memoria del
proyecto y la parte más difícil de reconstruir. Un comentario que dice "esto
evita trabajar en el repositorio equivocado; ya pasó: un directorio dejó de
corresponder al repositorio que su nombre decía y nada avisó" se convierte, si
lo resumís, en "valida el remote" — y la próxima persona que lea eso borra el
chequeo porque le parece defensivo. Copialos textuales, con el número, y
ajustales el nombre del archivo. Si un mecanismo no tiene un fallo concreto
detrás, no lo migres: es complejidad, y se borra.

**La lista de comandos prohibidos, como primera capa.** Es el mecanismo que se
midió roto: de 57 grafías de comando prohibido, **45 la sortearon**. Bastaba un
prefijo (`env`, `bash -c`, `command`, `sudo`), una comilla
(`git push origin "main"`) o un intérprete (`node -e`), y una de esas formas se
ejecutó contra un remoto real y le movió la rama principal. Alargar la lista
produce un verde inventado: una lista más larga que sigue cayendo con la grafía
siguiente, y tests que ahora afirman que está completa. Lo que se migra es el
cambio de punto de aplicación: **dentro de una tarea, el shell es denegar por
defecto**, con permitidos derivados de lo que el repositorio declara. Después
del cambio, de 28 grafías prohibidas pasan 0 y de 8 comandos legítimos se
bloquean 0. La lista de prohibidos se conserva como segunda capa, no como la
primera. Esto obligó a enmendar la constitución a 1.1.0, porque contradice
"ante la duda, permitir" — que queda acotado a las sesiones donde hay una
persona del otro lado; ver [`docs/AUTONOMY.md`](AUTONOMY.md).

**Los defaults razonables.** Un default para la ruta de un repositorio es cómo
se trabaja en el repositorio equivocado. En su lugar, `doctor` enumera cada
carencia por separado y no inventa ninguna ruta: sin `path` la respuesta honesta
es `null` y el problema dice qué campo falta y cómo declararlo.

**La validación de configuración escrita a mano.** Ya produjo el campo de
carencias vacío que el reporte leyó como "sin carencias".

**El techo de costo por invocación.** Mueve el muro sin quitarlo: el problema no
es dónde está, es que corta a mitad de una unidad de trabajo indivisible y lo
reporta como terminada.

**Lo que en el origen era un prompt, no se migra como prompt.** Un prompt que
pide TDD funciona en las dos primeras iteraciones y deja de funcionar en la
tercera; un hook no se cansa. Lo mismo vale para el límite de autonomía: si lo
sostiene una instrucción, no lo sostiene nada.

---

## 5. El caso concreto del gate por repositorio

Es el síntoma que más trabajo esconde, así que va aparte.

**No hay un comando de verificación uniforme.** Uno de los repositorios tiene
lint de arquitectura, otro no tiene chequeo de tipos, otro no tiene tests.
Asumir uno solo es como un orquestador termina fallando en los repositorios que
no son el suyo de origen, que en una organización de este tamaño —el plan
dimensiona hasta unos ocho por organización— son casi todos.

Y el fallo no es que falle: es que un comando único **no le permite al motor
distinguir** un repositorio sin tests de un repositorio cuyos tests pasaron. Las
dos cosas terminan siendo un exit code, y una de las dos es una mentira.

Lo que reemplaza al comando único es una declaración por repositorio:

| Campo | Qué es | Qué evita |
|---|---|---|
| `gate` | el comando cuyo exit code decide si una tarea cumple | el veredicto por prosa |
| `fastGate` | el subconjunto para el bucle rojo/verde | correr la verificación completa en cada iteración |
| `runners` | cómo correr un test suelto | lo mismo, un nivel más abajo |
| `env` | las variables que ese gate necesita | un gate que falla por entorno y se lee como fallo de la tarea |
| `gaps` | lo que ese gate **no** cubre | que un verde parcial se lea como completo |

Tres consecuencias que conviene tener presentes al declararlo:

- **Un repositorio sin `gate` no produce un verde vacío**: produce un error de
  configuración, que es lo que realmente es.
- **`gaps` vacío no es lo mismo que "sin carencias".** Es el fallo medido: un
  campo de carencias vacío que el reporte del PR leyó como "este gate no tiene
  huecos". Por eso `doctor` avisa cuando está vacío, y por eso lo declarado
  viaja al cuerpo del pull request.
- **Un gate que ya estaba roto en la base se distingue de un fallo causado por
  la tarea**, y la tarea no se bloquea por un fallo ajeno.

Y cerrando el círculo con el paso 1: de estos campos sale la lista de comandos
que la tarea puede ejecutar. Un gate mal declarado no se manifiesta como un
gate raro, sino como un comando bloqueado que dice cómo pedirlo — que es mucho
más fácil de diagnosticar.

---

## Después de migrar

- El escenario 8 de
  [`quickstart.md`](../specs/001-parallel-ticket-orchestrator/quickstart.md) es
  la prueba de adoptabilidad: en una máquina limpia, siguiendo solo la
  documentación, `doctor` tiene que enumerar exactamente qué falta.
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) tiene el flujo de cambios y las tres
  reglas que más se violan sin darse cuenta.
- Las siete invariantes que ningún cambio puede violar están en
  `.specify/memory/constitution.md`. Si tu harness migrado no las puede
  sostener, la que sobra es la promesa, no la invariante.
