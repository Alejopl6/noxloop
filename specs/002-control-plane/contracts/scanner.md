# Contrato · Scanner de proyecto

**Branch**: `002-control-plane` | Cubre FR-011 … FR-015, NFR-001, SC-002

## La promesa

El scanner **lee**. No escribe, no formatea, no instala, no ejecuta nada del proyecto, no corre sus tests, no resuelve sus dependencias.

Esto no es una buena práctica: es la condición de adopción. La primera acción del producto sobre el proyecto de alguien no puede ser tocarlo. Si el snapshot modificara algo, nadie lo apuntaría a un repositorio que le importa, y el producto entero se queda sin primera etapa.

**La promesa es verificable, no declarada** (SC-002): se captura el estado del árbol antes y después y tiene que ser idéntico, en 100 de 100 ejecuciones. Es el mismo criterio del exit code del principio II: sin el objeto que lo prueba, "no escribe nada" es prosa.

## Interfaz

```ts
interface Scanner {
  escanear(opts: {
    ruta: string
    señales?: AbortSignal
    alProgresar?: (p: Progreso) => void
    alHallar?: (h: Hallazgo) => void
  }): Promise<Snapshot>
}

interface Progreso {
  fase: Fase
  archivos_vistos: number
  total_estimado: number
}

type Fase =
  | 'inventario'      // qué archivos hay
  | 'manifiestos'     // package.json, cargo.toml, go.mod, pyproject...
  | 'estructura'      // capas, módulos, convenciones
  | 'testing'         // runner, ubicación, cobertura declarada
  | 'ci'              // workflows, pipelines
  | 'agentes'         // CLAUDE.md, .claude/, .cursor/, MCP, hooks, skills
  | 'guidelines'      // docs/, CONTRIBUTING, ADRs
  | 'riesgos'         // secretos en claro, dependencias sin fijar

interface Hallazgo {
  categoria: Fase | 'stack' | 'arquitectura' | 'dependencias'
  clave: string          // 'runtime.node', 'testing.runner', 'ci.workflow'
  valor: unknown
  origen: 'detectado' | 'inferido'
  evidencia: Array<{ ruta: string; linea?: number; extracto?: string }>
  confianza: 'alta' | 'media' | 'baja'
}
```

## Las tres reglas del hallazgo

**1. Detectado exige evidencia.** Un hallazgo `origen: 'detectado'` sin al menos una entrada en `evidencia` no se emite. Es el principio del exit code aplicado a la lectura: sin el archivo y la línea que lo respaldan, es una opinión.

**2. Inferido se declara inferido.** "Esto parece arquitectura hexagonal" es legítimo y útil, pero va con `origen: 'inferido'` y `confianza` honesta. El fallo que esto evita es el peor de un scanner: un snapshot que mezcla lo leído con lo supuesto produce una constitution basada en una arquitectura que el proyecto no tiene, y el runtime la aplica durante meses.

**3. Vacío se declara vacío.** Un repositorio sin tests emite `testing.runner = null, origen: 'detectado'` con la evidencia de que se buscó y no había. No emite un runner plausible. Rellenar un hueco con lo probable es exactamente lo que la constitution prohíbe cuando dice que las ambigüedades se preguntan, no se rellenan.

## Qué detecta

| Fase | Señales |
|---|---|
| Stack | Manifiestos por ecosistema, lockfiles, versión de runtime fijada, gestor de paquetes |
| Arquitectura | Estructura de carpetas, monorepo y sus workspaces, límites de módulo, capas |
| Patrones | Convenciones de nombres, organización de tests, patrones de import |
| Testing | Runner, ubicación de tests, umbral de cobertura declarado, proporción tests/producción |
| CI/CD | Workflows y pipelines, qué comandos corren, qué gatea el merge |
| Dependencias | Directas, versiones fijadas o flotantes, edad, avisos de seguridad declarados en el repo |
| Guidelines | `CONTRIBUTING`, `docs/`, ADRs, guías de estilo, `README` con reglas |
| Agentes | `CLAUDE.md`, `.claude/`, `.cursor/`, `AGENTS.md`, servidores MCP configurados, hooks, skills, subagentes |
| Riesgos | Secretos en claro, `.env` versionado, dependencias sin fijar, tests ausentes |

