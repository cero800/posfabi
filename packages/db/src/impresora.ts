// Envío de tickets a la impresora térmica.
//
// ## Por qué esto se reescribe entero
//
// El backend original era Linux y tenía dos destinos: escribir bytes a
// `/dev/usb/lp0` o mandarlos a una cola CUPS con `lp -o raw`. Ninguna de las
// dos cosas existe en Windows, así que esto no es un porte sino otro
//Transportador, y las diferencias no son de nombre:
//
// - **Red.** Es lo único que hay que escribir. Toda impresora térmica de red
//   habla JetDirect en el puerto 9100, que es un socket TCP donde se escriben
//   bytes crudos. Node lo hace con `node:net`, sin dependencias. Y de paso se
//   puede poner timeout, que con `lp` no se podía: una impresora apagada
//   dejaba el comando colgado y el POS con la pantalla de venta bloqueada.
// - **USB.** Windows no expone los puertos USB de una impresora como archivos.
//   Lo que hay es la cola del spooler, y para mandarle bytes crudos a una
//   impresora ESC/POS la cola tiene que estar instalada con el controlador
//   "Texto sin formato" (Generic / Text Only). Con otro controlador, el spooler
//   rasteriza el texto y los bytes ESC/POS salen como caracteres raros en vez
//   de comandos. Por eso `listarImpresoras` y el error de `imprimir` dicen
//   explícitamente cuál es el controlador que hace falta, y por eso `probar`
//   es un paso obligatorio de la configuración y no un adorno.
// - **Archivo.** Se escribe a un archivo. Sirve para dos cosas: comprobar que
//   el ticket se genera bien sin tener la impresora comprada todavía, y tener
//   una prueba de lo que salió cuando algo se ve mal en el papel.
//
// ## Dónde se guarda
//
// El destino es JSON en `config.impresora_termica`. Tipado, no una cadena suelta
// como la ruta `/dev/usb/lp0` del original: una cadena no distingue "la
// impresora se llama `EPSON TM-T20`" de "el host es `EPSON TM-T20`", y el
// error de esa confusión no aparece hasta que alguien intenta imprimir.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';

import {
  IMPRESORA_TERMICA_KEY,
  type DestinoImpresora,
  NEGOCIO_CONFIG_KEYS,
} from '@tienda/core';

import { leerConfig, escribirConfig } from './config.js';
import {
  impresora as errorImpresora,
  impresoraNoConfigurada,
  validacion,
} from './errors.js';
import { type Rutas, RUTAS } from './paths.js';
import { ticketPrueba } from './ticket.js';

const ejecutarArchivo = promisify(execFile);

/** Puerto por defecto de una impresora térmica de red. */
export const PUERTO_POR_DEFECTO = 9100;

/** Cuánto se espera a que la impresora conteste antes de darse por caída. */
export const TIEMPO_LIMITE_MS = 5000;

/** Lo que ve el cajero cuando todavía no hay impresora configurada. */
export const SIN_IMPRESORA =
  'No hay impresora térmica configurada. Abra una factura, pulse el botón Térmica y luego "Configurar impresora".';

//---------------------------------------------------------------------------
// El destino, guardado y leído
//---------------------------------------------------------------------------

/**
 * Valida un destino de impresión y lo devuelve con sus valores ya normales.
 *
 * Se valida al guardar y también al leer. Validar solo al guardar deja el
 * destino viejo de una versión anterior compatible con el formato de esta: la
 * base tiene el JSON viejo, la base no se toca al actualizar la app, y el
 * backend empieza a fallar con un error que nadie sabe explicar.
 */
export function validarDestino(valor: unknown): DestinoImpresora {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
    throw validacion('La configuración de la impresora no tiene el formato esperado');
  }
  const d = valor as Record<string, unknown>;

  switch (d.tipo) {
    case 'red': {
      const host = texto(d.host, 'La dirección de la impresora de red');
      if (host === '') {
        throw validacion('La dirección de la impresora de red está vacía');
      }
      // Un campo de formulario vacío llega como `''`, como `null` o como unos
      // espacios, no como ausente. Las tres cosas quieren decir lo mismo: "el de
      // por defecto", que es el 9100. Si no, el cajero que deje el campo en
      // blanco recibe "el puerto 0 no existe" y no entiende que lo que tiene que
      // hacer es no llenarlo.
      const puerto = numeroOPorDefecto(d.puerto, PUERTO_POR_DEFECTO, 'El puerto de la impresora');
      if (puerto < 1 || puerto > 65535) {
        throw validacion(`El puerto ${puerto} no existe: use un número entre 1 y 65535`);
      }
      return { tipo: 'red', host, puerto };
    }

    case 'usb': {
      const impresora = texto(d.impresora, 'El nombre de la impresora');
      if (impresora === '') {
        throw validacion('Elija una impresora de la lista');
      }
      return { tipo: 'usb', impresora };
    }

    case 'archivo': {
      const ruta = texto(d.ruta, 'La ruta del archivo');
      if (ruta === '') {
        throw validacion('La ruta del archivo está vacía');
      }
      return { tipo: 'archivo', ruta };
    }

    default:
      throw validacion('No se reconoce el tipo de impresora configurada');
  }
}

