import type { ReactNode } from 'react'

import type { ClaseDeVista } from '@/components/marco/lienzo'
import type { Navegar, Seccion } from '@/lib/ruta'
import type { ArtefactosDeProyecto, NombreDeArtefacto, Proyecto } from '@/lib/tipos'

/**
 * EL CONTRATO DEL PASO. Esto es lo primero de este directorio y lo que los
 * demas frentes tienen que cumplir para enchufar el suyo.
 *
 * POR QUE UN MODELO DE DATOS Y NO UNA CADENA DE `if`s. El recorrido —crear,
 * discovery, constitution, guidelines, diseno, bootstrap, conexiones, flota—
 * tiene ocho preguntas por paso: que ensena, que exige para avanzar, si es
 * omitible, si lo hace la maquina, si aplica a este proyecto, cuanto ancho
 * pide, a que pantalla de consola equivale, y como se llama. Repartidas en
 * condicionales dentro del componente, la novena pantalla contesta siete de
 * las ocho y la que se olvida no da ningun error: el paso simplemente se
 * comporta distinto que los demas y nadie sabe por que. Declaradas como campos
 * obligatorios de una interfaz, el paso que no las contesta no compila.
 *
 * LA REGLA QUE ESTE ARCHIVO EXISTE PARA PROTEGER, y es la unica que no se
 * negocia: AUTOMATICO SIGNIFICA QUE LA MAQUINA LO HACE Y TE LO ENSENA PARA QUE
 * APRUEBES, NO QUE ESCRIBE SIN PREGUNTAR. La constitution de este repositorio
 * y FR-026 dicen lo mismo con otras palabras: ninguna recomendacion escribe en
 * el proyecto del operador sin aprobacion explicita, y el diff exacto se
 * ensena ANTES de tocar nada. Por eso `automatico` no es un booleano suelto:
 * arrastra una `PreparacionAutomatica` que obliga a escribir, en el propio
 * dato, POR QUE la peticion que el asistente lanza sola no escribe nada. Un
 * paso que no sepa contestar esa frase no puede declararse automatico.
 */

export type IdDePaso =
  | 'alta'
  | 'discovery'
  | 'constitution'
  | 'guidelines'
  | 'diseno'
  | 'bootstrap'
  | 'conexiones'
  | 'flota'
  | 'listo'

/** Lo que el asistente lanza contra el servicio al entrar en un paso automatico. */
export interface PeticionDePreparacion {
  metodo: 'POST' | 'PUT'
  ruta: string
  cuerpo?: unknown
}

/**
 * El trabajo que la maquina hace SOLA al entrar en el paso.
 *
 * Los dos campos de prosa no son documentacion: son la puerta. `produce` es lo
 * que el asistente le dice al operador mientras la peticion corre —una espera
 * sin nombre es una espera que parece un cuelgue— y `porQueNoEscribe` es la
 * justificacion que quien declara el paso tiene que poder escribir. Si no se
 * puede escribir esa frase, la peticion no puede lanzarse sola: va detras de
 * un boton.
 */
export interface PreparacionAutomatica {
  /** Que sale de esto, dicho al operador. Sin jerga de endpoint. */
  produce: string
  /**
   * Por que lanzarla sola NO escribe en el proyecto del operador.
   *
   * Es la frase que separa "la maquina te prepara la decision" de "la maquina
   * decidio por ti". Se pinta en pantalla, no se guarda en un comentario.
   */
  porQueNoEscribe: string
  /**
   * La peticion. `null` cuando el frente que la produce todavia no la expone:
   * entonces el paso NO es automatico en la practica y el asistente lo dice
   * con `hueco`, en vez de fingir que preparo algo.
   */
  peticion: ((proyectoId: string) => PeticionDePreparacion) | null
  /** Que se ensena cuando `peticion` es `null`. Obligatorio si lo es. */
  hueco?: string
}

