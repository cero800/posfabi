// Errores de la capa de negocio.
//
// El backend original (Rust) devolvía `Result<T, String>`: o el valor, o un
// mensaje en español. En TypeScript el camino natural es lanzar, porque
// `node:sqlite` ya lanza ante cualquier fallo de SQL. `AppError` reemplaza al
// `Result` conservando lo que el backend sí tenía: un mensaje legible.
//
// La diferencia es que cada error además lleva un `codigo` estable. Así la
// interfaz puede reaccionar a "no hay stock" sin comparar cadenas en español,
// que es frágil y se rompe en cuanto se edita un texto.

export const CODIGO_ERROR = {
  /** Dato de entrada inválido (formato, rango, enum desconocido). */
  validacion: 'validacion',
  /** Se pidió algo por id y no existe. */
  no_encontrado: 'no_encontrado',
  /** Violación de una restricción UNIQUE (código, documento, código de barras). */
  duplicado: 'duplicado',
  /** La venta supera el stock disponible del producto. */
  stock_insuficiente: 'stock_insuficiente',
  /** Se intentó vender sin caja abierta. */
  caja_cerrada: 'caja_cerrada',
  /** Ya hay una caja abierta y no se puede abrir otra. */
  caja_ya_abierta: 'caja_ya_abierta',
  /** La caja a cerrar no existe o ya está cerrada. */
  caja_no_abierta: 'caja_no_abierta',
  /** El PIN no corresponde al usuario. */
  pin_incorrecto: 'pin_incorrecto',
  /** La venta ya está anulada. */
  venta_anulada: 'venta_anulada',
  /** La venta tiene pagos que impiden anularla. */
  venta_con_pagos: 'venta_con_pagos',
  /** El cliente no tiene crédito disponible suficiente. */
  limite_credito: 'limite_credito',
  /** Falló la escritura en la impresora. */
  impresora: 'impresora',
  /** No hay impresora configurada. */
  impresora_no_configurada: 'impresora_no_configurada',
  /** Fallo de sistema: disco, permisos, ruta inexistente. */
  sistema: 'sistema',
  /** La petición RPC no tiene forma válida: no es un objeto, o le falta algo. */
  peticion_invalida: 'peticion_invalida',
  /** Se pidió un procedure que no existe en el registro. */
  metodo_desconocido: 'metodo_desconocido',
} as const;

export type CodigoError = (typeof CODIGO_ERROR)[keyof typeof CODIGO_ERROR];

export interface SerializedError {
  codigo: CodigoError;
  mensaje: string;
}

export class AppError extends Error {
  readonly codigo: CodigoError;

  constructor(codigo: CodigoError, mensaje: string) {
    super(mensaje);
    this.name = 'AppError';
    this.codigo = codigo;
  }

  toJSON(): SerializedError {
    return { codigo: this.codigo, mensaje: this.message };
  }
}

// Constructores sugar para los casos más frecuentes.

export const validacion = (mensaje: string): AppError =>
  new AppError(CODIGO_ERROR.validacion, mensaje);

/**
 * Error para un id que no existe, con el nombre de lo que se buscó.
 *
 * El género es un parámetro porque "Venta no encontrado" se lee mal y este
 * mensaje lo ve el cajero en la pantalla, no solo el registro. Masculino por
 * omisión, que es lo que son casi todas las entidades del catálogo; el
 * femenino se pide explícito para que no quede un artículo mal concordado.
 */
export const noEncontrado = (entidad: string, genero: 'm' | 'f' = 'm'): AppError =>
  new AppError(
    CODIGO_ERROR.no_encontrado,
    genero === 'f' ? `${entidad} no encontrada` : `${entidad} no encontrado`,
  );

export const stockInsuficiente = (nombre: string, disponible: number, unidad?: string): AppError =>
  new AppError(
    CODIGO_ERROR.stock_insuficiente,
    `Stock insuficiente de "${nombre}": quedan ${disponible}${unidad ? ` ${unidad}` : ''}`,
  );

export const sistema = (mensaje: string): AppError =>
  new AppError(CODIGO_ERROR.sistema, mensaje);

/**
 * Error con el código que le corresponda, para los pocos sitios donde el código
 * depende de la situación y no hay una función auxiliar que lo nombre.
 */
export const conCodigo = (codigo: CodigoError, mensaje: string): AppError =>
  new AppError(codigo, mensaje);

/**
 * Fallo de escritura en la impresora.
 *
 * A diferencia de `sistema`, este dice que la computadora está bien y lo que
 * falla está al otro lado: apagada, sin conectar, con el controlador
 * equivocado. El mensaje siempre dice qué revisar, porque lo lee el cajero de
 * pie en el mostrador con un cliente esperando, y "Acceso denegado" no le dice
 * que revise el cable.
 */
export const impresora = (mensaje: string): AppError =>
  new AppError(CODIGO_ERROR.impresora, mensaje);

/** No hay ninguna impresora configurada todavía. */
export const impresoraNoConfigurada = (mensaje: string): AppError =>
  new AppError(CODIGO_ERROR.impresora_no_configurada, mensaje);

// `node:sqlite` lanza errores con este texto ante una restricción UNIQUE.
const ES_UNIQUE = /UNIQUE constraint failed/i;
// Violación de clave foránea.
const ES_FK = /FOREIGN KEY constraint failed/i;
// Restricción NOT NULL.
const ES_NOT_NULL = /NOT NULL constraint failed/i;

/**
 * Convierte cualquier excepción en un `AppError` con código y mensaje en
 * español, para que la interfaz nunca vea un error crudo de SQLite.
 */
export function normalizarError(e: unknown): AppError {
  if (e instanceof AppError) return e;

  const crudo = e instanceof Error ? e.message : String(e);

  if (ES_UNIQUE.test(crudo)) {
    return new AppError(
      CODIGO_ERROR.duplicado,
      'Ya existe un registro con ese valor (código, documento o código de barras)',
    );
  }
  if (ES_FK.test(crudo)) {
    return new AppError(
      CODIGO_ERROR.validacion,
      'La operación hace referencia a un registro que no existe',
    );
  }
  if (ES_NOT_NULL.test(crudo)) {
    return new AppError(CODIGO_ERROR.validacion, 'Faltan datos obligatorios');
  }

  return new AppError(CODIGO_ERROR.sistema, crudo || 'Error inesperado');
}
