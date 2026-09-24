'use client'

import { useEffect, useRef, useState } from 'react'
import { KeyRound, LogIn } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { Entity, ListaDeEntidades } from '@/components/ui/entidad'
import { EmptyState } from '@/components/ui/estado-vacio'
import { Badge } from '@/components/ui/insignia'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { Note } from '@/components/ui/nota'
import { Encabezado, EsqueletoDeLista, FalloDeLectura } from '@/components/pantalla'
import { ErrorDelServicio, RUTAS } from '@/lib/daemon'
import { useLectura } from '@/lib/lectura'
import { useMutacion } from '@/lib/mutacion'
import type { EstadoDeRuntime, MetodoDeRuntime } from '@/lib/tipos'

/**
 * MODELOS: CON QUE SE EJECUTAN LOS AGENTES.
 *
 * Una fila por runtime de agente, y la pantalla no sabe cuales hay: los dice
 * `GET /v1/runtimes`. Hoy son dos —el SDK de agentes de Claude y Codex— y
 * mañana puede ser otro sin tocar este archivo. Es el principio VI aplicado a
 * la interfaz: soportar un runtime nuevo es anadir un adaptador en el
 * servicio, no una fila escrita aqui.
 *
 * DOS FORMAS DE CONECTAR, y la diferencia importa porque se factura distinto:
 *
 *   - INICIAR SESION usa la suscripcion o la cuenta del operador. El servicio
 *     lanza el login del propio runtime, que abre el navegador del sistema;
 *     esta pantalla solo hace la peticion y despues SONDEA el estado cada dos
 *     segundos hasta que el runtime diga que esta conectado, o hasta tres
 *     minutos. No hay otra forma de saberlo: el login ocurre fuera de noxloop.
 *   - USAR API KEY manda la clave al servicio, que la guarda en la boveda. El
 *     valor NO se queda en ningun estado de esta pantalla despues de enviarlo
 *     (principio IX): el campo se vacia y lo que vuelve es el estado, no la
 *     clave.
 *
 * Si el runtime de la flota de un proyecto no esta conectado, sus tarjetas
 * del board llevan Run apagado con el motivo «Conecta un modelo en Settings →
 * Modelos». Ese texto lo manda el servicio; esta es la pantalla a la que
 * apunta.
 */

const ESPERA_ENTRE_SONDEOS_MS = 2_000
const ESPERA_MAXIMA_DE_LOGIN_MS = 3 * 60_000

const COMO_ESTA_CONECTADO: Record<MetodoDeRuntime, string> = {
  suscripcion_claude: 'con tu suscripcion de Claude',
  cuenta_chatgpt: 'con tu cuenta de ChatGPT',
  api_key: 'con API key',
}

export function etiquetaDeConexion(runtime: EstadoDeRuntime): string {
  if (!runtime.conectado) return 'No conectado'
  return runtime.metodo ? `Conectado · ${COMO_ESTA_CONECTADO[runtime.metodo] ?? runtime.metodo}` : 'Conectado'
}

export interface PropsDePanelDeModelos {
  runtimes: EstadoDeRuntime[] | null
  cargando: boolean
  error: ErrorDelServicio | null
  /** El runtime cuyo inicio de sesion se esta esperando. */
  esperando: string | null
  errorDeAccion: ErrorDelServicio | null
  trabajando: boolean
  alIniciarSesion: (runtime: string) => void
  alCancelarEspera: () => void
  alGuardarClave: (runtime: string, valor: string) => Promise<boolean>
  alQuitarClave: (runtime: string) => void
}

