import { describe, expect, it } from 'vitest';

import {
  actualizarCategoria,
  actualizarCliente,
  actualizarProducto,
  cantidadDisponible,
  cambiarPin,
  crearCategoria,
  crearCliente,
  crearProducto,
  crearUsuario,
  descontarStock,
  eliminarCategoria,
  eliminarCliente,
  eliminarPrecioCliente,
  eliminarProducto,
  listarCategorias,
  listarClientes,
  listarPreciosCliente,
  listarProductos,
  listarStock,
  listarUsuarios,
  obtenerCliente,
  obtenerProducto,
  obtenerUnidad,
  precioEfectivo,
  registrarAjuste,
  registrarEntradaMercancia,
  registrarMerma,
  reponerStock,
  setPrecioCliente,
  verificarPin,
} from './repo.js';
import { enMemoria, qUno, qTodos, transaccion } from './db.js';
import { CODIGO_ERROR } from './errors.js';
import { usuario as crearUsuarioFixture, venta } from './testutil.js';
import type { DatabaseSync } from 'node:sqlite';
import type { ClienteInput, ProductoInput } from '@tienda/core';

//---------------------------------------------------------------------------
// Utilidades de las pruebas
//---------------------------------------------------------------------------

const bd = (): DatabaseSync => enMemoria();

/**
 * Usuario operador válido.
 *
 * `movimientos_inventario.operador_id` y `venta_id` tienen clave foránea, así
 * que los números sueltos tipo `1` no sirven: hay que crear las filas de las
 * que dependen los apuntes.
 */
const operador = (db: DatabaseSync): number => crearUsuarioFixture(db, 'Alex');

const CLIENTE: ClienteInput = {
  documento: 'V-12345678',
  nombre: 'Colegio Santa María',
  dias_credito: 30,
  limite_credito: 0,
  activo: true,
};

const PRODUCTO: ProductoInput = {
  codigo: 'P-1',
  nombre: 'Cuaderno',
  unidad_medida: 'unidad',
  precio_base: 500,
  activo: true,
};

/** Crea un producto en `db` y devuelve su id. */
function producto(db: DatabaseSync, over: Partial<ProductoInput> = {}): number {
  return crearProducto(db, { ...PRODUCTO, ...over });
}

/** Producto con 10 unidades en stock. */
function productoConStock(db: DatabaseSync, cantidad = 10, over: Partial<ProductoInput> = {}): number {
  const id = producto(db, over);
  registrarEntradaMercancia(db, {
    producto_id: id,
    cantidad,
    costo_unitario: 400,
    operador_id: operador(db),
    fecha: '2026-09-01',
  });
  return id;
}

/** El mensaje del error lanzado. */
function mensajeDe(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof Error) return e.message;
    throw e;
  }
  throw new Error('se esperaba un error y no se lanzó');
}

/** El `codigo` del `AppError` lanzado. */
function codigoDe(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e && typeof e === 'object' && 'codigo' in e) return String((e as { codigo: string }).codigo);
    throw e;
  }
  throw new Error('se esperaba un AppError y no se lanzó');
}

