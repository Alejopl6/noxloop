'use client'

import { useCallback, useMemo } from 'react'

import { EsqueletoDeLista, FalloDeLectura } from '@/components/pantalla'
import { MarcoDelAsistente } from '@/components/asistente/marco-del-asistente'
import { AvisoDePreparacion, usePreparacionAutomatica } from '@/components/asistente/preparacion'
import {
  veredictoDelPaso,
  type IdDePaso,
  type PasoDelAsistente,
} from '@/components/asistente/paso'
import {
  destinoDentroDelAsistente,
  esIdDePaso,
  pasoAnterior,
  pasoEnQueSeRetoma,
  pasosAplicables,
  siguientePaso,
} from '@/components/asistente/recorrido'
import { useLectura } from '@/lib/lectura'
import type { Navegar, Ruta } from '@/lib/ruta'
import type { ArtefactosDeProyecto, Proyecto } from '@/lib/tipos'

/**
 * EL RECORRIDO GUIADO, con los datos puestos.
 *
 * COMO SE RETOMA, que es la pregunta que el operador hizo con otras palabras
 * ("cierro y vuelvo"). Dos fuentes, en este orden:
 *
 *   1. LA DIRECCION. `?paso=` dice en cual estaba. Sobrevive a recargar, a
 *      cerrar la ventana con la pestana abierta, y al boton de atras del
 *      navegador. Es la unica forma de volver a guidelines o a diseno, que son
 *      los dos pasos que el servicio no sabe distinguir (ver `recorrido.ts`).
 *   2. EL ESTADO DEL PROYECTO. Sin `?paso=`, se deduce de lo que el servicio
 *      dice: `etapaQueFalta()` con los veredictos de las guardas delante. Esta
 *      pantalla NO guarda nada —ni en memoria entre sesiones, ni en el
 *      navegador— porque el estado lo tiene el servicio y una segunda copia
 *      aqui seria una copia que se queda vieja.
 *
 * Y UNA CORRECCION QUE NO SE VE HASTA QUE PASA: un `?paso=` que no aplica a
 * este proyecto —`discovery` en un proyecto nuevo, porque alguien pego la
 * direccion de otro— no se obedece. Se deduce. Obedecerlo dejaria al operador
 * mirando un escaneo de una carpeta que nadie va a escanear.
 *
 * LA LECTURA ES UNA SOLA. `GET /v1/projects/:id` trae el proyecto Y los cinco
 * veredictos en una respuesta, que es justo lo que hace falta aqui: sin los
 * veredictos, la guarda de cada paso seria una suposicion de esta pantalla.
 */

/** La forma de `GET /v1/projects/:id`. Solo lo que este recorrido usa. */
interface DetalleDeProyecto {
  proyecto: Proyecto
  artefactos?: ArtefactosDeProyecto
}

/**
 * Los eventos que mueven este recorrido. `proyecto.estado` es el que importa:
 * cuando una etapa se cierra, el paso siguiente deja de estar bloqueado y el
 * boton de avanzar tiene que encenderse solo.
 */
const EVENTOS_DEL_RECORRIDO = [
  'proyecto.estado',
  'recomendacion.aplicada',
  'conexion.estado',
  'sincronizar_completo',
] as const

