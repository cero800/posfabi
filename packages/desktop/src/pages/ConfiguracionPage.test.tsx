import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NEGOCIO_CONFIG_KEYS } from '@tienda/core';
import {
  cambiarPin,
  crearBackup,
  eliminarBackup,
  getConfig,
  hayBackupHoy,
  listarBackups,
  obtenerDatosNegocio,
  obtenerDestinoImpresora,
  setConfig,
} from '../services/db';
import { useSesion } from '../store/sesion';
import ConfiguracionPage from './ConfiguracionPage';

/**
 * Sin valores por defecto dentro de la fábrica: `vi.mock` se sube al principio del
 * archivo y no puede leer las constantes de abajo. Se ponen en el `beforeEach`.
 */
vi.mock('../services/db', () => ({
  obtenerDatosNegocio: vi.fn(),
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  cambiarPin: vi.fn(),
  crearBackup: vi.fn(),
  eliminarBackup: vi.fn(),
  listarBackups: vi.fn(),
  hayBackupHoy: vi.fn(),
  obtenerDestinoImpresora: vi.fn(),
  configurarDestinoImpresora: vi.fn(),
  listarImpresoras: vi.fn(),
  probarImpresora: vi.fn(),
}));

const NEGOCIO = {
  nombre: 'Papelería Don Carlos',
  rif: 'J-12345678-9',
  telefono: '0414-0000000',
  direccion: 'Av. Bolívar, Caracas',
};

beforeEach(() => {
  useSesion.setState({ operador: { id: 7, nombre: 'Ana', rol: 'admin', activo: true } });
  vi.mocked(obtenerDatosNegocio).mockReset();
  vi.mocked(obtenerDatosNegocio).mockResolvedValue(NEGOCIO);
  vi.mocked(getConfig).mockReset();
  vi.mocked(getConfig).mockResolvedValue('5');
  vi.mocked(setConfig).mockReset();
  vi.mocked(setConfig).mockResolvedValue(undefined as never);
  vi.mocked(cambiarPin).mockReset();
  vi.mocked(cambiarPin).mockResolvedValue(undefined as never);
  vi.mocked(crearBackup).mockReset();
  vi.mocked(crearBackup).mockResolvedValue({
    nombre: '20260930-210000',
    fecha: '2026-09-30 21:00:00',
    tamano_bytes: 2048,
    ruta: 'C:\\copias\\20260930-210000',
  } as never);
  vi.mocked(eliminarBackup).mockReset();
  vi.mocked(eliminarBackup).mockResolvedValue(undefined as never);
  vi.mocked(listarBackups).mockReset();
  vi.mocked(listarBackups).mockResolvedValue([
    { nombre: '20260930-210000', fecha: '2026-09-30 21:00:00', tamano_bytes: 2048, ruta: 'C:\\copias\\20260930-210000' },
    { nombre: '20260929-210000', fecha: '2026-09-29 21:00:00', tamano_bytes: 1_048_576, ruta: 'C:\\copias\\20260929-210000' },
  ]);
  vi.mocked(hayBackupHoy).mockReset();
  vi.mocked(hayBackupHoy).mockResolvedValue(true);
  vi.mocked(obtenerDestinoImpresora).mockReset();
  vi.mocked(obtenerDestinoImpresora).mockResolvedValue({
    tipo: 'red',
    host: '192.168.1.50',
    puerto: 9100,
  });
});

