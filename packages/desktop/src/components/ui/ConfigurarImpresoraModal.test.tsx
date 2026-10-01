import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  configurarDestinoImpresora,
  listarImpresoras,
  obtenerDestinoImpresora,
  probarImpresora,
} from '../../services/db';
import { ConfigurarImpresoraModal, quitarMarca } from './ConfigurarImpresoraModal';
import type { DestinoImpresora } from '@tienda/core';

vi.mock('../../services/db', () => ({
  obtenerDestinoImpresora: vi.fn(),
  configurarDestinoImpresora: vi.fn(),
  listarImpresoras: vi.fn(),
  probarImpresora: vi.fn(),
}));

/** La lista que devuelve Windows, con la marca en la que no sirve. */
const IMPRESORAS = [
  'Generic / Text Only EPSON TM-T20III *',
  'Generic / Text Only Generic 80mm',
  'Microsoft XPS Document Writer *',
];

beforeEach(() => {
  vi.mocked(obtenerDestinoImpresora).mockReset();
  vi.mocked(obtenerDestinoImpresora).mockResolvedValue(null);
  vi.mocked(configurarDestinoImpresora).mockReset();
  vi.mocked(configurarDestinoImpresora).mockImplementation(async (d: DestinoImpresora) => d);
  vi.mocked(listarImpresoras).mockReset();
  vi.mocked(listarImpresoras).mockResolvedValue(IMPRESORAS);
  vi.mocked(probarImpresora).mockReset();
  vi.mocked(probarImpresora).mockResolvedValue(undefined as never);
});

describe('quitarMarca', () => {
  it('quita el asterisco de la cola que no tiene controlador de texto', () => {
    expect(quitarMarca('Generic / Text Only EPSON TM-T20III *')).toBe(
      'Generic / Text Only EPSON TM-T20III',
    );
  });

  it('no toca un nombre que no termina en « *»', () => {
    // El asterisco en medio del nombre es parte de él: mandarle `copy /b` con
    // el asterisco quitado apuntaría a otra cola o a ninguna.
    expect(quitarMarca('EPSON *TM*')).toBe('EPSON *TM*');
    expect(quitarMarca('EPSON ')).toBe('EPSON ');
  });
});

