'use client'

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { CicloDeVida, LoQueFalta } from '@/components/ui/ciclo-de-vida'
import { Description, ListaDeDescripciones } from '@/components/ui/descripcion'
import { Note } from '@/components/ui/nota'
import { Segmentado } from '@/components/ui/segmentado'
import { Encabezado, EsqueletoDeLista, FalloDeLectura } from '@/components/pantalla'
import type { ErrorDelServicio } from '@/lib/daemon'
import { useLectura } from '@/lib/lectura'
import { useMutacion } from '@/lib/mutacion'
import { useOpciones } from '@/lib/opciones'
import type { Navegar } from '@/lib/ruta'
import { GRUPO, type ArtefactosDeProyecto, type GrupoDeOpciones, type Proyecto } from '@/lib/tipos'

/**
 * LA PESTANA «GENERAL» DE SETTINGS DEL PROYECTO: que es, en que etapa esta y
 * cuanta autonomia tiene.
 *
 * LA AUTONOMIA ES LO UNICO QUE SE EDITA AQUI, y es lo que decide que hace el
 * boton Run del board (FR-015): en L2 el motor planifica y ejecuta; en L0 y L1
 * planifica y PARA, y la tarjeta muestra «Plan listo» hasta que el operador
 * lo aprueba. Hasta la 003 este valor solo se podia elegir al crear el
 * proyecto, y un ajuste que no se puede cambiar despues no es un ajuste.
 *
 * Va por `PATCH /v1/projects/:id` con `autonomia` y nada mas. El servicio
 * valida el valor contra su enum y rechaza cualquier cambio de `estado` por
 * esta via: la maquina de estados solo avanza por sus transiciones.
 */

interface DetalleDeProyecto {
  proyecto: Proyecto
  artefactos?: ArtefactosDeProyecto
}

const EVENTOS = ['proyecto.estado', 'sincronizar_completo'] as const

/** Lo que significa cada nivel EN EL BOARD, que es donde se nota. */
const EN_EL_BOARD: Record<string, string> = {
  L0: 'Run planifica y para. Cada paso posterior espera tu aprobacion.',
  L1: 'Run planifica y para en «Plan listo». Aprobado el plan, el ciclo corre solo y se detiene en lo que el proyecto declaro peligroso.',
  L2: 'Run planifica y ejecuta sin mas confirmacion, hasta el pull request. El merge sigue siendo tuyo.',
}

