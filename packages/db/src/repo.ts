// Acceso a datos del catálogo, inventario y usuarios.
//
// Portado de `repo.rs`. Cada función recibe la conexión explícitamente, igual
// que allí, en vez de alcanzar una global: es lo que permite que las pruebas
// usen varias bases en memoria al mismo tiempo.
//
// Las escrituras que tocan más de una tabla (producto + stock, movimiento +
// asiento, entrada de mercadería + libro) van dentro de `transaccion()`, que
// se encarga del BEGIN/COMMIT/ROLLBACK y de los savepoints anidados.

import type { DatabaseSync } from 'node:sqlite';
import type {
  AjusteInput,
  Categoria,
  CategoriaInput,
  Cliente,
  ClienteInput,
  EntradaMercanciaInput,
  MermaInput,
  PrecioCliente,
  PrecioClienteInput,
  Producto,
  ProductoInput,
  StockItem,
  TipoMovimiento,
  UnidadMedida,
  Usuario,
  UsuarioInput,
} from '@tienda/core';

import { ejecutar, qObligatorio, qTodos, qUno, transaccion } from './db.js';
import { noEncontrado, stockInsuficiente, validacion } from './errors.js';
import {
  MAX_CANTIDAD,
  normalizarClave,
  textoOpcional,
  validarCantidad,
  validarCodigo,
  validarDocumento,
  validarEnteroNoNegativo,
  validarMonto,
  validarMontoPositivo,
  validarNombre,
  validarPin,
  validarRol,
  validarUnidadMedida,
} from './validators.js';

/**
 * SQLite no tiene booleanos: guarda 1/0. Cada fila cruda se tipa con `number`
 * y se convierte al dominio al mapear, en vez de mentir en el tipo y dejar que
 * un `if (producto.activo)` haga de `1`.
 */
const bool = (v: number): boolean => v !== 0;

//---------------------------------------------------------------------------
// Categorías
//---------------------------------------------------------------------------

interface CategoriaFila {
  id: number;
  nombre: string;
  parent_id: number | null;
  orden: number;
  activo: number;
  productos: number;
}

const aCategoria = (f: CategoriaFila): Categoria => ({
  id: f.id,
  nombre: f.nombre,
  parent_id: f.parent_id,
  orden: f.orden,
  activo: bool(f.activo),
  productos: f.productos,
});

/**
 * Lista las categorías con la cantidad de productos activos de cada una, que es
 * lo que muestra el árbol del inventario y avisa antes de borrar una que
 * todavía tiene productos colgados.
 */
export function listarCategorias(db: DatabaseSync): Categoria[] {
  return qTodos<CategoriaFila>(
    db,
    `SELECT c.id, c.nombre, c.parent_id, c.orden, c.activo,
            (SELECT COUNT(*) FROM productos p
              WHERE p.categoria_id = c.id AND p.activo = 1) AS productos
       FROM categorias c
      WHERE c.activo = 1
      ORDER BY c.orden ASC, c.nombre ASC`,
  ).map(aCategoria);
}

export function crearCategoria(db: DatabaseSync, input: CategoriaInput): number {
  const nombre = validarNombre(input.nombre, 'La categoría');
  return ejecutar(
    db,
    'INSERT INTO categorias (nombre, parent_id, orden, activo) VALUES (?, ?, ?, ?)',
    nombre,
    input.parent_id ?? null,
    input.orden ?? 0,
    input.activo === false ? 0 : 1,
  ).ultimoId;
}

export function actualizarCategoria(db: DatabaseSync, id: number, input: CategoriaInput): void {
  const nombre = validarNombre(input.nombre, 'La categoría');
  if (id === input.parent_id) {
    throw validacion('Una categoría no puede ser su propia madre');
  }
  if (input.parent_id !== null && input.parent_id !== undefined) {
    existeCategoria(db, input.parent_id);
    if (esDescendiente(db, id, input.parent_id)) {
      throw validacion('No se puede mover una categoría dentro de una de sus subcategorías');
    }
  }
  ejecutar(
    db,
    'UPDATE categorias SET nombre = ?, parent_id = ?, orden = ?, activo = ? WHERE id = ?',
    nombre,
    input.parent_id ?? null,
    input.orden ?? 0,
    input.activo === false ? 0 : 1,
    id,
  );
}

