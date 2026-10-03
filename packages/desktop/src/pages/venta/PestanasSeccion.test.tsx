// Tests de las pestañas de sección.
//
// Van sobre el componente y no sobre `VentaPage` a propósito: para que la fila
// de subsecciones exista hace falta un catálogo anidado, y el del mock de la
// página es plano —dos categorías sin hijas—. Montando el componente con sus
// propias props se puede comprobar esa parte, que es justo la que se rompe sin
// que se note.
//
// El agrupado del catálogo se prueba en `secciones.test.ts`. Aquí lo que importa
// son los controles: qué se ve, qué está pulsado y qué se emite al pinchar.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Categoria } from '@tienda/core';

import { PestanasSeccion } from './PestanasSeccion';
import type { SeccionRaiz, Seleccion } from './secciones';

const PAPEL: Categoria = { id: 1, nombre: 'Papelería', parent_id: null, orden: 0, activo: true, productos: 0 };
const PAPEL_HOJA: Categoria = { id: 2, nombre: 'Cuadernos', parent_id: 1, orden: 0, activo: true, productos: 0 };
const BOLIGRAFO: Categoria = { id: 3, nombre: 'Escritura', parent_id: 1, orden: 1, activo: true, productos: 0 };
const VIVERES: Categoria = { id: 4, nombre: 'Viveres', parent_id: null, orden: 1, activo: true, productos: 0 };

const HIJAS_PAPEL = [PAPEL_HOJA, BOLIGRAFO];

const SECCIONES: SeccionRaiz[] = [
  { id: PAPEL.id, nombre: 'Papelería', total: 12 },
  { id: VIVERES.id, nombre: 'Viveres', total: 4 },
];

interface Opciones {
  secciones?: SeccionRaiz[];
  sinCategoria?: string | null;
  hijas?: Categoria[];
}

function montar(
  seleccion: Seleccion,
  { secciones = SECCIONES, sinCategoria = 'Sin categoría · 3', hijas = [] }: Opciones = {},
) {
  const onCambiar = vi.fn();
  render(
    <PestanasSeccion
      secciones={secciones}
      sinCategoria={sinCategoria}
      hijas={hijas}
      seleccion={seleccion}
      onCambiar={onCambiar}
    />,
  );
  return { onCambiar, user: userEvent.setup() };
}

const fila = (nombre: string | RegExp) => screen.getByRole('button', { name: nombre });

describe('primera fila', () => {
  it('empieza en "Todas", y "Todas" es la única pulsada', () => {
    montar({ nivel: 'todas' });
    expect(fila('Todas')).toHaveAttribute('aria-pressed', 'true');
    expect(fila(/^Papelería/)).toHaveAttribute('aria-pressed', 'false');
  });

  it('cada sección muestra su total', () => {
    montar({ nivel: 'todas' });
    expect(fila(/^Papelería/)).toHaveTextContent('12');
    expect(fila(/^Viveres/)).toHaveTextContent('4');
  });

  it('el total es el de la sección entera, no el de sus subsecciones', () => {
    // Es el número que se le da al usuario para decidir si pincha o no; el de
    // `listarCategorias` sería 0 y parecería una sección vacía.
    montar({ nivel: 'todas' });
    expect(fila(/^Papelería/)).not.toHaveTextContent('0');
  });

  it('sin huérfanos no hay pestaña de huérfanos', () => {
    montar({ nivel: 'todas' }, { sinCategoria: null });
    expect(screen.queryByRole('button', { name: /Sin categor/ })).not.toBeInTheDocument();
  });

  it('con huérfanos, la pestaña lleva su contador', () => {
    montar({ nivel: 'todas' }, { sinCategoria: 'Sin categoría · 3' });
    expect(fila('Sin categoría · 3')).toBeInTheDocument();
  });
});

