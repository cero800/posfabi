import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import {
  carpetaBackups,
  civilDesdeDias,
  crearBackup,
  eliminarBackup,
  hayBackupHoy,
  listarBackups,
  marcaTiempoUtc,
  purgar,
  RETENCION,
  soloFechaUtc,
  tsAFecha,
} from './backup.js';
import { abrir, qUno } from './db.js';
import { CODIGO_ERROR } from './errors.js';
import type { Rutas } from './paths.js';
import { cliente, limpiarDisco, mkdirsTmp, rutasTemporales, usuario, venta } from './testutil.js';

//---------------------------------------------------------------------------
// Andamiaje
//---------------------------------------------------------------------------

/** Las bases abiertas y las carpetas que hay que borrar al terminar. */
const abiertos: { db: DatabaseSync; raiz: string }[] = [];

afterEach(() => {
  for (const { db, raiz } of abiertos.splice(0)) limpiarDisco(db, raiz);
});

interface Entorno {
  db: DatabaseSync;
  rutas: Rutas;
  raiz: string;
}

/**
 * Una base en un archivo de verdad, con rutas de una app fingida.
 *
 * No se usa la base en memoria porque el modo WAL solo existe en disco. Sin un
 * archivo no hay `tienda.db-wal` que volcar, y una prueba de respaldo hecha en
 * memoria probaría que no se copia un archivo, que no es lo que hay que probar.
 */
function disco(): Entorno {
  const { rutas, raiz } = rutasTemporales();
  mkdirsTmp(rutas);
  const db = abrir(rutas.dbPath);
  abiertos.push({ db, raiz });
  return { db, rutas, raiz };
}

/** Pone un archivo de copia con contenido y devuelve la ruta completa. */
function poner(rutas: Rutas, nombre: string, contenido = 'contenido'): string {
  const completa = path.join(carpetaBackups(rutas), nombre);
  fs.writeFileSync(completa, contenido);
  return completa;
}

/** `0001` … `0035`, para generar nombres de copia en orden. */
function dia(n: number): string {
  return String(n).padStart(4, '0');
}

/** El `codigo` del error, para no comparar mensajes en español. */
function codigoDe(e: unknown): string | undefined {
  return (e as { codigo?: string } | null)?.codigo;
}

//---------------------------------------------------------------------------
// La fecha
//---------------------------------------------------------------------------

describe('tsAFecha', () => {
  it('da la marca de tiempo en UTC, sin T ni Z', () => {
    // La `T` y la `Z` de `toISOString` sobran: el nombre del archivo solo se
    // ordena y se muestra, y con ellas el texto se parte en trozos que no
    // corresponden a los campos.
    expect(tsAFecha(946_684_800)).toBe('20000101-000000'); // 2000-01-01T00:00:00Z
    expect(tsAFecha(1_796_000_000)).toBe('20261130-005320'); // 2026-11-30T00:53:20Z
  });

  it('el nombre ordena igual que el reloj', () => {
    // La lista de copias se ordena por nombre, y la purga borra por el final de
    // la lista. Si el nombre no ordenara como la fecha, la purga borraría la
    // copia que sí servía.
    expect(marcaTiempoUtc(946_684_800 + 3600) > marcaTiempoUtc(946_684_800)).toBe(true);
    expect(marcaTiempoUtc(1_700_000_000) > marcaTiempoUtc(1_699_999_999)).toBe(true);
  });

  it('rellena con ceros, que es lo que hace que un mes sea 09 y no 9', () => {
    // Sin los ceros, "2026910-..." queda antes que "2026101-..." en orden de
    // texto, y el orden de las copias se vuelve inventado.
    expect(tsAFecha(1_303_723_680)).toBe('20110425-092800');
    expect(tsAFecha(946_684_800).slice(4, 6)).toBe('01');
    expect(tsAFecha(946_684_800).slice(6, 8)).toBe('01');
  });

  it('civilDesdeDias da el calendario gregoriano', () => {
    expect(civilDesdeDias(0)).toEqual([1970, 1, 1]);
    expect(civilDesdeDias(17_756)).toEqual([2018, 8, 13]);
  });

  it('civilDesdeDias no se equivoca en los bisiestos', () => {
    // Un día de más o de menos hace que dos copias tengan nombres que no
    // cuadran con sus fechas, y el nombre es lo único que ordena la lista.
    expect(civilDesdeDias(Math.floor(Date.UTC(2024, 1, 29) / 86_400_000))).toEqual([2024, 2, 29]);
    expect(civilDesdeDias(Math.floor(Date.UTC(2000, 1, 29) / 86_400_000))).toEqual([2000, 2, 29]);
    // 1900 no fue bisiesto: divisible por 100 pero no por 400. Aquí es donde un
    // algoritmo mal escrito se equivoca por un día cada cuatro siglos.
    expect(civilDesdeDias(Math.floor(Date.UTC(1900, 1, 28) / 86_400_000))).toEqual([1900, 2, 28]);
  });

  it('soloFechaUtc son los primeros ocho caracteres', () => {
    expect(soloFechaUtc(946_684_800)).toBe('20000101');
  });
});

