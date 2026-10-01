import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCarrito } from '../store/carrito';
import { useSesion } from '../store/sesion';
import { crearVenta, getFactura } from '../services/db';
import VentaPage from './VentaPage';

const facturaMock = {
  venta_id: 1,
  numero_factura: 12,
  tipo: 'contado',
  estado: 'entregada',
  fecha: '2026-09-04',
  cliente: 'Consumidor Final',
  cliente_documento: '0',
  dias_credito: 0,
  negocio_nombre: 'Papelería Don Carlos',
  negocio_rif: '',
  negocio_telefono: '',
  negocio_direccion: '',
  subtotal: 500,
  descuento: 0,
  impuesto: 0,
  total: 500,
  tasa_cambio: 36.85,
  detalle: [{ producto: 'Cuaderno Carta', cantidad: 1, precio_unitario: 500, subtotal: 500 }],
  pagos: [{ tipo_pago: 'efectivo', moneda: 'usd', monto: 500, numero_referencia: null }],
  devoluciones: [],
};

vi.mock('../services/db', () => ({
  listarProductos: vi.fn().mockResolvedValue([
    { id: 1, codigo: 'P1', nombre: 'Cuaderno Carta', descripcion: null, categoria_id: 1, unidad_medida: 'unidad', precio_base: 500, impuesto_porcentaje: 0, stock_minimo: 4, activo: true, creado_en: null },
    { id: 2, codigo: 'P2', nombre: 'Tiza Blanca', descripcion: null, categoria_id: 2, unidad_medida: 'unidad', precio_base: 800, impuesto_porcentaje: 0, stock_minimo: 6, activo: true, creado_en: null },
    { id: 3, codigo: 'P3', nombre: 'Bolígrafo Azul', descripcion: null, categoria_id: null, unidad_medida: 'unidad', precio_base: 150, impuesto_porcentaje: 0, stock_minimo: 12, activo: true, creado_en: null },
  ]),
  listarCategorias: vi.fn().mockResolvedValue([
    { id: 1, nombre: 'Cuadernos', parent_id: null, orden: 0, activo: true, productos: 1 },
    { id: 2, nombre: 'Pizarra', parent_id: null, orden: 1, activo: true, productos: 1 },
  ]),
  listarClientes: vi.fn().mockResolvedValue([
    { id: 1, documento: '0', nombre: 'Consumidor Final', razon_social: null, telefono: null, email: null, direccion: null, dias_credito: 0, limite_credito: 0, activo: true, creado_en: null },
    { id: 2, documento: 'J-123', nombre: 'Distribuidora La Esquina', razon_social: null, telefono: null, email: null, direccion: null, dias_credito: 15, limite_credito: 5000, activo: true, creado_en: null },
  ]),
  listarStock: vi.fn().mockResolvedValue([
    { producto_id: 1, nombre: 'Cuaderno Carta', codigo: 'P1', cantidad_disponible: 10, stock_minimo: 4, unidad_medida: 'unidad', categoria_id: 1, categoria_nombre: 'Cuadernos' },
    { producto_id: 2, nombre: 'Tiza Blanca', codigo: 'P2', cantidad_disponible: 0, stock_minimo: 6, unidad_medida: 'unidad', categoria_id: 2, categoria_nombre: 'Pizarra' },
    { producto_id: 3, nombre: 'Bolígrafo Azul', codigo: 'P3', cantidad_disponible: 5, stock_minimo: 12, unidad_medida: 'unidad', categoria_id: null, categoria_nombre: null },
  ]),
  listarPreciosCliente: vi.fn().mockImplementation((clienteId: number) =>
    clienteId === 2 ? Promise.resolve([{ id: 1, cliente_id: 2, producto_id: 1, precio_especial: 900 }]) : Promise.resolve([]),
  ),
  setPrecioCliente: vi.fn(),
  eliminarPrecioCliente: vi.fn(),
  crearVenta: vi.fn(),
  getFactura: vi.fn(),
  imprimirTicket: vi.fn(),
  listarImpresoras: vi.fn(),
  probarImpresora: vi.fn(),
  obtenerDestinoImpresora: vi.fn(),
  configurarDestinoImpresora: vi.fn(),
  getConfig: vi.fn(),
  setConfig: vi.fn(),
}));

beforeEach(() => {
  useCarrito.getState().vaciar();
  useSesion.setState({
    tasa: 36.85,
    operador: { id: 1, nombre: 'Ana', rol: 'admin', activo: true },
    caja: { id: 7, fecha: '2026-09-04', operador_id: 1, operador_nombre: 'Ana', efectivo_inicial_usd: 0, efectivo_inicial_ves: 0, efectivo_ventas_usd: 0, efectivo_ventas_ves: 0, efectivo_egresos_usd: 0, efectivo_egresos_ves: 0, efectivo_final_usd: 0, efectivo_final_ves: 0, efectivo_esperado_usd: 0, efectivo_esperado_ves: 0, diferencia_usd: 0, diferencia_ves: 0, tasa_cierre: 36.85, estado: 'abierta' },
  });
  vi.mocked(crearVenta).mockReset();
  vi.mocked(crearVenta).mockResolvedValue({
    id: 1, cliente_id: 2, numero_factura: 12, tipo: 'contado', estado: 'entregada', fecha: '2026-09-04', subtotal: 900, descuento: 0, impuesto: 0, total: 900, operador_id: 1, moneda: 'usd', tasa_cambio: 36.85,
  } as never);

  vi.mocked(getFactura).mockReset();
  vi.mocked(getFactura).mockResolvedValue(facturaMock as never);
});

