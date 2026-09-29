import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { ARCHIVO_ERRORES, ARCHIVO_TRAZA, leerRegistro, logError, logEvento } from './bitacora.js';
import { CODIGO_ERROR } from './errors.js';
import type { Rutas } from './paths.js';
import { rutasTemporales } from './testutil.js';

//---------------------------------------------------------------------------
// Andamiaje
//---------------------------------------------------------------------------

const raices: string[] = [];
let rutas: Rutas;

/** Rutas nuevas antes de cada prueba, y la carpeta que hay que borrar. */
function rutasNuevas(): Rutas {
  const r = rutasTemporales();
  rutas = r.rutas;
  raices.push(r.raiz);
  return r.rutas;
}

afterEach(() => {
  for (const raiz of raices.splice(0)) fs.rmSync(raiz, { recursive: true, force: true });
});

function archivo(nombre: string): string {
  return path.join(rutas.dataDir, nombre);
}

//---------------------------------------------------------------------------
// Escribir
//---------------------------------------------------------------------------

describe('logError', () => {
  it('anota una línea con la marca, el origen y el mensaje', () => {
    const r = rutasNuevas();
    logError('venta', 'No se pudo guardar la venta', r);

    const lineas = fs.readFileSync(archivo(ARCHIVO_ERRORES), 'utf8').split('\n');
    expect(lineas.filter((l) => l !== '')).toHaveLength(1);
    expect(lineas[0]).toMatch(/^\d+ \[venta\] No se pudo guardar la venta$/);
  });

  it('la marca es un número, no una fecha larga', () => {
    // Un número ocupa menos sitio y da el orden igual. El archivo se lee con un
    // Bloc de notas, donde una fecha por línea empuja lo importante fuera de
    // la vista.
    const r = rutasNuevas();
    logError('x', 'y', r);

    const marca = fs.readFileSync(archivo(ARCHIVO_ERRORES), 'utf8').split(' ')[0] ?? '';
    expect(Number(marca)).toBeGreaterThan(1_600_000_000_000);
  });

  it('va pegando, no sobrescribiendo', () => {
    // Es la diferencia entre un registro y un archivo con el último error. Con
    // sobrescribir, el segundo error borra el primero y el del cajero que se
    // queja ahora es justo el que se pierde.
    const r = rutasNuevas();
    logError('venta', 'primer error', r);
    logError('impresora', 'segundo error', r);

    const lineas = leerRegistro(ARCHIVO_ERRORES, r);
    expect(lineas).toHaveLength(2);
    expect(lineas[0]).toMatch(/primer error$/);
    expect(lineas[1]).toMatch(/segundo error$/);
  });

  it('deja el archivo entero aunque la aplicación se muera justo después', () => {
    // Se escribe con `appendFileSync`, que abre, escribe y cierra. Un
    // descriptor que se deja abierto perdería la última línea en un corte de
    // luz, y esa es justo la que interesa.
    const r = rutasNuevas();
    logError('ventana', 'montada', r);

    expect(fs.readFileSync(archivo(ARCHIVO_ERRORES), 'utf8').endsWith('\n')).toBe(true);
  });

  it('apila el stack en la misma línea, sin la sangría', () => {
    // El frontend manda `${mensaje}\n${stack}`. Con los saltos tal cual, un
    // error de JavaScript ocupa quince líneas y hay que contarlas para saber
    // cuántos errores hay. Y la sangría de cuatro espacios por frame no dice
    // nada: con ella la línea mide el doble de lo que tiene que medir, y esto
    // se lee en un Bloc de notas o en un teléfono con el cliente esperando.
    const r = rutasNuevas();
    logError('promesa', 'No se pudo leer\n    at algo (app.js:1:1)\n    at otro (app.js:2:2)', r);

    const lineas = leerRegistro(ARCHIVO_ERRORES, r);
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toMatch(/No se pudo leer ⏎ at algo \(app\.js:1:1\) ⏎ at otro/);
  });

  it('crea la carpeta de datos si no existe', () => {
    // Los errores llegan desde la pantalla, y la carpeta de datos puede no
    // existir todavía si el backend arrancó sin abrir la base.
    const r = rutasNuevas();
    expect(fs.existsSync(r.dataDir)).toBe(false);

    logError('x', 'y', r);

    expect(fs.existsSync(archivo(ARCHIVO_ERRORES))).toBe(true);
  });
});

