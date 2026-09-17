---
description: "Prepara el recorrido de un hito —rama, orden y exclusiones— y para. Con --go lo lanza: una aprobación, N historias, N pull requests sobre una sola rama."
argument-hint: "<item> [--go] [--repo <repo>] [--max-items N] [--max-cost USD] [--only <ids>] [--skip <ids>]"
---

# /noxloop-milestone — una aprobación, N historias

Argumentos: `$ARGUMENTS`.

```bash
noxloop milestone <item>        # prepara y para: el recorrido propuesto
noxloop milestone <item> --go   # lo lanza
```

## Prepara y para

Sin `--go` no ejecuta nada **y no escribe nada**: lee la épica o la feature,
resuelve el orden con lo que el gestor declara, declara qué queda afuera, y
muestra el recorrido. Es la forma que el escenario 5 del quickstart llama el
dry-run, y su invariante es verificable: correrla contra un `NOXLOOP_HOME` vacío
lo deja vacío.

**Esa frontera es el único punto de aprobación humana del hito entero.** No es
una pantalla de confirmación: es *la* revisión. Con nueve historias, pasar una
por una por `/noxloop-plan` serían nueve aprobaciones —nueve momentos en los que
alguien mira y dice sí—, y el hito existe para cambiarlas por una. Después de
esa, corre hasta que se queda sin historias, sin presupuesto o sin camino.

Presentá el recorrido tal cual sale y **esperá una respuesta**. Lo que hay que
leer antes de decir sí, y en este orden:

- **la rama del hito y de qué nace**, en qué repositorio;
- **el orden y de dónde sale**: `dependencias-del-gestor` significa que el gestor
  las afirma; `serializado` significa que no las tiene y el motor no las
  inventó, así que el orden es el que le diste;
- **el paralelismo**: cuántas historias van a estar en vuelo a la vez;
- **las excluidas, con su motivo**, y las **dependencias externas** al hito, que
  son las que nadie de adentro puede resolver;
- **el techo de gasto**, que es del hito y no de cada invocación.

## Las tres decisiones que van antes, no sobre la marcha

**1. Qué historias se omiten, y por qué** — `--skip <ids>`.

Una historia que depende de algo que ningún driver puede resolver —un permiso
que todavía no existe, una decisión de producto, un item que no es hijo de este
hito— no mejora por entrar al recorrido: se bloquea a mitad, deja una rama y un
worktree a medias, y arrastra como `unreachable` a las que venían detrás. El
arrastre transitivo lo calcula el motor y lo declara; el motivo lo escribís vos,
y "la sacamos" no es un motivo: dentro de un mes, el motivo es lo único que
explica por qué el hito cerró con ocho de nueve.

**2. El orden que el grafo no puede deducir** — declarado en el gestor, o
`--only <ids>` para una corrida.

El motor ordena por las dependencias que el gestor declara, y si el gestor no
las tiene, serializa y lo dice. Lo que ningún grafo ve es el **costo de hacer
algo tarde**. El caso típico es un rename: nada depende de él, así que el grafo
lo pone donde caiga; si cae al final, las historias intermedias trabajan sobre
rutas que van a cambiar igual y cada una paga el conflicto dos veces —una al
escribir, otra al rebasar—. Si hay una historia así, decilo antes de aprobar y
pedila primero. Preferí declararla como dependencia en el gestor: ahí el orden
es persistente y lo ve la corrida siguiente, mientras `--only` vale para una
sola.

**3. En qué repositorio vive la rama del hito** — `--repo <repo>`.

Es **una** rama, y ahí se acumula todo el trabajo del hito: cada historia
integra sobre ella, y los PRs de las historias apuntan a ella y no a la base
—así la revisión humana recibe una sola rama y N PRs revisables por separado—.
Con más de un repositorio declarado el motor **no elige**: pide `--repo`.
Elegirlo por orden alfabético sería elegirlo por casualidad, y equivocarse ahí
se descubre cuando ya hay historias integradas en el lugar equivocado.

## Estrenalo con `--max-items 1`

```bash
noxloop milestone <item> --go --max-items 1
```

