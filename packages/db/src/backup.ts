// Copias de seguridad de la base de datos.
//
// Se guardan en `Documentos/tienda/backups/` con el nombre
// `tienda-AAAAMMDD-HHMMSS.db`, y se conservan las 30 últimas.
//
// ## Lo que hace distinto de `backup.rs`
//
// El original volcaba el WAL con `PRAGMA wal_checkpoint(FULL)` y copiaba el
// archivo, sin mirar el resultado. `PRAGMA wal_checkpoint` no lanza una
// excepción cuando no consigue el bloqueo: devuelve una fila con `busy = 1` y
// sigue como si nada. Con otra conexión leyendo —o con un `BEGIN` abierto en
// esta misma— la copia salía sin lo que estaba en el WAL, y nadie se enteraba
// hasta que había que restaurar y faltaban las últimas ventas. Aquí se
// comprueba la fila y, si el volcado no se hizo completo, se falla en vez de
// dejar un backup incompleto con nombre de backup bueno.
//
// ## Por qué hay que volcar el WAL
//
// La base está en modo WAL (ver `db.ts`): cada confirmación escribe primero en
// el archivo `tienda.db-wal` y el archivo `tienda.db` se actualiza después. Si
// se copia solo `tienda.db` sin volcar antes, la copia no tiene nada de lo
// escrito en los últimos minutos. Es un backup que parece bueno y no lo es.

import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import type { BackupItem } from '@tienda/core';

import { qUno } from './db.js';
import { sistema, validacion } from './errors.js';
import { type Rutas, RUTAS, carpetaDocumentosSub } from './paths.js';

/** Cuántas copias se conservan. Las más viejas se van borrando solas. */
export const RETENCION = 30;

/** Prefijo del nombre de archivo de las copias. */
const PREFIJO = 'tienda-';

/**
 * Cuántas copias se conservan por defecto.
 *
 * Treinta respaldos automáticos de un día cada uno son un mes de historial,
 * que es lo que alcanza para darse cuenta de un problema de datos un mes
 * después. A tamaño de base de este POS (unas 300 ventas al mes) cada copia
 * ocupa cientos de kilobytes, así que el disco no es el límite.
 */
export const COPIAS_POR_DEFECTO = RETENCION;

//---------------------------------------------------------------------------
// La carpeta
//---------------------------------------------------------------------------

/**
 * `Documentos\tienda\backups\`, creada si no existe.
 *
 * El error de la creación se traduce aquí en vez de dejar que salga el de Node.
 * La carpeta que falla es casi siempre `Documentos` sin permisos, o un disco
 * externo desconectado, y `ENOENT: no such file or directory, open 'D:\...'` no
 * le dice al dueño que lo que tiene que hacer es volver a conectar el disco.
 */
export function carpetaBackups(rutas: Rutas = RUTAS): string {
  try {
    return carpetaDocumentosSub('backups', rutas);
  } catch (e) {
    throw sistema(
      `No se pudo crear la carpeta de copias en ${rutas.documentDir}: ${detalle(e)}. ` +
        'Revise que la carpeta Documentos exista y que el disco tenga espacio.',
    );
  }
}

//---------------------------------------------------------------------------
// Crear
//---------------------------------------------------------------------------

/**
 * Crea una copia de seguridad y devuelve la información del archivo creado.
 *
 * El orden importa y no es negociable: primero se vuelca el WAL, después se
 * comprueba que la base existe, y solo entonces se copia. Copiar antes de
 * volcar produce un archivo que parece un respaldo y no lo es.
 */
export function crearBackup(db: DatabaseSync, rutas: Rutas = RUTAS): BackupItem {
  volcarWal(db);
  asegurarBaseLegible(rutas);

  const nombre = `${PREFIJO}${marcaTiempoUtc()}.db`;
  const destino = path.join(carpetaBackups(rutas), nombre);

  try {
    fs.copyFileSync(rutas.dbPath, destino);
  } catch (e) {
    throw sistema(
      `No se pudo copiar la base de datos a ${destino}: ${detalle(e)}. ` +
        'Revise que la carpeta Documentos tenga espacio en el disco y que no sea de solo lectura.',
    );
  }

  const item = itemDesde(destino);
  purgar(rutas);
  return item;
}

/**
 * Vuelca el WAL al archivo de la base y se asegura de que se hizo entero.
 *
 * `PRAGMA wal_checkpoint` devuelve `{ busy, log, checkpointed }`. `busy = 1`
 * significa que no consiguió el bloqueo porque hay otra conexión leyendo, y en
 * ese caso `checkpointed` es 0: no se copió nada. La diferencia entre `log` y
 * `checkpointed` dice cuántos frames quedaron fuera.
 */
