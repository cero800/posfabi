// Seguridad de credenciales y bloqueo por intentos.
//
// Los PIN se guardan con `scrypt` (de `node:crypto`), sin dependencias
// nuevas. El formato en la misma columna `usuarios.pin` es
// `scrypt$N$r=...$p=...$saltHex$hashHex` para detectar si ya está hasheado
// y migrar los valores en claro existentes al primer `verificarPin` exitoso
// (migración perezosa). La comparación usa `timingSafeEqual` para evitar
// fugas por tiempo.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { validarPin } from './validators.js';

// Coste moderado para un POS local. Suficiente para un PIN de 4 dígitos
// sin volverse molesto en un cajero con un solo núcleo.
const COSTE_LOG2 = 14;
const BLOQUE_LONG = 32;
const SALT_BYTES = 16;

const PREFIJO = 'scrypt';

export function esHashAlmacenado(almacenado: string | null | undefined): boolean {
  return typeof almacenado === 'string' && almacenado.startsWith(`${PREFIJO}$`);
}

export function hashearPin(pin: string): string {
  const limpio = pin.trim();
  validarPin(limpio);
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(limpio, salt, BLOQUE_LONG, { N: 1 << COSTE_LOG2, r: 8, p: 1 }) as Buffer;
  return `${PREFIJO}$${COSTE_LOG2}$r=8$p=1$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verificarHash(pin: string, almacenado: string): boolean {
  const limpio = pin.trim();
  if (!esHashAlmacenado(almacenado)) {
    return almacenado.trim() === limpio;
  }
  const partes = almacenado.split('$');
  // scrypt$N$r=...$p=...$salt$hash
  if (partes.length !== 6) return false;
  const logN = Number(partes[1]);
  const saltHex = partes[4];
  const hashHex = partes[5];
  if (!Number.isFinite(logN) || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const hashGuardado = Buffer.from(hashHex, 'hex');
  const hashCalculado = scryptSync(limpio, salt, hashGuardado.length, { N: 1 << logN, r: 8, p: 1 }) as Buffer;
  if (hashCalculado.length !== hashGuardado.length) return false;
  try {
    return timingSafeEqual(hashCalculado, hashGuardado);
  } catch {
    return false;
  }
}
