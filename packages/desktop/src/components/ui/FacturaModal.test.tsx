import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FacturaModal } from './FacturaModal';
import { configurarDestinoImpresora, imprimirTicket, listarImpresoras, obtenerDestinoImpresora } from '../../services/db';
import type { Factura } from '@tienda/core';

vi.mock('../../lib/facturaPdf', () => ({
  nombreArchivoFactura: vi.fn().mockReturnValue('factura-001.pdf'),
  facturaPdfB64: vi.fn().mockResolvedValue('data'),
}));

vi.mock('../../services/db', () => ({
  guardarFacturaPdf: vi.fn().mockResolvedValue('/tmp/factura-001.pdf'),
  imprimirTicket: vi.fn(),
  listarImpresoras: vi.fn().mockResolvedValue(['EPSON TM-T20III']),
  probarImpresora: vi.fn().mockResolvedValue(undefined),
  obtenerDestinoImpresora: vi.fn().mockResolvedValue(null),
  configurarDestinoImpresora: vi.fn().mockResolvedValue({ tipo: 'usb', impresora: 'EPSON TM-T20III' }),
  getConfig: vi.fn().mockResolvedValue(''),
  setConfig: vi.fn().mockResolvedValue(undefined),
  IMPRESORA_TERMICA_KEY: 'impresora_termica',
}));

const factura: Factura = {
  venta_id: 1,
  numero_factura: 12,
  tipo: 'contado',
  estado: 'entregada',
  fecha: '2026-09-04',
  cliente: 'Consumidor Final',
  cliente_documento: '',
  dias_credito: 0,
  negocio_nombre: 'Papelería Don Carlos',
  negocio_rif: 'J-99999999-9',
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

beforeEach(() => {
  vi.mocked(imprimirTicket).mockReset();
  vi.mocked(imprimirTicket).mockResolvedValue(undefined);
  vi.mocked(listarImpresoras).mockResolvedValue(['EPSON TM-T20III']);
  vi.mocked(obtenerDestinoImpresora).mockReset();
  vi.mocked(obtenerDestinoImpresora).mockResolvedValue(null);
  vi.mocked(configurarDestinoImpresora).mockReset();
  vi.mocked(configurarDestinoImpresora).mockResolvedValue({ tipo: 'usb', impresora: 'EPSON TM-T20III' });
});

describe('FacturaModal: impresión térmica', () => {
  it('envía la factura como ticket a la impresora y confirma el envío', async () => {
    const user = userEvent.setup();
    render(<FacturaModal factura={factura} onClose={() => {}} />);

    await user.click(await screen.findByRole('button', { name: /térmica/i }));

    expect(imprimirTicket).toHaveBeenCalledTimes(1);
    expect(imprimirTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        negocio_nombre: 'Papelería Don Carlos',
        negocio_rif: 'J-99999999-9',
        numero_factura: 12,
        cliente: 'Consumidor Final',
        total: 500,
        detalle: expect.arrayContaining([
          expect.objectContaining({ producto: 'Cuaderno Carta', cantidad: 1, subtotal: 500 }),
        ]),
        pagos: expect.arrayContaining([
          expect.objectContaining({ tipo_pago: 'efectivo', moneda: 'usd', monto: 500 }),
        ]),
      }),
    );
    expect(await screen.findByText(/ticket enviado a la impresora térmica/i)).toBeInTheDocument();
  });

  it('si falla el envío, ofrece configurar la impresora y al guardar reenvía el ticket', async () => {
    vi.mocked(imprimirTicket).mockRejectedValueOnce(new Error('No hay impresora conectada (LP)'));
    const user = userEvent.setup();
    render(<FacturaModal factura={factura} onClose={() => {}} />);

    await user.click(await screen.findByRole('button', { name: /térmica/i }));
    expect(await screen.findByText(/no hay impresora conectada/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /configurar impresora/i }));
    expect(screen.getByText('Configurar impresora térmica')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: /EPSON TM-T20III/i }));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(configurarDestinoImpresora).toHaveBeenCalledWith({ tipo: 'usb', impresora: 'EPSON TM-T20III' });
    expect(imprimirTicket).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/ticket enviado a la impresora térmica/i)).toBeInTheDocument();
  });
});