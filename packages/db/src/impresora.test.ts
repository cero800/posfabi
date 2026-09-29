import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { IMPRESORA_TERMICA_KEY, type DestinoImpresora } from '@tienda/core';

import {
  comandoSpooler,
  describirDestino,
  escribirDestino,
  imprimir,
  imprimirPorRedParaPruebas,
  listarImpresoras,
  leerDestino,
  probar,
  PUERTO_POR_DEFECTO,
  SIN_IMPRESORA,
  validarDestino,
} from './impresora.js';
import { CODIGO_ERROR } from './errors.js';
import { leerConfig } from './config.js';
import { NEGOCIO_CONFIG_KEYS } from '@tienda/core';
import { bd, mkdirsTmp, rutasTemporales, escribirConfig } from './testutil.js';
import type { Rutas } from './paths.js';
import { ticketFactura } from './ticket.js';

//---------------------------------------------------------------------------
// Andamiaje
//---------------------------------------------------------------------------

const limpios: string[] = [];

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

/** Bytes de un ticket cualquiera, para probar el envío. */
const TICKET = Uint8Array.from([0x1b, 0x40, 0x48, 0x4f, 0x4c, 0x41, 0x0a]);

/** El `codigo` del error, para no comparar mensajes en español. */
function codigoDe(e: unknown): string | undefined {
  return (e as { codigo?: string } | null)?.codigo;
}

/** Los archivos de una carpeta, ordenados, para comparar antes y después. */
function listarArchivos(carpeta: string): string[] {
  return fs.readdirSync(carpeta).sort();
}

//---------------------------------------------------------------------------
// Validar el destino
//---------------------------------------------------------------------------

describe('validarDestino', () => {
  it('acepta los tres tipos con sus valores', () => {
    expect(validarDestino({ tipo: 'red', host: '192.168.1.50', puerto: 9100 })).toEqual({
      tipo: 'red',
      host: '192.168.1.50',
      puerto: 9100,
    });
    expect(validarDestino({ tipo: 'usb', impresora: 'EPSON TM-T20' })).toEqual({
      tipo: 'usb',
      impresora: 'EPSON TM-T20',
    });
    expect(validarDestino({ tipo: 'archivo', ruta: 'C:\\pruebas\\t.bin' })).toEqual({
      tipo: 'archivo',
      ruta: 'C:\\pruebas\\t.bin',
    });
  });

  it('pone el puerto 9100 si no viene, que es el de casi todas', () => {
    // La impresora térmica de red habla JetDirect en el 9100. Pedirle el puerto
    // al cajero cuando ya se sabe cuál es solo suma un campo que se llena mal.
    expect(validarDestino({ tipo: 'red', host: '192.168.1.50' })).toEqual({
      tipo: 'red',
      host: '192.168.1.50',
      puerto: PUERTO_POR_DEFECTO,
    });
  });

  it('acepta el puerto como texto, porque llega de un campo de formulario', () => {
    expect(validarDestino({ tipo: 'red', host: 'x', puerto: '9100' })).toMatchObject({ puerto: 9100 });
  });

  it('un campo de puerto vacío toma el de por defecto, no el cero', () => {
    // Un formulario manda `''` o `null` cuando el campo está en blanco, y
    // ninguna de las dos cosas es "el puerto 0". Si no se trataran como
    // ausentes, el cajero que deje el campo vacío recibiría "el puerto 0 no
    // existe" y no entendería que lo que tiene que hacer es no llenarlo.
    for (const vacio of ['', null, undefined, '   ']) {
      expect(validarDestino({ tipo: 'red', host: 'x', puerto: vacio }), String(vacio)).toMatchObject({
        puerto: PUERTO_POR_DEFECTO,
      });
    }
  });

  it('recorta los espacios que uno pega al copiar la dirección', () => {
    expect(validarDestino({ tipo: 'red', host: '  192.168.1.50  ', puerto: 9100 })).toMatchObject({
      host: '192.168.1.50',
    });
  });

  it('rechaza un tipo que no conoce, en vez de adivinar', () => {
    // `/dev/usb/lp0` viene del backend viejo. Si se aceptara cualquier cosa, el
    // POS intentaría escribir a un archivo llamado así en Windows y el error
    // que vería el cajero no diría nada de la impresora.
    expect(() => validarDestino({ tipo: 'cualquiera' })).toThrowError(/No se reconoce el tipo/);
    expect(() => validarDestino({ tipo: '/dev/usb/lp0' })).toThrowError(/No se reconoce el tipo/);
  });

  it('rechaza un destino que no es un objeto', () => {
    for (const malo of [null, 'texto', 42, undefined, []]) {
      expect(() => validarDestino(malo)).toThrowError(/no tiene el formato esperado/);
    }
  });

  it('rechaza los campos vacíos, con un mensaje que diga cuál falta', () => {
    // "La dirección está vacía" y "Elija una impresora" son dos problemas
    // distintos para el cajero, y un mensaje genérico lo deja probando al azar.
    expect(() => validarDestino({ tipo: 'red', host: '   ' })).toThrowError(/dirección.*vacía/);
    expect(() => validarDestino({ tipo: 'usb', impresora: '' })).toThrowError(/Elija una impresora/);
    expect(() => validarDestino({ tipo: 'archivo', ruta: '  ' })).toThrowError(/ruta.*vacía/);
  });

  it('rechaza un puerto que no es un número entero', () => {
    for (const malo of ['abc', 1.5, Number.NaN, -9100]) {
      expect(() => validarDestino({ tipo: 'red', host: 'x', puerto: malo })).toThrowError();
    }
  });

  it('rechaza un puerto fuera del rango, que no es un puerto', () => {
    expect(() => validarDestino({ tipo: 'red', host: 'x', puerto: 0 })).toThrowError(/entre 1 y 65535/);
    expect(() => validarDestino({ tipo: 'red', host: 'x', puerto: 70000 })).toThrowError(/entre 1 y 65535/);
  });

  it('rechaza un campo que llega con el tipo equivocado', () => {
    expect(() => validarDestino({ tipo: 'red', host: 12345 })).toThrowError(/dirección.*formato/);
    expect(() => validarDestino({ tipo: 'usb', impresora: ['EPSON'] })).toThrowError(/nombre.*formato/);
  });
});

