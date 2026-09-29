import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  IDENTIFICADOR_APP,
  NOMBRE_BASE_DATOS,
  carpetaDocumentos,
  carpetaDocumentosSub,
  dataDirPorDefecto,
  documentDirPorDefecto,
  rutasDesdeEnv,
} from './paths.js';

describe('rutasDesdeEnv', () => {
  it('usa las variables que le pasa el shell de Tauri', () => {
    const rutas = rutasDesdeEnv({
      TIENDA_DATA_DIR: 'C:\\Users\\Ana\\AppData\\Roaming\\com.tienda.pos',
      TIENDA_DOC_DIR: 'C:\\Users\\Ana\\Documents',
    });
    expect(rutas.dataDir).toBe('C:\\Users\\Ana\\AppData\\Roaming\\com.tienda.pos');
    expect(rutas.documentDir).toBe('C:\\Users\\Ana\\Documents');
  });

  it('deriva la ruta de la base a partir de la carpeta de datos', () => {
    const rutas = rutasDesdeEnv({ TIENDA_DATA_DIR: '/datos' });
    expect(path.basename(rutas.dbPath)).toBe(NOMBRE_BASE_DATOS);
    expect(rutas.dbPath.startsWith('/datos')).toBe(true);
  });

  it('cae en los valores por defecto de Windows cuando no hay variables', () => {
    const rutas = rutasDesdeEnv({ APPDATA: 'C:\\Users\\Ana\\AppData\\Roaming', USERPROFILE: 'C:\\Users\\Ana' });
    expect(rutas.dataDir).toBe(path.join('C:\\Users\\Ana\\AppData\\Roaming', IDENTIFICADOR_APP));
    // Se compara con path.join y no con una cadena literal porque el separador
    // depende de la plataforma. En Windows será `Documents`; estas pruebas
    // también corren en la máquina de desarrollo, que no es Windows.
    expect(rutas.documentDir).toBe(path.join('C:\\Users\\Ana', 'Documents'));
  });

  it('usa la carpeta temporal del sistema', () => {
    expect(rutasDesdeEnv({ TEMP: 'C:\\Tmp' }).tempDir).toBe('C:\\Tmp');
    expect(rutasDesdeEnv({ TMP: 'C:\\Tmp2' }).tempDir).toBe('C:\\Tmp2');
  });

  it('mira junto al ejecutable los scripts auxiliares', () => {
    expect(rutasDesdeEnv({ TIENDA_SCRIPTS_DIR: 'C:\\App\\resources' }).scriptsDir).toBe(
      'C:\\App\\resources',
    );
    // Sin la variable, se supone que están al lado del binario.
    expect(rutasDesdeEnv({}).scriptsDir).toBe(path.dirname(process.execPath));
  });
});

describe('valores por defecto sin variables de Windows', () => {
  it('cae en el home del usuario en vez de fallar', () => {
    // En Linux/macOS no hay APPDATA ni USERPROFILE; aun así debe resolver algo.
    expect(dataDirPorDefecto({})).toContain(IDENTIFICADOR_APP);
    expect(documentDirPorDefecto({})).toBe(path.join(os.homedir(), 'Documents'));
  });
});

describe('carpetas de documentos', () => {
  it('crea Documentos/tienda y sus subcarpetas', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tienda-doc-'));
    const rutas = rutasDesdeEnv({ TIENDA_DOC_DIR: dir });

    const base = carpetaDocumentos(rutas);
    expect(base).toBe(path.join(dir, 'tienda'));
    expect(fs.existsSync(base)).toBe(true);

    const facturas = carpetaDocumentosSub('facturas', rutas);
    expect(facturas).toBe(path.join(base, 'facturas'));
    expect(fs.existsSync(facturas)).toBe(true);

    // Idempotente: llamarla dos veces no falla.
    expect(carpetaDocumentosSub('facturas', rutas)).toBe(facturas);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
