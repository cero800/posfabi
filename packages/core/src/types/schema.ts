// Tipos compartidos — fuente única de verdad del dominio. Deben coincidir con el
// esquema SQLite en `packages/db/src/schema.sql`.
//
// Todos los MONTOS están en CENTAVOS de su moneda (enteros). Puede ser en US$
// (moneda base) o en Bs. La conversión usa `tasa_cambio` (Bs por 1 US$) congelada
// como snapshot por venta, pago y cierre de caja, de modo que cambiar la tasa
// después no altera lo ya cobrado.

export type Moneda = 'usd' | 'ves';

export const MONEDAS: readonly Moneda[] = ['usd', 'ves'];

export const MONEDA_LABELS: Record<Moneda, string> = {
  usd: 'US$',
  ves: 'Bs',
};

// Tipos de venta, pago y operación (enumerados cerrados, validados en el backend).
export type TipoVenta = 'contado' | 'credito';
export type TipoPago = 'efectivo' | 'pago_movil' | 'punto' | 'biopago';
export type Rol = 'admin' | 'cajero';
export type EstadoCaja = 'abierta' | 'revisada' | 'cerrada';
export type EstadoVenta = 'entregada' | 'anulada';

export type UnidadMedida =
  | 'unidad'
  | 'caja'
  | 'paquete'
  | 'metro'
  | 'kg'
  | 'libra'
  | 'blister';

export const UNIDADES_MEDIDA: readonly UnidadMedida[] = [
  'unidad',
  'caja',
  'paquete',
  'metro',
  'kg',
  'libra',
  'blister',
];

export const UNIDAD_MEDIDA_LABELS: Record<UnidadMedida, string> = {
  unidad: 'Unidad',
  caja: 'Caja',
  paquete: 'Paquete',
  metro: 'Metro',
  kg: 'Kilogramo',
  libra: 'Libra',
  blister: 'Blíster',
};

/** Tipos de movimiento de inventario. La cantidad va firmada: entrada (+), salida (−). */
export type TipoMovimiento =
  | 'entrada_mercancia'
  | 'salida_venta'
  | 'merma'
  | 'ajuste'
  | 'devolucion';

// Etiquetas visibles de los tipos de pago.
export const TIPO_PAGO_LABELS: Record<TipoPago, string> = {
  efectivo: 'Efectivo',
  pago_movil: 'Pago móvil',
  punto: 'Punto de venta',
  biopago: 'Biopago',
};

export const TIPO_VENTA_LABELS: Record<TipoVenta, string> = {
  contado: 'Contado',
  credito: 'Crédito',
};

// Claves de configuración de los datos del negocio que encabezan las facturas.
export const NEGOCIO_CONFIG_KEYS = {
  nombre: 'negocio_nombre',
  rif: 'negocio_rif',
  telefono: 'negocio_telefono',
  direccion: 'negocio_direccion',
} as const;

/**
 * Los cuatro datos del negocio, juntos.
 *
 * Vive aquí y no en el backend porque la interfaz los necesita igual que él: el
 * encabezado de la barra lateral y el del `.xlsx` del reporte llevan el nombre
 * del negocio, y la página de configuración los edita. Con el tipo en el
 * backend, el frontend tendría que duplicarlo o importar el paquete entero.
 */
export interface DatosNegocio {
  nombre: string;
  rif: string;
  telefono: string;
  direccion: string;
}

/** Clave de `config` donde se guarda el destino de impresión (JSON, ver `DestinoImpresora`). */
export const IMPRESORA_TERMICA_KEY = 'impresora_termica';

// Cuántos días antes del vencimiento se imprime el recordatorio de pago en una
// factura a crédito (se configura en la página de Configuración).
export const RECORDATORIO_PAGO_DIAS_KEY = 'recordatorio_pago_dias';

//---------------------------------------------------------------------------
// Catálogo
//---------------------------------------------------------------------------

/** Categoría de productos. `parent_id` permite anidar (papelería > útiles > cuadernos). */
export interface Categoria {
  id: number;
  nombre: string;
  parent_id: number | null;
  orden: number;
  activo: boolean;
  /** Cantidad de productos activos de esta categoría (solo en lecturas). */
  productos?: number;
  /** Categorías hijas (solo en lecturas). */
  hijas?: Categoria[];
}

