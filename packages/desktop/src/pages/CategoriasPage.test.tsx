import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { actualizarCategoria, crearCategoria, eliminarCategoria, listarCategorias } from '../services/db';
import CategoriasPage from './CategoriasPage';

/**
 * Cuatro categorías, dos activas y una desactivada.
 *
 * `parent_id` sigue en los datos —la base y la API lo conservan— aunque la
 * pantalla ya no lo muestre ni lo edite: así las pruebas cubren que una base
 * con categorías anidadas de antes se lista sin romperse.
 */
const ARBOL = [
  { id: 1, nombre: 'Papelería', parent_id: null, orden: 0, activo: true, productos: 4 },
  { id: 2, nombre: 'Útiles', parent_id: 1, orden: 0, activo: true, productos: 2 },
  { id: 3, nombre: 'Cuadernos', parent_id: 2, orden: 1, activo: true, productos: 1 },
  { id: 4, nombre: 'Pizarra', parent_id: null, orden: 2, activo: false, productos: 0 },
];

vi.mock('../services/db', () => ({
  // Sin implementación dentro de la fábrica: `vi.mock` se sube al principio del
  // archivo y no puede leer `ARBOL`, que todavía no existe ahí. Los valores por
  // defecto se ponen en el `beforeEach`.
  listarCategorias: vi.fn(),
  crearCategoria: vi.fn(),
  actualizarCategoria: vi.fn(),
  eliminarCategoria: vi.fn(),
}));

/**
 * La fila donde está la categoría, esperando a que la lista cargue.
 *
 * Busca por la primera celda y no con `getByText` a secas: los nombres se
 * repiten entre filas y un `getByText` de página entera daría "elementos
 * múltiples" —o, peor, encontraría la celda equivocada y la prueba pasaría
 * creyendo que miró la fila correcta.
 */
async function filaDe(nombre: string): Promise<HTMLElement> {
  return waitFor(() => {
    const fila = Array.from(document.querySelectorAll('tbody tr')).find(
      (f) => f.querySelector('td')?.textContent?.trim() === nombre,
    );
    if (fila === undefined) throw new Error(`no se encontró la fila de "${nombre}"`);
    return fila as HTMLElement;
  });
}

/**
 * El texto de una celda por número de columna: 0 nombre, 1 orden, 2 productos,
 * 3 acciones.
 *
 * Hace falta porque orden y número de productos son las dos columnas de números
 * y se repiten entre filas: en la fila de "Cuadernos" hay dos "1", el orden y
 * el conteo. Buscar el texto sin saber la columna comprobaría que el número
 * existe en algún lado, no que esté en la columna que dice estar.
 */
function celda(fila: HTMLElement, columna: number): string {
  return fila.querySelectorAll('td')[columna]?.textContent?.trim() ?? '';
}

/** El diálogo de edición de la categoría indicada, abierto. */
async function abrirEditor(nombre: string): Promise<HTMLElement> {
  const user = userEvent.setup();
  await filaDe(nombre);
  await user.click(screen.getByRole('button', { name: `Editar ${nombre}` }));
  return screen.getByRole('dialog');
}

