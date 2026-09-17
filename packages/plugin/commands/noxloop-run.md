---
description: "Lanza el recorrido de un ticket: tareas en paralelo, integración por cola, un pull request. Retomable."
argument-hint: "<item> [--dry-run]"
---

# /noxloop-run

Argumentos: `$ARGUMENTS`.

```bash
noxloop run <item>
```

Eso es todo: el motor corre fuera de esta sesión, así que cada tarea recibe un
contexto nuevo y el recorrido sobrevive a que cierres la terminal.

Antes de soltarlo del todo:

```bash
noxloop run <item> --dry-run     # qué haría, sin ejecutar nada
noxloop status <item>            # en qué quedó
```

## Qué hace, y qué no

Ejecuta el plan que dejó `/noxloop-plan`. **No replanifica**: un recorrido que
arma su propio plan puede cambiar el alcance sin que nadie lo apruebe, y la
aprobación del plan es el único punto de control humano del flujo.

Las tareas sin dependencia entre sí corren **a la vez**, cada una en su propio
worktree. Las dependientes esperan a que la anterior esté **integrada** — no
"terminada": integrada. La cola de integración rebasa cada tarea sobre la punta
actual, vuelve a verificar, y recién entonces la mete.

Al final deja **un pull request** y nada más. No mergea, no despliega, y no hay
bandera que lo habilite.

## Cuando una tarea no sale

Queda bloqueada con la causa real y el recorrido **sigue con las demás**. El PR
se abre igual con las que salieron, y dice cuáles faltaron y por qué.

Una tarea bloqueada con un diagnóstico honesto vale más que un verde inventado.

## Si se interrumpió

```bash
noxloop resume <item>
```

Continúa desde el estado en disco. No repite trabajo hecho y no devuelve
presupuesto consumido. Si alguna tarea quedó a medias con su worktree sucio, el
motor se detiene a decidir qué hacer con ella en vez de pisarla.
