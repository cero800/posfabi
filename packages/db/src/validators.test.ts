import { describe, expect, it } from 'vitest';

import { UNIDADES_MEDIDA, type Moneda, type Rol, type TipoPago, type TipoVenta, type UnidadMedida } from '@tienda/core';
import { AppError, CODIGO_ERROR } from './errors.js';
import {
  MAX_CANTIDAD,
  MAX_CODIGO,
  MAX_MONTO,
  normalizarClave,
  textoOpcional,
  validarCantidad,
  validarCantidadVenta,
  validarCodigo,
  validarCombinacionPago,
  validarDescuento,
  validarDocumento,
  validarEnteroNoNegativo,
  validarMoneda,
  validarMonto,
  validarMontoPositivo,
  validarNombre,
  validarPin,
  validarRol,
  validarTipoPago,
  validarTipoVenta,
  validarUnidadMedida,
} from './validators.js';

/** El mensaje del error de validación, para compararlo con una expresión. */
function mensajeDe(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppError) return e.message;
    throw e;
  }
  throw new Error('se esperaba un error y no se lanzó');
}

describe('validarMonto', () => {
  it('acepta 0 y un monto normal', () => {
    validarMonto(0, 'Precio');
    validarMonto(1999, 'Precio');
    validarMonto(MAX_MONTO, 'Precio');
  });

  it('rechaza un monto negativo nombrando el campo', () => {
    expect(mensajeDe(() => validarMonto(-1, 'Precio'))).toBe('Precio no puede ser negativo');
  });

  it('rechaza un monto por encima del máximo', () => {
    expect(mensajeDe(() => validarMonto(MAX_MONTO + 1, 'Precio'))).toBe(
      'Precio excede el máximo permitido',
    );
  });

  it('rechaza un monto fraccionario, que no es un número de céntimos', () => {
    expect(mensajeDe(() => validarMonto(19.99, 'Precio'))).toMatch(/entero de céntimos/);
  });
});

describe('validarEnteroNoNegativo', () => {
  it('acepta 0 y un contador normal', () => {
    validarEnteroNoNegativo(0, 'días de crédito');
    validarEnteroNoNegativo(30, 'días de crédito');
    validarEnteroNoNegativo(MAX_CANTIDAD, 'días de crédito');
  });

  it('rechaza un valor que no es un entero', () => {
    // El caso que justifica la función: `undefined` no es un entero, y un
    // `if (valor < 0)` no lo atrapa porque comparar con `undefined` da `false`.
    for (const malo of [1.5, '30', null, undefined, Number.NaN, true, {}, []]) {
      expect(
        mensajeDe(() => validarEnteroNoNegativo(malo as number, 'días de crédito')),
        String(malo),
      ).toBe('El campo «días de crédito» debe ser un número entero');
    }
  });

  it('rechaza un negativo, con un mensaje propio', () => {
    expect(mensajeDe(() => validarEnteroNoNegativo(-1, 'días de crédito'))).toBe(
      'El campo «días de crédito» no puede ser negativo',
    );
  });

  it('rechaza un contador disparatado', () => {
    expect(mensajeDe(() => validarEnteroNoNegativo(MAX_CANTIDAD + 1, 'días de crédito'))).toBe(
      'El campo «días de crédito» excede el máximo permitido',
    );
  });

  it('no habla de céntimos, porque un contador no es un monto', () => {
    // `validarMonto` habría dicho «debe ser un número entero de céntimos», que
    // deja a quien rellena el formulario buscando qué céntimos se le olvidaron.
    expect(mensajeDe(() => validarEnteroNoNegativo(1.5, 'orden'))).not.toMatch(/céntimos/);
  });
});

describe('validarMontoPositivo', () => {
  it('exige mayor que cero', () => {
    validarMontoPositivo(1, 'Precio');
    expect(mensajeDe(() => validarMontoPositivo(0, 'Precio'))).toBe('Precio debe ser mayor que 0');
    expect(mensajeDe(() => validarMontoPositivo(-1, 'Precio'))).toBe('Precio debe ser mayor que 0');
  });

  it('también respeta el máximo', () => {
    expect(mensajeDe(() => validarMontoPositivo(MAX_MONTO + 1, 'Precio'))).toBe(
      'Precio excede el máximo permitido',
    );
  });
});

describe('validarDescuento', () => {
  it('admite un descuento igual o menor que el subtotal', () => {
    validarDescuento(0, 100);
    validarDescuento(100, 100);
  });

  it('rechaza un descuento mayor que el subtotal', () => {
    expect(mensajeDe(() => validarDescuento(101, 100))).toBe(
      'El descuento no puede superar el subtotal',
    );
  });

  it('rechaza un descuento negativo', () => {
    expect(mensajeDe(() => validarDescuento(-1, 100))).toBe('Descuento no puede ser negativo');
  });
});

