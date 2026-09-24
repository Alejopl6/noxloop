'use client'

import { useCallback, useEffect, useState } from 'react'
import { Copy, Eye, EyeOff, KeyRound } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Desconocido } from '@/components/ui/desconocido'

/**
 * T162 · `SecretValue` — FR-040, FR-041 y NFR-004 hechos interfaz.
 *
 * LO QUE ESTE COMPONENTE ENSENA CASI SIEMPRE ES UNA HUELLA, NO UN SECRETO, y
 * eso no es una limitacion: es el producto. La boveda vive detras de comandos
 * de Rust que no estan expuestos al webview (research.md §1), asi que la
 * interfaz NO TIENE RUTA para pedir el valor de una credencial. No existe el
 * endpoint. NFR-004 dice que ningun secreto aparece en la interfaz, y aqui la
 * forma de cumplirlo no es acordarse: es que no hay por donde.
 *
 * Por eso el modo por defecto —sin `valor`— no es un caso degradado ni un
 * estado de carga. Es el normal. Y lo dice con todas las letras, porque un
 * campo con puntitos y sin boton de revelar parece roto si nadie explica que
 * no hay nada que revelar.
 *
 * `valor` existe para el unico caso en que la interfaz tiene el secreto en la
 * mano: el instante entre que el operador lo pega y el servicio lo guarda, o un
 * revelado de un solo uso que el servicio conceda explicitamente. Nunca sale de
 * ahi, nunca se persiste en esta aplicacion (que no guarda estado, principio
 * VIII) y se oculta solo.
 *
 * LAS DECISIONES DE DETALLE, que es donde este componente se gana el sueldo:
 *
 *   1. QUE SE COPIA. En modo huella se copia LA HUELLA, y el boton lo dice
 *      ("Copiar huella"), porque un boton que pone "Copiar" junto a algo que
 *      parece un secreto promete el secreto. En modo valor se copia el valor.
 *      Nunca hay un boton que copie algo distinto de lo que se esta mirando.
 *
 *   2. QUE SE PROMETE AL COPIAR. Nada. El aviso dice que el valor queda en el
 *      portapapeles hasta que se copie otra cosa, y es verdad. La alternativa
 *      —vaciar el portapapeles a los 30 segundos— suena mejor y es peor: borra
 *      lo que el operador copiara despues y no protege de nada, porque quien
 *      puede leer el portapapeles ya lo leyo en el primer segundo.
 *
 *   3. EL VALOR REVELADO SE VUELVE A OCULTAR SOLO, y por tres caminos, no uno:
 *      al agotarse la cuenta atras, al cambiar de pestana o minimizar
 *      (`visibilitychange`) y al perder el foco la ventana. La cuenta atras
 *      cubre el descuido; los otros dos cubren el caso real, que es levantarse
 *      de la mesa con el token en pantalla.
 *
 *   4. LA MASCARA TIENE LONGITUD FIJA. `'•'.repeat(valor.length)` filtra la
 *      longitud del secreto, y la longitud es informacion: distingue un PAT de
 *      40 de una clave de 64 y recorta el espacio de busqueda. Doce puntos
 *      siempre.
 *
 *   5. OCULTO SIGNIFICA AUSENTE DEL DOM. No hay `filter: blur` ni un
 *      `-webkit-text-security`: el valor sencillamente no se renderiza. Un
 *      secreto tapado por CSS esta en el HTML, y de ahi lo sacan el inspector,
 *      una extension, una captura de pantalla del arbol de accesibilidad y
 *      cualquier volcado del DOM.
 */

/** Doce. Ni los que mida el secreto. Ver el punto 4 de la cabecera. */
const MASCARA = '••••••••••••'

export interface PropsDeSecretValue {
  /**
   * Lo que la boveda SI entrega: la huella del valor (FR-040). Se pinta entera
   * y en Geist Mono, porque es un identificador operativo y porque truncarla
   * la vuelve inutil para comparar con la del proveedor.
   */
  huella?: string | null
  /**
   * El valor en claro. Ausente en el 99% de los casos — ver la cabecera. Si
   * llega, llega de paso.
   */
  valor?: string | null
  /** Como se llama esto al anunciarlo. "el token de despliegue", "la clave". */
  etiqueta?: string
  /** Cuanto aguanta visible antes de ocultarse solo. */
  segundosVisible?: number
  className?: string
}

