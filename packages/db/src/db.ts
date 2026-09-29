// Conexión a la base y control de transacciones.
//
// Estas funciones son el sustituto directo de `db.rs`. La diferencia principal
// con el original en Rust: allí cada función tomaba `&mut Connection` y el
// módulo envolvía todo en un `Mutex`, porque el backend era concurrente. Aquí
// `node:sqlite` es síncrono y el proceso es de un solo hilo de ejecución, así
// que el mutex sobra: la serialización ya la da el event loop.
//
// `transaccion()` encapsula el patrón BEGIN/COMMIT/ROLLBACK con savepoints
// anidados, igual que `unchecked_transaction()` de rusqlite. Existe para que no
// sea posible dejar una transacción abierta por accidente:
//
//   - El error se propaga siempre hacia afuera, nunca se captura dentro. Si el
//     código del dominio se traga una excepción, el commit sale con datos a
//     medias y la base queda inconsistente sin que nadie lo note.
//
// Si alguna vez hace falta una operación que capture errores dentro de una
// transacción, el nombre debe decirlo (ej. `transaccionATolerarFallo`) y solo
// para lecturas; para escrituras, no.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.js';
import { noEncontrado, normalizarError } from './errors.js';
import { asegurarDataDir, RUTAS } from './paths.js';

//---------------------------------------------------------------------------
// Apertura
//---------------------------------------------------------------------------

/**
 * Abre (o crea) la base en `dbPath` con los PRAGMA correctos y el esquema
 * aplicado. Devuelve la conexión lista para usar.
 */
export function abrir(dbPath: string = RUTAS.dbPath): DatabaseSync {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  configurar(db);
  aplicarEsquema(db);
  return db;
}

/** Conexión en memoria con el esquema actual. Solo para pruebas. */
export function enMemoria(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  configurar(db);
  aplicarEsquema(db);
  return db;
}

function configurar(db: DatabaseSync): void {
  // Las claves foráneas están apagadas por defecto en SQLite. Sin esto, una
  // venta podría confirmar sin stock válido.
  db.exec('PRAGMA foreign_keys = ON');
  // WAL permite leer mientras se escribe y evita corromper la base si la
  // aplicación se cierra a la fuerza. En bases en memoria no aplica y SQLite
  // simplemente lo ignora.
  db.exec('PRAGMA journal_mode = WAL');
  // 5 s de espera ante bloqueo, en vez de fallar de inmediato.
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
}

