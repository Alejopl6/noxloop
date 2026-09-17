# examples

`noxloop.config.json` esta listo para copiar a la raiz de tu proyecto:

```bash
cp examples/noxloop.config.json ./noxloop.config.json
$EDITOR ./noxloop.config.json
noxloop doctor
```

Viene apuntando al **proveedor falso**, que no toca ninguna red: sirve para ver
el motor funcionando antes de poner una credencial. Para pasar a un gestor real,
cambia `provider.name` y `provider.module`, y revisa el `stateMap` contra los
estados que tu proyecto tiene de verdad.

Tres campos que conviene no dejar por defecto:

- **`repos.<x>.gate`** — el comando cuyo exit code decide si una tarea cumple.
  No hay uno uniforme entre proyectos, y asumirlo es como un orquestador falla
  en la mayoria de los repositorios de una organizacion.
- **`repos.<x>.gaps`** — lo que ese gate NO cubre. Se declara para que la
  ausencia sea visible en el pull request y no se confunda con un verde
  completo.
- **`repos.<x>.runners`** — como correr un test suelto. Sin esto, el bucle
  rojo/verde corre el gate completo en cada iteracion.

`doctor` avisa de los tres si los dejas vacios.

## `noxloop.config.github.json` — la configuración de la prueba de fuego

Es noxloop apuntado **a su propio repositorio**, con GitHub Issues como gestor.
Sirve para la primera corrida contra un gestor real sin arriesgar el trabajo de
nadie: el repositorio es el del proyecto, los issues son los suyos, y el PR que
salga lo revisa quien lo lanzó.

Lo único que le falta para arrancar es `GITHUB_TOKEN`. `doctor` lo dice así:

```
NO esta listo: 1 problema(s)
  ✗ falta la variable de entorno GITHUB_TOKEN, que el proveedor github necesita
```

Tres cosas a saber antes de lanzarla, y ninguna es un detalle:

1. **Va a abrir un pull request de verdad.** No lo va a mergear —eso está
   forzado por un hook, no por buena voluntad— pero el PR queda público.
2. **Cuesta dinero.** El techo está en `limits.maxCostUsd: 25` y el harness del
   que salió este proyecto midió ~$6 por tarea. Con `maxParallelItems: 1` y
   `maxParallelTasks: 2` la primera corrida es acotada a propósito.
3. **La primera vez no uses `daemon`.** El endpoint de GitHub devuelve los issues
   asignados al dueño del token, y aunque la bandeja ahora los filtra por el
   repositorio declarado, la forma sensata de estrenarlo es a mano:
   `noxloop plan <numero>` mira el plan sin ejecutar nada, y recién después
   `noxloop run <numero>`.
