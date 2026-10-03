// Tests del modo claro/oscuro.
//
// Lo que más importa aquí no es que `alternarTema` funcione, que es una línea, sino
// que el script de `public/theme.js` decida **lo mismo** que este módulo. Son dos
// copias de la misma regla —una en TypeScript para React, otra en JavaScript plano
// para el primer pintado— y nada más las ata: si una cambia y la otra no, la app
// arranca en un color y se pasa al otro un instante después. Ningún otro test lo
// caza, así que estos ejecutan el script de verdad y comparan.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { establecerTemaDelSistema } from '../test/matchMedia';
import {
  alternarTema,
  cambiarTema,
  iniciarTema,
  temaEfectivo,
  useTema,
  CLAVE_TEMA,
} from './tema';

// vitest con `environment: 'jsdom'` da `import.meta.url` como URL `http://`, así
// que `fileURLToPath` no vale. Se resuelve desde la raíz del paquete, que es el
// directorio de trabajo de vitest. Si algún día dejara de serlo, `readFileSync`
// falla con un ENOENT que lo dice claro.
const RUTA_TEMA_JS = resolve(process.cwd(), 'public/theme.js');
const RUTA_INDEX_HTML = resolve(process.cwd(), 'index.html');

function claseOscuro(): boolean {
  return document.documentElement.classList.contains('dark');
}

/** Corre `public/theme.js` como lo haría el navegador, sobre el documento de ahora. */
function correrScriptAntiflash(): void {
  const codigo = readFileSync(RUTA_TEMA_JS, 'utf8');
  // El archivo es un IIFE que usa los globales del navegador. Se le pasan como
  // parámetros en vez de confiar en que estén sueltos en el ámbito, que es lo que
  // un `<script src>` normal sí tiene.
  new Function('document', 'localStorage', 'matchMedia', codigo)(
    document,
    localStorage,
    globalThis.matchMedia,
  );
}

/** Repone el módulo a su estado de arranque: tema del sistema, sin recordarlo. */
function temaLimpio(): void {
  // El orden importa: `cambiarTema` guarda en `localStorage`, así que el borrado
  // va después. Al final queda como una instalación nueva, sin tema elegido.
  cambiarTema('system');
  localStorage.removeItem(CLAVE_TEMA);
  document.documentElement.classList.remove('dark');
}

beforeEach(temaLimpio);
afterEach(temaLimpio);

describe('temaEfectivo', () => {
  it('usa lo que se eligió cuando es claro u oscuro', () => {
    expect(temaEfectivo('light')).toBe('light');
    expect(temaEfectivo('dark')).toBe('dark');
  });

  it('resuelve "system" al tema del sistema operativo', () => {
    establecerTemaDelSistema(true);
    expect(temaEfectivo('system')).toBe('dark');
    establecerTemaDelSistema(false);
    expect(temaEfectivo('system')).toBe('light');
  });
});

describe('alternarTema', () => {
  it('de claro pasa a oscuro y al revés', () => {
    cambiarTema('light');
    alternarTema();
    expect(claseOscuro()).toBe(true);

    alternarTema();
    expect(claseOscuro()).toBe(false);
  });

  it('arranca desde el contrario del sistema cuando nadie eligió tema', () => {
    // El estado inicial es `system`. Si el sistema pide oscuro y el usuario pulsa
    // el interruptor, lo razonable es que quiera claro, no que se le reaplique el
    // mismo color.
    establecerTemaDelSistema(true);
    cambiarTema('system');
    alternarTema();
    expect(claseOscuro()).toBe(false);
  });

  it('recuerda el tema elegido', () => {
    cambiarTema('dark');
    expect(localStorage.getItem(CLAVE_TEMA)).toBe('dark');
  });

  it('sobrevive a un valor corrupto en localStorage', () => {
    localStorage.setItem(CLAVE_TEMA, 'sepia');
    // `iniciarTema` lee lo guardado. No debe lanzar: cae al tema del sistema.
    iniciarTema();
    expect(claseOscuro()).toBe(false);
    establecerTemaDelSistema(true);
    iniciarTema();
    expect(claseOscuro()).toBe(true);
  });
});

describe('el script que evita el parpadeo', () => {
  // Este bloque es el que ata `public/theme.js` con `tema.ts`.

  it('pone la clase .dark cuando el usuario eligió oscuro', () => {
    localStorage.setItem(CLAVE_TEMA, 'dark');
    correrScriptAntiflash();
    expect(claseOscuro()).toBe(true);
  });

  it('deja la pantalla clara cuando el usuario eligió claro', () => {
    document.documentElement.classList.add('dark');
    localStorage.setItem(CLAVE_TEMA, 'light');
    correrScriptAntiflash();
    expect(claseOscuro()).toBe(false);
  });

  it('sigue al sistema cuando el usuario no eligió nada', () => {
    establecerTemaDelSistema(true);
    correrScriptAntiflash();
    expect(claseOscuro()).toBe(true);
  });

  it('no oscurece por un valor corrupto', () => {
    localStorage.setItem(CLAVE_TEMA, 'loquesea');
    correrScriptAntiflash();
    expect(claseOscuro()).toBe(false);
  });

  it('se carga en el HTML antes de la app, para no parpadear', () => {
    // El orden importa: si el script se moviera después del punto de entrada,
    // dejaría de cumplir su propósito aunque la regla fuera correcta.
    const html = readFileSync(RUTA_INDEX_HTML, 'utf8');
    const posTema = html.indexOf('/theme.js');
    const posApp = html.indexOf('/src/main.tsx');
    expect(posTema).toBeGreaterThan(-1);
    expect(posApp).toBeGreaterThan(-1);
    expect(posTema).toBeLessThan(posApp);
  });

  it('decide exactamente lo mismo que el módulo', () => {
    // La comparación que de verdad importa: para cada combinación de elección y
    // de tema del sistema, el script del `<head>` y `tema.ts` coinciden.
    const elecciones: Array<string | null> = [null, 'light', 'dark', 'system', 'basura'];
    for (const sistema of [false, true]) {
      for (const eleccion of elecciones) {
        const etiqueta = `sistema=${sistema} elección=${eleccion}`;

        document.documentElement.classList.remove('dark');
        if (eleccion === null) localStorage.removeItem(CLAVE_TEMA);
        else localStorage.setItem(CLAVE_TEMA, eleccion);
        establecerTemaDelSistema(sistema);
        correrScriptAntiflash();
        const porScript = claseOscuro();

        // El módulo solo puede leer `localStorage` al cargarse, así que en vez de
        // escribir el valor se le dice directamente. Un valor corrupto es lo que
        // hace `leer()` al arrancar, y equivale a `system`.
        cambiarTema(
          eleccion === null || eleccion === 'basura' ? 'system' : (eleccion as 'light' | 'dark' | 'system'),
        );
        iniciarTema();
        expect(claseOscuro(), etiqueta).toBe(porScript);
      }
    }
  });
});

describe('useTema', () => {
  it('devuelve el tema efectivo y refleja el cambio', () => {
    let visto: 'light' | 'dark' = 'light';
    function Sonda() {
      visto = useTema().efectivo;
      return null;
    }

    render(createElement(Sonda));
    expect(visto).toBe('light');

    act(() => cambiarTema('dark'));
    expect(visto).toBe('dark');

    act(() => cambiarTema('light'));
    expect(visto).toBe('light');
  });
});