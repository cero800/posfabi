// Devoluciones: mercadería que el cliente devuelve y la tienda descuenta de su
// cuenta.
//
// Lo que una devolución hace es RESTAR del total facturado del cliente (y por
// tanto bajar su saldo si estaba debiendo). Lo que NO hace, por defecto, es
// tocar el stock: la caja y la factura original quedan intactas.
//
// Sobre el stock hay una decisión explícita en la interfaz, la casilla
// "Reingresar al inventario", que llega como `afecta_stock`:
//   - `true`  → la mercadería vuelve a estar disponible. Es el caso normal en
//     papelería: un cuaderno devuelto sin estrenar se puede vender a otro
//     cliente. El movimiento queda asentado en el libro de inventario, así que
//     el cambio es rastreable.
//   - `false` → no se toca el stock. Para mercadería defectuosa, mojada o ya
//     retirada, que va a merma. Registrar esto sin `true` evita que se venda
//     algo que ya no sirve.
//
// La regla que no se negocia: lo devuelto de una factura nunca puede superar su
// total, ni contando devoluciones anteriores. Sin eso, un cliente podría
// "devolver" una y otra vez la misma factura hasta dejar su saldo en negativo y
// el deudor en un estado imposible de explicar.
//
// A diferencia de la venta y del abono, aquí NO se exige caja abierta, igual que
// en el backend original: una devolución no mueve la gaveta, solo la cuenta del
// cliente. El costo de esa permisividad se anota para que no se lea como
// descuido: una devolución registrada después de cerrar el turno no entra al
// resumen de ese día (que ya se imprimió) ni al del día siguiente (que filtra
// por su propia fecha). Queda solo en el historial del cliente.

import type { DatabaseSync } from 'node:sqlite';
import type {
  DetalleDevolucion,
  DetalleDevolucionInput,
  DetalleVentaDevolucion,
  Devolucion,
  DevolucionInput,
  VentaDevolucion,
} from '@tienda/core';

import { ejecutar, hoy, qTodos, qUno, transaccion } from './db.js';
import { AppError, CODIGO_ERROR, validacion } from './errors.js';
import { redondearCent } from './money.js';
import { clienteExiste, aplicarMovimiento } from './repo.js';
import { validarMontoPositivo } from './validators.js';

/**
 * Valida que el detalle cuadre con el monto declarado.
 *
 * El total se vuelve a calcular desde las líneas en lugar de confiar en el
 * número que envía la pantalla. Si no coincidieran, el saldo del cliente se
 * movería por una cifra distinta de la que dicen los productos devueltos, y el
 * detalle del comprobante no se podría ni auditar ni corregir.
 */
function validarDetalle(detalle: DetalleDevolucionInput[], monto: number): void {
  let suma = 0;
  for (const l of detalle) {
    validarMontoPositivo(l.precio_unitario, 'Precio unitario de la devolución');
    if (l.cantidad <= 0) {
      throw validacion('Cantidad a devolver debe ser mayor que 0 para cada producto');
    }
    suma += redondearCent(l.cantidad * l.precio_unitario, 'subtotal de la devolución');
  }
  if (suma !== monto) {
    throw validacion(
      `El detalle (${suma} centavos US$) no coincide con el monto de la devolución (${monto} centavos US$)`,
    );
  }
}

/** Inserta las líneas de detalle. Va dentro de la transacción de la devolución. */
function insertarDetalle(
  db: DatabaseSync,
  devolucionId: number,
  detalle: DetalleDevolucionInput[],
): void {
  for (const l of detalle) {
    ejecutar(
      db,
      `INSERT INTO detalle_devoluciones (devolucion_id, producto_id, cantidad, precio_unitario, subtotal)
       VALUES (?, ?, ?, ?, ?)`,
      devolucionId,
      l.producto_id,
      l.cantidad,
      l.precio_unitario,
      redondearCent(l.cantidad * l.precio_unitario, 'subtotal de la devolución'),
    );
  }
}

/** Líneas de detalle (productos devueltos) de una devolución. */
export function detalleDevolucion(db: DatabaseSync, devolucionId: number): DetalleDevolucion[] {
  return qTodos<DetalleDevolucion>(
    db,
    `SELECT dd.producto_id, p.nombre, dd.cantidad, dd.precio_unitario, dd.subtotal
       FROM detalle_devoluciones dd
       JOIN productos p ON p.id = dd.producto_id
      WHERE dd.devolucion_id = ?
      ORDER BY dd.id`,
    devolucionId,
  );
}

/**
 * Registra una devolución vinculada a una factura entregada.
 *
 * Devuelve la devolución ya con su número de factura y su detalle completo, que
 * es lo que la interfaz necesita para pintar el comprobante sin volver a
 * preguntar.
 */
