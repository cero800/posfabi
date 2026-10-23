import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { VentaInput } from '@tienda/core';

import { qTodos, qUno } from './db.js';
import { CODIGO_ERROR } from './errors.js';
import {
  anularVenta,
  crearVenta,
  listarVentas,
  listarVentasCliente,
  obtenerVenta,
} from './ventas.js';
import { cantidadDisponible, setPrecioCliente } from './repo.js';
import { registrarAbono } from './pagos.js';
import { registrarDevolucion } from './devoluciones.js';
import { cerrarCaja } from './caja.js';
import { estadoCuenta } from './deudores.js';
import {
  abrirCaja,
  bd,
  cliente,
  clienteMostrador,
  producto,
  stock,
  tasa,
  usuario,
} from './testutil.js';

//---------------------------------------------------------------------------
// Andamiaje
//---------------------------------------------------------------------------

/** Base con caja abierta, un operador y el cliente de pruebas. */
function escenario(): {
  db: DatabaseSync;
  op: number;
  mostrador: number;
  ana: number;
} {
  const db = bd();
  const op = usuario(db, 'Alex');
  const mostrador = clienteMostrador(db);
  const ana = cliente(db, { documento: 'V-11111111', nombre: 'Ana Pérez' });
  abrirCaja(db, op);
  return { db, op, mostrador, ana };
}

/** Venta de contado de 2 unidades de un producto de `precio` centavos. */
function ventaContado(
  productoId: number,
  cantidad: number,
  op: number,
  clienteId: number,
  over: Partial<VentaInput> = {},
): VentaInput {
  return {
    cliente_id: clienteId,
    tipo: 'contado',
    descuento: 0,
    detalles: [{ producto_id: productoId, cantidad }],
    pagos: [{ monto: 0, tipo_pago: 'efectivo', moneda: 'usd' }],
    operador_id: op,
    ...over,
  };
}

/** El código de error de la llamada, o la AssertionError si no falló. */
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
// Validación de la entrada
//---------------------------------------------------------------------------

describe('crearVenta · lo que se rechaza antes de tocar nada', () => {
  it('exige al menos un producto', () => {
    const { db, op, mostrador } = escenario();
    // Sin productos, el `producto_id` del helper da igual: `detalles` vacío lo
    // reemplaza entero.
    expect(
      codigoDe(() => crearVenta(db, ventaContado(0, 1, op, mostrador, { detalles: [] }))),
    ).toBe(CODIGO_ERROR.validacion);
    expect(listarVentas(db)).toHaveLength(0);
  });

  it('exige el pago en una venta de contado', () => {
    const { db, op, mostrador } = escenario();
    const p = producto(db, 100);
    stock(db, p, 10);
    expect(
      codigoDe(() => crearVenta(db, ventaContado(p, 1, op, mostrador, { pagos: [] }))),
    ).toBe(CODIGO_ERROR.validacion);
  });

  it('no acepta un tipo de venta desconocido', () => {
    const { db, op, mostrador } = escenario();
    const p = producto(db, 100);
    stock(db, p, 10);
    expect(
      codigoDe(() => crearVenta(db, ventaContado(p, 1, op, mostrador, { tipo: 'barato' as never }))),
    ).toBe(CODIGO_ERROR.validacion);
  });

  it('exige caja abierta', () => {
    // Base sin `abrirCaja`: es el estado en el que la tienda abre el programa
    // antes de que el cajero cuente la gaveta.
    const db = bd();
    const op = usuario(db);
    const mostrador = clienteMostrador(db);
    const p = producto(db, 100);
    stock(db, p, 10);

    expect(
      codigoDe(() => crearVenta(db, ventaContado(p, 1, op, mostrador))),
    ).toBe(CODIGO_ERROR.caja_cerrada);
    expect(listarVentas(db)).toHaveLength(0);
  });

  it('no vende a crédito al cliente de mostrador', () => {
    const { db, op, mostrador } = escenario();
    const p = producto(db, 100);
    stock(db, p, 10);
    expect(
      mensajeDe(() => crearVenta(db, ventaContado(p, 1, op, mostrador, { tipo: 'credito' }))),
    ).toMatch(/Mostrador/);
  });

  it('no acepta un cliente inexistente', () => {
    const { db, op } = escenario();
    const p = producto(db, 100);
    stock(db, p, 10);
    expect(codigoDe(() => crearVenta(db, ventaContado(p, 1, op, 999)))).toBe(
      CODIGO_ERROR.no_encontrado,
    );
  });
});

