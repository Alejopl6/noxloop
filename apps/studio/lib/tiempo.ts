/**
 * Formato de instantes, segun la regla de Geist: relativo hasta 7 dias,
 * absoluto a partir de ahi. "hace 3 minutos" es util; "hace 94 dias" no le
 * dice nada a nadie y obliga a hacer la cuenta.
 */

const MINUTO = 60_000
const HORA = 60 * MINUTO
const DIA = 24 * HORA

export function formatearRelativo(instante: number, ahora: number = Date.now()): string {
  const transcurrido = Math.max(0, ahora - instante)

  if (transcurrido < 5_000) return 'hace un momento'
  if (transcurrido < MINUTO) return `hace ${Math.floor(transcurrido / 1_000)} s`
  if (transcurrido < HORA) {
    const minutos = Math.floor(transcurrido / MINUTO)
    return `hace ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`
  }
  if (transcurrido < DIA) {
    const horas = Math.floor(transcurrido / HORA)
    return `hace ${horas} ${horas === 1 ? 'hora' : 'horas'}`
  }
  if (transcurrido < 7 * DIA) {
    const dias = Math.floor(transcurrido / DIA)
    return `hace ${dias} ${dias === 1 ? 'dia' : 'dias'}`
  }

  return new Date(instante).toLocaleString('es', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
