'use client'

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Check, ChevronDown, Plus, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { plural } from '@/components/board/derivar'
import type { ResumenDelBoard } from '@/lib/tipos'
import { cn } from '@/lib/utils'

/**
 * LA BARRA DE ARRIBA DEL BOARD: titulo, resumen, filtros y «Nueva tarea»,
 * que es el primario de la pantalla (US7: sin gestor externo, el board se
 * llena desde aqui).
 *
 * Los filtros son DESPLEGABLES PEQUENOS y no el menu de comandos, que es lo
 * que usa el conmutador de proyecto. La diferencia es de escala: el menu de
 * comandos es un dialogo modal con buscador, correcto para elegir entre veinte
 * proyectos; para elegir entre «con repo» y «sin repo» un modal que tapa el
 * board es una pantalla de por medio para dos opciones. El desplegable se
 * cierra con Escape y al pulsar fuera, se recorre con flechas y devuelve el
 * foco al boton — las cuatro cosas que un desplegable propio suele olvidar.
 */

/* -------------------------------------------------------------------------- */
/* Desplegable de filtro                                                      */
/* -------------------------------------------------------------------------- */

export interface OpcionDeFiltro {
  /** `null` es «todos»: quitar el filtro. */
  valor: string | null
  etiqueta: string
  prefijo?: ReactNode
}

