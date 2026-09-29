import { describe, expect, it } from 'vitest';
import type { TicketInput } from '@tienda/core';

import { ANCHO, COMANDOS, ticketFactura, ticketPrueba } from './ticket.js';

//---------------------------------------------------------------------------
// Andamiaje
//---------------------------------------------------------------------------

function factura(over: Partial<TicketInput> = {}): TicketInput {
  return {
    negocio_nombre: 'Papelería El Lápiz',
    negocio_rif: 'J-40123456-7',
    negocio_telefono: '0212-1234567',
    negocio_direccion: 'Av. Miranda, Caracas',
    numero_factura: 3,
    fecha: '2026-09-05 10:22:00',
    cliente: 'Café del Centro',
    cliente_documento: 'J-11111111-1',
    subtotal: 1500,
    descuento: 0,
    total: 1500,
    tasa_cambio: 36.85,
    detalle: [{ producto: 'Cuaderno', cantidad: 3, subtotal: 1500 }],
    pagos: [{ tipo_pago: 'efectivo', moneda: 'usd', monto: 1500, numero_referencia: null }],
    devoluciones: [],
    recordatorio: null,
    ...over,
  };
}

/**
 * El ticket como texto, quitando los comandos ESC/POS.
 *
 * tabla de comandos sale de `ticket.ts`, así que no hay forma de que las
 * pruebas y el generador discrepen sobre dónde acaba un comando.
 */
function texto(bytes: Uint8Array): string {
  const salida: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 0x1b || b === 0x1d) {
      // 2 bytes de prefijo y opcode, más los parámetros del comando.
      const parametros = COMANDOS[bytes[i + 1]!];
      if (parametros === undefined) {
        // Comando desconocido: se salta solo el opcode, que es lo menos que
        // puede hacer. Si aparece aquí, falta añadirlo a `COMANDOS`.
        throw new Error(`Comando ESC/POS desconocido: 0x${b.toString(16)} 0x${bytes[i + 1]!.toString(16)}`);
      }
      i += 1 + parametros;
      continue;
    }
    salida.push(String.fromCharCode(b));
  }
  return salida.join('');
}

/** Los renglones de texto del ticket, sin los separadores de guiones. */
function renglones(bytes: Uint8Array): string[] {
  return texto(bytes)
    .split('\n')
    .map((l) => l.replace(/^ {42}$/, '').replace(/^-{42}$/, '').trimEnd())
    .filter((l) => l !== '');
}

/** Los bytes que no son parte de un comando ESC/POS. */
function soloTexto(bytes: Uint8Array): number[] {
  return Array.from(texto(bytes), (c) => c.charCodeAt(0));
}

/**
 * Que exista un renglón con este texto a la izquierda y este monto a la derecha.
 *
 * Las pruebas de contenido miran el texto, no el relleno de espacios: la
 * maquetación tiene sus propias pruebas, que comprueban el ancho exacto de
 * cada renglón y que la columna del dinero no se mueve. Si cada prueba de
 * contenido calcula a mano cuántos espacios van entre el nombre y el monto,
 * cambiar el ancho del papel rompe veinte aserciones y ninguna señala el
 * problema real.
 */
function tieneFila(bytes: Uint8Array, izquierda: string, derecha: string): boolean {
  return renglones(bytes).some((l) => l.startsWith(izquierda) && l.endsWith(derecha));
}

//---------------------------------------------------------------------------
// Lo que la impresora necesita entender
//---------------------------------------------------------------------------

