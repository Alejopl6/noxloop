/**
 * Comparacion de texto para filtros y busquedas.
 *
 * Sin acentos y sin mayusculas EN LOS DOS SENTIDOS: escribir "auditoria"
 * encuentra "auditoria", y escribir "Auditoria" tambien. El fallo que esto
 * evita es el filtro que no encuentra lo que el operador esta viendo en
 * pantalla, que es la forma mas rapida de que deje de usarse.
 *
 * `\p{Diacritic}` con la bandera `u` en vez de un rango de codigos: cubre los
 * diacriticos de cualquier alfabeto y no solo los del latin-1. Es la misma
 * funcion que usa el menu de comandos.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/** `true` si `aguja` aparece en `pajar`, comparando ya normalizado. */
export function contiene(pajar: string, aguja: string): boolean {
  const buscada = normalizar(aguja.trim())
  if (!buscada) return true
  return normalizar(pajar).includes(buscada)
}
