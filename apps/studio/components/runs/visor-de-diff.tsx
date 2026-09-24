'use client'

import { useMemo, useState } from 'react'

import { Badge, type TonoDeBadge } from '@/components/ui/insignia'
import { Note } from '@/components/ui/nota'
import type { ArchivoDeDiff, CommitDeTarea, DiffDeTarea } from '@/lib/tipos'
import { cn } from '@/lib/utils'

/**
 * EL DIFF DE UNA TAREA: lo que cambio su agente, commit a commit (US6).
 *
 * POR QUE POR COMMIT Y NO EL DIFF ENTERO DE LA RAMA. Porque el orden es la
 * prueba: el commit del test va ANTES que el de la implementacion, y eso es el
 * principio I a la vista —el test existio y fallo antes que el codigo—. Un
 * diff unico de la rama mezcla los dos y borra justo la evidencia que el
 * operador necesita para fiarse del agente sin leer el PR entero.
 *
 * SOLO LECTURA, y sale de `git log`/`git diff` sobre la rama y el worktree de
 * la tarea, en el servicio. Aqui no se ejecuta nada ni se lee ningun archivo.
 *
 * FORMA: lista de archivos a la izquierda, parche unificado a la derecha. El
 * parche va en Geist Mono con dos canales de numero de linea (antes y
 * despues), y lo anadido y lo quitado se distinguen por color Y por el signo
 * `+`/`-` de la primera columna: el color solo no lo leen todos.
 */

const TIPO_DE_COMMIT: Record<string, { etiqueta: string; tono: TonoDeBadge }> = {
  test: { etiqueta: 'Test', tono: 'informativo' },
  impl: { etiqueta: 'Implementacion', tono: 'exito' },
  otro: { etiqueta: 'Otro', tono: 'neutral' },
}

const ESTADO_DE_ARCHIVO: Record<string, { letra: string; nombre: string; clase: string }> = {
  A: { letra: 'A', nombre: 'Anadido', clase: 'text-ds-green-900' },
  M: { letra: 'M', nombre: 'Modificado', clase: 'text-ds-amber-900' },
  D: { letra: 'D', nombre: 'Borrado', clase: 'text-ds-red-900' },
  R: { letra: 'R', nombre: 'Renombrado', clase: 'text-ds-blue-900' },
}

/**
 * ¿Llego el parche cortado? El contrato dice que los de mas de 200 KB se
 * cortan «y lo dicen», sin fijar como. Se acepta un campo booleano con los
 * dos nombres razonables y, por si el servicio lo dice en el propio texto, una
 * ultima linea que lo declare. Mejor avisar de mas que pintar como entero un
 * archivo al que le falta el final.
 */
export function parcheCortado(archivo: ArchivoDeDiff): boolean {
  if (archivo.cortado || archivo.truncado) return true
  const ultima = archivo.parche.trimEnd().split('\n').pop() ?? ''
  return /(cortado|truncad|truncated)/i.test(ultima) && !/^[+\- ]/.test(ultima)
}

interface LineaDePatch {
  tipo: 'hunk' | 'mas' | 'menos' | 'contexto' | 'nota'
  texto: string
  antes: number | null
  despues: number | null
}

/** Parte un parche unificado en lineas con su numero de antes y de despues. */
export function analizarParche(parche: string): LineaDePatch[] {
  const lineas: LineaDePatch[] = []
  let antes = 0
  let despues = 0
  for (const linea of parche.replace(/\r\n/g, '\n').split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(linea)
    if (hunk) {
      antes = Number(hunk[1])
      despues = Number(hunk[2])
      lineas.push({ tipo: 'hunk', texto: linea, antes: null, despues: null })
    } else if (linea.startsWith('+')) {
      lineas.push({ tipo: 'mas', texto: linea.slice(1), antes: null, despues: despues++ })
    } else if (linea.startsWith('-')) {
      lineas.push({ tipo: 'menos', texto: linea.slice(1), antes: antes++, despues: null })
    } else if (linea.startsWith('\\')) {
      lineas.push({ tipo: 'nota', texto: linea, antes: null, despues: null })
    } else if (linea.startsWith(' ')) {
      lineas.push({ tipo: 'contexto', texto: linea.slice(1), antes: antes++, despues: despues++ })
    } else if (linea.length > 0) {
      // Cabeceras sueltas (`diff --git`, `index`, la marca de corte): se
      // ensenan como nota y no como contexto, que les daria numero de linea.
      lineas.push({ tipo: 'nota', texto: linea, antes: null, despues: null })
    }
  }
  return lineas
}