/** Desactiva la categoría. Los productos quedan sin categoría, no se borran. */
export function eliminarCategoria(db: DatabaseSync, id: number): void {
  existeCategoria(db, id);
  transaccion(db, () => {
    // Los productos se descolgan a mano. El `ON DELETE SET NULL` de la clave
    // foránea solo dispara con un DELETE de verdad, y aquí se desactiva en vez
    // de borrar para conservar la historia de qué categoría tenía cada producto
    // cuando se vendió. Sin este UPDATE, los productos quedarían apuntando a
    // una categoría que ya no aparece en ningún listado: invisible y colgada.
    ejecutar(db, 'UPDATE productos SET categoria_id = NULL WHERE categoria_id = ?', id);
    ejecutar(db, 'UPDATE categorias SET activo = 0 WHERE id = ?', id);
  });
}

function existeCategoria(db: DatabaseSync, id: number): void {
  qObligatorio<{ id: number }>(db, 'Categoría', 'SELECT id FROM categorias WHERE id = ?', id);
}

/** `true` si `abajo` está dentro del subárbol de `arriba` (o es `arriba`). */
function esDescendiente(db: DatabaseSync, arriba: number, abajo: number): boolean {
  let actual: number | null = abajo;
  // El subárbol es finito, pero sin tope un ciclo grabado a mano sería un
  // bucle infinito. 32 niveles de anidación ya son de sobra para un catálogo.
  for (let nivel = 0; nivel < 32 && actual !== null; nivel += 1) {
    if (actual === arriba) return true;
    // La anotación es necesaria: sin ella, `fila` depende de `actual` y
    // `actual` del nuevo valor de `fila`, y el compilador no puede resolverlo.
    const fila: { parent_id: number | null } | null = qUno(
      db,
      'SELECT parent_id FROM categorias WHERE id = ?',
      actual,
    );
    actual = fila?.parent_id ?? null;
  }
  return false;
}

//---------------------------------------------------------------------------
// Clientes
//---------------------------------------------------------------------------

interface ClienteFila {
  id: number;
  documento: string;
  nombre: string;
  razon_social: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  dias_credito: number;
  limite_credito: number;
  es_mostrador: number;
  activo: number;
  creado_en: string | null;
}

const aCliente = (f: ClienteFila): Cliente => ({
  id: f.id,
  documento: f.documento,
  nombre: f.nombre,
  razon_social: f.razon_social,
  telefono: f.telefono,
  email: f.email,
  direccion: f.direccion,
  dias_credito: f.dias_credito,
  limite_credito: f.limite_credito,
  es_mostrador: bool(f.es_mostrador),
  activo: bool(f.activo),
  creado_en: f.creado_en,
});

const COLUMNAS_CLIENTE = `id, documento, nombre, razon_social, telefono, email, direccion,
                            dias_credito, limite_credito, es_mostrador, activo, creado_en`;

export function listarClientes(db: DatabaseSync): Cliente[] {
  return qTodos<ClienteFila>(
    db,
    `SELECT ${COLUMNAS_CLIENTE} FROM clientes WHERE activo = 1 ORDER BY nombre ASC`,
  ).map(aCliente);
}

export function obtenerCliente(db: DatabaseSync, id: number): Cliente {
  return aCliente(
    qObligatorio<ClienteFila>(db, 'Cliente', `SELECT ${COLUMNAS_CLIENTE} FROM clientes WHERE id = ?`, id),
  );
}

/** `true` si el cliente existe y está activo. Lanza si no. */
export function clienteExiste(db: DatabaseSync, id: number): void {
  qObligatorio<{ id: number }>(
    db,
    'Cliente',
    'SELECT id FROM clientes WHERE id = ? AND activo = 1',
    id,
  );
}

