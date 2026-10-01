// Pruebas del cliente del sidecar: arrancar el backend, repartir las respuestas
// y fallar lo que queda pendiente.
//
// ## Por qué hay que probarlo con un doble
//
// El backend de verdad no se puede usar aquí: hablaría con una base de datos
// real en la máquina donde corren las pruebas, y el cliente además depende de
// Tauri, que no existe fuera de la app. Se dobla el plugin de shell —que es
// justo donde vive toda la lógica de este archivo— y se comprueba el
// comportamiento que, si estuviera mal, dejaría la pantalla del cajero cargando
// para siempre sin decir por qué.
//
// Lo que se prueba no es que el backend conteste bien —eso lo prueba
// `packages/db` contra una base de verdad— sino que el cliente entrega cada
// respuesta a quien la pidió, rechaza lo que corresponde y nunca deja una
// petición sin resolver.
//
// ## El arranque no es instantáneo
//
// `llamar` primero resuelve las carpetas, lanza el proceso, confirma con una
// llamada y recién entonces envía lo que se le pidió. Así que una prueba no
// puede contestar a ciegas: tiene que esperar a que la petición salga por el pipe.
// Por eso está `esperaA`, que cede al bucle de eventos las pocas vueltas que
// hacen falta —los dobles resuelven en el acto— en vez de esperar de verdad.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
const spawn = vi.fn();
const write = vi.fn();

type Linea = (linea: string) => void;

/** Los flujos y eventos del proceso falso, para poder hablarle desde la prueba. */
const flujos: { stdout: Linea[]; stderr: Linea[] } = { stdout: [], stderr: [] };
const eventos = new Map<string, (dato: unknown) => void>();

/** Lo que el cliente le pasó al plugin al pedir el proceso. */
let pedido: { program: string; args: string[]; options: { env: Record<string, string> } } | null = null;

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string) => invoke(cmd),
}));

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: {
    sidecar: (program: string, args: string[], options: { env: Record<string, string> }) => {
      pedido = { program, args, options };
      // Un proceso son unos flujos nuevos: los del anterior desaparecen. Sin
      // esto, las respuestas del backend nuevo llegarían también al cliente que
      // ya está muerto, que es como si no estuvieran.
      flujos.stdout.length = 0;
      flujos.stderr.length = 0;
      return {
        stdout: { on: (_e: string, fn: Linea) => flujos.stdout.push(fn) },
        stderr: { on: (_e: string, fn: Linea) => flujos.stderr.push(fn) },
        on: (evento: string, fn: (dato: unknown) => void) => eventos.set(evento, fn),
        spawn,
      };
    },
  },
}));

import { ErrorBackend, llamar, reiniciarCliente } from './backend';

interface Peticion {
  jsonrpc: string;
  id: number;
  method: string;
  params: unknown;
}

/** Lo que el cliente lleva escrito en el pipe del proceso. */
function peticiones(): Peticion[] {
  return write.mock.calls.map((c) => JSON.parse(c[0] as string) as Peticion);
}

/** Escribe una respuesta del backend por `stdout`, como haría el proceso. */
function responde(id: number, sobre: unknown): void {
  const linea = JSON.stringify({ jsonrpc: '2.0', id, result: sobre });
  for (const fn of flujos.stdout) fn(linea);
}

/** Emula una línea de ruido: algo que llega por `stdout` y no es respuesta. */
function ruido(linea: string): void {
  for (const fn of flujos.stdout) fn(linea);
}

/** Dispara el cierre del proceso. */
function cierra(code: number | null): void {
  eventos.get('close')?.({ code, signal: code === null ? 'SIGTERM' : null });
}

/** Cede al bucle hasta que `condicion` se cumpla, o se rinde. */
async function esperaA(condicion: () => boolean, vueltas = 50): Promise<void> {
  for (let i = 0; i < vueltas && !condicion(); i++) await Promise.resolve();
  if (!condicion()) throw new Error('la petición nunca llegó a escribirse');
}

function ultimoIdDe(metodo: string): number {
  const propias = peticiones().filter((p) => p.method === metodo);
  if (propias.length === 0) throw new Error(`nunca se pidió «${metodo}»`);
  return propias[propias.length - 1].id;
}

