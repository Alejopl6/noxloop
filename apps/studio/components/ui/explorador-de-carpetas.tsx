'use client'

import { useState } from 'react'
import { CornerLeftUp, Eye, EyeOff, Folder, FolderGit2, RefreshCw } from 'lucide-react'

import { Badge } from '@/components/ui/insignia'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/estado-vacio'
import { Note } from '@/components/ui/nota'
import { Spinner } from '@/components/ui/indicador-de-carga'
import { FalloDeLectura } from '@/components/pantalla'
import { useLectura } from '@/lib/lectura'
import { cn } from '@/lib/utils'
import type { Carpeta, ListadoDeCarpetas } from '@/lib/tipos'

/**
 * El explorador de carpetas: elegir la carpeta del proyecto en vez de
 * escribirla.
 *
 * EL FALLO QUE CIERRA. La pantalla de alta pedia la ruta absoluta en un campo
 * de texto y explicaba, con razon, que en el navegador no hay dialogo de
 * carpetas: el navegador no le entrega a una pagina la ruta de una carpeta del
 * disco. La explicacion era cierta y la conclusion no: el SERVICIO corre en la
 * maquina del operador y si puede leer el disco. Faltaba preguntarselo.
 *
 * LO QUE ESTO NO SUSTITUYE, y por eso el campo de texto sigue al lado: el
 * explorador se acota a las raices que el servicio declara (su cabecera en
 * `packages/service/src/carpetas.mjs` razona por que). Un proyecto que vive
 * fuera de ellas se sigue dando de alta escribiendo su ruta, y desde ese
 * momento su carpeta queda explorable. Quitar el campo convertiria un limite
 * razonable del explorador en un limite del producto.
 *
 * LO QUE SE ENSEÑA DE CADA CARPETA ES LO UNICO QUE DECIDE AQUI: si es un
 * repositorio git —que es lo que separa «se puede adoptar tal cual» de «hay
 * que inicializarlo»— y si ya hay un proyecto gestionandola. Sin lo segundo, el
 * operador la vuelve a dar de alta y el servicio la rechaza por slug repetido,
 * con un error que no habla de lo que pasa.
 *
 * NO HAY LISTA DE ARCHIVOS, y no es una simplificacion: el servicio no los
 * manda. Se enseña cuantos hay, que es lo que sirve para saber si una carpeta
 * esta vacia.
 */

/**
 * La fila de una carpeta. UN solo control, y entrar ES elegir.
 *
 * POR QUE NO HAY «entrar» Y «elegir esta» POR SEPARADO. Porque son la misma
 * respuesta a la misma pregunta y dos botones obligan a adivinar cual hace
 * falta. La carpeta elegida es SIEMPRE la que se esta mirando —la ruta que el
 * explorador enseña arriba es la que el formulario va a enviar— asi que entrar
 * en una la elige, y subir elige la de arriba. Con dos controles, equivocarse
 * cuesta en los dos sentidos: entrar cuando se queria elegir borra la
 * seleccion, y elegir cuando se queria entrar deja el formulario apuntando a la
 * carpeta contenedora, que es el fallo silencioso de los dos.
 */
function Fila({ carpeta, alEntrar }: { carpeta: Carpeta; alEntrar: () => void }) {
  const Icono = carpeta.es_repositorio ? FolderGit2 : Folder

  return (
    <li>
      <button
        type="button"
        onClick={alEntrar}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
          'hover:bg-ds-gray-alpha-100',
        )}
      >
        <Icono aria-hidden="true" className="size-4 shrink-0 text-ds-gray-700" />
        <span className="min-w-0 flex-1 truncate text-copy-14 text-ds-gray-1000">
          {carpeta.nombre}
        </span>

        {/* El texto del badge es la senal, no el color: "Repositorio" se lee
            igual en escala de grises. */}
        {carpeta.es_repositorio ? <Badge tono="exito">Repositorio</Badge> : null}
        {carpeta.proyecto ? (
          <Badge tono="informativo">Ya dado de alta: {carpeta.proyecto.nombre}</Badge>
        ) : null}
        {carpeta.enlace ? <Badge tono="neutral">Enlace</Badge> : null}
      </button>
    </li>
  )
}

