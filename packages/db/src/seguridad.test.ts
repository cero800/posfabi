import { describe, expect, it } from 'vitest';

import { esHashAlmacenado, hashearPin, verificarHash } from './seguridad.js';

describe('seguridad de PIN', () => {
  it('hashea con prefijo scrypt y distinto al texto plano', () => {
    const h = hashearPin('1234');
    expect(esHashAlmacenado(h)).toBe(true);
    expect(h).not.toBe('1234');
    expect(h.startsWith('scrypt$')).toBe(true);
  });

  it('verifica correctamente', () => {
    const h = hashearPin('4321');
    expect(verificarHash('4321', h)).toBe(true);
    expect(verificarHash('1234', h)).toBe(false);
  });

  it('acepta texto plano legacy y es falso para otro', () => {
    expect(verificarHash('1234', '1234')).toBe(true);
    expect(verificarHash('0000', '1234')).toBe(false);
  });

  it('salts distintos producen hashes distintos', () => {
    const a = hashearPin('1234');
    const b = hashearPin('1234');
    expect(a).not.toBe(b);
  });
});
