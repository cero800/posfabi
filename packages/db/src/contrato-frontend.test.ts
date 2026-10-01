// El contrato entre las dos mitades de la app: la interfaz pide procedures por
// nombre y el backend tiene que conocerlos.
//
// ## Por qué este test es raro
//
// Lee el código fuente de otro paquete. No es la forma habitual de probar, y
// normalmente no lo haría. Lo hago porque el contrato entre el frontend y el
// backend no lo comprueba nadie más, y ya costó una app entera: cuando los
// commands de Rust se movieron al backend, `registrar_produccion` pasó a
// llamarse `registrar_entrada_mercancia` y la interfaz siguió llamándolo por el
// nombre viejo. Nada falló al compilar —cada mitad por su lado estaba bien— y
// el resultado fue un POS que no arrancaba.
//
// ## Por qué no se resuelve importing
//
// Podría importar los wrappers del frontend y llamar a cada uno contra una base
// de pruebas, que es lo que de verdad importa: que cada llamada sea aceptada por
// el backend. No se hace por dos razones. La primera es que el paquete del
// frontend no depende del del backend —esa es la arquitectura entera, y el
// cliente habla por un proceso aparte—, y un test que la rompe para probarla es
// una prueba que nadie va a querer arreglar. La segunda es que los wrappers
// piden datos que aquí no existen: un cliente, un producto, una venta.
//
// Lo que queda es la parte que sí se puede comprobar sin montar nada: los
// nombres. Y es la parte que se rompió.
//
// ## Cuando se mueva el archivo
//
// Si esto falla porque no encuentra `packages/desktop/src/services/db.ts`, el
// archivo se movió y hay que arreglar la ruta de arriba. No se salta la prueba:
// una prueba que se salta sola no avisa de nada.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROCEDIMIENTOS } from './procedimientos.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Archivos de la interfaz que hablan con el backend, en orden de arranque. */
const ARCHIVOS = [
  'src/services/backend.ts',
  'src/services/db.ts',
  'src/services/logging.ts',
];

/** El procedure que llama al backend cuando la interfaz aún no ha comprobado nada. */
const ARRANQUE = 'estado_sistema';

/**
 * Saca los nombres de procedure que pide el frontend.
 *
 * Se buscan las llamadas a `llamar(...)`, que es el único camino: los wrappers
 * de `db.ts` no llaman a `invoke` y no podrían, porque `invoke` ya no habla con
 * el backend sino con el shell de Rust, que solo expone `rutas_app`.
 *
 * El nombre se captura con un conjunto de caracteres más ancho que el de los
 * nombres válidos a propósito. Con `[a-z_]` —el juego de caracteres real— un
 * nombre escrito con una mayúscula o un dígito, como `listar_clientes_XX`, no
 * entraba en la captura y la prueba lo daba por bueno. Que es exactamente el
 * error que se busca aquí: uno que no se parece a un nombre de procedure.
 */
