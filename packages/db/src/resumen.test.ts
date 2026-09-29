import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';

import { resumenDia } from './resumen.js';
import { crearVenta } from './ventas.js';
import { registrarAbono } from './pagos.js';
import { registrarDevolucion } from './devoluciones.js';
import { registrarEntradaMercancia } from './repo.js';
import {
  abrirCaja,
  bd,
  cliente,
  clienteMostrador,
  hoy,
  producto,
  stock,
  tasa,
  usuario,
} from './testutil.js';

interface Ctx {
  db: DatabaseSync;
  op: number;
  ana: number;
  mostrador: number;
  cuaderno: number;
}

function escenario(): Ctx {
  const db = bd();
  const op = usuario(db, 'Alex');
  const ana = cliente(db, { documento: 'V-11111111', nombre: 'Ana Pérez' });
  const mostrador = clienteMostrador(db);
  abrirCaja(db, op);
  const cuaderno = producto(db, 100, { codigo: 'C-1', nombre: 'Cuaderno' });
  stock(db, cuaderno, 100);
  return { db, op, ana, mostrador, cuaderno };
}

/** Venta de contado de `cantidad` cuadernos a $0.10 cada uno. */
function vender(
  ctx: Ctx,
  cantidad: number,
  clienteId: number,
  tipo: 'contado' | 'credito' = 'contado',
  pagos: { monto: number; tipo_pago?: 'efectivo'; moneda?: 'usd' | 'ves' }[] = [],
): number {
  return crearVenta(ctx.db, {
    cliente_id: clienteId,
    tipo,
    descuento: 0,
    detalles: [{ producto_id: ctx.cuaderno, cantidad }],
    pagos: pagos.map((p) => ({
      monto: p.monto,
      tipo_pago: p.tipo_pago ?? 'efectivo',
      moneda: p.moneda ?? 'usd',
    })),
    operador_id: ctx.op,
  }).id;
}

//---------------------------------------------------------------------------

