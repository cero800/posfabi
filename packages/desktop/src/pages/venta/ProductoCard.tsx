import type { ReactNode } from 'react';
import { useSesion } from '../../store/sesion';
import { formatUsdCents, formatVesCents } from '../../lib/format';
import { STOCK_BAJO } from '../../lib/stock';

export function ProductoCard({
  nombre,
  codigo,
  precio,
  stock,
  icono,
  onAgregar,
  deshabilitado,
}: {
  nombre: string;
  codigo: string;
  precio: number;
  stock?: number;
  icono?: ReactNode;
  onAgregar: () => void;
  deshabilitado?: boolean;
}) {
  const stockBajo = typeof stock === 'number' && stock > 0 && stock <= STOCK_BAJO;
  return (
    <button
      type="button"
      onClick={onAgregar}
      disabled={deshabilitado}
      className="group flex flex-col justify-between gap-2 rounded-card border border-border bg-card p-3 text-left text-foreground shadow-card transition hover:border-primary/40 hover:shadow-pop disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{codigo}</span>
        {typeof stock === 'number' && (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              stockBajo ? 'bg-destructive/10 font-bold text-destructive' : 'bg-muted text-muted-foreground'
            }`}
          >
            {stock}
          </span>
        )}
      </div>
      <div>
        <p className="line-clamp-2 text-sm font-semibold text-foreground">{nombre}</p>
        <span className="text-sm font-bold text-primary">{formatUsdCents(precio)}</span>
      </div>
      {icono}
    </button>
  );
}

export function ClienteSelect({
  value,
  onChange,
  clientes,
}: {
  value: string;
  onChange: (clienteId: number) => void;
  clientes: Array<{ id: number; nombre: string; esMostrador?: boolean }>;
}) {
  return (
    <div>
      <label htmlFor="cliente-venta" className="mb-1 block text-xs font-medium text-muted-foreground">
        Cliente
      </label>
      <select
        id="cliente-venta"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        {clientes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
            {c.esMostrador ? ' (mostrador)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

export function TasaBar() {
  const tasa = useSesion((s) => s.tasa);
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
      <span>Tasa de hoy</span>
      <strong className="text-sm text-foreground">{formatVesCents(Math.round(tasa * 100))}</strong>
    </div>
  );
}

export function TotalRow({ etiqueta, monto, moneda }: { etiqueta: string; monto: number; moneda: 'usd' | 'ves' }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{etiqueta}</span>
      <strong className={moneda === 'usd' ? 'text-foreground' : 'text-primary'}>{formatUsdCents(monto)}</strong>
    </div>
  );
}