//---------------------------------------------------------------------------
// Guardar y leer
//---------------------------------------------------------------------------

describe('leerDestino', () => {
  it('devuelve null cuando no hay nada configurado', () => {
    expect(leerDestino(bdEnRutas(rutasLimpias()))).toBeNull();
  });

  it('guarda y relee el mismo destino', () => {
    const db = bdEnRutas(rutasLimpias());
    const destino: DestinoImpresora = { tipo: 'red', host: '192.168.1.50', puerto: 9100 };

    escribirDestino(db, destino);
    expect(leerDestino(db)).toEqual(destino);
  });

  it('guarda en JSON, no en una cadena suelta', () => {
    // La ventaja del JSON tipado es que `listar_impresoras` puede ofrecer
    // "la cola se llama X" sin que el backend adivine si eso es un host o un
    // nombre de cola. Una cadena no lleva esa información.
    const db = bdEnRutas(rutasLimpias());
    escribirDestino(db, { tipo: 'usb', impresora: 'EPSON TM-T20' });

    expect(leerConfig(db, IMPRESORA_TERMICA_KEY)).toBe('{"tipo":"usb","impresora":"EPSON TM-T20"}');
  });

  it('no guarda un destino inválido, aunque se le saltee el tipo', () => {
    // `escribirDestino` valida antes de escribir, no confía en que el objeto
    // venga bien formado. Si un comando futuro lo llama con algo mal, la base no
    // queda con una configuración que después no se pueda leer.
    const db = bdEnRutas(rutasLimpias());
    expect(() =>
      escribirDestino(db, { tipo: 'usb', impresora: '' } as unknown as DestinoImpresora),
    ).toThrowError();
    expect(leerConfig(db, IMPRESORA_TERMICA_KEY)).toBeNull();
  });

  it('una configuración dañada da un error que dice que hay que reconfigurar', () => {
    // Si en vez de fallar devolviera null, el cajero vería "no hay impresora
    // configurada", entraría a configurarla, y el texto roto seguiría ahí. El
    // mensaje dice explícitamente que abra el modal otra vez.
    const db = bdEnRutas(rutasLimpias());
    escribirConfig(db, IMPRESORA_TERMICA_KEY, '{esto no es json');

    try {
      leerDestino(db);
      throw new Error('se esperaba un error');
    } catch (e) {
      expect(codigoDe(e)).toBe(CODIGO_ERROR.impresora);
      expect((e as Error).message).toMatch(/volver a configurarla/);
    }
  });

  it('un destino guardado de una versión vieja tampoco se ignora en silencio', () => {
    // El JSON puede estar bien formado y aun así no ser de esta versión. Es el
    // mismo caso que el de arriba: si no se falla aquí, el error aparece después
    // en mitad de una venta.
    const db = bdEnRutas(rutasLimpias());
    escribirConfig(db, IMPRESORA_TERMICA_KEY, '{"tipo":"usb","impresora":"X","extra":1}');

    // Este sí es válido: los campos de más se ignoran, para que una versión
    // nueva que agregue un campo no rompa la configuración de la anterior.
    expect(leerDestino(db)).toEqual({ tipo: 'usb', impresora: 'X' });
  });
});

