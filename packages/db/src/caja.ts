// Caja / arqueo de turno.
//
// Máquina de estados: solo puede haber UNA caja abierta a la vez. No se puede
// vender ni abonar sin caja abierta, porque si no el dinero entra a un limbo del
// que nadie sabe dar cuenta al cierre.
//
// El arqueo es POR MONEDA: el efectivo en dólares y el efectivo en bolívares se
// cuentan y se reconcilian por separado. Juntarlos en un total es imposible,
// porque a la tienda no se le puede pasar "un número" sin saber cuánto de eso
// eran dólares para convertirlo a la tasa del cierre.
//
// El cierre NO toca el stock: el inventario es acumulativo y persiste entre
// días.

import type { DatabaseSync } from 'node:sqlite';
import type {
  Caja,
  CajaAbrirInput,
  CajaCerrarInput,
  CierreAbono,
  CierreCajaPago,
  CierreDia,
  Moneda,
  ResumenDiaVenta,
  TipoPago,
} from '@tienda/core';

import { qObligatorio, qTodos, qUno, transaccion, ejecutar } from './db.js';
import { AppError, CODIGO_ERROR, validacion } from './errors.js';
import { aUsd, aVes, redondearCent, tasa as validarTasaCambio } from './money.js';
import { datosNegocio, getTasaCambio } from './config.js';
import { resumenDia } from './resumen.js';

// Los alias importan: el mapeo de `node:sqlite` devuelve las claves tal como
// las llama el SQL, así que `u.nombre` sin `AS` llegaría a la interfaz como
// `nombre` y el tipo `Caja` pediría `operador_nombre` y se leería `undefined`.
const COLUMNAS_CAJA = `c.id, c.fecha, c.operador_id, u.nombre AS operador_nombre,
                       c.efectivo_inicial_usd, c.efectivo_inicial_ves,
                       c.efectivo_ventas_usd,  c.efectivo_ventas_ves,
                       c.efectivo_egresos_usd,  c.efectivo_egresos_ves,
                       c.efectivo_final_usd,    c.efectivo_final_ves,
                       c.efectivo_esperado_usd, c.efectivo_esperado_ves,
                       c.diferencia_usd,        c.diferencia_ves,
                       c.tasa_cierre, c.estado`;

/** La caja abierta del turno, o `null` si no hay ninguna. */
export function cajaAbierta(db: DatabaseSync): Caja | null {
  return qUno<Caja>(
    db,
    `SELECT ${COLUMNAS_CAJA}
       FROM cajas c JOIN usuarios u ON u.id = c.operador_id
      WHERE c.estado = 'abierta'
      ORDER BY c.id DESC LIMIT 1`,
  );
}

/**
 * Exige que haya una caja abierta y devuelve su id. La llaman ventas y abonos
 * antes de tocar el dinero.
 */
export function exigirCajaAbierta(db: DatabaseSync): number {
  const caja = cajaAbierta(db);
  if (caja === null) {
    throw new AppError(
      CODIGO_ERROR.caja_cerrada,
      'Debe abrir la caja de turno antes de registrar ventas o pagos',
    );
  }
  return caja.id;
}

/**
 * Abre la caja del turno.
 *
 * El efectivo inicial se hereda de la última caja cerrada: es el dinero que
 * quedó en la gaveta y el cajero vuelve a contarlo como base. El primer día
 * arranca en cero, porque no hay gaveta previa.
 */
export function abrirCaja(db: DatabaseSync, input: CajaAbrirInput): number {
  if (cajaAbierta(db) !== null) {
    throw new AppError(
      CODIGO_ERROR.caja_ya_abierta,
      'Ya hay una caja abierta. Ciérrala antes de abrir otra.',
    );
  }

  const previa = qUno<{ efectivo_final_usd: number; efectivo_final_ves: number }>(
    db,
    `SELECT efectivo_final_usd, efectivo_final_ves FROM cajas
      WHERE estado = 'cerrada' ORDER BY id DESC LIMIT 1`,
  );
  const picoUsd = previa?.efectivo_final_usd ?? 0;
  const picoVes = previa?.efectivo_final_ves ?? 0;

  return ejecutar(
    db,
    `INSERT INTO cajas (fecha, operador_id,
                        efectivo_inicial_usd, efectivo_esperado_usd,
                        efectivo_inicial_ves, efectivo_esperado_ves)
     VALUES (date('now'), ?, ?, ?, ?, ?)`,
    input.operador_id,
    picoUsd,
    picoUsd,
    picoVes,
    picoVes,
  ).ultimoId;
}

