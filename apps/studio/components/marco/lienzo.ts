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
 * POR QUE LOS INVENTARIOS NO VAN CENTRADOS. Con el lienzo centrado, el titulo
 * de un inventario empieza en una x y el de la tabla de al lado en otra: al
 * navegar entre secciones el contenido salta de sitio, y es el salto lo que se
 * nota, no el ancho. Alineado a la izquierda contra la navegacion, todas las
 * pantallas de barrido empiezan en la misma columna vertical pase lo que pase
 * con su ancho maximo. Eso es lo que Geist llama alineacion.
 *
 * POR QUE LO QUE SE CREA O SE EDITA SI VA CENTRADO, Y NO ES UNA CONTRADICCION.
 * El argumento de arriba es sobre NAVEGAR: vale cuando el operador va saltando
 * de pantalla en pantalla comparando filas. Una pantalla donde se rellena un
 * formulario o se lee una constitution entera no se navega, se habita: se
 * entra, se decide, se sale. Ahi el salto no ocurre —no hay pantalla de al
 * lado con la que comparar la columna— y lo que si ocurre es el defecto
 * contrario: una columna de 672px pegada al margen izquierdo de un monitor
 * ancho deja dos tercios de pantalla vacios a la derecha y el ojo tiene que
 * volver cada linea a un margen que no esta donde mira.
 *
 * La regla, entonces, es la del operador y se declara en `ALINEACION_DE_VISTA`
 * mas abajo: CREAR Y EDITAR AL CENTRO, INVENTARIAR A LA IZQUIERDA.
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
   * El recorrido guiado. No tiene un ancho: tiene uno POR PASO.
   *
   * Un paso que ensena un diff unificado y un paso que ensena un campo de
   * texto no caben en el mismo tope, y el lienzo solo conoce la seccion. Asi
   * que aqui el lienzo se aparta —sin tope y sin centrar— y el asistente pone
   * el ancho y el centrado de cada paso con la misma tabla `ANCHO_DE_CLASE`
   * que usa todo lo demas. El ancho sigue siendo una decision de este archivo;
   * lo que cambia es quien la consulta.
   */
  | 'asistente'

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

  // Ver la cabecera de `ClaseDeVista`: el tope lo pone el paso, no la seccion.
  asistente: 'max-w-none',
}

/**
 * En que clase cae cada pantalla. `Record` completo a proposito: una seccion
 * nueva no compila hasta que alguien decida cuanto espacio pide.
 */
export const CLASE_DE_VISTA: Record<Seccion, ClaseDeVista> = {
  // Indicadores agregados en rejilla de cinco, y debajo la bandeja. Es un
  // inventario: lo de arriba se compara entre si y lo de abajo son filas.
  inicio: 'inventario',

  asistente: 'asistente',

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

export type AlineacionDeVista = 'izquierda' | 'centro'

/**
 * CREAR Y EDITAR AL CENTRO, INVENTARIAR A LA IZQUIERDA.
 *
 * `Record` completo por la misma razon que la tabla de arriba: una seccion
 * nueva no compila hasta que alguien decida de cual de las dos es. La duda
 * tipica —"¿el bootstrap es edicion?"— se resuelve con una pregunta concreta:
 * ¿la pantalla se BARRE comparando filas entre si, o se HABITA decidiendo una
 * cosa? El bootstrap es una lista de recomendaciones que se comparan; la
 * constitution es un texto que se redacta entero.
 */
export const ALINEACION_DE_VISTA: Record<Seccion, AlineacionDeVista> = {
  inicio: 'izquierda',

  // El asistente centra por paso, desde dentro. Ver `ClaseDeVista.asistente`:
  // centrar aqui ademas dejaria una columna centrada dentro de otra, y la de
  // fuera no tiene tope, asi que no haria nada visible salvo el dia que
  // alguien le ponga uno.
  asistente: 'izquierda',

  bandeja: 'izquierda',
  proyectos: 'izquierda',

  // El alta de proyecto es LA pantalla de creacion. Cuatro campos pegados al
  // margen izquierdo de un monitor ancho es el caso que el operador nombro.
  'proyecto-nuevo': 'centro',

  snapshot: 'izquierda',

  // Se redacta y se lee entera: prosa a 768px que se habita, no se barre.
  constitution: 'centro',

  bootstrap: 'izquierda',
  conexiones: 'izquierda',
  flota: 'izquierda',
  runs: 'izquierda',
  credenciales: 'izquierda',
  auditoria: 'izquierda',
  catalogo: 'izquierda',
}

export function anchoDelLienzo(seccion: Seccion): string {
  return ANCHO_DE_CLASE[CLASE_DE_VISTA[seccion]]
}

/**
 * La clase de centrado, o cadena vacia.
 *
 * Devuelve `''` y no `null` para que se pueda concatenar sin condicionales en
 * el sitio de llamada; `cn()` ignora la cadena vacia.
 */
export function alineacionDelLienzo(seccion: Seccion): string {
  return ALINEACION_DE_VISTA[seccion] === 'centro' ? 'mx-auto' : ''
}
