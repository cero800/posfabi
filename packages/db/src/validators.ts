// Validaciones centralizadas del dominio.
//
// Portado directo de `validators.rs`. Igual que allí, un error de validación
// nunca debe llegar a la base de datos: se comprueba antes de escribir.
//
// Diferencia con Rust: allí los validadores recibían `&str` y la comparación era
// un `match`. Aquí el tipo declarado del parámetro es `string` y, en los
// enumerados cerrados, la función devuelve una aserción de tipo (`asserts`).
// Eso hace que el valor narrowéado sea reutilizable sin repetir el `as`, que es
// donde suelen colarse los casteos sueltos.
//
// Sigue siendo validación en tiempo de ejecución, no una comprobación de
// compilación: los valores vienen por JSON-RPC desde el webview y no son de
// fiar. El tipo solo documenta lo que el validador garantiza.

import {
  MONEDAS,
  UNIDADES_MEDIDA,
  type Moneda,
  type Rol,
  type TipoPago,
  type TipoVenta,
  type UnidadMedida,
} from '@tienda/core';

import { validacion } from './errors.js';
import { MAX_CANTIDAD, MAX_MONTO, cent } from './money.js';

export { MAX_CANTIDAD, MAX_MONTO };

/** Longitudes máximas de los textos del catálogo. */
export const MAX_NOMBRE = 120;
export const MAX_DOCUMENTO = 32;
export const MAX_CODIGO = 32;
export const MAX_TEXTO = 500;

//---------------------------------------------------------------------------
// Montos
//---------------------------------------------------------------------------

/**
 * Monto no negativo (precio, subtotal, total, pago).
 *
 * Además del rango, verifica que sea un entero representable sin pérdida: en
 * Rust el tipo `i64` lo garantizaba solo y aquí hay que comprobarlo.
 */
export function validarMonto(monto: number, campo: string): void {
  if (monto < 0) {
    throw validacion(`${campo} no puede ser negativo`);
  }
  if (monto > MAX_MONTO) {
    throw validacion(`${campo} excede el máximo permitido`);
  }
  cent(monto, campo);
}

/** Monto estrictamente positivo: un precio de venta nunca es 0 ni negativo. */
export function validarMontoPositivo(monto: number, campo: string): void {
  if (monto <= 0) {
    throw validacion(`${campo} debe ser mayor que 0`);
  }
  validarMonto(monto, campo);
}

/**
 * Descuento entre 0 y el subtotal, para que el total nunca quede negativo.
 * El cálculo es el que puede romper: sin este tope, un descuento mayor que el
 * subtotal dejaría `total` negativo y el arqueo de caja descuadraría.
 */
export function validarDescuento(descuento: number, subtotal: number): void {
  validarMonto(descuento, 'Descuento');
  if (descuento > subtotal) {
    throw validacion('El descuento no puede superar el subtotal');
  }
}

//---------------------------------------------------------------------------
// Cantidades
//---------------------------------------------------------------------------

/**
 * Cantidad vendible o almacenable. Puede ser fraccionaria porque hay productos
 * al kilo, al metro y a la libra, pero un producto en `unidad` es entero.
 */
export function validarCantidad(cantidad: number, unidad: string): void {
  if (!Number.isFinite(cantidad)) {
    throw validacion('Cantidad no válida');
  }
  if (cantidad <= 0) {
    throw validacion('La cantidad debe ser mayor que 0');
  }
  if (cantidad > MAX_CANTIDAD) {
    throw validacion('La cantidad excede el máximo permitido');
  }
  if (unidad === 'unidad' && !Number.isInteger(cantidad)) {
    throw validacion("En 'unidad' la cantidad debe ser un número entero");
  }
}

/**
 * Cantidad de un detalle de venta. Aparte de las reglas generales, dice
 * explícitamente que no se venden fracciones de un producto por unidad, que es
 * el error más fácil de cometer en la pantalla de venta.
 */
export function validarCantidadVenta(cantidad: number, unidad: string): void {
  if (unidad === 'unidad' && !Number.isInteger(cantidad)) {
    throw validacion("No se pueden vender fracciones de un producto en 'unidad'");
  }
  validarCantidad(cantidad, 'Cantidad');
}

/**
 * Contador entero igual o mayor que cero: los días de crédito de un cliente, el
 * orden de una categoría.
 *
 * Existe aparte de `validarMonto` porque un monto son céntimos y un contador no,
 * y el mensaje tiene que decirlo: si a alguien le sale "debe ser un número
 * entero de céntimos" al escribir los días de crédito de un cliente, va a
 * seguir buscando qué céntimos se le olvidaron.
 *
 * También atrapa el `undefined`, que es el caso que justifica la función: un
 * `campo < 0` no falla con `undefined` —la comparación es `false`— así que un
 * campo obligatorio que llegue sin valor llega hasta el `INSERT` y SQLite
 * responde con un texto sobre parámetros que no le dice nada a quien lo escribió.
 */
export function validarEnteroNoNegativo(valor: number, campo: string): void {
  if (typeof valor !== 'number' || !Number.isInteger(valor)) {
    // El nombre va entre comillas y en singular a propósito: el mensaje lo lee
    // quien está rellenando un formulario, y "El campo «días de crédito» debe
    // ser…" concuerda siempre, mientras que "Los días de crédito debe ser…"
    // suena a hueco.
    throw validacion(`El campo «${campo}» debe ser un número entero`);
  }
  if (valor < 0) {
    throw validacion(`El campo «${campo}» no puede ser negativo`);
  }
  if (valor > MAX_CANTIDAD) {
    throw validacion(`El campo «${campo}» excede el máximo permitido`);
  }
}