export function crearCliente(db: DatabaseSync, input: ClienteInput): number {
  const documento = normalizarClave(validarDocumento(input.documento));
  if (documento.length < 3) {
    throw validacion('El documento es demasiado corto');
  }
  const nombre = validarNombre(input.nombre, 'El nombre');
  validarEnteroNoNegativo(input.dias_credito, 'días de crédito');
  validarMonto(input.limite_credito, 'Límite de crédito');

  return ejecutar(
    db,
    `INSERT INTO clientes (documento, nombre, razon_social, telefono, email, direccion,
                           dias_credito, limite_credito, activo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    documento,
    nombre,
    textoOpcional(input.razon_social),
    textoOpcional(input.telefono, 40),
    textoOpcional(input.email, 120),
    textoOpcional(input.direccion),
    input.dias_credito,
    input.limite_credito,
    input.activo === false ? 0 : 1,
  ).ultimoId;
}

export function actualizarCliente(db: DatabaseSync, id: number, input: ClienteInput): void {
  clienteExiste(db, id);
  const documento = normalizarClave(validarDocumento(input.documento));
  if (documento.length < 3) {
    throw validacion('El documento es demasiado corto');
  }
  const nombre = validarNombre(input.nombre, 'El nombre');
  validarEnteroNoNegativo(input.dias_credito, 'días de crédito');
  validarMonto(input.limite_credito, 'Límite de crédito');

  ejecutar(
    db,
    `UPDATE clientes SET documento = ?, nombre = ?, razon_social = ?, telefono = ?,
                         email = ?, direccion = ?, dias_credito = ?, limite_credito = ?, activo = ?
      WHERE id = ?`,
    documento,
    nombre,
    textoOpcional(input.razon_social),
    textoOpcional(input.telefono, 40),
    textoOpcional(input.email, 120),
    textoOpcional(input.direccion),
    input.dias_credito,
    input.limite_credito,
    input.activo === false ? 0 : 1,
    id,
  );
}

/**
 * Desactiva el cliente. Nunca se borra: sus ventas, pagos y abonos lo
 * referencian para siempre y un borrado rompería el estado de cuenta histórico.
 */
export function eliminarCliente(db: DatabaseSync, id: number): void {
  clienteExiste(db, id);
  ejecutar(db, 'UPDATE clientes SET activo = 0 WHERE id = ?', id);
}

//---------------------------------------------------------------------------
// Productos
//---------------------------------------------------------------------------

interface ProductoFila {
  id: number;
  codigo: string;
  codigo_barras: string | null;
  nombre: string;
  descripcion: string | null;
  categoria_id: number | null;
  unidad_medida: string;
  precio_base: number;
  impuesto_porcentaje: number;
  stock_minimo: number;
  activo: number;
  creado_en: string | null;
}

const aProducto = (f: ProductoFila): Producto => ({
  id: f.id,
  codigo: f.codigo,
  codigo_barras: f.codigo_barras,
  nombre: f.nombre,
  descripcion: f.descripcion,
  categoria_id: f.categoria_id,
  // narrow: la columna se validó al escribir y el dominio la comprueba aquí.
  unidad_medida: f.unidad_medida as Producto['unidad_medida'],
  precio_base: f.precio_base,
  impuesto_porcentaje: f.impuesto_porcentaje,
  stock_minimo: f.stock_minimo,
  activo: bool(f.activo),
  creado_en: f.creado_en,
});

const COLUMNAS_PRODUCTO = `id, codigo, codigo_barras, nombre, descripcion, categoria_id,
                            unidad_medida, precio_base, impuesto_porcentaje, stock_minimo,
                            activo, creado_en`;

export function listarProductos(db: DatabaseSync): Producto[] {
  return qTodos<ProductoFila>(
    db,
    `SELECT ${COLUMNAS_PRODUCTO} FROM productos WHERE activo = 1 ORDER BY nombre ASC`,
  ).map(aProducto);
}

export function obtenerProducto(db: DatabaseSync, id: number): Producto {
  return aProducto(
    qObligatorio<ProductoFila>(
      db,
      'Producto',
      `SELECT ${COLUMNAS_PRODUCTO} FROM productos WHERE id = ? AND activo = 1`,
      id,
    ),
  );
}

export function crearProducto(db: DatabaseSync, input: ProductoInput): number {
  const codigo = normalizarClave(validarCodigo(input.codigo));
  const nombre = validarNombre(input.nombre, 'El nombre del producto');
  validarMontoPositivo(input.precio_base, 'Precio unitario');
  validarUnidadMedida(input.unidad_medida);
  validarImpuesto(input.impuesto_porcentaje);
  validarStockMinimo(input.stock_minimo);

  return transaccion(db, () => {
    const id = ejecutar(
      db,
      `INSERT INTO productos (codigo, codigo_barras, nombre, descripcion, categoria_id,
                              unidad_medida, precio_base, impuesto_porcentaje, stock_minimo, activo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      codigo,
      textoOpcional(input.codigo_barras, 32),
      nombre,
      textoOpcional(input.descripcion),
      input.categoria_id ?? null,
      input.unidad_medida,
      input.precio_base,
      input.impuesto_porcentaje ?? 0,
      input.stock_minimo ?? 0,
      input.activo === false ? 0 : 1,
    ).ultimoId;

    // Todo producto nuevo arranca sin stock. La fila se crea ya para que las
    // lecturas de inventario no tengan que distinguir "sin fila" de "en cero".
    ejecutar(
      db,
      'INSERT INTO stock (producto_id, cantidad_disponible) VALUES (?, 0)',
      id,
    );
    return id;
  });
}

