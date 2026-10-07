import { useEffect, useState } from 'react';
import { Plus, Trash2, Users } from 'lucide-react';
import type { Cliente, ClienteInput } from '@tienda/core';
import { crearCliente, eliminarCliente, listarClientes } from '../services/db';
import { formatUsdCents, parseCentsInput } from '../lib/format';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Table, THead, Th, Td } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { EmptyState, PageHeader } from '../components/ui/Page';
import { PageLoader } from '../components/ui/Spinner';

function clienteVacio(): ClienteInput {
  return {
    documento: '',
    nombre: '',
    dias_credito: 0,
    limite_credito: 0,
    activo: true,
  };
}

export default function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [modalNuevo, setModalNuevo] = useState(false);
  const [form, setForm] = useState<ClienteInput>(clienteVacio());
  const [limiteTex, setLimiteTex] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = () => listarClientes().then(setClientes).finally(() => setCargando(false));
  useEffect(() => {
    cargar();
  }, []);

  const crear = async () => {
    if (!form.nombre.trim()) {
      setError('El nombre es obligatorio');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await crearCliente({ ...form, limite_credito: parseCentsInput(limiteTex, 'usd') ?? 0 });
      setModalNuevo(false);
      setForm(clienteVacio());
      setLimiteTex('');
      cargar();
    } catch (e) {
      setError(String(e));
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async (c: Cliente) => {
    if (!window.confirm(`¿Eliminar "${c.nombre}"?`)) return;
    try {
      await eliminarCliente(c.id);
      cargar();
    } catch (e) {
      window.alert(String(e));
    }
  };

  if (cargando) return <PageLoader />;

  return (
    <div>
      <PageHeader
        title="Clientes"
        subtitle={`${clientes.length} registrados`}
        actions={
          <Button onClick={() => { setError(null); setForm(clienteVacio()); setLimiteTex(''); setModalNuevo(true); }}>
            <Plus className="h-4 w-4" /> Nuevo cliente
          </Button>
        }
      />

      {clientes.filter((c) => c.documento !== '0').length === 0 ? (
        <Card>
          <EmptyState icon={<Users className="h-8 w-8" />} message="Aún no hay clientes" />
        </Card>
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <Th>RIF/NIT</Th>
                <Th>Nombre</Th>
                <Th>Crédito</Th>
                <Th>Estado</Th>
                <Th className="text-right">Acciones</Th>
              </tr>
            </THead>
            <tbody>
              {clientes
                .filter((c) => c.documento !== '0')
                .map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                    <Td className="font-mono text-xs text-muted-foreground">{c.documento}</Td>
                    <Td>
                      <span className="font-medium text-foreground">{c.nombre}</span>
                      <span className="block text-xs text-muted-foreground">
                        {c.dias_credito > 0 ? `Plazo: ${c.dias_credito} días` : 'Al contado'}
                      </span>
                    </Td>
                    <Td>{formatUsdCents(c.limite_credito)}</Td>
                    <Td>
                      <Badge tone={c.activo ? 'green' : 'gray'}>{c.activo ? 'Activo' : 'Inactivo'}</Badge>
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" aria-label={`Eliminar ${c.nombre}`} onClick={() => eliminar(c)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
            </tbody>
          </Table>
        </Card>
      )}

      {/* Nuevo cliente */}
      <Modal open={modalNuevo} title="Nuevo cliente" onClose={() => setModalNuevo(false)} footer={<>
        <Button variant="secondary" onClick={() => setModalNuevo(false)}>Cancelar</Button>
        <Button onClick={crear} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</Button>
      </>}>
        <div className="space-y-3">
          {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          <Input label="Nombre *" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
          <div className="flex gap-3">
            <div className="flex-1">
              <Input label="RIF/NIT" value={form.documento} onChange={(e) => setForm({ ...form, documento: e.target.value })} />
            </div>
            <div className="flex-1">
              <Input
                label="Plazo de pago (días)"
                hint="Días para pagar las ventas a crédito (0 = al contado)"
                type="number"
                min={0}
                value={form.dias_credito}
                onChange={(e) => setForm({ ...form, dias_credito: Number(e.target.value) })}
              />
            </div>
          </div>
          <Input
            label="Límite de crédito (US$)"
            prefix="$"
            inputMode="decimal"
            placeholder="0.00"
            value={limiteTex}
            onChange={(e) => setLimiteTex(e.target.value)}
          />
        </div>
      </Modal>
    </div>
  );
}