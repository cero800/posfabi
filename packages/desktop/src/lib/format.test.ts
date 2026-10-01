import { describe, expect, it } from 'vitest';
import { formatCents, formatUsdCents, formatVesCents, hoyIso, parseCentsInput } from './format';

describe('formatUsdCents', () => {
  it('formatea con miles por coma y punto decimal', () => {
    expect(formatUsdCents(123456)).toBe('$1,234.56');
    expect(formatUsdCents(100)).toBe('$1.00');
    expect(formatUsdCents(0)).toBe('$0.00');
  });

  it('maneja redondeo y negativos', () => {
    expect(formatUsdCents(99_995)).toBe('$999.95');
    expect(formatUsdCents(-250)).toBe('-$2.50');
  });
});

describe('formatVesCents', () => {
  it('formatea con miles por punto y coma decimal', () => {
    expect(formatVesCents(123456)).toBe('Bs 1.234,56');
    expect(formatVesCents(36850)).toBe('Bs 368,50');
    expect(formatVesCents(0)).toBe('Bs 0,00');
  });
});

describe('formatCents', () => {
  it('elige según la moneda', () => {
    expect(formatCents(500, 'usd')).toBe('$5.00');
    expect(formatCents(500, 'ves')).toBe('Bs 5,00');
  });
});

describe('parseCentsInput', () => {
  it('parsea entradas US$', () => {
    expect(parseCentsInput('1,234.56', 'usd')).toBe(123456);
    expect(parseCentsInput('1234', 'usd')).toBe(123400);
    expect(parseCentsInput('$ 10.5', 'usd')).toBe(1050);
  });

  it('parsea entradas Bs', () => {
    expect(parseCentsInput('1.234,56', 'ves')).toBe(123456);
    expect(parseCentsInput('368,50', 'ves')).toBe(36850);
    expect(parseCentsInput('1234', 'ves')).toBe(123400);
  });

  it('rechaza textos inválidos', () => {
    expect(parseCentsInput('', 'usd')).toBeNull();
    expect(parseCentsInput('abc', 'usd')).toBeNull();
    expect(parseCentsInput('10,5', 'usd')).toBeNull(); // coma como decimal en US$
    expect(parseCentsInput('10.5', 'ves')).toBeNull(); // punto como decimal en Bs
    expect(parseCentsInput('10.123', 'usd')).toBeNull(); // 3 decimales
    expect(parseCentsInput('-5', 'usd')).toBeNull();
  });
});
describe('hoyIso', () => {
  /**
   * Zonas para el test de la fecha.
   *
   * Entre Kiritimati (UTC+14) y Midway (UTC-11) hay 25 horas de diferencia, así
   * que nunca caen en la misma fecha. Con las dos siempre hay al menos una que
   * difiere de la fecha en UTC, que es justo lo que hay que distinguir.
   */
  const ZONAS = ['Pacific/Kiritimati', 'America/Caracas', 'Pacific/Midway'] as const;

  it('da el día local, no el de UTC', () => {
    const tzOriginal = process.env.TZ;
    try {
      for (const zona of ZONAS) {
        process.env.TZ = zona;
        const d = new Date();
        const esperado = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        expect(hoyIso(), `con TZ=${zona}`).toBe(esperado);
      }
    } finally {
      if (tzOriginal === undefined) delete process.env.TZ;
      else process.env.TZ = tzOriginal;
    }
  });

  it('el reloj del runner hace posible distinguir UTC de hora local', () => {
    const tzOriginal = process.env.TZ;
    try {
      const fechas = new Set<string>();
      for (const zona of [...ZONAS, 'UTC']) {
        process.env.TZ = zona;
        fechas.add(hoyIso());
      }
      // Si el runner corriera justo cuando las tres zonas coinciden con UTC, el
      // test de arriba pasaría con cualquier implementación. Esto avisa.
      expect(fechas.size, 'ninguna zona difiere de UTC: el test no probaría nada').toBeGreaterThan(1);
    } finally {
      if (tzOriginal === undefined) delete process.env.TZ;
      else process.env.TZ = tzOriginal;
    }
  });

  it('devuelve AAAA-MM-DD con el día y el mes a dos dígitos', () => {
    expect(hoyIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
