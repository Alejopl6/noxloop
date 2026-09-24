'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { useLectura, type Lectura } from '@/lib/lectura'
import type { CatalogoDeOpciones, GrupoDeOpciones, Opcion } from '@/lib/tipos'

/**
 * El catalogo de opciones del servicio, leido una vez por pantalla.
 *
 * POR QUE ESTE MODULO EXISTE Y NO SE LLAMA `useLectura` EN CADA VISTA. Por tres
 * cosas que, escritas en cada sitio de llamada, se olvidan en el tercero:
 *
 *   1. UN GRUPO QUE NO ESTA NO ES UN GRUPO VACIO. Si el servicio es mas viejo
 *      que esta interfaz, `/v1/options` contesta 404 o llega sin la clave que
 *      se pidio. Un `catalogo.grupos[clave].opciones` sobre eso revienta con
 *      "cannot read properties of undefined" y la pantalla entera desaparece —
 *      por un desplegable. `grupoDe()` devuelve SIEMPRE un grupo, y cuando no
 *      hay lo devuelve declarado como hueco, con el motivo dentro.
 *   2. LA ETIQUETA DE UN VALOR GUARDADO. Una lista de agentes tiene que pintar
 *      "Implementador" al lado de un `rol: "implementador"` que ya esta en la
 *      base. Eso es el catalogo otra vez, pero leido al reves, y hacerlo a mano
 *      es como se cuela un `Record` de etiquetas en el cliente — que es
 *      exactamente lo que este cambio vino a quitar.
 *   3. EL VALOR GUARDADO PUEDE NO ESTAR EN EL CATALOGO. Un agente guardado con
 *      `runtime: "codex"` cuando el servicio de hoy ya no lo registra tiene que
 *      poder verse: lo que hay en la base es un hecho, y esconderlo deja al
 *      operador mirando un campo vacio donde hay un valor. `conElValorActual()`
 *      lo añade a la lista marcandolo.
 */

/** Se relee cuando el proyecto cambia de estado: la preseleccion depende de el. */
const EVENTOS = ['proyecto.estado', 'sincronizar_completo'] as const

export interface Opciones {
  catalogo: CatalogoDeOpciones | null
  lectura: Lectura<CatalogoDeOpciones>
  /** El grupo pedido, SIEMPRE. Cuando no hay, uno declarado hueco. */
  grupoDe: (clave: string) => GrupoDeOpciones
}

/**
 * @param proyectoId con el, el servicio calcula las preselecciones de ESE
 *   proyecto; sin el, contesta el catalogo generico y ninguna preseleccion dice
 *   `detectado`.
 */
export function useOpciones(proyectoId?: string | null): Opciones {
  const lectura = useLectura<CatalogoDeOpciones>(
    proyectoId ? `/v1/options?project_id=${encodeURIComponent(proyectoId)}` : '/v1/options',
    { relerEn: EVENTOS },
  )

  const catalogo = lectura.datos
  const error = lectura.error

  const grupoDe = useMemo(() => {
    return (clave: string): GrupoDeOpciones => {
      const grupo = catalogo?.grupos?.[clave]
      if (grupo) return grupo
      return {
        opciones: [],
        unica: false,
        origen: 'vacio',
        porque: error
          ? `No se pudo leer el catalogo de opciones del servicio: ${error.causa}`
          : catalogo
            ? `Este servicio no publica el grupo de opciones \`${clave}\` en /v1/options. Suele ser un servicio mas viejo que esta interfaz: la lista existe en su modelo de datos, pero no la expone todavia.`
            : 'El catalogo de opciones todavia no ha llegado del servicio.',
        como_conseguirlo: error
          ? error.accion
          : 'Comprueba en /v1/health la version del servicio; si no es la que esta interfaz espera, cierra la aplicacion y vuelve a abrirla para que levante el que le corresponde.',
        preseleccion: null,
      }
    }
  }, [catalogo, error])

  return { catalogo, lectura, grupoDe }
}

