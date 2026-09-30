// Punto de entrada. Lo único que hay aquí es la llamada a `run()`.
//
// `windows_subsystem = "windows"` en release esconde la consola. Es lo que
// quiere el usuario —una app de mostrador no debe abrir una ventana negra— y
// por eso el shell tiene su propio registro de `panic` en
// `%TEMP%\tienda-panic.log`; ver `lib.rs`.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tienda_desktop_lib::run()
}