export function SecretValue({
  huella,
  valor,
  etiqueta = 'el valor',
  segundosVisible = 20,
  className,
}: PropsDeSecretValue) {
  const [revelado, setRevelado] = useState(false)
  const [restante, setRestante] = useState(segundosVisible)
  const [mensaje, setMensaje] = useState<string | null>(null)

  // Cuenta atras. Se reinicia en cada revelado porque el estado arranca de
  // nuevo al entrar en el `if`.
  useEffect(() => {
    if (!revelado) return
    if (restante <= 0) {
      setRevelado(false)
      setMensaje(`Se oculto ${etiqueta} por inactividad.`)
      return
    }
    const temporizador = setTimeout(() => setRestante((s) => s - 1), 1000)
    return () => clearTimeout(temporizador)
  }, [revelado, restante, etiqueta])

  // Los dos caminos que cubren el descuido de verdad: cambiar de pestana y
  // dejar la ventana. Si el operador no esta mirando, el secreto no esta en
  // pantalla.
  useEffect(() => {
    if (!revelado) return
    const ocultar = () => {
      setRevelado(false)
      setMensaje(`Se oculto ${etiqueta} al dejar la ventana.`)
    }
    const alCambiarVisibilidad = () => {
      if (document.hidden) ocultar()
    }
    window.addEventListener('blur', ocultar)
    document.addEventListener('visibilitychange', alCambiarVisibilidad)
    return () => {
      window.removeEventListener('blur', ocultar)
      document.removeEventListener('visibilitychange', alCambiarVisibilidad)
    }
  }, [revelado, etiqueta])

  const copiar = useCallback(
    async (texto: string, que: string) => {
      // `navigator.clipboard` no existe fuera de contexto seguro, y el webview
      // de Tauri no siempre lo es. Se dice que paso y que hacer, en ese orden.
      if (!navigator.clipboard?.writeText) {
        setMensaje(
          `No se pudo copiar ${que}: este entorno no da acceso al portapapeles. Selecciona el texto y copialo con el teclado.`,
        )
        return
      }
      try {
        await navigator.clipboard.writeText(texto)
        setMensaje(
          `${que} copiada al portapapeles. Queda ahi hasta que copies otra cosa.`,
        )
      } catch {
        setMensaje(
          `No se pudo copiar ${que}: el navegador denego el acceso al portapapeles. Selecciona el texto y copialo con el teclado.`,
        )
      }
    },
    [],
  )

  const hayValor = typeof valor === 'string' && valor.length > 0
  const hayHuella = typeof huella === 'string' && huella.length > 0

  if (!hayValor && !hayHuella) {
    return (
      <span className={cn('inline-flex items-center gap-2', className)}>
        <Desconocido razon="Sin credencial registrada" />
      </span>
    )
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="size-4 shrink-0 text-ds-gray-700" aria-hidden="true" />

        <span className="fuente-operativa min-w-0 break-all text-label-13 text-ds-gray-1000">
          {hayValor ? (revelado ? valor : MASCARA) : (huella as string)}
        </span>

        {hayValor ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (revelado) {
                  setRevelado(false)
                  setMensaje(`Se oculto ${etiqueta}.`)
                  return
                }
                setRestante(segundosVisible)
                setRevelado(true)
                setMensaje(
                  `${etiqueta} esta visible y se ocultara sola en ${segundosVisible} segundos.`,
                )
              }}
            >
              {revelado ? <EyeOff /> : <Eye />}
              {revelado ? 'Ocultar' : 'Mostrar'}
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => void copiar(valor as string, 'La credencial')}
            >
              <Copy />
              Copiar valor
            </Button>
          </>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void copiar(huella as string, 'La huella')}
          >
            <Copy />
            Copiar huella
          </Button>
        )}
      </div>

      {hayValor ? (
        revelado ? (
          <p className="text-label-12 text-ds-gray-700">
            Se ocultara en {restante} s. Tambien se oculta si cambias de ventana.
          </p>
        ) : (
          <p className="text-label-12 text-ds-gray-700">
            Oculto. Mostrarlo es una accion deliberada y queda a la vista de quien
            tengas detras.
          </p>
        )
      ) : (
        <p className="text-label-12 text-ds-gray-700">
          Esto es la huella, no la credencial. La boveda del sistema operativo no
          entrega el valor a esta interfaz: no hay ninguna pantalla donde pueda
          aparecer.
        </p>
      )}

      {/* El canal de anuncios. Vive fuera de los botones para que el lector de
          pantalla lo lea como novedad y no como parte del control pulsado. */}
      <p role="status" aria-live="polite" className="sr-only">
        {mensaje}
      </p>
      {mensaje ? (
        <p className="text-label-12 text-ds-gray-900" aria-hidden="true">
          {mensaje}
        </p>
      ) : null}
    </div>
  )
}
