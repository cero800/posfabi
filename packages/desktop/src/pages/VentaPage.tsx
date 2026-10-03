import { useEffect, useMemo, useState } from 'react';
import { Minus, Plus, Search, ShoppingCart, Trash2, X } from 'lucide-react';
import type { Categoria, Cliente, Factura, Producto, VentaInput } from '@tienda/core';
import {
  crearVenta,
  getFactura,
  listarCategorias,
  listarClientes,
  listarPreciosCliente,
  listarProductos,
  listarStock,
} from '../services/db';
import { useCarrito } from '../store/carrito';
import { useSesion } from '../store/sesion';
import { formatUsdCents, formatVesCents } from '../lib/format';
import { STOCK_BAJO } from '../lib/stock';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { PageLoader } from '../components/ui/Spinner';
import { FacturaModal } from '../components/ui/FacturaModal';
import ClienteAutocomplete, { esMostrador } from './venta/ClienteAutocomplete';
import PrecioEspecialModal from './venta/PrecioEspecialModal';
import CobroModal from './venta/CobroModal';
import { CatalogoSecciones } from './venta/CatalogoSecciones';
import { PestanasSeccion } from './venta/PestanasSeccion';
import {
  bloques as bloquesDe,
  conCabeceras,
  desagrupar,
  seccionesRaiz,
  hijasDe,
  etiquetaSinCategoria,
  SIN_CATEGORIA_SEL,
  TODAS,
  type Seleccion,
} from './venta/secciones';

