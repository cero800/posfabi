// Transporte JSON-RPC 2.0 del backend.
//
// ## Por qué un sobre `{ok, data}` dentro de `result`
//
// JSON-RPC ya tiene un sitio para los errores (`error`), pero aquí no se usa,
// y es deliberado. El shell de Tauri y el cliente HTTP necesitan poder distinguir
// tres cosas que JSON-RPC confunde: un fallo del POS ("no hay stock"), un error
// de programación en el procedure, y un procedure que no existe. Con el sobre
// dentro de `result` las tres viajan siempre por el mismo camino y el shell solo
// tiene que mirar un campo:
//
//   { "jsonrpc": "2.0", "id": 7, "result": { "ok": true,  "data": {...} } }
//   { "jsonrpc": "2.0", "id": 7, "result": { "ok": false, "error": { codigo, mensaje } } }
//
// La ventaja práctica es que `error` nunca aparece a nivel superior: el shell no
// necesita dos ramas de código para "respondió" y "falló", y un procedure que
// devuelve `null` (una caja sin abrir) no se confunde con una respuesta vacía.
//
// ## Encuadre: un JSON por línea
//
// Sobre stdio no hay longitudes ni delimitadores negotiated, así que el
// encuadre tiene que ser explícito. Se usa NDJSON: una petición por línea,
// terminada en `\n`. Es a prueba del contenido porque `JSON.stringify` escapa
// los saltos de línea dentro de las cadenas, así que un valor JSON serializado
// nunca contiene un `\n` crudo. Por el mismo motivo el ticket no viaja como
// bytes: viaja como el `TicketInput` estructurado y el backend genera los bytes
// ESC/POS, que es además lo que evita que la interfaz mande bytes arbitrarios
// a la impresora.
//
// ## stdout es del protocolo
//
// Cualquier `console.log` en cualquier módulo —y también en una dependencia
// futura— corrompería el stream: la línea de log se leería como una respuesta
// JSON y el shell no sabría qué hacer con ella. En modo stdio, `console.log`
// se redirige a stderr al arrancar. No es una defensa perfecta (un `process.
// stdout.write` directo se escapa) pero cubre el caso real, que es el
// `console.log` que alguien dejó en un `catch` mientras depuraba.
//
// ## Concurrencia
//
// Las peticiones se atienden en paralelo, no en fila. La razón es concreta:
// `imprimir_ticket` puede tardar 5 s esperando una impresora apagada, y encolando
// todo detrás de ella la pantalla de venta se quedaría congelada mientras el
// cajero tiene a un cliente esperando. Como el cliente empareja por `id`, el
// orden de las respuestas no importa.
//
// La regla que hace esto seguro: **ningún procedure puede usar la base después
// de un `await`**. `node:sqlite` es síncrono, así que una transacción se
// completa entera sin que nada se cuele en medio; lo único que puede separarse
// del resto es el trabajo de E/S, y ese trabajo no toca la base.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';

import {
  CODIGO_ERROR,
  type SerializedError,
  conCodigo,
  normalizarError,
  sistema,
  validacion,
} from './errors.js';
import { type Rutas } from './paths.js';

//---------------------------------------------------------------------------
// Contrato
//---------------------------------------------------------------------------

/** Lo que un procedure necesita para trabajar. */
export interface Contexto {
  db: DatabaseSync;
  rutas: Rutas;
}

/**
 * Un procedure del dominio.
 *
 * Puede devolver el valor directamente o una promesa. La regla es que la base
 * solo se usa antes del primer `await` (ver la nota de concurrencia arriba).
 */
export type Procedimiento = (ctx: Contexto, args: Args) => unknown | Promise<unknown>;

/** Nombre → procedure. Es lo único que `main.ts` le pasa al transporte. */
export type Registro = ReadonlyMap<string, Procedimiento>;

/** Identificador de la petición. Lo devuelve el cliente tal cual vino. */
export type IdRpc = number | string | null;

export interface PeticionRpc {
  jsonrpc?: unknown;
  id?: IdRpc;
  method?: unknown;
  params?: unknown;
}

export interface SobreOk {
  ok: true;
  data: unknown;
}

export interface SobreError {
  ok: false;
  error: SerializedError;
}

export type Sobre = SobreOk | SobreError;

export interface RespuestaRpc {
  jsonrpc: '2.0';
  id: IdRpc;
  result: Sobre;
}

//---------------------------------------------------------------------------
// Lectura de argumentos
//---------------------------------------------------------------------------