export interface CategoriaInput {
  nombre: string;
  parent_id?: number | null;
  orden?: number;
  activo?: boolean;
}

/**
 * Cliente del negocio. Un cliente puede ser una persona (mostrador) o una
 * empresa con crédito. Las ventas de mostrador usan el cliente semilla
 * "Mostrador", que no tiene plazo de crédito.
 */
export interface Cliente {
  id: number;
  documento: string;
  nombre: string;
  razon_social: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  dias_credito: number;
  limite_credito: number;
  /**
   * `true` solo para el cliente Mostrador. La interfaz lo usa para no ofrecer
   * crédito ni pedirle datos a quien compra sin identificación.
   */
  es_mostrador: boolean;
  activo: boolean;
  creado_en: string | null;
}

export interface ClienteInput {
  documento: string;
  nombre: string;
  razon_social?: string | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  dias_credito: number;
  limite_credito: number;
  activo: boolean;
}
export interface Producto {
  id: number;
  codigo: string;
  codigo_barras: string | null;
  nombre: string;
  descripcion: string | null;
  categoria_id: number | null;
  unidad_medida: UnidadMedida;
  precio_base: number;
  impuesto_porcentaje: number;
  stock_minimo: number;
  activo: boolean;
  creado_en: string | null;
}

export interface ProductoInput {
  codigo: string;
  codigo_barras?: string | null;
  nombre: string;
  descripcion?: string | null;
  categoria_id?: number | null;
  unidad_medida: UnidadMedida;
  precio_base: number;
  impuesto_porcentaje?: number;
  stock_minimo?: number;
  activo: boolean;
}

export interface PrecioCliente {
  id: number;
  cliente_id: number;
  producto_id: number;
  precio_especial: number;
}

export interface PrecioClienteInput {
  cliente_id: number;
  producto_id: number;
  precio_especial: number;
}

//---------------------------------------------------------------------------
// Inventario
//---------------------------------------------------------------------------

export interface StockItem {
  producto_id: number;
  nombre: string;
  codigo: string;
  cantidad_disponible: number;
  stock_minimo: number;
  unidad_medida: UnidadMedida;
  categoria_id: number | null;
  categoria_nombre: string | null;
}

/** Recepción de mercadería del proveedor: suma stock y actualiza el costo. */
export interface EntradaMercanciaInput {
  producto_id: number;
  cantidad: number;
  costo_unitario: number;
  operador_id: number;
  fecha: string;
  proveedor?: string | null;
  documento_ref?: string | null;
}

export interface MermaInput {
  producto_id: number;
  cantidad: number;
  motivo: string;
  operador_id: number;
}

/** Ajuste de inventario con cantidad con signo: positiva suma, negativa resta. */
export interface AjusteInput {
  producto_id: number;
  cantidad_delta: number;
  motivo: string;
  operador_id: number;
}

//---------------------------------------------------------------------------
// Motivos de movimiento de inventario
//---------------------------------------------------------------------------

/**
 * Por qué se movió el stock. Es un código, no texto libre.
 *
 * Antes el motivo era una cadena que se guardaba y nadie leía nunca: no había
 * forma de sacar «cuánto se perdió este mes» sin interpretar texto escrito a
 * mano. Con un catálogo cerrado ese número por fin se puede sumar, que es para
 * lo que sirve tener una merma separada de un ajuste.
 */
export type MotivoMovimiento =
  | 'vendido'
  | 'roto'
  | 'robado'
  | 'vencido'
  | 'error_conteo'
  | 'devolucion_proveedor'
  | 'otro';

/** Cómo afecta el motivo al stock. `signo` es una pista para la interfaz. */
export interface MotivoMovimientoInfo {
  etiqueta: string;
  /** El tipo que se asienta en el libro de movimientos. */
  tipo: TipoMovimiento;
  /**
   * `-1` si el motivo siempre resta, `1` si siempre suma, `0` si depende del
   * conteo y lo elige quien lo registra.
   */
  signo: -1 | 0 | 1;
  /** Descripción corta para la ayuda del formulario. */
  ayuda: string;
}