describe('resumenDia', () => {
  it('una base recién sembrada está en cero', () => {
    const r = resumenDia(bd());
    expect(r.ventas).toEqual([]);
    expect(r.entradas).toEqual([]);
    expect(r.devoluciones).toEqual([]);
    expect(r.deudores).toEqual([]);
    expect(r.pagos_efectivo_usd).toBe(0);
    expect(r.pagos_efectivo_ves).toBe(0);
  });

  it('lista las ventas del día con el nombre del cliente', () => {
    const ctx = escenario();
    vender(ctx, 3, ctx.mostrador, 'contado', [{ monto: 300 }]);

    const r = resumenDia(ctx.db);
    expect(r.ventas).toHaveLength(1);
    expect(r.ventas[0]).toMatchObject({
      cliente: 'Mostrador',
      tipo: 'contado',
      monto: 300,
      devuelto: 0,
      estado: 'entregada',
    });
  });

  it('acumula el efectivo en la moneda en que se cobró', () => {
    const ctx = escenario();
    tasa(ctx.db, 10);
    // Dos ventas de $1.00: una cobrada en dólares, otra en Bs 1000 (=$1.00 a
    // tasa 10). Los dos bills entran por separado al arqueo de la gaveta.
    vender(ctx, 1, ctx.mostrador, 'contado', [{ monto: 100 }]);
    vender(ctx, 1, ctx.mostrador, 'contado', [{ monto: 1000, moneda: 'ves' }]);

    const r = resumenDia(ctx.db);
    expect(r.pagos_efectivo_usd).toBe(100);
    expect(r.pagos_efectivo_ves).toBe(1000);
  });

  it('no cuenta las ventas anuladas', () => {
    const ctx = escenario();
    const v = vender(ctx, 3, ctx.mostrador, 'contado', [{ monto: 300 }]);
    ctx.db.prepare("UPDATE ventas SET estado = 'anulada' WHERE id = ?").run(v);
    expect(resumenDia(ctx.db).ventas).toHaveLength(0);
  });

  it('solo lista los deudores: quien está al día no aparece', () => {
    const ctx = escenario();
    vender(ctx, 5, ctx.ana, 'credito'); // Ana debe 500
    vender(ctx, 1, ctx.mostrador, 'contado', [{ monto: 100 }]);

    const r = resumenDia(ctx.db);
    expect(r.deudores).toHaveLength(1);
    expect(r.deudores[0]).toMatchObject({ cliente_id: ctx.ana, saldo_pendiente: 500 });
  });

  it('lista las entradas de mercadería del día', () => {
    const ctx = escenario();
    registrarEntradaMercancia(ctx.db, {
      producto_id: ctx.cuaderno,
      cantidad: 50,
      costo_unitario: 60,
      operador_id: ctx.op,
      fecha: hoy(ctx.db),
    });

    expect(resumenDia(ctx.db).entradas).toEqual([
      { producto: 'Cuaderno', cantidad: 50, costo_unitario: 60 },
    ]);
  });

  it('las devoluciones del día traen su detalle', () => {
    const ctx = escenario();
    const v = vender(ctx, 3, ctx.ana, 'credito');
    registrarDevolucion(ctx.db, {
      cliente_id: ctx.ana,
      venta_id: v,
      monto: 100,
      motivo: 'no le gustó',
      afecta_stock: false,
      operador_id: ctx.op,
      detalle: [{ producto_id: ctx.cuaderno, cantidad: 1, precio_unitario: 100 }],
    });

    const r = resumenDia(ctx.db);
    expect(r.devoluciones).toHaveLength(1);
    expect(r.devoluciones[0]).toMatchObject({
      cliente: 'Ana Pérez',
      numero_factura: 1,
      monto: 100,
      motivo: 'no le gustó',
      operador_nombre: 'Alex',
    });
    expect(r.devoluciones[0]?.detalle).toEqual([
      { producto_id: ctx.cuaderno, nombre: 'Cuaderno', cantidad: 1, precio_unitario: 100, subtotal: 100 },
    ]);
  });

  it('el neto de una venta con devolución cuadra por los dos lados', () => {
    // La lista de ventas y la de devoluciones se miran por fechas distintas
    // (fecha de la venta contra fecha de la devolución), así que un cliente
    // puede tener devoluciones de facturas de ayer. El resumen tiene que
    // seguir cuadrando: hoy se vendió X y se devolvió Y.
    const ctx = escenario();
    const v = vender(ctx, 10, ctx.ana, 'credito');
    registrarDevolucion(ctx.db, {
      cliente_id: ctx.ana,
      venta_id: v,
      monto: 300,
      motivo: 'tres rotos',
      afecta_stock: false,
      operador_id: ctx.op,
    });

    const r = resumenDia(ctx.db);
    expect(r.ventas[0]?.monto).toBe(1000);
    expect(r.devoluciones[0]?.monto).toBe(300);
    // La devolución de HOY descuenta la venta de HOY, que es lo que ve el
    // comprobante de cierre: 1000 − 300 = 700.
    expect((r.ventas[0]?.monto ?? 0) - (r.devoluciones[0]?.monto ?? 0)).toBe(700);
  });

  it('un abono a cuenta no cuenta como venta del día', () => {
    const ctx = escenario();
    vender(ctx, 5, ctx.ana, 'credito');
    registrarAbono(ctx.db, {
      cliente_id: ctx.ana,
      pagos: [{ monto: 200, tipo_pago: 'efectivo', moneda: 'usd' }],
      operador_id: ctx.op,
    });

    const r = resumenDia(ctx.db);
    expect(r.ventas).toHaveLength(1);
    // Pero sí es efectivo que entró a la gaveta.
    expect(r.pagos_efectivo_usd).toBe(200);
  });

  it('acepta una fecha explícita', () => {
    const ctx = escenario();
    vender(ctx, 1, ctx.mostrador, 'contado', [{ monto: 100 }]);

    // Nada de lo de hoy cae en una fecha que no existe.
    expect(resumenDia(ctx.db, '2020-01-01').ventas).toEqual([]);
    expect(resumenDia(ctx.db, '2020-01-01').entradas).toEqual([]);
  });
});