describe('ConfigurarImpresoraModal', () => {
  it('abre en USB cuando no hay destino guardado y avisa de las colas sin texto sin formato', async () => {
    const user = userEvent.setup();
    render(<ConfigurarImpresoraModal open onClose={() => {}} onGuardado={() => {}} />);

    await user.click(await screen.findByRole('button', { name: /Generic \/ Text Only Generic 80mm/ }));
    expect(screen.getByLabelText(/Nombre de la impresora/)).toHaveValue(
      'Generic / Text Only Generic 80mm',
    );

    // La explicación sale porque hay candidatas con «*», y dice qué controlador
    // hace falta: sin eso el cajero|prueba, ve el ticket feo y no sabe por qué.
    expect(screen.getByText(/Texto sin formato/)).toBeInTheDocument();
  });

  it('al elegir una cola marcada guarda el nombre sin la marca', async () => {
    const user = userEvent.setup();
    render(<ConfigurarImpresoraModal open onClose={() => {}} onGuardado={() => {}} />);

    await user.click(await screen.findByRole('button', { name: /EPSON TM-T20III \*/ }));
    expect(screen.getByLabelText(/Nombre de la impresora/)).toHaveValue(
      'Generic / Text Only EPSON TM-T20III',
    );

    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await vi.waitFor(() => expect(configurarDestinoImpresora).toHaveBeenCalledTimes(1));
    expect(configurarDestinoImpresora).toHaveBeenCalledWith({
      tipo: 'usb',
      impresora: 'Generic / Text Only EPSON TM-T20III',
    });
  });

  it('guarda una impresora de red con su puerto', async () => {
    const user = userEvent.setup();
    render(<ConfigurarImpresoraModal open onClose={() => {}} onGuardado={() => {}} />);

    await user.click(await screen.findByRole('button', { name: 'Red' }));
    await user.type(screen.getByLabelText(/Dirección de la impresora/), '192.168.1.50');
    await user.type(screen.getByLabelText('Puerto'), '9100');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() =>
      expect(configurarDestinoImpresora).toHaveBeenCalledWith({
        tipo: 'red',
        host: '192.168.1.50',
        puerto: 9100,
      }),
    );
  });

  /**
   * El puerto vacío se resuelve a 9100. `DestinoImpresora` lo exige como número,
   * así que "vacío" no se puede mandar; resolverlo aquí evita que el cajero vea
   * un error de validación por un campo que él decidió dejar en blanco.
   */
  it('usa el puerto 9100 si el cajero no lo escribe', async () => {
    const user = userEvent.setup();
    render(<ConfigurarImpresoraModal open onClose={() => {}} onGuardado={() => {}} />);

    await user.click(await screen.findByRole('button', { name: 'Red' }));
    await user.type(screen.getByLabelText(/Dirección de la impresora/), 'ImpresoraTienda');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() =>
      expect(configurarDestinoImpresora).toHaveBeenCalledWith({
        tipo: 'red',
        host: 'ImpresoraTienda',
        puerto: 9100,
      }),
    );
  });

  it('guarda la ruta cuando el destino es un archivo', async () => {
    const user = userEvent.setup();
    render(<ConfigurarImpresoraModal open onClose={() => {}} onGuardado={() => {}} />);

    await user.click(await screen.findByRole('button', { name: 'Archivo' }));
    await user.type(screen.getByLabelText(/Ruta del archivo/), 'C:\\tickets\\salida.txt');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await vi.waitFor(() =>
      expect(configurarDestinoImpresora).toHaveBeenCalledWith({
        tipo: 'archivo',
        ruta: 'C:\\tickets\\salida.txt',
      }),
    );
  });

  it('no deja guardar un destino a medio rellenar', async () => {
    const user = userEvent.setup();
    render(<ConfigurarImpresoraModal open onClose={() => {}} onGuardado={() => {}} />);

    await user.click(await screen.findByRole('button', { name: 'Red' }));
    // Sin host: el backend daría un error de formato que no explicaría que
    // faltaba el campo.
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Completa el destino antes de guardar');
    expect(configurarDestinoImpresora).not.toHaveBeenCalled();
  });

  /**
   * Probar guarda antes de probar. Si no, "probar"MANDaría la impresión al
   * destino viejo y el cajero creería que probó el nuevo.
   */
  it('probar guarda primero el destino y luego manda la prueba', async () => {
    const user = userEvent.setup();
    render(<ConfigurarImpresoraModal open onClose={() => {}} onGuardado={() => {}} />);

    await user.click(await screen.findByRole('button', { name: /Generic 80mm/ }));
    await user.click(screen.getByRole('button', { name: /Probar impresión/ }));

    await vi.waitFor(() => expect(probarImpresora).toHaveBeenCalledTimes(1));
    expect(configurarDestinoImpresora).toHaveBeenCalledWith({
      tipo: 'usb',
      impresora: 'Generic / Text Only Generic 80mm',
    });
    // El orden importa: si se probara antes de guardar, la prueba iría al
    // destino anterior.
    expect(vi.mocked(configurarDestinoImpresora).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(probarImpresora).mock.invocationCallOrder[0]!,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Prueba enviada');
  });

  it('abre en el destino que ya estaba guardado', async () => {
    vi.mocked(obtenerDestinoImpresora).mockResolvedValue({
      tipo: 'red',
      host: '10.0.0.9',
      puerto: 515,
    });
    const user = userEvent.setup();
    render(<ConfigurarImpresoraModal open onClose={() => {}} onGuardado={() => {}} />);

    expect(await screen.findByLabelText(/Dirección de la impresora/)).toHaveValue('10.0.0.9');
    expect(screen.getByLabelText('Puerto')).toHaveValue('515');
  });

  /**
   * Si el destino guardado está corrupto, el backend falla a propósito para que
   * el cajero lo vuelva a configurar. La lista de impresoras sigue viniendo: es
   * justo lo que hace falta para arreglarlo, y con un `Promise.all` se perdería.
   */
  it('sigue mostrando las impresoras aunque el destino guardado esté corrupto', async () => {
    vi.mocked(obtenerDestinoImpresora).mockRejectedValue(new Error('destino inválido: "HP LaserJet"'));
    render(<ConfigurarImpresoraModal open onClose={() => {}} onGuardado={() => {}} />);

    expect(await screen.findByText(/destino inválido/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /EPSON TM-T20III \*/ })).toBeInTheDocument();
  });

  it('avisa cuando no se detecta ninguna impresora', async () => {
    vi.mocked(listarImpresoras).mockResolvedValue([]);
    render(<ConfigurarImpresoraModal open onClose={() => {}} onGuardado={() => {}} />);

    expect(await screen.findByText(/No se detectaron impresoras/)).toBeInTheDocument();
  });
});