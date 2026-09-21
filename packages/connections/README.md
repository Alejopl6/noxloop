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
