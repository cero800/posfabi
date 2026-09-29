// Punto de entrada del backend.
//
// Corre como proceso hijo del webview de Tauri. En esta fase solo arranca la
// base y reporta el estado: sirve para verificar que la ruta de empaquetado
// (Node SEA → externalBin de Tauri) funciona antes de escribir los 48
// procedures. El transporte JSON-RPC sobre stdio entra en la fase 6.

import { abrir } from './db.js';
import { necesitaConfiguracion, sembrarTodo } from './seed.js';
import { RUTAS, asegurarDataDir } from './paths.js';
import { versionEsquema } from './db.js';
import { SCHEMA_VERSION } from './schema.js';

function arrancar(): void {
  asegurarDataDir();
  const db = abrir(RUTAS.dbPath);
  sembrarTodo(db);

  const esquema = versionEsquema(db);
  if (esquema !== SCHEMA_VERSION) {
    throw new Error(`La base está en v${esquema} y se esperaba v${SCHEMA_VERSION}`);
  }

  const configuracionPendiente = necesitaConfiguracion(db);
  db.close();

  process.stdout.write(
    JSON.stringify({
      ok: true,
      dbPath: RUTAS.dbPath,
      esquema,
      configuracionPendiente,
    }) + '\n',
  );
}

try {
  arrancar();
} catch (e) {
  process.stderr.write(
    JSON.stringify({
      ok: false,
      error: { codigo: 'sistema', mensaje: e instanceof Error ? e.message : String(e) },
    }) + '\n',
  );
  process.exitCode = 1;
}
