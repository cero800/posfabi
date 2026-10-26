// El registro de procedures: el único lugar donde el transporte se encuentra con
// el dominio.
//
// ## Por qué un mapa y no un `switch`
//
// El backend original eran 48 funciones `#[tauri::command]` declaradas una por
// una en `lib.rs`, con una lista aparte en `generate_handler!` que había que
// mantener en paralelo. Olvidarse de un nombre en esa segunda lista daba un
// error en compilación, que es la mitad de por qué no se olvidaba.
//
// Aquí el mapa es la declaración: el nombre es la clave y la función es el
// valor, así que no hay segunda lista que sincronizar. Además cada procedure
// declara sus propios argumentos al leerlos, que es lo que permite que `Args`
// dé el mensaje concreto ("falta `cliente_id`") en vez de que el error aparezca
// tres capas más adentro como un `undefined` convertido a `NULL` por SQLite.
//
// ## Nombres
//
// Los nombres son los del dominio nuevo y en `snake_case`, igual que las
// columnas. `registrar_produccion` del original es `registrar_entrada_mercancia`
// porque la tabla se llama `entradas_mercancia` y en una papelería no hay
// producción. `services/db.ts` se reescribe en la fase 8, así que el cambio de
// nombre es un ajuste de una línea por wrapper, no una migración.
//
// ## Los arguments
//
// Un procedure recibe `Args`, que lee del objeto `params` con nombre. Los
// alias en camelCase existen solo para tolerar los tres wrappers del frontend
// que hoy mandan `ventaId`, `nombreArchivo` y `usuarioId`; ver `Args`.

import type {
  AbonoInput,
  AjusteInput,
  BackupItem,
  CajaAbrirInput,
  CajaCerrarInput,
  CategoriaInput,
  ClienteInput,
  ConfigurarAdminInput,
  DevolucionInput,
  DestinoImpresora,
  EntradaMercanciaInput,
  MermaInput,
  MovimientoInventarioInput,
  PrecioClienteInput,
  ProductoInput,
  TicketInput,
  UsuarioInput,
  VentaInput,
} from '@tienda/core';

import {
  crearBackup,
  eliminarBackup,
  hayBackupHoy,
  listarBackups,
} from './backup.js';
import { logError, logEvento } from './bitacora.js';
import { versionEsquema } from './db.js';
import { validacion } from './errors.js';
import {
  cajaAbierta,
  cerrarCaja,
  abrirCaja,
  listarCajas,
  obtenerCaja,
  obtenerCierre,
} from './caja.js';
import { datosNegocio, escribirConfig, leerConfig } from './config.js';
import { estadoCuenta, estadoCuentaTodos } from './deudores.js';
import {
  detalleVenta,
  listarDevoluciones,
  listarVentasCliente,
  registrarDevolucion,
} from './devoluciones.js';
import { guardarFacturaPdf, guardarReporteExcel } from './archivos.js';
import { facturaVenta } from './factura.js';
import {
  escribirDestino,
  imprimir,
  leerDestino,
  listarImpresoras,
  probar,
  validarDestino,
} from './impresora.js';
import { historialPagos, registrarAbono } from './pagos.js';
import { SCHEMA_VERSION } from './schema.js';
import { ticketFactura } from './ticket.js';
import {
  actualizarCategoria,
  actualizarCliente,
  actualizarProducto,
  cambiarPin,
  crearCategoria,
  crearCliente,
  crearProducto,
  crearUsuario,
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
  obtenerProducto,
  registrarAjuste,
  registrarEntradaMercancia,
  registrarMerma,
  registrarMovimientoInventario,
  setPrecioCliente,
  verificarPin,
  configurarAdmin,
} from './repo.js';
import { resumenDia } from './resumen.js';
import { type Procedimiento, type Registro } from './rpc.js';
import { anularVenta, crearVenta, listarVentas, obtenerVenta } from './ventas.js';

import { necesitaConfiguracion } from './seed.js';

/**
 * Todo lo que la interfaz puede pedir, en un solo objeto.
 *
 * Se construye con un objeto literal y no con `new Map` para que el orden de
 * lectura sea el de los grupos del código, y para que añadir un procedure sea
 * una línea visible en el diff.
 */
