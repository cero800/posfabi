import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { Cliente, Producto } from '@tienda/core';
import { eliminarPrecioCliente, setPrecioCliente } from '../../services/db';
import { formatUsdCents, parseCentsInput } from '../../lib/format';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';

interface Props {
  abierto: boolean;
  cliente: Cliente | null;
  productos: Producto[];
  preciosEspeciales: Record<number, number>;
  onCerrar: () => void;
  onGuardado: () => void;
}

/** Precio especial por cliente (se abre con F6 desde el carrito). */
export default function PrecioEspecialModal({
  abierto,
  cliente,
  productos,
  preciosEspeciales,
  onCerrar,
  onGuardado,
}: Props) {
  const [busqueda, setBusqueda] = useState('');
  const [edicion, setEdicion] = useState<Record<number, string>>({});
  const [activoId, setActivoId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (abierto) {
      setBusqueda('');
      setEdicion({});
      setActivoId(null);
      setError(null);
    }
  }, [abierto]);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return productos;
    return productos.filter(
      (p) => p.nombre.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q),
    );
  }, [productos, busqueda]);

  if (!cliente) return null;

  const guardar = async (p: Producto) => {
    const texto = (edicion[p.id] ?? '').trim();
    const cents = parseCentsInput(texto, 'usd');
    if (cents == null || cents <= 0) {
      setError(`Ingresa un precio válido para ${p.nombre}`);
      return;
    }
    setError(null);
    setActivoId(p.id);
    try {
      await setPrecioCliente({
        cliente_id: cliente.id,
        producto_id: p.id,
        precio_especial: cents,
      });
      setEdicion((prev) => ({ ...prev, [p.id]: '' }));
      onGuardado();
    } catch (e) {
      setError(String(e));
    } finally {
      setActivoId(null);
    }
  };

  const quitar = async (p: Producto) => {
    setError(null);
    setActivoId(p.id);
    try {
      await eliminarPrecioCliente(cliente.id, p.id);
      setEdicion((prev) => ({ ...prev, [p.id]: '' }));
      onGuardado();
    } catch (e) {
      setError(String(e));
    } finally {
      setActivoId(null);
    }
  };

  return (
    <Modal
      open={abierto}
      title={`Precio especial — ${cliente.nombre}`}
      onClose={onCerrar}
      footer={
        <Button variant="secondary" onClick={onCerrar}>
          Cerrar
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar producto por nombre o código…"
            className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm shadow-sm focus:border-primary focus:ring-2 focus:ring-primary/40 focus:outline-none"
          />
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {filtrados.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Sin productos que coincidan.</p>
        ) : (
          <ul className="divide-y divide-border">
            {filtrados.map((p) => {
              const especial = preciosEspeciales[p.id];
              return (
                <li key={p.id} className="py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{p.nombre}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.codigo} · Base {formatUsdCents(p.precio_base)}
                        {especial != null && (
                          <span className="ml-1 text-primary">
                            · Especial {formatUsdCents(especial)}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <input
                        aria-label={`Precio ${p.nombre}`}
                        inputMode="decimal"
                        placeholder={formatUsdCents(especial ?? p.precio_base)}
                        value={edicion[p.id] ?? ''}
                        onChange={(e) => setEdicion((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void guardar(p);
                        }}
                        className="w-24 rounded-md border border-border px-2 py-1 text-right text-sm focus:border-primary focus:outline-none"
                      />
                      <Button size="sm" disabled={activoId === p.id} onClick={() => guardar(p)}>
                        {activoId === p.id ? '…' : 'Guardar'}
                      </Button>
                      {especial != null && (
                        <Button size="sm" variant="ghost" disabled={activoId === p.id} onClick={() => quitar(p)}>
                          Quitar
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}