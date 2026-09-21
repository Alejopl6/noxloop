# @noxloop/connections

La capa de integración: cómo se conecta un proveedor externo, dónde vive su
credencial y cómo se entrega justo antes de usarla.

Un archivo = un adaptador, igual que en [`providers/`](../../providers). El
dominio no conoce ningún adaptador: habla con la interfaz de
[`src/proveedor.mjs`](src/proveedor.mjs) y el contrato completo está en
[`specs/002-control-plane/contracts/connection-provider.md`](../../specs/002-control-plane/contracts/connection-provider.md).

## Se llama `ConnectionProvider` y no `OAuthProvider`

Está verificado: Linear, Jira, GitHub, Slack y Notion usan OAuth2, pero **Azure
DevOps se conecta con un token personal (basic) y Vercel con una clave de API**.
Dos de los cinco objetivos no son OAuth.

Por eso **el modo lo decide el catálogo, no quien llama**. `conectar` no recibe
un `modo` —lo rechaza si se lo pasan—, y con un modo sin flujo de autorización
no devuelve URL: la propiedad ni siquiera existe en el resultado. Si la interfaz
hubiera asumido OAuth, el error habría aparecido al implementar Azure DevOps,
con todo construido alrededor.

## Los adaptadores

| Adaptador | Cuándo gana | Estado |
|---|---|---|
| `fake` | Pruebas sin red y sin credenciales. Trae los dos caminos, `oauth2` y los que no lo son | ✅ completo |
| `local` | Token personal y clave de API contra la bóveda del sistema operativo: Azure DevOps, Vercel. Y el operador sin Docker | ✅ completo |
| `nango` | OAuth de verdad: refresco automático y catálogo que nadie quiere reimplementar | 🕳️ hueco declarado — ver [`src/adaptadores/nango.mjs`](src/adaptadores/nango.mjs) |

`local` no es un plan B. Para un token personal, el adaptador alojado no aporta
nada que `local` no haga —no hay flujo que delegar ni token que refrescar— y
levantar tres contenedores para guardar un valor que cabe en el llavero es
coste sin contrapartida.

**La licencia de la dependencia que trae `nango` está declarada en
[`docs/licencia-de-integraciones.md`](docs/licencia-de-integraciones.md).** Es
Elastic License 2.0: no OSI, no compatible con GPL/AGPL, y viaja dentro del
binario distribuido.

## Los dos catálogos

Son dos porque hacen dos trabajos distintos, y mezclarlos rompe uno de los dos.

| | Qué es | Cuántos | Para qué sirve |
|---|---|---|---|
| **`CATALOGO_POR_DEFECTO`** (`src/catalogo.mjs`) | Escrito a mano y verificado contra la documentación oficial. Trae `campos`, `entorno` y `api` | 7 | **Conectar.** Es lo único que se le puede pasar a `crearProveedorDeConexiones` |
| **`PROVEEDORES_DE_NANGO`** (`src/catalogo-nango.mjs`) | Generado desde el catálogo público de Nango. Trae slug, nombre, modo y categorías | 1012 | **Mirar.** Qué existe, cómo se autentica, y qué adaptador lo atendería |

`construirCatalogoConsultable()` los junta en una sola lista consultable, y **lo
propio manda**: la entrada escrita a mano gana sobre la derivada, porque es la
que está verificada y la única que sabe qué pedirle al operador.

### El catálogo de Nango viaja empotrado

**«¿Qué puedo conectar?» es una pregunta de solo lectura y no puede exigir
levantar tres contenedores para contestarse.** El adaptador `local` existe justo
para quien no puede o no quiere levantar Docker; si la lista necesitara Nango
corriendo, ese operador no podría ni *mirar* qué hay. Y la fuente no es el Nango
del operador: es una página de documentación en internet, así que pedirla en
tiempo de ejecución tampoco sería «preguntarle a tu Nango».

El coste se acepta entero: **esto envejece**. Lo que lo hace sostenible es que
se regenera con una orden y el diff se revisa:

```
node packages/connections/scripts/generar-catalogo-nango.mjs
```

La cabecera de `src/catalogo-nango.mjs` dice de qué URL salió, en qué fecha y con
qué `sha256` — el mismo patrón que los tokens de Geist en `globals.css`, que
existe porque escribirlos de memoria salió caro.

