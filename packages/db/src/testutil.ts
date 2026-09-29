// Fixtures para las pruebas.
//
// Equivalente de `testutil.rs` en el backend original: helpers que dejan una
// base en memoria con los datos mínimos que necesita cada caso. Los tests los
// importan con `import { ... } from './testutil.js'`.

import type { DatabaseSync } from 'node:sqlite';

import { enMemoria, hoy, qUno } from './db.js';
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

/**
 * Crea el cliente de mostrador (sin crédito) y devuelve su id.
 *
 * Se marca `es_mostrador = 1` igual que hace el sembrado. Importa: las ventas
 * a crédito se rechazan para el mostrador, así que una prueba de crédito que
 * usara este cliente fallaría por una razón que no es la que se quiere probar.
 */
export function clienteMostrador(db: DatabaseSync): number {
  return Number(
    db
      .prepare(
        `INSERT INTO clientes (documento, nombre, dias_credito, limite_credito, es_mostrador, activo)
         VALUES (?, 'Mostrador', 0, 0, 1, 1)`,
      )
      .run('V-00000000').lastInsertRowid,
  );
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

/**
 * Inserta una venta vacía y devuelve su id.
 *
 * Existe porque `movimientos_inventario.venta_id` tiene clave foránea: los
 * movimientos que nacen de una venta no se pueden probar sin una venta real de
 * la que colgarlos. El total es 0 porque a estas alturas lo que importa es que
 * exista la fila.
 */
export function venta(db: DatabaseSync, opciones: { clienteId?: number; operadorId?: number } = {}): number {
  const clienteId = opciones.clienteId ?? clienteMostrador(db);
  // numero_factura es UNIQUE, así que se deriva del siguiente id para que dos
  // ventas en la misma base no choquen.
  const siguiente = Number(
    qUno<{ n: number }>(db, 'SELECT COALESCE(MAX(numero_factura), 0) + 1 AS n FROM ventas')?.n ?? 1,
  );
  return Number(
    db
      .prepare(
        `INSERT INTO ventas (cliente_id, numero_factura, tipo, fecha, total, moneda, tasa_cambio, operador_id)
         VALUES (?, ?, 'contado', date('now'), 0, 'usd', 1, ?)`,
      )
      .run(clienteId, siguiente, opciones.operadorId ?? null).lastInsertRowid,
  );
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

// `hoy` se reexporta desde `db.ts` para que las pruebas y el código usen la
// misma lectura de la fecha. Un `new Date()` en una prueba archivaría la venta
// en el día UTC, que a las nueve de la noche en Caracas ya es mañana, y el
// resumen del día no la encontraría.
export { hoy };
