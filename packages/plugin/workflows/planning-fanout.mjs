// Fan-out de planificacion: analisis -> planificacion -> materializacion, con
// la salida de cada etapa validada por su `schema`.
//
// DONDE CORRE, Y DONDE NO. Esto es un script de la tool `Workflow` de Claude
// Code, que necesita una sesion interactiva viva. `research.md` (decision D7)
// deja dicho que **no esta confirmado** que una sesion del SDK pueda invocar
// `Workflow`, y por eso la decision queda acotada al plugin: EL MOTOR NO DEPENDE
// DE ESTE ARCHIVO. En el camino headless el mismo fan-out se arma en JavaScript
// con varias `query()` concurrentes, que si esta confirmado. Un motor que
// dependiera de una capacidad sin verificar se rompe en el primer recorrido que
// corre sin terminal, que son todos los del daemon.
//
// QUE COMPRA SOBRE UNA SOLA SESION. No velocidad: son tres etapas en serie
// porque cada una necesita lo que decidio la anterior. Lo que compra es el
// handoff. Hoy el plan viaja entre agentes como prosa y el que la recibe la
// interpreta; con `schema` por etapa vuelve como objeto validado, y un plan al
// que le falta `targetFiles` se cae ACA en vez de caerse en el primer `Edit` de
// la tarea, cuando ya hay una rama y un worktree abiertos.
//
// EL `meta` TIENE QUE SER UN LITERAL PURO —sin variables, sin interpolacion—:
// la tool lo lee sin ejecutar el script.
//
// EL RESULTADO SALE POR `export default` Y NO POR UN `return` DE NIVEL SUPERIOR.
// Un `return` de nivel superior es un SyntaxError en un modulo ESM y `node
// --check` lo rechaza, que es la unica verificacion que este archivo puede
// recibir: no hay forma de "correrlo" en un test. Un script que no pasa el
// unico control que tiene no se distingue de uno roto.

export const meta = {
  name: 'noxloop-planning-fanout',
  description: 'Fan-out de planificacion de noxloop: analisis del ticket, plan como DAG de tareas, y materializacion del plan donde el motor lo espera. Una etapa, un esquema.',
  phases: [
    { title: 'Analisis', detail: 'el ticket, sus criterios, los repos que toca y con que evidencia' },
    { title: 'Planificacion', detail: 'el DAG de tareas atomicas, una por repositorio' },
    { title: 'Materializacion', detail: 'el plan escrito donde el motor lo espera, y validado' },
  ],
}

// ------------------------------------------------- lo que completa quien lanza
// Esta tool no recibe argumentos de linea de comandos: la sesion que la invoca
// completa estas tres constantes antes de lanzarla.

const ITEM = '<id del ticket>'
const PLAN_OUT = '<ruta donde el motor espera el plan: el --out de /noxloop-plan>'
const REPO_NOTAS = '<una linea de contexto del ticket, o cadena vacia>'

const CONTEXTO = `Estas planificando el ticket ${ITEM} para noxloop, que toma un
ticket y devuelve un pull request.

Sos el unico punto del flujo donde todavia hay una persona mirando: una
suposicion tuya se convierte en codigo, PR y tickets hijos antes de que nadie la
revise.

Reglas duras del proyecto, que ningun plan puede violar:
- El test va primero, y lo fuerza un hook: toda tarea con logica lleva sus
  \`testFiles\`. Si de verdad no lleva test, va sin ellos y CON el motivo en
  \`noTestsBecause\`.
- Una tarea = un repositorio. Si el cambio cruza repositorios, son dos tareas con
  una dependencia entre ellas, y el que publica el contrato va antes.
- \`targetFiles\` y \`testFiles\` NO son documentacion: el guardian de alcance
  bloquea las escrituras fuera de esa lista. Un archivo inventado traba la tarea
  en el primer \`Edit\`.
- Una tarea es lo que cabe en un PR revisable: menos de 400 lineas de diff.
- Lo ambiguo se pregunta, no se rellena.

${REPO_NOTAS}`

// ------------------------------------------------------------------- esquemas
// Cada etapa declara la forma exacta de lo que devuelve. `additionalProperties:
// false` no es rigor decorativo: sin eso, una etapa puede devolver un campo con
// el nombre casi bien —`testFile` por `testFiles`— y la etapa siguiente lo lee
// como ausente.

