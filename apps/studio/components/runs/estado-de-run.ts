import type { TonoDeBadge } from '@/components/ui/insignia'

/**
 * El tono del estado de un run en la lista de Runs.
 *
 * EL CONTRATO NO ENUMERA LOS ESTADOS de un run (`estado: string`), y esta
 * lista no se los inventa: se lee la palabra y se decide el tono por lo que
 * dice, con neutro para lo que no se reconoce. El texto del badge es SIEMPRE
 * el que mando el servicio; el tono solo acelera el barrido.
 */
export function tonoDeEstadoDeRun(estado: string): TonoDeBadge {
  const texto = estado.toLowerCase()
  if (/(fall|error|bloque|blocked|failed)/.test(texto)) return 'error'
  if (/(permiso|plan_listo|plan listo|criterio|espera|approval|needs)/.test(texto)) return 'advertencia'
  if (/(pr|termin|integr|hecho|done|complet)/.test(texto)) return 'exito'
  if (/(corr|curso|running|fase|planific|test|implement|gate|revis)/.test(texto)) return 'informativo'
  return 'neutral'
}