export function PanelDeAjustesDeProyecto({
  proyectoId,
  detalle,
  cargando,
  error,
  grupoDeAutonomia,
  errorDeGuardado,
  guardando,
  alGuardarAutonomia,
  navegar,
}: {
  proyectoId: string
  detalle: DetalleDeProyecto | null
  cargando: boolean
  error: ErrorDelServicio | null
  grupoDeAutonomia: GrupoDeOpciones
  errorDeGuardado: ErrorDelServicio | null
  guardando: boolean
  alGuardarAutonomia: (autonomia: string) => void
  navegar: Navegar
}) {
  const proyecto = detalle?.proyecto ?? null
  const actual = proyecto?.autonomia ?? null
  const [elegida, setElegida] = useState<string | null>(actual)

  // Cuando llega (o cambia por debajo) la autonomia del servicio, se adopta
  // mientras el operador no haya elegido otra cosa sin guardar.
  useEffect(() => {
    setElegida(actual)
  }, [actual])

  const opciones = grupoDeAutonomia.opciones
  const cambiada = elegida !== null && elegida !== actual

  return (
    <div className="flex flex-col gap-8">
      <Encabezado
        titulo="General"
        descripcion="Que es este proyecto, en que etapa esta y cuanta autonomia tiene el motor cuando pulsas Run en una de sus tarjetas."
      />

      <FalloDeLectura error={error} />
      {cargando ? <EsqueletoDeLista filas={2} /> : null}

      {proyecto ? (
        <>
          <section className="flex flex-col gap-4">
            <h3 className="text-heading-16 text-ds-gray-1000">Etapa</h3>
            <CicloDeVida proyecto={proyecto} artefactos={detalle?.artefactos} />
            <div className="text-copy-14 text-ds-gray-900">
              <LoQueFalta proyecto={proyecto} artefactos={detalle?.artefactos} />
            </div>
            {proyecto.estado !== 'ACTIVE' ? (
              <div>
                <Button size="sm" onClick={() => navegar({ seccion: 'asistente', id: proyectoId })}>
                  Continuar en el asistente
                </Button>
              </div>
            ) : null}
          </section>

          <section className="flex flex-col gap-4">
            <h3 className="text-heading-16 text-ds-gray-1000">Autonomia</h3>
            {opciones.length > 0 ? (
              <Segmentado
                etiqueta="Nivel de autonomia"
                opciones={opciones.map((opcion) => ({
                  valor: opcion.valor,
                  etiqueta: opcion.etiqueta,
                  descripcion: (
                    <span className="flex flex-col gap-1">
                      {opcion.descripcion ? <span>{opcion.descripcion}</span> : null}
                      {EN_EL_BOARD[opcion.valor] ? (
                        <span className="text-ds-gray-1000">En el board: {EN_EL_BOARD[opcion.valor]}</span>
                      ) : null}
                    </span>
                  ),
                }))}
                valor={elegida ?? ''}
                alCambiar={setElegida}
              />
            ) : (
              // El hueco declarado del catalogo de opciones, con su porque.
              <Note tipo="advertencia" titulo="No se pueden ofrecer los niveles de autonomia">
                <p>{grupoDeAutonomia.porque}</p>
                {grupoDeAutonomia.como_conseguirlo ? <p>{grupoDeAutonomia.como_conseguirlo}</p> : null}
              </Note>
            )}
            {actual === null ? (
              <p className="text-label-12 text-ds-gray-700">
                El servicio no dijo el nivel actual de este proyecto: elegir uno y guardarlo lo fija.
              </p>
            ) : null}
            {errorDeGuardado ? <FalloDeLectura error={errorDeGuardado} /> : null}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={!cambiada || guardando}
                onClick={() => elegida && alGuardarAutonomia(elegida)}
              >
                {guardando ? 'Guardando…' : 'Guardar autonomia'}
              </Button>
              {cambiada ? (
                <Button variant="ghost" size="sm" onClick={() => setElegida(actual)}>
                  Descartar
                </Button>
              ) : null}
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <h3 className="text-heading-16 text-ds-gray-1000">Donde vive</h3>
            <ListaDeDescripciones columnas={2}>
              <Description titulo="Nombre" contenido={proyecto.nombre} />
              <Description titulo="Identificador" contenido={proyecto.id} operativo />
              <Description titulo="Carpeta local" contenido={proyecto.ruta_local ?? undefined} operativo />
              <Description titulo="Repositorio remoto" contenido={proyecto.remoto ?? undefined} operativo />
            </ListaDeDescripciones>
          </section>
        </>
      ) : null}
    </div>
  )
}

export function VistaDeAjustesDeProyecto({
  proyectoId,
  navegar,
}: {
  proyectoId: string
  navegar: Navegar
}) {
  const lectura = useLectura<DetalleDeProyecto>(`/v1/projects/${encodeURIComponent(proyectoId)}`, {
    relerEn: EVENTOS,
  })
  const { grupoDe } = useOpciones(proyectoId)
  const mutacion = useMutacion()

  const guardar = async (autonomia: string) => {
    const hecho = await mutacion.enviar('PATCH', `/v1/projects/${encodeURIComponent(proyectoId)}`, {
      autonomia,
    })
    if (hecho !== null) lectura.releer()
  }

  return (
    <PanelDeAjustesDeProyecto
      proyectoId={proyectoId}
      detalle={lectura.datos}
      cargando={lectura.datos === null && lectura.error === null}
      error={lectura.error}
      grupoDeAutonomia={grupoDe(GRUPO.autonomia)}
      errorDeGuardado={mutacion.error}
      guardando={mutacion.trabajando}
      alGuardarAutonomia={(autonomia) => void guardar(autonomia)}
      navegar={navegar}
    />
  )
}
