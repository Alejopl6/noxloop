# Contrato · ConnectionProvider

**Branch**: `002-control-plane` | Cubre FR-030 … FR-032

## Por qué es una fachada y no una integración directa

La definición de producto marca esto como decisión abierta (§6): *"adoptar una capa de integración alojada de terceros introduce una dependencia de runtime y superficie de red que contradice el principio de núcleo open source y ejecución local"*.

La decisión tomada fue Nango self-hosted **detrás de una interfaz propia**. La investigación técnica confirmó que la cautela estaba justificada, y por un motivo que no era el esperado. Los hallazgos están en `research.md`; el resumen que gobierna este contrato:

| Hallazgo verificado | Consecuencia para el contrato |
|---|---|
| **Nango es Elastic License 2.0**, y los SDK `@nangohq/node` y `@nangohq/frontend` también | No es OSI, no es compatible con GPL/AGPL. La fachada es lo que permite que el núcleo no dependa de ella |
| El self-hosted gratuito son **3 contenedores** (Postgres + Redis + Node) | Un adaptador alternativo más ligero tiene que ser posible sin tocar el dominio |
| **Azure DevOps usa PAT y Vercel usa API key**, no OAuth | El contrato **no puede llamarse `OAuthProvider`** ni asumir un flujo de autorización |
| El callback vive en `localhost:3003`, puerto **fijo y registrado con cada proveedor** | Es un contrato con el mundo exterior. Va en el preflight, no en un try/catch |
| No hay webhooks garantizados en la edición gratuita | El sondeo es el camino primario; los webhooks, optimización opcional |

La fachada no es prudencia abstracta: es lo que hace que cambiar de proveedor sea cambiar un archivo.

## Interfaz

```ts
interface ConnectionProvider {
  readonly id: string

  /** ¿Puede funcionar aquí y ahora? Se llama en el doctor, no a mitad de una conexión. */
  preflight(): Promise<PreflightResult>

  /** Qué proveedores conoce y cómo se autentica cada uno. */
  catalogo(): Promise<ProveedorExterno[]>

  /** Arranca una conexión. El modo lo decide el catálogo, no quien llama. */
  conectar(req: ConectarRequest): Promise<ConectarResult>

  /** Espera a que la conexión se complete. Sondeo, no webhook. */
  esperarConexion(handle: string, opts?: { timeoutMs?: number }): Promise<Conexion>

  /** Credenciales para inyectar a un subproceso. Se piden justo antes de lanzar. */
  credenciales(conexionId: string): Promise<CredencialViva>

  /** Llamada a la API del proveedor sin materializar el token. */
  llamar(req: LlamadaRequest): Promise<LlamadaResult>

  revocar(conexionId: string): Promise<void>
  listar(projectId: string): Promise<Conexion[]>
}

type ModoAuth = 'oauth2' | 'api_key' | 'basic' | 'pat' | 'app'

interface ProveedorExterno {
  slug: string          // 'linear', 'jira', 'github', 'azure-devops', 'vercel'
  nombre: string
  modo: ModoAuth        // lo dice el catálogo
  clase: 'tracker' | 'scm' | 'infra' | 'integracion'
  campos?: CampoRequerido[]   // para modos que no son oauth2
}

interface ConectarRequest {
  projectId: string
  slug: string
  /** Solo para modos no-oauth. En oauth2 va vacío. */
  valores?: Record<string, string>
}

interface ConectarResult {
  handle: string
  /** En oauth2: URL a abrir en el NAVEGADOR DEL SISTEMA, no en el webview. */
  url?: string
  expira?: string
  /** En modos no-oauth la conexión puede quedar lista de inmediato. */
  conexion?: Conexion
}

interface CredencialViva {
  valores: Record<string, string>   // lo que se inyecta al entorno
  expira?: string
  /** Cuánto se puede sostener antes de volver a pedirla. Nunca más de 5 minutos. */
  vigencia_ms: number
}
```

## Las seis reglas

**1. El modo lo decide el catálogo.** Quien llama a `conectar` no sabe si habrá OAuth, un PAT o una clave de API. Si el contrato asumiera OAuth, Azure DevOps y Vercel —dos de los objetivos declarados— quedarían fuera desde el primer día. El error se habría descubierto al implementarlos, con la interfaz ya escrita alrededor de un flujo que no aplica.

**2. El navegador del sistema, no el webview.** Varios proveedores OAuth bloquean webviews embebidos por política. La app abre la URL en el navegador del operador y sondea. El webview embebido queda solo como alternativa para modos que no son OAuth.

**3. El sondeo es el camino primario.** No porque los webhooks sean peores, sino porque la disponibilidad de webhooks en la edición gratuita es ambigua —la tabla de funcionalidades dice que no, el código sugiere que sí, y la petición de aclararlo lleva meses abierta sin respuesta. Construir el camino feliz sobre una casilla ambigua es construir sobre algo que no se puede verificar. Además, los webhooks exigen un endpoint HTTP escuchando en la máquina del operador: superficie de red que el principio de ejecución local prefiere no abrir.