describe('validarCantidad', () => {
  it('acepta enteros y fracciones', () => {
    validarCantidad(1, 'unidad');
    validarCantidad(0.25, 'kg');
    validarCantidad(3.5, 'metro');
    validarCantidad(2, 'libra');
  });

  it('rechaza cero, negativos y no-números', () => {
    expect(mensajeDe(() => validarCantidad(0, 'kg'))).toBe('La cantidad debe ser mayor que 0');
    expect(mensajeDe(() => validarCantidad(-1, 'kg'))).toBe('La cantidad debe ser mayor que 0');
    expect(mensajeDe(() => validarCantidad(Number.NaN, 'kg'))).toBe('Cantidad no válida');
    expect(mensajeDe(() => validarCantidad(Number.POSITIVE_INFINITY, 'kg'))).toBe('Cantidad no válida');
  });

  it('rechaza una cantidad por encima del máximo', () => {
    expect(mensajeDe(() => validarCantidad(MAX_CANTIDAD + 1, 'kg'))).toBe(
      'La cantidad excede el máximo permitido',
    );
  });

  it('exige entero cuando la unidad es "unidad"', () => {
    validarCantidad(3, 'unidad');
    expect(mensajeDe(() => validarCantidad(2.5, 'unidad'))).toBe(
      "En 'unidad' la cantidad debe ser un número entero",
    );
  });
});

describe('validarCantidadVenta', () => {
  it('da un mensaje propio para la venta de fracciones por unidad', () => {
    expect(mensajeDe(() => validarCantidadVenta(2.5, 'unidad'))).toBe(
      "No se pueden vender fracciones de un producto en 'unidad'",
    );
  });

  it('acepta igual que validarCantidad cuando la cantidad es entera', () => {
    validarCantidadVenta(3, 'unidad');
    validarCantidadVenta(0.5, 'kg');
    expect(mensajeDe(() => validarCantidadVenta(0, 'kg'))).toBe('La cantidad debe ser mayor que 0');
  });
});

describe('enumerados cerrados', () => {
  it('acepta las monedas soportadas y rechaza otras', () => {
    validarMoneda('usd');
    validarMoneda('ves');
    expect(mensajeDe(() => validarMoneda('eur'))).toBe('Moneda inválida: eur');
  });

  it('acepta los métodos de pago vigentes y rechaza los demás', () => {
    for (const t of ['efectivo', 'pago_movil', 'punto', 'biopago']) validarTipoPago(t);
    for (const t of ['transferencia', 'cheque', 'mixto', '']) {
      expect(mensajeDe(() => validarTipoPago(t))).toBe(`Tipo de pago inválido: ${t}`);
    }
  });

  it('acepta los dos tipos de venta', () => {
    validarTipoVenta('contado');
    validarTipoVenta('credito');
    expect(mensajeDe(() => validarTipoVenta('barato'))).toBe('Tipo de venta inválida: barato');
  });

  it('acepta los dos roles', () => {
    validarRol('admin');
    validarRol('cajero');
    expect(mensajeDe(() => validarRol('supervisor'))).toBe('Rol inválido: supervisor');
  });

  it('acepta las unidades de medida del catálogo', () => {
    for (const u of UNIDADES_MEDIDA) validarUnidadMedida(u);
    expect(mensajeDe(() => validarUnidadMedida('bandeja'))).toBe('Unidad de medida inválida: bandeja');
    expect(mensajeDe(() => validarUnidadMedida('arroba'))).toBe('Unidad de medida inválida: arroba');
  });

  it('acepta exactamente las unidades que la interfaz ofrece', () => {
    // Si alguien agrega una unidad a `@tienda/core` y olvida validarla aquí,
    // la lista de arriba se cae. Esta prueba es la que avisa.
    const esperadas: string[] = ['unidad', 'caja', 'paquete', 'metro', 'kg', 'libra', 'blister'];
    expect([...UNIDADES_MEDIDA].sort()).toEqual([...esperadas].sort());
  });
});

describe('narrowing de tipos', () => {
  it('el validador estrecha el tipo para el resto del código', () => {
    // Si el `asserts` no funcionara, estas asignaciones no compilarían.
    const pagoDePrueba = (crudo: string): TipoPago => {
      validarTipoPago(crudo);
      return crudo;
    };
    const monedaDePrueba = (crudo: string): Moneda => {
      validarMoneda(crudo);
      return crudo;
    };
    const rolDePrueba = (crudo: string): Rol => {
      validarRol(crudo);
      return crudo;
    };
    const ventaDePrueba = (crudo: string): TipoVenta => {
      validarTipoVenta(crudo);
      return crudo;
    };
    const unidadDePrueba = (crudo: string): UnidadMedida => {
      validarUnidadMedida(crudo);
      return crudo;
    };

    expect(pagoDePrueba('pago_movil')).toBe('pago_movil');
    expect(monedaDePrueba('ves')).toBe('ves');
    expect(rolDePrueba('cajero')).toBe('cajero');
    expect(ventaDePrueba('credito')).toBe('credito');
    expect(unidadDePrueba('blister')).toBe('blister');
  });
});

