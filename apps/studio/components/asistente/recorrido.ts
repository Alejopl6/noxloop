import { PASOS_DEL_ASISTENTE } from '@/components/asistente/pasos'
import { PASO_DEL_ARTEFACTO, type IdDePaso, type PasoDelAsistente } from '@/components/asistente/paso'
import type { Seccion } from '@/lib/ruta'
import { etapaQueFalta, type ArtefactosDeProyecto, type Proyecto } from '@/lib/tipos'

/**
 * Las preguntas que se le hacen al recorrido. Todas derivadas de la lista
 * declarada en `pasos.tsx`, ninguna escrita dos veces.
 */

export function esIdDePaso(valor: string | null | undefined): valor is IdDePaso {
  return valor != null && PASOS_DEL_ASISTENTE.some((paso) => paso.id === valor)
}

/**
 * Los pasos que este proyecto va a pisar de verdad.
 *
 * Con `proyecto === null` se devuelven todos: mientras el servicio no ha
 * contestado no se puede saber si toma el atajo, y esconder un paso por no
 * tener el dato todavia significa que el recorrido cambia de longitud delante
 * del operador en cuanto llegue la respuesta.
 */
export function pasosAplicables(
  proyecto: Pick<Proyecto, 'estado' | 'origen'> | null,
): readonly PasoDelAsistente[] {
  return PASOS_DEL_ASISTENTE.filter((paso) => paso.aplicaA(proyecto))
}

/**
 * EN QUE PASO SE RETOMA.
 *
 * El estado lo tiene el servicio, no esta pantalla: esta funcion no recuerda
 * nada entre sesiones y no guarda nada en el navegador. Pregunta lo mismo que
 * la fila del inventario —`etapaQueFalta`, que prefiere el veredicto de la
 * guarda a la tabla declarada cuando el veredicto ha llegado— y traduce la
 * respuesta a un paso.
 *
 * LO QUE ESTO NO PUEDE CONTESTAR, y es el hueco declarado en
 * `PasoDelAsistente.exige`: guidelines y diseno viven dentro de `CONSTITUTED`
 * junto con el bootstrap, y el servicio no publica ninguna guarda que los
 * distinga. Asi que quien vuelve de nuevas a un proyecto `CONSTITUTED` aterriza
 * en el bootstrap, no en las guidelines. Quien vuelve con la direccion que
 * tenia abierta aterriza donde estaba, porque el paso viaja en `?paso=`.
 */
export function pasoEnQueSeRetoma(
  proyecto: Proyecto | null,
  artefactos: ArtefactosDeProyecto | null,
): IdDePaso {
  if (!proyecto) return 'alta'

  const falta = etapaQueFalta(proyecto, artefactos)
  if (!falta?.artefacto) return 'listo'

  return PASO_DEL_ARTEFACTO[falta.artefacto]
}

/**
 * El paso que corresponde a una seccion de la consola.
 *
 * Varias secciones apuntan al mismo paso y un paso puede no tener seccion, asi
 * que la busqueda va en el sentido util: dada la seccion a la que una vista
 * quiso navegar, cual es el primer paso del recorrido que vive ahi. El
 * "primero" importa: `constitution` es la seccion de dos pasos —constitution y
 * guidelines— y la vista que navega a `constitution` se refiere al primero.
 */
export function pasoDeLaSeccion(seccion: Seccion): IdDePaso | null {
  return PASOS_DEL_ASISTENTE.find((paso) => paso.seccion === seccion)?.id ?? null
}

/**
 * A donde va una navegacion que salio de DENTRO del asistente.
 *
 * ESTE ES EL NUCLEO DE QUE NO HAYA HECHO FALTA TOCAR NINGUNA VISTA. Las seis
 * pantallas de etapa ya sabian avanzar: al aceptar el snapshot navegan a la
 * constitution, al fijar la constitution navegan al bootstrap, al completar el
 * bootstrap navegan a las conexiones. Lo que no saben —y no tienen por que
 * saber— es que el recorrido guiado tiene mas paradas que la consola: entre la
 * constitution y el bootstrap hay guidelines y diseno, que no son secciones.
 *
 * Las tres reglas, y la de en medio es la que evita el salto:
 *
 *   1. La seccion no es de ningun paso (credenciales, proyectos, inicio) — se
 *      SALE al modo consola. Es una navegacion a un sitio del espacio de
 *      trabajo, y retenerla dentro del asistente seria secuestrar el destino.
 *   2. El paso destino esta MAS DE UNO por delante — la vista dijo "esta etapa
 *      quedo cerrada", no "llevame tres pantallas adelante". Se avanza UN paso
 *      aplicable. Sin esta regla, fijar la constitution se salta guidelines y
 *      diseno y el operador no los ve nunca.
 *   3. Cualquier otro caso —ir atras, o avanzar justo uno— se respeta tal cual.
 *
 * Y UNA EXCEPCION EXPLICITA: desde `alta` no se avanza "uno", se DEDUCE. El
 * proyecto acaba de crearse y todavia no ha llegado del servicio, asi que aqui
 * no se sabe si toma el atajo del proyecto nuevo; deducir el paso cuando
 * llegue es la unica respuesta que no se inventa el recorrido.
 */
export type DestinoDelAsistente =
  | { dentro: true; paso: IdDePaso | null }
  | { dentro: false }

export function destinoDentroDelAsistente(
  seccionDestino: Seccion,
  pasoActual: IdDePaso,
  aplicables: readonly PasoDelAsistente[],
): DestinoDelAsistente {
  const destino = pasoDeLaSeccion(seccionDestino)
  if (!destino) return { dentro: false }

  // `paso: null` significa "dedúcelo del estado del proyecto".
  if (pasoActual === 'alta') return { dentro: true, paso: null }

  const indiceActual = aplicables.findIndex((paso) => paso.id === pasoActual)
  const indiceDestino = aplicables.findIndex((paso) => paso.id === destino)

  // Un destino que no es aplicable a este proyecto (Discovery en un proyecto
  // nuevo) no se puede honrar: se avanza uno, que es lo que la vista queria.
  if (indiceActual < 0 || indiceDestino < 0) {
    return { dentro: true, paso: siguientePaso(pasoActual, aplicables) }
  }

  if (indiceDestino > indiceActual + 1) {
    return { dentro: true, paso: siguientePaso(pasoActual, aplicables) }
  }

  return { dentro: true, paso: destino }
}

/** El siguiente paso aplicable, o el actual si ya es el ultimo. */
export function siguientePaso(
  pasoActual: IdDePaso,
  aplicables: readonly PasoDelAsistente[],
): IdDePaso {
  const indice = aplicables.findIndex((paso) => paso.id === pasoActual)
  if (indice < 0) return pasoActual
  return aplicables[Math.min(indice + 1, aplicables.length - 1)].id
}

/** El paso anterior aplicable, o `null` si ya es el primero. */
export function pasoAnterior(
  pasoActual: IdDePaso,
  aplicables: readonly PasoDelAsistente[],
): IdDePaso | null {
  const indice = aplicables.findIndex((paso) => paso.id === pasoActual)
  if (indice <= 0) return null
  return aplicables[indice - 1].id
}
