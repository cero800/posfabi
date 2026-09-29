import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { DevolucionInput } from '@tienda/core';

import { qUno } from './db.js';
import { CODIGO_ERROR } from './errors.js';
import {
  detalleDevolucion,
  detalleVenta,
  listarDevoluciones,
  listarVentasCliente,
  registrarDevolucion,
} from './devoluciones.js';
import { crearVenta } from './ventas.js';
import { cantidadDisponible } from './repo.js';
import { estadoCuenta } from './deudores.js';
import {
  abrirCaja,
  bd,
  cliente,
  producto,
  stock,
  usuario,
} from './testutil.js';

//---------------------------------------------------------------------------
// Andamiaje
//---------------------------------------------------------------------------

interface Ctx {
  db: DatabaseSync;
  op: number;
  ana: number;
  cuaderno: number;
  regla: number;
}

/**
 * Base con Ana y dos productos (10 y 100 unidades), y una venta a crédito de
 * 3 cuadernos + 2 reglas: 3×100 + 2×50 = 400 centavos.
 */
function escenario(): Ctx {
  const db = bd();
  const op = usuario(db, 'Alex');
  const ana = cliente(db, { documento: 'V-11111111', nombre: 'Ana Pérez' });
  abrirCaja(db, op);

  const cuaderno = producto(db, 100, { codigo: 'C-1', nombre: 'Cuaderno' });
  const regla = producto(db, 50, { codigo: 'R-1', nombre: 'Regla' });
  stock(db, cuaderno, 10);
  stock(db, regla, 100);

  return { db, op, ana, cuaderno, regla };
}

/** Venta a crédito de 3 cuadernos y 2 reglas a Ana. */
function ventaDe400(db: DatabaseSync, { ana, cuaderno, regla, op }: Ctx): number {
  return crearVenta(db, {
    cliente_id: ana,
    tipo: 'credito',
    descuento: 0,
    detalles: [
      { producto_id: cuaderno, cantidad: 3 },
      { producto_id: regla, cantidad: 2 },
    ],
    pagos: [],
    operador_id: op,
  }).id;
}

/** Devolución de un cuaderno de la venta dada. */
function devolucionDe(ventaId: number, ctx: Ctx, sobre: Partial<DevolucionInput> = {}) {
  return registrarDevolucion(ctx.db, {
    cliente_id: ctx.ana,
    venta_id: ventaId,
    monto: 100,
    motivo: 'no le gustó',
    afecta_stock: false,
    operador_id: ctx.op,
    detalle: [{ producto_id: ctx.cuaderno, cantidad: 1, precio_unitario: 100 }],
    ...sobre,
  });
}

function codigoDe(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e && typeof e === 'object' && 'codigo' in e) return String((e as { codigo: string }).codigo);
  }
  throw new Error('se esperaba un error y no se lanzó');
}

function mensajeDe(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error('se esperaba un error y no se lanzó');
}

//---------------------------------------------------------------------------
// Registro
//---------------------------------------------------------------------------

describe('registrarDevolucion', () => {
  it('devuelve el número de factura y el detalle con el nombre del producto', () => {
    const ctx = escenario();
    const venta = ventaDe400(ctx.db, ctx);

    const d = devolucionDe(venta, ctx);

    expect(d.numero_factura).toBe(1);
    expect(d.monto).toBe(100);
    expect(d.motivo).toBe('no le gustó');
    expect(d.detalle).toEqual([
      { producto_id: ctx.cuaderno, nombre: 'Cuaderno', cantidad: 1, precio_unitario: 100, subtotal: 100 },
    ]);
  });

  it('acepta una devolución sin detalle, solo por monto', () => {
    const ctx = escenario();
    const venta = ventaDe400(ctx.db, ctx);

    // Es el caso de un ajuste contable: se descarta mercadería sin identificar
    // cuál (o toda, si estaba dañada). El monto es lo que baja la deuda.
    const d = registrarDevolucion(ctx.db, {
      cliente_id: ctx.ana,
      venta_id: venta,
      monto: 50,
      motivo: 'ajuste por daño',
      afecta_stock: false,
      operador_id: ctx.op,
    });

    expect(d.detalle).toEqual([]);
    expect(estadoCuenta(ctx.db, ctx.ana).total_facturado).toBe(350);
  });

  it('baja lo facturado del cliente', () => {
    const ctx = escenario();
    const venta = ventaDe400(ctx.db, ctx);
    expect(estadoCuenta(ctx.db, ctx.ana).saldo_pendiente).toBe(400);

    devolucionDe(venta, ctx);
    expect(estadoCuenta(ctx.db, ctx.ana).saldo_pendiente).toBe(300);
  });

  it('no toca la caja ni la factura original', () => {
    const ctx = escenario();
    const venta = ventaDe400(ctx.db, ctx);
    devolucionDe(venta, ctx);

    expect(qUno<{ total: number; estado: string }>(ctx.db, 'SELECT total, estado FROM ventas WHERE id = ?', venta)).toEqual({
      total: 400,
      estado: 'entregada',
    });
  });

  it('guarda el motivo aunque venga vacío', () => {
    const ctx = escenario();
    const venta = ventaDe400(ctx.db, ctx);
    const d = registrarDevolucion(ctx.db, {
      cliente_id: ctx.ana,
      venta_id: venta,
      monto: 100,
      motivo: null,
      afecta_stock: false,
      operador_id: ctx.op,
    });
    expect(d.motivo).toBeNull();
  });
});

