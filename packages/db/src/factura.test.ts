import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { NEGOCIO_CONFIG_KEYS } from '@tienda/core';

import { facturaVenta } from './factura.js';
import { crearVenta, anularVenta } from './ventas.js';
import { registrarDevolucion } from './devoluciones.js';
import { escribirConfig } from './config.js';
import { CODIGO_ERROR } from './errors.js';
import { abrirCaja, bd, cliente, clienteMostrador, producto, stock, usuario } from './testutil.js';

//---------------------------------------------------------------------------
// Andamiaje
//---------------------------------------------------------------------------

interface Escenario {
  db: DatabaseSync;
  op: number;
  mostrador: number;
  ana: number;
  cuaderno: number;
  /** Venta de contado de $1,00 pagada en efectivo. */
  ventaContado: number;
}

/** Tienda con caja abierta, dos clientes, un producto y una venta de $1,00. */
function escenario(): Escenario {
  const db = bd();
  const op = usuario(db, 'Alex');
  const mostrador = clienteMostrador(db);
  const ana = cliente(db, { documento: 'V-11111111', nombre: 'Ana Pérez', dias_credito: 30 });
  const cuaderno = producto(db, 100, { codigo: 'C-1', nombre: 'Cuaderno pautado' });
  stock(db, cuaderno, 50);
  abrirCaja(db, op);

  const ventaContado = crearVenta(db, {
    cliente_id: mostrador,
    tipo: 'contado',
    descuento: 0,
    detalles: [{ producto_id: cuaderno, cantidad: 1 }],
    pagos: [{ monto: 100, tipo_pago: 'efectivo', moneda: 'usd' }],
    operador_id: op,
  }).id;

  return { db, op, mostrador, ana, cuaderno, ventaContado };
}

/** Venta a crédito de `cantidad` cuadernos a Ana. */
function ventaACredito(ctx: Escenario, cantidad: number): number {
  return crearVenta(ctx.db, {
    cliente_id: ctx.ana,
    tipo: 'credito',
    descuento: 0,
    detalles: [{ producto_id: ctx.cuaderno, cantidad }],
    pagos: [],
    operador_id: ctx.op,
  }).id;
}

//---------------------------------------------------------------------------
// La cabecera
//---------------------------------------------------------------------------

describe('facturaVenta · la cabecera', () => {
  it('reúne la venta tal como se guardó', () => {
    const ctx = escenario();
    const f = facturaVenta(ctx.db, ctx.ventaContado);

    expect(f.venta_id).toBe(ctx.ventaContado);
    expect(f.numero_factura).toBe(1);
    expect(f.tipo).toBe('contado');
    expect(f.estado).toBe('entregada');
    expect(f.fecha).toBeTruthy();
    expect(f.subtotal).toBe(100);
    expect(f.descuento).toBe(0);
    expect(f.impuesto).toBe(0);
    expect(f.total).toBe(100);
  });

  it('falla si la venta no existe, con un código que la interfaz puede leer', () => {
    const ctx = escenario();
    try {
      facturaVenta(ctx.db, 9999);
      throw new Error('se esperaba un error');
    } catch (e) {
      expect((e as { codigo?: string }).codigo).toBe(CODIGO_ERROR.no_encontrado);
      expect((e as Error).message).toMatch(/Venta no encontrada/);
    }
  });

  it('no filtra por estado: una venta anulada también se puede imprimir', () => {
    // El cliente llega con el papel del cajero y necesita ver que está anulada.
    const ctx = escenario();
    anularVenta(ctx.db, ctx.ventaContado, 'se cobró dos veces', ctx.op);

    expect(facturaVenta(ctx.db, ctx.ventaContado).estado).toBe('anulada');
  });
});

//---------------------------------------------------------------------------
// El cliente
//---------------------------------------------------------------------------

describe('facturaVenta · el cliente', () => {
  it('trae nombre, documento y plazo de crédito', () => {
    const ctx = escenario();
    const f = facturaVenta(ctx.db, ventaACredito(ctx, 2));

    expect(f.cliente).toBe('Ana Pérez');
    expect(f.cliente_documento).toBe('V-11111111');
    expect(f.dias_credito).toBe(30);
  });

  it('todo cliente tiene documento: la columna no admite nulos', () => {
    // No es una prueba de `facturaVenta` sino del contrato que la sostiene: si
    // `clientes.documento` algún día admitiera nulos, `facturaPdf.ts` imprimiría
    // `null` en el comprobante de quien se dé de alta sin cédula. Por eso la
    // columna es NOT NULL y la factura no necesita defenderse.
    const ctx = escenario();
    expect(() =>
      ctx.db.prepare("INSERT INTO clientes (documento, nombre) VALUES (NULL, 'Sin RIF')").run(),
    ).toThrowError(/NOT NULL/);

    const sinRazon = cliente(ctx.db, { documento: 'V-33333333', nombre: 'Solo cédula' });
    ctx.db.prepare('UPDATE clientes SET razon_social = NULL WHERE id = ?').run(sinRazon);
    expect(() => facturaVenta(ctx.db, ctx.ventaContado)).not.toThrowError();
  });
});

