// El color de Tailwind, el blanco y los tokens: cada uno donde le toca.
//
// ## Por qué un test de textos y no de componentes
//
// El rediseño no se asegura mirando JSX: si a alguien se le ocurre escribir
// `text-gray-500` en una pantalla nueva, ni `typecheck` ni un test de render se
// quejan — el compilador está perfectamente contento con esa clase, y el
// componente se ve bien en modo claro. El problema aparece solo en modo oscuro,
// con la pantalla llena y en la tienda.
//
// Hay dos reglas, y son de sentido contrario. Las dos hacen falta.
//
// **Fuera de la zona imprimible, ningún color de Tailwind y ningún blanco.** Todo
// sale de los tokens de `index.css`. Se comprueba sobre el fuente, que es donde
// se toma la decisión de escribir `gray-*`.
//
// **Dentro de la zona imprimible, sí el papel y ningún token.**
// `CierreModal` y `FacturaModal` contienen un bloque `.factura-print` que es lo
// único que sale a la impresora, y tiene que llevar `bg-white` y `gray-900`
// fijos, en claro y en oscuro: una impresora térmica no tiene modo oscuro, y un
// cierre que en pantalla saliera invertido sería ilegible en papel.
//
// Por qué hacen falta las dos: la primera regla no cubre la segunda. Un
// `bg-popover` dentro de la zona no es ningún color prohibido —`popover` no está
// en las escalas de Tailwind—, así que se escapa y la factura sale impresa con el
// fondo del modo oscuro. Y la segunda no cubre la primera: exigir `bg-white`
// dentro no impide que alguien escriba `bg-white` fuera. Una regla solo prohíbe,
// la otra solo exige, y los dos huecos están en direcciones distintas.
//
// ## La excepción se recorta por sangría, no por número de línea
//
// Un número de línea se mueve con el primer `prettier` y dejaría de cortar donde
// tiene que cortar. Todo lo que está por debajo de la línea con
// `className="factura-print"` es zona de papel hasta que el sangrado vuelve a ser
// el mismo.
//
// ## Por qué no es una lista blanca de ficheros
//
// Crece y no se puede recordar. Esto prefiere que la excepción sea el árbol de lo
// imprimible, que es una regla que se explica en una frase y que dentro de cinco
// años sigue teniendo sentido.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const RAIZ = resolve(process.cwd(), 'src');
const MARCA = 'className="factura-print';

/** Escalas de color de Tailwind. Ninguna debe aparecer: los tokens las sustituyen. */
const ESCALAS =
  /\b(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|emerald|teal|cyan|sky|blue|indigo|purple|fuchsia|violet|pink|rose)-\d{2,3}\b/g;

/**
 * El blanco puro. Dentro de la zona es el papel; fuera es una superficie que no
 * sabe que existe el modo oscuro. `text-white` tampoco: `destructive-foreground`
 * en oscuro es casi negro sobre rojo, y el blanco ahí deja de distinguirse.
 */
const BLANCO = /\b(?:bg-white|text-white|text-black)\b/g;

/**
 * Un color que sale de `hsl(var(--…))` de `index.css`: el único que conoce el
 * modo oscuro, y por eso el único prohibido sobre papel.
 */
const SUPERFICIES_TOKEN =
  /\b(?:bg|text|border|divide|ring)-(?:background|foreground|card|popover|muted|primary|accent|secondary|destructive|success|warning|border|input|ring|shadow)(?:-foreground)?(?:\/\d{2,3})?\b/g;

function listarFicheros(directorio: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(directorio)) {
    const ruta = join(directorio, nombre);
    if (statSync(ruta).isDirectory()) {
      listarFicheros(ruta, salida);
    } else if (/\.(tsx|ts)$/.test(nombre) && !/\.test\.(tsx|ts)$/.test(nombre)) {
      salida.push(ruta);
    }
  }
  return salida;
}

/**
 * Reparte el código en `fuera` y `zonas`: la parte que va a pantalla y la que va
 * al papel. La zona incluye la propia línea que la abre, porque ahí están
 * `bg-white` y `gray-900`, que son papel.
 */
function repartir(contenido: string): { fuera: string; zonas: string[] } {
  const lineas = contenido.split('\n');
  const fuera: string[] = [];
  const zonas: string[] = [];
  let sangrado: number | null = null;
  let zona: string[] | null = null;

  for (const linea of lineas) {
    if (sangrado !== null && zona !== null) {
      const vacia = linea.trim() === '';
      const masProfunda = linea.length - linea.trimStart().length > sangrado;
      if (vacia || masProfunda) {
        zona.push(linea);
        continue;
      }
      zonas.push(zona.join('\n'));
      zona = null;
      sangrado = null;
    }

    if (linea.includes(MARCA)) {
      sangrado = linea.length - linea.trimStart().length;
      zona = [linea];
      continue;
    }
    fuera.push(linea);
  }

  if (zona !== null) zonas.push(zona.join('\n'));
  return { fuera: fuera.join('\n'), zonas };
}

