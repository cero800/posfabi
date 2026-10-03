// La rejilla del catálogo, agrupada en secciones.
//
// ## Un solo contenedor de scroll
//
// Antes había un `overflow-y-auto` en la propia rejilla. Con secciones hay varios
// bloques y cada uno necesita su cabecera, así que el scroll va en un ancestro
// común: si no, cada bloque scrollearía por su cuenta y las cabeceras quedarían
// clavadas en sitios que no son la parte alta de nada.
//
// ## Cuándo se ven las cabeceras
//
// Solo con "Todas" activo y más de un bloque. Con una sección elegida la pestaña
// ya dice dónde estás, y repetirlo sobre cada bloque es ruido. Con la búsqueda
// activa el catálogo viene desagrupado y no hay nada que encabezar. Lo decide
// `secciones.ts`; aquí solo se pinta.

import type { Producto } from '@tienda/core';

import type { Bloque } from './secciones';
import { ProductoCard } from './ProductoCard';

interface Props {
  bloques: Bloque[];
  mostrarCabeceras: boolean;
  precioDe: (producto: Producto) => number;
  stock: Record<number, number>;
  onAgregar: (producto: Producto) => void;
}

const REJILLA = 'grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4';

export function CatalogoSecciones({ bloques, mostrarCabeceras, precioDe, stock, onAgregar }: Props) {
  // Distinguir "no hay nada" de "esto está vacío" es cosa de los dos sitios por
  // los que se puede llegar aquí. Si no sale ni un producto en toda la pantalla,
  // lo que falló fue la búsqueda —o el filtro—, y el mensaje tiene que decirlo. Si
  // solo una sección sale vacía, lo que falta es contenido en ella, y es otra
  // cosa: decir "sin productos que coincidan" debajo de un catálogo lleno
  // desconcierta, y hace dudar de si la pantalla se cargó bien.
  const total = bloques.reduce((acc, b) => acc + b.productos.length, 0);

  if (total === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Sin productos que coincidan.</p>;
  }

  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
      {bloques.map((bloque) => (
        <section key={bloque.categoriaId ?? 'sin-categoria'} aria-label={bloque.titulo}>
          {mostrarCabeceras && (
            <header className="mb-2 flex items-baseline gap-2">
              <h2 className="text-sm font-semibold text-foreground">{bloque.titulo}</h2>
              <span className="text-xs tabular-nums text-muted-foreground">{bloque.productos.length}</span>
            </header>
          )}
          {bloque.productos.length === 0 ? (
            // Una sección vacía con su cabecera es información: el cajero ve que
            // existe y que no hay nada dentro. Sin cabecera, un hueco en blanco
            // parece un fallo de carga.
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              Sin productos en esta sección
            </p>
          ) : (
            <div className={REJILLA}>
              {bloque.productos.map((p) => (
                <ProductoCard
                  key={p.id}
                  nombre={p.nombre}
                  codigo={p.codigo}
                  precio={precioDe(p)}
                  stock={stock[p.id]}
                  onAgregar={() => onAgregar(p)}
                  deshabilitado={(stock[p.id] ?? Infinity) <= 0}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}