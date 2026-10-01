// Empaquetado del backend en un único ejecutable (Node SEA).
//
// Tauri lanza el backend como "sidecar", y para eso exige un binario en
//   src-tauri/binaries/<nombre>-<tripleta-de-objetivo>[.exe]
// En Windows x64 la tripleta es `x86_64-pc-windows-msvc`; en Linux x64 es
// `x86_64-unknown-linux-gnu`.
//
// El resultado es un `node` con el bundle inyectado dentro, así que pesa como
// Node (unos 120 MB) y lleva su propio runtime. Es lo que permite que el `.exe`
// del POS no dependa de que haya un Node instalado en la PC de la tienda.
//
// ## Para qué sirve más de una plataforma
//
// El destino es Windows, y el `.exe` de la tienda solo se puede generar ahí. Pero
// el script construye el binario *de la máquina en la que corre*, y eso permite
// dos cosas que en Windows no se pueden hacer:
//
//   - `tauri dev` en Linux, que es la única forma de probar el camino real
//     (el mismo `shell.sidecar` y el mismo JSON-RPC por stdio que usará el
//     `.exe`) sin estar en la PC de la tienda.
//   - Dejar el binario de Windows intacto mientras se develops en otro sistema:
//     cada plataforma escribe en `bin/` y en `src-tauri/binaries/` con su propio
//     nombre, así que no se pisan.
//
// ## Cómo se hace
//
// Hay dos formas según la versión de Node:
//
//   Node >= 25.5   `node --build-sea sea-config.json`
//                  La generación del blob es un flag nativo de Node.
//
//   Node 24.x      `node --experimental-sea-config sea-config.json` genera el
//                  blob, y hay que inyectarlo en una copia del ejecutable de Node
//                  con `postject`.
//
// El script detecta la versión y hace lo que corresponda, así que no hay que
// cambiar nada al actualizar Node.
//
// ## Antes de ejecutarlo
//
// En Windows hacen falta Node 24 o superior, Rust con MSVC Build Tools (los
// necesita Tauri, no este script) y Visual Studio Build Tools. `postject` se
// baja con `npx` la primera vez, así que la primera corrida necesita internet.
//
// Uso:  pnpm --filter @tienda/db build:sea

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO_DIR = path.join(RAIZ, 'bin');
const BLOB = path.join(RAIZ, 'sea-prep.blob');
const CONFIG = path.join(RAIZ, 'sea-config.json');

const NOMBRE_APP = 'tienda-db';

/**
 * La tripleta de destino que Tauri exige en el nombre del sidecar.
 *
 * Tauri no busca un binario genérico: mira por el nombre con el sufijo de la
 * plataforma de *compilación*. Es el mismo criterio de `externalBin`, y por eso
 * el mapa está escrito aquí y no se deduce: son cuatro combinaciones y una tabla
 * se lee de un vistazo, mientras que un `switch` con `process.arch` de por medio
 * obliga a saltar entre el `process.platform` y el `arch` para entender qué sale.
 *
 * Solo están las plataformas donde esto se usa: la tienda va en Windows x64 y el
 * desarrollo en Linux. Un `arch` raro —Windows ARM, Linux de 32 bits— falla a
 * propósito en vez de producir un nombre que Tauri no va a encontrar.
 */
const TRIPLETAS = {
  'win32:x64': 'x86_64-pc-windows-msvc',
  'linux:x64': 'x86_64-unknown-linux-gnu',
  'linux:arm64': 'aarch64-unknown-linux-gnu',
  'darwin:x64': 'x86_64-apple-darwin',
  'darwin:arm64': 'aarch64-apple-darwin',
};

function tripletaDeEstaPlataforma() {
  const clave = `${process.platform}:${process.arch}`;
  const tripleta = TRIPLETAS[clave];
  if (tripleta === undefined) {
    throw new Error(
      `No hay tripleta conocida para ${clave}. Las que este script sabe construir son: ` +
        Object.keys(TRIPLETAS).join(', ') +
        '. Si la app se va a empaquetar para esa plataforma, hay que añadirla aquí y a ' +
        'las plataformas de `tauri.conf.json`.',
    );
  }
  return tripleta;
}