describe('CategoriasPage', () => {
  beforeEach(() => {
    vi.mocked(listarCategorias).mockReset();
    vi.mocked(listarCategorias).mockResolvedValue(ARBOL as never);
    vi.mocked(crearCategoria).mockReset();
    vi.mocked(crearCategoria).mockResolvedValue(undefined as never);
    vi.mocked(actualizarCategoria).mockReset();
    vi.mocked(actualizarCategoria).mockResolvedValue(undefined as never);
    vi.mocked(eliminarCategoria).mockReset();
    vi.mocked(eliminarCategoria).mockResolvedValue(undefined as never);
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('alert', vi.fn());
  });

  it('lista las categorías con el orden y los productos', async () => {
    render(<CategoriasPage />);

    // Orden y número de productos, cada uno en su columna.
    const cuadernos = await filaDe('Cuadernos');
    expect(celda(cuadernos, 1)).toBe('1'); // orden
    expect(celda(cuadernos, 2)).toBe('1'); // productos
    expect(celda(await filaDe('Pizarra'), 1)).toBe('2'); // orden, sin productos
    expect(celda(await filaDe('Pizarra'), 2)).toBe('0');
  });

  it('no muestra la columna de árbol: el alta ya no pregunta «Dentro de»', async () => {
    render(<CategoriasPage />);
    await filaDe('Papelería');
    expect(screen.queryByText('Dentro de')).not.toBeInTheDocument();
  });

  it('avisa cuando no hay ninguna categoría', async () => {
    vi.mocked(listarCategorias).mockResolvedValueOnce([]);
    render(<CategoriasPage />);
    expect(await screen.findByText(/Sin categorías/)).toBeInTheDocument();
  });

  it('crea una categoría nueva de primer nivel con solo nombre y orden', async () => {
    const user = userEvent.setup();
    render(<CategoriasPage />);
    await filaDe('Papelería');

    await user.click(screen.getByRole('button', { name: /Nueva categoría/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Nombre/), 'Marcadores');
    await user.clear(within(dialog).getByLabelText(/Orden/));
    await user.type(within(dialog).getByLabelText(/Orden/), '5');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(crearCategoria).toHaveBeenCalledWith({
      nombre: 'Marcadores',
      parent_id: null,
      orden: 5,
    });
  });

  it('exige nombre y un orden que sea un entero', async () => {
    const user = userEvent.setup();
    render(<CategoriasPage />);
    await filaDe('Papelería');

    await user.click(screen.getByRole('button', { name: /Nueva categoría/ }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El nombre es obligatorio');

    await user.type(within(dialog).getByLabelText(/Nombre/), 'X');
    const orden = within(dialog).getByLabelText(/Orden/);
    await user.clear(orden);
    await user.type(orden, '1.5');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El orden debe ser un número entero');

    expect(crearCategoria).not.toHaveBeenCalled();
  });

  /**
   * `actualizar_categoria` reescribe la fila entera, `parent_id` y `orden`
   * incluidos. Si el formulario mandara un parche, renombrar una categoría la
   * dejaría sin padre y con orden cero. Por eso va el objeto completo: aquí se
   * comprueba que el `parent_id` que ya tenía se conserva tal cual, sin que la
   * pantalla lo toque.
   */
  it('al editar manda la categoría entera, conservando su parent_id y su activo', async () => {
    render(<CategoriasPage />);
    const dialog = await abrirEditor('Cuadernos');
    const user = userEvent.setup();
    const nombre = within(dialog).getByLabelText(/Nombre/);
    await user.clear(nombre);
    await user.type(nombre, 'Cuadernos escolar');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(actualizarCategoria).toHaveBeenCalledWith(3, {
      nombre: 'Cuadernos escolar',
      parent_id: 2,
      orden: 1,
      activo: true,
    });
  });

  it('al editar trae el nombre y el orden que ya tenía', async () => {
    render(<CategoriasPage />);
    const dialog = await abrirEditor('Cuadernos');
    expect(within(dialog).getByLabelText(/Nombre/)).toHaveValue('Cuadernos');
    // El input de orden es `type="number"`, así que su valor es número.
    expect(within(dialog).getByLabelText(/Orden/)).toHaveValue(1);
  });

  /**
   * Desactivar no borra: descolga los productos que cuelgan de ahí. Si el
   * diálogo no dijera cuántos son, el usuario cerraría pensando que se iba a
   * quedar con el catálogo descuadrado sin aviso.
   */
  it('desactiva con un aviso que dice cuántos productos quedan sin categoría', async () => {
    const user = userEvent.setup();
    render(<CategoriasPage />);
    await filaDe('Papelería');
    await user.click(screen.getByRole('button', { name: 'Desactivar Papelería' }));

    const aviso = String(vi.mocked(confirm).mock.calls[0]?.[0]);
    expect(aviso).toMatch(/4 producto/);
    expect(aviso).toMatch(/quedarán sin categoría/);
    expect(aviso).toMatch(/no se borran/);
    expect(eliminarCategoria).toHaveBeenCalledWith(1);
  });

  it('una categoría sin productos se desactiva sin el aviso largo', async () => {
    const user = userEvent.setup();
    render(<CategoriasPage />);
    await filaDe('Pizarra');
    await user.click(screen.getByRole('button', { name: 'Desactivar Pizarra' }));

    expect(String(vi.mocked(confirm).mock.calls[0]?.[0])).toBe('¿Desactivar "Pizarra"?');
    expect(eliminarCategoria).toHaveBeenCalledWith(4);
  });

  it('no desactiva si el usuario dice que no', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const user = userEvent.setup();
    render(<CategoriasPage />);
    await filaDe('Papelería');
    await user.click(screen.getByRole('button', { name: 'Desactivar Papelería' }));

    expect(confirm).toHaveBeenCalled();
    expect(eliminarCategoria).not.toHaveBeenCalled();
  });
});