//---------------------------------------------------------------------------
// El detalle tiene que cuadrar
//---------------------------------------------------------------------------

describe('el detalle tiene que cuadrar con el monto', () => {
  it('rechaza un detalle que no suma el monto', () => {
    const ctx = escenario();
    const venta = ventaDe400(ctx.db, ctx);
    expect(
      mensajeDe(() => registrarDevolucion(ctx.db, {
        cliente_id: ctx.ana,
        venta_id: venta,
        monto: 500,
        motivo: 'x',
        afecta_stock: false,
        operador_id: ctx.op,
        detalle: [{ producto_id: ctx.cuaderno, cantidad: 1, precio_unitario: 100 }], // 100 ≠ 500
      })),
    ).toMatch(/no coincide con el monto/);
    expect(estadoCuenta(ctx.db, ctx.ana).saldo_pendiente).toBe(400);
  });

  it('rechaza una cantidad de cero en el detalle', () => {
    const ctx = escenario();
    const venta = ventaDe400(ctx.db, ctx);
    expect(
      codigoDe(() => registrarDevolucion(ctx.db, {
        cliente_id: ctx.ana,
        venta_id: venta,
        monto: 0,
        motivo: 'x',
        afecta_stock: false,
        operador_id: ctx.op,
        detalle: [{ producto_id: ctx.cuaderno, cantidad: 0, precio_unitario: 100 }],
      })),
    ).toBe(CODIGO_ERROR.validacion);
  });

  it('rechaza un precio unitario de cero', () => {
    const ctx = escenario();
    const venta = ventaDe400(ctx.db, ctx);
    expect(
      codigoDe(() => registrarDevolucion(ctx.db, {
        cliente_id: ctx.ana,
        venta_id: venta,
        monto: 0,
        motivo: 'x',
        afecta_stock: false,
        operador_id: ctx.op,
        detalle: [{ producto_id: ctx.cuaderno, cantidad: 1, precio_unitario: 0 }],
      })),
    ).toBe(CODIGO_ERROR.validacion);
  });

  it('rechaza un monto de devolución de cero o negativo', () => {
    const ctx = escenario();
    const venta = ventaDe400(ctx.db, ctx);
    for (const monto of [0, -100]) {
      expect(
        codigoDe(() => registrarDevolucion(ctx.db, {
          cliente_id: ctx.ana,
          venta_id: venta,
          monto,
          motivo: 'x',
          afecta_stock: false,
          operador_id: ctx.op,
        })),
      ).toBe(CODIGO_ERROR.validacion);
    }
  });
});

//---------------------------------------------------------------------------
// La factura que se devuelve
//---------------------------------------------------------------------------

