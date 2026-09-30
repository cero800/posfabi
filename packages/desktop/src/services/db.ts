// Capa de acceso al backend. Los TIPOS no viven aquí: se comparten desde
// @tienda/core (fuente única) y se re-exportan por comodidad.
//
// Antes esto eran `invoke()` contra 48 comandos de Rust. Ahora cada wrapper es
// una llamada JSON-RPC al proceso del backend; ver `services/backend.ts` para
// cómo se arranca y cómo se le habla.
//
// ## Los nombres de los wrappers
//
// Cada wrapper es una línea que dice qué procedure del backend llama y con qué
// forma de argumento. Los nombres de los wrappers y los de los procedures
// coinciden a propósito —`listarClientes` llama a `listar_clientes`— para que
// buscar uno encuentre el otro. Los nombres del backend son los del dominio
// nuevo: `registrarEntradaMercancia` es el `registrar_produccion` del original,
// que en una papelería no tiene sentido.
//
// Los errores se propagan tal cual. No hay un mapa de códigos a textos porque no
// hace falta: el backend ya escribe mensajes para el cajero y `services/logging.ts`
// se encarga de que se vean.

import { TASA_CAMBIO_KEY } from '@tienda/core';
import type {
  AbonoInput,
  AjusteInput,
  BackupItem,
  Caja,
  CajaAbrirInput,
  CajaCerrarInput,
  CierreDia,
  ConfigurarAdminInput,
  DetalleVentaDevolucion,
  Devolucion,
  DevolucionInput,
  Cliente,
  ClienteInput,
  EntradaMercanciaInput,
  EstadoCuenta,
  Factura,
  MermaInput,
  PagoLinea,
  PrecioCliente,
  PrecioClienteInput,
  Producto,
  ProductoInput,
  ResumenDia,
  StockItem,
  TicketInput,
  Usuario,
  UsuarioInput,
  Venta,
  VentaDevolucion,
  VentaInput,
} from '@tienda/core';

import { llamar } from './backend';

export type {
  AbonoInput,
  AjusteInput,
  BackupItem,
  Caja,
  CajaAbrirInput,
  CajaCerrarInput,
  CierreAbono,
  CierreDia,
  ConfigurarAdminInput,
  DetalleVentaDevolucion,
  DetalleVentaInput,
  Devolucion,
  DevolucionInput,
  Cliente,
  ClienteInput,
  EntradaMercanciaInput,
  EstadoCuenta,
  Factura,
  FacturaDetalle,
  MermaInput,
  PagoLinea,
  PrecioCliente,
  PrecioClienteInput,
  Producto,
  ProductoInput,
  ResumenDia,
  StockItem,
  TicketInput,
  Usuario,
  UsuarioInput,
  Venta,
  VentaDevolucion,
  VentaInput,
} from '@tienda/core';

// ============================================================
// Catálogo
// ============================================================

export const listarClientes = () => llamar<Cliente[]>('listar_clientes');
export const crearCliente = (cliente: ClienteInput) => llamar<number>('crear_cliente', { cliente });
export const eliminarCliente = (id: number) => llamar<void>('eliminar_cliente', { id });

export const listarProductos = () => llamar<Producto[]>('listar_productos');
export const crearProducto = (producto: ProductoInput) => llamar<number>('crear_producto', { producto });
export const actualizarProducto = (id: number, producto: ProductoInput) =>
  llamar<void>('actualizar_producto', { id, producto });
export const eliminarProducto = (id: number) => llamar<void>('eliminar_producto', { id });

export const listarPreciosCliente = (cliente_id: number) =>
  llamar<PrecioCliente[]>('listar_precios_cliente', { cliente_id });
export const setPrecioCliente = (precio: PrecioClienteInput) =>
  llamar<void>('set_precio_cliente', { precio });
export const eliminarPrecioCliente = (cliente_id: number, producto_id: number) =>
  llamar<void>('eliminar_precio_cliente', { cliente_id, producto_id });

// ============================================================
// Usuarios
// ============================================================

export const listarUsuarios = () => llamar<Usuario[]>('listar_usuarios');

export const crearUsuario = (usuario: UsuarioInput) => llamar<number>('crear_usuario', { usuario });

export const verificarPin = (usuario_id: number, pin: string) =>
  llamar<boolean>('verificar_pin', { usuario_id, pin });

export const cambiarPin = (usuario_id: number, pin_actual: string, pin_nuevo: string) =>
  llamar<void>('cambiar_pin', { usuario_id, pin_actual, pin_nuevo });

export const necesitaConfiguracion = () => llamar<boolean>('necesita_configuracion');

export const configurarAdmin = (admin: ConfigurarAdminInput) => llamar<void>('configurar_admin', { admin });

// ============================================================
// Inventario
// ============================================================

export const listarStock = () => llamar<StockItem[]>('listar_stock');

/**
 * Recepción de mercadería del proveedor: suma stock y actualiza el costo.
 *
 * Se llama así y no `registrarProduccion` porque eso es lo que hace: en una
 * papelería lo que entra es mercadería comprada, no pan horneado.
 */