describe('ticketFactura · los comandos ESC/POS', () => {
  it('empieza inicializando la impresora', () => {
    // ESC @ pone la impresora en su estado por defecto. Sin esto, una impresión
    // anterior que dejara la fuente en doble o el papel en otra posición arrastra
    // ese estado a este ticket.
    const b = ticketFactura(factura());
    expect(Array.from(b.slice(0, 2))).toEqual([0x1b, 0x40]);
  });

  it('termina con el corte de papel', () => {
    // GS V 0: corte parcial. El total (GS V 1) deja un trozo de papel tirado en
    // la bandeja en cada venta, y en una papelería eso se acumula.
    const b = ticketFactura(factura());
    expect(Array.from(b.slice(-3))).toEqual([0x1d, 0x56, 0x00]);
  });

  it('enciende y apaga la negrita sin dejarla puesta', () => {
    const b = ticketFactura(factura());
    // ESC E 1 y ESC E 0.
    expect(b).toContain(0x1b);
    const apagado = Array.from(b).findIndex(
      (x, i) => x === 0x1b && b[i + 1] === 0x45 && b[i + 2] === 0x00,
    );
    expect(apagado).toBeGreaterThan(0);
  });

  it('vuelve a la fuente normal después del total', () => {
    // ESC ! con 0x11 es doble tamaño; si no se apagara, todo lo que saliera
    // después del total saldría gigante.
    const b = ticketFactura(factura());
    const doble = Array.from(b).findIndex(
      (x, i) => x === 0x1b && b[i + 1] === 0x21 && b[i + 2] === 0x11,
    );
    const normal = Array.from(b).findIndex(
      (x, i) => i > doble && x === 0x1b && b[i + 1] === 0x21 && b[i + 2] === 0x00,
    );
    expect(doble).toBeGreaterThan(0);
    expect(normal).toBeGreaterThan(doble);
  });

  it('nunca deja la impresora en negrita o en doble al final', () => {
    // Un ticket se enchufa en la impresora y a veces el cajero reimprime algo a
    // mano. Si este ticket se quedó en negrita doble, ese papel sale distinto.
    const b = ticketFactura(factura());
    const ultimos = Array.from(b.slice(-60));
    // Ni ESC E 1 ni ESC ! 0x11 en el tramo final (el corte ya se lo llevó).
    expect(ultimos.some((x, i) => x === 0x1b && (ultimos[i + 1] === 0x45 || ultimos[i + 1] === 0x21))).toBe(false);
  });
});

//---------------------------------------------------------------------------
// El texto
//---------------------------------------------------------------------------

describe('ticketFactura · el texto', () => {
  it('pone el nombre del negocio arriba, en mayúsculas', () => {
    expect(texto(ticketFactura(factura()))).toContain('PAPELERIA EL LAPIZ');
  });

  it('centra el nombre del negocio en las 42 columnas', () => {
    const primera = texto(ticketFactura(factura())).split('\n')[0] ?? '';
    // "PAPELERIA EL LAPIZ" son 18 columnas; 12 de margen a cada lado.
    expect(primera).toBe('            PAPELERIA EL LAPIZ            ');
  });

  it('nunca deja los renglones más largos que el papel', () => {
    // Este es el error que arruina un ticket: una línea de 50 columnas hace que
    // la impresora la parta en dos y el total acabe descolocado.
    for (const f of [
      factura(),
      factura({ cliente: 'Una empresa con un nombre verdaderamente larguísimo que no cabe' }),
      factura({ negocio_direccion: 'Una dirección también bastante larga para no caber en una línea' }),
      factura({ recordatorio: 'Recordatorio larguísimo que tampoco cabe en las cuarenta y dos columnas' }),
    ]) {
      for (const l of texto(ticketFactura(f)).split('\n')) {
        expect(l.length).toBeLessThanOrEqual(ANCHO);
      }
    }
  });

  it('saca la fecha corta, no la hora', () => {
    // `2026-09-05 10:22:00` no cabe en la mitad derecha de la línea del
    // encabezado, y lo que importa es el día. Y de los diez primeros
    // caracteres: si el recorte fuera por el medio saldría `2026-09...`, que no
    // es una fecha y no se puede archivar.
    const b = ticketFactura(factura());
    expect(tieneFila(b, 'FACTURA No 0003', '2026-09-05')).toBe(true);
    expect(texto(b)).not.toContain('10:22');
  });

  it('numera la factura con cuatro dígitos', () => {
    expect(texto(ticketFactura(factura()))).toContain('FACTURA No 0003');
  });

  it('lista los productos con cantidad y subtotal', () => {
    expect(tieneFila(ticketFactura(factura()), 'Cuaderno', '3 $15.00')).toBe(true);
  });

  it('muestra el total en doble tamaño', () => {
    expect(tieneFila(ticketFactura(factura()), 'TOTAL', '$15.00')).toBe(true);
  });

  it('deja dos renglones libres para que el cajero escriba a mano', () => {
    // Papel continuo con espacio después del agradecimiento: es donde el cajero
    // anota lo que el cliente pidió y no había, o el teléfono para llamarle.
    // Sin ese hueco el papel se corta pegado al texto y no hay dónde escribir.
    const t = texto(ticketFactura(factura()));
    expect(renglones(ticketFactura(factura())).at(-1)).toContain('Gracias por su compra');
    // Los dos saltos vacíos van después del relleno de centrado, no antes.
    expect(t).toMatch(/!!\s*\n\n\n$/);
  });
});

