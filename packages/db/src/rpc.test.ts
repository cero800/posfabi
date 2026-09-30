// Pruebas del transporte: `Args`, el sobre, el despacho y los dos servidores.
//
// La capa de dominio ya tiene sus pruebas contra la base en memoria (500 de las
// fases 1 a 5). Lo que no había probado nadie es el camino que la interfaz
// recorre de verdad: una petición JSON en un pipe o en un socket, y una
// respuesta JSON con el error adentro. Estos tests son ese camino.
//
// El caso que más pesa aquí no es el feliz: es que **nada** de lo que llega del
// cable pueda tumbar el proceso. Un POS que se cae porque un campo llegó mal
// escrito pierde la venta que el cajero estaba cobro en ese momento.

import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { enMemoria } from './db.js';
import { CODIGO_ERROR, stockInsuficiente } from './errors.js';
import type { Rutas } from './paths.js';
import {
  Args,
  Escritor,
  type Contexto,
  type Procedimiento,
  type Registro,
  type RespuestaRpc,
  type Sobre,
  atender,
  servirHttp,
  servirStdio,
} from './rpc.js';

//---------------------------------------------------------------------------
// Andamiaje
//---------------------------------------------------------------------------

const RUTAS_FALSAS: Rutas = {
  dataDir: '/tmp/no-se-usa',
  documentDir: '/tmp/no-se-usa',
  tempDir: '/tmp',
  dbPath: '/tmp/no-se-usa/tienda.db',
};

function ctxCon(): Contexto {
  return { db: enMemoria(), rutas: RUTAS_FALSAS };
}

function registroDe(...entradas: [string, Procedimiento][]): Registro {
  return new Map(entradas);
}

/** Registra un procedure que devuelve sueco, para probar el despacho. */
function eco(valor: unknown): Procedimiento {
  return () => valor;
}

function pedir(
  registro: Registro,
  method: string,
  params?: unknown,
  id: number | string | null = 1,
): Promise<RespuestaRpc> {
  return atender(registro, ctxCon(), { jsonrpc: '2.0', id, method, params });
}

/** El `data` si la respuesta fue buena; si no, lanza con el mensaje del error. */
function dato<T>(r: RespuestaRpc): T {
  if (r.result.ok) return r.result.data as T;
  throw new Error(`${r.result.error.codigo}: ${r.result.error.mensaje}`);
}

function errorDe(r: RespuestaRpc): { codigo: string; mensaje: string } {
  if (r.result.ok) throw new Error('se esperaba un error y la respuesta fue buena');
  return r.result.error;
}

//---------------------------------------------------------------------------
// Args
//---------------------------------------------------------------------------

