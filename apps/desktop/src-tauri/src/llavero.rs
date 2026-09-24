//! El llavero del sistema operativo, por el crate `keyring`.
//!
//! # Por que esto y no `tauri-plugin-stronghold`
//!
//! La investigacion (`specs/002-control-plane/research.md` §1) desmonto la via
//! que parecia obvia: **Stronghold no usa el llavero del sistema**. Guarda un
//! fichero cifrado protegido por una contrasena que la aplicacion tiene que
//! suministrar, y esa contrasena habria que guardarla en el llavero. No aporta
//! la pieza que hace falta. No hay plugin oficial de llavero para Tauri, asi que
//! la via verificada es el crate `keyring`: Keychain en macOS, Credential
//! Manager en Windows, Secret Service en Linux.
//!
//! # Por que NO hay ningun `#[tauri::command]` en este archivo
//!
//! Y es la parte que mejora el diseno, no un efecto lateral que se aguanta: los
//! comandos de la boveda no se exponen al webview. **La interfaz no puede pedir
//! un valor porque no existe la ruta para pedirlo.** No hay `#[tauri::command]`
//! que lo devuelva, luego no hay `invoke` que lo alcance, luego no hay script
//! colado en la pagina —una dependencia de npm comprometida, por ejemplo— que
//! pueda enumerar credenciales. La interfaz solo ve huellas.
//!
//! Quien habla con este codigo es el servicio, por un proceso hijo cuyo stdout
//! es un tubo privado entre los dos. Hay una prueba en `lib.rs`
//! (`ningun_comando_de_boveda_llega_al_webview`) que lee este archivo y falla si
//! aparece un `#[tauri::command]`, y que compara la lista entera de comandos
//! registrados: agregar uno obliga a tocar la prueba y a explicarse.
//!
//! # Por que el valor entra por la entrada estandar
//!
//! `ps ax -o command` muestra los argumentos de cualquier proceso a cualquier
//! proceso del mismo usuario —comprobado en esta maquina con el token de sesion
//! del servicio—. Un `llavero guardar <valor>` publica la credencial durante
//! toda la vida del proceso. Por argv van la orden y la referencia, que es
//! opaca justamente para poder viajar por ahi. `Orden::partir` rechaza cualquier
//! bandera que no conozca, `--valor` incluida: la forma insegura no se puede
//! escribir aunque alguien lo intente desde el lado de Node.

use std::io::{Read, Write};

/// Nombre del servicio con el que se guardan las entradas en el llavero.
const SERVICIO_POR_DEFECTO: &str = "noxloop";

/// Referencia de la sonda de disponibilidad. No guarda nada: se lee para ver si
/// el llavero contesta.
const SONDA: &str = "noxloop:sonda:disponibilidad";

/// Lo que se puede pedirle a este binario. Nada mas.
pub struct Orden {
    pub verbo: String,
    pub referencia: Option<String>,
    pub servicio: String,
}

impl Orden {
    /// Parte los argumentos, rechazando todo lo que no este declarado.
    ///
    /// Denegar por defecto tambien aca: una bandera desconocida es un error, no
    /// algo que se ignora. Ignorarla es como se cuela `--valor`.
    pub fn partir(args: &[String]) -> Result<Orden, String> {
        let verbo = args
            .first()
            .ok_or_else(|| {
                "falta la orden: guardar, recuperar, existe, borrar o disponible".to_string()
            })?
            .clone();
        if !["guardar", "recuperar", "existe", "borrar", "disponible"].contains(&verbo.as_str()) {
            return Err(format!(
                "orden desconocida '{verbo}': solo guardar, recuperar, existe, borrar y disponible"
            ));
        }

        let mut referencia = None;
        let mut servicio = SERVICIO_POR_DEFECTO.to_string();
        let mut i = 1;
        while i < args.len() {
            match args[i].as_str() {
                "--ref" => {
                    referencia = Some(
                        args.get(i + 1)
                            .ok_or_else(|| "--ref sin valor".to_string())?
                            .clone(),
                    );
                    i += 2;
                }
                "--servicio" => {
                    servicio = args
                        .get(i + 1)
                        .ok_or_else(|| "--servicio sin valor".to_string())?
                        .clone();
                    i += 2;
                }
                otra => {
                    return Err(format!(
                        "bandera desconocida '{otra}'. El valor de una credencial NUNCA va por la \
                         linea de comandos: entra por la entrada estandar"
                    ))
                }
            }
        }

        if verbo != "disponible" && referencia.is_none() {
            return Err(format!("la orden '{verbo}' necesita --ref"));
        }
        Ok(Orden {
            verbo,
            referencia,
            servicio,
        })
    }
}