const ANALISIS = {
  type: 'object',
  required: ['criterios', 'repoScope', 'evidence', 'preguntas'],
  additionalProperties: false,
  properties: {
    criterios: { type: 'array', items: { type: 'string' } },
    repoScope: { type: 'array', items: { type: 'string' } },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        required: ['repo', 'why'],
        additionalProperties: false,
        properties: { repo: { type: 'string' }, why: { type: 'string' } },
      },
    },
    restricciones: { type: 'array', items: { type: 'string' } },
    outOfScope: { type: 'array', items: { type: 'string' } },
    // Las preguntas son la salida mas importante de esta etapa: una sola
    // detiene el pipeline. Ver la guarda de mas abajo.
    preguntas: { type: 'array', items: { type: 'string' } },
  },
}

const TAREA = {
  type: 'object',
  required: ['id', 'repo', 'title', 'acceptance', 'targetFiles', 'testFiles', 'tier', 'dependsOn', 'dependencyKind'],
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    repo: { type: 'string' },
    title: { type: 'string' },
    acceptance: { type: 'string' },
    targetFiles: { type: 'array', items: { type: 'string' } },
    testFiles: { type: 'array', items: { type: 'string' } },
    noTestsBecause: { type: 'string' },
    tier: { type: 'string', enum: ['trivial', 'small', 'medium', 'large'] },
    specialist: { type: 'string' },
    dependsOn: { type: 'array', items: { type: 'string' } },
    dependencyKind: { type: 'string', enum: ['hard', 'soft'] },
  },
}

const PLAN = {
  type: 'object',
  required: ['repoScope', 'evidence', 'outOfScope', 'tasks', 'lectura'],
  additionalProperties: false,
  properties: {
    repoScope: { type: 'array', items: { type: 'string' } },
    evidence: ANALISIS.properties.evidence,
    outOfScope: { type: 'array', items: { type: 'string' } },
    tasks: { type: 'array', items: TAREA },
    // La lectura en prosa del orden y del riesgo: que va primero, que puede ir
    // en paralelo, y donde esta la dependencia que serializa todo.
    lectura: { type: 'string' },
  },
}

const MATERIALIZACION = {
  type: 'object',
  required: ['archivo', 'tareas', 'valido', 'salida'],
  additionalProperties: false,
  properties: {
    archivo: { type: 'string' },
    tareas: { type: 'number' },
    valido: { type: 'boolean' },
    salida: { type: 'string' },
    problemas: { type: 'array', items: { type: 'string' } },
  },
}

// ------------------------------------------------------------------- Etapa 1

phase('Analisis')

const analisis = await agent(`${CONTEXTO}

Etapa 1 de 3: **analiza el ticket**. No escribas ningun archivo y no planifiques
todavia.

1. Lee el ticket completo: titulo, descripcion, criterios de aceptacion y
   comentarios. El motor ya verifico que tiene criterios; tu trabajo es ver si se
   pueden convertir en tests que fallen. Un criterio que no se puede escribir
   como test es una pregunta, no un criterio.
2. Resuelve que repositorios toca y **con que evidencia**: un archivo concreto,
   un contrato, una arista del grafo. "Probablemente toque X" no es evidencia y
   va a \`preguntas\`.
3. Contrasta con las reglas de cada repositorio —su \`CLAUDE.md\`, su
   constitucion si la tiene—. Ahi estan las restricciones que invalidan un plan
   entero, y sale mas barato descubrirlas ahora que con quince tareas encima.

Si un criterio tiene dos lecturas razonables, **no elijas una**: ponela en
\`preguntas\` textual. Una sola pregunta detiene el pipeline a proposito, que es
mas barato que un plan completo sobre una suposicion.`,
  { label: 'analisis', phase: 'Analisis', schema: ANALISIS, effort: 'high' })

log(`analisis: ${analisis.repoScope.join(', ') || 'sin repos'} — ${analisis.preguntas.length} pregunta(s)`)

// LA GUARDA QUE JUSTIFICA PARTIR ESTO EN ETAPAS. Con una sola sesion, la
// ambiguedad se resuelve sola a mitad de camino y nadie se entera: el plan sale
// completo y coherente sobre una eleccion que nunca se aprobo. Aca la
// planificacion no arranca.
let plan = null
let materializacion = null
const problemas = []