const conteo = (db: DatabaseSync, tabla: string): number =>
  qUno<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${tabla}`)!.n;

//---------------------------------------------------------------------------
// Categorías
//---------------------------------------------------------------------------

describe('categorías', () => {
  it('crea y lista con el conteo de productos', () => {
    const db = bd();
    const utiles = crearCategoria(db, { nombre: 'Útiles escolares' });
    producto(db, { categoria_id: utiles });

    const categorias = listarCategorias(db);
    expect(categorias).toHaveLength(1);
    expect(categorias[0]).toMatchObject({ nombre: 'Útiles escolares', productos: 1, activo: true });
  });

  it('admite anidamiento y lo refleja en parent_id', () => {
    const db = bd();
    // Se fija `orden` distinto en cada una porque el listado ordena por ese
    // campo, y a igualdad de `orden` desempata por nombre. Sin esto el orden
    // de la prueba dependería de las tildes.
    const pap = crearCategoria(db, { nombre: 'Papelería', orden: 1 });
    const utiles = crearCategoria(db, { nombre: 'Útiles', parent_id: pap, orden: 2 });
    const cuadernos = crearCategoria(db, { nombre: 'Cuadernos', parent_id: utiles, orden: 3 });
    expect(cuadernos).toBeGreaterThan(0);

    expect(listarCategorias(db).map((c) => [c.nombre, c.parent_id])).toEqual([
      ['Papelería', null],
      ['Útiles', pap],
      ['Cuadernos', utiles],
    ]);
  });

  it('ordena por `orden` y, a igualdad, por nombre', () => {
    const db = bd();
    crearCategoria(db, { nombre: 'Zeta', orden: 2 });
    crearCategoria(db, { nombre: 'Alfa', orden: 2 });
    crearCategoria(db, { nombre: 'Mango', orden: 1 });
    expect(listarCategorias(db).map((c) => c.nombre)).toEqual(['Mango', 'Alfa', 'Zeta']);
  });

  it('no cuenta productos desactivados', () => {
    const db = bd();
    const cat = crearCategoria(db, { nombre: 'Oficina' });
    const id = producto(db, { categoria_id: cat });
    eliminarProducto(db, id, 1);
    expect(listarCategorias(db)[0]?.productos).toBe(0);
  });

  it('no admite dos categorías con el mismo nombre al mismo nivel', () => {
    const db = bd();
    crearCategoria(db, { nombre: 'Oficina' });
    expect(codigoDe(() => crearCategoria(db, { nombre: 'Oficina' }))).toBe(CODIGO_ERROR.duplicado);
  });

  it('sí admite el mismo nombre bajo padres distintos', () => {
    const db = bd();
    const pap = crearCategoria(db, { nombre: 'Papelería' });
    crearCategoria(db, { nombre: 'Oficina' });
    expect(() => crearCategoria(db, { nombre: 'Oficina', parent_id: pap })).not.toThrow();
  });

  it('exige un nombre', () => {
    const db = bd();
    expect(codigoDe(() => crearCategoria(db, { nombre: '   ' }))).toBe(CODIGO_ERROR.validacion);
  });

  it('no admite una categoría que sea su propia madre', () => {
    const db = bd();
    const id = crearCategoria(db, { nombre: 'Oficina' });
    expect(mensajeDe(() => actualizarCategoria(db, id, { nombre: 'Oficina', parent_id: id }))).toBe(
      'Una categoría no puede ser su propia madre',
    );
  });

  it('no admite mover una categoría dentro de su propia hija', () => {
    const db = bd();
    const pap = crearCategoria(db, { nombre: 'Papelería' });
    const utiles = crearCategoria(db, { nombre: 'Útiles', parent_id: pap });
    expect(
      mensajeDe(() => actualizarCategoria(db, pap, { nombre: 'Papelería', parent_id: utiles })),
    ).toMatch(/subcategorías/);
  });

  it('sí admite reorganizar ramas independientes', () => {
    const db = bd();
    const pap = crearCategoria(db, { nombre: 'Papelería' });
    const oficina = crearCategoria(db, { nombre: 'Oficina' });
    expect(() =>
      actualizarCategoria(db, oficina, { nombre: 'Oficina', parent_id: pap }),
    ).not.toThrow();
    expect(listarCategorias(db).find((c) => c.nombre === 'Oficina')?.parent_id).toBe(pap);
  });

  it('rechaza una madre inexistente', () => {
    const db = bd();
    const id = crearCategoria(db, { nombre: 'Oficina' });
    expect(codigoDe(() => actualizarCategoria(db, id, { nombre: 'Oficina', parent_id: 999 }))).toBe(
      CODIGO_ERROR.no_encontrado,
    );
  });

  it('desactivar una categoría deja sus productos sin categoría, no los borra', () => {
    const db = bd();
    const cat = crearCategoria(db, { nombre: 'Oficina' });
    const id = producto(db, { categoria_id: cat });

    eliminarCategoria(db, cat);

    expect(listarCategorias(db)).toHaveLength(0);
    expect(obtenerProducto(db, id).categoria_id).toBeNull();
  });
});

//---------------------------------------------------------------------------
// Clientes
//---------------------------------------------------------------------------

describe('clientes', () => {
  it('normaliza el documento y recorta el nombre', () => {
    const db = bd();
    crearCliente(db, {
      ...CLIENTE,
      documento: '  v-12345678 ',
      nombre: '  Colegio Santa María  ',
    });
    const c = listarClientes(db)[0]!;
    expect(c.documento).toBe('V-12345678');
    expect(c.nombre).toBe('Colegio Santa María');
  });

  it('rechaza un documento demasiado corto', () => {
    const db = bd();
    expect(codigoDe(() => crearCliente(db, { ...CLIENTE, documento: '1' }))).toBe(
      CODIGO_ERROR.validacion,
    );
  });

  it('convierte los indicadores 0/1 de SQLite a booleanos', () => {
    const db = bd();
    crearCliente(db, CLIENTE);
    // El tipo del dominio dice `boolean`; si el mapeo se olvidara, la interfaz
    // recibiría 0/1 y un `if (cliente.es_mostrador)` se comportaría al revés.
    expect(listarClientes(db)[0]?.es_mostrador).toBe(false);
    expect(listarClientes(db)[0]?.activo).toBe(true);

    db.prepare('UPDATE clientes SET es_mostrador = 1, activo = 0').run();
    const c = obtenerCliente(db, 1);
    expect(c.es_mostrador).toBe(true);
    expect(c.activo).toBe(false);
  });

  it('rechaza días de crédito negativos', () => {
    const db = bd();
    expect(mensajeDe(() => crearCliente(db, { ...CLIENTE, dias_credito: -1 }))).toBe(
      'Los días de crédito no pueden ser negativos',
    );
  });

  it('rechaza un límite de crédito negativo', () => {
    const db = bd();
    expect(mensajeDe(() => crearCliente(db, { ...CLIENTE, limite_credito: -1 }))).toBe(
      'Límite de crédito no puede ser negativo',
    );
  });

  it('convierte los textos vacíos en null', () => {
    const db = bd();
    crearCliente(db, { ...CLIENTE, razon_social: '   ', telefono: null, email: '' });
    const c = listarClientes(db)[0]!;
    expect(c.razon_social).toBeNull();
    expect(c.telefono).toBeNull();
    expect(c.email).toBeNull();
    expect(c.direccion).toBeNull();
  });

  it('rechaza un documento repetido, aunque cambie el formato', () => {
    const db = bd();
    // ' v-1 ' y 'v-1' se normalizan al mismo 'V-1'.
    crearCliente(db, { ...CLIENTE, documento: ' v-1 ' });
    expect(codigoDe(() => crearCliente(db, { ...CLIENTE, documento: 'v-1' }))).toBe(
      CODIGO_ERROR.duplicado,
    );
  });

  it('libera el documento de un cliente desactivado', () => {
    const db = bd();
    const id = crearCliente(db, { ...CLIENTE, documento: 'V-1' });
    db.prepare('UPDATE clientes SET activo = 0 WHERE id = ?').run(id);
    // El UNIQUE es parcial: solo mira los activos, así que el documento vuelve a estar libre.
    expect(() => crearCliente(db, { ...CLIENTE, documento: 'V-1' })).not.toThrow();
  });

  it('actualiza los datos de plazo y límite', () => {
    const db = bd();
    const id = crearCliente(db, CLIENTE);
    actualizarCliente(db, id, { ...CLIENTE, nombre: 'Colegio Don Bosco', dias_credito: 60, limite_credito: 500_00 });
    const c = obtenerCliente(db, id);
    expect(c.nombre).toBe('Colegio Don Bosco');
    expect(c.dias_credito).toBe(60);
    expect(c.limite_credito).toBe(50_000);
  });

  it('desactivar no borra: el registro sigue consultable por id', () => {
    const db = bd();
    const id = crearCliente(db, CLIENTE);
    db.prepare('UPDATE clientes SET activo = 0 WHERE id = ?').run(id);

    expect(listarClientes(db)).toHaveLength(0);
    // Sigue en la base: sus ventas lo necesitan para el estado de cuenta.
    expect(obtenerCliente(db, id).nombre).toBe(CLIENTE.nombre);
  });

  it('eliminarCliente no borra la fila', () => {
    const db = bd();
    const id = crearCliente(db, CLIENTE);
    eliminarCliente(db, id);
    expect(conteo(db, 'clientes')).toBe(1);
    expect(listarClientes(db)).toHaveLength(0);
  });

  it('eliminarCliente falla si el cliente no existe o ya estaba dado de baja', () => {
    const db = bd();
    const id = crearCliente(db, CLIENTE);
    eliminarCliente(db, id);
    expect(codigoDe(() => eliminarCliente(db, id))).toBe(CODIGO_ERROR.no_encontrado);
    expect(codigoDe(() => eliminarCliente(db, 999))).toBe(CODIGO_ERROR.no_encontrado);
  });
});

//---------------------------------------------------------------------------
// Productos
//---------------------------------------------------------------------------

describe('productos', () => {
  it('normaliza el código y crea la fila de stock en cero', () => {
    const db = bd();
    const id = producto(db, { codigo: '  p-1 ' });
    expect(obtenerProducto(db, id).codigo).toBe('P-1');
    expect(cantidadDisponible(db, id)).toBe(0);
  });

  it('guarda categoría, código de barras y stock mínimo', () => {
    const db = bd();
    const cat = crearCategoria(db, { nombre: 'Cuadernos' });
    const id = producto(db, {
      codigo_barras: '7501234567890',
      categoria_id: cat,
      stock_minimo: 5,
    });
    const p = obtenerProducto(db, id);
    expect(p.codigo_barras).toBe('7501234567890');
    expect(p.categoria_id).toBe(cat);
    expect(p.stock_minimo).toBe(5);
  });

  it('deja impuesto y stock mínimo en 0 si no se indican', () => {
    const db = bd();
    const p = obtenerProducto(db, producto(db));
    expect(p.impuesto_porcentaje).toBe(0);
    expect(p.stock_minimo).toBe(0);
  });

  it('rechaza un precio de cero o negativo', () => {
    const db = bd();
    expect(codigoDe(() => producto(db, { precio_base: 0 }))).toBe(CODIGO_ERROR.validacion);
    expect(codigoDe(() => producto(db, { precio_base: -100 }))).toBe(CODIGO_ERROR.validacion);
  });

  it('rechaza un impuesto fuera de 0..100', () => {
    const db = bd();
    expect(codigoDe(() => producto(db, { impuesto_porcentaje: -1 }))).toBe(CODIGO_ERROR.validacion);
    expect(codigoDe(() => producto(db, { impuesto_porcentaje: 101 }))).toBe(CODIGO_ERROR.validacion);
    expect(() => producto(db, { impuesto_porcentaje: 16 })).not.toThrow();
  });

  it('rechaza un stock mínimo negativo', () => {
    const db = bd();
    expect(codigoDe(() => producto(db, { stock_minimo: -1 }))).toBe(CODIGO_ERROR.validacion);
  });

  it('rechaza una unidad de medida desconocida', () => {
    const db = bd();
    expect(codigoDe(() => producto(db, { unidad_medida: 'arroba' as never }))).toBe(
      CODIGO_ERROR.validacion,
    );
  });

  it('rechaza un código repetido entre productos activos', () => {
    const db = bd();
    // 'P 1' y 'p 1' se normalizan al mismo 'P1': la colisión tiene que saltar
    // en la restricción, no pasar los dos.
    producto(db, { codigo: 'P 1' });
    expect(codigoDe(() => producto(db, { codigo: 'p 1', nombre: 'Otro' }))).toBe(
      CODIGO_ERROR.duplicado,
    );
  });

  it('rechaza un código de barras repetido', () => {
    const db = bd();
    producto(db, { codigo_barras: '750' });
    expect(
      codigoDe(() => producto(db, { codigo: 'P-2', codigo_barras: '750' })),
    ).toBe(CODIGO_ERROR.duplicado);
  });

  it('admite productos sin código de barras, incluso varios', () => {
    const db = bd();
    producto(db, { codigo: 'A' });
    producto(db, { codigo: 'B' });
    producto(db, { codigo: 'C', codigo_barras: '' });
    expect(listarProductos(db)).toHaveLength(3);
  });

  it('no deja una fila de stock huérfana si el producto falla', () => {
    const db = bd();
    producto(db);
    expect(() => producto(db, { codigo: 'P-1' })).toThrow();
    expect(conteo(db, 'productos')).toBe(1);
    expect(conteo(db, 'stock')).toBe(1);
  });

  it('actualiza precio, categoría y stock mínimo', () => {
    const db = bd();
    const cat = crearCategoria(db, { nombre: 'Oficina' });
    const id = producto(db);
    actualizarProducto(db, id, {
      ...PRODUCTO,
      nombre: 'Cuaderno universitario',
      precio_base: 900,
      categoria_id: cat,
      stock_minimo: 3,
    });
    const p = obtenerProducto(db, id);
    expect(p).toMatchObject({ nombre: 'Cuaderno universitario', precio_base: 900, categoria_id: cat, stock_minimo: 3 });
  });

  it('actualizar un producto inexistente falla', () => {
    const db = bd();
    expect(codigoDe(() => actualizarProducto(db, 999, PRODUCTO))).toBe(CODIGO_ERROR.no_encontrado);
  });

  it('desactivar saca el producto del catálogo y deja el stock en cero', () => {
    const db = bd();
    const id = productoConStock(db, 10);
    eliminarProducto(db, id, 1);

    expect(listarProductos(db)).toHaveLength(0);
    expect(cantidadDisponible(db, id)).toBe(0);
    const movs = qTodos<{ motivo: string }>(
      db,
      'SELECT motivo FROM movimientos_inventario WHERE producto_id = ? ORDER BY id',
      id,
    );
    expect(movs.at(-1)?.motivo).toBe('Producto dado de baja');
  });

  it('libera el código de un producto desactivado', () => {
    const db = bd();
    const id = producto(db);
    eliminarProducto(db, id, 1);
    expect(() => producto(db, { nombre: 'Reutilizado', precio_base: 200 })).not.toThrow();
  });

  it('obtenerUnidad falla si el producto no existe o está dado de baja', () => {
    const db = bd();
    expect(codigoDe(() => obtenerUnidad(db, 999))).toBe(CODIGO_ERROR.no_encontrado);

    const id = producto(db, { unidad_medida: 'kg' });
    expect(obtenerUnidad(db, id)).toBe('kg');
    eliminarProducto(db, id, 1);
    expect(codigoDe(() => obtenerUnidad(db, id))).toBe(CODIGO_ERROR.no_encontrado);
  });
});

//---------------------------------------------------------------------------
// Precios especiales por cliente
//---------------------------------------------------------------------------

describe('precios por cliente', () => {
  const escenario = () => {
    const db = bd();
    const clienteId = crearCliente(db, CLIENTE);
    const productoId = producto(db);
    return { db, clienteId, productoId };
  };

  it('sin precio especial devuelve el precio base', () => {
    const { db, clienteId, productoId } = escenario();
    expect(precioEfectivo(db, productoId, clienteId)).toMatchObject({
      precio: 500,
      unidad: 'unidad',
    });
  });

  it('con precio especial lo antepone al base', () => {
    const { db, clienteId, productoId } = escenario();
    setPrecioCliente(db, { cliente_id: clienteId, producto_id: productoId, precio_especial: 420 });
    expect(precioEfectivo(db, productoId, clienteId).precio).toBe(420);
  });

  it('trae el porcentaje de impuesto del producto', () => {
    const db = bd();
    const clienteId = crearCliente(db, CLIENTE);
    const productoId = producto(db, { impuesto_porcentaje: 16 });
    expect(precioEfectivo(db, productoId, clienteId).impuestoPorcentaje).toBe(16);
  });

  it('fijar el precio dos veces actualiza en vez de duplicar', () => {
    const { db, clienteId, productoId } = escenario();
    setPrecioCliente(db, { cliente_id: clienteId, producto_id: productoId, precio_especial: 420 });
    setPrecioCliente(db, { cliente_id: clienteId, producto_id: productoId, precio_especial: 400 });
    const lista = listarPreciosCliente(db, clienteId);
    expect(lista).toHaveLength(1);
    expect(lista[0]?.precio_especial).toBe(400);
  });

  it('rechaza un precio especial de cero o negativo', () => {
    const { db, clienteId, productoId } = escenario();
    expect(
      codigoDe(() => setPrecioCliente(db, { cliente_id: clienteId, producto_id: productoId, precio_especial: 0 })),
    ).toBe(CODIGO_ERROR.validacion);
  });

  it('eliminar el precio especial devuelve el producto al precio base', () => {
    const { db, clienteId, productoId } = escenario();
    setPrecioCliente(db, { cliente_id: clienteId, producto_id: productoId, precio_especial: 420 });
    eliminarPrecioCliente(db, clienteId, productoId);
    expect(listarPreciosCliente(db, clienteId)).toHaveLength(0);
    expect(precioEfectivo(db, productoId, clienteId).precio).toBe(500);
  });

  it('el precio especial es por cliente: otro paga el base', () => {
    const { db, clienteId, productoId } = escenario();
    const otro = crearCliente(db, { ...CLIENTE, documento: 'V-2', nombre: 'Otro' });
    setPrecioCliente(db, { cliente_id: clienteId, producto_id: productoId, precio_especial: 420 });
    expect(precioEfectivo(db, productoId, otro).precio).toBe(500);
  });

  it('precioEfectivo falla si el producto no existe', () => {
    const { db, clienteId } = escenario();
    expect(codigoDe(() => precioEfectivo(db, 999, clienteId))).toBe(CODIGO_ERROR.no_encontrado);
  });
});

//---------------------------------------------------------------------------
// Entrada de mercadería
//---------------------------------------------------------------------------

describe('entrada de mercadería', () => {
  it('suma al stock y deja asiento en el libro', () => {
    const db = bd();
    const id = producto(db);
    registrarEntradaMercancia(db, {
      producto_id: id,
      cantidad: 24,
      costo_unitario: 400,
      operador_id: 1,
      fecha: '2026-09-01',
      proveedor: 'Distribuidora del Centro',
      documento_ref: 'F-001',
    });

    expect(cantidadDisponible(db, id)).toBe(24);
    expect(
      qUno<{ tipo: string; cantidad: number }>(
        db,
        'SELECT tipo, cantidad FROM movimientos_inventario WHERE producto_id = ?',
        id,
      ),
    ).toEqual({ tipo: 'entrada_mercancia', cantidad: 24 });
  });

  it('guarda proveedor y documento de la factura de compra', () => {
    const db = bd();
    const id = producto(db);
    registrarEntradaMercancia(db, {
      producto_id: id,
      cantidad: 10,
      costo_unitario: 400,
      operador_id: 1,
      fecha: '2026-09-01',
      proveedor: 'Distribuidora del Centro',
      documento_ref: 'F-001',
    });
    expect(qUno<{ proveedor: string; documento_ref: string }>(
      db,
      'SELECT proveedor, documento_ref FROM entradas_mercancia',
    )).toEqual({ proveedor: 'Distribuidora del Centro', documento_ref: 'F-001' });
  });

  it('acumula varias entradas', () => {
    const db = bd();
    const id = producto(db);
    registrarEntradaMercancia(db, { producto_id: id, cantidad: 10, costo_unitario: 400, operador_id: 1, fecha: '2026-09-01' });
    registrarEntradaMercancia(db, { producto_id: id, cantidad: 5, costo_unitario: 420, operador_id: 1, fecha: '2026-09-02' });
    expect(cantidadDisponible(db, id)).toBe(15);
  });

  it('acepta fracciones en productos que se venden al peso o la medida', () => {
    const db = bd();
    const metro = producto(db, { codigo: 'C-1', unidad_medida: 'metro' });
    registrarEntradaMercancia(db, { producto_id: metro, cantidad: 0.5, costo_unitario: 150, operador_id: 1, fecha: '2026-09-01' });
    expect(cantidadDisponible(db, metro)).toBe(0.5);
  });

  it('rechaza una cantidad fraccionaria en un producto por unidad', () => {
    const db = bd();
    const id = producto(db);
    expect(
      mensajeDe(() =>
        registrarEntradaMercancia(db, { producto_id: id, cantidad: 1.5, costo_unitario: 400, operador_id: 1, fecha: '2026-09-01' }),
      ),
    ).toMatch(/número entero/);
  });

  it('no mueve el stock si el movimiento falla', () => {
    const db = bd();
    const id = producto(db);
    expect(() =>
      registrarEntradaMercancia(db, { producto_id: 999, cantidad: 5, costo_unitario: 400, operador_id: 1, fecha: '2026-09-01' }),
    ).toThrow();
    expect(cantidadDisponible(db, id)).toBe(0);
    expect(conteo(db, 'movimientos_inventario')).toBe(0);
  });
});

//---------------------------------------------------------------------------
// Merma
//---------------------------------------------------------------------------

describe('merma', () => {
  it('descuenta del stock y asienta la salida con signo negativo', () => {
    const db = bd();
    const id = productoConStock(db, 10);
    registrarMerma(db, { producto_id: id, cantidad: 2, motivo: ' mojado ', operador_id: 1 });

    expect(cantidadDisponible(db, id)).toBe(8);
    expect(
      qUno<{ tipo: string; cantidad: number; motivo: string }>(
        db,
        'SELECT tipo, cantidad, motivo FROM movimientos_inventario WHERE producto_id = ? ORDER BY id DESC',
        id,
      ),
    ).toEqual({ tipo: 'merma', cantidad: -2, motivo: 'mojado' });
  });

  it('exige un motivo', () => {
    const db = bd();
    const id = productoConStock(db, 10);
    expect(mensajeDe(() => registrarMerma(db, { producto_id: id, cantidad: 1, motivo: '  ', operador_id: 1 }))).toBe(
      'La merma requiere un motivo',
    );
    expect(cantidadDisponible(db, id)).toBe(10);
  });

  it('no deja el stock en negativo', () => {
    const db = bd();
    const id = productoConStock(db, 10);
    expect(
      codigoDe(() =>
        registrarMerma(db, { producto_id: id, cantidad: 99, motivo: 'error de conteo', operador_id: operador(db) }),
      ),
    ).toBe(CODIGO_ERROR.stock_insuficiente);
    expect(cantidadDisponible(db, id)).toBe(10);
  });
});

//---------------------------------------------------------------------------
// Ajuste por conteo físico
//---------------------------------------------------------------------------

describe('ajuste por conteo físico', () => {
  it('sube el stock con un delta positivo', () => {
    const db = bd();
    const id = productoConStock(db, 10);
    registrarAjuste(db, { producto_id: id, cantidad_delta: 3, motivo: 'conteo físico', operador_id: 1 });
    expect(cantidadDisponible(db, id)).toBe(13);
  });

  it('baja el stock con un delta negativo', () => {
    const db = bd();
    const id = productoConStock(db, 10);
    registrarAjuste(db, { producto_id: id, cantidad_delta: -4, motivo: 'conteo físico', operador_id: 1 });
    expect(cantidadDisponible(db, id)).toBe(6);
  });

  it('asienta el delta con su signo', () => {
    const db = bd();
    const id = productoConStock(db, 10);
    registrarAjuste(db, { producto_id: id, cantidad_delta: -4, motivo: 'conteo físico', operador_id: 1 });
    expect(
      qUno<{ tipo: string; cantidad: number }>(
        db,
        'SELECT tipo, cantidad FROM movimientos_inventario WHERE producto_id = ? ORDER BY id DESC',
        id,
      ),
    ).toEqual({ tipo: 'ajuste', cantidad: -4 });
  });

  it('no deja el stock en negativo', () => {
    const db = bd();
    const id = productoConStock(db, 10);
    expect(
      mensajeDe(() => registrarAjuste(db, { producto_id: id, cantidad_delta: -99, motivo: 'conteo', operador_id: 1 })),
    ).toBe('El ajuste dejaría el stock en negativo');
    expect(cantidadDisponible(db, id)).toBe(10);
  });

  it('rechaza un ajuste de cero', () => {
    const db = bd();
    const id = productoConStock(db, 10);
    expect(
      mensajeDe(() => registrarAjuste(db, { producto_id: id, cantidad_delta: 0, motivo: 'conteo', operador_id: 1 })),
    ).toBe('El ajuste no puede ser cero');
  });

  it('exige un motivo', () => {
    const db = bd();
    const id = productoConStock(db, 10);
    expect(
      mensajeDe(() => registrarAjuste(db, { producto_id: id, cantidad_delta: 1, motivo: '', operador_id: 1 })),
    ).toBe('El ajuste requiere un motivo');
  });

  it('rechaza un delta fuera de rango o no numérico', () => {
    const db = bd();
    const id = productoConStock(db, 10);
    for (const delta of [5_000_000, -5_000_000, Number.NaN]) {
      expect(codigoDe(() => registrarAjuste(db, { producto_id: id, cantidad_delta: delta, motivo: 'x', operador_id: 1 }))).toBe(
        CODIGO_ERROR.validacion,
      );
    }
    expect(cantidadDisponible(db, id)).toBe(10);
  });
});

//---------------------------------------------------------------------------
// Movimiento por venta
//---------------------------------------------------------------------------

describe('movimiento por venta', () => {
  it('descontarStock descuenta y liga el movimiento a la venta', () => {
    const db = bd();
    const id = productoConStock(db, 10);
    const op = operador(db);
    const ventaId = venta(db, { operadorId: op });

    descontarStock(db, id, 3, ventaId, op);

    expect(cantidadDisponible(db, id)).toBe(7);
    expect(
      qUno<{ tipo: string; cantidad: number; venta_id: number }>(
        db,
        'SELECT tipo, cantidad, venta_id FROM movimientos_inventario WHERE producto_id = ? ORDER BY id DESC',
        id,
      ),
    ).toEqual({ tipo: 'salida_venta', cantidad: -3, venta_id: ventaId });
  });

  it('no permite vender más de lo que hay', () => {
    const db = bd();
    const id = productoConStock(db, 10);
    const op = operador(db);
    const ventaId = venta(db, { operadorId: op });
    expect(mensajeDe(() => descontarStock(db, id, 11, ventaId, op))).toMatch(/Stock insuficiente/);
    expect(cantidadDisponible(db, id)).toBe(10);
  });

  it('el mensaje nombra el producto y cuánto queda', () => {
    const db = bd();
    const id = productoConStock(db, 10);
    const op = operador(db);
    const ventaId = venta(db, { operadorId: op });
    expect(mensajeDe(() => descontarStock(db, id, 20, ventaId, op))).toBe(
      'Stock insuficiente de "Cuaderno": quedan 10 unidad',
    );
  });

  it('no crea el movimiento si la venta no existe', () => {
    const db = bd();
    const id = productoConStock(db, 10);
    expect(codigoDe(() => descontarStock(db, id, 1, 999, operador(db)))).toBe(
      CODIGO_ERROR.validacion,
    );
    expect(cantidadDisponible(db, id)).toBe(10);
  });

  it('reponerStock devuelve la mercadería de una venta anulada', () => {
    const db = bd();
    const id = productoConStock(db, 10);
    const op = operador(db);
    const ventaId = venta(db, { operadorId: op });

    descontarStock(db, id, 3, ventaId, op);
    reponerStock(db, id, 3, ventaId, op);

    expect(cantidadDisponible(db, id)).toBe(10);
    expect(
      qUno<{ motivo: string }>(
        db,
        'SELECT motivo FROM movimientos_inventario WHERE producto_id = ? ORDER BY id DESC',
        id,
      )?.motivo,
    ).toBe('Anulación de venta');
  });

  it('dentro de una transacción, un fallo revierte el stock', () => {
    const db = bd();
    const id = productoConStock(db, 10);
    const op = operador(db);
    const ventaId = venta(db, { operadorId: op });

    expect(() =>
      transaccion(db, () => {
        descontarStock(db, id, 4, ventaId, op);
        throw new Error('no se pudo cobrar');
      }),
    ).toThrow('no se pudo cobrar');
    expect(cantidadDisponible(db, id)).toBe(10);
  });

  it('revierte los renglones ya descontados cuando falla el último', () => {
    const db = bd();
    const a = productoConStock(db, 10, { codigo: 'A', nombre: 'A' });
    const b = productoConStock(db, 1, { codigo: 'B', nombre: 'B' });
    const op = operador(db);
    const ventaId = venta(db, { operadorId: op });

    expect(() =>
      transaccion(db, () => {
        descontarStock(db, a, 2, ventaId, op);
        descontarStock(db, b, 5, ventaId, op); // no hay stock: revoca el renglón anterior
      }),
    ).toThrow(/Stock insuficiente/);

    expect(cantidadDisponible(db, a)).toBe(10);
    expect(cantidadDisponible(db, b)).toBe(1);
  });
});

//---------------------------------------------------------------------------
// Listado de stock
//---------------------------------------------------------------------------

describe('listarStock', () => {
  it('trae stock, stock mínimo y categoría de cada producto activo', () => {
    const db = bd();
    const cat = crearCategoria(db, { nombre: 'Cuadernos' });
    const id = producto(db, { categoria_id: cat, stock_minimo: 4 });
    registrarEntradaMercancia(db, { producto_id: id, cantidad: 2, costo_unitario: 400, operador_id: 1, fecha: '2026-09-01' });

    expect(listarStock(db)).toEqual([
      {
        producto_id: id,
        nombre: 'Cuaderno',
        codigo: 'P-1',
        cantidad_disponible: 2,
        stock_minimo: 4,
        unidad_medida: 'unidad',
        categoria_id: cat,
        categoria_nombre: 'Cuadernos',
      },
    ]);
  });

  it('deja la categoría en null si el producto no tiene', () => {
    const db = bd();
    producto(db);
    expect(listarStock(db)[0]?.categoria_nombre).toBeNull();
  });

  it('omite los productos desactivados', () => {
    const db = bd();
    const id = producto(db);
    eliminarProducto(db, id, 1);
    expect(listarStock(db)).toHaveLength(0);
  });
});

//---------------------------------------------------------------------------
// Usuarios
//---------------------------------------------------------------------------

describe('usuarios', () => {
  it('crea con el PIN indicado', () => {
    const db = bd();
    const id = crearUsuario(db, { nombre: 'Alex', rol: 'cajero', activo: true, pin: '4821' });
    expect(verificarPin(db, id, '4821')).toBe(true);
    expect(verificarPin(db, id, '0000')).toBe(false);
  });

  it('sin PIN usa el inicial', () => {
    const db = bd();
    const id = crearUsuario(db, { nombre: 'Bety', rol: 'cajero', activo: true });
    expect(verificarPin(db, id, '1234')).toBe(true);
  });

  it('rechaza un PIN de formato inválido', () => {
    const db = bd();
    expect(codigoDe(() => crearUsuario(db, { nombre: 'Bety', rol: 'cajero', activo: true, pin: '12' }))).toBe(
      CODIGO_ERROR.validacion,
    );
  });

  it('rechaza un rol desconocido', () => {
    const db = bd();
    expect(codigoDe(() => crearUsuario(db, { nombre: 'Bety', rol: 'jefe' as never, activo: true }))).toBe(
      CODIGO_ERROR.validacion,
    );
  });

  it('exige nombre', () => {
    const db = bd();
    expect(codigoDe(() => crearUsuario(db, { nombre: '  ', rol: 'cajero', activo: true }))).toBe(
      CODIGO_ERROR.validacion,
    );
  });

  it('un usuario desactivado no puede autenticarse', () => {
    const db = bd();
    const id = crearUsuario(db, { nombre: 'Alex', rol: 'cajero', activo: true, pin: '4821' });
    db.prepare('UPDATE usuarios SET activo = 0 WHERE id = ?').run(id);
    expect(codigoDe(() => verificarPin(db, id, '4821'))).toBe(CODIGO_ERROR.no_encontrado);
  });

  it('un usuario inexistente no puede autenticarse', () => {
    expect(codigoDe(() => verificarPin(bd(), 999, '4821'))).toBe(CODIGO_ERROR.no_encontrado);
  });

  it('el PIN se compara recortado', () => {
    const db = bd();
    const id = crearUsuario(db, { nombre: 'Alex', rol: 'cajero', activo: true, pin: '4821' });
    expect(verificarPin(db, id, ' 4821 ')).toBe(true);
  });

  it('cambiarPin exige el PIN actual y valida el nuevo', () => {
    const db = bd();
    const id = crearUsuario(db, { nombre: 'Alex', rol: 'cajero', activo: true, pin: '1234' });

    expect(mensajeDe(() => cambiarPin(db, id, '9999', '5555'))).toBe('El PIN actual no es correcto');
    // El intento fallido no dejó el PIN cambiado.
    expect(verificarPin(db, id, '1234')).toBe(true);

    expect(codigoDe(() => cambiarPin(db, id, '1234', '55'))).toBe(CODIGO_ERROR.validacion);
    expect(verificarPin(db, id, '1234')).toBe(true);

    cambiarPin(db, id, '1234', '5555');
    expect(verificarPin(db, id, '5555')).toBe(true);
    expect(verificarPin(db, id, '1234')).toBe(false);
  });

  it('lista solo los usuarios activos', () => {
    const db = bd();
    crearUsuario(db, { nombre: 'Alex', rol: 'cajero', activo: true, pin: '1111' });
    const id = crearUsuario(db, { nombre: 'Bety', rol: 'admin', activo: true, pin: '2222' });
    db.prepare('UPDATE usuarios SET activo = 0 WHERE id = ?').run(id);
    expect(listarUsuarios(db).map((u) => u.nombre)).toEqual(['Alex']);
  });
});