//---------------------------------------------------------------------------
// Imprimir a archivo: el único destino que se puede probar sin hardware
//---------------------------------------------------------------------------

describe('imprimir · destino de archivo', () => {
  it('escribe los bytes tal cual, sin añadirlos ni quitarles', () => {
    const rutas = rutasLimpias();
    const destino = path.join(rutas.documentDir, 'tickets', 'factura.bin');
    const db = bdEnRutas(rutas);
    escribirDestino(db, { tipo: 'archivo', ruta: destino });

    return imprimir(db, TICKET, rutas).then(() => {
      expect(Array.from(fs.readFileSync(destino))).toEqual(Array.from(TICKET));
    });
  });

  it('crea las carpetas intermedias', () => {
    const rutas = rutasLimpias();
    const destino = path.join(rutas.documentDir, 'a', 'b', 'c', 'factura.bin');
    const db = bdEnRutas(rutas);
    escribirDestino(db, { tipo: 'archivo', ruta: destino });

    return imprimir(db, TICKET, rutas).then(() => {
      expect(fs.existsSync(destino)).toBe(true);
    });
  });

  it('un ticket de una factura real sale entero y con sus comandos', () => {
    // El destino de archivo sirve para esto: comprobar el ticket sin tener la
    // impresora comprada. Si el archivo sale con los bytes ESC/POS al principio y
    // el corte al final, el generador está bien.
    const rutas = rutasLimpias();
    const destino = path.join(rutas.documentDir, 'factura.bin');
    const db = bdEnRutas(rutas);
    escribirDestino(db, { tipo: 'archivo', ruta: destino });

    return imprimir(db, ticketFactura(facturaDePrueba()), rutas).then(() => {
      const b = fs.readFileSync(destino);
      expect(Array.from(b.slice(0, 2))).toEqual([0x1b, 0x40]);
      expect(Array.from(b.slice(-3))).toEqual([0x1d, 0x56, 0x00]);
      expect(b.length).toBeGreaterThan(100);
    });
  });

  it('sobrescribe el archivo anterior, sin dejar restos del ticket viejo', () => {
    // Si el ticket nuevo fuera más corto y se abriera en modo "añadir al final",
    // el archivo tendría el corte de papel en medio y medio ticket abajo. Un
    // archivo de ticket con dos facturas no lo sabe leer nadie.
    const rutas = rutasLimpias();
    const destino = path.join(rutas.documentDir, 'factura.bin');
    const db = bdEnRutas(rutas);
    escribirDestino(db, { tipo: 'archivo', ruta: destino });

    return imprimir(db, Uint8Array.from([0x41, 0x42, 0x43, 0x44]), rutas)
      .then(() => imprimir(db, TICKET, rutas))
      .then(() => {
        expect(Array.from(fs.readFileSync(destino))).toEqual(Array.from(TICKET));
      });
  });

  it('una ruta que no se puede escribir lo dice con su código de sistema', async () => {
    const rutas = rutasLimpias();
    // `documentDir` es un archivo, no una carpeta: crear `tickets` debajo falla.
    fs.rmSync(rutas.documentDir, { recursive: true, force: true });
    fs.writeFileSync(rutas.documentDir, 'estoyocupandoelpuesto');
    const db = bdEnRutas(rutas);
    escribirDestino(db, { tipo: 'archivo', ruta: path.join(rutas.documentDir, 't', 'x.bin') });

    await expect(imprimir(db, TICKET, rutas)).rejects.toMatchObject({
      codigo: CODIGO_ERROR.impresora,
      message: expect.stringMatching(/No se pudo escribir/),
    });
  });
});

