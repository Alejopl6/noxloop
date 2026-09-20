//! La cascara de escritorio de noxloop.
//!
//! Hace tres cosas y ninguna mas: levanta el servicio de control como proceso
//! hijo, le entrega a la interfaz la URL y el token con los que hablarle, y se
//! asegura de que ese proceso no sobreviva a la ventana.
//!
//! # Por que la CSP dice lo que dice (`tauri.conf.json`, `app.security.csp`)
//!
//! JSON no admite comentarios y la CSP es una sola linea sin sitio donde
//! explicarse, asi que la justificacion de cada fuente vive aca. Cada entrada
//! esta por un fallo concreto, no por prolijidad:
//!
//! - `default-src 'self'` — todo lo que no se nombre abajo queda prohibido. Sin
//!   esta linea de base, una fuente omitida se permite en silencio.
//! - `connect-src 'self' http://127.0.0.1:* http://localhost:*` — el servicio
//!   escucha en un puerto efimero (`--port 0`) precisamente para que dos
//!   instalaciones no colisionen; el numero no se conoce hasta que el proceso
//!   imprime `NOXLOOP_READY`, y por eso el comodin. Sin esto la CSP corta el
//!   `fetch` y el SSE al daemon, y la interfaz arranca vacia sin decir por que.
//! - `connect-src ... ipc: http://ipc.localhost` — es el transporte de `invoke`.
//!   Sin esas dos fuentes, `daemon_info` no se puede llamar desde el webview y
//!   la interfaz nunca conoce el token.
//! - `script-src 'self'` — sin `'unsafe-inline'` ni `'unsafe-eval'`. El export
//!   estatico de Next no necesita ninguno de los dos en runtime.
//! - `style-src 'self' 'unsafe-inline'` — Next inyecta estilos criticos en un
//!   `<style>` inline durante la hidratacion; sin `'unsafe-inline'` la primera
//!   pintura sale sin estilos. No hay hash estable que sustituirlo por: el
//!   hashing de CSP de Tauri sobre los inline de Next 16 esta declarado como no
//!   verificado en `research.md` §1, y esto se revisa cuando se compruebe.
//! - `img-src 'self' data: blob:` — iconos y avatares embebidos; `blob:` para lo
//!   que se genere en cliente.
//! - `font-src 'self' data:` — `next/font` auto-hospeda las tipografias en el
//!   build. Ninguna fuente sale a la red en runtime, y por eso no hay ningun
//!   host de terceros en esta directiva.
//! - `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`,
//!   `frame-ancestors 'none'` — cierran las vias clasicas de secuestro de una
//!   pagina local: un `<object>` cargado desde disco, un `<base>` que reescribe
//!   cada ruta relativa, y un formulario que exfiltra a un tercero.
//!
//! # Por que las capacidades no conceden `shell`
//!
//! El sidecar se lanza desde Rust (mas abajo, en `setup`). La ACL de Tauri solo
//! filtra las invocaciones que vienen del webview: lo que Rust ejecuta no pasa
//! por ella. Conceder `shell:allow-execute` o `shell:allow-spawn` por si acaso
//! le daria al webview la capacidad de lanzar procesos sin que ninguna linea de
//! la aplicacion la necesite. Esta declarado tambien en
//! `capabilities/default.json`.

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Prefijo que el servicio imprime en stdout cuando ya esta escuchando. El
/// contrato esta en `specs/002-control-plane/contracts/control-api.md`.
const MARCA_LISTO: &str = "NOXLOOP_READY ";

/// Nombre del `externalBin`. El archivo en disco lleva ademas el sufijo del
/// target triple (`noxloop-service-aarch64-apple-darwin`); Tauri lo resuelve.
const SIDECAR: &str = "noxloop-service";

/// Ruta del punto de entrada del servicio dentro de los recursos empaquetados.
const ENTRADA_SERVICIO: &str = "servicio/bin/noxloop-service.mjs";