export function ExploradorDeCarpetas({
  ruta,
  alElegir,
  className,
}: {
  /** La ruta que se esta mirando. Vacia: el servicio contesta desde su raiz. */
  ruta: string
  /** Entrar en una carpeta ES elegirla: el padre guarda la ruta que llegue. */
  alElegir: (ruta: string) => void
  className?: string
}) {
  const [ocultas, setOcultas] = useState(false)

  const consulta = new URLSearchParams()
  if (ruta.trim()) consulta.set('ruta', ruta.trim())
  if (ocultas) consulta.set('ocultas', 'si')
  const cadena = consulta.toString()

  const lectura = useLectura<Carpeta[]>(`/v1/folders${cadena ? `?${cadena}` : ''}`)

  // El sobre de esta ruta trae MUCHO mas que `items`: la ruta que el servicio
  // resolvio de verdad —que no es la que se pidio cuando habia un enlace por
  // medio—, el padre al que se puede subir, las raices, cuantos archivos hay y
  // cuantas entradas se omitieron. Todo eso viaja JUNTO a `items` como declara
  // el contrato, y `useLectura` lo conserva en `sobre`.
  const sobre = lectura.sobre as ListadoDeCarpetas | null

  const carpetas = lectura.datos ?? []

  // TRES ESTADOS Y NO DOS, y el tercero salio de mirar el HTML generado: con el
  // servicio sin conectar, `useLectura` no pide nada —ni datos, ni error, ni
  // peticion en vuelo— y la version anterior de esta linea (`datos === null &&
  // error === null`) dejaba el indicador «Leyendo la carpeta» girando para
  // siempre sobre una lista vacia. Un explorador que dice estar leyendo y no
  // esta leyendo nada es peor que uno que dice que no puede.
  const cargando = lectura.cargando
  const sinRespuesta = sobre === null && !lectura.cargando && lectura.error === null

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={!sobre || sobre.padre === null}
          onClick={() => sobre?.padre && alElegir(sobre.padre)}
        >
          <CornerLeftUp />
          Subir
        </Button>

        <Button variant="secondary" size="sm" onClick={() => setOcultas((antes) => !antes)}>
          {ocultas ? <EyeOff /> : <Eye />}
          {ocultas ? 'Ocultar las ocultas' : 'Ver las ocultas'}
        </Button>

        <Button variant="secondary" size="sm" onClick={() => lectura.releer()}>
          <RefreshCw />
          Releer
        </Button>

        {cargando ? <Spinner tamano="sm" etiqueta="Leyendo la carpeta" /> : null}
      </div>

      {/* Donde se esta, en Mono: es una ruta, no prosa. */}
      <p className="fuente-operativa break-all text-label-12 text-ds-gray-900">
        {sobre?.ruta ?? ruta ?? ''}
        {sobre?.es_repositorio ? (
          <span className="text-ds-green-900"> · es un repositorio git</span>
        ) : null}
      </p>

      {lectura.avisos.map((aviso) => (
        <Note key={aviso.codigo} tipo="advertencia" titulo={aviso.causa}>
          {aviso.accion}
        </Note>
      ))}

      <FalloDeLectura error={lectura.error} />

      {sinRespuesta ? (
        <Note tipo="neutral" titulo="El servicio de control todavia no ha contestado">
          El explorador lee el disco a traves del servicio, que es quien corre en esta
          maquina: esta pantalla no toca el sistema de archivos. Mientras no haya servicio,
          escribe la ruta absoluta en el campo de abajo — el alta la acepta igual.
        </Note>
      ) : null}

      {!cargando && !sinRespuesta && carpetas.length === 0 && !lectura.error ? (
        <EmptyState
          modo="primero"
          tamano="compacto"
          titulo="Esta Carpeta No Tiene Subcarpetas"
          descripcion={
            sobre && sobre.archivos > 0
              ? `Tiene ${sobre.archivos} archivo(s) y ninguna subcarpeta. Esta carpeta ya esta elegida: es la que el formulario va a enviar.`
              : 'No hay ninguna subcarpeta aqui. Esta carpeta ya esta elegida; sube un nivel para elegir otra, o escribe la ruta en el campo de abajo.'
          }
        />
      ) : null}

      {carpetas.length > 0 ? (
        <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
          {carpetas.map((carpeta) => (
            <Fila key={carpeta.ruta} carpeta={carpeta} alEntrar={() => alElegir(carpeta.ruta)} />
          ))}
        </ul>
      ) : null}

      {/* LO QUE NO SE ENSEÑA, DICHO. Omitir en silencio convierte la lista en
          una verdad a medias: el operador que busca una carpeta oculta
          concluiria que no esta. */}
      {sobre && (sobre.archivos > 0 || sobre.omitidas.ocultas > 0 || sobre.omitidas.enlaces_fuera > 0) ? (
        <p className="text-label-12 text-ds-gray-700">
          {[
            sobre.archivos > 0 ? `${sobre.archivos} archivo(s), que no se listan` : null,
            sobre.omitidas.ocultas > 0 ? `${sobre.omitidas.ocultas} carpeta(s) oculta(s)` : null,
            sobre.omitidas.enlaces_fuera > 0
              ? `${sobre.omitidas.enlaces_fuera} enlace(s) que salen de lo explorable`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          .
        </p>
      ) : null}
    </div>
  )
}
