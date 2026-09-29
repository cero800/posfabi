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
  qObligatorio,
  qTodos,
  qUno,
  transaccion,
  versionEsquema,
} from './db.js';
import { SCHEMA_VERSION } from './schema.js';

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

  it('deja la base en la versión 1', () => {
    expect(versionEsquema(enMemoria())).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(1);
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
    // cliente inexistente sin error; con la pragma activa debe fallar.
    expect(() =>
      ejecutar(
        db,
        "INSERT INTO ventas (cliente_id, numero_factura, tipo, fecha, subtotal, descuento, impuesto, total) VALUES (999, 1, 'contado', '2026-01-01', 0, 0, 0, 0)",
      ),
    ).toThrow(/FOREIGN KEY/);
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
    expect(() =>
      ejecutar(db, 'INSERT INTO productos (codigo, nombre) VALUES (?, ?)', 'P1', 'Otro'),
    ).toThrow(/UNIQUE/);
  });

  it('no admite dos clientes con el mismo documento', () => {
    const db = enMemoria();
    ejecutar(db, 'INSERT INTO clientes (documento, nombre) VALUES (?, ?)', 'V-1', 'Ana');
    expect(() =>
      ejecutar(db, 'INSERT INTO clientes (documento, nombre) VALUES (?, ?)', 'V-1', 'Otra'),
    ).toThrow(/UNIQUE/);
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
    expect(() =>
      ejecutar(db, 'INSERT INTO productos (codigo, codigo_barras, nombre) VALUES (?,?,?)', 'P2', '7501', 'B'),
    ).toThrow(/UNIQUE/);
  });

  it('no admite dos categorías con el mismo nombre entre hermanas', () => {
    const db = enMemoria();
    ejecutar(db, 'INSERT INTO categorias (nombre) VALUES (?)', 'Oficina');
    expect(() => ejecutar(db, 'INSERT INTO categorias (nombre) VALUES (?)', 'Oficina')).toThrow(
      /UNIQUE/,
    );
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
