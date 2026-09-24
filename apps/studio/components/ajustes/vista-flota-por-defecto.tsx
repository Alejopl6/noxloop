'use client'

import { Button } from '@/components/ui/button'
import { Entity, ListaDeEntidades } from '@/components/ui/entidad'
import { Badge } from '@/components/ui/insignia'
import { Note } from '@/components/ui/nota'
import { Encabezado, EsqueletoDeLista, FalloDeLectura } from '@/components/pantalla'
import { PuntoDeProyecto } from '@/components/board/tarjeta'
import type { ErrorDelServicio } from '@/lib/daemon'
import { useLectura } from '@/lib/lectura'
import type { Navegar } from '@/lib/ruta'
import { ETIQUETA_ESTADO_PROYECTO, type Proyecto } from '@/lib/tipos'

/**
 * FLOTA POR DEFECTO: EL HUECO, DECLARADO COMO HUECO (principio X).
 *
 * La spec pide una «flota por defecto» en Settings general, y el servicio de
 * hoy no la tiene: la flota es de cada proyecto (`/v1/projects/:id/agents`) y
 * no existe ninguna ruta de flota del espacio de trabajo. Inventar aqui un
 * formulario que no guarda en ningun sitio seria un control que miente.
 *
 * Lo que SI se puede dar sin inventar es el camino corto: la flota de cada
 * proyecto, con cuantos agentes declara, a un clic. Cuando el servicio
 * publique una flota por defecto, esta pestana es donde va; mientras, dice
 * que no la hay y por que.
 */

export function PanelDeFlotaPorDefecto({
  proyectos,
  cargando,
  error,
  navegar,
}: {
  proyectos: Proyecto[] | null
  cargando: boolean
  error: ErrorDelServicio | null
  navegar: Navegar
}) {
  return (
    <div className="flex flex-col gap-6">
      <Encabezado
        titulo="Flota por defecto"
        descripcion="Quien implementa y quien revisa, con que runtime. La flota se declara por proyecto; desde aqui se llega a la de cada uno."
      />

      <Note tipo="informativo" titulo="Este servicio todavia no tiene una flota del espacio de trabajo">
        Cada proyecto declara su propia flota al establecerse, y es la que usa su board. Una flota
        por defecto —la que heredaria un proyecto nuevo— necesita una ruta en el servicio que hoy
        no existe; hasta entonces, el asistente propone la flota de cada proyecto al crearlo.
      </Note>

      <FalloDeLectura error={error} />
      {cargando ? <EsqueletoDeLista filas={3} /> : null}

      {proyectos && proyectos.length > 0 ? (
        <ListaDeEntidades etiqueta="La flota de cada proyecto">
          {proyectos.map((proyecto) => {
            const agentes = proyecto.contadores?.agentes
            return (
              <Entity
                key={proyecto.id}
                contenedor="li"
                miniatura={<PuntoDeProyecto proyecto={proyecto} />}
                titulo={proyecto.nombre}
                identificador={proyecto.id}
                metadatos={
                  <>
                    <Badge tono={proyecto.estado === 'ACTIVE' ? 'exito' : 'neutral'}>
                      {ETIQUETA_ESTADO_PROYECTO[proyecto.estado]}
                    </Badge>
                    <span className="text-label-12 text-ds-gray-900">
                      {agentes === undefined
                        ? 'agentes: sin dato en la lista'
                        : `${agentes} ${agentes === 1 ? 'agente' : 'agentes'}`}
                    </span>
                  </>
                }
                acciones={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navegar({ seccion: 'flota', id: proyecto.id })}
                  >
                    Abrir su flota
                  </Button>
                }
              />
            )
          })}
        </ListaDeEntidades>
      ) : null}

      {proyectos && proyectos.length === 0 ? (
        <p className="text-copy-14 text-ds-gray-900">
          Todavia no hay proyectos, asi que no hay ninguna flota declarada.
        </p>
      ) : null}
    </div>
  )
}

const EVENTOS = ['proyecto.estado', 'sincronizar_completo'] as const

export function VistaDeFlotaPorDefecto({ navegar }: { navegar: Navegar }) {
  const lectura = useLectura<Proyecto[]>('/v1/projects', { relerEn: EVENTOS })
  return (
    <PanelDeFlotaPorDefecto
      proyectos={lectura.datos}
      cargando={lectura.datos === null && lectura.error === null}
      error={lectura.error}
      navegar={navegar}
    />
  )
}
