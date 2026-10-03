// El catálogo agrupado por secciones.
//
// ## Qué resuelve esto
//
// `listarProductos` devuelve `ORDER BY nombre ASC`, así que con el filtro en
// "Todo el catálogo" el cajero ve alfabético plano: "Abrazadera, Aceite, Agenda,
// Anillo, Arroz, Azúcar, Bolígrafo…", con papelería mezclada con víveres y con
// bisutería. Las secciones existen en la base pero no se ven en pantalla, y el
// filtro por desplegable obliga a abrirlas una por una para ver siquiera qué
// hay dentro.
//
// Aquí se convierte esa lista plana en bloques con título, y se decide qué
// aparece en cada pestaña.
//
// ## Por qué el frontend y no el SQL
//
// Hay tres razones, y ninguna es por pereza:
//
// 1. `listarCategorias` solo trae `productos` de la categoría *directa*. El
//    total de una sección con subsecciones —cuántos cuadernos hay en "Papelería"
//    entera— hay que sumarlo en el cliente de todos modos.
//
// 2. Con la búsqueda activa el catálogo se desagrupa. Eso es una decisión de
//    pantalla: buscar "cuaderno" entre tres mil artículos tiene que dar treinta
//    resultados, no tres cabeceras de un artículo cada una. Meter esa regla en
//    el SQL obligaría a dos consultas distintas según si hay texto en el campo.
//
// 3. El orden depende de `orden`, que es un número que el usuario edita a mano
//    en la pantalla de Categorías. Reordenar ahí no tiene que requerir un
//    despliegue.
//
// ## La jerarquía
//
// Las pestañas de primer nivel son las categorías raíz. Al elegir una raíz con
// hijas, sus hijas salen en una segunda fila de pestañas, y debajo van sus
// productos sin cabeceras —la pestaña ya dice dónde estás, ponerlo otra vez sería
// repetir. Con "Todas" activo, en cambio, sí hacen falta las cabeceras, porque
// es la única señal de dónde empieza cada sección.
//
// ## Qué pasa cuando falla `listarCategorias`
//
// La pantalla lo carga con su propio `catch` para que la venta siga funcionando
// (`VentaPage.tsx:64`). Si llega vacío, `seccionesRaiz` no devuelve nada, no hay
// pestañas y todos los productos caen en un bloque suelto: exactamente el
// catálogo plano de antes. Degradar, no romper.

import type { Categoria, Producto } from '@tienda/core';

/** El valor especial de "productos que no están en ninguna categoría". */
export const SIN_CATEGORIA = 'sin-categoria';

/** Qué está elegido en la pantalla. Cada forma sabe qué nivel representa. */
export type Seleccion =
  | { nivel: 'todas' }
  | { nivel: 'sin-categoria' }
  | { nivel: 'raiz'; id: number }
  | { nivel: 'hija'; id: number; raiz: number };

export const TODAS: Seleccion = { nivel: 'todas' };
export const SIN_CATEGORIA_SEL: Seleccion = { nivel: 'sin-categoria' };

/** Una pestaña de primer nivel. */
export interface SeccionRaiz {
  id: number;
  nombre: string;
  /** Productos de la raíz más los de todas sus descendientes. */
  total: number;
}

/** Un bloque de la rejilla: un título y los productos que le corresponden. */
export interface Bloque {
  /** `null` en el bloque "Sin categoría". */
  categoriaId: number | null;
  titulo: string;
  productos: Producto[];
}

/**
 * Índice de ascendencia: id de categoría → id de su raíz.
 *
 * Se recorre `parent_id` hacia arriba porque el anidamiento no tiene límite
 * teorizado: `CategoriasPage` ofrece un nivel, pero la tabla permite más y
 * escribir a mano en la base podría dejar dos. Un ciclo —A es padre de B y B de
 * A— no se cuelga: se corta al repetir un id ya visitado.
 */
function raizDe(categorias: Categoria[]): Map<number, number> {
  const porId = new Map(categorias.map((c) => [c.id, c]));
  const raices = new Map<number, number>();

  for (const categoria of categorias) {
    const vistos = new Set<number>([categoria.id]);
    let actual = categoria;
    while (actual.parent_id != null && porId.has(actual.parent_id) && !vistos.has(actual.parent_id)) {
      vistos.add(actual.parent_id);
      const padre = porId.get(actual.parent_id)!;
      actual = padre;
    }
    raices.set(categoria.id, actual.id);
  }

  return raices;
}

/** Las pestañas de primer nivel, en el orden que dio `listarCategorias`. */
export function seccionesRaiz(categorias: Categoria[], productos: Producto[]): SeccionRaiz[] {
  const raices = raizDe(categorias);
  const conteo = new Map<number, number>();

  for (const producto of productos) {
    if (producto.categoria_id == null) continue;
    const raiz = raices.get(producto.categoria_id);
    // Una categoría a la que el producto apunta pero que no vino en la lista
    // —inactiva, o la lista entera falló— se cuenta como sin categoría. Es donde
    // el usuario tiene que moverla para verla clasificada.
    if (raiz == null) continue;
    conteo.set(raiz, (conteo.get(raiz) ?? 0) + 1);
  }

  return categorias
    .filter((c) => c.parent_id == null)
    .map((c) => ({ id: c.id, nombre: c.nombre, total: conteo.get(c.id) ?? 0 }));
}

/** Las hijas directas de una raíz, en el orden que dio `listarCategorias`. */
export function hijasDe(categorias: Categoria[], raizId: number): Categoria[] {
  return categorias.filter((c) => c.parent_id === raizId);
}

