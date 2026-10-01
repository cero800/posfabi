import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { guardarReporteExcel, obtenerDatosNegocio, resumenDia } from '../services/db';
import ReportePage from './ReportePage';

vi.mock('../services/db', () => ({
  resumenDia: vi.fn(),
  obtenerDatosNegocio: vi.fn().mockResolvedValue({
    nombre: 'Papelería Don Carlos',
    rif: 'J-99999999-9',
    telefono: '',
    direccion: '',
  }),
  getFactura: vi.fn(),
  guardarReporteExcel: vi.fn().mockResolvedValue('C:\\reporte.xlsx'),
  imprimirTicket: vi.fn(),
  listarImpresoras: vi.fn(),
  probarImpresora: vi.fn(),
  obtenerDestinoImpresora: vi.fn(),
  configurarDestinoImpresora: vi.fn(),
  getConfig: vi.fn(),
  setConfig: vi.fn(),
}));

const resumen = {
  entradas: [
    { producto: 'Cuaderno Carta', cantidad: 10, costo_unitario: 100 },
  ],
  ventas: [
    { venta_id: 1, numero_factura: 1, cliente: 'Mostrador', tipo: 'contado', monto: 5000, devuelto: 0, estado: 'entregada', tasa_cambio: 36.85 },
    { venta_id: 2, numero_factura: 2, cliente: 'Librería del Centro', tipo: 'credito', monto: 3000, devuelto: 2000, estado: 'entregada', tasa_cambio: 36.85 },
  ],
  pagos_efectivo_usd: 5000,
  pagos_efectivo_ves: 36850,
  devoluciones: [
    { id: 1, venta_id: 2, numero_factura: 2, cliente: 'Librería del Centro', monto: 2000, motivo: 'artículo devuelto', operador_nombre: 'Ana', fecha_devolucion: '2026-09-04', detalle: [{ producto_id: 3, nombre: 'Cuaderno Carta', cantidad: 10, precio_unitario: 200, subtotal: 2000 }] },
  ],
  deudores: [],
};

beforeEach(() => {
  vi.mocked(resumenDia).mockReset();
  vi.mocked(resumenDia).mockResolvedValue(resumen as never);
  vi.mocked(obtenerDatosNegocio).mockReset();
  vi.mocked(obtenerDatosNegocio).mockResolvedValue({
    nombre: 'Papelería Don Carlos',
    rif: 'J-99999999-9',
    telefono: '',
    direccion: '',
  });
  vi.mocked(guardarReporteExcel).mockReset();
  vi.mocked(guardarReporteExcel).mockResolvedValue('C:\\reportes\\reporte.xlsx');
});

describe('ReportePage', () => {
  it('muestra ventas brutas, devoluciones y ventas netas (perdido/ganado)', async () => {
    render(<ReportePage />);
    expect(await screen.findByText('Ventas brutas')).toBeInTheDocument();
    expect(screen.getByText('Devoluciones (perdido)')).toBeInTheDocument();
    expect(screen.getByText('Ventas netas (ganado)')).toBeInTheDocument();
    expect(screen.getByText('$80.00')).toBeInTheDocument();
    expect(screen.getAllByText('-$20.00').length).toBeGreaterThan(0);
    expect(screen.getByText('$60.00')).toBeInTheDocument();
  });

  it('muestra junto a cada factura lo devuelto y el neto', async () => {
    render(<ReportePage />);
    await screen.findByText('Ventas brutas');
    expect(screen.getAllByText(/#2/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('-$20.00').length).toBeGreaterThan(0);
    expect(screen.getByText('$10.00')).toBeInTheDocument();
  });

  it('lista las devoluciones del día con motivo y monto', async () => {
    render(<ReportePage />);
    expect(await screen.findByText('Devoluciones del día')).toBeInTheDocument();
    expect(screen.getByText(/artículo devuelto/)).toBeInTheDocument();
    // Muestra también qué productos se devolvieron.
    expect(screen.getByText(/Cuaderno Carta × 10/)).toBeInTheDocument();
  });

  /**
   * La sección se llama "entradas de mercancía" y no "producción". El rótulo
   * viejo venía de la panadería y en una papelería no dice nada: lo que entra
   * por la puerta es mercancia que alguien compró, no pan que alguien horneó.
   */
  it('titula la sección de entradas de mercancía, no de producción', async () => {
    render(<ReportePage />);
    expect(await screen.findByText('Entradas de mercancía')).toBeInTheDocument();
    expect(screen.queryByText(/Producción/)).not.toBeInTheDocument();
  });

  it('exporta el .xlsx con el nombre del negocio del encabezado', async () => {
    const user = userEvent.setup();
    render(<ReportePage />);
    await screen.findByText('Ventas brutas');

    await user.click(screen.getByRole('button', { name: /Excel/i }));

    expect(await screen.findByText(/Reporte guardado en/)).toBeInTheDocument();
    expect(guardarReporteExcel).toHaveBeenCalledTimes(1);
    const [nombre, b64] = vi.mocked(guardarReporteExcel).mock.calls[0] as [string, string];
    expect(nombre).toMatch(/^reporte-\d{4}-\d{2}-\d{2}\.xlsx$/);

    // Se relee el `.xlsx` con el mismo ExcelJS que lo escribió. Es lo único que
    // comprueba de verdad que el nombre del negocio quedó en la primera fila: el
    // archivo va comprimido, así que buscar el texto en los bytes no encuentra
    // nada y un test que pasara con `toContain` sobre el base64 no probaría nada.
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    // `Buffer.from(...).buffer` y no el `Buffer`: el `index.d.ts` de ExcelJS
    // declara su propia `interface Buffer extends ArrayBuffer` y el parámetro de
    // `load` no acepta el `Buffer<ArrayBufferLike>` de `@types/node`. Como
    // `Buffer.from` con base64 reserva el tamaño exacto, el corte no pierde nada.
    await wb.xlsx.load(Buffer.from(b64, 'base64').buffer as ArrayBuffer);
    const fila1 = wb.worksheets[0]!.getRow(1).getCell(1).value as string;
    expect(fila1).toContain('Papelería Don Carlos');
    expect(fila1).toContain('Reporte del día');
  });

  /**
   * Si el nombre del negocio no se puede leer, el `.xlsx` se sigue exporting con
   * un encabezado genérico. Un archivo que no dice de qué tienda es es
   *mucho mejor que un botón que no hace nada.
   */
  it('exporta igual si no se puede leer el nombre del negocio', async () => {
    vi.mocked(obtenerDatosNegocio).mockRejectedValue(new Error('sin config'));
    const user = userEvent.setup();
    render(<ReportePage />);
    await screen.findByText('Ventas brutas');

    await user.click(screen.getByRole('button', { name: /Excel/i }));
    expect(await screen.findByText(/Reporte guardado en/)).toBeInTheDocument();
    expect(guardarReporteExcel).toHaveBeenCalledTimes(1);
  });
});