//---------------------------------------------------------------------------
// Imprimir a red, contra un socket de verdad
//---------------------------------------------------------------------------

describe('imprimir · destino de red', () => {
  it('manda los bytes al socket y cierra', async () => {
    // Un servidor de prueba es lo único que se parece a una impresora sin
    // tener una. La impresora de red es un tubo sin más: no hay acuse ni
    // negociación, así que escuchar y recibir dice todo.
    const { puerto, bytes, recibidos, cerrar } = await levantarServidor();
    await imprimirPorRedParaPruebas('127.0.0.1', puerto, TICKET);
    await recibidos();

    expect(bytes).toEqual(Array.from(TICKET));
    cerrar();
  });

  it('espera a que se/envíen todos los bytes, no solo a escribirlos', async () => {
    // `socket.write` devuelve en cuanto copia al búfer del kernel, no cuando
    // llega. Un ticket grande a una impresora lenta por wifi se perdería por el
    // camino si se cerrara en `write` sin esperar al `end`.
    const grande = new Uint8Array(40_000).fill(0x41);
    const { puerto, bytes, recibidos, cerrar } = await levantarServidor();
    await imprimirPorRedParaPruebas('127.0.0.1', puerto, grande);
    await recibidos(40_000);

    expect(bytes).toHaveLength(40_000);
    cerrar();
  });

  it('falla si no hay nada escuchando en ese puerto', async () => {
    // El caso real: la impresora está apagada. El mensaje tiene que decir que
    // revise que esté encendida, no "ECONNREFUSED".
    const puerto = await puertoLibre();
    await expect(imprimirPorRedParaPruebas('127.0.0.1', puerto, TICKET)).rejects.toMatchObject({
      codigo: CODIGO_ERROR.impresora,
      message: expect.stringMatching(/encendida|rechazó/),
    });
  });

  it('falla si el host no existe, diciendo cuál dirección no encontró', async () => {
    // Una dirección mal escrita es el error de configuración más probable, y el
    // mensaje tiene que repetir la dirección: el cajero la está copiando de la
    // etiqueta de la impresora y necesita ver cuál escribió.
    const puerto = await puertoLibre();
    await expect(
      imprimirPorRedParaPruebas('impresora-que-no-existe.local', puerto, TICKET),
    ).rejects.toMatchObject({
      codigo: CODIGO_ERROR.impresora,
      message: expect.stringContaining('impresora-que-no-existe.local'),
    });
  });

  it('da por caída una impresora que no contesta, sin colgar el POS', async () => {
    // La impresora apagada detrás de un cortafuegos no rechaza la conexión: la
    // deja pendiente, y sin un tiempo límite el `await` no vuelve nunca y el
    // cajero reinicia la computadora con un cliente esperando.
    //
    // No hay forma de provocar eso en local sin una red que se trague los
    // paquetes, así que la prueba mete un socket que nunca termina de conectar
    // y dispara su propio temporizador, que es exactamente lo que hace el
    // kernel cuando la impresora no responde.
    const { conectar, dispararTemporizador } = socketQueNoContesta();
    const impresion = imprimirPorRedParaPruebas('192.168.1.50', 9100, TICKET, { conectar });
    dispararTemporizador();

    await expect(impresion).rejects.toMatchObject({
      codigo: CODIGO_ERROR.impresora,
      message: expect.stringMatching(/no respondió en 5 segundos/),
    });
  });

  it('el mensaje del timeout dice qué revisar, no solo que falló', async () => {
    // Lo lee el cajero de pie en el mostrador. "Timeout" no le dice nada;
    // "compruebe que esté encendida y en la misma red" sí.
    const { conectar, dispararTemporizador } = socketQueNoContesta();
    const impresion = imprimirPorRedParaPruebas('192.168.1.50', 9100, TICKET, { conectar });
    dispararTemporizador();

    await expect(impresion).rejects.toThrow(
      /192\.168\.1\.50:9100 no respondió[\s\S]*encendida[\s\S]*9100/,
    );
  });
});