/** Lo que recibe el cuerpo de un paso. Nada mas, y nada menos. */
export interface ContextoDelPaso {
  /** Siempre presente salvo en `alta`, que es el paso que lo consigue. */
  proyectoId: string | null
  /** `null` mientras `GET /v1/projects/:id` no ha contestado. */
  proyecto: Proyecto | null
  /** Los veredictos de las guardas. `null` mientras no han llegado. */
  artefactos: ArtefactosDeProyecto | null
  /**
   * Navegar. ES LA DEL ASISTENTE, no la de la aplicacion: un destino que cae
   * dentro del recorrido se queda dentro del recorrido, y uno que no, sale al
   * modo consola. Las vistas reutilizadas no se enteran de la diferencia, y
   * por eso no hubo que tocar ninguna.
   */
  navegar: Navegar
  /** Volver a pedir el proyecto y sus guardas. Tras una transicion de etapa. */
  releerProyecto: () => void
  /** Ir a otro paso del recorrido, sin pasar por una seccion. */
  irAlPaso: (paso: IdDePaso) => void
  /**
   * Avanzar al paso siguiente APLICABLE.
   *
   * Existe ademas de `irAlPaso` porque un cuerpo no conoce el orden del
   * recorrido y no tiene por que: el paso de diseno escribia
   * `irAlPaso('bootstrap')`, que es correcto hoy y deja de serlo el dia que
   * alguien meta un paso entre los dos — sin ningun error, avanzando de mas.
   */
  irAlSiguientePaso: () => void
}

export interface PasoDelAsistente {
  id: IdDePaso

  /** Como se llama el paso en el recorrido. Dos palabras, sin verbo. */
  titulo: string

  /**
   * LA DECISION QUE SE TOMA AQUI, en una frase y en segunda persona.
   *
   * No es un subtitulo decorativo. Es lo que convierte trece destinos en un
   * recorrido: el operador que entra en "Bootstrap" sin esta frase sabe el
   * nombre de la etapa y no sabe que se espera de el.
   */
  proposito: string

  /**
   * La pantalla de consola equivalente, para la salida.
   *
   * `null` cuando el paso no tiene una: `alta` vive en `proyecto-nuevo` pero
   * `guidelines` y `diseno` no son secciones de la consola —se llega a ellas
   * dentro de la constitution— y `listo` no es una pantalla, es el final.
   */
  seccion: Seccion | null

  /** Cuanto espacio pide este paso. Se resuelve con `ANCHO_DE_CLASE`. */
  ancho: ClaseDeVista

  /**
   * EL ARTEFACTO QUE LA GUARDA DEL ALMACEN EXIGE PARA DAR EL PASO POR CERRADO.
   *
   * Es la clave exacta de `GET /v1/projects/:id` → `artefactos`, y es lo unico
   * con lo que el asistente decide si se puede avanzar: no lo decide esta
   * interfaz, lo decide el servicio y aqui solo se lee.
   *
   * `null` ES UN HUECO DECLARADO, no un descuido. Guidelines y diseno viven
   * los tres dentro de `CONSTITUTED` junto con el bootstrap, y el servicio no
   * publica ninguna guarda que diga si quedaron hechos. Consecuencia, dicha
   * entera para que nadie la descubra en produccion: un paso con `exige: null`
   * NUNCA es donde el asistente retoma —se llega a el andando, no volviendo— y
   * nunca bloquea. El dia que el servicio publique esa guarda, se rellena este
   * campo y el comportamiento sale solo.
   */
  exige: NombreDeArtefacto | null

  /**
   * Se puede pasar de largo sin penalizacion ni bloqueo.
   *
   * Hoy solo el diseno, y no por comodidad: FR-023 lo exige y el nucleo lo
   * implementa devolviendo `bloquea: false` y `penalizacion: null` en los tres
   * estados. Un paso omitible que la interfaz pinta en rojo deja de ser
   * omitible en la practica.
   */
  omitible: boolean

  /** Ver `PreparacionAutomatica`. `true` obliga a declarar `preparacion`. */
  automatico: boolean

  /** El trabajo que la maquina hace sola al entrar. `null` si no hace ninguno. */
  preparacion: PreparacionAutomatica | null