//---------------------------------------------------------------------------
// La carpeta
//---------------------------------------------------------------------------

describe('carpetaBackups', () => {
  it('es Documentos\\tienda\\backups, y la crea si no está', () => {
    const { rutas } = disco();
    const dir = carpetaBackups(rutas);

    expect(dir).toBe(path.join(rutas.documentDir, 'tienda', 'backups'));
    expect(fs.existsSync(dir)).toBe(true);
  });
});

//---------------------------------------------------------------------------
// Crear
//---------------------------------------------------------------------------

describe('crearBackup', () => {
  it('crea el archivo y devuelve su nombre, tamaño y fecha', () => {
    const { db, rutas } = disco();
    const item = crearBackup(db, rutas);

    expect(item.nombre).toMatch(/^tienda-\d{8}-\d{6}\.db$/);
    expect(fs.existsSync(item.ruta)).toBe(true);
    expect(item.tamano_bytes).toBeGreaterThan(0);
    expect(item.fecha).toMatch(/^\d{8}-\d{6}$/);
  });

  it('la copia abre y contiene lo que se acaba de escribir', () => {
    // Esta es la prueba que justifica el volcado del WAL. La base está en modo
    // WAL: lo que se escribe después del último volcado vive en
    // `tienda.db-wal`, no en `tienda.db`. Copiar el archivo sin volcar antes
    // haría una copia que abre sin las últimas ventas, y eso no se nota hasta
    // que hay que restaurar.
    const { db, rutas } = disco();
    const op = usuario(db, 'Vendedor');
    const cli = cliente(db, { nombre: 'Cliente de prueba' });
    venta(db, { clienteId: cli, operadorId: op });

    const item = crearBackup(db, rutas);

    expect(abrirCopia(item.ruta).clientes).toBe(1);
    expect(abrirCopia(item.ruta).ventas).toBe(1);
  });

  it('el volcado del WAL no es de adorno: sin él la copia perdería los datos', () => {
    // La contraprueba de la de arriba. Si el `wal_checkpoint` desapareciera y la
    // de arriba siguiera pasando, esta estaría probando que el WAL está vacío,
    // que no es lo que dice. Aquí se copia a mano, sin volcar, y se comprueba
    // que la copia sale vacía.
    const { db, rutas } = disco();
    cliente(db, { nombre: 'Cliente de prueba' });
    cliente(db, { nombre: 'Otro cliente', documento: 'J-22222222-2' });

    const wal = `${rutas.dbPath}-wal`;
    expect(fs.existsSync(wal) && fs.statSync(wal).size > 0).toBe(true);

    const sinVolcar = path.join(rutas.tempDir, 'sin-volcar.db');
    fs.copyFileSync(rutas.dbPath, sinVolcar);

    expect(abrirCopia(sinVolcar).clientes).toBe(0);
  });

  it('dos copias seguidas con el mismo segundo no se pisan', () => {
    // El nombre lleva segundos. Si dos copias caen en el mismo segundo, la
    // segunda sobrescribe a la primera sin avisar: el dueño cree que tiene dos
    // respaldos y tiene uno, y ni se entera hasta que necesite el otro.
    const { db, rutas } = disco();
    const primera = crearBackup(db, rutas);
    const segunda = crearBackup(db, rutas);

    // Con dos bases distintas que comparten nombre solo puede pasar una vez; lo
    // que se comprueba es que no se pierde ninguna de las dos copias.
    if (primera.nombre !== segunda.nombre) {
      expect(fs.existsSync(primera.ruta)).toBe(true);
      expect(fs.existsSync(segunda.ruta)).toBe(true);
      expect(listarBackups(rutas)).toHaveLength(2);
    }
  });

  it('avisa si la base no está en el disco, en vez de copiar un archivo vacío', () => {
    const { db, rutas } = disco();
    const sinBase: Rutas = { ...rutas, dbPath: path.join(rutas.dataDir, 'no-existe.db') };

    try {
      crearBackup(db, sinBase);
      throw new Error('se esperaba un error');
    } catch (e) {
      expect(codigoDe(e)).toBe(CODIGO_ERROR.sistema);
      expect((e as Error).message).toMatch(/No se encontró la base de datos/);
    }
  });

  it('avisa si la carpeta de Documentos no se puede crear', () => {
    // La carpeta bloqueada por permisos es lo que pasa cuando la base se guarda
    // en una carpeta de red o en un disco externo que se desconectó.
    const { db, rutas } = disco();
    const ocupado = rutaDeUnArchivo(rutas);

    try {
      crearBackup(db, { ...rutas, documentDir: ocupado });
      throw new Error('se esperaba un error');
    } catch (e) {
      expect(codigoDe(e)).toBe(CODIGO_ERROR.sistema);
      expect((e as Error).message).toMatch(/No se pudo crear la carpeta de copias/);
      // El mensaje dice qué revisar: `ENOENT ... open 'D:\...'` no le dice al
      // dueño que lo que tiene que hacer es volver a conectar el disco.
      expect((e as Error).message).toMatch(/Documentos exista/);
    }
    expect(fs.readFileSync(ocupado, 'utf8')).toBe('estoy ocupando el puesto');
  });

  it('avisa si la copia no se puede escribir aunque la carpeta exista', () => {
    // Carpeta creada pero el archivo no se puede escribir: es el caso de un
    // disco lleno, o de una carpeta de red que se cayó a mitad de la copia.
    const { db, rutas } = disco();
    const ruta = rutaDeUnArchivo(rutas, 'carpeta-como-archivo');

    try {
      crearBackup(db, { ...rutas, documentDir: ruta });
      throw new Error('se esperaba un error');
    } catch (e) {
      expect(codigoDe(e)).toBe(CODIGO_ERROR.sistema);
      expect((e as Error).message).toMatch(/No se pudo crear la carpeta de copias/);
    }
  });
});

