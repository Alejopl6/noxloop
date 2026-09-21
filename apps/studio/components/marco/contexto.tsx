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
