import type { NextConfig } from 'next'

const esProduccion = process.env.NODE_ENV === 'production'

// El CLI de Tauri inyecta TAURI_DEV_HOST cuando se desarrolla contra un
// dispositivo que no es esta maquina (movil, otra IP de la LAN). En ese caso el
// webview no puede pedir los assets a `localhost`, porque su localhost es otro.
const hostDeDesarrollo = process.env.TAURI_DEV_HOST || 'localhost'

// 3100 y no 3000, que es el puerto por defecto de Next.
//
// EL FALLO QUE ESTO EVITA, y ya ocurrio en esta maquina: 3000 es el puerto mas
// disputado del ecosistema. Aqui lo tenia tomado Docker de forma permanente, y
// `tauri dev` moria con EADDRINUSE antes de abrir la ventana — un fallo que se
// lee como "Tauri no arranca" y no como "el puerto estaba ocupado".
//
// Va por variable de entorno porque el puerto es configuracion, no codigo
// (constitution, principio VII): quien lo tenga ocupado lo cambia sin tocar
// esto. El valor tiene que coincidir con `devUrl` de tauri.conf.json.
const puertoDeDesarrollo = process.env.NOXLOOP_PUERTO_DEV || '3100'

const config: NextConfig = {
  // Export estatico. No es una limitacion que sufrimos: es la propiedad que
  // queriamos (research.md §1). Sin servidor no hay Server Actions, ni rutas de
  // API, ni middleware, ni `cookies()`/`headers()` — es decir, no hay ninguna
  // via por la que esta interfaz pueda convertirse en un segundo escritor
  // (constitution, principio VIII; FR-002).
  output: 'export',

  // Next 16 genera `AGENTS.md` y `CLAUDE.md` en cada arranque de `dev`.
  //
  // EL FALLO QUE ESTO EVITA, y es especifico de ESTE producto: el scanner de
  // noxloop detecta `AGENTS.md` como instrucciones de agente del proyecto. Con
  // esto encendido, noxloop escaneandose a si mismo encuentra un archivo que
  // escribio su propio servidor de desarrollo y lo reporta como contexto que
  // alguien redacto. Es exactamente el hallazgo inventado que prohibe el
  // principio X, fabricado por una herramienta en vez de por un modelo.
  agentRules: false,

  // Sin servidor no hay optimizador de imagenes.
  images: { unoptimized: true },

  // Sin esto, `/ajustes` no resuelve bajo el esquema `tauri://`: el webview
  // busca un archivo llamado `ajustes` y no el `ajustes/index.html` que el
  // export produce.
  trailingSlash: true,

  // TRAMPA NUMERO UNO (research.md §1). `assetPrefix` apuntando a
  // `http://localhost:3000` en el build de PRODUCCION deja la app de escritorio
  // EN BLANCO: el bundle empaquetado pide sus chunks a un servidor de
  // desarrollo que no esta corriendo, falla en silencio y no pinta nada.
  // El ternario es lo unico que separa "funciona" de "pantalla negra".
  assetPrefix: esProduccion ? undefined : `http://${hostDeDesarrollo}:${puertoDeDesarrollo}`,
}

export default config