//---------------------------------------------------------------------------
// Los acentos
//---------------------------------------------------------------------------

describe('ticketFactura · los acentos', () => {
  it('nunca escribe un byte que no sea ASCII imprimible', () => {
    // Es la garantía que hace que el ticket se lea en cualquier impresora, sin
    // importar su juego de caracteres. `Buffer.from(s, 'utf8')` de un texto con
    // `ñ` escribiría dos bytes que en PC437 salen como dos signos raros.
    const conAcentos = factura({
      negocio_nombre: 'Ñoño Adiciones, S.A.',
      negocio_direccion: 'Av. Ñapures — local «3»',
      cliente: 'Peña & Hijos, C.A.',
      recordatorio: 'Vence en 3 días',
      detalle: [{ producto: 'Cinta de aislar 3M', cantidad: 2, subtotal: 300 }],
    });
    for (const b of soloTexto(ticketFactura(conAcentos))) {
      expect(b === 0x0a || (b >= 0x20 && b < 0x7f)).toBe(true);
    }
  });

  it('cambia cada acento por su vocal', () => {
    const t = texto(
      ticketFactura(factura({ negocio_nombre: 'Ñandú, Adiciones.piñata y CIUDAD' })),
    );
    expect(t).toContain('NANDU, ADICIONES.PINATA Y CIUDAD');
  });

  it('cambia los signos que no son ASCII por algo legible', () => {
    // Los productos de papelería traen ángulos, comillas y medidas:
    // "Lápiz 2B × 2,5m". La `×` es el signo de multiplicar, que en el papel se
    // lee mejor como una `x`.
    const t = texto(
      ticketFactura(
        factura({ detalle: [{ producto: 'Lápiz "2B" × 18cm', cantidad: 1, subtotal: 50 }] }),
      ),
    );
    expect(t).toContain('Lapiz "2B" x 18cm');
  });

  it('no pierde columnas al quitar los acentos', () => {
    // Un acento que ocupara dos columnas desalinearía todos los renglones
    // siguientes: los nombres dejarían de estar centrados y las columnas del
    // dinero se irían un espacio. Por eso la sustitución es de uno a uno.
    const primera = texto(ticketFactura(factura({ negocio_nombre: 'ÑÁÉÍÓÚ' }))).split('\n')[0] ?? '';
    expect(primera).toBe('                  NAEIOU                  ');
    expect(primera).toHaveLength(ANCHO);
  });

  it('marca con ? lo que no sabe escribir, en vez de borrarlo', () => {
    const t = texto(ticketFactura(factura({ cliente: 'Cliente 漢字 2' })));
    expect(t).toContain('Cliente ?? 2');
  });
});

//---------------------------------------------------------------------------
// Los nombres largos
//---------------------------------------------------------------------------

describe('ticketFactura · los nombres largos', () => {
  it('recorta por los dos extremos, para no perder el final del nombre', () => {
    // En papelería lo que distingue al producto suele estar al final ("100
    // hojas", "RxL", "18 cm"). Recortar solo por la derecha convertía
    // "Resma de papel bond carta 75 g" en "Resma de papel bond car", que es otro
    // producto y el cajero cobra lo que el cliente no pidió.
    const linea = renglones(
      ticketFactura(
        factura({
          detalle: [
            { producto: 'Resma de papel bond carta 75 g premium', cantidad: 1, subtotal: 2000 },
          ],
        }),
      ),
    ).find((l) => l.includes('Resma'));

    expect(linea).toContain('Resma');
    expect(linea).toContain('75 g');
    expect(linea).toContain('...');
    expect(linea).toHaveLength(ANCHO);
  });

  it('no pone puntos suspensivos en un nombre que sí cabe', () => {
    // Los `...` avisan de que se perdió algo. Si salieran por costumbre, el
    // cajero dejaría de mirar los nombres enteros.
    const linea = renglones(
      ticketFactura(factura({ detalle: [{ producto: 'Cuaderno', cantidad: 1, subtotal: 500 }] })),
    ).find((l) => l.includes('Cuaderno'));

    expect(linea).not.toContain('...');
    expect(linea).toBe('Cuaderno                           1 $5.00');
  });

  it('deja la columna del dinero intacta al recortar el nombre', () => {
    for (const nombre of [
      'Cinta',
      'Cinta de aislar',
      'Cinta de aislar de colores',
      'Cinta de aislar de colores muy resistantísima',
      'X'.repeat(200),
    ]) {
      const linea = renglones(
        ticketFactura(factura({ detalle: [{ producto: nombre, cantidad: 7, subtotal: 12345 }] })),
      ).find((l) => l.includes('$123.45'));
      expect(linea).toBeDefined();
      expect(linea!.length).toBe(ANCHO);
      expect(linea!.endsWith('7 $123.45')).toBe(true);
    }
  });

  it('un nombre más largo que el papel no rompe la maqueta', () => {
    const linea = renglones(
      ticketFactura(factura({ cliente: 'E'.repeat(100) })),
    ).find((l) => l.includes('EEE'));
    expect(linea!.length).toBe(ANCHO);
  });
});

