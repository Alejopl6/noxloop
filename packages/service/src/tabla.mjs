// LA tabla: todas las rutas que este servicio expone, en un solo sitio.
//
// POR QUE ESTA LISTA ES EL ARTEFACTO Y NO UNA CONVENIENCIA. NFR-004 dice que
// ninguna respuesta de ningun endpoint —errores incluidos— contiene el valor de
// una credencial, y que eso se prueba serializando la respuesta y buscando un
// centinela dentro. Una prueba asi necesita ENUMERAR las rutas, y si las
// enumera desde su propia lista, la ruta numero cuarenta y uno —la que alguien
// agregue sin acordarse del test— queda fuera de la prueba. Justo esa es la que
// filtra, porque es la que nadie reviso.
//
// Por eso la tabla es dato, se exporta, y la prueba la recorre. Agregar una
// ruta la mete en la prueba automaticamente; agregarla sin meterla en la tabla
// no la hace alcanzable, porque el servidor tampoco la ve.

import { crearTabla } from "./rutas.mjs";

import * as salud from "./salud.mjs";
import * as proyectos from "./proyectos.mjs";
import * as escaneo from "./escaneo.mjs";
import * as nucleo from "./nucleo.mjs";
import * as credenciales from "./credenciales.mjs";
import * as catalogo from "./catalogo-de-conexiones.mjs";
import * as flota from "./flota.mjs";
import * as runs from "./runs.mjs";

