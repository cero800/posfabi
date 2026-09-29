import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { guardarFacturaPdf, guardarReporteExcel } from './archivos.js';
import type { Rutas } from './paths.js';
import { mkdirsTmp, rutasTemporales } from './testutil.js';

// `aGVsbG8` es "hello". Sirve para probar el contenido sin montar un PDF de
// verdad: a este módulo le llega una cadena opaca y solo tiene que escribir
// exactamente los bytes que dice.
const HOLA_B64 = 'aGVsbG8=';

//---------------------------------------------------------------------------
// Andamiaje
//---------------------------------------------------------------------------

const limpios: string[] = [];

/** Rutas nuevas, limpias, que se borran al terminar la prueba. */
function rutasLimpias(): Rutas {
  const { rutas, raiz } = rutasTemporales();
  limpios.push(raiz);
  mkdirsTmp(rutas);
  return rutas;
}

afterEach(() => {
  for (const raiz of limpios.splice(0)) {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

/** Los archivos que hay bajo `dir`, como nombres relativos ordenados. */
function listado(dir: string): string[] {
  return fs.readdirSync(dir).sort();
}

//---------------------------------------------------------------------------
// Lo normal
//---------------------------------------------------------------------------

describe('guardarFacturaPdf', () => {
  it('escribe el archivo y devuelve dónde quedó', () => {
    const rutas = rutasLimpias();
    const ruta = guardarFacturaPdf('factura-0001-2026-09-28.pdf', HOLA_B64, rutas);

    expect(ruta).toBe(
      path.join(rutas.documentDir, 'tienda', 'facturas', 'factura-0001-2026-09-28.pdf'),
    );
    expect(fs.readFileSync(ruta, 'utf8')).toBe('hello');
  });

  it('crea la carpeta de facturas aunque no exista', () => {
    const rutas = rutasLimpias();
    const destino = path.join(rutas.documentDir, 'tienda', 'facturas');
    expect(fs.existsSync(destino)).toBe(false);

    guardarFacturaPdf('a.pdf', HOLA_B64, rutas);
    expect(fs.existsSync(destino)).toBe(true);
  });

  it('deja cada factura en su propio archivo, sin pisarse entre sí', () => {
    const rutas = rutasLimpias();
    guardarFacturaPdf('factura-0001.pdf', Buffer.from('primera').toString('base64'), rutas);
    guardarFacturaPdf('factura-0002.pdf', Buffer.from('segunda').toString('base64'), rutas);

    const dir = path.join(rutas.documentDir, 'tienda', 'facturas');
    expect(listado(dir)).toEqual(['factura-0001.pdf', 'factura-0002.pdf']);
    expect(fs.readFileSync(path.join(dir, 'factura-0001.pdf'), 'utf8')).toBe('primera');
  });

  it('sobrescribe si el archivo ya existe, para reexportar el mismo documento', () => {
    // El frontend reintenta guardar la misma factura si la primera vez se le
    // cerró la laptop a mitad de camino. Un "ya existe" lo dejaría sin salida.
    const rutas = rutasLimpias();
    guardarFacturaPdf('factura-0001.pdf', Buffer.from('viejo').toString('base64'), rutas);
    guardarFacturaPdf('factura-0001.pdf', Buffer.from('nuevo').toString('base64'), rutas);

    const ruta = path.join(rutas.documentDir, 'tienda', 'facturas', 'factura-0001.pdf');
    expect(fs.readFileSync(ruta, 'utf8')).toBe('nuevo');
  });
});

describe('guardarReporteExcel', () => {
  it('va a su propia carpeta, separada de las facturas', () => {
    const rutas = rutasLimpias();
    guardarFacturaPdf('factura-0001.pdf', HOLA_B64, rutas);
    const reporte = guardarReporteExcel('reporte-2026-09-28.xlsx', HOLA_B64, rutas);

    expect(reporte).toBe(
      path.join(rutas.documentDir, 'tienda', 'excel', 'reporte-2026-09-28.xlsx'),
    );
    expect(
      listado(path.join(rutas.documentDir, 'tienda', 'facturas')),
    ).toEqual(['factura-0001.pdf']);
    expect(
      listado(path.join(rutas.documentDir, 'tienda', 'excel')),
    ).toEqual(['reporte-2026-09-28.xlsx']);
  });
});

//---------------------------------------------------------------------------
// El nombre, que viene del navegador
//---------------------------------------------------------------------------

describe('el nombre del archivo', () => {
  it('no deja salir de la carpeta de destino', () => {
    const rutas = rutasLimpias();
    // El nombre lo arma el webview. Si el backend lo aceptara tal cual, esto
    // escribiría fuera de `Documentos\tienda\facturas\`, que es exactamente lo
    // que un nombre con `..` significa.
    const ruta = guardarFacturaPdf('../../../../../evil.pdf', HOLA_B64, rutas);

    expect(path.dirname(ruta)).toBe(path.join(rutas.documentDir, 'tienda', 'facturas'));
    expect(fs.existsSync(path.join(rutas.documentDir, '..', '..', 'evil.pdf'))).toBe(false);
  });

  it('cambia por guion bajo lo que Windows no admite en un nombre', () => {
    const rutas = rutasLimpias();
    guardarFacturaPdf('factura 0001 (copia) ñ.pdf', HOLA_B64, rutas);

    expect(
      listado(path.join(rutas.documentDir, 'tienda', 'facturas')),
    ).toEqual(['factura_0001__copia___.pdf']);
  });

  it('recorta los puntos del final, que Windows descarta por su cuenta', () => {
    // `factura.pdf.` y `factura.pdf` son el mismo archivo en Windows. Si el
    // nombre no se recortara, dos facturas distintas se pisarían en silencio.
    const rutas = rutasLimpias();
    guardarFacturaPdf('factura.pdf.', HOLA_B64, rutas);

    expect(
      listado(path.join(rutas.documentDir, 'tienda', 'facturas')),
    ).toEqual(['factura.pdf']);
  });

  it('antepone un guion a los nombres que Windows reserva', () => {
    const rutas = rutasLimpias();
    guardarFacturaPdf('CON', HOLA_B64, rutas);

    expect(listado(path.join(rutas.documentDir, 'tienda', 'facturas'))).toEqual(['_CON']);
  });

  it('rechaza un nombre que se queda sin nada', () => {
    const rutas = rutasLimpias();
    // Un nombre que no deja nada usable es un error del frontend, no algo que
    // se pueda arreglar guardando el archivo como `___.pdf`.
    for (const malo of ['', '   ', '.', '..', '...', '....']) {
      expect(() => guardarFacturaPdf(malo, HOLA_B64, rutas)).toThrowError(/quedó vacío/);
    }
  });

  it('acepta acentos y eñes en el contenido, no en el nombre', () => {
    // El nombre del archivo lo genera el backend, con formato `factura-0001.pdf`
    // y `reporte-AAAA-MM-DD.xlsx`: siempre ASCII. Los acentos viven en el
    // contenido, que va en base64 y no pasa por el saneador.
    const rutas = rutasLimpias();
    const conAcentos = Buffer.from('Factura: Cuadernillo × 2 — "El Lápiz", Bs 1.234,56')
      .toString('base64');
    const ruta = guardarFacturaPdf('factura-0001.pdf', conAcentos, rutas);

    expect(fs.readFileSync(ruta, 'utf8')).toBe('Factura: Cuadernillo × 2 — "El Lápiz", Bs 1.234,56');
  });
});

//---------------------------------------------------------------------------
// El contenido
//---------------------------------------------------------------------------

describe('el contenido que llega', () => {
  it('rechaza algo que no es base64 en vez de escribir un archivo de basura', () => {
    // `Buffer.from('esto no es base64', 'base64')` no falla: devuelve bytes
    // raros. Sin validar, el cajero abriría un PDF corrupto creyendo que la
    // factura salió mal.
    const rutas = rutasLimpias();
    const dir = path.join(rutas.documentDir, 'tienda', 'facturas');
    expect(() => guardarFacturaPdf('a.pdf', '!!! no soy base64 !!!', rutas)).toThrowError(
      /no es base64 válido/,
    );
    // Ni siquiera se crea la carpeta: el contenido se valida antes de tocar disco.
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('rechaza contenido vacío', () => {
    const rutas = rutasLimpias();
    for (const vacio of ['', '   ', '====']) {
      expect(() => guardarFacturaPdf('a.pdf', vacio, rutas)).toThrowError();
    }
  });

  it('detecta el contenido truncado', () => {
    // Un PDF cortado a la mitad llega como base64 de largo no múltiplo de 4.
    const truncado = HOLA_B64.slice(0, HOLA_B64.length - 1);
    const rutas = rutasLimpias();
    expect(() => guardarFacturaPdf('a.pdf', truncado, rutas)).toThrowError(/truncado/);
  });

  it('tolera el base64 partido en varias líneas', () => {
    // `arrayBufferABase64` del frontend envuelve a 76 caracteres, que es lo que
    // hace MIME y también lo primero que hunden los implementadores.
    const largo = Buffer.from('x'.repeat(500)).toString('base64');
    const partido = largo.match(/.{1,76}/g)!.join('\n');
    const rutas = rutasLimpias();
    const ruta = guardarFacturaPdf('a.pdf', partido, rutas);

    expect(fs.statSync(ruta).size).toBe(500);
  });
});

//---------------------------------------------------------------------------
// Fallos de disco
//---------------------------------------------------------------------------

describe('cuando el disco no deja', () => {
  it('no deja archivos a medias y el error dice dónde falló', () => {
    const rutas = rutasLimpias();
    // `dataDir` es un archivo, no una carpeta: crear `tienda/documentos/tienda`
    // debajo va a fallar.
    fs.rmSync(rutas.documentDir, { recursive: true, force: true });
    fs.writeFileSync(rutas.documentDir, 'estoyocupandoelpuesto');

    expect(() => guardarFacturaPdf('a.pdf', HOLA_B64, rutas)).toThrowError(/No se pudo guardar/);
  });

  it('limpia el temporal cuando la escritura falla', () => {
    // El temporal vive en `%TEMP%`, no junto al destino. Un fallo de escritura
    // lo dejaría ahí, y a la larga `%TEMP%` se llena de `.parcial` de facturas
    // que nadie sabe qué son.
    const rutas = rutasLimpias();
    fs.rmSync(rutas.documentDir, { recursive: true, force: true });
    fs.writeFileSync(rutas.documentDir, 'bloqueado');

    expect(() => guardarFacturaPdf('a.pdf', HOLA_B64, rutas)).toThrowError();
    expect(listado(rutas.tempDir)).toEqual([]);
  });

  it('nombra el temporal con el pid, para que dos procesos no se pisen', () => {
    // Si dos instancias del backend escribieran a la vez (el usuario abrió dos
    // copias del POS), un temporal con nombre fijo dejaría un PDF a medias.
    const rutas = rutasLimpias();
    guardarFacturaPdf('factura-0001.pdf', HOLA_B64, rutas);
    guardarFacturaPdf('factura-0002.pdf', HOLA_B64, rutas);

    expect(listado(rutas.tempDir)).toEqual([]);
    expect(
      listado(path.join(rutas.documentDir, 'tienda', 'facturas')),
    ).toEqual(['factura-0001.pdf', 'factura-0002.pdf']);
  });
});
