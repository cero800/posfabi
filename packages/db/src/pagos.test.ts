import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';

import { qTodos } from './db.js';
import { CODIGO_ERROR } from './errors.js';
import { estadoCuenta, estadoCuentaTodos } from './deudores.js';
import { historialPagos, registrarAbono } from './pagos.js';
import { crearVenta, anularVenta } from './ventas.js';
import { registrarDevolucion } from './devoluciones.js';
import {
  abrirCaja,
  bd,
  cliente,
  producto,
  stock,
  tasa,
  usuario,
} from './testutil.js';

//---------------------------------------------------------------------------
// Andamiaje
//---------------------------------------------------------------------------

/** Base con caja abierta, Ana (crédito) y Luis (crédito, plazo de 0 días). */
function escenario(): {
  db: DatabaseSync;
  op: number;
  ana: number;
  luis: number;
  p: number;
} {
  const db = bd();
  const op = usuario(db, 'Alex');
  const ana = cliente(db, { documento: 'V-11111111', nombre: 'Ana Pérez', dias_credito: 30 });
  const luis = cliente(db, { documento: 'V-22222222', nombre: 'Luis Gómez', dias_credito: 0 });
  abrirCaja(db, op);
  const p = producto(db, 100);
  stock(db, p, 1000);
  return { db, op, ana, luis, p };
}

