// La factura de una venta, reunida en un solo objeto.
//
// Esto es una consulta, no un generador de documentos. El PDF lo dibuja
// `facturaPdf.ts` con jsPDF en el webview y el ticket térmico lo arma
// `ticket.ts` con bytes ESC/POS en el backend; los dos necesitan exactamente
// estos mismos datos, y ninguno de los dos debería tener que volver a la base a
// buscarlos por su cuenta.
//
// Reúne las cinco cosas que un comprobante necesita y que viven en cinco
// lugares distintos: la cabecera de la venta, el cliente, el detalle de
// productos, los pagos y los datos del negocio emisor.

import type { DatabaseSync } from 'node:sqlite';
import type { Factura, FacturaDetalle, FacturaPago, ResumenDiaDevolucion } from '@tienda/core';

import { qTodos, qUno } from './db.js';
import { noEncontrado } from './errors.js';
import { datosNegocio } from './config.js';
import { detalleDevolucion } from './devoluciones.js';

/** Cabecera de la venta: los campos que salen del `SELECT` de `ventas`. */
interface CabeceraVenta {
  cliente_id: number;
  numero_factura: number;
  tipo: Factura['tipo'];
  estado: Factura['estado'];
  fecha: string;
  subtotal: number;
  descuento: number;
  impuesto: number;
  total: number;
  tasa_cambio: number;
}

/**
 * Factura completa de una venta: cabecera, cliente, detalle, pagos y las
 * devoluciones que se le hicieron después.
 *
 * Las devoluciones van incluidas a propósito, aunque la venta ya esté anulada.
 * Un comprobante de una venta anulada con su devolución pegada es el papel que
 * el cliente necesita para reclamar que ya devolvió; sacarle esa información
 * sería esconder el único registro que lo demuestra.
 *
 * Falla si la venta no existe, y también si la venta existe pero su cliente no.
 * Lo segundo no debería pasar nunca (la llave foránea lo impide), así que su
 * error dice `sistema` y no `no_encontrado`: si aparece, hay corrupción en la
 * base y conviene saberlo.
 */
export function facturaVenta(db: DatabaseSync, ventaId: number): Factura {
  const cabecera = qUno<CabeceraVenta>(
    db,
    `SELECT cliente_id, numero_factura, tipo, estado, fecha,
            subtotal, descuento, impuesto, total, tasa_cambio
       FROM ventas WHERE id = ?`,
    ventaId,
  );
  if (cabecera === null) {
    throw noEncontrado('Venta', 'f');
  }

  const cliente = qUno<{ nombre: string; documento: string; dias_credito: number }>(
    db,
    'SELECT nombre, documento, dias_credito FROM clientes WHERE id = ?',
    cabecera.cliente_id,
  );
  if (cliente === null) {
    throw new Error(
      `La venta ${ventaId} apunta al cliente ${cabecera.cliente_id}, que no existe`,
    );
  }

  const detalle = qTodos<FacturaDetalle>(
    db,
    `SELECT p.nombre AS producto, d.cantidad, d.precio_unitario, d.subtotal
       FROM detalle_ventas d
       JOIN productos p ON p.id = d.producto_id
      WHERE d.venta_id = ?
      ORDER BY d.id`,
    ventaId,
  );

  const pagos = qTodos<FacturaPago>(
    db,
    `SELECT tipo_pago, moneda, monto, numero_referencia
       FROM pagos WHERE venta_id = ? ORDER BY id`,
    ventaId,
  );

  const negocio = datosNegocio(db);

  return {
    venta_id: ventaId,
    numero_factura: cabecera.numero_factura,
    tipo: cabecera.tipo,
    estado: cabecera.estado,
    fecha: cabecera.fecha,
    cliente: cliente.nombre,
    // `clientes.documento` es NOT NULL: todo cliente, hasta el de mostrador, se
    // da de alta con cédula, RIF o NIT. No hay caso en que este campo salga
    // vacío, y si algún día lo hubiera el PDF imprimiría "undefined".
    cliente_documento: cliente.documento,
    dias_credito: cliente.dias_credito,
    negocio_nombre: negocio.nombre,
    negocio_rif: negocio.rif,
    negocio_telefono: negocio.telefono,
    negocio_direccion: negocio.direccion,
    subtotal: cabecera.subtotal,
    descuento: cabecera.descuento,
    impuesto: cabecera.impuesto,
    total: cabecera.total,
    tasa_cambio: cabecera.tasa_cambio,
    detalle,
    pagos,
    devoluciones: devolucionesDeVenta(db, ventaId),
  };
}

/** Devoluciones de una venta, cada una con su detalle de productos. */
function devolucionesDeVenta(db: DatabaseSync, ventaId: number): ResumenDiaDevolucion[] {
  return qTodos<ResumenDiaDevolucion>(
    db,
    `SELECT d.id, d.venta_id, v.numero_factura, c.nombre AS cliente, d.monto,
            d.motivo, COALESCE(u.nombre, '') AS operador_nombre,
            d.fecha_devolucion
       FROM devoluciones d
       JOIN ventas v  ON v.id = d.venta_id
       JOIN clientes c ON c.id = d.cliente_id
       LEFT JOIN usuarios u ON u.id = d.operador_id
      WHERE d.venta_id = ?
      ORDER BY d.id`,
    ventaId,
  ).map((d) => ({ ...d, detalle: detalleDevolucion(db, d.id) }));
}
