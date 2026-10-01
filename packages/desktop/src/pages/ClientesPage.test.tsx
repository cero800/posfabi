import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { crearCliente, eliminarCliente } from '../services/db';
import ClientesPage from './ClientesPage';

vi.mock('../services/db', () => ({
  listarClientes: vi.fn().mockResolvedValue([
    { id: 1, documento: '0', nombre: 'Consumidor Final', razon_social: null, telefono: null, email: null, direccion: null, dias_credito: 0, limite_credito: 0, activo: true, creado_en: null },
    { id: 2, documento: 'J-123', nombre: 'Distribuidora La Esquina', razon_social: null, telefono: null, email: null, direccion: null, dias_credito: 15, limite_credito: 5000, activo: true, creado_en: null },
  ]),
  crearCliente: vi.fn(),
  eliminarCliente: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(crearCliente).mockReset();
  vi.mocked(eliminarCliente).mockReset();
  vi.stubGlobal('confirm', vi.fn(() => true));
});

describe('ClientesPage', () => {
  it('no muestra a Consumidor Final como cliente', async () => {
    render(<ClientesPage />);
    await screen.findByText('Distribuidora La Esquina');
    expect(screen.queryByText('Consumidor Final')).not.toBeInTheDocument();
    expect(screen.getByText('J-123')).toBeInTheDocument();
  });

  it('crea un cliente nuevo', async () => {
    const user = userEvent.setup();
    vi.mocked(crearCliente).mockResolvedValue(9 as never);
    render(<ClientesPage />);
    await screen.findByText('Distribuidora La Esquina');

    await user.click(screen.getByRole('button', { name: /Nuevo cliente/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Nombre/), 'Colegio Santa María');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(crearCliente).toHaveBeenCalledWith(
      expect.objectContaining({ nombre: 'Colegio Santa María', dias_credito: 0, activo: true }),
    );
  });

  it('guarda un límite de crédito mayor que 9 dólares', async () => {
    const user = userEvent.setup();
    vi.mocked(crearCliente).mockResolvedValue(9 as never);
    render(<ClientesPage />);
    await screen.findByText('Distribuidora La Esquina');

    await user.click(screen.getByRole('button', { name: /Nuevo cliente/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Nombre/), 'Colegio Santa María');
    await user.type(within(dialog).getByLabelText(/Límite de crédito/), '25');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    expect(crearCliente).toHaveBeenCalledWith(expect.objectContaining({ limite_credito: 2500 }));
  });

  it('elimina un cliente con confirmación', async () => {
    const user = userEvent.setup();
    render(<ClientesPage />);
    await screen.findByText('Distribuidora La Esquina');
    await user.click(screen.getByRole('button', { name: /Eliminar Distribuidora La Esquina/ }));
    expect(confirm).toHaveBeenCalled();
    expect(eliminarCliente).toHaveBeenCalledWith(2);
  });
});