/** Un `string` o nada; cualquier otra cosa es un error de formato. */
function texto(valor: unknown, que: string): string {
  if (valor === undefined || valor === null) return '';
  if (typeof valor !== 'string') throw validacion(`${que} no tiene el formato esperado`);
  return valor.trim();
}

function numero(valor: unknown, que: string): number {
  const n = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw validacion(`${que} debe ser un número entero`);
  }
  return n;
}

/**
 * Un número, o el de por defecto si el campo llegó vacío.
 *
 * `Number('')` y `Number('   ')` dan 0, no `NaN`, así que un formulario con el
 * campo en blanco se convertiría en "el puerto 0" y el error que vería el cajero
 * sería el de un puerto fuera de rango, que no es lo que pasó.
 */
function numeroOPorDefecto(valor: unknown, porDefecto: number, que: string): number {
  if (valor === undefined || valor === null) return porDefecto;
  if (typeof valor === 'string' && valor.trim() === '') return porDefecto;
  return numero(valor, que);
}

/**
 * El destino configurado, o `null` si no hay ninguno.
 *
 * Un destino guardado que ya no se puede leer no se ignora en silencio: se
 * devuelve el error. Lo contrario es la peor falla posible aquí, porque el
 * cajero ve "no hay impresora configurada", entra a configurarla de nuevo, y el
 * destino roto sigue ahí esperando a que alguien lo note.
 */
export function leerDestino(db: DatabaseSync): DestinoImpresora | null {
  const crudo = leerConfig(db, IMPRESORA_TERMICA_KEY)?.trim() ?? '';
  if (crudo === '') return null;

  let valor: unknown;
  try {
    valor = JSON.parse(crudo);
  } catch {
    throw errorImpresora(
      `La configuración de la impresora está dañada y hay que volver a configurarla: "${crudo}". ` +
        'Abra una factura, pulse Térmica y luego "Configurar impresora".',
    );
  }
  return validarDestino(valor);
}

/** Guarda un destino de impresión, validado. */
export function escribirDestino(db: DatabaseSync, destino: DestinoImpresora): DestinoImpresora {
  const limpio = validarDestino(destino);
  escribirConfig(db, IMPRESORA_TERMICA_KEY, JSON.stringify(limpio));
  return limpio;
}

//---------------------------------------------------------------------------
// Los tres destinos
//---------------------------------------------------------------------------

/** Cómo se describe un destino en un mensaje para el cajero. */
export function describirDestino(destino: DestinoImpresora): string {
  switch (destino.tipo) {
    case 'red':
      return `${destino.host}:${destino.puerto} (red)`;
    case 'usb':
      return `${destino.impresora} (USB)`;
    case 'archivo':
      return destino.ruta;
  }
}

/**
 * Escribe bytes crudos a una impresora de red por el puerto 9100.
 *
 * Es un socket y ya está: no hay negotiation, no hay acuse y no hay manera de
 * saber si el papel salió. JetDirect es un tubo sin más. Se espera a que la
 * impresora acepte la conexión, se escriben los bytes y se espera a que los
 * acepte todos, y se cierra.
 *
 * El timeout no es opcional. Una impresora apagada o con el cable de red
 * desconectado no rechaza la conexión: la deja pendiente. Sin límite, el POS se
 * queda esperando con la pantalla de venta bloqueada y el cajero reiniciando la
 * computadora.
 */
