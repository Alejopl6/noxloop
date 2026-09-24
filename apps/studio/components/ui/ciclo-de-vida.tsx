'use client'

import { Clock } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Badge, type TonoDeBadge } from '@/components/ui/insignia'
import { Button } from '@/components/ui/button'
import { Entity, ListaDeEntidades } from '@/components/ui/entidad'
import {
  ETAPAS_DEL_PROYECTO,
  ETIQUETA_ESTADO_PROYECTO,
  etapaQueFalta,
  recorridoDelProyecto,
  type ArtefactosDeProyecto,
  type EstadoProyecto,
  type NombreDeArtefacto,
  type Proyecto,
} from '@/lib/tipos'
import { DESTINO_DE_ETAPA, type Navegar, type Seccion } from '@/lib/ruta'

/**
 * El indicador del ciclo de vida del proyecto.
 *
 * `CREATED -> DISCOVERED -> CONSTITUTED -> BOOTSTRAPPED -> CONNECTED ->
 * ACTIVE` es lo que este producto tiene y un orquestador de agentes no: los
 * demas empiezan en la tarea, este empieza en el ciclo de vida del proyecto.
 * Y hasta aqui estaba invisible — el operador tenia que deducir donde estaba
 * leyendo la frase de `ETAPA_PENDIENTE`, que dice bien QUE falta y no dice
 * nada de CUANTO se ha andado.
 *
 * LAS TRES PREGUNTAS QUE CONTESTA, y las tres tienen que caber de un vistazo:
 *
 *   1. Donde estoy — la etapa actual, con su nombre y su posicion.
 *   2. Que falta para avanzar — no "te falta la constitution" a secas: el
 *      artefacto que exige la guarda y como conseguirlo, que es lo que
 *      devuelve `GET /v1/projects/:id`. Y accionable: un boton a esa etapa.
 *   3. Que ya paso — las etapas cerradas, distinguibles de las que vienen.
 *
 * RETROCEDER NO EXISTE, por diseno (`packages/store/src/proyecto.mjs`: "un
 * estado que baja deja sin explicar los artefactos que ya se produjeron"). Por
 * eso una marca cerrada no se "desmarca" nunca y no hay ningun estado visual
 * para "se deshizo": lo que se reabre es la etapa —el snapshot se vuelve a
 * correr, la constitution se enmienda— sin mover el estado.
 *
 * DOS DENSIDADES, QUE NO SON EL MISMO COMPONENTE ESTIRADO:
 *
 *   - `CicloDeVida` + `LoQueFalta`, para la FILA de un proyecto. Doce filas se
 *     leen de un vistazo, asi que la posicion cabe en una regleta de seis
 *     marcas y una linea de texto.
 *   - `ResumenDelCiclo`, para inicio. Ahi la pregunta no es por proyecto: es
 *     cuantos hay en cada etapa, y cuales llevan semanas sin moverse. Un
 *     proyecto parado tres semanas en BOOTSTRAPPED es una senal, no una fila
 *     mas, y por eso sale de la distribucion y se nombra aparte.
 *
 * LA DOCTRINA, aplicada donde mas cuesta (`docs/DISENO.md`):
 *
 *   - MONOCROMO PRIMERO. La regleta es gris entera: `gray-400` lo que no ha
 *     pasado, `gray-700` lo cerrado, `gray-1000` donde esta. Tres pasos de
 *     luminancia que se distinguen en claro y en oscuro, y que siguen
 *     distinguiendose en escala de grises. Un indicador de progreso es
 *     exactamente donde se cae en seis circulos de colores con checkmarks, que
 *     es lo generico.
 *   - SIN CHECKMARKS NI EQUIS. La semantica de `Badge` ya lo dice: el color
 *     comunica y el icono sobra. Aqui ni siquiera hay color que ayudar.
 *   - El unico color de esta pieza es el ambar de "sin moverse N dias", y va
 *     con la palabra escrita al lado, dentro del propio badge.
 *   - Ni gradientes, ni glow, ni barra decorativa: la regleta son seis marcas
 *     de 4px de alto que cambian de tono y de ancho, y la regla de la
 *     distribucion es una linea de 1px que dice si esa etapa tiene proyectos.
 *
 * ACCESIBILIDAD. La regleta va `aria-hidden`: es la forma visual de algo que
 * el texto dice entero al lado — "Con setup resuelto. Etapa 4 de 6 · falta
 * Conexiones". Ni el color ni la posicion comunican solos. Si la regleta se
 * anunciara marca a marca, doce filas serian setenta y dos anuncios sin una
 * palabra util.
 */