/**
 * Un valor de formulario que ADOPTA la preseleccion del servicio cuando llega,
 * y deja de hacerlo en cuanto el operador elige.
 *
 * POR QUE HACE FALTA UN HOOK Y NO BASTA UN VALOR INICIAL. Porque el catalogo
 * llega DESPUES del primer render: en ese instante la preseleccion es `null` y
 * un `useState(grupo.preseleccion?.valor ?? '')` se queda con la cadena vacia
 * para siempre. El campo saldria en blanco justo cuando el servicio si sabia
 * que poner, que es el caso entero para el que existe la preseleccion.
 *
 * Y POR QUE «SOLO HASTA QUE EL OPERADOR ELIGE». Porque el catalogo se relee
 * —cuando el proyecto cambia de estado, por el canal de eventos— y una
 * adopcion sin memoria pisaria lo que el operador acababa de elegir, en medio
 * de rellenar el formulario, sin ninguna accion suya de por medio. Es el mismo
 * fallo que el borrador de una guideline resincronizandose encima de lo
 * escrito.
 *
 * @param grupo el grupo del catalogo del que sale la preseleccion
 * @param inicial lo que vale mientras no haya ni preseleccion ni eleccion
 */
export function useValorConPreseleccion(
  grupo: GrupoDeOpciones,
  inicial = '',
): [string, (valor: string) => void] {
  // El inicial se calcula con la preseleccion QUE YA HAYA en el primer render,
  // y no solo desde el efecto. Sin esto, cuando el catalogo ya esta en memoria
  // —otra pantalla lo leyo, o el HTML se pregenero con el— el control se pinta
  // un fotograma vacio y salta al valor bueno en el siguiente. Se vio en el
  // HTML generado: el select de autonomia salia con «Elige nivel de autonomia»
  // teniendo L0 preseleccionado al lado.
  const [valor, setValor] = useState(() => grupo.preseleccion?.valor ?? inicial)
  const eligioLaPersona = useRef(false)

  const preseleccionado = grupo.preseleccion?.valor ?? null

  useEffect(() => {
    if (eligioLaPersona.current) return
    if (preseleccionado && preseleccionado !== valor) setValor(preseleccionado)
    // `valor` queda fuera a proposito: el efecto reacciona a que llegue una
    // preseleccion nueva, no a que el valor cambie. Con el dentro, el propio
    // `setValor` lo volveria a disparar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preseleccionado])

  const elegir = (nuevo: string) => {
    eligioLaPersona.current = true
    setValor(nuevo)
  }

  return [valor, elegir]
}

/**
 * La etiqueta de un valor guardado, o el valor crudo si el catalogo no lo
 * conoce.
 *
 * DEVUELVE EL CRUDO Y NO UN HUECO a proposito: lo que hay en la base es un
 * hecho, y un guion en su lugar convierte "este agente corre sobre un runtime
 * que ya no existe" en "este agente no tiene runtime", que son dos problemas
 * distintos con dos salidas distintas.
 */
export function etiquetaDe(grupo: GrupoDeOpciones, valor: string | null | undefined): string {
  if (!valor) return ''
  return grupo.opciones.find((opcion) => opcion.valor === valor)?.etiqueta ?? valor
}

/** La descripcion de un valor guardado, si el catalogo la trae. */
export function descripcionDe(
  grupo: GrupoDeOpciones,
  valor: string | null | undefined,
): string | undefined {
  if (!valor) return undefined
  return grupo.opciones.find((opcion) => opcion.valor === valor)?.descripcion
}

/**
 * Las opciones del grupo MAS el valor que ya esta guardado, si no esta entre
 * ellas.
 *
 * EL FALLO QUE CIERRA: editar un agente guardado con un runtime que el servicio
 * de hoy ya no registra. Sin esto, el desplegable se abre sin nada marcado y el
 * primer guardado cambia el runtime en silencio —a ninguno, o al que el
 * operador elija sin saber que habia otro— y el revisor acaba compartiendo
 * runtime con el implementador sin que nadie tocara esa decision.
 */
export function conElValorActual(grupo: GrupoDeOpciones, valor: string | null | undefined): Opcion[] {
  if (!valor) return grupo.opciones
  if (grupo.opciones.some((opcion) => opcion.valor === valor)) return grupo.opciones
  return [
    ...grupo.opciones,
    {
      valor,
      etiqueta: valor,
      nota:
        'Esta guardado asi, y este servicio no lo ofrece: o lo escribio una version anterior, o el registro ' +
        'que lo atendia ya no esta montado. Se enseña porque es lo que hay en la base; elegir otro lo cambia.',
    },
  ]
}
