import { Aplicacion } from '@/components/aplicacion'

/**
 * T011 · Catch-all opcional.
 *
 * `output: 'export'` no admite rutas dinamicas sin parametros conocidos en
 * build, y los identificadores de esta aplicacion (proyecto, snapshot, entrada
 * de bandeja) los inventa el servicio en runtime: en build no existen y no hay
 * forma de enumerarlos.
 *
 * Asi que se genera UNA sola pagina —`out/index.html`— y el enrutado ocurre en
 * el cliente (`lib/ruta.ts`, que explica por que va sobre el query string).
 */
export function generateStaticParams() {
  return [{ slug: [] }]
}

export default function Pagina() {
  return <Aplicacion />
}