/* -------------------------------------------------------------------------- */
/* Donde lleva la etapa que falta                                             */
/* -------------------------------------------------------------------------- */

/**
 * De artefacto a pantalla.
 *
 * `DESTINO_DE_ETAPA` en `lib/ruta.ts` mapea ESTADO -> seccion y no puede saber
 * del atajo: para `CREATED` manda a `snapshot`, que para un proyecto `nuevo`
 * es un escaneo de una carpeta vacia. Esta tabla mapea el ARTEFACTO que falta,
 * que es lo que de verdad decide a donde hay que ir, y se queda aqui porque
 * `ruta.ts` es de otro frente en este ciclo. Si las dos sobreviven, la de
 * arriba es la que se puede borrar: el artefacto es el criterio mas fino.
 */
const DESTINO_DEL_ARTEFACTO: Record<NombreDeArtefacto, Seccion> = {
  snapshot_aceptado: 'snapshot',
  constitution_vigente: 'constitution',
  bootstrap_resuelto: 'bootstrap',
  conexion_viva: 'conexiones',
  flota_declarada: 'flota',
}

/** A que pantalla lleva el boton de esta fila. */
export function destinoDeLaEtapaQueFalta(
  proyecto: Pick<Proyecto, 'estado' | 'origen'>,
): Seccion {
  const falta = etapaQueFalta(proyecto)
  if (!falta?.artefacto) return DESTINO_DE_ETAPA[proyecto.estado]
  return DESTINO_DEL_ARTEFACTO[falta.artefacto]
}

/* -------------------------------------------------------------------------- */
/* Densidad de fila                                                           */
/* -------------------------------------------------------------------------- */

/**
 * El tono del badge del estado.
 *
 * Vivia en `vista-proyectos.tsx` y se muda aqui porque ya son dos pantallas
 * las que lo pintan, y dos copias de esta tabla se separan a la primera vez
 * que alguien decide que `CONNECTED` merece otro tono.
 */
const TONO_DEL_ESTADO: Record<EstadoProyecto, TonoDeBadge> = {
  CREATED: 'neutral',
  DISCOVERED: 'neutral',
  CONSTITUTED: 'informativo',
  BOOTSTRAPPED: 'informativo',
  CONNECTED: 'informativo',
  ACTIVE: 'exito',
}

type SituacionDeEtapa = 'cerrada' | 'actual' | 'pendiente'

/**
 * Las tres marcas.
 *
 * La actual es mas ancha ADEMAS de mas oscura: con una sola senal, un monitor
 * mal calibrado o un tema de alto contraste dejan las tres situaciones
 * indistinguibles. El ancho sobrevive a todo eso.
 */
const MARCA: Record<SituacionDeEtapa, string> = {
  cerrada: 'w-4 bg-ds-gray-700',
  actual: 'w-8 bg-ds-gray-1000',
  pendiente: 'w-4 bg-ds-gray-400',
}

function situacionDe(posicion: number, actual: number): SituacionDeEtapa {
  if (posicion < actual) return 'cerrada'
  if (posicion === actual) return 'actual'
  return 'pendiente'
}

/**
 * La regleta y la linea de texto que la explica. Va en `metadatos` de la fila.
 *
 * `artefactos` es opcional porque `GET /v1/projects` no los trae: la vista de
 * inicio del almacen es UNA consulta (NFR-002) y cinco guardas por proyecto no
 * caben ahi. Con ellos, la etiqueta de la etapa que falta es la misma; lo que
 * cambia es el texto de `LoQueFalta`.
 */