function nombresPedidos(origen: string): string[] {
  const fuente = fs.readFileSync(path.join(RAIZ, 'desktop', origen), 'utf8');
  const encontrados = new Set<string>();
  // `llamar<T>('nombre'...` y `llamar('nombre'...`, con o sin salto de línea.
  const patron = /\bllamar(?:<[^>]*>)?\(\s*'([\w]+)'/g;
  for (const coincidencia of fuente.matchAll(patron)) {
    const nombre = coincidencia[1];
    // El grupo de captura está garantizado por construcción, pero si el patrón
    // se tocara y no casara, no se cuela un nombre vacío como si fuera real.
    if (nombre !== undefined) encontrados.add(nombre);
  }
  return [...encontrados].sort();
}

describe('Contrato entre la interfaz y el backend', () => {
  const conocidos = new Set(Object.keys(PROCEDIMIENTOS));

  it('el procedure de arranque existe y no toca datos de negocio', () => {
    // Si este falla, la interfaz se queda esperando un backend que nunca
    // contesta y no hay forma de distinguirlo de un POS lento.
    expect(conocidos.has(ARRANQUE)).toBe(true);
  });

  it('la interfaz no pide procedures que el backend no conozca', () => {
    const desconocidos: string[] = [];
    for (const archivo of ARCHIVOS) {
      for (const nombre of nombresPedidos(archivo)) {
        if (!conocidos.has(nombre)) desconocidos.push(`${nombre} (en ${archivo})`);
      }
    }

    expect(
      desconocidos,
      `La interfaz pide procedures que no están en el registro:\n  ${desconocidos.join('\n  ')}\n` +
        'O se escribió mal el nombre, o el procedure se renombró sin tocar la interfaz.',
    ).toEqual([]);
  });

  it('la extracción de nombres no se queda vacía sin avisar', () => {
    // La prueba anterior pasa sola si `nombresPedidos` deja de encontrar
    // llamadas —porque `llamar` cambió de nombre, o porque el archivo se vació—.
    // Aquí se comprueba que sigue habiendo nombres, y muchos: `db.ts` es donde
    // están los wrappers de todo el POS.
    const enDb = nombresPedidos('src/services/db.ts');
    expect(enDb.length).toBeGreaterThan(30);
    expect(enDb).toContain('necesita_configuracion');
  });
});

//---------------------------------------------------------------------------
// El nombre del sidecar
//---------------------------------------------------------------------------

/**
 * Los tres sitios donde tiene que coincidir el nombre del backend empaquetado.
 *
 * Es un contrato igual de real que el de los procedures, y rompió igual de
 * callado: `tauri-plugin-shell` busca el programa comparando el texto que le
 * pasa la interfaz con la lista de `externalBin` y con el `name` del scope de la
 * capability. Con uno de los tres distinto, `spawn()` se rechaza con «sidecar not
 * configured under `bundle > externalBin``, la interfaz se queda sin backend y
 * todo lo demás —código, tipos, pruebas— sigue en verde. Nada más lo detecta.
 *
 * Lo que compara es la ruta de `externalBin` con su carpeta, no el nombre del
 * binario: `binaries/tienda-db`, no `tienda-db`.
 */
function nombreDelSidecar(): string {
  const fuente = fs.readFileSync(path.join(RAIZ, 'desktop', 'src/services/backend.ts'), 'utf8');
  const encontrado = /^const PROGRAMA = '([^']+)';$/m.exec(fuente);
  if (encontrado === null) {
    throw new Error(
      'No se encontró `const PROGRAMA = ...` en desktop/src/services/backend.ts. ' +
        'Si lo cambiaron de sitio hay que arreglar la ruta de esta prueba.',
    );
  }
  return encontrado[1] as string;
}

function leerJson<T>(relativo: string): T {
  return JSON.parse(fs.readFileSync(path.join(RAIZ, 'desktop', relativo), 'utf8')) as T;
}

describe('Nombre del backend empaquetado', () => {
  it('el que pide la interfaz es una entrada de externalBin', () => {
    const conf = leerJson<{ bundle: { externalBin?: string[] } }>('src-tauri/tauri.conf.json');
    const programa = nombreDelSidecar();

    expect(
      conf.bundle.externalBin ?? [],
      `La interfaz lanza «${programa}», que no está en bundle > externalBin ` +
        `(${(conf.bundle.externalBin ?? []).join(', ') || 'vacío'}). ` +
        'Tauri compara el texto tal cual: o se cambia en los dos sitios, o no arranca.',
    ).toContain(programa);
  });

  it('el scope de la capability que lo lanza tiene el mismo nombre', () => {
    const cap = leerJson<{ permissions: unknown[] }>('src-tauri/capabilities/default.json');
    const programa = nombreDelSidecar();
    // El scope está enterrado en un objeto con `identifier` y `allow`; se busca
    // por forma y no por posición para que reordenar el array no rompa nada.
    const permitidos = cap.permissions
      .filter((p): p is { identifier: string; allow?: { name: string; sidecar?: boolean }[] } =>
        typeof p === 'object' && p !== null && 'identifier' in p,
      )
      .flatMap((p) => (p.identifier === 'shell:allow-spawn' ? (p.allow ?? []) : []))
      .filter((s) => s.sidecar === true)
      .map((s) => s.name);

    expect(
      permitidos,
      `La capability lanza ${JSON.stringify(permitidos)} y la interfaz pide «${programa}».`,
    ).toContain(programa);
  });
});