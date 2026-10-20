// Escritura de documentos que genera el webview.
//
// El PDF de la factura lo dibuja jsPDF y el `.xlsx` del reporte lo arma ExcelJS,
// los dos dentro del webview: son bibliotecas de navegador y no tiene sentido
// reconstruirlas en el backend. Lo que sí necesita el backend es la última
// milla, porque la carpeta destino (`Documentos\tienda\facturas\`) es suya y
// así hay un solo sitio que sabe dónde queda cada cosa.
//
// El contenido llega en base64 porque el transporte es JSON-RPC: son bytes, y
// JSON no los tiene. Es la opción menos mala, no la buena.
//
// Este módulo no es una utilidad genérica de archivos. Es exactamente lo que
// necesitan las dos pantallas que guardan documentos, y por eso valida el
// nombre que le mandan: el nombre viene del navegador, o sea de una cadena que
// el usuario pudo editar en la caja de direcciones de un `data:` URL.

import fs from 'node:fs';
import path from 'node:path';

import { type Rutas, RUTAS } from './paths.js';
import { sistema, validacion } from './errors.js';

//---------------------------------------------------------------------------
// Base64
//---------------------------------------------------------------------------

/**
 * Caracteres válidos en base64 estándar, con o sin relleno `=`.
 *
 * `Buffer.from(x, 'base64')` es indulgente: ante cualquier basura devuelve algo
 * en vez de fallar, así que un contenido corrupto se guardaría como un
 * archivo hecho pedazos y el cajero lo abriría sin entender qué pasó. Se valida
 * antes de decodificar para que el error aparezca en la pantalla que lo pidió.
 *
 * La expresión acepta también espacios y saltos de línea, porque
 * `arrayBufferABase64` del frontend envuelve la línea a 76 caracteres.
 */
const BASE64 = /^[A-Za-z0-9+/\s]*={0,2}$/;

/** Decodifica contenido base64, o explica por qué no se pudo. */
function decodificarBase64(contenido: string, etiqueta: string): Buffer {
  const limpio = contenido.trim();
  if (limpio === '') {
    throw validacion(`El contenido del ${etiqueta} llegó vacío`);
  }
  if (!BASE64.test(limpio)) {
    throw validacion(`El contenido del ${etiqueta} no es base64 válido`);
  }
  // Un múltiplo de 4 es la única longitud que representa bytes completos; lo
  // que sobra es relleno que se perdió por el camino.
  if (limpio.replace(/\s/g, '').length % 4 !== 0) {
    throw validacion(`El contenido del ${etiqueta} llegó truncado`);
  }

  const bytes = Buffer.from(limpio, 'base64');
  if (bytes.length === 0) {
    throw validacion(`El contenido del ${etiqueta} llegó vacío`);
  }
  return bytes;
}

//---------------------------------------------------------------------------
// Nombre del archivo
//---------------------------------------------------------------------------

/** Nombres que Windows reserva y no deja crear, ni siquiera con extensión. */
const RESERVADOS = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/**
 * Deja un nombre que Windows acepte y que no pueda escapar de la carpeta.
 *
 * Se queda con alfanuméricos, `-`, `_` y `.`, y cambia todo lo demás por `_`.
 * El motivo no es la estética: un nombre con `/` o `\` es un camino, y un
 * nombre con `..` sale de la carpeta de facturas. Aquí el nombre no lo escribe
 * el backend sino el navegador, y en un `data:` URL el JavaScript lo tiene
 * cualquiera.
 *
 * Los puntos del final también sobran: Windows los recorta solo, así que
 * `factura.pdf.` y `factura.pdf` serían el mismo archivo y el segundo guardado
 * pisaría al primero sin avisar.
 */
function sanearNombre(nombre: string, etiqueta: string): string {
  // El recorte va antes de la sustitución: si los espacios se cambiaran por `_`
  // primero, un nombre de solo espacios dejaría de estar vacío y se guardaría
  // como `___.pdf`.
  const limpio = [...nombre.trim()]
    .map((c) => (/^[A-Za-z0-9._-]$/.test(c) ? c : '_'))
    .join('')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');

  if (limpio === '') {
    throw validacion(`El nombre del ${etiqueta} quedó vacío al limpiarlo`);
  }

  // `CON.pdf` no es un nombre reservado, pero `con` sin extensión sí lo es y el
  // nombre puede venir sin extensión.
  if (RESERVADOS.has(limpio.split('.')[0]!.toLowerCase())) {
    return `_${limpio}`;
  }
  return limpio;
}

//---------------------------------------------------------------------------
// Escritura
//---------------------------------------------------------------------------

/**
 * Guarda un documento generado por el webview y devuelve su ruta completa.
 *
 * Crea la carpeta si no existe y sobrescribe si el archivo ya está: los nombres
 * que usa el frontend (`factura-0001-2026-09-28.pdf`, `reporte-2026-09-28.xlsx`)
 * son únicos por venta y por día, así que pisar es justo el comportamiento
 * buscado al reexportar el mismo reporte corregido.
 *
 * Se escribe a un temporal y se renombra al final. Si se escribiera directo, un
 * corte de luz a mitad del PDF dejaría un archivo truncado con extensión
 * `.pdf` que el cajero abriría creyendo que la factura está mala.
 */
function guardarDocumento(
  nombreArchivo: string,
  contenidoB64: string,
  subcarpeta: string,
  etiqueta: string,
  rutas: Rutas = RUTAS,
): string {
  const nombre = sanearNombre(nombreArchivo, etiqueta);
  const bytes = decodificarBase64(contenidoB64, etiqueta);
  const dir = path.join(rutas.documentDir, 'tienda', subcarpeta);
  const destino = path.join(dir, nombre);
  // El temporal vive en la carpeta destino, no en `rutas.tempDir`. `rename` es
  // atómico solo dentro del mismo sistema de archivos: si el temporal está en
  // `/tmp` (otra partición, o `%TEMP%` en otro disco) el renombrado falla con
  // `EXDEV: cross-device link not permitted` y la factura nunca se guarda. Con
  // el temporal junto al destino el renombrado siempre es del mismo dispositivo.
  const temporal = path.join(dir, `.${nombre}.${process.pid}.parcial`);

  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(temporal, bytes);
    fs.renameSync(temporal, destino);
  } catch (e) {
    // El temporal no se limpió: sin esto queda un `.parcial` oculto junto a las
    // facturas buenas, uno por cada factura que no se pudo guardar.
    try {
      fs.rmSync(temporal, { force: true });
    } catch {
      // Si ni esto sale, ya hay un problema de permisos que el error de arriba
      // describe mejor que este.
    }
    throw sistema(
      `No se pudo guardar el ${etiqueta} en ${dir}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  return destino;
}

/** Guarda el PDF de una factura en `Documentos\tienda\facturas\`. */
export function guardarFacturaPdf(
  nombreArchivo: string,
  contenidoB64: string,
  rutas: Rutas = RUTAS,
): string {
  return guardarDocumento(nombreArchivo, contenidoB64, 'facturas', 'PDF de la factura', rutas);
}

/** Guarda el reporte del día en `Documentos\tienda\excel\`. */
export function guardarReporteExcel(
  nombreArchivo: string,
  contenidoB64: string,
  rutas: Rutas = RUTAS,
): string {
  return guardarDocumento(nombreArchivo, contenidoB64, 'excel', 'reporte', rutas);
}