export const MOTIVOS_MOVIMIENTO: Record<MotivoMovimiento, MotivoMovimientoInfo> = {
  vendido: {
    etiqueta: 'Vendido',
    tipo: 'salida_venta',
    signo: -1,
    ayuda: 'Mercancía que salió por una venta',
  },
  roto: {
    etiqueta: 'Roto o dañado',
    tipo: 'merma',
    signo: -1,
    ayuda: 'Se rompió, se mojó o se dañó',
  },
  robado: {
    etiqueta: 'Robado o perdido',
    tipo: 'merma',
    signo: -1,
    ayuda: 'Desapareció sin explicación',
  },
  vencido: {
    etiqueta: 'Vencido',
    tipo: 'merma',
    signo: -1,
    ayuda: 'Pasó su fecha y ya no se puede vender',
  },
  error_conteo: {
    etiqueta: 'Error de conteo',
    tipo: 'ajuste',
    signo: 0,
    ayuda: 'El sistema decía una cosa y el estante otra',
  },
  devolucion_proveedor: {
    etiqueta: 'Devolución a proveedor',
    tipo: 'merma',
    signo: -1,
    ayuda: 'Se le devolvió la mercancía al proveedor',
  },
  otro: {
    etiqueta: 'Otro',
    tipo: 'ajuste',
    signo: 0,
    ayuda: 'Cualquier otro motivo; escribe cuál',
  },
};

/** Entrada de un movimiento de inventario con motivo estructurado. */
export interface MovimientoInventarioInput {
  producto_id: number;
  /** Siempre positivo: el signo lo pone el motivo. */
  cantidad: number;
  motivo: MotivoMovimiento;
  /** Obligatorio solo para `otro`; el resto lo lleva en su etiqueta. */
  detalle?: string | null;
  operador_id: number;
}

export interface MovimientoInventario {
  id: number;
  producto_id: number;
  tipo: TipoMovimiento;
  cantidad: number;
  motivo: string | null;
  venta_id: number | null;
  operador_id: number | null;
  fecha: string | null;
}

//---------------------------------------------------------------------------
// Ventas
//---------------------------------------------------------------------------

export interface DetalleVentaInput {
  producto_id: number;
  cantidad: number;
}

export interface PagoInput {
  monto: number;
  tipo_pago: TipoPago;
  moneda: Moneda;
  numero_referencia?: string;
}

export interface VentaInput {
  cliente_id: number;
  tipo: TipoVenta;
  descuento: number;
  detalles: DetalleVentaInput[];
  pagos: PagoInput[];
  operador_id: number;
}

export interface Venta {
  id: number;
  cliente_id: number;
  numero_factura: number;
  tipo: TipoVenta;
  estado: EstadoVenta;
  fecha: string;
  subtotal: number;
  descuento: number;
  impuesto: number;
  total: number;
  operador_id: number;
  moneda: Moneda;
  tasa_cambio: number;
}

export interface AnularVentaInput {
  venta_id: number;
  motivo: string;
  operador_id: number;
}

//---------------------------------------------------------------------------
// Pagos / Estado de cuenta
//---------------------------------------------------------------------------

export interface AbonoInput {
  cliente_id: number;
  pagos: PagoInput[];
  operador_id: number;
}

export interface EstadoCuenta {
  cliente_id: number;
  nombre: string;
  total_facturado: number;
  total_pagado: number;
  saldo_pendiente: number;
  total_vencido: number;
  total_al_dia: number;
  dias_credito: number;
}

export interface PagoLinea {
  id: number;
  venta_id: number | null;
  numero_factura: number | null;
  monto: number;
  tipo_pago: TipoPago;
  moneda: Moneda;
  tasa_cambio: number;
  numero_referencia: string | null;
  fecha_pago: string | null;
}

//---------------------------------------------------------------------------
// Devoluciones
//---------------------------------------------------------------------------

export interface DetalleDevolucionInput {
  producto_id: number;
  cantidad: number;
  precio_unitario: number;
}

export interface DevolucionInput {
  cliente_id: number;
  venta_id: number;
  monto: number;
  motivo: string | null;
  operador_id: number;
  /** Si es `true`, los productos devueltos reingresan al stock disponible. */
  afecta_stock: boolean;
  detalle?: DetalleDevolucionInput[];
}

export interface DetalleDevolucion {
  producto_id: number;
  nombre: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
}