export function CicloDeVida({
  proyecto,
  artefactos,
  className,
}: {
  proyecto: Pick<Proyecto, 'estado' | 'origen'>
  artefactos?: ArtefactosDeProyecto | null
  className?: string
}) {
  const recorrido = recorridoDelProyecto(proyecto)
  const actual = recorrido.indexOf(proyecto.estado)
  const falta = etapaQueFalta(proyecto, artefactos)

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-2 gap-y-1', className)}>
      <span aria-hidden="true" className="flex shrink-0 items-center gap-1">
        {recorrido.map((etapa, posicion) => (
          <span
            key={etapa}
            className={cn(
              'h-1 rounded-full',
              // La transicion solo existe cuando el proyecto avanza de etapa
              // en vivo (evento `proyecto.estado`). Con `prefers-reduced-motion`
              // el cambio es instantaneo: `motion-safe` es la unica variante
              // que no deja la animacion escrita para quien pidio que no.
              'motion-safe:transition-[width,background-color] motion-safe:duration-200',
              MARCA[situacionDe(posicion, actual)],
            )}
          />
        ))}
      </span>

      <Badge tono={TONO_DEL_ESTADO[proyecto.estado]}>
        {ETIQUETA_ESTADO_PROYECTO[proyecto.estado]}
      </Badge>

      {/* La posicion dicha con palabras, que es lo que lee un lector de
          pantalla y lo que hace que la regleta no sea la unica senal. */}
      <span className="text-label-12 text-ds-gray-700">
        Etapa {actual + 1} de {recorrido.length}
        {falta ? ` · falta ${falta.etapa}` : ' · recorrido completo'}
      </span>
    </span>
  )
}

/**
 * Que falta y como conseguirlo, los dos, en ese orden. Va en `descripcion`.
 *
 * LA SEGUNDA FRASE ES LA QUE FALTABA EN PANTALLA. La fila de proyectos pintaba
 * `pendiente.causa` y tiraba `pendiente.accion`: el operador leia "no tiene
 * ninguna conexion viva" y se quedaba con el problema sin la salida, que es
 * exactamente lo que NFR-006 prohibe — que paso y que hacer, en ese orden, y
 * el segundo no es opcional.
 *
 * No se trunca ninguna de las dos, por la misma razon que FR-062 en la
 * bandeja: una fila alta es mejor que una decision tomada con media frase.
 */