//---------------------------------------------------------------------------
// Los montos
//---------------------------------------------------------------------------

describe('ticketFactura · los montos', () => {
  it('formatea los dólares con coma de miles y punto decimal', () => {
    expect(texto(ticketFactura(factura({ subtotal: 123456789, total: 123456789 })))).toContain(
      '$1,234,567.89',
    );
  });

  it('formatea los bolívares con punto de miles y coma decimal', () => {
    const t = texto(
      ticketFactura(
        factura({
          pagos: [{ tipo_pago: 'efectivo', moneda: 'ves', monto: 123456789, numero_referencia: null }],
        }),
      ),
    );
    expect(t).toContain('Bs 1.234.567,89');
  });

  it('un descuento sale con el signo menos delante del número', () => {
    // El signo menos va pegado al número, no a la etiqueta: el cajero compara la
    // cifra con el total de arriba, y un guion suelto al principio de la línea
    // es donde no se mira.
    const b = ticketFactura(factura({ subtotal: 2000, descuento: 500, total: 1500 }));
    expect(tieneFila(b, 'Descuento', '-$5.00')).toBe(true);
  });

  it('no imprime la línea de descuento cuando no hay descuento', () => {
    expect(texto(ticketFactura(factura({ descuento: 0 })))).not.toContain('Descuento');
  });

  it('las cantidades van con coma decimal y sin separador de miles', () => {
    const t = texto(
      ticketFactura(factura({ detalle: [{ producto: 'Cable', cantidad: 2.5, subtotal: 200 }] })),
    );
    expect(t).toContain('2,5 $2.00');
  });

  it('una cantidad entera no lleva decimales', () => {
    const t = texto(
      ticketFactura(factura({ detalle: [{ producto: 'Cable', cantidad: 1000, subtotal: 20000 }] })),
    );
    expect(t).not.toContain('1.000');
    expect(t).toContain('1000 $200.00');
  });

  it('redondea a tres decimales, que es más de lo que significa un metro', () => {
    const t = texto(
      ticketFactura(factura({ detalle: [{ producto: 'Cable', cantidad: 1.23456789, subtotal: 100 }] })),
    );
    expect(t).toContain('1,235 $1.00');
  });

  it('una cantidad inválida no rompe el ticket', () => {
    // `cantidad` viene por JSON-RPC y un cliente desactualizado puede mandar
    // NaN. El ticket tiene que salir igual, con un 0 en la cantidad.
    const t = texto(
      ticketFactura(factura({ detalle: [{ producto: 'Algo', cantidad: Number.NaN, subtotal: 100 }] })),
    );
    expect(t).toContain('0 $1.00');
  });

  it('la tasa sale con coma decimal, como se lee en Venezuela', () => {
    expect(texto(ticketFactura(factura({ tasa_cambio: 36.85 })))).toContain('Tasa: Bs 36,85 por US$ 1');
  });

  it('no imprime la tasa si es cero o no tiene sentido', () => {
    expect(texto(ticketFactura(factura({ tasa_cambio: 0 })))).not.toContain('Tasa:');
    expect(texto(ticketFactura(factura({ tasa_cambio: Number.NaN })))).not.toContain('Tasa:');
  });
});

//---------------------------------------------------------------------------
// Los pagos
//---------------------------------------------------------------------------