/**
 * Lee los `params` de una petición con nombre y falla con un mensaje concreto
 * cuando falta un dato o viene con el tipo equivocado.
 *
 * Hace dos cosas que un `params as T` no hace. Una: valida, porque el frontend
 * y el backend se despliegan por separado y un campo renombrado produce un
 * `undefined` silencioso que SQLite convierte en `NULL`, y `NULL` en un `id`
 * significa "producto no encontrado" —un mensaje que culpa al dato en vez de al
 * código. Dos: acepta el nombre en `snake_case` y en `camelCase`, porque el
 * frontend que hay hoy mezcla las dos convenciones y `services/db.ts` se
 * reescribe en la fase 8. Tolera las dos ahora para que el cambio sea cosmético
 * y no un arreglo de nombres en el mismo commit.
 */
export class Args {
  private readonly datos: Record<string, unknown>;

  constructor(params: unknown) {
    if (params === undefined || params === null) {
      this.datos = {};
    } else if (typeof params === 'object' && !Array.isArray(params)) {
      this.datos = params as Record<string, unknown>;
    } else {
      // JSON-RPC admite `params` como arreglo posicional, pero los procedures de
      // aquí reciben un objeto con nombre. Aceptar el arreglo obligaría a
      // guardar el orden de los parámetros de cada procedure en dos sitios.
      throw validacion(
        'Los parámetros deben enviarse como objeto con nombres, no como lista',
      );
    }
  }

  /** Busca la primera clave presente entre los alias dados. */
  private buscar(...nombres: string[]): { clave: string; valor: unknown } | null {
    for (const clave of nombres) {
      if (Object.hasOwn(this.datos, clave) && this.datos[clave] !== undefined) {
        return { clave, valor: this.datos[clave] };
      }
    }
    return null;
  }

  private obligatorio(...nombres: string[]): { clave: string; valor: unknown } {
    const encontrado = this.buscar(...nombres);
    if (encontrado === null) {
      throw validacion(`Falta el dato «${nombres[0]}» en la petición`);
    }
    return encontrado;
  }

  /** Entero obligatorio. Rechaza `NaN`, decimales y strings numéricos. */
  entero(...nombres: string[]): number {
    const { clave, valor } = this.obligatorio(...nombres);
    if (typeof valor !== 'number' || !Number.isInteger(valor)) {
      throw validacion(`El dato «${clave}» debe ser un número entero`);
    }
    return valor;
  }

  /** Entero opcional: `null` y `undefined` significan "no viene". */
  enteroOpc(...nombres: string[]): number | null {
    const encontrado = this.buscar(...nombres);
    if (encontrado === null || encontrado.valor === null) return null;
    return this.entero(encontrado.clave);
  }

  /** Número (entero o con decimales) obligatorio. */
  numero(...nombres: string[]): number {
    const { clave, valor } = this.obligatorio(...nombres);
    if (typeof valor !== 'number' || !Number.isFinite(valor)) {
      throw validacion(`El dato «${clave}» debe ser un número`);
    }
    return valor;
  }

  /** Cadena obligatoria. No se recorta: el recorte es decisión de cada campo. */
  texto(...nombres: string[]): string {
    const { clave, valor } = this.obligatorio(...nombres);
    if (typeof valor !== 'string') {
      throw validacion(`El dato «${clave}» debe ser texto`);
    }
    return valor;
  }

  /** Cadena opcional; `null` y `undefined` se normalizan a `null`. */
  textoOpc(...nombres: string[]): string | null {
    const encontrado = this.buscar(...nombres);
    if (encontrado === null || encontrado.valor === null) return null;
    return this.texto(encontrado.clave);
  }

  /**
   * Bandera opcional.
   *
   * Acepta el string `"true"`/`"false"` porque el destino de la impresora se
   * serializa a JSON dentro de la tabla de configuración y ahí los booleanos
   * ya pueden haber pasado por un `parse` de texto.
   */
  bandera(nombre: string, porDefecto = false): boolean {
    const encontrado = this.buscar(nombre);
    if (encontrado === null || encontrado.valor === null) return porDefecto;
    const { valor } = encontrado;
    if (typeof valor === 'boolean') return valor;
    if (valor === 'true') return true;
    if (valor === 'false') return false;
    throw validacion(`El dato «${nombre}» debe ser verdadero o falso`);
  }