**4. Las credenciales se piden justo antes de usarse.** `vigencia_ms` nunca supera los 5 minutos, y es la recomendación del propio proveedor. La credencial se pide, se inyecta al subproceso y se descarta. No hay caché en el servicio.

**5. El preflight nombra el puerto.** El puerto del callback queda registrado en la aplicación OAuth de **cada** proveedor. Si está ocupado, todos los flujos OAuth rompen sin degradación posible. Eso no es un error de tiempo de ejecución: es una condición de arranque, y `preflight` lo comprueba y lo dice con causa y acción.

**6. Git y SCM no pasan por aquí** (FR-032). Clonar, ramificar y abrir un PR se hablan directo con git y con la forja. La capa de integración no se interpone en el camino crítico del motor. Lo que sí pasa por aquí es la **credencial** del SCM, que es inventario, no transporte.

## El asunto de la licencia · decisión tomada

**Decisión (2026-09-20): Nango entra como dependencia normal del núcleo.** El hallazgo se puso sobre la mesa con sus consecuencias y la decisión es esa. Lo que sigue queda registrado para que nadie tenga que volver a descubrirlo.

Nango está bajo **Elastic License 2.0**, y sus SDK de cliente también. Consecuencias verificadas, aceptadas a sabiendas:

- ELv2 no está aprobada por la OSI y no es compatible con GPL/AGPL.
- El binario distribuido lleva código ELv2 dentro. El repositorio de noxloop sigue siendo MIT; **la dependencia no lo es**, y la licencia exige que quien reciba una copia reciba también sus términos.
- Debian, Fedora y varias políticas corporativas de software libre rechazan ELv2: empaquetar noxloop en esos canales será fricción.
- La cláusula que prohíbe ofrecer el software como servicio alojado a terceros **no** afecta a un Nango local para su propio operador. **Sí** afectaría a un noxloop alojado que conectara integraciones por cuenta de sus usuarios. Si esa puerta se abre algún día, esta decisión vuelve a la mesa.

**Qué hay que hacer para que la decisión no cueste cara después:**

1. **`LICENSE` y `README` declaran la dependencia ELv2** y lo que implica. Un usuario que descubre la licencia después de adoptar el producto tiene un problema que nosotros le creamos en silencio.
2. **Aplicaciones OAuth propias desde el día uno.** Las aplicaciones compartidas de Nango tienen scopes fijos, el usuario autoriza "Nango" y no a noxloop, y el proveedor puede revocarlas. Y lo decisivo: **solo con aplicación propia se pueden exportar los tokens y salir de Nango sin que los usuarios vuelvan a autorizar**. Es el seguro de portabilidad, y solo funciona si está puesto desde el principio.
3. **La fachada se mantiene.** No como mitigación de licencia —ya no lo es— sino porque es lo que hace posibles `local` y `fake`, lo que mantiene el dominio ignorante del proveedor, y lo que convierte "cambiar de capa de integración" en cambiar un archivo si alguna vez hace falta.

## Por qué siguen existiendo tres adaptadores

Con Nango en el núcleo, `local` deja de ser un plan B y pasa a ser lo que realmente es: **el camino correcto para los modos de autenticación que no son OAuth**.

Azure DevOps se conecta con PAT. Vercel, con clave de API. En esos dos casos el adaptador `nango` no aporta nada que `local` no haga: no hay flujo OAuth que delegar ni token que refrescar. Levantar tres contenedores para guardar un PAT que cabe en el keychain es coste sin contrapartida.

El reparto queda así:

| Adaptador | Cuándo gana |
|---|---|
| `nango` | OAuth de verdad: Linear, Jira, GitHub, Slack, Notion. Refresco automático, cifrado en reposo, catálogo que nadie quiere reimplementar |
| `local` | PAT y claves de API: Azure DevOps, Vercel. Y el operador sin Docker |
| `fake` | Pruebas sin red y sin credenciales |

La elección la hace el catálogo según el modo del proveedor, no el operador. Si el modo es `oauth2`, va por `nango`; si es `pat` o `api_key`, por `local`. El operador no tiene por qué saber que existen dos caminos.

## Suite de contrato

| Prueba | Qué afirma |
|---|---|
| `catalogo-declara-modo` | Cada proveedor del catálogo declara su modo. Ninguno queda sin modo |
| `no-asume-oauth` | Con un proveedor de modo `pat`, `conectar` no devuelve URL de autorización |
| `preflight-diagnostica-puerto` | Puerto ocupado → causa y acción, al arrancar, no al conectar |
| `credencial-vigencia-acotada` | `vigencia_ms` nunca supera 5 minutos |
| `credencial-no-cacheada` | Dos llamadas separadas por más de la vigencia piden de nuevo |
| `revocar-corta` | Tras revocar, `credenciales` falla con causa textual |
| `sin-proveedor-degrada` | Con el adaptador caído, las conexiones existentes siguen y las nuevas fallan con causa; la app no se cae |
| `secreto-no-en-listar` | `listar` y `catalogo` nunca devuelven valores de credencial |
| `local-sin-contenedores` | El adaptador `local` completa un ciclo entero sin Docker |
