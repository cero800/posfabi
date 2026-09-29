// Ventas / punto de venta.
//
// La creación de una venta es ATÓMICA de punta a punta: valida, reserva el
// número de factura, descuenta inventario, y graba cabecera, detalle y pagos. Un
// error a mitad revierte todo. Dos propiedades importan y por eso están aquí
// juntas y no repartidas en varias pantallas:
//
//   1. Nunca se vende mercadería que no está. El stock se descuenta DENTRO de la
//      misma transacción que inserta la línea, así que si la tercera línea no
//      hay stock, las dos primeras también se revierten. La alternativa
//      (descontar al final) deja la venta a medio hacer si algo falla.
//
//   2. El número de factura nunca se reutiliza ni se salta. Se reserva dentro
//      de la transacción, así que si la venta falla, el número vuelve a quedar
//      libre; si la venta se anula, el número queda consumido. Un número de
//      factura que se repite es un problema legal y contable.

import type { DatabaseSync } from 'node:sqlite';
import type { Venta, VentaInput } from '@tienda/core';

import { ejecutar, hoy, qObligatorio, qTodos, qUno, transaccion } from './db.js';
import { AppError, CODIGO_ERROR, validacion } from './errors.js';
import { aUsd, cent, HOLGURA_CENTIMOS, redondearCent } from './money.js';
import { getTasaCambio } from './config.js';
import { clienteExiste, descontarStock, precioEfectivo, reponerStock } from './repo.js';
import { exigirCajaAbierta } from './caja.js';
import { pagosImputadosAVenta } from './deudores.js';
import {
  validarCantidadVenta,
  validarCombinacionPago,
  validarDescuento,
  validarMonto,
  validarMontoPositivo,
  validarTipoPago,
  validarTipoVenta,
} from './validators.js';

const KEY_ULTIMA_FACTURA = 'ultimo_numero_factura';

/** Una línea de venta con el precio ya resuelto y el subtotal redondeado. */
interface LineaResuelta {
  producto_id: number;
  cantidad: number;
  precio: number;
  subtotal: number;
  impuesto: number;
}

/**
 * Suma de los pagos en su moneda, convertida a US$ con la tasa del momento.
 *
 * Se usa para comprobar que el pago cubre el total. Un cliente puede pagar
 * $5 en efectivo y Bs 184,25 en una venta de $10: cada línea va en su moneda y
 * la comparación se hace en la moneda base, que es la única en la que el total
 * está expresado.
 */
function pagosEnUsd(input: VentaInput, tasaCambio: number): number {
  let total = 0;
  for (const p of input.pagos) {
    validarMontoPositivo(p.monto, 'Monto del pago');
    validarTipoPago(p.tipo_pago);
    validarCombinacionPago(p.tipo_pago, p.moneda, p.numero_referencia);
    total += aUsd(p.monto, p.moneda, tasaCambio);
  }
  return total;
}

/**
 * Reserva el siguiente número de factura.
 *
 * Va dentro de la transacción de la venta a propósito. Reservarlo antes
 * significaría que una venta fallida por falta de stock dejaría un hueco en la
 * numeración; reservarlo dentro significa que el número se devuelve con el
 * rollback. La contrapartida es que hay que asegurar que nadie más lea el
 * correlativo fuera de la transacción.
 */