describe('Args', () => {
  it('lee un entero del nivel superior', () => {
    expect(new Args({ id: 7 }).entero('id')).toBe(7);
  });

  it('acepta el alias en camelCase cuando viene en snake_case y al revés', () => {
    // Es la tolerancia que hace que la reescritura de `services/db.ts` en la
    // fase 8 sea cosmética y no un arreglo de nombres en el mismo commit.
    expect(new Args({ clienteId: 3 }).entero('cliente_id', 'clienteId')).toBe(3);
    expect(new Args({ cliente_id: 3 }).entero('cliente_id', 'clienteId')).toBe(3);
    expect(new Args({ ventaId: 9 }).entero('venta_id', 'ventaId')).toBe(9);
  });

  it('falla diciendo qué dato falta, y no con un error de SQLite', () => {
    // El mensaje importa: es lo que ve la persona que depura. "Falta el dato
    // «cliente_id»" dice dónde mirar; un `undefined` que llega al INSERT
    // produce "cannot be bound to SQLite parameter 3".
    expect(() => new Args({}).entero('cliente_id')).toThrowError(/Falta el dato «cliente_id»/);
  });

  it('rechaza un entero que no lo es', () => {
    for (const malo of ['7', 7.5, null, true, {}, []]) {
      expect(() => new Args({ id: malo }).entero('id'), String(malo)).toThrowError(
        /número entero/,
      );
    }
  });

  it('no confunde un 0 con un dato ausente', () => {
    // El bug clásico de `if (args.id)`: el id 0 es un id, no "no vino".
    expect(new Args({ cantidad_delta: 0 }).entero('cantidad_delta')).toBe(0);
  });

  it('trata un null en un opcional como ausente, no como error', () => {
    expect(new Args({ fecha: null }).textoOpc('fecha')).toBeNull();
    expect(new Args({}).enteroOpc('limite')).toBeNull();
    expect(new Args({ limite: null }).enteroOpc('limite')).toBeNull();
  });

  it('distingue ausente de `false` en una bandera', () => {
    expect(new Args({}).bandera('activo')).toBe(false);
    expect(new Args({}).bandera('activo', true)).toBe(true);
    expect(new Args({ activo: false }).bandera('activo', true)).toBe(false);
    expect(new Args({ activo: true }).bandera('activo', false)).toBe(true);
  });

  it('lee el "true" y el "false" en texto de una bandera', () => {
    // El destino de la impresora se guarda como JSON en la tabla de
    // configuración, así que un `true` puede haber pasado por un `parse` de texto.
    expect(new Args({ ok: 'true' }).bandera('ok')).toBe(true);
    expect(new Args({ ok: 'false' }).bandera('ok', true)).toBe(false);
  });

  it('rechaza una bandera que no es bandera', () => {
    expect(() => new Args({ ok: 'quizá' }).bandera('ok')).toThrowError(/verdadero o falso/);
  });

  it('lee un objeto anidado y una lista', () => {
    expect(new Args({ venta: { cliente_id: 1 } }).objeto<{ cliente_id: number }>('venta')).toEqual({
      cliente_id: 1,
    });
    expect(new Args({ pagos: [1, 2] }).lista<number>('pagos')).toEqual([1, 2]);
  });

  it('no deja pasar un null donde va un objeto', () => {
    // Sin esto, un `null` llegaría al SELECT y el error sería de SQLite, no del
    // validador del dominio que es quien tiene el mensaje que el cajero lee.
    expect(() => new Args({ venta: null }).objeto('venta')).toThrowError(/debe ser un objeto/);
    expect(() => new Args({ venta: [] }).objeto('venta')).toThrowError(/debe ser un objeto/);
  });

  it('no deja pasar un objeto donde va una lista', () => {
    expect(() => new Args({ pagos: { monto: 1 } }).lista('pagos')).toThrowError(/debe ser una lista/);
  });

  it('rechaza params como lista posicional y lo explica', () => {
    // JSON-RPC la admite, pero aceptarla obligaría a guardar el orden de los
    // parámetros de cada procedure en dos sitios distintos.
    expect(() => new Args([1, 2])).toThrowError(/objeto con nombres/);
  });

  it('trata params ausente y null como un objeto vacío', () => {
    expect(new Args(undefined).tiene('id')).toBe(false);
    expect(new Args(null).tiene('id')).toBe(false);
  });
});

//---------------------------------------------------------------------------
// Despacho
//---------------------------------------------------------------------------

