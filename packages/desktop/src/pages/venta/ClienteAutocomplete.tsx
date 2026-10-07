import { useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import type { Cliente } from '@tienda/core';

export function esMostrador(e: Cliente) {
  return e.documento === '0';
}

interface Props {
  clientes: Cliente[];
  clienteId: number | null;
  onChange: (id: number) => void;
}

/** Autocomplete del carrito: busca el cliente por nombre comercial o RIF/DNI. */
export default function ClienteAutocomplete({ clientes, clienteId, onChange }: Props) {
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [selecciono, setSelecciono] = useState(false);

  const clienteActual = clientes.find((e) => e.id === clienteId) ?? null;

  const filtrados = useMemo(() => {
    const q = texto.trim().toLowerCase();
    const base = q
      ? clientes.filter(
          (e) =>
            e.nombre.toLowerCase().includes(q) ||
            e.documento.toLowerCase().includes(q),
        )
      : clientes;
    return [...base].sort((a, b) => Number(esMostrador(b)) - Number(esMostrador(a)));
  }, [clientes, texto]);

  const seleccionar = (e: Cliente) => {
    setTexto(e.nombre);
    setSelecciono(true);
    setAbierto(false);
    onChange(e.id);
  };

  const reiniciar = () => {
    if (selecciono) {
      setSelecciono(false);
      return;
    }
    if (clienteActual) setTexto(clienteActual.nombre);
  };

  const mostrado = abierto ? texto : clienteActual?.nombre ?? texto;

  return (
    <div>
      <label htmlFor="cliente-venta" className="mb-1 block text-xs font-medium text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Users className="h-3 w-3" /> Cliente
        </span>
      </label>
      <div className="relative">
        <input
          id="cliente-venta"
          role="combobox"
          aria-expanded={abierto}
          aria-autocomplete="list"
          aria-label="Cliente"
          value={mostrado}
          onChange={(e) => {
            setTexto(e.target.value);
            setSelecciono(false);
            setAbierto(true);
          }}
          onFocus={() => setAbierto(true)}
          onBlur={() => window.setTimeout(reiniciar, 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const primero = filtrados[0];
              if (primero) seleccionar(primero);
              e.preventDefault();
            }
            if (e.key === 'Escape') setAbierto(false);
          }}
          placeholder="Buscar por nombre o RIF/DNI…"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground focus:border-primary focus:ring-2 focus:ring-primary/40 focus:outline-none"
        />
        {abierto && (
          <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-background shadow-lg">
            {filtrados.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">Sin resultados</li>
            ) : (
              filtrados.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    role="option"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => seleccionar(c)}
                    // El foco aquí solo puede venir del teclado: el `onMouseDown`
                    // de arriba cancela el evento para que el campo no pierda el
                    // suyo. Sin indicador, quien navega con Tab cambia de opción
                    // sin saber en cuál está.
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                  >
                    <span className="font-medium text-foreground">{c.nombre}</span>
                    {esMostrador(c) && <span className="ml-1 text-xs text-muted-foreground">(mostrador)</span>}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{c.documento}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}