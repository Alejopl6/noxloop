# Enmienda a la constitution · v1.1.0 → v1.2.0

**Branch**: `002-control-plane` | **Estado: APLICADA el 2026-09-20**

La constitution vigente exige que toda enmienda traiga tres cosas: el principio nuevo o modificado, el fallo concreto que lo motiva, y qué se rompe si no se hace. *"Una enmienda sin un fallo detrás no es una enmienda: es una preferencia."*

Este archivo fue la propuesta. El operador la aprobó y los tres principios están en `.specify/memory/constitution.md`, que pasó a **v1.2.0**.

Se conserva como registro de por qué entró cada uno: la constitution dice *qué* hay que respetar; esto dice *qué se rompió* para que haga falta respetarlo. Revertirla es un `git revert` del commit que la aplicó.

Los tres principios existentes que la feature amplía no se modifican: se extienden a una superficie que en v1.1.0 no existía.

---

## Principio VIII · La interfaz lee; el motor y el servicio escriben

**El principio**

La superficie visual —escritorio o web— no escribe estado. Ni archivos de run, ni el almacén, ni worktrees, ni archivos del proyecto. Toda mutación pasa por el servicio de control, que es el único escritor del almacén, igual que `state.mjs` es el único escritor del estado del run.

Con varias ventanas abiertas y una sesión de CLI en marcha, siguen siendo un escritor y N lectores.

**El fallo que lo motiva**

Ya está medido en este repositorio, en el principio III y en el board de v1: *"un tablero con permiso de escritura sería el segundo escritor"*, y existe un test que mide el disco antes y después para probar que no lo es. La v2 multiplica la superficie por diez: ocho pantallas que editan constitution, guidelines, recomendaciones, credenciales y flota. Cada una es un candidato a segundo escritor, y cada segundo escritor saltea las guardas de transición — que son lo único que sostiene el principio del exit code.

**Qué se rompe si no se hace**

Dos ventanas abiertas sobre el mismo proyecto corrompen el estado sin que nadie lo note, porque ninguna de las dos pasó por la guarda. El síntoma no aparece al escribir: aparece tres etapas después, con un proyecto en un estado que su máquina no permite alcanzar, y sin forma de reconstruir cuál de las dos ventanas lo puso ahí.

---

## Principio IX · El secreto vive en la bóveda y en el subproceso. En ningún otro sitio

**El principio**

El valor de una credencial existe en dos lugares: el backend de secretos del sistema operativo, y el entorno del subproceso que tiene grant vigente, mientras ese subproceso vive. No en el almacén, no en estado, no en logs, no en respuestas de la API, no en mensajes de error, no en transcripts, no en evidencia, no en la interfaz.

La redacción contra la bóveda ocurre **antes** de persistir, no después. Y como todos los demás invariantes de este proyecto, se prueba sobre el objeto serializado con un valor centinela — no sobre la intención.

Ninguna credencial se entrega sin grant vigente verificado en el instante del uso. Denegar por defecto: una tarea sin grant se bloquea y entra en la bandeja; nunca falla en silencio ni continúa sin la credencial.

**El fallo que lo motiva**

Es el único fallo de este producto que no tiene segundo intento. Todo lo demás —un gate mal configurado, un plan equivocado, un scanner que se confunde— se corrige en el ciclo siguiente. Un secreto filtrado a un log se rota, se audita y se explica, y el producto pierde la propiedad que lo diferencia. La propia definición de producto lo clasifica como *"fin de la viabilidad"*, y es el único riesgo de su tabla con esa etiqueta.

El vector concreto no es hipotético: un agente lee una credencial durante la ejecución y la reproduce en su transcript. Si la redacción es posterior a la escritura, hubo un instante en que estuvo en disco — y "un instante" es todo lo que hace falta.

**Qué se rompe si no se hace**

La gobernanza de credenciales es el diferencial competitivo declarado del producto. Un producto que promete *"prueba con qué credenciales operaron tus agentes"* y filtra una es peor que uno que nunca lo prometió, porque el operador confió en la promesa y dejó de vigilar.

---

## Principio X · Lo detectado se distingue de lo inferido, y el hueco se declara hueco

**El principio**

Todo hallazgo que el sistema produce sobre un proyecto —snapshot, recomendación, constitution propuesta— declara su origen: **detectado** con la ruta y la línea que lo respaldan, **inferido** con su confianza declarada, o **vacío** con la constancia de que se buscó y no había.

Un hallazgo `detectado` sin evidencia no se persiste. Un hueco no se rellena con lo probable.

**El fallo que lo motiva**

Es el principio II aplicado a la lectura en vez de a la ejecución, y evita el mismo modo de fallo con otro disfraz. El verde inventado es un gate que afirma haber pasado sin exit code; el **contexto inventado** es un snapshot que afirma "arquitectura hexagonal, cobertura 80%" sin un archivo detrás.

Y es peor en un aspecto: el verde inventado se descubre cuando el código falla en producción. El contexto inventado no se descubre nunca — se convierte en la constitution del proyecto, el runtime la aplica durante meses, y cada tarea hereda la suposición como si fuera un hecho verificado.

La constitution vigente ya lo dice para el flujo de trabajo: *"las ambigüedades se preguntan, no se rellenan"*. Este principio lo extiende a lo que el sistema lee por su cuenta, donde no hay nadie a quien preguntar en ese momento — y por eso hay que declarar el hueco en vez de cerrarlo.

**Qué se rompe si no se hace**

El operador no puede distinguir qué parte del snapshot revisar. Si todo se presenta con la misma autoridad, o lo revisa entero —y entonces el scanner no ahorró nada— o no revisa nada —y entonces adopta las suposiciones del modelo como reglas de su proyecto. Las dos salidas dejan el producto sin la etapa 01.

---

## Ampliaciones a principios existentes

Ninguno se modifica. Se hace explícito su alcance en la superficie nueva:

| Principio | Ampliación |
|---|---|
| **III · El estado vive en disco, fuera de los repos** | El almacén consultable es proyección de lectura, nunca fuente de verdad del run. Un hook sigue decidiendo leyendo un archivo, sin abrir una base de datos y sin conexión. Una discrepancia se resuelve siempre a favor del archivo. |
| **IV · La autonomía termina en el PR abierto** | Se mantiene intacto en esta feature. `L3` y `L4` no entran; el máximo alcanzable es `L2`. Las *danger options* se modelan —tabla, política, auditoría— pero ninguna ruta de la aplicación crea una habilitada. |
| **VII · La configuración es datos; el motor, código** | Se extiende al servicio y a la interfaz: ningún nombre de organización, repositorio, host, proveedor ni proyecto aparece en su código. El grep sigue teniendo que volver vacío, ahora sobre tres paquetes más. |

---

## Lo que esta enmienda deja fuera a propósito

Un principio sobre "la interfaz debe ser accesible y bonita" no entra. Es una preferencia, por razonable que sea, y la constitution es explícita: sin un fallo medido detrás, no es enmienda. Vive en las guidelines de frontend, que es donde se aplica y donde se puede cambiar sin ratificar nada.

---

## Versión propuesta

**1.2.0** — tres principios nuevos, ninguno modificado, ninguno retirado. Menor y no mayor porque nada de lo ratificado el 2026-09-16 deja de valer.

Para aplicarla: tu visto bueno. Si algún principio te sobra o le falta el fallo que lo justifica, se cae — es exactamente la prueba que la constitution exige.
