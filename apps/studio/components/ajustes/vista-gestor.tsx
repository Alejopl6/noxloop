'use client'

import { useEffect, useId, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { Badge } from '@/components/ui/insignia'
import { Note } from '@/components/ui/nota'
import { Encabezado, EsqueletoDeLista, FalloDeLectura } from '@/components/pantalla'
import { EVENTOS_DEL_GESTOR, RUTAS_DEL_GESTOR, type ErrorDelServicio } from '@/lib/daemon'
import { useLectura } from '@/lib/lectura'
import { useMutacion } from '@/lib/mutacion'
import type {
  CambioDelTracker,
  EsquemaDeOpcion,
  EstadoCanonicoEscribible,
  EstadosDelTracker,
  MapaDeEstados,
  TrackerGuardado,
} from '@/lib/tipos'

/**
 * LA PESTANA «GESTOR» DE SETTINGS DEL PROYECTO (spec 005, FR-001/002).
 *
 * Tres cosas que hasta aqui exigian escribir JSON en la conexion: el EQUIPO del
 * gestor, las REGLAS de ruteo (que issues le tocan a este proyecto) y el MAPA
 * de estados (que estado del gestor es «en curso», cual «en revision»...).
 *
 * LA PANTALLA NO SABE QUE GESTOR ES. Pinta los campos que el proveedor DECLARA
 * en su `optionsSchema` (que viaja en la respuesta) y los estados que el
 * proveedor LISTA (`listStates`). Un proveedor sin `listStates` no deja la
 * tabla vacia: se editan los cinco nombres a mano, y la nota dice por que.
 *
 * NO ESCRIBE NADA POR SU CUENTA (principio VIII). Guarda por
 * `PATCH /v1/projects/:id/tracker`, que valida las opciones contra el esquema
 * del proveedor y el mapa contra los cinco canonicos; el error del servicio se
 * pinta tal cual, con su causa y su accion.
 *
 * POR QUE `backlog` NO ES UNA OPCION DEL SELECTOR. El mapa es el de ESCRITURA:
 * dice a que estado mueve el motor el ticket. `backlog` es de lectura —el
 * gestor lo reconoce por su tipo— y el servicio rechaza la clave. Se muestra en
 * la columna «El gestor lo lee como», que es donde es verdad.
 */

const CANONICOS: readonly EstadoCanonicoEscribible[] = ['todo', 'in_progress', 'blocked', 'in_review', 'done']

const NOMBRE_CANONICO: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'En curso',
  blocked: 'Bloqueado',
  in_review: 'En revision',
  done: 'Hecho',
}

/** Lo que el motor hace con cada canonico: por que importa asignarlo. */
const PARA_QUE: Record<EstadoCanonicoEscribible, string> = {
  todo: 'Donde vuelve una issue que se suelta.',
  in_progress: 'A donde la mueve el motor al empezar.',
  blocked: 'A donde la mueve si ninguna tarea llega a terminar.',
  in_review: 'A donde la mueve al abrir el pull request.',
  done: 'El motor no lo escribe nunca: el merge es de una persona.',
}

const MAPA_VACIO: MapaDeEstados = { todo: null, in_progress: null, blocked: null, in_review: null, done: null }

/* -------------------------------------------------------------------------- */
/* Las opciones: los campos que el proveedor declara                          */
/* -------------------------------------------------------------------------- */

/** Un campo de texto que la pantalla sabe pintar, con su ruta en las opciones. */
interface CampoDeOpcion {
  ruta: [string] | [string, string]
  etiqueta: string
  ayuda: string | undefined
  lista: boolean
}

const esTexto = (e: EsquemaDeOpcion | undefined) => e?.type === 'string'
const esListaDeTexto = (e: EsquemaDeOpcion | undefined) => e?.type === 'array' && esTexto(e.items)

