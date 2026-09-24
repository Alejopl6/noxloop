/**
 * Lo que solo existe en la aplicacion de escritorio: abrir un archivo en el
 * editor (FR-007) y el numero del Dock (FR-008).
 *
 * LA INTERFAZ NO EJECUTA NADA (principio VIII). Aqui solo se PIDE a la cascara
 * de Tauri por `invoke`; es la cascara la que valida la ruta —solo abre
 * archivos de los worktrees de noxloop— y lanza el editor sin shell
 * (`apps/desktop/src-tauri/src/editor.rs`). En web todo esto no hace nada: no
 * hay cascara a la que pedirle.
 *
 * Como `lib/daemon.ts`, nada de aqui toca `window` al importarse, y
 * `@tauri-apps/api` se carga con `import()` dentro de cada funcion: en el
 * prerender de `next build` no hay ventana.
 */

export interface EditorDisponible {
  id: string
  nombre: string
}

/** ¿Estamos dentro de la cascara de Tauri? `false` en el prerender y en web. */
export async function esEscritorio(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  const { isTauri } = await import('@tauri-apps/api/core')
  return isTauri()
}

/** Los editores instalados que la cascara sabe abrir. `[]` en web o si falla. */
export async function editoresDisponibles(): Promise<EditorDisponible[]> {
  if (!(await esEscritorio())) return []
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    return await invoke<EditorDisponible[]>('editores_disponibles')
  } catch {
    return []
  }
}

/**
 * Pide abrir `ruta` (absoluta) en `linea`. Lanza con la causa que da la
 * cascara —p. ej. «el archivo ya no existe: el worktree pudo limpiarse»— para
 * que quien llame la ensene.
 */
export async function abrirEnEditor(ruta: string, linea: number | null, editor?: string): Promise<void> {
  if (!(await esEscritorio())) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('abrir_en_editor', { ruta, linea: linea ?? null, editor: editor ?? null })
}

/** Pone el numero del Dock; 0 lo quita. En web, nada. Nunca lanza. */
export async function ponerBadgeDelDock(teNecesitan: number): Promise<void> {
  if (!(await esEscritorio())) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('poner_badge_del_dock', { teNecesitan: numeroDelBadge(teNecesitan) })
  } catch {
    // El badge es un aviso: si la plataforma no lo tiene, no hay nada que pintar.
  }
}

/* --- Logica pura, probada en `test/escritorio.test.mjs` ------------------ */

/** Entero no negativo: lo que venga raro del servicio no pinta un «-1» o un «NaN». */
export function numeroDelBadge(valor: unknown): number {
  return typeof valor === 'number' && Number.isFinite(valor) && valor > 0 ? Math.floor(valor) : 0
}

/**
 * La ruta absoluta de un archivo del diff dentro del worktree de su tarea, o
 * `null` si no se puede armar (sin worktree, o una ruta que intenta salirse).
 * La cascara vuelve a validarlo contra el disco; esto solo evita pedir lo que
 * seguro va a rechazar.
 */
export function rutaEnElWorktree(worktree: string | null | undefined, ruta: string): string | null {
  if (!worktree || !worktree.startsWith('/') || !ruta) return null
  if (ruta.startsWith('/') || ruta.split('/').includes('..')) return null
  return `${worktree.replace(/\/+$/, '')}/${ruta}`
}

/**
 * La linea donde abrir un archivo entero: la primera linea anadida, o si no la
 * primera del lado nuevo del primer hunk. `null` si el parche no dice ninguna.
 */
export function primeraLineaDelParche(parche: string): number | null {
  let despues: number | null = null
  let primeraDelHunk: number | null = null
  for (const linea of parche.replace(/\r\n/g, '\n').split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(linea)
    if (hunk) {
      despues = Number(hunk[1])
      if (primeraDelHunk === null) primeraDelHunk = despues
      continue
    }
    if (despues === null) continue
    if (linea.startsWith('+')) return despues
    if (linea.startsWith(' ')) despues += 1
  }
  return primeraDelHunk && primeraDelHunk > 0 ? primeraDelHunk : null
}