function imprimirPorRed(
  host: string,
  puerto: number,
  bytes: Uint8Array,
  opciones: OpcionesRed = {},
): Promise<void> {
  const limite = opciones.limite ?? TIEMPO_LIMITE_MS;
  const conectar = opciones.conectar ?? net.createConnection;
  return new Promise((cumplir, fallar) => {
    // Un `false` en `setNoDelay` agrupa los bytes en menos paquetes. Un ticket
    // son 300-500 bytes; mandarlos en 300 paquetes por una red de tienda, que
    // puede ser wifi de un router viejo, es pedir que se corte el último.
    const socket = conectar({ host, port: puerto }, () => {
      socket.setNoDelay(false);
      socket.end(Buffer.from(bytes), () => cumplir());
    });

    let yaTermino = false;
    const terminar = (e?: Error) => {
      if (yaTermino) return;
      yaTermino = true;
      socket.destroy();
      if (e) fallar(e);
      else cumplir();
    };

    socket.setTimeout(limite, () => {
      terminar(
        errorImpresora(
          `La impresora ${host}:${puerto} no respondió en ${limite / 1000} segundos. ` +
            'Compruebe que esté encendida y conectada a la misma red que esta computadora, ' +
            'y que el puerto 9100 esté abierto en su configuración.',
        ),
      );
    });
    socket.on('error', (e: NodeJS.ErrnoException) => {
      const mensajes: Record<string, string> = {
        ECONNREFUSED: `La impresora ${host}:${puerto} rechazó la conexión.`,
        EHOSTUNREACH: `No hay ninguna impresora en ${host}.`,
        ENETUNREACH: `Esta computadora no puede llegar a la red de la impresora.`,
        ETIMEDOUT: `La impresora ${host}:${puerto} no respondió a tiempo.`,
        ENOTFOUND: `No se encontró la dirección "${host}".`,
      };
      const base = mensajes[e.code ?? ''] ?? `Falló la conexión con la impresora ${host}:${puerto}.`;
      terminar(errorImpresora(`${base} ${e.message}`));
    });
  });
}

/** Ajustes del envío por red. */
interface OpcionesRed {
  /** Cuánto esperar antes de dar la impresora por caída. */
  limite?: number;
  /**
   * La fábrica de sockets.
   *
   * Existe solo para las pruebas. El caso que hay que comprobar es el de una
   * impresora apagada detrás de un cortafuegos: la conexión no se rechaza, se
   * queda pendiente, y sin este tiempo límite el POS no vuelve nunca. No hay
   * forma de provocar eso en una máquina de desarrollo sin una red que se
   * trague los paquetes, así que la prueba inyecta un socket que no contesta y
   * dispara el temporizador a mano.
   */
  conectar?: typeof net.createConnection;
}

/**
 * El envío por red, expuesto solo para las pruebas.
 *
 * Una impresora de red es un socket que acepta bytes y no dice nada más, así
 * que un servidor de prueba en `127.0.0.1` sirve tan bien como una impresora
 * real para comprobar que los bytes llegan enteros. Exportarlo evita que
 * verificar esta fase requiera una impresora conectada a la máquina donde se
 * desarrolla, que es justo lo que hay que evitar.
 */
export const imprimirPorRedParaPruebas = imprimirPorRed;

/**
 * Manda los bytes a una cola de la impresora de Windows.
 *
 * El truco es `copy /b`: le dice a `copy` que copie un archivo binario a la
 * cola, que es un recurso de dispositivo. Sin la `b`, `copy`-traduce los
 * bytes de control a texto y los comandos ESC/POS llegarían corruptos.
 *
 * Requiere que la cola esté instalada con el controlador "Texto sin formato"
 * (Generic / Text Only). Con el controlador de Epson o el de la marca, el
 * spooler convierte el texto en una imagen y los comandos de formato y de corte
 * dejan de funcionar: el ticket sale entero en un solo cuerpo de letra. No es
 * un error que se pueda detectar desde aquí, así que se dice en el mensaje.
 */
async function imprimirPorUsb(impresora: string, bytes: Uint8Array, rutas: Rutas): Promise<void> {
  const temporal = path.join(rutas.tempDir, `tienda-ticket-${process.pid}-${Date.now()}.bin`);
  try {
    fs.writeFileSync(temporal, bytes);
    const { comando, args } = comandoSpooler(impresora, temporal);
    await ejecutarArchivo(comando, args, {
      timeout: TIEMPO_LIMITE_MS,
      windowsHide: true,
    });
  } catch (e) {
    const salida = e as { stderr?: string; message?: string };
    // 5 es "no se encontró el archivo": la cola no existe con ese nombre.
    // 1 es error genérico, casi siempre el controlador equivocado.
    throw errorImpresora(
      `No se pudo imprimir en "${impresora}". ${salida.stderr?.trim() || salida.message || ''} ` +
        'Revise que la impresora esté encendida y de que su nombre sea el exacto. ' +
        'Si la cola está instalada con el controlador de la marca en vez de "Texto sin formato", ' +
        'quite la impresora en Configuración y vuelva a instalarla con el controlador ' +
        '"Generic / Text Only" (Texto sin formato), que es el que manda los comandos de la impresora.',
    );
  } finally {
    try {
      fs.rmSync(temporal, { force: true });
    } catch {
      // Un temporal que no se pudo borrar en `%TEMP%` no vale la pena de
      // tapar el error del cajero. Windows lo limpia solo.
    }
  }
}

