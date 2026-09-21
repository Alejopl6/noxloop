'use client'

import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight, SkipForward, TerminalSquare } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/insignia'
import { CicloDeVida } from '@/components/ui/ciclo-de-vida'
import { ANCHO_DE_CLASE } from '@/components/marco/lienzo'
import { ETIQUETA_DE_SECCION } from '@/components/marco/secciones'
import { ProveedorDeAsistente } from '@/components/marco/contexto'
import {
  sePuedeAvanzar,
  type PasoDelAsistente,
  type VeredictoDelPaso,
} from '@/components/asistente/paso'
import { cn } from '@/lib/utils'
import type { ArtefactosDeProyecto, Proyecto } from '@/lib/tipos'

/**
 * EL MARCO DEL RECORRIDO. Pieza pura: todo lo que pinta le llega por props.
 *
 * POR QUE PURA, Y NO ES UN GUSTO ARQUITECTONICO. Es la misma division que ya
 * usan las trece vistas (`PanelDeX` puro, `VistaDeX` con los datos), y aqui
 * sirve ademas para lo unico que sustituye a mirar la pantalla en este
 * entorno: un componente que no depende del servicio se puede montar en el
 * prerender y leer el HTML que produce. Los seis fallos que frentes anteriores
 * pillaron —tipografias que `twMerge` borraba, un titulo con nada debajo, un
 * verbo mal concertado— se encontraron asi y no con el typecheck.
 *
 * LO QUE ESTE MARCO ENSENA, y por que cada cosa:
 *
 *   1. DONDE ESTAS EN EL RECORRIDO. Una tira de nombres, no una barra de
 *      porcentaje: el operador necesita saber que viene despues, y un 40% no
 *      lo dice. Cada nombre navega, porque un indicador que no lleva a ningun
 *      sitio es decoracion.
 *   2. QUE DECIDES AQUI. El `proposito` del paso, en segunda persona. Es la
 *      linea que convierte trece destinos en un recorrido.
 *   3. QUE DICE LA MAQUINA DE ESTADOS. `CicloDeVida`, el mismo componente que
 *      pinta la fila del inventario, que ya sabe del atajo del proyecto nuevo
 *      y que dice la etapa con palabras ademas de con la regleta. El progreso
 *      honesto es este, no la tira de arriba: la tira dice por donde vas
 *      andando, y esto dice que da por cerrado el servicio.
 *
 * POR QUE LA TIRA NO PINTA PASOS "COMPLETADOS". Porque habria que inventarlo.
 * Tres de los nueve pasos no tienen guarda que lo diga —guidelines, diseno y
 * el final— y marcar en verde un paso por el que se paso seria afirmar algo
 * que el servicio no afirma. La tira dice posicion; los checkmarks que no
 * existen habrian dicho progreso.
 *
 * UNA COLUMNA Y CENTRADA. El ancho sale de `ANCHO_DE_CLASE` —la misma tabla
 * que usa el lienzo— y lo elige el paso, porque un paso de diffs y un paso de
 * un campo no caben en el mismo tope.
 */

