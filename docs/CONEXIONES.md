# La capa de conexiones

Conecta el proyecto con su ecosistema —tracker, SCM, infraestructura,
integraciones— sin que el dominio sepa con quién está hablando.

Es el mismo patrón que ya funciona para los gestores de tickets: una fachada,
capacidades declaradas, degradación visible, y una suite de contrato que un
adaptador nuevo tiene que pasar entera. Añadir un adaptador es añadir un archivo.

---

## La regla que gobierna el diseño

> **El modo de autenticación lo decide el catálogo, no quien llama.**

Esto no es abstracción por gusto. Está verificado contra el catálogo real:

| Proveedor | Modo |
|---|---|
| Linear, Jira, GitHub, Slack, Notion | `oauth2` |
| **Azure DevOps** | **`basic`** — token personal como contraseña |
| **Vercel** | **`api_key`** |

Dos de los objetivos declarados **no usan OAuth**. Una interfaz llamada
`OAuthProvider` los habría dejado fuera desde el primer día, y el error se
habría descubierto al implementarlos — con la pantalla y el flujo ya construidos
alrededor de algo que no aplica.

Por eso `conectar()` no devuelve siempre una URL de autorización. Con un
proveedor de modo `pat`, devuelve los campos que hay que rellenar.

---

## Los tres adaptadores

| Adaptador | Cuándo gana |
|---|---|
| `nango` | OAuth de verdad: Linear, Jira, GitHub, Slack, Notion. Refresco automático de tokens, cifrado en reposo, y un catálogo de mil proveedores que nadie quiere reimplementar |
| `local` | Token personal y clave de API: Azure DevOps, Vercel. Y el operador que no puede o no quiere levantar contenedores |
| `fake` | Pruebas sin red y sin credenciales |

**`local` no es un plan B.** Para los modos que no son OAuth, el adaptador
alojado no aporta nada que `local` no haga: no hay flujo que delegar ni token que
refrescar. Levantar tres contenedores para guardar un token personal que cabe en
el llavero es coste sin contrapartida.

La elección la hace el catálogo según el modo del proveedor. El operador no
tiene por qué saber que existen dos caminos.

---

## El callback de OAuth en una aplicación de escritorio

Es el problema que parece no tener solución —una aplicación de escritorio no
tiene dominio público donde recibir el redirect— y la tiene, simple:

> **El callback lo sirve el propio Nango, que corre en localhost.**

Con `NANGO_SERVER_URL=http://localhost:3003`, el callback es
`http://localhost:3003/oauth/callback`. El proveedor redirige **el navegador del
operador**, y el navegador sí alcanza localhost. No hace falta deep link, ni
esquema propio, ni túnel.

El camino completo:

1. Registrar `http://localhost:3003/oauth/callback` como redirect URI en la
   aplicación OAuth de cada proveedor.
2. El servicio pide una sesión de conexión y obtiene un enlace.
3. La aplicación lo abre en el **navegador del sistema**, no en el webview —
   varios proveedores bloquean webviews embebidos por política.
4. El operador autoriza. La página de callback es autónoma: funciona en una
   pestaña suelta, sin depender de la ventana que la abrió.
5. La aplicación **sondea** hasta que la conexión aparece.

### El puerto 3003 es un contrato con el mundo exterior

Queda registrado como redirect URI en la aplicación OAuth de **cada** proveedor.
Si está ocupado, todos los flujos OAuth rompen, y **no hay degradación elegante
posible**: reasignar el puerto obliga a volver a registrar la URI en todas
partes.

Por eso `preflight()` lo comprueba **al arrancar** y falla ruidosamente, en vez
de buscar otro puerto libre y fallar más tarde en un sitio donde el mensaje no
mencione ningún puerto.

---

## Por qué el sondeo y no los webhooks

No porque los webhooks sean peores. Porque **su disponibilidad en la edición
gratuita no se puede verificar**: la tabla de funcionalidades dice que no, el
código sugiere que sí, y la petición de aclararlo lleva meses abierta sin
respuesta del proyecto.

