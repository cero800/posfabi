// Empaquetado del backend en un único ejecutable de Windows (Node SEA).
//
// Tauri lanza el backend como "sidecar", y para eso exige un binario en
//   src-tauri/binaries/<nombre>-<tripleta-de-objetivo>[.exe]
// En Windows x64 la tripleta es `x86_64-pc-windows-msvc`.
//
// Hay dos formas de generar ese binario según la versión de Node:
//
//   Node >= 25.5   `node --build-sea sea-config.json`
//                  La generación del blob es un flag nativo de Node.
//
//   Node 24.x      `node --experimental-sea-config sea-config.json` genera un
//                  JSON con el blob, y hay que inyectarlo en una copia de
//                  node.exe con `postject`.
//
// El script detecta la versión y hace lo que corresponda, así que no hay que
// cambiar nada al actualizar Node.
//
// Uso:  node scripts/build-sea.mjs

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO_DIR = path.join(RAIZ, 'bin');
const BLOB = path.join(RAIZ, 'sea-prep.blob');
const CONFIG = path.join(RAIZ, 'sea-config.json');

const NOMBRE_APP = 'tienda-db';
// Tauri exige el sufijo con la tripleta del objetivo; en Windows, además, `.exe`.
const TRIPLETA = 'x86_64-pc-windows-msvc';
const SALIDA = path.join(DESTINO_DIR, `${NOMBRE_APP}-${TRIPLETA}.exe`);
// Dónde lo espera Tauri.
const DESTINO_TAURI = path.join(
  RAIZ,
  '..',
  'desktop',
  'src-tauri',
  'binaries',
  `${NOMBRE_APP}-${TRIPLETA}.exe`,
);

function log(msg) {
  process.stdout.write(`[build:sea] ${msg}\n`);
}

function ejecutar(cmd, args, opciones = {}) {
  log(`$ ${cmd} ${args.join(' ')}`);
  return execFileSync(cmd, args, { stdio: 'inherit', ...opciones });
}

function versionNode() {
  const [mayor, menor] = process.versions.node.split('.').map(Number);
  return { mayor: mayor ?? 0, menor: menor ?? 0 };
}

// node.exe en el mismo directorio que el binario de Node con el que se ejecuta.
const NODE_EXE = process.execPath;

async function main() {
  if (process.platform !== 'win32') {
    throw new Error(
      'El empaquetado está pensado para compilar en Windows, que es el destino de la app. ' +
        'Para probar el backend en otro sistema, ejecútalo con `npm start`.',
    );
  }

  fs.mkdirSync(DESTINO_DIR, { recursive: true });
  fs.rmSync(SALIDA, { force: true });
  fs.rmSync(BLOB, { force: true });

  log('1/4 compilando TypeScript');
  ejecutar("npm", ["run", "build"]);

  log('2/4 generando el blob SEA');
  const { mayor, menor } = versionNode();
  const nativo = mayor > 25 || (mayor === 25 && menor >= 5);

  if (nativo) {
    fs.writeFileSync(
      CONFIG,
      JSON.stringify(
        { main: 'build/main.cjs', output: SALIDA, disableExperimentalSEAWarning: true },
        null,
        2,
      ),
    );
    ejecutar('node', ['--build-sea', CONFIG]);
  } else {
    fs.writeFileSync(
      CONFIG,
      JSON.stringify({ main: 'build/main.cjs', output: BLOB, disableExperimentalSEAWarning: true }, null, 2),
    );
    ejecutar('node', ['--experimental-sea-config', CONFIG]);

    log('   inyectando el blob en node.exe (postject)');
    fs.copyFileSync(NODE_EXE, SALIDA);
    ejecutar('npx', [
      '--yes',
      'postject@1.0.0-alpha.6',
      SALIDA,
      'NODE_SEA_BLOB',
      BLOB,
      '--sentinel-fuse',
      'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
      '--overwrite',
    ]);
  }

  if (!fs.existsSync(SALIDA)) {
    throw new Error(`No se generó el ejecutable esperado en ${SALIDA}`);
  }

  log('3/4 copiando al directorio de Tauri');
  fs.mkdirSync(path.dirname(DESTINO_TAURI), { recursive: true });
  fs.copyFileSync(SALIDA, DESTINO_TAURI);

  const mb = (fs.statSync(SALIDA).size / 1024 / 1024).toFixed(1);
  log(`4/4 listo: ${SALIDA} (${mb} MB)`);
  log(`     copiado a ${DESTINO_TAURI}`);
  log('     ejecuta `pnpm --filter @tienda/desktop tauri build` para generar el instalador');
}

main().catch((e) => {
  process.stderr.write(`[build:sea] ERROR: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
