'use client'

import { FolderGit2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Entity, ListaDeEntidades } from '@/components/ui/entidad'
import { CicloDeVida, LoQueFalta } from '@/components/ui/ciclo-de-vida'
import { EsqueletoDeLista, FalloDeLectura } from '@/components/pantalla'
import { VistaDeAltaDeProyecto } from '@/components/vista-alta-de-proyecto'
import { VerDetalle } from '@/components/asistente/ver-detalle'
import { useLectura } from '@/lib/lectura'
import type { Navegar } from '@/lib/ruta'
import type { Proyecto } from '@/lib/tipos'

/**
 * El primer paso: de que proyecto hablamos.
 *
 * POR QUE NO ES SOLO EL FORMULARIO DE ALTA. El asistente se alcanza desde la
 * navegacion sin proyecto abierto, y quien llega ahi no siempre quiere crear
 * uno: la mitad de las veces quiere seguir el que dejo a medias ayer. Si este
 * paso fuera solo el formulario, esa persona tendria que salir al inventario,
 * buscar su proyecto y volver a entrar — tres pantallas para retomar, que es
 * exactamente lo que este recorrido existe para quitar.
 *
 * EL ORDEN: PRIMERO RETOMAR, DESPUES CREAR. Con proyectos a medias, seguir uno
 * es el camino corto y es el que mas veces se recorre; el alta se usa una vez
 * por proyecto. Sin proyectos a medias, el bloque de retomar no aparece y la
 * pantalla queda siendo el formulario y nada mas, que es lo correcto en una
 * instalacion nueva.
 *
 * LOS `ACTIVE` NO SALEN. Un proyecto activo no tiene recorrido pendiente: ya
 * puede recibir ciclos. Ofrecerlo aqui seria ofrecer un asistente que no tiene
 * nada que asistir; a ese proyecto se llega por el inventario o por ⌘K.
 */
export function PasoDeAlta({ navegar }: { navegar: Navegar }) {
  const lectura = useLectura<Proyecto[]>('/v1/projects', {
    relerEn: ['proyecto.estado', 'sincronizar_completo'],
  })

  const proyectos = lectura.datos ?? []
  const aMedias = proyectos.filter((proyecto) => proyecto.estado !== 'ACTIVE')
  const cargando = lectura.datos === null && lectura.error === null

  return (
    <div className="flex flex-col gap-10">
      {cargando ? <EsqueletoDeLista filas={2} /> : null}

      <FalloDeLectura error={lectura.error} />

      {aMedias.length > 0 ? (
        <section aria-labelledby="titulo-retomar" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="titulo-retomar" className="text-heading-20 text-ds-gray-1000">
              Seguir un proyecto que dejaste a medias
            </h2>
            <p className="text-copy-14 text-ds-gray-900">
              El asistente sabe en que etapa esta cada uno y entra por ahi. No vuelve a
              empezar.
            </p>
          </div>

          <ListaDeEntidades etiqueta="Proyectos con el recorrido a medias">
            {aMedias.map((proyecto) => (
              <Entity
                key={proyecto.id}
                contenedor="li"
                miniatura={<FolderGit2 />}
                titulo={proyecto.nombre}
                identificador={proyecto.ruta_local ?? proyecto.remoto ?? undefined}
                descripcion={<LoQueFalta proyecto={proyecto} />}
                metadatos={<CicloDeVida proyecto={proyecto} />}
                acciones={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navegar({ seccion: 'asistente', id: proyecto.id })}
                  >
                    Seguir aqui
                  </Button>
                }
                // Sin `paso`: el asistente deduce la etapa del estado del
                // proyecto. Fijarlo desde esta fila seria decidir por el
                // servicio con datos de la lista, que no trae los veredictos.
                alPulsar={() => navegar({ seccion: 'asistente', id: proyecto.id })}
              />
            ))}
          </ListaDeEntidades>
        </section>
      ) : null}

      {/* SIN ENCABEZADO PROPIO. El primer intento ponia un "O empezar uno
          nuevo" encima, y el HTML generado enseno el resultado: dos
          encabezados del mismo nivel seguidos —ese y el "Anadir proyecto" que
          la vista reutilizada ya pinta— diciendo lo mismo con otras palabras.
          El titulo de la vista es el que se queda, porque es el que nombra lo
          que hay debajo. Lo que si hace falta es la separacion visual con el
          bloque de arriba, y eso es una linea, no un titulo. */}
      <div className={aMedias.length > 0 ? 'border-t border-ds-gray-400 pt-8' : undefined}>
        <VistaDeAltaDeProyecto navegar={navegar} />
      </div>

      <VerDetalle etiqueta="Que pasa despues de crearlo">
        <div className="flex flex-col gap-2 text-copy-14 text-ds-gray-900">
          <p>
            El asistente sigue por el analisis del codigo, la constitution, las
            guidelines, el diseno —que es omitible—, el bootstrap, las conexiones y la
            flota de agentes. Al final el proyecto queda activo y puede recibir ciclos.
          </p>
          <p>
            Lo que la maquina puede preparar sola lo prepara y te lo ensena para que lo
            apruebes. Nada se escribe en tu repositorio sin que lo decidas tu, y el
            bootstrap ensena el diff exacto antes de tocar un archivo.
          </p>
          <p>
            Un proyecto nuevo se salta el analisis: no hay codigo que escanear, asi que la
            maquina de estados declara el atajo directo a la constitution.
          </p>
        </div>
      </VerDetalle>
    </div>
  )
}