/**
 * Levanta el cliente y contesta su comprobación de arranque.
 *
 * Arranca con una llamada cualquiera y contesta las dos peticiones que salen:
 * la comprobación interna y la que hizo la prueba. Al terminar, el backend
 * queda listo para llamadas nuevas.
 */
async function conectar(): Promise<void> {
  // El historial se borra para que `ultimoIdDe` no encuentre peticiones de una
  // conexión anterior: los identificadores vuelven a empezar en uno con cada
  // backend, y responder a uno viejo dejaría a la promesa colgada sin que se
  // note por qué.
  write.mockClear();
  const promesa = llamar('listar_clientes');

  await esperaA(() => peticiones().some((p) => p.method === 'estado_sistema'));
  responde(ultimoIdDe('estado_sistema'), { ok: true, data: { procedures: 62 } });

  await esperaA(() => peticiones().some((p) => p.method === 'listar_clientes'));
  responde(ultimoIdDe('listar_clientes'), { ok: true, data: null });

  await promesa;
}

/** Manda una llamada y devuelve su identificador y su promesa, ya escritas. */
async function pide<T>(metodo: string, params: unknown = {}): Promise<{ id: number; promesa: Promise<T> }> {
  const antes = peticiones().filter((p) => p.method === metodo).length;
  const promesa = llamar<T>(metodo, params);
  await esperaA(() => peticiones().filter((p) => p.method === metodo).length > antes);
  return { id: ultimoIdDe(metodo), promesa };
}

beforeEach(() => {
  invoke.mockReset();
  spawn.mockReset();
  write.mockReset();
  flujos.stdout.length = 0;
  flujos.stderr.length = 0;
  eventos.clear();
  pedido = null;
  reiniciarCliente();

  invoke.mockResolvedValue({ data_dir: '/datos', document_dir: '/documentos' });
  write.mockResolvedValue(undefined);
  spawn.mockImplementation(() => Promise.resolve({ pid: 4242, write, kill: vi.fn() }));
});

afterEach(() => {
  reiniciarCliente();
});

