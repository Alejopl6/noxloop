import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * `Markdown` — una vista previa de markdown SIN `dangerouslySetInnerHTML`.
 *
 * POR QUE NO UNA LIBRERIA. La vista previa del plan de una tarea necesita lo
 * que un plan usa —encabezados, listas, codigo, enfasis— y nada mas. Un
 * renderizador completo es una dependencia mas en un bundle que se exporta
 * estatico, y casi todos producen HTML en texto que hay que inyectar: con un
 * plan pegado desde cualquier sitio, eso es una puerta para `<script>`. Aqui
 * cada bloque se convierte en un elemento de React, y React escapa el texto.
 *
 * LO QUE NO HACE, dicho para que nadie lo busque: tablas, enlaces con
 * formato, imagenes, HTML crudo. Se pintan como texto, que es lo honesto: la
 * vista previa ensena que va a leer el motor, y el motor lee el markdown tal
 * cual.
 */

function enLinea(texto: string, clave: string): ReactNode[] {
  // `code`, **negrita**, *cursiva* — en ese orden, porque dentro del codigo
  // los asteriscos son literales.
  const partes: ReactNode[] = []
  const patron = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g
  let ultimo = 0
  let coincidencia: RegExpExecArray | null
  let indice = 0
  while ((coincidencia = patron.exec(texto)) !== null) {
    if (coincidencia.index > ultimo) partes.push(texto.slice(ultimo, coincidencia.index))
    const trozo = coincidencia[0]
    const k = `${clave}-${indice++}`
    if (trozo.startsWith('`')) {
      partes.push(
        <code key={k} className="fuente-operativa rounded-[4px] bg-ds-gray-100 px-1 text-[0.92em]">
          {trozo.slice(1, -1)}
        </code>,
      )
    } else if (trozo.startsWith('**')) {
      partes.push(<strong key={k} className="font-semibold text-ds-gray-1000">{trozo.slice(2, -2)}</strong>)
    } else {
      partes.push(<em key={k}>{trozo.slice(1, -1)}</em>)
    }
    ultimo = coincidencia.index + trozo.length
  }
  if (ultimo < texto.length) partes.push(texto.slice(ultimo))
  return partes
}

export function Markdown({ texto, className }: { texto: string; className?: string }) {
  const lineas = texto.replace(/\r\n/g, '\n').split('\n')
  const bloques: ReactNode[] = []
  let i = 0
  let clave = 0

  while (i < lineas.length) {
    const linea = lineas[i]

    if (linea.trim() === '') {
      i += 1
      continue
    }

    if (linea.trimStart().startsWith('```')) {
      const codigo: string[] = []
      i += 1
      while (i < lineas.length && !lineas[i].trimStart().startsWith('```')) {
        codigo.push(lineas[i])
        i += 1
      }
      i += 1
      bloques.push(
        <pre
          key={clave++}
          className="fuente-operativa overflow-x-auto rounded-md bg-ds-gray-100 px-3 py-2 text-label-12 text-ds-gray-1000"
        >
          {codigo.join('\n')}
        </pre>,
      )
      continue
    }

    const encabezado = /^(#{1,3})\s+(.*)$/.exec(linea)
    if (encabezado) {
      const nivel = encabezado[1].length
      const Etiqueta = nivel === 1 ? 'h4' : nivel === 2 ? 'h5' : 'h6'
      bloques.push(
        <Etiqueta
          key={clave}
          className={nivel === 1 ? 'text-heading-16 text-ds-gray-1000' : 'text-heading-14 text-ds-gray-1000'}
        >
          {enLinea(encabezado[2], String(clave++))}
        </Etiqueta>,
      )
      i += 1
      continue
    }

    const esLista = (texto: string) => /^\s*([-*+]|\d+[.)])\s+/.test(texto)
    if (esLista(linea)) {
      const ordenada = /^\s*\d+[.)]\s+/.test(linea)
      const items: string[] = []
      while (i < lineas.length && esLista(lineas[i])) {
        items.push(lineas[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ''))
        i += 1
      }
      const Lista = ordenada ? 'ol' : 'ul'
      const k = clave++
      bloques.push(
        <Lista key={k} className={cn('flex flex-col gap-1 pl-5', ordenada ? 'list-decimal' : 'list-disc')}>
          {items.map((item, n) => (
            <li key={n}>{enLinea(item.replace(/^\[( |x)\]\s+/i, ''), `${k}-${n}`)}</li>
          ))}
        </Lista>,
      )
      continue
    }

    const parrafo: string[] = []
    while (
      i < lineas.length &&
      lineas[i].trim() !== '' &&
      !lineas[i].trimStart().startsWith('```') &&
      !/^#{1,3}\s/.test(lineas[i]) &&
      !esLista(lineas[i])
    ) {
      parrafo.push(lineas[i])
      i += 1
    }
    const k = clave++
    bloques.push(<p key={k}>{enLinea(parrafo.join(' '), String(k))}</p>)
  }

  return <div className={cn('flex flex-col gap-3 text-copy-14 text-ds-gray-900', className)}>{bloques}</div>
}
