import { useEffect, useMemo, useState } from 'react';
import { Boxes, FolderTree, MinusCircle, PackagePlus, Plus, Settings2 } from 'lucide-react';
import type { Categoria, StockItem } from '@tienda/core';
import {
  listarCategorias,
  listarProductos,
  listarStock,
  registrarAjuste,
  registrarEntradaMercancia,
  registrarMerma,
} from '../services/db';
import { hoyIso, parseCentsInput } from '../lib/format';
import type { Producto } from '@tienda/core';
import { useSesion } from '../store/sesion';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { Table, THead, Th, Td } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { EmptyState, PageHeader } from '../components/ui/Page';
import { PageLoader } from '../components/ui/Spinner';
import { DatePicker } from '../components/ui/DatePicker';

type Accion = 'entrada' | 'merma' | 'ajuste';

export default function InventarioPage() {
  const operadorId = useSesion((s) => s.operador?.id ?? 0);
  const esAdmin = useSesion((s) => s.operador?.rol === 'admin');
  const [stock, setStock] = useState<StockItem[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [categoriaFiltro, setCategoriaFiltro] = useState('');
  const [cargando, setCargando] = useState(true);
  const [accion, setAccion] = useState<Accion | null>(null);
  const [productoId, setProductoId] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [costo, setCosto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [fecha, setFecha] = useState(hoyIso());
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = () => listarStock().then(setStock).finally(() => setCargando(false));
  useEffect(() => {
    cargar();
    listarProductos()
      .then((ps) => setProductos(ps.filter((p) => p.activo)))
      .catch(() => {});
    // Con su propio `catch` por lo mismo que en la venta: el filtro por
    // categoría es una comodidad y no puede dejar la pantalla sin inventario.
    listarCategorias()
      .then(setCategorias)
      .catch(() => setCategorias([]));
  }, []);

  const pendientes = useMemo(
    () => stock.filter((s) => s.cantidad_disponible <= 0),
    [stock],
  );
  /**
   * Productos por debajo de su mínimo.
   *
   * Es distinto de `pendientes`: agotado es "no se puede vender más", por
   * debajo del mínimo es "todavía se puede, pero hay que pedir". La columna lo
   * muestra uno a uno y el aviso de arriba los junta, porque son dos decisiones
   * distintas para el dueño de la tienda.
   */
  const bajoMinimo = useMemo(
    () => stock.filter((s) => s.stock_minimo > 0 && s.cantidad_disponible < s.stock_minimo),
    [stock],
  );

  const filtrados = useMemo(() => {
    if (categoriaFiltro === 'sin-categoria') return stock.filter((s) => s.categoria_id == null);
    if (categoriaFiltro === '') return stock;
    return stock.filter((s) => String(s.categoria_id ?? '') === categoriaFiltro);
  }, [stock, categoriaFiltro]);

  const abrir = (a: Accion, productoIdDefault?: number) => {
    setAccion(a);
    setProductoId(productoIdDefault != null ? String(productoIdDefault) : '');
    setCantidad('');
    setCosto('');
    setMotivo('');
    setFecha(hoyIso());
    setError(null);
    if (a === 'entrada' && productoIdDefault != null) {
      const p = productos.find((x) => x.id === productoIdDefault);
      if (p) setCosto((p.precio_base / 100).toFixed(2));
    }
  };

  const elegirProducto = (id: string) => {
    setProductoId(id);
    if (accion === 'entrada') {
      const p = productos.find((x) => x.id === Number(id));
      if (p) setCosto((p.precio_base / 100).toFixed(2));
    }
  };

  const ejecutar = async () => {
    const pid = Number(productoId);
    const cant = Number(cantidad.replace(',', '.'));
    const esAjuste = accion === 'ajuste';
    if (!productoId || !Number.isFinite(cant) || (esAjuste ? cant === 0 : cant <= 0)) {
      setError('Selecciona el producto e ingresa una cantidad válida');
      return;
    }
    if (accion === 'merma' && !motivo.trim()) {
      setError('La merma requiere un motivo');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      if (accion === 'entrada') {
        await registrarEntradaMercancia({
          producto_id: pid,
          cantidad: cant,
          costo_unitario: parseCentsInput(costo, 'usd') ?? 0,
          operador_id: operadorId,
          fecha,
        });
      } else if (accion === 'merma') {
        await registrarMerma({ producto_id: pid, cantidad: cant, motivo: motivo.trim(), operador_id: operadorId });
      } else {
        await registrarAjuste({
          producto_id: pid,
          cantidad_delta: Number(cantidad.replace(',', '.')),
          motivo: motivo.trim() || 'Ajuste manual',
          operador_id: operadorId,
        });
      }
      setAccion(null);
      cargar();
    } catch (e) {
      setError(String(e));
    } finally {
      setGuardando(false);
    }
  };

  if (cargando) return <PageLoader />;

  return (
    <div>
      <PageHeader
        title="Inventario"
        subtitle={`${stock.length} productos`}
        actions={
          <>
            {esAdmin && (
              <>
                <Button variant="secondary" onClick={() => abrir('merma')}>
                  <MinusCircle className="h-4 w-4" /> Merma
                </Button>
                <Button variant="secondary" onClick={() => abrir('ajuste')}>
                  <Settings2 className="h-4 w-4" /> Ajuste
                </Button>
              </>
            )}
            <Button onClick={() => abrir('entrada')}>
              <Plus className="h-4 w-4" /> Recibir mercancía
            </Button>
          </>
        }
      />

      {pendientes.length > 0 && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          ¡Ojo! {pendientes.length} producto(s) con stock agotado o negativo:{' '}
          {pendientes.map((p) => p.nombre).join(', ')}.
        </div>
      )}

      {bajoMinimo.length > 0 && (
        <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          {bajoMinimo.length} producto(s) por debajo del mínimo: {bajoMinimo.map((p) => p.nombre).join(', ')}.
        </div>
      )}

      {categorias.length > 0 && (
        <Card className="mb-4 p-3">
          <div className="flex items-center gap-2">
            <FolderTree className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Select
              aria-label="Filtrar por categoría"
              value={categoriaFiltro}
              onChange={(e) => setCategoriaFiltro(e.target.value)}
            >
              <option value="">Todas las categorías</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
              <option value="sin-categoria">Sin categoría</option>
            </Select>
          </div>
        </Card>
      )}

      {filtrados.length === 0 ? (
        <Card>
          <EmptyState icon={<Boxes className="h-8 w-8" />} message="Sin movimientos de inventario aún" />
        </Card>
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <Th>Código</Th>
                <Th>Producto</Th>
                <Th>Categoría</Th>
                <Th className="text-right">Disponible</Th>
                <Th className="text-right">Mínimo</Th>
                <Th>Unidad</Th>
                <Th>Estado</Th>
                <Th className="text-right">Acción</Th>
              </tr>
            </THead>
            <tbody>
              {filtrados.map((s) => {
                const bajo = s.stock_minimo > 0 && s.cantidad_disponible < s.stock_minimo;
                return (
                  <tr key={s.producto_id} className="border-b border-border last:border-0 hover:bg-muted/50">
                    <Td className="font-mono text-xs text-muted-foreground">{s.codigo}</Td>
                    <Td className="font-medium text-foreground">{s.nombre}</Td>
                    <Td className="text-muted-foreground">{s.categoria_nombre ?? '—'}</Td>
                    <Td className="text-right font-semibold">{s.cantidad_disponible}</Td>
                    <Td className="text-right text-muted-foreground">{s.stock_minimo}</Td>
                    <Td>{s.unidad_medida}</Td>
                    <Td>
                      <Badge tone={s.cantidad_disponible <= 0 ? 'red' : bajo ? 'amber' : 'green'}>
                        {s.cantidad_disponible <= 0 ? 'Agotado' : bajo ? 'Bajo mínimo' : 'Disponible'}
                      </Badge>
                    </Td>
                    <Td className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => abrir('entrada', s.producto_id)}
                        aria-label={`Recibir mercancía de ${s.nombre}`}
                      >
                        <PackagePlus className="h-4 w-4" />
                        <span className="ml-1"> Recibir</span>
                      </Button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}

      <Modal
        open={accion != null}
        title={
          accion === 'entrada' ? 'Recibir mercancía' : accion === 'merma' ? 'Registrar merma' : 'Ajuste de inventario'
        }
        onClose={() => setAccion(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAccion(null)}>
              Cancelar
            </Button>
            <Button onClick={ejecutar} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && (
            <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <Select label="Producto" value={productoId} onChange={(e) => elegirProducto(e.target.value)}>
            <option value="">— Seleccionar —</option>
            {productos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </Select>

          <div className="flex gap-3">
            <div className="flex-1">
              <Input
                label="Cantidad"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                placeholder="1.5"
                hint={accion === 'ajuste' ? 'Negativo para restar' : undefined}
              />
            </div>
            {accion === 'entrada' && (
              <div className="flex-1">
                <Input
                  label="Costo unitario (US$)"
                  prefix="$"
                  value={costo}
                  onChange={(e) => setCosto(e.target.value)}
                  placeholder="0.00"
                  hint="Pre-cargado con el precio base del producto (editable)"
                />
              </div>
            )}
          </div>

          {accion === 'entrada' && (
            <div>
              <span className="mb-1 block text-sm font-medium text-foreground">Fecha</span>
              <DatePicker value={fecha} onChange={setFecha} aria-label="Fecha de la entrada" />
            </div>
          )}

          {accion !== 'entrada' && (
            <Input
              label={accion === 'merma' ? 'Motivo *' : 'Motivo'}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej.: rotura de empaque"
            />
          )}
        </div>
      </Modal>
    </div>
  );
}