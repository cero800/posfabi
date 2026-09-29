// Los dos registros de texto: errores y traza.
//
// ## Qué son y por qué existen
//
// No van a la base de datos, a propósito. Si el error que hay que registrar es
// el que dejó la base a medio escribir o ilegible, escribir el diagnóstico en
// la base lo pierde: o la escritura falla, o el archivo ya no abre, o el
// diagnóstico queda en un transaction rollback. Un archivo de texto aparte
// siempre se puede leer con un Bloc de notas aunque la aplicación no arranque.
//
// ## Por qué son dos y no uno
//
// Los dos van al mismo sitio y con el mismo formato, pero se separan porque se
// leen en momentos distintos y por gente distinta. `errores.log` lo lee quien
// va a arreglar algo: "no guarda la venta", "no imprime". `traza.log` lo lee
// quien quiere saber por qué la aplicación se quedó colgada, y se puede
// borrar sin perder nada. Si estuvieran en el mismo archivo, la traza —que
// escribe en cada navegación, y por lo tanto crece muchísimo más rápido— taparía
// los errores.
//
// ## Crecimiento
//
// Ninguno de los dos tiene rotación. Un POS de una sola caja genera unos
// cuantos eventos de traza al día y unos pocos errores, así que el archivo
// tarda años en llegar a un tamaño que moleste. Ponerle rotación sería más
// código que el problema que resuelve, y un `errores.log` al que se le da la
// vuelta es un `errores.log` del que nadie se acuerda.

import fs from 'node:fs';
import path from 'node:path';

import { sistema } from './errors.js';
import { type Rutas, RUTAS, asegurarDataDir } from './paths.js';

/** El archivo de errores. */
export const ARCHIVO_ERRORES = 'errores.log';

/** El archivo de traza. */
export const ARCHIVO_TRAZA = 'traza.log';

/**
 * Anota un error en `errores.log`.
 *
 * El frontend manda `${mensaje}\n${stack}`, así que el mensaje llega con saltos
 * de línea. Se convierten en un símbolo para que el archivo siga teniendo una
 * línea por evento: un `errores.log` de mil líneas se lee de un vistazo, y con
 * los `stack` multilínea hay que contar líneas para saber cuántos errores hay.
 */
export function logError(origen: string, mensaje: string, rutas: Rutas = RUTAS): void {
  escribirLinea(ARCHIVO_ERRORES, origen, mensaje, rutas);
}

/**
 * Anota un evento de la interfaz en `traza.log`.
 *
 * Sirve para saber en qué punto se quedó colgada la aplicación: se anota al
 * montar, al iniciar sesión y en cada navegación, así que si la app se queda en
 * blanco la última línea dice dónde.
 */
export function logEvento(origen: string, mensaje: string, rutas: Rutas = RUTAS): void {
  escribirLinea(ARCHIVO_TRAZA, origen, mensaje, rutas);
}

//---------------------------------------------------------------------------
// El mecanismo
//---------------------------------------------------------------------------

function escribirLinea(archivo: string, origen: string, mensaje: string, rutas: Rutas): void {
  const completa = rutaRegistro(archivo, rutas);
  // Una sola entrada por evento. Abrir, escribir y cerrar cada vez es lo que
  // hace que la línea quede completa aunque la aplicación se muera justo
  // después: si se dejara el descriptor abierto, un corte de luz deja la
  // última línea a medias y esa es justo la que importa.
  try {
    fs.appendFileSync(completa, formatear(origen, mensaje), 'utf8');
  } catch (e) {
    throw errorDeRegistro(completa, e);
  }
}

function errorDeRegistro(completa: string, e: unknown): Error {
  return sistema(
    `No se pudo escribir en ${completa}: ${e instanceof Error ? e.message : String(e)}. ` +
      'Revise que la carpeta de datos exista y que el disco no esté en solo lectura.',
  );
}

/**
 * La ruta del archivo, creando la carpeta de datos si hace falta.
 *
 * La creación va dentro del mismo `try` que la escritura a propósito. Si
 * fallara por separado, el error que vería quien lee el registro sería el de
 * `mkdirSync` —`EEXIST: file already exists`—, que no dice nada de que lo que
 * está en el puesto de la carpeta de datos es un archivo.
 */
function rutaRegistro(archivo: string, rutas: Rutas): string {
  const completa = path.join(rutas.dataDir, archivo);
  try {
    asegurarDataDir(rutas);
  } catch (e) {
    throw errorDeRegistro(completa, e);
  }
  return completa;
}

/**
 * `<marca> [<origen>] <mensaje>` con un salto al final.
 *
 * La marca son milisegundos desde la época, como el original. Un número y no una
 * fecha legible porque así el orden de las líneas es el orden en que
 * ocurrieron, y porque el archivo se lee con un Bloc de notas donde una fecha
 * larga ocupa más sitio que un número sin decir nada nuevo.
 */
function formatear(origen: string, mensaje: string): string {
  return `${Date.now()} [${unaLinea(origen)}] ${unaLinea(mensaje)}\n`;
}

/**
 * Deja el texto en una sola línea.
 *
 * Los saltos se cambian por `⏎`, para que se vea dónde estaba el corte en vez
 * de perderlo. Y la sangría se colapsa: la de un `stack` de JavaScript son
 * cuatro espacios por frame que no dicen nada, y con ellos una línea de error
 * mide el doble de lo que tiene que medir. Quien lea esto lo hace en un
 * Bloc de notas, o en un teléfono mientras el cliente espera, y el ancho de la
 * línea es el dato.
 */
function unaLinea(texto: string): string {
  return texto
    .replace(/[\r\n]+/g, ' ⏎ ')
    .replace(/[^\S\n]{2,}/g, ' ')
    .trim();
}

//---------------------------------------------------------------------------
// Leer
//---------------------------------------------------------------------------

/**
 * Lee un archivo de registro, de la línea más antigua a la más reciente.
 *
 * Devuelve `[]` si el archivo no existe. Todavía no haber registrado nada no es
 * un error, y la pantalla que muestra los errores llama a esto al arrancar.
 */
export function leerRegistro(archivo: string, rutas: Rutas = RUTAS): string[] {
  const completa = rutaRegistro(archivo, rutas);
  if (!fs.existsSync(completa)) return [];
  try {
    return fs
      .readFileSync(completa, 'utf8')
      .split('\n')
      .filter((l) => l !== '');
  } catch (e) {
    throw sistema(
      `No se pudo leer ${completa}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
