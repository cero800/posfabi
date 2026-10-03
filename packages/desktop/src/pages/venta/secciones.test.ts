// Tests de la agrupación del catálogo.
//
// Van como un módulo puro, sin React, porque la lógica que decide qué se ve es
// la parte que hay que tener segura: si esto agrupa mal, la caja muestra el
// catálogo equivocado y no hay ninguna otra prueba que lo detecte.

import { describe, expect, it } from 'vitest';

import type { Categoria, Producto } from '@tienda/core';

import {
  bloques,
  conCabeceras,
  desagrupar,
  etiquetaSinCategoria,
  seccionesRaiz,
  SIN_CATEGORIA_SEL,
  TODAS,
} from './secciones';

let siguienteId = 1;

function producto(nombre: string, categoria_id: number | null): Producto {
  return {
    id: siguienteId++,
    codigo: `P${nombre.slice(0, 2).toUpperCase()}`,
    codigo_barras: null,
    nombre,
    descripcion: null,
    categoria_id,
    unidad_medida: 'unidad',
    precio_base: 500,
    impuesto_porcentaje: 0,
    stock_minimo: 0,
    activo: true,
    creado_en: null,
  };
}

function categoria(nombre: string, parent_id: number | null = null, orden = 0): Categoria {
  return { id: siguienteId++, nombre, parent_id, orden, activo: true, productos: 0 };
}

// Escenario de tienda de papelería real: dos secciones con subsecciones, una sin
// subsecciones, y un producto sin clasificar.
const PAPELERIA = categoria('Papelería', null, 0);
const PAPEL = categoria('Papel', PAPELERIA.id, 0);
const ESCRITURA = categoria('Escritura', PAPELERIA.id, 1);
const VIVERES = categoria('Viveres', null, 1);
const ABANICOS = categoria('Abanicos', null, 2);

const categorias = [PAPELERIA, PAPEL, ESCRITURA, VIVERES, ABANICOS];

const catalogo = [
  producto('Cuaderno Carta', PAPEL.id),
  producto('Cuaderno Universitario', PAPEL.id),
  producto('Bolígrafo Azul', ESCRITURA.id),
  producto('Arroz', VIVERES.id),
  producto('Aceite', VIVERES.id),
  producto('Collar', ABANICOS.id),
  producto('Regla', null),
];

describe('seccionesRaiz', () => {
  it('devuelve solo las categorías raíz, en el orden que ya traía la lista', () => {
    expect(seccionesRaiz(categorias, catalogo).map((s) => s.nombre)).toEqual([
      'Papelería',
      'Viveres',
      'Abanicos',
    ]);
  });

  it('suma los productos de las subsecciones en el total de la raíz', () => {
    // Aquí está la razón de hacerlo en el cliente: `listarCategorias` solo trae
    // el conteo de la categoría directa, así que "Papelería" diría 0 productos si
    // se creyera que está vacía, cuando tiene tres.
    const papeleria = seccionesRaiz(categorias, catalogo).find((s) => s.id === PAPELERIA.id);
    expect(papeleria?.total).toBe(3);
  });

  it('cuenta cero para una sección sin productos', () => {
    expect(seccionesRaiz(categorias, []).every((s) => s.total === 0)).toBe(true);
  });

  it('no cuenta los productos sin categoría en ninguna sección', () => {
    const total = seccionesRaiz(categorias, catalogo).reduce((acc, s) => acc + s.total, 0);
    expect(total).toBe(catalogo.length - 1);
  });
});