//---------------------------------------------------------------------------
// Cuando no hay impresora
//---------------------------------------------------------------------------

describe('imprimir sin impresora configurada', () => {
  it('falla con un código que la interfaz reconoce como "no configurada"', async () => {
    // El código aparte es lo que permite que la pantalla abra el modal de
    // configuración sola, sin preguntarle al cajero qué hacer.
    const rutas = rutasLimpias();
    await expect(imprimir(bdEnRutas(rutas), TICKET, rutas)).rejects.toMatchObject({
      codigo: CODIGO_ERROR.impresora_no_configurada,
      message: SIN_IMPRESORA,
    });
    expect(SIN_IMPRESORA).toMatch(/Configurar impresora/);
  });

  it('no escribe nada en el disco, ni medio ticket a una impresora que no hay', async () => {
    // El destino se valida antes de generar o enviar. Un destino ausente tiene
    // que fallar sin haber tocado el disco: si la validación se hiciera después
    // del envío, quedaría medio comprobante escrito en el archivo de prueba.
    const rutas = rutasLimpias();
    const antes = listarArchivos(rutas.documentDir);

    await expect(imprimir(bdEnRutas(rutas), TICKET, rutas)).rejects.toThrow();

    expect(listarArchivos(rutas.documentDir)).toEqual(antes);
  });

  it('rechaza un ticket vacío en vez de mandar cero bytes', async () => {
    const rutas = rutasLimpias();
    const destino = path.join(rutas.documentDir, 'x.bin');
    const db = bdEnRutas(rutas);
    escribirDestino(db, { tipo: 'archivo', ruta: destino });

    await expect(imprimir(db, new Uint8Array(0), rutas)).rejects.toMatchObject({
      codigo: CODIGO_ERROR.validacion,
    });
    // Cero bytes sí se pueden mandar a un socket sin que pase nada, así que
    // aquí también se comprueba que no se creó el archivo: el cajero pulsó
    // imprimir y no imprimió, y un archivo vacío no explica por qué.
    expect(fs.existsSync(destino)).toBe(false);
  });
});

//---------------------------------------------------------------------------
// Destino de USB: el comando, que se puede comprobar sin Windows
//---------------------------------------------------------------------------

describe('comandoSpooler', () => {
  it('usa copy con /b, que es lo que manda los bytes sin traducirlos', () => {
    // Sin la `/b`, `copy` traduce los bytes a texto y los comandos ESC/POS
    // (0x1B, 0x1D) llegan a la impresora como caracteres raros: el ticket sale
    // sin negritas, sin doble tamaño y sin corte, y todo pegado al
    // siguiente. Nada en la pantalla avisa de que pasó.
    const { args } = comandoSpooler('EPSON TM-T20', 'C:\\Temp\\t.bin');
    expect(args).toContain('/b');
  });

  it('va por la cola, con dos barras, no por un archivo de C:', () => {
    // `\\NOMBRE` es la cola. `\NOMBRE` sería un archivo en la raíz del disco, y
    // el ticket se escribiría ahí sin llegar a la impresora.
    const { args } = comandoSpooler('EPSON TM-T20', 'C:\\Temp\\t.bin');
    expect(args.at(-1)).toBe('\\\\EPSON TM-T20');
  });

  it('lleva /y, para que el spooler no abra un diálogo de sobrescribir', () => {
    // El diálogo sale detrás de la ventana del POS, invisible, y el POS espera
    // a que alguien lo cierre sin saber que lo está esperando.
    expect(comandoSpooler('X', 'C:\\Temp\\t.bin').args).toContain('/y');
  });

  it('manda el nombre de la cola con espacios sin romperse', () => {
    // `execFile` no pasa por un shell, así que el nombre llega tal cual. Con un
    // shell habría que entrecomillarlo, y ese es el tipo de cosa que se rompe
    // al cambiar de enfoque.
    const { args } = comandoSpooler('EPSON TM-T20III (Redirigida a LPT1:)', 'C:\\Temp\\t.bin');
    expect(args.at(-1)).toBe('\\\\EPSON TM-T20III (Redirigida a LPT1:)');
  });

  it('el temporal va como argumento, no pegado en la cadena', () => {
    const { args } = comandoSpooler('X', 'C:\\Users\\Vendedor\\AppData\\Local\\Temp\\t 1.bin');
    expect(args).toContain('C:\\Users\\Vendedor\\AppData\\Local\\Temp\\t 1.bin');
  });
});

