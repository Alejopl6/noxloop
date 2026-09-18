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

Estas son las que quedaron sin hacer. **Advertencia de completitud**: la lista
autoritativa de diez vivía en la sesión y no se pudo recuperar entera del
transcript; las cinco de abajo son las que se pudieron reconstruir con
precisión. Si falta alguna, es exactamente por el motivo por el que este archivo
existe, y la próxima que aparezca se agrega acá y no a una conversación.

1. **Clasificar el fallo de gate en código / base / entorno.** Hoy un gate que
   falla es un gate que falla, y los tres se arreglan distinto: el de código lo
   arregla la tarea, el de base lo arregla rebasar, el de entorno no lo arregla
   ningún reintento —y es el que hoy consume los tres intentos para nada—.
2. **Corte por no convergencia.** Un presupuesto por bucle acota los intentos,
   pero no detecta el caso en que los tres intentos producen el *mismo* fallo.
   Repetir sin converger es distinto de estar cerca, y merece cortar antes.
3. **Delimitar la entrada no confiable.** El título y la descripción de un
   ticket, el diff, y el texto de salida de un gate entran a un prompt sin
   marcar como datos. Un ticket cuyo cuerpo diga "ignorá las instrucciones
   anteriores" es entrada de otra persona, y hoy nada lo separa.
4. **Persistir el objeto del run rojo en el cuerpo del PR.** El PR dice que el
   rojo se vio; no muestra la corrida. Quien revisa tiene que creer al estado en
   vez de leer la evidencia, y la evidencia ya existe en disco.
5. **No acotar cobertura en silencio.** Si un fan-out toma los primeros N, no
   reintenta, o muestrea, tiene que decir qué dejó afuera. Un recorte que no se
   registra se lee como "se cubrió todo".

De la lista original, dos ya se resolvieron por otro camino:

- **`needs-clarification` como resultado terminal de la planificación** quedó
  cubierto de hecho por el tablero, que deriva "necesita una persona" de tres
  fuentes que sí se escriben (ver D13 en `research.md`).
- **El test de campos sin consumidor** está hecho, y es el que encontró los seis
  cables cortados.