describe('atender', () => {
  it('devuelve el sobre de éxito con el valor del procedure', async () => {
    const r = await pedir(registroDe(['sumar', () => 42]), 'sumar');
    expect(r).toEqual({ jsonrpc: '2.0', id: 1, result: { ok: true, data: 42 } });
  });

  it('devuelve el id que vino, sea número, texto o null', async () => {
    const reg = registroDe(['nada', eco(null)]);
    expect((await atender(reg, ctxCon(), { id: 4, method: 'nada' })).id).toBe(4);
    expect((await atender(reg, ctxCon(), { id: 'abc', method: 'nada' })).id).toBe('abc');
    expect((await atender(reg, ctxCon(), { id: null, method: 'nada' })).id).toBeNull();
  });

  it('devuelve null cuando el procedure no devuelve nada', async () => {
    // Un procedure `void` es un `data: null`, no una respuesta vacía: el cliente
    // siempre recibe un sobre y no tiene que adivinar si le faltó algo.
    const r = await pedir(registroDe(['hacer', () => undefined]), 'hacer');
    expect(r.result).toEqual({ ok: true, data: null });
  });

  it('sabe distinguir una caja cerrada de un fallo', async () => {
    const r = await pedir(registroDe(['caja', eco(null)]), 'caja');
    expect(r.result).toEqual({ ok: true, data: null });
  });

  it('pasa los params al procedure como Args', async () => {
    let recibido: Args | null = null;
    const r = await pedir(
      registroDe([
        'leer',
        (_c, a) => {
          recibido = a;
          return a.entero('id');
        },
      ]),
      'leer',
      { id: 5 },
    );
    expect(dato<number>(r)).toBe(5);
    expect(recibido).toBeInstanceOf(Args);
  });

  it('le pasa al procedure la base y las rutas', async () => {
    let tieneDb = false;
    let mismaRuta = false;
    await pedir(
      registroDe([
        'mirar',
        (c) => {
          tieneDb = c.db !== undefined;
          mismaRuta = c.rutas === RUTAS_FALSAS;
          return null;
        },
      ]),
      'mirar',
    );
    expect(tieneDb).toBe(true);
    expect(mismaRuta).toBe(true);
  });

  it('admite procedures asíncronos', async () => {
    const r = await pedir(registroDe(['tarde', async () => 'listo']), 'tarde');
    expect(dato(r)).toBe('listo');
  });

  it('reporta un method desconocido con su propio código', async () => {
    const r = await pedir(registroDe(), 'no_existe');
    expect(errorDe(r).codigo).toBe(CODIGO_ERROR.metodo_desconocido);
    expect(errorDe(r).mensaje).toContain('no_existe');
  });

  it('reporta una petición que no dice qué pide', async () => {
    const r = await pedir(registroDe(), '');
    expect(errorDe(r).codigo).toBe(CODIGO_ERROR.validacion);
  });

  it('reporta una petición que no es un objeto', async () => {
    for (const malo of [null, 'hola', 42, [1, 2]]) {
      const r = await atender(registroDe(), ctxCon(), malo);
      expect(errorDe(r).codigo, JSON.stringify(malo)).toBe(CODIGO_ERROR.validacion);
    }
  });

  it('contesta con id null cuando la petición ni siquiera tiene id', async () => {
    // Si no contestara, el cliente esperaría para siempre. Es peor eso que
    // devolver un error que no se puede emparejar.
    const reg = registroDe();
    const r = await atender(reg, ctxCon(), { method: 'lo_que_sea' });
    expect(r.id).toBeNull();
    expect(r.result.ok).toBe(false);
  });

  it('nunca lanza, pase lo que pase con el procedure', async () => {
    const r = await pedir(
      registroDe([
        'explota',
        () => {
          throw new Error('boom interno');
        },
      ]),
      'explota',
    );
    expect(r.result.ok).toBe(false);
    expect(errorDe(r).codigo).toBe(CODIGO_ERROR.sistema);
    expect(errorDe(r).mensaje).toContain('boom interno');
  });

  it('deja pasar el código del error del dominio sin tocarlo', async () => {
    // Es lo que permite que la interfaz distinga "no hay stock" de "cerrá la
    // caja" sin comparar textos en español. Si el despacho reescribiera el
    // código, esa distinción se perdería y todo acabaría en "algo falló".
    const r = await pedir(
      registroDe([
        'vender',
        () => {
          throw stockInsuficiente('Cuaderno', 2, 'unidad');
        },
      ]),
      'vender',
    );
    expect(errorDe(r)).toEqual({
      codigo: CODIGO_ERROR.stock_insuficiente,
      mensaje: 'Stock insuficiente de "Cuaderno": quedan 2 unidad',
    });
  });

  it('traduce a `sistema` un error que no es del dominio', async () => {
    // Un `TypeError` de programación no se reescribe como si fuera un error de
    // negocio: el código `sistema` es el que dice "esto hay que mirarlo".
    const r = await pedir(
      registroDe([
        'raro',
        () => {
          throw new TypeError('x no es una función');
        },
      ]),
      'raro',
    );
    expect(errorDe(r).codigo).toBe(CODIGO_ERROR.sistema);
  });

  it('traduce a `duplicado` la violación de una restricción UNIQUE', async () => {
    // Es el caso que más se va a ver en la práctica: dos productos con el mismo
    // código. El mensaje crudo de SQLite no le dice nada a quien lo escribió.
    const r = await pedir(
      registroDe([
        'crear',
        () => {
          throw new Error('UNIQUE constraint failed: productos.codigo');
        },
      ]),
      'crear',
    );
    expect(errorDe(r).codigo).toBe(CODIGO_ERROR.duplicado);
  });

  it('no filtra el stack trace al cliente', async () => {
    const r = await pedir(
      registroDe([
        'falla',
        () => {
          throw new Error('detalle interno que no debe salir');
        },
      ]),
      'falla',
    );
    expect(JSON.stringify(r)).not.toContain('at ');
  });
});