describe('bloques con "Todas" activo', () => {
  const salida = bloques(categorias, catalogo, TODAS);

  it('un bloque por sección, en el orden de las pestañas', () => {
    expect(salida.map((b) => b.titulo)).toEqual(['Papelería', 'Viveres', 'Abanicos', 'Sin categoría']);
  });

  it('los productos de una subsección van a su raíz, no a un bloque propio', () => {
    const papeleria = salida[0];
    expect(papeleria.categoriaId).toBe(PAPELERIA.id);
    expect(papeleria.productos.map((p) => p.nombre)).toEqual([
      'Bolígrafo Azul',
      'Cuaderno Carta',
      'Cuaderno Universitario',
    ]);
  });

  it('"Sin categoría" va siempre al final', () => {
    // Mientras el usuario esté metiendo el catálogo va a haber huérfanos, y arriba
    // estorban: lo que se busca está en las secciones de verdad.
    expect(salida[salida.length - 1].titulo).toBe('Sin categoría');
    expect(salida[salida.length - 1].categoriaId).toBeNull();
  });

  it('no añade el bloque "Sin categoría" si no hay huérfanos', () => {
    const sinHuérfanos = catalogo.filter((p) => p.categoria_id != null);
    expect(bloques(categorias, sinHuérfanos, TODAS).map((b) => b.titulo)).not.toContain('Sin categoría');
  });

  it('muestra también la sección vacía, para que se vea que existe', () => {
    // Si se filtraran las que no tienen productos, el cajero pensaría que se
    // perdieron al crear la sección.
    const conVacia = bloques(categorias, [producto('Arroz', VIVERES.id)], TODAS);
    const vacia = conVacia.find((b) => b.categoriaId === PAPELERIA.id);
    expect(vacia).toBeDefined();
    expect(vacia?.productos).toEqual([]);
  });

  it('ordena los productos por nombre con acentos en su sitio', () => {
    const papeleria = salida[0];
    const nombres = papeleria.productos.map((p) => p.nombre);
    expect(nombres).toEqual([...nombres].sort((a, b) => a.localeCompare(b, 'es')));
  });
});

describe('bloques con una sección raíz elegida', () => {
  const salida = bloques(categorias, catalogo, { nivel: 'raiz', id: PAPELERIA.id });

  it('un bloque por subsección, y ninguno propio si la raíz no tiene', () => {
    // En este catálogo nadie metió productos directamente en "Papelería", así que
    // no debe aparecer un bloque vacío con ese nombre.
    expect(salida.map((b) => b.titulo)).toEqual(['Papel', 'Escritura']);
  });

  it('los productos propios de la raíz no se pierden', () => {
    const propios = producto('Carpeta', PAPELERIA.id);
    const conPropios = bloques(categorias, [...catalogo, propios], { nivel: 'raiz', id: PAPELERIA.id });
    const bloqueRaiz = conPropios.find((b) => b.categoriaId === PAPELERIA.id);
    expect(bloqueRaiz?.productos.map((p) => p.nombre)).toEqual(['Carpeta']);
  });

  it('si la raíz no tiene subsecciones, sale un solo bloque con su nombre', () => {
    // Es lo normal si el usuario nunca creó subsecciones: la pestaña debe servir
    // tal cual, sin obligarle a bajar un nivel que no existe.
    const salida = bloques(categorias, catalogo, { nivel: 'raiz', id: VIVERES.id });
    expect(salida).toHaveLength(1);
    expect(salida[0].titulo).toBe('Viveres');
    expect(salida[0].productos.map((p) => p.nombre)).toEqual(['Aceite', 'Arroz']);
  });

  it('no se cuela lo de otras secciones', () => {
    expect(salida.flatMap((b) => b.productos.map((p) => p.nombre))).not.toContain('Collar');
  });
});

describe('bloques con una subsección elegida', () => {
  it('un único bloque, con el nombre de la subsección', () => {
    const salida = bloques(categorias, catalogo, { nivel: 'hija', id: PAPEL.id, raiz: PAPELERIA.id });
    expect(salida).toHaveLength(1);
    expect(salida[0].titulo).toBe('Papel');
    expect(salida[0].productos.map((p) => p.nombre)).toEqual([
      'Cuaderno Carta',
      'Cuaderno Universitario',
    ]);
  });
});

describe('bloques con "Sin categoría" activo', () => {
  it('solo los huérfanos', () => {
    const salida = bloques(categorias, catalogo, SIN_CATEGORIA_SEL);
    expect(salida).toHaveLength(1);
    expect(salida[0].productos.map((p) => p.nombre)).toEqual(['Regla']);
  });

  it('nada que pintar si no hay huérfanos', () => {
    const sinHuérfanos = catalogo.filter((p) => p.categoria_id != null);
    expect(bloques(categorias, sinHuérfanos, SIN_CATEGORIA_SEL)).toEqual([]);
  });
});