export function Asistente({ ruta, navegar }: { ruta: Ruta; navegar: Navegar }) {
  const proyectoId = ruta.id

  const lectura = useLectura<DetalleDeProyecto>(
    proyectoId ? `/v1/projects/${proyectoId}` : null,
    { relerEn: EVENTOS_DEL_RECORRIDO },
  )

  const proyecto = lectura.datos?.proyecto ?? null
  const artefactos = lectura.datos?.artefactos ?? null
  const aplicables = useMemo(() => pasosAplicables(proyecto), [proyecto])

  // Que paso toca. Ver la cabecera: primero la direccion, despues el estado.
  const pedido = esIdDePaso(ruta.paso) ? ruta.paso : null
  const deducido: IdDePaso = proyectoId ? pasoEnQueSeRetoma(proyecto, artefactos) : 'alta'
  const pasoId: IdDePaso =
    pedido && aplicables.some((paso) => paso.id === pedido) ? pedido : deducido

  // `aplicables` nunca esta vacio —`alta` y `listo` aplican siempre— asi que
  // el `??` es para el compilador, no para un caso real. Se deja resuelto en
  // vez de con `!` para que un cambio futuro en `aplicaA` no reviente aqui.
  const paso: PasoDelAsistente =
    aplicables.find((candidato) => candidato.id === pasoId) ?? aplicables[0]

  const irAlPaso = useCallback(
    (destino: IdDePaso) => navegar({ seccion: 'asistente', id: proyectoId, paso: destino }),
    [navegar, proyectoId],
  )

  /**
   * El `navegar` que reciben las vistas reutilizadas.
   *
   * Es lo que hace que ninguna de las seis haya tenido que cambiar: siguen
   * llamando a `navegar({ seccion: 'bootstrap', ... })` cuando su etapa queda
   * cerrada, y quien contesta ahora es el recorrido. Las reglas —y por que la
   * de "avanzar uno" existe— estan en `destinoDentroDelAsistente`.
   */
  const navegarDentro = useCallback<Navegar>(
    (destino) => {
      if (destino.seccion === 'asistente') {
        navegar(destino)
        return
      }

      const resultado = destinoDentroDelAsistente(destino.seccion, pasoId, aplicables)
      if (!resultado.dentro) {
        navegar(destino)
        return
      }

      navegar({
        seccion: 'asistente',
        // `destino.id` manda sobre el de la ruta: al crear un proyecto, el que
        // llega es el nuevo y el de la ruta todavia es `null`.
        id: destino.id ?? proyectoId,
        paso: resultado.paso,
      })
    },
    [navegar, pasoId, aplicables, proyectoId],
  )

  const releerProyecto = useCallback(() => lectura.releer(), [lectura])

  const preparacion = usePreparacionAutomatica(paso, proyectoId, releerProyecto)

  const veredicto = veredictoDelPaso(paso, artefactos)
  const anterior = pasoAnterior(pasoId, aplicables)
  const siguiente = siguientePaso(pasoId, aplicables)
  const irAlSiguientePaso = useCallback(
    () => irAlPaso(siguiente),
    [irAlPaso, siguiente],
  )

  return (
    <MarcoDelAsistente
      paso={paso}
      pasos={aplicables}
      proyecto={proyecto}
      artefactos={artefactos}
      veredicto={veredicto}
      avisoDePreparacion={
        <AvisoDePreparacion
          paso={paso}
          estado={preparacion.estado}
          error={preparacion.error}
          rehacer={preparacion.rehacer}
        />
      }
      alIrAlPaso={(destino) => irAlPaso(destino.id)}
      alSiguiente={siguiente === pasoId ? null : irAlSiguientePaso}
      alAtras={anterior ? () => irAlPaso(anterior) : null}
      alSalirAConsola={
        paso.seccion ? () => navegar({ seccion: paso.seccion!, id: proyectoId }) : null
      }
    >
      {/* Un fallo al leer el proyecto NO borra el paso: el cuerpo es la vista
          de siempre y sabe leer lo suyo por su cuenta. Lo que se pierde sin
          esta lectura son los veredictos, y eso ya lo dice el boton de
          avanzar. */}
      <FalloDeLectura error={lectura.error} />

      {/* MIENTRAS LA MAQUINA PREPARA, EL CUERPO NO SE MONTA. No es estetica:
          `VistaDeBootstrap` lee las recomendaciones al montarse, y montarla
          antes de que `analyze` conteste la deja con la lista vacia y sin
          motivo para releerla. Montarla despues es lo que hace que el paso
          entre ya preparado, que es lo que el operador pidio. */}
      {preparacion.estado === 'corriendo' ? (
        <EsqueletoDeLista filas={3} />
      ) : (
        paso.cuerpo({
          proyectoId,
          proyecto,
          artefactos,
          navegar: navegarDentro,
          releerProyecto,
          irAlPaso,
          irAlSiguientePaso,
        })
      )}
    </MarcoDelAsistente>
  )
}
