/**
 * El guion largo que Geist usa para "no se sabe".
 *
 * Existe como componente y no como la cadena `'—'` suelta por una razon de
 * accesibilidad concreta: un guion largo lo anuncian distinto cada lector de
 * pantalla —unos dicen "raya", otros no dicen nada— y una celda muda es
 * indistinguible de una celda que no se cargo. El guion queda para la vista y
 * la palabra queda para el oido.
 *
 * Y la distincion que hay que respetar al usarlo: `—` es DESCONOCIDO, no cero
 * y no vacio. Una credencial sin fecha de caducidad no caduca —eso se escribe
 * "No caduca"— y un contador en cero es `0`. Poner `—` en esos sitios borra
 * informacion que el sistema si tenia.
 */
export function Desconocido({ razon = 'Desconocido' }: { razon?: string }) {
  return (
    <>
      <span aria-hidden="true" className="text-ds-gray-700">
        —
      </span>
      <span className="sr-only">{razon}</span>
    </>
  )
}