//---------------------------------------------------------------------------
// Probar
//---------------------------------------------------------------------------

describe('probar', () => {
  it('sale por el mismo camino que una factura, con el nombre del negocio', () => {
    // La prueba tiene que pasar por lo mismo que después va a fallar: mismo
    // generador, mismos comandos, mismo destino. Una prueba que solo mande un
    // "Hola" no dice si el corte del papel funciona.
    const rutas = rutasLimpias();
    const destino = path.join(rutas.documentDir, 'prueba.bin');
    const db = bdEnRutas(rutas);
    escribirConfig(db, NEGOCIO_CONFIG_KEYS.nombre, 'Papelería El Lápiz');
    escribirDestino(db, { tipo: 'archivo', ruta: destino });

    return probar(db, rutas).then(() => {
      const b = fs.readFileSync(destino);
      expect(Array.from(b.slice(0, 2))).toEqual([0x1b, 0x40]);
      expect(Array.from(b.slice(-3))).toEqual([0x1d, 0x56, 0x00]);
      expect(b.toString('latin1')).toContain('PAPELERIA EL LAPIZ');
    });
  });

  it('usa un nombre genérico si el negocio todavía no está configurado', () => {
    // La prueba se puede pulsar antes de haber configurado nada, y tiene que
    // salir en vez de decir "undefined" en el encabezado.
    const rutas = rutasLimpias();
    const destino = path.join(rutas.documentDir, 'prueba.bin');
    const db = bdEnRutas(rutas);
    escribirDestino(db, { tipo: 'archivo', ruta: destino });

    return probar(db, rutas).then(() => {
      expect(fs.readFileSync(destino).toString('latin1')).toContain('TIENDA');
    });
  });
});

//---------------------------------------------------------------------------
// Describir el destino
//---------------------------------------------------------------------------

describe('describirDestino', () => {
  it('cada destino se describe como lo que es', () => {
    // El texto va en el modal de configuración, para que el cajero sepa qué
    // tiene configurado sin abrir el JSON.
    expect(describirDestino({ tipo: 'red', host: '192.168.1.50', puerto: 9100 })).toBe(
      '192.168.1.50:9100 (red)',
    );
    expect(describirDestino({ tipo: 'usb', impresora: 'EPSON TM-T20' })).toBe('EPSON TM-T20 (USB)');
    expect(describirDestino({ tipo: 'archivo', ruta: 'C:\\t.bin' })).toBe('C:\\t.bin');
  });
});

//---------------------------------------------------------------------------
// Listar impresoras
//---------------------------------------------------------------------------

describe('listarImpresoras', () => {
  it('devuelve una lista, vacía si el sistema no deja preguntar', () => {
    // En Windows casi siempre hay `Get-Printer`, pero en una máquina bloqueada
    // o con el spooler parado no. Devolver [] es mejor que lanzar: el modal
    // tiene un campo de texto para escribir el nombre a mano, y eso cubre el
    // caso. Un error aquí dejaría al cajero sin poder configurar nada.
    return listarImpresoras().then((lista) => {
      expect(Array.isArray(lista)).toBe(true);
    });
  });
});

//---------------------------------------------------------------------------
// Utilidades de las pruebas
//---------------------------------------------------------------------------

/**
 * Base en memoria con el esquema.
 *
 * Las rutas no se pasan a la base: solo las usan los destinos de archivo y de
 * USB, que son los que reciben `rutas` por parámetro. Así el resto de las
 * pruebas no necesita crear carpetas en el disco.
 */