describe('cuando las categorías no llegan', () => {
  // Es el caso real: `VentaPage` las carga con su propio `catch` para que la
  // venta siga funcionando. El catálogo tiene que salir entero y plano.
  it('no revienta y deja todos los productos juntos', () => {
    const salida = bloques([], catalogo, TODAS);
    expect(salida).toHaveLength(1);
    expect(salida[0].productos).toHaveLength(catalogo.length);
  });

  it('no inventa pestañas', () => {
    expect(seccionesRaiz([], catalogo)).toEqual([]);
  });

  it('trata como sin categoría lo que apunta a una categoría que no vino', () => {
    // Una categoría inactiva no aparece en `listarCategorias` porque el SQL filtra
    // por `activo = 1`. Su producto no debe desaparecer de ninguna parte.
    const salida = bloques(categorias, catalogo, SIN_CATEGORIA_SEL);
    expect(salida[0].productos.map((p) => p.nombre)).toEqual(['Regla']);
  });
});

describe('niveles raros que la base puede dejar', () => {
  it('un ciclo de parent_id no cuelga el agrupado', () => {
    // A es padre de B y B es padre de A. Nadie lo hace por la interfaz, pero una
    // escritura directa en la base sí podría, y esto corre en la caja.
    const a = { ...categoria('A'), id: 900 };
    const b = { ...categoria('B', 900), id: 901 };
    const salida = bloques([a, b], [producto('Algo', 901)], TODAS);
    expect(salida.flatMap((x) => x.productos)).toHaveLength(1);
  });

  it('una categoría de tercer nivel sube hasta su raíz', () => {
    const raiz = categoria('Ropa', null, 0);
    const medio = categoria('Caballero', raiz.id, 0);
    const hoja = categoria('Pantalones', medio.id, 0);
    const salida = bloques([raiz, medio, hoja], [producto('Pantalón jeans', hoja.id)], TODAS);
    expect(salida.map((b) => b.titulo)).toEqual(['Ropa']);
    expect(salida[0].productos).toHaveLength(1);
  });
});

describe('cuándo poner cabeceras', () => {
  it('sí, con "Todas" y más de un bloque', () => {
    expect(conCabeceras(categorias, catalogo, TODAS)).toBe(true);
  });

  it('no, con una sola sección activa', () => {
    // La pestaña ya dice dónde estás; repetirlo sobre la rejilla es ruido.
    expect(conCabeceras(categorias, catalogo, { nivel: 'raiz', id: VIVERES.id })).toBe(false);
  });

  it('no, con "Todas" pero un único bloque', () => {
    const uno = [producto('Arroz', VIVERES.id)];
    expect(bloques(categorias, uno, TODAS).length).toBeGreaterThan(1);
    expect(conCabeceras([], uno, TODAS)).toBe(false);
  });
});

describe('cuándo desagrupar', () => {
  it('solo si el cajero escribió algo', () => {
    expect(desagrupar('')).toBe(false);
    expect(desagrupar('   ')).toBe(false);
    expect(desagrupar('cuaderno')).toBe(true);
  });
});

describe('la pestaña de huérfanos', () => {
  it('aparece con su contador si hay productos sin clasificar', () => {
    expect(etiquetaSinCategoria(categorias, catalogo)).toBe('Sin categoría · 1');
  });

  it('no aparece si no hay huérfanos', () => {
    expect(etiquetaSinCategoria(categorias, catalogo.filter((p) => p.categoria_id != null))).toBeNull();
  });

  it('no aparece si no llegaron las categorías, aunque haya productos sueltos', () => {
    // Sin la lista no se sabe si un producto está sin clasificar o en una
    // categoría que no se pudo cargar. Ofrecer el filtro sería mentir.
    expect(etiquetaSinCategoria([], catalogo)).toBeNull();
  });
});