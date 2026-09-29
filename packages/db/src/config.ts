// Lectura y escritura de la tabla `config`.
//
// En Rust estas funciones vivían en `reporte.rs` (`get_config`, `set_config`) y
// la tasa de cambio se leía desde allí. Aquí están aparte porque las necesitan
// casi todos los módulos: ventas, pagos, caja y reportes.

import type { DatabaseSync } from 'node:sqlite';
import { NEGOCIO_CONFIG_KEYS, TASA_CAMBIO_KEY } from '@tienda/core';

import { ejecutar, qUno } from './db.js';
import { validacion } from './errors.js';
import { tasa as validarTasaCambio } from './money.js';

/** Valor de una clave, o `null` si no está. */
export function leerConfig(db: DatabaseSync, clave: string): string | null {
  return (
    qUno<{ valor: string | null }>(db, 'SELECT valor FROM config WHERE clave = ?', clave)?.valor ??
    null
  );
}

/** Fija el valor de una clave, creándola si no existía. */
export function escribirConfig(db: DatabaseSync, clave: string, valor: string | null): void {
  ejecutar(
    db,
    'INSERT INTO config (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor',
    clave,
    valor,
  );
}

/**
 * Tasa de cambio vigente: cuántos bolívares vale 1 US$.
 *
 * Si no hay ninguna configurada se usa 1, que es lo que permite que una tienda
 * que solo cobra en dólares funcione desde el primer arranque sin tocar nada.
 * Con tasa 1, "Bs 100" y "US$ 100" son la misma cifra, y la conversión de
 * monedas no inventa ni pierde dinero.
 */
export function getTasaCambio(db: DatabaseSync): number {
  const bruto = leerConfig(db, TASA_CAMBIO_KEY) ?? '1';
  const valor = Number(bruto.trim());
  if (!Number.isFinite(valor)) {
    throw validacion('La tasa de cambio configurada no es un número válido');
  }
  return validarTasaCambio(valor);
}

/** Fija la tasa de cambio, rechazando valores imposibles. */
export function setTasaCambio(db: DatabaseSync, valor: number): void {
  escribirConfig(db, TASA_CAMBIO_KEY, String(validarTasaCambio(valor)));
}

export interface DatosNegocio {
  nombre: string;
  rif: string;
  telefono: string;
  direccion: string;
}

/**
 * Nombre, RIF, teléfono y dirección del negocio, que salen impresos en la
 * factura y en el comprobante de cierre. Vacíos si no se han configurado: es
 * preferible una factura sin teléfono a una que no se puede emitir.
 */
export function datosNegocio(db: DatabaseSync): DatosNegocio {
  return {
    nombre: leerConfig(db, NEGOCIO_CONFIG_KEYS.nombre) ?? '',
    rif: leerConfig(db, NEGOCIO_CONFIG_KEYS.rif) ?? '',
    telefono: leerConfig(db, NEGOCIO_CONFIG_KEYS.telefono) ?? '',
    direccion: leerConfig(db, NEGOCIO_CONFIG_KEYS.direccion) ?? '',
  };
}