const TRIPLETA = tripletaDeEstaPlataforma();
// Solo en Windows el ejecutable lleva extensión: sin ella Tauri no lo encuentra.
const EXTENSION = process.platform === 'win32' ? '.exe' : '';
const NOMBRE_SALIDA = `${NOMBRE_APP}-${TRIPLETA}${EXTENSION}`;
const SALIDA = path.join(DESTINO_DIR, NOMBRE_SALIDA);
// Dónde lo espera Tauri.
const DESTINO_TAURI = path.join(
  RAIZ,
  '..',
  'desktop',
  'src-tauri',
  'binaries',
  NOMBRE_SALIDA,
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

/**
 * Busca en `node.exe` la cadena del fusible que hay que volcar para que la app
 * acepte el blob.
 *
 * Node lleva esa cadena dentro de su propio binario y `postject` la usa como
 * "ya le inyectaron algo": si el fusible está a `0x01` (apagado) la inyección se
 * rechaza. El valor es una cadena fija desde Node 20, pero leerlo del binario en
 * vez de escribirlo a mano tiene una ventaja que se paga sola: si Node cambiara
 * el valor, el script sigue funcionando y el error, si lo hay, sería de
 * `postject` y no de Node.
 *
 * Se lee por bloques porque `node.exe` pesa más de cien megas y cargarlo entero
 * como cadena para buscar once letras es tirar memoria a la basura. Cada bloque
 * arranca con los últimos bytes del anterior: sin eso, un fusible que cae
 * justo en la frontera entre dos bloques —y con bloques de ocho megas, tarde o
 * temprano cae— se parte en dos y no se encuentra nunca.
 */
function buscarFusible(exe) {
  const patron = /NODE_SEA_FUSE_[0-9a-f]{32}/;
  // El fusible son 14 + 32 = 46 caracteres. Con 64 de solape siempre cabe entero
  // aunque parta el bloque, sobrando margen por si cambia de longitud.
  const SOLAPE = 64;
  const BLOQUE = 8 * 1024 * 1024;

  const fd = fs.openSync(exe, 'r');
  try {
    const buf = Buffer.alloc(BLOQUE + SOLAPE);
    // Bytes válidos al principio del buffer: los del bloque anterior más los
    // que se leen ahora.
    let inicio = 0;

    for (;;) {
      // Sin `position`: el descriptor avanza solo y no hay que llevar la cuenta.
      const n = fs.readSync(fd, buf, inicio, BLOQUE, null);
      if (n <= 0) break;
      const fin = inicio + n;

      const encontrado = patron.exec(buf.toString('latin1', 0, fin));
      if (encontrado) return encontrado[0];

      // Lo que quedó al final del bloque, al principio del buffer.
      inicio = Math.min(SOLAPE, fin);
      buf.copy(buf, 0, fin - inicio, fin);
    }
  } finally {
    fs.closeSync(fd);
  }

  throw new Error(
    `No se encontró "NODE_SEA_FUSE_" dentro de ${exe}. ` +
      'El ejecutable de Node está alterado o no es el de una instalación oficial; ' +
      'reinstala Node y vuelve a intentarlo.',
  );
}

async function main() {
  const { mayor, menor } = versionNode();
  const nativo = mayor > 25 || (mayor === 25 && menor >= 5);
  if (!nativo && mayor < 20) {
    throw new Error(`Node ${process.versions.node} es demasiado antiguo: se necesita 20 o superior.`);
  }

  log(`destino: ${TRIPLETA}${EXTENSION}`);

  fs.mkdirSync(DESTINO_DIR, { recursive: true });
  fs.rmSync(SALIDA, { force: true });
  fs.rmSync(BLOB, { force: true });

  log('1/5 compilando TypeScript');
  // Se llama a esbuild y no a `npm run build` para no depender de qué gestor de
  // paquetes esté activo: el paso es el mismo con cualquiera de los dos.
  ejecutar(process.execPath, [path.join(RAIZ, 'scripts', 'bundle.mjs'), '--minify']);

  log('2/5 generando el blob SEA');
  const entrada = path.join(RAIZ, 'build', 'main.cjs');
  if (!fs.existsSync(entrada)) {
    throw new Error(`No existe ${entrada}; la compilación no produjo nada.`);
  }

  if (nativo) {
    fs.writeFileSync(
      CONFIG,
      JSON.stringify({ main: entrada, output: SALIDA, disableExperimentalSEAWarning: true }, null, 2),
    );
    ejecutar(process.execPath, ['--build-sea', CONFIG]);
  } else {
    fs.writeFileSync(
      CONFIG,
      JSON.stringify({ main: entrada, output: BLOB, disableExperimentalSEAWarning: true }, null, 2),
    );
    ejecutar(process.execPath, ['--experimental-sea-config', CONFIG]);

    const fusible = buscarFusible(process.execPath);
    log(`   volcando el fusible ${fusible}`);

    // El ejecutable es una copia del binario de Node con el blob inyectado. Se
    // copia primero y se inyecta sobre la copia: el ejecutable que está corriendo
    // este script no se toca, que en Windows está bloqueado mientras se ejecuta y
    // en Linux se corrompería.
    fs.copyFileSync(process.execPath, SALIDA);
    ejecutar(
      'npx',
      [
        '--yes',
        // Versión fijada a propósito: es la que documenta Node, y `postject` es
        // alpha. Sin fijar, una actualización puede romper la inyección sin que
        // se note por qué.
        'postject@1.0.0-alpha.6',
        SALIDA,
        'NODE_SEA_BLOB',
        BLOB,
        '--sentinel-fuse',
        fusible,
        '--overwrite',
      ],
      // En Windows `npx` es un `.cmd`, que no es un ejecutable que `execFileSync`
      // pueda lanzar sin ayuda.
      { shell: true },
    );
  }

  if (!fs.existsSync(SALIDA)) {
    throw new Error(`No se generó el ejecutable esperado en ${SALIDA}`);
  }

  // Sin esto el sidecar existe pero no arranca, y el error que sale es de Tauri
  // ("no se encontró el binario" o un permiso denegado) en vez de algo que diga
  // "falta el permiso de ejecución". `copyFileSync` sí lo copia, pero `postject`
  // reescribe el archivo y en Linux se lo quita.
  //
  // En Windows el permiso no existe, pero `chmod` no hace daño: el sistema de
  // archivos lo ignora y el archivo sigue igual.
  fs.chmodSync(SALIDA, 0o755);

  log('3/5 comprobando que el ejecutable arranca');
  // Esto es el entregable de la fase: un archivo que existe no es lo mismo que
  // un archivo que arranca y habla. Se prueban las dos cosas por las que vale la
  // pena empaquetarlo, y son justo las que no funcionan si el blob se inyectó a
  // medias o si algo del runtime de SEA estropea la entrada estándar.
  //
  // En una base recién creada —carpeta temporal que se borra al terminar— para no
  // tocar la base de la tienda ni dejar un archivo de menos en sus respaldos.

  // 1. Arranca. La respuesta va por stderr a propósito —stdout está reservado
  //    para el protocolo—, así que hay que mirar los dos flujos, y se exige que
  //    no esté vacía: un ejecutable que sale con código 0 sin decir nada se
  //    rompió, y esta comprobación sin esa condición pasaría igual.
  const version = spawnSync(SALIDA, ['--version'], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });

  if (version.error) {
    throw new Error(`El ejecutable se generó pero no se pudo lanzar: ${version.error.message}`);
  }
  if (version.status !== 0) {
    throw new Error(
      `El ejecutable se generó pero salió con código ${version.status}. ` +
        `${version.stderr || version.stdout || ''}`.trim(),
    );
  }
  const saludo = `${version.stdout || ''}${version.stderr || ''}`.trim();
  if (!saludo) {
    throw new Error('El ejecutable se generó pero no respondió nada a --version.');
  }
  log(`   --version: ${saludo}`);

  // 2. Habla JSON-RPC por stdio, que es como le habla el POS entero.
  const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'tienda-sea-prueba-'));
  try {
    const peticion = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'necesita_configuracion',
      params: {},
    });

    const rpc = spawnSync(SALIDA, [], {
      input: `${peticion}\n`,
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true,
      env: {
        ...process.env,
        TIENDA_DATA_DIR: temporal,
        TIENDA_DOC_DIR: path.join(temporal, 'documentos'),
      },
    });

    if (rpc.error) {
      throw new Error(`El ejecutable no atendió la petición: ${rpc.error.message}`);
    }

    // La primera línea de stdout es la respuesta; lo que venga después se
    // ignora, porque en este momento solo viene eso.
    const linea = (rpc.stdout || '').split('\n').find((l) => l.trim() !== '');
    if (!linea) {
      throw new Error(
        `El ejecutable no respondió por stdout. stderr: ${(rpc.stderr || '').trim() || '(vacío)'}`,
      );
    }

    let envelope;
    try {
      envelope = JSON.parse(linea);
    } catch {
      throw new Error(`La respuesta no es JSON: ${linea.slice(0, 200)}`);
    }

    if (envelope.jsonrpc !== '2.0' || envelope.id !== 1 || envelope.result?.ok !== true) {
      throw new Error(`La respuesta no es la esperada: ${linea.slice(0, 200)}`);
    }
    log('   JSON-RPC por stdio: responde bien');
  } finally {
    fs.rmSync(temporal, { recursive: true, force: true });
  }

  log('4/5 copiando al directorio de Tauri');
  fs.mkdirSync(path.dirname(DESTINO_TAURI), { recursive: true });
  fs.copyFileSync(SALIDA, DESTINO_TAURI);
  // La copia necesita el permiso otra vez: `copyFileSync` sí lo trae, pero se
  // deja explícito porque el directorio `binaries/` está en `.gitignore` y
  // nunca pasa por un control de versiones que avise de un cambio de permisos.
  fs.chmodSync(DESTINO_TAURI, 0o755);

  log('5/5 listo');
  const mb = (fs.statSync(SALIDA).size / 1024 / 1024).toFixed(1);
  log(`   ${SALIDA} (${mb} MB)`);
  log(`   copiado a ${DESTINO_TAURI}`);
  if (process.platform === 'win32') {
    log('   siguiente paso: pnpm --filter @tienda/desktop tauri build');
  } else {
    // En una plataforma que no es la de la tienda el instalador no sirve de nada,
    // así que no se sugiere: lo que se sugiere es probar la app, que es para lo
    // que se ha generado.
    log('   siguiente paso: pnpm --filter @tienda/desktop tauri dev');
    log('   (este binario no es el de la tienda: hay que repetir esto en Windows)');
  }
}

main().catch((e) => {
  process.stderr.write(`[build:sea] ERROR: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});