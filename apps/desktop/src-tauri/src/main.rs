// En Windows, un binario compilado con el subsistema de consola abre una
// ventana negra detras de la aplicacion cada vez que se arranca. El atributo la
// evita, y se aplica solo en release para no perder la salida de `println!`
// durante el desarrollo.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    noxloop_desktop_lib::run();
}