function aplicarEsquema(db: DatabaseSync): void {
  db.exec(SCHEMA_SQL);
  migrar(db);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

//---------------------------------------------------------------------------
// Migraciones
//---------------------------------------------------------------------------

/**
 * Migraciones incrementales no destructivas. Cada entrada transforma de
 * `version` a `version + 1` y solo se aplica si la base está en `version`.
 *
 * La versión 1 es el punto de partida del proyecto: no hay bases anteriores que
 * migrar, así que la lista arranca vacía. La infra queda montada para que los
 * próximos cambios de esquema (una columna nueva, un índice) se agreguen aquí
 * con un `ALTER TABLE` y no obliguen a reconstruir la base de los clientes.
 */
const MIGRACIONES: ReadonlyArray<{
  version: number;
  nombre: string;
  aplicar: (db: DatabaseSync) => void;
}> = [];

export function versionEsquema(db: DatabaseSync): number {
  const fila = qUno<{ user_version: number }>(db, 'PRAGMA user_version');
  return fila?.user_version ?? 0;
}

function migrar(db: DatabaseSync): void {
  let actual = versionEsquema(db);
  if (actual > SCHEMA_VERSION) {
    throw new Error(
      `La base está en el esquema v${actual} y esta versión solo entiende hasta la v${SCHEMA_VERSION}. ` +
        'Actualice la aplicación.',
    );
  }
  for (const m of MIGRACIONES) {
    if (actual === m.version) {
      m.aplicar(db);
      actual = m.version + 1;
      db.exec(`PRAGMA user_version = ${actual}`);
    }
  }
}

//---------------------------------------------------------------------------
// Transacciones
//---------------------------------------------------------------------------

/**
 * Profundidad de anidamiento por conexión. `node:sqlite` no expone si hay una
 * transacción abierta, así que se lleva aquí. Es un `WeakMap` y no una variable
 * de módulo a propósito: las pruebas abren varias bases en memoria a la vez y
 * cada una lleva su propio contador.
 */
const PROFUNDIDAD = new WeakMap<DatabaseSync, number>();

/** `true` si la conexión tiene al menos una transacción abierta. */
export function estaEnTransaccion(db: DatabaseSync): boolean {
  return (PROFUNDIDAD.get(db) ?? 0) > 0;
}

/**
 * Ejecuta `fn` dentro de una transacción. La primera llamada abre `BEGIN`;
 * las anidadas usan savepoints, de modo que un fallo intermedio revierte solo
 * su propio tramo y deja que el llamador decida.
 *
 * Si `fn` lanza, se revierte y el error se propaga. Si `fn` termina bien, se
 * confirma.
 */
export function transaccion<T>(db: DatabaseSync, fn: () => T): T {
  const profundidad = PROFUNDIDAD.get(db) ?? 0;
  const punto = `sp${profundidad}`;
  const anidada = profundidad > 0;

  db.exec(anidada ? `SAVEPOINT ${punto}` : 'BEGIN');
  PROFUNDIDAD.set(db, profundidad + 1);

  let resultado: T;
  try {
    resultado = fn();
  } catch (e) {
    PROFUNDIDAD.set(db, profundidad);
    revertir(db, anidada, punto);
    throw e;
  }

  PROFUNDIDAD.set(db, profundidad);
  db.exec(anidada ? `RELEASE ${punto}` : 'COMMIT');
  return resultado;
}

function revertir(db: DatabaseSync, anidada: boolean, punto: string): void {
  try {
    db.exec(anidada ? `ROLLBACK TO ${punto}; RELEASE ${punto}` : 'ROLLBACK');
  } catch {
    // Si la reversión falla, SQLite ya ha descartado la transacción por su
    // cuenta. El error original es el que importa; este no aporta nada.
  }
}

//---------------------------------------------------------------------------
// Consultas
//---------------------------------------------------------------------------

// `node:sqlite` devuelve las filas como `Record<string, SQLOutputValue>`: no sabe
// la forma de la fila, solo la lee del SQL. Estos dos helpers son el punto donde
// el dominio declara esa forma con el parámetro de tipo, igual que en Rust cada
// `query_row` declaraba el tipo de su closure. El casteo es inevitable, pero
// queda en un solo lugar y no se repite por todo el código.
//
// Además, todos pasan por `normalizarError`. Es el único embudo por donde sale
// SQL hacia el dominio, así que es el punto donde se traduce el texto técnico de
// SQLite ("UNIQUE constraint failed: productos.codigo_barras") al mensaje y al
// código que la interfaz entiende. Normalizar aquí en vez de en el llamador
// significa que ningún error crudo se escapa por un `catch` olvidado, y que los
// datos no tienen que acordarse de envolver cada consulta.

/** Todas las filas de una consulta. */
export function qTodos<T>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T[] {
  try {
    return db.prepare(sql).all(...params) as T[];
  } catch (e) {
    throw normalizarError(e);
  }
}

/** La primera fila, o `null` si no hay ninguna. */
export function qUno<T>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T | null {
  try {
    return (db.prepare(sql).get(...params) as T | undefined) ?? null;
  } catch (e) {
    throw normalizarError(e);
  }
}

/** La primera fila, o error `no_encontrado` con el nombre de la entidad. */
export function qObligatorio<T>(
  db: DatabaseSync,
  entidad: string,
  sql: string,
  ...params: SQLInputValue[]
): T {
  const fila = qUno<T>(db, sql, ...params);
  if (fila === null) throw noEncontrado(entidad);
  return fila;
}

/** Ejecuta una escritura y devuelve cuántas filas cambió y el id insertado. */
export function ejecutar(
  db: DatabaseSync,
  sql: string,
  ...params: SQLInputValue[]
): { cambios: number; ultimoId: number } {
  try {
    const r = db.prepare(sql).run(...params);
    return { cambios: Number(r.changes), ultimoId: Number(r.lastInsertRowid) };
  } catch (e) {
    throw normalizarError(e);
  }
}

/** Ejecuta varias sentencias seguidas (DDL, scripts). */
export function ejecutarScript(db: DatabaseSync, sql: string): void {
  try {
    db.exec(sql);
  } catch (e) {
    throw normalizarError(e);
  }
}

export { DatabaseSync };
export type { SQLInputValue };
export { asegurarDataDir };