Arranca una sola historia y se detiene. Se mira una historia **completa** —su
plan, su PR, su diff, cómo quedó la rama del hito— antes de confiarle las otras
ocho. Lo que se está probando no es el código de esa historia: es si el
recorrido de este hito, en este repositorio, produce algo revisable.

Después, `--go` sin el tope continúa desde donde quedó: relanzar no repite las
historias integradas ni devuelve presupuesto consumido.

## El alcance del riesgo, dicho antes de lanzar

El hito integra cada historia a su rama **sin esperar revisión humana**. Es a
propósito —parar en cada historia es el flujo de `/noxloop-plan` y
`/noxloop-run`, y el hito existe para no pararse—, pero es un precio, y hay que
nombrarlo antes de apretar el botón y no después:

- un error en la historia 2 **viaja** hacia la 3, la 4 y la 5, porque cada una
  arranca sobre trabajo ya integrado;
- una revisión que llega al final no ve el error: ve N historias encima del
  error;
- lo único que se interpone es el gate de cada historia. Si el repositorio
  declara huecos de verificación, el hito los hereda multiplicados por N.

De ahí sale el criterio de qué darle a un hito: historias cuyo gate signifique
algo en ese repositorio. Y de ahí sale `--max-cost`, que es del hito: un techo
por invocación corta a mitad de una historia y el reintento cuesta más de lo que
el techo ahorró.

Lo que **no** cambia por ser un hito: no mergea a la base, no despliega, no hace
force push, y no hay bandera que lo habilite. Al final hay una rama del hito y N
PRs abiertos. La decisión sigue siendo de una persona.

## Cuando se detiene a preguntar

Es el caso **sano**, no un fallo. Una historia con un criterio de dos lecturas
razonables se detiene, la pregunta queda como nota y la historia espera —el
reporte la marca `[espera respuesta]`—. Rellenar la ambigüedad sería peor: el
hito seguiría, y la elección arbitraria llegaría integrada en la rama con tres
historias encima.

La respuesta va **a los dos lados**:

1. **Al ticket de la historia**, que es la fuente de verdad. Un comentario en el
   gestor, con la decisión y quién la tomó.
2. **A las notas del recorrido**, que es por donde la lee la replanificación: la
   nota es lo que reabre la historia y lo que llega a la fase que preguntó.

Registrar solo en las notas es el atajo, y se paga en diferido: el recorrido
sigue bien, y quien abra el ticket dentro de un mes —para entender por qué el
código quedó así— no encuentra la decisión en ninguna parte. Registrar solo en
el ticket falla en la otra dirección: la planificación no la lee y la historia
se queda esperando una respuesta que ya existe.

Y no la contestes vos si no es tuya. Una respuesta inventada acá se convierte en
código, en PR y en tickets hijos antes de que nadie la revise.

## Cuando termina

El reporte sale sin interpretación y sin tocar el gestor: tiene que poder leerse
con la red caída. Presentalo tal cual. Lo que importa:

- **`blocked` frente a `unreachable`**, que son dos cosas distintas y es la
  distinción que hace útil el reporte: la bloqueada falló y tiene una causa que
  hay que mirar —textual, sin resumir: "falla el build" no es accionable—; la
  inalcanzable **nunca pudo intentarse** porque dependía de otra, y lo que hay
  que destrabar está en otro lado.
- **`stoppedBy`**: por qué se detuvo. Alcanzar el techo de gasto o el tope de
  historias no es un fallo; `sinAvance` sí pide mirar.
- **`spent`**, y los **PRs**: los integrados y los que quedaron abiertos sin
  integrar, con su causa.

## No negociables

- **No relances un hito "a ver si esta vez sale".** Una historia bloqueada tiene
  una causa; sin leerla, relanzar gasta presupuesto para volver al mismo lugar.
- **Nunca decidas una ambigüedad para desatascar el recorrido.** Un hito
  detenido esperando una respuesta es un éxito del mecanismo.
- **Nunca apruebes un recorrido cuyo orden no entendés.** El orden es lo que ya
  no se revisa después: se revisa el resultado, con todo integrado encima.