export function registrarDevolucion(db: DatabaseSync, input: DevolucionInput): Devolucion {
  validarMontoPositivo(input.monto, 'Monto de la devolución');
  const detalle = input.detalle ?? [];
  if (detalle.length > 0) {
    validarDetalle(detalle, input.monto);
  }

  return transaccion(db, () => {
    clienteExiste(db, input.cliente_id);

    const venta = qUno<{ id: number; total: number; estado: string; numero_factura: number }>(
      db,
      'SELECT id, total, estado, numero_factura FROM ventas WHERE id = ? AND cliente_id = ?',
      input.venta_id,
      input.cliente_id,
    );
    if (venta === null) {
      throw new AppError(
        CODIGO_ERROR.no_encontrado,
        'No se encontró esa factura entre las ventas del cliente',
      );
    }
    if (venta.estado !== 'entregada') {
      throw validacion('Solo se pueden devolver ventas entregadas');
    }

    const yaDevuelto =
      qUno<{ n: number }>(
        db,
        'SELECT COALESCE(SUM(monto), 0) AS n FROM devoluciones WHERE venta_id = ?',
        input.venta_id,
      )?.n ?? 0;
    const devoluble = venta.total - yaDevuelto;
    if (input.monto > devoluble) {
      throw validacion(
        `La devolución (${input.monto} centavos US$) supera el saldo devoluble de la factura (${devoluble} centavos US$)`,
      );
    }

    const id = ejecutar(
      db,
      `INSERT INTO devoluciones (cliente_id, venta_id, monto, motivo, afecta_stock, operador_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      input.cliente_id,
      input.venta_id,
      input.monto,
      input.motivo,
      input.afecta_stock ? 1 : 0,
      input.operador_id,
    ).ultimoId;

    insertarDetalle(db, id, detalle);

    // El reingreso al stock va después de insertar la devolución, dentro de la
    // misma transacción. `aplicarMovimiento` abre un savepoint propio, así que
    // si aquí no hay stock que reponer, revierte solo su UPDATE y el error sube
    // hasta aquí, que revierte la devolución entera. Un asiento de inventario
    // sin devolución que lo justifique es peor que no hacer nada.
    if (input.afecta_stock) {
      for (const l of detalle) {
        aplicarMovimiento(
          db,
          {
            producto_id: l.producto_id,
            tipo: 'devolucion',
            cantidad: l.cantidad,
            motivo: `Devolución de la factura ${venta.numero_factura}`,
            venta_id: null,
            operador_id: input.operador_id,
            // `null` deja que SQLite ponga la hora actual, que es la misma que
            // usan los movimientos de venta y los que ven los reportes.
            fecha: null,
          },
          false,
        );
      }
    }

    return {
      id,
      cliente_id: input.cliente_id,
      venta_id: input.venta_id,
      numero_factura: venta.numero_factura,
      monto: input.monto,
      motivo: input.motivo,
      afecta_stock: input.afecta_stock,
      operador_id: input.operador_id,
      fecha_devolucion: hoy(db),
      // Se relee del libro y no se arma con los datos de entrada: así el
      // `nombre` del producto viene de la base, que es la única fuente
      // confiable si el artículo se renombró después de la venta.
      detalle: detalleDevolucion(db, id),
    };
  });
}

/**
 * Facturas entregadas de un cliente con lo ya devuelto de cada una.
 *
 * `total - devuelto` es lo que queda por devolver, que es el número que la
 * interfaz muestra al cajero antes de que abra el modal.
 */
export function listarVentasCliente(
  db: DatabaseSync,
  clienteId: number,
): VentaDevolucion[] {
  return qTodos<VentaDevolucion>(
    db,
    `SELECT v.id AS venta_id, v.numero_factura, v.tipo, v.fecha, v.total,
            COALESCE((SELECT SUM(d.monto) FROM devoluciones d WHERE d.venta_id = v.id), 0) AS devuelto
       FROM ventas v
      WHERE v.cliente_id = ? AND v.estado = 'entregada'
      ORDER BY v.fecha ASC, v.id ASC`,
    clienteId,
  );
}

/** Líneas de una factura, para el modal de devolución. */
export function detalleVenta(db: DatabaseSync, ventaId: number): DetalleVentaDevolucion[] {
  return qTodos<DetalleVentaDevolucion>(
    db,
    `SELECT d.producto_id, p.nombre, d.cantidad, d.precio_unitario, d.subtotal
       FROM detalle_ventas d
       JOIN productos p ON p.id = d.producto_id
      WHERE d.venta_id = ?
      ORDER BY d.id`,
    ventaId,
  );
}

/** Historial de devoluciones de un cliente, con el detalle de cada una. */
export function listarDevoluciones(db: DatabaseSync, clienteId: number): Devolucion[] {
  // `afecta_stock` se deja como 0/1 en la fila cruda porque el tipo del dominio
  // lo declara `boolean`; la conversión a booleano se hace al mapear.
  const filas = qTodos<Omit<Devolucion, 'detalle' | 'afecta_stock'> & { afecta_stock: number }>(
    db,
    `SELECT d.id, d.cliente_id, d.venta_id, v.numero_factura, d.monto, d.motivo,
            d.afecta_stock, d.operador_id, d.fecha_devolucion
       FROM devoluciones d
       JOIN ventas v ON v.id = d.venta_id
      WHERE d.cliente_id = ?
      ORDER BY d.id DESC`,
    clienteId,
  );
  return filas.map((d) => ({
    ...d,
    afecta_stock: d.afecta_stock !== 0,
    detalle: detalleDevolucion(db, d.id),
  }));
}
