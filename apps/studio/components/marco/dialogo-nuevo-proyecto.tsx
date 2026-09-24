'use client'

import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { Dialogo } from '@/components/ui/dialogo'
import { ExploradorDeCarpetas } from '@/components/ui/explorador-de-carpetas'
import { ErrorText } from '@/components/ui/fieldset'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { useServicio } from '@/components/proveedor-servicio'
import { elegirCarpeta, superficieDeSeleccion, type SuperficieDeSeleccion } from '@/lib/carpeta'
import { comoErrorDelServicio, ErrorDelServicio } from '@/lib/daemon'
import type { Navegar } from '@/lib/ruta'

/**
 * EL «+» DE PROYECTOS: nombre y carpeta, y al board (spec 003, US8, FR-033).
 *
 * POR QUE DOS CAMPOS Y NO EL ASISTENTE. El operador tenia tres proyectos en
 * `CREATED` que el board ignoraba: dar de alta llevaba a siete pantallas, y
 * a la tercera se dejaba para luego. El referente (Nodal) pide nombre y repo,
 * y el operador lo dijo asi: «el concepto debe ser simple». La accion
 * principal hace eso: crea el proyecto Y lo activa por el modo rapido, que
 * recorre las cinco guardas de verdad sin escribir en el repositorio.
 *
 * LA CONFIGURACION COMPLETA SIGUE A UN CLIC, como accion secundaria: quien
 * quiere revisar la constitution o aplicar el bootstrap antes de empezar abre
 * el asistente, que es el mismo de siempre.
 *
 * SOLO CARPETA LOCAL. Un repositorio remoto necesita cuenta conectada y un
 * destino del clon —dos decisiones mas—, y eso es la configuracion completa.
 */
export function DialogoNuevoProyecto({
  abierto,
  alCerrar,
  navegar,
}: {
  abierto: boolean
  alCerrar: () => void
  navegar: Navegar
}) {
  const { cliente } = useServicio()
  const [nombre, setNombre] = useState('')
  const [nombreAMano, setNombreAMano] = useState(false)
  const [ruta, setRuta] = useState('')
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState<ErrorDelServicio | null>(null)
  const [superficie, setSuperficie] = useState<SuperficieDeSeleccion>('desconocida')

  // `isTauri()` lee `window`: solo dentro de un efecto (ver `lib/daemon.ts`).
  useEffect(() => {
    let vigente = true
    superficieDeSeleccion().then((cual) => {
      if (vigente) setSuperficie(cual)
    })
    return () => {
      vigente = false
    }
  }, [])

  /** Elegir carpeta propone el nombre, si el operador no escribio uno. */
  const elegirRuta = (elegida: string) => {
    setRuta(elegida)
    if (!nombreAMano) {
      const ultima = elegida.replace(/\/+$/, '').split('/').pop() ?? ''
      setNombre(ultima)
    }
  }

  const abrirSelector = async () => {
    setError(null)
    try {
      const elegida = await elegirCarpeta({ desde: ruta || undefined })
      if (elegida) elegirRuta(elegida)
    } catch (fallo: unknown) {
      setError(comoErrorDelServicio(fallo, 'selector de carpetas'))
    }
  }

  const cerrar = () => {
    if (trabajando) return
    setError(null)
    alCerrar()
  }

  const incompleto = nombre.trim().length === 0 || ruta.trim().length === 0

  const crearYAbrir = async () => {
    if (incompleto || trabajando) return
    if (!cliente) {
      setError(comoErrorDelServicio(new Error('esta interfaz no tiene conexion con el servicio de control'), 'crear el proyecto'))
      return
    }
    setTrabajando(true)
    setError(null)
    try {
      // Nada se escribe aqui: se le pide al servicio (principio VIII), que da
      // de alta y activa por las guardas en la misma peticion.
      const r = await cliente.crearProyectoRapido({ origen: 'local', nombre: nombre.trim(), ruta_local: ruta.trim() })
      setNombre('')
      setNombreAMano(false)
      setRuta('')
      alCerrar()
      navegar({ seccion: 'board', id: r.proyecto.id })
    } catch (fallo: unknown) {
      setError(comoErrorDelServicio(fallo, 'POST /v1/projects'))
    } finally {
      setTrabajando(false)
    }
  }

  // Si el modo rapido paro en una etapa, el proyecto YA existe (el 409 trae su
  // id): la salida es terminarlo en el asistente, que retoma donde quedo.
  const proyectoAMedias = error?.codigo === 'modo_rapido_detenido' && error.objeto?.id ? error.objeto.id : null

  return (
    <Dialogo abierto={abierto} alCerrar={cerrar} etiqueta="Nuevo proyecto" ancho="lg" cerrarAlPulsarFuera={!trabajando}>
      <form
        className="flex flex-col"
        onSubmit={(evento) => {
          evento.preventDefault()
          void crearYAbrir()
        }}
      >
        <div className="flex flex-col gap-1 border-b border-ds-gray-400 px-5 py-4">
          <h2 className="text-heading-20 text-ds-gray-1000">Nuevo proyecto</h2>
          <p className="text-copy-14 text-ds-gray-900">
            Un nombre y la carpeta del repositorio. noxloop lo lee, lo deja listo y abre su board, sin escribir nada
            en tu repositorio.
          </p>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          <Campo
            etiqueta="Nombre"
            valor={nombre}
            alCambiar={(valor) => {
              setNombre(valor)
              setNombreAMano(valor.trim().length > 0)
            }}
            requerido
            marcador="payments"
            deshabilitado={trabajando}
          />

          <ExploradorDeCarpetas ruta={ruta} alElegir={elegirRuta} />

          <Campo
            etiqueta="Carpeta del repositorio"
            valor={ruta}
            alCambiar={setRuta}
            requerido
            operativo
            marcador="/ruta/absoluta/al/repositorio"
            deshabilitado={trabajando}
            ayuda="Tiene que ser un repositorio git. Elige arriba o escribe la ruta."
            accion={
              superficie === 'escritorio' ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => void abrirSelector()}>
                  <FolderOpen />
                  Dialogo del sistema
                </Button>
              ) : null
            }
          />

          {error ? (
            <div className="flex flex-col gap-2">
              <ErrorText causa={error.causa} accion={error.accion} />
              {proyectoAMedias ? (
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setError(null)
                      alCerrar()
                      navegar({ seccion: 'asistente', id: proyectoAMedias })
                    }}
                  >
                    Terminarlo en la configuracion completa
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ds-gray-400 bg-ds-background-200 px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            disabled={trabajando}
            onClick={() => {
              setError(null)
              alCerrar()
              navegar({ seccion: 'asistente', id: null })
            }}
          >
            Configuracion completa
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" disabled={trabajando} onClick={cerrar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={incompleto || trabajando}>
              {trabajando ? <Spinner tamano="sm" etiqueta="Leyendo el repositorio y activando" /> : null}
              {trabajando ? 'Leyendo el repositorio…' : 'Crear y abrir board'}
            </Button>
          </div>
        </div>
      </form>
    </Dialogo>
  )
}