export const registrarEntradaMercancia = (entrada: EntradaMercanciaInput) =>
  llamar<void>('registrar_entrada_mercancia', { entrada });

export const registrarMerma = (merma: MermaInput) => llamar<void>('registrar_merma', { merma });

export const registrarAjuste = (ajuste: AjusteInput) => llamar<void>('registrar_ajuste', { ajuste });

// ============================================================
// Ventas
// ============================================================

export const crearVenta = (venta: VentaInput) => llamar<Venta>('crear_venta', { venta });
export const listarVentas = () => llamar<Venta[]>('listar_ventas');
export const anularVenta = (args: { venta_id: number; motivo: string; operador_id: number }) =>
  llamar<void>('anular_venta', args);

// ============================================================
// Pagos y estado de cuenta
// ============================================================

export const estadoCuenta = (cliente_id: number) => llamar<EstadoCuenta>('estado_cuenta', { cliente_id });
export const estadoCuentaTodos = () => llamar<EstadoCuenta[]>('estado_cuenta_todos');
export const registrarAbono = (abono: AbonoInput) => llamar<void>('registrar_abono', { abono });
export const historialPagos = (cliente_id: number) => llamar<PagoLinea[]>('historial_pagos', { cliente_id });

// ============================================================
// Devoluciones
// ============================================================

export const registrarDevolucion = (devolucion: DevolucionInput) =>
  llamar<Devolucion>('registrar_devolucion', { devolucion });
export const listarVentasCliente = (cliente_id: number) =>
  llamar<VentaDevolucion[]>('listar_ventas_cliente', { cliente_id });
export const detalleVenta = (venta_id: number) =>
  llamar<DetalleVentaDevolucion[]>('detalle_venta', { venta_id });
export const listarDevoluciones = (cliente_id: number) =>
  llamar<Devolucion[]>('listar_devoluciones', { cliente_id });

// ============================================================
// Caja
// ============================================================

export const cajaAbierta = () => llamar<Caja | null>('caja_abierta');
export const abrirCaja = (caja: CajaAbrirInput) => llamar<void>('abrir_caja', { caja });
export const cerrarCaja = (caja: CajaCerrarInput) => llamar<CierreDia>('cerrar_caja', { caja });

// ============================================================
// Reporte y configuración
// ============================================================

export const resumenDia = (fecha?: string) => llamar<ResumenDia>('resumen_dia', { fecha: fecha ?? null });
export const getConfig = (clave: string) => llamar<string | null>('get_config', { clave });
export const setConfig = (clave: string, valor: string) => llamar<void>('set_config', { clave, valor });

// ============================================================
// Factura
// ============================================================

export const getFactura = (venta_id: number) => llamar<Factura>('obtener_factura', { venta_id });

/**
 * Guarda el PDF de la factura y devuelve dónde quedó.
 *
 * El PDF lo arma la interfaz con jsPDF y aquí solo se escribe el archivo, igual
 * que con el `.xlsx` del reporte. Son dos razones: el PDF no se genera bien fuera
 * del navegador y el navegador es donde ya vive esa lógica.
 */
export const guardarFacturaPdf = (nombre_archivo: string, contenido_b64: string) =>
  llamar<string>('guardar_factura_pdf', { nombre_archivo, contenido_b64 });

export const guardarReporteExcel = (nombre_archivo: string, contenido_b64: string) =>
  llamar<string>('guardar_reporte_excel', { nombre_archivo, contenido_b64 });

// ============================================================
// Impresora térmica (ESC/POS), sin diálogo
// ============================================================

export const imprimirTicket = (ticket: TicketInput) => llamar<void>('imprimir_ticket', { ticket });
export const listarImpresoras = () => llamar<string[]>('listar_impresoras');
export const probarImpresora = () => llamar<void>('probar_impresora');

// ============================================================
// Respaldos
// ============================================================

export const listarBackups = () => llamar<BackupItem[]>('listar_backups');

export const crearBackup = () => llamar<BackupItem>('crear_backup');

export const eliminarBackup = (nombre_archivo: string) =>
  llamar<void>('eliminar_backup', { nombre_archivo });

// ============================================================
// Tasa de cambio (Bs por 1 US$)
// ============================================================

/**
 * Atajo sobre `get_config`.
 *
 * Devuelve `1` si no hay nada guardado o si el valor guardado no es un número
 * utilizable, en vez de `NaN`. Un `NaN` en el precio de venta termina en un
 * total `NaN` que el cajero no sabe leer, y en la base de una tienda es más
 * probable el valor corrupto que el cero.
 */
export const getTasaCambio = async (): Promise<number> => {
  const valor = await getConfig(TASA_CAMBIO_KEY);
  const tasa = Number(valor);
  return Number.isFinite(tasa) && tasa > 0 ? tasa : 1;
};

export const setTasaCambio = (tasa: number) => setConfig(TASA_CAMBIO_KEY, String(tasa));