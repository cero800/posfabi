fn main() {
    placeholder_del_sidecar();
    tauri_build::build();
}

/// Deja el archivo que Tauri espera para `externalBin` si el ejecutable real no
/// está.
///
/// `tauri_build::build()` resuelve `bundle.externalBin` contra la tripleta del
/// objetivo y aborta la compilación si el archivo no existe. En la PC de la
/// tienda, `pnpm --filter @tienda/db build:sea` ya lo dejó y esto no hace nada.
///
/// En Linux —donde corren `cargo check`, `cargo test` y el desarrollo— el
/// sufijo sería `x86_64-unknown-linux-gnu` y el backend empaquetado es un `.exe`
/// de Windows, así que el archivo no va a existir nunca. Un archivo de texto es
/// lo que hace falta para que la resolución pase, y que Tauri no lo intente
/// ejecutar: el shell no arranca el sidecar hasta que el frontend lo pide, y en
/// Linux esa llamada no se llega a hacer.
fn placeholder_del_sidecar() {
    use std::path::PathBuf;

    // Solo tiene sentido en un objetivo que no sea Windows. Ahí el placeholder
    // es un archivo de texto; en Windows sería un `.exe` inválido que Tauri sí
    // intentaría arrancar.
    //
    // El caso real de esta función es `cargo clippy` y `cargo fmt`, que no
    // llegan a compilar el crate pero sí ejecutan el build script. Sin esto,
    // revisar el shell en Linux falla siempre.
    if cfg!(target_os = "windows") {
        return;
    }

    let Ok(dir) = std::env::var("CARGO_MANIFEST_DIR") else {
        return;
    };

    // `TARGET` la pone Cargo para todo build script y es la misma cadena que
    // Tauri usa para el sufijo. `TAURI_ENV_TARGET_TRIPLE` no sirve aquí: la
    // define `tauri_build::build()`, que todavía no ha corrido.
    let Ok(tripleta) = std::env::var("TARGET") else {
        return;
    };

    let mut ruta: PathBuf = PathBuf::from(dir);
    ruta.push("binaries");
    ruta.push(format!("tienda-db-{tripleta}"));

    if ruta.exists() {
        return;
    }

    if std::fs::create_dir_all(ruta.parent().expect("la ruta tiene padre")).is_err() {
        return;
    }
    let _ = std::fs::write(
        &ruta,
        b"placeholder: el backend real se genera con `pnpm --filter @tienda/db build:sea` en Windows\n",
    );
}
