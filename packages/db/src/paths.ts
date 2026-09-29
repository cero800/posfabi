// Rutas del sistema de archivos.
//
// El backend corre como proceso hijo del webview, así que no puede usar
// `app.path()` de Tauri. Quien las resuelve es el shell de Rust (o el propio
// webview con `@tauri-apps/api/path`) y se las entrega por variables de
// entorno al arrancar el proceso. Este módulo solo las lee y les pone nombre.
//
// Los valores por defecto son los de Windows y permiten que el backend arranque
// sin Tauri, en modo `--http`, para desarrollo y pruebas.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Identificador de la app; define la carpeta de datos en Windows. */
export const IDENTIFICADOR_APP = 'com.tienda.pos';

export const NOMBRE_BASE_DATOS = 'tienda.db';

export interface Rutas {
  /** Carpeta de datos de la app: base de datos, registro de errores. */
  dataDir: string;
  /** Carpeta del usuario donde se guardan facturas, reportes y respaldos. */
  documentDir: string;
  /** Carpeta temporal del sistema, para las escrituras intermedias. */
  tempDir: string;
  /** Ruta completa de la base SQLite. */
  dbPath: string;
  /** Carpeta de `imprimir.ps1` y demás recursos auxiliares. */
  scriptsDir: string;
}

/** `%APPDATA%\com.tienda.pos` — el mismo lugar donde Tauri guarda los datos. */
export function dataDirPorDefecto(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(base, IDENTIFICADOR_APP);
}

export function documentDirPorDefecto(env: NodeJS.ProcessEnv = process.env): string {
  const userProfile = env.USERPROFILE ?? os.homedir();
  return path.join(userProfile, 'Documents');
}

/**
 * Resuelve las rutas desde el entorno. Las variables que define el shell son
 * `TIENDA_DATA_DIR` y `TIENDA_DOC_DIR`; `TIENDA_SCRIPTS_DIR` apunta a los
 * recursos empaquetados junto al ejecutable.
 */
export function rutasDesdeEnv(env: NodeJS.ProcessEnv = process.env): Rutas {
  const dataDir = env.TIENDA_DATA_DIR || dataDirPorDefecto(env);
  const documentDir = env.TIENDA_DOC_DIR || documentDirPorDefecto(env);

  return {
    dataDir,
    documentDir,
    tempDir: env.TEMP || env.TMP || os.tmpdir(),
    dbPath: path.join(dataDir, NOMBRE_BASE_DATOS),
    // Junto al ejecutable: en un build empaquetado es el directorio de Tauri.
    scriptsDir: env.TIENDA_SCRIPTS_DIR || path.dirname(process.execPath),
  };
}

/** Las rutas de la app en ejecución. */
export const RUTAS: Rutas = rutasDesdeEnv();

/** Crea la carpeta de datos si no existe. Idempotente. */
export function asegurarDataDir(rutas: Rutas = RUTAS): string {
  fs.mkdirSync(rutas.dataDir, { recursive: true });
  return rutas.dataDir;
}

/** `Documentos\tienda\`, donde van facturas, reportes y respaldos. */
export function carpetaDocumentos(rutas: Rutas = RUTAS): string {
  const dir = path.join(rutas.documentDir, 'tienda');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** `Documentos\tienda\<subcarpeta>`, creada si no existe. */
export function carpetaDocumentosSub(sub: string, rutas: Rutas = RUTAS): string {
  const dir = path.join(carpetaDocumentos(rutas), sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
