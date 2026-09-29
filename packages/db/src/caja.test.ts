import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';

import { qTodos } from './db.js';
import { CODIGO_ERROR } from './errors.js';
import { cajaAbierta, cerrarCaja, exigirCajaAbierta, obtenerCaja, abrirCaja as abrirTurno } from './caja.js';
import { crearVenta } from './ventas.js';
import { registrarAbono } from './pagos.js';
import { abrirCaja as abrir, bd, cliente, clienteMostrador, producto, stock, tasa, usuario as crearUsuario } from './testutil.js';

//---------------------------------------------------------------------------
// Andamiaje
//---------------------------------------------------------------------------

/** Base con un operador, caja abierta y dos productos con stock. */
function escenario(): {
  db: DatabaseSync;
  op: number;
  mostrador: number;
  ana: number;
  a: number;
  b: number;
} {
  const db = bd();
  const op = crearUsuario(db, 'Alex');
  const mostrador = clienteMostrador(db);
  const ana = cliente(db, { documento: 'V-11111111', nombre: 'Ana Pérez' });
  abrir(db, op);

  const cuaderno = producto(db, 100, { codigo: 'C-1', nombre: 'Cuaderno' });
  const regla = producto(db, 50, { codigo: 'R-1', nombre: 'Regla' });
  stock(db, cuaderno, 100);
  stock(db, regla, 100);

  return { db, op, mostrador, ana, a: cuaderno, b: regla };
}