describe('validarCombinacionPago', () => {
  it('en US$ solo admite efectivo', () => {
    validarCombinacionPago('efectivo', 'usd', null);
    for (const tipo of ['pago_movil', 'punto', 'biopago']) {
      expect(mensajeDe(() => validarCombinacionPago(tipo, 'usd', 'REF1'))).toMatch(/US\$/);
    }
  });

  it('en Bs admite todos los métodos', () => {
    validarCombinacionPago('efectivo', 'ves', null);
    validarCombinacionPago('pago_movil', 'ves', 'REF1');
    validarCombinacionPago('punto', 'ves', null);
    validarCombinacionPago('biopago', 'ves', null);
  });

  it('solo el pago móvil exige número de referencia', () => {
    expect(mensajeDe(() => validarCombinacionPago('pago_movil', 'ves', null))).toMatch(/referencia/);
    expect(mensajeDe(() => validarCombinacionPago('pago_movil', 'ves', '   '))).toMatch(
      /referencia/,
    );
    // Punto y biopago ya no exigen referencia.
    validarCombinacionPago('punto', 'ves', null);
    validarCombinacionPago('biopago', 'ves', null);
  });

  it('valida los enumerados antes de la combinación', () => {
    expect(mensajeDe(() => validarCombinacionPago('transferencia', 'usd', null))).toMatch(
      /Tipo de pago inválido/,
    );
    expect(mensajeDe(() => validarCombinacionPago('efectivo', 'eur', null))).toMatch(
      /Moneda inválida/,
    );
  });
});

describe('validarPin', () => {
  it('acepta 4 dígitos', () => {
    validarPin('1234');
    validarPin('0000');
    validarPin(' 9999 ');
  });

  it('rechaza longitudes y formatos incorrectos', () => {
    for (const p of ['123', '12345', '', '12a4', '12.4', 'abcd', '-123']) {
      expect(mensajeDe(() => validarPin(p))).toBe('El PIN debe tener exactamente 4 dígitos');
    }
  });
});

describe('normalizarClave', () => {
  it('hace equivalentes las claves que solo difieren en formato', () => {
    expect(normalizarClave('  p-001 ')).toBe('P-001');
    expect(normalizarClave('P 001')).toBe('P001');
    expect(normalizarClave('v-12345678')).toBe(normalizarClave(' V-12345678 '));
  });

  it('colapsa los espacios internos', () => {
    expect(normalizarClave('a   b\tc')).toBe('ABC');
  });

  it('deja vacío a vacío', () => {
    expect(normalizarClave('   ')).toBe('');
  });
});

describe('textos', () => {
  it('exige documento', () => {
    expect(validarDocumento(' V-123 ')).toBe('V-123');
    expect(mensajeDe(() => validarDocumento('   '))).toBe('El documento es obligatorio');
    expect(mensajeDe(() => validarDocumento('x'.repeat(MAX_CODIGO + 1)))).toMatch(/no puede superar/);
  });

  it('exige código', () => {
    expect(validarCodigo(' P-1 ')).toBe('P-1');
    expect(mensajeDe(() => validarCodigo(''))).toBe('El código es obligatorio');
    expect(mensajeDe(() => validarCodigo('x'.repeat(MAX_CODIGO + 1)))).toMatch(/no puede superar/);
  });

  it('exige nombre y personaliza el mensaje según el campo', () => {
    expect(validarNombre('  Cuadernos ')).toBe('Cuadernos');
    expect(mensajeDe(() => validarNombre('', 'La categoría'))).toBe('La categoría es obligatorio');
    expect(mensajeDe(() => validarNombre('x'.repeat(200)))).toMatch(/no puede superar 120/);
  });

  it('convierte un texto opcional vacío en null', () => {
    expect(textoOpcional(null)).toBeNull();
    expect(textoOpcional(undefined)).toBeNull();
    expect(textoOpcional('')).toBeNull();
    expect(textoOpcional('   ')).toBeNull();
    expect(textoOpcional('  se dañó  ')).toBe('se dañó');
    expect(mensajeDe(() => textoOpcional('x'.repeat(600)))).toMatch(/no puede superar/);
  });
});

describe('código de error', () => {
  it('todo fallo de validación usa el mismo código', () => {
    const fallos: Array<() => unknown> = [
      () => validarMonto(-1, 'X'),
      () => validarMontoPositivo(0, 'X'),
      () => validarDescuento(5, 1),
      () => validarCantidad(0, 'kg'),
      () => validarCantidadVenta(1.5, 'unidad'),
      () => validarMoneda('eur'),
      () => validarTipoPago('cheque'),
      () => validarTipoVenta('barato'),
      () => validarRol('jefe'),
      () => validarUnidadMedida('arroba'),
      () => validarCombinacionPago('punto', 'usd', null),
      () => validarPin('12'),
      () => validarDocumento(''),
      () => validarNombre(''),
      () => textoOpcional('x'.repeat(600)),
    ];

    for (const f of fallos) {
      try {
        f();
        throw new Error('se esperaba un error');
      } catch (e) {
        expect(e, 'no fue un AppError').toBeInstanceOf(AppError);
        expect((e as AppError).codigo).toBe(CODIGO_ERROR.validacion);
      }
    }
  });
});
