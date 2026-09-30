// Shell de la app. Aquí no hay lógica de negocio: es una ventana de Tauri y el
// arranque del backend.
//
// Todo el POS —la base, las ventas, la caja, la impresión, los respaldos— vive
// en `packages/db`: un proceso aparte escrito en TypeScript, empaquetado con Node
// SEA y lanzado como *sidecar* (`externalBin` en `tauri.conf.json`). Tauri lo
// levanta con `tauri-plugin-shell` y le habla JSON-RPC por stdio. Lo que este
// archivo hace es poco, y a propósito: todo lo que se pueda mover al backend
// se mueve, porque código en Rust no se prueba con `vitest`.
//
// ## El acoplamiento
//
// Este es el único punto donde Rust y el backend se tocan. `rutas_app` resuelve
// las carpetas con `app.path()` de Tauri y el frontend se las pasa al sidecar por
// variables de entorno al lanzarlo. Sin eso el backend tendría que adivinarlas, y
// adivinar la carpeta Documentos falla justo en el caso que importa: cuando el
// usuario la movió, que en una tienda es lo más normal del mundo.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::Manager;

/// Las carpetas que el backend necesita, ya resueltas por Tauri.
#[derive(Serialize, Debug, PartialEq, Eq)]
struct Rutas {
    /// Base de datos y bitácora. En Windows, `%APPDATA%\com.tienda.pos`.
    data_dir: String,
    /// Facturas, reportes y respaldos. En Windows, la carpeta Documentos.
    document_dir: String,
}

/// Resuelve las carpetas de la app para que el backend pueda abrirlas.
///
/// `document_dir()` falla si el usuario movió Documentos, si la cuenta está
/// provisionada de un modo que no la expone, o si la carpeta no existe. En
/// cualquiera de esos casos se usa la carpeta de datos: queda todo junto, que
/// es peor que repartido pero mejor que arrancar sin base.
#[tauri::command]
fn rutas_app(app: tauri::AppHandle) -> Result<Rutas, String> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo resolver la carpeta de datos de la app: {e}"))?;

    Ok(componer_rutas(data, app.path().document_dir().ok()))
}

/// La regla de qué carpeta va dónde, sin Tauri, para poder probarla.
///
/// Es la única decisión que toma este crate sobre el sistema de archivos, y es
/// una decisión con consecuencia: donde diga `data_dir` va la base, y equivocarse
/// ahí significa que el POS abra una base vacía y parezca que se perdieron las
/// ventas.
fn componer_rutas(data_dir: PathBuf, document_dir: Option<PathBuf>) -> Rutas {
    let document_dir = document_dir.unwrap_or_else(|| data_dir.clone());
    Rutas {
        data_dir: perder(&data_dir),
        document_dir: perder(&document_dir),
    }
}

/// `Path` a `String` por la única vía que no puede fallar en Windows.
///
/// `to_string_lossy` sustituye lo que no es UTF-8, que en una ruta de Windows solo
/// puede pasar con una carpeta escrita en una página de códigos antigua. Perder
/// un carácter es feo; no devolver la ruta deja al backend sin base.
fn perder(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Registra el mensaje de cualquier `panic` del lado Rust en un archivo de texto.
///
/// El release no tiene consola —`main.rs` pone `windows_subsystem = "windows"`—,
/// así que un crash se queda sin ningún rastro en pantalla. Este archivo es lo
/// único que queda. Vive en la carpeta temporal y no en los datos de la app a
/// propósito: si el disco de datos está lleno o corrupto, que es justo cuando
/// más hace falta, el temporal sigue escribiéndose.
fn setup_panic_log() {
    let ruta = std::env::temp_dir().join("tienda-panic.log");
    std::panic::set_hook(Box::new(move |info| {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let linea = format!("=== {ts} ===\n{info}\n");
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&ruta)
        {
            let _ = writeln!(f, "{linea}");
        }
    }));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    setup_panic_log();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![rutas_app])
        .run(tauri::generate_context!())
        .expect("error al ejecutar la app Tauri");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Se prueban las funciones puras y no un Tauri entero: lo único que este
    /// crate decide sobre el disco son dos rutas, y eso sí se puede comprobar.
    #[test]
    fn el_backend_recibe_las_dos_carpetas() {
        let r = componer_rutas(PathBuf::from("/datos"), Some(PathBuf::from("/docs")));
        assert_eq!(r.data_dir, "/datos");
        assert_eq!(r.document_dir, "/docs");
    }

    #[test]
    fn sin_documentos_cae_en_las_datos() {
        // Una cuenta de Windows sin carpeta Documentos, o con la movida, no
        // puede dejar al backend sin sitio donde escribir facturas y respaldos.
        let r = componer_rutas(PathBuf::from("/datos"), None);
        assert_eq!(r.document_dir, "/datos");
    }

    /// La forma de los campos es parte del contrato con el frontend, que los lee
    /// tal cual y los pasa al sidecar como variables de entorno.
    #[test]
    fn los_campos_son_los_que_espera_el_frontend() {
        let json = serde_json::to_string(&componer_rutas(
            PathBuf::from("/d"),
            Some(PathBuf::from("/o")),
        ))
        .expect("serializa");
        assert!(json.contains("\"data_dir\""), "{json}");
        assert!(json.contains("\"document_dir\""), "{json}");
    }
}