export function PanelDeModelos({
  runtimes,
  cargando,
  error,
  esperando,
  errorDeAccion,
  trabajando,
  alIniciarSesion,
  alCancelarEspera,
  alGuardarClave,
  alQuitarClave,
}: PropsDePanelDeModelos) {
  const [conFormulario, setConFormulario] = useState<string | null>(null)
  const [clave, setClave] = useState('')

  // Al cerrar el formulario la clave se borra. Un valor secreto a medio
  // escribir que sobrevive a «Cancelar» reaparece al abrir el de otro runtime.
  const cerrarFormulario = () => {
    setConFormulario(null)
    setClave('')
  }

  return (
    <div className="flex flex-col gap-6">
      <Encabezado
        titulo="Modelos"
        descripcion="Los runtimes que ejecutan a los agentes y como esta conectado cada uno. Con tu suscripcion o tu cuenta, el login lo hace el propio runtime en el navegador; con una API key, la clave va a la boveda del servicio y no vuelve a esta pantalla."
      />

      {errorDeAccion ? (
        <Note tipo="error" titulo={errorDeAccion.causa}>
          {errorDeAccion.accion}
        </Note>
      ) : null}

      {cargando ? <EsqueletoDeLista filas={2} /> : null}

      {!cargando && (runtimes ?? []).length === 0 ? (
        <EmptyState
          modo={error ? 'error' : 'primero'}
          titulo={error ? 'No Se Pudieron Leer Los Modelos' : 'Ningun Runtime Registrado'}
          descripcion={
            error ? (
              <FalloDeLectura error={error} />
            ) : (
              'El servicio no tiene ningun runtime de agente registrado. Los adaptadores se montan al arrancar el servicio; sin ninguno, el board no puede lanzar nada.'
            )
          }
        />
      ) : null}

      {runtimes && runtimes.length > 0 ? (
        <>
          {error ? <FalloDeLectura error={error} /> : null}
          <ListaDeEntidades etiqueta="Runtimes de agente">
            {runtimes.map((runtime) => {
              const esperandoEste = esperando === runtime.runtime
              const abierto = conFormulario === runtime.runtime
              return (
                <li key={runtime.runtime} className="flex flex-col">
                  <Entity
                    contenedor="div"
                    titulo={runtime.nombre}
                    identificador={runtime.runtime}
                    descripcion={
                      <span className="flex flex-col gap-1">
                        <span>{runtime.detalle}</span>
                        {!runtime.conectado && runtime.causa ? (
                          <span className="text-ds-gray-1000">{runtime.causa}</span>
                        ) : null}
                        {!runtime.conectado && runtime.accion ? (
                          <span className="text-ds-gray-700">{runtime.accion}</span>
                        ) : null}
                      </span>
                    }
                    metadatos={
                      <Badge tono={runtime.conectado ? 'exito' : 'neutral'}>
                        {etiquetaDeConexion(runtime)}
                      </Badge>
                    }
                    acciones={
                      <div className="flex flex-wrap items-center gap-2">
                        {esperandoEste ? (
                          <>
                            <Spinner tamano="sm" etiqueta="Esperando el inicio de sesion" conTexto />
                            <Button variant="ghost" size="sm" onClick={alCancelarEspera}>
                              Dejar de esperar
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={trabajando || esperando !== null}
                            onClick={() => alIniciarSesion(runtime.runtime)}
                          >
                            <LogIn aria-hidden="true" />
                            Iniciar sesion
                          </Button>
                        )}
                        {runtime.metodo === 'api_key' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={trabajando}
                            onClick={() => alQuitarClave(runtime.runtime)}
                          >
                            Quitar API key
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-expanded={abierto}
                            disabled={trabajando}
                            onClick={() => (abierto ? cerrarFormulario() : (setClave(''), setConFormulario(runtime.runtime)))}
                          >
                            <KeyRound aria-hidden="true" />
                            Usar API key
                          </Button>
                        )}
                      </div>
                    }
                  />

                  {esperandoEste ? (
                    <p className="px-3 pb-3 text-copy-13 text-ds-gray-900">
                      Se abrio el inicio de sesion de {runtime.nombre} en tu navegador. Terminalo alli;
                      esta fila cambia sola en cuanto el runtime diga que esta conectado.
                    </p>
                  ) : null}

                  {abierto ? (
                    <form
                      className="flex flex-col gap-3 px-3 pb-4"
                      onSubmit={async (evento) => {
                        evento.preventDefault()
                        if (!clave.trim()) return
                        const hecho = await alGuardarClave(runtime.runtime, clave.trim())
                        // Se vacia pase lo que pase: con exito ya esta en la
                        // boveda, y con fallo el operador la vuelve a pegar
                        // antes que dejarla viva en memoria de la pagina.
                        setClave('')
                        if (hecho) setConFormulario(null)
                      }}
                    >
                      <Campo
                        etiqueta={`API key de ${runtime.nombre}`}
                        valor={clave}
                        alCambiar={setClave}
                        secreto
                        operativo
                        requerido
                        ayuda="Va al servicio y se guarda en la boveda. Esta pantalla no la conserva ni la vuelve a mostrar; lo que queda visible es solo si el runtime esta conectado."
                      />
                      <div className="flex items-center gap-2">
                        <Button type="submit" size="sm" disabled={!clave.trim() || trabajando}>
                          Guardar API key
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={cerrarFormulario}>
                          Cancelar
                        </Button>
                      </div>
                    </form>
                  ) : null}
                </li>
              )
            })}
          </ListaDeEntidades>
        </>
      ) : null}
    </div>
  )
}