export interface Devolucion {
  id: number;
  cliente_id: number;
  venta_id: number;
  numero_factura: number;
  monto: number;
  motivo: string | null;
  afecta_stock: boolean;
  operador_id: number;
  fecha_devolucion: string | null;
  detalle: DetalleDevolucion[];
}

export interface VentaDevolucion {
  venta_id: number;
  numero_factura: number;
  tipo: TipoVenta;
  fecha: string;
  total: number;
  devuelto: number;
}

export interface DetalleVentaDevolucion {
  producto_id: number;
  nombre: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
}

//---------------------------------------------------------------------------
// Usuarios
//---------------------------------------------------------------------------

export interface Usuario {
  id: number;
  nombre: string;
  rol: Rol;
  activo: boolean;
}

export interface UsuarioInput {
  nombre: string;
  rol: Rol;
  activo: boolean;
  /** Si se omite, el backend asigna el PIN inicial. */
  pin?: string | null;
}

/** Datos del primer arranque: crear/ajustar el administrador y su PIN. */
export interface ConfigurarAdminInput {
  nombre: string;
  pin: string;
}

//---------------------------------------------------------------------------
// Caja (arqueo por moneda)
//---------------------------------------------------------------------------

export interface Caja {
  id: number;
  fecha: string;
  operador_id: number;
  operador_nombre: string;
  efectivo_inicial_usd: number;
  efectivo_inicial_ves: number;
  efectivo_ventas_usd: number;
  efectivo_ventas_ves: number;
  efectivo_egresos_usd: number;
  efectivo_egresos_ves: number;
  efectivo_final_usd: number;
  efectivo_final_ves: number;
  efectivo_esperado_usd: number;
  efectivo_esperado_ves: number;
  diferencia_usd: number;
  diferencia_ves: number;
  tasa_cierre: number;
  estado: EstadoCaja;
}

export interface CajaAbrirInput {
  operador_id: number;
}

export interface CajaCerrarInput {
  caja_id: number;
  operador_id: number;
  tasa_cierre: number;
}

/** Desglose por método de pago y moneda al cerrar el turno. */
export interface CierreCajaPago {
  tipo_pago: TipoPago;
  moneda: Moneda;
  monto: number;
}

//---------------------------------------------------------------------------
// Reporte
//---------------------------------------------------------------------------

export interface ResumenDiaVenta {
  venta_id: number;
  numero_factura: number;
  cliente: string;
  tipo: TipoVenta;
  monto: number;
  devuelto: number;
  estado: EstadoVenta;
  tasa_cambio: number;
}

export interface EntradaResumen {
  producto: string;
  cantidad: number;
  costo_unitario: number;
}

export interface ResumenDiaDevolucion {
  id: number;
  venta_id: number;
  numero_factura: number;
  cliente: string;
  monto: number;
  motivo: string | null;
  operador_nombre: string;
  fecha_devolucion: string;
  detalle: DetalleDevolucion[];
}

export interface ResumenDia {
  entradas: EntradaResumen[];
  ventas: ResumenDiaVenta[];
  pagos_efectivo_usd: number;
  pagos_efectivo_ves: number;
  devoluciones: ResumenDiaDevolucion[];
  deudores: EstadoCuenta[];
}

//---------------------------------------------------------------------------
// Factura (comprobante imprimible)
//---------------------------------------------------------------------------

export interface FacturaDetalle {
  producto: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
}

export interface FacturaPago {
  tipo_pago: TipoPago;
  moneda: Moneda;
  monto: number;
  numero_referencia: string | null;
}

export interface Factura {
  venta_id: number;
  numero_factura: number;
  tipo: TipoVenta;
  estado: EstadoVenta;
  fecha: string;
  cliente: string;
  cliente_documento: string;
  dias_credito: number;
  negocio_nombre: string;
  negocio_rif: string;
  negocio_telefono: string;
  negocio_direccion: string;
  subtotal: number;
  descuento: number;
  impuesto: number;
  total: number;
  tasa_cambio: number;
  detalle: FacturaDetalle[];
  pagos: FacturaPago[];
  devoluciones: ResumenDiaDevolucion[];
}

//---------------------------------------------------------------------------
// Impresión térmica 80 mm (ESC/POS directo) y copias de seguridad
//---------------------------------------------------------------------------

