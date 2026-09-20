# noxloop Constitution

noxloop toma un ticket y devuelve un pull request. Nada más, y nada menos: el
recorrido completo entre esos dos puntos —entender, especificar, planificar,
escribir el test, implementarlo, verificarlo, revisarlo e integrarlo— corre sin
que nadie lo empuje, y se detiene exactamente donde empieza la responsabilidad
humana.

Este documento fija lo que ningún plan generado puede violar. No describe cómo
está hecho el motor: describe qué invariantes tiene que respetar cualquier
cambio, incluido uno propuesto por un modelo.

## Core Principles

### I. El test primero, forzado por el sistema de archivos (NO NEGOCIABLE)

Ninguna escritura sobre un archivo de producción ocurre antes de que exista un
test que falle y que alguien haya visto fallar. Esto no se implementa pidiéndole
al modelo que se acuerde: lo bloquea un hook `PreToolUse` que intercepta `Edit`,
`Write` y `MultiEdit` y consulta el estado en disco.

La distinción importa porque ya se midió: un prompt que pide TDD funciona en las
dos primeras iteraciones y deja de funcionar en la tercera. Un hook no se cansa.

Ningún tier, bandera, modo rápido ni configuración puede apagar el paso RED. Lo
que un tier abarata es la revisión, el modelo y el alcance del gate — nunca el
orden test-primero. Una tarea sin rojo verificado no avanza: se atasca, y está
bien que se atasque.

### II. El criterio de éxito es un exit code, nunca una frase

Un gate pasó si y solo si existe el objeto del ejecutor de gates con su exit
code real. "Se ve bien", "debería pasar" y "lo verifiqué" no son evidencia.
Ningún agente puede declarar verde lo que no corrió, y ningún estado en disco
se escribe a partir de la prosa de un modelo.

El fallo que esto evita tiene nombre propio: el verde inventado. Es peor que un
rojo, porque un rojo se arregla y un verde falso se mergea.

### III. El estado vive en disco, fuera de los repos

Todo lo que el recorrido necesita recordar entre invocaciones está en archivos,
con escrituras atómicas (temporal + rename). La conversación no es la fuente de
verdad; el archivo sí. Es lo que hace que un recorrido sea retomable después de
una compactación de contexto, un error de red o una sesión matada.

Fuera de los repos a propósito: un ticket puede abarcar varios, y los hooks que
corren dentro de uno tienen que ver la misma tarea activa que los que corren
dentro de otro.

Retomar no regala presupuesto: una tarea que consumió tres intentos los
conserva.

### IV. La autonomía termina en el PR abierto

El sistema no mergea a una rama protegida, no despliega, no toca producción y no
hace force push. Lo impide un hook, no la buena voluntad de un prompt — y el
hook corre dentro de cada subproceso, también en los que nadie está mirando.

Un recorrido que llega a PR abierto con tres tareas bloqueadas y un diagnóstico
honesto es un éxito. Uno que llega a PR mergeado sin revisión humana es un
incidente, aunque el código esté bien.

### V. El paralelismo lo gobierna el DAG, no el optimismo

Dos tareas corren a la vez si y solo si no hay arista de dependencia entre
ellas. Cada tarea paralela vive en su propio worktree, y la integración pasa por
una cola serial que rebasa sobre la punta y vuelve a verificar antes de mergear.

Nadie ramifica sobre trabajo no integrado. La razón es medida, no teórica: un
recorrido anterior encadenó catorce ramas una sobre otra y las tres últimas
llegaron en conflicto cuando las primeras se integraron.

### VI. El gestor de tickets es un detalle, y se prueba que lo es

El motor no sabe qué gestor hay del otro lado. Habla con una interfaz de
proveedor y le pregunta qué sabe hacer (`capabilities`) antes de asumirlo. Un
proveedor que no soporta dependencias explícitas no degrada el recorrido: lo
declara, y el motor serializa por defecto en vez de inventar un orden.

Agregar un gestor nuevo es agregar un archivo plano en `providers/`. Si un
cambio en el motor hace falta para soportar un gestor, la interfaz está mal y se
arregla la interfaz — no se ramifica el motor con un `if`.

### VII. La configuración es datos; el motor, código

Nombres de repos, comandos de verificación, mapas de estado, ramas base, límites
y rutas son configuración validada contra un JSON Schema. Ningún nombre de
organización, repo, host o proyecto aparece en el código del motor.

Es la condición para que esto sea instalable por alguien más, y la verificación
es mecánica: un grep del motor buscando nombres propios tiene que volver vacío.

### VIII. La interfaz lee; el motor y el servicio escriben

La superficie visual —escritorio o web— no escribe estado. Ni archivos de run,
ni el almacén, ni worktrees, ni archivos del proyecto. Toda mutación pasa por el
servicio de control, que es el único escritor del almacén igual que `state.mjs`
es el único escritor del estado del run.

Con varias ventanas abiertas y una sesión de CLI en marcha, siguen siendo un
escritor y N lectores.

El fallo ya está medido en este repositorio: el board de v1 no escribe, y hay un
test que mide el disco antes y después para probarlo. La superficie de v2 se
multiplica por diez —pantallas que editan constitution, guidelines,
recomendaciones, credenciales y flota— y cada una es un candidato a segundo
escritor. Un segundo escritor saltea las guardas de transición, que son lo único
que sostiene el principio del exit code.

Sin esto, dos ventanas sobre el mismo proyecto lo corrompen sin que nadie lo
note, y el síntoma aparece tres etapas después, sin forma de saber cuál de las
dos lo puso ahí.

### IX. El secreto vive en la bóveda y en el subproceso. En ningún otro sitio

