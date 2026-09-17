// Fan-out de revision: cuatro lentes en paralelo sobre el diff de UNA tarea, y
// una sintesis que decide.
//
// DONDE CORRE, Y DONDE NO. Esto es un script de la tool `Workflow` de Claude
// Code, que necesita una sesion interactiva viva. `research.md` (decision D7)
// deja dicho que **no esta confirmado** que una sesion del SDK pueda invocar
// `Workflow`, y por eso la decision queda acotada al plugin: EL MOTOR NO DEPENDE
// DE ESTE ARCHIVO. En el camino headless el mismo fan-out se arma en JavaScript
// con varias `query()` concurrentes, que si esta confirmado. El motor no puede
// depender de una capacidad sin verificar; su fase REVIEW sigue siendo un solo
// revisor, y este script es lo que la mejora cuando hay terminal.
//
// SOLO PARA TIER `large`, Y LA GUARDA ES LO PRIMERO QUE CORRE. En `trivial`,
// `small` y `medium` son cuatro invocaciones y una quinta para sintetizarlas,
// sobre un diff que un solo revisor cubre entero: gasto sin retorno. Y ese es
// exactamente el gasto del que este proyecto viene — hay un antecedente medido
// de un hito que le dio el pipeline completo a 59 tareas, incluidas las que
// cambiaban una constante. El tier no es una sugerencia de intensidad: es el
// presupuesto.
//
// UN SOLO JUEZ. Las cuatro lentes REPORTAN; la sintesis DECIDE. Dos agentes con
// autoridad para vetar y sin jerarquia entre ellos producen hallazgos
// contradictorios sin nadie que resuelva, y el motor lee un solo marcador
// (`HALLAZGO BLOQUEANTE:`): con dos veredictos, cual gana depende de cual texto
// se leyo primero, que es una moneda al aire decidiendo si un PR vuelve a GREEN.
//
// EL `meta` TIENE QUE SER UN LITERAL PURO —sin variables, sin interpolacion—:
// la tool lo lee sin ejecutar el script.
//
// EL RESULTADO SALE POR `export default` Y NO POR UN `return` DE NIVEL SUPERIOR.
// Un `return` de nivel superior es un SyntaxError en un modulo ESM y `node
// --check` lo rechaza, que es la unica verificacion que este archivo puede
// recibir: no hay forma de "correrlo" en un test.

export const meta = {
  name: 'noxloop-review-fanout',
  description: 'Revision con fan-out de una tarea de tier large en noxloop: cuatro lentes en paralelo —correccion, seguridad, estilo, alcance— y una sintesis que emite el unico veredicto.',
  phases: [
    { title: 'Lentes', detail: 'cuatro revisores en paralelo, una mirada cada uno, solo lectura' },
    { title: 'Sintesis', detail: 'un solo revisor decide: bloqueante o limpio' },
  ],
}

// ------------------------------------------------- lo que completa quien lanza
// Esta tool no recibe argumentos de linea de comandos: la sesion que la invoca
// completa estas constantes con lo que devuelve `noxloop status <item> --json`.
// De ahi salen el tier, el worktree y el rango del diff; reconstruirlos de
// memoria es como se revisa el diff equivocado.

const ITEM = '<id del ticket>'
const TAREA = '<id de la tarea: T001>'
const TIER = '<tier de la tarea, tal como lo dice el estado>'
const WORKTREE = '<ruta del worktree de la tarea>'
const DIFF = '<el comando git que produce el diff de la tarea, p. ej. git diff main...HEAD>'
const ACEPTACION = '<el criterio de aceptacion de la tarea, textual>'

const CONTEXTO = `Revisas el diff de la tarea ${TAREA} del ticket ${ITEM} en
noxloop, que toma un ticket y devuelve un pull request.

El diff:
\`\`\`bash
cd ${WORKTREE} && ${DIFF}
\`\`\`

Criterio de aceptacion de la tarea:
${ACEPTACION}

**Solo lectura.** No edites, no corras el gate, no arregles nada. Si el hallazgo
exige codigo, el motor va a abrir una fase GREEN con el hallazgo como contexto —
arreglarlo desde una revision deja un cambio que nadie reviso.

Distingui lo **bloqueante** de lo **mejorable**. Marcar todo como bloqueante hace
que el recorrido agote su presupuesto en detalles y la tarea termine bloqueada
por estilo en vez de por un problema. Y decilo cuando no pudiste revisar algo:
quien lea el PR necesita saber que mirada ocurrio de verdad.`