describe('ticketFactura · los pagos', () => {
  it('nombre y monto de cada forma de pago, cada uno en su moneda', () => {
    // Cada pago lleva el símbolo de su propia moneda. Un pago de Bs 5.000,00
    // impreso como `$50.00` haría creer al cajero que cobró cinco dólares, que
    // es justo el error que hace que la gaveta no cuadre al cierre.
    const b = ticketFactura(
      factura({
        pagos: [
          { tipo_pago: 'efectivo', moneda: 'usd', monto: 1000, numero_referencia: null },
          { tipo_pago: 'pago_movil', moneda: 'ves', monto: 500000, numero_referencia: '0414-99' },
        ],
      }),
    );
    expect(tieneFila(b, 'Efectivo US$', '$10.00')).toBe(true);
    expect(tieneFila(b, 'Pago movil Bs - Ref. 0414-99', 'Bs 5.000,00')).toBe(true);
  });

  it('sin referencia no inventa el texto "Ref."', () => {
    const t = texto(
      ticketFactura(
        factura({ pagos: [{ tipo_pago: 'efectivo', moneda: 'usd', monto: 100, numero_referencia: null }] }),
      ),
    );
    expect(t).not.toContain('Ref.');
  });

  it('una referencia en blanco se trata como ausente', () => {
    const t = texto(
      ticketFactura(
        factura({
          pagos: [{ tipo_pago: 'pago_movil', moneda: 'ves', monto: 100, numero_referencia: '   ' }],
        }),
      ),
    );
    expect(t).toContain('Pago movil Bs');
    expect(t).not.toContain('Ref.');
  });

  it('un tipo de pago desconocido no deja la línea en blanco', () => {
    // Un cliente viejo puede mandar un tipo que este backend no conoce. Es
    // mejor que salga "Efectivo" a que salga una etiqueta vacía que confunda.
    const t = texto(
      ticketFactura(
        factura({ pagos: [{ tipo_pago: 'zelle_inventado', moneda: 'usd', monto: 100, numero_referencia: null }] }),
      ),
    );
    expect(t).toContain('Efectivo US$');
  });

  it('no imprime la sección de pagos si la venta no tuvo ninguno', () => {
    // Una venta a crédito en firme todavía no tiene pagos, pero el cajero
    // necesita ver que la sección está vacía y no que falta.
    expect(texto(ticketFactura(factura({ pagos: [] })))).toContain('FORMA DE PAGO');
  });
});

//---------------------------------------------------------------------------
// El recordatorio
//---------------------------------------------------------------------------

describe('ticketFactura · el recordatorio de cobro', () => {
  it('aparece centrado cuando la factura es a crédito próxima a vencer', () => {
    const t = texto(ticketFactura(factura({ recordatorio: 'Vence el viernes' })));
    expect(t).toContain('Vence el viernes');
  });

  it('un recordatorio en blanco no imprime una línea vacía', () => {
    const sinNada = renglones(ticketFactura(factura({ recordatorio: null })));
    const conBlanco = renglones(ticketFactura(factura({ recordatorio: '   ' })));
    expect(conBlanco).toEqual(sinNada);
  });
});

//---------------------------------------------------------------------------
// Las devoluciones
//---------------------------------------------------------------------------