export function actualizarProducto(db: DatabaseSync, id: number, input: ProductoInput): void {
  obtenerProducto(db, id);
  const codigo = normalizarClave(validarCodigo(input.codigo));
  const nombre = validarNombre(input.nombre, 'El nombre del producto');
  validarMontoPositivo(input.precio_base, 'Precio unitario');
  validarUnidadMedida(input.unidad_medida);
  validarImpuesto(input.impuesto_porcentaje);
  validarStockMinimo(input.stock_minimo);

  ejecutar(
    db,
    `UPDATE productos SET codigo = ?, codigo_barras = ?, nombre = ?, descripcion = ?,
                          categoria_id = ?, unidad_medida = ?, precio_base = ?,
                          impuesto_porcentaje = ?, stock_minimo = ?, activo = ?
      WHERE id = ?`,
    codigo,
    textoOpcional(input.codigo_barras, 32),
    nombre,
    textoOpcional(input.descripcion),
    input.categoria_id ?? null,
    input.unidad_medida,
    input.precio_base,
    input.impuesto_porcentaje ?? 0,
    input.stock_minimo ?? 0,
    input.activo === false ? 0 : 1,
    id,
  );
}

/**
 * Desactiva el producto. No se borra porque el historial de ventas y de
 * movimientos lo referencia; además `eliminarProducto` repone el stock, que en
 * el original no se hacía y dejaba mercadería fantasma en el inventario.
 *
 * `operadorId` admite `null` porque el wrapper de la interfaz todavía no manda
 * quién dio de baja el producto. Se escribe `NULL` y no un id inventado: en una
 * tabla de auditoría, un `operador_id = 0` que nadie puede consultar es peor que
 * un hueco, porque parece un dato y no lo es.
 */
export function eliminarProducto(
  db: DatabaseSync,
  id: number,
  operadorId: number | null = null,
): void {
  obtenerProducto(db, id);
  transaccion(db, () => {
    ejecutar(db, 'UPDATE productos SET activo = 0 WHERE id = ?', id);
    ejecutar(db, 'UPDATE stock SET cantidad_disponible = 0 WHERE producto_id = ?', id);
    ejecutar(
      db,
      `INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo, venta_id, operador_id)
       VALUES (?, 'ajuste', 0, 'Producto dado de baja', NULL, ?)`,
      id,
      operadorId,
    );
  });
}

