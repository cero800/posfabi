// El ticket térmico de una factura, en bytes ESC/POS.
//
// Es una función pura: recibe la factura y devuelve bytes. No abre la base, no
// habla con la impresora, no lee configuración. Todo eso vive en
// `impresora.ts`, que recibe estos mismos bytes y los manda a donde toque. La
// separación no es purismo: los bytes son la parte difícil de acertar y se
// pueden probar sin una impresora en la mesa, que es la diferencia entre
// arreglar un error en un segundo y hacerlo con el cajero esperando.
//
// ## Las columnas
//
// Un ticket de 80 mm imprime 42 caracteres con la fuente normal de una
// impresora térmica de papel continuo. Cada línea del papel es `ANCHO`
// columnas exactas, y ese es el número del que sale toda la maquetación.
//
// ## Los acentos
//
// El original escribía los bytes en UTF-8 y no decía nada del juego de
// caracteres, así que dependía del que trajera la impresora de fábrica. Casi
// todas las térmicas económicas vienen en PC437, donde la `ñ`, la `á` y la `é`
// no existen: una tienda llamada "Papelería El Lápiz" salía como un renglón de
// signos raros en cada ticket, y nadie se lo decía.
//
// Aquí no se intenta hablar el idioma de la impresora. Todo se lleva a ASCII
// antes de codificar, y cada carácter se cambia por exactamente uno solo, de
// modo que la cuenta de columnas sigue dando lo mismo. "Papelería El Lápiz"
// sale como "Papeleria El Lapiz", que se lee igual de bien. Es la solución que
// funciona en cualquier impresora de cualquier marca, sin tabla de
// caracteres que mantener ni.code page que negociar.

import type {
  TicketDevolucion,
  TicketInput,
  TicketLinea,
  TicketPago,
} from '@tienda/core';

/** Columnas de un ticket de 80 mm con fuente normal. */
export const ANCHO = 42;

const ESC = 0x1b;
const GS = 0x1d;

/**
 * Unicode → ASCII, un carácter por carácter.
 *
 * La regla de una a una es lo que hace que esto sea seguro: si un acento
 * ocupara dos columnas, los centrados y las columnas de la derecha se irían un
 * espacio y las columnas de dinero dejarían de cuadrar. Por eso las comillas
 * tipográficas se cambian por comillas rectas y no se estiran, y los puntos
 * suspensivos se cambian por uno solo y no por tres.
 */
const SIN_TILDES: Record<string, string> = {
  á: 'a', à: 'a', ä: 'a', â: 'a', ã: 'a', å: 'a', ā: 'a',
  é: 'e', è: 'e', ë: 'e', ê: 'e', ē: 'e',
  í: 'i', ì: 'i', ï: 'i', î: 'i',
  ó: 'o', ò: 'o', ö: 'o', ô: 'o', õ: 'o', ō: 'o',
  ú: 'u', ù: 'u', ü: 'u', û: 'u',
  ñ: 'n', ń: 'n',
  ç: 'c', ć: 'c',
  ý: 'y', ÿ: 'y',
  Á: 'A', À: 'A', Ä: 'A', Â: 'A', Ā: 'A',
  É: 'E', È: 'E', Ë: 'E', Ê: 'E', Ē: 'E',
  Í: 'I', Ì: 'I', Ï: 'I', Î: 'I',
  Ó: 'O', Ò: 'O', Ö: 'O', Ô: 'O', Õ: 'O', Ō: 'O',
  Ú: 'U', Ù: 'U', Ü: 'U', Û: 'U',
  Ñ: 'N', Ń: 'N',
  Ç: 'C', Ć: 'C',
  Ý: 'Y',
  '«': '"', '»': '"', '“': '"', '”': '"',
  '‘': "'", '’': "'",
  '–': '-', '—': '-', '−': '-',
  '…': '.',
  '·': '-', // separador entre campos
  '×': 'x', // multiplicación
  '°': 'o', 'º': 'o', // "N° 42" → "No 42"
  'ª': 'a', // "1ª" → "1a"
};

