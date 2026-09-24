// El almacen consultable, montado.
//
// LA REGLA QUE ORDENA TODO LO DEMAS, Y ESTE ARCHIVO ES DONDE SE PUEDE ROMPER.
// El estado se parte en dos almacenes y el criterio no es de gusto: quien lo
// escribe y quien lo lee bajo presion. El estado del run —tareas, intentos,
// gates, locks— vive en archivos atomicos y lo escribe `state.mjs`, porque un
// hook corre dentro de un worktree, sin dependencias y sin conexion abierta, y
// tiene que leer un archivo y decidir en milisegundos. Esto de aqui guarda lo
// otro: proyectos, snapshots, credenciales, grants, auditoria, recomendaciones.
//
// SQLITE ES PROYECCION DE LECTURA, NUNCA FUENTE DE VERDAD DEL RUN. Si un hook
// necesitara abrir esta base para saber si el rojo existe, el principio III se
// rompe y con el la retomabilidad. La unica sincronizacion permitida es de
// archivos HACIA SQLite, en un solo sentido; una proyeccion perdida se
// reconstruye releyendo los archivos, y una discrepancia se resuelve SIEMPRE a
// favor del archivo.
//
// TODO(proyeccion): la costura de archivos -> SQLite no esta implementada. Va
// aqui, como un metodo que lee el estado en disco y REEMPLAZA las filas
// proyectadas, y tiene que cumplir tres cosas que conviene dejar escritas antes
// de que alguien las descubra a medias:
//   1. Un solo sentido. Ningun camino escribe del almacen hacia los archivos.
//   2. Reconstruible entera. Borrar la base y reproyectar tiene que dar lo
//      mismo, porque es como se sale de una proyeccion corrupta.
//   3. Idempotente por instante. Reproyectar dos veces el mismo estado no
//      duplica nada, igual que las migraciones.
// Este paquete no lee `NOXLOOP_HOME` ni el sistema de archivos, y hay una
// prueba que lo prohibe: cuando llegue la proyeccion, esa prueba es la que hay
// que mirar primero para decidir donde vive el lector.

import { abrirBase } from "./sqlite.mjs";
import { aplicarMigraciones, versionDeEsquema } from "./migraciones.mjs";
import { repositorioDeProyectos } from "./proyecto.mjs";
import { repositorioDeAuditoria } from "./auditoria.mjs";
import { repositorioDeBoveda } from "./boveda.mjs";
import { repositorioDeTareas } from "./tareas.mjs";
import { repositorioDeAjustes, repositorioDeOrden } from "./orden.mjs";
import {
  repositorioDeAgentes,
  repositorioDeBandeja,
  repositorioDeConexiones,
  repositorioDeConstituciones,
  repositorioDeGuidelines,
  repositorioDePoliticas,
  repositorioDeRecomendaciones,
  repositorioDeSnapshots,
  repositorioDeWorkspaces,
  vistaDeInicio,
} from "./repositorios.mjs";

/**
 * @param {{ruta?: string, redactor?: ((detalle: any) => any)|null, migraciones?: any}} [opciones]
 */
export function abrirAlmacen(opciones = {}) {
  const base = abrirBase(opciones.ruta ?? ":memory:");
  const { version } = aplicarMigraciones(base, opciones.migraciones);

  // El redactor NO tiene valor por defecto, y la ausencia no falla aqui: falla
  // al intentar escribir un evento de auditoria. Un redactor identidad por
  // defecto convertiria el principio IX en una recomendacion —el dia que nadie
  // lo inyecta, la auditoria sigue escribiendo y el detalle sale crudo— y
  // fallar al abrir dejaria sin almacen a todo lo que no audita nada.
  const redactor = opciones.redactor ?? null;

  const workspaces = repositorioDeWorkspaces(base);
  // Se construye antes del objeto porque `proyectos` lo necesita: las
  // transiciones de estado dejan rastro en el mismo registro append-only.
  const auditoria = repositorioDeAuditoria(base, redactor);

  return {
    /** La capa fina sobre `node:sqlite`. La usa el servicio para consultas propias y las pruebas para interrogar el esquema. */
    base,
    version,
    workspaces: {
      ...workspaces,
      crear(datos) {
        // `version_esquema` de `Workspace` es la COPIA que la API expone; la
        // contabilidad de verdad es la tabla `esquema_migracion`, que es por
        // base y no por workspace. Se rellena aqui para que las dos nunca se
        // contradigan por un olvido de quien llama.
        return workspaces.crear({ ...datos, version_esquema: versionDeEsquema(base) });
      },
    },
    // Los dos comparten `base`, asi que la transicion y su rastro caen en la
    // MISMA transaccion: o se escriben las dos o ninguna. Un estado que avanza
    // sin dejar rastro es justo lo que este cableado existe para impedir.
    proyectos: repositorioDeProyectos(base, auditoria),
    snapshots: repositorioDeSnapshots(base),
    constituciones: repositorioDeConstituciones(base),
    guidelines: repositorioDeGuidelines(base),
    recomendaciones: repositorioDeRecomendaciones(base),
    conexiones: repositorioDeConexiones(base),
    agentes: repositorioDeAgentes(base),
    bandeja: repositorioDeBandeja(base),
    politicas: repositorioDePoliticas(base),
    boveda: repositorioDeBoveda(base),
    // El gestor local (spec 003, FR-030). Su unico escritor es el servicio.
    tareas: repositorioDeTareas(base),
    // El orden a mano del board y los ajustes del servicio (spec 005). El
    // gestor no se entera del orden: es de esta pantalla, no del equipo.
    orden: repositorioDeOrden(base),
    ajustes: repositorioDeAjustes(base),
    auditoria,
    inicio: vistaDeInicio(base),
    cerrar() {
      base.cerrar();
    },
  };
}