function bdEnRutas(_rutas: Rutas): DatabaseSync {
  return bd();
}

function facturaDePrueba() {
  return {
    negocio_nombre: 'Papelería El Lápiz',
    negocio_rif: 'J-40123456-7',
    negocio_telefono: '',
    negocio_direccion: '',
    numero_factura: 1,
    fecha: '2026-09-05 10:00:00',
    cliente: 'Cliente',
    cliente_documento: 'V-12345678',
    subtotal: 500,
    descuento: 0,
    total: 500,
    tasa_cambio: 36.85,
    detalle: [{ producto: 'Cuaderno', cantidad: 1, subtotal: 500 }],
    pagos: [{ tipo_pago: 'efectivo', moneda: 'usd', monto: 500, numero_referencia: null }],
    devoluciones: [],
    recordatorio: null,
  };
}

/**
 * Un socket que hace de impresora y acumula lo que recibe.
 *
 * `recibidos(cuantos)` devuelve una promesa que espera a que lleguen `cuantos`
 * bytes. Hace falta porque el `end` del cliente se dispara cuando el kernel
 * local devuelve los bytes, no cuando el otro lado los leyó: sin esta espera la
 * prueba miraría un arreglo vacío y fallaría sin que haya ningún error de por
 * medio.
 */
interface ImpresoraFalsa {
  puerto: number;
  recibidos: (cuantos?: number) => Promise<void>;
  bytes: number[];
  cerrar: () => void;
}

function levantarServidor(): Promise<ImpresoraFalsa> {
  return new Promise((cumplir, fallar) => {
    const estado: ImpresoraFalsa = {
      puerto: 0,
      bytes: [],
      recibidos: () => Promise.resolve(),
      cerrar: () => servidor.close(),
    };
    const esperas: { cuantos: number; cumplir: () => void }[] = [];

    const servidor = net.createServer((s) => {
      s.on('data', (d) => {
        estado.bytes.push(...d);
        for (const espera of [...esperas]) {
          if (estado.bytes.length >= espera.cuantos) {
            esperas.splice(esperas.indexOf(espera), 1);
            espera.cumplir();
          }
        }
      });
      s.on('error', () => undefined);
    });

    estado.recibidos = (cuantos = 1) =>
      new Promise((hecho) => {
        if (estado.bytes.length >= cuantos) {
          hecho();
          return;
        }
        esperas.push({ cuantos, cumplir: hecho });
      });

    servidor.on('error', fallar);
    servidor.listen(0, '127.0.0.1', () => {
      estado.puerto = (servidor.address() as net.AddressInfo).port;
      estado.cerrar = () => {
        servidor.close();
      };
      cumplir(estado);
    });
  });
}

/** Un puerto que está libre ahora mismo, para probar conexiones rechazadas. */
function puertoLibre(): Promise<number> {
  return new Promise((cumplir, fallar) => {
    const servidor = net.createServer();
    servidor.on('error', fallar);
    servidor.listen(0, '127.0.0.1', () => {
      const puerto = (servidor.address() as net.AddressInfo).port;
      servidor.close(() => cumplir(puerto));
    });
  });
}

/**
 * Una fábrica de sockets que nunca termina de conectar, con su temporizador a
 * mano.
 *
 * Es lo que hace el kernel con una impresora apagada detrás de un cortafuegos:
 * la conexión se queda pendiente hasta que expira el tiempo límite. Con un
 * servidor local de prueba no se puede provocar, porque el kernel acepta la
 * conexión en cola antes de que llegue el primer paquete.
 */
function socketQueNoContesta(): { conectar: typeof net.createConnection; dispararTemporizador: () => void } {
  let temporizador: (() => void) | null = null;
  let destruido = false;

  const socket = {
    setNoDelay: () => undefined,
    setTimeout: (_ms: number, cb: () => void) => {
      temporizador = cb;
    },
    on: () => undefined,
    end: () => undefined,
    destroy: () => {
      destruido = true;
    },
    get destruido() {
      return destruido;
    },
  };

  return {
    conectar: (() => socket) as unknown as typeof net.createConnection,
    dispararTemporizador: () => temporizador?.(),
  };
}