/**
 * Deja solo ASCII imprimible, un carácter por carácter.
 *
 * Lo que no se puede representar se cambia por `?` y no se borra: un hueco en
 * un nombre de producto es peor que un signo de interrogación, porque el cajero
 * creería que el nombre termina ahí.
 */
function aAscii(texto: string): string {
  let salida = '';
  for (const c of texto) {
    const tilde = SIN_TILDES[c];
    if (tilde !== undefined) {
      salida += tilde;
    } else if (c >= ' ' && c <= '~') {
      salida += c;
    } else {
      salida += '?';
    }
  }
  return salida;
}

//---------------------------------------------------------------------------
// Comandos ESC/POS
//---------------------------------------------------------------------------

/**
 * Los comandos ESC/POS que usa este ticket y cuántos parámetros lleva cada uno.
 * El total de un comando son 2 bytes (prefijo y opcode) más sus parámetros.
 *
 * Se exporta porque las pruebas lo necesitan para quitar los comandos del medio
 * y mirar solo el texto. Si el código y el test tuvieran cada uno su lista, el
 * día que se añadiera un comando de tres bytes la del test se quedaría corta y
 * se comería el primer carácter de cada renglón sin decir nada.
 *
 * La clave es el opcode, no el prefijo: los cuatro comandos que emite este
 * ticket tienen opcodes distintos, así que no hace falta distinguir `ESC` de
 * `GS` para no confundirlos.
 */
export const COMANDOS: Readonly<Record<number, number>> = {
  0x40: 0, // ESC @   inicializar
  0x45: 1, // ESC E n  negrita
  0x21: 1, // ESC ! n  tamaño y ancho
  0x56: 1, // GS V n   corte de papel
};

/** Inicializa la impresora y deja la fuente en normal. */
function init(): number[] {
  return [ESC, 0x40];
}

function negrita(on: boolean): number[] {
  return [ESC, 0x45, on ? 0x01 : 0x00];
}

/** Doble alto y doble ancho, para el total. */
function dobleTamano(): number[] {
  return [ESC, 0x21, 0x11];
}

function fuenteNormal(): number[] {
  return [ESC, 0x21, 0x00];
}

/** Corte de papel. `GS V 0` es el corte parcial, que no wastea tanto. */
function corte(): number[] {
  return [GS, 0x56, 0x00];
}

/** Avance del papel de una línea, con el texto ya limpio. */
function linea(texto: string): number[] {
  return [...bytesDe(aAscii(texto)), 0x0a];
}

/** Caracteres de `texto` en ASCII, uno por byte. */
function bytesDe(texto: string): number[] {
  const salida: number[] = [];
  for (let i = 0; i < texto.length; i++) {
    salida.push(texto.charCodeAt(i) & 0xff);
  }
  return salida;
}

//---------------------------------------------------------------------------
// Maquetación
//---------------------------------------------------------------------------

function separador(): string {
  return '-'.repeat(ANCHO);
}

/** Centra en las ANCHO columnas, con el sobrante a la derecha. */
function centrar(texto: string): string {
  const limpio = aAscii(texto);
  if (limpio.length >= ANCHO) return limpio.slice(0, ANCHO);
  const izq = Math.floor((ANCHO - limpio.length) / 2);
  return ' '.repeat(izq) + limpio + ' '.repeat(ANCHO - izq - limpio.length);
}

/**
 * Une izquierda y derecha con los huecos de en medio.
 *
 * Si no caben, la izquierda cede: los centimos van a la derecha porque son el
 * número que hay que leer, y el nombre se recorta antes.
 */
function fila(izq: string, der: string): string {
  const l = aAscii(izq);
  const d = aAscii(der);
  if (d.length > ANCHO) return d.slice(0, ANCHO);
  if (l.length + d.length >= ANCHO) {
    return l.slice(0, ANCHO - d.length) + d;
  }
  return l + ' '.repeat(ANCHO - l.length - d.length) + d;
}

