'use client'

import { useState } from 'react'
import { Check, Copy, ExternalLink, KeyRound } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { ErrorText } from '@/components/ui/fieldset'
import { Note } from '@/components/ui/nota'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { abrirExterno } from '@/lib/enlace'
import { comoErrorDelServicio, type ErrorDelServicio } from '@/lib/daemon'
import type { EstadoDeAplicacionesOauth, RecorridoDeRegistro } from '@/lib/tipos'

/**
 * El recorrido para registrar la aplicacion OAuth de un proveedor.
 *
 * -------------------------------------------------------------------------
 * POR QUE ESTA PANTALLA EXISTE, Y QUE HABIA EN SU LUGAR
 * -------------------------------------------------------------------------
 *
 * Habia una lista de tres frases que empezaba por «Levantar el servidor de
 * integraciones en esta maquina» y terminaba con: «Ninguna de las tres se
 * puede hacer desde esta pantalla, y por eso no hay aqui un boton que las
 * prometa». Era honesto y era un callejon: el operador leia lo que le faltaba
 * y se quedaba exactamente igual de lejos de conseguirlo.
 *
 * Con el adaptador alojado montado, dos de las tres YA estan hechas. La que
 * queda —registrar la aplicacion— es la unica que solo puede dar el operador,
 * y esta pantalla la convierte en cuatro pasos con los valores dentro.
 *
 * -------------------------------------------------------------------------
 * POR QUE NO SE PUEDE SALTAR, Y LA PRUEBA VIAJA EN LA RESPUESTA
 * -------------------------------------------------------------------------
 *
 * La pregunta del operador fue «¿no sirven las integraciones con OAuth? para
 * eso esta la capa de integraciones». Sirven — pero sus aplicaciones OAuth
 * compartidas viven en SU nube. Medido contra una instancia propia: la tabla
 * que las guarda se crea vacia, los 1013 proveedores vienen con
 * `preConfigured: false`, y pedir una devuelve 400. Ademas el callback de esas
 * aplicaciones apunta a su dominio, que una instancia en localhost no puede
 * recibir.
 *
 * Esa evidencia se enseña, plegada, en vez de resumirse en «hace falta
 * registrar una aplicacion». Una afirmacion sin pruebas se vuelve a discutir.
 *
 * -------------------------------------------------------------------------
 * POR QUE LA REDIRECT URI VA DETRAS DE UN BOTON DE COPIAR
 * -------------------------------------------------------------------------
 *
 * La guia oficial del proveedor de integraciones dice, literal, que pegues la
 * direccion de SU nube. Con una instancia propia esa es justo la que no
 * funciona, y el fallo no aparece al registrar: aparece al autorizar, con un
 * error del proveedor sobre un `redirect_uri` que no coincide y que no
 * menciona ninguna instancia, ningun puerto y ninguna pantalla de aqui.
 *
 * Por eso el valor correcto viaja como dato desde el servicio —calculado con
 * el servidor que de verdad esta escuchando— y se copia con un boton. Lo que
 * no se transcribe no se transcribe mal.
 */

/** Un valor copiable, con su boton. */
function ParaCopiar({ valor }: { valor: string }) {
  const [copiado, setCopiado] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="fuente-operativa rounded-md border border-ds-gray-400 bg-ds-gray-100 px-2 py-1 text-label-12 text-ds-gray-1000">
        {valor}
      </code>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          void navigator.clipboard?.writeText(valor)
          setCopiado(true)
          window.setTimeout(() => setCopiado(false), 2000)
        }}
      >
        {copiado ? <Check /> : <Copy />}
        {copiado ? 'Copiado' : 'Copiar'}
      </Button>
    </div>
  )
}

export interface PropsDeRegistroDeAplicacion {
  recorrido: RecorridoDeRegistro
  /** La constancia de por que no hay aplicaciones compartidas, con su evidencia. */
  compartidas: EstadoDeAplicacionesOauth['aplicaciones_compartidas'] | null
  trabajando: boolean
  error: ErrorDelServicio | null
  alRegistrar: (datos: { client_id: string; client_secret: string }) => void
}