//---------------------------------------------------------------------------
// Totales
//---------------------------------------------------------------------------

describe('crearVenta · totales', () => {
  it('multiplica cantidad por precio y guarda el detalle', () => {
    const { db, op, mostrador } = escenario();
    const cuaderno = producto(db, 250, { codigo: 'C-1', nombre: 'Cuaderno' });
    stock(db, cuaderno, 10);

    const v = crearVenta(db, ventaContado(cuaderno, 4, op, mostrador, {
      pagos: [{ monto: 1000, tipo_pago: 'efectivo', moneda: 'usd' }],
    }));

    expect(v.total).toBe(1000);
    expect(v.subtotal).toBe(1000);
    expect(v.impuesto).toBe(0);
    expect(v.numero_factura).toBe(1);
    expect(v.estado).toBe('entregada');

    expect(
      qTodos<{ producto_id: number; cantidad: number; precio_unitario: number; subtotal: number }>(
        db,
        'SELECT producto_id, cantidad, precio_unitario, subtotal FROM detalle_ventas',
      ),
    ).toEqual([{ producto_id: cuaderno, cantidad: 4, precio_unitario: 250, subtotal: 1000 }]);
  });

  it('aplica el descuento sobre el subtotal', () => {
    const { db, op, mostrador } = escenario();
    const p = producto(db, 100);
    stock(db, p, 10);

    const v = crearVenta(db, ventaContado(p, 10, op, mostrador, {
      descuento: 150,
      pagos: [{ monto: 850, tipo_pago: 'efectivo', moneda: 'usd' }],
    }));

    expect(v.subtotal).toBe(850); // 1000 − 150
    expect(v.descuento).toBe(150);
    expect(v.total).toBe(850);
  });

  it('rechaza un descuento mayor que el subtotal', () => {
    const { db, op, mostrador } = escenario();
    const p = producto(db, 100);
    stock(db, p, 10);
    expect(
      codigoDe(() => crearVenta(db, ventaContado(p, 1, op, mostrador, { descuento: 500 }))),
    ).toBe(CODIGO_ERROR.validacion);
  });

  it('redondea a céntimos las cantidades fraccionarias', () => {
    const { db, op, mostrador } = escenario();
    // Un producto por metro: ahí sí se venden fracciones, que es la razón por la
    // que existe la lista de unidades. Con 33 centavos por metro, 2.5 metros
    // son 82.5 céntimos y se guardan 83.
    const cinta = producto(db, 33, { codigo: 'CINTA', nombre: 'Cinta métrica' });
    db.prepare("UPDATE productos SET unidad_medida = 'metro' WHERE id = ?").run(cinta);
    stock(db, cinta, 10);

    const v = crearVenta(db, ventaContado(cinta, 2.5, op, mostrador, {
      pagos: [{ monto: 83, tipo_pago: 'efectivo', moneda: 'usd' }],
    }));
    expect(v.total).toBe(83);
  });

  it('no permite fracciones de un producto que se vende por unidades', () => {
    const { db, op, mostrador } = escenario();
    const cuaderno = producto(db, 100);
    stock(db, cuaderno, 10);
    expect(
      mensajeDe(() => crearVenta(db, ventaContado(cuaderno, 1.5, op, mostrador, {
        pagos: [{ monto: 150, tipo_pago: 'efectivo', moneda: 'usd' }],
      }))),
    ).toMatch(/fracciones/);
  });

  it('usa el precio pactado del cliente si existe', () => {
    const { db, op, ana } = escenario();
    const p = producto(db, 100);
    stock(db, p, 10);
    setPrecioCliente(db, { cliente_id: ana, producto_id: p, precio_especial: 80 });

    const v = crearVenta(db, ventaContado(p, 2, op, ana, {
      tipo: 'credito',
      pagos: [],
    }));
    expect(v.total).toBe(160);
  });

  it('aplica el impuesto del producto si tiene', () => {
    const { db, op, mostrador } = escenario();
    const p = producto(db, 100);
    stock(db, p, 10);
    db.prepare('UPDATE productos SET impuesto_porcentaje = 16 WHERE id = ?').run(p);

    // 200 de mercadería + 16% = 232
    const v = crearVenta(db, ventaContado(p, 2, op, mostrador, {
      pagos: [{ monto: 232, tipo_pago: 'efectivo', moneda: 'usd' }],
    }));
    expect(v.impuesto).toBe(32);
    expect(v.total).toBe(232);
  });
});

