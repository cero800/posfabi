// Catálogo e inventario en una sola pantalla.
//
// ## Por qué están juntos
//
// Antes había dos pantallas: «Productos» (el catálogo: alta, edición, baja y
// precio) e «Inventario» (las existencias: recibir, merma y ajuste). En la
// práctica son la misma cosa vista desde dos lados: el dueño de la papelería no
// piensa «voy a crear un producto» y luego «voy a cargarle stock»; piensa «me
// llegó mercancía» y hace las dos cosas de un tirón. Separadas obligaban a
// crear el producto en una pantalla, cambiar de sección y cargarle el stock en
// la otra, y como el producto recién creado no tenía fila de stock, no aparecía
// en Inventario hasta después. Ahora se da de alta con su cantidad inicial y
// queda cuadrado desde el primer momento.
//
// ## Cómo se arma la tabla
//
// Se cruzan dos listas en el frontend, no en SQL. `listarStock` trae las
// existencias (solo productos activos y solo los que ya tienen fila de stock),
// y `listarProductos` trae el catálogo entero, con precio, unidad y estado. La
// tabla muestra la unión: un producto inactivo, o uno activo al que todavía no
// se le cargó nada, igual aparece. Se hace aquí y no con un JOIN nuevo en el
// backend porque es una decisión de presentación —qué columnas se ven juntas—
// y el backend ya tiene los dos procedures que hacen falta.
//
// ## El precio de un cliente con precio especial no vive aquí
//
// Está en otra tabla (`precios_cliente`) y se edita desde la pantalla de venta.
// La descripción y el código de barras se guardan pero no tienen campo: son
// datos que se cargan al vuelo, no algo que el cajero escriba a cada rato.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  FolderTree,
  MinusCircle,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2,
} from 'lucide-react';
import type { Categoria, Producto, ProductoInput, StockItem, UnidadMedida } from '@tienda/core';
import { UNIDADES_MEDIDA, UNIDAD_MEDIDA_LABELS } from '@tienda/core';
import {
  actualizarProducto,
  crearProducto,
  eliminarProducto,
  listarCategorias,
  listarProductos,
  listarStock,
  registrarAjuste,
  registrarEntradaMercancia,
  registrarMerma,
} from '../services/db';
import { formatUsdCents, hoyIso, parseCentsInput } from '../lib/format';
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

const UNIDADES: readonly UnidadMedida[] = UNIDADES_MEDIDA;

type Accion = 'entrada' | 'merma' | 'ajuste';

/** Una fila de la tabla: lo que hay que mostrar, ya cruzado y sin huecos. */
interface Fila {
  producto: Producto;
  /** Existencias. `null` cuando el producto todavía no tiene fila de stock. */
  stock: StockItem | null;
  categoria: string | null;
}

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

