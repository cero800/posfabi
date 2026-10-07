// Catálogo de productos: alta, edición, baja y filtro.
//
// ## Por qué el formulario copia el producto entero
//
// `actualizar_producto` reemplaza la fila, no le hace un parche: el backend
// escribe todas las columnas del `ProductoInput` que llegan, y las que no
// llegan toman su valor por defecto. Antes el formulario se armaba con cinco
// campos —código, nombre, unidad, precio y activo— así que guardar una edición
// ponía la categoría, el stock mínimo, la descripción y el código de barras en
// `NULL`. Con el catálogo ya agrupado por categorías eso no era un detalle
// cosmético: cada renombrado de producto lo sacaba de su categoría. Por eso
// `abrirEdicion` parte del producto tal como vino.
//
// ## Los que no se editan aquí
//
// El precio de un cliente con precio especial vive en otra tabla
// (`precios_cliente`) y se edita desde la pantalla de venta. La descripción y el
// código de barras se guardan pero no tienen campo: son datos que se cargan al
// vuelo en el catálogo, no algo que el cajero escriba a cada rato. Añadirlos es
// una línea en el formulario si hacen falta.

import { useEffect, useMemo, useState } from 'react';
import { FolderTree, Package, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { Producto, ProductoInput, UnidadMedida } from '@tienda/core';
import { UNIDADES_MEDIDA, UNIDAD_MEDIDA_LABELS } from '@tienda/core';
import {
  actualizarProducto,
  crearProducto,
  eliminarProducto,
  listarCategorias,
  listarProductos,
} from '../services/db';
import { formatUsdCents, parseCentsInput } from '../lib/format';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { Table, THead, Th, Td } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { EmptyState, PageHeader } from '../components/ui/Page';
import { PageLoader } from '../components/ui/Spinner';

const UNIDADES: readonly UnidadMedida[] = UNIDADES_MEDIDA;

function vacio(): ProductoInput {
  return {
    codigo: '',
    nombre: '',
    unidad_medida: 'unidad',
    precio_base: 0,
    stock_minimo: 0,
    categoria_id: null,
    activo: true,
  };
}

export default function ProductosPage() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [categorias, setCategorias] = useState<{ id: number; nombre: string }[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [categoriaFiltro, setCategoriaFiltro] = useState('');
  const [modal, setModal] = useState(false);
  const [editando, setEditando] = useState<Producto | null>(null);
  const [form, setForm] = useState<ProductoInput>(vacio());
  const [precioBaseTex, setPrecioBaseTex] = useState('');
  const [stockMinimoTex, setStockMinimoTex] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = () => listarProductos().then(setProductos).finally(() => setCargando(false));
  useEffect(() => {
    cargar();
    // Las categorías son para filtrar y elegir. Si esta llamada falla —el POS
    // arrancando, el backend todavía no listo— la pantalla tiene que servir igual
    // con la lista de productos vacía de filtro, no quedarse en blanco.
    listarCategorias()
      .then(setCategorias)
      .catch(() => setCategorias([]));
  }, []);

  const nombreDe = useMemo(() => {
    const porId = new Map(categorias.map((c) => [c.id, c.nombre]));
    return (id: number | null | undefined): string | null => (id == null ? null : (porId.get(id) ?? null));
  }, [categorias]);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return productos.filter((p) => {
      if (categoriaFiltro === 'sin-categoria') {
        if (p.categoria_id != null) return false;
      } else if (categoriaFiltro !== '' && String(p.categoria_id ?? '') !== categoriaFiltro) {
        return false;
      }
      if (!q) return true;
      return p.nombre.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q);
    });
  }, [productos, busqueda, categoriaFiltro]);

  const abrirNuevo = () => {
    setEditando(null);
    setForm(vacio());
    setPrecioBaseTex('');
    setStockMinimoTex('0');
    setError(null);
    setModal(true);
  };

  const abrirEdicion = (p: Producto) => {
    setEditando(p);
    setForm({
      codigo: p.codigo,
      codigo_barras: p.codigo_barras,
      nombre: p.nombre,
      descripcion: p.descripcion,
      categoria_id: p.categoria_id,
      unidad_medida: p.unidad_medida,
      precio_base: p.precio_base,
      impuesto_porcentaje: p.impuesto_porcentaje,
      stock_minimo: p.stock_minimo,
      activo: p.activo,
    });
    setPrecioBaseTex((p.precio_base / 100).toFixed(2));
    setStockMinimoTex(String(p.stock_minimo));
    setError(null);
    setModal(true);
  };

  const guardar = async () => {
    if (!form.nombre.trim()) {
      setError('El nombre es obligatorio');
      return;
    }
    const precioBase = precioBaseTex.trim() === '' ? 0 : parseCentsInput(precioBaseTex, 'usd');
    if (precioBase == null) {
      setError('Ingresa un precio válido en US$ (máx. 2 decimales)');
      return;
    }
    // El stock mínimo es un umbral de aviso, no un precio: se admiten decimales
    // (un paquete de 0.5 kg) y no hace falta llevarlos a centavos. Un `NaN`
    // aquí se compara contra el stock disponible y siempre da falso, que es
    // justo el caso en que el aviso tiene que aparecer.
    const minimo = Number(stockMinimoTex.replace(',', '.'));
    const stockMinimo = stockMinimoTex.trim() === '' || !Number.isFinite(minimo) ? 0 : minimo;
    if (stockMinimo < 0) {
      setError('El stock mínimo no puede ser negativo');
      return;
    }
    const aGuardar = { ...form, precio_base: precioBase, stock_minimo: stockMinimo };
    setGuardando(true);
    setError(null);
    try {
      if (editando) {
        await actualizarProducto(editando.id, aGuardar);
      } else {
        await crearProducto(aGuardar);
      }
      setModal(false);
      cargar();
    } catch (e) {
      setError(String(e));
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async (p: Producto) => {
    if (!window.confirm(`¿Eliminar "${p.nombre}"?`)) return;
    try {
      await eliminarProducto(p.id);
      cargar();
    } catch (e) {
      window.alert(String(e));
    }
  };

  if (cargando) return <PageLoader />;

  return (
    <div>
      <PageHeader
        title="Productos"
        subtitle={`${filtrados.length} de ${productos.length} en el catálogo`}
        actions={
          <Button onClick={abrirNuevo}>
            <Plus className="h-4 w-4" /> Nuevo producto
          </Button>
        }
      />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre o código…"
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm shadow-sm focus:border-primary focus:ring-2 focus:ring-primary/40 focus:outline-none"
            />
          </div>
          {categorias.length > 0 && (
            <div className="flex w-full items-center gap-2 sm:w-56">
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
          )}
        </div>
      </Card>

      {filtrados.length === 0 ? (
        <Card>
          <EmptyState icon={<Package className="h-8 w-8" />} message="Sin productos" />
        </Card>
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <Th>Código</Th>
                <Th>Nombre</Th>
                <Th>Categoría</Th>
                <Th className="text-right">Mínimo</Th>
                <Th>Unidad</Th>
                <Th className="text-right">Precio</Th>
                <Th>Estado</Th>
                <Th className="text-right">Acciones</Th>
              </tr>
            </THead>
            <tbody>
              {filtrados.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                  <Td className="font-mono text-xs text-muted-foreground">{p.codigo}</Td>
                  <Td>
                    <span className="font-medium text-foreground">{p.nombre}</span>
                    {p.descripcion && <span className="block text-xs text-muted-foreground">{p.descripcion}</span>}
                  </Td>
                  <Td className="text-muted-foreground">{nombreDe(p.categoria_id) ?? '—'}</Td>
                  <Td className="text-right text-muted-foreground">{p.stock_minimo}</Td>
                  <Td>{p.unidad_medida}</Td>
                  <Td className="text-right">{formatUsdCents(p.precio_base)}</Td>
                  <Td>
                    <Badge tone={p.activo ? 'green' : 'gray'}>{p.activo ? 'Activo' : 'Inactivo'}</Badge>
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" aria-label={`Editar ${p.nombre}`} onClick={() => abrirEdicion(p)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" aria-label={`Eliminar ${p.nombre}`} onClick={() => eliminar(p)}>
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

      <Modal
        open={modal}
        title={editando ? 'Editar producto' : 'Nuevo producto'}
        onClose={() => setModal(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(false)}>
              Cancelar
            </Button>
            <Button onClick={guardar} disabled={guardando}>
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
          <Input label="Código" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} placeholder="P-001" />
          <Input label="Nombre *" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />
          <Select
            label="Categoría"
            value={form.categoria_id == null ? '' : String(form.categoria_id)}
            onChange={(e) =>
              setForm({ ...form, categoria_id: e.target.value === '' ? null : Number(e.target.value) })
            }
          >
            <option value="">— Sin categoría —</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </Select>
          <Select
            label="Unidad"
            value={form.unidad_medida}
            onChange={(e) => setForm({ ...form, unidad_medida: e.target.value as UnidadMedida })}
          >
            {UNIDADES.map((u) => (
              <option key={u} value={u}>
                {UNIDAD_MEDIDA_LABELS[u]}
              </option>
            ))}
          </Select>
          <Input
            label="Precio unitario (US$)"
            prefix="$"
            inputMode="decimal"
            placeholder="1.20"
            value={precioBaseTex}
            onChange={(e) => setPrecioBaseTex(e.target.value)}
          />
          <Input
            label="Stock mínimo"
            inputMode="decimal"
            placeholder="0"
            value={stockMinimoTex}
            onChange={(e) => setStockMinimoTex(e.target.value)}
            hint="El inventario avisa cuando quedan menos unidades que este número"
          />
        </div>
      </Modal>
    </div>
  );
}
