import { describe, expect, it } from 'vitest';

import { enMemoria, qUno } from './db.js';
import {
  DOCUMENTO_MOSTRADOR,
  PIN_ADMIN_POR_DEFECTO,
  necesitaConfiguracion,
  sembrarAdmin,
  sembrarClienteMostrador,
  sembrarTodo,
} from './seed.js';

const contar = (db: ReturnType<typeof enMemoria>, tabla: string): number =>
  qUno<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${tabla}`)!.n;

describe('sembrarAdmin', () => {
  it('crea el administrador con el PIN por defecto en una base vacía', () => {
    const db = enMemoria();
    sembrarAdmin(db);
    const u = qUno<{ nombre: string; rol: string; pin: string }>(
      db,
      'SELECT nombre, rol, pin FROM usuarios',
    );
    expect(u).toEqual({ nombre: 'Administrador', rol: 'admin', pin: PIN_ADMIN_POR_DEFECTO });
  });

  it('no duplica si ya hay usuarios', () => {
    const db = enMemoria();
    sembrarAdmin(db);
    sembrarAdmin(db);
    sembrarAdmin(db);
    expect(contar(db, 'usuarios')).toBe(1);
  });

  it('no pisa un usuario que el usuario haya creado', () => {
    const db = enMemoria();
    db.prepare("INSERT INTO usuarios (nombre, rol, pin) VALUES ('Cajero', 'cajero', '9999')").run();
    sembrarAdmin(db);
    expect(contar(db, 'usuarios')).toBe(1);
    expect(qUno<{ pin: string }>(db, 'SELECT pin FROM usuarios')!.pin).toBe('9999');
  });
});

describe('sembrarClienteMostrador', () => {
  it('crea el cliente de mostrador sin crédito', () => {
    const db = enMemoria();
    sembrarClienteMostrador(db);
    const c = qUno<{ documento: string; nombre: string; dias_credito: number; es_mostrador: number }>(
      db,
      'SELECT documento, nombre, dias_credito, es_mostrador FROM clientes',
    );
    expect(c).toEqual({
      documento: DOCUMENTO_MOSTRADOR,
      nombre: 'Mostrador',
      dias_credito: 0,
      es_mostrador: 1,
    });
  });

  it('no duplica si ya hay clientes', () => {
    const db = enMemoria();
    sembrarClienteMostrador(db);
    sembrarClienteMostrador(db);
    expect(contar(db, 'clientes')).toBe(1);
  });
});

describe('sembrarTodo', () => {
  it('deja la base lista para operar', () => {
    const db = enMemoria();
    sembrarTodo(db);
    expect(contar(db, 'usuarios')).toBe(1);
    expect(contar(db, 'clientes')).toBe(1);
    expect(necesitaConfiguracion(db)).toBe(false);
  });

  it('es idempotente', () => {
    const db = enMemoria();
    sembrarTodo(db);
    sembrarTodo(db);
    expect(contar(db, 'usuarios')).toBe(1);
    expect(contar(db, 'clientes')).toBe(1);
  });
});

describe('necesitaConfiguracion', () => {
  it('es true en una base recién creada', () => {
    expect(necesitaConfiguracion(enMemoria())).toBe(true);
  });

  it('es false una vez sembrado el administrador', () => {
    const db = enMemoria();
    sembrarAdmin(db);
    expect(necesitaConfiguracion(db)).toBe(false);
  });
});