/**
 * El comando que manda el archivo temporal a la cola de la impresora.
 *
 * Va aparte de la llamada porque es la parte que se puede comprobar sin
 * Windows, y es la que más fácil se rompe sin que nadie se entere:
 *
 * - Sin la `/b`, `copy` traduce los bytes a texto. Los comandos ESC/POS
 *   (0x1B, 0x1D) llegarían a la impresora como caracteres de control o como
 *   signos raros, y el ticket saldría sin negritas, sin doble tamaño y sin
 *   corte: un comprobante de 42 columnas sin nada que lo separe del siguiente.
 * - Sin la `/y`, el spooler abre un diálogo pidiendo permiso para sobrescribir
 *   si el nombre de la impresora ya está en uso, y ese diálogo sale detrás de
 *   la ventana del POS, invisible.
 * - Con un solo `\\\\`, el destino sería `C:\nombre` y no la cola. La cola se
 *   llama `\\NOMBRE`, con dos barras.
 *
 * El nombre de la cola va como un argumento más y no pegado en la cadena de
 * `cmd`, porque un nombre de impresora puede traer espacios y signos: "EPSON
 * TM-T20III" es el nombre más común que hay. Con `execFile` no hay shell que
 * interprete nada, así que el nombre llega tal cual.
 */
export function comandoSpooler(
  impresora: string,
  temporal: string,
): { comando: string; args: string[] } {
  return {
    comando: 'cmd.exe',
    args: ['/c', 'copy', '/b', '/y', temporal, `\\\\${impresora}`],
  };
}

