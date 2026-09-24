'use client'

import { useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Campo } from '@/components/ui/campo'
import { Note } from '@/components/ui/nota'
import { establecerTokenDeSesion } from '@/lib/daemon'

/**
 * La pantalla que pide el token de sesion en modo web.
 *
 * POR QUE EXISTE, Y POR QUE NO ESTAR ERA UN FALLO GRAVE. El token no se
 * persiste —eso sigue siendo correcto, ver `daemon.ts`— y se toma de `?token=`
 * en la direccion, que se borra en cuanto se lee para que no quede en el
 * historial ni se copie al compartir el enlace.
 *
 * Las dos decisiones son buenas por separado y juntas dejaban la aplicacion
 * MUERTA a la primera recarga: sin token no hay cliente, sin cliente la
 * aplicacion entera cae a "el servicio no esta corriendo" —aunque este
 * corriendo perfectamente— y todas las acciones dejan de hacer nada. El
 * operador ve una herramienta rota y el diagnostico que la pantalla le da es
 * falso: le habla de arrancar un servicio que ya arranco.
 *
 * Es el fallo de las costuras otra vez, y esta vez entre dos decisiones mias.
 *
 * ESTA PANTALLA NO SE INVENTA EL PROBLEMA NI LO ESCONDE: dice que falta el
 * token, donde encontrarlo, y por que hay que volver a pegarlo tras recargar.
 * La alternativa —guardarlo en `localStorage`— seria un secreto en reposo
 * legible por cualquier script de la pagina, y el principio IX no distingue
 * entre secretos importantes y secretos comodos.
 */
export function PedirToken({ alEntrar }: { alEntrar: () => void }) {
  const [valor, setValor] = useState('')

  function enviar(evento: FormEvent) {
    evento.preventDefault()
    const token = valor.trim()
    if (!token) return
    establecerTokenDeSesion(token)
    // El reintento lo dispara quien nos monta: esta pantalla no sabe reconectar.
    alEntrar()
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-6 px-6 py-16">
      <div className="flex flex-col gap-2">
        <KeyRound aria-hidden="true" className="size-5 text-ds-gray-700" />
        <h1 className="text-heading-24 text-ds-gray-1000">Falta el token de sesion</h1>
        <p className="text-copy-14 text-ds-gray-900">
          El servicio de control puede estar corriendo perfectamente: lo que falta es la credencial
          con la que esta pestaña se identifica ante el. Sin ella, el servicio rechaza cada peticion
          y esta interfaz no puede leer ni pedir nada.
        </p>
      </div>

      <form onSubmit={enviar} className="flex flex-col gap-4">
        <Campo
          etiqueta="Token de sesion"
          valor={valor}
          alCambiar={setValor}
          secreto
          ayuda="Lo imprime el servicio al arrancar, y queda en `<home>/servicio/sesion.json`. Si lo lanzaste con `--token`, es ese."
        />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={valor.trim().length === 0}>
            Entrar
          </Button>
        </div>
      </form>

      <Note tipo="informativo" titulo="Por que hay que volver a pegarlo al recargar">
        El token vive solo en memoria. Guardarlo en el navegador lo dejaria legible por cualquier
        script de la pagina y sobreviviria al cierre — un secreto en reposo sin boveda, que es lo
        que el principio IX prohibe. El precio es este paso; es el precio correcto.
      </Note>
    </main>
  )
}