export const PROCEDIMIENTOS: Readonly<Record<string, Procedimiento>> = {
  //------------------------------------------------------------------ sistema
  /**
   * Estado del backend: qué base abrió, con qué esquema y qué sabe hacer.
   *
   * Es lo que consulta el shell de Tauri para confirmar que el sidecar arrancó,
   * y lo que se le muestra a alguien depurando con `--http`. No toca datos de
   * negocio, así que se puede llamar en cualquier momento.
   */
  estado_sistema: ({ db, rutas }) => ({
    version_esquema: versionEsquema(db),
    version_esperada: SCHEMA_VERSION,
    base: rutas.dbPath,
    datos: rutas.dataDir,
    documentos: rutas.documentDir,
    configuracion_pendiente: necesitaConfiguracion(db),
    procedures: Object.keys(PROCEDIMIENTOS).length,
    node: process.version,
    pid: process.pid,
  }),

  //----------------------------------------------------------------- catálogo
  listar_categorias: ({ db }) => listarCategorias(db),
  crear_categoria: ({ db }, a) => crearCategoria(db, a.objeto<CategoriaInput>('categoria')),
  actualizar_categoria: ({ db }, a) =>
    actualizarCategoria(db, a.entero('id'), a.objeto<CategoriaInput>('categoria')),
  eliminar_categoria: ({ db }, a) => {
    eliminarCategoria(db, a.entero('id'));
  },

  listar_clientes: ({ db }) => listarClientes(db),
  crear_cliente: ({ db }, a) => crearCliente(db, a.objeto<ClienteInput>('cliente')),
  actualizar_cliente: ({ db }, a) =>
    actualizarCliente(db, a.entero('id'), a.objeto<ClienteInput>('cliente')),
  eliminar_cliente: ({ db }, a) => {
    eliminarCliente(db, a.entero('id'));
  },

  listar_productos: ({ db }) => listarProductos(db),
  crear_producto: ({ db }, a) => crearProducto(db, a.objeto<ProductoInput>('producto')),
  actualizar_producto: ({ db }, a) =>
    actualizarProducto(db, a.entero('id'), a.objeto<ProductoInput>('producto')),
  eliminar_producto: ({ db }, a) => {
    // Sin operador no se anota `NULL`: ver la nota en `repo.eliminarProducto`.
    eliminarProducto(db, a.entero('id'), a.enteroOpc('operador_id', 'operadorId'));
  },
  obtener_producto: ({ db }, a) => obtenerProducto(db, a.entero('id')),

  listar_precios_cliente: ({ db }, a) =>
    listarPreciosCliente(db, a.entero('cliente_id', 'clienteId')),
  set_precio_cliente: ({ db }, a) => {
    setPrecioCliente(db, a.objeto<PrecioClienteInput>('precio'));
  },
  eliminar_precio_cliente: ({ db }, a) => {
    eliminarPrecioCliente(
      db,
      a.entero('cliente_id', 'clienteId'),
      a.entero('producto_id', 'productoId'),
    );
  },

  //---------------------------------------------------------------- usuarios
  listar_usuarios: ({ db }) => listarUsuarios(db),
  crear_usuario: ({ db }, a) => crearUsuario(db, a.objeto<UsuarioInput>('usuario')),
  verificar_pin: ({ db }, a) => verificarPin(db, a.entero('usuario_id', 'usuarioId'), a.texto('pin')),
  cambiar_pin: ({ db }, a) => {
    cambiarPin(
      db,
      a.entero('usuario_id', 'usuarioId'),
      a.texto('pin_actual', 'pinActual'),
      a.texto('pin_nuevo', 'pinNuevo'),
    );
  },
  necesita_configuracion: ({ db }) => necesitaConfiguracion(db),
  configurar_admin: ({ db }, a) => {
    const admin = a.objeto<ConfigurarAdminInput>('admin');
    configurarAdmin(db, admin.nombre, admin.pin);
  },

  //--------------------------------------------------------------- inventario
  listar_stock: ({ db }) => listarStock(db),
  /**
   * Recepción de mercadería del proveedor.
   *
   * Es el `registrar_produccion` del original con otro nombre: la tabla se llama
   * `entradas_mercancia` y lo que entra en una papelería es mercadería comprada,
   * no pan horneado.
   */
  registrar_entrada_mercancia: ({ db }, a) =>
    registrarEntradaMercancia(db, a.objeto<EntradaMercanciaInput>('entrada')),
  registrar_merma: ({ db }, a) => {
    registrarMerma(db, a.objeto<MermaInput>('merma'));
  },
  registrar_ajuste: ({ db }, a) => {
    registrarAjuste(db, a.objeto<AjusteInput>('ajuste'));
  },
  /**
   * Movimiento de inventario con motivo estructurado.
   *
   * Es el que usa la interfaz. `registrar_merma` y `registrar_ajuste` siguen
   * existiendo para scripts y compatibilidad, pero el motivo de texto libre que
   * arrastran es justo lo que este reemplaza.
   */
  registrar_movimiento_inventario: ({ db }, a) => {
    registrarMovimientoInventario(db, a.objeto<MovimientoInventarioInput>('movimiento'));
  },

  //------------------------------------------------------------------ ventas
  crear_venta: ({ db }, a) => crearVenta(db, a.objeto<VentaInput>('venta')),
  listar_ventas: ({ db }, a) => listarVentas(db, a.enteroOpc('limite') ?? undefined),
  obtener_venta: ({ db }, a) => obtenerVenta(db, a.entero('venta_id', 'ventaId', 'id')),
  anular_venta: ({ db }, a) => {
    anularVenta(
      db,
      a.entero('venta_id', 'ventaId'),
      a.texto('motivo'),
      a.entero('operador_id', 'operadorId'),
    );
  },

  //------------------------------------------------------------------- pagos
  estado_cuenta: ({ db }, a) => estadoCuenta(db, a.entero('cliente_id', 'clienteId')),
  estado_cuenta_todos: ({ db }) => estadoCuentaTodos(db),
  registrar_abono: ({ db }, a) => {
    registrarAbono(db, a.objeto<AbonoInput>('abono'));
  },
  historial_pagos: ({ db }, a) => historialPagos(db, a.entero('cliente_id', 'clienteId')),

  //------------------------------------------------------------- devoluciones
  registrar_devolucion: ({ db }, a) =>
    registrarDevolucion(db, a.objeto<DevolucionInput>('devolucion')),
  listar_ventas_cliente: ({ db }, a) =>
    listarVentasCliente(db, a.entero('cliente_id', 'clienteId')),
  detalle_venta: ({ db }, a) => detalleVenta(db, a.entero('venta_id', 'ventaId')),
  listar_devoluciones: ({ db }, a) => listarDevoluciones(db, a.entero('cliente_id', 'clienteId')),

  //-------------------------------------------------------------------- caja
  caja_abierta: ({ db }) => cajaAbierta(db),
  abrir_caja: ({ db }, a) => {
    abrirCaja(db, a.objeto<CajaAbrirInput>('caja'));
  },
  cerrar_caja: ({ db }, a) => cerrarCaja(db, a.objeto<CajaCerrarInput>('caja')),
  listar_cajas: ({ db }, a) => listarCajas(db, a.enteroOpc('limite') ?? 60),
  obtener_caja: ({ db }, a) => obtenerCaja(db, a.entero('id')),
  obtener_cierre: ({ db }, a) => obtenerCierre(db, a.entero('caja_id', 'cajaId', 'id')),
  obtenerCierre: ({ db }, a) => obtenerCierre(db, a.entero('caja_id', 'cajaId', 'id')),
  'obtener cierre': ({ db }, a) => obtenerCierre(db, a.entero('caja_id', 'cajaId', 'id')),
  'obtener-cierre': ({ db }, a) => obtenerCierre(db, a.entero('caja_id', 'cajaId', 'id')),

  //---------------------------------------------------------- reporte y config
  resumen_dia: ({ db }, a) => resumenDia(db, a.textoOpc('fecha')),
  get_config: ({ db }, a) => leerConfig(db, a.texto('clave')),
  set_config: ({ db }, a) => {
    escribirConfig(db, a.texto('clave'), a.textoOpc('valor'));
  },
  /**
   * Los cuatro datos del negocio de una vez.
   *
   * La interfaz hoy hace cuatro `get_config` separados solo para armar el
   * encabezado del ticket, y un quinto para el recordatorio de pago. Con esto
   * es una llamada.
   */
  obtener_datos_negocio: ({ db }) => datosNegocio(db),

  //------------------------------------------------------------------ factura
  obtener_factura: ({ db }, a) => facturaVenta(db, a.entero('venta_id', 'ventaId', 'id')),

  /**
   * Guarda el PDF que arma la interfaz (jsPDF) y devuelve dónde quedó.
   *
   * El PDF no se genera aquí a propósito: en el backend solo hay un `writeFile`.
   * El `.xlsx` va por `guardar_reporte_excel`, igual.
   */
  guardar_factura_pdf: ({ rutas }, a) =>
    guardarFacturaPdf(
      a.texto('nombre_archivo', 'nombreArchivo'),
      a.texto('contenido_b64', 'contenidoB64'),
      rutas,
    ),
  guardar_reporte_excel: ({ rutas }, a) =>
    guardarReporteExcel(
      a.texto('nombre_archivo', 'nombreArchivo'),
      a.texto('contenido_b64', 'contenidoB64'),
      rutas,
    ),

  //--------------------------------------------------------------- impresora
  /**
   * Imprime el ticket ESC/POS de una factura.
   *
   * Los bytes se generan aquí y no en la interfaz: el generador es una función
   * pura (`ticket.ts`) y mandarle el resultado por el cable sería gastar ancho de
   * banda en algo que la interfaz no sabe construir.
   */
  imprimir_ticket: async ({ db, rutas }, a) => {
    const ticket = a.objeto<TicketInput>('ticket');
    validarTicket(ticket);
    await imprimir(db, ticketFactura(ticket), rutas);
  },
  listar_impresoras: () => listarImpresoras(),
  probar_impresora: async ({ db, rutas }) => {
    await probar(db, rutas);
  },
  obtener_destino_impresora: ({ db }) => leerDestino(db),
  /**
   * Guarda el destino de impresión. Se valida antes de escribir: un destino
   * mal formado en la configuración se descubre cuando el cajero intenta
   * imprimir, que es el peor momento posible.
   */
  configurar_destino_impresora: ({ db }, a): DestinoImpresora => {
    const destino = validarDestino(a.objeto<DestinoImpresora>('destino'));
    return escribirDestino(db, destino);
  },

  //----------------------------------------------------------------- backups
  crear_backup: ({ db, rutas }): BackupItem => crearBackup(db, rutas),
  listar_backups: ({ rutas }) => listarBackups(rutas),
  eliminar_backup: ({ rutas }, a) => {
    eliminarBackup(a.texto('nombre_archivo', 'nombreArchivo'), rutas);
  },
  /**
   * ¿Ya hay copia de hoy?
   *
   * No es un procedure de la interfaz: lo usa `main.ts` al arrancar para no
   * hacer la copia automática diaria si el POS se abrió varias veces. Se expone
   * igual porque es la forma de que un script de mantenimiento respete la misma
   * regla que la app.
   */
  hay_backup_hoy: ({ rutas }) => hayBackupHoy(rutas),

  //---------------------------------------------------------------- bitácora
  log_error: ({ rutas }, a) => {
    logError(a.texto('origen'), a.texto('mensaje'), rutas);
  },
  log_evento: ({ rutas }, a) => {
    logEvento(a.texto('origen'), a.texto('mensaje'), rutas);
  },
};

