// Fixtures para las pruebas.
//
// Equivalente de `testutil.rs` en el backend original: helpers que dejan una
// base en memoria con los datos mínimos que necesita cada caso. Se importan
// desde los tests con `import { ... } from '../testutil.js'`.

import type { DatabaseSync } from 'node:sqlite';

import { enMemoria, qUno } from './db.js';
import { PIN_ADMIN_POR_DEFECTO } from './seed.js';

/** Base nueva en memoria con el esquema aplicado. */
export function bd(): DatabaseSync {
  return enMemoria();
}

/** Fija la tasa de cambio (Bs por 1 US$). */
export function tasa(db: DatabaseSync, valor: number): void {
  db.prepare(
    "INSERT INTO config (clave, valor) VALUES ('tasa_cambio', ?) " +
      'ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor',
  ).run(String(valor));
}

/** Crea un usuario admin con PIN y devuelve su id. */
export function usuario(db: DatabaseSync, nombre = 'Test'): number {
  return Number(
    db
      .prepare("INSERT INTO usuarios (nombre, rol, pin) VALUES (?, 'admin', ?)")
      .run(nombre, PIN_ADMIN_POR_DEFECTO).lastInsertRowid,
  );
}

/** Crea un cliente con crédito y devuelve su id. */
export function cliente(
  db: DatabaseSync,
  opciones: { documento?: string; nombre?: string; dias_credito?: number } = {},
): number {
  const documento = opciones.documento ?? 'V-12345678';
  const nombre = opciones.nombre ?? 'Cliente de Prueba';
  const dias = opciones.dias_credito ?? 30;
  return Number(
    db
      .prepare(
        `INSERT INTO clientes (documento, nombre, dias_credito, limite_credito, activo)
         VALUES (?, ?, ?, 0, 1)`,
      )
      .run(documento, nombre, dias).lastInsertRowid,
  );
}

/** Crea el cliente de mostrador (sin crédito) y devuelve su id. */
export function clienteMostrador(db: DatabaseSync): number {
  return cliente(db, { documento: '0', nombre: 'Mostrador', dias_credito: 0 });
}

/** Crea un producto con el precio dado y devuelve su id. */
export function producto(
  db: DatabaseSync,
  precio: number,
  opciones: { codigo?: string; nombre?: string } = {},
): number {
  const codigo = opciones.codigo ?? `P${precio}`;
  const nombre = opciones.nombre ?? `Producto ${precio}`;
  return Number(
    db
      .prepare(
        `INSERT INTO productos (codigo, nombre, unidad_medida, precio_base, activo)
         VALUES (?, ?, 'unidad', ?, 1)`,
      )
      .run(codigo, nombre, precio).lastInsertRowid,
  );
}

/** Fija el stock de un producto directamente, sin pasar por movimientos. */
export function stock(db: DatabaseSync, productoId: number, cantidad: number): void {
  db.prepare(
    `INSERT INTO stock (producto_id, cantidad_disponible) VALUES (?, ?)
     ON CONFLICT(producto_id) DO UPDATE SET cantidad_disponible = excluded.cantidad_disponible`,
  ).run(productoId, cantidad);
}

/** Abre una caja de hoy para el operador dado. */
export function abrirCaja(db: DatabaseSync, operadorId: number): number {
  return Number(
    db
      .prepare(
        `INSERT INTO cajas (fecha, operador_id, estado) VALUES (date('now'), ?, 'abierta')`,
      )
      .run(operadorId).lastInsertRowid,
  );
}

/** Lee una clave de configuración. */
export function config(db: DatabaseSync, clave: string): string | null {
  return qUno<{ valor: string | null }>(db, 'SELECT valor FROM config WHERE clave = ?', clave)
    ?.valor ?? null;
}
