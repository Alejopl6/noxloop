---
name: tdd
description: El ciclo test-primero tal como noxloop lo fuerza, y qué hacer cuando el hook de orden bloquea una escritura. Se usa al implementar cualquier tarea de un recorrido.
---

# Test primero, forzado por el sistema de archivos

En noxloop el orden no es una convención del equipo: es un hook `PreToolUse` que
intercepta `Edit`, `Write` y `MultiEdit`, consulta el estado en disco, y bloquea
la escritura si la tarea no tiene rojo verificado.

La distinción importa porque está medida: un prompt que pide TDD funciona en las
dos primeras iteraciones y deja de funcionar en la tercera. Un hook no se cansa.

## El rojo lo verifica el motor, no vos

Escribir el test no alcanza. El motor corre el archivo él mismo y concede el
rojo solo si **las dos cosas** son ciertas:

1. el archivo de test declarado **existe**, y
2. su corrida sale con código **distinto de cero**.

La primera condición no es burocracia: un import que falla porque el módulo no
existe también sale con código distinto de cero, y aceptarlo sería conceder el
rojo a una tarea donde nadie escribió un test.

Si el test **pasa** sin el cambio, no prueba nada. Reescribilo hasta que falle
por la razón correcta.

## Ningún tier saltea el rojo

Lo que un tier abarata es la revisión, el modelo, el effort y el alcance del
gate. **Nunca el orden test-primero.** Una tarea `trivial` sin rojo verificado
no avanza: se atasca, y está bien que se atasque.

## Cuando el hook bloquea

Su mensaje te dice la salida. No hay otra:

```
noxloop: la tarea T003 todavia no tiene rojo verificado, asi que no se puede
escribir codigo de produccion (src/grilla.mjs).
```

Escribí el test en los `testFiles` declarados — esos **siempre** se pueden
escribir, es la salida del bloqueo, no una excepción. Corrélo. Vélo fallar.

## Nunca debilites un test

Ni `skip`, ni bajar un umbral, ni relajar una aserción, ni un `expect(true)`. Si
el test está mal planteado, corregilo **como test**: cambiá lo que prueba, no si
prueba.

Un test debilitado es la forma más barata de convertir un recorrido honesto en
un verde inventado, y es indetectable en el diff de un PR grande.
