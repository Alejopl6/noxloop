'use client'

import { useMemo, useState } from 'react'
import { ChevronsUpDown } from 'lucide-react'

import { MenuDeComandos, type Comando } from '@/components/ui/menu-de-comandos'
import { ETAPA_PENDIENTE, ETIQUETA_ESTADO_PROYECTO, type Proyecto } from '@/lib/tipos'
import type { Navegar, Seccion } from '@/lib/ruta'

/**
 * El contexto de proyecto, persistente y conmutable.
 *
 * ES EL AGUJERO QUE MOTIVA ESTA FEATURE. Antes se llegaba a las etapas desde
 * la fila del proyecto y, una vez dentro, el marco dejaba de hablar del
 * proyecto: para pasar del snapshot de A al snapshot de B habia que volver a
 * la lista, buscar B y entrar otra vez — tres pantallas para cambiar una
 * variable. Y mientras tanto, nada en la pantalla decia que se estaba mirando
 * A y no B.
 *
 * POR QUE EL MENU DE COMANDOS Y NO UN DESPLEGABLE. Sin `@radix-ui/*`, un
 * desplegable propio es la pieza donde mas cosas se olvidan (trampa de foco,
 * Escape, cierre al pulsar fuera, `aria-activedescendant`). `MenuDeComandos`
 * ya resuelve las cuatro sobre `<dialog>` nativo, ya busca sin acentos y ya se
 * filtra escribiendo, que es exactamente lo que hace falta cuando hay veinte
 * proyectos. Reutilizarlo no ahorra codigo: ahorra los errores de teclado que
 * NFR-005 mide.
 *
 * CONMUTAR MANTIENE LA ETAPA. Cambiar de proyecto estando en "Conexiones"
 * lleva a las conexiones del otro proyecto, no a la etapa que a ese otro le
 * falta. Llevar a la etapa pendiente parece mas util y mueve DOS cosas con una
 * sola pulsacion: despues, el operador no sabe si lo que ve cambio porque
 * cambio de proyecto o porque cambio de etapa. Cada fila del menu dice en que
 * estado esta su proyecto, asi que la sorpresa se ve antes de pulsar.
 */

/** Que se sabe del proyecto abierto, dicho sin inventar nada. */
function nombreDelProyecto(
  proyectoId: string,
  proyectos: Proyecto[],
  cargando: boolean,
): { etiqueta: string; operativo: boolean; detalle: string } {
  const abierto = proyectos.find((proyecto) => proyecto.id === proyectoId)
  if (abierto) {
    return {
      etiqueta: abierto.nombre,
      operativo: false,
      detalle: `Proyecto abierto: ${abierto.nombre}. Cambiar de proyecto.`,
    }
  }

  // Sin la lista todavia, lo unico verificado es el identificador de la
  // direccion. Se pinta ESE, en Mono, y no un hueco gris: un marco que no dice
  // nada mientras carga es indistinguible de un marco que perdio el contexto.
  if (cargando) {
    return {
      etiqueta: proyectoId,
      operativo: true,
      detalle: `Proyecto ${proyectoId}, todavia sin nombre: la lista de proyectos no ha llegado. Cambiar de proyecto.`,
    }
  }

  // La lista llego y este identificador no esta en ella: el proyecto se borro,
  // o la direccion se pego mal. No se corrige en silencio.
  return {
    etiqueta: proyectoId,
    operativo: true,
    detalle: `El proyecto ${proyectoId} no esta en la lista del servicio. Elegir otro proyecto.`,
  }
}

export function ConmutadorDeProyecto({
  proyectoId,
  seccion,
  proyectos,
  cargando,
  navegar,
}: {
  proyectoId: string
  /** La etapa en la que se esta. Se conserva al conmutar. Ver la cabecera. */
  seccion: Seccion
  proyectos: Proyecto[]
  cargando: boolean
  navegar: Navegar
}) {
  const [abierto, setAbierto] = useState(false)
  const { etiqueta, operativo, detalle } = nombreDelProyecto(proyectoId, proyectos, cargando)

  const comandos = useMemo<Comando[]>(() => {
    const deProyectos: Comando[] = proyectos.map((proyecto) => {
      const pendiente = ETAPA_PENDIENTE[proyecto.estado]
      return {
        id: `conmutar-${proyecto.id}`,
        etiqueta: proyecto.nombre,
        // El estado va escrito y no en color: este menu no pinta badges, y un
        // proyecto que aun no llego a esta etapa tiene que poder verse ANTES
        // de conmutar, no despues de aterrizar en una pantalla vacia.
        descripcion:
          proyecto.id === proyectoId
            ? `${ETIQUETA_ESTADO_PROYECTO[proyecto.estado]} · abierto ahora`
            : pendiente
              ? `${ETIQUETA_ESTADO_PROYECTO[proyecto.estado]} · le falta ${pendiente.etapa}`
              : ETIQUETA_ESTADO_PROYECTO[proyecto.estado],
        grupo: 'Proyectos',
        palabrasClave: [proyecto.ruta_local ?? '', proyecto.remoto ?? '', proyecto.id],
        ejecutar: () => navegar({ seccion, id: proyecto.id }),
      }
    })

    return [
      ...deProyectos,
      {
        id: 'conmutar-ver-lista',
        etiqueta: 'Ver todos los proyectos',
        descripcion:
          proyectos.length === 0
            ? 'La lista de proyectos todavia no ha llegado del servicio'
            : 'La lista completa, con la etapa que le falta a cada uno',
        grupo: 'Ir a',
        ejecutar: () => navegar({ seccion: 'proyectos', id: null }),
      },
    ]
  }, [proyectos, proyectoId, seccion, navegar])

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        // El nombre accesible dice el proyecto Y que el control conmuta. Solo
        // con el nombre, un lector de pantalla anuncia "mi-proyecto, boton" y
        // no hay forma de saber que hace pulsarlo.
        aria-label={detalle}
        title={detalle}
        // Fondo solo al pasar por encima: la superficie se gana cuando
        // comunica interaccion, no por ser un control.
        //
        // Y sin `cn()`, como en `migas.tsx`: la tipografia de Geist y un color
        // `--ds-*` no sobreviven juntos a `twMerge`.
        className="-mx-1.5 flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-ds-gray-1000 transition-colors hover:bg-ds-gray-alpha-100"
      >
        <span
          className={`max-w-[12rem] truncate ${
            operativo ? 'fuente-operativa text-label-13' : 'text-label-14'
          }`}
        >
          {etiqueta}
        </span>
        {/* No es un icono decorativo: es lo unico que distingue este nivel de
            la miga de al lado, que solo navega. */}
        <ChevronsUpDown aria-hidden="true" className="size-3.5 shrink-0 text-ds-gray-700" />
      </button>

      <MenuDeComandos
        comandos={comandos}
        abierto={abierto}
        alCerrar={() => setAbierto(false)}
        marcador="Busca un proyecto por nombre, ruta o remoto"
      />
    </>
  )
}