//---------------------------------------------------------------------------
// Enumerados cerrados
//---------------------------------------------------------------------------

const TIPOS_PAGO: readonly TipoPago[] = ['efectivo', 'pago_movil', 'punto', 'biopago'];
const TIPOS_VENTA: readonly TipoVenta[] = ['contado', 'credito'];
const ROLES: readonly Rol[] = ['admin', 'cajero'];

export function validarTipoPago(t: string): asserts t is TipoPago {
  if (!(TIPOS_PAGO as readonly string[]).includes(t)) {
    throw validacion(`Tipo de pago inválido: ${t}`);
  }
}

export function validarTipoVenta(t: string): asserts t is TipoVenta {
  if (!(TIPOS_VENTA as readonly string[]).includes(t)) {
    throw validacion(`Tipo de venta inválida: ${t}`);
  }
}

export function validarMoneda(m: string): asserts m is Moneda {
  if (!(MONEDAS as readonly string[]).includes(m)) {
    throw validacion(`Moneda inválida: ${m}`);
  }
}

export function validarRol(r: string): asserts r is Rol {
  if (!(ROLES as readonly string[]).includes(r)) {
    throw validacion(`Rol inválido: ${r}`);
  }
}

/**
 * Unidad de medida válida. La lista sale de `@tienda/core` y no de una copia
 * local: si se agrega una unidad al desplegable de la interfaz, queda válida
 * aquí sin que nadie tenga que acordarse de actualizar este archivo.
 */
export function validarUnidadMedida(u: string): asserts u is UnidadMedida {
  if (!(UNIDADES_MEDIDA as readonly string[]).includes(u)) {
    throw validacion(`Unidad de medida inválida: ${u}`);
  }
}

//---------------------------------------------------------------------------
// Reglas de pago
//---------------------------------------------------------------------------

/**
 * Regla de negocio entre tipo de pago y moneda:
 *
 * - En US$ solo puede pagarse en efectivo. Las vías electrónicas (punto,
 *   biopago, pago móvil) cobran en bolívares: el punto de venta y el biopago
 *   no tienen forma de recibir dólares, y un pago móvil en US$ significaría
 *   que el cajero cambió los billetes por bolívares al recibir, lo que
 *   descuadra la caja sin que nadie lo note.
 * - Solo el pago móvil exige número de referencia. Punto de venta y biopago
 *   generan su propio comprobante interno y no dejan un número que anotar.
 */
export function validarCombinacionPago(
  tipo: string,
  moneda: string,
  numeroReferencia: string | null | undefined,
): void {
  validarTipoPago(tipo);
  validarMoneda(moneda);

  if (moneda === 'usd' && tipo !== 'efectivo') {
    throw validacion('En US$ el pago debe ser en efectivo (divisas)');
  }
  if (tipo === 'pago_movil' && (numeroReferencia === undefined || numeroReferencia === null || numeroReferencia.trim() === '')) {
    throw validacion('El pago móvil requiere el número de referencia');
  }
}

/** PIN de 4 dígitos. */
export function validarPin(pin: string): void {
  const p = pin.trim();
  if (p.length !== 4 || !/^\d{4}$/.test(p)) {
    throw validacion('El PIN debe tener exactamente 4 dígitos');
  }
}

//---------------------------------------------------------------------------
// Textos
//---------------------------------------------------------------------------

/**
 * Normaliza la clave única (código de producto, documento) para que dos
 * registros que solo difieren en espacios o mayúsculas colisionen en la
 * restricción UNIQUE en vez de pasar los dos y duplicar el catálogo.
 *
 * Sin esto, "P-001" y "p 001" serían dos productos distintos, y el cajero
 * terminaría sin encontrar uno de los dos al buscar.
 */
export function normalizarClave(s: string): string {
  return s
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .join('');
}

/** Documento de cliente (cédula, RIF o NIT): obligatorio y acotado. */
export function validarDocumento(documento: string): string {
  const d = documento.trim();
  if (d === '') {
    throw validacion('El documento es obligatorio');
  }
  if (d.length > MAX_DOCUMENTO) {
    throw validacion(`El documento no puede superar ${MAX_DOCUMENTO} caracteres`);
  }
  return d;
}

/** Código de producto: obligatorio y acotado. */
export function validarCodigo(codigo: string): string {
  const c = codigo.trim();
  if (c === '') {
    throw validacion('El código es obligatorio');
  }
  if (c.length > MAX_CODIGO) {
    throw validacion(`El código no puede superar ${MAX_CODIGO} caracteres`);
  }
  return c;
}

/** Nombre de cliente, producto o categoría: obligatorio y acotado. */
export function validarNombre(nombre: string, campo = 'El nombre'): string {
  const n = nombre.trim();
  if (n === '') {
    throw validacion(`${campo} es obligatorio`);
  }
  if (n.length > MAX_NOMBRE) {
    throw validacion(`${campo} no puede superar ${MAX_NOMBRE} caracteres`);
  }
  return n;
}

/**
 * Texto opcional (motivo, dirección, teléfono). Recorta y convierte vacío en
 * `null`, para que en la base no queden cadenas vacías indistinguibles de un
 * valor real.
 */
export function textoOpcional(valor: string | null | undefined, max = MAX_TEXTO): string | null {
  if (valor === null || valor === undefined) return null;
  const v = valor.trim();
  if (v === '') return null;
  if (v.length > max) {
    throw validacion(`El texto no puede superar ${max} caracteres`);
  }
  return v;
}