export default function InventarioPage() {
  const operadorId = useSesion((s) => s.operador?.id ?? 0);
  const esAdmin = useSesion((s) => s.operador?.rol === 'admin');

  const [productos, setProductos] = useState<Producto[]>([]);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [cargando, setCargando] = useState(true);

  const [busqueda, setBusqueda] = useState('');
  const [categoriaFiltro, setCategoriaFiltro] = useState('');
  const [estadoFiltro, setEstadoFiltro] = useState('');

  // Formulario de producto (alta y edición).
  const [modal, setModal] = useState(false);
  const [editando, setEditando] = useState<Producto | null>(null);
  const [form, setForm] = useState<ProductoInput>(vacio());
  const [precioBaseTex, setPrecioBaseTex] = useState('');
  const [stockMinimoTex, setStockMinimoTex] = useState('0');
  const [cantidadInicialTex, setCantidadInicialTex] = useState('');
  const [costoInicialTex, setCostoInicialTex] = useState('');
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const [guardandoForm, setGuardandoForm] = useState(false);

  // Movimientos de inventario (entrada, merma y ajuste).
  const [accion, setAccion] = useState<Accion | null>(null);
  const [productoId, setProductoId] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [costo, setCosto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [fecha, setFecha] = useState(hoyIso());
  const [errorMov, setErrorMov] = useState<string | null>(null);
  const [guardandoMov, setGuardandoMov] = useState(false);

  const cargar = () =>
    Promise.all([listarProductos(), listarStock()])
      .then(([ps, ss]) => {
        setProductos(ps);
        setStock(ss);
      })
      .finally(() => setCargando(false));

  useEffect(() => {
    cargar();
    // Las categorías son para filtrar y elegir. Si esta llamada falla —el POS
    // arrancando, el backend todavía no listo— la pantalla tiene que servir
    // igual con la lista de productos sin filtro, no quedarse en blanco.
    listarCategorias()
      .then(setCategorias)
      .catch(() => setCategorias([]));
  }, []);

  const nombreDeCategoria = useMemo(() => {
    const porId = new Map(categorias.map((c) => [c.id, c.nombre]));
    return (id: number | null | undefined): string | null => (id == null ? null : (porId.get(id) ?? null));
  }, [categorias]);

  /** El catálogo entero, cruzado con sus existencias. */
  const filas = useMemo<Fila[]>(() => {
    const stockPorProducto = new Map(stock.map((s) => [s.producto_id, s]));
    return productos.map((producto) => ({
      producto,
      stock: stockPorProducto.get(producto.id) ?? null,
      categoria: nombreDeCategoria(producto.categoria_id),
    }));
  }, [productos, stock, nombreDeCategoria]);

  const disponibleDe = useCallback((f: Fila) => f.stock?.cantidad_disponible ?? 0, []);
  const bajoMinimo = useCallback(
    (f: Fila) => f.producto.stock_minimo > 0 && disponibleDe(f) < f.producto.stock_minimo,
    [disponibleDe],
  );

  const agotados = useMemo(
    () => filas.filter((f) => f.producto.activo && disponibleDe(f) <= 0),
    [filas, disponibleDe],
  );
  const porDebajoDelMinimo = useMemo(
    () => filas.filter((f) => f.producto.activo && bajoMinimo(f)),
    [filas, bajoMinimo],
  );

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return filas.filter((f) => {
      if (categoriaFiltro === 'sin-categoria') {
        if (f.producto.categoria_id != null) return false;
      } else if (categoriaFiltro !== '' && String(f.producto.categoria_id ?? '') !== categoriaFiltro) {
        return false;
      }
      if (estadoFiltro === 'activos' && !f.producto.activo) return false;
      if (estadoFiltro === 'inactivos' && f.producto.activo) return false;
      if (estadoFiltro === 'agotados' && !(f.producto.activo && disponibleDe(f) <= 0)) return false;
      if (estadoFiltro === 'bajo' && !(f.producto.activo && bajoMinimo(f))) return false;
      if (!q) return true;
      return (
        f.producto.nombre.toLowerCase().includes(q) || f.producto.codigo.toLowerCase().includes(q)
      );
    });
  }, [filas, busqueda, categoriaFiltro, estadoFiltro, disponibleDe, bajoMinimo]);

  //-----------------------------------------------------------------------
  // Formulario de producto
  //-----------------------------------------------------------------------

  const abrirNuevo = () => {
    setEditando(null);
    setForm(vacio());
    setPrecioBaseTex('');
    setStockMinimoTex('0');
    setCantidadInicialTex('');
    setCostoInicialTex('');
    setErrorForm(null);
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
    setCantidadInicialTex('');
    setCostoInicialTex('');
    setErrorForm(null);
    setModal(true);
  };

  const guardarProducto = async () => {
    if (!form.nombre.trim()) {
      setErrorForm('El nombre es obligatorio');
      return;
    }
    const precioBase = precioBaseTex.trim() === '' ? 0 : parseCentsInput(precioBaseTex, 'usd');
    if (precioBase == null) {
      setErrorForm('Ingresa un precio válido en US$ (máx. 2 decimales)');
      return;
    }
    // El stock mínimo es un umbral de aviso, no un precio: se admiten decimales
    // (un paquete de 0.5 kg) y no hace falta llevarlos a centavos.
    const minimo = Number(stockMinimoTex.replace(',', '.'));
    const stockMinimo = stockMinimoTex.trim() === '' || !Number.isFinite(minimo) ? 0 : minimo;
    if (stockMinimo < 0) {
      setErrorForm('El stock mínimo no puede ser negativo');
      return;
    }
    // La cantidad inicial solo tiene sentido al crear. Es opcional: un producto
    // se puede dar de alta sin stock y cargarlo después con «Recibir mercancía».
    const inicial = cantidadInicialTex.trim() === '' ? 0 : Number(cantidadInicialTex.replace(',', '.'));
    if (!Number.isFinite(inicial) || inicial < 0) {
      setErrorForm('La cantidad inicial no puede ser negativa');
      return;
    }

    const aGuardar = { ...form, precio_base: precioBase, stock_minimo: stockMinimo };
    setGuardandoForm(true);
    setErrorForm(null);
    try {
      if (editando) {
        await actualizarProducto(editando.id, aGuardar);
      } else {
        const nuevoId = await crearProducto(aGuardar);
        // Si se pidió cantidad inicial, se registra como entrada de mercancía y
        // no como un INSERT suelto en `stock`: así queda el movimiento en el
        // historial y el costo, igual que si se hubiera recibido por separado.
        if (inicial > 0) {
          await registrarEntradaMercancia({
            producto_id: nuevoId,
            cantidad: inicial,
            costo_unitario: costoInicialTex.trim() === '' ? precioBase : (parseCentsInput(costoInicialTex, 'usd') ?? precioBase),
            operador_id: operadorId,
            fecha: hoyIso(),
          });
        }
      }
      setModal(false);
      cargar();
    } catch (e) {
      setErrorForm(String(e));
    } finally {
      setGuardandoForm(false);
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

  const alternarActivo = async (p: Producto) => {
    try {
      await actualizarProducto(p.id, {
        codigo: p.codigo,
        codigo_barras: p.codigo_barras,
        nombre: p.nombre,
        descripcion: p.descripcion,
        categoria_id: p.categoria_id,
        unidad_medida: p.unidad_medida,
        precio_base: p.precio_base,
        impuesto_porcentaje: p.impuesto_porcentaje,
        stock_minimo: p.stock_minimo,
        activo: !p.activo,
      });
      cargar();
    } catch (e) {
      window.alert(String(e));
    }
  };

  //-----------------------------------------------------------------------
  // Movimientos de inventario
  //-----------------------------------------------------------------------

  const abrirMovimiento = (a: Accion, productoIdDefault?: number) => {
    setAccion(a);
    setProductoId(productoIdDefault != null ? String(productoIdDefault) : '');
    setCantidad('');
    setCosto('');
    setMotivo('');
    setFecha(hoyIso());
    setErrorMov(null);
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

  const ejecutarMovimiento = async () => {
    const pid = Number(productoId);
    const cant = Number(cantidad.replace(',', '.'));
    const esAjuste = accion === 'ajuste';
    if (!productoId || !Number.isFinite(cant) || (esAjuste ? cant === 0 : cant <= 0)) {
      setErrorMov('Selecciona el producto e ingresa una cantidad válida');
      return;
    }
    if (accion === 'merma' && !motivo.trim()) {
      setErrorMov('La merma requiere un motivo');
      return;
    }
    setGuardandoMov(true);
    setErrorMov(null);
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
          cantidad_delta: cant,
          motivo: motivo.trim() || 'Ajuste manual',
          operador_id: operadorId,
        });
      }
      setAccion(null);
      cargar();
    } catch (e) {
      setErrorMov(String(e));
    } finally {
      setGuardandoMov(false);
    }
  };

  if (cargando) return <PageLoader />;

  return (
    <div>
      <PageHeader
        title="Inventario"
        subtitle={`${filtradas.length} de ${productos.length} productos`}
        actions={
          <>
            {esAdmin && (
              <>
                <Button variant="secondary" onClick={() => abrirMovimiento('merma')}>
                  <MinusCircle className="h-4 w-4" /> Merma
                </Button>
                <Button variant="secondary" onClick={() => abrirMovimiento('ajuste')}>
                  <Settings2 className="h-4 w-4" /> Ajuste
                </Button>
              </>
            )}
            <Button variant="secondary" onClick={() => abrirMovimiento('entrada')}>
              <PackagePlus className="h-4 w-4" /> Recibir mercancía
            </Button>
            <Button onClick={abrirNuevo}>
              <Plus className="h-4 w-4" /> Nuevo producto
            </Button>
          </>
        }
      />

      {agotados.length > 0 && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          ¡Ojo! {agotados.length} producto(s) con stock agotado o negativo:{' '}
          {agotados.map((f) => f.producto.nombre).join(', ')}.
        </div>
      )}

      {porDebajoDelMinimo.length > 0 && (
        <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          {porDebajoDelMinimo.length} producto(s) por debajo del mínimo:{' '}
          {porDebajoDelMinimo.map((f) => f.producto.nombre).join(', ')}.
        </div>
      )}

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
          <div className="w-full sm:w-48">
            <Select
              aria-label="Filtrar por estado"
              value={estadoFiltro}
              onChange={(e) => setEstadoFiltro(e.target.value)}
            >
              <option value="">Todos los estados</option>
              <option value="activos">Activos</option>
              <option value="inactivos">Inactivos</option>
              <option value="agotados">Agotados</option>
              <option value="bajo">Bajo mínimo</option>
            </Select>
          </div>
        </div>
      </Card>

      {filtradas.length === 0 ? (
        <Card>
          <EmptyState icon={<Boxes className="h-8 w-8" />} message="Sin productos que mostrar" />
        </Card>
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <Th>Código</Th>
                <Th>Producto</Th>
                <Th>Categoría</Th>
                <Th className="text-right">Precio</Th>
                <Th className="text-right">Disponible</Th>
                <Th className="text-right">Mínimo</Th>
                <Th>Unidad</Th>
                <Th>Estado</Th>
                <Th className="text-right">Acciones</Th>
              </tr>
            </THead>
            <tbody>
              {filtradas.map((f) => {
                const p = f.producto;
                const disponible = disponibleDe(f);
                const bajo = bajoMinimo(f);
                const tone = !p.activo ? 'gray' : disponible <= 0 ? 'red' : bajo ? 'amber' : 'green';
                const etiqueta = !p.activo
                  ? 'Inactivo'
                  : disponible <= 0
                    ? 'Agotado'
                    : bajo
                      ? 'Bajo mínimo'
                      : 'Disponible';
                return (
                  <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                    <Td className="font-mono text-xs text-muted-foreground">{p.codigo}</Td>
                    <Td>
                      <span className="font-medium text-foreground">{p.nombre}</span>
                      {p.descripcion && (
                        <span className="block text-xs text-muted-foreground">{p.descripcion}</span>
                      )}
                    </Td>
                    <Td className="text-muted-foreground">{f.categoria ?? '—'}</Td>
                    <Td className="text-right">{formatUsdCents(p.precio_base)}</Td>
                    <Td className="text-right font-semibold">{disponible}</Td>
                    <Td className="text-right text-muted-foreground">{p.stock_minimo}</Td>
                    <Td>{p.unidad_medida}</Td>
                    <Td>
                      <Badge tone={tone}>{etiqueta}</Badge>
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => abrirMovimiento('entrada', p.id)}
                          aria-label={`Recibir mercancía de ${p.nombre}`}
                        >
                          <PackagePlus className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Editar ${p.nombre}`}
                          onClick={() => abrirEdicion(p)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {esAdmin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`${p.activo ? 'Desactivar' : 'Activar'} ${p.nombre}`}
                            onClick={() => alternarActivo(p)}
                          >
                            {p.activo ? 'Desactivar' : 'Activar'}
                          </Button>
                        )}
                        {esAdmin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Eliminar ${p.nombre}`}
                            onClick={() => eliminar(p)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}

      {/* Alta y edición del producto. En el alta se puede cargar el stock inicial
          de una vez; al editar, el stock se ajusta con «Recibir mercancía»,
          «Merma» o «Ajuste», que sí dejan el movimiento en el historial. */}
      <Modal
        open={modal}
        title={editando ? 'Editar producto' : 'Nuevo producto'}
        onClose={() => setModal(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(false)}>
              Cancelar
            </Button>
            <Button onClick={guardarProducto} disabled={guardandoForm}>
              {guardandoForm ? 'Guardando…' : 'Guardar'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {errorForm && (
            <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {errorForm}
            </p>
          )}
          <Input
            label="Código"
            value={form.codigo}
            onChange={(e) => setForm({ ...form, codigo: e.target.value })}
            placeholder="P-001"
          />
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

          {!editando && (
            <>
              <div className="border-t border-border pt-3" />
              <div className="flex gap-3">
                <div className="flex-1">
                  <Input
                    label="Cantidad inicial"
                    inputMode="decimal"
                    placeholder="0"
                    value={cantidadInicialTex}
                    onChange={(e) => setCantidadInicialTex(e.target.value)}
                    hint="Stock con el que arranca. Se registra como entrada"
                  />
                </div>
                <div className="flex-1">
                  <Input
                    label="Costo unitario (US$)"
                    prefix="$"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={costoInicialTex}
                    onChange={(e) => setCostoInicialTex(e.target.value)}
                    hint="Vacío usa el precio de venta"
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* Recepción, merma y ajuste: suman o restan existencias dejando registro. */}
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
            <Button onClick={ejecutarMovimiento} disabled={guardandoMov}>
              {guardandoMov ? 'Guardando…' : 'Guardar'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {errorMov && (
            <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {errorMov}
            </p>
          )}
          <Select label="Producto" value={productoId} onChange={(e) => elegirProducto(e.target.value)}>
            <option value="">— Seleccionar —</option>
            {productos
              .filter((p) => p.activo)
              .map((p) => (
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
