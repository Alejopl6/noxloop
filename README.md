# noxloop

**Un ticket entra, un pull request sale.**

noxloop toma una épica, una feature, una historia o una tarea del gestor de
tickets que ya usás, arma el plan de trabajo, y lo ejecuta en paralelo hasta
dejar pull requests abiertos. No mergea. No despliega. Ahí termina, a propósito.

```
   ticket asignado ──┐
                     ├──▶  plan (DAG de tareas)  ──▶  ejecución paralela  ──▶  PR abierto
   @noxloop ─────────┘                                      │
                                                            ├─ T1 ─┐
                                                            ├─ T2 ─┼─▶ cola de integración
                                                            └─ T3 ─┘   (rebase, verifica, integra)
```

> **Estado: completo para el flujo que promete.** 650 tests, typecheck y
> validación de esquemas en verde. Asignar un ticket —o mencionarlo— en GitHub
> Issues, Linear o Azure DevOps es todo lo que hay que hacer: hay un test de
> punta a punta que recorre el cableado real y solo simula el modelo y el forge.
> Lo que queda abierto está [declarado, no escondido](#huecos-declarados).

---

## Qué lo hace distinto

**El test existió y falló antes del código, y se puede comprobar sin leer el motor.**
Cada tarea deja dos commits, en este orden:

```
$ git log --format='%h %s' --reverse <rama>
a1b2c3d  test(app): ocultar la columna costo (T001, H-42)
e4f5g6h  feat(app): ocultar la columna costo (T001, H-42)
```

**El TDD no es una preferencia: es un hook.** Ningún archivo de producción se
puede escribir antes de que exista un test que falló y que alguien vio fallar.
No lo pide un prompt — lo bloquea un hook `PreToolUse` que consulta el estado en
disco. Un prompt que pide TDD funciona en las dos primeras iteraciones y deja de
funcionar en la tercera; un hook no se cansa. Y no hay tier, bandera ni modo
rápido que lo apague.

**El veredicto es un exit code.** Una tarea cumple si y solo si existe el objeto
del gate con su código de salida real. "Se ve bien" no es evidencia, y el estado
rechaza la transición sin ella. El modo de fallo que esto mata tiene nombre: el
verde inventado, que es peor que un rojo porque un rojo se arregla y un verde
falso se mergea.

**El paralelismo lo gobierna el DAG.** Dos tareas corren a la vez si y solo si
no hay arista de dependencia entre ellas. Cada una en su propio worktree, y la
integración pasa por una cola serial que rebasa sobre la punta y vuelve a
verificar. Nadie ramifica sobre trabajo no integrado — el proyecto anterior
encadenó catorce ramas una sobre otra y las tres últimas llegaron en conflicto.

**La autonomía termina en el PR abierto.** No mergea a una rama protegida, no
despliega, no hace force push. Lo impide un hook que corre dentro de cada
subproceso, también en los que nadie está mirando. Un recorrido que llega a PR
abierto con tres tareas bloqueadas y un diagnóstico honesto es un éxito; uno que
llega a PR mergeado sin revisión humana es un incidente, aunque el código esté
bien.

**Hay un tablero, y es un lector.** `noxloop board` levanta en `127.0.0.1` una
vista de todo: qué hay por empezar, qué corre ahora, qué dejó PR, qué se integró,
qué está bloqueado — y arriba, separado del resto, **lo que necesita que una
persona conteste**, con la causa textual y no un resumen. No tiene base de datos
ni backend: lee `$NOXLOOP_HOME` y **no escribe una sola cosa**, porque
`state.mjs` es el único escritor del estado y un tablero con permiso de
escritura sería el segundo. Hay un test que mide el disco antes y después.

**El gestor de tickets es un detalle, y está probado que lo es.** El motor no
sabe qué hay del otro lado: le pregunta capacidades y degrada de forma visible
cuando algo no está. Agregar un gestor es agregar un archivo.

---

## Instalación

```bash
git clone https://github.com/<tu-usuario>/noxloop && cd noxloop
npm install
cp examples/noxloop.config.json ./noxloop.config.json
$EDITOR ./noxloop.config.json
npx noxloop doctor
```

`doctor` te dice exactamente qué falta: qué repositorio no encontró, qué remote
no coincide, qué credencial no está en el entorno, qué estado canónico no
mapeaste. No inventa valores por defecto — un default razonable para la ruta de
un repositorio es cómo se trabaja en el repositorio equivocado.

El ejemplo viene apuntando al **proveedor falso**, que no toca ninguna red: se
puede ver el motor funcionando antes de poner una credencial.

### Como plugin de Claude Code

```
/plugin marketplace add <tu-usuario>/noxloop
/plugin install noxloop
```

---

## Proveedores

| Gestor | Jerarquía | Dependencias | Estado |
|---|---|---|---|
| **Azure DevOps** | Parent/Child nativo | `Predecessor`/`Successor` | ✅ las 10 capacidades |
| **Linear** | `parent` / sub-issues | relaciones `blocks` | ✅ |
| **GitHub Issues** | sub-issues | sin relación nativa → serializa y lo declara | ✅ con su camino degradado |
| **fake** | sí | sí | ✅ listo (tests, y ejemplo mínimo) |
| Jira, y cualquier otro | — | — | un archivo en `providers/` |

Agregar uno son cinco pasos y ninguno toca el motor: copiar
`providers/fake/index.mjs`, declarar `capabilities()` con la verdad —empezar con
casi todo en `false` es correcto y produce un recorrido que funciona—, escribir
el mapa de tipos y de estados, correr la suite de contrato hasta verde, y
apuntar `provider.module` en la configuración. Detalle en
[`providers/README.md`](providers/README.md) y en
[el contrato](specs/001-parallel-ticket-orchestrator/contracts/provider.md).

Si hace falta un cambio en el motor para soportar un gestor, la interfaz está
mal: se arregla la interfaz, no se ramifica el motor con un `if`.

---

## Cómo está armado

```
packages/engine/     el motor: estado, scheduler, cola de integración, gates, hooks
packages/plugin/     el plugin de Claude Code: comandos, agentes, skills
providers/           plano, a propósito: un archivo = un gestor de tickets
examples/            configuración lista para copiar
specs/               el ciclo spec-kit completo de cada cambio
```

Dos reglas de estructura que se verifican con tests, no con revisión:

- **Ningún nombre propio en el motor.** Organizaciones, repositorios, hosts,
  comandos y ramas viven en configuración validada contra JSON Schema. Un test
  busca nombres propios en `packages/engine/src/**` y falla si encuentra alguno.
- **Solo `state.mjs` escribe el estado de una tarea.** Otro test recorre el
  motor buscando asignaciones a `.status` fuera de ahí. Un estado escrito por
  otro archivo se saltearía las guardas, que es todo lo que sostiene el
  principio del exit code.

Cero dependencias de runtime obligatorias: el motor corre con Node y git. El
Claude Agent SDK es opcional, y si falta, se degrada a invocar el CLI y lo dice.
Incluso el validador de JSON Schema es propio — esto se instala para orquestar
los repositorios de otra persona, y cada dependencia es superficie que esa
persona no eligió.

---

## Verificación

```bash
npm test          # 849 tests: unitarios, contrato de proveedor, integración, concurrencia y guardas de constitución
npm run typecheck # tsc --checkJs, sin paso de build
npm run validate  # la configuración de ejemplo contra su esquema
```

Los tests del motor corren **sin red, sin credenciales y sin modelo**: el
paralelismo, la cola de integración y la máquina de estados se prueban contra el
proveedor falso y repositorios git desechables.

---

## El plan de trabajo

Todo el diseño está en
[`specs/001-parallel-ticket-orchestrator/`](specs/001-parallel-ticket-orchestrator/):
especificación, plan, decisiones con su medición detrás, modelo de datos,
contratos y 84 tareas en 8 fases.

| Fase | Qué entrega | Estado |
|---|---|---|
| 1. Setup | monorepo, CI, esquemas | ✅ 7/7 |
| 2. Fundacional | configuración, estado con guardas, gates, hooks, worktrees, lock, contrato de proveedor, CLI | ✅ 22/22 |
| 3. US1 — un ticket, un PR | runner con el SDK, planificador, driver del ciclo TDD, commits, PRs, plugin | ✅ 14/14 |
| 4. US2 — paralelismo | scheduler, cola, driver concurrente, hitos, fan-out | ✅ 12/12 |
| 5. US3 — proveedores | Azure DevOps, GitHub, Linear, degradación, docs | ✅ 9/9 |
| 6. US4 — retomar | reanudación, worktrees huérfanos, destrabar | ✅ 7/7 |
| 7. US5 — adoptabilidad | ADOPTING, PARALLELISM, AUTONOMY, MIGRATING | ✅ 7/7 |
| 5. US3 — proveedores | Azure DevOps, GitHub, Linear | 9 tareas |
| 8. Pulido | daemon, disparo por asignación y mención | ✅ 6/6 |
| Descubiertas | 32 huecos que el plan no había previsto | ✅ 29 cerrados, 3 declarados |

Los ocho escenarios de `quickstart.md` están corridos y su resultado registrado
al pie de ese archivo. Los escenarios 4, 5 y 8 quedaron verificados en su mitad
offline: cerrarlos del todo necesita una credencial de un gestor real, no más
código.

**T035 y T080 están cerradas**, y cómo se cerraron dice más que el hecho de que
lo estén: una revisión adversarial rompió la promesa del límite de autonomía. De
57 grafías de comando prohibido, **45 la sortearon** —bastaba un prefijo (`env`,
`bash -c`), una comilla (`git push origin "main"`) o un intérprete (`node -e`)—
y una se ejecutó contra un remoto real moviéndole la rama principal.

El arreglo no fue alargar la lista, que es cómo se construye un verde inventado.
Fue cambiar el punto de aplicación: **dentro de una tarea, el shell es denegar
por defecto**, con una lista de permitidos derivada de lo que el repositorio
declara necesitar. La constitución se enmendó a 1.1.0 para decirlo, porque
contradice "ante la duda, permitir" — que ahora queda acotado a las sesiones
donde hay una persona del otro lado.

Después del cambio: de 28 grafías prohibidas pasan **0**, y de 8 comandos
legítimos se bloquean **0**.

---

## Huecos declarados

Uno, y es deliberado. Está en `tasks.md` como T116: **el merge local en dos
tiempos** (`git checkout main` y después `git merge task/x`) no lo frena el hook.
No se cerró porque bloquear `checkout` es el sobre-bloqueo que ese hook ya
cometió una vez, y la salida a lo compartido sí está cerrada: publicarlo exige un
`git push origin main`, que está probado bloqueado.

Los otros dos que estaban declarados se cerraron. T114: `provider.options` ahora
se valida contra el `optionsSchema` que declara cada proveedor, con
`additionalProperties: false` y un test que falla si el código lee una opción que
el esquema no describe —la premisa de que "ninguno de los tres lo usaría" era
falsa—. T115: `doctor` acepta el detector del SDK por `opts`, así que su rama
degradada se prueba de verdad, y un test verifica que `doctor` y el runner
coincidan sobre si el SDK está: si difieren, uno de los dos miente.

Un hueco declarado vale más que un verde inventado. Es el principio II.

## Cómo se construyó esto

Vale decirlo porque cambia cómo leer el resultado: el código lo escribieron
agentes en paralelo, y **cada tanda tenía un escéptico con instrucción de romper
lo que los demás habían hecho**, no de confirmarlo.

Los escépticos encontraron más que los implementadores. El del límite de
autonomía demostró que la promesa central del proyecto era falsa —45 de 57
grafías de comando prohibido la sorteaban, y una se ejecutó contra un remoto real
moviéndole la rama principal—. El del daemon midió una carrera en el lock que
duplicaba el trabajo en 16 de 25 arranques. El que revisó la documentación en
frío encontró once afirmaciones que el código no respaldaba.

Cada arreglo lleva su medición en el comentario, y cada test que protege un
mecanismo se verificó rompiendo el mecanismo a propósito para ver el rojo. Un
test que pasa con el mecanismo roto no prueba nada.

Lo que se tomó de otros harness —y lo que se descartó, con el motivo— está en
[`docs/SINTESIS-ECC.md`](docs/SINTESIS-ECC.md).

## La constitución

`.specify/memory/constitution.md` fija las siete invariantes que ningún cambio
puede violar, incluido uno propuesto por un modelo. Un plan que las viola se
rechaza en el `Constitution Check` antes de escribir código.

Bajar un umbral, saltear un test, apagar un hook o recortar un gate para que una
tarea avance no es una decisión de implementación. No está disponible.

---

## Licencia

MIT — ver [LICENSE](LICENSE).
