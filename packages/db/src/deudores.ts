// Estado de cuenta de los clientes.
//
// Aquí vive la aritmética de deuda, que es la parte del sistema donde un error
// de un céntimo se propaga durante meses. La regla del sistema es que el saldo
// NUNCA se guarda: se deriva siempre de (ventas − devoluciones − pagos). Si se
// guardara, cualquier venta o abono que se perdiera desincronizaría el saldo
// almacenado del que se muestra al cliente, y no habría forma de saber cuál de
// los dos mentía.
//
// Los pagos pueden venir en bolívares, así que se convierten a US$ con la tasa
// congelada de CADA pago, no con la tasa de hoy. Si no, cambiar la tasa de un
// día a otro reescribiría la historia de lo que el cliente ya pagó.

import type { DatabaseSync } from 'node:sqlite';
import type { EstadoCuenta } from '@tienda/core';

import { qTodos, qUno } from './db.js';
import { noEncontrado } from './errors.js';

/** Una factura dentro del FIFO, con la marca de si todavía está en plazo. */
interface LineaFifo {
  saldo: number;
  alDia: boolean;
}

/** Totales derivados: lo facturado, lo devuelto y lo pagado en US$. */
interface Totales {
  facturado: number;
  devuelto: number;
  pagado: number;
}

/**
 * Reparte los pagos acumulados sobre las ventas entregadas más antiguas y
 * devuelve de cuánto es el vencido.
 *
 * Es FIFO y no proporcional a propósito: si el cliente tiene una factura vieja
 * de $5 y otra de $100, y ha pagado $30, lo natural es que la de $5 esté
 * saldada y queden $75 de la otra. Si la vieja está en mora, es la que se
 * persigue. Repartir proporcionalmente dejaría ambas a medio pagar y no
 * señalaría ninguna.
 */
function calcularVencido(lineas: LineaFifo[], pagado: number): number {
  let porPagar = pagado;
  let vencido = 0;

  for (const { saldo, alDia } of lineas) {
    if (saldo <= 0) continue;
    if (porPagar >= saldo) {
      porPagar -= saldo;
    } else if (porPagar > 0) {
      // El pago alcanza a cubrir parte de esta factura pero no toda.
      if (!alDia) vencido += saldo - porPagar;
      porPagar = 0;
    } else if (!alDia) {
      // No queda pago para esta factura y su plazo ya venció.
      vencido += saldo;
    }
  }

  return vencido;
}

/**
 * Totales derivados: lo facturado, lo devuelto y lo pagado en US$.
 *
 * Las tres sumas tienen que mirar el mismo conjunto de ventas. La de
 * devoluciones se ancla a `ventas.estado = 'entregada'` a propósito, y no por
 * simetría sino porque sin ese filtro el total queda mal en dos direcciones:
 *
 *   - Si el cliente devuelve mercadería y después se anula esa factura, la
 *     devolución sigue descontando y `facturado` se vuelve negativo. El saldo
 *     queda en cero por el `max(..., 0)`, pero la pantalla muestra "Facturado:
 *     −$1,00" de un cliente que no debe nada.
 *   - Peor: si el cliente devuelve de la factura A ($100) y se anula A, esa
 *     devolución sigue apuntando a la factura B ($200) que sigue viva, y le
 *     descuenta $100 de una deuda que sí existe. El cliente aparece debiendo
 *     la mitad de lo que debe, y nadie sabe de dónde salió ese número.
 *
 * El FIFO de `lineasCliente` sí filtraba por `entregada` desde el principio, así
 * que el desglose de vencido y el total contaban historias distintas sobre la
 * misma deuda. Con el filtro, los dos leen lo mismo.
 */
function totalesCliente(db: DatabaseSync, clienteId: number): Totales {
  return qUno<Totales>(
    db,
    `SELECT
        COALESCE((SELECT SUM(total) FROM ventas
                   WHERE cliente_id = ?1 AND estado = 'entregada'), 0)  AS facturado,
        COALESCE((SELECT SUM(d.monto) FROM devoluciones d
                   JOIN ventas v ON v.id = d.venta_id
                   WHERE d.cliente_id = ?1 AND v.estado = 'entregada'), 0) AS devuelto,
        COALESCE((SELECT SUM(CASE WHEN moneda = 'usd' THEN monto
                                  ELSE monto / tasa_cambio END)
                    FROM pagos WHERE cliente_id = ?1), 0)             AS pagado`,
    clienteId,
  )!;
}