function validarImpuesto(porcentaje: number | undefined): void {
  const p = porcentaje ?? 0;
  if (!Number.isFinite(p) || p < 0 || p > 100) {
    throw validacion('El impuesto debe estar entre 0 y 100');
  }
}

function validarStockMinimo(stockMinimo: number | undefined): void {
  const s = stockMinimo ?? 0;
  if (!Number.isFinite(s) || s < 0) {
    throw validacion('El stock mínimo no puede ser negativo');
  }
  if (s > MAX_CANTIDAD) {
    throw validacion('El stock mínimo excede el máximo permitido');
  }
}

export function obtenerUnidad(db: DatabaseSync, productoId: number): UnidadMedida {
  const fila = qUno<{ unidad_medida: string }>(
    db,
    'SELECT unidad_medida FROM productos WHERE id = ? AND activo = 1',
    productoId,
  );
  if (fila === null) throw noEncontrado('Producto');
  validarUnidadMedida(fila.unidad_medida);
  return fila.unidad_medida;
}

export interface PrecioEfectivo {
  precio: number;
  impuestoPorcentaje: number;
  unidad: UnidadMedida;
}

/**
 * Resuelve el precio de venta de un producto para un cliente: el precio
 * especial pactado si existe, si no el precio base. Devuelve también la unidad
 * de medida, porque de ella depende si la cantidad admite fracciones, y el
 * porcentaje de impuesto para que el cálculo del total no tenga que releer el
 * producto por cada línea del carrito.
 */
export function precioEfectivo(
  db: DatabaseSync,
  productoId: number,
  clienteId: number,
): PrecioEfectivo {
  const fila = qUno<{ unidad_medida: string; precio: number; impuesto_porcentaje: number }>(
    db,
    `SELECT p.unidad_medida,
            COALESCE(pc.precio_especial, p.precio_base) AS precio,
            p.impuesto_porcentaje
       FROM productos p
       LEFT JOIN precios_cliente pc
         ON pc.producto_id = p.id AND pc.cliente_id = ?2
      WHERE p.id = ?1 AND p.activo = 1`,
    productoId,
    clienteId,
  );
  if (fila === null) throw noEncontrado('Producto');
  validarUnidadMedida(fila.unidad_medida);
  return {
    precio: fila.precio,
    impuestoPorcentaje: fila.impuesto_porcentaje,
    unidad: fila.unidad_medida,
  };
}

//---------------------------------------------------------------------------
// Precios especiales por cliente
//---------------------------------------------------------------------------

export function listarPreciosCliente(db: DatabaseSync, clienteId: number): PrecioCliente[] {
  return qTodos<PrecioCliente>(
    db,
    `SELECT id, cliente_id, producto_id, precio_especial
       FROM precios_cliente WHERE cliente_id = ?`,
    clienteId,
  );
}

export function setPrecioCliente(db: DatabaseSync, input: PrecioClienteInput): void {
  validarMontoPositivo(input.precio_especial, 'Precio especial');
  ejecutar(
    db,
    `INSERT INTO precios_cliente (cliente_id, producto_id, precio_especial)
     VALUES (?, ?, ?)
     ON CONFLICT(cliente_id, producto_id)
     DO UPDATE SET precio_especial = excluded.precio_especial,
                   actualizado_en = CURRENT_TIMESTAMP`,
    input.cliente_id,
    input.producto_id,
    input.precio_especial,
  );
}

/** Quita el precio especial: el producto vuelve a su precio base. */
export function eliminarPrecioCliente(db: DatabaseSync, clienteId: number, productoId: number): void {
  ejecutar(
    db,
    'DELETE FROM precios_cliente WHERE cliente_id = ? AND producto_id = ?',
    clienteId,
    productoId,
  );
}

//---------------------------------------------------------------------------
// Inventario
//---------------------------------------------------------------------------

