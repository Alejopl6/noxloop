'use client'

import { useEffect, useRef, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * El cascaron de las superficies modales, sobre `<dialog>` nativo.
 *
 * POR QUE `<dialog>` Y NO UN `div` CON `position: fixed`. Esta fase no tiene
 * Radix (`research.md` §2 y `button.tsx`: no hay `@radix-ui/*` instalado), y la
 * version casera de un modal es donde mas cosas se olvidan: la trampa de foco,
 * devolver el foco al cerrar, Escape, y sobre todo dejar INERTE lo de detras —
 * sin eso el lector de pantalla sigue recorriendo la pagina entera por debajo
 * del modal y el operador no entiende donde esta.
 *
 * `showModal()` da las cuatro cosas de fabrica, ademas del top-layer (que
 * resuelve de raiz las guerras de `z-index`) y de un `::backdrop` real. Es mas
 * correcto que casi cualquier implementacion a mano, y son veinte lineas.
 *
 * LO QUE FALTA, Y QUE TRAERIA RADIX el dia que entre: control fino del retorno
 * de foco (a un elemento elegido, no al ultimo que lo tuvo), bloqueo del scroll
 * del `body` sin saltos por la barra de scroll, y animaciones de entrada/salida
 * coordinadas con el desmontaje. Nada de eso es correccion: es pulido.
 *
 * EL MOVIMIENTO ES DE ENTRADA Y NADA MAS, y eso es una decision, no una tarea
 * a medias. Una animacion de SALIDA exige retrasar el `close()` hasta que
 * termine —`@starting-style` no cubre el camino de vuelta de un `<dialog>` sin
 * `transition-behavior: allow-discrete` y un desmontaje coordinado— y eso pone
 * entre 200 y 300ms entre "el operador pulso Escape" y "el foco vuelve". Cerrar
 * es la salida de emergencia de esta superficie: no se le pone un retraso
 * encima para que se vea bonita. La entrada si tiene trabajo que hacer: dice de
 * donde salio esto.
 *
 * `showModal()` saca el `<dialog>` de `display: none`, y ese cambio es
 * justamente lo que rearranca las animaciones CSS. Por eso no hace falta
 * ninguna clave de React ni un `useEffect` para que la entrada se repita en
 * cada apertura: la da el navegador.
 *
 * EL VELO SALE DE SU PROPIO TOKEN, `--ds-overlay-backdrop-*`.
 *
 * Este parrafo decia otra cosa —que el velo usaba `gray-100` porque Geist no
 * trae token de velo— y era falso desde que se extrajo el token de verdad: el
 * comentario en linea de abajo ya lo usaba, asi que la cabecera contradecia al
 * codigo doce lineas mas abajo. Se corrige aqui porque un comentario obsoleto
 * es peor que ninguno: el siguiente que lea esto habria "arreglado" el codigo
 * para que coincidiera con la explicacion equivocada.
 *
 * El razonamiento que SI se conserva, porque sigue siendo cierto y no es
 * obvio: la escala `gray-alpha` parece la candidata natural para un velo y no
 * lo es, porque en tema oscuro es BLANCA translucida —esta pensada para
 * aclarar superficies sobre negro— y un velo blanco sobre un modal oscuro
 * deslumbra. El token de Geist resuelve a `gray-100` en claro y a
 * `background-200` (negro) en oscuro, asi que el fondo se apaga en los dos.
 */

const ANCHOS = {
  sm: 'w-[min(24rem,calc(100vw-2rem))]',
  md: 'w-[min(32rem,calc(100vw-2rem))]',
  lg: 'w-[min(40rem,calc(100vw-2rem))]',
} as const

export interface PropsDeDialogo {
  abierto: boolean
  /** Se llama tambien cuando cierra el navegador (Escape, clic fuera). */
  alCerrar: () => void
  /** Como se anuncia el dialogo. Obligatoria: un dialogo sin nombre no se sabe que es. */
  etiqueta: string
  ancho?: keyof typeof ANCHOS
  /** Permite cerrar pulsando el fondo. Se apaga para acciones destructivas. */
  cerrarAlPulsarFuera?: boolean
  /**
   * Con que par de tokens de movimiento entra.
   *
   * `overlay` (.3s) para una superficie que interrumpe y sobre la que hay que
   * decidir; `popover` (.2s) para una superficie transitoria que se abre y se
   * cierra muchas veces seguidas. Es una prop y no una deduccion porque Geist
   * define las dos duraciones POR SEPARADO a proposito: un popover a .3s se
   * siente lento y un modal a .2s se siente brusco. El mismo numero con dos
   * nombres no habria necesitado dos tokens.
   */
  movimiento?: 'overlay' | 'popover'
  children: ReactNode
  className?: string
}

export function Dialogo({
  abierto,
  alCerrar,
  etiqueta,
  ancho = 'md',
  cerrarAlPulsarFuera = true,
  movimiento = 'overlay',
  children,
  className,
}: PropsDeDialogo) {
  const referencia = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialogo = referencia.current
    if (!dialogo) return
    // Se compara contra `dialogo.open` y no se llama a ciegas: `showModal()`
    // sobre un dialogo ya abierto lanza `InvalidStateError`, y React puede
    // volver a correr este efecto sin que `abierto` haya cambiado de verdad.
    if (abierto && !dialogo.open) dialogo.showModal()
    if (!abierto && dialogo.open) dialogo.close()
  }, [abierto])

  return (
    <dialog
      ref={referencia}
      aria-label={etiqueta}
      // `onClose` cubre los tres caminos a la vez: Escape, el clic de fuera y
      // el `close()` de arriba. Sin el, cerrar con Escape deja el estado de
      // React diciendo que el dialogo sigue abierto y no se puede reabrir.
      onClose={alCerrar}
      onClick={(evento) => {
        if (!cerrarAlPulsarFuera) return
        // El `::backdrop` no es un elemento: los clics de fuera llegan con el
        // propio `<dialog>` como objetivo. Es la unica forma de distinguirlos.
        if (evento.target === referencia.current) alCerrar()
      }}
      className={cn(
        // `m-auto` explicito: la hoja base de Tailwind pone `margin: 0` en
        // todo, y con eso se pierde el centrado que el navegador le da a un
        // dialogo modal.
        'fixed inset-0 m-auto h-fit max-h-[85dvh] overflow-auto rounded-lg bg-ds-background-100 p-0 text-ds-gray-1000 shadow-ds-modal',
        // El velo sale del token de Geist, no de una aproximacion. La primera
        // version usaba `bg-ds-gray-100/80`, que acierta en claro y falla en
        // oscuro: ahi `gray-100` es #1a1a1a y el velo ACLARA el fondo en vez de
        // apagarlo. El token resuelve a negro en oscuro y a gris en claro.
        '[&::backdrop]:bg-[var(--ds-overlay-backdrop-color)]',
        '[&::backdrop]:opacity-[var(--ds-overlay-backdrop-opacity)]',
        // La superficie escala desde `--ds-motion-overlay-scale` (.96). El
        // trabajo del movimiento es decir DE DONDE salio esto: un modal que
        // aparece ya a tamano final se lee como una capa que estaba puesta y
        // alguien encendio, no como algo que la pagina de detras acaba de
        // levantar.
        movimiento === 'popover' ? 'movimiento-popover' : 'movimiento-overlay',
        // El velo se funde aparte y sin escalar: no es un objeto que llega, es
        // la pagina de detras apagandose. Si compartiera la animacion de la
        // superficie, el fondo entero "creceria" un 4% en cada apertura.
        //
        // Y usa SIEMPRE la duracion de overlay, tambien cuando la superficie
        // entra con la de popover: el velo es la misma pagina apagandose se
        // abra lo que se abra encima, asi que no tiene dos velocidades. Lo que
        // cambia segun lo que se abre es la superficie.
        '[&::backdrop]:movimiento-velo',
        ANCHOS[ancho],
        className,
      )}
    >
      {/* Los hijos se montan siempre, pero el navegador no pinta un `<dialog>`
          cerrado. Montarlos solo al abrir haria que el `autoFocus` del primer
          campo llegara tarde. */}
      {children}
    </dialog>
  )
}