export function FiltroDesplegable({
  etiqueta,
  opciones,
  valor,
  alCambiar,
  deshabilitado = false,
}: {
  /** Que filtra: «Proyecto», «Asignado»… Es tambien el nombre accesible. */
  etiqueta: string
  opciones: OpcionDeFiltro[]
  valor: string | null
  alCambiar: (valor: string | null) => void
  deshabilitado?: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const contenedor = useRef<HTMLDivElement>(null)
  const boton = useRef<HTMLButtonElement>(null)
  const lista = useRef<HTMLUListElement>(null)
  const idLista = useId()

  const elegida = opciones.find((opcion) => opcion.valor === valor) ?? null
  const activo = valor !== null

  useEffect(() => {
    if (!abierto) return
    const alPulsarFuera = (evento: MouseEvent) => {
      if (!contenedor.current?.contains(evento.target as Node)) setAbierto(false)
    }
    document.addEventListener('mousedown', alPulsarFuera)
    // El foco entra en la opcion elegida, o en la primera: abrir un listbox y
    // dejar el foco en el boton obliga a una tecla mas antes de poder elegir.
    const opcionesDom = lista.current?.querySelectorAll<HTMLElement>('[role="option"]')
    const inicial =
      lista.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? opcionesDom?.[0]
    inicial?.focus()
    return () => document.removeEventListener('mousedown', alPulsarFuera)
  }, [abierto])

  const cerrar = () => {
    setAbierto(false)
    boton.current?.focus()
  }

  const alTeclear = (evento: KeyboardEvent<HTMLUListElement>) => {
    const opcionesDom = Array.from(
      lista.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
    )
    const actual = opcionesDom.indexOf(document.activeElement as HTMLElement)
    if (evento.key === 'Escape') {
      evento.preventDefault()
      cerrar()
    } else if (evento.key === 'ArrowDown') {
      evento.preventDefault()
      opcionesDom[Math.min(actual + 1, opcionesDom.length - 1)]?.focus()
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault()
      opcionesDom[Math.max(actual - 1, 0)]?.focus()
    } else if (evento.key === 'Home') {
      evento.preventDefault()
      opcionesDom[0]?.focus()
    } else if (evento.key === 'End') {
      evento.preventDefault()
      opcionesDom[opcionesDom.length - 1]?.focus()
    } else if (evento.key === 'Tab') {
      setAbierto(false)
    }
  }

  return (
    <div ref={contenedor} className="relative">
      <button
        ref={boton}
        type="button"
        disabled={deshabilitado}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-controls={abierto ? idLista : undefined}
        onClick={() => setAbierto((estaba) => !estaba)}
        onKeyDown={(evento) => {
          if (evento.key === 'ArrowDown' && !abierto) {
            evento.preventDefault()
            setAbierto(true)
          }
        }}
        className={cn(
          'inline-flex h-7 max-w-[14rem] items-center gap-1.5 rounded-md px-2 text-label-13 transition-colors disabled:opacity-50',
          activo
            ? 'bg-ds-gray-alpha-200 text-ds-gray-1000'
            : 'text-ds-gray-900 shadow-ds-border hover:bg-ds-gray-alpha-100 hover:text-ds-gray-1000',
        )}
      >
        <span className={activo ? 'text-ds-gray-900' : undefined}>{etiqueta}</span>
        {activo && elegida ? (
          <span className="flex min-w-0 items-center gap-1.5">
            {elegida.prefijo}
            <span className="truncate">{elegida.etiqueta}</span>
          </span>
        ) : null}
        <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-ds-gray-700" />
      </button>

      {abierto ? (
        <ul
          ref={lista}
          id={idLista}
          role="listbox"
          aria-label={etiqueta}
          onKeyDown={alTeclear}
          className="movimiento-popover absolute left-0 top-full z-40 mt-1 max-h-72 min-w-52 overflow-y-auto rounded-lg bg-ds-background-100 p-1 shadow-ds-menu"
        >
          {opciones.map((opcion) => {
            const seleccionada = opcion.valor === valor
            return (
              <li
                key={opcion.valor ?? '\u0000todos'}
                role="option"
                aria-selected={seleccionada}
                tabIndex={-1}
                onClick={() => {
                  alCambiar(opcion.valor)
                  cerrar()
                }}
                onKeyDown={(evento) => {
                  if (evento.key === 'Enter' || evento.key === ' ') {
                    evento.preventDefault()
                    alCambiar(opcion.valor)
                    cerrar()
                  }
                }}
                className="flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-label-13 text-ds-gray-1000 outline-none hover:bg-ds-gray-alpha-100 focus:bg-ds-gray-alpha-200 focus-visible:shadow-none"
              >
                {opcion.prefijo}
                <span className="min-w-0 flex-1 truncate">{opcion.etiqueta}</span>
                {seleccionada ? (
                  <Check aria-hidden="true" className="size-3.5 shrink-0 text-ds-gray-900" />
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* El resumen                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * «● 4 corriendo  ● 3 te necesitan  1 en cola» (FR-008).
 *
 * CERO SE DICE EN PALABRAS. «0 te necesitan» es un numero que hay que leer y
 * traducir; «nada te espera» ya es la conclusion (US3, escenario 3). Lo que no
 * se hace es esconder la cifra cuando es cero: un resumen al que le falta una
 * pieza se lee como un resumen roto.
 */
export function ResumenDeRuns({ resumen }: { resumen: ResumenDelBoard | null }) {
  if (!resumen) {
    return <span className="text-label-13 text-ds-gray-700">Sin resumen todavia</span>
  }

  const { enCurso, teNecesitan, enCola } = resumen
  if (enCurso === 0 && teNecesitan === 0 && enCola === 0) {
    return (
      <p role="status" className="text-label-13 text-ds-gray-900">
        Nada corriendo · nada te espera
      </p>
    )
  }

  return (
    <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-label-13 text-ds-gray-1000">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-ds-blue-700" />
        {enCurso > 0 ? plural(enCurso, 'corriendo', 'corriendo') : 'nada corriendo'}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-ds-amber-700" />
        {teNecesitan > 0 ? plural(teNecesitan, 'te necesita', 'te necesitan') : 'nada te espera'}
      </span>
      {enCola > 0 ? (
        <span className="text-ds-gray-900">{plural(enCola, 'en cola', 'en cola')}</span>
      ) : null}
    </p>
  )
}

/* -------------------------------------------------------------------------- */
/* La barra                                                                   */
/* -------------------------------------------------------------------------- */

export function BarraDelBoard({
  titulo,
  prefijoDelTitulo,
  resumen,
  texto,
  alCambiarTexto,
  filtros,
  motivoSinTareaNueva,
  alNuevaTarea,
  extremo,
}: {
  titulo: string
  prefijoDelTitulo?: ReactNode
  resumen: ResumenDelBoard | null
  texto: string
  alCambiarTexto: (texto: string) => void
  /** Los desplegables, ya montados. */
  filtros: ReactNode
  /** Por que no se puede crear una tarea ahora, o `null` si se puede. */
  motivoSinTareaNueva: string | null
  /** Abre el dialogo de tarea nueva (US7). */
  alNuevaTarea: () => void
  /** Lo que va al final de la fila de filtros: incluir terminados, limpiar. */
  extremo?: ReactNode
}) {
  const idMotivo = useId()

  return (
    <div className="flex shrink-0 flex-col gap-3 border-b border-ds-gray-400 px-4 pb-3 pt-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="flex min-w-0 items-center gap-2 text-heading-20 text-ds-gray-1000">
          {prefijoDelTitulo}
          <span className="truncate">{titulo}</span>
        </h1>

        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
          <ResumenDeRuns resumen={resumen} />
          <Button
            size="sm"
            className="h-7 px-2.5"
            disabled={motivoSinTareaNueva !== null}
            aria-describedby={motivoSinTareaNueva ? idMotivo : undefined}
            title={motivoSinTareaNueva ?? 'Crea una tarea propia, sin gestor externo'}
            onClick={alNuevaTarea}
          >
            <Plus aria-hidden="true" />
            Nueva tarea
          </Button>
          {motivoSinTareaNueva ? (
            <span id={idMotivo} className="sr-only">
              {motivoSinTareaNueva}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex items-center">
          <span className="sr-only">Filtrar tarjetas</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-2 size-3.5 text-ds-gray-700" />
          <input
            type="search"
            value={texto}
            onChange={(evento) => alCambiarTexto(evento.target.value)}
            placeholder="Filtrar…"
            className="h-7 w-48 rounded-md bg-ds-background-100 pl-7 pr-2 text-label-13 text-ds-gray-1000 shadow-ds-border outline-none placeholder:text-ds-gray-700 sm:w-56"
          />
        </label>
        {filtros}
        {extremo ? <div className="ml-auto flex items-center gap-2">{extremo}</div> : null}
      </div>
    </div>
  )
}