  /**
   * Si este paso forma parte del recorrido DE ESTE proyecto.
   *
   * Existe por el atajo del proyecto nuevo, que no es una suposicion de esta
   * pantalla: la maquina de estados declara la arista `CREATED -> CONSTITUTED`
   * con `soloOrigen: "nuevo"` porque en un proyecto nuevo no hay codigo que
   * escanear. Un recorrido que ensena "Discovery" a ese proyecto deja al
   * operador esperando un snapshot que nadie va a correr.
   *
   * Recibe `null` mientras el proyecto no ha llegado: en ese caso el paso se
   * considera aplicable, porque esconder un paso por no tener datos todavia es
   * cambiar el recorrido delante del operador cuando lleguen.
   */
  aplicaA: (proyecto: Pick<Proyecto, 'estado' | 'origen'> | null) => boolean

  /** Lo que se pinta. Una decision, y el resto detras de un «ver detalle». */
  cuerpo: (contexto: ContextoDelPaso) => ReactNode
}

/**
 * De artefacto a paso.
 *
 * Es la tabla que hace que RETOMAR no sea una heuristica: `etapaQueFalta()` en
 * `lib/tipos.ts` ya contesta que artefacto bloquea —con el veredicto del
 * servicio cuando lo hay y con la tabla declarada cuando no— y esto solo
 * traduce esa respuesta a un paso del recorrido. La alternativa era una
 * segunda cadena de `if`s sobre `EstadoProyecto`, que es la copia que diverge
 * la primera vez que alguien anade una etapa.
 */
export const PASO_DEL_ARTEFACTO: Record<NombreDeArtefacto, IdDePaso> = {
  snapshot_aceptado: 'discovery',
  constitution_vigente: 'constitution',
  bootstrap_resuelto: 'bootstrap',
  conexion_viva: 'conexiones',
  flota_declarada: 'flota',
}

/**
 * Que dice la guarda del servicio sobre este paso. CINCO respuestas, no dos.
 *
 * EL FALLO QUE LAS OTRAS TRES EVITAN, y se vio leyendo el HTML generado. La
 * primera version devolvia `boolean | null`, y `null` significaba a la vez
 * "el detalle no ha llegado" y "llego y esta guarda no venia dentro". El
 * asistente pintaba para las dos el mismo mensaje —"espera un momento o
 * recarga"— y apagaba el boton de avanzar. Para la primera es correcto; para
 * la segunda es un callejon: `ArtefactosDeProyecto` es `Partial` A PROPOSITO
 * (el contrato no enumera las claves de `artefactos`, las enumera el almacen),
 * asi que un servicio con una guarda menos dejaba el recorrido bloqueado en
 * un paso que nunca se iba a desbloquear, diciendo que esperase.
 *
 * Con `no_publicada` separada, ese caso NO bloquea: lo que no se puede leer no
 * se puede exigir, y lo que se hace es decirlo.
 */
export type VeredictoDelPaso =
  /** La guarda dice que el artefacto esta. */
  | 'cerrada'
  /** La guarda dice que falta. */
  | 'abierta'
  /** El paso no exige ningun artefacto. */
  | 'sin_guarda'
  /** El detalle del proyecto todavia no ha llegado. */
  | 'sin_respuesta'
  /** El detalle llego y no traia veredicto para esta guarda. */
  | 'no_publicada'

export function veredictoDelPaso(
  paso: PasoDelAsistente,
  artefactos: ArtefactosDeProyecto | null,
): VeredictoDelPaso {
  if (!paso.exige) return 'sin_guarda'
  if (artefactos === null) return 'sin_respuesta'
  const veredicto = artefactos[paso.exige]
  if (!veredicto) return 'no_publicada'
  return veredicto.listo ? 'cerrada' : 'abierta'
}

/**
 * Si se puede avanzar desde este paso.
 *
 * Lo unico que bloquea es una guarda que el servicio LEYO y que dice que no.
 * Todo lo demas avanza: un paso sin guarda no tiene nada que exigir, uno
 * omitible avanza por definicion (FR-023), y una guarda que el servicio no
 * publica no se puede convertir en un requisito inventado por la interfaz.
 */
export function sePuedeAvanzar(paso: PasoDelAsistente, veredicto: VeredictoDelPaso): boolean {
  if (paso.omitible) return true
  return veredicto !== 'abierta' && veredicto !== 'sin_respuesta'
}