/** Ventas entregadas del cliente con su saldo ya descontadas devoluciones. */
function lineasCliente(db: DatabaseSync, clienteId: number, diasCredito: number): LineaFifo[] {
  return qTodos<{ saldo: number; al_dia: number }>(
    db,
    `SELECT v.total - COALESCE((SELECT SUM(d.monto) FROM devoluciones d
                                 WHERE d.venta_id = v.id), 0) AS saldo,
            (date('now') <= date(v.fecha, '+' || ?2 || ' days')) AS al_dia
       FROM ventas v
      WHERE v.cliente_id = ?1 AND v.estado = 'entregada'
      ORDER BY v.fecha ASC, v.id ASC`,
    clienteId,
    diasCredito,
  ).map((f) => ({ saldo: f.saldo, alDia: f.al_dia !== 0 }));
}

/** Arma el `EstadoCuenta` a partir de datos ya consultados. */
function componer(
  clienteId: number,
  nombre: string,
  diasCredito: number,
  t: Totales,
  lineas: LineaFifo[],
): EstadoCuenta {
  const facturado = t.facturado - t.devuelto;
  const pagado = Math.round(t.pagado);
  const saldo = Math.max(facturado - pagado, 0);
  const vencido = calcularVencido(lineas, pagado);

  return {
    cliente_id: clienteId,
    nombre,
    total_facturado: facturado,
    total_pagado: pagado,
    saldo_pendiente: saldo,
    total_vencido: vencido,
    total_al_dia: Math.max(saldo - vencido, 0),
    dias_credito: diasCredito,
  };
}

/**
 * Estado de cuenta de un cliente.
 *
 * El saldo nunca es negativo: una devolución de contado no genera "crédito a
 * favor" que el cliente pueda usar después para no pagar otra cosa. Es una
 * decisión de negocio, y por eso el `max(..., 0)` aparece en todos los lugares
 * donde se deriva un saldo.
 */
export function estadoCuenta(db: DatabaseSync, clienteId: number): EstadoCuenta {
  const cliente = qUno<{ nombre: string; dias_credito: number }>(
    db,
    'SELECT nombre, dias_credito FROM clientes WHERE id = ? AND activo = 1',
    clienteId,
  );
  if (cliente === null) throw noEncontrado('Cliente');

  return componer(
    clienteId,
    cliente.nombre,
    cliente.dias_credito,
    totalesCliente(db, clienteId),
    lineasCliente(db, clienteId, cliente.dias_credito),
  );
}

/**
 * Estados de cuenta de todos los clientes activos, del que más debe al que
 * menos.
 *
 * Son dos pasos a propósito. La primera consulta solo trae los ids en orden de
 * saldo, porque el desglose de vencido es un FIFO sobre las facturas en orden
 * de fecha y no se puede escribir en el mismo SELECT sin Window Functions. La
 * segunda arma cada estado con `estadoCuenta`, que ya sabe hacerlo bien.
 *
 * Son unas dos consultas pequeñas por cliente. Una papelería tiene decenas, no
 * miles, y esta pantalla se abre una vez al cierre: wasteful antes que lento.
 */
export function estadoCuentaTodos(db: DatabaseSync): EstadoCuenta[] {
  const orden = qTodos<{ id: number }>(
    db,
    `SELECT c.id
       FROM clientes c
      WHERE c.activo = 1
      ORDER BY MAX(0,
               COALESCE((SELECT SUM(v.total) FROM ventas v
                          WHERE v.cliente_id = c.id AND v.estado = 'entregada'), 0)
               - COALESCE((SELECT SUM(d.monto) FROM devoluciones d
                            JOIN ventas dv ON dv.id = d.venta_id
                            WHERE d.cliente_id = c.id AND dv.estado = 'entregada'), 0)
               - CAST(ROUND(COALESCE((SELECT SUM(CASE WHEN p.moneda = 'usd' THEN p.monto
                                                      ELSE p.monto / p.tasa_cambio END)
                                       FROM pagos p WHERE p.cliente_id = c.id), 0)) AS INTEGER)
             ) DESC, c.nombre ASC`,
  );

  return orden.map(({ id }) => estadoCuenta(db, id));
}
