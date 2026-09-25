import type { ModoTdd } from '@/lib/tipos'

/**
 * COMO SE FUERZA EL TEST-PRIMERO DE UN AGENTE, dicho para la pantalla de flota
 * (spec 005, FR-008 (b)).
 *
 * El servicio manda `tdd` por agente y la pantalla no lo pintaba: el operador
 * elegia un implementador sin hooks sin saber que el principio I lo sostiene el
 * motor DESPUES de la fase —revirtiendo lo escrito fuera de alcance— y no un
 * hook que lo bloquea ANTES. Las dos cosas dejan el historial limpio; no son la
 * misma garantia, y la frase lo dice en vez de igualarlas.
 *
 * Sin JSX a proposito: se prueba con `node --test` (`test/tdd-de-la-flota.test.mjs`).
 */
export interface ExplicacionDelTdd {
  etiqueta: string
  frase: string
  tono: 'exito' | 'informativo' | 'neutral' | 'advertencia'
}

export function explicarTdd(tdd: ModoTdd | null | undefined): ExplicacionDelTdd {
  switch (tdd) {
    case 'por_hook':
      return {
        etiqueta: 'TDD por hook',
        frase:
          'El runtime corre el hook del paso RED dentro de su sesion: una escritura de produccion antes del test en rojo se bloquea antes de ocurrir.',
        tono: 'exito',
      }
    case 'por_motor':
      return {
        etiqueta: 'TDD por el motor',
        frase:
          'El runtime no tiene hooks: el motor mira el worktree despues de cada fase y revierte lo escrito fuera de su alcance, contando el intento. El historial queda igual de limpio; lo que no hay es el bloqueo en caliente.',
        tono: 'informativo',
      }
    case 'no_aplica':
      return {
        etiqueta: 'TDD no aplica',
        frase: 'Este rol no escribe produccion: revisa, planifica o verifica.',
        tono: 'neutral',
      }
    case null:
      return {
        etiqueta: 'TDD sin sostener',
        frase:
          'Nadie sostiene el test-primero de este agente: implementa sin hooks y el motor no le aplica la guarda posterior. El servicio no deberia haberlo guardado.',
        tono: 'advertencia',
      }
    default:
      return {
        etiqueta: 'TDD sin dato',
        frase:
          'No se sabe como se fuerza su TDD: el servicio no tiene registrado el runtime de este agente, asi que no puede leer sus capacidades.',
        tono: 'advertencia',
      }
  }
}