/// Lo que la interfaz necesita para hablarle al servicio, y nada mas.
///
/// El token no se escribe en ningun archivo que el webview pueda leer ni viaja
/// en la URL de la ventana: se entrega por `invoke`, una vez, a traves de
/// [`daemon_info`].
struct Daemon {
    /// Generado en Rust al arrancar. El servicio lo recibe por `--token` y lo
    /// exige en cada peticion.
    ///
    /// Sin token, cualquier pagina abierta en el navegador del operador puede
    /// hacer peticiones a `127.0.0.1` y enumerar sus proyectos y sus
    /// credenciales. Que el servicio escuche solo en loopback no lo impide: el
    /// navegador del propio operador tambien es loopback.
    token: String,
    /// `None` hasta que el servicio imprime `NOXLOOP_READY`. El puerto es
    /// efimero, asi que no hay forma de saberla antes.
    url: Mutex<Option<String>>,
    /// Se guarda para poder matarlo a mano en `RunEvent::Exit`. Ver
    /// [`cerrar_el_daemon`].
    hijo: Mutex<Option<CommandChild>>,
}

/// Devuelve `(url, token)` cuando el servicio ya respondio, `None` mientras
/// arranca.
///
/// Devolver `None` en vez de bloquear es deliberado: si el servicio tarda o no
/// levanta, la interfaz tiene que poder pintar la pantalla de "el servicio no
/// esta corriendo" con su causa y su accion (FR-005). Una llamada que se cuelga
/// produce exactamente la pantalla en blanco que FR-005 prohibe.
///
/// Este comando se define con `generate_handler!`, no viene de un plugin, asi
/// que no lo filtra la ACL. Es aceptable porque solo expone el par
/// `(url, token)` del servicio local. Ningun comando de boveda o de secretos
/// puede definirse asi: cuando llegue la fase D, va por una ruta que el webview
/// no pueda invocar.
#[tauri::command]
fn daemon_info(estado: tauri::State<'_, Daemon>) -> Option<(String, String)> {
    let url = estado.url.lock().ok()?.clone()?;
    Some((url, estado.token.clone()))
}

/// Token de sesion: 32 bytes del CSPRNG del sistema, en hexadecimal.
///
/// Se usa `getrandom`, que lee del generador del sistema operativo, y no un PRNG
/// sembrado con el reloj: un token predecible a partir del instante de arranque
/// no es un token.
fn token_de_sesion() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("el CSPRNG del sistema no respondio");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Saca la URL de una linea de stdout del servicio, si es la marca de listo.
///
/// Esta separada del bucle de eventos para poder probarla: el bucle necesita una
/// aplicacion Tauri viva y una sesion grafica, y la logica que de verdad puede
/// equivocarse —quedarse con un `\r` de mas y producir una URL a la que nadie
/// contesta, o aceptar una linea que solo *contiene* la marca— es esta.
fn url_de_la_marca(linea: &str) -> Option<String> {
    let resto = linea.trim().strip_prefix(MARCA_LISTO)?;
    let url = resto.trim();
    if url.is_empty() {
        return None;
    }
    Some(url.to_string())
}

/// Resuelve el `.mjs` del servicio, que no esta en el mismo sitio empaquetado
/// que en desarrollo.
///
/// En el bundle vive bajo el directorio de recursos del `.app`. Bajo `tauri dev`
/// el directorio de recursos es `target/debug`, y ahi `tauri-build` **si** copia
/// lo declarado en `bundle.resources` — verificado en esta maquina: tras un
/// `cargo check`, `target/debug/servicio/` contiene `bin/` y `src/`.
///
/// El segundo intento existe igual, y no es redundante: esa copia solo ocurre
/// cuando `build.rs` vuelve a correr. Un `packages/service` que cambio despues
/// de la ultima compilacion deja en `target/debug` una version vieja o, la
/// primera vez, ninguna. Sin la busqueda en el arbol, el sintoma es un "no such
/// file" que apunta a `target/debug` y no menciona el paquete del repositorio,
/// que es donde hay que mirar.
fn ruta_del_servicio(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(empaquetada) = app
        .path()
        .resolve(ENTRADA_SERVICIO, BaseDirectory::Resource)
    {
        if empaquetada.exists() {
            return Ok(empaquetada);
        }
    }

    // `CARGO_MANIFEST_DIR` es `apps/desktop/src-tauri`; tres niveles arriba esta
    // la raiz del repositorio. Solo puede acertar cuando el binario corre desde
    // el arbol de fuentes, que es justo el caso de `tauri dev`.
    let en_el_arbol = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../packages/service/bin/noxloop-service.mjs");
    if en_el_arbol.exists() {
        return Ok(en_el_arbol);
    }

    Err(format!(
        "No se encontro el punto de entrada del servicio. Se busco en los recursos \
         empaquetados ({ENTRADA_SERVICIO}) y en el arbol del repositorio \
         ({}). Comproba que `packages/service` esta construido antes de arrancar.",
        en_el_arbol.display()
    ))
}

