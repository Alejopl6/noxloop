//! El comando del llavero que ejecuta el servicio.
//!
//! Es un binario aparte y no un comando de Tauri a proposito: quien necesita el
//! valor es el servicio, que corre en Node, y lo que NO puede existir es una
//! ruta desde el webview hasta un secreto. La logica —y el porque entero— estan
//! en `llavero.rs`.

fn main() {
    std::process::exit(noxloop_desktop_lib::llavero::correr_cli());
}