function reservarNumeroFactura(db: DatabaseSync): number {
  const actual =
    qUno<{ n: number }>(
      db,
      `SELECT COALESCE(CAST((SELECT valor FROM config WHERE clave = ?) AS INTEGER), 0) AS n`,
      KEY_ULTIMA_FACTURA,
    )?.n ?? 0;
  const nuevo = cent(actual + 1, 'número de factura');
  ejecutar(
    db,
    `INSERT INTO config (clave, valor) VALUES (?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
    KEY_ULTIMA_FACTURA,
    String(nuevo),
  );
  return nuevo;
}

/** Comprueba que un cliente admita crédito. */
function exigirCredito(db: DatabaseSync, clienteId: number, tipo: string): void {
  if (tipo !== 'credito') return;
  const cliente = qObligatorio<{ es_mostrador: number }>(
    db,
    'Cliente',
    'SELECT es_mostrador FROM clientes WHERE id = ? AND activo = 1',
    clienteId,
  );
  if (cliente.es_mostrador !== 0) {
    // El cliente Mostrador es el consumidor anónimo del mostrador. Fijarle una
    // deuda sin documento ni plazo es deuda que nadie va a cobranza.
    throw validacion('El cliente Mostrador no admite ventas a crédito');
  }
}

/**
 * Registra una venta completa.
 *
 * Los totales se calculan una sola vez, dentro de la transacción. El original
 * los calculaba dos veces (una antes de abrir la transacción para validar, otra
 * dentro) y luego escribía la cabecera con valores provisionales y la
 * corregía con un UPDATE. Como todo pasa en el mismo proceso y la misma base,
 * la segunda pasada no podía diferir de la primera, así que solo servía para
 * duplicar el cálculo.
 */
export function crearVenta(db: DatabaseSync, input: VentaInput): Venta {
  validarTipoVenta(input.tipo);
  if (input.detalles.length === 0) {
    throw validacion('La venta debe tener al menos un producto');
  }
  if (input.tipo === 'contado' && input.pagos.length === 0) {
    throw validacion('Una venta de contado requiere el registro del pago');
  }

  return transaccion(db, () => {
    exigirCajaAbierta(db);
    clienteExiste(db, input.cliente_id);
    exigirCredito(db, input.cliente_id, input.tipo);

    // Foto de la tasa. Vale para toda la venta y para todos sus pagos: aunque la
    // cambien a mitad del día, esta factura conserva la que tenía cuando se cobró.
    const tasaCambio = getTasaCambio(db);

    // Los pagos se validan y se suman antes que los detalles: si el pago está
    // mal (moneda inválida, pago móvil sin referencia) es un error de tecleo
    // del cajero y se avisa antes de haber tocado el inventario.
    const pagadoUsd = pagosEnUsd(input, tasaCambio);

    // Cada línea se resuelve UNA vez: se consulta el precio, se redondea el
    // subtotal y se guarda. El original volvía a preguntar el precio al momento
    // de insertar el detalle, lo que hacía dos consultas por línea y abría la
    // puerta a que el precio del detalle no cuadrara con el del total si algo
    // cambiaba en medio.
    const lineas: LineaResuelta[] = input.detalles.map((d) => {
      const { precio, impuestoPorcentaje, unidad } = precioEfectivo(
        db,
        d.producto_id,
        input.cliente_id,
      );
      validarCantidadVenta(d.cantidad, unidad);
      const subtotal = redondearCent(d.cantidad * precio, 'subtotal');
      return {
        producto_id: d.producto_id,
        cantidad: d.cantidad,
        precio,
        subtotal,
        impuesto: redondearCent((subtotal * impuestoPorcentaje) / 100, 'impuesto'),
      };
    });

    const subtotalBruto = lineas.reduce((s, l) => s + l.subtotal, 0);
    const impuesto = lineas.reduce((s, l) => s + l.impuesto, 0);

    validarDescuento(input.descuento, subtotalBruto);
    const total = subtotalBruto - input.descuento + impuesto;
    validarMonto(total, 'Total');
    if (total < 0) {
      throw validacion('El total no puede ser negativo');
    }

    if (input.tipo === 'contado' && pagadoUsd < total) {
      throw validacion(
        `El pago (${pagadoUsd} centavos US$) no cubre el total (${total} centavos US$)`,
      );
    }
    if (pagadoUsd > total + HOLGURA_CENTIMOS) {
      // Se tolera un céntimo: al repartir un pago entre várias monedas, los
      // redondeos de cada conversión pueden dejar el total un céntimo por
      // debajo. Más que eso ya es un sobrepago, y el cambio se lo lleva la
      // tienda.
      throw validacion('El pago supera el total de la venta (no se permite sobrepago)');
    }

    const numeroFactura = reservarNumeroFactura(db);
    // La fecha se lee con el mismo criterio que los reportes: una venta que
    // casara de medianoche quedaría archivada en el día que cualquier consulta
    // posterior iría a buscar.
    const fechaVenta = hoy(db);
    const ventaId = ejecutar(
      db,
      `INSERT INTO ventas (cliente_id, numero_factura, tipo, fecha, subtotal, descuento,
                           impuesto, total, moneda, tasa_cambio, operador_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'usd', ?, ?)`,
      input.cliente_id,
      numeroFactura,
      input.tipo,
      fechaVenta,
      subtotalBruto - input.descuento,
      input.descuento,
      impuesto,
      total,
      tasaCambio,
      input.operador_id,
    ).ultimoId;

    for (const l of lineas) {
      // El stock se descuenta ANTES de grabar la línea. Si aquí no hay
      // mercadería, el error sube y la transacción revierte las líneas que ya
      // se habían descontado.
      descontarStock(db, l.producto_id, l.cantidad, ventaId, input.operador_id);

      ejecutar(
        db,
        `INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, precio_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?)`,
        ventaId,
        l.producto_id,
        l.cantidad,
        l.precio,
        l.subtotal,
      );
    }

    for (const p of input.pagos) {
      ejecutar(
        db,
        `INSERT INTO pagos (cliente_id, venta_id, monto, tipo_pago, moneda, tasa_cambio,
                            numero_referencia, operador_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        input.cliente_id,
        ventaId,
        p.monto,
        p.tipo_pago,
        p.moneda,
        tasaCambio,
        p.numero_referencia ?? null,
        input.operador_id,
      );
    }

    return {
      id: ventaId,
      cliente_id: input.cliente_id,
      numero_factura: numeroFactura,
      tipo: input.tipo,
      estado: 'entregada',
      fecha: fechaVenta,
      subtotal: subtotalBruto - input.descuento,
      descuento: input.descuento,
      impuesto,
      total,
      operador_id: input.operador_id,
      moneda: 'usd',
      tasa_cambio: tasaCambio,
    };
  });
}

