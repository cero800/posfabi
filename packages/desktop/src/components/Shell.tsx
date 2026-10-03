import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ShoppingCart,
  Package,
  FolderTree,
  Users,
  Boxes,
  BarChart3,
  Wallet,
  LogOut,
  Coins,
  Settings,
} from 'lucide-react';
import { useSesion } from '../store/sesion';
import { obtenerDatosNegocio } from '../services/db';
import { trazar } from '../services/logging';
import { cn } from '../lib/cn';
import { formatVesCents } from '../lib/format';
import { Button } from './ui/Button';
import { TemaToggle } from './TemaToggle';

const nav: Array<{ to: string; label: string; icon: ReactNode; soloAdmin?: boolean }> = [
  { to: '/venta', label: 'Venta', icon: <ShoppingCart className="h-4 w-4" /> },
  { to: '/productos', label: 'Productos', icon: <Package className="h-4 w-4" /> },
  { to: '/categorias', label: 'Categorías', icon: <FolderTree className="h-4 w-4" /> },
  { to: '/clientes', label: 'Clientes', icon: <Users className="h-4 w-4" /> },
  { to: '/inventario', label: 'Inventario', icon: <Boxes className="h-4 w-4" /> },
  { to: '/reporte', label: 'Reporte', icon: <BarChart3 className="h-4 w-4" /> },
  { to: '/deudores', label: 'Deudores', icon: <Wallet className="h-4 w-4" /> },
  { to: '/cerrar-caja', label: 'Cerrar caja', icon: <Coins className="h-4 w-4" /> },
  { to: '/config', label: 'Configuración', icon: <Settings className="h-4 w-4" />, soloAdmin: true },
];

/** Lo que se ve arriba cuando el negocio todavía no tiene nombre configurado. */
const NOMBRE_POR_DEFECTO = 'POS Tienda';

const esAdmin = (rol?: string) => rol === 'admin';

export default function Shell() {
  const navegar = useNavigate();
  const operador = useSesion((s) => s.operador);
  const caja = useSesion((s) => s.caja);
  const logout = useSesion((s) => s.logout);
  const ubicacion = useLocation();
  const [negocio, setNegocio] = useState('');

  useEffect(() => {
    trazar('ruta', `Shell en ${ubicacion.pathname}`);
  }, [ubicacion.pathname]);

  // El nombre del negocio va arriba a la izquierda. Se pide una sola vez, al
  // montar: son cuatro valores de configuración que no cambian durante el día,
  // y pedirlos en cada navegación sería una llamada por cada cambio de página.
  // Si el nombre cambia, se ve al volver a entrar, que es cuando el POS se
  // reinicia en la tienda.
  useEffect(() => {
    obtenerDatosNegocio()
      .then((d) => setNegocio(d.nombre.trim()))
      .catch(() => setNegocio(''));
  }, []);

  const salir = () => {
    logout();
    navegar('/login');
  };

  const items = nav.filter((item) => !item.soloAdmin || esAdmin(operador?.rol));

  return (
    <div className="flex h-screen bg-muted">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card">
        <div className="border-b border-border px-4 py-4">
          <p className="truncate text-sm font-bold text-card-foreground">{negocio || NOMBRE_POR_DEFECTO}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Punto de venta</p>
        </div>

        <nav className="flex-1 space-y-1 px-2 py-3">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  // El morado se reserva para el estado activo: es el único acento
                  // de la pantalla, y con nueve entradas del menú es la que
                  // dice dónde estás sin gritar.
                  isActive
                    ? 'bg-accent/10 text-accent'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-border p-3">
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{operador?.nombre}</p>
              <p className="text-xs text-muted-foreground">{caja?.estado}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={salir} aria-label="Cerrar sesión">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-4">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>{caja?.fecha?.slice(0, 10) ?? '—'}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <TemaToggle />
            <span className="text-muted-foreground">
              Tasa del día:{' '}
              <strong className="text-foreground" data-testid="tasa-bar">
                {formatVesCents(Math.round(useSesion.getState().tasa * 100))}
              </strong>
            </span>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto p-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}