/** El registro en la forma que espera el transporte. */
export function construirRegistro(): Registro {
  return new Map(Object.entries(PROCEDIMIENTOS));
}

//---------------------------------------------------------------------------
// Guarda de entrada
//---------------------------------------------------------------------------

/** Campos de texto del `TicketInput`: se recorren carácter por carácter. */
const TICKET_TEXTOS = [
  'negocio_nombre',
  'negocio_rif',
  'negocio_telefono',
  'negocio_direccion',
  'fecha',
  'cliente',
  'cliente_documento',
] as const;

/** Listas del `TicketInput`. */
const TICKET_LISTAS = ['detalle', 'pagos', 'devoluciones'] as const;

/** Números del `TicketInput`. */
const TICKET_NUMEROS = [
  'numero_factura',
  'subtotal',
  'descuento',
  'total',
  'tasa_cambio',
] as const;

/**
 * Comprueba la forma del `TicketInput` antes de generar el ticket.
 *
 * Es la única excepción a "los validadores son del dominio", y está aquí por un
 * motivo concreto: `ticketFactura` es una función pura que se supone incapable
 * de fallar, y lo es frente a datos válidos. Pero arma tablas de ancho fijo
 * recorriendo cada texto carácter por carácter y da por hecha la existencia de
 * las listas, así que un campo renombrado la revienta con un `TypeError` a medio
 * comprobante.
 *
 * Lo que se ve desde la interfaz en ese caso es `{codigo: "sistema"}` con un
 * texto del tipo "f.detalle is not iterable", que en el ejecutable empaquetado
 * sale minificado como "e is not iterable": ni el cajero ni quien depure sabe
 * qué falta. Con esta guarda el mensaje dice el campo.
 *
 * No se validan rangos ni importes: de eso sí se ocupa `factura.ts`, que es de
 * donde viene la factura. Aquí solo que los datos tengan la forma que el
 * generador da por hecha.
 */
export function validarTicket(ticket: TicketInput): void {
  for (const campo of TICKET_TEXTOS) {
    if (typeof ticket[campo] !== 'string') {
      throw validacion(`El ticket no trae el dato «${campo}»`);
    }
  }
  for (const campo of TICKET_NUMEROS) {
    if (typeof ticket[campo] !== 'number' || !Number.isFinite(ticket[campo])) {
      throw validacion(`El ticket no trae el número «${campo}»`);
    }
  }
  for (const campo of TICKET_LISTAS) {
    if (!Array.isArray(ticket[campo])) {
      throw validacion(`El ticket no trae la lista «${campo}»`);
    }
  }
}

/** Los nombres de todos los procedures, ordenados. Para documentación y tests. */
export function nombresProcedimientos(): string[] {
  return Object.keys(PROCEDIMIENTOS).sort();
}