  /**
   * Objeto anidado obligatorio, ya tipado por el dominio.
   *
   * No se valida la forma: la hacen los validadores de cada módulo
   * (`validators.ts`), que es donde viven los mensajes que el cajero lee. Aquí
   * solo se comprueba que sea un objeto, para que un `null` no llegue a un
   * `SELECT` y produzca un error de SQLite en vez del mensaje del validador.
   */
  objeto<T>(...nombres: string[]): T {
    const { clave, valor } = this.obligatorio(...nombres);
    if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
      throw validacion(`El dato «${clave}» debe ser un objeto`);
    }
    return valor as T;
  }

  /** Lista obligatoria de elementos de tipo `T`. */
  lista<T>(...nombres: string[]): T[] {
    const { clave, valor } = this.obligatorio(...nombres);
    if (!Array.isArray(valor)) {
      throw validacion(`El dato «${clave}» debe ser una lista`);
    }
    return valor as T[];
  }

  /** ¿Viene este dato? Para los opcionales cuyo valor por defecto importa. */
  tiene(...nombres: string[]): boolean {
    return this.buscar(...nombres) !== null;
  }
}

//---------------------------------------------------------------------------
// Despacho
//---------------------------------------------------------------------------

/** Envuelve un error del dominio en el sobre que viaja por el cable. */
export function sobreError(e: { toJSON(): SerializedError }): SobreError {
  return { ok: false, error: e.toJSON() };
}

/**
 * Atiende una petición y devuelve la respuesta.
 *
 * Nunca lanza: un procedure que revienta por una excepción de SQLite, por un
 * `undefined` en un campo o por un nombre que no existe, produce un sobre de
 * error. Si esta función lanzara, el shell tendría que distinguir "falló la
 * lógica" de "se rompió el transporte", que es justo lo que se quiso evitar.
 */
export async function atender(
  registro: Registro,
  ctx: Contexto,
  peticion: unknown,
): Promise<RespuestaRpc> {
  // El id se saca antes de validar nada: aunque la petición no tenga forma, hay
  // que contestarle a alguien o el cliente queda esperando para siempre.
  const crudo = peticion as PeticionRpc | null;
  const id: IdRpc =
    crudo !== null && typeof crudo === 'object' && (crudo.id === null || typeof crudo.id === 'string' || typeof crudo.id === 'number')
      ? crudo.id
      : null;

  try {
    if (crudo === null || typeof crudo !== 'object' || Array.isArray(crudo)) {
      throw validacion('La petición no es un objeto JSON-RPC');
    }
    if (typeof crudo.method !== 'string' || crudo.method === '') {
      throw validacion('La petición no dice qué procedure pide (`method`)');
    }

    const method = String(crudo.method).trim();
    let procedimiento = registro.get(method);
    if (procedimiento === undefined) {
      const normalizados = [
        method.replace(/\s+/g, '_'),
        method.replace(/-/g, '_'),
        method.replace(/_/g, ' '),
        method.replace(/_/g, '-'),
        method.toLowerCase(),
        method.toLowerCase().replace(/\s+/g, '_'),
        method.toLowerCase().replace(/-/g, '_'),
      ];
      for (const candidato of normalizados) {
        procedimiento = registro.get(candidato);
        if (procedimiento !== undefined) break;
      }
    }
    if (procedimiento === undefined) {
      throw conCodigo(
        CODIGO_ERROR.metodo_desconocido,
        `No existe el procedure «${crudo.method}»`,
      );
    }

    const args = new Args(crudo.params);
    const data = await procedimiento(ctx, args);
    return { jsonrpc: '2.0', id, result: { ok: true, data: data ?? null } };
  } catch (e) {
    return { jsonrpc: '2.0', id, result: sobreError(normalizarError(e)) };
  }
}

//---------------------------------------------------------------------------
// Salida en serie
//---------------------------------------------------------------------------

/**
 * Escribe las respuestas de una en una.
 *
 * `process.stdout.write` es asíncrono cuando el pipe está lleno, y con una
 * factura de 40 KB más un `.xlsx` de 200 KB es fácil llenarlo. Sin esta cola, dos
 * respuestas que se cruzan se entrelazan en el archivo y el shell lee un JSON
 * partido. Se encadena con una promesa para que cada línea se escriba completa
 * antes de empezar la siguiente.
 */
export class Escritor {
  private cola: Promise<void> = Promise.resolve();
  private readonly escribirLinea: (linea: string) => void;

  constructor(escribirLinea: (linea: string) => void) {
    this.escribirLinea = escribirLinea;
  }