export function MarcoDelAsistente({
  paso,
  pasos,
  proyecto,
  artefactos,
  veredicto,
  avisoDePreparacion,
  alIrAlPaso,
  alSiguiente,
  alAtras,
  alSalirAConsola,
  children,
}: {
  paso: PasoDelAsistente
  /** Los pasos aplicables a ESTE proyecto, en orden. */
  pasos: readonly PasoDelAsistente[]
  proyecto: Proyecto | null
  artefactos: ArtefactosDeProyecto | null
  /** Lo que dice la guarda del servicio. Ver `veredictoDelPaso` en `paso.ts`. */
  veredicto: VeredictoDelPaso
  avisoDePreparacion?: ReactNode
  alIrAlPaso: (paso: PasoDelAsistente) => void
  /** `null` cuando este es el ultimo paso. */
  alSiguiente: (() => void) | null
  /** `null` cuando este es el primero. */
  alAtras: (() => void) | null
  /** `null` cuando el paso no tiene pantalla de consola equivalente. */
  alSalirAConsola: (() => void) | null
  children: ReactNode
}) {
  const posicion = pasos.findIndex((candidato) => candidato.id === paso.id)

  return (
    <div className={cn('mx-auto flex w-full flex-col gap-8', ANCHO_DE_CLASE[paso.ancho])}>
      <header className="flex flex-col gap-5">
        <TiraDePasos pasos={pasos} actual={paso} alIrAlPaso={alIrAlPaso} />

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* La posicion escrita, que es lo que lee quien no ve la tira. */}
            <span className="text-label-12 text-ds-gray-700">
              Paso {posicion + 1} de {pasos.length}
            </span>

            {paso.omitible ? <Badge tono="neutral">Omitible</Badge> : null}

            {veredicto === 'cerrada' ? <Badge tono="exito">Etapa cerrada</Badge> : null}
          </div>

          <h1 className="text-heading-24 text-ds-gray-1000">{paso.titulo}</h1>
          <p className="text-copy-14 text-ds-gray-900">{paso.proposito}</p>

          {/* LO AUTOMATICO, DICHO ENTERO Y COMO PROSA, NO COMO BADGE.
              Empezo siendo un `Badge` con la frase dentro y el HTML generado
              enseno el problema: un badge lleva `whitespace-nowrap`, asi que
              una frase de treinta y siete caracteres no se puede partir y en
              una ventana estrecha se sale de la caja. Y ademas contradecia la
              doctrina del propio componente —"el estado de una cosa, en una
              palabra"—. La frase entera importa: sin la segunda mitad, la
              palabra "automatico" promete que ya esta hecho. */}
          {paso.automatico ? (
            <p className="text-label-13 text-ds-gray-700">
              Este paso lo prepara la maquina; la decision sigue siendo tuya.
            </p>
          ) : null}
        </div>

        {proyecto ? <CicloDeVida proyecto={proyecto} artefactos={artefactos} /> : null}
      </header>

      {avisoDePreparacion}

      {/* El contenido del paso: la vista de siempre, entera.
          `ProveedorDeAsistente` es lo unico que se le anade, y solo para que
          su `Encabezado` sepa que el `<h1>` de esta pagina ya esta puesto. */}
      <ProveedorDeAsistente>
        <div className="flex flex-col gap-6">{children}</div>
      </ProveedorDeAsistente>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-ds-gray-400 pt-5">
        <div className="flex flex-wrap items-center gap-2">
          {alAtras ? (
            <Button variant="ghost" onClick={alAtras}>
              <ArrowLeft />
              Paso anterior
            </Button>
          ) : null}

          {/* LA SALIDA AL MODO CONSOLA, en todos los pasos que tienen pantalla.
              Las trece vistas siguen ahi: un operador con doce proyectos no
              quiere un asistente para cambiar una credencial. */}
          {alSalirAConsola && paso.seccion ? (
            <Button
              variant="ghost"
              onClick={alSalirAConsola}
              // El nombre accesible dice a donde lleva Y que se sale del
              // recorrido; la etiqueta visible se queda con lo corto.
              aria-label={`Salir del asistente y abrir la pantalla de ${ETIQUETA_DE_SECCION[paso.seccion]} en el modo consola`}
            >
              <TerminalSquare />
              {/* "Abrir la pantalla de X" y no "Abrir x sin el asistente": el
                  HTML generado enseno "Abrir snapshot sin el asistente" y
                  "Abrir conexiones sin el asistente", con el articulo bailando
                  segun el genero y el numero de cada seccion. Con el sustantivo
                  delante, la frase concierta con las trece. */}
              Abrir la pantalla de {ETIQUETA_DE_SECCION[paso.seccion]}
            </Button>
          ) : null}
        </div>

        {alSiguiente ? (
          <SiguientePaso paso={paso} veredicto={veredicto} alSiguiente={alSiguiente} />
        ) : null}
      </footer>
    </div>
  )
}

/**
 * El boton de avanzar, y lo que dice cuando no se puede.
 *
 * NO ES UN BOTON QUE SALTA LA GUARDA. Un paso con artefacto exigido y con la
 * guarda abierta no se puede pasar desde aqui: el servicio rechazaria la
 * transicion de todas formas, y un boton que lleva a un rechazo es peor que
 * uno apagado. Lo que si hace, siempre, es DECIR POR QUE — NFR-006: que paso y
 * que hacer, y el segundo no es opcional.
 *
 * EN UN PASO OMITIBLE ESTE BOTON NO ES EL PRINCIPAL, y por eso va en
 * `secondary`. La accion principal del diseno es guardarlo, y vive en el
 * cuerpo; un "Omitir y seguir" pintado como el boton mas oscuro de la pantalla
 * ensena a omitir, que es lo contrario de lo que FR-023 pretende — la etapa es
 * opcional, no desaconsejada.
 */