El valor de una credencial existe en dos lugares: el backend de secretos del
sistema operativo, y el entorno del subproceso que tiene grant vigente, mientras
ese subproceso vive. No en el almacén, no en estado, no en logs, no en
respuestas de la API, no en mensajes de error, no en transcripts, no en
evidencia, no en la interfaz.

La redacción contra la bóveda ocurre ANTES de persistir, no después. Y como todo
invariante de este proyecto, se prueba sobre el objeto serializado con un valor
centinela, no sobre la intención.

Ninguna credencial se entrega sin grant vigente verificado en el instante del
uso. Denegar por defecto: una tarea sin grant se bloquea y entra en la bandeja;
nunca falla en silencio ni continúa sin ella.

Es el único fallo de este producto sin segundo intento. Un gate mal configurado
o un plan equivocado se corrigen en el ciclo siguiente; un secreto filtrado se
rota, se audita y se explica. El vector concreto no es hipotético: un agente lee
una credencial durante la ejecución y la reproduce en su transcript. Si la
redacción es posterior a la escritura, hubo un instante en que estuvo en disco, y
un instante es todo lo que hace falta.

### X. Lo detectado se distingue de lo inferido, y el hueco se declara hueco

Todo hallazgo que el sistema produce sobre un proyecto —snapshot, recomendación,
constitution propuesta— declara su origen: DETECTADO con la ruta y la línea que
lo respaldan, INFERIDO con su confianza declarada, o VACÍO con la constancia de
que se buscó y no había.

Un hallazgo detectado sin evidencia no se persiste. Un hueco no se rellena con
lo probable.

Es el principio II aplicado a la lectura en vez de a la ejecución, y evita el
mismo fallo con otro disfraz. El verde inventado es un gate que afirma haber
pasado sin exit code; el contexto inventado es un snapshot que afirma
"arquitectura hexagonal, cobertura 80%" sin un archivo detrás.

Y es peor en un aspecto: el verde inventado se descubre cuando el código falla.
El contexto inventado no se descubre nunca — se convierte en la constitution del
proyecto, el runtime la aplica durante meses, y cada tarea hereda la suposición
como si fuera un hecho verificado.

El flujo de trabajo ya lo dice para las personas: las ambigüedades se preguntan,
no se rellenan. Este principio lo extiende a lo que el sistema lee por su cuenta,
donde no hay nadie a quien preguntar — y por eso hay que declarar el hueco en
vez de cerrarlo.

## Additional Constraints

**Sin dependencias en el camino crítico.** El motor corre con Node y git. El SDK
del modelo es la única dependencia de runtime, y si falta, el motor degrada al
CLI en vez de morir. Las dependencias de desarrollo (validador de schema, runner
de tests) nunca se cargan en tiempo de ejecución.

**Todo mecanismo declara el fallo que evita.** Un mecanismo sin un fallo
concreto y observado detrás es complejidad, y se borra. Los comentarios del
motor citan la medición, no la intención: cuánto costó, cuándo, en qué
recorrido. Es la memoria del proyecto y es la parte más difícil de reconstruir.

**Los presupuestos se consumen explícitamente.** Un intento que no se registra
no existe, y una tarea que no registra puede iterar sin límite. Registrar es
parte del intento, no un reporte posterior.

**Ante la duda, un hook permite — cuando hay una persona del otro lado.** Los
hooks corren en cada operación de la sesión, también cuando noxloop no está
activo, y un hook que bloquea por un error propio deja a una persona sin poder
trabajar: eso es peor que el problema que evitaba.

**Dentro de una tarea que el motor lanzó, la regla se invierte: el shell es
denegar por defecto.** Ahí no hay nadie del otro lado, así que el argumento que
sostiene la permisividad no aplica. Lo que se permite es lo que la tarea
necesita —los comandos de verificación que el repositorio declara, y lecturas—
y todo lo demás se rechaza diciendo cómo pedirlo.

La enmienda tiene un fallo medido detrás, y es el que la hace obligatoria: con
una lista de comandos prohibidos, **45 de 57 grafías la sortearon**. Un prefijo
(`env`, `bash -c`, `command`, `sudo`), una comilla (`git push origin "main"`) o
un intérprete (`node -e`) bastaban. Una de esas formas se ejecutó contra un
remoto real y movió su rama principal. Alargar la lista produce exactamente el
verde inventado que prohíbe el principio II: una lista más larga que sigue
cayendo con la grafía siguiente, y tests que ahora afirman que está completa.

La lista de prohibidos se conserva como segunda capa, no como la primera.

## Development Workflow

Todo cambio entra por el ciclo de spec-kit: `specify → plan → tasks →
implement`. Las ambigüedades se preguntan, no se rellenan.

Toda tarea con lógica nueva lleva su test antes que su implementación, y ese
test tiene que fallar contra el código viejo. El propio motor se construye con
la disciplina que impone.

Un PR de más de 400 líneas de diff se parte. Commits en Conventional Commits.
Ninguna rama nace de otra cosa que la base declarada.

El motor no se publica sin: schemas de configuración validados, la suite de
tests en verde en CI, y el test de contrato de proveedor pasando para los tres
proveedores incluidos.

## Governance

Esta constitución gana sobre cualquier otra práctica, incluida una sugerencia
razonable de un modelo a mitad de un recorrido. Un plan que la viola se rechaza
en el `Constitution Check` del plan, antes de escribir código.

Enmendarla requiere: el principio nuevo o modificado, el fallo concreto que lo
motiva, y qué se rompe si no se hace. Una enmienda sin un fallo detrás no es una
enmienda: es una preferencia.

Bajar un umbral, saltear un test, apagar un hook o recortar un gate para que una
tarea avance no es una decisión de implementación. No está disponible.

**Version**: 1.2.0 | **Ratified**: 2026-09-16 | **Last Amended**: 2026-09-20
