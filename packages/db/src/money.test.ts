import { describe, expect, it } from 'vitest';

import { cent, redondearCent, cantidad, MAX_MONTO, aUsd, aVes, tasa } from './money.js';
import { CODIGO_ERROR, AppError } from './errors.js';

/** Extrae el `codigo` de un AppError lanzado. */
function codigoDe(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppError) return e.codigo;
    throw e;
  }
  throw new Error('se esperaba un AppError y no se lanzó ninguno');
}

describe('cent', () => {
  it('acepta un entero de céntimos', () => {
    expect(cent(0)).toBe(0);
    expect(cent(1999)).toBe(1999);
    expect(cent(-500)).toBe(-500);
  });

  it('rechaza un monto fraccionario', () => {
    expect(() => cent(19.99)).toThrow(/entero de céntimos/);
    expect(codigoDe(() => cent(19.99))).toBe(CODIGO_ERROR.validacion);
  });

  it('rechaza NaN e Infinity', () => {
    expect(() => cent(Number.NaN)).toThrow();
    expect(() => cent(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('rechaza un monto por encima del máximo', () => {
    expect(() => cent(MAX_MONTO + 1)).toThrow(/máximo permitido/);
    expect(cent(MAX_MONTO)).toBe(MAX_MONTO);
  });
});

describe('redondearCent', () => {
  it('redondea 3 cuadernos a $1.199 a 2.50 céntimos', () => {
    // 3 × 800 = 2400 exactos.
    expect(redondearCent(3 * 800)).toBe(2400);
  });

  it('redondea el medio hacia arriba', () => {
    expect(redondearCent(2.5)).toBe(3);
    expect(redondearCent(-2.5)).toBe(-2);
  });

  it('redondea el resultado de multiplicar cantidad por precio', () => {
    // 0.75 kg × 1.999 Bs = 1499.25 céntimos
    expect(redondearCent(0.75 * 1999)).toBe(1499);
  });
});

describe('cantidad', () => {
  it('acepta fracciones (kg, metros, libras)', () => {
    expect(cantidad(0.25)).toBe(0.25);
    expect(cantidad(2)).toBe(2);
  });

  it('rechaza no-números', () => {
    expect(() => cantidad(Number.NaN)).toThrow(/no es un número válido/);
  });

  it('rechaza cantidades absurdas', () => {
    expect(() => cantidad(2_000_000)).toThrow(/máximo permitido/);
  });
});

describe('conversión de moneda', () => {
  it('deja el US$ igual', () => {
    expect(aUsd(1000, 'usd', 36.85)).toBe(1000);
    expect(aVes(1000, 'usd', 36.85)).toBe(36_850);
  });

  it('convierte Bs a US$ redondeando al céntimo', () => {
    expect(aUsd(36_850, 'ves', 36.85)).toBe(1000);
    // 1.000 céntimos de US$ valen 36.850 céntimos de Bs a esa tasa.
    expect(aVes(1000, 'usd', 36.85)).toBe(36_850);
    // Y al revés, un monto ya en Bs no se toca.
    expect(aVes(36_850, 'ves', 36.85)).toBe(36_850);
  });

  it('rechaza una tasa inválida con error de negocio', () => {
    expect(codigoDe(() => aUsd(1000, 'ves', 0))).toBe(CODIGO_ERROR.validacion);
    expect(codigoDe(() => aVes(1000, 'usd', -1))).toBe(CODIGO_ERROR.validacion);
    expect(codigoDe(() => tasa(Number.NaN))).toBe(CODIGO_ERROR.validacion);
  });
});
