// Datos iniciales que la app crea en el primer arranque.
//
// Es el equivalente de `repo::seed_usuario_admin` y `seed_cliente_mostrador` en
// el backend original. Ambas son idempotentes: solo insertan si la tabla está
// vacía, de modo que se pueden llamar en cada arranque sin duplicar.

import type { DatabaseSync } from 'node:sqlite';

import { qUno } from './db.js';

/** Administrador inicial, con PIN por defecto. */
export const PIN_ADMIN_POR_DEFECTO = '1234';

/** Documento del cliente de mostrador. */
export const DOCUMENTO_MOSTRADOR = '0';

/**
 * Crea el usuario administrador si no hay ninguno. El PIN por defecto solo se
 * aplica en la creación; después el usuario puede cambiarlo.
 */
export function sembrarAdmin(db: DatabaseSync): void {
  const { total } = qObligatorioCont(db, 'usuarios');
  if (total > 0) return;
  db.prepare('INSERT INTO usuarios (nombre, rol, pin) VALUES (?, ?, ?)').run(
    'Administrador',
    'admin',
    PIN_ADMIN_POR_DEFECTO,
  );
}

/**
 * Crea el cliente "Mostrador" si no hay ninguno. En una tienda la mayoría de
 * las ventas son de mostrador contra consumidor final: sin crédito y sin datos
 * que pedirle al cliente.
 */
export function sembrarClienteMostrador(db: DatabaseSync): void {
  const { total } = qObligatorioCont(db, 'clientes');
  if (total > 0) return;
  db.prepare(
    `INSERT INTO clientes (documento, nombre, dias_credito, limite_credito, es_mostrador, activo)
     VALUES (?, ?, 0, 0, 1, 1)`,
  ).run(DOCUMENTO_MOSTRADOR, 'Mostrador');
}

/** Todas las semillas, en orden. */
export function sembrarTodo(db: DatabaseSync): void {
  sembrarAdmin(db);
  sembrarClienteMostrador(db);
}

/** `true` si todavía no se configuró ningún administrador: la app va al setup. */
export function necesitaConfiguracion(db: DatabaseSync): boolean {
  const { total } = qObligatorioCont(db, 'usuarios');
  return total === 0;
}

function qObligatorioCont(db: DatabaseSync, tabla: string): { total: number } {
  // `tabla` nunca viene del usuario: son literales de este módulo.
  const fila = qUno<{ total: number }>(db, `SELECT COUNT(*) AS total FROM ${tabla}`);
  return fila ?? { total: 0 };
}
