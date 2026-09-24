# La bóveda de credenciales

Es la única parte de noxloop cuyo fallo no tiene segundo intento.

Un gate mal configurado se corrige en el ciclo siguiente. Un plan equivocado se
replanifica. Un scanner que se confunde se corrige a mano. **Un secreto filtrado
se rota, se audita y se explica** — y el producto pierde la propiedad que lo
diferencia, porque un producto que promete probar con qué credenciales operaron
tus agentes y filtra una es peor que uno que nunca lo prometió: el operador
confió en la promesa y dejó de vigilar.

Por eso esta capa tiene su propio documento, sus propias pruebas y una regla que
no se negocia.

---

## La regla

> El valor de una credencial existe en exactamente dos sitios: **el almacén de
> secretos del sistema operativo**, y **el entorno del subproceso que tiene
> grant vigente**, durante el tiempo que ese subproceso vive.

En ningún otro lugar. No en el almacén consultable, no en un archivo de estado,
no en un log, no en una respuesta HTTP, no en un mensaje de error, no en un
transcript, no en la evidencia, no en la interfaz, no en una variable de módulo
del servicio.

Es el principio IX de la constitución, y está escrito ahí porque una regla que
vive solo en un documento de diseño se olvida.

---

## Por qué la interfaz no puede pedir un secreto

No está prohibido: **no existe la ruta**.

El camino obvio habría sido un comando de Tauri —`#[tauri::command] fn
leer_secreto(...)`— que el webview invoca. Eso convierte "no se puede" en "no se
debe", y la diferencia es exactamente la que el principio I ya midió para el
TDD: un prompt se cansa a la tercera iteración, un mecanismo no.

El llavero vive detrás de un **binario propio**, `noxloop-llavero`, que habla por
entrada estándar. No es un comando de Tauri, así que no está en la lista de
`generate_handler!`, así que `invoke()` desde la interfaz no lo alcanza. Hay una
prueba en Rust que lo comprueba: que el archivo del llavero no contenga ningún
`#[tauri::command]`, y que esa lista no haya crecido.

Y el binario **deniega por defecto**: cualquier bandera que no reconozca —
`--valor` incluida — es un error. La forma insegura no se puede escribir.

---

## Los dos backends, y por qué la elección se declara

| | `keychain_so` | `archivo_cifrado` |
|---|---|---|
| Dónde | Llavero de macOS, Credential Manager de Windows, Secret Service en Linux | Archivo cifrado con clave derivada de una contraseña |
| Cuándo | Siempre que exista | Servidor sin escritorio, contenedor, CI |

**La caída al archivo cifrado nunca es silenciosa.** Al arrancar, el servicio
determina el backend y lo publica en `/v1/capabilities`; la interfaz lo muestra
siempre.

El motivo no es informativo, es de seguridad: un servidor Linux sin Secret
Service es exactamente el caso donde el operador cree tener el llavero del
sistema y tiene un archivo. Cambiarle el modelo de amenaza sin decírselo es peor
que no tener el respaldo.

> Nota sobre una vía que **no** funciona: el plugin de bóveda de Tauri no usa el
> llavero del sistema. Guarda un fichero cifrado protegido por una contraseña
> que la aplicación debe suministrar — y esa contraseña habría que guardarla en
> el llavero, con lo cual el plugin no aporta la pieza que hace falta. No hay
> plugin oficial para llavero; se resuelve con el crate `keyring` desde Rust.

---

## El grant es una tripleta, y se comprueba al usar

```
proyecto + agente + credencial  [+ vigencia opcional]
```

**Denegar por defecto.** Una tarea que necesita una credencial sin grant se
bloquea y entra en la bandeja con causa textual. No falla en silencio, y no
continúa sin ella.

**La vigencia se mira en el instante del uso**, no al planificar. Entre
planificar y ejecutar puede haber horas, y en esas horas alguien pudo revocar.
Una consulta que solo pregunta "¿existe la fila?" deja pasar el grant que se
otorgó para una tarea que terminó el mes pasado.

**La vista inversa** es obligatoria y es la consulta que justifica todo el
inventario: *dada esta credencial, qué agentes y qué proyectos la alcanzan hoy*
— considerando vigencia y revocación, no solo existencia.

---

## `recuperar` exige un motivo, y no es burocracia

```js
await boveda.recuperar(ref, {
  grant_id, project_id, agent_id,
  proposito: "lanzar_runner",
});
```

Sin `MotivoDeAcceso` no compila. Es lo que hace que la auditoría sea
**automática en vez de recordada**: no existe camino donde alguien "olvidó"
registrar el acceso, porque registrar es parte de la operación.

Es el mismo criterio que el motor ya aplica a los presupuestos: *un intento que
no se registra no existe*, y registrar es parte del intento, no un reporte
posterior.

---

## La inyección al subproceso

```
servicio → ¿grant vigente? → bóveda → valor → spawn(env) → el valor se descarta
                ↓ no
          bandeja + tarea bloqueada + auditoría
```