/**
 * Los campos que se pueden editar sin JSON: textos y listas de textos, en el
 * primer nivel o dentro de un objeto (`reglas.proyecto`). Lo demas del esquema
 * no se pinta y se CONSERVA al guardar: una opcion que la pantalla no sabe
 * editar no puede borrarse por guardar otra.
 */
function camposDelEsquema(esquema: EsquemaDeOpcion | null): CampoDeOpcion[] {
  const campos: CampoDeOpcion[] = []
  for (const [clave, sub] of Object.entries(esquema?.properties ?? {})) {
    if (esTexto(sub) || esListaDeTexto(sub)) {
      campos.push({ ruta: [clave], etiqueta: clave, ayuda: sub.description, lista: esListaDeTexto(sub) })
    } else if (sub.type === 'object' && sub.properties) {
      for (const [hija, subHija] of Object.entries(sub.properties)) {
        if (esTexto(subHija) || esListaDeTexto(subHija)) {
          campos.push({
            ruta: [clave, hija],
            etiqueta: `${clave}.${hija}`,
            ayuda: subHija.description ?? sub.description,
            lista: esListaDeTexto(subHija),
          })
        }
      }
    }
  }
  return campos
}

const claveDe = (campo: CampoDeOpcion) => campo.ruta.join('.')

function leer(opciones: Record<string, unknown> | null, campo: CampoDeOpcion): string {
  const [a, b] = campo.ruta
  const valor = b ? (opciones?.[a] as Record<string, unknown> | undefined)?.[b] : opciones?.[a]
  if (Array.isArray(valor)) return valor.join(', ')
  return typeof valor === 'string' ? valor : ''
}

/**
 * Las opciones a guardar: las de antes, con los campos editados encima. Un
 * campo vacio se QUITA (no se manda `""`): para el proveedor, una regla vacia
 * y una ausente no son lo mismo, y un `teamKey: ""` filtraria por un equipo que
 * no existe.
 */
function opcionesAGuardar(
  antes: Record<string, unknown> | null,
  campos: CampoDeOpcion[],
  borrador: Record<string, string>,
): Record<string, unknown> {
  const salida: Record<string, unknown> = structuredClone(antes ?? {})
  for (const campo of campos) {
    const texto = (borrador[claveDe(campo)] ?? '').trim()
    const valor = campo.lista
      ? texto
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
      : texto
    const vacio = campo.lista ? (valor as string[]).length === 0 : valor === ''
    const [a, b] = campo.ruta
    if (!b) {
      if (vacio) delete salida[a]
      else salida[a] = valor
      continue
    }
    const padre = { ...((salida[a] as Record<string, unknown> | undefined) ?? {}) }
    if (vacio) delete padre[b]
    else padre[b] = valor
    if (Object.keys(padre).length === 0) delete salida[a]
    else salida[a] = padre
  }
  return salida
}

/* -------------------------------------------------------------------------- */
/* El mapa de estados                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Asigna el estado `nombre` al canonico `canonico` (o lo deja sin asignar con
 * `null`). Un canonico nombra UN estado: asignarlo aqui se lo quita al que lo
 * tuviera, y esa fila pasa a «sin asignar» a la vista.
 */
function asignar(mapa: MapaDeEstados, nombre: string, canonico: EstadoCanonicoEscribible | null): MapaDeEstados {
  const nuevo: MapaDeEstados = { ...mapa }
  for (const c of CANONICOS) if (nuevo[c] === nombre) nuevo[c] = null
  if (canonico) nuevo[canonico] = nombre
  return nuevo
}

function canonicoDe(mapa: MapaDeEstados, nombre: string): EstadoCanonicoEscribible | null {
  return CANONICOS.find((c) => mapa[c] === nombre) ?? null
}

function mismosMapas(a: MapaDeEstados, b: MapaDeEstados) {
  return CANONICOS.every((c) => (a[c] ?? null) === (b[c] ?? null))
}