/** Venta a crédito de `cantidad` unidades a `clienteId`. */
function venderACredito(
  db: DatabaseSync,
  productoId: number,
  cantidad: number,
  clienteId: number,
  op: number,
): number {
  return crearVenta(db, {
    cliente_id: clienteId,
    tipo: 'credito',
    descuento: 0,
    detalles: [{ producto_id: productoId, cantidad }],
    pagos: [],
    operador_id: op,
  }).id;
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

/** Reprograma la fecha de una venta, para probar el FIFO sin esperar días. */
function fechaDeVenta(db: DatabaseSync, ventaId: number, fecha: string): void {
  db.prepare('UPDATE ventas SET fecha = ? WHERE id = ?').run(fecha, ventaId);
}

//---------------------------------------------------------------------------
// Derivación del saldo
//---------------------------------------------------------------------------

describe('estadoCuenta', () => {
  it('un cliente sin movimientos no debe nada', () => {
    const { db, ana } = escenario();
    expect(estadoCuenta(db, ana)).toEqual({
      cliente_id: ana,
      nombre: 'Ana Pérez',
      total_facturado: 0,
      total_pagado: 0,
      saldo_pendiente: 0,
      total_vencido: 0,
      total_al_dia: 0,
      dias_credito: 30,
    });
  });

  it('acumula las ventas como factura y saldo', () => {
    const { db, ana, p, op } = escenario();
    venderACredito(db, p, 5, ana, op);  // 500
    venderACredito(db, p, 3, ana, op);  // 300

    const e = estadoCuenta(db, ana);
    expect(e.total_facturado).toBe(800);
    expect(e.saldo_pendiente).toBe(800);
  });

  it('resta lo pagado del saldo', () => {
    const { db, ana, p, op } = escenario();
    venderACredito(db, p, 5, ana, op); // 500
    registrarAbono(db, {
      cliente_id: ana,
      pagos: [{ monto: 200, tipo_pago: 'efectivo', moneda: 'usd' }],
      operador_id: op,
    });

    const e = estadoCuenta(db, ana);
    expect(e.total_facturado).toBe(500);
    expect(e.total_pagado).toBe(200);
    expect(e.saldo_pendiente).toBe(300);
  });

  it('convierte los abonos en bolívares con la tasa de cada pago', () => {
    const { db, ana, p, op } = escenario();
    tasa(db, 10);
    venderACredito(db, p, 10, ana, op); // $10.00 = 1000 centavos

    registrarAbono(db, {
      cliente_id: ana,
      pagos: [{ monto: 500, tipo_pago: 'pago_movil', moneda: 'ves', numero_referencia: '1' }],
      operador_id: op,
    });

    // 500 Bs a tasa 10 son 50 centavos US$.
    expect(estadoCuenta(db, ana).saldo_pendiente).toBe(950);
  });

  it('usa la tasa del pago, no la de hoy', () => {
    const { db, ana, p, op } = escenario();
    tasa(db, 10);
    venderACredito(db, p, 10, ana, op); // 1000 centavos

    registrarAbono(db, {
      cliente_id: ana,
      pagos: [{ monto: 500, tipo_pago: 'pago_movil', moneda: 'ves', numero_referencia: '1' }],
      operador_id: op,
    });

    // La tasa se duplica después del abono. El pago sigue valiendo 50 centavos,
    // no 25: si se recalculara con la tasa nueva, el saldo del cliente cambiaría
    // solo por un cambio de precio del dólar.
    tasa(db, 20);
    expect(estadoCuenta(db, ana).saldo_pendiente).toBe(950);
  });

  it('las devoluciones bajan lo facturado', () => {
    const { db, ana, p, op } = escenario();
    const venta = venderACredito(db, p, 5, ana, op); // 500
    registrarDevolucion(db, {
      cliente_id: ana,
      venta_id: venta,
      monto: 200,
      motivo: 'se rompió',
      afecta_stock: false,
      operador_id: op,
    });

    const e = estadoCuenta(db, ana);
    expect(e.total_facturado).toBe(300);
    expect(e.saldo_pendiente).toBe(300);
  });

  it('una devolución de una factura anulada deja de contar, y no descuenta otra deuda', () => {
    const { db, ana, p, op } = escenario();
    // Dos facturas a crédito: A de $1.00 y B de $2.00.
    const a = venderACredito(db, p, 1, ana, op); // 100
    venderACredito(db, p, 2, ana, op);           // 200
    expect(estadoCuenta(db, ana).saldo_pendiente).toBe(300);

    // Ana devuelve los cuadernos de A y luego A se anula (mercadería dañada que
    // el cajero corrigió por su cuenta).
    registrarDevolucion(db, {
      cliente_id: ana,
      venta_id: a,
      monto: 100,
      motivo: 'daños',
      afecta_stock: false,
      operador_id: op,
    });
    expect(estadoCuenta(db, ana).saldo_pendiente).toBe(200);

    anularVenta(db, a, 'se devolvió', op);

    // A ya no es una deuda, así que su devolución tampoco. Lo que queda es B
    // entera: si la devolución de A siguiera descontando, Ana aparecería
    // debiendo $1.00 cuando debe $2.00, y el $1.00 estaría en ninguna parte.
    const e = estadoCuenta(db, ana);
    expect(e.total_facturado).toBe(200);
    expect(e.saldo_pendiente).toBe(200);
    expect(e.total_al_dia).toBe(200);
  });

  it('el total facturado no sale nunca en negativo', () => {
    const { db, ana, p, op } = escenario();
    // Se devuelve todo y luego se anula: ni la devolución ni la venta cuentan.
    const a = venderACredito(db, p, 5, ana, op); // 500
    registrarDevolucion(db, {
      cliente_id: ana,
      venta_id: a,
      monto: 500,
      motivo: 'todo roto',
      afecta_stock: false,
      operador_id: op,
    });
    anularVenta(db, a, 'se devolvió todo', op);

    const e = estadoCuenta(db, ana);
    expect(e.total_facturado).toBe(0);
    expect(e.saldo_pendiente).toBe(0);
    expect(e.total_vencido).toBe(0);
  });

  it('el desglose de vencido y el total cuentan la misma deuda', () => {
    // El FIFO reparte sobre las facturas vigentes y `facturado` las suma. Si
    // uno de los dos mirara un conjunto distinto de ventas, el vencido podría
    // no caber dentro del saldo: un cliente con saldo $0 y vencido $500.
    const { db, ana, p, op } = escenario();
    const vieja = venderACredito(db, p, 5, ana, op); // 500, la más antigua
    fechaDeVenta(db, vieja, '2026-08-19');
    venderACredito(db, p, 5, ana, op);             // 500, al día
    registrarDevolucion(db, {
      cliente_id: ana,
      venta_id: vieja,
      monto: 500,
      motivo: 'todo devuelto de la vieja',
      afecta_stock: false,
      operador_id: op,
    });

    const e = estadoCuenta(db, ana);
    // La vieja quedó en 0 (devuelta), la nueva en 500 y al día.
    expect(e.saldo_pendiente).toBe(500);
    expect(e.total_vencido).toBe(0);
    expect(e.total_al_dia).toBe(500);
    expect(e.total_al_dia + e.total_vencido).toBe(e.saldo_pendiente);
  });

  it('las ventas anuladas no cuentan', () => {
    const { db, ana, p, op } = escenario();
    const venta = venderACredito(db, p, 5, ana, op);
    anularVenta(db, venta, 'error de caja', op);
    expect(estadoCuenta(db, ana).saldo_pendiente).toBe(0);
  });

  it('el saldo nunca es negativo', () => {
    const { db, ana, p, op } = escenario();
    // Una devolución de más sobre una venta pagada en parte no puede dejar al
    // cliente con saldo a favor: el sistema no guarda saldos negativos.
    const venta = venderACredito(db, p, 5, ana, op); // 500
    registrarDevolucion(db, {
      cliente_id: ana,
      venta_id: venta,
      monto: 500,
      motivo: 'todo roto',
      afecta_stock: false,
      operador_id: op,
    });
    expect(estadoCuenta(db, ana).saldo_pendiente).toBe(0);
  });

  it('no existe un estado de cuenta para un cliente dado de baja', () => {
    const { db, ana } = escenario();
    db.prepare('UPDATE clientes SET activo = 0 WHERE id = ?').run(ana);
    expect(codigoDe(() => estadoCuenta(db, ana))).toBe(CODIGO_ERROR.no_encontrado);
  });
});

//---------------------------------------------------------------------------
// Vencimiento
//---------------------------------------------------------------------------

describe('vencimiento (FIFO)', () => {
  it('una factura dentro del plazo no está vencida', () => {
    const { db, ana, p, op } = escenario();
    venderACredito(db, p, 5, ana, op);

    const e = estadoCuenta(db, ana);
    expect(e.saldo_pendiente).toBe(500);
    expect(e.total_vencido).toBe(0);
    expect(e.total_al_dia).toBe(500);
  });

  it('una factura con el plazo vencido sí lo está', () => {
    const { db, ana, p, op } = escenario();
    const v = venderACredito(db, p, 5, ana, op);
    // 40 días atrás, con 30 días de plazo: venció hace 10.
    fechaDeVenta(db, v, '2026-08-19');

    const e = estadoCuenta(db, ana);
    expect(e.total_vencido).toBe(500);
    expect(e.total_al_dia).toBe(0);
  });

  it('el pago cubre primero la factura más antigua', () => {
    const { db, ana, p, op } = escenario();
    const vieja = venderACredito(db, p, 5, ana, op); // 500, hace 40 días → vencida
    fechaDeVenta(db, vieja, '2026-08-19');
    venderACredito(db, p, 10, ana, op); // 1000, hoy → al día

    registrarAbono(db, {
      cliente_id: ana,
      pagos: [{ monto: 500, tipo_pago: 'efectivo', moneda: 'usd' }],
      operador_id: op,
    });

    // El abono saldó la vieja. Lo que queda está al día, no vencido.
    const e = estadoCuenta(db, ana);
    expect(e.saldo_pendiente).toBe(1000);
    expect(e.total_vencido).toBe(0);
    expect(e.total_al_dia).toBe(1000);
  });

  it('un pago parcial deja la factura vieja a medio pagar y todavía vencida', () => {
    const { db, ana, p, op } = escenario();
    const vieja = venderACredito(db, p, 5, ana, op);
    fechaDeVenta(db, vieja, '2026-08-19');
    venderACredito(db, p, 10, ana, op);

    registrarAbono(db, {
      cliente_id: ana,
      pagos: [{ monto: 200, tipo_pago: 'efectivo', moneda: 'usd' }],
      operador_id: op,
    });

    const e = estadoCuenta(db, ana);
    expect(e.saldo_pendiente).toBe(1300);
    expect(e.total_vencido).toBe(300); // de la vieja, que quedó en 300
    expect(e.total_al_dia).toBe(1000);
  });

  it('el plazo de cada cliente es el suyo, no uno global', () => {
    const { db, ana, p, op } = escenario();
    // Misma fecha, misma deuda, distinto plazo pactado.
    const moroso = cliente(db, { documento: 'V-44444444', nombre: 'Moroso', dias_credito: 15 });
    const fiel = cliente(db, { documento: 'V-55555555', nombre: 'Fiel', dias_credito: 90 });

    const va = venderACredito(db, p, 5, ana, op);   // Ana: 30 días
    const vm = venderACredito(db, p, 5, moroso, op); // 15 días
    const vf = venderACredito(db, p, 5, fiel, op);   // 90 días
    fechaDeVenta(db, va, '2026-08-19'); // hace 40 días
    fechaDeVenta(db, vm, '2026-08-19');
    fechaDeVenta(db, vf, '2026-08-19');

    // A Ana se le venció hace 10 días; a Moroso hace 25; a la fiel le faltan
    // 50. Con un plazo global de 30, las tres estarían en rojo.
    expect(estadoCuenta(db, ana).total_vencido).toBe(500);
    expect(estadoCuenta(db, moroso).total_vencido).toBe(500);
    expect(estadoCuenta(db, fiel).total_vencido).toBe(0);
    expect(estadoCuenta(db, fiel).total_al_dia).toBe(500);
  });

  it('quien paga al contado no tiene plazo: vence de inmediato', () => {
    const { db, luis, p, op } = escenario();
    const v = venderACredito(db, p, 5, luis, op); // Luis: 0 días de crédito
    fechaDeVenta(db, v, '2026-08-19');

    // Even yesterday's sale is already overdue for him.
    expect(estadoCuenta(db, luis).total_vencido).toBe(500);
  });
});

//---------------------------------------------------------------------------
// El listado de deudores
//---------------------------------------------------------------------------

describe('estadoCuentaTodos', () => {
  it('ordena de mayor a menor saldo', () => {
    const { db, ana, luis, p, op } = escenario();
    const chica = cliente(db, { documento: 'V-33333333', nombre: 'Chica Deuda' });
    venderACredito(db, p, 1, chica, op); // 100
    venderACredito(db, p, 20, ana, op); // 2000
    venderACredito(db, p, 10, luis, op); // 1000

    const lista = estadoCuentaTodos(db);
    expect(lista.map((c) => c.saldo_pendiente)).toEqual([2000, 1000, 100]);
    expect(lista.map((c) => c.nombre)).toEqual(['Ana Pérez', 'Luis Gómez', 'Chica Deuda']);
  });

  it('incluye a quien no debe nada, con saldo cero', () => {
    const { db, ana } = escenario();
    const lista = estadoCuentaTodos(db);
    expect(lista.find((c) => c.cliente_id === ana)?.saldo_pendiente).toBe(0);
  });

  it('excluye a los clientes dados de baja', () => {
    const { db, ana } = escenario();
    db.prepare('UPDATE clientes SET activo = 0 WHERE id = ?').run(ana);
    expect(estadoCuentaTodos(db).some((c) => c.cliente_id === ana)).toBe(false);
  });

  it('desglosa el vencido de cada uno, no solo el total', () => {
    const { db, ana, p, op } = escenario();
    const v = venderACredito(db, p, 5, ana, op);
    fechaDeVenta(db, v, '2026-08-19');

    const lista = estadoCuentaTodos(db);
    const deAna = lista.find((c) => c.cliente_id === ana)!;
    expect(deAna.total_vencido).toBe(500);
    expect(deAna.total_al_dia).toBe(0);
  });
});

//---------------------------------------------------------------------------
// Abonos
//---------------------------------------------------------------------------

describe('registrarAbono', () => {
  it('deja el abono sin factura asociada', () => {
    const { db, ana, p, op } = escenario();
    venderACredito(db, p, 5, ana, op);
    registrarAbono(db, {
      cliente_id: ana,
      pagos: [{ monto: 200, tipo_pago: 'efectivo', moneda: 'usd' }],
      operador_id: op,
    });

    const pagos = historialPagos(db, ana);
    expect(pagos).toHaveLength(1);
    expect(pagos[0]?.venta_id).toBeNull();
    expect(pagos[0]?.numero_factura).toBeNull();
    expect(pagos[0]?.monto).toBe(200);
  });

  it('acepta varios pagos en un solo abono', () => {
    const { db, ana, p, op } = escenario();
    tasa(db, 10);
    venderACredito(db, p, 10, ana, op); // 1000 centavos

    registrarAbono(db, {
      cliente_id: ana,
      pagos: [
        { monto: 300, tipo_pago: 'efectivo', moneda: 'usd' },
        { monto: 4000, tipo_pago: 'pago_movil', moneda: 'ves', numero_referencia: '7' },
      ],
      operador_id: op,
    });

    // 300 US$ + 400 Bs (400 centavos US$) = 700
    expect(estadoCuenta(db, ana).saldo_pendiente).toBe(300);
  });

  it('no deja abonar más que el saldo pendiente', () => {
    const { db, ana, p, op } = escenario();
    venderACredito(db, p, 5, ana, op); // 500
    expect(
      mensajeDe(() => registrarAbono(db, {
        cliente_id: ana,
        pagos: [{ monto: 502, tipo_pago: 'efectivo', moneda: 'usd' }],
        operador_id: op,
      })),
    ).toMatch(/supera el saldo pendiente/);
    expect(estadoCuenta(db, ana).total_pagado).toBe(0);
  });

  it('no deja abonar a quien no debe nada', () => {
    const { db, ana, op } = escenario();
    expect(
      mensajeDe(() => registrarAbono(db, {
        cliente_id: ana,
        pagos: [{ monto: 100, tipo_pago: 'efectivo', moneda: 'usd' }],
        operador_id: op,
      })),
    ).toMatch(/no tiene saldo pendiente/);
  });

  it('exige caja abierta', () => {
    const db = bd();
    const op = usuario(db);
    const ana = cliente(db);
    // Sin `abrirCaja`: la tienda abre el programa y aún no se ha contado la gaveta.
    expect(
      codigoDe(() => registrarAbono(db, {
        cliente_id: ana,
        pagos: [{ monto: 100, tipo_pago: 'efectivo', moneda: 'usd' }],
        operador_id: op,
      })),
    ).toBe(CODIGO_ERROR.caja_cerrada);
  });

  it('rechaza un abono sin pagos', () => {
    const { db, ana, op } = escenario();
    expect(codigoDe(() => registrarAbono(db, { cliente_id: ana, pagos: [], operador_id: op }))).toBe(
      CODIGO_ERROR.validacion,
    );
  });

  it('rechaza un pago de cero', () => {
    const { db, ana, p, op } = escenario();
    venderACredito(db, p, 5, ana, op);
    expect(
      codigoDe(() => registrarAbono(db, {
        cliente_id: ana,
        pagos: [{ monto: 0, tipo_pago: 'efectivo', moneda: 'usd' }],
        operador_id: op,
      })),
    ).toBe(CODIGO_ERROR.validacion);
  });

  it('un abono a un cliente inexistente no se guarda', () => {
    const { db, op } = escenario();
    expect(
      codigoDe(() => registrarAbono(db, {
        cliente_id: 999,
        pagos: [{ monto: 100, tipo_pago: 'efectivo', moneda: 'usd' }],
        operador_id: op,
      })),
    ).toBe(CODIGO_ERROR.no_encontrado);
  });

  it('revierte todos los pagos si uno del abono es inválido', () => {
    const { db, ana, p, op } = escenario();
    venderACredito(db, p, 20, ana, op); // 2000
    expect(
      codigoDe(() => registrarAbono(db, {
        cliente_id: ana,
        pagos: [
          { monto: 100, tipo_pago: 'efectivo', moneda: 'usd' },
          { monto: 100, tipo_pago: 'pago_movil', moneda: 'ves' }, // sin referencia
        ],
        operador_id: op,
      })),
    ).toBe(CODIGO_ERROR.validacion);
    expect(qTodos(db, 'SELECT * FROM pagos')).toHaveLength(0);
    expect(estadoCuenta(db, ana).total_pagado).toBe(0);
  });

  it('tolera un céntimo de sobrepago por redondeo entre monedas', () => {
    const { db, ana, p, op } = escenario();
    tasa(db, 3);
    // La deuda es de $4.00 (400 centavos). Ana entrega Bs 1203, que a tasa 3
    // son 401 centavos: un céntimo de más, del redondeo al dividir. Se acepta,
    // igual que en la venta, para no dejar al cajero sin salida.
    venderACredito(db, p, 4, ana, op);
    registrarAbono(db, {
      cliente_id: ana,
      pagos: [{ monto: 1203, tipo_pago: 'pago_movil', moneda: 'ves', numero_referencia: '1' }],
      operador_id: op,
    });
    expect(estadoCuenta(db, ana).saldo_pendiente).toBe(0);
  });

  it('rechaza dos céntimos de sobrepago', () => {
    const { db, ana, p, op } = escenario();
    tasa(db, 3);
    venderACredito(db, p, 4, ana, op); // 400 centavos
    expect(
      codigoDe(() => registrarAbono(db, {
        cliente_id: ana,
        pagos: [{ monto: 1206, tipo_pago: 'pago_movil', moneda: 'ves', numero_referencia: '1' }],
        operador_id: op,
      })),
    ).toBe(CODIGO_ERROR.validacion);
    expect(estadoCuenta(db, ana).total_pagado).toBe(0);
  });
});

//---------------------------------------------------------------------------
// Historial
//---------------------------------------------------------------------------

describe('historialPagos', () => {
  it('muestra los pagos de la venta y los abonos juntos', () => {
    const { db, ana, p, op } = escenario();
    // Venta a crédito con un abono parcial en la misma factura.
    crearVenta(db, {
      cliente_id: ana,
      tipo: 'credito',
      descuento: 0,
      detalles: [{ producto_id: p, cantidad: 10 }],
      pagos: [{ monto: 400, tipo_pago: 'efectivo', moneda: 'usd' }],
      operador_id: op,
    });
    registrarAbono(db, {
      cliente_id: ana,
      pagos: [{ monto: 200, tipo_pago: 'efectivo', moneda: 'usd' }],
      operador_id: op,
    });

    const h = historialPagos(db, ana);
    expect(h).toHaveLength(2);
    expect(h.filter((x) => x.venta_id === null)).toHaveLength(1);
    expect(h.filter((x) => x.venta_id !== null)[0]?.numero_factura).toBe(1);
  });

  it('solo muestra los pagos de ese cliente', () => {
    const { db, ana, luis, p, op } = escenario();
    venderACredito(db, p, 5, ana, op);
    venderACredito(db, p, 5, luis, op);
    registrarAbono(db, {
      cliente_id: luis,
      pagos: [{ monto: 100, tipo_pago: 'efectivo', moneda: 'usd' }],
      operador_id: op,
    });

    expect(historialPagos(db, ana)).toHaveLength(0);
    expect(historialPagos(db, luis)).toHaveLength(1);
  });
});
