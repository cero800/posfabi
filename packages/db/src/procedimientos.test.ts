// Pruebas del registro de procedures.
//
// Las 500 pruebas de las fases 1 a 5 llaman a las funciones del dominio
// directamente. Estas llaman a los **procedures**, que es el camino que
// recorre la interfaz: un objeto de `params` en JSON entra por el mismo lector
// `Args` que usará el shell de Tauri, y sale el sobre de respuesta.
//
// La diferencia no es cosmética. Entre la función del dominio y el procedure hay
// una traducción de nombres que TypeScript no vigila: si un procedure lee
// `a.entero('ventaid')` en vez de `a.entero('venta_id')`, todo compila, todos
// los tests del dominio pasan, y el día que se monte la app el botón de anular
// venta no hace nada. Estos tests son los que lo detectan.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseSync } from 'node:sqlite';

import { abrir } from './db.js';
import type { StockItem } from '@tienda/core';
import { CODIGO_ERROR } from './errors.js';
import type { Rutas } from './paths.js';
import { construirRegistro, nombresProcedimientos, validarTicket } from './procedimientos.js';
import { atender, type RespuestaRpc, type Sobre } from './rpc.js';
import {
  cliente,
  clienteMostrador,
  limpiarDisco,
  mkdirsTmp,
  producto,
  rutasTemporales,
  stock,
  tasa,
  usuario,
  venta,
} from './testutil.js';

//---------------------------------------------------------------------------
// Andamiaje
//---------------------------------------------------------------------------

const REGISTRO = construirRegistro();

let db: DatabaseSync;
let rutas: Rutas;
let raiz: string;

beforeEach(() => {
  ({ rutas, raiz } = rutasTemporales());
  mkdirsTmp(rutas);
  db = abrir(rutas.dbPath);
});

afterEach(() => {
  limpiarDisco(db, raiz);
});

/** Llama a un procedure y devuelve la respuesta completa. */
function llamar(method: string, params?: unknown): Promise<RespuestaRpc> {
  return atender(REGISTRO, { db, rutas }, { jsonrpc: '2.0', id: 1, method, params });
}

/** Llama y devuelve el `data`, o falla con el mensaje del error. */
async function ok<T>(method: string, params?: unknown): Promise<T> {
  const r = await llamar(method, params);
  const s = r.result as Sobre;
  if (!s.ok) throw new Error(`${s.error.codigo}: ${s.error.mensaje}`);
  return s.data as T;
}

/** Llama y devuelve el error, o falla si la respuesta fue buena. */
async function falla(method: string, params?: unknown): Promise<{ codigo: string; mensaje: string }> {
  const r = await llamar(method, params);
  const s = r.result as Sobre;
  if (s.ok) throw new Error(`se esperaba un error de «${method}» y respondió bien`);
  return s.error;
}

//---------------------------------------------------------------------------
// El registro en sí
//---------------------------------------------------------------------------

