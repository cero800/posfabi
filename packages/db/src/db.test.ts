import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  abrir,
  enMemoria,
  estaEnTransaccion,
  ejecutar,
  ejecutarScript,
  hoy,
  qObligatorio,
  qTodos,
  qUno,
  transaccion,
  versionEsquema,
} from './db.js';
import { SCHEMA_VERSION } from './schema.js';
import { CODIGO_ERROR } from './errors.js';

/**
 * El código de error de la llamada, o la AssertionError si no falló.
 *
 * Estas pruebas ya no comprueban el texto crudo de SQLite: los helpers de
 * consulta lo traducen a un `AppError`, y el texto técnico es justamente lo que
 * no debe assertionar el código de negocio. Lo que importa es el código.
 */
function codigoDeError(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e && typeof e === 'object' && 'codigo' in e) return String((e as { codigo: string }).codigo);
  }
  throw new Error('se esperaba un error y no se lanzó');
}

/** Todas las tablas que el dominio necesita. */
const TABLAS = [
  'categorias',
  'clientes',
  'productos',
  'precios_cliente',
  'stock',
  'movimientos_inventario',
  'entradas_mercancia',
  'ventas',
  'detalle_ventas',
  'pagos',
  'devoluciones',
  'detalle_devoluciones',
  'usuarios',
  'cajas',
  'cierre_caja_pagos',
  'config',
];

