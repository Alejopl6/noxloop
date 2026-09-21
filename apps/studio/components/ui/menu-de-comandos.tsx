'use client'

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as EventoDeTecladoDeReact,
  type ReactNode,
} from 'react'
import { Search } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Dialogo } from '@/components/ui/dialogo'
import { EmptyState } from '@/components/ui/estado-vacio'

/**
 * T197 · `MenuDeComandos` (⌘K) — NFR-005.
 *
 * NO ES UN ATAJO PARA EXPERTOS: es lo que hace que la consola se pueda operar
 * SIN raton. NFR-005 pide teclado, y "teclado" en una aplicacion con navegacion
 * lateral significa, sin esto, tabular hasta encontrar el enlace. El menu de
 * comandos convierte cualquier destino y cualquier accion en dos pulsaciones y
 * un par de letras, y de paso es la unica superficie donde el operador descubre
 * que existe una accion que no esta en la pantalla en la que esta.
 *
 * SE BUSCA SIN ACENTOS Y SIN MAYUSCULAS, en los dos sentidos: escribir
 * "credencial" encuentra "Añadir credencial" y escribir "anadir" tambien. En
 * una interfaz en espanol es la diferencia entre que el buscador funcione y que
 * el operador crea que la accion no existe.
 *
 * ACCESIBILIDAD: es el patron `combobox` + `listbox`. El foco NO se mueve nunca
 * a la lista —se queda en el campo, que es donde se sigue escribiendo— y quien
 * esta resaltado se anuncia con `aria-activedescendant`. Mover el foco de
 * verdad rompe el campo de texto; no moverlo y no poner `aria-activedescendant`
 * deja a un lector de pantalla sin saber que hay seleccionado.
 *
 * LO QUE TRAERIA UNA DEPENDENCIA: `cmdk` (que es lo que usa shadcn para esto)
 * anade puntuacion por coincidencia difusa, agrupado con estado y virtualizado.
 * Con un catalogo de comandos de la consola —decenas, no miles— el filtrado por
 * subcadena normalizada acierta igual y no mete otra dependencia en una
 * aplicacion que se distribuye empaquetada.
 */

export interface Comando {
  id: string
  /** Verbo + sustantivo. "Abrir bandeja", "Revocar credencial". */
  etiqueta: string
  /** Que hace, si el nombre no basta. */
  descripcion?: string
  /** Encabezado bajo el que se agrupa. Sin grupo, va al final. */
  grupo?: string
  /** Sinonimos por los que tambien deberia encontrarse. */
  palabrasClave?: string[]
  /** El atajo propio, si lo tiene. Solo se pinta; no se registra aqui. */
  atajo?: string
  icono?: ReactNode
  ejecutar: () => void
}

/** Sin acentos y en minusculas. Ver la cabecera. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/**
 * El atajo global. Vive en un hook y no dentro del componente para que el menu
 * pueda montarse una sola vez en la cascara de la aplicacion y abrirse desde
 * cualquier sitio.
 *
 * `preventDefault` es obligatorio: ⌘K esta cogido por el navegador (foco en la
 * barra de direcciones en algunos) y Ctrl+K por otros tantos.
 */