const ESTILO_DE_LINEA: Record<LineaDePatch['tipo'], { fila: string; signo: string; marca: string }> = {
  mas: { fila: 'bg-ds-green-100', signo: 'text-ds-green-900', marca: '+' },
  menos: { fila: 'bg-ds-red-100', signo: 'text-ds-red-900', marca: '-' },
  contexto: { fila: '', signo: 'text-ds-gray-700', marca: ' ' },
  hunk: { fila: 'bg-ds-gray-100 text-ds-gray-900', signo: 'text-ds-gray-700', marca: '' },
  nota: { fila: 'text-ds-gray-700 italic', signo: 'text-ds-gray-700', marca: '' },
}

export function ParcheUnificado({ archivo }: { archivo: ArchivoDeDiff }) {
  const lineas = useMemo(() => analizarParche(archivo.parche), [archivo.parche])
  const cortado = parcheCortado(archivo)

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {cortado ? (
        <Note tipo="advertencia" titulo="Este parche llego cortado">
          El servicio corta los parches de mas de 200 KB. Lo que se ve termina donde termina lo que
          llego, no donde termina el archivo: el resto esta en la rama de la tarea.
        </Note>
      ) : null}
      {lineas.length === 0 ? (
        <p className="px-3 py-4 text-copy-13 text-ds-gray-900">
          Sin lineas de texto: es un archivo binario, un cambio de permisos o un renombrado sin cambios.
        </p>
      ) : (
        <div className="max-h-[36rem] overflow-auto rounded-md shadow-ds-border">
          <table className="fuente-operativa w-full border-collapse text-label-12">
            <caption className="sr-only">Parche de {archivo.ruta}</caption>
            <tbody>
              {lineas.map((linea, indice) => {
                const estilo = ESTILO_DE_LINEA[linea.tipo]
                return (
                  <tr key={indice} className={estilo.fila}>
                    <td className="w-10 select-none px-2 text-right align-top text-ds-gray-700">
                      {linea.antes ?? ''}
                    </td>
                    <td className="w-10 select-none px-2 text-right align-top text-ds-gray-700">
                      {linea.despues ?? ''}
                    </td>
                    <td className={cn('w-4 select-none text-center align-top', estilo.signo)}>{estilo.marca}</td>
                    <td className="whitespace-pre pr-4 align-top text-ds-gray-1000">{linea.texto || ' '}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ListaDeArchivos({
  archivos,
  elegido,
  alElegir,
}: {
  archivos: ArchivoDeDiff[]
  elegido: string | null
  alElegir: (ruta: string) => void
}) {
  return (
    <ul aria-label="Archivos" className="flex flex-col gap-px">
      {archivos.map((archivo) => {
        const estado = ESTADO_DE_ARCHIVO[archivo.estado] ?? {
          letra: archivo.estado,
          nombre: archivo.estado,
          clase: 'text-ds-gray-900',
        }
        const esEste = archivo.ruta === elegido
        const nombre = archivo.ruta.split('/').pop() ?? archivo.ruta
        const carpeta = archivo.ruta.slice(0, archivo.ruta.length - nombre.length)
        return (
          <li key={archivo.ruta}>
            <button
              type="button"
              aria-current={esEste ? 'true' : undefined}
              title={`${estado.nombre}: ${archivo.ruta}`}
              onClick={() => alElegir(archivo.ruta)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                esEste ? 'bg-ds-gray-alpha-200' : 'hover:bg-ds-gray-alpha-100',
              )}
            >
              <span className={cn('fuente-operativa w-3 shrink-0 text-label-12', estado.clase)}>
                <span aria-hidden="true">{estado.letra}</span>
                <span className="sr-only">{estado.nombre}</span>
              </span>
              <span className="fuente-operativa min-w-0 flex-1 truncate text-label-12">
                <span className="text-ds-gray-700">{carpeta}</span>
                <span className="text-ds-gray-1000">{nombre}</span>
              </span>
              <span className="fuente-operativa shrink-0 text-label-12">
                <span className="text-ds-green-900">+{archivo.mas}</span>{' '}
                <span className="text-ds-red-900">−{archivo.menos}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** Un commit —o el bloque «sin commitear»— con sus archivos y el parche elegido. */
function BloqueDeCambios({
  titulo,
  tono,
  sha,
  mensaje,
  archivos,
}: {
  titulo: string
  tono: TonoDeBadge
  sha: string | null
  mensaje: string | null
  archivos: ArchivoDeDiff[]
}) {
  const [elegido, setElegido] = useState<string | null>(archivos[0]?.ruta ?? null)
  const archivo = archivos.find((candidato) => candidato.ruta === elegido) ?? archivos[0] ?? null
  const [asunto, ...cuerpo] = (mensaje ?? '').split('\n')
  const mas = archivos.reduce((suma, candidato) => suma + candidato.mas, 0)
  const menos = archivos.reduce((suma, candidato) => suma + candidato.menos, 0)

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tono={tono}>{titulo}</Badge>
          {sha ? <span className="fuente-operativa text-label-12 text-ds-gray-700">{sha.slice(0, 10)}</span> : null}
          <span className="fuente-operativa text-label-12">
            <span className="text-ds-green-900">+{mas}</span> <span className="text-ds-red-900">−{menos}</span>
          </span>
          <span className="text-label-12 text-ds-gray-700">
            {archivos.length} {archivos.length === 1 ? 'archivo' : 'archivos'}
          </span>
        </div>
        {asunto ? <p className="text-heading-14 text-ds-gray-1000">{asunto}</p> : null}
        {cuerpo.join('\n').trim() ? (
          <p className="whitespace-pre-wrap text-copy-13 text-ds-gray-900">{cuerpo.join('\n').trim()}</p>
        ) : null}
      </header>

      {archivos.length === 0 ? (
        <p className="text-copy-13 text-ds-gray-900">Este commit no toca ningun archivo.</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <ListaDeArchivos archivos={archivos} elegido={archivo?.ruta ?? null} alElegir={setElegido} />
          {archivo ? <ParcheUnificado archivo={archivo} /> : null}
        </div>
      )}
    </section>
  )
}

/**
 * ¿El test fue antes? Solo se afirma lo que los commits dicen: si hay un
 * commit de test y uno de implementacion, cual va primero. Sin alguno de los
 * dos no se dice nada — no es lo mismo «no hay test» que «el servicio no
 * clasifico el commit».
 */
function ordenDelTest(commits: CommitDeTarea[]): 'antes' | 'despues' | null {
  const test = commits.findIndex((commit) => commit.tipo === 'test')
  const impl = commits.findIndex((commit) => commit.tipo === 'impl')
  if (test < 0 || impl < 0) return null
  return test < impl ? 'antes' : 'despues'
}

export function VisorDeDiff({ diff }: { diff: DiffDeTarea }) {
  const orden = ordenDelTest(diff.commits)

  return (
    <div className="flex flex-col gap-8">
      {orden === 'antes' ? (
        <Note tipo="exito">
          El commit del test va antes que el de la implementacion: el test existio antes que el codigo.
        </Note>
      ) : orden === 'despues' ? (
        <Note tipo="advertencia" titulo="La implementacion va antes que el test">
          El orden de los commits no demuestra que el test fallara primero. Revisa el historial de la
          tarea antes de confiar en el verde.
        </Note>
      ) : null}

      {diff.commits.length === 0 && !diff.sinCommitear ? (
        <p className="text-copy-14 text-ds-gray-900">
          Esta tarea todavia no tiene commits ni cambios en su worktree.
        </p>
      ) : null}

      {diff.commits.map((commit) => {
        const tipo = TIPO_DE_COMMIT[commit.tipo] ?? TIPO_DE_COMMIT.otro
        return (
          <BloqueDeCambios
            key={commit.sha}
            titulo={tipo.etiqueta}
            tono={tipo.tono}
            sha={commit.sha}
            mensaje={commit.mensaje}
            archivos={commit.archivos}
          />
        )
      })}

      {diff.sinCommitear ? (
        <BloqueDeCambios
          titulo="Sin commitear"
          tono="advertencia"
          sha={null}
          mensaje="Lo que la tarea lleva hecho en su worktree respecto a su base."
          archivos={diff.sinCommitear.archivos}
        />
      ) : null}
    </div>
  )
}

/** El resumen +/− de todos los cambios de una tarea, para su fila. */
export function totalesDelDiff(diff: DiffDeTarea): { mas: number; menos: number; archivos: number } {
  const rutas = new Set<string>()
  let mas = 0
  let menos = 0
  for (const archivo of [...diff.commits.flatMap((commit) => commit.archivos), ...(diff.sinCommitear?.archivos ?? [])]) {
    rutas.add(archivo.ruta)
    mas += archivo.mas
    menos += archivo.menos
  }
  return { mas, menos, archivos: rutas.size }
}
