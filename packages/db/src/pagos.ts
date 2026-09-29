// Pagos, abonos a cuenta e historial.
//
// Un pago sin factura es un abono a cuenta: el cliente entrega dinero sin que
// se lo apliquen a ninguna venta concreta. Sirve para saldar debtores que
// pagan por adelantado, o para alguien que quiere reducir su saldo sin que el
// sistema decida a qué factura se lo descuenta. El FIFO del estado de cuenta se
// encarga de imputarlo a la factura más antigua.
//
// El saldo pendiente se lee de `deudores.ts` y no se recalcula aquí: la regla
// del sistema es que la deuda se deriva siempre, nunca se guarda.

import type { DatabaseSync } from 'node:sqlite';
import type { AbonoInput, PagoLinea } from '@tienda/core';

import { ejecutar, qTodos, transaccion } from './db.js';
import { validacion } from './errors.js';
import { aUsd, HOLGURA_CENTIMOS } from './money.js';
import { getTasaCambio } from './config.js';
import { clienteExiste } from './repo.js';
import { exigirCajaAbierta } from './caja.js';
import { estadoCuenta } from './deudores.js';
import {
  validarCombinacionPago,
  validarMontoPositivo,
  validarTipoPago,
} from './validators.js';

/**
 * Registra un abono a cuenta: uno o varios pagos sin factura asociada.
 *
 * No se permite abonar más que el saldo pendiente. Abonar de más no es un error
 * de la tienda (el cliente puede estar pagando por adelantado), pero sí es un
 * error de este sistema: un abono que excede la deuda deja al cliente con saldo
 * cero y el dinero pagado sin destino, y no hay ninguna pantalla desde la que
 * devolverlo. Para eso está el botón de devolución, que sí deja rastro.
 */
export function registrarAbono(db: DatabaseSync, input: AbonoInput): void {
  if (input.pagos.length === 0) {
    throw validacion('El abono debe tener al menos un pago');
  }

  transaccion(db, () => {
    exigirCajaAbierta(db);
    clienteExiste(db, input.cliente_id);

    const saldo = estadoCuenta(db, input.cliente_id).saldo_pendiente;
    if (saldo <= 0) {
      throw validacion('El cliente no tiene saldo pendiente');
    }

    const tasaCambio = getTasaCambio(db);
    let totalUsd = 0;
    for (const p of input.pagos) {
      validarMontoPositivo(p.monto, 'Monto del abono');
      validarTipoPago(p.tipo_pago);
      validarCombinacionPago(p.tipo_pago, p.moneda, p.numero_referencia);
      totalUsd += aUsd(p.monto, p.moneda, tasaCambio);
    }

    if (totalUsd > saldo + HOLGURA_CENTIMOS) {
      throw validacion(
        `El abono (${totalUsd} centavos US$) supera el saldo pendiente (${saldo} centavos US$)`,
      );
    }

    for (const p of input.pagos) {
      ejecutar(
        db,
        `INSERT INTO pagos (cliente_id, venta_id, monto, tipo_pago, moneda, tasa_cambio,
                            numero_referencia, operador_id)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
        input.cliente_id,
        p.monto,
        p.tipo_pago,
        p.moneda,
        tasaCambio,
        p.numero_referencia ?? null,
        input.operador_id,
      );
    }
  });
}

/**
 * Historial de pagos de un cliente, incluidos sus abonos, del más reciente al
 * más antiguo.
 *
 * `numero_factura` viene `NULL` en los abonos: es la forma de distinguirlos en
 * la lista sin tener que mirar si hay venta o no.
 */
export function historialPagos(db: DatabaseSync, clienteId: number): PagoLinea[] {
  return qTodos<PagoLinea>(
    db,
    `SELECT p.id, p.venta_id, v.numero_factura, p.monto, p.tipo_pago, p.moneda,
            p.tasa_cambio, p.numero_referencia, p.fecha_pago
       FROM pagos p
       LEFT JOIN ventas v ON v.id = p.venta_id
      WHERE p.cliente_id = ?
      ORDER BY date(p.fecha_pago) DESC, p.id DESC`,
    clienteId,
  );
}