describe('segunda fila de subsecciones', () => {
  it('no aparece con "Todas"', () => {
    montar({ nivel: 'todas' }, { sinCategoria: null, hijas: HIJAS_PAPEL });
    expect(screen.queryByRole('group', { name: /Subsecciones de/ })).not.toBeInTheDocument();
  });

  it('no aparece si la sección elegida no tiene subsecciones', () => {
    // Viveres no tiene hijas. Mostrar una segunda fila con un único elemento, o
    // peor, con la propia raíz repetida, sería ruido.
    montar({ nivel: 'raiz', id: VIVERES.id }, { sinCategoria: null });
    expect(screen.queryByRole('group', { name: /Subsecciones de/ })).not.toBeInTheDocument();
  });

  it('aparece al elegir una raíz que sí tiene, con la raíz y sus hijas', () => {
    montar({ nivel: 'raiz', id: PAPEL.id }, { sinCategoria: null, hijas: HIJAS_PAPEL });
    const grupo = screen.getByRole('group', { name: 'Subsecciones de Papelería' });
    expect(grupo).toBeInTheDocument();
    expect(fila(/^Todo/)).toHaveAttribute('aria-pressed', 'true');
    expect(fila('Cuadernos')).toHaveAttribute('aria-pressed', 'false');
    // La raíz solo aparece una vez, en la fila de arriba.
    expect(screen.getAllByRole('button', { name: /^Papelería/ })).toHaveLength(1);
  });

  it('sigue ahí con una hija activa, que es donde se puede volver a subir', () => {
    // El fallo caro: si la fila solo se pinta con la raíz activa, al pinchar una
    // hija desaparece y el cajero se queda encerrado en ella, con la única salida
    // de tocar "Todas" y perder la sección.
    montar({ nivel: 'hija', id: PAPEL_HOJA.id, raiz: PAPEL.id }, { sinCategoria: null, hijas: HIJAS_PAPEL });
    expect(screen.getByRole('group', { name: 'Subsecciones de Papelería' })).toBeInTheDocument();
    expect(fila('Cuadernos')).toHaveAttribute('aria-pressed', 'true');
    expect(fila(/^Todo/)).toHaveAttribute('aria-pressed', 'false');
  });

  it('con una sola hija no hace falta una fila para una elección', () => {
    montar({ nivel: 'raiz', id: PAPEL.id }, { sinCategoria: null, hijas: [PAPEL_HOJA] });
    expect(screen.queryByRole('group', { name: /Subsecciones de/ })).not.toBeInTheDocument();
  });
});

describe('al pinchar', () => {
  it('una sección del primer nivel', async () => {
    const { onCambiar, user } = montar({ nivel: 'todas' });
    await user.click(fila(/^Viveres/));
    expect(onCambiar).toHaveBeenCalledWith({ nivel: 'raiz', id: VIVERES.id });
  });

  it('una subsección, sabiendo de qué raíz se viene', async () => {
    // El id de la raíz viaja en el evento porque el componente de la rejilla lo
    // necesita para saber si la sección elegida tiene hijas que dibujar.
    const { onCambiar, user } = montar({ nivel: 'raiz', id: PAPEL.id }, { sinCategoria: null, hijas: HIJAS_PAPEL });
    await user.click(fila('Escritura'));
    expect(onCambiar).toHaveBeenCalledWith({ nivel: 'hija', id: BOLIGRAFO.id, raiz: PAPEL.id });
  });

  it('volver a la raíz desde una hija', async () => {
    const { onCambiar, user } = montar({ nivel: 'hija', id: PAPEL_HOJA.id, raiz: PAPEL.id }, { sinCategoria: null, hijas: HIJAS_PAPEL });
    await user.click(fila(/^Todo/));
    expect(onCambiar).toHaveBeenCalledWith({ nivel: 'raiz', id: PAPEL.id });
  });

  it('volver a "Todas"', async () => {
    const { onCambiar, user } = montar({ nivel: 'raiz', id: VIVERES.id }, { sinCategoria: null });
    await user.click(fila('Todas'));
    expect(onCambiar).toHaveBeenCalledWith({ nivel: 'todas' });
  });

  it('los huérfanos', async () => {
    const { onCambiar, user } = montar({ nivel: 'todas' }, { sinCategoria: 'Sin categoría · 3' });
    await user.click(fila('Sin categoría · 3'));
    expect(onCambiar).toHaveBeenCalledWith({ nivel: 'sin-categoria' });
  });
});

describe('cuando no hay nada que filtrar', () => {
  it('no pinta ninguna fila', () => {
    // Sin secciones ni huérfanos el catálogo entero es lo único que hay, y un
    // grupo de un solo "Todas" no filtra nada: sería un adorno.
    montar({ nivel: 'todas' }, { secciones: [], sinCategoria: null });
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });
});