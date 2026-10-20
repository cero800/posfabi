import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  actualizarProducto,
  crearProducto,
  eliminarProducto,
  registrarEntradaMercancia,
  registrarMovimientoInventario,
} from '../services/db';
import { useSesion } from '../store/sesion';
import InventarioPage from './InventarioPage';

vi.mock('../services/db', () => ({
  listarStock: vi.fn().mockResolvedValue([
    {
      producto_id: 1,
      nombre: 'Cuaderno Carta',
      codigo: 'P1',
      cantidad_disponible: 10,
      stock_minimo: 4,
      unidad_medida: 'unidad',
      categoria_id: 1,
      categoria_nombre: 'Cuadernos',
    },
    {
      producto_id: 2,
      nombre: 'Tiza Blanca',
      codigo: 'P2',
      cantidad_disponible: 0,
      stock_minimo: 6,
      unidad_medida: 'unidad',
      categoria_id: 2,
      categoria_nombre: 'Pizarra',
    },
    {
      producto_id: 3,
      nombre: 'Bolígrafo Azul',
      codigo: 'P3',
      cantidad_disponible: 3,
      stock_minimo: 12,
      unidad_medida: 'unidad',
      categoria_id: null,
      categoria_nombre: null,
    },
  ]),
  listarProductos: vi.fn().mockResolvedValue([
    { id: 1, codigo: 'P1', nombre: 'Cuaderno Carta', descripcion: null, categoria_id: 1, unidad_medida: 'unidad', precio_base: 500, impuesto_porcentaje: 0, stock_minimo: 4, activo: true, creado_en: null },
    { id: 2, codigo: 'P2', nombre: 'Tiza Blanca', descripcion: null, categoria_id: 2, unidad_medida: 'unidad', precio_base: 800, impuesto_porcentaje: 0, stock_minimo: 6, activo: true, creado_en: null },
    { id: 3, codigo: 'P3', nombre: 'Bolígrafo Azul', descripcion: null, categoria_id: null, unidad_medida: 'unidad', precio_base: 150, impuesto_porcentaje: 0, stock_minimo: 12, activo: true, creado_en: null },
    // Un producto inactivo y sin fila de stock: tiene que verse igual, con 0.
    { id: 4, codigo: 'P4', nombre: 'Marcador Viejo', descripcion: null, categoria_id: 1, unidad_medida: 'unidad', precio_base: 300, impuesto_porcentaje: 0, stock_minimo: 0, activo: false, creado_en: null },
  ]),
  listarCategorias: vi.fn().mockResolvedValue([
    { id: 1, nombre: 'Cuadernos', parent_id: null, orden: 0, activo: true, productos: 1 },
    { id: 2, nombre: 'Pizarra', parent_id: null, orden: 1, activo: true, productos: 1 },
  ]),
  crearProducto: vi.fn(),
  actualizarProducto: vi.fn(),
  eliminarProducto: vi.fn(),
  registrarEntradaMercancia: vi.fn(),
  registrarMovimientoInventario: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(crearProducto).mockReset();
  vi.mocked(actualizarProducto).mockReset();
  vi.mocked(eliminarProducto).mockReset();
  vi.mocked(registrarEntradaMercancia).mockReset();
  vi.mocked(registrarMovimientoInventario).mockReset();
  vi.stubGlobal('confirm', vi.fn(() => true));
  useSesion.setState({ operador: { id: 1, nombre: 'Ana', rol: 'admin', activo: true } });
});

/**
 * La fila de la tabla donde está el producto.
 *
 * El nombre de una categoría aparece dos veces en pantalla: como opción del
 * filtro y como celda de la fila. Buscarlo en toda la página da "elementos
 * múltiples", así que las comprobaciones de categoría y de mínimo se hacen
 * dentro de la fila.
 */
function filaDe(nombre: string): HTMLElement {
  const celda = screen.getByText(nombre);
  const fila = celda.closest('tr');
  if (fila === null) throw new Error(`no se encontró la fila de "${nombre}"`);
  return fila;
}

describe('InventarioPage', () => {
  it('muestra el catálogo con precio, stock y alerta de agotados', async () => {
    render(<InventarioPage />);
    await screen.findByText('Cuaderno Carta');

    // Precio (catálogo) y disponible (existencias) en la misma fila.
    expect(within(filaDe('Cuaderno Carta')).getByText('$5.00')).toBeInTheDocument();
    expect(within(filaDe('Cuaderno Carta')).getByText('10')).toBeInTheDocument();

    expect(screen.getByText(/stock agotado o negativo/)).toHaveTextContent('Tiza Blanca');
  });

  it('muestra también los productos inactivos, sin fila de stock', async () => {
    render(<InventarioPage />);
    await screen.findByText('Cuaderno Carta');

    // El inactivo se ve, marcado como tal, y con 0 disponible en vez de guion.
    // «0» sale dos veces en la fila —disponible y mínimo—, así que el disponible
    // se busca por su clase, que es la que lo distingue del mínimo apagado.
    const marcador = filaDe('Marcador Viejo');
    expect(within(marcador).getByText('Inactivo')).toBeInTheDocument();
    expect(marcador.querySelector('td.text-right.font-semibold')?.textContent).toBe('0');
  });

  it('muestra la categoría y el mínimo, y avisa de lo que está por debajo', async () => {
    render(<InventarioPage />);
    await screen.findByText('Cuaderno Carta');

    const cuaderno = within(filaDe('Cuaderno Carta'));
    expect(cuaderno.getByText('Cuadernos')).toBeInTheDocument();
    expect(cuaderno.getByText('4')).toBeInTheDocument();

    // Un producto sin categoría no inventa una: muestra el guion de "nada".
    expect(within(filaDe('Bolígrafo Azul')).getByText('—')).toBeInTheDocument();

    expect(screen.getByText(/por debajo del mínimo/)).toHaveTextContent('Bolígrafo Azul');

    expect(within(filaDe('Tiza Blanca')).getByText('Agotado')).toBeInTheDocument();
    expect(within(filaDe('Bolígrafo Azul')).getByText('Bajo mínimo')).toBeInTheDocument();
    expect(within(filaDe('Cuaderno Carta')).getByText('Disponible')).toBeInTheDocument();
  });

  it('filtra por categoría, por los que no tienen ninguna y por estado', async () => {
    const user = userEvent.setup();
    render(<InventarioPage />);
    await screen.findByText('Cuaderno Carta');

    await user.selectOptions(screen.getByLabelText('Filtrar por categoría'), '1');
    expect(screen.getByText('Cuaderno Carta')).toBeInTheDocument();
    expect(screen.queryByText('Tiza Blanca')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Filtrar por categoría'), 'sin-categoria');
    expect(screen.getByText('Bolígrafo Azul')).toBeInTheDocument();
    expect(screen.queryByText('Cuaderno Carta')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Filtrar por categoría'), '');
    await user.selectOptions(screen.getByLabelText('Filtrar por estado'), 'inactivos');
    expect(screen.getByText('Marcador Viejo')).toBeInTheDocument();
    expect(screen.queryByText('Cuaderno Carta')).not.toBeInTheDocument();
  });

  it('filtra por búsqueda', async () => {
    const user = userEvent.setup();
    render(<InventarioPage />);
    await screen.findByText('Cuaderno Carta');

    await user.type(screen.getByPlaceholderText(/Buscar por nombre/), 'bolígrafo');
    expect(screen.queryByText('Cuaderno Carta')).not.toBeInTheDocument();
    expect(screen.getByText('Bolígrafo Azul')).toBeInTheDocument();
  });

  it('crea un producto y carga su stock inicial como entrada', async () => {
    const user = userEvent.setup();
    vi.mocked(crearProducto).mockResolvedValue(9 as never);
    vi.mocked(registrarEntradaMercancia).mockResolvedValue(undefined as never);
    render(<InventarioPage />);
    await screen.findByText('Cuaderno Carta');

    await user.click(screen.getByRole('button', { name: /Nuevo producto/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Nombre/), 'Resma carta');
    await user.selectOptions(within(dialog).getByLabelText(/Categoría/), '1');
    await user.type(within(dialog).getByLabelText(/Precio/), '1.20');
    await user.type(within(dialog).getByLabelText(/Stock mínimo/), '3');
    await user.type(within(dialog).getByLabelText(/Cantidad inicial/), '20');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(crearProducto).toHaveBeenCalledWith(
      expect.objectContaining({
        nombre: 'Resma carta',
        precio_base: 120,
        stock_minimo: 3,
        categoria_id: 1,
        activo: true,
      }),
    );
    // El stock inicial entra como movimiento, no como un INSERT suelto.
    expect(registrarEntradaMercancia).toHaveBeenCalledWith(
      expect.objectContaining({ producto_id: 9, cantidad: 20, operador_id: 1, fecha: expect.any(String) }),
    );
  });

  it('no registra entrada cuando se crea sin cantidad inicial', async () => {
    const user = userEvent.setup();
    vi.mocked(crearProducto).mockResolvedValue(9 as never);
    render(<InventarioPage />);
    await screen.findByText('Cuaderno Carta');

    await user.click(screen.getByRole('button', { name: /Nuevo producto/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Nombre/), 'Sin stock');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(crearProducto).toHaveBeenCalled();
    expect(registrarEntradaMercancia).not.toHaveBeenCalled();
  });

  it('valida precios mal formados y stock mínimo negativo', async () => {
    const user = userEvent.setup();
    render(<InventarioPage />);
    await screen.findByText('Cuaderno Carta');

    await user.click(screen.getByRole('button', { name: /Nuevo producto/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Nombre/), 'X');
    await user.type(within(dialog).getByLabelText(/Precio/), '1.2.3');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('precio válido');
    expect(crearProducto).not.toHaveBeenCalled();

    await user.clear(within(dialog).getByLabelText(/Precio/));
    await user.type(within(dialog).getByLabelText(/Precio/), '1');
    const minimo = within(dialog).getByLabelText(/Stock mínimo/);
    await user.clear(minimo);
    await user.type(minimo, '-5');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no puede ser negativo');
    expect(crearProducto).not.toHaveBeenCalled();
  });

  it('valida que el nombre sea obligatorio', async () => {
    const user = userEvent.setup();
    render(<InventarioPage />);
    await screen.findByText('Cuaderno Carta');

    await user.click(screen.getByRole('button', { name: /Nuevo producto/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('nombre es obligatorio');
    expect(crearProducto).not.toHaveBeenCalled();
  });

  /**
   * El backend reemplaza la fila entera al editar, así que el formulario tiene
   * que mandar todos los campos. Antes mandaba cinco y cada renombrado dejaba el
   * producto sin categoría, sin mínimo, sin descripción y sin código de barras.
   */
  it('al editar no pierde la categoría ni el stock mínimo', async () => {
    const user = userEvent.setup();
    vi.mocked(actualizarProducto).mockResolvedValue(undefined as never);
    render(<InventarioPage />);
    await screen.findByText('Cuaderno Carta');

    await user.click(screen.getByRole('button', { name: /Editar Cuaderno Carta/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Nombre/), ' (bobina)');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(actualizarProducto).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        nombre: 'Cuaderno Carta (bobina)',
        categoria_id: 1,
        stock_minimo: 4,
        unidad_medida: 'unidad',
        precio_base: 500,
        impuesto_porcentaje: 0,
        activo: true,
      }),
    );
  });

  it('elimina un producto con confirmación', async () => {
    const user = userEvent.setup();
    render(<InventarioPage />);
    await screen.findByText('Cuaderno Carta');

    await user.click(screen.getByRole('button', { name: /Eliminar Cuaderno Carta/ }));
    expect(confirm).toHaveBeenCalled();
    expect(eliminarProducto).toHaveBeenCalledWith(1);
  });

  it('activar y desactivar manda el producto completo con el estado invertido', async () => {
    const user = userEvent.setup();
    vi.mocked(actualizarProducto).mockResolvedValue(undefined as never);
    render(<InventarioPage />);
    await screen.findByText('Cuaderno Carta');

    await user.click(screen.getByRole('button', { name: /Desactivar Cuaderno Carta/ }));
    expect(actualizarProducto).toHaveBeenCalledWith(1, expect.objectContaining({ activo: false }));
  });

  it('registra la recepción de mercancía con fecha y costo pre-cargado', async () => {
    const user = userEvent.setup();
    vi.mocked(registrarEntradaMercancia).mockResolvedValue(undefined as never);
    render(<InventarioPage />);
    await screen.findByText('Cuaderno Carta');

    await user.click(screen.getByRole('button', { name: 'Recibir mercancía' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/Producto/), '1');
    const costoInput = within(dialog).getByLabelText(/Costo unitario/) as HTMLInputElement;
    expect(costoInput.value).toBe('5.00');
    await user.type(within(dialog).getByLabelText(/Cantidad/), '2.5');
    await user.clear(costoInput);
    await user.type(costoInput, '1.2');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(registrarEntradaMercancia).toHaveBeenCalledWith(
      expect.objectContaining({
        producto_id: 1,
        cantidad: 2.5,
        costo_unitario: 120,
        operador_id: 1,
        fecha: expect.any(String),
      }),
    );
  });

  it('pre-carga el costo unitario con el precio base al usar el botón Recibir de la fila', async () => {
    const user = userEvent.setup();
    render(<InventarioPage />);
    await screen.findByText('Cuaderno Carta');

    await user.click(screen.getByRole('button', { name: 'Recibir mercancía de Cuaderno Carta' }));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText(/Producto/) as HTMLSelectElement).value).toBe('1');
    expect((within(dialog).getByLabelText(/Costo unitario/) as HTMLInputElement).value).toBe('5.00');
  });

  it('el movimiento de pérdida resta sin pedir el signo y asienta la etiqueta del motivo', async () => {
    const user = userEvent.setup();
    vi.mocked(registrarMovimientoInventario).mockResolvedValue(undefined as never);
    render(<InventarioPage />);
    await screen.findByText('Cuaderno Carta');

    await user.click(screen.getByRole('button', { name: /Movimiento/ }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/Producto/), '2');
    await user.type(within(dialog).getByLabelText(/Cantidad/), '3');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(registrarMovimientoInventario).toHaveBeenCalledWith({
      producto_id: 2,
      cantidad: 3,
      motivo: 'roto',
      detalle: null,
      operador_id: 1,
    });
  });

  it('rechaza una cantidad negativa en un motivo de pérdida', async () => {
    const user = userEvent.setup();
    render(<InventarioPage />);
    await screen.findByText('Cuaderno Carta');

    await user.click(screen.getByRole('button', { name: /Movimiento/ }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/Producto/), '2');
    await user.type(within(dialog).getByLabelText(/Cantidad/), '-3');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('mayor que cero');
    expect(registrarMovimientoInventario).not.toHaveBeenCalled();
  });

  it('el error de conteo sí acepta signo negativo', async () => {
    const user = userEvent.setup();
    vi.mocked(registrarMovimientoInventario).mockResolvedValue(undefined as never);
    render(<InventarioPage />);
    await screen.findByText('Cuaderno Carta');

    await user.click(screen.getByRole('button', { name: /Movimiento/ }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/Producto/), '1');
    await user.selectOptions(within(dialog).getByLabelText(/Motivo/), 'error_conteo');
    await user.type(within(dialog).getByLabelText(/Cantidad/), '-4');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(registrarMovimientoInventario).toHaveBeenCalledWith(
      expect.objectContaining({ producto_id: 1, cantidad: -4, motivo: 'error_conteo', operador_id: 1 }),
    );
  });

  it('exige explicación cuando el motivo es «Otro»', async () => {
    const user = userEvent.setup();
    render(<InventarioPage />);
    await screen.findByText('Cuaderno Carta');

    await user.click(screen.getByRole('button', { name: /Movimiento/ }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/Producto/), '1');
    await user.selectOptions(within(dialog).getByLabelText(/Motivo/), 'otro');
    await user.type(within(dialog).getByLabelText(/Cantidad/), '1');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('explicación');
    expect(registrarMovimientoInventario).not.toHaveBeenCalled();
  });
});
