// Contraste de los tokens, contra lo que dice WCAG.
//
// ## Por qué un test y no mirar la pantalla
//
// Los valores de `index.css` se eligieron a ojo y a ojo se eligen mal: el morado
// de acento que parecía bonito daba 3.4:1 sobre su propio fondo de menú activo,
// y en una pantalla de tienda eso no se nota en el despacho pero sí a la tercera
// hora de caja. Este test lee el CSS de verdad, saca los números y comprueba cada
// par que la aplicación pinta, así que un token nuevo o retocado no entra sin que
// alguien mire su contraste.
//
// ## Los umbrales
//
// 4.5:1 para texto normal (WCAG AA). Los badges son de 12 px y peso medio, así que
// cuentan como normal, no como texto grande. 3:1 para lo que no es texto pero
// delimita o señala: el anillo de foco.
//
// ## Por qué el borde no está
//
// `--border` e `--input` se quedan fuera a propósito, y `index.css` explica por
// qué: un borde de formulario claro no llega a 3:1 sin arruinar el aire minimal.
// La accesibilidad la carga `--ring`, que sí está comprobado aquí. Si algún día se
// quiere cumplir 1.4.11 también en el borde, hay que subirlos y la alistar abajo.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const CSS = resolve(process.cwd(), 'src/index.css');

type Tokens = Record<string, [number, number, number]>;

/** Saca los triples HSL de un bloque `{ ... }` del CSS. */
function leerTokens(bloque: string): Tokens {
  const cuerpo = bloque.slice(bloque.indexOf('{') + 1, bloque.lastIndexOf('}'));
  const tokens: Tokens = {};
  for (const linea of cuerpo.split(';')) {
    const coincidencia = /--([a-z-]+):\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/.exec(
      linea,
    );
    if (coincidencia) {
      tokens[coincidencia[1]] = [
        Number(coincidencia[2]),
        Number(coincidencia[3]),
        Number(coincidencia[4]),
      ];
    }
  }
  return tokens;
}

/** Convierte HSL (0-360, 0-100, 0-100) a RGB 0-255. */
function hslARgb([h, s, l]: [number, number, number]): [number, number, number] {
  const sat = s / 100;
  const lum = l / 100;
  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const hPrime = h / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));
  const [r1, g1, b1] =
    hPrime < 1
      ? [c, x, 0]
      : hPrime < 2
        ? [x, c, 0]
        : hPrime < 3
          ? [0, c, x]
          : hPrime < 4
            ? [0, x, c]
            : hPrime < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = lum - c / 2;
  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255];
}

/** Luminancia relativa según la fórmula de WCAG. */
function luminancia([h, s, l]: [number, number, number]): number {
  const [r, g, b] = hslARgb([h, s, l]).map((canal) => {
    const c = canal / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razón de contraste entre dos colores, de 1 a 21. */
function contraste(a: [number, number, number], b: [number, number, number]): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  const [claro, oscuro] = la > lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (oscuro + 0.05);
}

const css = readFileSync(CSS, 'utf8');
const claro = leerTokens(css.slice(css.indexOf(':root'), css.indexOf('.dark')));
const oscuro = leerTokens(css.slice(css.indexOf('.dark')));

// Los pares que la aplicación pinta de verdad: [color de texto, superficie].
const TEXTO_SOBRE_SUPERFICIE: Array<[string, string]> = [
  ['foreground', 'background'],
  ['foreground', 'card'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['primary-foreground', 'primary'],
  ['accent-foreground', 'accent'],
  ['secondary-foreground', 'secondary'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'card'],
  ['muted-foreground', 'muted'],
  ['destructive-foreground', 'destructive'],
  ['success-foreground', 'success'],
  ['warning-foreground', 'warning'],
  // Colores usados como texto suelto: enlace del menú activo, texto de estado.
  ['primary', 'background'],
  ['accent', 'background'],
  ['accent', 'card'],
  ['destructive', 'background'],
  ['success', 'background'],
  ['warning', 'background'],
];

const MODOS: Array<[string, Tokens]> = [
  ['claro', claro],
  ['oscuro', oscuro],
];

describe('los tokens de color', () => {
  it.each(MODOS)('están todos definidos en modo %s', (_, tokens) => {
    for (const nombre of [
      'background', 'foreground', 'card', 'popover', 'primary', 'accent',
      'secondary', 'muted', 'border', 'input', 'ring', 'destructive',
      'success', 'warning', 'shadow',
    ]) {
      expect(tokens[nombre], `falta --${nombre}`).toBeDefined();
    }
  });
});

describe.each(MODOS)('contraste en modo %s', (_, tokens) => {
  it.each(TEXTO_SOBRE_SUPERFICIE)('%s sobre %s llega a 4.5:1', (tinta, superficie) => {
    const valor = contraste(tokens[tinta], tokens[superficie]);
    expect(
      valor,
      `--${tinta} sobre --${superficie} da ${valor.toFixed(2)}:1, y hacen falta 4.5:1`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('el anillo de foco llega a 3:1 contra el fondo', () => {
    // No es texto, pero es lo único que dice dónde estás escribiendo, así que
    // cuenta como contenido no textual (WCAG 1.4.11).
    const valor = contraste(tokens.ring, tokens.background);
    expect(valor, `--ring sobre --background da ${valor.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
  });

  it('el estado de error se distingue del texto normal', () => {
    // Si `destructive` y `foreground` se parecieran, un mensaje de validación
    // pasaría por texto corriente.
    expect(contraste(tokens.destructive, tokens.background)).toBeGreaterThan(2);
    expect(Math.abs(contraste(tokens.destructive, tokens.background) -
      contraste(tokens.foreground, tokens.background))).toBeGreaterThan(0.5);
  });
});

describe('los dos modos no se parecen', () => {
  it('el oscuro es realmente oscuro y el claro realmente claro', () => {
    expect(luminancia(oscuro.background)).toBeLessThan(0.05);
    expect(luminancia(claro.background)).toBeGreaterThan(0.9);
  });

  it('el primario se aclara al pasar a oscuro', () => {
    // Un azul saturado sobre fondo casi negro vibra. Los tokens claros de oscuro
    // suben de luminosidad justamente para eso.
    expect(luminancia(oscuro.primary)).toBeGreaterThan(luminancia(claro.primary));
  });
});