Construir el camino feliz sobre una casilla ambigua es construir sobre algo que
no se puede comprobar. Y los webhooks además exigen un endpoint HTTP escuchando
en la máquina del operador: superficie de red que el principio de ejecución
local prefiere no abrir.

---

## Las credenciales se piden justo antes de usarse

`credenciales()` devuelve una vigencia que **nunca supera los cinco minutos**, y
es la recomendación del propio proveedor. Se pide, se inyecta al subproceso, se
descarta. **No hay caché en el servicio.**

`vigencia_ms` es lo que sostiene quien ya tiene el valor fuera del servicio, no
una licencia para guardarlo.

---

## Git y SCM no pasan por aquí

Clonar, ramificar y abrir un PR se hablan directo con git y con la forja. La capa
de integración **no se interpone** en el camino crítico del motor.

Lo que sí pasa por aquí es la **credencial** del SCM, que es inventario, no
transporte.

---

## Levantar Nango

```bash
cd packages/connections/nango
cp .env.ejemplo .env
openssl rand -base64 32          # pégalo en NANGO_ENCRYPTION_KEY
docker compose up -d
```

Tres avisos que cuestan una tarde si se descubren solos:

1. **`SERVER_PORT=3003` tiene que estar explícito.** El compose oficial lo pasa
   sin valor por defecto, pero la imagen trae `PORT=8080` horneado: el servidor
   escucha en 8080 mientras el compose expone 3003, y no conecta nada. Está
   reportado y cerrado como *no planificado*, así que no va a arreglarse río
   arriba.
2. **`NANGO_ENCRYPTION_KEY` no admite rotación.** Sin ella, las credenciales se
   guardan **en claro** en Postgres. Cambiarla después rompe el descifrado de
   todo lo ya guardado, sin camino de migración publicado.
3. **El panel está abierto por defecto** a cualquiera que alcance la instancia.
   En localhost es menos grave; cualquier bind a `0.0.0.0` lo vuelve crítico.

### Registra tus propias aplicaciones OAuth desde el día uno

Las aplicaciones compartidas del proveedor tienen scopes fijos, el usuario
autoriza al proveedor y no a noxloop, y el proveedor puede revocarlas.

Y lo decisivo: **solo con aplicación propia se pueden exportar los tokens y
salir de la capa alojada sin que los usuarios vuelvan a autorizar**. Es el
seguro de portabilidad, y solo funciona si está puesto desde el principio.

---

## La licencia

`@nangohq/node` y `@nangohq/frontend` están bajo **Elastic License 2.0**: no está
aprobada por la OSI, no es compatible con GPL ni AGPL, y Debian y Fedora
rechazan paquetes con ese código dentro.

La decisión de meterla en el núcleo está tomada. El detalle completo —incluido
qué significa según si usas, redistribuyes o alojas— está en
[`LICENSE`](../LICENSE) y en la sección de licencia del
[`README`](../README.md).

Una guarda lo ata al código: mientras el adaptador exista, el aviso tiene que
seguir en los dos archivos.

---

## Cómo se verifica

```bash
node --test packages/connections/test/contrato-fake.test.mjs     # la suite contra `fake`
node --test packages/connections/test/contrato-local.test.mjs    # la misma contra `local`
```

La lista completa de pruebas del paquete:

```bash
node --test "packages/connections/test/*.test.mjs"
```

Y la validación del compose, que no necesita levantar nada:

```bash
cd packages/connections/nango && docker compose config
```

---

## Añadir un adaptador

Cinco pasos, ninguno toca el dominio:

1. Copiar `src/adaptadores/fake.mjs`.
2. Declarar sus capacidades **con la verdad**. Empezar con casi todo en `false`
   es correcto y produce un recorrido que funciona.
3. Implementar `preflight` y el resto de la interfaz.
4. Correr la suite de contrato hasta verde.
5. Registrarlo.

Si soportar un proveedor exige cambiar el dominio, la interfaz está mal y se
arregla la interfaz.