  /** Encola una respuesta. Devuelve la promesa de la cola para poder drenar. */
  enviar(respuesta: RespuestaRpc): Promise<void> {
    this.cola = this.cola.then(() => {
      try {
        this.escribirLinea(JSON.stringify(respuesta));
      } catch (e) {
        // Un `data` con un ciclo o un BigInt no se serializa. Contestar es
        // obligatorio aunque sea para decir que no se pudo serializar: si no,
        // el cliente espera para siempre sin saber por qué.
        this.escribirLinea(
          JSON.stringify({
            jsonrpc: '2.0',
            id: respuesta.id,
            result: sobreError(sistema(`Respuesta no serializable: ${detalle(e)}`)),
          }),
        );
      }
    });
    return this.cola;
  }

  /** Espera a que se vacíe la cola. Para cerrar con orden. */
  drenar(): Promise<void> {
    return this.cola;
  }
}

function detalle(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

//---------------------------------------------------------------------------
// Modo stdio
//---------------------------------------------------------------------------

/**
 * Redirige `console.log` a stderr.
 *
 * Solo en modo stdio. En modo `--http` stdout no lleva el protocolo y los logs
 * por ahí son más fáciles de leer a mano con `curl`.
 */
export function silenciarConsola(): void {
  console.log = (...partes: unknown[]): void => {
    console.error(...partes);
  };
}

export interface ServidorStdio {
  /** Cierra la entrada y espera a que se vacíe la cola de salida. */
  cerrar(): Promise<void>;
  /** Errores de escritura del pipe (el shell murió). Se relanza para que se vean. */
  readonly error: Promise<never>;
}

/**
 * Sirve el protocolo por stdin/stdout, un JSON por línea.
 *
 * Se atienden en paralelo a propósito: una impresión a una impresora apagada no
 * puede congelar la venta que viene detrás (ver la nota de concurrencia).
 */
export function servirStdio(
  registro: Registro,
  ctx: Contexto,
  entrada: NodeJS.ReadableStream = process.stdin,
  salida: NodeJS.WritableStream = process.stdout,
): ServidorStdio {
  const escritor = new Escritor((linea) => {
    salida.write(linea + '\n');
  });

  // Si el shell se cierra, escribir en el pipe lanza EPIPE. Sin este manejador
  // Node lanza una excepción no capturada y el proceso muere con un volcado de
  // pila en stderr, que es ruido: el shell ya no está, no hay a quién avisarle.
  const fallo = new Promise<never>((_, rechazar) => {
    salida.on('error', rechazar);
  });
  fallo.catch(() => {
    /* se observa en `cerrar()` y al salir del proceso */
  });

  let resto = '';
  entrada.setEncoding('utf8');
  entrada.on('data', (trozo: string | Buffer) => {
    resto += typeof trozo === 'string' ? trozo : trozo.toString('utf8');
    // Bucle en vez de un `split` por evento: un solo `data` puede traer varias
    // peticiones, y solo la última puede estar incompleta.
    for (let corte = resto.indexOf('\n'); corte >= 0; corte = resto.indexOf('\n')) {
      const linea = resto.slice(0, corte);
      resto = resto.slice(corte + 1);
      const limpia = linea.trim();
      if (limpia === '') continue;
      void despacharLinea(limpia);
    }
  });

  async function despacharLinea(linea: string): Promise<void> {
    let peticion: unknown;
    try {
      peticion = JSON.parse(linea);
    } catch {
      await escritor.enviar({
        jsonrpc: '2.0',
        id: null,
        result: sobreError(validacion('La línea no es JSON válido')),
      });
      return;
    }
    await escritor.enviar(await atender(registro, ctx, peticion));
  }

  return {
    error: fallo,
    cerrar: async () => {
      entrada.pause();
      await escritor.drenar();
    },
  };
}

//---------------------------------------------------------------------------
// Modo http
//---------------------------------------------------------------------------

/** Puerto por defecto del modo de desarrollo. */
export const PUERTO_POR_DEFECTO = 3001;

/**
 * Direcciones a las que se puede escuchar sin abrir la base a la red.
 *
 * El modo `--http` existe para depurar con `curl` desde la misma máquina. Un
 * POS de mostrador no necesita que su base de datos sea alcanzable desde el
 * wi-fi de la tienda, así que el valor por defecto es el bucle local y abrirlo a
 * otra cosa tiene que ser un acto deliberado: `--host 0.0.0.0`.
 */
export const HOSTS_PERMITIDOS = ['127.0.0.1', 'localhost', '::1'];

export interface OpcionesHttp {
  puerto: number;
  host: string;
}

export interface ServidorHttp {
  servidor: Server;
  /** Puerto real, útil cuando se pidió el 0 y el sistema eligió uno. */
  puerto(): number;
  cerrar(): Promise<void>;
}

/**
 * Sirve el mismo protocolo por HTTP, para poder probarlo sin Tauri.
 *
 * `POST /rpc` (o cualquier otra ruta) acepta una petición o una lista de
 * peticiones y contesta igual. `GET /salud` responde con el estado del backend
 * sin tocar la base, que es lo que consulta el shell para saber que el puerto ya
 * está escuchando.
 */
export function servirHttp(
  registro: Registro,
  ctx: Contexto,
  opciones: OpcionesHttp,
  aviso: (linea: string) => void = (l) => console.error(l),
): Promise<ServidorHttp> {
  const servidor = createServer((req, res) => {
    manejarHttp(registro, ctx, req, res).catch((e) => {
      aviso(`[rpc] fallo atendiendo ${req.method} ${req.url}: ${detalle(e)}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      }
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          result: sobreError(sistema(`Fallo interno del servidor: ${detalle(e)}`)),
        }),
      );
    });
  });

  return new Promise((cumplir, fallar) => {
    servidor.once('error', fallar);
    servidor.listen(opciones.puerto, opciones.host, () => {
      servidor.removeListener('error', fallar);
      const direccion = servidor.address();
      const puerto = typeof direccion === 'object' && direccion !== null ? direccion.port : opciones.puerto;
      if (!HOSTS_PERMITIDOS.includes(opciones.host)) {
        aviso(
          `[tienda-db] aviso: escuchando en ${opciones.host}:${puerto}. Cualquiera que ` +
            'llegue a esa dirección puede vender, cobrar y leer la base de la tienda.',
        );
      }
      cumplir({
        servidor,
        puerto: () => puerto,
        cerrar: () =>
          new Promise<void>((hecho) => {
            servidor.close(() => hecho());
            // Las conexiones abiertas (un `curl` colgado) no dejan cerrar el
            // servidor, y el proceso no se puede ir. Se cortan.
            servidor.closeAllConnections?.();
          }),
      });
    });
  });
}

async function manejarHttp(
  registro: Registro,
  ctx: Contexto,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method === 'GET' && (req.url === '/salud' || req.url === '/health')) {
    // El sobre se devuelve plano, sin la envoltura JSON-RPC: esto lo consulta un
    // `curl` o el shell, no el cliente RPC, y un nivel menos se lo hace más
    // legible a alguien que abre el navegador para ver si el backend vive.
    const respuesta = await atender(registro, ctx, {
      jsonrpc: '2.0',
      id: null,
      method: 'estado_sistema',
    });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(respuesta.result));
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        result: sobreError(validacion('Use POST para llamar a un procedure')),
      }),
    );
    return;
  }

  const cuerpo = await leerCuerpo(req);
  let peticion: unknown;
  try {
    peticion = JSON.parse(cuerpo === '' ? 'null' : cuerpo);
  } catch {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        result: sobreError(validacion('El cuerpo no es JSON válido')),
      }),
    );
    return;
  }

  // JSON-RPC admite lotes. Se atienden en paralelo y se devuelven en el mismo
  // orden de entrada, que es lo que espera cualquier cliente del protocolo.
  if (Array.isArray(peticion)) {
    if (peticion.length === 0) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          result: sobreError(validacion('La lista de peticiones está vacía')),
        }),
      );
      return;
    }
    const respuestas = await Promise.all(peticion.map((p) => atender(registro, ctx, p)));
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(respuestas));
    return;
  }

  const respuesta = await atender(registro, ctx, peticion);
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(respuesta));
}

/** Lee el cuerpo con un tope. */
const CUERPO_MAXIMO = 64 * 1024 * 1024;

function leerCuerpo(req: IncomingMessage): Promise<string> {
  return new Promise((cumplir, fallar) => {
    const trozos: Buffer[] = [];
    let total = 0;
    req.on('data', (trozo: Buffer) => {
      total += trozo.length;
      if (total > CUERPO_MAXIMO) {
        fallar(sistema('El cuerpo de la petición es demasiado grande'));
        req.destroy();
        return;
      }
      trozos.push(trozo);
    });
    req.on('end', () => cumplir(Buffer.concat(trozos).toString('utf8')));
    req.on('error', fallar);
  });
}
