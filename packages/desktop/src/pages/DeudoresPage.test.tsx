import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { estadoCuentaTodos, registrarAbono, registrarDevolucion, detalleVenta, listarVentasCliente, listarDevoluciones } from '../services/db';
import { useSesion } from '../store/sesion';
import DeudoresPage from './DeudoresPage';

vi.mock('../services/db', () => ({
  estadoCuentaTodos: vi.fn().mockResolvedValue([
    { cliente_id: 2, nombre: 'Distribuidora La Esquina', total_facturado: 25000, total_pagado: 5000, saldo_pendiente: 20000, total_vencido: 15000, total_al_dia: 5000, dias_credito: 30 },
  ]),
  estadoCuenta: vi.fn(),
  historialPagos: vi.fn().mockResolvedValue([
    { id: 1, venta_id: 10, numero_factura: 3, monto: 5000, tipo_pago: 'efectivo', moneda: 'ves', tasa_cambio: 36.85, fecha_pago: '2026-09-04' },
  ]),
  registrarAbono: vi.fn(),
  listarVentasCliente: vi.fn().mockResolvedValue([]),
  listarDevoluciones: vi.fn().mockResolvedValue([]),
  detalleVenta: vi.fn().mockResolvedValue([]),
  registrarDevolucion: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(registrarAbono).mockReset();
  vi.mocked(registrarDevolucion).mockReset();
  vi.mocked(listarVentasCliente).mockResolvedValue([]);
  vi.mocked(detalleVenta).mockResolvedValue([]);
  useSesion.setState({ operador: { id: 1, nombre: 'Ana', rol: 'admin', activo: true } });
});

describe('DeudoresPage', () => {
  it('lista deudores con vencido, plazo y saldo', async () => {
    render(<DeudoresPage />);
    expect(await screen.findByText('Distribuidora La Esquina')).toBeInTheDocument();
    expect(screen.getByText('Vencido', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByText('Al día')).not.toBeInTheDocument();
    expect(screen.getByText('Plazo: 30 días')).toBeInTheDocument();
    expect(screen.getByText('$150.00')).toBeInTheDocument();
    expect(screen.getAllByText('$200.00').length).toBeGreaterThan(0);
  });

  it('marca Al día cuando no hay saldo vencido', async () => {
    vi.mocked(estadoCuentaTodos).mockResolvedValueOnce([
      { cliente_id: 2, nombre: 'Distribuidora La Esquina', total_facturado: 25000, total_pagado: 5000, saldo_pendiente: 20000, total_vencido: 0, total_al_dia: 20000, dias_credito: 30 },
    ] as never);
    render(<DeudoresPage />);
    expect(await screen.findByText('Distribuidora La Esquina')).toBeInTheDocument();
    expect(screen.getByText('Al día')).toBeInTheDocument();
    expect(screen.queryByText('Vencido', { selector: 'span' })).not.toBeInTheDocument();
  });

  it('muestra historial de pagos al seleccionar cliente', async () => {
    const user = userEvent.setup();
    render(<DeudoresPage />);
    await user.click(await screen.findByText('Distribuidora La Esquina'));
    expect(await screen.findByText(/#3/)).toBeInTheDocument();
    expect(screen.getByText('Bs 50,00')).toBeInTheDocument();
  });

  it('registra un abono en Bs', async () => {
    const user = userEvent.setup();
    vi.mocked(registrarAbono).mockResolvedValue(undefined as never);
    render(<DeudoresPage />);
    await user.click(await screen.findByText('Distribuidora La Esquina'));
    await user.click(await screen.findByRole('button', { name: /Abono/ }));

    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Monto abono 1/), '100');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar abono' }));

    expect(registrarAbono).toHaveBeenCalledWith({
      cliente_id: 2,
      pagos: [{ monto: 10000, tipo_pago: 'efectivo', moneda: 'ves', numero_referencia: undefined }],
      operador_id: 1,
    });
  });

  it('registra un abono mixto de varias formas de pago', async () => {
    const user = userEvent.setup();
    vi.mocked(registrarAbono).mockResolvedValue(undefined as never);
    useSesion.setState({ operador: { id: 1, nombre: 'Ana', rol: 'admin', activo: true }, tasa: 36.85 });
    render(<DeudoresPage />);
    await user.click(await screen.findByText('Distribuidora La Esquina'));
    await user.click(await screen.findByRole('button', { name: /Abono/ }));

    const dialog = screen.getByRole('dialog');
    // Efectivo US$ $5 en la primera línea.
    await user.selectOptions(within(dialog).getByLabelText(/Moneda abono 1/), 'usd');
    await user.type(within(dialog).getByLabelText(/Monto abono 1/), '5');

    // Pago móvil Bs (= $5) con referencia en la segunda línea.
    await user.click(within(dialog).getByRole('button', { name: /Agregar pago/ }));
    await user.selectOptions(within(dialog).getByLabelText(/Tipo abono 2/), 'pago_movil');
    await user.type(within(dialog).getByLabelText(/Monto abono 2/), '184,25');
    await user.type(within(dialog).getByLabelText(/Referencia abono 2/), 'R-001');

    await user.click(within(dialog).getByRole('button', { name: 'Guardar abono' }));

    expect(registrarAbono).toHaveBeenCalledWith({
      cliente_id: 2,
      pagos: [
        { monto: 500, tipo_pago: 'efectivo', moneda: 'usd', numero_referencia: undefined },
        { monto: 18425, tipo_pago: 'pago_movil', moneda: 'ves', numero_referencia: 'R-001' },
      ],
      operador_id: 1,
    });
  });

  it('exige referencia en pagos móviles', async () => {
    const user = userEvent.setup();
    useSesion.setState({ operador: { id: 1, nombre: 'Ana', rol: 'admin', activo: true }, tasa: 1 });
    render(<DeudoresPage />);
    await user.click(await screen.findByText('Distribuidora La Esquina'));
    await user.click(await screen.findByRole('button', { name: /Abono/ }));

    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/Tipo abono 1/), 'pago_movil');
    await user.type(within(dialog).getByLabelText(/Monto abono 1/), '100');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar abono' }));

    expect(within(dialog).getByText(/pago móvil requiere el número de referencia/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Guardar abono' })).toBeDisabled();
    expect(registrarAbono).not.toHaveBeenCalled();
  });

  it('bloquea el abono que supera el saldo pendiente', async () => {
    const user = userEvent.setup();
    useSesion.setState({ operador: { id: 1, nombre: 'Ana', rol: 'admin', activo: true }, tasa: 1 });
    render(<DeudoresPage />);
    await user.click(await screen.findByText('Distribuidora La Esquina'));
    await user.click(await screen.findByRole('button', { name: /Abono/ }));

    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Monto abono 1/), '300');
    expect(within(dialog).getByText(/supera el saldo pendiente/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Guardar abono' })).toBeDisabled();
    expect(registrarAbono).not.toHaveBeenCalled();
  });

  it('muestra en el abono el saldo pendiente y lo que queda por pagar en US$ y Bs', async () => {
    const user = userEvent.setup();
    useSesion.setState({ operador: { id: 1, nombre: 'Ana', rol: 'admin', activo: true }, tasa: 1 });
    render(<DeudoresPage />);
    await user.click(await screen.findByText('Distribuidora La Esquina'));
    await user.click(await screen.findByRole('button', { name: /Abono/ }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Debe (saldo)')).toBeInTheDocument();
    expect(within(dialog).getByText('Facturado')).toBeInTheDocument();
    expect(within(dialog).getByText('Queda tras este abono')).toBeInTheDocument();
    expect(within(dialog).getAllByText('$200.00')).toHaveLength(2);
    expect(within(dialog).getAllByText('Bs 200,00')).toHaveLength(2);

    await user.type(within(dialog).getByLabelText(/Monto abono 1/), '50');
    expect(within(dialog).getByText('$150.00')).toBeInTheDocument();
    expect(within(dialog).getByText('Bs 150,00')).toBeInTheDocument();
  });

  it('rellena el saldo restante con el botón Abonar restante', async () => {
    const user = userEvent.setup();
    useSesion.setState({ operador: { id: 1, nombre: 'Ana', rol: 'admin', activo: true }, tasa: 1 });
    render(<DeudoresPage />);
    await user.click(await screen.findByText('Distribuidora La Esquina'));
    await user.click(await screen.findByRole('button', { name: /Abono/ }));

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Abonar restante' }));
    expect(within(dialog).getByLabelText(/Monto abono 1/)).toHaveValue('200,00');
  });

  it('lista facturas entregadas con su botón Devolver', async () => {
    vi.mocked(listarVentasCliente).mockResolvedValue([
      { venta_id: 10, numero_factura: 3, tipo: 'credito', fecha: '2026-09-01', total: 5000, devuelto: 0 },
    ] as never);
    const user = userEvent.setup();
    render(<DeudoresPage />);
    await user.click(await screen.findByText('Distribuidora La Esquina'));
    expect(await screen.findByRole('button', { name: /Devolver factura 3/ })).toBeInTheDocument();
    expect(screen.getByText('Crédito')).toBeInTheDocument();
    expect(screen.getByText('2026-09-01')).toBeInTheDocument();
  });

  it('registra una devolución calculando el monto por cantidad', async () => {
    const user = userEvent.setup();
    vi.mocked(listarVentasCliente).mockResolvedValue([
      { venta_id: 10, numero_factura: 3, tipo: 'credito', fecha: '2026-09-04', total: 1000, devuelto: 0 },
    ] as never);
    vi.mocked(detalleVenta).mockResolvedValue([
      { producto_id: 1, nombre: 'Cuaderno Carta', cantidad: 10, precio_unitario: 100, subtotal: 1000 },
    ] as never);
    render(<DeudoresPage />);
    await user.click(await screen.findByText('Distribuidora La Esquina'));
    await user.click(await screen.findByRole('button', { name: /Devolver factura 3/ }));

    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Devolver Cuaderno Carta/), '5');
    await user.click(within(dialog).getByRole('button', { name: 'Registrar devolución' }));

    expect(registrarDevolucion).toHaveBeenCalledWith({
      cliente_id: 2,
      venta_id: 10,
      monto: 500,
      motivo: null,
      afecta_stock: true,
      operador_id: 1,
      detalle: [{ producto_id: 1, cantidad: 5, precio_unitario: 100 }],
    });
  });

  it('bloquea devolución con cantidad mayor a la vendida', async () => {
    const user = userEvent.setup();
    vi.mocked(listarVentasCliente).mockResolvedValue([
      { venta_id: 10, numero_factura: 3, tipo: 'contado', fecha: '2026-09-04', total: 1000, devuelto: 0 },
    ] as never);
    vi.mocked(detalleVenta).mockResolvedValue([
      { producto_id: 1, nombre: 'Cuaderno Carta', cantidad: 10, precio_unitario: 100, subtotal: 1000 },
    ] as never);
    render(<DeudoresPage />);
    await user.click(await screen.findByText('Distribuidora La Esquina'));
    await user.click(await screen.findByRole('button', { name: /Devolver factura 3/ }));

    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Devolver Cuaderno Carta/), '15');
    expect(within(dialog).getByText(/cantidad devuelta no puede superar/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Registrar devolución' })).toBeDisabled();
    expect(registrarDevolucion).not.toHaveBeenCalled();
  });

  it('muestra las devoluciones ya registradas de la cliente', async () => {
    vi.mocked(listarVentasCliente).mockResolvedValue([
      { venta_id: 10, numero_factura: 3, tipo: 'credito', fecha: '2026-09-04', total: 5000, devuelto: 1000 },
    ] as never);
    vi.mocked(listarDevoluciones).mockResolvedValue([
      { id: 1, cliente_id: 2, venta_id: 10, numero_factura: 3, monto: 1000, motivo: 'artículo devuelto', operador_id: 1, fecha_devolucion: '2026-09-05', detalle: [{ producto_id: 1, nombre: 'Cuaderno Carta', cantidad: 5, precio_unitario: 100, subtotal: 500 }] },
    ] as never);
    const user = userEvent.setup();
    render(<DeudoresPage />);
    await user.click(await screen.findByText('Distribuidora La Esquina'));
    expect(await screen.findByText(/artículo devuelto/)).toBeInTheDocument();
    expect(screen.getAllByText('-$10.00').length).toBeGreaterThan(0);
    // Muestra qué productos se devolvieron dentro de la factura.
    expect(screen.getByText(/Cuaderno Carta × 5/)).toBeInTheDocument();
  });

  it('filtra las devoluciones registradas por día y vuelve con Todos', async () => {
    const ahora = new Date();
    const hoy = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
    const hoyDia = String(ahora.getDate());
    vi.mocked(listarVentasCliente).mockResolvedValue([
      { venta_id: 10, numero_factura: 3, tipo: 'credito', fecha: '2026-09-04', total: 5000, devuelto: 1000 },
    ] as never);
    vi.mocked(listarDevoluciones).mockResolvedValue([
      { id: 1, cliente_id: 2, venta_id: 10, numero_factura: 3, monto: 1000, motivo: 'artículo devuelto', operador_id: 1, fecha_devolucion: hoy, detalle: [] },
      { id: 2, cliente_id: 2, venta_id: 10, numero_factura: 3, monto: 2000, motivo: 'otro error', operador_id: 1, fecha_devolucion: '2030-01-01', detalle: [] },
    ] as never);
    const user = userEvent.setup();
    render(<DeudoresPage />);
    await user.click(await screen.findByText('Distribuidora La Esquina'));
    expect(await screen.findByText(/artículo devuelto/)).toBeInTheDocument();
    expect(screen.getByText(/otro error/)).toBeInTheDocument();

    await user.click(screen.getByLabelText('Filtrar devoluciones por día'));
    const calendario = screen.getByRole('dialog', { name: 'Calendario' });
    await user.click(within(calendario).getByRole('button', { name: hoyDia }));

    expect(screen.queryByText(/otro error/)).not.toBeInTheDocument();
    expect(screen.getByText(/artículo devuelto/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Todos' }));
    expect(screen.getByText(/otro error/)).toBeInTheDocument();
  });
});