/**
 * Recorta por los dos extremos: `nombre largo de verdad...final`.
 *
 * El original recortaba solo por la derecha, así que "Cuaderno.Events pauta 100
 * hojas" salía como "Cuaderno.Events pauta 100 h", que es un producto
 * diferente al que el cajero está pensando. Los nombres de papelería son largos
 * y se distinguen por el final (la cantidad de hojas, el tamaño, la marca), que
 * es justo lo que se perdía.
 */
function truncar(texto: string, max: number): string {
  const limpio = aAscii(texto);
  if (max <= 0) return '';
  if (limpio.length <= max) return limpio;
  if (max <= 3) return limpio.slice(0, max);
  return limpio.slice(0, max - 3) + '...';
}

//---------------------------------------------------------------------------
// Montos
//---------------------------------------------------------------------------

/** Miles con el separador que se usa en cada moneda. */
function agrupar(digitos: string, sep: string): string {
  let salida = '';
  const n = digitos.length;
  for (let i = 0; i < n; i++) {
    if (i > 0 && (n - i) % 3 === 0) salida += sep;
    salida += digitos[i];
  }
  return salida;
}

/** `$1,234.56`. Centavos de dólar. */
function fmtUsd(centavos: number): string {
  const neg = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  return `${neg}$${agrupar(String(Math.trunc(abs / 100)), ',')}.${String(abs % 100).padStart(2, '0')}`;
}

