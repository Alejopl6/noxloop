# Lo que se tomó de ECC, lo que no, y lo que falta

Este archivo existe porque la síntesis vivía **solo en una sesión de trabajo**.
Un inventario del repositorio lo encontró: no había una sola mención a ECC en
`docs/`, `specs/` ni el README, así que ocho decisiones ya tomadas estaban a un
cierre de terminal de perderse. Eso es el mismo modo de fallo que el proyecto
persigue en el código —una decisión que existe y no está registrada es una
decisión que se va a volver a tomar, distinta— aplicado a la documentación.

**La fuente**: [affaan-m/ECC](https://github.com/affaan-m/ECC) — 68 agentes y
584 archivos de skills. Se leyó, no se copió.

## La regla con la que se leyó

**No se copia nada.** Ya había pasado con spec-kit: 32 archivos quedaron
versionados bajo el `LICENSE` de este repositorio y hubo que sacarlos en
`dd5db29`. Lo que se toma son ideas, con atribución de dónde salieron. Y sale
mejor: los agentes de ECC no conocen el estado de noxloop, ni sus tiers, ni su
marcador `HALLAZGO BLOQUEANTE:`.

**Tope de diez.** Un plan de diez que se hacen vale más que uno de cuarenta que
se lee. Un portfolio amplio de cosas que nadie usa es peso, no valor.

## Tomado, y donde vive

| Idea | Dónde aterrizó |
|---|---|
| **Fan-out de revisión por lentes independientes** — varias pasadas con un criterio cada una encuentran lo que una pasada con cuatro criterios tapa, y tarda lo que la más lenta en vez de la suma. | `revisionEnAbanico()` en `driver.mjs`: cuatro lentes (`correccion`, `seguridad`, `estilo`, `alcance`) con `resume: null` cada una para que ninguna vea los hallazgos de otra, más una fase de síntesis. `packages/plugin/agents/review-fanout.md` y `packages/plugin/workflows/review-fanout.mjs`. |
| **Fan-out de planificación** — analizar los repositorios en paralelo antes de decidir el alcance. | `packages/plugin/workflows/planning-fanout.mjs`. |
| **Verificación adversarial** — al verificador se le pide REFUTAR, no confirmar, y se mata el hallazgo si la mayoría lo refuta. | Es el método con el que se construyó el proyecto, y encontró más que los implementadores: la promesa de autonomía era falsa (un bypass ejecutado contra un remoto real), la carrera del lock, y que `findings` no lo producía nadie. Vive en el proceso, no en el código. |
| **Un test que falla cuando un campo declarado no tiene consumidor.** | `packages/engine/test/campos-sin-consumidor.test.mjs`. Al correrlo por primera vez encontró **seis** campos huérfanos, dos con promesa escrita en la documentación. Ver el commit que lo agrega. |

## Descartado, y por qué

La lista de descartes vale tanto como la de virtudes. Lo que ECC hace bien para
ECC y mal para noxloop, en todos los casos porque choca con la constitución:

- **Apagar hooks o guardas por configuración.** Acá no hay bandera, tier ni modo
  rápido que apague el orden del TDD ni el límite de autonomía. Principios I y V.
- **Autonomía más allá del PR abierto.** Sin merge a rama protegida, sin deploy,
  sin force push, y lo impide un hook que corre dentro de cada subproceso.
- **Declarar cumplido sin evidencia.** Una tarea cumple si y solo si existe el
  objeto del gate con su exit code real. Principio II.
- **Nombres propios en el motor.** Hay un test de constitución que falla si
  aparece el nombre de una organización, un repositorio o un host.
- **Volumen de agentes y skills por volumen.** Cinco agentes y dos skills que se
  usan, contra 68 y 584 que hay que mantener.

## Pendiente

**Ninguna.** Las cinco que quedaban se cerraron. Quedan acá con lo que resultó
ser cada una, porque en cuatro de los cinco casos lo que se encontró al
implementar era peor que lo que decía la nota:

1. **Clasificar el fallo de gate en código / base / entorno.** Hecho, en
   `claseDeFallo()`. Lo que apareció: `blameGate()` ya existía en `gate.mjs`
   distinguiendo base de tarea, y **nadie lo llamaba**. El entorno se decide
   primero y sin correr nada: si falta `npm`, correr el gate sobre la base
   tampoco va a funcionar. Y si la base no se puede correr, la clase es
   *indeterminada* y no *código* — asumir que es de la tarea cuando no se sabe
   le hace cargar un fallo ajeno.
2. **Corte por no convergencia.** Hecho, en `huellaDeFallo()` + `noConverge()`.
   Lo delicado no fue cortar: fue qué normalizar. Los colores, duraciones,
   rutas y shas se borran, pero **los conteos de tests se dejan tal cual**,
   porque pasar de tres a uno es la señal de avance más común y borrarla haría
   cortar trabajo que estaba llegando.
3. **Delimitar la entrada no confiable.** Hecho, en `prompt.mjs`. El vector real
   no es envolver: es que el contenido pueda **cerrar su propio bloque**.
   Envolver sin neutralizar eso es teatro — y el primer intento de
   neutralización tenía el bug, porque el reemplazo contenía la marca que
   reemplazaba. El texto del ticket no pasa por el motor (lo lee el agente), así
   que ahí la marca vive en `noxloop-plan.md`, con un test que la sostiene.
4. **Persistir el objeto del run rojo en el cuerpo del PR.** Hecho. Lo que
   apareció es más feo de lo que decía la nota: la evidencia del rojo **se
   validaba y se tiraba** — sólo sobrevivía `redVerified: true`. El mismo PR
   mostraba "exit 0" del gate y "creeme" del rojo.
5. **No acotar cobertura en silencio.** Hecho. Tres topes ya avisaban y no se
   tocaron (`truncar` del gate, el cupo del daemon, el `stoppedBy` del hito).
   Los que no: el informe de cada lente del abanico, el diagnóstico del
   planificador —el peor, porque es la causa de por qué no se pudo planificar—
   y **la paginación de GitHub**, que al llegar a `maxPages` con la última
   página llena dejaba tickets afuera sin una línea que lo dijera.

De la lista original, dos se habían resuelto antes por otro camino:

- **`needs-clarification` como resultado terminal de la planificación** quedó
  cubierto de hecho por el tablero, que deriva "necesita una persona" de tres
  fuentes que sí se escriben (ver D13 en `research.md`).
- **El test de campos sin consumidor** encontró seis cables cortados, y es el
  que hizo aparecer `identity`, `outOfScope`, `callsPerItem` y los otros tres.

## Lo que sigue

La lista autoritativa de diez no se pudo recuperar entera del transcript, así
que puede faltar alguna. Si aparece, se agrega **acá** y no a una conversación
— que es la razón por la que este archivo existe.
