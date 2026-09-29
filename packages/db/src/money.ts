// Aritmética de dinero.
//
// Regla del proyecto: los MONTOS son enteros en céntimos de su moneda, y solo
// en el momento de multiplicar cantidad × precio se usa punto flotante, para
// redondear de inmediato al entero más cercano.
//
// En Rust esto era `i64`, exacto por definición. En TypeScript los números son
// `number` (IEEE-754, exacto hasta 2^53), así que hay que verificar el
// redondeo en lugar de confiar en el tipo. `cent()` es el único punto por el que
// pasan todos los importes, y tira si el resultado no es un entero seguro.

import { toUsd, toVes, validarTasa, TASA_CAMBIO_KEY } from '@tienda/core';
import { validacion, type AppError } from './errors.js';

export { TASA_CAMBIO_KEY };

/** Tope de importes, equivalente a `i64` cómodo: 999.999.999,99 por moneda. */
export const MAX_MONTO = 99_999_999_999;

/** Tope de cantidad vendible o almacenable. */
export const MAX_CANTIDAD = 1_000_000;

/**
 * Céntimos de tolerancia al comparar un pago con lo que debe.
 *
 * Existe por el redondeo al mezclar monedas: un cliente que paga $5 en efectivo
 * más Bs 184,25 a tasa 36,85 no cuadra al céntimo, y de 1 a 3 centavos la
 * diferencia es del cálculo, no del cajero. Rechazarla deja al cliente frente a
 * una venta ya cobrada con el sistema diciendo que debe un céntimo.
 *
 * Vive aquí y no en cada módulo porque ventas y pagos tienen que tolerar lo
 * mismo: si el mismo error de redondeo bloquea en una pantalla y no en la otra,
 * el cajero acaba buscando por dónde pasar.
 */
export const HOLGURA_CENTIMOS = 1;

/**
 * Verifica que un importe sea un entero representable sin pérdida.
 * Lanza `AppError` de validación si no lo es.
 */
export function cent(valor: number, etiqueta = 'monto'): number {
  if (!Number.isInteger(valor)) {
    throw validacion(`El ${etiqueta} debe ser un número entero de céntimos`);
  }
  if (!Number.isSafeInteger(valor)) {
    throw validacion(`El ${etiqueta} es demasiado grande para calcular con precisión`);
  }
  if (Math.abs(valor) > MAX_MONTO) {
    throw validacion(`El ${etiqueta} excede el máximo permitido`);
  }
  return valor;
}

/**
 * Redondea a céntimos y verifica el resultado. Es la función que se usa en
 * cualquier `Math.round(cantidad * precio)` del dominio.
 */
export function redondearCent(valor: number, etiqueta = 'monto'): number {
  return cent(Math.round(valor), etiqueta);
}

/** Verifica una cantidad (puede ser fraccionaria: kg, metros, libras). */
export function cantidad(valor: number, etiqueta = 'cantidad'): number {
  if (!Number.isFinite(valor)) {
    throw validacion(`La ${etiqueta} no es un número válido`);
  }
  if (Math.abs(valor) > MAX_CANTIDAD) {
    throw validacion(`La ${etiqueta} excede el máximo permitido`);
  }
  return valor;
}

/** `toUsd` del core, pero con error de negocio en vez de `Error` genérico. */
export function aUsd(monto: number, moneda: 'usd' | 'ves', tasa: number): number {
  try {
    return toUsd(monto, moneda, tasa);
  } catch {
    throw validacion('Tasa de cambio inválida');
  }
}

/** `toVes` del core, con error de negocio. */
export function aVes(monto: number, moneda: 'usd' | 'ves', tasa: number): number {
  try {
    return toVes(monto, moneda, tasa);
  } catch {
    throw validacion('Tasa de cambio inválida');
  }
}

/** `validarTasa` del core, con error de negocio. */
export function tasa(tasaCambio: number): number {
  try {
    return validarTasa(tasaCambio);
  } catch {
    throw validacion('Tasa de cambio inválida');
  }
}

export type { AppError };
