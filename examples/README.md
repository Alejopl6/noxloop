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
