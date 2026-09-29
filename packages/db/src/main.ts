// Punto de entrada del backend.
//
// Corre como proceso hijo del webview de Tauri (`externalBin`), habla JSON-RPC
// sobre stdio y no imprime nada en stdout que no sea una respuesta. Para
// desarrollo también arranca en modo HTTP con `--http`, que es lo que permite
// probar el backend con `curl` sin Tauri y sin el webview.
//
//   node build/main.cjs                      → JSON-RPC por stdio
//   node build/main.cjs --http               → HTTP en 127.0.0.1:3001
//   node build/main.cjs --http --port 4000
//   node build/main.cjs --http --host 0.0.0.0    ← abre la base a la red; avisará
//
// Las rutas llegan por variables de entorno (`TIENDA_DATA_DIR`, `TIENDA_DOC_DIR`,
// `TIENDA_SCRIPTS_DIR`); ver `paths.ts`. Sin ellas se usan los valores por
// defecto de Windows, que es lo que hace que el modo `--http` funcione en Linux.
//
// ## Arranque
//
// El orden es el mismo que el del `setup` del Tauri original y no es
// arbitrario: carpeta de datos, base abierta, semilla, comprobación de esquema,
// copia diaria y por último el transporte. La copia va antes de escuchar porque
// si el shell está esperando una respuesta y el proceso se cae al copiar, se ve
// en el registro; al revés, el shell creería que el backend arrancó y esperaría
// una respuesta que no va a llegar.

import { crearBackup, hayBackupHoy } from './backup.js';
import { logError } from './bitacora.js';
import { abrir, versionEsquema } from './db.js';
import { conCodigo, CODIGO_ERROR, normalizarError } from './errors.js';
import { construirRegistro } from './procedimientos.js';
import { RUTAS, asegurarDataDir, type Rutas } from './paths.js';
import {
  PUERTO_POR_DEFECTO,
  servirHttp,
  servirStdio,
  silenciarConsola,
  type Contexto,
  type OpcionesHttp,
} from './rpc.js';
import { SCHEMA_VERSION } from './schema.js';
import { necesitaConfiguracion, sembrarTodo } from './seed.js';

import type { DatabaseSync } from 'node:sqlite';

//---------------------------------------------------------------------------
// Argumentos de la línea de comandos
//---------------------------------------------------------------------------

interface Opciones {
  http: boolean;
  puerto: number;
  host: string;
}

/**
 * Lee `--http`, `--port N` y `--host H`.
 *
 * Un flag desconocido es un error y no una advertencia: en un POS, un
 * `--htpp` mal escrito que se ignorara en silencio dejaría el proceso esperando
 * en stdio mientras el shell cree que tiene un puerto abierto.
 */
export function leerOpciones(argv: string[]): Opciones {
  const opciones: Opciones = { http: false, puerto: PUERTO_POR_DEFECTO, host: '127.0.0.1' };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--http':
        opciones.http = true;
        break;
      case '--port': {
        const valor = Number(argv[++i]);
        if (!Number.isInteger(valor) || valor < 0 || valor > 65535) {
          throw conCodigo(CODIGO_ERROR.peticion_invalida, 'El puerto debe ser un número de 0 a 65535');
        }
        opciones.puerto = valor;
        break;
      }
      case '--host': {
        const valor = argv[++i];
        if (valor === undefined || valor === '') {
          throw conCodigo(CODIGO_ERROR.peticion_invalida, 'Falta la dirección después de --host');
        }
        opciones.host = valor;
        break;
      }
      case '--version': {
        process.stderr.write(`tienda-db esquema v${SCHEMA_VERSION}\n`);
        process.exit(0);
        break;
      }
      default:
        throw conCodigo(
          CODIGO_ERROR.peticion_invalida,
          `Opción desconocida «${arg}». Se aceptan: --http, --port N, --host DIRECCIÓN, --version`,
        );
    }
  }

  return opciones;
}

//---------------------------------------------------------------------------
// Arranque
//---------------------------------------------------------------------------

/** El backend preparado, para poder probarlo sin Tauri ni sockets. */
export interface Estado {
  db: DatabaseSync;
  ctx: Contexto;
  cerrar: () => Promise<void>;
}

/**
 * Abre la base, la siembra y deja el contexto listo.
 *
 * Separado del arranque del transporte para que el test pueda abrir un backend
 * real y llamarlo por el registro sin abrir un socket.
 */