//---------------------------------------------------------------------------
// El detalle
//---------------------------------------------------------------------------

describe('facturaVenta · el detalle', () => {
  it('lista los productos en el orden en que se vendieron', () => {
    const ctx = escenario();
    const goma = producto(ctx.db, 50, { codigo: 'G-1', nombre: 'Goma de borrar' });
    stock(ctx.db, goma, 50);

    const v = crearVenta(ctx.db, {
      cliente_id: ctx.mostrador,
      tipo: 'contado',
      descuento: 0,
      detalles: [
        { producto_id: goma, cantidad: 1 },
        { producto_id: ctx.cuaderno, cantidad: 3 },
      ],
      // 50 + 300 = 350.
      pagos: [{ monto: 350, tipo_pago: 'efectivo', moneda: 'usd' }],
      operador_id: ctx.op,
    }).id;

    expect(facturaVenta(ctx.db, v).detalle).toEqual([
      { producto: 'Goma de borrar', cantidad: 1, precio_unitario: 50, subtotal: 50 },
      { producto: 'Cuaderno pautado', cantidad: 3, precio_unitario: 100, subtotal: 300 },
    ]);
  });

  it('usa el nombre del producto, aunque después se renombre', () => {
    // El nombre se lee en el momento de imprimir, no se copia a la venta. Si
    // alguien renombra el catálogo, las facturas viejas salen con el nombre
    // nuevo. Es lo que hacía el backend original y no se cambia aquí: cambiarlo
    // exigiría guardar el nombre en el detalle, que es otra decisión.
    const ctx = escenario();
    ctx.db.prepare("UPDATE productos SET nombre = 'Cuaderno pauta 100 hojas' WHERE id = ?")
      .run(ctx.cuaderno);

    expect(facturaVenta(ctx.db, ctx.ventaContado).detalle[0]?.producto).toBe('Cuaderno pauta 100 hojas');
  });

  it('una venta de un solo producto tiene un detalle de una línea', () => {
    const ctx = escenario();
    expect(facturaVenta(ctx.db, ctx.ventaContado).detalle).toHaveLength(1);
  });
});

//---------------------------------------------------------------------------
// Los pagos
//---------------------------------------------------------------------------

describe('facturaVenta · los pagos', () => {
  it('trae los pagos con su moneda y su referencia', () => {
    const ctx = escenario();
    escribirConfig(ctx.db, 'tasa_cambio', '10');
    const v = crearVenta(ctx.db, {
      cliente_id: ctx.mostrador,
      tipo: 'contado',
      descuento: 0,
      detalles: [{ producto_id: ctx.cuaderno, cantidad: 1 }], // 100 = Bs 1000
      // Pago partido: 40 centavos en dólares y Bs 600 (60 centavos) por
      // transferencia. Las dos monedas van en su propia unidad; aquí no se
      // convierte nada, solo se listan.
      pagos: [
        { monto: 40, tipo_pago: 'efectivo', moneda: 'usd' },
        { monto: 600, tipo_pago: 'pago_movil', moneda: 'ves', numero_referencia: '0414-99' },
      ],
      operador_id: ctx.op,
    }).id;

    expect(facturaVenta(ctx.db, v).pagos).toEqual([
      { tipo_pago: 'efectivo', moneda: 'usd', monto: 40, numero_referencia: null },
      { tipo_pago: 'pago_movil', moneda: 'ves', monto: 600, numero_referencia: '0414-99' },
    ]);
  });

  it('una venta a crédito no tiene pagos que mostrar', () => {
    const ctx = escenario();
    expect(facturaVenta(ctx.db, ventaACredito(ctx, 1)).pagos).toEqual([]);
  });
});

//---------------------------------------------------------------------------
// Los datos del negocio
// ---------------------------------------------------------------------------

describe('facturaVenta · los datos del negocio', () => {
  it('trae lo que dice la configuración de los ajustes', () => {
    const ctx = escenario();
    escribirConfig(ctx.db, NEGOCIO_CONFIG_KEYS.nombre, 'Papelería El Lápiz');
    escribirConfig(ctx.db, NEGOCIO_CONFIG_KEYS.rif, 'J-40123456-7');

    const f = facturaVenta(ctx.db, ctx.ventaContado);
    expect(f.negocio_nombre).toBe('Papelería El Lápiz');
    expect(f.negocio_rif).toBe('J-40123456-7');
    expect(f.negocio_telefono).toBe('');
    expect(f.negocio_direccion).toBe('');
  });

  it('sale en blanco antes de configurar el negocio, sin fallar', () => {
    // Una instalación recién hecha no tiene datos del negocio. La factura tiene
    // que salir igual, con el nombre del emisor en blanco y el PDF de
    // `facturaPdf.ts` cayendo en "Mi Negocio". Fallar aquí dejaría al cajero sin
    // poder vender hasta que configurara la razón social.
    const ctx = escenario();
    expect(facturaVenta(ctx.db, ctx.ventaContado).negocio_nombre).toBe('');
  });
});