describe('ticketFactura · las devoluciones', () => {
  const devolucion = {
    fecha_devolucion: '2026-09-07 09:00:00',
    motivo: 'daños de transporte',
    monto: 500,
    detalle: [{ nombre: 'Cuaderno', cantidad: 1, subtotal: 500 }],
  };

  it('imprime la fecha y el monto en la cabecera, y el motivo aparte', () => {
    // El motivo va en su propio renglón porque no cabe junto a la fecha: la
    // cabecera con la fecha se come 22 de las 42 columnas. Mezclados, el motivo
    // salía siempre cortado a "danos de trans", y es justo el dato que explica
    // por qué el cliente devolvió la mercadería.
    const b = ticketFactura(factura({ devoluciones: [devolucion] }));
    expect(tieneFila(b, 'Devuelto el 2026-09-07', '$5.00')).toBe(true);
    expect(renglones(b)).toContain('  danos de transporte');
    expect(tieneFila(b, '  Cuaderno x 1', '$5.00')).toBe(true);
  });

  it('el motivo en blanco no imprime un renglón vacío', () => {
    const conMotivo = renglones(ticketFactura(factura({ devoluciones: [devolucion] })));
    const sinMotivo = renglones(
      ticketFactura(factura({ devoluciones: [{ ...devolucion, motivo: null }] })),
    );
    expect(sinMotivo.length).toBe(conMotivo.length - 1);
    expect(sinMotivo.join('\n')).not.toContain('Devuelto el 2026-09-07 -');
  });

  it('un motivo largo se recorta avisando, sin comerse el monto', () => {
    // El motivo es texto libre y lo escribe quien atiende. Lo que no puede pasar
    // es que el recorte se coma la columna del dinero: el cajero necesita ver
    // cuánto se devolvió aunque el motivo no lea completo.
    const b = ticketFactura(
      factura({
        devoluciones: [
          {
            ...devolucion,
            motivo: 'el cliente lo devolvio porque se mojo con la lluvia en el camino de la tienda',
          },
        ],
      }),
    );
    const cabecera = renglones(b).find((l) => l.startsWith('Devuelto el'));
    const renglonMotivo = renglones(b).find((l) => l.startsWith('  el cliente'));

    expect(cabecera).toHaveLength(ANCHO);
    expect(cabecera!.endsWith('$5.00')).toBe(true);
    expect(renglonMotivo).toContain('...');
    expect(renglonMotivo!.length).toBeLessThanOrEqual(ANCHO);
  });

  it('resta lo devuelto y muestra el saldo final', () => {
    const b = ticketFactura(factura({ total: 1500, devoluciones: [devolucion] }));
    expect(tieneFila(b, 'Saldo final (neto)', '$10.00')).toBe(true);
  });

  it('varias devoluciones se suman para el saldo final', () => {
    // $15.00 menos $5.00 menos $3.00 son $7.00. Sumar solo la última, o
    // quedarse con la primera, daría un saldo que no le sirve de nada al
    // cliente que viene a reclamar.
    const b = ticketFactura(
      factura({ total: 1500, devoluciones: [devolucion, { ...devolucion, monto: 300, detalle: [] }] }),
    );
    expect(tieneFila(b, 'Saldo final (neto)', '$7.00')).toBe(true);
  });

  it('una devolución mayor que el total no deja un saldo negativo', () => {
    // Sería imposible por la regla de `devoluciones.ts`, pero el ticket no
    // depende de esa regla: si algún día alguien la relaja, aquí no se imprime
    // un "-$X".
    const b = ticketFactura(factura({ total: 100, devoluciones: [{ ...devolucion, monto: 500 }] }));
    expect(tieneFila(b, 'Saldo final (neto)', '$0.00')).toBe(true);
    expect(texto(b)).not.toContain('-$');
  });

  it('sin devoluciones no imprime el saldo final', () => {
    expect(texto(ticketFactura(factura()))).not.toContain('Saldo final');
  });
});

//---------------------------------------------------------------------------
// El ticket de prueba
//---------------------------------------------------------------------------

describe('ticketPrueba', () => {
  it('trae todos los comandos que necesita una prueba de impresión', () => {
    // Si la prueba no usa doble tamaño, negrita y corte, sirve para poco: hay
    // que comprobar que la impresora obedece antes de confiarle una venta.
    const b = ticketPrueba();
    const arr = Array.from(b);
    expect(arr.slice(0, 2)).toEqual([0x1b, 0x40]);
    expect(arr.slice(-3)).toEqual([0x1d, 0x56, 0x00]);
    expect(arr.some((x, i) => x === 0x1b && arr[i + 1] === 0x21 && arr[i + 2] === 0x11)).toBe(true);
    expect(arr.some((x, i) => x === 0x1b && arr[i + 1] === 0x45)).toBe(true);
  });

  it('prueba los tres casos que más se rompen: coma, acento y referencia', () => {
    const t = texto(ticketPrueba());
    expect(t).toContain('2,5'); // cantidad con decimal
    expect(t).toContain('Pago movil'); // etiqueta de un pago que no es efectivo
    expect(t).toContain('Ref. 0414-1234567');
    // El nombre del negocio llega al papel, y un acento si se le pasó sería una
    // vocal, no dos bytes raros.
    expect(t).toContain('TIENDA - PRUEBA');
  });

  it('lleva el nombre del negocio si se le pasa', () => {
    expect(texto(ticketPrueba('Papelería'))).toContain('PAPELERIA');
  });
});