export function useMenuDeComandos() {
  const [abierto, setAbierto] = useState(false)

  useEffect(() => {
    const alPulsar = (evento: globalThis.KeyboardEvent) => {
      if ((evento.metaKey || evento.ctrlKey) && evento.key.toLowerCase() === 'k') {
        evento.preventDefault()
        setAbierto((estaba) => !estaba)
      }
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [])

  return {
    abierto,
    abrir: useCallback(() => setAbierto(true), []),
    cerrar: useCallback(() => setAbierto(false), []),
  }
}

export interface PropsDeMenuDeComandos {
  comandos: Comando[]
  abierto: boolean
  alCerrar: () => void
  marcador?: string
  className?: string
}

export function MenuDeComandos({
  comandos,
  abierto,
  alCerrar,
  marcador = 'Busca una accion o un destino',
  className,
}: PropsDeMenuDeComandos) {
  const [consulta, setConsulta] = useState('')
  const [indice, setIndice] = useState(0)
  const idDeLaLista = useId()
  const idBase = useId()
  const opciones = useRef(new Map<string, HTMLLIElement | null>())

  // Cada apertura empieza limpia. Conservar la consulta anterior ensena
  // resultados de una busqueda que el operador ya no recuerda haber hecho.
  useEffect(() => {
    if (abierto) {
      setConsulta('')
      setIndice(0)
    }
  }, [abierto])

  const filtrados = useMemo(() => {
    const aguja = normalizar(consulta.trim())
    if (!aguja) return comandos
    return comandos.filter((comando) => {
      const pajar = normalizar(
        [comando.etiqueta, comando.descripcion ?? '', comando.grupo ?? '', ...(comando.palabrasClave ?? [])].join(' '),
      )
      return pajar.includes(aguja)
    })
  }, [comandos, consulta])

  // El resaltado vuelve al primero en cada tecleo: tras filtrar, el indice
  // anterior apunta a un comando distinto, y pulsar Enter ejecutaria algo que
  // el operador no eligio.
  useEffect(() => {
    setIndice(0)
  }, [consulta])

  useEffect(() => {
    const actual = filtrados[indice]
    if (!actual) return
    opciones.current.get(actual.id)?.scrollIntoView({ block: 'nearest' })
  }, [indice, filtrados])

  const ejecutar = (comando: Comando) => {
    // Se cierra ANTES de ejecutar: si el comando navega o abre otro dialogo, un
    // menu que se cierra despues pelea por el foco con lo que acaba de abrirse.
    alCerrar()
    comando.ejecutar()
  }

  const alPulsarTecla = (evento: EventoDeTecladoDeReact<HTMLInputElement>) => {
    if (filtrados.length === 0) return
    switch (evento.key) {
      case 'ArrowDown':
        evento.preventDefault()
        setIndice((actual) => (actual + 1) % filtrados.length)
        break
      case 'ArrowUp':
        evento.preventDefault()
        setIndice((actual) => (actual - 1 + filtrados.length) % filtrados.length)
        break
      case 'Home':
        evento.preventDefault()
        setIndice(0)
        break
      case 'End':
        evento.preventDefault()
        setIndice(filtrados.length - 1)
        break
      case 'Enter': {
        evento.preventDefault()
        const elegido = filtrados[indice]
        if (elegido) ejecutar(elegido)
        break
      }
      default:
        break
    }
  }

  // El orden de grupos es el de primera aparicion en `comandos`: asi el sitio
  // de llamada decide la prioridad con el orden del array, sin otra prop.
  const porGrupo = useMemo(() => {
    const mapa = new Map<string, Comando[]>()
    for (const comando of filtrados) {
      const grupo = comando.grupo ?? 'Otros'
      const lista = mapa.get(grupo)
      if (lista) lista.push(comando)
      else mapa.set(grupo, [comando])
    }
    return [...mapa.entries()]
  }, [filtrados])

  const activo = filtrados[indice]

  return (
    <Dialogo
      abierto={abierto}
      alCerrar={alCerrar}
      etiqueta="Menu de comandos"
      ancho="lg"
      className={className}
    >
      <div className="flex items-center gap-2 border-b border-ds-gray-400 px-4">
        <Search className="size-4 shrink-0 text-ds-gray-700" aria-hidden="true" />
        <input
          // eslint-disable-next-line jsx-a11y/no-autofocus -- dentro de un dialogo modal el foco TIENE que empezar aqui
          autoFocus
          value={consulta}
          onChange={(evento) => setConsulta(evento.target.value)}
          onKeyDown={alPulsarTecla}
          placeholder={marcador}
          role="combobox"
          aria-expanded
          aria-controls={idDeLaLista}
          aria-autocomplete="list"
          aria-activedescendant={activo ? `${idBase}-${activo.id}` : undefined}
          aria-label="Busca una accion o un destino"
          autoComplete="off"
          spellCheck={false}
          className="h-12 w-full bg-transparent text-copy-14 text-ds-gray-1000 outline-none placeholder:text-ds-gray-700"
        />
      </div>

      {filtrados.length === 0 ? (
        <div className="px-4">
          <EmptyState
            modo="filtrado"
            tamano="compacto"
            titulo="Ningun Comando Coincide"
            consulta={consulta}
            descripcion="El menu solo lista lo que puedes hacer ahora mismo: una accion que exige un proyecto abierto no aparece hasta que abras uno."
          />
        </div>
      ) : (
        <ul
          id={idDeLaLista}
          role="listbox"
          aria-label="Comandos"
          className="max-h-80 overflow-y-auto p-2"
        >
          {porGrupo.map(([grupo, comandosDelGrupo]) => (
            <li key={grupo} role="presentation">
              <div className="px-2 pb-1 pt-2 text-label-12 text-ds-gray-700">{grupo}</div>
              <ul role="presentation">
                {comandosDelGrupo.map((comando) => {
                  const resaltado = activo?.id === comando.id
                  return (
                    <li
                      key={comando.id}
                      id={`${idBase}-${comando.id}`}
                      role="option"
                      aria-selected={resaltado}
                      ref={(elemento) => {
                        opciones.current.set(comando.id, elemento)
                      }}
                      onMouseMove={() => {
                        const posicion = filtrados.findIndex((c) => c.id === comando.id)
                        if (posicion >= 0 && posicion !== indice) setIndice(posicion)
                      }}
                      onClick={() => ejecutar(comando)}
                      className={cn(
                        'flex cursor-default items-center gap-2.5 rounded-md px-2 py-2',
                        resaltado ? 'bg-ds-gray-alpha-100' : null,
                      )}
                    >
                      {comando.icono ? (
                        <span
                          aria-hidden="true"
                          className="flex size-4 shrink-0 items-center justify-center text-ds-gray-700 [&_svg]:size-4"
                        >
                          {comando.icono}
                        </span>
                      ) : null}

                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-label-14 text-ds-gray-1000">{comando.etiqueta}</span>
                        {comando.descripcion ? (
                          <span className="text-label-12 text-ds-gray-900">{comando.descripcion}</span>
                        ) : null}
                      </span>

                      {comando.atajo ? (
                        <span className="fuente-operativa shrink-0 text-label-12 text-ds-gray-700">
                          {comando.atajo}
                        </span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-4 border-t border-ds-gray-400 bg-ds-background-200 px-4 py-2 text-label-12 text-ds-gray-700">
        <span>
          <span className="fuente-operativa">↑ ↓</span> moverse
        </span>
        <span>
          <span className="fuente-operativa">↵</span> ejecutar
        </span>
        <span>
          <span className="fuente-operativa">esc</span> cerrar
        </span>
      </div>
    </Dialogo>
  )
}