interface StockFila {
  producto_id: number;
  nombre: string;
  codigo: string;
  cantidad_disponible: number;
  stock_minimo: number;
  unidad_medida: string;
  categoria_id: number | null;
  categoria_nombre: string | null;
}

export function listarStock(db: DatabaseSync): StockItem[] {
  return qTodos<StockFila>(
    db,
    `SELECT s.producto_id, p.nombre, p.codigo, s.cantidad_disponible, p.stock_minimo,
            p.unidad_medida, p.categoria_id, c.nombre AS categoria_nombre
       FROM stock s
       JOIN productos p ON p.id = s.producto_id
       LEFT JOIN categorias c ON c.id = p.categoria_id
      WHERE p.activo = 1
      ORDER BY p.nombre ASC`,
  ).map((f) => ({
    producto_id: f.producto_id,
    nombre: f.nombre,
    codigo: f.codigo,
    cantidad_disponible: f.cantidad_disponible,
    stock_minimo: f.stock_minimo,
    unidad_medida: f.unidad_medida as StockItem['unidad_medida'],
    categoria_id: f.categoria_id,
    categoria_nombre: f.categoria_nombre,
  }));
}

export function cantidadDisponible(db: DatabaseSync, productoId: number): number {
  return (
    qUno<{ cantidad_disponible: number }>(
      db,
      'SELECT cantidad_disponible FROM stock WHERE producto_id = ?',
      productoId,
    )?.cantidad_disponible ?? 0
  );
}

interface Movimiento {
  producto_id: number;
  tipo: TipoMovimiento;
  cantidad: number;
  motivo: string | null;
  venta_id: number | null;
  operador_id: number | null;
  fecha: string | null;
}

/**
 * Aplica un movimiento al stock y lo asienta en el libro.
 *
 * `cantidad` es siempre positiva; el signo lo determina el tipo. Actualizar el
 * stock y registrar el movimiento van juntos porque si uno de los dos fallara
 * el inventario y su historia dirían cosas distintas, que es el peor estado
 * posible: nadie puede explicar después un descuadre.
 *
 * Lanza si el stock quedaría negativo, para que el llamador revierta toda la
 * operación (por ejemplo, los renglones ya insertados de una venta).
 */
