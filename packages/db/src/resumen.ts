// Resumen del día: qué entró, qué salió y quién debe.
//
// Este módulo existe aparte de `caja.ts` por un motivo concreto: el cierre de
// caja necesita las ventas y las devoluciones del día, y el resumen también
// necesita el estado de cuenta de los deudores. Si el resumen viviera dentro
// de caja.ts, caja ↔ resumen serían un ciclo de importaciones. Separados, cada
// uno depende del que tiene menos responsabilidades.
//
// `cerrarCaja` lo usa tal cual, para que el comprobante impreso y los números
// guardados no puedan discrepar.

import type { DatabaseSync } from 'node:sqlite';
import type { EntradaResumen, ResumenDia, ResumenDiaDevolucion } from '@tienda/core';

import { HOY_SQL, qTodos, qUno } from './db.js';
import { estadoCuentaTodos } from './deudores.js';
import { detalleDevolucion } from './devoluciones.js';

/**
 * Condición de fecha para una columna, con o sin día explícito.
 *
 * Sin fecha usa `HOY_SQL`, el día local de la tienda; ver `db.ts` para por qué no
 * es el de UTC. Se compara con `date(...)` en los dos lados porque las fechas se
 * guardan como texto y `2026-09-01 14:30:00` no es igual a `2026-09-01` en una
 * comparación cruda.
 */
function filtroFecha(columna: string, fecha: string | null): { sql: string; params: (string | null)[] } {
  return fecha === null || fecha === ''
    ? { sql: `date(${columna}) = ${HOY_SQL}`, params: [] }
    : { sql: `date(${columna}) = date(?)`, params: [fecha] };
}

/** Entradas de mercadería del día. */
function entradas(db: DatabaseSync, fecha: string | null): EntradaResumen[] {
  const f = filtroFecha('e.fecha', fecha);
  return qTodos<EntradaResumen>(
    db,
    `SELECT p.nombre AS producto, e.cantidad, e.costo_unitario
       FROM entradas_mercancia e JOIN productos p ON p.id = e.producto_id
      WHERE ${f.sql}
      ORDER BY e.id DESC`,
    ...f.params,
  );
}

/**
 * Ventas entregadas del día, con lo devuelto de cada factura ese mismo día.
 *
 * `devuelto` se limita a devoluciones de la MISMA fecha que la venta, para que
 * cuadre con la lista de devoluciones del día y el neto (ventas − devoluciones)
 * sea el mismo número por los dos lados.
 */
function ventas(db: DatabaseSync, fecha: string | null): ResumenDia['ventas'] {
  const f = filtroFecha('v.fecha', fecha);
  return qTodos<ResumenDia['ventas'][number]>(
    db,
    `SELECT v.id AS venta_id, v.numero_factura, c.nombre AS cliente, v.tipo, v.total AS monto,
            v.estado, v.tasa_cambio,
            (SELECT COALESCE(SUM(d.monto), 0) FROM devoluciones d
              WHERE d.venta_id = v.id AND date(d.fecha_devolucion) = date(v.fecha)) AS devuelto
       FROM ventas v JOIN clientes c ON c.id = v.cliente_id
      WHERE ${f.sql} AND v.estado = 'entregada'
      ORDER BY v.id`,
    ...f.params,
  );
}

/**
 * Devoluciones registradas durante el día, incluidas las de facturas de días
 * anteriores: son el "perdido" de la cuenta del día.
 */
function devolucionesDelDia(db: DatabaseSync, fecha: string | null): ResumenDiaDevolucion[] {
  const f = filtroFecha('d.fecha_devolucion', fecha);
  const filas = qTodos<Omit<ResumenDiaDevolucion, 'detalle'>>(
    db,
    `SELECT d.id, d.venta_id, v.numero_factura, c.nombre AS cliente, d.monto, d.motivo,
            COALESCE(u.nombre, '') AS operador_nombre, d.fecha_devolucion
       FROM devoluciones d
       JOIN ventas v   ON v.id = d.venta_id
       JOIN clientes c ON c.id = d.cliente_id
       LEFT JOIN usuarios u ON u.id = d.operador_id
      WHERE ${f.sql}
      ORDER BY d.id`,
    ...f.params,
  );

  return filas.map((d) => ({ ...d, detalle: detalleDevolucion(db, d.id) }));
}

/** Pagos en efectivo del día, separados por moneda. */
function efectivoDelDia(db: DatabaseSync, fecha: string | null): {
  usd: number;
  ves: number;
} {
  const f = filtroFecha('fecha_pago', fecha);
  return (
    qUno<{ usd: number; ves: number }>(
      db,
      `SELECT COALESCE(SUM(CASE WHEN moneda = 'usd' THEN monto ELSE 0 END), 0) AS usd,
              COALESCE(SUM(CASE WHEN moneda = 'ves' THEN monto ELSE 0 END), 0) AS ves
         FROM pagos
        WHERE tipo_pago = 'efectivo' AND ${f.sql}`,
      ...f.params,
    ) ?? { usd: 0, ves: 0 }
  );
}

/**
 * Resumen completo del día, o del día que se le pase.
 *
 * `fecha` en `null` o vacío significa hoy.
 */
export function resumenDia(db: DatabaseSync, fecha: string | null = null): ResumenDia {
  const efectivo = efectivoDelDia(db, fecha);

  return {
    entradas: entradas(db, fecha),
    ventas: ventas(db, fecha),
    pagos_efectivo_usd: efectivo.usd,
    pagos_efectivo_ves: efectivo.ves,
    devoluciones: devolucionesDelDia(db, fecha),
    // Deudores: solo los que deben algo. Mostrar a los que están al día en una
    // lista de cobranza solo hace ruido.
    deudores: estadoCuentaTodos(db).filter((d) => d.saldo_pendiente > 0),
  };
}
