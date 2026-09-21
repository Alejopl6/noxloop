'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Note } from '@/components/ui/nota'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { useMutacion } from '@/lib/mutacion'
import { useServicio } from '@/components/proveedor-servicio'
import type { ErrorDelServicio } from '@/lib/daemon'
import type { PasoDelAsistente, PeticionDePreparacion } from '@/components/asistente/paso'

/**
 * LO AUTOMATICO, Y EL LIMITE EXACTO DE LO AUTOMATICO.
 *
 * El operador pidio que el bootstrap fuera automatico y que la flota se
 * sugiriera sola. Lo que eso significa aqui, y no significa otra cosa: al
 * entrar en el paso, el asistente lanza SOLO el trabajo que PRODUCE UNA
 * PROPUESTA, y te la ensena para que decidas. No lanza nada que escriba en el
 * repositorio del operador. La constitution de este repositorio y FR-026 lo
 * exigen —el diff exacto se ensena antes de tocar nada— y el contrato del paso
 * lo hace comprobable: `PreparacionAutomatica.porQueNoEscribe` es un campo
 * obligatorio, se pinta en pantalla, y un paso cuyo autor no sepa escribir esa
 * frase no puede declararse automatico.
 *
 * SE LANZA UNA VEZ POR PROYECTO Y PASO, y esa es la parte que se olvida: sin
 * la llave de abajo, cada repintado del componente —un evento del canal SSE,
 * una relectura, el operador plegando un detalle— vuelve a lanzar la peticion,
 * y el paso queda en un bucle de analisis que nunca ensena nada. Se vuelve a
 * lanzar solo si el operador lo pide, con el boton de rehacer.
 *
 * Y NO SE LANZA SIN SERVICIO. `useMutacion` sabe decir que no hay cliente, y
 * lo dice bien, pero un error de "no hay servicio" que aparece solo porque el
 * asistente entro en un paso es ruido: el banner del marco ya lo dijo.
 */

export type EstadoDePreparacion =
  | 'inactiva'
  | 'corriendo'
  | 'hecha'
  | 'fallida'
  /** El frente que produce esta preparacion todavia no expone la peticion. */
  | 'sin_peticion'

export function usePreparacionAutomatica(
  paso: PasoDelAsistente,
  proyectoId: string | null,
  /** Se llama cuando la preparacion termino bien: toca releer lo que produjo. */
  alTerminar: () => void,
): {
  estado: EstadoDePreparacion
  error: ErrorDelServicio | null
  rehacer: () => void
} {
  const { estado: estadoDelServicio } = useServicio()
  const mutacion = useMutacion()
  const [estado, setEstado] = useState<EstadoDePreparacion>('inactiva')

  /**
   * Cuantas veces se ha pedido rehacer.
   *
   * VA EN EL ESTADO Y EN LAS DEPENDENCIAS DEL EFECTO, y no es redundante con
   * la llave de abajo. Borrar la llave sola no vuelve a lanzar nada: el efecto
   * no se reejecuta porque ninguna de sus dependencias cambio, asi que el
   * boton de rehacer dejaba el aviso en blanco y no pasaba nada mas. Con este
   * contador, rehacer es una dependencia que cambia.
   */
  const [vuelta, setVuelta] = useState(0)

  // La llave de "esto ya se lanzo". `null` significa que todavia no.
  const lanzada = useRef<string | null>(null)

  // `alTerminar` cambia de identidad en cada render del padre; guardarla en
  // una referencia evita que el efecto se vuelva a disparar por eso solo, que
  // es el bucle que la llave de arriba ya intenta cortar.
  const alTerminarRef = useRef(alTerminar)
  alTerminarRef.current = alTerminar

  const enviar = mutacion.enviar

  useEffect(() => {
    const preparacion = paso.preparacion
    if (!preparacion || !proyectoId) return
    if (estadoDelServicio !== 'conectado') return

    if (!preparacion.peticion) {
      setEstado('sin_peticion')
      return
    }

    const llave = `${paso.id}:${proyectoId}`
    if (lanzada.current === llave) return
    lanzada.current = llave

    const peticion: PeticionDePreparacion = preparacion.peticion(proyectoId)
    let vigente = true
    setEstado('corriendo')

    void enviar(peticion.metodo, peticion.ruta, peticion.cuerpo).then((resultado) => {
      if (!vigente) return
      // `enviar` devuelve `null` al fallar Y tambien cuando la respuesta no
      // trae cuerpo, asi que `null` solo no distingue las dos cosas. Lo que
      // las distingue es que el hook deja el error puesto, y eso se consulta
      // en el render, no aqui: mirar `mutacion.error` dentro de este efecto
      // leeria el valor de la vuelta anterior.
      setEstado(resultado === null ? 'fallida' : 'hecha')
      if (resultado !== null) alTerminarRef.current()
    })

    return () => {
      vigente = false
    }
  }, [paso, proyectoId, estadoDelServicio, enviar, vuelta])

  const rehacer = useCallback(() => {
    lanzada.current = null
    setEstado('inactiva')
    setVuelta((anterior) => anterior + 1)
  }, [])

  // El error manda sobre el estado optimista: `POST .../analyze` contesta con
  // el analisis, asi que un `null` con error puesto es siempre un fallo.
  const estadoFinal: EstadoDePreparacion =
    estado === 'hecha' && mutacion.error ? 'fallida' : estado

  return { estado: estadoFinal, error: mutacion.error, rehacer }
}