export default function VentaPage() {
  const tasa = useSesion((s) => s.tasa);

  const [productos, setProductos] = useState<Producto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [seleccion, setSeleccion] = useState<Seleccion>(TODAS);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [stock, setStock] = useState<Record<number, number>>({});
  const [busqueda, setBusqueda] = useState('');
  const [clienteId, setClienteId] = useState<number | null>(null);
  const [preciosEspeciales, setPreciosEspeciales] = useState<Record<number, number>>({});
  const [cargando, setCargando] = useState(true);
  const [cobroAbierto, setCobroAbierto] = useState(false);
  const [preciosAbierto, setPreciosAbierto] = useState(false);
  const [factura, setFactura] = useState<Factura | null>(null);
  const [cantidadPara, setCantidadPara] = useState<Producto | null>(null);
  const [cantidad, setCantidad] = useState('1');

  const lineas = useCarrito((s) => s.lineas);
  const agregar = useCarrito((s) => s.agregar);

  useEffect(() => {
    Promise.all([listarProductos(), listarClientes(), listarStock()])
      .then(([ps, es, ss]) => {
        setProductos(ps.filter((p) => p.activo));
        setClientes(es);
        const mostrador = es.find(esMostrador);
        setClienteId(mostrador?.id ?? es[0]?.id ?? null);
        setStock(Object.fromEntries(ss.map((s) => [s.producto_id, s.cantidad_disponible])));
      })
      .finally(() => setCargando(false));
    // Aparte y con su propio `catch`: si el filtro por categoría no se puede
    // cargar, la venta tiene que seguir funcionando sin él. Un `Promise.all`
    // tiraría los productos y los clientes por tierra porque fallara una lista
    // que es solo comodidad.
    listarCategorias()
      .then(setCategorias)
      .catch(() => setCategorias([]));
  }, []);

  const recargarPrecios = async (clienteId: number) => {
    try {
      const precios = await listarPreciosCliente(clienteId);
      const mapa = Object.fromEntries(precios.map((p) => [p.producto_id, p.precio_especial]));
      setPreciosEspeciales(mapa);
      useCarrito
        .getState()
        .aplicarPrecios(new Map(Object.entries(mapa).map(([k, v]) => [Number(k), v])));
    } catch {
      setPreciosEspeciales({});
    }
  };

  useEffect(() => {
    if (clienteId == null) return;
    void recargarPrecios(clienteId);
  }, [clienteId]);

  // F6 abre/cierra el modal de precio especial del cliente seleccionado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F6') {
        e.preventDefault();
        const actual = clientes.find((x) => x.id === clienteId) ?? null;
        if (actual && !esMostrador(actual)) setPreciosAbierto((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clientes, clienteId]);

  const clienteActual = clientes.find((e) => e.id === clienteId) ?? null;
  const sePermiteCredito = clienteActual != null && !esMostrador(clienteActual);

  const efectivoDe = (p: Producto) => preciosEspeciales[p.id] ?? p.precio_base;

  // Catálogo ya filtrado por la sección elegida y por lo que se haya escrito.
  // El orden importa: la sección va primero a propósito, porque en un catálogo de
  // papelería el cajero casi nunca busca por nombre —busca "cuaderno
  // universitario" y le aparecen treinta—, lo que hace es mirar una sección y
  // recorrerla. La búsqueda sigue funcionando encima de la sección.
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return productos.filter((p) => {
      if (seleccion.nivel === 'sin-categoria') {
        if (p.categoria_id != null) return false;
      } else if (seleccion.nivel === 'raiz' || seleccion.nivel === 'hija') {
        if (p.categoria_id !== seleccion.id) return false;
      }
      if (!q) return true;
      return p.nombre.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q);
    });
  }, [productos, busqueda, seleccion]);

  const secciones = useMemo(() => seccionesRaiz(categorias, productos), [categorias, productos]);
  const sinCategoria = useMemo(
    () => etiquetaSinCategoria(categorias, productos),
    [categorias, productos],
  );
  // Las hijas de la sección en la que estamos, este el nivel que sea: con una
  // subsección activa sigue haciendo falta la fila para poder volver a subir.
  const hijas = useMemo(() => {
    if (seleccion.nivel === 'raiz') return hijasDe(categorias, seleccion.id);
    if (seleccion.nivel === 'hija') return hijasDe(categorias, seleccion.raiz);
    return [];
  }, [categorias, seleccion]);

  const bloques = useMemo(
    () => bloquesDe(categorias, filtrados, seleccion),
    [categorias, filtrados, seleccion],
  );

  // Escribir en el buscador desagrupa el catálogo: ver arriba por qué. Y ya en
  // esa lista plana no tiene sentido contar qué secciones quedan.
  const agrupado = !desagrupar(busqueda);
  const mostrarCabeceras = agrupado && conCabeceras(categorias, filtrados, seleccion);

  const subtotal = useMemo(() => lineas.reduce((acc, l) => acc + Math.round(l.precio * l.cantidad), 0), [lineas]);

  const abrirCantidad = (p: Producto) => {
    setCantidadPara(p);
    setCantidad('1');
  };

  const confirmarCantidad = () => {
    if (!cantidadPara) return;
    const n = Math.floor(Number(cantidad));
    if (Number.isFinite(n) && n > 0) {
      const p = cantidadPara;
      agregar({
        producto_id: p.id,
        codigo: p.codigo,
        nombre: p.nombre,
        unidad: p.unidad_medida,
        precio: efectivoDe(p),
        cantidad: n,
      });
    }
    setCantidadPara(null);
  };

  const confirmarVenta = async (venta: VentaInput) => {
    const v = await crearVenta(venta);
    useCarrito.getState().vaciar();
    setCobroAbierto(false);
    try {
      setFactura(await getFactura(v.id));
    } catch {
      setFactura(null);
    }
  };

  const cantidadNum = cantidadPara ? Math.floor(Number(cantidad)) : 0;
  const stockDisponible = cantidadPara ? (stock[cantidadPara.id] ?? Infinity) : Infinity;
  const cantidadValida = Number.isFinite(cantidadNum) && cantidadNum > 0 && cantidadNum <= stockDisponible;
  const cantidadError =
    cantidadPara && cantidad.trim() !== ''
      ? !Number.isFinite(cantidadNum) || cantidadNum <= 0
        ? 'Ingresa una cantidad válida'
        : cantidadNum > stockDisponible
          ? `Solo hay ${stock[cantidadPara.id]} disponibles`
          : undefined
      : undefined;

  if (cargando) return <PageLoader />;

  return (
    <div className="flex h-full gap-4">
      {/* Catálogo */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar producto por nombre o código…"
              aria-label="Buscar producto"
              className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm text-foreground shadow-card transition placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          {busqueda && (
            <Button variant="ghost" size="sm" onClick={() => setBusqueda('')} aria-label="Limpiar búsqueda">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        <PestanasSeccion
          secciones={secciones}
          sinCategoria={sinCategoria}
          hijas={hijas}
          seleccion={seleccion}
          onCambiar={setSeleccion}
        />

        <CatalogoSecciones
          bloques={agrupado ? bloques : [{ categoriaId: null, titulo: '', productos: filtrados }]}
          mostrarCabeceras={mostrarCabeceras}
          precioDe={efectivoDe}
          stock={stock}
          onAgregar={abrirCantidad}
        />
      </div>

      {/* Carrito */}
      <Card className="flex w-80 shrink-0 flex-col">
        <CardHeader title="Carrito" subtitle={`Tasa ${formatVesCents(Math.round(tasa * 100))}`} />
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="px-3 pt-2">
            <ClienteAutocomplete
              clientes={clientes}
              clienteId={clienteId}
              onChange={(id) => setClienteId(id)}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            {lineas.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <ShoppingCart className="h-8 w-8" />
                <p className="text-sm">Agrega productos para comenzar</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {lineas.map((l) => (
                  <li key={l.producto_id} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{l.nombre}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatUsdCents(l.precio)} × {l.cantidad}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        aria-label={`Menos ${l.nombre}`}
                        onClick={() => useCarrito.getState().setCantidad(l.producto_id, l.cantidad - 1)}
                        className="rounded-md border border-border p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-8 text-center text-sm font-semibold">{l.cantidad}</span>
                      <button
                        aria-label={`Más ${l.nombre}`}
                        onClick={() => useCarrito.getState().setCantidad(l.producto_id, l.cantidad + 1)}
                        className="rounded-md border border-border p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        aria-label={`Quitar ${l.nombre}`}
                        onClick={() => useCarrito.getState().quitar(l.producto_id)}
                        className="ml-1 rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <strong className="w-16 text-right text-sm">{formatUsdCents(Math.round(l.precio * l.cantidad))}</strong>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-border px-3 py-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total</span>
              <strong className="text-xl text-foreground" data-testid="total-usd">{formatUsdCents(subtotal)}</strong>
            </div>
            {subtotal > 0 && (
              <p className="mb-2 text-xs text-muted-foreground" data-testid="total-bs">
                ≈ {formatVesCents(Math.round(subtotal * tasa))}
              </p>
            )}
            {clienteActual && !esMostrador(clienteActual) && (
              <Button
                variant="secondary"
                size="sm"
                className="mb-2 w-full"
                onClick={() => setPreciosAbierto(true)}
              >
                Precio cliente (F6)
              </Button>
            )}
            <Button className="w-full" size="lg" disabled={lineas.length === 0} onClick={() => setCobroAbierto(true)}>
              Cobrar
            </Button>
          </div>
        </div>
      </Card>

      {clienteId != null && (
        <CobroModal
          abre={cobroAbierto}
          total={subtotal}
          clienteId={clienteId}
          sePermiteCredito={sePermiteCredito}
          onCerrar={() => setCobroAbierto(false)}
          onConfirmar={confirmarVenta}
        />
      )}

      <PrecioEspecialModal
        abierto={preciosAbierto}
        cliente={clienteActual}
        productos={productos}
        preciosEspeciales={preciosEspeciales}
        onCerrar={() => setPreciosAbierto(false)}
        onGuardado={() => clienteId != null && void recargarPrecios(clienteId)}
      />

      {/* Pide la cantidad al agregar un producto */}
      <Modal
        open={cantidadPara != null}
        title={cantidadPara ? `Agregar ${cantidadPara.nombre}` : 'Agregar producto'}
        onClose={() => setCantidadPara(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCantidadPara(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmarCantidad} disabled={!cantidadValida}>
              Agregar
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {cantidadPara && (
            <p className="text-sm text-muted-foreground">
              Precio unitario <strong>{formatUsdCents(efectivoDe(cantidadPara))}</strong>
              {stock[cantidadPara.id] != null && (
                <span
                  className={`ml-2 text-xs ${
                    (stock[cantidadPara.id] ?? 0) <= STOCK_BAJO
                      ? 'font-semibold text-destructive'
                      : 'text-muted-foreground'
                  }`}
                >
                  Disponible: {stock[cantidadPara.id]}
                </span>
              )}
            </p>
          )}
          <Input
            autoFocus
            label="Cantidad"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            inputMode="numeric"
            error={cantidadError}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && cantidadValida) confirmarCantidad();
            }}
          />
          {cantidadPara && cantidadValida && (
            <p className="text-xs text-muted-foreground">
              Total: <strong>{formatUsdCents(Math.round(efectivoDe(cantidadPara) * Number(cantidad)))}</strong>
            </p>
          )}
        </div>
      </Modal>

      {/* Factura de la venta recién registrada */}
      <FacturaModal factura={factura} onClose={() => setFactura(null)} />
    </div>
  );
}