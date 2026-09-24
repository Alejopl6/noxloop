'use client'

import { createContext, useContext, type ReactNode } from 'react'

/**
 * Lo unico que el contenido necesita saber del marco: si el marco ya esta
 * pintando las migas.
 *
 * EL FALLO CONCRETO QUE EVITA. `Encabezado` (en `components/pantalla.tsx`)
 * pinta un boton "← Proyectos" porque hasta ahora era la unica forma de volver:
 * la cabecera de cinco pestanas no tenia nivel de proyecto. Con las migas en el
 * marco, nueve pantallas quedan con DOS vueltas atras, una encima de la otra,
 * apuntando al mismo destino — y quien navega con teclado tabula por las dos
 * antes de llegar al contenido. Este contexto deja que `Encabezado` se calle su
 * boton cuando el marco ya dijo donde esta, sin tocar las nueve vistas.
 *
 * Es un booleano y no el arbol de migas a proposito: el contenido no decide
 * donde esta, solo deja de repetirlo.
 */
const ContextoDeMarco = createContext(false)

export function ProveedorDeMarco({ children }: { children: ReactNode }) {
  return <ContextoDeMarco.Provider value={true}>{children}</ContextoDeMarco.Provider>
}

/**
 * `true` cuando el contenido se esta pintando dentro del marco de la consola.
 *
 * `false` por defecto —sin proveedor— para que una pantalla montada fuera del
 * marco (el catalogo de componentes, una prueba) siga teniendo su vuelta atras
 * en vez de quedarse sin ninguna.
 */
export function useHayMigas(): boolean {
  return useContext(ContextoDeMarco)
}

/**
 * Si el contenido se esta pintando DENTRO del recorrido guiado.
 *
 * EL FALLO CONCRETO, encontrado leyendo el HTML generado. El asistente pinta
 * el titulo del paso en un `<h1>` —es el titulo de la pagina— y despues monta
 * la vista de la etapa, que pinta el suyo con `Encabezado`, tambien en `<h1>`.
 * Resultado: dos `<h1>` en la misma pagina, uno debajo del otro, con dos
 * tamanos distintos y sin jerarquia entre ellos. Para un lector de pantalla
 * que navega por encabezados son dos titulos de pagina en una pagina; para el
 * ojo es un encabezado repetido.
 *
 * Con esto, `Encabezado` baja a `<h2>` dentro del asistente: el titulo de la
 * pagina es el paso, y el de la vista es la seccion de dentro. No hubo que
 * tocar ninguna de las seis vistas, que es la misma razon por la que existe
 * `useHayMigas` justo arriba.
 */
const ContextoDeAsistente = createContext(false)

export function ProveedorDeAsistente({ children }: { children: ReactNode }) {
  return <ContextoDeAsistente.Provider value={true}>{children}</ContextoDeAsistente.Provider>
}

export function useDentroDelAsistente(): boolean {
  return useContext(ContextoDeAsistente)
}

/**
 * Si el contenido se esta pintando DENTRO DE SETTINGS, como una pestana.
 *
 * El mismo fallo que el del asistente, un nivel mas abajo: Settings pinta su
 * `<h1>` —«Settings» o el nombre del proyecto— y la vista reutilizada de la
 * 002 pinta el suyo con `Encabezado`. Con esto baja a `<h2>` sin tocar las
 * vistas, que siguen siendo las mismas pantallas de siempre.
 */
const ContextoDeAjustes = createContext(false)

export function ProveedorDeAjustes({ children }: { children: ReactNode }) {
  return <ContextoDeAjustes.Provider value={true}>{children}</ContextoDeAjustes.Provider>
}

export function useDentroDeAjustes(): boolean {
  return useContext(ContextoDeAjustes)
}