export function LoQueFalta({
  proyecto,
  artefactos,
}: {
  proyecto: Pick<Proyecto, 'estado' | 'origen'>
  artefactos?: ArtefactosDeProyecto | null
}) {
  const falta = etapaQueFalta(proyecto, artefactos)

  if (!falta) {
    return (
      <>
        El proyecto esta establecido: tiene snapshot, constitution, setup resuelto,
        conexiones vivas y flota declarada. Puede recibir ciclos del motor.
      </>
    )
  }

  return (
    <>
      <span className="block">{falta.causa}</span>
      <span className="mt-1 block text-ds-gray-700">{falta.accion}</span>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Densidad agregada                                                          */
/* -------------------------------------------------------------------------- */

const DIA_EN_MS = 24 * 60 * 60 * 1000

/**
 * A partir de cuantos dias sin moverse un proyecto se nombra aparte.
 *
 * NO SALE DEL CONTRATO NI DEL ALMACEN: ninguno de los dos define "atascado".
 * Es una heuristica de esta consola, y por eso lo que se pinta al lado es el
 * HECHO —"sin moverse 21 dias"— y no el juicio: el numero es comprobable, la
 * palabra "atascado" seria esta pantalla decidiendo producto. Se deja como
 * prop para que el dia que el servicio lo declare, se le pase el suyo.
 */
export const DIAS_PARA_NOMBRAR_PARADO = 14

/** Dias sin moverse, o `null` si el instante no se puede leer. */
function diasSinMoverse(proyecto: Proyecto, ahora: number): number | null {
  // `actualizado` es opcional en el contrato; `creado` no. Un proyecto recien
  // dado de alta que nunca transiciono tiene los dos iguales, asi que la
  // cuenta sale bien por los dos lados.
  const instante = Date.parse(proyecto.actualizado ?? proyecto.creado)
  if (Number.isNaN(instante)) return null
  return Math.floor(Math.max(0, ahora - instante) / DIA_EN_MS)
}

function conPlural(cuantos: number, singular: string, plural: string): string {
  return `${cuantos} ${cuantos === 1 ? singular : plural}`
}

/**
 * El ciclo de vida de TODOS los proyectos, para inicio.
 *
 * Dos bloques y ninguna tarjeta:
 *
 *   1. LA DISTRIBUCION. Las seis etapas en su orden, con cuantos proyectos hay
 *      en cada una. Leida de izquierda a derecha es la forma del embudo: donde
 *      se acumulan los proyectos es donde el producto se atasca. Se pintan
 *      tambien las etapas en cero, porque un cero en `ACTIVE` con cuatro en
 *      `BOOTSTRAPPED` es la informacion entera, y una etapa que desaparece por
 *      estar vacia rompe el eje.
 *
 *   2. LOS PARADOS. Un proyecto lleva tres semanas en `BOOTSTRAPPED` y nadie
 *      lo ha mirado: eso no es una fila mas de la lista, es la unica fila que
 *      importa de esta pantalla. Sale con su cuenta de dias, con que le falta
 *      y con el boton que lleva ahi.
 *
 * `ahora` entra por parametro y admite `null` a proposito. Leer el reloj
 * durante el render hace que el HTML prerenderizado y el primer render del
 * cliente no coincidan; `null` es "el reloj todavia no se ha leido", y con eso
 * no se puede decir que nada lleva parado veintiun dias. Antes que inventar la
 * antiguedad, el bloque no aparece — un tick.
 */
export function ResumenDelCiclo({
  proyectos,
  ahora,
  navegar,
  diasParaNombrarParado = DIAS_PARA_NOMBRAR_PARADO,
}: {
  proyectos: Proyecto[]
  /** El "ahora" del sitio de llamada. `null` mientras no se haya leido. */
  ahora: number | null
  navegar: Navegar
  diasParaNombrarParado?: number
}) {
  const reparto = ETAPAS_DEL_PROYECTO.map((etapa) => ({
    etapa,
    cuantos: proyectos.filter((proyecto) => proyecto.estado === etapa).length,
  }))

  // El atajo, a esta densidad: no se puede pintar el recorrido de cada
  // proyecto, asi que se dice cuantos de los que estan en CREATED no van a
  // pasar por Analizado. Sin esta linea, la columna de `DISCOVERED` en cero se
  // lee como "nadie ha corrido el analisis" cuando puede ser "ninguno de estos
  // necesita analisis".
  const nuevosEnCreated = proyectos.filter(
    (proyecto) => proyecto.origen === 'nuevo' && proyecto.estado === 'CREATED',
  ).length

  const parados =
    ahora === null
      ? []
      : proyectos
          .map((proyecto) => ({
            proyecto,
            dias: diasSinMoverse(proyecto, ahora),
          }))
          .filter(
            (fila): fila is { proyecto: Proyecto; dias: number } =>
              // Un proyecto ACTIVE no esta parado: no tiene etapa que esperar.
              // Que lleve un mes sin transicionar es lo normal, porque ya no
              // le quedan transiciones.
              fila.proyecto.estado !== 'ACTIVE' &&
              fila.dias !== null &&
              fila.dias >= diasParaNombrarParado,
          )
          .sort((uno, otro) => otro.dias - uno.dias)

  if (proyectos.length === 0) {
    return (
      <p className="text-copy-14 text-ds-gray-900">
        No hay ningun proyecto registrado, asi que no hay ciclo de vida que contar. El
        recorrido empieza en Proyectos, dando de alta el primero.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <ol className="grid grid-cols-3 gap-x-6 gap-y-5 sm:grid-cols-6">
        {reparto.map(({ etapa, cuantos }) => (
          <li key={etapa} className="flex min-w-0 flex-col gap-1">
            {/* El eje. Una linea de 1px que dice si esta etapa tiene
                proyectos: es el dato, no un adorno. Sin ella las seis columnas
                se leen como seis metricas sueltas en vez de como un recorrido. */}
            <span
              aria-hidden="true"
              className={cn(
                'h-px w-full',
                cuantos > 0 ? 'bg-ds-gray-1000' : 'bg-ds-gray-400',
              )}
            />
            {/* Mono con `tabular-nums`, igual que los indicadores de al lado en
                esta misma pantalla: dos fuentes para los numeros de una sola
                pantalla se ve como un fallo de pintado. */}
            <span className="fuente-operativa pt-1 text-heading-20 text-ds-gray-1000">
              {cuantos}
            </span>
            <span className="text-label-12 text-ds-gray-900">
              {ETIQUETA_ESTADO_PROYECTO[etapa]}
            </span>
          </li>
        ))}
      </ol>

      {nuevosEnCreated > 0 ? (
        // Sin pronombre y con el verbo concertado: el HTML generado pillo un
        // "les declara" colgando de "1 proyecto nuevo".
        <p className="text-label-13 text-ds-gray-700">
          {conPlural(nuevosEnCreated, 'proyecto nuevo', 'proyectos nuevos')} de los que
          estan en Creado {nuevosEnCreated === 1 ? 'salta' : 'saltan'} Analizado: sin
          codigo que escanear, la maquina de estados declara el atajo directo a Con
          constitution.
        </p>
      ) : null}

      {/* Con `ahora === null` no se pinta ni el titulo. El HTML generado
          enseno un "Parados" con nada debajo, que se lee como "no hay
          ninguno" cuando lo que pasa es que todavia no se sabe. */}
      {ahora === null ? null : (
        <div className="flex flex-col gap-3">
          <h3 className="text-heading-14 text-ds-gray-1000">Parados</h3>

          {parados.length === 0 ? (
            <p className="text-copy-14 text-ds-gray-900">
              Ningun proyecto lleva {diasParaNombrarParado} dias o mas sin moverse de
              etapa. La cuenta sale del instante en que el proyecto cambio por ultima vez,
              y el umbral lo pone esta consola: no hay ninguno declarado por el servicio.
            </p>
          ) : (
            <ListaDeEntidades etiqueta="Proyectos que llevan dias sin moverse de etapa">
              {parados.map(({ proyecto, dias }) => {
                const falta = etapaQueFalta(proyecto)
                const destino = destinoDeLaEtapaQueFalta(proyecto)

                return (
                  <Entity
                    key={proyecto.id}
                    contenedor="li"
                    miniatura={<Clock />}
                    titulo={proyecto.nombre}
                    identificador={proyecto.ruta_local ?? proyecto.remoto ?? undefined}
                    descripcion={<LoQueFalta proyecto={proyecto} />}
                    metadatos={
                      <>
                        {/* El unico color de la pieza, y con la palabra al lado
                          dentro del badge: el ambar acelera el barrido, el
                          texto es lo que informa. */}
                        <Badge tono="advertencia">
                          Sin moverse {conPlural(dias, 'dia', 'dias')}
                        </Badge>
                        <CicloDeVida proyecto={proyecto} />
                      </>
                    }
                    acciones={
                      falta ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => navegar({ seccion: destino, id: proyecto.id })}
                        >
                          Continuar en {falta.etapa}
                        </Button>
                      ) : null
                    }
                    alPulsar={() => navegar({ seccion: 'snapshot', id: proyecto.id })}
                  />
                )
              })}
            </ListaDeEntidades>
          )}
        </div>
      )}
    </div>
  )
}