//---------------------------------------------------------------------------
// Las devoluciones
// ---------------------------------------------------------------------------

describe('facturaVenta · las devoluciones', () => {
  it('trae las devoluciones de esa venta con su detalle de productos', () => {
    const ctx = escenario();
    const v = ventaACredito(ctx, 2); // 200
    const d = registrarDevolucion(ctx.db, {
      cliente_id: ctx.ana,
      venta_id: v,
      monto: 100,
      motivo: 'el cliente lo dejó mojado',
      detalle: [{ producto_id: ctx.cuaderno, cantidad: 1, precio_unitario: 100 }],
      afecta_stock: true,
      operador_id: ctx.op,
    });

    const devoluciones = facturaVenta(ctx.db, v).devoluciones;
    expect(devoluciones).toHaveLength(1);
    expect(devoluciones[0]).toMatchObject({
      id: d.id,
      venta_id: v,
      numero_factura: numeroDe(ctx.db, v),
      cliente: 'Ana Pérez',
      monto: 100,
      motivo: 'el cliente lo dejó mojado',
      operador_nombre: 'Alex',
    });
    expect(devoluciones[0]?.detalle).toEqual([
      { producto_id: ctx.cuaderno, nombre: 'Cuaderno pautado', cantidad: 1, precio_unitario: 100, subtotal: 100 },
    ]);
  });

  it('solo trae las devoluciones de esa venta, no las del cliente entero', () => {
    const ctx = escenario();
    const a = ventaACredito(ctx, 1);
    const b = ventaACredito(ctx, 3);
    for (const [venta, monto] of [[a, 100], [b, 100]] as const) {
      registrarDevolucion(ctx.db, {
        cliente_id: ctx.ana,
        venta_id: venta,
        monto,
        motivo: 'prueba',
        afecta_stock: false,
        operador_id: ctx.op,
      });
    }

    const f = facturaVenta(ctx.db, a);
    expect(f.devoluciones).toHaveLength(1);
    expect(f.devoluciones[0]?.monto).toBe(100);
  });

  it('deja las devoluciones pegadas aunque la venta se anule después', () => {
    // Este es el motivo de que las devoluciones vayan en la factura: es el papel
    // que demuestra que el cliente ya devolvió. Si la factura anulada llegara
    // sin ellas, el cliente no podría reclamar y el cajero no podría justificar
    // la anulación.
    const ctx = escenario();
    const v = ventaACredito(ctx, 2);
    registrarDevolucion(ctx.db, {
      cliente_id: ctx.ana,
      venta_id: v,
      monto: 100,
      motivo: 'daños de transporte',
      afecta_stock: false,
      operador_id: ctx.op,
    });
    anularVenta(ctx.db, v, 'se devolvió la mercadería', ctx.op);

    const f = facturaVenta(ctx.db, v);
    expect(f.estado).toBe('anulada');
    expect(f.devoluciones).toHaveLength(1);
    expect(f.devoluciones[0]?.motivo).toBe('daños de transporte');
  });

  it('el operador borrado no rompe la factura: sale en blanco', () => {
    // `operador_id` es nullable y un usuario puede darse de baja. El `LEFT JOIN`
    // es a propósito: una factura vieja no se vuelve ilegible porque se borró
    // quien la hizo.
    const ctx = escenario();
    const v = ventaACredito(ctx, 1);
    registrarDevolucion(ctx.db, {
      cliente_id: ctx.ana,
      venta_id: v,
      monto: 100,
      motivo: 'sin operador',
      afecta_stock: false,
      operador_id: 9999,
    });

    expect(facturaVenta(ctx.db, v).devoluciones[0]?.operador_nombre).toBe('');
  });

  it('una venta sin devoluciones las trae vacías, no faltando', () => {
    const ctx = escenario();
    expect(facturaVenta(ctx.db, ctx.ventaContado).devoluciones).toEqual([]);
  });
});

/** El número de factura de una venta, para comparar. */
function numeroDe(db: DatabaseSync, ventaId: number): number {
  const fila = db.prepare('SELECT numero_factura AS n FROM ventas WHERE id = ?').get(ventaId) as
    | { n: number }
    | undefined;
  return fila?.n ?? 0;
}