/// Lanza el servicio y engancha su salida.
///
/// El sidecar que se empaqueta es el ejecutable de Node, no el servicio: el
/// servicio es codigo `.mjs` que viaja como recurso. Por eso el primer argumento
/// es la ruta del script. La decision y su motivo estan en `research.md` §1
/// (Node SEA no soporta macOS x64; `vercel/pkg` esta archivado).
fn arrancar_el_daemon(app: &AppHandle, token: &str) -> Result<CommandChild, String> {
    let script = ruta_del_servicio(app)?;

    let (mut eventos, hijo) = app
        .shell()
        .sidecar(SIDECAR)
        .map_err(|e| format!("No se pudo resolver el sidecar '{SIDECAR}': {e}"))?
        .args([
            script.to_string_lossy().to_string(),
            // Puerto efimero: el sistema elige uno libre y el servicio lo anuncia
            // en stdout. Un puerto fijo convierte "ya hay otra instancia" o
            // "otro programa lo ocupo" en un arranque fallido sin alternativa.
            "--port".to_string(),
            "0".to_string(),
            // El token va por `--token` porque asi lo fija el contrato del
            // servicio (`contracts/control-api.md`) y `research.md` §1.
            //
            // Con un coste que conviene tener escrito: un argumento aparece en
            // `ps` para cualquier proceso del mismo usuario. Comprobado en esta
            // maquina — `ps ax -o command` muestra la linea entera con el token.
            // Contra el fallo que este token evita (una pestana del navegador
            // del operador alcanzando 127.0.0.1) sirve igual: una pagina web no
            // puede leer la tabla de procesos. Contra otro programa que ya corre
            // como el operador, no sirve.
            //
            // Esto choca con T143 de la fase D ("ningun valor aparece en `argv`
            // del proceso lanzado"), que habla de credenciales de boveda. Cuando
            // esa tarea llegue hay que decidir si el token de sesion entra en la
            // misma regla; cambiarlo aca por su cuenta romperia el contrato con
            // el servicio.
            "--token".to_string(),
            token.to_string(),
            // Segunda capa del cierre. Ver `cerrar_el_daemon`.
            "--parent-pid".to_string(),
            std::process::id().to_string(),
        ])
        .spawn()
        .map_err(|e| format!("No se pudo lanzar el servicio: {e}"))?;

    // `--home` no se pasa a proposito: el servicio resuelve `NOXLOOP_HOME` por su
    // cuenta y esa resolucion tiene que ser la misma la lance quien la lance
    // (esta cascara, el CLI o un test). Fijarla desde aca haria que la aplicacion
    // y el CLI vieran almacenes distintos sin que nadie lo hubiera pedido.

    let manejador = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(evento) = eventos.recv().await {
            match evento {
                CommandEvent::Stdout(linea) => {
                    let texto = String::from_utf8_lossy(&linea).trim_end().to_string();
                    if texto.is_empty() {
                        continue;
                    }
                    println!("[servicio] {texto}");

                    if let Some(url) = url_de_la_marca(&texto) {
                        if let Some(estado) = manejador.try_state::<Daemon>() {
                            if let Ok(mut guarda) = estado.url.lock() {
                                *guarda = Some(url.clone());
                            }
                        }
                        // La interfaz escucha este evento en vez de sondear
                        // `daemon_info`: el arranque del servicio no tiene una
                        // duracion conocida, y un sondeo con intervalo fijo o
                        // pinta la pantalla de error antes de tiempo o hace
                        // esperar de mas cuando ya estaba listo.
                        let _ = manejador.emit("daemon://ready", url);
                    }
                }
                // El stderr del servicio se reenvia entero y con prefijo. Sin
                // esto, un servicio que muere al arrancar lo hace en silencio: el
                // proceso hijo no tiene consola propia y su diagnostico se pierde.
                CommandEvent::Stderr(linea) => {
                    let texto = String::from_utf8_lossy(&linea);
                    let texto = texto.trim_end();
                    if !texto.is_empty() {
                        eprintln!("[servicio:err] {texto}");
                    }
                }
                CommandEvent::Terminated(salida) => {
                    eprintln!(
                        "[servicio] termino (codigo: {:?}, senal: {:?})",
                        salida.code, salida.signal
                    );
                    if let Some(estado) = manejador.try_state::<Daemon>() {
                        if let Ok(mut guarda) = estado.url.lock() {
                            *guarda = None;
                        }
                        if let Ok(mut guarda) = estado.hijo.lock() {
                            // El proceso ya no existe: soltar el `CommandChild`
                            // evita que `RunEvent::Exit` intente matar un PID que
                            // el sistema pudo haber reasignado.
                            guarda.take();
                        }
                    }
                    let _ = manejador.emit(
                        "daemon://terminated",
                        serde_json::json!({
                            "codigo": salida.code,
                            "senal": salida.signal,
                        }),
                    );
                }
                CommandEvent::Error(causa) => {
                    eprintln!("[servicio:err] fallo del canal con el proceso: {causa}");
                }
                _ => {}
            }
        }
    });

    Ok(hijo)
}