/** Escribe los bytes a un archivo, para probar sin impresora. */
function imprimirAArchivo(ruta: string, bytes: Uint8Array): void {
  const dir = path.dirname(ruta);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ruta, bytes);
  } catch (e) {
    throw errorImpresora(
      `No se pudo escribir en ${ruta}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

//---------------------------------------------------------------------------
// Imprimir
//---------------------------------------------------------------------------

/**
 * Imprime un ticket ya generado.
 *
 * El orden de los pasos importa: primero se valida el destino y se generan los
 * bytes, y solo después se intenta el envío. Un destino mal configurado tiene
 * que fallar sin haber mandando medio ticket, que en una impresora de ancho
 * fijo sale como la mitad superior de un comprobante cortado por la mitad.
 */
export async function imprimir(
  db: DatabaseSync,
  bytes: Uint8Array,
  rutas: Rutas = RUTAS,
): Promise<void> {
  const destino = leerDestino(db);
  if (destino === null) {
    // Código aparte del de fallo de impresión para que la interfaz pueda abrir
    // el modal de configuración sola, sin que el cajero tenga que saber que
    // "no hay impresora" y "la impresora falló" son cosas distintas.
    throw impresoraNoConfigurada(SIN_IMPRESORA);
  }
  if (bytes.length === 0) {
    throw validacion('El ticket está vacío: no hay nada que imprimir');
  }

  switch (destino.tipo) {
    case 'red':
      await imprimirPorRed(destino.host, destino.puerto, bytes);
      return;
    case 'usb':
      await imprimirPorUsb(destino.impresora, bytes, rutas);
      return;
    case 'archivo':
      imprimirAArchivo(destino.ruta, bytes);
      return;
  }
}

/**
 * Imprime el ticket de prueba del destino configurado.
 *
 * Sale del mismo camino que una factura, con el mismo tipo de letra y el mismo
 * corte, porque de nada sirve una prueba que no exercise lo que después va a
 * fallar.
 */
export async function probar(db: DatabaseSync, rutas: Rutas = RUTAS): Promise<void> {
  // No hace falta leer el destino aquí: `imprimir` lo lee y falla con el mismo
  // error de "no hay impresora configurada" si no hay. Releerlo solo para
  // guardarlo en una variable sin usarlo sería ruido.
  const nombre = leerConfig(db, NEGOCIO_CONFIG_KEYS.nombre)?.trim() || 'TIENDA';
  await imprimir(db, ticketPrueba(nombre.toUpperCase()), rutas);
}

//---------------------------------------------------------------------------
// Listar impresoras
//---------------------------------------------------------------------------

/**
 * Las impresoras que Windows tiene instaladas, con un `*` detrás de las que no
 * pueden recibir bytes crudos.
 *
 * No se filtran las que no sirven: se marcan. Una impresora de PDF está
 * instalada en cualquier computadora, y el cajero tiene derecho a verla en la
 * lista aunque no sirva para el ticket. Lo que cambia es que el `*` le dice por
 * qué esa no va a funcionar, en vez de que la busque dos veces en la lista de
 * dispositivos y la pruebe tres veces antes de descubrir que es de PDF.
 *
 * En Windows hay dos maneras de preguntar, y hace falta las dos: `Get-Printer`
 * es de Windows 10 en adelante y da los nombres exactos con su controlador, y
 * `wmic` está en todas pero avisa que se va. Si `Get-Printer` no está (o no está
 * el módulo PrintManagement) se cae a `wmic`, y si tampoco, se devuelve una
 * lista vacía en vez de un error: el modal de configuración tiene un campo de
 * texto donde escribir el nombre a mano, y eso cubre el caso de que el proceso
 * no pueda preguntar.
 */
export async function listarImpresoras(): Promise<string[]> {
  const vistas = await listarVistas();
  if (vistas.length === 0) return [];
  return vistas.map((v) => (v.texto ? `${v.nombre} *` : v.nombre));
}

interface ImpresoraVista {
  nombre: string;
  /** Si el nombre viene marcado como "no apto para texto sin formato". */
  texto: boolean;
}

async function listarVistas(): Promise<ImpresoraVista[]> {
  const conGetPrinter = await porGetPrinter();
  if (conGetPrinter !== null) return conGetPrinter;
  return porWmic();
}

async function porGetPrinter(): Promise<ImpresoraVista[] | null> {
  try {
    const { stdout } = await ejecutarArchivo(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-Printer | Select-Object Name, DriverName | ConvertTo-Json -Compress',
      ],
      { timeout: TIEMPO_LIMITE_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
    );
    const salida = stdout.trim();
    if (salida === '') return [];

    // `ConvertTo-Json` devuelve un objeto suelto si hay una sola impresora y una
    // lista si hay varias. Esa diferencia hay que normalizarla, y es la razón
    // de no usar el JSON a pelo.
    const datos: unknown = JSON.parse(salida);
    const filas = (Array.isArray(datos) ? datos : [datos]) as { Name?: string; DriverName?: string }[];

    return filas
      .filter((f): f is { Name: string; DriverName: string } => typeof f.Name === 'string' && f.Name !== '')
      .map((f) => ({ nombre: f.Name, texto: esControladorDeTexto(f.DriverName ?? '') }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  } catch {
    return null;
  }
}

async function porWmic(): Promise<ImpresoraVista[]> {
  try {
    const { stdout } = await ejecutarArchivo(
      'wmic',
      ['printer', 'get', 'Name,DriverName', '/format:csv'],
      { timeout: TIEMPO_LIMITE_MS, windowsHide: true },
    );
    const lineas = stdout.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lineas.length < 2) return [];
    const cabecera = lineas[0]!.split(',').map((c) => c.trim());
    const iNombre = cabecera.indexOf('Name');
    const iDriver = cabecera.indexOf('DriverName');
    if (iNombre < 0) return [];

    return lineas
      .slice(1)
      .map((l) => l.split(',').map((c) => c.trim()))
      .filter((c) => (c[iNombre] ?? '') !== '')
      .map((c) => ({
        nombre: c[iNombre]!,
        texto: esControladorDeTexto(iDriver >= 0 ? (c[iDriver] ?? '') : ''),
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  } catch {
    return [];
  }
}

/**
 * Si el nombre del controlador corresponde a una impresora de texto sin
 * formato, que es la única que manda los bytes ESC/POS tal cual.
 *
 * Windows nombra ese controlador "Microsoft XPS Document Writer" para PDF y
 * "Generic / Text Only" para texto, pero en español sale como "Generic / Text
 * Only" o como "Texto sin formato", y hay variantes regionalizadas. Se
 * comprueba por palabras en vez de por igualdad exacta, que es lo único que
 * sobrevive a las diferencias de idioma del Windows donde se configuró.
 */
function esControladorDeTexto(driver: string): boolean {
  const d = driver.toLowerCase();
  if (d === '') return true; // sin nombre de controlador: no se puede juzgar
  if (d.includes('text only') || d.includes('texto sin formato')) return true;
  return false;
}