describe('Arranque del backend', () => {
  it('pide las carpetas a Rust y lanza el sidecar con ellas por entorno', async () => {
    await conectar();

    expect(invoke).toHaveBeenCalledWith('rutas_app');
    // La ruta de `externalBin` entera, no el nombre del binario: es lo que
    // `tauri-plugin-shell` compara contra la lista de `tauri.conf.json`.
    expect(pedido?.program).toBe('binaries/tienda-db');
    // Sin argumentos: el backend no lee órdenes, solo el protocolo.
    expect(pedido?.args).toEqual([]);
    expect(pedido?.options.env).toEqual({
      TIENDA_DATA_DIR: '/datos',
      TIENDA_DOC_DIR: '/documentos',
    });
  });

  it('confirma que el backend arrancó preguntándole su estado', async () => {
    await conectar();

    // Siempre la primera. Si alguien la quita y el backend no puede abrir la
    // base, la interfaz no se entera hasta que el cajero intenta vender algo.
    expect(peticiones()[0].method).toBe('estado_sistema');
  });

  it('no lanza un proceso por llamada', async () => {
    await conectar();

    const primera = await pide('listar_productos');
    const segunda = await pide('listar_stock');
    responde(primera.id, { ok: true, data: [] });
    responde(segunda.id, { ok: true, data: [] });
    await Promise.all([primera.promesa, segunda.promesa]);

    // Una sola vez: el backend es uno, y dos procesos abriendo la misma base a
    // la vez es una forma corta de corromperla.
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('da error claro cuando el ejecutable no está', async () => {
    spawn.mockRejectedValueOnce(new Error('no existe el archivo'));

    await expect(llamar('listar_clientes')).rejects.toThrow(
      /No se pudo lanzar «binaries\/tienda-db»/,
    );
  });
});

describe('Reparto de respuestas', () => {
  it('entrega cada respuesta a quien la pidió, aunque lleguen desordenadas', async () => {
    await conectar();

    const clientes = await pide<{ id: number }[]>('listar_clientes');
    const productos = await pide<{ id: number }[]>('listar_productos');

    // El backend atiende en paralelo, así que el orden de llegada no es el de
    // salida. Lo que empareja es el identificador de la petición.
    responde(ultimoIdDe('listar_productos'), { ok: true, data: [{ id: 9 }] });
    responde(ultimoIdDe('listar_clientes'), { ok: true, data: [{ id: 1 }, { id: 2 }] });

    await expect(clientes.promesa).resolves.toEqual([{ id: 1 }, { id: 2 }]);
    await expect(productos.promesa).resolves.toEqual([{ id: 9 }]);
  });

  it('devuelve solo el `data`, sin el sobre', async () => {
    await conectar();
    const { id, promesa } = await pide<number>('obtener_venta', { venta_id: 7 });
    responde(id, { ok: true, data: 42 });
    await expect(promesa).resolves.toBe(42);
  });

  it('envía el método y los parámetros tal cual', async () => {
    await conectar();
    const { id } = await pide('crear_venta', { venta: { cliente_id: 3 } });

    const enviada = peticiones().find((p) => p.id === id);
    expect(enviada).toEqual({
      jsonrpc: '2.0',
      id,
      method: 'crear_venta',
      params: { venta: { cliente_id: 3 } },
    });
  });

  it('convierte `ok: false` en un rechazo con el mensaje del backend', async () => {
    await conectar();
    const { id, promesa } = await pide('crear_cliente', { cliente: {} });

    responde(id, {
      ok: false,
      error: { mensaje: 'El nombre del cliente no puede quedar vacío', codigo: 'validacion' },
    });

    await expect(promesa).rejects.toThrow('El nombre del cliente no puede quedar vacío');
    await expect(promesa).rejects.toBeInstanceOf(ErrorBackend);
    // El código se guarda aparte para poder distinguirlos más adelante sin
    // volver a tocar los textos que ve el cajero.
    await expect(promesa.catch((e: ErrorBackend) => e.codigo)).resolves.toBe('validacion');
  });

  it('sigue funcionando si por `stdout` pasa algo que no es una respuesta', async () => {
    await conectar();
    const { id, promesa } = await pide<string[]>('listar_categorias');

    // Una línea de ruido no es motivo para tumbar la conexión: si lo fuera, un
    // solo byte raro cerraría el POS. Tampoco lo es un error sin `id`, que no
    // tiene a quién atribuírselo.
    ruido('esto no es json');
    ruido(JSON.stringify({ jsonrpc: '2.0', id: null, error: { mensaje: 'algo' } }));

    responde(id, { ok: true, data: [] });
    await expect(promesa).resolves.toEqual([]);
  });
});

describe('Cuando el backend se muere', () => {
  it('falla las peticiones en vuelo en vez de dejarlas colgadas', async () => {
    await conectar();
    const { promesa } = await pide('listar_clientes');

    cierra(1);

    await expect(promesa).rejects.toThrow(/El backend se cerró con código 1/);
  });

  it('cuenta con lo último que dijo el backend, que es la explicación', async () => {
    await conectar();
    for (const fn of flujos.stderr) fn('no se pudo abrir la base: el archivo está bloqueado');

    const { promesa } = await pide('listar_clientes');
    cierra(1);

    await expect(promesa).rejects.toThrow(/archivo está bloqueado/);
  });

  it('se vuelve a lanzar en la siguiente llamada, para que el POS se recupere solo', async () => {
    await conectar();
    cierra(1);

    await conectar();

    // Dos procesos en total: el que murió y el nuevo. Lo que no puede pasar es
    // que el segundo arranque quede a medias y deje al POS sin backend hasta
    // que se reinicie la app.
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('reintenta el arranque si falló, sin dejar el POS sin backend para siempre', async () => {
    spawn.mockRejectedValueOnce(new Error('el antivirus tenía el archivo bloqueado'));
    await expect(llamar('listar_clientes')).rejects.toThrow(/No se pudo lanzar/);

    await conectar();

    expect(spawn).toHaveBeenCalledTimes(2);
  });
});