export function preparar(rutas: Rutas = RUTAS): Estado {
  asegurarDataDir(rutas);
  const db = abrir(rutas.dbPath);
  sembrarTodo(db);

  const esquema = versionEsquema(db);
  if (esquema !== SCHEMA_VERSION) {
    // No se sigue con una base de otra versión. `abrir` ya aplicó las
    // migraciones pendientes, así que llegar aquí significa que hay una base
    // de una versión futura: seguir sería escribir con un esquema que este
    // código no conoce, y eso pierde datos sin avisar.
    db.close();
    throw conCodigo(
      CODIGO_ERROR.sistema,
      `La base está en el esquema v${esquema} y esta versión espera v${SCHEMA_VERSION}. ` +
        'Actualice la aplicación.',
    );
  }

  const ctx: Contexto = { db, rutas };

  return {
    db,
    ctx,
    cerrar: async () => {
      db.close();
    },
  };
}

/**
 * La copia de seguridad del día, si no hay una.
 *
 * El original hacía `let _ = crear_backup(...)`: si fallaba, nadie se enteraba
 * hasta que un cliente perdía datos. Aquí el fallo se anota en la bitácora y se
 * sigue arrancando, que es lo que importa: un POS que no arranca por un disco
 * lleno en la copia es peor que un POS sin copia de hoy.
 */
function copiarSiHaceFalta(ctx: Contexto): void {
  try {
    if (!hayBackupHoy(ctx.rutas)) {
      crearBackup(ctx.db, ctx.rutas);
    }
  } catch (e) {
    const err = normalizarError(e);
    logError('arranque', `No se pudo hacer la copia diaria: ${err.message}`, ctx.rutas);
    console.error(`[tienda-db] ${err.message}`);
  }
}

/** Estado de arranque que se escribe en stderr para diagnóstico. */
function resumenArranque(ctx: Contexto, modo: string, extra: string = ''): void {
  console.error(
    `[tienda-db] esquema v${SCHEMA_VERSION} · ${ctx.rutas.dbPath}` +
      (extra === '' ? '' : ` · ${extra}`) +
      ` · ${modo}` +
      (necesitaConfiguracion(ctx.db) ? ' · falta configurar el administrador' : ''),
  );
}

async function principal(): Promise<void> {
  const opciones = leerOpciones(process.argv.slice(2));

  // Antes de abrir nada: en modo stdio, stdout es el canal del protocolo.
  if (!opciones.http) {
    silenciarConsola();
  }

  const estado = preparar();
  copiarSiHaceFalta(estado.ctx);
  const registro = construirRegistro();

  if (!opciones.http) {
    resumenArranque(estado.ctx, 'stdio');
    const servidor = servirStdio(registro, estado.ctx);
    // Si el shell se cierra, el pipe se rompe. Se apaga el proceso sin volcado
    // de pila: no hay a quién avisarle y el cierre limpio ya lo hizo SQLite.
    servidor.error.catch(() => {
      process.exit(0);
    });
    await cerrarAlSalir(async () => {
      await servidor.cerrar();
      await estado.cerrar();
    });
    return;
  }

  const http: OpcionesHttp = { puerto: opciones.puerto, host: opciones.host };
  const servidor = await servirHttp(registro, estado.ctx, http);
  // El aviso de estar escuchando fuera del bucle local lo da `servirHttp`, que
  // es quien sabe en qué puerto acabó escuchando de verdad.
  resumenArranque(estado.ctx, `http://${opciones.host}:${servidor.puerto()}`);
  await cerrarAlSalir(async () => {
    await servidor.cerrar();
    await estado.cerrar();
  });
}

/**
 * Cierra con orden al recibir Ctrl-C o al cerrarse stdin.
 *
 * Importa el orden: primero se deja de aceptar peticiones y se vacía la cola de
 * respuestas, y solo después se cierra la base. Al revés, una respuesta a medio
 * escribir se pierde con la conexión y el shell ve un fallo donde no lo hubo.
 */
function cerrarAlSalir(cerrar: () => Promise<void>): Promise<void> {
  return new Promise<void>((cumplir) => {
    let hecho = false;
    const terminar = (): void => {
      if (hecho) return;
      hecho = true;
      cerrar()
        .catch((e) => console.error(`[tienda-db] error al cerrar: ${normalizarError(e).message}`))
        .finally(() => {
          cumplir();
        });
    };

    process.once('SIGINT', terminar);
    process.once('SIGTERM', terminar);
    // En modo stdio, que el shell cierre su lado del pipe es la señal normal de
    // que la app se está cerrando.
    process.stdin.once('end', terminar);
    process.stdin.once('close', terminar);
  });
}

principal().catch((e) => {
  const err = normalizarError(e);
  // Aunque falle el arranque, la forma del mensaje es la del protocolo: hay
  // procesos (y personas) que leen stderr buscando ese JSON.
  process.stderr.write(
    JSON.stringify({ ok: false, error: { codigo: err.codigo, mensaje: err.message } }) + '\n',
  );
  process.exitCode = 1;
});
