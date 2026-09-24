'use client'

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { ChevronsUpDown } from 'lucide-react'

import { Badge } from '@/components/ui/insignia'
import { MenuDeComandos, type Comando } from '@/components/ui/menu-de-comandos'
import { Note } from '@/components/ui/nota'
import { cn } from '@/lib/utils'
import type { GrupoDeOpciones, Opcion } from '@/lib/tipos'

/**
 * `Seleccion` — elegir un valor de un conjunto que el SERVICIO conoce.
 *
 * EL FALLO QUE CIERRA, con nombre. El campo «Runtime» de la pantalla de flota
 * era un `<input>` de texto, y su ayuda decia literalmente: «este servicio
 * declara en /v1/capabilities: claude-agent-sdk, codex». La lista estaba en la
 * misma frase que pedia teclearla. Un `claude-agent` sin el sufijo se guarda
 * sin error y el agente corre —o no corre— con un runtime que ningun adaptador
 * atiende, y eso no se descubre hasta el primer ciclo.
 *
 * POR QUE SOBRE `MenuDeComandos` Y NO UN DESPLEGABLE PROPIO. El mismo motivo
 * que `conmutador-de-proyecto.tsx` escribe en su cabecera: sin `@radix-ui/*`,
 * un desplegable casero es la pieza donde mas cosas se olvidan —trampa de
 * foco, Escape, cierre al pulsar fuera, `aria-activedescendant`— y
 * `MenuDeComandos` ya resuelve las cuatro sobre `<dialog>` nativo, ya busca sin
 * acentos y ya se filtra escribiendo. Reutilizarlo no ahorra codigo: ahorra los
 * errores de teclado que NFR-005 mide.
 *
 * CUANDO ESTO Y CUANDO `Segmentado`: `Segmentado` es para dos o tres opciones
 * que CAMBIAN LA PANTALLA y caben a la vista (el origen de un proyecto). Esto
 * es para conjuntos de cinco o mas, para los que llegan del servicio y pueden
 * ser cero, y para los que traen un parrafo por opcion.
 *
 * LAS TRES DEGRADACIONES, que son la mitad del componente y viven aqui —una
 * sola vez— en vez de en cada sitio de llamada:
 *
 *   1. UNA SOLA OPCION NO ES UN SELECT. Es un dato, y se enseña como dato. Un
 *      desplegable con un elemento le pide al operador que abra algo para
 *      confirmar lo unico que habia — y ademas le esconde que no habia
 *      alternativa, que es justo lo que necesitaba saber.
 *   2. CERO OPCIONES NO ES UN SELECT VACIO. Es un hueco, y el servicio dice por
 *      que lo esta y como salir de el. Un desplegable que se abre vacio se lee
 *      como «esto esta roto».
 *   3. CARGANDO NO ES CERO. Mientras el catalogo viaja, el control se enseña
 *      deshabilitado y diciendolo, no como un hueco declarado.
 */

export interface PropsDeSeleccion {
  /** Obligatoria y enlazada. Un marcador no es una etiqueta. */
  etiqueta: string
  grupo: GrupoDeOpciones
  /** Las opciones a pintar. Por defecto las del grupo; ver `conElValorActual`. */
  opciones?: Opcion[]
  valor: string
  alCambiar: (valor: string) => void
  /** Aclaracion permanente bajo el control. */
  ayuda?: ReactNode
  /** El catalogo todavia no llego. Ver la degradacion 3. */
  cargando?: boolean
  requerido?: boolean
  deshabilitado?: boolean
  /** Texto del campo de busqueda del menu. */
  marcador?: string
  className?: string
}

/** La procedencia de un valor, dicha en una linea. Sin color como unica senal. */
function PorQue({ texto, tono }: { texto: string; tono: 'informativo' | 'neutral' }) {
  return (
    <p className="flex flex-wrap items-baseline gap-1.5 text-label-12 text-ds-gray-700">
      <Badge tono={tono}>{tono === 'informativo' ? 'Preseleccionado' : 'Unica opcion'}</Badge>
      <span className="min-w-0">{texto}</span>
    </p>
  )
}

