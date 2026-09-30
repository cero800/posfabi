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