export function VistaDeModelos() {
  const lectura = useLectura<EstadoDeRuntime[]>(RUTAS.runtimes())
  const mutacion = useMutacion()
  const [esperando, setEsperando] = useState<string | null>(null)
  const [errorDeEspera, setErrorDeEspera] = useState<ErrorDelServicio | null>(null)
  const releer = useRef(lectura.releer)
  releer.current = lectura.releer

  // EL SONDEO. Mientras se espera un login, se relee la lista cada dos
  // segundos; se para cuando el runtime aparece conectado o a los tres
  // minutos, y en ese caso se dice que paso en vez de girar para siempre.
  useEffect(() => {
    if (!esperando) return
    const intervalo = setInterval(() => releer.current(), ESPERA_ENTRE_SONDEOS_MS)
    const tope = setTimeout(() => {
      setEsperando(null)
      setErrorDeEspera(
        new ErrorDelServicio({
          codigo: 'login_sin_terminar',
          causa: `El inicio de sesion de ${esperando} no termino en tres minutos: el runtime sigue sin decir que esta conectado.`,
          accion:
            'Si cerraste la ventana del navegador, vuelve a pulsar Iniciar sesion. Si el navegador no llego a abrirse, mira la salida del servicio: el login del runtime escribe ahi lo que le falta.',
        }),
      )
    }, ESPERA_MAXIMA_DE_LOGIN_MS)
    return () => {
      clearInterval(intervalo)
      clearTimeout(tope)
    }
  }, [esperando])

  useEffect(() => {
    if (!esperando) return
    if (lectura.datos?.some((runtime) => runtime.runtime === esperando && runtime.conectado)) {
      setEsperando(null)
    }
  }, [lectura.datos, esperando])

  const iniciarSesion = async (runtime: string) => {
    setErrorDeEspera(null)
    const respuesta = await mutacion.enviar<{ iniciado: boolean }>('POST', RUTAS.loginDeRuntime(runtime))
    if (respuesta) setEsperando(runtime)
  }

  const guardarClave = async (runtime: string, valor: string) => {
    setErrorDeEspera(null)
    // La respuesta es el estado del runtime, sin la clave. No se guarda: se
    // relee, que es la unica fuente de «esta conectado».
    const respuesta = await mutacion.enviar<EstadoDeRuntime>('POST', RUTAS.claveDeRuntime(runtime), { valor })
    lectura.releer()
    return respuesta !== null
  }

  const quitarClave = async (runtime: string) => {
    setErrorDeEspera(null)
    await mutacion.enviar('DELETE', RUTAS.claveDeRuntime(runtime))
    lectura.releer()
  }

  return (
    <PanelDeModelos
      runtimes={lectura.datos}
      cargando={lectura.datos === null && lectura.error === null}
      error={lectura.error}
      esperando={esperando}
      errorDeAccion={mutacion.error ?? errorDeEspera}
      trabajando={mutacion.trabajando}
      alIniciarSesion={(runtime) => void iniciarSesion(runtime)}
      alCancelarEspera={() => setEsperando(null)}
      alGuardarClave={guardarClave}
      alQuitarClave={(runtime) => void quitarClave(runtime)}
    />
  )
}