describe('ConfiguracionPage', () => {
  it('carga los datos del negocio y los guarda', async () => {
    const user = userEvent.setup();
    render(<ConfiguracionPage />);

    const nombre = await screen.findByLabelText(/Nombre del negocio/);
    expect(nombre).toHaveValue('Papelería Don Carlos');
    expect(screen.getByLabelText('RIF')).toHaveValue('J-12345678-9');

    await user.clear(nombre);
    await user.type(nombre, 'Papelería Don Carlos C.A.');
    await user.click(screen.getByRole('button', { name: /Guardar/ }));

    // Hay varios `role="status"` en la página (el de guardar y el de la copia
    // de hoy), así que se busca el texto del que se quiere comprobar.
    expect(await screen.findByText('Datos guardados correctamente')).toBeInTheDocument();
    expect(setConfig).toHaveBeenCalledWith(NEGOCIO_CONFIG_KEYS.nombre, 'Papelería Don Carlos C.A.');
    expect(setConfig).toHaveBeenCalledWith(NEGOCIO_CONFIG_KEYS.rif, 'J-12345678-9');
  });

  /**
   * Si los datos del negocio no se pueden leer, la pantalla se abre igual con
   * los campos vacíos. Perder el nombre por un `get_config` que falló sería
   * dejar a alguien Guardando encima de un formulario en blanco.
   */
  it('se abre aunque no se puedan leer los datos del negocio', async () => {
    vi.mocked(obtenerDatosNegocio).mockRejectedValue(new Error('sin config'));
    render(<ConfiguracionPage />);

    expect(await screen.findByLabelText(/Nombre del negocio/)).toHaveValue('');
  });

  it('describe la impresora configurada', async () => {
    render(<ConfiguracionPage />);
    expect(await screen.findByText('192.168.1.50:9100 (red)')).toBeInTheDocument();
  });

  it('dice que no hay impresora cuando no hay ninguna', async () => {
    vi.mocked(obtenerDestinoImpresora).mockResolvedValue(null);
    render(<ConfiguracionPage />);
    expect(await screen.findByText(/No hay impresora configurada/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Configurar' })).toBeInTheDocument();
  });

  it('avisa que hoy ya hay copia automática y lista las copias', async () => {
    render(<ConfiguracionPage />);
    expect(await screen.findByText(/Hoy ya hay una copia automática/)).toBeInTheDocument();
    expect(screen.getByText('20260930-210000')).toBeInTheDocument();
    // El tamaño se formatea, no se suelta en bytes: 1 MB y no 1048576.
    expect(screen.getByText(/1\.0 MB/)).toBeInTheDocument();
  });

  it('no dice que hay copia de hoy si hoy no hay', async () => {
    vi.mocked(hayBackupHoy).mockResolvedValue(false);
    render(<ConfiguracionPage />);
    await screen.findByText('20260930-210000');
    expect(screen.queryByText(/Hoy ya hay una copia automática/)).not.toBeInTheDocument();
  });

  it('crea una copia manual y lo dice por su nombre', async () => {
    const user = userEvent.setup();
    render(<ConfiguracionPage />);
    await screen.findByText('20260930-210000');

    await user.click(screen.getByRole('button', { name: /Crear copia/ }));
    expect(await screen.findByText(/Copia creada: 20260930-210000/)).toBeInTheDocument();
    expect(crearBackup).toHaveBeenCalledTimes(1);
  });

  it('borra la copia que se le pide', async () => {
    const user = userEvent.setup();
    render(<ConfiguracionPage />);
    await screen.findByText('20260929-210000');

    await user.click(screen.getByRole('button', { name: 'Eliminar 20260929-210000' }));
    await waitFor(() => expect(eliminarBackup).toHaveBeenCalledWith('20260929-210000'));
  });

  it('exige que el PIN nuevo tenga 4 dígitos y se repita', async () => {
    const user = userEvent.setup();
    render(<ConfiguracionPage />);
    await screen.findByLabelText(/Nombre del negocio/);

    const pinNuevo = screen.getByLabelText('PIN nuevo');
    const confirmar = screen.getByLabelText('Confirmar PIN');

    await user.type(screen.getByLabelText('PIN actual'), '1234');
    await user.type(pinNuevo, '12');
    await user.type(confirmar, '12');
    await user.click(screen.getByRole('button', { name: /Actualizar PIN/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('4 dígitos');
    expect(cambiarPin).not.toHaveBeenCalled();

    // Ya con los cuatro dígitos, pero la confirmación se quedó en dos: el aviso
    // sigue siendo el de la longitud, no el de la coincidencia.
    await user.clear(pinNuevo);
    await user.type(pinNuevo, '5678');
    await user.click(screen.getByRole('button', { name: /Actualizar PIN/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('4 dígitos');

    // Cuatro y cuatro, pero distintos.
    await user.clear(confirmar);
    await user.type(confirmar, '9012');
    await user.click(screen.getByRole('button', { name: /Actualizar PIN/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no coinciden');
    expect(cambiarPin).not.toHaveBeenCalled();

    await user.clear(confirmar);
    await user.type(confirmar, '5678');
    await user.click(screen.getByRole('button', { name: /Actualizar PIN/ }));
    await waitFor(() => expect(cambiarPin).toHaveBeenCalledWith(7, '1234', '5678'));
    expect(await screen.findByText('PIN actualizado correctamente')).toBeInTheDocument();
  });
});