export function Seleccion({
  etiqueta,
  grupo,
  opciones,
  valor,
  alCambiar,
  ayuda,
  cargando = false,
  requerido = false,
  deshabilitado = false,
  marcador,
  className,
}: PropsDeSeleccion) {
  const [abierto, setAbierto] = useState(false)
  const idDelControl = useId()
  const idDeLaAyuda = useId()

  const lista = opciones ?? grupo.opciones
  const elegida = lista.find((opcion) => opcion.valor === valor) ?? null
  const preseleccion = grupo.preseleccion

  // UNA SOLA OPCION SE FIJA SOLA, y desde un efecto y no desde el render.
  // Llamar a `alCambiar` mientras se pinta actualiza el estado del padre
  // durante el render del hijo: React avisa por consola y, con dos de estos en
  // la misma pantalla, el render se repite hasta que uno de los dos gana.
  //
  // Y se fija en vez de esperar a que el operador «elija» lo unico que hay:
  // dejarlo vacio obliga a abrir un menu de un elemento para poder enviar el
  // formulario, con el boton de enviar apagado mientras tanto y sin que se vea
  // por que.
  const unicaOpcion = lista.length === 1 ? lista[0] : null
  useEffect(() => {
    if (unicaOpcion && valor !== unicaOpcion.valor) alCambiar(unicaOpcion.valor)
  }, [unicaOpcion, valor, alCambiar])

  const comandos = useMemo<Comando[]>(
    () =>
      lista.map((opcion) => ({
        id: `opcion-${opcion.valor}`,
        etiqueta: opcion.etiqueta,
        // La descripcion del servicio va DENTRO del menu y no solo bajo el
        // control: es donde el operador esta mirando cuando compara dos
        // opciones, y leer que hace cada rol despues de elegirlo no sirve de
        // nada.
        descripcion:
          [
            opcion.valor === valor ? 'elegido ahora' : null,
            opcion.valor === preseleccion?.valor && opcion.valor !== valor ? 'preseleccionado' : null,
            opcion.nota ?? opcion.descripcion ?? null,
          ]
            .filter(Boolean)
            .join(' · ') || undefined,
        grupo: etiqueta,
        // El identificador crudo tambien encuentra: quien ya se sabe `api_token`
        // no tiene que aprenderse «Token de API» para buscarlo.
        palabrasClave: [opcion.valor],
        ejecutar: () => alCambiar(opcion.valor),
      })),
    [lista, valor, preseleccion, etiqueta, alCambiar],
  )

  const Etiqueta = (
    <label htmlFor={idDelControl} className="text-label-13 text-ds-gray-1000">
      {etiqueta}
      {requerido ? (
        <>
          {' '}
          <span className="text-ds-gray-700" aria-hidden="true">
            (obligatorio)
          </span>
          <span className="sr-only">obligatorio</span>
        </>
      ) : null}
    </label>
  )

  /* --- Degradacion 3: el catalogo todavia viaja ---------------------------- */
  if (cargando) {
    return (
      <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
        {Etiqueta}
        <div
          id={idDelControl}
          aria-busy="true"
          className="flex h-8 items-center rounded-md bg-ds-background-100 px-2.5 text-copy-14 text-ds-gray-700 shadow-ds-border"
        >
          Pidiendo las opciones al servicio…
        </div>
      </div>
    )
  }

  /* --- Degradacion 2: no hay ninguna, y el servicio dice por que ----------- */
  if (lista.length === 0) {
    return (
      <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
        {Etiqueta}
        <Note tipo="advertencia" titulo={`No hay ninguna opcion de ${etiqueta.toLowerCase()}`}>
          <span className="flex flex-col gap-1">
            <span>{grupo.porque ?? 'El servicio no publica ninguna opcion para este campo.'}</span>
            {grupo.como_conseguirlo ? (
              <span className="text-ds-gray-1000">{grupo.como_conseguirlo}</span>
            ) : null}
          </span>
        </Note>
      </div>
    )
  }

  /* --- Degradacion 1: una sola opcion es un dato, no un control ------------ */
  if (unicaOpcion) {
    const unica = unicaOpcion
    return (
      <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
        {Etiqueta}
        <p
          id={idDelControl}
          className="fuente-operativa flex h-8 items-center rounded-md bg-ds-gray-100 px-2.5 text-label-13 text-ds-gray-1000"
        >
          {unica.etiqueta}
        </p>
        <PorQue
          tono="neutral"
          texto={
            unica.nota ??
            (grupo.porque
              ? `Es la unica que hay, asi que no hay nada que elegir: ${grupo.porque}`
              : 'Es la unica que hay, asi que no hay nada que elegir.')
          }
        />
        {unica.descripcion ? (
          <p className="text-copy-13 text-ds-gray-900">{unica.descripcion}</p>
        ) : null}
        {ayuda ? <p className="text-label-12 text-ds-gray-700">{ayuda}</p> : null}
      </div>
    )
  }

  /* --- El control de verdad ------------------------------------------------ */
  const describe =
    [ayuda ? idDeLaAyuda : null].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {Etiqueta}

      <button
        id={idDelControl}
        type="button"
        onClick={() => setAbierto(true)}
        disabled={deshabilitado}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        aria-describedby={describe}
        className={cn(
          'flex h-8 w-full items-center justify-between gap-2 rounded-md bg-ds-background-100 px-2.5',
          'text-left text-copy-14 text-ds-gray-1000 shadow-ds-border transition-colors',
          'hover:bg-ds-gray-100 disabled:opacity-50',
        )}
      >
        <span className={cn('min-w-0 truncate', elegida ? null : 'text-ds-gray-700')}>
          {elegida ? elegida.etiqueta : `Elige ${etiqueta.toLowerCase()}`}
        </span>
        <ChevronsUpDown aria-hidden="true" className="size-3.5 shrink-0 text-ds-gray-700" />
      </button>

      {/* La descripcion de LA ELEGIDA, y solo esa. Las siete a la vez son siete
          parrafos que el operador tiene que descartar a mano — la misma regla
          que sigue `Segmentado`. */}
      {elegida?.descripcion ? (
        <p className="text-copy-13 text-ds-gray-900">{elegida.descripcion}</p>
      ) : null}

      {elegida?.nota ? (
        <p className="text-copy-13 text-ds-amber-900">{elegida.nota}</p>
      ) : null}

      {/* DE DONDE SALE LO QUE ESTA MARCADO. Solo mientras el valor sigue siendo
          el que el servicio preselecciono: en cuanto el operador elige otro, la
          procedencia deja de describir lo que hay en el campo y se calla. */}
      {preseleccion && preseleccion.valor === valor ? (
        <PorQue
          tono="informativo"
          texto={`${preseleccion.porque}${
            preseleccion.evidencia && preseleccion.evidencia.length > 0
              ? ` Evidencia: ${preseleccion.evidencia.map((e) => e.ruta).join(', ')}.`
              : ''
          }`}
        />
      ) : null}

      {ayuda ? (
        <p id={idDeLaAyuda} className="text-label-12 text-ds-gray-700">
          {ayuda}
        </p>
      ) : null}

      <MenuDeComandos
        comandos={comandos}
        abierto={abierto}
        alCerrar={() => setAbierto(false)}
        marcador={marcador ?? `Busca ${etiqueta.toLowerCase()}`}
      />
    </div>
  )
}