/**
 * Suma de un pago del día separada por moneda, en céntimos de esa moneda.
 *
 * Solo mira `venta_id IS NOT NULL` o `IS NULL` según pida el llamador: efectivo
 * cobrado en una venta es una cosa, y un abono a cuenta es otra, aunque los dos
 * entren después en la gaveta.
 */
function efectivoDelDia(
  db: DatabaseSync,
  soloVentas: boolean,
): { usd: number; ves: number } {
  return (
    qUno<{ usd: number; ves: number }>(
      db,
      `SELECT COALESCE(SUM(CASE WHEN moneda = 'usd' THEN monto ELSE 0 END), 0) AS usd,
              COALESCE(SUM(CASE WHEN moneda = 'ves' THEN monto ELSE 0 END), 0) AS ves
         FROM pagos
        WHERE tipo_pago = 'efectivo'
          AND date(fecha_pago) = date('now')
          AND ${soloVentas ? 'venta_id IS NOT NULL' : 'venta_id IS NULL'}`,
    ) ?? { usd: 0, ves: 0 }
  );
}

/** Desglose del dinero del día por método de pago y moneda. */
function desglosePagos(db: DatabaseSync, cajaId: number): CierreCajaPago[] {
  return transaccion(db, () => {
    ejecutar(db, 'DELETE FROM cierre_caja_pagos WHERE caja_id = ?', cajaId);
    const filas = qTodos<{ tipo_pago: TipoPago; moneda: Moneda; monto: number }>(
      db,
      `SELECT tipo_pago, moneda, SUM(monto) AS monto
         FROM pagos
        WHERE date(fecha_pago) = date('now')
        GROUP BY tipo_pago, moneda
        ORDER BY tipo_pago, moneda`,
    );
    for (const f of filas) {
      ejecutar(
        db,
        'INSERT INTO cierre_caja_pagos (caja_id, tipo_pago, moneda, monto) VALUES (?, ?, ?, ?)',
        cajaId,
        f.tipo_pago,
        f.moneda,
        f.monto,
      );
    }
    return filas;
  });
}

/**
 * Cierra la caja y devuelve el comprobante del día, listo para imprimir.
 *
 * El efectivo real NO se digita: se reconcilia en persona, contando la gaveta
 * junto al cajero. Por eso al guardar se asume `efectivo_final = esperado` y
 * `diferencia = 0`; la diferencia real la anota el administrador a mano si hace
 * falta. Automatizarlo exigiría un sensor de peso en la caja, que no es el caso.
 */