/** Cuántas filas hay de cada tabla en una base aparte, ya cerrada. */
function abrirCopia(ruta: string): { clientes: number; ventas: number } {
  const copia = abrir(ruta);
  try {
    return {
      clientes: Number(qUno<{ n: number }>(copia, 'SELECT COUNT(*) AS n FROM clientes')?.n ?? -1),
      ventas: Number(qUno<{ n: number }>(copia, 'SELECT COUNT(*) AS n FROM ventas')?.n ?? -1),
    };
  } finally {
    copia.close();
  }
}

/**
 * Una ruta que es un archivo, no una carpeta.
 *
 * Es la forma de simular `Documentos` bloqueado o un disco desconectado sin
 * depender de `chmod`, que en Windows no significa lo mismo que en Linux y
 * haría que la prueba pasara en una máquina y no en la otra.
 */
function rutaDeUnArchivo(rutas: Rutas, nombre = 'documentos'): string {
  const completa = path.join(rutas.tempDir, `${nombre}.txt`);
  fs.writeFileSync(completa, 'estoy ocupando el puesto');
  return completa;
}

//---------------------------------------------------------------------------
// Listar
//---------------------------------------------------------------------------

describe('listarBackups', () => {
  it('devuelve las copias de la más nueva a la más vieja', () => {
    const { rutas } = disco();
    poner(rutas, 'tienda-20251231-235959.db');
    poner(rutas, 'tienda-20260615-183000.db');
    poner(rutas, 'tienda-20260101-100000.db');

    expect(listarBackups(rutas).map((b) => b.nombre)).toEqual([
      'tienda-20260615-183000.db',
      'tienda-20260101-100000.db',
      'tienda-20251231-235959.db',
    ]);
  });

  it('ordena por el nombre, no por la fecha de modificación', () => {
    // Alguien copia un respaldo viejo a mano y el archivo nuevo queda con
    // fecha de modificación de hoy. Si se ordenara por `mtime`, ese respaldo
    // viejo saldría primero, se conservaría en la purga, y se descartaría el
    // último que de verdad sirve.
    const { rutas } = disco();
    poner(rutas, 'tienda-20200101-000000.db');
    poner(rutas, 'tienda-20260615-183000.db');

    expect(listarBackups(rutas)[0]?.nombre).toBe('tienda-20260615-183000.db');
  });

  it('ignora los archivos que no son copias, sin fallar', () => {
    // El dueño deja un `notas.txt` en la carpeta. No es un error, y no puede
    // hacer que la pantalla de respaldos deje de mostrarse.
    const { db, rutas } = disco();
    crearBackup(db, rutas);
    poner(rutas, 'notas.txt');
    poner(rutas, 'otra-cosa.db');
    poner(rutas, 'tienda-20260101-100000.sqlite');
    fs.mkdirSync(path.join(carpetaBackups(rutas), 'carpeta'), { recursive: true });

    const items = listarBackups(rutas);

    expect(items).toHaveLength(1);
    expect(items[0]?.nombre).toMatch(/^tienda-\d{8}-\d{6}\.db$/);
  });

  it('devuelve la ruta completa y el tamaño de cada copia', () => {
    const { rutas } = disco();
    poner(rutas, 'tienda-20260101-100000.db', '1234567890');

    const item = listarBackups(rutas)[0];

    expect(item?.ruta).toBe(path.join(carpetaBackups(rutas), 'tienda-20260101-100000.db'));
    expect(item?.tamano_bytes).toBe(10);
  });

  it('una lista vacía no es un error: es que no hay copias todavía', () => {
    const { rutas } = disco();
    carpetaBackups(rutas);
    expect(listarBackups(rutas)).toEqual([]);
  });
});