function SelectorDeCanonico({
  estado,
  valor,
  deshabilitado,
  alCambiar,
}: {
  estado: string
  valor: EstadoCanonicoEscribible | null
  deshabilitado: boolean
  alCambiar: (valor: EstadoCanonicoEscribible | null) => void
}) {
  const id = useId()
  return (
    <>
      <label htmlFor={id} className="sr-only">
        Estado canonico de «{estado}»
      </label>
      <select
        id={id}
        value={valor ?? ''}
        disabled={deshabilitado}
        onChange={(evento) => alCambiar((evento.target.value || null) as EstadoCanonicoEscribible | null)}
        className="h-8 rounded-md bg-ds-background-100 px-2 text-label-13 text-ds-gray-1000 shadow-ds-border outline-none disabled:opacity-50"
      >
        <option value="">Sin asignar</option>
        {CANONICOS.map((c) => (
          <option key={c} value={c}>
            {NOMBRE_CANONICO[c]}
          </option>
        ))}
      </select>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* El panel                                                                   */
/* -------------------------------------------------------------------------- */

export function PanelDelGestor({
  datos,
  cargando,
  error,
  errorDeGuardado,
  guardando,
  alGuardar,
}: {
  datos: EstadosDelTracker | null
  cargando: boolean
  error: ErrorDelServicio | null
  errorDeGuardado: ErrorDelServicio | null
  guardando: boolean
  alGuardar: (cambio: CambioDelTracker) => void
}) {
  const campos = useMemo(() => camposDelEsquema(datos?.esquema ?? null), [datos?.esquema])
  const opcionesActuales = datos?.gestor.opciones ?? null
  const mapaActual = datos?.stateMap ?? MAPA_VACIO

  const [borrador, setBorrador] = useState<Record<string, string>>({})
  const [mapa, setMapa] = useState<MapaDeEstados>(mapaActual)

  // Lo que llega del servicio se adopta como punto de partida: al guardar, el
  // servicio emite `board.invalidado`, la lectura se renueva y el borrador
  // vuelve a ser lo guardado.
  useEffect(() => {
    setBorrador(Object.fromEntries(campos.map((c) => [claveDe(c), leer(opcionesActuales, c)])))
  }, [campos, opcionesActuales])
  useEffect(() => {
    setMapa(datos?.stateMap ?? MAPA_VACIO)
  }, [datos?.stateMap])

  const editable = Boolean(datos?.editable)
  const opcionesCambiadas = campos.some((c) => (borrador[claveDe(c)] ?? '') !== leer(opcionesActuales, c))
  const mapaCambiado = !mismosMapas(mapa, mapaActual)
  const conLista = Boolean(datos && datos.estados.length > 0)
  const sinAsignar = (datos?.estados ?? []).filter((e) => canonicoDe(mapa, e.name) === null).map((e) => e.name)
  const canonicosVacios = CANONICOS.filter((c) => mapa[c] === null && c !== 'done')

  // La propuesta: lo que el gestor diria de cada estado por su tipo, SOLO para
  // los canonicos que el mapa deja vacios. El primero de cada canonico gana;
  // `done` no se propone (el motor no lo escribe).
  const proponer = () => {
    let nuevo = { ...mapa }
    for (const e of datos?.estados ?? []) {
      const s = e.suggested
      if (!s || s === 'backlog' || s === 'done') continue
      if (nuevo[s] === null && canonicoDe(nuevo, e.name) === null) nuevo = asignar(nuevo, e.name, s)
    }
    setMapa(nuevo)
  }

  return (
    <div className="flex flex-col gap-8">
      <Encabezado
        titulo="Gestor"
        descripcion="Que issues del gestor le tocan a este proyecto y como se llaman sus estados. Se guarda en la conexion del proyecto y el siguiente Run ya lo usa."
      />

      <FalloDeLectura error={error} />
      {cargando ? <EsqueletoDeLista filas={3} /> : null}

      {datos ? (
        <>
          <p className="flex flex-wrap items-center gap-2 text-label-13 text-ds-gray-900">
            <Badge tono="neutral">{datos.gestor.nombre}</Badge>
            {datos.gestor.conexion ? (
              <span className="fuente-operativa text-label-12 text-ds-gray-700">conexion {datos.gestor.conexion}</span>
            ) : null}
          </p>

          {!editable && datos.motivo ? (
            <Note tipo="advertencia" titulo="Estos ajustes no se pueden cambiar desde este proyecto">
              {datos.motivo}
            </Note>
          ) : null}
          {datos.nota ? (
            <Note tipo={datos.listStates ? 'error' : 'informativo'} titulo="Los estados del gestor">
              {datos.nota}
            </Note>
          ) : null}

          {/* ---------------------------------------------- equipo y reglas */}
          <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h3 className="text-heading-16 text-ds-gray-1000">Equipo y reglas</h3>
              <p className="max-w-2xl text-copy-14 text-ds-gray-900">
                Las reglas deciden que issues aparecen en este board: el proyecto del gestor Y, si pones etiquetas,
                alguna de ellas. Dos proyectos de noxloop sobre el mismo equipo, con reglas distintas, ven cada uno
                lo suyo. Un campo vacio es «sin condicion».
              </p>
            </div>
            {campos.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {campos.map((campo) => (
                  <Campo
                    key={claveDe(campo)}
                    etiqueta={campo.etiqueta}
                    valor={borrador[claveDe(campo)] ?? ''}
                    alCambiar={(valor) => setBorrador((antes) => ({ ...antes, [claveDe(campo)]: valor }))}
                    ayuda={campo.lista ? `${campo.ayuda ?? ''} Separadas por comas.`.trim() : campo.ayuda}
                    operativo
                    deshabilitado={!editable || guardando}
                  />
                ))}
              </div>
            ) : (
              <p className="text-copy-14 text-ds-gray-900">
                El proveedor `{datos.gestor.nombre}` no declara opciones que se puedan editar aqui.
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={!editable || !opcionesCambiadas || guardando}
                onClick={() => alGuardar({ opciones: opcionesAGuardar(opcionesActuales, campos, borrador) })}
              >
                {guardando ? 'Guardando…' : 'Guardar equipo y reglas'}
              </Button>
              {opcionesCambiadas ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setBorrador(Object.fromEntries(campos.map((c) => [claveDe(c), leer(opcionesActuales, c)])))}
                >
                  Descartar
                </Button>
              ) : null}
            </div>
          </section>

          {/* ------------------------------------------------------ estados */}
          <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h3 className="text-heading-16 text-ds-gray-1000">Estados</h3>
              <p className="max-w-2xl text-copy-14 text-ds-gray-900">
                A que estado del gestor mueve el motor la issue en cada momento. Cada estado canonico nombra uno
                solo; un estado sin asignar el motor no lo escribe nunca, y un canonico sin estado se omite.
              </p>
            </div>

            {conLista ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left">
                  <thead>
                    <tr className="text-label-12 text-ds-gray-700">
                      <th scope="col" className="py-2 pr-4 font-normal">Estado en el gestor</th>
                      <th scope="col" className="py-2 pr-4 font-normal">El gestor lo lee como</th>
                      <th scope="col" className="py-2 font-normal">Estado canonico</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.estados.map((estado) => {
                      const canonico = canonicoDe(mapa, estado.name)
                      return (
                        <tr key={estado.id} className="border-t border-ds-gray-300">
                          <td className="py-2 pr-4">
                            <span className="fuente-operativa text-label-13 text-ds-gray-1000">{estado.name}</span>
                            {estado.category ? (
                              <span className="ml-2 text-label-12 text-ds-gray-700">{estado.category}</span>
                            ) : null}
                          </td>
                          <td className="py-2 pr-4 text-label-13 text-ds-gray-900">
                            {estado.suggested ? NOMBRE_CANONICO[estado.suggested] : 'sin columna'}
                          </td>
                          <td className="py-2">
                            <div className="flex items-center gap-2">
                              <SelectorDeCanonico
                                estado={estado.name}
                                valor={canonico}
                                deshabilitado={!editable || guardando}
                                alCambiar={(valor) => setMapa((antes) => asignar(antes, estado.name, valor))}
                              />
                              {canonico === null ? <Badge tono="advertencia">sin asignar</Badge> : null}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              // SIN LISTA DEL GESTOR: los cinco nombres a mano. Es la
              // degradacion declarada, no un editor roto.
              <div className="grid gap-4 sm:grid-cols-2">
                {CANONICOS.map((c) => (
                  <Campo
                    key={c}
                    etiqueta={NOMBRE_CANONICO[c]}
                    valor={mapa[c] ?? ''}
                    alCambiar={(valor) => setMapa((antes) => ({ ...antes, [c]: valor.trim() ? valor : null }))}
                    ayuda={`${PARA_QUE[c]} Tal como se llama en el gestor; vacio si no existe.`}
                    operativo
                    deshabilitado={!editable || guardando}
                  />
                ))}
              </div>
            )}

            {conLista && sinAsignar.length > 0 ? (
              <p className="text-copy-13 text-ds-gray-900">
                <span className="text-ds-gray-1000">Sin asignar:</span> {sinAsignar.join(', ')}. El motor no mueve
                ninguna issue a estos estados; el board los sigue leyendo por su tipo.
              </p>
            ) : null}
            {canonicosVacios.length > 0 ? (
              <ul className="flex flex-col gap-1 text-copy-13 text-ds-gray-900">
                {canonicosVacios.map((c) => (
                  <li key={c}>
                    <span className="text-ds-gray-1000">{NOMBRE_CANONICO[c]}</span> no tiene estado: {PARA_QUE[c]}{' '}
                    Sin estado, ese paso no se escribe en el gestor.
                  </li>
                ))}
              </ul>
            ) : null}
            {datos.desconocidos.length > 0 ? (
              <Note tipo="advertencia" titulo="El mapa nombra estados que el gestor no tiene">
                {datos.desconocidos.map((d) => `${NOMBRE_CANONICO[d.canonico]} → «${d.nombre}»`).join(', ')}. El motor
                fallaria al escribirlos: asigna un estado real o dejalos sin estado.
              </Note>
            ) : null}

            {errorDeGuardado ? <FalloDeLectura error={errorDeGuardado} /> : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={!editable || !mapaCambiado || guardando}
                onClick={() => alGuardar({ stateMap: mapa })}
              >
                {guardando ? 'Guardando…' : 'Guardar estados'}
              </Button>
              {conLista && editable ? (
                <Button variant="secondary" size="sm" disabled={guardando} onClick={proponer}>
                  Proponer segun el gestor
                </Button>
              ) : null}
              {mapaCambiado ? (
                <Button variant="ghost" size="sm" onClick={() => setMapa(mapaActual)}>
                  Descartar
                </Button>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}

export function VistaDelGestor({ proyectoId }: { proyectoId: string }) {
  const lectura = useLectura<EstadosDelTracker>(RUTAS_DEL_GESTOR.estados(proyectoId), {
    relerEn: EVENTOS_DEL_GESTOR,
  })
  const mutacion = useMutacion()

  const guardar = async (cambio: CambioDelTracker) => {
    const hecho = await mutacion.enviar<TrackerGuardado>('PATCH', RUTAS_DEL_GESTOR.tracker(proyectoId), cambio)
    if (hecho !== null) lectura.releer()
  }

  return (
    <PanelDelGestor
      datos={lectura.datos}
      cargando={lectura.datos === null && lectura.error === null}
      error={lectura.error}
      errorDeGuardado={mutacion.error}
      guardando={mutacion.trabajando}
      alGuardar={(cambio) => void guardar(cambio)}
    />
  )
}