if (analisis.preguntas.length > 0) {
  log('el pipeline se detiene: hay ambiguedades sin responder, y rellenarlas costaria un plan entero')
  for (const p of analisis.preguntas) log(`  ? ${p}`)
} else {
  // ----------------------------------------------------------------- Etapa 2

  phase('Planificacion')

  plan = await agent(`${CONTEXTO}

Etapa 2 de 3: **el plan**, a partir del analisis ya validado. No lo vuelvas a
hacer y no amplies el alcance que quedo fijado.

Criterios de aceptacion:
${analisis.criterios.map((c) => `- ${c}`).join('\n')}

Repositorios en alcance, con su evidencia:
${analisis.evidence.map((e) => `- ${e.repo}: ${e.why}`).join('\n')}

Fuera de alcance, y sigue fuera:
${(analisis.outOfScope || []).map((o) => `- ${o}`).join('\n') || '- (nada declarado)'}

Restricciones de los repositorios:
${(analisis.restricciones || []).map((r) => `- ${r}`).join('\n') || '- (ninguna encontrada)'}

Parti el trabajo en tareas atomicas y devolve el DAG. Lo que decide si el
recorrido avanza o se atasca:

- **\`dependencyKind\`**: \`hard\` si la tarea no compila ni pasa sin la anterior
  INTEGRADA; \`soft\` si puede asumir el contrato y declararlo en el PR. \`hard\`
  de mas serializa el recorrido entero; \`soft\` de mas produce PRs que no
  compilan. **Ante la duda, \`hard\`**: un recorrido lento se nota y se corrige,
  un PR roto contamina la rama.
- **\`tier\`** abarata la revision, el modelo y el alcance del gate. Nunca el paso
  RED, que corre en los cuatro.
- **No inventes archivos.** Si no sabes donde va algo, leelo. Un \`targetFiles\`
  inventado traba la tarea en el primer \`Edit\`, y un \`testFiles\` inventado la
  traba antes.
- **Los huecos del gate**: si un repositorio declara que no tiene con que
  verificar, no le asignes una tarea con logica de negocio — se atascaria hasta
  agotar su presupuesto sin que nada la pueda declarar verde.

\`lectura\` es la lectura en prosa del orden y del riesgo: que va primero, que
puede ir en paralelo, y donde esta la dependencia que serializa todo. Es lo que
va a leer la persona que aprueba.`,
    { label: 'planificacion', phase: 'Planificacion', schema: PLAN, effort: 'high' })

  log(`plan: ${plan.tasks.length} tarea(s) en ${plan.repoScope.join(', ')}`)

  // Dos comprobaciones deterministas que ningun `schema` puede expresar, y que
  // valen mas baratas aca que como una tarea atascada:
  //   - una dependencia hacia un id que no existe en el plan: el scheduler no
  //     la puede satisfacer nunca, asi que esa tarea y las suyas quedan
  //     `unreachable` sin que nada haya fallado de verdad;
  //   - una tarea sin test y sin motivo: choca con el hook de orden en la
  //     primera escritura, que es el principio I y no se negocia por tier.
  const ids = new Set(plan.tasks.map((t) => t.id))
  for (const t of plan.tasks) {
    for (const d of t.dependsOn) {
      if (!ids.has(d)) problemas.push(`${t.id} depende de ${d}, que no existe en el plan`)
    }
    if (t.testFiles.length === 0 && !t.noTestsBecause) {
      problemas.push(`${t.id} no declara test ni motivo para no tenerlo`)
    }
  }

  if (problemas.length > 0) {
    log('el plan no se materializa: tiene problemas que trabarian tareas en vuelo')
    for (const p of problemas) log(`  x ${p}`)
  } else {
    // --------------------------------------------------------------- Etapa 3

    phase('Materializacion')

    materializacion = await agent(`${CONTEXTO}

Etapa 3 de 3: **materializa el plan**. No lo rediseñes: ya esta aprobado en su
forma, y cambiarlo aca seria cambiar el alcance sin que nadie lo apruebe.

Escribi este plan, tal cual, en \`${PLAN_OUT}\`:

\`\`\`json
${JSON.stringify(plan, null, 2)}
\`\`\`

Dos cosas, y nada mas:

1. Escribilo en esa ruta exacta. Si el plan no esta ahi, el motor reporta que la
   fase termino sin plan — y no hay lugar donde ir a buscarlo.
2. Verificalo: que el archivo exista, que sea JSON valido al releerlo, y que
   tenga la misma cantidad de tareas. Pega la salida real de esa verificacion en
   \`salida\`.

No escribas el campo \`item\`: lo fija el motor, y es lo que mantiene el recorrido
indexado por el ticket de verdad.

**No crees tickets hijos.** Los materializa el motor, contra el gestor y con
idempotencia: crearlos desde aca produce duplicados que despues nadie sabe cual
seguir.`,
      { label: 'materializacion', phase: 'Materializacion', schema: MATERIALIZACION, effort: 'medium' })

    log(`${materializacion.archivo}: ${materializacion.tareas} tarea(s), ${materializacion.valido ? 'valido' : 'NO VALIDO'}`)
  }
}

const resultado = {
  item: ITEM,
  detenidoEn: analisis.preguntas.length ? 'analisis' : problemas.length ? 'planificacion' : null,
  preguntas: analisis.preguntas,
  problemas,
  analisis,
  plan,
  materializacion,
}

export default resultado