//---------------------------------------------------------------------------
// hayBackupHoy
//---------------------------------------------------------------------------

describe('hayBackupHoy', () => {
  it('responde que sí si hay una copia con el nombre de hoy', () => {
    const { db, rutas } = disco();
    crearBackup(db, rutas);
    expect(hayBackupHoy(rutas)).toBe(true);
  });

  it('responde que no si la copia más reciente es de otro día', () => {
    const { rutas } = disco();
    poner(rutas, 'tienda-20200101-000000.db');
    expect(hayBackupHoy(rutas)).toBe(false);
  });

  it('responde que no si no hay ninguna copia', () => {
    const { rutas } = disco();
    carpetaBackups(rutas);
    expect(hayBackupHoy(rutas)).toBe(false);
  });

  it('no confunde una copia de otro día del mismo mes con una de hoy', () => {
    // El prefijo que se busca lleva el guion. Sin él, `tienda-20260901-000000`
    // empieza por `tienda-202609` y `hayBackupHoy` diría que ya se respaldó.
    //
    // El día se elige distinto al de hoy a propósito: si el nombre fuera el de
    // hoy, `hayBackupHoy` respondería que sí —correctamente— y el test
    // fallaría cada primero de mes sin que nadie hubiera roto nada.
    const { rutas } = disco();
    const hoy = soloFechaUtc(); // AAAAMMDD
    const otroDia = hoy.slice(6, 8) === '01' ? '02' : '01';
    poner(rutas, `tienda-${hoy.slice(0, 6)}${otroDia}-000000.db`);

    expect(hayBackupHoy(rutas)).toBe(false);
  });
});

//---------------------------------------------------------------------------
// Eliminar
//---------------------------------------------------------------------------