describe('logEvento', () => {
  it('anota en su propio archivo, sin mezclarse con los errores', () => {
    // Se separan porque se leen en momentos distintos: la traza crece con cada
    // navegación y taparía los errores, que son los que hay que mirar.
    const r = rutasNuevas();
    logEvento('app', 'montada', r);
    logError('app', 'se rompió', r);

    expect(leerRegistro(ARCHIVO_TRAZA, r)).toHaveLength(1);
    expect(leerRegistro(ARCHIVO_TRAZA, r)[0]).toMatch(/\[app\] montada$/);
    expect(leerRegistro(ARCHIVO_ERRORES, r)[0]).toMatch(/\[app\] se rompió$/);
  });

  it('acepta muchos eventos, que es lo que se va a llamar en cada navegación', () => {
    const r = rutasNuevas();
    for (let i = 0; i < 200; i++) logEvento('ruta', `/${i}`, r);

    const lineas = leerRegistro(ARCHIVO_TRAZA, r);
    expect(lineas).toHaveLength(200);
    expect(lineas[199]).toMatch(/\/199$/);
  });
});

//---------------------------------------------------------------------------
// Leer
//---------------------------------------------------------------------------

describe('leerRegistro', () => {
  it('devuelve las líneas de la más antigua a la más reciente', () => {
    // Al revés el diagnóstico no sirve: el error que interesa es el último, el
    // que acaba de pasar.
    const r = rutasNuevas();
    logEvento('a', 'primero', r);
    logEvento('a', 'segundo', r);

    expect(leerRegistro(ARCHIVO_TRAZA, r).map((l) => l.match(/(\w+)$/)?.[1])).toEqual([
      'primero',
      'segundo',
    ]);
  });

  it('un archivo que no existe es una lista vacía, no un error', () => {
    // La pantalla de errores llama a esto al arrancar, antes de que haya
    // ocurrido ninguno. Que fuera un error dejaría la aplicación sin arrancar.
    const r = rutasNuevas();
    expect(leerRegistro(ARCHIVO_ERRORES, r)).toEqual([]);
  });

  it('no cuenta la línea vacía del final como un evento', () => {
    // Cada línea termina en salto, así que `split` siempre deja una última
    // cadena vacía. Contarla sería un error más que no ocurrió.
    const r = rutasNuevas();
    logError('a', 'x', r);

    expect(leerRegistro(ARCHIVO_ERRORES, r)).toHaveLength(1);
  });

  it('salta las líneas en blanco que hubiera en medio', () => {
    const r = rutasNuevas();
    logError('a', 'x', r);
    fs.appendFileSync(archivo(ARCHIVO_ERRORES), '\n\n', 'utf8');
    logError('a', 'y', r);

    expect(leerRegistro(ARCHIVO_ERRORES, r)).toHaveLength(2);
  });
});

//---------------------------------------------------------------------------
// Cuando el registro no se puede escribir
//---------------------------------------------------------------------------

describe('logError sin permiso', () => {
  it('avisa con su mensaje y no con el de Node', () => {
    // `EACCES: permission denied, open '...'` no le dice al dueño que la
    // carpeta de datos está en solo lectura.
    const r = rutasNuevas();
    const ocupada = path.join(r.tempDir, 'datos');
    fs.mkdirSync(path.dirname(ocupada), { recursive: true });
    fs.writeFileSync(ocupada, 'soy un archivo');

    try {
      logError('x', 'y', { ...r, dataDir: ocupada });
      throw new Error('se esperaba un error');
    } catch (e) {
      expect((e as { codigo?: string }).codigo).toBe(CODIGO_ERROR.sistema);
      expect((e as Error).message).toMatch(/No se pudo escribir en/);
    }
  });
});