//---------------------------------------------------------------------------
// Cobro
//---------------------------------------------------------------------------

describe('crearVenta · cobro', () => {
  it('no acepta un pago que no cubre el total', () => {
    const { db, op, mostrador } = escenario();
    const p = producto(db, 100);
    stock(db, p, 10);
    expect(
      mensajeDe(() => crearVenta(db, ventaContado(p, 1, op, mostrador, {
        pagos: [{ monto: 50, tipo_pago: 'efectivo', moneda: 'usd' }],
      }))),
    ).toMatch(/no cubre el total/);
  });

  it('no acepta un sobrepago', () => {
    const { db, op, mostrador } = escenario();
    const p = producto(db, 100);
    stock(db, p, 10);
    expect(
      mensajeDe(() => crearVenta(db, ventaContado(p, 1, op, mostrador, {
        pagos: [{ monto: 500, tipo_pago: 'efectivo', moneda: 'usd' }],
      }))),
    ).toMatch(/supera el total/);
  });

  it('tolera un céntimo de sobrepago por redondeo entre monedas', () => {
    const { db, op, mostrador } = escenario();
    tasa(db, 10);
    const p = producto(db, 100);
    stock(db, p, 10);

    // La venta cuesta 100 centavos. El cliente entrega Bs 1010, que a tasa 10
    // son 101 centavos: un céntimo de más por el redondeo de la conversión. Se
    // acepta porque el cambio se lo lleva la tienda, no el cliente.
    const v = crearVenta(db, ventaContado(p, 1, op, mostrador, {
      pagos: [{ monto: 1010, tipo_pago: 'pago_movil', moneda: 'ves', numero_referencia: '1234' }],
    }));
    expect(v.total).toBe(100);
    expect(v.tasa_cambio).toBe(10);
  });

  it('rechaza dos céntimos de sobrepago', () => {
    const { db, op, mostrador } = escenario();
    tasa(db, 10);
    const p = producto(db, 100);
    stock(db, p, 10);

    expect(
      mensajeDe(() => crearVenta(db, ventaContado(p, 1, op, mostrador, {
        pagos: [{ monto: 1020, tipo_pago: 'pago_movil', moneda: 'ves', numero_referencia: '1234' }],
      }))),
    ).toMatch(/supera el total/);
  });

  it('suma varias formas de pago en distintas monedas', () => {
    const { db, op, mostrador } = escenario();
    tasa(db, 10);
    const p = producto(db, 500);
    stock(db, p, 10);

    const v = crearVenta(db, ventaContado(p, 1, op, mostrador, {
      pagos: [
        { monto: 300, tipo_pago: 'efectivo', moneda: 'usd' },
        { monto: 2000, tipo_pago: 'pago_movil', moneda: 'ves', numero_referencia: '555' },
      ],
    }));
    expect(v.total).toBe(500);

    expect(
      qTodos<{ monto: number; moneda: string; tasa_cambio: number }>(
        db,
        'SELECT monto, moneda, tasa_cambio FROM pagos WHERE venta_id = ?',
        v.id,
      ),
    ).toEqual([
      { monto: 300, moneda: 'usd', tasa_cambio: 10 },
      { monto: 2000, moneda: 'ves', tasa_cambio: 10 },
    ]);
  });

  it('exige número de referencia en pago móvil y punto de venta', () => {
    const { db, op, mostrador } = escenario();
    const p = producto(db, 100);
    stock(db, p, 10);
    expect(
      codigoDe(() => crearVenta(db, ventaContado(p, 1, op, mostrador, {
        pagos: [{ monto: 100, tipo_pago: 'pago_movil', moneda: 'usd' }],
      }))),
    ).toBe(CODIGO_ERROR.validacion);
  });

  it('una venta a crédito puede no llevar pagos', () => {
    const { db, op, ana } = escenario();
    const p = producto(db, 100);
    stock(db, p, 10);
    const v = crearVenta(db, ventaContado(p, 1, op, ana, { tipo: 'credito', pagos: [] }));
    expect(v.tipo).toBe('credito');
    expect(v.total).toBe(100);
  });

  it('un crédito con pagos también los acepta', () => {
    const { db, op, ana } = escenario();
    const p = producto(db, 100);
    stock(db, p, 10);
    const v = crearVenta(db, ventaContado(p, 1, op, ana, {
      tipo: 'credito',
      pagos: [{ monto: 50, tipo_pago: 'efectivo', moneda: 'usd' }],
    }));
    expect(v.total).toBe(100);
    expect(qUno<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM pagos WHERE venta_id = ?', v.id)?.n).toBe(1);
  });
});

//---------------------------------------------------------------------------
// Atomicidad
//---------------------------------------------------------------------------

describe('crearVenta · todo o nada', () => {
  it('no descuenta stock si la venta no se graba', () => {
    const { db, op, mostrador } = escenario();
    const p = producto(db, 100);
    stock(db, p, 10);

    // El pago no cubre el total: la venta falla y el stock tiene que quedar
    // entero. Si se descontara antes de validar, aquí quedaría en 9 sin venta.
    expect(
      codigoDe(() => crearVenta(db, ventaContado(p, 5, op, mostrador, {
        pagos: [{ monto: 1, tipo_pago: 'efectivo', moneda: 'usd' }],
      }))),
    ).toBe(CODIGO_ERROR.validacion);

    expect(cantidadDisponible(db, p)).toBe(10);
    expect(listarVentas(db)).toHaveLength(0);
  });

  it('revierte los renglones ya descontados cuando el último falla', () => {
    const { db, op, mostrador } = escenario();
    const a = producto(db, 100, { codigo: 'A' });
    const b = producto(db, 100, { codigo: 'B' });
    stock(db, a, 10);
    stock(db, b, 1);

    expect(
      mensajeDe(() => crearVenta(db, {
        cliente_id: mostrador,
        tipo: 'contado',
        descuento: 0,
        detalles: [
          { producto_id: a, cantidad: 2 },
          { producto_id: b, cantidad: 5 }, // no hay stock
        ],
        pagos: [{ monto: 700, tipo_pago: 'efectivo', moneda: 'usd' }],
        operador_id: op,
      })),
    ).toMatch(/Stock insuficiente/);

    // La clave: la primera línea se había descontado y tiene que haber vuelto.
    expect(cantidadDisponible(db, a)).toBe(10);
    expect(cantidadDisponible(db, b)).toBe(1);
    expect(listarVentas(db)).toHaveLength(0);
    expect(qUno<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM movimientos_inventario')?.n).toBe(0);
  });

  it('no consume el número de factura si la venta falla', () => {
    const { db, op, mostrador } = escenario();
    const p = producto(db, 100);
    stock(db, p, 1);

    // El pago tiene que cubrir el total, o la venta fallaría antes de llegar al
    // stock y no se probaría lo que se quiere probar.
    expect(
      codigoDe(() => crearVenta(db, ventaContado(p, 5, op, mostrador, {
        pagos: [{ monto: 500, tipo_pago: 'efectivo', moneda: 'usd' }],
      }))),
    ).toBe(CODIGO_ERROR.stock_insuficiente);

    // La siguiente venta sale con el número 1, no con el 2: el correlativo se
    // reserva dentro de la transacción y vuelve con el rollback.
    stock(db, p, 10);
    const buena = crearVenta(db, ventaContado(p, 1, op, mostrador, {
      pagos: [{ monto: 100, tipo_pago: 'efectivo', moneda: 'usd' }],
    }));
    expect(buena.numero_factura).toBe(1);
  });

  it('numera las ventas de forma correlativa', () => {
    const { db, op, mostrador } = escenario();
    const p = producto(db, 100);
    stock(db, p, 10);

    const numeros = [1, 2, 3].map(
      () => crearVenta(db, ventaContado(p, 1, op, mostrador, {
        pagos: [{ monto: 100, tipo_pago: 'efectivo', moneda: 'usd' }],
      })).numero_factura,
    );
    expect(numeros).toEqual([1, 2, 3]);
  });

  it('la venta a crédito con pago incompleto no se guarda', () => {
    // A crédito el pago es un abono parcial, así que no tiene por qué cubrir el
    // total. Lo que no puede es pasarse.
    const { db, op, ana } = escenario();
    const p = producto(db, 100);
    stock(db, p, 10);

    const v = crearVenta(db, ventaContado(p, 1, op, ana, {
      tipo: 'credito',
      pagos: [{ monto: 40, tipo_pago: 'efectivo', moneda: 'usd' }],
    }));
    expect(v.total).toBe(100);
    expect(qUno<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM pagos')?.n).toBe(1);
  });
});

//---------------------------------------------------------------------------
// Stock
//---------------------------------------------------------------------------

describe('crearVenta · inventario', () => {
  it('descuenta el stock y deja el movimiento en el libro', () => {
    const { db, op, mostrador } = escenario();
    const p = producto(db, 100);
    stock(db, p, 10);

    const v = crearVenta(db, ventaContado(p, 3, op, mostrador, {
      pagos: [{ monto: 300, tipo_pago: 'efectivo', moneda: 'usd' }],
    }));

    expect(cantidadDisponible(db, p)).toBe(7);
    expect(
      qUno<{ tipo: string; cantidad: number; venta_id: number; motivo: string }>(
        db,
        'SELECT tipo, cantidad, venta_id, motivo FROM movimientos_inventario',
      ),
    ).toEqual({ tipo: 'salida_venta', cantidad: -3, venta_id: v.id, motivo: 'Venta' });
  });

  it('rechaza vender sin stock', () => {
    const { db, op, mostrador } = escenario();
    const p = producto(db, 100);
    stock(db, p, 2);
    expect(mensajeDe(() => crearVenta(db, ventaContado(p, 3, op, mostrador, {
      pagos: [{ monto: 300, tipo_pago: 'efectivo', moneda: 'usd' }],
    })))).toMatch(/Stock insuficiente/);
  });

  it('rechaza vender un producto que no existe', () => {
    const { db, op, mostrador } = escenario();
    expect(codigoDe(() => crearVenta(db, ventaContado(999, 1, op, mostrador, {
      pagos: [{ monto: 100, tipo_pago: 'efectivo', moneda: 'usd' }],
    })))).toBe(CODIGO_ERROR.no_encontrado);
  });
});

//---------------------------------------------------------------------------
// Consultas
//---------------------------------------------------------------------------

describe('consultas de ventas', () => {
  it('obtenerVenta devuelve la venta o dice que no está', () => {
    const { db, op, mostrador } = escenario();
    const p = producto(db, 100);
    stock(db, p, 10);
    const v = crearVenta(db, ventaContado(p, 1, op, mostrador, {
      pagos: [{ monto: 100, tipo_pago: 'efectivo', moneda: 'usd' }],
    }));

    expect(obtenerVenta(db, v.id).numero_factura).toBe(1);
    expect(codigoDe(() => obtenerVenta(db, 999))).toBe(CODIGO_ERROR.no_encontrado);
  });

  it('listarVentas respeta el límite', () => {
    const { db, op, mostrador } = escenario();
    const p = producto(db, 100);
    stock(db, p, 50);
    for (let i = 0; i < 5; i++) {
      crearVenta(db, ventaContado(p, 1, op, mostrador, {
        pagos: [{ monto: 100, tipo_pago: 'efectivo', moneda: 'usd' }],
      }));
    }
    expect(listarVentas(db)).toHaveLength(5);
    expect(listarVentas(db, 2)).toHaveLength(2);
  });

  it('listarVentasCliente solo devuelve las suyas', () => {
    const { db, op, ana } = escenario();
    const otro = cliente(db, { documento: 'V-22222222', nombre: 'Otro' });
    const p = producto(db, 100);
    stock(db, p, 10);

    crearVenta(db, ventaContado(p, 1, op, ana, { tipo: 'credito', pagos: [] }));
    crearVenta(db, ventaContado(p, 1, op, otro, { tipo: 'credito', pagos: [] }));

    expect(listarVentasCliente(db, ana)).toHaveLength(1);
    expect(listarVentasCliente(db, otro)).toHaveLength(1);
  });
});

//---------------------------------------------------------------------------
// Anulación
//---------------------------------------------------------------------------

describe('anularVenta', () => {
  function ventaConStock(): {
    db: DatabaseSync;
    op: number;
    mostrador: number;
    ana: number;
    p: number;
  } {
    const { db, op, mostrador, ana } = escenario();
    const p = producto(db, 100);
    stock(db, p, 10);
    return { db, op, mostrador, ana, p };
  }

  /**
   * Venta a crédito sin cobrar, que es la única que se puede anular.
   *
   * Los tests de anulación usan esta forma y no una venta de contado porque una
   * venta de contado SIEMPRE tiene pago —`crearVenta` no admite una sin— y una
   * venta con pago ya no se anula. Anular es para deshacer una venta mal
   * registrada; lo que se devuelve de una venta cobrada es una devolución.
   */
  function sinCobrar(
    db: DatabaseSync,
    p: number,
    cantidad: number,
    op: number,
    ana: number,
  ): number {
    return crearVenta(db, ventaContado(p, cantidad, op, ana, { tipo: 'credito', pagos: [] })).id;
  }

  it('devuelve la mercadería al stock y marca la venta', () => {
    const { db, op, ana, p } = ventaConStock();
    const id = sinCobrar(db, p, 3, op, ana);
    expect(cantidadDisponible(db, p)).toBe(7);

    anularVenta(db, id, '  mercadería dañada  ', op);

    expect(cantidadDisponible(db, p)).toBe(10);
    expect(obtenerVenta(db, id).estado).toBe('anulada');
    expect(qUno<{ anulada_motivo: string }>(db, 'SELECT anulada_motivo FROM ventas WHERE id = ?', id)?.anulada_motivo).toBe(
      'mercadería dañada',
    );
  });

  it('deja el asiento de reposición en el libro', () => {
    const { db, op, ana, p } = ventaConStock();
    anularVenta(db, sinCobrar(db, p, 3, op, ana), 'error de caja', op);

    expect(
      qUno<{ tipo: string; cantidad: number; motivo: string }>(
        db,
        'SELECT tipo, cantidad, motivo FROM movimientos_inventario ORDER BY id DESC LIMIT 1',
      ),
    ).toEqual({ tipo: 'ajuste', cantidad: 3, motivo: 'Anulación de venta' });
  });

  it('no borra el número de factura ni lo reutiliza', () => {
    const { db, op, mostrador, ana, p } = ventaConStock();
    const id = sinCobrar(db, p, 3, op, ana);
    anularVenta(db, id, 'se equivocaron de cliente', op);

    expect(obtenerVenta(db, id).numero_factura).toBe(1);

    // La siguiente venta no reutiliza el número: una factura anulada sigue
    // siendo una factura que existió.
    const siguiente = crearVenta(db, ventaContado(p, 1, op, mostrador, {
      pagos: [{ monto: 100, tipo_pago: 'efectivo', moneda: 'usd' }],
    }));
    expect(siguiente.numero_factura).toBe(2);
  });

  it('exige un motivo', () => {
    const { db, op, ana, p } = ventaConStock();
    const id = sinCobrar(db, p, 1, op, ana);
    expect(codigoDe(() => anularVenta(db, id, '   ', op))).toBe(CODIGO_ERROR.validacion);
    expect(obtenerVenta(db, id).estado).toBe('entregada');
    expect(cantidadDisponible(db, p)).toBe(9);
  });

  it('no anula dos veces', () => {
    const { db, op, ana, p } = ventaConStock();
    const id = sinCobrar(db, p, 1, op, ana);
    anularVenta(db, id, 'mal', op);
    expect(codigoDe(() => anularVenta(db, id, 'otra vez', op))).toBe(CODIGO_ERROR.venta_anulada);
    // El stock no se repone dos veces.
    expect(cantidadDisponible(db, p)).toBe(10);
  });

  it('no anula una venta que no existe', () => {
    const { db, op } = escenario();
    expect(codigoDe(() => anularVenta(db, 999, 'x', op))).toBe(CODIGO_ERROR.no_encontrado);
  });

  it('exige caja abierta: no se anula con el turno cerrado', () => {
    // Anular después del cierre devolvería mercadería al stock fuera de todo
    // arqueo, y el conteo de esa noche ya está firmado.
    const { db, op, ana, p } = ventaConStock();
    const id = sinCobrar(db, p, 1, op, ana);
    cerrarCaja(db, { caja_id: 1, operador_id: op, tasa_cierre: 10, efectivo_contado_usd: 0, efectivo_contado_ves: 0 });

    expect(codigoDe(() => anularVenta(db, id, 'tarde', op))).toBe(CODIGO_ERROR.caja_cerrada);
    expect(obtenerVenta(db, id).estado).toBe('entregada');
    expect(cantidadDisponible(db, p)).toBe(9);
  });

  it('una venta anulada sale del total facturado del cliente', () => {
    const { db, op, ana, p } = ventaConStock();
    const id = sinCobrar(db, p, 5, op, ana);

    expect(
      qUno<{ n: number }>(db, "SELECT SUM(total) AS n FROM ventas WHERE cliente_id = ? AND estado = 'entregada'", ana)?.n,
    ).toBe(500);

    anularVenta(db, id, 'se lo llevó sin pagar', op);

    expect(
      qUno<{ n: number }>(db, "SELECT COALESCE(SUM(total), 0) AS n FROM ventas WHERE cliente_id = ? AND estado = 'entregada'", ana)?.n,
    ).toBe(0);
  });
});

//---------------------------------------------------------------------------
// Anulación de ventas con dinero detrás
//---------------------------------------------------------------------------

describe('anularVenta · la venta no puede tener dinero detrás', () => {
  /** Venta a crédito de $10,00 a Ana, sin cobrar. */
  function ventaACredito(db: DatabaseSync, op: number, ana: number): number {
    const p = producto(db, 1000);
    stock(db, p, 10);
    return crearVenta(db, ventaContado(p, 1, op, ana, { tipo: 'credito', pagos: [] })).id;
  }

  function abono(db: DatabaseSync, op: number, ana: number, monto: number): void {
    registrarAbono(db, {
      cliente_id: ana,
      operador_id: op,
      pagos: [{ monto, tipo_pago: 'efectivo', moneda: 'usd' }],
    });
  }

  it('un abono a cuenta también pone dinero detrás de la venta', () => {
    // Un abono no lleva `venta_id`, así que la venta no tiene pagos propios. El
    // veto tiene que mirar el reparto FIFO del estado de cuenta, que es lo
    // único que sabe a qué factura se imputa ese abono.
    const { db, op, ana } = escenario();
    const id = ventaACredito(db, op, ana);
    abono(db, op, ana, 400);

    expect(codigoDe(() => anularVenta(db, id, 'x', op))).toBe(CODIGO_ERROR.venta_con_pagos);
  });

  it('basta con que el pago alcance a una parte de la venta', () => {
    // Un abono de 100 contra una factura de 1000 no cubre la venta, pero sí le
    // quita mercadería al cliente, y anularla devolvería el stock de algo que
    // ya se cobró. El veto no espera a que la factura esté liquidada.
    const { db, op, ana } = escenario();
    const id = ventaACredito(db, op, ana);
    abono(db, op, ana, 100);

    expect(codigoDe(() => anularVenta(db, id, 'x', op))).toBe(CODIGO_ERROR.venta_con_pagos);
  });

  it('no toca la venta ni el stock cuando veta', () => {
    const { db, op, ana } = escenario();
    const id = ventaACredito(db, op, ana);
    abono(db, op, ana, 1000);
    codigoDe(() => anularVenta(db, id, 'x', op));

    expect(obtenerVenta(db, id).estado).toBe('entregada');
    expect(
      qUno<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM movimientos_inventario WHERE motivo = ?', 'Anulación de venta')
        ?.n,
    ).toBe(0);
  });

  it('el veto no se extiende a facturas que el pago no alcanza', () => {
    // Dos ventas de $10,00 y un abono de $10,00: el FIFO se lo queda entero en
    // la primera. Si el veto mirara el saldo del cliente en vez del reparto,
    // bloquearía las dos y el cliente no podría deshacer nunca nada.
    const { db, op, ana } = escenario();
    const p = producto(db, 1000);
    stock(db, p, 10);
    const vieja = crearVenta(db, ventaContado(p, 1, op, ana, { tipo: 'credito', pagos: [] })).id;
    const nueva = crearVenta(db, ventaContado(p, 1, op, ana, { tipo: 'credito', pagos: [] })).id;
    abono(db, op, ana, 1000);

    anularVenta(db, nueva, 'error de tecleo', op);
    expect(obtenerVenta(db, nueva).estado).toBe('anulada');
    expect(codigoDe(() => anularVenta(db, vieja, 'x', op))).toBe(CODIGO_ERROR.venta_con_pagos);
  });

  it('una venta ya devuelta por completo no tiene dinero detrás', () => {
    // El caso límite: la factura de $10,00 está pagada y devuelta entera, así
    // que su saldo en el reparto es 0 y ningún pago "toca" esa línea. Anularla
    // se permite, y no cambia nada de la cuenta: lo facturado ya era 0 por la
    // devolución, y lo abonado sigue compensado por ella. El dinero no se
    // pierde —queda neutralizado por la devolución—, pero queda una asimetría
    // a la vista: se ve lo pagado de una factura que ya no está.
    const { db, op, ana } = escenario();
    const id = ventaACredito(db, op, ana);
    abono(db, op, ana, 1000);
    registrarDevolucion(db, {
      cliente_id: ana,
      venta_id: id,
      monto: 1000,
      motivo: 'todo roto',
      afecta_stock: false,
      operador_id: op,
    });

    const antes = estadoCuenta(db, ana);
    anularVenta(db, id, 'todo devuelto', op);

    expect(obtenerVenta(db, id).estado).toBe('anulada');
    expect(estadoCuenta(db, ana)).toEqual(antes);
  });
});
