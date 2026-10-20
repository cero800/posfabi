import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ShoppingCart,
  FolderTree,
  Users,
  Boxes,
  BarChart3,
  Wallet,
  LogOut,
  Coins,
  Settings,
  Store,
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
  { to: '/inventario', label: 'Inventario', icon: <Boxes className="h-4 w-4" /> },
  { to: '/categorias', label: 'Categorías', icon: <FolderTree className="h-4 w-4" /> },
  { to: '/clientes', label: 'Clientes', icon: <Users className="h-4 w-4" /> },
  { to: '/reporte', label: 'Reporte', icon: <BarChart3 className="h-4 w-4" /> },
  { to: '/deudores', label: 'Deudores', icon: <Wallet className="h-4 w-4" /> },
  { to: '/cerrar-caja', label: 'Cerrar caja', icon: <Coins className="h-4 w-4" /> },
  { to: '/config', label: 'Configuración', icon: <Settings className="h-4 w-4" />, soloAdmin: true },
];

/** Lo que se ve arriba cuando el negocio todavía no tiene nombre configurado. */
const NOMBRE_POR_DEFECTO = 'POS Tienda';

const esAdmin = (rol?: string) => rol === 'admin';

/** Iniciales del operador para el avatar de la barra superior. */
function inicialesDe(nombre: string | undefined): string {
  if (!nombre) return '?';
  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

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
    <div className="flex h-screen flex-col bg-muted">
      {/* App bar: identidad y operación del día. Aquí vive también el interruptor
          de tema, que es lo que las pruebas buscan en la barra superior. */}
      <header className="shrink-0">
        <div className="flex h-14 items-center justify-between gap-4 border-b border-border bg-card px-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-card">
              <Store className="h-5 w-5" />
            </div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-bold text-card-foreground">{negocio || NOMBRE_POR_DEFECTO}</p>
              <p className="text-xs text-muted-foreground">Punto de venta</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {/* Fecha y tasa del día: el contexto que el cajero consulta sin pedirlo. */}
            <span className="hidden text-sm tabular-nums text-muted-foreground md:block">
              {caja?.fecha?.slice(0, 10) ?? '—'}
            </span>
            <div className="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
              <span>Tasa</span>
              <strong className="text-sm text-foreground" data-testid="tasa-bar">
                {formatVesCents(Math.round(useSesion.getState().tasa * 100))}
              </strong>
            </div>
            <TemaToggle />
            <div className="hidden h-6 w-px bg-border sm:block" />
            <div className="flex items-center gap-2">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/10 text-sm font-bold text-accent">
                {inicialesDe(operador?.nombre)}
              </div>
              <div className="hidden leading-tight lg:block">
                <p className="max-w-32 truncate text-sm font-semibold text-foreground">{operador?.nombre}</p>
                <p className="text-xs text-muted-foreground">{caja?.estado}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={salir} aria-label="Cerrar sesión">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Navegación horizontal: las secciones van en una cinta bajo la app bar,
            no en una columna a la izquierda. El morado marca dónde estás. */}
        <nav
          aria-label="Secciones"
          className="flex h-12 items-center gap-1 overflow-x-auto border-b border-border bg-card/60 px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent/10 text-accent ring-1 ring-inset ring-accent/20'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-4">
        <Outlet />
      </main>
    </div>
  );
}
