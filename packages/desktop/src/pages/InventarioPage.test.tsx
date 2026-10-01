import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { registrarAjuste, registrarEntradaMercancia, registrarMerma } from '../services/db';
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
  ]),
  listarCategorias: vi.fn().mockResolvedValue([
    { id: 1, nombre: 'Cuadernos', parent_id: null, orden: 0, activo: true, productos: 1 },
    { id: 2, nombre: 'Pizarra', parent_id: null, orden: 1, activo: true, productos: 1 },
  ]),
  registrarEntradaMercancia: vi.fn(),
  registrarMerma: vi.fn(),
  registrarAjuste: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(registrarEntradaMercancia).mockReset();
  vi.mocked(registrarMerma).mockReset();
  vi.mocked(registrarAjuste).mockReset();
  useSesion.setState({ operador: { id: 1, nombre: 'Ana', rol: 'admin', activo: true } });
});

/**
 * La fila de la tabla donde está el producto.
 *
 * El nombre de una categoría aparece dos veces en pantalla: como opción del
 * filtro y como celda de la fila. Buscarlo en toda la página da "elementos
 * múltiples" y, peor, un test que pasara buscando en cualquier lado, así que
 * las comprobaciones de categoría y de mínimo se hacen dentro de la fila.
 */
function filaDe(nombre: string): HTMLElement {
  const celda = screen.getByText(nombre);
  const fila = celda.closest('tr');
  if (fila === null) throw new Error(`no se encontró la fila de "${nombre}"`);
  return fila;
}

describe('InventarioPage', () => {
  it('muestra stock y alerta de agotados', async () => {
    render(<InventarioPage />);
    await screen.findByText('Cuaderno Carta');
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText(/stock agotado o negativo/)).toHaveTextContent('Tiza Blanca');
  });

  it('muestra la categoría y el mínimo, y avisa de lo que está por debajo', async () => {
    render(<InventarioPage />);
    await screen.findByText('Cuaderno Carta');

    // La categoría y el mínimo van en la fila del producto, no sueltos.
    const cuaderno = within(filaDe('Cuaderno Carta'));
    expect(cuaderno.getByText('Cuadernos')).toBeInTheDocument();
    expect(cuaderno.getByText('4')).toBeInTheDocument();

    // Un producto sin categoría no inventa una: muestra el guion de "nada".
    expect(within(filaDe('Bolígrafo Azul')).getByText('—')).toBeInTheDocument();

    expect(screen.getByText(/por debajo del mínimo/)).toHaveTextContent('Bolígrafo Azul');

    // Agotado, por debajo del mínimo y por encima: los tres estados distintos.
    // "Disponible" también es el rótulo de una columna, así que se mira dentro
    // de la fila para no encontrar la cabecera en vez de la insignia.
    expect(within(filaDe('Tiza Blanca')).getByText('Agotado')).toBeInTheDocument();
    expect(within(filaDe('Bolígrafo Azul')).getByText('Bajo mínimo')).toBeInTheDocument();
    expect(within(filaDe('Cuaderno Carta')).getByText('Disponible')).toBeInTheDocument();
  });

  it('filtra por categoría, y por los que no tienen ninguna', async () => {
    const user = userEvent.setup();
    render(<InventarioPage />);
    await screen.findByText('Cuaderno Carta');

    await user.selectOptions(screen.getByLabelText('Filtrar por categoría'), '1');
    expect(screen.getByText('Cuaderno Carta')).toBeInTheDocument();
    expect(screen.queryByText('Tiza Blanca')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Filtrar por categoría'), 'sin-categoria');
    expect(screen.getByText('Bolígrafo Azul')).toBeInTheDocument();
    expect(screen.queryByText('Cuaderno Carta')).not.toBeInTheDocument();
  });

  it('registra la recepción de mercancía con fecha y costo pre-cargado', async () => {
    const user = userEvent.setup();
    vi.mocked(registrarEntradaMercancia).mockResolvedValue(undefined as never);
    render(<InventarioPage />);
    await screen.findByText('Cuaderno Carta');

    // El botón de la cabecera. El de cada fila se llama «Recibir mercancía de X»,
    // así que un nombre exacto los distingue.
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

    // El botón de la fila, no el de la cabecera: uno abre el formulario con el
    // producto puesto y el otro con el primero de la lista.
    await user.click(screen.getByRole('button', { name: 'Recibir mercancía de Cuaderno Carta' }));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText(/Producto/) as HTMLSelectElement).value).toBe('1');
    expect((within(dialog).getByLabelText(/Costo unitario/) as HTMLInputElement).value).toBe('5.00');
  });

  it('exige motivo en la merma', async () => {
    const user = userEvent.setup();
    render(<InventarioPage />);
    await screen.findByText('Cuaderno Carta');

    await user.click(screen.getByRole('button', { name: /Merma/ }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/Producto/), '2');
    await user.type(within(dialog).getByLabelText(/Cantidad/), '1');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('motivo');
    expect(registrarMerma).not.toHaveBeenCalled();
  });

  it('registra un ajuste con delta', async () => {
    const user = userEvent.setup();
    vi.mocked(registrarAjuste).mockResolvedValue(undefined as never);
    render(<InventarioPage />);
    await screen.findByText('Cuaderno Carta');

    await user.click(screen.getByRole('button', { name: /Ajuste/ }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/Producto/), '1');
    await user.type(within(dialog).getByLabelText(/Cantidad/), '-2');
    await user.type(within(dialog).getByLabelText(/Motivo/), 'Inventario físico');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(registrarAjuste).toHaveBeenCalledWith({
      producto_id: 1,
      cantidad_delta: -2,
      motivo: 'Inventario físico',
      operador_id: 1,
    });
  });
});