/** Las hojas que cuelgan de una raíz, para saber si hace falta la segunda fila. */
export function hojasDe(categorias: Categoria[], raizId: number): Categoria[] {
  const raices = raizDe(categorias);
  return categorias.filter((c) => raices.get(c.id) === raizId && c.id !== raizId);
}

function sinClasificar(productos: Producto[]): Producto[] {
  return productos
    .filter((p) => p.categoria_id == null)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

function porNombre(productos: Producto[]): Producto[] {
  return [...productos].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/**
 * Los bloques que se pintan, en orden.
 *
 * Con "Todas" son las raíces —incluidas las que no tienen ni un producto, para
 * que el cajero vea que la sección existe y está vacía en vez de pensar que se
 * perdió— y al final el bloque "Sin categoría". Con una raíz elegida son sus
 * hijas, más la raíz misma si tiene productos que no son de ninguna hija. Con una
 * hija elegida es un único bloque, sin cabeceras.
 */
export function bloques(categorias: Categoria[], productos: Producto[], seleccion: Seleccion): Bloque[] {
  if (seleccion.nivel === 'sin-categoria') {
    const sueltos = sinClasificar(productos);
    return sueltos.length === 0 ? [] : [{ categoriaId: null, titulo: 'Sin categoría', productos: sueltos }];
  }

  if (seleccion.nivel === 'hija') {
    const suyos = productos
      .filter((p) => p.categoria_id === seleccion.id)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const nombre = categorias.find((c) => c.id === seleccion.id)?.nombre ?? 'Sección';
    return [{ categoriaId: seleccion.id, titulo: nombre, productos: suyos }];
  }

  if (seleccion.nivel === 'raiz') {
    // Solo los productos apuntados *directamente* a la raíz. Los de sus hijas ya
    // tienen su bloque, y meterlos también aquí los duplicaría.
    const enRaiz = (p: Producto) => p.categoria_id === seleccion.id;
    const raicesElegidas = categorias.filter((c) => c.id === seleccion.id);
    const nombre = raicesElegidas[0]?.nombre ?? 'Sección';
    const hijas = hijasDe(categorias, seleccion.id);

    const salida: Bloque[] = hijas
      .map((hija) => ({
        categoriaId: hija.id,
        titulo: hija.nombre,
        productos: porNombre(productos.filter((p) => p.categoria_id === hija.id)),
      }))
      // La raíz puede tener productos propios —es lo normal si el usuario nunca
      // hizo subsecciones— y esos no son de ninguna hija, así que necesitan un
      // bloque propio en vez de desaparecer.
      .concat(
        productos.filter(enRaiz).length === 0
          ? []
          : [
              {
                categoriaId: seleccion.id,
                titulo: nombre,
                productos: porNombre(productos.filter(enRaiz)),
              },
            ],
      );

    return salida;
  }

  const raices = raizDe(categorias);
  const porRaiz = new Map<number, Producto[]>();
  const sueltos: Producto[] = [];
  for (const producto of productos) {
    if (producto.categoria_id == null) {
      sueltos.push(producto);
      continue;
    }
    const raiz = raices.get(producto.categoria_id);
    if (raiz == null) {
      sueltos.push(producto);
      continue;
    }
    const lista = porRaiz.get(raiz);
    if (lista) lista.push(producto);
    else porRaiz.set(raiz, [producto]);
  }

  const salida: Bloque[] = categorias
    .filter((c) => c.parent_id == null)
    .map((raiz) => ({
      categoriaId: raiz.id,
      titulo: raiz.nombre,
      productos: porNombre(porRaiz.get(raiz.id) ?? []),
    }));

  // Al final, nunca al principio: los productos sin clasificar existen mientras
  // el usuario esté metiendo el catálogo, y arriba estorban.
  if (sueltos.length > 0) {
    salida.push({ categoriaId: null, titulo: 'Sin categoría', productos: sueltos.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')) });
  }

  return salida;
}

/**
 * Si toca pintar cabeceras o no.
 *
 * Con una sola sección activa el título sobra: la pestaña ya lo dice, y repetirlo
 * encima de la rejilla es ruido. Con "Todas" hay varios bloques y sí hace falta.
 */
export function conCabeceras(categorias: Categoria[], productos: Producto[], seleccion: Seleccion): boolean {
  return seleccion.nivel === 'todas' && bloques(categorias, productos, seleccion).length > 1;
}

/**
 * Si el catálogo debe verse desagrupado.
 *
 * En cuanto el cajero escribe algo, agrupar estorba: el resultado de una búsqueda
 * es una lista de lo que coincide, no un mapa de secciones. Además se aplana
 * aunque haya un solo bloque, porque un catálogo de una sola sección con
 * cabeceras es ruido puro.
 */
export function desagrupar(busqueda: string): boolean {
  return busqueda.trim() !== '';
}

/**
 * Texto de la pestaña de huérfanos, con su contador, o `null` si no hace falta.
 *
 * Con la lista de categorías vacía devuelve `null` aunque haya productos sin
 * `categoria_id`: sin las categorías no se puede distinguir "no está en ninguna"
 * de "está en una que no se pudo cargar", y una pestaña que junta todo el
 * catálogo bajo "Sin categoría" affirmaría algo que no se sabe. Es el mismo
 * motivo por el que la pantalla no se cae cuando `listarCategorias` falla: el
 * filtro es una comodidad, y una comodidad que miente es peor que no tenerla.
 */
export function etiquetaSinCategoria(categorias: Categoria[], productos: Producto[]): string | null {
  if (categorias.length === 0) return null;
  const raices = raizDe(categorias);
  const huerfanos = productos.filter(
    (p) => p.categoria_id == null || !raices.has(p.categoria_id),
  ).length;
  return huerfanos === 0 ? null : `Sin categoría · ${huerfanos}`;
}