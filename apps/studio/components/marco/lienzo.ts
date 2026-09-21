import type { Seccion } from '@/lib/ruta'

/**
 * EL ANCHO DEL LIENZO, DECLARADO AQUI Y NO EN CADA PANTALLA.
 *
 * El estado anterior era un `max-w-5xl` unico para las trece vistas. 1024px es
 * ancho de articulo: para un formulario de alta sobra, y para la tabla de
 * auditoria —seis columnas, una de ellas un identificador en Mono— falta
 * tanto que la tabla se pasa la vida con barra horizontal. Dicho de otro modo,
 * el ancho unico esta mal para casi todas: es el promedio de necesidades que
 * no se parecen.
 *
 * POR QUE POR CLASE Y NO POR PANTALLA. Trece anchos son trece decisiones que
 * nadie vuelve a revisar y que divergen sin que se note: dos inventarios con
 * 1152 y 1100 se ven igual de bien por separado y descuadran al navegar de uno
 * al otro. Cinco clases son cinco decisiones que se pueden defender, y el
 * mapa de abajo obliga a colocar cada pantalla nueva en una de ellas.
 *
 * POR QUE NO VA CENTRADO (no hay `mx-auto` en ninguna parte). Con el lienzo
 * centrado, el titulo de un formulario empieza en una x y el de la tabla de al
 * lado en otra: al navegar entre secciones el contenido salta de sitio, y es
 * el salto lo que se nota, no el ancho. Alineado a la izquierda contra la
 * navegacion, TODAS las pantallas empiezan en la misma columna vertical pase
 * lo que pase con su ancho maximo. Eso es lo que Geist llama alineacion, y es
 * lo unico que hace que trece pantallas se lean como un producto.
 */
export type ClaseDeVista =
  /** Una columna de campos que se rellenan de arriba abajo. */
  | 'formulario'
  /** Prosa destinada a leerse entera. */
  | 'lectura'
  /** Un objeto con su evidencia: rutas, extractos, diffs, clave/valor. */
  | 'detalle'
  /** Filas que se comparan entre si. */
  | 'inventario'
  /** Columnas. */
  | 'tabla'

/**
 * Las clases literales, sin interpolar, para que Tailwind las encuentre al
 * escanear las fuentes. Una clase construida con plantilla no se compila y el
 * ancho desaparece sin ningun error.
 */
export const ANCHO_DE_CLASE: Record<ClaseDeVista, string> = {
  // 672px. El limite no es estetico: un campo de texto mas ancho que esto
  // obliga a barrer con la vista desde la etiqueta hasta el final del campo
  // para comprobar que se escribio, y el ojo pierde la linea al bajar al
  // siguiente. Los formularios de esta consola son de una columna.
  formulario: 'max-w-2xl',

  // 768px. A 14px de cuerpo son unos 85 caracteres por linea: el limite alto
  // de lo legible. La constitution y las guidelines son markdown que se lee
  // entero, y a 1024px cada linea son 115 caracteres — al volver al margen
  // izquierdo se pierde el renglon.
  lectura: 'max-w-3xl',

  // 1024px. Aqui conviven prosa corta y monoespaciado ancho (rutas con linea,
  // extractos de archivo, diffs unificados). Estrecharlo parte los diffs en
  // barra horizontal permanente; ensancharlo estira la prosa que va al lado.
  detalle: 'max-w-5xl',

  // 1152px. Una fila de `Entity` lleva titulo, identificador, descripcion,
  // metadatos y el control a la derecha. Con menos ancho, la descripcion se
  // parte en tres lineas y las filas dejan de compararse de un vistazo; con
  // mucho mas, el control queda tan lejos del titulo que deja de leerse como
  // perteneciente a esa fila.
  inventario: 'max-w-6xl',

  // Sin tope. Una tabla es el unico contenido cuya utilidad crece con cada
  // pixel: cada columna que cabe es una columna que no hay que ir a buscar
  // desplazandose. Poner aqui un tope es garantizar la barra horizontal en
  // pantallas que no la necesitaban.
  tabla: 'max-w-none',
}

/**
 * En que clase cae cada pantalla. `Record` completo a proposito: una seccion
 * nueva no compila hasta que alguien decida cuanto espacio pide.
 */
export const CLASE_DE_VISTA: Record<Seccion, ClaseDeVista> = {
  // Indicadores agregados en rejilla de cinco, y debajo la bandeja. Es un
  // inventario: lo de arriba se compara entre si y lo de abajo son filas.
  inicio: 'inventario',

  // La causa de una entrada llega COMPLETA por FR-062 y puede ser un parrafo
  // largo de un agente. Es prosa, y va al ancho de la prosa aunque la lista de
  // entradas quepa mas ancha: lo que se lee entero manda sobre lo que se barre.
  bandeja: 'lectura',

  proyectos: 'inventario',
  'proyecto-nuevo': 'formulario',

  // Hallazgos agrupados, cada uno con su evidencia: ruta, linea y extracto.
  snapshot: 'detalle',

  // Markdown completo mas las guidelines por area.
  constitution: 'lectura',

  // Diffs exactos (FR-026) y el arbol de archivos que cambian.
  bootstrap: 'detalle',

  conexiones: 'inventario',
  flota: 'inventario',

  // Tabla de tareas del ciclo: estado, intentos por lazo, rama, ultimo fallo.
  runs: 'tabla',

  credenciales: 'inventario',

  // Seis columnas y la cadena de hashes. Es la pantalla que peor sufria el
  // ancho unico.
  auditoria: 'tabla',

  // No es superficie de producto; se le da el ancho del inventario porque lo
  // que hace es enfilar componentes para compararlos.
  catalogo: 'inventario',
}

export function anchoDelLienzo(seccion: Seccion): string {
  return ANCHO_DE_CLASE[CLASE_DE_VISTA[seccion]]
}