export function cerrarCaja(db: DatabaseSync, input: CajaCerrarInput): CierreDia {
  const actual = cajaAbierta(db);
  if (actual === null) {
    throw new AppError(CODIGO_ERROR.caja_no_abierta, 'No hay caja abierta para cerrar');
  }
  if (actual.id !== input.caja_id) {
    throw validacion('La caja a cerrar no coincide con la abierta');
  }
  if (actual.operador_id !== input.operador_id) {
    // El arqueo es una declaración personal del cajero. Que otro lo cierre por
    // él falsifica la firma del conteo.
    throw validacion('Solo el operador que abrió la caja puede cerrarla');
  }
  const tasaCierre = validarTasaCambio(input.tasa_cierre);

  // El resumen del día trae ventas y devoluciones ya consultadas; no se
  // reconsultan, porque leerlas dos veces podría dar dos cifras distintas si
  // algo cambiara en medio y el comprobante no cuadraría consigo mismo.
  const resumen = resumenDia(db);
  const ventas: ResumenDiaVenta[] = resumen.ventas;

  const ventasEfectivo = efectivoDelDia(db, true);
  const abonosEfectivo = efectivoDelDia(db, false);

  const abonos: CierreAbono[] = qTodos<CierreAbono>(
    db,
    `SELECT p.cliente_id, c.nombre AS cliente, p.tipo_pago, p.moneda, p.monto,
            p.tasa_cambio, p.fecha_pago
       FROM pagos p JOIN clientes c ON c.id = p.cliente_id
      WHERE p.venta_id IS NULL AND date(p.fecha_pago) = date('now')
      ORDER BY p.id`,
  );

  // Cada abono se convierte a la otra moneda con SU tasa, no con la del cierre:
  // el pago del cliente entró a una tasa y hay que valorarlo a esa misma tasa.
  const totalAbonosUsd = abonos.reduce(
    (suma, a) => suma + (a.moneda === 'usd' ? a.monto : aUsd(a.monto, 'ves', a.tasa_cambio)),
    0,
  );
  const totalAbonosBs = abonos.reduce(
    (suma, a) => suma + (a.moneda === 'ves' ? a.monto : aVes(a.monto, 'usd', a.tasa_cambio)),
    0,
  );

  const inicialUsd = actual.efectivo_inicial_usd;
  const inicialVes = actual.efectivo_inicial_ves;

  // El esperado se recalcula desde el inicial, no desde lo que ya estuviera
  // escrito en la fila, por si la caja se reabrió o se ajustó a mitad de turno.
  //
  // Suma también el efectivo de los abonos, que el original no sumaba. El
  // abono no es una venta, pero su dinero sí está en la gaveta: si Ana paga
  // $50 en efectivo a cuenta de lo que debe, esos billetes quedan en el cajón
  // y el arqueo tiene que contarlos. Excluirlos hacía que la gaveta "sobrara"
  // exactamente el monto de los abonos en efectivo, todas las tardes.
  const esperadoUsd = inicialUsd + ventasEfectivo.usd + abonosEfectivo.usd;
  const esperadoVes = inicialVes + ventasEfectivo.ves + abonosEfectivo.ves;

  const pagos = desglosePagos(db, actual.id);

  ejecutar(
    db,
    `UPDATE cajas
        SET efectivo_ventas_usd   = ?,
            efectivo_ventas_ves   = ?,
            efectivo_final_usd    = ?,
            efectivo_final_ves    = ?,
            efectivo_esperado_usd = ?,
            efectivo_esperado_ves = ?,
            diferencia_usd        = 0,
            diferencia_ves        = 0,
            tasa_cierre           = ?,
            estado                = 'cerrada'
      WHERE id = ?`,
    ventasEfectivo.usd,
    ventasEfectivo.ves,
    esperadoUsd,
    esperadoVes,
    esperadoUsd,
    esperadoVes,
    tasaCierre,
    actual.id,
  );

  const totalVentasUsd = ventas.reduce((s, v) => s + v.monto, 0);
  const totalVentasBs = ventas.reduce(
    (s, v) => s + redondearCent(v.monto * v.tasa_cambio),
    0,
  );
  const totalDevolucionesUsd = resumen.devoluciones.reduce((s, d) => s + d.monto, 0);
  const totalDevolucionesBs = redondearCent(totalDevolucionesUsd * tasaCierre);

  const negocio = datosNegocio(db);

  return {
    caja_id: actual.id,
    fecha: actual.fecha,
    operador_nombre: actual.operador_nombre,
    negocio_nombre: negocio.nombre,
    negocio_rif: negocio.rif,
    negocio_telefono: negocio.telefono,
    negocio_direccion: negocio.direccion,
    efectivo_inicial_usd: inicialUsd,
    efectivo_inicial_ves: inicialVes,
    efectivo_ventas_usd: ventasEfectivo.usd,
    efectivo_ventas_ves: ventasEfectivo.ves,
    abonos_efectivo_usd: abonosEfectivo.usd,
    abonos_efectivo_ves: abonosEfectivo.ves,
    efectivo_esperado_usd: esperadoUsd,
    efectivo_esperado_ves: esperadoVes,
    pagos,
    ventas,
    abonos,
    devoluciones: resumen.devoluciones,
    total_ventas_usd: totalVentasUsd,
    total_ventas_bs: totalVentasBs,
    total_abonos_usd: totalAbonosUsd,
    total_abonos_bs: totalAbonosBs,
    total_devoluciones_usd: totalDevolucionesUsd,
    total_devoluciones_bs: totalDevolucionesBs,
    tasa_cierre: tasaCierre,
  };
}

/** Historial de cajas, para la pantalla de arqueos. */
export function listarCajas(db: DatabaseSync, limite = 60): Caja[] {
  return qTodos<Caja>(
    db,
    `SELECT ${COLUMNAS_CAJA}
       FROM cajas c JOIN usuarios u ON u.id = c.operador_id
      ORDER BY c.id DESC
      LIMIT ?`,
    limite,
  );
}

/** Una caja por id, exista o no. */
export function obtenerCaja(db: DatabaseSync, id: number): Caja {
  return qObligatorio<Caja>(
    db,
    'Caja',
    `SELECT ${COLUMNAS_CAJA} FROM cajas c JOIN usuarios u ON u.id = c.operador_id WHERE c.id = ?`,
    id,
  );
}

/** Tasa de cambio del día, expuesta para la pantalla de venta. */
export { getTasaCambio };