describe('el registro', () => {
  it('tiene procedures', () => {
    expect(nombresProcedimientos().length).toBeGreaterThan(50);
  });

  it('no tiene dos procedures con el mismo nombre', () => {
    // El objeto literal de TypeScript avisa de esto, pero el registro también
    // se construye a mano en las pruebas y en el modo `--http`.
    const nombres = nombresProcedimientos();
    expect(new Set(nombres).size).toBe(nombres.length);
  });

  it('usa nombres de snake_case sin acentos ni mayúsculas', () => {
    // Los nombres viajan como cadenas y los escribe `services/db.ts` a mano.
    // Un nombre con tilde o con mayúscula no se vería en ninguna otra parte.
    for (const nombre of nombresProcedimientos()) {
      expect(nombre, nombre).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it('no conserva ningún nombre de la panadería', () => {
    // El renombrado de dominio: si algo se coló, aquí se ve.
    const prohibidos = ['empresa', 'produccion', 'panaderia', 'merma_produccion'];
    for (const nombre of nombresProcedimientos()) {
      for (const malo of prohibidos) {
        expect(nombre.includes(malo), `${nombre} todavía habla de ${malo}`).toBe(false);
      }
    }
  });

  it('todos los procedures son funciones', () => {
    for (const [nombre, p] of REGISTRO) {
      expect(typeof p, nombre).toBe('function');
    }
  });

  it('declara cuántos procedures tiene, sin contarlos a mano', () => {
    return(async () => {
      const estado = await ok<{ procedures: number }>('estado_sistema');
      expect(estado.procedures).toBe(REGISTRO.size);
    })();
  });
});

//---------------------------------------------------------------------------
// Un recorrido de negocio por el registro
//---------------------------------------------------------------------------

describe('recorrido de negocio por el registro', () => {
  it('hace la venta entera: catálogo, stock, caja, venta, factura y cierre', async () => {
    // Es el mismo camino que recorre la interfaz, de punta a punta. Si esto
    // pasa, el backend sirve para una venta real aunque el shell todavía no
    // exista.
    await ok('configurar_admin', { admin: { nombre: 'Dueña', pin: '1234' } });
    const admin = await ok<number>('crear_usuario', {
      usuario: { nombre: 'Cajero', rol: 'cajero', activo: true },
    });

    const categoria = await ok<number>('crear_categoria', { categoria: { nombre: 'Papelería' } });
    const clienteId = await ok<number>('crear_cliente', {
      cliente: { nombre: 'Librería', documento: 'J-11111111', dias_credito: 30, limite_credito: 100000, activo: true },
    });
    const productoId = await ok<number>('crear_producto', {
      producto: {
        codigo: 'CUA-1',
        nombre: 'Cuaderno',
        categoria_id: categoria,
        unidad_medida: 'unidad',
        precio_base: 350,
        activo: true,
      },
    });

    await ok('registrar_entrada_mercancia', {
      entrada: { producto_id: productoId, cantidad: 20, costo_unitario: 200, operador_id: admin, fecha: '2026-01-15' },
    });
    const conStock = await ok<StockItem[]>('listar_stock');
    expect(conStock.find((s) => s.producto_id === productoId)?.cantidad_disponible).toBe(20);

    await ok('abrir_caja', { caja: { operador_id: admin } });
    const caja = await ok<{ id: number } | null>('caja_abierta');
    expect(caja?.id).toBeGreaterThan(0);

    const ventaHecha = await ok<{ id: number; numero_factura: number; total: number; tasa_cambio: number }>(
      'crear_venta',
      {
        venta: {
          cliente_id: clienteId,
          tipo: 'credito',
          descuento: 0,
          operador_id: admin,
          detalles: [{ producto_id: productoId, cantidad: 2 }],
          pagos: [],
        },
      },
    );
    expect(ventaHecha.total).toBe(700);
    expect(ventaHecha.numero_factura).toBe(1);

    const factura = await ok<{ total: number; detalle: unknown[] }>('obtener_factura', {
      venta_id: ventaHecha.id,
    });
    expect(factura.total).toBe(700);
    expect(factura.detalle).toHaveLength(1);

    const cuenta = await ok<{ saldo_pendiente: number }>('estado_cuenta', { cliente_id: clienteId });
    expect(cuenta.saldo_pendiente).toBe(700);

    const cierre = await ok<{ total_ventas_usd: number; ventas: unknown[] }>('cerrar_caja', {
      caja: { caja_id: caja?.id, operador_id: admin, tasa_cierre: 36.5 },
    });
    expect(cierre.total_ventas_usd).toBe(700);
    expect(cierre.ventas).toHaveLength(1);

    // El stock bajó lo vendido.
    const despues = await ok<StockItem[]>('listar_stock');
    expect(despues.find((s) => s.producto_id === productoId)?.cantidad_disponible).toBe(18);
  });
});

//---------------------------------------------------------------------------
// Que los nombres de los argumentos sean los correctos
//---------------------------------------------------------------------------

describe('los nombres de los argumentos', () => {
  it('caja_abierta y estado_cuenta_todos no piden nada', async () => {
    await ok('caja_abierta');
    await ok('estado_cuenta_todos');
    await ok('listar_clientes');
    await ok('listar_productos');
    await ok('listar_categorias');
    await ok('listar_stock');
    await ok('listar_usuarios');
    await ok('listar_ventas');
    await ok('listar_backups');
    await ok('necesita_configuracion');
  });

  it('el nombre del producto en el ticket es `producto`', async () => {
    // Si aquí se usara `nombre`, el procedure devolvería un TypeError. Este
    // es el tipo de error que solo se ve cuando ya hay una caja abierta.
    const e = await falla('imprimir_ticket', { ticket: { detalle: [{ nombre: 'x' }] } });
    expect(e.codigo).toBe(CODIGO_ERROR.validacion);
  });

  it('obtener_factura acepta el id que manda el frontend', async () => {
    // `services/db.ts` hoy manda `ventaId` por una mezcla de convenciones que
    // se arregla en la fase 8. Mientras tanto tiene que funcionar.
    const v = venta(db, { clienteId: clienteMostrador(db) });
    const porVentaId = await ok<{ venta_id: number }>('obtener_factura', { ventaId: v });
    const porVentaIdGuion = await ok<{ venta_id: number }>('obtener_factura', { venta_id: v });
    expect(porVentaId.venta_id).toBe(v);
    expect(porVentaIdGuion.venta_id).toBe(v);
  });

  it('eliminar_backup acepta el nombre que manda el frontend', async () => {
    const creado = await ok<{ nombre: string }>('crear_backup');
    await ok('eliminar_backup', { nombreArchivo: creado.nombre });
    expect(await ok<unknown[]>('listar_backups')).toHaveLength(0);
  });

  it('verificar_pin acepta `usuarioId` y `usuario_id`', async () => {
    const u = usuario(db);
    expect(await ok<boolean>('verificar_pin', { usuarioId: u, pin: '1234' })).toBe(true);
    expect(await ok<boolean>('verificar_pin', { usuario_id: u, pin: '1234' })).toBe(true);
    expect(await ok<boolean>('verificar_pin', { usuarioId: u, pin: '0000' })).toBe(false);
  });

  it('dice qué dato falta cuando falta', async () => {
    const e = await falla('obtener_venta');
    expect(e.mensaje).toContain('venta_id');
  });

  it('no acepta un id que sea texto', async () => {
    const e = await falla('obtener_venta', { venta_id: 'siete' });
    expect(e.mensaje).toMatch(/número entero/);
  });

  it('devuelve `null` de `caja_abierta` cuando no hay ninguna', async () => {
    // Y no un error: que no haya caja es un estado normal, no una falla.
    expect(await ok('caja_abierta')).toBeNull();
  });

  it('devuelve `null` de `obtener_destino_impresora` antes de configurar', async () => {
    expect(await ok('obtener_destino_impresora')).toBeNull();
  });

  it('devuelve `null` de `get_config` para una clave que no existe', async () => {
    expect(await ok('get_config', { clave: 'nada_esto' })).toBeNull();
  });
});

//---------------------------------------------------------------------------
// Procedures sin argumentos de negocio
//---------------------------------------------------------------------------

describe('procedures sin entrada de negocio', () => {
  it('obtener_datos_negocio devuelve los cuatro campos aunque estén vacíos', async () => {
    const datos = await ok<{ nombre: string; rif: string }>('obtener_datos_negocio');
    expect(datos.nombre).toBe('');
    await ok('set_config', { clave: 'negocio_nombre', valor: 'Papelería Fabi' });
    expect((await ok<{ nombre: string }>('obtener_datos_negocio')).nombre).toBe('Papelería Fabi');
  });

  it('log_error y log_evento escriben una línea por mensaje', async () => {
    await ok('log_error', { origen: 'prueba', mensaje: 'algo salió mal' });
    await ok('log_evento', { origen: 'prueba', mensaje: 'se abrió la caja' });
    const fs = await import('node:fs');
    expect(fs.readFileSync(`${rutas.dataDir}/errores.log`, 'utf8')).toContain('algo salió mal');
    expect(fs.readFileSync(`${rutas.dataDir}/traza.log`, 'utf8')).toContain('se abrió la caja');
  });

  it('exige origen y mensaje en la bitácora', async () => {
    expect((await falla('log_error', { origen: 'prueba' })).mensaje).toContain('mensaje');
  });

  it('crear_backup deja un archivo que se puede abrir', async () => {
    const item = await ok<{ nombre: string; ruta: string; tamano_bytes: number }>('crear_backup');
    expect(item.tamano_bytes).toBeGreaterThan(0);
    // La prueba fuerte: la copia tiene que abrirse y tener el esquema.
    const copia = abrir(item.ruta);
    const total = copia.prepare('SELECT COUNT(*) AS n FROM ventas').get() as { n: number };
    expect(total.n).toBe(0);
    copia.close();
  });

  it('hay_backup_hoy responde bien después de crear una copia', async () => {
    expect(await ok<boolean>('hay_backup_hoy')).toBe(false);
    await ok('crear_backup');
    expect(await ok<boolean>('hay_backup_hoy')).toBe(true);
  });
});

//---------------------------------------------------------------------------
// La impresora
//---------------------------------------------------------------------------

describe('destino de impresora', () => {
  it('guarda y devuelve el destino de red', async () => {
    await ok('configurar_destino_impresora', {
      destino: { tipo: 'red', host: '192.168.1.50', puerto: 9100 },
    });
    expect(await ok('obtener_destino_impresora')).toEqual({
      tipo: 'red',
      host: '192.168.1.50',
      puerto: 9100,
    });
  });

  it('guarda un destino de archivo, que es como se prueba sin impresora', async () => {
    await ok('configurar_destino_impresora', {
      destino: { tipo: 'archivo', ruta: `${raiz}/t.bin` },
    });
    expect(await ok('obtener_destino_impresora')).toEqual({
      tipo: 'archivo',
      ruta: `${raiz}/t.bin`,
    });
  });

  it('rechaza un destino que no es de ningún tipo conocido', async () => {
    // Sin esta guarda, el error sale al imprimir, con el POS en mitad de una
    // venta y no con el formulario de configuración delante.
    const e = await falla('configurar_destino_impresora', { destino: { tipo: 'fax' } });
    expect(e.codigo).toBe(CODIGO_ERROR.validacion);
  });

  it('rechaza una impresora de red sin host', async () => {
    expect((await falla('configurar_destino_impresora', { destino: { tipo: 'red' } })).codigo).toBe(
      CODIGO_ERROR.validacion,
    );
  });

  it('imprimir_ticket escribe los bytes en el archivo de destino', async () => {
    const ruta = `${raiz}/ticket.bin`;
    await ok('configurar_destino_impresora', { destino: { tipo: 'archivo', ruta } });
    await ok('imprimir_ticket', { ticket: TICKET_VALIDO });
    const fs = await import('node:fs');
    const bytes = fs.readFileSync(ruta);
    // ESC/POS empieza y termina con el corte de papel: si aparece, lo que salió
    // por el cable es un ticket completo y no una foto de la mitad.
    expect(bytes[0]).toBe(0x1b);
    expect(bytes.subarray(-3).toString('hex')).toBe('1d5600'); // GS V 0, corte parcial
    expect(bytes.toString('latin1')).toContain('Cuaderno');
  });

  it('imprimir_ticket se niega a imprimir sin destino configurado', async () => {
    const e = await falla('imprimir_ticket', { ticket: TICKET_VALIDO });
    expect(e.codigo).toBe(CODIGO_ERROR.impresora_no_configurada);
  });

  it('probar_impresora usa el mismo camino que una factura', async () => {
    const ruta = `${raiz}/prueba.bin`;
    await ok('configurar_destino_impresora', { destino: { tipo: 'archivo', ruta } });
    await ok('probar_impresora');
    const fs = await import('node:fs');
    expect(fs.existsSync(ruta)).toBe(true);
  });

  it('listar_impresoras devuelve una lista, aunque esté vacía', async () => {
    // En Linux no hay `Get-Printer`; el caso vacío es el que se da cuando el
    // proceso no puede preguntar, y el formulario tiene un campo para escribir
    // el nombre a mano. Devolver un error dejaría la pantalla vacía sin salida.
    const lista = await ok<string[]>('listar_impresoras');
    expect(Array.isArray(lista)).toBe(true);
  });
});

//---------------------------------------------------------------------------
// La guarda del ticket
//---------------------------------------------------------------------------

describe('validarTicket', () => {
  it('acepta un ticket bien formado', () => {
    expect(() => validarTicket(TICKET_VALIDO)).not.toThrow();
  });

  it('dice qué lista falta', () => {
    for (const campo of ['detalle', 'pagos', 'devoluciones']) {
      const malo = { ...TICKET_VALIDO, [campo]: undefined };
      expect(() => validarTicket(malo as never), campo).toThrowError(new RegExp(`«${campo}»`));
    }
  });

  it('dice qué texto falta', () => {
    for (const campo of ['cliente', 'negocio_nombre', 'fecha']) {
      const malo = { ...TICKET_VALIDO, [campo]: undefined };
      expect(() => validarTicket(malo as never), campo).toThrowError(new RegExp(`«${campo}»`));
    }
  });

  it('dice qué número falta', () => {
    for (const campo of ['numero_factura', 'total', 'tasa_cambio']) {
      const malo = { ...TICKET_VALIDO, [campo]: undefined };
      expect(() => validarTicket(malo as never), campo).toThrowError(new RegExp(`«${campo}»`));
    }
  });

  it('rechaza un número que no es finito, que es lo que produce un NaN', () => {
    // Un NaN llega aquí desde un `Math.round` de algo indefinido en el
    // generador de la factura, y sale impreso como "NaN" en el papel.
    expect(() => validarTicket({ ...TICKET_VALIDO, total: Number.NaN })).toThrowError(/«total»/);
  });
});

//---------------------------------------------------------------------------
// Cosas que no se pueden llamar dos veces
//---------------------------------------------------------------------------

describe('estado que se rompe si se repite', () => {
  it('no deja abrir dos cajas', async () => {
    const u = usuario(db);
    await ok('abrir_caja', { caja: { operador_id: u } });
    const e = await falla('abrir_caja', { caja: { operador_id: u } });
    expect(e.codigo).toBe(CODIGO_ERROR.caja_ya_abierta);
  });

  it('no deja anular dos veces la misma venta', async () => {
    const u = usuario(db);
    tasa(db, 36.5);
    const c = cliente(db);
    const p = producto(db, 350);
    stock(db, p, 10);
    await ok('abrir_caja', { caja: { operador_id: u } });
    const v = await ok<{ id: number }>('crear_venta', {
      venta: {
        cliente_id: c,
        tipo: 'credito',
        descuento: 0,
        operador_id: u,
        detalles: [{ producto_id: p, cantidad: 1 }],
        pagos: [],
      },
    });

    await ok('anular_venta', { venta_id: v.id, motivo: 'Error de tecleo', operador_id: u });
    const e = await falla('anular_venta', { venta_id: v.id, motivo: 'otra vez', operador_id: u });
    expect(e.codigo).toBe(CODIGO_ERROR.venta_anulada);
  });

  it('no anula una venta a crédito a la que el cliente ya abonó', async () => {
    // El abono no lleva `venta_id` —el FIFO del estado de cuenta lo reparte
    // entre las facturas—, así que la venta sola parece no tener pagos. Pero el
    // dinero sí está detrás de ella, y anularla lo dejaba huérfano: la venta
    // salía del total facturado, los 500 se quedaban en `pagos` y en el
    // arqueo del día, y el `Math.max(facturado - pagado, 0)` recortaba la
    // cuenta a cero. El dinero no aparecía ni como deuda ni como saldo a
    // favor, en ninguna pantalla.
    const u = usuario(db);
    tasa(db, 36.5);
    const c = cliente(db);
    const p = producto(db, 1000);
    stock(db, p, 10);
    await ok('abrir_caja', { caja: { operador_id: u } });
    const v = await ok<{ id: number }>('crear_venta', {
      venta: {
        cliente_id: c,
        tipo: 'credito',
        descuento: 0,
        operador_id: u,
        detalles: [{ producto_id: p, cantidad: 1 }],
        pagos: [],
      },
    });
    await ok('registrar_abono', {
      abono: {
        cliente_id: c,
        operador_id: u,
        pagos: [{ monto: 500, tipo_pago: 'efectivo', moneda: 'usd' }],
      },
    });

    const e = await falla('anular_venta', {
      venta_id: v.id,
      motivo: 'se lo llevó sin pagar',
      operador_id: u,
    });
    expect(e.codigo).toBe(CODIGO_ERROR.venta_con_pagos);
    // El mensaje dice qué hacer en su lugar, no solo qué pasó.
    expect(e.mensaje).toMatch(/devoluci[oó]n/i);

    // Y nada se movió: la venta sigue viva, el stock sigue descontado, y los
    // 500 siguen imputándose a la factura que los respaldaba.
    const ventas = await ok<{ id: number; estado: string }[]>('listar_ventas');
    expect(ventas.find((x) => x.id === v.id)?.estado).toBe('entregada');
    const cuenta = await ok<{ total_pagado: number; saldo_pendiente: number }>('estado_cuenta', {
      cliente_id: c,
    });
    expect(cuenta.total_pagado).toBe(500);
    expect(cuenta.saldo_pendiente).toBe(500);
  });

  it('no anula una venta de contado, que siempre está cobrada', async () => {
    // `crearVenta` no admite una venta de contado sin pago, así que aquí el
    // veto es siempre el caso. No es una pérdida de función: devolver una
    // venta cobrada es una devolución, que repone el stock y deja rastro.
    const u = usuario(db);
    tasa(db, 36.5);
    const p = producto(db, 500);
    stock(db, p, 10);
    await ok('abrir_caja', { caja: { operador_id: u } });
    const v = await ok<{ id: number }>('crear_venta', {
      venta: {
        cliente_id: clienteMostrador(db),
        tipo: 'contado',
        descuento: 0,
        operador_id: u,
        detalles: [{ producto_id: p, cantidad: 1 }],
        pagos: [{ monto: 500, tipo_pago: 'efectivo', moneda: 'usd' }],
      },
    });

    const e = await falla('anular_venta', { venta_id: v.id, motivo: 'mal', operador_id: u });
    expect(e.codigo).toBe(CODIGO_ERROR.venta_con_pagos);
  });

  it('anula una venta a crédito cuando el abono es de una factura más antigua', async () => {
    // El veto mira el reparto FIFO, no el saldo del cliente. Un abono que
    // alcanza a la factura vieja no impide deshacer una venta nueva que
    // todavía nadie pagó; de lo contrario el cliente quedaría con sus facturas
    // viejas bloqueadas para siempre.
    const u = usuario(db);
    tasa(db, 36.5);
    const c = cliente(db);
    const p = producto(db, 1000);
    stock(db, p, 10);
    await ok('abrir_caja', { caja: { operador_id: u } });

    const vieja = await ok<{ id: number }>('crear_venta', {
      venta: {
        cliente_id: c,
        tipo: 'credito',
        descuento: 0,
        operador_id: u,
        detalles: [{ producto_id: p, cantidad: 1 }],
        pagos: [],
      },
    });
    const nueva = await ok<{ id: number }>('crear_venta', {
      venta: {
        cliente_id: c,
        tipo: 'credito',
        descuento: 0,
        operador_id: u,
        detalles: [{ producto_id: p, cantidad: 1 }],
        pagos: [],
      },
    });
    // Un abono exacto por la factura vieja: el FIFO se lo queda entero.
    await ok('registrar_abono', {
      abono: {
        cliente_id: c,
        operador_id: u,
        pagos: [{ monto: 1000, tipo_pago: 'efectivo', moneda: 'usd' }],
      },
    });

    await ok('anular_venta', { venta_id: nueva.id, motivo: 'error de tecleo', operador_id: u });
    // La vieja, que sí está pagada, sigue protegida.
    const e = await falla('anular_venta', { venta_id: vieja.id, motivo: 'x', operador_id: u });
    expect(e.codigo).toBe(CODIGO_ERROR.venta_con_pagos);
  });

  it('no deja anular sin motivo', async () => {
    const e = await falla('anular_venta', { venta_id: 1, motivo: '   ', operador_id: 1 });
    expect(e.codigo).toBe(CODIGO_ERROR.validacion);
    expect(e.mensaje).toContain('motivo');
  });

  it('no deja crear dos productos con el mismo código', async () => {
    await ok('crear_producto', {
      producto: { codigo: 'X', nombre: 'Uno', unidad_medida: 'unidad', precio_base: 100, activo: true },
    });
    const e = await falla('crear_producto', {
      producto: { codigo: 'X', nombre: 'Otro', unidad_medida: 'unidad', precio_base: 200, activo: true },
    });
    expect(e.codigo).toBe(CODIGO_ERROR.duplicado);
  });

  it('no deja crear dos clientes con el mismo documento', async () => {
    await ok('crear_cliente', {
      cliente: { nombre: 'Uno', documento: 'J-1', dias_credito: 0, limite_credito: 0, activo: true },
    });
    const e = await falla('crear_cliente', {
      cliente: { nombre: 'Otro', documento: 'j-1', dias_credito: 0, limite_credito: 0, activo: true },
    });
    expect(e.codigo).toBe(CODIGO_ERROR.duplicado);
  });
});

//---------------------------------------------------------------------------
// El ticket de ejemplo
//---------------------------------------------------------------------------

const TICKET_VALIDO = {
  negocio_nombre: 'Papelería Fabi',
  negocio_rif: 'J-40123456-7',
  negocio_telefono: '0412-1234567',
  negocio_direccion: 'Av. Principal, Caracas',
  numero_factura: 1,
  fecha: '2026-01-15',
  cliente: 'Mostrador',
  cliente_documento: '0',
  subtotal: 700,
  descuento: 0,
  total: 700,
  tasa_cambio: 36.5,
  detalle: [{ producto: 'Cuaderno', cantidad: 2, subtotal: 700 }],
  pagos: [{ tipo_pago: 'efectivo', moneda: 'usd', monto: 700, numero_referencia: null }],
  devoluciones: [],
  recordatorio: null,
};
