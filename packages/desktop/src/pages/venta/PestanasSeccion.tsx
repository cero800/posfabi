// Las pestañas de sección del catálogo.
//
// ## Botones y no pestañas ARIA
//
// Con `role="tab"` habría que implementar la navegación con flechas que el patrón
// de pestañas de ARIA exige, y sin eso el rol promete algo que no se cumple:
// para un lector de pantalla, "pestaña" sin flechas es un callejón sin salida.
// Un grupo de botones con `aria-pressed` dice la verdad —estos filtran— y el
// tabulador los recorre solo, sin código extra.
//
// Se agrupan bajo `aria-label="Filtrar por categoría"`, que es el nombre que ya
// usaba el desplegable anterior y del que dependen las pruebas.

import { cn } from '../../lib/cn';
import type { Categoria } from '@tienda/core';
import type { SeccionRaiz, Seleccion } from './secciones';

interface Props {
  secciones: SeccionRaiz[];
  /** Etiqueta de la pestaña de huérfanos con su contador, o `null` si no hay. */
  sinCategoria: string | null;
  /** Las hijas de la raíz activa. Vacío si no hay segunda fila que pintar. */
  hijas: Categoria[];
  seleccion: Seleccion;
  onCambiar: (seleccion: Seleccion) => void;
}

function Pestania({
  activa,
  etiqueta,
  conteo,
  onClick,
}: {
  activa: boolean;
  etiqueta: string;
  conteo?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className={cn(
        'shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
        // El morado marca dónde estás. Es el mismo acento que usa el menú lateral,
        // y a propósito es el único: dos colores de "activo" en la misma
        // pantalla harían que uno dejara de significar nada.
        activa
          ? 'bg-accent/10 font-semibold text-accent ring-1 ring-inset ring-accent/20'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {etiqueta}
      {conteo !== undefined && (
        <span className={cn('ml-1.5 text-xs tabular-nums', activa ? 'text-accent/70' : 'text-muted-foreground/70')}>
          {conteo}
        </span>
      )}
    </button>
  );
}

export function PestanasSeccion({ secciones, sinCategoria, hijas, seleccion, onCambiar }: Props) {
  // Sin secciones ni huérfanos no hay nada que filtrar: se deja el catálogo
  // entero, que es como se veía antes de que existieran las secciones.
  if (secciones.length === 0 && sinCategoria == null) return null;

  // La segunda fila depende de la *sección*, no de si está activa la raíz o una
  // de sus hijas. Si solo apareciera con la raíz activa, al pinchar una hija la
  // fila se escondería y no habría forma de volver a subir.
  const raizId =
    seleccion.nivel === 'raiz' ? seleccion.id : seleccion.nivel === 'hija' ? seleccion.raiz : null;
  const raizActiva = raizId == null ? undefined : secciones.find((s) => s.id === raizId);
  const enRaiz = seleccion.nivel === 'raiz' ? seleccion.id : null;
  const enHija = seleccion.nivel === 'hija' ? seleccion.id : null;
  const muestraHijas = raizActiva != null && hijas.length > 1;

  return (
    <div className="flex flex-col gap-1.5">
      <div role="group" aria-label="Filtrar por categoría" className="flex gap-1 overflow-x-auto pb-1">
        <Pestania
          activa={seleccion.nivel === 'todas'}
          etiqueta="Todas"
          onClick={() => onCambiar({ nivel: 'todas' })}
        />
        {secciones.map((s) => (
          <Pestania
            key={s.id}
            activa={enRaiz === s.id}
            etiqueta={s.nombre}
            conteo={s.total}
            onClick={() => onCambiar({ nivel: 'raiz', id: s.id })}
          />
        ))}
        {sinCategoria != null && (
          <Pestania
            activa={seleccion.nivel === 'sin-categoria'}
            etiqueta={sinCategoria}
            onClick={() => onCambiar({ nivel: 'sin-categoria' })}
          />
        )}
      </div>

      {muestraHijas && raizActiva && (
        <div role="group" aria-label={`Subsecciones de ${raizActiva.nombre}`} className="flex gap-1 overflow-x-auto pb-1">
          {/* "Todo", no el nombre de la raíz: la raíz ya está en la fila de arriba y
              repetirla con el mismo texto daría dos botones iguales en pantalla,
              uno para marcar dónde estás y otro para volver. */}
          <Pestania
            activa={enRaiz === raizActiva.id}
            etiqueta="Todo"
            conteo={raizActiva.total}
            onClick={() => onCambiar({ nivel: 'raiz', id: raizActiva.id })}
          />
          {hijas.map((hija) => (
            <Pestania
              key={hija.id}
              activa={enHija === hija.id}
              etiqueta={hija.nombre}
              onClick={() => onCambiar({ nivel: 'hija', id: hija.id, raiz: raizActiva.id })}
            />
          ))}
        </div>
      )}
    </div>
  );
}