Cuatro reglas:

1. **Solo por el entorno**, nunca por argumentos de línea de comandos. `ps`
   muestra los argumentos de cualquier proceso a cualquier proceso de la
   máquina: una credencial en `argv` es una credencial pública para el resto del
   sistema, y el grant que la autorizó deja de significar nada.
2. El servicio **no guarda el valor** en ninguna estructura que sobreviva al
   `spawn`.
3. El entorno se construye **explícito**: solo lo que ese runner necesita.
   Heredar el entorno del servicio propaga al agente todas las credenciales que
   el proceso padre tenga cargadas, tenga grant o no — y entonces la capa de
   grants es decorativa.
4. El grant se verifica **en ese instante**, no al planificar.

---

## La redacción ocurre antes de persistir

La palabra "antes" es el contrato. Redactar después significa que hubo un
instante en que el secreto estuvo en disco, y un instante es todo lo que hace
falta.

Pasan por el redactor, sin excepción: transcripts de agente, salida de gates,
evidence packets, logs del servicio, detalle de eventos de auditoría, cuerpos de
error, y cualquier respuesta de la API.

**El redactor busca por valor, no por nombre de variable.** Un secreto que un
agente copió a mitad de un mensaje no lleva etiqueta.

El reemplazo es `[redactado:<nombre-credencial>]` y no un `[redactado]` anónimo:
nombrar cuál era hace el log útil para diagnosticar sin revelar nada. Con la
forma anónima hay que adivinar qué credencial falló.

---

## SSH se trata aparte

Una sesión SSH es un shell remoto, y **las restricciones que protegen el shell
local dejan de aplicar dentro de ella**. Sin extender el límite de autonomía a
ese canal, SSH es la vía que evade toda la capa de gobernanza.

| Control | Regla |
|---|---|
| Huella del host | Fijada al registrar. Un host desconocido es un bloqueo, nunca una aceptación silenciosa |
| Comandos | Allowlist. Por defecto, solo lectura y diagnóstico |
| Escritura y despliegue | Autorización explícita por la bandeja, por sesión, no permanente |
| Bitácora | **Cada comando ejecutado**, no la apertura de la sesión |
| Agente SSH | Sin reenvío. Reenviar el agente entrega las llaves al host remoto |

**La allowlist es la segunda capa, no la primera.** La constitución lo midió en
el shell local: con una lista de comandos *prohibidos*, **45 de 57 grafías la
sortearon** — un prefijo, una comilla, un intérprete. Aquí se aplica el mismo
criterio: se permite lo que la tarea declara necesitar, y todo lo demás se
rechaza diciendo cómo pedirlo.

---

## Las pruebas no verifican la intención

Cada una planta un **valor centinela** improbable, ejecuta la operación real, y
busca el centinela dentro del objeto serializado. Una coincidencia es siempre
real y nunca casual.

| Prueba | Qué afirma |
|---|---|
| `boveda-no-serializa-valor` | Serializar cualquier entidad del inventario no produce el valor, en ningún campo, ni truncado |
| `credencial-exige-su-identidad` | Sin proveedor no se inventaria; el tipo se valida contra el enum; un ámbito de proyecto sin proyecto se rechaza |
| `grants-y-vigencia` | Sin grant no hay valor; un grant expirado no autoriza aunque la fila exista; rotar conserva los grants |
| `entorno-del-subproceso` | El entorno contiene exactamente lo declarado, ni una variable heredada de más, y ningún valor aparece en `argv` |
| `redactor` | Busca por valor y redacta antes de escribir |
| `auditoria` | Append-only, cadena de hash, y alterar una fila es detectable |
| `backend-declarado` | El backend elegido se publica con su motivo; nunca se cae en silencio |
| `ssh` | Huella fijada, allowlist por vector, bitácora por comando, sin reenvío de agente |
| `paquete-cerrado` | Ningún import sale del paquete |

---

## Cómo se verifica

```bash
node --test packages/vault/test/boveda-no-serializa-valor.test.mjs   # el centinela
node --test packages/vault/test/grants-y-vigencia.test.mjs           # denegar por defecto
node --test packages/vault/test/entorno-del-subproceso.test.mjs      # ni una variable de más
node --test packages/vault/test/redactor.test.mjs                    # antes de persistir
node --test packages/vault/test/ssh.test.mjs                         # el canal que evade
```

Y las de Rust, que comprueban que el llavero no llegó al webview:

```bash
cd apps/desktop/src-tauri && cargo test --lib
```

---

## Lo que esta capa prohíbe

- Ningún comando de bóveda expuesto al webview.
- Ningún secreto en argumentos de proceso.
- Ningún backend seleccionado en silencio.
- Ningún acceso sin motivo, y por tanto ninguno sin auditar.
- Ninguna redacción posterior a la escritura.
- Ningún reenvío de agente SSH, ninguna aceptación automática de host
  desconocido.