Refrescarlo en caliente contra Nango es una **mejora declarada**, no el camino
por defecto: tendría que caer al dato empotrado cuando no hay red, que es el
caso normal de este producto.

### El modo de Nango no es el modo del contrato

Nango publica **17 modos** distintos; este contrato tiene cinco. La traducción
vive en `MODO_POR_MODO_DE_NANGO`, es **total y sin default**, y lo que no se
sabe atender se marca apagado **con su motivo**:

| Nango | Aquí | Adaptador |
|---|---|---|
| `OAUTH2` (353) | `oauth2` | `nango` |
| `API_KEY` (332) | `api_key` | `local` |
| `BASIC` (98) | `basic` | `local` |
| `APP` (1) | `app` | `local` |
| los otros 13, y la fila sin modo (228) | — | ninguno, y se dice por qué |

Un `?? "oauth2"` para lo que sobra convertiría 228 proveedores en 228 pestañas
de navegador que no llevan a ningún sitio. No es hipotético: el catálogo real
trae una fila **sin modo declarado**, y `OAUTH2_CC` no tiene nada que autorizar
en un navegador.

### Mil elementos no son una interfaz

`consultar()` sin texto y sin filtros **no devuelve el catálogo entero**:
devuelve lo que el ciclo 00–07 necesita —tracker, SCM e infraestructura— más los
siete propios. El resto no está escondido: `total_catalogo` sigue diciendo
cuántos hay, las facetas los cuentan, y cualquier búsqueda o filtro los alcanza.

Cada entrada dice **qué adaptador la va a atender**, y eso cambia el trabajo del
operador: `nango` es levantar tres contenedores y registrar una aplicación OAuth
propia; `local` es pegar un token. Saberlo antes de elegir es la diferencia
entre una tarde y cinco minutos.

El servicio lo expone en `GET /v1/connections/catalog`, y esa ruta **no
necesita ni proyecto ni adaptador montado**.

## Agregar un adaptador

1. **Escribí el motor.** Ocho funciones: `requisitos`, `salud`, `iniciar`,
   `guardar`, `leer`, `olvidar`, `sondear`, `llamar`. Lo único que cambia entre
   adaptadores es dónde se guarda el valor y cómo se pide. Las seis reglas del
   contrato viven en `crearProveedorDeConexiones` y no se reimplementan:
   copiarlas a cada adaptador es cómo se pierden.

2. **Declará tus requisitos con la verdad.** `requisitos()` dice qué hace falta
   —contenedores, depósito de secretos, puertos— y el preflight lo comprueba al
   arrancar. La suite exige la honestidad en las dos direcciones: quien dice no
   necesitar contenedores tiene que completar un ciclo entero sin ninguno, y
   quien los necesita tiene que declararlos.

3. **Corré la suite de contrato hasta verde.** Son nueve chequeos:

   ```js
   import { test } from "node:test";
   import { chequeosDeContrato } from "../src/contrato.mjs";

   test("pasa el contrato", async (t) => {
     for (const chequeo of chequeosDeContrato(misFixtures)) {
       await t.test(chequeo.name, () => chequeo.run());
     }
   });
   ```

   Los fixtures traen un `montar()` que devuelve una instancia nueva con el
   reloj controlado, un contador de lecturas y una forma de tirar el adaptador.
   Cada chequeo monta la suya: revocar corta, y una instancia compartida
   arrastraría el corte al chequeo siguiente.

   Si tu adaptador habla HTTP, la petición llega **inyectada** y los fixtures le
   pasan respuestas grabadas. Un test que necesita una cuenta no lo puede correr
   quien adopte el proyecto.

4. **No importes nada de fuera de este paquete.** Viaja al escritorio como
   recurso suelto: un import relativo que salga resuelve en el repositorio y
   muere en la aplicación instalada. La bóveda y la persistencia llegan
   inyectadas, y hay una prueba que lo prohíbe.

## Lo que este paquete no hace

**Git y el SCM no pasan por aquí** (FR-032). Clonar, ramificar y abrir un PR se
hablan directo con git y con la forja: si pasaran por la capa de integración,
cada tarea dependería de que esté arriba. Lo que sí pasa por aquí es la
**credencial** del SCM, que es inventario y no transporte.

**La persistencia tampoco.** El repositorio está declarado como interfaz, con
una implementación en memoria y un `TODO`. El almacén lo construye otro paquete.