export const TABLA = crearTabla([
  // ---- Salud y sesion -----------------------------------------------------
  // `/v1/health` es lo unico publico: si exigiera token, una interfaz sin token
  // no podria ni diagnosticar por que no tiene token.
  { patron: "/v1/health", metodos: ["GET", "HEAD"], publica: true, manejar: salud.salud },
  { patron: "/v1/capabilities", metodos: ["GET", "HEAD"], manejar: salud.capacidades },
  { patron: "/v1/events", metodos: ["GET"], crudo: true, manejar: salud.eventos },

  // ---- Proyectos · etapa 00 -----------------------------------------------
  { patron: "/v1/projects", metodos: ["GET", "POST"], manejar: proyectos.lista },
  { patron: "/v1/projects/:id", metodos: ["GET", "PATCH", "DELETE"], manejar: proyectos.uno },
  // Se declara ANTES que `/v1/projects/:id` en la lectura, aunque el orden no
  // importe: la tabla pone lo literal por delante de lo parametrico al montar.
  { patron: "/v1/templates", metodos: ["GET"], manejar: proyectos.plantillas },

  // ---- Discovery · etapa 01 -----------------------------------------------
  { patron: "/v1/projects/:id/scan", metodos: ["POST"], manejar: escaneo.arrancarEscaneo },
  { patron: "/v1/scans/:snapshot_id", metodos: ["DELETE"], manejar: escaneo.cancelarEscaneo },
  { patron: "/v1/projects/:id/snapshot", metodos: ["GET"], manejar: escaneo.snapshotVigente },
  { patron: "/v1/snapshots/:id/findings/:finding_id", metodos: ["PATCH"], manejar: escaneo.decidirHallazgo },
  { patron: "/v1/snapshots/:id/accept", metodos: ["POST"], manejar: escaneo.aceptarSnapshot },

  // ---- Constitution y guidelines · etapas 02-04 ---------------------------
  { patron: "/v1/projects/:id/constitution/propose", metodos: ["POST"], manejar: nucleo.proponer },
  { patron: "/v1/projects/:id/constitution", metodos: ["GET", "PUT"], manejar: nucleo.constitution },
  { patron: "/v1/projects/:id/constitution/amend", metodos: ["POST"], manejar: nucleo.enmendar },
  { patron: "/v1/projects/:id/guidelines/:area", metodos: ["GET", "PUT"], manejar: nucleo.guideline },
  { patron: "/v1/projects/:id/design", metodos: ["PUT"], manejar: nucleo.diseno },

  // ---- Bootstrap · etapa 05 -----------------------------------------------
  { patron: "/v1/projects/:id/bootstrap/analyze", metodos: ["POST"], manejar: nucleo.analizarBootstrap },
  // La propuesta completa —el bloque, lo que se decide solo, las preguntas y lo
  // que ya estaba— y su aprobacion en UNA decision. `analyze` sigue existiendo
  // para quien quiera el analisis crudo; esto es lo que la pantalla pide.
  { patron: "/v1/projects/:id/bootstrap/proposal", metodos: ["GET"], manejar: nucleo.propuestaDeBootstrap },
  { patron: "/v1/projects/:id/bootstrap/approve", metodos: ["POST"], manejar: nucleo.aprobarBootstrap },
  { patron: "/v1/projects/:id/recommendations", metodos: ["GET"], manejar: nucleo.recomendaciones },
  { patron: "/v1/recommendations/:id/apply", metodos: ["POST"], manejar: nucleo.aplicarRecomendacion },
  { patron: "/v1/recommendations/:id/customize", metodos: ["POST"], manejar: nucleo.personalizarRecomendacion },
  { patron: "/v1/recommendations/:id/skip", metodos: ["POST"], manejar: nucleo.omitirRecomendacion },
  { patron: "/v1/projects/:id/bootstrap/complete", metodos: ["POST"], manejar: nucleo.completarBootstrap },

  // ---- Conexiones y credenciales · etapa 06 y §12 -------------------------
  // El catalogo va ANTES que `/v1/connections/:id` en la lectura, aunque el
  // orden no importe: la tabla pone lo literal por delante de lo parametrico al
  // montar. Y es la unica ruta de conexiones que NO necesita un proyecto ni un
  // adaptador montado — «¿que puedo conectar?» es una pregunta de solo lectura
  // y no puede exigir tres contenedores levantados para contestarse.
  { patron: "/v1/connections/catalog", metodos: ["GET", "HEAD"], manejar: catalogo.catalogoDeConexiones },
  { patron: "/v1/projects/:id/connections", metodos: ["GET"], manejar: credenciales.conexionesDelProyecto },
  { patron: "/v1/projects/:id/connections/authorize", metodos: ["POST"], manejar: credenciales.autorizarConexion },
  { patron: "/v1/connections/:id/callback", metodos: ["POST"], manejar: credenciales.callbackDeConexion },
  { patron: "/v1/connections/:id", metodos: ["DELETE"], manejar: credenciales.revocarConexion },
  { patron: "/v1/credentials", metodos: ["GET", "POST"], manejar: credenciales.inventario },
  { patron: "/v1/credentials/:id/rotate", metodos: ["POST"], manejar: credenciales.rotar },
  { patron: "/v1/credentials/:id/reach", metodos: ["GET"], manejar: credenciales.reach },
  { patron: "/v1/credentials/:id", metodos: ["DELETE"], manejar: credenciales.revocarCredencial },
  { patron: "/v1/grants", metodos: ["GET", "POST"], manejar: credenciales.grants },
  { patron: "/v1/grants/:id", metodos: ["DELETE"], manejar: credenciales.revocarGrant },

  // FR-049, y la lista de metodos ES el mecanismo: `GET` y nada mas. No hay
  // `POST`, no hay `PATCH`, no hay `DELETE`. No es que esten y devuelvan 403 —
  // no existen, y el 405 de esta ruta lo dice nombrando lo unico que acepta.
  // Un metodo que existe acaba llamandose.
  { patron: "/v1/audit", metodos: ["GET"], manejar: credenciales.auditoria },

  // ---- Flota · etapa 07 ---------------------------------------------------
  { patron: "/v1/projects/:id/agents", metodos: ["GET", "POST"], manejar: flota.agentesDelProyecto },
  // La flota PROPUESTA desde el snapshot. `GET` y nada mas: sugerir no guarda,
  // y un `POST` aqui seria la puerta por la que la propuesta se convierte en
  // configuracion sin que nadie la confirme.
  { patron: "/v1/projects/:id/agents/suggest", metodos: ["GET"], manejar: flota.sugerenciaDeFlota },
  { patron: "/v1/agents/:id", metodos: ["PATCH", "DELETE"], manejar: flota.unAgente },
  { patron: "/v1/projects/:id/activate", metodos: ["POST"], manejar: flota.activar },

  // ---- Bandeja ------------------------------------------------------------
  { patron: "/v1/inbox", metodos: ["GET"], manejar: flota.bandeja },
  { patron: "/v1/inbox/:id", metodos: ["GET"], manejar: flota.entradaDeBandeja },
  { patron: "/v1/inbox/:id/resolve", metodos: ["POST"], manejar: flota.resolverEntrada },
  { patron: "/v1/dashboard", metodos: ["GET"], manejar: flota.dashboard },

  // ---- Handoff al motor ---------------------------------------------------
  // Las tres LEEN archivos y los proyectan. El estado del run lo escribe el
  // motor: hay una prueba que mide el disco antes y despues de un `GET`.
  { patron: "/v1/projects/:id/runs", metodos: ["GET", "POST"], manejar: runs.runsDelProyecto },
  { patron: "/v1/runs/:id", metodos: ["GET"], manejar: runs.unRun },
]);