//---------------------------------------------------------------------------
// Escritor
//---------------------------------------------------------------------------

describe('Escritor', () => {
  it('escribe una línea por respuesta, terminada en salto', async () => {
    const lineas: string[] = [];
    const e = new Escritor((l) => lineas.push(l));
    await e.enviar({ jsonrpc: '2.0', id: 1, result: { ok: true, data: 1 } });
    expect(lineas).toEqual(['{"jsonrpc":"2.0","id":1,"result":{"ok":true,"data":1}}']);
  });

  it('mantiene el orden aunque las respuestas se pidan en paralelo', async () => {
    // Sin la cola, dos respuestas que se cruzan se entrelazan en el pipe y el
    // shell lee un JSON partido. Esto es lo que evita.
    const lineas: string[] = [];
    const e = new Escritor((l) => lineas.push(l));
    await Promise.all([
      e.enviar({ jsonrpc: '2.0', id: 'a', result: { ok: true, data: 'primero' } }),
      e.enviar({ jsonrpc: '2.0', id: 'b', result: { ok: true, data: 'segundo' } }),
      e.enviar({ jsonrpc: '2.0', id: 'c', result: { ok: true, data: 'tercero' } }),
    ]);
    expect(lineas.map((l) => JSON.parse(l).id)).toEqual(['a', 'b', 'c']);
  });

  it('contesta aunque el resultado no se pueda serializar', async () => {
    // Un ciclo o un BigInt harían que JSON.stringify tirara. Si el escritor no
    // responds, el cliente queda colgado sin ninguna pista.
    const lineas: string[] = [];
    const e = new Escritor((l) => lineas.push(l));
    const conCiclo: Record<string, unknown> = {};
    conCiclo['self'] = conCiclo;
    await e.enviar({ jsonrpc: '2.0', id: 9, result: { ok: true, data: conCiclo } });
    expect(lineas).toHaveLength(1);
    const sobre = JSON.parse(lineas[0] as string).result as Sobre;
    expect(sobre.ok).toBe(false);
    if (!sobre.ok) expect(sobre.error.codigo).toBe(CODIGO_ERROR.sistema);
  });

  it('drenar espera a que se escriba todo', async () => {
    const lineas: string[] = [];
    const e = new Escritor((l) => lineas.push(l));
    for (let i = 0; i < 50; i++) {
      void e.enviar({ jsonrpc: '2.0', id: i, result: { ok: true, data: i } });
    }
    await e.drenar();
    expect(lineas).toHaveLength(50);
  });
});

//---------------------------------------------------------------------------
// Servidor por stdio
//---------------------------------------------------------------------------

/** Conduce un `servirStdio` con dos `PassThrough` y devuelve lo que se escribió. */
function crearStdio(registro: Registro) {
  const entrada = new PassThrough();
  const salida = new PassThrough();
  const escrito: string[] = [];
  let acumulado = '';
  salida.on('data', (t: Buffer) => {
    acumulado += t.toString('utf8');
  });
  const servidor = servirStdio(registro, ctxCon(), entrada, salida);
  const leer = async (): Promise<RespuestaRpc[]> =>
    // Se espera a que haya al menos una línea completa.
    (async () => {
      for (let i = 0; i < 200 && !acumulado.includes('\n'); i++) {
        await new Promise((r) => setTimeout(r, 5));
      }
      const lineas = acumulado.split('\n').filter((l) => l !== '');
      acumulado = '';
      return lineas.map((l) => JSON.parse(l) as RespuestaRpc);
    })();
  return { entrada, salida, servidor, escrito, leer };
}