/**
 * Lo que el operador ve mientras la maquina prepara — y despues.
 *
 * LOS CUATRO ESTADOS SE PINTAN, incluido el que no existe todavia. Un paso
 * declarado automatico cuya peticion aun no expone nadie tiene que decirlo:
 * callarselo deja una pantalla identica a la de antes del asistente y al
 * operador creyendo que la maquina ya hizo algo.
 */
export function AvisoDePreparacion({
  paso,
  estado,
  error,
  rehacer,
}: {
  paso: PasoDelAsistente
  estado: EstadoDePreparacion
  error: ErrorDelServicio | null
  rehacer: () => void
}) {
  const preparacion = paso.preparacion
  if (!preparacion || estado === 'inactiva') return null

  if (estado === 'sin_peticion') {
    return (
      <Note tipo="neutral" titulo="Este paso todavia no se prepara solo">
        {preparacion.hueco ??
          `El asistente declara este paso como automatico —deberia ${preparacion.produce.toLowerCase()}— y el servicio todavia no expone la peticion que lo hace. Mientras tanto se decide a mano, aqui abajo, exactamente igual que antes.`}
      </Note>
    )
  }

  if (estado === 'corriendo') {
    return (
      <Note tipo="informativo" titulo="La maquina esta preparando este paso">
        <span className="flex items-center gap-2">
          {/* La etiqueta del spinner es CORTA y no la frase de al lado. Con
              `preparacion.produce` dentro, el HTML generado enseno la misma
              frase de doscientos caracteres dos veces seguidas: una en el
              `sr-only` del spinner y otra visible. Quien usa lector de
              pantalla la oia entera dos veces. */}
          <Spinner tamano="sm" etiqueta="Preparando" />
          {preparacion.produce}
        </span>
      </Note>
    )
  }

  if (estado === 'fallida') {
    return (
      <Note
        tipo="error"
        titulo="No se pudo preparar este paso"
        accion={
          <Button variant="secondary" size="sm" onClick={rehacer}>
            <RefreshCw />
            Reintentar
          </Button>
        }
      >
        <span className="block">
          {error?.causa ??
            'El servicio no contesto a la peticion que prepara este paso, y no dijo por que.'}
        </span>
        <span className="mt-1 block text-ds-gray-1000">
          {error?.accion ??
            'Reintenta. Si vuelve a fallar, el paso se puede resolver a mano aqui abajo: lo automatico prepara la decision, no la sustituye.'}
        </span>
      </Note>
    )
  }

  return (
    <Note
      tipo="neutral"
      titulo="Preparado por la maquina. Falta tu decision."
      accion={
        <Button variant="ghost" size="sm" onClick={rehacer}>
          <RefreshCw />
          Rehacer
        </Button>
      }
    >
      <span className="block">{preparacion.produce}</span>
      <span className="mt-1 block text-ds-gray-1000">{preparacion.porQueNoEscribe}</span>
    </Note>
  )
}