/// Mata al servicio al cerrar la aplicacion.
///
/// # Por que `RunEvent::Exit` y no `RunEvent::ExitRequested`
///
/// En macOS el cierre normal (Cmd+Q, el menu, el boton rojo con la ultima
/// ventana) pasa de `MainEventsCleared` directo a `Exit` **sin emitir nunca**
/// `ExitRequested`. Un cierre colgado de `ExitRequested` no corre en el caso mas
/// comun y deja el daemon huerfano escuchando en su puerto.
///
/// **Fuente no verificada**: este comportamiento sale de discusiones en el
/// repositorio de Tauri, no de su documentacion oficial. Se declara como tal
/// porque la correccion depende de el.
///
/// # Por que ademas hace falta el watchdog del servicio
///
/// Son dos capas y las dos son necesarias:
///
/// 1. Esta: matar el `CommandChild` en `RunEvent::Exit`. El plugin shell ya mata
///    a sus hijos ahi —verificado en su codigo fuente— pero solo al hijo
///    directo; cualquier nieto que el servicio haya lanzado no entra.
/// 2. El watchdog del propio servicio: recibe `--parent-pid` y comprueba con
///    `process.kill(pid, 0)` cada dos segundos si su padre sigue vivo.
///
/// La segunda existe porque la primera no siempre corre. `RunEvent::Exit` es
/// codigo de la aplicacion: si Tauri muere por SIGKILL, por un panico del
/// proceso o porque el sistema lo mata por memoria, nadie lo ejecuta. El
/// servicio quedaria escuchando en su puerto, con el token de la sesion
/// anterior, hasta el siguiente reinicio de la maquina.
///
/// Y la primera existe porque la segunda tarda: hasta dos segundos de ventana en
/// los que un arranque inmediato de la aplicacion encontraria dos servicios
/// vivos sobre el mismo `home`.
fn cerrar_el_daemon(app: &AppHandle) {
    let Some(estado) = app.try_state::<Daemon>() else {
        return;
    };
    let Ok(mut guarda) = estado.hijo.lock() else {
        return;
    };
    if let Some(hijo) = guarda.take() {
        if let Err(e) = hijo.kill() {
            eprintln!("[servicio] no se pudo matar el proceso al cerrar: {e}");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let aplicacion = tauri::Builder::default()
        // `shell` esta aca por el sidecar, que se lanza desde Rust. No se le
        // concede ningun permiso al webview; ver el comentario del modulo.
        .plugin(tauri_plugin_shell::init())
        // `dialog` es el selector de carpeta del alta de proyecto (fase B). Se
        // registra ahora para que la superficie quede cerrada de una vez.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        // `opener` abre el enlace de autorizacion en el navegador del sistema y
        // no en el webview (fase D): varios proveedores de OAuth rechazan por
        // politica los webviews embebidos, y el flujo falla al final, no al
        // empezar.
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![daemon_info])
        .setup(|app| {
            let token = token_de_sesion();
            let manejador = app.handle().clone();

            app.manage(Daemon {
                token: token.clone(),
                url: Mutex::new(None),
                hijo: Mutex::new(None),
            });

            match arrancar_el_daemon(&manejador, &token) {
                Ok(hijo) => {
                    if let Ok(mut guarda) = app.state::<Daemon>().hijo.lock() {
                        *guarda = Some(hijo);
                    }
                }
                // Un fallo al lanzar el servicio no aborta el arranque a
                // proposito. Si lo abortara, el operador veria la aplicacion
                // cerrarse sin explicacion; asi la ventana abre y la interfaz
                // pinta la causa y la accion (FR-005), que es lo que se puede
                // leer.
                Err(causa) => {
                    eprintln!("[servicio:err] {causa}");
                    let _ = manejador.emit(
                        "daemon://terminated",
                        serde_json::json!({ "codigo": null, "senal": null, "causa": causa }),
                    );
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("no se pudo construir la aplicacion");

    aplicacion.run(|app, evento| {
        if let RunEvent::Exit = evento {
            cerrar_el_daemon(app);
        }
    });
}

#[cfg(test)]
mod pruebas {
    use super::*;

    // La comprobacion que T035 pide de verdad —cerrar la aplicacion y que no
    // quede ningun proceso del servicio— no se puede escribir aca: necesita una
    // sesion grafica, el bundle armado y el servicio de `packages/service`
    // construido, que en esta fase todavia no existe. Se declara pendiente en
    // vez de sustituirse por una prueba que parezca cubrirla y no la cubra. Lo
    // que si se prueba es la logica que puede equivocarse sin que se note.

    #[test]
    fn la_marca_de_listo_entrega_la_url_limpia() {
        assert_eq!(
            url_de_la_marca("NOXLOOP_READY http://127.0.0.1:52341"),
            Some("http://127.0.0.1:52341".to_string())
        );
    }

    #[test]
    fn un_retorno_de_carro_no_se_cuela_en_la_url() {
        // El fallo concreto: una URL con `\r` al final produce peticiones a un
        // host que no existe, y el error que sale no menciona el caracter
        // invisible que lo causo.
        assert_eq!(
            url_de_la_marca("NOXLOOP_READY http://127.0.0.1:52341\r\n"),
            Some("http://127.0.0.1:52341".to_string())
        );
    }

    #[test]
    fn una_linea_que_solo_menciona_la_marca_no_cuenta() {
        // El servicio escribe diagnostico por stdout. Una linea que hable de la
        // marca sin serla no puede fijar la URL del daemon.
        assert_eq!(
            url_de_la_marca("esperando para imprimir NOXLOOP_READY http://127.0.0.1:1"),
            None
        );
        assert_eq!(url_de_la_marca("NOXLOOP_READY"), None);
        assert_eq!(url_de_la_marca("NOXLOOP_READY   "), None);
    }

    #[test]
    fn el_token_es_de_256_bits_y_no_se_repite() {
        let a = token_de_sesion();
        let b = token_de_sesion();
        assert_eq!(a.len(), 64, "32 bytes en hexadecimal son 64 caracteres");
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        // Dos arranques seguidos con el mismo token significarian que el token no
        // viene del CSPRNG del sistema. La probabilidad de colision real es nula.
        assert_ne!(a, b);
    }
}