describe('esquema', () => {
  it('crea todas las tablas del dominio', () => {
    const db = enMemoria();
    const existentes = new Set(
      qTodos<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type = 'table'").map(
        (t) => t.name,
      ),
    );
    for (const t of TABLAS) {
      expect(existentes.has(t), `falta la tabla ${t}`).toBe(true);
    }
  });

  it('deja la base en la versión actual', () => {
    expect(versionEsquema(enMemoria())).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(2);
  });

  it('migra una base v1 a v2 conservando los datos', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tienda-bd-'));
    const ruta = path.join(dir, 'tienda.db');

    // Base con el esquema v1 tal como lo tenían los clientes: usuarios sin
    // columnas de bloqueo y user_version = 1.
    const db = abrir(ruta);
    db.exec('DROP TABLE usuarios');
    db.exec(`CREATE TABLE usuarios (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre    TEXT NOT NULL,
      rol       TEXT NOT NULL DEFAULT 'cajero',
      pin       TEXT,
      activo    INTEGER NOT NULL DEFAULT 1,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.exec("INSERT INTO usuarios (nombre, rol, pin) VALUES ('Alex', 'cajero', '1234')");
    db.exec('PRAGMA user_version = 1');
    db.close();

    const otra = abrir(ruta);
    expect(versionEsquema(otra)).toBe(2);
    const fila = qUno<{ nombre: string; intentos_fallidos: number; bloqueado_hasta: string | null }>(
      otra,
      'SELECT nombre, intentos_fallidos, bloqueado_hasta FROM usuarios WHERE id = 1',
    );
    expect(fila).toEqual({ nombre: 'Alex', intentos_fallidos: 0, bloqueado_hasta: null });

    otra.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('es idempotente: abrir dos veces no rompe nada', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tienda-bd-'));
    const ruta = path.join(dir, 'tienda.db');

    const db = abrir(ruta);
    ejecutar(db, 'INSERT INTO categorias (nombre) VALUES (?)', 'Papelería');
    db.close();

    const otra = abrir(ruta);
    expect(qTodos(otra, 'SELECT nombre FROM categorias')).toEqual([{ nombre: 'Papelería' }]);
    otra.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('activa las claves foráneas', () => {
    const db = enMemoria();
    // Con foreign_keys apagado este INSERT dejaría una venta colgada de una
    // cliente inexistente sin error; con la pragma activa debe fallar, y el
    // fallo llega ya traducido.
    expect(
      codigoDeError(() =>
        ejecutar(
          db,
          "INSERT INTO ventas (cliente_id, numero_factura, tipo, fecha, subtotal, descuento, impuesto, total) VALUES (999, 1, 'contado', '2026-01-01', 0, 0, 0, 0)",
        ),
      ),
    ).toBe(CODIGO_ERROR.validacion);
  });

  it('rechaza una base de un esquema más nuevo que el que entiende la app', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tienda-bd-'));
    const ruta = path.join(dir, 'tienda.db');

    const db = abrir(ruta);
    db.exec('PRAGMA user_version = 99');
    db.close();

    expect(() => abrir(ruta)).toThrow(/esquema v99/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('restricciones de integridad', () => {
  it('no admite dos productos con el mismo código', () => {
    const db = enMemoria();
    ejecutar(db, 'INSERT INTO productos (codigo, nombre) VALUES (?, ?)', 'P1', 'Cuaderno');
    expect(
      codigoDeError(() =>
        ejecutar(db, 'INSERT INTO productos (codigo, nombre) VALUES (?, ?)', 'P1', 'Otro'),
      ),
    ).toBe(CODIGO_ERROR.duplicado);
  });

  it('no admite dos clientes con el mismo documento', () => {
    const db = enMemoria();
    ejecutar(db, 'INSERT INTO clientes (documento, nombre) VALUES (?, ?)', 'V-1', 'Ana');
    expect(
      codigoDeError(() =>
        ejecutar(db, 'INSERT INTO clientes (documento, nombre) VALUES (?, ?)', 'V-1', 'Otra'),
      ),
    ).toBe(CODIGO_ERROR.duplicado);
  });

  it('admite productos sin código de barras repetido', () => {
    const db = enMemoria();
    ejecutar(db, 'INSERT INTO productos (codigo, nombre) VALUES (?, ?)', 'P1', 'A');
    ejecutar(db, 'INSERT INTO productos (codigo, nombre) VALUES (?, ?)', 'P2', 'B');
    ejecutar(db, 'INSERT INTO productos (codigo, nombre) VALUES (?, ?)', 'P3', 'C');
    expect(qTodos(db, 'SELECT codigo FROM productos')).toHaveLength(3);
  });

  it('rechaza un código de barras repetido entre dos productos', () => {
    const db = enMemoria();
    ejecutar(db, 'INSERT INTO productos (codigo, codigo_barras, nombre) VALUES (?,?,?)', 'P1', '7501', 'A');
    expect(
      codigoDeError(() =>
        ejecutar(db, 'INSERT INTO productos (codigo, codigo_barras, nombre) VALUES (?,?,?)', 'P2', '7501', 'B'),
      ),
    ).toBe(CODIGO_ERROR.duplicado);
  });

  it('no admite dos categorías con el mismo nombre entre hermanas', () => {
    const db = enMemoria();
    ejecutar(db, 'INSERT INTO categorias (nombre) VALUES (?)', 'Oficina');
    expect(
      codigoDeError(() => ejecutar(db, 'INSERT INTO categorias (nombre) VALUES (?)', 'Oficina')),
    ).toBe(CODIGO_ERROR.duplicado);
  });

  it('sí admite el mismo nombre bajo padres distintos', () => {
    const db = enMemoria();
    ejecutar(db, 'INSERT INTO categorias (nombre) VALUES (?)', 'Oficina');
    const padre = Number(ejecutar(db, 'INSERT INTO categorias (nombre) VALUES (?)', 'Papelería').ultimoId);
    ejecutar(db, 'INSERT INTO categorias (nombre, parent_id) VALUES (?, ?)', 'Oficina', padre);
    expect(qTodos(db, 'SELECT nombre FROM categorias')).toHaveLength(3);
  });

  it('borra los precios especiales de un producto eliminado (CASCADE)', () => {
    const db = enMemoria();
    const c = Number(ejecutar(db, 'INSERT INTO clientes (documento, nombre) VALUES (?,?)', 'V-1', 'Ana').ultimoId);
    const p = Number(ejecutar(db, 'INSERT INTO productos (codigo, nombre) VALUES (?,?)', 'P1', 'Cuaderno').ultimoId);
    ejecutar(db, 'INSERT INTO precios_cliente (cliente_id, producto_id, precio_especial) VALUES (?,?,?)', c, p, 900);

    ejecutar(db, 'DELETE FROM productos WHERE id = ?', p);
    expect(qUno<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM precios_cliente')!.n).toBe(0);
  });
});

describe('transacciones', () => {
  const crear = (db: ReturnType<typeof enMemoria>, nombre: string) =>
    ejecutar(db, 'INSERT INTO categorias (nombre) VALUES (?)', nombre).ultimoId;

  it('confirma cuando el bloque termina bien', () => {
    const db = enMemoria();
    transaccion(db, () => {
      crear(db, 'Papelería');
      crear(db, 'Oficina');
    });
    expect(qTodos(db, 'SELECT nombre FROM categorias')).toHaveLength(2);
  });

  it('revierte todo cuando el bloque lanza', () => {
    const db = enMemoria();
    crear(db, 'Antes');

    expect(() =>
      transaccion(db, () => {
        crear(db, 'Dentro 1');
        crear(db, 'Dentro 2');
        throw new Error('fallo de negocio');
      }),
    ).toThrow('fallo de negocio');

    // Ninguna de las dos inserciones debe haber quedado.
    expect(qTodos<{ nombre: string }>(db, 'SELECT nombre FROM categorias').map((c) => c.nombre)).toEqual([
      'Antes',
    ]);
  });

  it('deja la conexión utilizable después de un fallo', () => {
    const db = enMemoria();
    expect(() => transaccion(db, () => { throw new Error('boom'); })).toThrow('boom');
    expect(estaEnTransaccion(db)).toBe(false);

    // La siguiente transacción debe funcionar con normalidad.
    transaccion(db, () => crear(db, 'Después'));
    expect(qTodos(db, 'SELECT nombre FROM categorias')).toHaveLength(1);
  });

  it('revierte una transacción anidada sin tocar la externa', () => {
    const db = enMemoria();

    transaccion(db, () => {
      crear(db, 'Exterior');
      try {
        transaccion(db, () => {
          crear(db, 'Interior A');
          crear(db, 'Interior B');
          throw new Error('falla en el savepoint');
        });
      } catch {
        // El llamador captura el fallo y sigue: el exterior sí debe confirmar.
      }
    });

    const nombres = qTodos<{ nombre: string }>(db, 'SELECT nombre FROM categorias').map((c) => c.nombre);
    expect(nombres).toEqual(['Exterior']);
  });

  it('revierte el exterior y también lo anidado cuando el error sube', () => {
    const db = enMemoria();
    crear(db, 'Antes');

    expect(() =>
      transaccion(db, () => {
        crear(db, 'Exterior');
        transaccion(db, () => {
          crear(db, 'Interior');
          throw new Error('falla profunda');
        });
      }),
    ).toThrow('falla profunda');

    expect(qTodos(db, 'SELECT nombre FROM categorias')).toHaveLength(1);
  });

  it('admite tres niveles de anidamiento', () => {
    const db = enMemoria();
    transaccion(db, () => {
      crear(db, 'N1');
      transaccion(db, () => {
        crear(db, 'N2');
        transaccion(db, () => crear(db, 'N3'));
      });
    });
    expect(qTodos(db, 'SELECT nombre FROM categorias')).toHaveLength(3);
    expect(estaEnTransaccion(db)).toBe(false);
  });

  it('reporta si hay una transacción abierta', () => {
    const db = enMemoria();
    expect(estaEnTransaccion(db)).toBe(false);
    transaccion(db, () => {
      expect(estaEnTransaccion(db)).toBe(true);
      transaccion(db, () => expect(estaEnTransaccion(db)).toBe(true));
      expect(estaEnTransaccion(db)).toBe(true);
    });
    expect(estaEnTransaccion(db)).toBe(false);
  });

  it('mantiene el contador por conexión, no global', () => {
    const a = enMemoria();
    const b = enMemoria();
    transaccion(a, () => {
      expect(estaEnTransaccion(a)).toBe(true);
      expect(estaEnTransaccion(b)).toBe(false);
    });
  });

  it('devuelve el valor del bloque', () => {
    const db = enMemoria();
    const id = transaccion(db, () => crear(db, 'X'));
    expect(id).toBe(1);
  });
});

describe('helpers de consulta', () => {
  it('qUno devuelve null si no hay filas', () => {
    expect(qUno(enMemoria(), 'SELECT 1 AS n WHERE 0')).toBeNull();
  });

  it('qObligatorio lanza no_encontrado', () => {
    expect(() => qObligatorio(enMemoria(), 'Cliente', 'SELECT 1 AS n WHERE 0')).toThrow(
      /Cliente no encontrado/,
    );
  });

  it('ejecutarScript corre varias sentencias', () => {
    const db = enMemoria();
    ejecutarScript(db, "INSERT INTO categorias (nombre) VALUES ('A'); INSERT INTO categorias (nombre) VALUES ('B');");
    expect(qTodos(db, 'SELECT nombre FROM categorias')).toHaveLength(2);
  });
});

/**
 * Zonas horarias para el test del día.
 *
 * Entre Kiritimati (UTC+14) y Midway (UTC-11) hay 25 horas de diferencia, así
 * que las dos nunca pueden caer en la misma fecha. Con las dos, siempre hay al
 * menos una que difiere de la fecha en UTC, y el test no puede volverse inocuo
 * por casualidad: si algún día el reloj del runner coincidiera con las dos, el
 * `expect` de la precondición fallaría y se vería, en vez de pasar sin comprobar
 * nada.
 */
const ZONAS = ['Pacific/Kiritimati', 'America/Caracas', 'Pacific/Midway'] as const;

describe('el día del negocio', () => {
  /**
   * `hoy()` con el reloj de JavaScript, para comparar.
   *
   * Se calcula con los accesores locales en vez de `toISOString()` a propósito:
   * `toISOString()` es UTC, que es justo lo que se está probando que no se usa.
   */
  const hoyLocal = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  it('es la fecha local, no la de UTC', () => {
    const tzOriginal = process.env.TZ;
    const db = enMemoria();
    try {
      for (const zona of ZONAS) {
        process.env.TZ = zona;
        expect(hoy(db), `con TZ=${zona}`).toBe(hoyLocal());
      }
    } finally {
      if (tzOriginal === undefined) delete process.env.TZ;
      else process.env.TZ = tzOriginal;
    }
  });

  /**
   * La mitad del test anterior se puede volver cierto sin querer: si a la hora
   * en que corre el runner happen las tres zonas dan la misma fecha que UTC, el
   * `expect` pasa tanto si el código usa `localtime` como si usa UTC. Esto
   * comprueba que el test realmente está midiendo algo, y falla si algún día se
   * rompe esa garantía.
   */
  it('el reloj del runner hace posible distinguir UTC de hora local', () => {
    const tzOriginal = process.env.TZ;
    try {
      const fechas = new Set<string>();
      for (const zona of [...ZONAS, 'UTC']) {
        process.env.TZ = zona;
        fechas.add(hoyLocal());
      }
      expect(fechas.size, 'ninguna zona difiere de UTC: el test no probaría nada').toBeGreaterThan(1);
    } finally {
      if (tzOriginal === undefined) delete process.env.TZ;
      else process.env.TZ = tzOriginal;
    }
  });
});