describe('servirStdio', () => {
  it('responde una petición por línea', async () => {
    const { entrada, leer } = crearStdio(registroDe(['hola', eco('que tal')]));
    entrada.write('{"jsonrpc":"2.0","id":1,"method":"hola"}\n');
    const [r] = await leer();
    expect(r?.result).toEqual({ ok: true, data: 'que tal' });
  });

  it('atiende varias peticiones que llegan en un solo trozo', async () => {
    // Un `data` de un pipe puede traer varias líneas. Si solo se leyera la
    // primera, las demás se quedarían sin respuesta para siempre.
    const { entrada, leer } = crearStdio(registroDe(['n', eco(1)]));
    entrada.write('{"id":1,"method":"n"}\n{"id":2,"method":"n"}\n{"id":3,"method":"n"}\n');
    const rs = await leer();
    expect(rs.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('espera a que llegue la línea partida', async () => {
    const { entrada, leer } = crearStdio(registroDe(['n', eco(1)]));
    entrada.write('{"jsonrpc":"2.0","id":1,');
    await new Promise((r) => setTimeout(r, 20));
    entrada.write('"method":"n"}\n');
    const [r] = await leer();
    expect(r?.id).toBe(1);
  });

  it('contesta con un error a una línea que no es JSON, sin morir', async () => {
    // Si una línea corrupta tumbara el proceso, el POS cerraría en el medio de
    // una venta. Contestar es lo único que permite seguir.
    const { entrada, leer } = crearStdio(registroDe());
    entrada.write('esto no es json\n');
    const [r] = await leer();
    expect(errorDe(r as RespuestaRpc).mensaje).toMatch(/no es JSON/);
  });

  it('ignora las líneas en blanco', async () => {
    const { entrada, leer } = crearStdio(registroDe(['n', eco(1)]));
    entrada.write('\n\n   \n{"id":1,"method":"n"}\n\n');
    const rs = await leer();
    expect(rs).toHaveLength(1);
  });

  it('descarta la línea a medias y sigue con la siguiente', async () => {
    // Una petición que se cortó a la mitad se responde con un error de sintaxis
    // y el proceso sigue: el shell no se queda esperando una respuesta que ya
    // no puede llegar, y la venta que venga detrás sí se registra.
    const { entrada, leer } = crearStdio(registroDe(['n', eco(1)]));
    entrada.write('{"id":99,"method":"n"');
    entrada.write('\n{"id":1,"method":"n"}\n');
    const rs = await leer();
    expect(errorDe(rs[0] as RespuestaRpc).mensaje).toMatch(/no es JSON/);
    expect(dato<number>(rs[1] as RespuestaRpc)).toBe(1);
  });

  it('cierra sin escribir de más', async () => {
    const { entrada, servidor, leer } = crearStdio(registroDe(['n', eco(1)]));
    entrada.write('{"id":1,"method":"n"}\n');
    await leer();
    await servidor.cerrar();
    entrada.end();
  });
});

//---------------------------------------------------------------------------
// Servidor por HTTP
//---------------------------------------------------------------------------

describe('servirHttp', () => {
  /** Levanta un servidor en un puerto libre y devuelve la base para llamar. */
  async function levantar(registro: Registro) {
    // Puerto 0: que el sistema elija uno libre, para que dos pruebas en
    // paralelo no se pisen.
    const s = await servirHttp(registro, ctxCon(), { puerto: 0, host: '127.0.0.1' });
    const base = `http://127.0.0.1:${s.puerto()}`;
    return { s, base };
  }

  it('responde a una petición por POST', async () => {
    const { s, base } = await levantar(registroDe(['hola', eco('que tal')]));
    const r = await fetch(`${base}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'hola' }),
    });
    expect(await r.json()).toEqual({ jsonrpc: '2.0', id: 1, result: { ok: true, data: 'que tal' } });
    await s.cerrar();
  });

  it('acepta cualquier ruta del POST, no solo /rpc', async () => {
    // El shell Rust no tiene por qué acertar la ruta; y un typo en la URL
    // tendría que ser un 404, no un fallo de negocio.
    const { s, base } = await levantar(registroDe(['hola', eco(1)]));
    const r = await fetch(`${base}/cualquier/cosa`, {
      method: 'POST',
      body: JSON.stringify({ id: 1, method: 'hola' }),
    });
    expect(r.status).toBe(200);
    await s.cerrar();
  });

  it('atiende un lote y lo devuelve en el orden de entrada', async () => {
    const { s, base } = await levantar(registroDe(['n', eco(1)]));
    const r = await fetch(`${base}/rpc`, {
      method: 'POST',
      body: JSON.stringify([
        { id: 'primero', method: 'n' },
        { id: 'segundo', method: 'n' },
      ]),
    });
    const cuerpo = (await r.json()) as RespuestaRpc[];
    expect(cuerpo.map((c) => c.id)).toEqual(['primero', 'segundo']);
    await s.cerrar();
  });

  it('devuelve 400 con un sobre de error si el cuerpo no es JSON', async () => {
    const { s, base } = await levantar(registroDe());
    const r = await fetch(`${base}/rpc`, { method: 'POST', body: 'no soy json' });
    expect(r.status).toBe(400);
    expect(errorDe((await r.json()) as RespuestaRpc).codigo).toBe(CODIGO_ERROR.validacion);
    await s.cerrar();
  });

  it('devuelve 400 con un lote vacío', async () => {
    const { s, base } = await levantar(registroDe());
    const r = await fetch(`${base}/rpc`, { method: 'POST', body: '[]' });
    expect(r.status).toBe(400);
    await s.cerrar();
  });

  it('devuelve 405 si no es un POST', async () => {
    const { s, base } = await levantar(registroDe());
    const r = await fetch(`${base}/rpc`, { method: 'PUT', body: '{}' });
    expect(r.status).toBe(405);
    await s.cerrar();
  });

  it('contesta un error de negocio con 200, no con 4xx', async () => {
    // El transporte funcionó: el error es del POS. Un 4xx haría que un cliente
    // HTTP genérico lo tratara como problema de la llamada y no como respuesta.
    const { s, base } = await levantar(
      registroDe([
        'vender',
        () => {
          throw new Error('no hay caja abierta');
        },
      ]),
    );
    const r = await fetch(`${base}/rpc`, {
      method: 'POST',
      body: JSON.stringify({ id: 1, method: 'vender' }),
    });
    expect(r.status).toBe(200);
    expect(errorDe((await r.json()) as RespuestaRpc).codigo).toBe(CODIGO_ERROR.sistema);
    await s.cerrar();
  });

  it('sirve /salud sin envoltura JSON-RPC', async () => {
    // Es lo que consulta un `curl` o el shell para saber si el puerto está vivo.
    const { s, base } = await levantar(registroDe(['estado_sistema', () => ({ vivo: true })]));
    const r = await fetch(`${base}/salud`);
    expect(await r.json()).toEqual({ ok: true, data: { vivo: true } });
    await s.cerrar();
  });

  it('sigue respondiendo después de un error', async () => {
    // Un fallo no puede dejar el servidor inservible: la app seguiría viva pero
    // sin base, que es el peor estado posible en un mostrador.
    const { s, base } = await levantar(
      registroDe(
        [
          'roto',
          () => {
            throw new Error('siempre falla');
          },
        ],
        ['sano', eco('ok')],
      ),
    );
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`${base}/rpc`, {
        method: 'POST',
        body: JSON.stringify({ id: i, method: 'roto' }),
      });
      expect(r.status).toBe(200);
    }
    const r = await fetch(`${base}/rpc`, {
      method: 'POST',
      body: JSON.stringify({ id: 'final', method: 'sano' }),
    });
    expect(dato<RespuestaRpc>((await r.json()) as RespuestaRpc)).toBe('ok');
    await s.cerrar();
  });

  it('cierra aunque haya conexiones abiertas', async () => {
    // Un cliente colgado no puede impedir que el proceso se vaya, que es lo que
    // pasa al cerrar la app con la caja abierta.
    const { s, base } = await levantar(registroDe(['n', eco(1)]));
    void fetch(`${base}/rpc`, { method: 'POST', body: '{"id":1,"method":"n"}' }).catch(() => {});
    await s.cerrar();
  });
});
