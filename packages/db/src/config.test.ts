import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { NEGOCIO_CONFIG_KEYS, TASA_CAMBIO_KEY } from '@tienda/core';

import { leerConfig, escribirConfig, getTasaCambio, setTasaCambio, datosNegocio } from './config.js';
import { crearVenta } from './ventas.js';
import { CODIGO_ERROR } from './errors.js';
import { abrirCaja, bd, clienteMostrador, producto, stock, usuario } from './testutil.js';

//---------------------------------------------------------------------------
// Claves sueltas
//---------------------------------------------------------------------------

describe('leerConfig / escribirConfig', () => {
  it('una clave que no existe sale null, noundefined ni error', () => {
    expect(leerConfig(bd(), 'no_existe')).toBeNull();
  });

  it('crea la clave si no existía y la actualiza si sí', () => {
    const db = bd();
    escribirConfig(db, 'impuestos', 'ACTIVOS');
    expect(leerConfig(db, 'impuestos')).toBe('ACTIVOS');

    escribirConfig(db, 'impuestos', 'INACTIVOS');
    expect(leerConfig(db, 'impuestos')).toBe('INACTIVOS');
    // Actualizar no debe duplicar la fila: la clave es la clave primaria.
    expect(db.prepare('SELECT COUNT(*) AS n FROM config WHERE clave = ?').get('impuestos')).toEqual({ n: 1 });
  });

  it('acepta un valor vacío, que es distinto de no tener nada', () => {
    const db = bd();
    escribirConfig(db, 'negocio_direccion', '');
    expect(leerConfig(db, 'negocio_direccion')).toBe('');
  });

  it('guarda los valores tal cual, sin recortarlos', () => {
    const db = bd();
    escribirConfig(db, 'negocio_nombre', '  Papelería El Lápiz  ');
    expect(leerConfig(db, 'negocio_nombre')).toBe('  Papelería El Lápiz  ');
  });
});

//---------------------------------------------------------------------------
// La tasa de cambio
//---------------------------------------------------------------------------

describe('la tasa de cambio', () => {
  it('si no está configurada vale 1, para que la tienda arranque sin tocarla', () => {
    // Una papelería que solo cobra en dólares tiene que poder vender el primer
    // día sin que nadie vendinga a escribir 36,85 en un archivo de configuración.
    expect(getTasaCambio(bd())).toBe(1);
  });

  it('guarda y devuelve la que se configura', () => {
    const db = bd();
    setTasaCambio(db, 36.85);
    expect(getTasaCambio(db)).toBe(36.85);
    expect(leerConfig(db, TASA_CAMBIO_KEY)).toBe('36.85');
  });

  it('rechaza una tasa de cero o negativa', () => {
    const db = bd();
    for (const mala of [0, -5]) {
      expect(() => setTasaCambio(db, mala)).toThrowError();
    }
    expect(leerConfig(db, TASA_CAMBIO_KEY)).toBeNull();
  });

  it('rechaza una tasa que no es un número', () => {
    const db = bd();
    expect(() => setTasaCambio(db, Number.NaN)).toThrowError();
    expect(() => setTasaCambio(db, Number.POSITIVE_INFINITY)).toThrowError();
  });

  it('detecta una tasa corrupta en la base en vez de vender a tasa NaN', () => {
    // Alguien editó el archivo a mano, o una versión anterior guardó basura. Un
    // `NaN` silencioso se propagaría a todos los totales del día sin que nada
    // lo delate, así que se avisa en el momento de leerla.
    const db = bd();
    escribirConfig(db, TASA_CAMBIO_KEY, 'treinta y pico');
    expect(() => getTasaCambio(db)).toThrowError(/no es un número válido/);
  });

  it('tolera espacios alrededor del número', () => {
    const db = bd();
    escribirConfig(db, TASA_CAMBIO_KEY, ' 36.85 ');
    expect(getTasaCambio(db)).toBe(36.85);
  });

  it('el cambio de tasa no altera las facturas ya emitidas', () => {
    const db = bd();
    const op = usuario(db, 'Alex');
    const mostrador = clienteMostrador(db);
    abrirCaja(db, op);
    const cuaderno = producto(db, 100, { codigo: 'C-1', nombre: 'Cuaderno' });
    stock(db, cuaderno, 100);
    setTasaCambio(db, 10);

    const v = crearVenta(db, {
      cliente_id: mostrador,
      tipo: 'contado',
      descuento: 0,
      detalles: [{ producto_id: cuaderno, cantidad: 1 }],
      pagos: [{ monto: 100, tipo_pago: 'efectivo', moneda: 'usd' }],
      operador_id: op,
    });

    // Al día siguiente el dólar se mueve. La factura de ayer sigue valuada a
    // la tasa de ayer: es la única forma de que el cierre de hoy cuadre con
    // lo que entró a la gaveta ayer.
    setTasaCambio(db, 25);
    expect(getTasaCambio(db)).toBe(25);

    const guardada = db
      .prepare('SELECT tasa_cambio, total FROM ventas WHERE id = ?')
      .get(v.id) as { tasa_cambio: number; total: number };
    expect(guardada.tasa_cambio).toBe(10);
    expect(guardada.total).toBe(100);
  });
});