// ------------------------------------------------------------------- esquemas

const HALLAZGO = {
  type: 'object',
  required: ['archivo', 'gravedad', 'que', 'porque'],
  additionalProperties: false,
  properties: {
    archivo: { type: 'string' },
    linea: { type: 'number' },
    gravedad: { type: 'string', enum: ['bloqueante', 'mejorable'] },
    que: { type: 'string' },
    porque: { type: 'string' },
  },
}

const LENTE = {
  type: 'object',
  required: ['lente', 'revisado', 'hallazgos'],
  additionalProperties: false,
  properties: {
    lente: { type: 'string' },
    // Que se miro de verdad. Un "se ve bien" sin esto no le sirve a nadie.
    revisado: { type: 'array', items: { type: 'string' } },
    hallazgos: { type: 'array', items: HALLAZGO },
    noPudeRevisar: { type: 'array', items: { type: 'string' } },
  },
}

const VEREDICTO = {
  type: 'object',
  required: ['veredicto', 'texto', 'bloqueantes', 'mejorables', 'revisado'],
  additionalProperties: false,
  properties: {
    veredicto: { type: 'string', enum: ['bloqueante', 'limpio'] },
    // `texto` es lo que la sesion devuelve al motor: cuando el veredicto es
    // bloqueante TIENE que empezar con `HALLAZGO BLOQUEANTE:`, porque ese
    // marcador es lo que el motor lee para devolver la tarea a GREEN. Un
    // hallazgo real sin el marcador se integra igual.
    texto: { type: 'string' },
    bloqueantes: { type: 'array', items: HALLAZGO },
    mejorables: { type: 'array', items: HALLAZGO },
    revisado: { type: 'array', items: { type: 'string' } },
    noRevisado: { type: 'array', items: { type: 'string' } },
  },
}

// --------------------------------------------------------------- las cuatro lentes
// El orden importa solo para leer el log: corren a la vez. Cada una mira UNA
// cosa, y ninguna emite veredicto.

const LENTES = [
  {
    label: 'correccion',
    encargo: `Tu lente es la **correccion**, y es la que mas se olvida: ¿el
criterio de aceptacion esta realmente cubierto?

No alcanza con que haya un test: que el test pruebe **eso**. Un test que pasa sin
ejercitar el criterio es peor que ninguno, porque parece cobertura y nadie vuelve
a mirar. Revisa tambien los casos de borde del criterio, el manejo de error, y si
el test fallaria de verdad contra el codigo viejo.`,
  },
  {
    label: 'seguridad',
    encargo: `Tu lente es la **seguridad**: input externo sin validar, secretos en
el codigo o en los logs, autorizacion, y superficie nueva expuesta.

Lo que entra por la red, por un archivo o por un argumento es hostil hasta que se
valida. Mira tambien lo que el diff AGREGA de superficie: un endpoint, una
variable de entorno, un permiso mas amplio del que la tarea necesitaba.`,
  },
  {
    label: 'estilo',
    encargo: `Tu lente es el **estilo y la arquitectura del repositorio**: sus
convenciones, sus limites de modulo, sus nombres.

Si el repositorio tiene un \`CLAUDE.md\` o una constitucion, **ganan sus reglas
sobre tu gusto**, y una regla del repositorio violada es bloqueante mientras una
preferencia tuya nunca lo es. Leelas antes de opinar.`,
  },
  {
    label: 'alcance',
    encargo: `Tu lente es el **alcance**: ¿el diff hace lo que la tarea dice, y
nada mas?

Lo que sobra pertenece a otra tarea del plan y llega sin haberse planificado: sin
criterio de aceptacion, sin test propio y sin nadie esperandolo. Mira si se
tocaron archivos fuera de los declarados, y si se amplio el alcance en silencio
en vez de registrarlo.`,
  },
]

// ---------------------------------------------------------------------- guarda

let lentes = []
let sintesis = null