describe('la factura que se devuelve', () => {
  it('no devuelve más que el total de la factura', () => {
    const ctx = escenario();
    const venta = ventaDe400(ctx.db, ctx);
    expect(
      mensajeDe(() => registrarDevolucion(ctx.db, {
        cliente_id: ctx.ana,
        venta_id: venta,
        monto: 401,
        motivo: 'x',
        afecta_stock: false,
        operador_id: ctx.op,
      })),
    ).toMatch(/supera el saldo devoluble/);
  });

  it('devuelve exactamente el total de la factura', () => {
    const ctx = escenario();
    const venta = ventaDe400(ctx.db, ctx);
    registrarDevolucion(ctx.db, {
      cliente_id: ctx.ana,
      venta_id: venta,
      monto: 400,
      motivo: 'todo devuelto',
      afecta_stock: false,
      operador_id: ctx.op,
    });
    expect(estadoCuenta(ctx.db, ctx.ana).total_facturado).toBe(0);
  });

  it('acumula devoluciones y no deja devolver dos veces lo mismo', () => {
    const ctx = escenario();
    const venta = ventaDe400(ctx.db, ctx);
    devolucionDe(venta, ctx); // 100
    devolucionDe(venta, ctx); // 100 más → 200 devueltos de 400

    expect(listarVentasCliente(ctx.db, ctx.ana)[0]?.devuelto).toBe(200);
    expect(
      mensajeDe(() => registrarDevolucion(ctx.db, {
        cliente_id: ctx.ana,
        venta_id: venta,
        monto: 201,
        motivo: 'x',
        afecta_stock: false,
        operador_id: ctx.op,
      })),
    ).toMatch(/supera el saldo devoluble/);

    // Lo que queda: 400 − 200 = 200. Todavía se puede devolver eso.
    registrarDevolucion(ctx.db, {
      cliente_id: ctx.ana,
      venta_id: venta,
      monto: 200,
      motivo: 'resto',
      afecta_stock: false,
      operador_id: ctx.op,
    });
    expect(estadoCuenta(ctx.db, ctx.ana).total_facturado).toBe(0);
  });

  it('no devuelve una factura de otro cliente', () => {
    const ctx = escenario();
    const venta = ventaDe400(ctx.db, ctx);
    const otro = cliente(ctx.db, { documento: 'V-99999999', nombre: 'Otro' });
    expect(
      codigoDe(() => registrarDevolucion(ctx.db, {
        cliente_id: otro,
        venta_id: venta,
        monto: 100,
        motivo: 'x',
        afecta_stock: false,
        operador_id: ctx.op,
      })),
    ).toBe(CODIGO_ERROR.no_encontrado);
  });

  it('no devuelve una venta inexistente', () => {
    const ctx = escenario();
    expect(
      codigoDe(() => registrarDevolucion(ctx.db, {
        cliente_id: ctx.ana,
        venta_id: 999,
        monto: 100,
        motivo: 'x',
        afecta_stock: false,
        operador_id: ctx.op,
      })),
    ).toBe(CODIGO_ERROR.no_encontrado);
  });

  it('no devuelve una venta anulada', () => {
    const ctx = escenario();
    const venta = ventaDe400(ctx.db, ctx);
    ctx.db.prepare("UPDATE ventas SET estado = 'anulada' WHERE id = ?").run(venta);
    expect(
      mensajeDe(() => registrarDevolucion(ctx.db, {
        cliente_id: ctx.ana,
        venta_id: venta,
        monto: 100,
        motivo: 'x',
        afecta_stock: false,
        operador_id: ctx.op,
      })),
    ).toMatch(/Solo se pueden devolver ventas entregadas/);
  });
});

//---------------------------------------------------------------------------
// Reingreso al inventario
//---------------------------------------------------------------------------

describe('afecta_stock', () => {
  it('con la casilla marcada, la mercadería vuelve al stock', () => {
    const ctx = escenario();
    const venta = ventaDe400(ctx.db, ctx);
    // Se vendieron 3 cuadernos: quedan 7.
    expect(cantidadDisponible(ctx.db, ctx.cuaderno)).toBe(7);

    devolucionDe(venta, ctx, { afecta_stock: true });

    expect(cantidadDisponible(ctx.db, ctx.cuaderno)).toBe(8);
    expect(
      qUno<{ tipo: string; cantidad: number; motivo: string }>(
        ctx.db,
        'SELECT tipo, cantidad, motivo FROM movimientos_inventario WHERE tipo = ? ORDER BY id DESC LIMIT 1',
        'devolucion',
      ),
    ).toEqual({
      tipo: 'devolucion',
      cantidad: 1,
      motivo: 'Devolución de la factura 1',
    });
  });

  it('con la casilla sin marcar, el stock no se toca', () => {
    const ctx = escenario();
    const venta = ventaDe400(ctx.db, ctx);
    devolucionDe(venta, ctx, { afecta_stock: false });
    expect(cantidadDisponible(ctx.db, ctx.cuaderno)).toBe(7);
  });

  it('el asiento de reingreso no cuelga de la venta, sino de la devolución', () => {
    const ctx = escenario();
    const venta = ventaDe400(ctx.db, ctx);
    devolucionDe(venta, ctx, { afecta_stock: true });
    // `movimientos_inventario.venta_id` queda nulo a propósito: el movimiento
    // lo justifica la devolución, no la venta. Si colgara de la venta, al
    // anularla el ajuste de stock se borraría en cascada.
    expect(
      qUno<{ venta_id: number | null }>(
        ctx.db,
        'SELECT venta_id FROM movimientos_inventario WHERE tipo = ?',
        'devolucion',
      )?.venta_id,
    ).toBeNull();
  });

  it('una devolución sin detalle no reingresa nada', () => {
    const ctx = escenario();
    const venta = ventaDe400(ctx.db, ctx);
    registrarDevolucion(ctx.db, {
      cliente_id: ctx.ana,
      venta_id: venta,
      monto: 50,
      motivo: 'ajuste contable',
      afecta_stock: true, // marcado, pero no hay qué producto reingresar
      operador_id: ctx.op,
    });
    expect(cantidadDisponible(ctx.db, ctx.cuaderno)).toBe(7);
  });

  it('si algo falla a mitad, la devolución entera tampoco se guarda', () => {
    const ctx = escenario();
    const venta = ventaDe400(ctx.db, ctx);
    // Se da de baja el cuaderno a mano y se borra su catálogo, dejando el
    // historial de la venta. Con `afecta_stock` marcado, algo tiene que fallar
    // al asentar el reingreso. Lo que se comprueba es que la transacción
    // revierte la cabecera ya insertada: una deuda bajada sin devolución que la
    // justifique no se puede detectar ni corregir después.
    ctx.db.prepare('DELETE FROM detalle_ventas WHERE producto_id = ?').run(ctx.cuaderno);
    ctx.db.prepare('DELETE FROM movimientos_inventario WHERE producto_id = ?').run(ctx.cuaderno);
    ctx.db.prepare('DELETE FROM stock WHERE producto_id = ?').run(ctx.cuaderno);
    ctx.db.prepare('DELETE FROM productos WHERE id = ?').run(ctx.cuaderno);

    expect(
      codigoDe(() => registrarDevolucion(ctx.db, {
        cliente_id: ctx.ana,
        venta_id: venta,
        monto: 100,
        motivo: 'x',
        afecta_stock: true,
        operador_id: ctx.op,
        detalle: [{ producto_id: ctx.cuaderno, cantidad: 1, precio_unitario: 100 }],
      })),
    ).toBe(CODIGO_ERROR.validacion);

    expect(estadoCuenta(ctx.db, ctx.ana).total_facturado).toBe(400);
    expect(listarDevoluciones(ctx.db, ctx.ana)).toHaveLength(0);
  });
});

