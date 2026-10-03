// Los tokens de color viven en dos sitios y tienen que estar de acuerdo.
//
// `tailwind.config.js` dice que `bg-primary` es `hsl(var(--primary))`, y
// `index.css` es el que define `--primary`. Si uno de los dos se equivoca —un
// token con una errata, o uno añadido a la config y olvidado en el CSS— la
// clase se compila, el typecheck pasa, los tests pasan, y en pantalla sale
// transparente. Solo se ve mirando, y mirando no lo vas a notar.
//
// Estos tests no comprueban que los colores sean bonitos —de eso se ocupa
// `contraste.test.ts`— sino que la cadena esté cerrada.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import configCrudo from '../../tailwind.config.js';

const CSS = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

type Hoja = string | { DEFAULT: string };
type Colores = Record<string, Hoja>;

/**
 * El tipo de `Config` de Tailwind deja cada sección como "resoluble", que
 * significa "puede venir de una función". Aquí no: el archivo es un objeto
 * literal. Se estrecha una vez y se trabaja con algo concreto.
 */
const config = configCrudo as unknown as {
  darkMode: string;
  theme: {
    extend: {
      colors: Colores;
      borderRadius: Record<string, string>;
      boxShadow: Record<string, string>;
    };
  };
};

/**
 * Aplana la config de colores a las clases que Tailwind genera.
 *
 * `primary: { DEFAULT, foreground }` produce `bg-primary` y `bg-primary/10` —el
 * grupo entero— además de `text-primary-foreground`. Por eso un grupo con
 * `DEFAULT` también aporta su nombre a secas.
 */
function claves(objeto: Colores): string[] {
  return Object.entries(objeto).flatMap(([nombre, valor]) => {
    if (typeof valor === 'string') return [nombre];
    const subs = Object.keys(valor);
    return subs.includes('DEFAULT')
      ? [nombre, ...subs.filter((s) => s !== 'DEFAULT').map((s) => `${nombre}-${s}`)]
      : subs.map((s) => `${nombre}-${s}`);
  });
}

const colores = config.theme.extend.colors;
const nombres = claves(colores);

/** Los tokens CSS que la config de Tailwind da por usados. */
function variablesUsadas(): Set<string> {
  const fuentes = Object.values(colores).flatMap((valor) =>
    typeof valor === 'string' ? [valor] : Object.values(valor),
  );
  const usadas = new Set<string>();
  for (const fuente of fuentes) {
    for (const m of String(fuente).matchAll(/var\(--([a-z-]+)/g)) usadas.add(m[1]);
  }
  return usadas;
}

/** El primer bloque `{ ... }` que empieza por el selector dado. */
function bloque(selector: string): string {
  const desde = CSS.indexOf(selector);
  expect(desde, `no se encuentra "${selector}" en index.css`).toBeGreaterThan(-1);
  return CSS.slice(desde, CSS.indexOf('}', desde));
}

const declaradas = (css: string) => new Set([...css.matchAll(/--([a-z-]+):/g)].map((m) => m[1]));

const claro = declaradas(bloque(':root'));
const oscuro = declaradas(bloque('.dark'));

describe('la config de Tailwind y el CSS cuentan lo mismo', () => {
  it.each([
    ['claro', claro],
    ['oscuro', oscuro],
  ])('todo token que la config usa existe en index.css en modo %s', (_modo, definidas) => {
    for (const usada of variablesUsadas()) {
      expect(
        definidas.has(usada),
        `--${usada} se usa en tailwind.config.js pero no está declarado en index.css`,
      ).toBe(true);
    }
  });

  it('los dos modos declaran exactamente los mismos tokens', () => {
    // Un token que solo existe en un modo se queda sin valor al cambiar de tema:
    // la propiedad cae al valor inicial en lugar de mantener el diseño.
    expect([...claro].sort()).toEqual([...oscuro].sort());
  });

  it('el color que usan las sombras suaves está en los dos modos', () => {
    expect(config.theme.extend.boxShadow.card).toContain('var(--shadow)');
    expect(config.theme.extend.boxShadow.pop).toContain('var(--shadow)');
    expect(claro.has('shadow')).toBe(true);
    expect(oscuro.has('shadow')).toBe(true);
  });

  it('las sombras del diálogo se difuminan más que las de las tarjetas', () => {
    // Si no, el modal separa de la superficie lo mismo que una tarjeta y parece
    // un rectángulo plano en vez de una ventana por encima.
    const mayorDesenfoque = (sombra: string) =>
      Math.max(...[...sombra.matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1])));
    expect(mayorDesenfoque(config.theme.extend.boxShadow.pop)).toBeGreaterThan(
      mayorDesenfoque(config.theme.extend.boxShadow.card),
    );
  });
});

describe('las clases propias que usa el código', () => {
  it('están todas definidas en la config', () => {
    expect(nombres).toContain('primary');
    expect(nombres).toContain('muted-foreground');
    expect(nombres).toContain('border');
    expect(Object.keys(config.theme.extend.borderRadius)).toContain('card');
    expect(Object.keys(config.theme.extend.boxShadow)).toEqual(
      expect.arrayContaining(['card', 'pop']),
    );
  });
});

describe('el modo oscuro se activa por clase, no por preferencia del sistema', () => {
  it('Tailwind está en darkMode class', () => {
    // Con `media` el `dark:` se decidiría por el sistema operativo y el
    // interruptor de la app no podría contradecirlo, que es justo lo que el
    // interruptor tiene que poder hacer.
    expect(config.darkMode).toBe('class');
  });

  it('el CSS define una clase .dark y no una media query de tema', () => {
    expect(CSS).toContain('.dark {');
    expect(CSS).not.toMatch(/@media\s*\(prefers-color-scheme/);
  });
});