## Lo que el scanner nunca hace

| Prohibido | Por qué |
|---|---|
| Escribir, crear o borrar un archivo del proyecto | La promesa |
| `npm install`, `pip install`, resolver dependencias | Escribe, tarda y puede ejecutar scripts de instalación |
| Ejecutar los tests del proyecto | Ejecuta código ajeno con los permisos del operador |
| Ejecutar cualquier script del proyecto | Lo mismo |
| `git checkout`, `git stash`, cambiar de rama | Modifica el árbol del operador |
| Enviar contenido del proyecto a un servicio externo sin permiso | El código de alguien no sale de su máquina por defecto |
| Copiar el valor de un secreto a ninguna parte | FR-041, y la razón por la que existe la fase `riesgos` |

**El caso del secreto encontrado.** El scanner emite un hallazgo de riesgo con la ruta y la línea. **No** copia el valor, ni truncado, ni ofuscado, ni al hallazgo, ni al log, ni a la interfaz. Un snapshot que reporta "encontré una clave de AWS en `.env:3`" es útil; uno que además la transcribe acaba de crear una segunda copia del problema en un almacén nuevo.

## Rendimiento y cancelación

| Requisito | Regla |
|---|---|
| NFR-001 | 10.000 archivos en menos de 60 segundos |
| Progreso | Emitido por fase, con cuenta parcial. Nunca una barra que no se mueve |
| Hallazgos en vivo | Emitidos según aparecen, para que la lista crezca mientras corre |
| Cancelación | Atiende `AbortSignal` en cada fase. Deja el snapshot en `cancelado`, **nunca** un snapshot parcial marcado como completo (FR-015) |
| Exclusiones | `.git`, `node_modules`, `dist`, `build`, `target`, `vendor`, y lo que declare `.gitignore` |
| Binarios | Se cuentan, no se leen |
| Archivos enormes | Se leen por encima de un umbral solo en cabecera |

## Pruebas obligatorias

| Prueba | Qué afirma |
|---|---|
| `scanner-no-escribe` | `git status --porcelain` vacío antes y después, sobre repositorios de varios ecosistemas |
| `scanner-no-escribe-ignorados` | Ni siquiera toca archivos que git ignora — se comparan mtime e inodos del árbol completo |
| `scanner-se-detecta-a-si-mismo` | Sobre este repositorio: Node 20, módulos ES, `node --test`, el workflow de CI, la constitution, el plugin, los cuatro proveedores |
| `scanner-no-inventa` | Sobre un repositorio vacío: emite huecos declarados, cero hallazgos inferidos con confianza alta |
| `detectado-exige-evidencia` | Ningún hallazgo `detectado` sin `evidencia` sale del scanner |
| `scanner-cancelable` | Cancelado a mitad, deja estado `cancelado` y ningún snapshot completo |
| `scanner-no-copia-secreto` | Con un secreto plantado, el hallazgo lleva la ruta y no el valor — se busca el centinela en el snapshot serializado |
| `scanner-rutas-raras` | Espacios, acentos, enlaces simbólicos: funciona o falla con causa textual, nunca a medias |
| `scanner-rendimiento` | 10.000 archivos sintéticos bajo 60 segundos |

## Extensión

Un detector nuevo es un archivo que declara su fase, sus señales y sus hallazgos. No toca el motor del scanner, igual que un proveedor de tickets no toca el motor de ejecución. Si soportar un ecosistema exige cambiar el núcleo del scanner, la interfaz está mal y se arregla la interfaz.