//---------------------------------------------------------------------------
// Consultas
//---------------------------------------------------------------------------

describe('consultas de devoluciones', () => {
  it('lista las facturas del cliente con lo ya devuelto', () => {
    const ctx = escenario();
    const venta = ventaDe400(ctx.db, ctx);
    expect(listarVentasCliente(ctx.db, ctx.ana)).toEqual([
      { venta_id: venta, numero_factura: 1, tipo: 'credito', fecha: expect.any(String), total: 400, devuelto: 0 },
    ]);

    devolucionDe(venta, ctx);
    expect(listarVentasCliente(ctx.db, ctx.ana)[0]?.devuelto).toBe(100);
  });

  it('solo lista ventas entregadas', () => {
    const ctx = escenario();
    const venta = ventaDe400(ctx.db, ctx);
    ctx.db.prepare("UPDATE ventas SET estado = 'anulada' WHERE id = ?").run(venta);
    expect(listarVentasCliente(ctx.db, ctx.ana)).toHaveLength(0);
  });

  it('trae las líneas de la venta para el modal', () => {
    const ctx = escenario();
    const venta = ventaDe400(ctx.db, ctx);
    expect(detalleVenta(ctx.db, venta)).toEqual([
      { producto_id: ctx.cuaderno, nombre: 'Cuaderno', cantidad: 3, precio_unitario: 100, subtotal: 300 },
      { producto_id: ctx.regla, nombre: 'Regla', cantidad: 2, precio_unitario: 50, subtotal: 100 },
    ]);
  });

  it('trae el historial de devoluciones con su detalle', () => {
    const ctx = escenario();
    const venta = ventaDe400(ctx.db, ctx);
    devolucionDe(venta, ctx, { afecta_stock: true });

    const lista = listarDevoluciones(ctx.db, ctx.ana);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({
      cliente_id: ctx.ana,
      venta_id: venta,
      numero_factura: 1,
      monto: 100,
      motivo: 'no le gustó',
      // Sale como booleano, no como 0/1 de SQLite.
      afecta_stock: true,
    });
    expect(lista[0]?.detalle).toHaveLength(1);
  });

  it('detalleDevolucion de una devolución sin detalle devuelve una lista vacía', () => {
    const ctx = escenario();
    const venta = ventaDe400(ctx.db, ctx);
    const d = registrarDevolucion(ctx.db, {
      cliente_id: ctx.ana,
      venta_id: venta,
      monto: 50,
      motivo: 'x',
      afecta_stock: false,
      operador_id: ctx.op,
    });
    expect(detalleDevolucion(ctx.db, d.id)).toEqual([]);
  });

  it('el historial de un cliente sin devoluciones está vacío', () => {
    const ctx = escenario();
    ventaDe400(ctx.db, ctx);
    expect(listarDevoluciones(ctx.db, ctx.ana)).toEqual([]);
  });
});