if (TIER !== 'large') {
  log(`tier "${TIER}": el fan-out no corre. Cinco invocaciones sobre un diff que un solo revisor cubre entero es el gasto que este proyecto vino a cortar.`)
} else {
  // ------------------------------------------------------------------ Fase 1

  phase('Lentes')

  // `parallel` por la misma razon que el driver lanza el ReadySet junto: las
  // cuatro miradas son independientes, y encadenarlas ademas las contamina —la
  // segunda leeria los hallazgos de la primera y confirmaria en vez de mirar.
  lentes = await parallel(
    LENTES.map((l) => () => agent(`${CONTEXTO}

${l.encargo}

Devolve tus hallazgos con \`lente: "${l.label}"\`. **No des un veredicto y no
digas si la tarea puede integrarse**: eso lo decide la sintesis, con las cuatro
lentes delante. Tu trabajo es que lo que viste quede dicho con archivo, linea y
motivo, para que la decision se pueda tomar sin volver a mirar el diff.`,
      { label: `lente:${l.label}`, phase: 'Lentes', schema: LENTE, effort: 'high' })),
  )

  const vivas = lentes.filter(Boolean)
  for (const l of vivas) {
    const b = l.hallazgos.filter((h) => h.gravedad === 'bloqueante').length
    log(`${l.lente}: ${l.hallazgos.length} hallazgo(s), ${b} bloqueante(s)`)
  }

  // Una lente caida no invalida la revision, pero tampoco se tapa: la sintesis
  // tiene que decir que esa mirada no ocurrio. Una revision que se declara
  // completa sin haber mirado la seguridad es el verde inventado con otro
  // nombre.
  const caidas = LENTES.filter((_, i) => !lentes[i]).map((l) => l.label)
  if (caidas.length) log(`lentes que no devolvieron nada: ${caidas.join(', ')}`)

  // ------------------------------------------------------------------ Fase 2

  phase('Sintesis')

  sintesis = await agent(`${CONTEXTO}

Sos **el revisor que decide**, y el unico. Cuatro lentes miraron este diff y te
dejaron sus hallazgos; vos emitis el veredicto.

${vivas.map((l) => `## lente: ${l.lente}
revisado: ${l.revisado.join('; ') || '(no lo dijo)'}
${l.hallazgos.length
  ? l.hallazgos.map((h) => `- [${h.gravedad}] ${h.archivo}${h.linea ? `:${h.linea}` : ''} — ${h.que} (${h.porque})`).join('\n')
  : '- sin hallazgos'}
${l.noPudeRevisar?.length ? `no pudo revisar: ${l.noPudeRevisar.join('; ')}` : ''}`).join('\n\n')}

${caidas.length ? `Lentes que NO devolvieron nada, y que por lo tanto no ocurrieron: ${caidas.join(', ')}. Declaralas en \`noRevisado\`.` : ''}

Tu trabajo, en este orden:

1. **Verifica los bloqueantes antes de repetirlos.** Abri el archivo y la linea.
   Una lente puede reportar un bloqueante que el diff ya resuelve tres lineas mas
   abajo, y un bloqueante falso cuesta una vuelta entera de GREEN y un intento de
   presupuesto que no vuelve.
2. **Unifica los duplicados.** Cuatro lentes sobre el mismo diff ven la misma
   cosa desde cuatro lados; que se reporte una vez, con el motivo mas fuerte.
3. **Decidi.** \`veredicto: "bloqueante"\` si queda al menos un bloqueante
   verificado; \`"limpio"\` si no. Lo mejorable NO bloquea: se dice y se sigue.
4. **Escribi \`texto\`**, que es lo que va a leer el motor:
   - si el veredicto es bloqueante, tiene que **empezar** con
     \`HALLAZGO BLOQUEANTE:\` seguido del detalle concreto —archivo, linea, y por
     que bloquea—. Ese marcador es lo que devuelve la tarea a GREEN; sin el, el
     hallazgo existe y el codigo se integra igual;
   - si esta limpio, deci **que se reviso y que no**. "Se ve bien" no le sirve a
     nadie: quien lea el PR necesita saber que mirada ya ocurrio.

No implementes nada, y no ablandes un hallazgo para que la tarea avance.`,
    { label: 'sintesis', phase: 'Sintesis', schema: VEREDICTO, effort: 'high' })

  log(`veredicto: ${sintesis.veredicto} (${sintesis.bloqueantes.length} bloqueante(s), ${sintesis.mejorables.length} mejorable(s))`)
}

const resultado = {
  item: ITEM,
  tarea: TAREA,
  tier: TIER,
  corrio: TIER === 'large',
  lentes: lentes.filter(Boolean),
  veredicto: sintesis?.veredicto ?? null,
  texto: sintesis?.texto ?? null,
  sintesis,
}

export default resultado