function volcarWal(db: DatabaseSync): void {
  const r = qUno<{ busy: number; log: number; checkpointed: number }>(
    db,
    'PRAGMA wal_checkpoint(FULL)',
  );
  if (r === null) {
    // No debería pasar: el PRAGMA siempre devuelve una fila. Si no la devuelve,
    // es que algo cambió y no se puede saber si el volcado se hizo.
    throw sistema('No se pudo confirmar la sincronización de la base de datos');
  }
  if (r.busy !== 0 || r.checkpointed < r.log) {
    throw sistema(
      'No se pudo sincronizar la base de datos antes de copiar: hay otra operación en curso ' +
        `(${r.checkpointed} de ${r.log} páginas volcadas). ` +
        'Si suele pasar, cierre la pantalla de reportes y vuelva a intentarlo.',
    );
  }
}

/** Que la base exista en disco. Sin este archivo no hay nada que copiar. */
function asegurarBaseLegible(rutas: Rutas): void {
  if (!fs.existsSync(rutas.dbPath)) {
    throw sistema(`No se encontró la base de datos en ${rutas.dbPath}`);
  }
}

//---------------------------------------------------------------------------
// Listar
//---------------------------------------------------------------------------

/**
 * Las copias que hay, de la más nueva a la más vieja.
 *
 * Se ordenan por nombre, que es un `AAAAMMDD-HHMMSS`, así que el orden del
 * texto coincide con el del reloj mientras todos los nombres tengan el mismo
 * formato. Ordenar por fecha de modificación no serviría: alguien que copia un
 * respaldo viejo a mano deja un respaldo viejo con fecha de hoy, y ese pasa
 * al principio de la lista y se purga como si fuera el más nuevo.
 *
 * Los archivos que no son copias (un `.txt` que alguien dejó ahí, una carpeta)
 * se ignoran en vez de romper la lista.
 */
export function listarBackups(rutas: Rutas = RUTAS): BackupItem[] {
  const dir = carpetaBackups(rutas);

  let entradas: fs.Dirent[];
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    throw sistema(`No se pudo leer la carpeta de copias: ${detalle(e)}`);
  }

  const items: BackupItem[] = [];
  for (const entrada of entradas) {
    if (!entrada.isFile()) continue;
    const completa = path.join(dir, entrada.name);
    if (!esNombreDeCopia(entrada.name)) continue;
    try {
      items.push(itemDesde(completa));
    } catch {
      // Una copia que no se puede leer no debe hacer fallar la lista entera: el
      // cajero quiere ver sus copias, no enterarse de que una está corrupta.
      // La que se pueda restaurar se verá al restaurarla.
    }
  }

  return items.sort((a, b) => (a.nombre < b.nombre ? 1 : a.nombre > b.nombre ? -1 : 0));
}

/** `true` si el nombre tiene la forma de una copia: `tienda-AAAAMMDD-HHMMSS.db`. */
function esNombreDeCopia(nombre: string): boolean {
  return new RegExp(`^${PREFIJO}\\d{8}-\\d{6}\\.db$`).test(nombre);
}

/**
 * Si ya se hizo una copia hoy.
 *
 * Por prefijo de fecha, que es como lo hacía el original. Comprueba el día en
 * UTC, que es el mismo criterio con el que se nombran los archivos: si se
 * mezclara un criterio para nombrar y otro para buscar, un respaldo de la
 * 20:00 en Caracas quedaría con nombre del día siguiente y `hayBackupHoy`
 * respondería que no hay copia aunque se acabara de hacer.
 */
export function hayBackupHoy(rutas: Rutas = RUTAS): boolean {
  const prefijo = `${PREFIJO}${soloFechaUtc()}-`;
  return listarBackups(rutas).some((b) => b.nombre.startsWith(prefijo));
}

//---------------------------------------------------------------------------
// Eliminar
//---------------------------------------------------------------------------

/**
 * Borra una copia por su nombre de archivo.
 *
 * El nombre se valida antes de tocar el disco porque viene de la interfaz y
 * acabar en un `../../` sería una forma discreta de borrar cualquier archivo
 * que el proceso pueda alcanzar. Se exige un solo componente de ruta y la
 * extensión `.db`.
 *
 * Se comprueban las dos barras, la de Windows y la de Unix, y no las del sistema
 * en el que corra el proceso. El POS solo corre en Windows, pero las pruebas
 * corren en Linux: una validación que solo mirara `path.sep` pasaría todas las
 * pruebas y dejaría el agujero abierto en la computadora de la tienda.
 */
export function eliminarBackup(nombre: string, rutas: Rutas = RUTAS): void {
  validarNombreDeCopia(nombre);
  const completa = path.join(carpetaBackups(rutas), nombre);
  try {
    fs.rmSync(completa, { force: true });
  } catch (e) {
    throw sistema(`No se pudo eliminar la copia ${nombre}: ${detalle(e)}`);
  }
}