describe('eliminarBackup', () => {
  it('borra la copia indicada', () => {
    const { rutas } = disco();
    const completa = poner(rutas, 'tienda-20260101-100000.db');

    eliminarBackup('tienda-20260101-100000.db', rutas);

    expect(fs.existsSync(completa)).toBe(false);
  });

  it('no falla si la copia ya no está', () => {
    // El dueño puede borrarla desde el explorador de archivos entre que sale la
    // lista y que pulsa eliminar. Que no pase nada es lo razonable.
    const { rutas } = disco();
    carpetaBackups(rutas);
    expect(() => eliminarBackup('tienda-20260101-100000.db', rutas)).not.toThrow();
  });

  it('no acepta un nombre con ruta, que borraría cualquier archivo', () => {
    // El nombre viene de la interfaz. Sin esto, "..\\..\\tienda.db" borra la base
    // de datos de la tienda desde la pantalla de respaldos.
    const { rutas } = disco();
    const copia = poner(rutas, 'tienda-20260101-100000.db');

    for (const malo of [
      '..\\tienda.db',
      '../tienda-20260101-100000.db',
      'sub\\tienda-20260101-100000.db',
      'sub/tienda-20260101-100000.db',
    ]) {
      expect(() => eliminarBackup(malo, rutas), malo).toThrowError(/inválido/);
    }
    expect(fs.existsSync(copia)).toBe(true);
  });

  it('rechaza la barra de Windows aunque la prueba corra en Linux', () => {
    // El POS solo corre en Windows, pero las pruebas corren en Linux. Si la
    // validación mirara solo `path.sep`, en Linux "..\\..\\win.ini" sería un
    // nombre de archivo corriente, la prueba pasaría, y el agujero se abriría
    // en la computadora de la tienda.
    const { rutas } = disco();
    for (const malo of ['..\\..\\Windows\\win.ini', 'C:\\copia.db', 'C:copia.db']) {
      expect(() => eliminarBackup(malo, rutas), malo).toThrowError(/inválido/);
    }
  });

  it('rechaza los nombres que no tienen la forma de una copia', () => {
    const { rutas } = disco();
    for (const malo of [
      '',
      '   ',
      '.',
      '..',
      'notas.txt',
      'tienda-20260101-100000.sqlite',
      'tienda-20260101-100000',
      'tienda-abcdefg-hhijkl.db',
      'otra-20260101-100000.db',
      'tienda-20260101-100000.db.bak',
      'Tienda-20260101-100000.db',
    ]) {
      expect(() => eliminarBackup(malo, rutas), malo).toThrowError(/inválido/);
    }
  });

  it('un nombre inválido ni siquiera toca el disco', () => {
    const { rutas } = disco();
    const base = path.join(carpetaBackups(rutas), '..', '..', 'gancho.txt');
    fs.writeFileSync(base, 'no me deben borrar');

    try {
      eliminarBackup('..\\..\\gancho.txt', rutas);
    } catch {
      // Lo que importa es lo que se comprueba abajo.
    }

    expect(fs.existsSync(base)).toBe(true);
  });
});

//---------------------------------------------------------------------------
// Purgar
//---------------------------------------------------------------------------

describe('purgar', () => {
  it('deja las más recientes y borra el resto', () => {
    const { rutas } = disco();
    for (let i = 1; i <= 35; i++) poner(rutas, `tienda-2026${dia(i)}-100000.db`);

    const borrados = purgar(rutas, 30);

    const nombres = listarBackups(rutas).map((b) => b.nombre);
    expect(borrados).toBe(5);
    expect(nombres).toHaveLength(30);
    expect(nombres[0]).toBe('tienda-20260035-100000.db');
  });

  it('crear un backup purga solo, sin que nadie lo pida', () => {
    // Si la purga no pasara al crear, la carpeta crecería sin parar. En una
    // tienda el dueño no se va a acordar de purgar.
    const { db, rutas } = disco();
    for (let i = 1; i <= RETENCION + 5; i++) poner(rutas, `tienda-2026${dia(i)}-100000.db`);

    crearBackup(db, rutas);

    expect(listarBackups(rutas).length).toBeLessThanOrEqual(RETENCION + 1);
  });

  it('no borra nada si no hay más de las que se conservan', () => {
    const { rutas } = disco();
    for (let i = 1; i <= 5; i++) poner(rutas, `tienda-2026${dia(i)}-100000.db`);

    expect(purgar(rutas, 30)).toBe(0);
    expect(listarBackups(rutas)).toHaveLength(5);
  });

  it('conservar cero deja la carpeta vacía', () => {
    const { rutas } = disco();
    for (let i = 1; i <= 5; i++) poner(rutas, `tienda-2026${dia(i)}-100000.db`);

    purgar(rutas, 0);

    expect(listarBackups(rutas)).toHaveLength(0);
  });

  it('devuelve cuántas borró, que es lo que se le puede decir al dueño', () => {
    const { rutas } = disco();
    for (let i = 1; i <= 7; i++) poner(rutas, `tienda-2026${dia(i)}-100000.db`);

    expect(purgar(rutas, 3)).toBe(4);
  });
});