//---------------------------------------------------------------------------
// Datos del negocio para imprimir
//---------------------------------------------------------------------------

describe('datosNegocio', () => {
  it('sale vacío antes de configurarlo, para no bloquear la factura', () => {
    expect(datosNegocio(bd())).toEqual({ nombre: '', rif: '', telefono: '', direccion: '' });
  });

  it('devuelve lo configurado tal cual', () => {
    const db: DatabaseSync = bd();
    escribirConfig(db, NEGOCIO_CONFIG_KEYS.nombre, 'Papelería El Lápiz');
    escribirConfig(db, NEGOCIO_CONFIG_KEYS.rif, 'J-40123456-7');
    escribirConfig(db, NEGOCIO_CONFIG_KEYS.telefono, '0212-1234567');
    escribirConfig(db, NEGOCIO_CONFIG_KEYS.direccion, 'Av. Miranda, Caracas');

    expect(datosNegocio(db)).toEqual({
      nombre: 'Papelería El Lápiz',
      rif: 'J-40123456-7',
      telefono: '0212-1234567',
      direccion: 'Av. Miranda, Caracas',
    });
  });

  it('no le importan mayúsculas ni acentos: el nombre va tal cual se escriba', () => {
    // El RIF y el teléfono los teclea el dueño, con el formato que él use. El
    // sistema los imprime, no los juzga.
    const db = bd();
    escribirConfig(db, NEGOCIO_CONFIG_KEYS.nombre, 'PAPELERÍA "EL LÁPIZ" C.A.');
    escribirConfig(db, NEGOCIO_CONFIG_KEYS.telefono, '0414-1234567');
    const d = datosNegocio(db);
    expect(d.nombre).toBe('PAPELERÍA "EL LÁPIZ" C.A.');
    expect(d.telefono).toBe('0414-1234567');
  });

  it('lee de las mismas claves que escribe la pantalla de ajustes', () => {
    // Si el nombre de la clave cambiara en un lado y no en el otro, la factura
    // saldría en blanco sin ningún aviso. Esta prueba ata los dos extremos por
    // la constante compartida, no por una cadena escrita a mano.
    const db = bd();
    escribirConfig(db, NEGOCIO_CONFIG_KEYS.nombre, 'Papelería El Lápiz');
    expect(datosNegocio(db).nombre).toBe('Papelería El Lápiz');
    expect(leerConfig(db, 'negocio_nombre')).toBe('Papelería El Lápiz');
  });

  it('no se confunde con el correlativo de facturas, que también vive en config', () => {
    // `config` guarda de todo: la tasa, el destino de la impresora y el
    // último número de factura. Un `datosNegocio` que leyera la tabla entera en
    // vez de pedir cuatro claves terminaría imprimiendo basura.
    const db = bd();
    escribirConfig(db, 'ultimo_numero_factura', '42');
    escribirConfig(db, NEGOCIO_CONFIG_KEYS.nombre, 'Papelería El Lápiz');
    expect(datosNegocio(db)).toEqual({
      nombre: 'Papelería El Lápiz',
      rif: '',
      telefono: '',
      direccion: '',
    });
  });
});

describe('códigos de error de la configuración', () => {
  it('los de la base llegan normalizados, no crudos', () => {
    const db = bd();
    escribirConfig(db, TASA_CAMBIO_KEY, 'x');
    try {
      getTasaCambio(db);
      throw new Error('se esperaba un error');
    } catch (e) {
      expect((e as { codigo?: string }).codigo).toBe(CODIGO_ERROR.validacion);
    }
  });
});