describe('VentaPage', () => {
  it('lista productos y agrega al carrito con precio de mostrador', async () => {
    const user = userEvent.setup();
    render(<VentaPage />);

    expect(await screen.findByText('Cuaderno Carta')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Cuaderno Carta/i }));
    await user.click(screen.getByRole('button', { name: 'Agregar' }));
    expect(await screen.findByText('$5.00 × 1')).toBeInTheDocument();

    // producto sin stock no se puede agregar
    expect(screen.getByRole('button', { name: /Tiza Blanca/i })).toBeDisabled();
    useCarrito.getState().vaciar();
  });

  it('permite agregar una cantidad fija de un producto', async () => {
    const user = userEvent.setup();
    render(<VentaPage />);

    await screen.findByText('Cuaderno Carta');
    await user.click(screen.getByRole('button', { name: /Cuaderno Carta/i }));
    const cantidad = screen.getByLabelText(/Cantidad/i);
    await user.clear(cantidad);
    await user.type(cantidad, '6');
    await user.click(screen.getByRole('button', { name: 'Agregar' }));

    expect(await screen.findByText('$5.00 × 6')).toBeInTheDocument();
    expect(screen.getByTestId('total-usd')).toHaveTextContent('$30.00');
    useCarrito.getState().vaciar();
  });

  it('filtra el catálogo por categoría', async () => {
    const user = userEvent.setup();
    render(<VentaPage />);
    await screen.findByText('Cuaderno Carta');
    await screen.findByText('Tiza Blanca');

    await user.selectOptions(screen.getByLabelText('Filtrar por categoría'), '1');
    expect(screen.getByText('Cuaderno Carta')).toBeInTheDocument();
    expect(screen.queryByText('Tiza Blanca')).not.toBeInTheDocument();
    expect(screen.queryByText('Bolígrafo Azul')).not.toBeInTheDocument();

    // Volver a "todas" los deja aparecer otra vez: el filtro es del catálogo,
    // no borra nada.
    await user.selectOptions(screen.getByLabelText('Filtrar por categoría'), '');
    expect(await screen.findByText('Tiza Blanca')).toBeInTheDocument();
    expect(screen.getByText('Bolígrafo Azul')).toBeInTheDocument();
  });

  it('sigue vendiendo aunque no se puedan cargar las categorías', async () => {
    // El filtro por categoría es una comodidad, no un requisito: si la lista de
    // categorías falla, el catálogo entero tiene que seguir en pantalla y la
    // venta tiene que poder hacerse.
    const { listarCategorias } = await import('../services/db');
    vi.mocked(listarCategorias).mockRejectedValueOnce(new Error('sin categorías'));

    const user = userEvent.setup();
    render(<VentaPage />);
    await screen.findByText('Cuaderno Carta');

    expect(screen.queryByLabelText('Filtrar por categoría')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Cuaderno Carta/i }));
    await user.click(screen.getByRole('button', { name: 'Agregar' }));
    expect(await screen.findByText('$5.00 × 1')).toBeInTheDocument();
    useCarrito.getState().vaciar();
  });

  it('rechaza una cantidad superior al stock disponible', async () => {
    const user = userEvent.setup();
    render(<VentaPage />);

    await screen.findByText('Cuaderno Carta');
    await user.click(screen.getByRole('button', { name: /Cuaderno Carta/i }));
    const cantidad = screen.getByLabelText(/Cantidad/i);
    await user.clear(cantidad);
    await user.type(cantidad, '11');
    expect(screen.getByText(/Solo hay 10 disponibles/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agregar' })).toBeDisabled();
    expect(useCarrito.getState().lineas).toHaveLength(0);
  });

  it('aplica precio especial al cambiar de cliente', async () => {
    const user = userEvent.setup();
    render(<VentaPage />);
    await screen.findByText('Cuaderno Carta');

    const cliente = screen.getByLabelText(/Cliente/i);
    await user.click(cliente);
    await user.type(cliente, 'J-123');
    await user.click(await screen.findByRole('option', { name: /Distribuidora La Esquina/i }));

    await waitFor(() => expect(screen.getByText('$9.00')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Cuaderno Carta/i }));
    await user.click(screen.getByRole('button', { name: 'Agregar' }));
    expect(screen.getByText('$9.00 × 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cobrar/ })).toBeEnabled();
    useCarrito.getState().vaciar();
  });

  it('cobra y confirma la venta completa', async () => {
    const user = userEvent.setup();
    render(<VentaPage />);
    await screen.findByRole('button', { name: /Cuaderno Carta/i });

    await user.click(screen.getByRole('button', { name: /Cuaderno Carta/i }));
    await user.click(screen.getByRole('button', { name: 'Agregar' }));
    await user.click(screen.getByRole('button', { name: /Cobrar/ }));

    await user.type(screen.getAllByLabelText(/Monto pago/)[0], '5');
    await user.click(screen.getByRole('button', { name: 'Confirmar venta' }));

    expect(crearVenta).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'contado', cliente_id: 1, detalles: [{ producto_id: 1, cantidad: 1 }] }));
    expect(getFactura).toHaveBeenCalledWith(1);
    expect(await screen.findByText('Factura')).toBeInTheDocument();
    expect(screen.getByText('0012')).toBeInTheDocument();
    useCarrito.getState().vaciar();
  });
});