/** Los comentarios citan las clases sin usarlas. */
function sinComentarios(contenido: string): string {
  return contenido
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/^[ \t]*\/\*[\s\S]*?\*\/$/gm, '');
}

function prohibidos(contenido: string): string[] {
  return [...new Set([...contenido.matchAll(ESCALAS), ...contenido.matchAll(BLANCO)].map((m) => m[0]))].sort();
}

function tokens(contenido: string): string[] {
  return [...new Set([...contenido.matchAll(SUPERFICIES_TOKEN)].map((m) => m[0]))].sort();
}

/**
 * Dos opacidades en la misma clase.
 *
 * `bg-success/10/60` no es una clase de Tailwind: se forma al trocear una clase
 * con opacidad a medias —`bg-emerald-50/60` convertido carácter a carácter— y el
 * compilador no se queja, no la genera, y la fila se queda sin fondo. La mitad de
 * los errores que deja una migración por cadenas son de esta forma: no rompen
 * nada, solo desaparecen en silencio.
 */
const DOBLE_OPACIDAD = /\b(?:[a-z]+-)+[a-z]+\/\d{1,3}\/\d{1,3}\b/g;

function malformadas(contenido: string): string[] {
  return [...new Set([...contenido.matchAll(DOBLE_OPACIDAD)].map((m) => m[0]))].sort();
}

/**
 * Un ancho de anillo sin color de anillo en el mismo fichero.
 *
 * `ring-2` solo fija el ancho; el color lo da otra clase. Si no la hay, el que
 * pinta es el respaldo de Tailwind, `rgb(59 130 246)`: un azul fijo que no es un
 * token y que no cambia con el tema. No se puede arreglar en la config — se
 * intentó: `withAlphaValue` de Tailwind rechaza `hsl(var(--ring))` y devuelve su
 * propio azul, así que `ringColor` en `tailwind.config.js` empeora el resultado en
 * vez de mejorarlo.
 *
 * La placa que sí funciona es esta, y va **por fichero y no por cadena** porque en
 * la práctica el ancho y el color casi nunca van juntos: `focus:ring-2` vive en la
 * clase base del componente y `focus:ring-primary/40` en su rama concreta, o
 * `ring-1` va en el elemento y el color en el mapa de variantes de al lado.
 */
const ANCHO_ANILLO = /\bring-(?:0|1|2|4|8)\b/;
const COLOR_ANILLO = /\bring-(?!inset\b|offset\b|[01248]\b)[a-z]+(?:\/\d{1,3})?\b/;

const ficheros = listarFicheros(RAIZ);
const repartidos = ficheros.map((f) => ({
  fichero: relative(process.cwd(), f),
  ...repartir(readFileSync(f, 'utf8')),
}));

describe('encontró fuente para mirar', () => {
  it('barre el árbol entero de src', () => {
    expect(repartidos.length).toBeGreaterThan(30);
  });

  it('y encuentra la zona de papel que se le presupone', () => {
    // Si la extracción por sangrado dejara de encontrar nada, todos los tests de
    // la sección de papel pasarían en vacío. Exigir al menos una zona los ata a
    // realidad: la regla de arriba seguiría vigente y la de abajo no.
    expect(repartidos.filter((f) => f.zonas.length > 0).length).toBeGreaterThan(0);
  });
});

describe('fuera de lo imprimible: ni escalas de Tailwind ni blanco', () => {
  it.each(repartidos.map((f) => [f.fichero, f.fuera]))('%s', (_nombre, fuera) => {
    const limpio = sinComentarios(fuera);
    expect(prohibidos(limpio)).toEqual([]);
    expect(malformadas(limpio)).toEqual([]);
  });
});

describe('dentro de lo imprimible: sí el papel y ningún token', () => {
  const conZona = repartidos.filter((f) => f.zonas.length > 0);

  it.each(conZona.map((f) => [f.fichero, f.zonas]))('%s', (_nombre, zonas) => {
    const contenido = sinComentarios(zonas.join('\n'));
    // Un token es un color que sabe que existe el modo oscuro. Sobre papel no
    // tiene nada que hacer.
    expect(tokens(contenido)).toEqual([]);
    expect(malformadas(contenido)).toEqual([]);
    expect(contenido).toContain('bg-white');
  });
});


describe('ningún ancho de anillo va sin color de anillo', () => {
  const conAncho = repartidos.map((f) => ({ fichero: f.fichero, limpio: sinComentarios(f.fuera) })).filter((f) => ANCHO_ANILLO.test(f.limpio));

  it('hay anillos en el código que mirar', () => {
    // Sin esta, el resto pasaría en vacío si un día desapareciera el ancho de
    // todas las pantallas.
    expect(conAncho.length).toBeGreaterThan(0);
  });

  it('y todos llevan su color', () => {
    expect(conAncho.filter((f) => !COLOR_ANILLO.test(f.limpio)).map((f) => f.fichero)).toEqual([]);
  });
});
