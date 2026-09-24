'use client'

import { useEffect, useState } from 'react'

import { editoresDisponibles, ponerBadgeDelDock, type EditorDisponible } from '@/lib/escritorio'

/**
 * Los editores que la cascara detecto. `[]` en web, mientras se pregunta, y si
 * no hay ninguno: en los tres casos el boton «Abrir en el editor» no se pinta.
 * Se pregunta una vez por montaje; instalar un editor con la app abierta se ve
 * al volver a abrir el diff.
 */
export function useEditores(): EditorDisponible[] {
  const [editores, setEditores] = useState<EditorDisponible[]>([])
  useEffect(() => {
    let vivo = true
    editoresDisponibles().then(
      (lista) => {
        if (vivo) setEditores(lista)
      },
      () => {},
    )
    return () => {
      vivo = false
    }
  }, [])
  return editores
}

/**
 * Sincroniza el numero del Dock con `resumen.teNecesitan` del board (FR-008).
 *
 * `null` = el board todavia no se leyo o fallo: se deja el numero que habia en
 * vez de quitarlo, porque un Dock que se vacia cada vez que el servicio tarda
 * diria «nada te espera» sin saberlo. En web no hace nada.
 */
export function useBadgeDelDock(teNecesitan: number | null | undefined): void {
  useEffect(() => {
    if (teNecesitan === null || teNecesitan === undefined) return
    void ponerBadgeDelDock(teNecesitan)
  }, [teNecesitan])
}