export function aplicarMovimiento(
  db: DatabaseSync,
  m: Movimiento,
  /** Movimiento de salida: la cantidad se resta. El resto, se suma. */
  resta: boolean,
): void {
  // La transacción va aquí y no en el llamador porque las dos escrituras
  // tienen que ser atómicas entre sí. Sin ella, un fallo al asentar el
  // movimiento (una venta que no existe, por ejemplo) dejaba el stock ya
  // descontado sin ningún asiento que lo explique, que es un descuadre que
  // nadie sabe explicar después.
  transaccion(db, () => {
    const unidad = obtenerUnidad(db, m.producto_id);
    validarCantidad(m.cantidad, unidad);
    const delta = resta ? -m.cantidad : m.cantidad;

    asegurarFilaStock(db, m.producto_id);
    const actual = cantidadDisponible(db, m.producto_id);
    const nueva = actual + delta;
    if (nueva < 0) {
      throw stockInsuficiente(nombreProducto(db, m.producto_id), actual, unidad);
    }

    ejecutar(
      db,
      'UPDATE stock SET cantidad_disponible = ? WHERE producto_id = ?',
      nueva,
      m.producto_id,
    );
    ejecutar(
      db,
      `INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo, venta_id, operador_id, fecha)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      m.producto_id,
      m.tipo,
      delta,
      m.motivo,
      m.venta_id,
      m.operador_id,
      m.fecha,
    );
  });
}

function nombreProducto(db: DatabaseSync, productoId: number): string {
  return (
    qUno<{ nombre: string }>(db, 'SELECT nombre FROM productos WHERE id = ?', productoId)?.nombre ??
    `#${productoId}`
  );
}

function asegurarFilaStock(db: DatabaseSync, productoId: number): void {
  const existe = qUno<{ producto_id: number }>(
    db,
    'SELECT producto_id FROM stock WHERE producto_id = ?',
    productoId,
  );
  if (existe === null) {
    ejecutar(
      db,
      'INSERT INTO stock (producto_id, cantidad_disponible) VALUES (?, 0)',
      productoId,
    );
  }
}

/**
 * Recepción de mercadería del proveedor: suma al stock y deja traza de quién
 * lo envió y con qué factura, para poder reclamar o cambiar mercadería.
 */
export function registrarEntradaMercancia(db: DatabaseSync, input: EntradaMercanciaInput): number {
  validarMonto(input.costo_unitario, 'Costo unitario');
  return transaccion(db, () => {
    aplicarMovimiento(
      db,
      {
        producto_id: input.producto_id,
        tipo: 'entrada_mercancia',
        cantidad: input.cantidad,
        motivo: 'Recepción de mercadería',
        venta_id: null,
        operador_id: input.operador_id,
        fecha: input.fecha,
      },
      false,
    );
    return ejecutar(
      db,
      `INSERT INTO entradas_mercancia (fecha, producto_id, cantidad, costo_unitario,
                                       proveedor, documento_ref, operador_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      input.fecha,
      input.producto_id,
      input.cantidad,
      input.costo_unitario,
      textoOpcional(input.proveedor, 120),
      textoOpcional(input.documento_ref, 60),
      input.operador_id,
    ).ultimoId;
  });
}

/** Merma: mercadería que se pierde o se daña. El motivo es obligatorio. */
export function registrarMerma(db: DatabaseSync, input: MermaInput): void {
  const motivo = textoOpcional(input.motivo);
  if (motivo === null) {
    throw validacion('La merma requiere un motivo');
  }
  transaccion(db, () => {
    aplicarMovimiento(
      db,
      {
        producto_id: input.producto_id,
        tipo: 'merma',
        cantidad: input.cantidad,
        motivo,
        venta_id: null,
        operador_id: input.operador_id,
        fecha: null,
      },
      true,
    );
  });
}

/**
 * Ajuste por conteo físico. Acepta delta con signo: positivo suma, negativo
 * resta. Nunca deja el stock por debajo de cero.
 */
export function registrarAjuste(db: DatabaseSync, input: AjusteInput): void {
  const motivo = textoOpcional(input.motivo);
  if (motivo === null) {
    throw validacion('El ajuste requiere un motivo');
  }
  if (input.cantidad_delta === 0) {
    throw validacion('El ajuste no puede ser cero');
  }
  if (!Number.isFinite(input.cantidad_delta) || Math.abs(input.cantidad_delta) > MAX_CANTIDAD) {
    throw validacion('El ajuste está fuera de rango');
  }
  transaccion(db, () => {
    // Un ajuste va con el signo que dio el conteo, así que se asienta tal cual:
    // no se pasa por `aplicarMovimiento`, que invierte según el tipo.
    const unidad = obtenerUnidad(db, input.producto_id);
    validarCantidad(Math.abs(input.cantidad_delta), unidad);

    asegurarFilaStock(db, input.producto_id);
    const nueva = cantidadDisponible(db, input.producto_id) + input.cantidad_delta;
    if (nueva < 0) {
      throw validacion('El ajuste dejaría el stock en negativo');
    }
    ejecutar(
      db,
      'UPDATE stock SET cantidad_disponible = ? WHERE producto_id = ?',
      nueva,
      input.producto_id,
    );
    ejecutar(
      db,
      `INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, motivo, venta_id, operador_id)
       VALUES (?, 'ajuste', ?, ?, NULL, ?)`,
      input.producto_id,
      input.cantidad_delta,
      motivo,
      input.operador_id,
    );
  });
}

/** Descuenta stock por una venta. Se llama dentro de la transacción de venta. */
export function descontarStock(
  db: DatabaseSync,
  productoId: number,
  cantidad: number,
  ventaId: number,
  operadorId: number,
): void {
  aplicarMovimiento(
    db,
    {
      producto_id: productoId,
      tipo: 'salida_venta',
      cantidad,
      motivo: 'Venta',
      venta_id: ventaId,
      operador_id: operadorId,
      fecha: null,
    },
    true,
  );
}

/** Repone el stock de una venta anulada. */
export function reponerStock(
  db: DatabaseSync,
  productoId: number,
  cantidad: number,
  ventaId: number,
  operadorId: number,
): void {
  aplicarMovimiento(
    db,
    {
      producto_id: productoId,
      tipo: 'ajuste',
      cantidad,
      motivo: 'Anulación de venta',
      venta_id: ventaId,
      operador_id: operadorId,
      fecha: null,
    },
    false,
  );
}

//---------------------------------------------------------------------------
// Usuarios
//---------------------------------------------------------------------------

interface UsuarioFila {
  id: number;
  nombre: string;
  rol: string;
  activo: number;
}

const aUsuario = (f: UsuarioFila): Usuario => ({
  id: f.id,
  nombre: f.nombre,
  rol: f.rol as Usuario['rol'],
  activo: bool(f.activo),
});

export function listarUsuarios(db: DatabaseSync): Usuario[] {
  return qTodos<UsuarioFila>(
    db,
    'SELECT id, nombre, rol, activo FROM usuarios WHERE activo = 1 ORDER BY nombre',
  ).map(aUsuario);
}

export function crearUsuario(db: DatabaseSync, input: UsuarioInput): number {
  const nombre = validarNombre(input.nombre, 'El nombre del usuario');
  validarRol(input.rol);
  // Sin PIN explícito se asigna el inicial, igual que el administrador semilla.
  const pin = input.pin && input.pin.trim() !== '' ? input.pin : '1234';
  validarPin(pin);

  return ejecutar(
    db,
    'INSERT INTO usuarios (nombre, rol, activo, pin) VALUES (?, ?, ?, ?)',
    nombre,
    input.rol,
    input.activo === false ? 0 : 1,
    pin.trim(),
  ).ultimoId;
}

/**
 * Comprueba el PIN de un usuario activo. Devuelve `false` en vez de fallar
 * cuando el PIN no coincide, porque "ese PIN no es" es un resultado normal del
 * login; sí falla si el usuario no existe o está desactivado.
 */
export function verificarPin(db: DatabaseSync, usuarioId: number, pin: string): boolean {
  const fila = qUno<{ pin: string | null }>(
    db,
    'SELECT pin FROM usuarios WHERE id = ? AND activo = 1',
    usuarioId,
  );
  if (fila === null) throw noEncontrado('Usuario');
  return (fila.pin ?? '').trim() === pin.trim();
}

export function cambiarPin(db: DatabaseSync, usuarioId: number, pinActual: string, pinNuevo: string): void {
  validarPin(pinNuevo);
  if (!verificarPin(db, usuarioId, pinActual)) {
    throw validacion('El PIN actual no es correcto');
  }
  ejecutar(
    db,
    'UPDATE usuarios SET pin = ? WHERE id = ?',
    pinNuevo.trim(),
    usuarioId,
  );
}

/**
 * Primer arranque: deja un administrador activo con el nombre y PIN elegidos.
 * Si ya hay un admin sin PIN (base dejada a medias), lo repara en vez de crear
 * un segundo administrador con permisos de fábrica.
 */
export function configurarAdmin(db: DatabaseSync, nombre: string, pin: string): void {
  const n = validarNombre(nombre, 'El nombre del administrador');
  validarPin(pin);

  const actualizados = ejecutar(
    db,
    `UPDATE usuarios SET nombre = ?, pin = ?, activo = 1 WHERE rol = 'admin'`,
    n,
    pin.trim(),
  ).cambios;

  if (actualizados === 0) {
    ejecutar(
      db,
      "INSERT INTO usuarios (nombre, rol, activo, pin) VALUES (?, 'admin', 1, ?)",
      n,
      pin.trim(),
    );
  }
}