function SiguientePaso({
  paso,
  veredicto,
  alSiguiente,
}: {
  paso: PasoDelAsistente
  veredicto: VeredictoDelPaso
  alSiguiente: () => void
}) {
  const puede = sePuedeAvanzar(paso, veredicto)

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        variant={paso.omitible ? 'secondary' : 'default'}
        onClick={alSiguiente}
        disabled={!puede}
      >
        {paso.omitible ? <SkipForward /> : null}
        {paso.omitible ? 'Omitir y seguir' : 'Siguiente paso'}
        {paso.omitible ? null : <ArrowRight />}
      </Button>

      {!puede ? (
        <p className="max-w-md text-right text-label-12 text-ds-gray-700">
          {veredicto === 'sin_respuesta'
            ? 'Todavia no ha llegado el detalle del proyecto, asi que no se puede decir si esta etapa esta cerrada. Espera un momento o recarga.'
            : 'Esta etapa todavia no esta cerrada para el servicio. Lo que falta esta escrito arriba, junto al estado del proyecto.'}
        </p>
      ) : null}

      {/* El servicio contesto sin veredicto para esta guarda. No se bloquea
          —lo que no se puede leer no se puede exigir— pero se dice, porque
          avanzar sin saberlo es avanzar a ciegas. */}
      {veredicto === 'no_publicada' ? (
        <p className="max-w-md text-right text-label-12 text-ds-gray-700">
          El servicio contesto sin veredicto para la guarda de esta etapa, asi que el
          asistente no puede decir si esta cerrada. Se deja avanzar; comprueba el estado
          del proyecto antes de dar la etapa por hecha.
        </p>
      ) : null}
    </div>
  )
}

/**
 * La tira de pasos. Texto, sin iconos y sin checkmarks: ver la cabecera.
 *
 * Es un `<ol>` porque es una secuencia, y cada entrada navega. La actual lleva
 * `aria-current="step"`, que es el valor que existe exactamente para esto y no
 * `"page"`: no se esta cambiando de pagina, se esta avanzando dentro de una.
 *
 * DESPLAZA EN HORIZONTAL EN VEZ DE ENVOLVER. Nueve nombres envolviendo en dos
 * lineas en una ventana estrecha mueven el titulo de sitio segun el paso en el
 * que estes, y el encabezado deja de ser un punto fijo de la pantalla.
 */
function TiraDePasos({
  pasos,
  actual,
  alIrAlPaso,
}: {
  pasos: readonly PasoDelAsistente[]
  actual: PasoDelAsistente
  alIrAlPaso: (paso: PasoDelAsistente) => void
}) {
  return (
    <nav aria-label="Pasos del recorrido guiado">
      <ol className="flex items-center gap-1 overflow-x-auto">
        {pasos.map((paso, indice) => {
          const esActual = paso.id === actual.id

          return (
            <li key={paso.id} className="flex shrink-0 items-center gap-1">
              {indice > 0 ? (
                <span aria-hidden="true" className="select-none text-ds-gray-700">
                  /
                </span>
              ) : null}

              <button
                type="button"
                aria-current={esActual ? 'step' : undefined}
                onClick={() => alIrAlPaso(paso)}
                // Sin `cn()`: `twMerge` no conoce `text-label-13` ni
                // `text-button-14` y las borra al ver el `text-ds-gray-*` de al
                // lado. Comprobado en el HTML generado por frentes anteriores;
                // la explicacion entera esta en `components/marco/migas.tsx`.
                className={`whitespace-nowrap rounded-md px-1.5 py-0.5 transition-colors ${
                  esActual
                    ? 'bg-ds-gray-alpha-100 text-button-14 text-ds-gray-1000'
                    : 'text-label-13 text-ds-gray-700 hover:text-ds-gray-1000'
                }`}
              >
                {paso.titulo}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
