'use client'

import { Button } from '@/components/ui/button'
import { Note } from '@/components/ui/nota'
import { VerDetalle } from '@/components/asistente/ver-detalle'
import type { Navegar } from '@/lib/ruta'
import { etapaQueFalta, type ArtefactosDeProyecto, type Proyecto } from '@/lib/tipos'

/**
 * El final del recorrido.
 *
 * QUE HACE FALTA QUE DIGA, y no es "enhorabuena". Un asistente que termina sin
 * decir que cambio deja al operador con la misma pregunta con la que entro:
 * ¿y ahora que? Asi que dice las tres cosas: en que estado quedo el proyecto,
 * que puede hacer ahora que antes no podia, y por donde se sigue.
 *
 * NO FINGE EL FINAL. Si el proyecto tiene las cinco guardas cerradas pero
 * sigue en `CONNECTED`, es que nadie pidio la transicion a `ACTIVE` — el
 * estado solo cambia cuando alguien lo pide, no cuando el ultimo artefacto
 * aparece. En ese caso este paso no dice "listo": dice que falta activar y
 * manda al sitio donde se activa.
 */
export function PasoFinal({
  proyecto,
  artefactos,
  navegar,
}: {
  proyecto: Proyecto | null
  artefactos: ArtefactosDeProyecto | null
  navegar: Navegar
}) {
  if (!proyecto) {
    return (
      <p className="text-copy-14 text-ds-gray-900">
        Todavia no ha llegado el proyecto del servicio, asi que no se puede decir en que
        estado quedo. Nada de lo que hiciste se pierde por esto: el estado lo guarda el
        servicio.
      </p>
    )
  }

  const falta = etapaQueFalta(proyecto, artefactos)
  const activo = proyecto.estado === 'ACTIVE'

  return (
    // SIN `CicloDeVida` AQUI, y estuvo puesto. El HTML generado lo enseno
    // duplicado: el marco del asistente ya lo pinta en su cabecera, asi que la
    // regleta, el badge "Activo" y el "Etapa 6 de 6" salian dos veces seguidos
    // con dos pixeles de separacion. Se ve como un fallo de pintado, que es
    // peor que la informacion que anadia — ninguna, porque era la misma.
    <div className="flex flex-col gap-6">
      {activo ? (
        <Note tipo="exito" titulo="El proyecto esta establecido">
          Tiene snapshot, constitution, setup resuelto, al menos una conexion viva y flota
          declarada. A partir de ahora puede recibir ciclos del motor: un ticket entra, un
          pull request sale.
        </Note>
      ) : (
        <Note tipo="advertencia" titulo="Falta un paso para terminar">
          <span className="block">{falta?.causa}</span>
          <span className="mt-1 block">{falta?.accion}</span>
        </Note>
      )}

      {/* LOS CICLOS SOLO SE OFRECEN SI EL PROYECTO PUEDE RECIBIRLOS. El HTML
          generado enseno "Ir a los ciclos" como boton principal de un proyecto
          en `CONNECTED`: el destino existe, pero ese proyecto no puede lanzar
          nada y el rechazo llega despues de pulsar. Cuando falta la
          transicion, el principal es lo que la completa. */}
      <div className="flex flex-wrap items-center gap-2">
        {activo ? (
          <Button onClick={() => navegar({ seccion: 'runs', id: proyecto.id })}>
            Ir a los ciclos
          </Button>
        ) : (
          <Button onClick={() => navegar({ seccion: 'flota', id: proyecto.id })}>
            Volver a la flota
          </Button>
        )}
        <Button variant="secondary" onClick={() => navegar({ seccion: 'inicio', id: null })}>
          Volver al inicio
        </Button>
      </div>

      <VerDetalle etiqueta="Que puede hacer este proyecto ahora">
        <ul className="flex list-disc flex-col gap-2 pl-5 text-copy-14 text-ds-gray-900">
          <li>
            Recibir un ticket del gestor conectado y abrir un pull request con el trabajo
            hecho, sin que nadie copie nada a mano.
          </li>
          <li>
            Resolver lo ambiguo consultando su constitution en vez de heredar las
            suposiciones del modelo.
          </li>
          <li>
            Parar y preguntar en la bandeja cuando una decision te corresponde a ti. Todo
            lo que se escriba en tu repositorio sigue pasando por ahi.
          </li>
        </ul>
      </VerDetalle>
    </div>
  )
}