/** Historial de facturas, de la más reciente a la más antigua. */
export function listarVentas(db: DatabaseSync, limite?: number): Venta[] {
  const base = `SELECT id, cliente_id, numero_factura, tipo, estado, fecha, subtotal, descuento,
                       impuesto, total, operador_id, moneda, tasa_cambio
                  FROM ventas ORDER BY fecha DESC, id DESC`;
  return limite === undefined
    ? qTodos<Venta>(db, base)
    : qTodos<Venta>(db, `${base} LIMIT ?`, limite);
}

/** Una venta por id. */
export function obtenerVenta(db: DatabaseSync, id: number): Venta {
  return qObligatorio<Venta>(
    db,
    'Venta',
    `SELECT id, cliente_id, numero_factura, tipo, estado, fecha, subtotal, descuento,
            impuesto, total, operador_id, moneda, tasa_cambio
       FROM ventas WHERE id = ?`,
    id,
  );
}

/** Ventas de un cliente, para su estado de cuenta. */
export function listarVentasCliente(db: DatabaseSync, clienteId: number): Venta[] {
  return qTodos<Venta>(
    db,
    `SELECT id, cliente_id, numero_factura, tipo, estado, fecha, subtotal, descuento,
            impuesto, total, operador_id, moneda, tasa_cambio
       FROM ventas WHERE cliente_id = ? ORDER BY fecha DESC, id DESC`,
    clienteId,
  );
}

