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
 * EL FONDO OSCURECEDOR USA `gray-100`, y merece explicacion porque parece un
 * error. La escala `gray-alpha` seria la candidata obvia, pero en tema oscuro
 * es BLANCA translucida (esta pensada para aclarar superficies sobre negro), y
 * un velo blanco sobre un modal oscuro deslumbra. `gray-100` es el gris mas
 * cercano al lienzo en los dos temas —casi blanco en claro, casi negro en
 * oscuro— asi que el contenido de detras se desvanece HACIA el fondo en ambos.
 * Los tokens de Geist no traen un token de velo; queda anotado en el informe.
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
  children: ReactNode
  className?: string
}

export function Dialogo({
  abierto,
  alCerrar,
  etiqueta,
  ancho = 'md',
  cerrarAlPulsarFuera = true,
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