export function RegistroDeAplicacionOauth({
  recorrido,
  compartidas,
  trabajando,
  error,
  alRegistrar,
}: PropsDeRegistroDeAplicacion) {
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [errorDeEnlace, setErrorDeEnlace] = useState<ErrorDelServicio | null>(null)
  const [porQue, setPorQue] = useState(false)

  const completo = clientId.trim().length > 0 && clientSecret.trim().length > 0

  const abrir = async (url: string) => {
    setErrorDeEnlace(null)
    try {
      await abrirExterno(url)
    } catch (fallo: unknown) {
      setErrorDeEnlace(comoErrorDelServicio(fallo, url))
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Note
        tipo="informativo"
        titulo={`Registra tu aplicacion OAuth de ${recorrido.nombre ?? recorrido.slug}: es el unico paso que queda`}
      >
        <div className="flex flex-col gap-2">
          <p>
            El servidor de integraciones ya esta levantado y conectado. Lo que falta es una
            aplicacion OAuth tuya, y solo la puedes crear tu: son cuatro pasos y se hace una vez
            por proveedor.
          </p>
          {compartidas && !compartidas.hay ? (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                className="self-start text-label-12 text-ds-blue-900 underline underline-offset-2"
                onClick={() => setPorQue((v) => !v)}
              >
                {porQue ? 'Ocultar' : '¿Por que no basta con conectar y ya?'}
              </button>
              {porQue ? (
                <div className="flex flex-col gap-2 rounded-md border border-ds-gray-400 p-3">
                  <p className="text-copy-13 text-ds-gray-900">{compartidas.porque}</p>
                  <p className="text-label-12 text-ds-gray-700">
                    Comprobado contra esta instancia
                    {compartidas.version ? ` (version ${compartidas.version})` : null}
                    {compartidas.medido_el ? `, el ${compartidas.medido_el}` : null}:
                  </p>
                  <ul className="ml-4 flex list-disc flex-col gap-1 text-label-12 text-ds-gray-900">
                    {compartidas.evidencia.map((prueba) => (
                      <li key={prueba.comprobacion}>
                        <span className="fuente-operativa">{prueba.comprobacion}</span> →{' '}
                        {prueba.resultado}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Note>

      <ol className="flex flex-col gap-4">
        {recorrido.pasos.map((paso, indice) => (
          <li key={paso.titulo} className="flex gap-3">
            <span
              aria-hidden
              className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-ds-gray-400 text-label-12 text-ds-gray-900"
            >
              {indice + 1}
            </span>
            <div className="flex flex-col gap-2">
              <p className="text-label-13 text-ds-gray-1000">{paso.titulo}</p>
              <p className="text-copy-13 text-ds-gray-900">{paso.detalle}</p>
              {paso.abrir ? (
                <div>
                  <Button variant="secondary" size="sm" onClick={() => void abrir(paso.abrir as string)}>
                    <ExternalLink />
                    Abrir en el navegador
                  </Button>
                </div>
              ) : null}
              {paso.pegar ? <ParaCopiar valor={paso.pegar} /> : null}
            </div>
          </li>
        ))}
      </ol>

      <div className="flex max-w-md flex-col gap-4">
        <Campo
          etiqueta="Client ID"
          valor={clientId}
          alCambiar={setClientId}
          requerido
          operativo
          deshabilitado={trabajando}
          ayuda="Se ve en la pagina de la aplicacion que acabas de crear."
        />
        <Campo
          etiqueta="Client Secret"
          valor={clientSecret}
          alCambiar={setClientSecret}
          requerido
          secreto
          deshabilitado={trabajando}
          ayuda="Va directo al servidor de integraciones, que lo cifra con su clave en reposo. No se guarda en este servicio y no vuelve a salir por esta pantalla."
        />
      </div>

      {errorDeEnlace ? <ErrorText causa={errorDeEnlace.causa} accion={errorDeEnlace.accion} /> : null}
      {error ? <ErrorText causa={error.causa} accion={error.accion} /> : null}

      <div>
        <Button
          onClick={() => alRegistrar({ client_id: clientId.trim(), client_secret: clientSecret.trim() })}
          disabled={trabajando || !completo}
        >
          {trabajando ? <Spinner tamano="sm" etiqueta="Registrando" /> : <KeyRound />}
          Registrar la aplicacion
        </Button>
      </div>
    </div>
  )
}