export interface TicketLinea {
  producto: string;
  cantidad: number;
  subtotal: number;
}

export interface TicketPago {
  tipo_pago: string;
  moneda: string;
  monto: number;
  numero_referencia: string | null;
}

export interface TicketDevolucionLinea {
  nombre: string;
  cantidad: number;
  subtotal: number;
}

export interface TicketDevolucion {
  fecha_devolucion: string;
  motivo: string | null;
  monto: number;
  detalle: TicketDevolucionLinea[];
}

export interface TicketInput {
  negocio_nombre: string;
  negocio_rif: string;
  negocio_telefono: string;
  negocio_direccion: string;
  numero_factura: number;
  fecha: string;
  cliente: string;
  cliente_documento: string;
  subtotal: number;
  descuento: number;
  total: number;
  tasa_cambio: number;
  detalle: TicketLinea[];
  pagos: TicketPago[];
  devoluciones: TicketDevolucion[];
  /** Recordatorio de pago (factura a crédito próximo a vencer) o null. */
  recordatorio: string | null;
}

/**
 * Destino de impresión configurado en `config.impresora_termica` (JSON).
 * - `red`: impresora con interfaz de red, se le escriben bytes ESC/POS por TCP.
 * - `usb`: impresora instalada en Windows, se imprimen bytes vía el spooler.
 * - `archivo`: vuelca los bytes a un archivo; sirve para revisar el ticket sin
 *   impresora física.
 */
export type DestinoImpresora =
  | { tipo: 'red'; host: string; puerto: number }
  | { tipo: 'usb'; impresora: string }
  | { tipo: 'archivo'; ruta: string };

/**
 * Cómo se describe un destino de impresión en una línea, para un mensaje.
 *
 * Vive aquí y no en el backend porque los dos lo necesitan: el backend lo
 * escribe en la bitácora y la interfaz lo muestra en pantalla después de
 * guardar. Dos copias de esta función acabarían divergiendo, y el síntoma sería
 * un POS que dice "impresora configurada" con un texto que el registro de
 * eventos no tiene.
 */
export function describirDestino(destino: DestinoImpresora): string {
  switch (destino.tipo) {
    case 'red':
      return `${destino.host}:${destino.puerto} (red)`;
    case 'usb':
      return `${destino.impresora} (USB)`;
    case 'archivo':
      return destino.ruta;
  }
}

/** Impresora detectada por el sistema operativo. */
export interface ImpresoraInfo {
  nombre: string;
  /** `PORT`, `IP_192.168.1.50`, `USB001`… según el driver con el que se instaló. */
  puerto: string | null;
  estado: string | null;
  /** `red` si el puerto parece una dirección IP, `usb` en caso contrario. */
  conexion: 'red' | 'usb' | 'desconocido';
}

export interface BackupItem {
  nombre: string;
  ruta: string;
  tamano_bytes: number;
  fecha: string;
}

//---------------------------------------------------------------------------
// Cierre de caja (comprobante del día)
//---------------------------------------------------------------------------

export interface CierreAbono {
  cliente_id: number;
  cliente: string;
  tipo_pago: TipoPago;
  moneda: Moneda;
  monto: number;
  tasa_cambio: number;
  fecha_pago: string;
}

export interface CierreDia {
  caja_id: number;
  fecha: string;
  operador_nombre: string;
  negocio_nombre: string;
  negocio_rif: string;
  negocio_telefono: string;
  negocio_direccion: string;
  efectivo_inicial_usd: number;
  efectivo_inicial_ves: number;
  efectivo_ventas_usd: number;
  efectivo_ventas_ves: number;
  abonos_efectivo_usd: number;
  abonos_efectivo_ves: number;
  efectivo_esperado_usd: number;
  efectivo_esperado_ves: number;
  /** Desglose por método de pago y moneda. */
  pagos: CierreCajaPago[];
  ventas: ResumenDiaVenta[];
  abonos: CierreAbono[];
  devoluciones: ResumenDiaDevolucion[];
  total_ventas_usd: number;
  total_ventas_bs: number;
  total_abonos_usd: number;
  total_abonos_bs: number;
  total_devoluciones_usd: number;
  total_devoluciones_bs: number;
  tasa_cierre: number;
}
