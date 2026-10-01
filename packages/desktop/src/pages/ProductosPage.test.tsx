import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { actualizarProducto, crearProducto, eliminarProducto } from '../services/db';
import ProductosPage from './ProductosPage';

vi.mock('../services/db', () => ({
  listarProductos: vi.fn().mockResolvedValue([
    { id: 1, codigo: 'P1', nombre: 'Cuaderno Carta', descripcion: null, categoria_id: 1, unidad_medida: 'unidad', precio_base: 500, impuesto_porcentaje: 0, stock_minimo: 4, activo: true, creado_en: null },
    { id: 2, codigo: 'P2', nombre: 'Bolígrafo Azul', descripcion: null, categoria_id: 2, unidad_medida: 'unidad', precio_base: 150, impuesto_porcentaje: 15, stock_minimo: 12, activo: false, creado_en: null },
    { id: 3, codigo: 'P3', nombre: 'Tiza Blanca', descripcion: null, categoria_id: null, unidad_medida: 'unidad', precio_base: 80, impuesto_porcentaje: 0, stock_minimo: 6, activo: true, creado_en: null },
  ]),
  listarCategorias: vi.fn().mockResolvedValue([
    { id: 1, nombre: 'Cuadernos', parent_id: null, orden: 0, activo: true, productos: 1 },
    { id: 2, nombre: 'Escritura', parent_id: null, orden: 1, activo: true, productos: 1 },
  ]),
  crearProducto: vi.fn(),
  actualizarProducto: vi.fn(),
  eliminarProducto: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(crearProducto).mockReset();
  vi.mocked(actualizarProducto).mockReset();
  vi.mocked(eliminarProducto).mockReset();
  vi.stubGlobal('confirm', vi.fn(() => true));
});

/**
 * La fila de la tabla donde está el producto.
 *
 * El nombre de una categoría sale dos veces en pantalla: como opción del filtro
 * y como celda de la fila. Buscarlo en toda la página da "elementos múltiples",
 * y un `queryByText` que pasara mirando en cualquier lado no comprobaría que
 * la categoría se muestre *en la fila del producto*. Por eso se mira dentro de
 * la fila.
 */
function filaDe(nombre: string): HTMLElement {
  const celda = screen.getByText(nombre);
  const fila = celda.closest('tr');
  if (fila === null) throw new Error(`no se encontró la fila de "${nombre}"`);
  return fila;
}

describe('ProductosPage', () => {
  it('lista productos con precios formateados', async () => {
    render(<ProductosPage />);
    expect(await screen.findByText('Cuaderno Carta')).toBeInTheDocument();
    expect(screen.getByText('$5.00')).toBeInTheDocument();
    expect(screen.getByText('Bolígrafo Azul')).toBeInTheDocument();
    expect(screen.getByText('Inactivo')).toBeInTheDocument();
  });

  it('muestra la categoría y el mínimo de cada producto', async () => {
    render(<ProductosPage />);
    await screen.findByText('Cuaderno Carta');

    const cuaderno = within(filaDe('Cuaderno Carta'));
    expect(cuaderno.getByText('Cuadernos')).toBeInTheDocument();
    expect(cuaderno.getByText('4')).toBeInTheDocument();

    // El que no tiene categoría muestra el guion, no el nombre de otra.
    expect(within(filaDe('Tiza Blanca')).getByText('—')).toBeInTheDocument();
  });

  it('filtra por categoría y por los que no tienen ninguna', async () => {
    const user = userEvent.setup();
    render(<ProductosPage />);
    await screen.findByText('Cuaderno Carta');

    await user.selectOptions(screen.getByLabelText('Filtrar por categoría'), '1');
    expect(screen.getByText('Cuaderno Carta')).toBeInTheDocument();
    expect(screen.queryByText('Bolígrafo Azul')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Filtrar por categoría'), 'sin-categoria');
    expect(screen.getByText('Tiza Blanca')).toBeInTheDocument();
    expect(screen.queryByText('Cuaderno Carta')).not.toBeInTheDocument();
  });

  it('filtra por búsqueda', async () => {
    const user = userEvent.setup();
    render(<ProductosPage />);
    await screen.findByText('Cuaderno Carta');
    await user.type(screen.getByPlaceholderText(/Buscar por nombre/), 'bolígrafo');
    expect(screen.queryByText('Cuaderno Carta')).not.toBeInTheDocument();
    expect(screen.getByText('Bolígrafo Azul')).toBeInTheDocument();
  });

  it('crea un producto nuevo', async () => {
    const user = userEvent.setup();
    vi.mocked(crearProducto).mockResolvedValue(3 as never);
    render(<ProductosPage />);
    await screen.findByText('Cuaderno Carta');

    await user.click(screen.getByRole('button', { name: /Nuevo producto/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Nombre/), 'Resma carta');
    await user.selectOptions(within(dialog).getByLabelText(/Categoría/), '1');
    await user.type(within(dialog).getByLabelText(/Stock mínimo/), '3');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(crearProducto).toHaveBeenCalledWith(
      expect.objectContaining({
        nombre: 'Resma carta',
        precio_base: 0,
        stock_minimo: 3,
        categoria_id: 1,
        activo: true,
      }),
    );
  });

  it('acepta precios con decimales', async () => {
    const user = userEvent.setup();
    vi.mocked(crearProducto).mockResolvedValue(4 as never);
    render(<ProductosPage />);
    await screen.findByText('Cuaderno Carta');

    await user.click(screen.getByRole('button', { name: /Nuevo producto/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Nombre/), 'Cuaderno premium');
    await user.type(within(dialog).getByLabelText(/Precio/), '1.20');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(crearProducto).toHaveBeenCalledWith(
      expect.objectContaining({ nombre: 'Cuaderno premium', precio_base: 120 }),
    );
  });

  it('valida precios mal formados', async () => {
    const user = userEvent.setup();
    render(<ProductosPage />);
    await screen.findByText('Cuaderno Carta');

    await user.click(screen.getByRole('button', { name: /Nuevo producto/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Nombre/), 'X');
    await user.type(within(dialog).getByLabelText(/Precio/), '1.2.3');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('precio válido');
    expect(crearProducto).not.toHaveBeenCalled();
  });

  it('valida que el stock mínimo no sea negativo', async () => {
    const user = userEvent.setup();
    render(<ProductosPage />);
    await screen.findByText('Cuaderno Carta');

    await user.click(screen.getByRole('button', { name: /Nuevo producto/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Nombre/), 'X');
    // El campo viene con "0", así que hay que vaciarlo antes de escribir el
    // signo: si se teclea encima quedaría "0-5", que no es un número y el
    // formulario lo tomaría como cero.
    const minimo = within(dialog).getByLabelText(/Stock mínimo/);
    await user.clear(minimo);
    await user.type(minimo, '-5');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('no puede ser negativo');
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
    render(<ProductosPage />);
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
    render(<ProductosPage />);
    await screen.findByText('Cuaderno Carta');
    await user.click(screen.getByRole('button', { name: /Eliminar Cuaderno Carta/ }));
    expect(confirm).toHaveBeenCalled();
    expect(eliminarProducto).toHaveBeenCalledWith(1);
  });

  it('valida que el nombre sea obligatorio', async () => {
    const user = userEvent.setup();
    render(<ProductosPage />);
    await screen.findByText('Cuaderno Carta');
    await user.click(screen.getByRole('button', { name: /Nuevo producto/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('nombre es obligatorio');
    expect(crearProducto).not.toHaveBeenCalled();
  });
});