/**
 * ¿Hay dinero detrás de esta venta?
 *
 * Dos maneras de que lo haya, y las dos importan:
 *
 *   1. Un pago con `venta_id` apuntando aquí. Es el caso normal de la venta de
 *      contado, y no hay discusión posible: el cobro se hizo por esta factura.
 *
 *   2. Un abono a cuenta que el FIFO le imputa a esta venta. Una venta a
 *      crédito no tiene pagos propios, así que (1) nunca se dispara y el
 *      dinero del cliente quedaría repartido entre facturas sin que ninguna
 *      lo reflejara.
 *
 * El FIFO solo se consulta para ventas a crédito. En las de contado daría una
 * respuesta falsa en las dos direcciones: todas las ventas del Mostrador
 * comparten cliente, así que repartir su bolsa por fecha atribuiría el pago de
 * una factura a otra más vieja y dejaría pasar anulaciones de ventas que sí se
 * cobraron. Para el Mostrador, (1) es exacto y basta.
 */
function tienePagos(
  db: DatabaseSync,
  venta: { cliente_id: number; tipo: string },
  ventaId: number,
): boolean {
  const directos = qUno<{ n: number }>(
    db,
    'SELECT COUNT(*) AS n FROM pagos WHERE venta_id = ?',
    ventaId,
  );
  if ((directos?.n ?? 0) > 0) return true;
  if (venta.tipo !== 'credito') return false;
  return pagosImputadosAVenta(db, venta.cliente_id, ventaId);
}

/**
 * Anula una venta: devuelve la mercadería al stock y marca la venta como anulada.
 *
 * El número de factura se conserva y no se reutiliza: una factura anulada sigue
 * siendo una factura que existió, y en la contabilidad no se borra.
 *
 * Solo se anula lo que no está cobrado. Anular una venta con dinero detrás
 * entregaría la mercadería y dejaría el pago sin factura que lo respaldara: el
 * efectivo sigue en el arqueo del día (el arqueo suma `pagos`, no `ventas`) y
 * el saldo del cliente se recorta a cero, así que ni la tienda ni el cliente
 * pueden ver ese dinero en ninguna parte. La anulación es para las ventas mal
 * hechas, no un refund; lo que se devuelve de una venta cobrada es una
 * devolución, que sí deja rastro y sí devuelve la mercadería al stock.
 *
 * La fecha de la venta es la que fija el FIFO del deudor, así que anular una
 * factura vieja no rejuvenece al cliente.
 */
export function anularVenta(
  db: DatabaseSync,
  ventaId: number,
  motivo: string,
  operadorId: number,
): void {
  const limpio = motivo.trim();
  if (limpio === '') {
    throw validacion('La anulación requiere un motivo');
  }

  const venta = qUno<{ estado: string; cliente_id: number; tipo: string }>(
    db,
    'SELECT estado, cliente_id, tipo FROM ventas WHERE id = ?',
    ventaId,
  );
  if (venta === null) throw new AppError(CODIGO_ERROR.no_encontrado, 'Venta no encontrada');
  if (venta.estado === 'anulada') {
    throw new AppError(CODIGO_ERROR.venta_anulada, 'La venta ya está anulada');
  }

  transaccion(db, () => {
    // Dentro de la transacción, no antes: un abono que entra entre la
    // comprobación y la escritura tiene que ver la venta todavía viva.
    if (tienePagos(db, venta, ventaId)) {
      throw new AppError(
        CODIGO_ERROR.venta_con_pagos,
        'La venta tiene pagos asociados. No se puede anular porque el dinero ' +
          'ya cambió de manos: registrá la devolución de la mercadería.',
      );
    }

    const lineas = qTodos<{ producto_id: number; cantidad: number }>(
      db,
      'SELECT producto_id, cantidad FROM detalle_ventas WHERE venta_id = ? ORDER BY id',
      ventaId,
    );

    for (const l of lineas) {
      // `reponerStock` suma al stock y asienta el movimiento en el libro.
      reponerStock(db, l.producto_id, l.cantidad, ventaId, operadorId);
    }

    ejecutar(
      db,
      "UPDATE ventas SET estado = 'anulada', anulada_motivo = ? WHERE id = ?",
      limpio,
      ventaId,
    );
  });
}
