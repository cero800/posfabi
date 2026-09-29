import { describe, expect, it } from 'vitest';

import { enMemoria, ejecutar } from './db.js';
import { AppError, CODIGO_ERROR, noEncontrado, normalizarError, validacion } from './errors.js';

describe('AppError', () => {
  it('conserva código y mensaje', () => {
    const e = new AppError(CODIGO_ERROR.stock_insuficiente, 'no hay');
    expect(e.codigo).toBe(CODIGO_ERROR.stock_insuficiente);
    expect(e.message).toBe('no hay');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('AppError');
  });

  it('se serializa a código y mensaje, sin la pila', () => {
    expect(new AppError(CODIGO_ERROR.validacion, 'x').toJSON()).toEqual({
      codigo: 'validacion',
      mensaje: 'x',
    });
  });
});

describe('normalizarError', () => {
  it('deja intacto un AppError', () => {
    const original = new AppError(CODIGO_ERROR.pin_incorrecto, 'PIN incorrecto');
    expect(normalizarError(original)).toBe(original);
  });

  it('traduce una violación de UNIQUE', () => {
    const db = enMemoria();
    ejecutar(db, 'INSERT INTO categorias (nombre) VALUES (?)', 'Oficina');
    try {
      ejecutar(db, 'INSERT INTO categorias (nombre) VALUES (?)', 'Oficina');
      throw new Error('debería haber fallado');
    } catch (e) {
      const n = normalizarError(e);
      expect(n.codigo).toBe(CODIGO_ERROR.duplicado);
      expect(n.message).toMatch(/Ya existe/);
    }
  });

  it('traduce una violación de clave foránea', () => {
    const db = enMemoria();
    try {
      ejecutar(
        db,
        "INSERT INTO ventas (cliente_id, numero_factura, tipo, fecha) VALUES (999, 1, 'contado', '2026-01-01')",
      );
      throw new Error('debería haber fallado');
    } catch (e) {
      expect(normalizarError(e).codigo).toBe(CODIGO_ERROR.validacion);
    }
  });

  it('traduce NOT NULL', () => {
    const n = normalizarError(new Error('NOT NULL constraint failed: categorias.nombre'));
    expect(n.codigo).toBe(CODIGO_ERROR.validacion);
  });

  it('deja pasar un error de sistema con su mensaje', () => {
    const n = normalizarError(new Error('disco lleno'));
    expect(n.codigo).toBe(CODIGO_ERROR.sistema);
    expect(n.message).toBe('disco lleno');
  });

  it('no se rompe con un valor que no es Error', () => {
    expect(normalizarError('algo raro').codigo).toBe(CODIGO_ERROR.sistema);
    expect(normalizarError(undefined).codigo).toBe(CODIGO_ERROR.sistema);
  });
});

describe('constructores', () => {
  it('validacion', () => {
    expect(validacion('malo').codigo).toBe(CODIGO_ERROR.validacion);
  });

  it('noEncontrado nombra la entidad', () => {
    expect(noEncontrado('Cliente').message).toBe('Cliente no encontrado');
  });
});