/** Venta de contado con pago en efectivo. */
function vender(
  db: DatabaseSync,
  productoId: number,
  cantidad: number,
  monto: number,
  op: number,
  clienteId: number,
  sobre: { tipo_pago?: 'efectivo' | 'pago_movil' | 'punto' | 'biopago'; moneda?: 'usd' | 'ves'; referencia?: string } = {},
): void {
  crearVenta(db, {
    cliente_id: clienteId,
    tipo: 'contado',
    descuento: 0,
    detalles: [{ producto_id: productoId, cantidad }],
    pagos: [
      {
        monto,
        tipo_pago: sobre.tipo_pago ?? 'efectivo',
        moneda: sobre.moneda ?? 'usd',
        numero_referencia: sobre.referencia,
      },
    ],
    operador_id: op,
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

//---------------------------------------------------------------------------
// Abrir
//---------------------------------------------------------------------------

describe('abrir la caja', () => {
  it('la primera caja arranca sin efectivo en la gaveta', () => {
    const db = bd();
    const op = crearUsuario(db);
    abrir(db, op);

    const c = cajaAbierta(db)!;
    expect(c.efectivo_inicial_usd).toBe(0);
    expect(c.efectivo_inicial_ves).toBe(0);
    expect(c.estado).toBe('abierta');
    expect(c.operador_nombre).toBe('Test');
  });

  it('no permite dos cajas abiertas a la vez', () => {
    const { db, op } = escenario();
    expect(codigoDe(() => abrirTurno(db, { operador_id: op }))).toBe(CODIGO_ERROR.caja_ya_abierta);
  });

  it('la siguiente caja hereda el efectivo que quedó en la gaveta', () => {
    const { db, op } = escenario();
    // Se simula una gaveta con 5000 US$ y 20000 Bs de un turno anterior.
    db.prepare(
      "UPDATE cajas SET efectivo_final_usd = 5000, efectivo_final_ves = 20000, estado = 'cerrada' WHERE id = 1",
    ).run();

    const nueva = abrirTurno(db, { operador_id: op });
    const c = obtenerCaja(db, nueva);
    expect(c.efectivo_inicial_usd).toBe(5000);
    expect(c.efectivo_inicial_ves).toBe(20000);
    // Lo que había en la gaveta también es lo que el sistema espera encontrar.
    expect(c.efectivo_esperado_usd).toBe(5000);
    expect(c.efectivo_esperado_ves).toBe(20000);
  });

  it('exigirCajaAbierta devuelve el id de la caja o dice que no hay', () => {
    const { db } = escenario();
    expect(exigirCajaAbierta(db)).toBe(1);

    db.prepare("UPDATE cajas SET estado = 'cerrada'").run();
    expect(codigoDe(() => exigirCajaAbierta(db))).toBe(CODIGO_ERROR.caja_cerrada);
  });
});

//---------------------------------------------------------------------------
// Cerrar
//---------------------------------------------------------------------------

describe('cerrar la caja', () => {
  it('suma al efectivo esperado lo cobrado en la venta', () => {
    const { db, op, mostrador, a } = escenario();
    vender(db, a, 2, 200, op, mostrador);

    const cierre = cerrarCaja(db, { caja_id: 1, operador_id: op, tasa_cierre: 10 });

    expect(cierre.efectivo_ventas_usd).toBe(200);
    expect(cierre.efectivo_esperado_usd).toBe(200);
    expect(cierre.total_ventas_usd).toBe(200);
    expect(cierre.efectivo_ventas_ves).toBe(0);
  });

  it('separa el efectivo en dólares del efectivo en bolívares', () => {
    const { db, op, mostrador, a, b } = escenario();
    tasa(db, 10);
    vender(db, a, 1, 100, op, mostrador);                    // $1.00 en efectivo
    vender(db, b, 1, 500, op, mostrador, { moneda: 'ves' });  // Bs 5 = $0.50 en efectivo

    const cierre = cerrarCaja(db, { caja_id: 1, operador_id: op, tasa_cierre: 10 });

    // Lo importante: los dos efectivos NO se suman en un solo número. El
    // billete de Bs y el billete de dólar son cajas distintas.
    expect(cierre.efectivo_ventas_usd).toBe(100);
    expect(cierre.efectivo_ventas_ves).toBe(500);
    expect(cierre.efectivo_esperado_usd).toBe(100);
    expect(cierre.efectivo_esperado_ves).toBe(500);
  });

  it('los pagos que no son efectivo no entran al arqueo de la gaveta', () => {
    const { db, op, mostrador, a } = escenario();
    tasa(db, 10);
    // Un pago móvil es en bolívares: las divisas en US$ solo se cobran en
    // efectivo, porque si no el dinero no está en la gaveta. La venta es de
    // $1.00, así que hacen falta Bs 1000 a tasa 10.
    vender(db, a, 1, 1000, op, mostrador, {
      tipo_pago: 'pago_movil',
      moneda: 'ves',
      referencia: '998877',
    });

    const cierre = cerrarCaja(db, { caja_id: 1, operador_id: op, tasa_cierre: 10 });

    // Cobrado por transferencia no entra a la gaveta, pero sí al desglose.
    expect(cierre.efectivo_ventas_usd).toBe(0);
    expect(cierre.efectivo_esperado_usd).toBe(0);
    expect(cierre.total_ventas_usd).toBe(100);
    expect(cierre.pagos).toEqual([{ tipo_pago: 'pago_movil', moneda: 'ves', monto: 1000 }]);
  });

  it('guarda el desglose por método y moneda para el arqueo', () => {
    const { db, op, mostrador, a, b } = escenario();
    tasa(db, 10);
    vender(db, a, 1, 100, op, mostrador);
    vender(db, a, 1, 100, op, mostrador);
    vender(db, b, 1, 500, op, mostrador, { moneda: 'ves' });
    vender(db, b, 1, 500, op, mostrador, { tipo_pago: 'biopago', moneda: 'ves' });

    const cierre = cerrarCaja(db, { caja_id: 1, operador_id: op, tasa_cierre: 10 });

    expect(cierre.pagos).toEqual([
      { tipo_pago: 'biopago', moneda: 'ves', monto: 500 },
      { tipo_pago: 'efectivo', moneda: 'usd', monto: 200 },
      { tipo_pago: 'efectivo', moneda: 'ves', monto: 500 },
    ]);

    // Y queda en la base, no solo en el comprobante: el arqueo de la semana
    // anterior se vuelve a consultar.
    expect(
      qTodos<{ tipo_pago: string; moneda: string; monto: number }>(
        db,
        'SELECT tipo_pago, moneda, monto FROM cierre_caja_pagos WHERE caja_id = 1 ORDER BY tipo_pago, moneda',
      ),
    ).toEqual([
      { tipo_pago: 'biopago', moneda: 'ves', monto: 500 },
      { tipo_pago: 'efectivo', moneda: 'usd', monto: 200 },
      { tipo_pago: 'efectivo', moneda: 'ves', monto: 500 },
    ]);
  });

  it('el comprobante lleva los datos del negocio', () => {
    const { db, op } = escenario();
    db.exec(
      `INSERT INTO config (clave, valor) VALUES
         ('negocio_nombre', 'Papelería El Lápiz'),
         ('negocio_rif', 'J-40123456-7'),
         ('negocio_telefono', '0212-1234567'),
         ('negocio_direccion', 'Av. Miranda, Caracas')`,
    );

    const cierre = cerrarCaja(db, { caja_id: 1, operador_id: op, tasa_cierre: 10 });
    expect(cierre.negocio_nombre).toBe('Papelería El Lápiz');
    expect(cierre.negocio_rif).toBe('J-40123456-7');
    expect(cierre.negocio_telefono).toBe('0212-1234567');
    expect(cierre.negocio_direccion).toBe('Av. Miranda, Caracas');
  });

  it('lista las ventas del día y su equivalente en bolívares', () => {
    const { db, op, mostrador, a } = escenario();
    tasa(db, 10);
    vender(db, a, 3, 300, op, mostrador);

    const cierre = cerrarCaja(db, { caja_id: 1, operador_id: op, tasa_cierre: 10 });
    expect(cierre.ventas).toHaveLength(1);
    expect(cierre.ventas[0]).toMatchObject({
      cliente: 'Mostrador',
      tipo: 'contado',
      monto: 300,
      devuelto: 0,
      estado: 'entregada',
      tasa_cambio: 10,
    });
    // 300 centavos a tasa 10 son 3000 Bs.
    expect(cierre.total_ventas_bs).toBe(3000);
  });

  it('convierte los abonos a cuenta con la tasa de cada pago', () => {
    const { db, op, ana, a } = escenario();
    tasa(db, 10);
    // Ana compra a crédito: 500 US$ de deuda.
    crearVenta(db, {
      cliente_id: ana,
      tipo: 'credito',
      descuento: 0,
      detalles: [{ producto_id: a, cantidad: 5 }],
      pagos: [],
      operador_id: op,
    });
    // Y abona 250 US$.
    registrarAbono(db, {
      cliente_id: ana,
      pagos: [{ monto: 250, tipo_pago: 'efectivo', moneda: 'usd' }],
      operador_id: op,
    });

    const cierre = cerrarCaja(db, { caja_id: 1, operador_id: op, tasa_cierre: 10 });
    expect(cierre.total_abonos_usd).toBe(250);
    expect(cierre.total_abonos_bs).toBe(2500);
    // Un abono no es una venta: no va a la lista de ventas del día.
    expect(cierre.ventas.every((v) => v.tipo === 'credito')).toBe(true);
  });

  it('el efectivo del abono sí cuenta en lo que hay en la gaveta', () => {
    const { db, op, ana, mostrador, a } = escenario();
    tasa(db, 10);
    crearVenta(db, {
      cliente_id: ana,
      tipo: 'credito',
      descuento: 0,
      detalles: [{ producto_id: a, cantidad: 5 }],
      pagos: [],
      operador_id: op,
    });
    // 100 en efectivo por venta y 250 en efectivo por abono.
    vender(db, a, 1, 100, op, mostrador);
    registrarAbono(db, {
      cliente_id: ana,
      pagos: [{ monto: 250, tipo_pago: 'efectivo', moneda: 'usd' }],
      operador_id: op,
    });

    const cierre = cerrarCaja(db, { caja_id: 1, operador_id: op, tasa_cierre: 10 });
    // El abono no es una venta, así que no va en `efectivo_ventas_usd`...
    expect(cierre.efectivo_ventas_usd).toBe(100);
    expect(cierre.abonos_efectivo_usd).toBe(250);
    // ...pero los billetes están en el cajón, así que el arqueo los tiene que ver.
    expect(cierre.efectivo_esperado_usd).toBe(350);
  });

  it('un abono en bolívares suma en la gaveta de bolívares, no en la de dólares', () => {
    const { db, op, ana, mostrador, a } = escenario();
    tasa(db, 10);
    crearVenta(db, {
      cliente_id: ana,
      tipo: 'credito',
      descuento: 0,
      detalles: [{ producto_id: a, cantidad: 5 }],
      pagos: [],
      operador_id: op,
    });
    vender(db, a, 1, 100, op, mostrador);
    registrarAbono(db, {
      cliente_id: ana,
      pagos: [{ monto: 2000, tipo_pago: 'efectivo', moneda: 'ves' }],
      operador_id: op,
    });

    const cierre = cerrarCaja(db, { caja_id: 1, operador_id: op, tasa_cierre: 10 });
    // El billete de Bs no se convierte a dólares para la gaveta: son dos
    // gavetas. Sumarlo a la de dólares daría un número que no se puede contar.
    expect(cierre.efectivo_esperado_usd).toBe(100);
    expect(cierre.efectivo_esperado_ves).toBe(2000);
  });

  it('guarda el cierre y ya no se puede volver a cerrar', () => {
    const { db, op, mostrador, a } = escenario();
    vender(db, a, 1, 100, op, mostrador);

    cerrarCaja(db, { caja_id: 1, operador_id: op, tasa_cierre: 10 });

    expect(cajaAbierta(db)).toBeNull();
    expect(obtenerCaja(db, 1).estado).toBe('cerrada');
    expect(codigoDe(() => cerrarCaja(db, { caja_id: 1, operador_id: op, tasa_cierre: 10 }))).toBe(
      CODIGO_ERROR.caja_no_abierta,
    );
  });

  it('el efectivo esperado sale del inicial más lo vendido, no de lo que hubiera escrito', () => {
    const { db, op, mostrador, a } = escenario();
    db.prepare('UPDATE cajas SET efectivo_esperado_usd = 99999 WHERE id = 1').run();
    vender(db, a, 2, 200, op, mostrador);

    const cierre = cerrarCaja(db, { caja_id: 1, operador_id: op, tasa_cierre: 10 });
    // 0 inicial + 200 cobrados. El 99999 escrito a mano no cuenta.
    expect(cierre.efectivo_esperado_usd).toBe(200);
  });

  it('rechaza cerrar una caja que no es la abierta', () => {
    const db = bd();
    const op = crearUsuario(db);
    abrir(db, op);
    abrir(db, op); // dos cajas abiertas: la 2 es la que vale
    expect(codigoDe(() => cerrarCaja(db, { caja_id: 1, operador_id: op, tasa_cierre: 10 }))).toBe(
      CODIGO_ERROR.validacion,
    );
    expect(cajaAbierta(db)?.id).toBe(2);
  });

  it('solo el operador que abrió la caja puede cerrarla', () => {
    const { db } = escenario();
    const otro = crearUsuario(db, 'Rosa');
    expect(codigoDe(() => cerrarCaja(db, { caja_id: 1, operador_id: otro, tasa_cierre: 10 }))).toBe(
      CODIGO_ERROR.validacion,
    );
    expect(cajaAbierta(db)).not.toBeNull();
  });

  it('rechaza una tasa de cambio imposible', () => {
    const { db, op } = escenario();
    expect(codigoDe(() => cerrarCaja(db, { caja_id: 1, operador_id: op, tasa_cierre: 0 }))).toBe(
      CODIGO_ERROR.validacion,
    );
    expect(cajaAbierta(db)).not.toBeNull();
  });

  it('guarda la tasa del cierre tal cual se envió', () => {
    const { db, op } = escenario();
    cerrarCaja(db, { caja_id: 1, operador_id: op, tasa_cierre: 36.5 });
    expect(obtenerCaja(db, 1).tasa_cierre).toBe(36.5);
  });
});
