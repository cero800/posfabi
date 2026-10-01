import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { actualizarCategoria, crearCategoria, eliminarCategoria, listarCategorias } from '../services/db';
import CategoriasPage from './CategoriasPage';

/**
 * Un árbol de tres niveles: Papelería > Útiles > Cuadernos, más una categoría
 * suelta. Es lo justo para comprobar que la página calcula el padre que se
 * muestra (subiendo más de un nivel) y que al editar no ofrece los
 * descendientes como padre.
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
 * Busca por la primera celda y no con `getByText` a secas: el nombre de una
 * categoría aparece también en la columna "Dentro de" de sus hijas, así que
 * "Papelería" está en tres filas y un `getByText` de página entera daría
 * "elementos múltiples" —o, peor, encontraría la celda de una hija y la prueba
 * pasaría creyendo que miró la fila de la madre.
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
 * El texto de una celda por número de columna: 0 nombre, 1 dentro de, 2 orden,
 * 3 productos, 4 acciones.
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

  it('lista el árbol mostrando el padre de primer nivel, el orden y los productos', async () => {
    render(<CategoriasPage />);

    // "Cuadernos" cuelga de "Útiles", que a su vez cuelga de "Papelería": la
    // columna "Dentro de" muestra la raíz, no el padre inmediato, porque si no
    // el cajero de un catálogo anidado no sabe dónde está la cosa.
    expect(within(await filaDe('Cuadernos')).getByText('Papelería')).toBeInTheDocument();
    expect(within(await filaDe('Útiles')).getByText('Papelería')).toBeInTheDocument();

    // Una categoría de primer nivel no tiene padre: guion, no texto vacío.
    expect(within(await filaDe('Papelería')).getByText('—')).toBeInTheDocument();

    // Orden y número de productos, cada uno en su columna.
    const cuadernos = await filaDe('Cuadernos');
    expect(celda(cuadernos, 2)).toBe('1'); // orden
    expect(celda(cuadernos, 3)).toBe('1'); // productos
    expect(celda(await filaDe('Pizarra'), 2)).toBe('2'); // orden, sin productos
    expect(celda(await filaDe('Pizarra'), 3)).toBe('0');
  });

  it('avisa cuando no hay ninguna categoría', async () => {
    vi.mocked(listarCategorias).mockResolvedValueOnce([]);
    render(<CategoriasPage />);
    expect(await screen.findByText(/Sin categorías/)).toBeInTheDocument();
  });

  it('crea una categoría nueva mandando solo lo que se escribió', async () => {
    const user = userEvent.setup();
    render(<CategoriasPage />);
    await filaDe('Papelería');

    await user.click(screen.getByRole('button', { name: /Nueva categoría/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Nombre/), 'Marcadores');
    await user.selectOptions(within(dialog).getByLabelText(/Dentro de/), '1');
    await user.clear(within(dialog).getByLabelText(/Orden/));
    await user.type(within(dialog).getByLabelText(/Orden/), '5');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(crearCategoria).toHaveBeenCalledWith({
      nombre: 'Marcadores',
      parent_id: 1,
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
   * dejaría colgada de la raíz y con orden cero. Por eso va el objeto completo.
   */
  it('al editar manda la categoría entera, con su activo y su orden', async () => {
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

  it('al editar trae el padre y el orden que ya tenía', async () => {
    render(<CategoriasPage />);
    const dialog = await abrirEditor('Cuadernos');
    expect(within(dialog).getByLabelText(/Nombre/)).toHaveValue('Cuadernos');
    expect(within(dialog).getByLabelText(/Dentro de/)).toHaveValue('2');
    // El input de orden es `type="number"`, así que su valor es número.
    expect(within(dialog).getByLabelText(/Orden/)).toHaveValue(1);
  });

  it('no ofrece como padre la categoría misma ni sus descendientes', async () => {
    render(<CategoriasPage />);
    // Editando "Papelería" (1): ella misma y todo lo que cuelga de abajo —"Útiles"
    // (2) y "Cuadernos" (3)— quedarían en ciclo. Solo se ofrece "Pizarra" (4),
    // que no tiene nada que ver.
    const dialog = await abrirEditor('Papelería');
    const select = within(dialog).getByLabelText(/Dentro de/) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', '4']);
  });

  it('al editar una hoja sí se ofrecen sus parientes y las raíces', async () => {
    render(<CategoriasPage />);
    // "Cuadernos" (3) no tiene descendientes, así que puede mudarse a cualquier
    // otro sitio menos a sí misma: "Papelería" y "Pizarra" siguen valiendo, y
    // quedarse donde está también.
    const dialog = await abrirEditor('Cuadernos');
    const select = within(dialog).getByLabelText(/Dentro de/) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', '1', '2', '4']);
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