/** El nombre tiene que ser un archivo suelto que parezca una copia. */
function validarNombreDeCopia(nombre: string): void {
  const malo = (motivo: string): never => {
    throw validacion(`Nombre de copia inválido: ${motivo}`);
  };

  if (nombre.trim() === '') malo('está vacío');
  if (nombre.includes('/') || nombre.includes('\\')) malo('no puede contener rutas');
  if (/^[a-zA-Z]:/.test(nombre)) malo('no puede empezar con una letra de unidad');
  if (nombre === '.' || nombre === '..') malo('no puede ser la carpeta actual');
  if (path.basename(nombre) !== nombre) malo('tiene más de una parte');
  if (path.extname(nombre) !== '.db') malo('no termina en .db');
  if (!esNombreDeCopia(nombre)) malo('no tiene el formato de una copia');
}

//---------------------------------------------------------------------------
// Purgar
//---------------------------------------------------------------------------

/**
 * Borra las copias viejas dejando solo las `conservar` más recientes.
 *
 * Los archivos que no se pueden borrar no detienen la purga. Si un respaldo
 * está abierto en el explorador de archivos, el error de borrar uno no puede
 * impedir que se purguen los otros veinte.
 */
export function purgar(rutas: Rutas = RUTAS, conservar: number = COPIAS_POR_DEFECTO): number {
  if (conservar < 0) conservar = 0;
  const items = listarBackups(rutas);
  if (items.length <= conservar) return 0;

  let borrados = 0;
  for (const item of items.slice(conservar)) {
    try {
      fs.rmSync(item.ruta, { force: true });
      borrados++;
    } catch {
      // Ver la nota del comentario de la función.
    }
  }
  return borrados;
}

//---------------------------------------------------------------------------
// La información de cada copia
//---------------------------------------------------------------------------

/** Nombre, ruta, tamaño y fecha de modificación de un archivo de copia. */
function itemDesde(completa: string): BackupItem {
  const meta = fs.statSync(completa);
  return {
    nombre: path.basename(completa),
    ruta: completa,
    tamano_bytes: meta.size,
    fecha: tsAFecha(Math.floor(meta.mtimeMs / 1000)),
  };
}

//---------------------------------------------------------------------------
// La fecha
//---------------------------------------------------------------------------

/**
 * `AAAAMMDD-HHMMSS` en UTC.
 *
 * Se calcula con aritmética civil a mano, sin `Intl` ni `toISOString`, por dos
 * razones. Una: el nombre del archivo tiene que ordenar igual que el reloj, y
 * `toISOString` mete una `T` y la `Z` que no ordenan como se espera al ordenar
 * texto. Dos: el offset de Venezuela es `-04:00` fijo desde hace años, así que
 * un nombre en hora local sería más legible para el dueño, pero el reloj del
 * sistema puede estar mal puesto y UTC es el único reloj que no depende de que
 * la computadora de la tienda tenga la hora bien.
 *
 * Lo que sí usa hora local es `BackupItem.fecha`, que es la fecha de
 * modificación tal como la ve el sistema: esa es la que el dueño ve en el
 * explorador de archivos y tiene que coincidir.
 */
export function marcaTiempoUtc(segundos?: number): string {
  return tsAFecha(segundos ?? ahoraEnSegundos());
}

/** `AAAAMMDD` en UTC. */
export function soloFechaUtc(segundos?: number): string {
  return marcaTiempoUtc(segundos).slice(0, 8);
}

/** Segundos desde la época Unix. */
function ahoraEnSegundos(): number {
  return Math.floor(Date.now() / 1000);
}

/** Segundos desde la época Unix a `AAAAMMDD-HHMMSS`, en UTC. */
export function tsAFecha(seg: number): string {
  const dias = Math.floor(seg / 86400);
  const resto = seg - dias * 86400;
  const [anio, mes, dia] = civilDesdeDias(dias);
  const h = Math.floor(resto / 3600);
  const min = Math.floor((resto % 3600) / 60);
  const s = resto % 60;
  return (
    `${pad(anio, 4)}${pad(mes, 2)}${pad(dia, 2)}` +
    `-${pad(h, 2)}${pad(min, 2)}${pad(s, 2)}`
  );
}

function pad(valor: number, largo: number): string {
  return String(valor).padStart(largo, '0');
}

/**
 * Días desde 1970-01-01 a (año, mes, día) del calendario gregoriano.
 *
 * Algoritmo "civil from days" de Howard Hinnant: corrige la época a marzo del
 * año cero, y de ahí en adelante el año son ciclos de 400, el mes sale de
 * contar en grupos de 153 días (marzo a febrero), y el ajuste de febrero es lo
 * que hace que no se pierda un día cada cuatro años.
 */
export function civilDesdeDias(dias: number): [number, number, number] {
  const z = dias + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097; // [0, 146096]
  const yoe = Math.floor((doe - doe / 1460 + doe / 36524 - doe / 146096) / 365); // [0, 399]
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const m = mp < 10 ? mp + 3 : mp - 9; // [1, 12]
  return [m <= 2 ? y + 1 : y, m, d];
}

/** El texto de un error de Node, sin la parte de "Error: ". */
function detalle(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