/// Ejecuta la orden contra el llavero del sistema.
///
/// Devuelve lo que hay que escribir en stdout. El unico caso en que eso es un
/// secreto es `recuperar`, y ese tubo va directo al servicio que lo pidio.
pub fn correr(orden: &Orden, entrada: &mut dyn Read) -> Result<String, String> {
    let referencia = orden
        .referencia
        .clone()
        .unwrap_or_else(|| SONDA.to_string());
    let entrada_del_llavero = keyring::Entry::new(&orden.servicio, &referencia)
        .map_err(|e| format!("no se pudo abrir el llavero del sistema: {e}"))?;

    match orden.verbo.as_str() {
        "guardar" => {
            let mut valor = String::new();
            entrada
                .read_to_string(&mut valor)
                .map_err(|e| format!("no se pudo leer el valor de la entrada estandar: {e}"))?;
            if valor.is_empty() {
                return Err("no llego ningun valor por la entrada estandar".to_string());
            }
            entrada_del_llavero
                .set_password(&valor)
                .map_err(|e| format!("el llavero rechazo guardar {referencia}: {e}"))?;
            Ok(String::new())
        }
        "recuperar" => entrada_del_llavero
            .get_password()
            .map_err(|e| format!("el llavero no devolvio {referencia}: {e}")),
        "existe" => {
            let existe = match entrada_del_llavero.get_password() {
                Ok(_) => true,
                Err(keyring::Error::NoEntry) => false,
                Err(e) => {
                    return Err(format!(
                        "el llavero no pudo responder por {referencia}: {e}"
                    ))
                }
            };
            Ok(format!("{{\"existe\":{existe}}}"))
        }
        "borrar" => match entrada_del_llavero.delete_credential() {
            // Borrar lo que ya no esta es el estado que se pedia, no un fallo:
            // si fallara, un reintento tras un corte dejaria la tarea atascada.
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(String::new()),
            Err(e) => Err(format!("el llavero rechazo borrar {referencia}: {e}")),
        },
        // La sonda: `NoEntry` es la MEJOR respuesta posible. Significa que el
        // llavero contesto y que no hay nada guardado con ese nombre. Un fallo
        // de plataforma (no hay Secret Service, el llavero esta bloqueado) es lo
        // que manda al respaldo cifrado, y con su causa, para que la seleccion
        // no sea silenciosa.
        "disponible" => match entrada_del_llavero.get_password() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok("{\"disponible\":true}".to_string()),
            Err(e) => Ok(format!(
                "{{\"disponible\":false,\"causa\":{:?}}}",
                e.to_string()
            )),
        },
        otro => Err(format!("orden desconocida '{otro}'")),
    }
}

/// Punto de entrada del binario. Devuelve el codigo de salida.
///
/// El diagnostico va por stderr y el resultado por stdout, separados a
/// proposito: quien invoca lee stdout esperando un valor, y un mensaje de error
/// mezclado ahi se convierte en la credencial que el subproceso recibe.
pub fn correr_cli() -> i32 {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let orden = match Orden::partir(&args) {
        Ok(o) => o,
        Err(causa) => {
            eprintln!("{causa}");
            return 2;
        }
    };
    match correr(&orden, &mut std::io::stdin()) {
        Ok(salida) => {
            let _ = std::io::stdout().write_all(salida.as_bytes());
            0
        }
        Err(causa) => {
            eprintln!("{causa}");
            1
        }
    }
}