/** `Bs 1.234,56`. Centimos de bolívar. */
function fmtVes(centavos: number): string {
  const neg = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  return `${neg}Bs ${agrupar(String(Math.trunc(abs / 100)), '.')},${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Cantidad sin separadores: `5` o `2,5`.
 *
 * La coma es decimal, como se usa en Venezuela, y el original imprimía el
 * punto de Rust (`2.5`), que el cajero leía como un separador de miles en una
 * columna de cantidades. Se redondea a tres decimales porque más de eso en un
 * metro de cable no significa nada y solo alarga la línea.
 */
function fmtCantidad(c: number): string {
  if (!Number.isFinite(c)) return '0';
  if (Number.isInteger(c)) return String(c);
  return c.toFixed(3).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}

/** `36,85`. La tasa, con coma decimal. */
function fmtTasa(t: number): string {
  if (!Number.isFinite(t) || t <= 0) return '0,00';
  const cent = Math.round(t * 100);
  return `${agrupar(String(Math.trunc(cent / 100)), '.')},${String(cent % 100).padStart(2, '0')}`;
}

/** `Pago móvil Bs · Ref. 0414-99`, o `Efectivo US$`. */
function etiquetaPago(p: TicketPago): string {
  const tipo = ETIQUETA_PAGO[p.tipo_pago] ?? 'Efectivo';
  const moneda = p.moneda === 'usd' ? 'US$' : 'Bs';
  const ref = p.numero_referencia?.trim();
  return ref ? `${tipo} ${moneda} - Ref. ${ref}` : `${tipo} ${moneda}`;
}

const ETIQUETA_PAGO: Record<string, string> = {
  pago_movil: 'Pago móvil',
  punto: 'Punto',
  biopago: 'Biopago',
};

function montoPago(p: TicketPago): string {
  return p.moneda === 'usd' ? fmtUsd(p.monto) : fmtVes(p.monto);
}

/**
 * La fecha sin la hora: `2026-09-05`.
 *
 * Recorta por la derecha y no por los dos extremos como `truncar`, porque los
 * dos extremos de una fecha no valen lo mismo: la parte que dice qué día es
 * está al principio, y `2026-09-05 10:22:00` recortado por el medio salía como
 * `2026-09...`, que no es una fecha y un ticket con una fecha ilegible es un
 * ticket que el cajero no puede archivar.
 *
 * La fecha viene de SQLite como `YYYY-MM-DD HH:MM:SS`, así que los diez
 * primeros caracteres son siempre el día. Si algún día el formato cambia, lo
 * que sale es un texto raro pero no una fecha falsa.
 */
function fechaCorta(fecha: string): string {
  return aAscii(fecha.trim()).slice(0, 10);
}

/** Una línea de producto: nombre a la izquierda, cantidad y subtotal a la derecha. */
function lineaDetalle(d: TicketLinea): string {
  const der = `${fmtCantidad(d.cantidad).padStart(2)} ${fmtUsd(d.subtotal)}`;
  return fila(truncar(d.producto, ANCHO - der.length), der);
}

//---------------------------------------------------------------------------
// El ticket
//---------------------------------------------------------------------------

/**
 * El ticket completo de una factura, listo para mandarse a la impresora.
 *
 * El orden de las secciones es el del original y está pensado para lo que hace
 * el cajero: identificar la venta arriba, ver qué se vendió en el medio, y
 * cuánto se cobró al final. El espacio de `NOTA:` y de `DEVOLUCION:` queda en
 * blanco a propósito: es donde el cajero escribe a mano, algo que el papel
 * continuo siempre ha permitido.
 */
export function ticketFactura(f: TicketInput): Uint8Array {
  const out: number[] = init();

  // Encabezado del negocio, centrado y en negrita.
  out.push(...negrita(true), ...linea(centrar(f.negocio_nombre.toUpperCase())), ...negrita(false));
  if (f.negocio_rif.trim() !== '') out.push(...linea(centrar(`RIF: ${f.negocio_rif.trim()}`)));
  if (f.negocio_telefono.trim() !== '') out.push(...linea(centrar(`Telf: ${f.negocio_telefono.trim()}`)));
  if (f.negocio_direccion.trim() !== '') out.push(...linea(centrar(f.negocio_direccion.trim())));
  out.push(...linea(separador()));

  out.push(...negrita(true), ...linea(fila(`FACTURA N° ${String(f.numero_factura).padStart(4, '0')}`, fechaCorta(f.fecha))), ...negrita(false));
  out.push(...linea(fila('Cliente:', '')));
  out.push(...linea(truncar(f.cliente, ANCHO)));
  if (f.cliente_documento.trim() !== '') {
    out.push(...linea(fila('RIF:', truncar(f.cliente_documento, ANCHO - 4))));
  }
  out.push(...linea(separador()));

  // Detalle.
  out.push(...negrita(true), ...linea(fila('PRODUCTO', 'CANT  SUBTOTAL')), ...negrita(false));
  for (const d of f.detalle) out.push(...linea(lineaDetalle(d)));
  out.push(...linea(separador()));

  out.push(...linea(fila('Subtotal', fmtUsd(f.subtotal))));
  if (f.descuento > 0) out.push(...linea(fila('Descuento', `-${fmtUsd(f.descuento)}`)));
  out.push(...dobleTamano(), ...negrita(true), ...linea(fila('TOTAL', fmtUsd(f.total))), ...negrita(false), ...fuenteNormal());

  // Forma de pago.
  out.push(...linea(separador()));
  out.push(...negrita(true), ...linea('FORMA DE PAGO'), ...negrita(false));
  for (const p of f.pagos) out.push(...linea(truncar(fila(etiquetaPago(p), montoPago(p)), ANCHO)));

  // Recordatorio de cobro, en una factura a crédito próxima a vencer.
  const recordatorio = f.recordatorio?.trim() ?? '';
  if (recordatorio !== '') {
    out.push(...linea(separador()));
    out.push(...linea(centrar(truncar(recordatorio, ANCHO))));
  }

  out.push(...linea(separador()));
  out.push(...linea('NOTA:'));

  // Devoluciones registradas sobre esta venta.
  out.push(...linea(separador()));
  out.push(...negrita(true), ...linea('DEVOLUCION:'), ...negrita(false));
  for (const dev of f.devoluciones) out.push(...bloqueDevolucion(dev));
  if (f.devoluciones.length > 0) {
    const devuelto = f.devoluciones.reduce((s, d) => s + d.monto, 0);
    out.push(
      ...negrita(true),
      ...linea(fila('Saldo final (neto)', fmtUsd(Math.max(0, f.total - devuelto)))),
      ...negrita(false),
    );
  }

  // Pie.
  out.push(...linea(separador()));
  if (f.tasa_cambio > 0) {
    out.push(...linea(centrar(`Tasa: Bs ${fmtTasa(f.tasa_cambio)} por US$ 1`)));
  }
  out.push(...linea(centrar('Gracias por su compra!!')));
  // Papel que el cajero se lleva para anotar, y que la impresora no trague.
  out.push(...linea(''), ...linea(''));

  out.push(...corte());
  return Uint8Array.from(out);
}

/**
 * Una devolución: la fecha y el monto, el motivo en su propia línea, y los
 * productos devueltos.
 *
 * El motivo lleva renglón aparte porque no cabe de otra manera. La cabecera con
 * la fecha se come 22 de las 42 columnas, así que mezclando el motivo ahí
 * quedaban doce para el texto: "el cliente lo devolvio porque se mojo" salía
 * como "danos de trans" en todas las devoluciones, que es el peor sitio posible
 * para perder información, porque es lo único que explica por qué el cliente
 * devolvió la mercadería. Con su renglón entra completo casi siempre, y si no,
 * los puntos suspensivos avisan de que se perdió algo.
 */
function bloqueDevolucion(dev: TicketDevolucion): number[] {
  const out: number[] = [];
  out.push(...linea(fila(`Devuelto el ${fechaCorta(dev.fecha_devolucion)}`, fmtUsd(dev.monto))));

  const motivo = dev.motivo?.trim() ?? '';
  if (motivo !== '') {
    out.push(...linea(`  ${truncar(motivo, ANCHO - 2)}`));
  }

  for (const dl of dev.detalle) {
    const importe = fmtUsd(dl.subtotal);
    out.push(
      ...linea(fila(truncar(`  ${dl.nombre} x ${fmtCantidad(dl.cantidad)}`, ANCHO - importe.length), importe)),
    );
  }
  return out;
}

//---------------------------------------------------------------------------
// Ticket de prueba
//---------------------------------------------------------------------------

/**
 * El ticket que sale al pulsar "Probar impresora".
 *
 * Lleva todos los comandos de control que la factura usa: negrita, doble
 * tamaño, corte, columnas. Si en la prueba salen los caracteres raros y los
 * acentos bien, el problema no es de aquí.
 */
export function ticketPrueba(negocioNombre = 'TIENDA - PRUEBA'): Uint8Array {
  return ticketFactura({
    negocio_nombre: negocioNombre,
    negocio_rif: 'J-00000000-0',
    negocio_telefono: '0000-0000000',
    negocio_direccion: 'Linea de prueba, 42 columnas',
    numero_factura: 0,
    fecha: 'AAAA-MM-DD',
    cliente: 'Cliente de prueba',
    cliente_documento: 'V-00000000',
    subtotal: 1234,
    descuento: 0,
    total: 1234,
    tasa_cambio: 36.85,
    detalle: [
      { producto: 'Cuaderno pauta 100 hojas', cantidad: 2, subtotal: 1000 },
      { producto: 'Lapiz grafito HB', cantidad: 1, subtotal: 34 },
      { producto: 'Metros de cable', cantidad: 2.5, subtotal: 200 },
    ],
    pagos: [
      { tipo_pago: 'efectivo', moneda: 'usd', monto: 500, numero_referencia: null },
      { tipo_pago: 'pago_movil', moneda: 'ves', monto: 73400, numero_referencia: '0414-1234567' },
    ],
    devoluciones: [],
    recordatorio: null,
  });
}
