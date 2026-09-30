// Cliente del backend: arranca el sidecar y le habla JSON-RPC por stdio.
//
// ## Qué es el backend
//
// Toda la lógica del POS —la base, las ventas, la caja, la impresión, los
// respaldos— está en `packages/db`, un proceso aparte escrito en TypeScript que
// Tauri lanza desde `externalBin`. No es un comando de Rust: es un programa que
// corre junto a la app, abre la base y contesta peticiones.
//
// El cable es JSON-RPC 2.0 sobre la entrada y la salida estándar, una petición
// por línea. Antes esto eran `invoke()` contra comandos de Rust, que ya no
// existen. Lo único que queda en Rust es `rutas_app`, para resolver las carpetas.
//
// ## Por qué el arranque es perezoso
//
// El sidecar no se lanza al abrir la ventana sino en la primera llamada, y se
// comparte entre todas. Dos razones: la ventana aparece antes y sin bloquearse
// aunque el backend tarde en abrir la base, y una app que falla al arrancar deja
// de avisar. Si el arranque falla, la promesa se suelta y la siguiente llamada lo
// intenta otra vez, para que un error transitorio no deje el POS muerto.
//
// ## Cuándo muere el backend
//
// Se cierra solo cuando se le cierra la entrada estándar, que es lo que pasa
// cuando Tauri cierra la app. Por eso este archivo no mata nada: no hace falta, y
// un `kill` a destiempo sería peor que no tener ninguno.

import { invoke } from '@tauri-apps/api/core';
import { Command } from '@tauri-apps/plugin-shell';
import type { Child } from '@tauri-apps/plugin-shell';

/** El nombre con el que el sidecar aparece en `externalBin` y en la capability. */
const PROGRAMA = 'tienda-db';

/** El sobre que devuelve el backend. */
type Sobre<T> = { ok: true; data: T } | { ok: false; error: { mensaje: string; codigo?: string } };

/** Lo que devuelve `rutas_app`, el único comando que queda en Rust. */
interface Rutas {
  data_dir: string;
  document_dir: string;
}

/** Como lo devuelve `estado_sistema`. */
export interface EstadoSistema {
  version_esquema: number;
  version_esperada: number;
  base: string;
  datos: string;
  documentos: string;
  configuracion_pendiente: boolean;
  procedures: number;
  node: string;
  pid: number;
}

/**
 * Error de una respuesta con `ok: false`.
 *
 * El mensaje se muestra al cajero tal cual, sin traducirlo ni mapear el código:
 * los del backend están escritos para eso. Guardar el código aparte es lo que
 * permitirá distinguirlos más adelante sin volver a tocar los textos.
 */
export class ErrorBackend extends Error {
  constructor(
    readonly mensaje: string,
    readonly codigo?: string,
  ) {
    super(mensaje);
    this.name = 'ErrorBackend';
  }
}

interface Pendiente {
  resolver: (valor: unknown) => void;
  rechazar: (error: Error) => void;
}

interface Conexion {
  escribir: (linea: string) => Promise<void>;
  siguienteId: () => number;
  pendientes: Map<string, Pendiente>;
}

/**
 * Cuántas líneas de `stderr` se guardan para el diagnóstico.
 *
 * El backend escribe sus avisos ahí —el de arranque entre ellos— y en una app sin
 * consola es la única explicación disponible cuando algo sale mal. Con veinte
 * alcanza para el arranque y para el error que mata el proceso, y no crece sin
 * límite si el backend se queja en bucle.
 */
const LINEAS_DIAGNOSTICO = 20;

/**
 * Cuánto se espera a que el backend responda antes de rendirse.
 *
 * El backend atiende en paralelo y lo normal son milisegundos, pero hay dos
 * cosas que se llevan su tiempo: imprimir un ticket y copiar un respaldo de una
 * base grande. Un minuto es holgado para ambas y, cuando se supera, es que algo
 * está mal de verdad —un ticket atascado en la cola de Windows, una base
 * bloqueada— y mejor fallar que dejar la pantalla cargando para siempre.
 */
const TIEMPO_LIMITE_MS = 60_000;

// La conexión se arma una vez y se comparte. Guardar la promesa y no el resultado
// es lo que evita que dos llamadas simultáneas —y las hay, la app carga varias
// pantallas a la vez— lancen dos procesos.
let conexion: Promise<Conexion> | null = null;

/** Limpia la conexión. Solo para las pruebas. */
export function reiniciarCliente(): void {
  conexion = null;
}

function arrancar(): Promise<Conexion> {
  const pendiente = resolverRutas().then(lanzar).then(confirmar);
  conexion = pendiente;
  // Un arranque fallido no debe dejar el POS sin backend para el resto de la
  // sesión: se suelta la conexión para que la siguiente llamada lo reintente.
  pendiente.catch(() => {
    if (conexion === pendiente) conexion = null;
  });
  return pendiente;
}

/** El backend corre aparte y no puede usar `app.path()` de Tauri; se lo preguntamos. */
function resolverRutas(): Promise<Rutas> {
  return invoke<Rutas>('rutas_app');
}

async function lanzar(rutas: Rutas): Promise<Conexion> {
  const comando = Command.sidecar(PROGRAMA, [], {
    // Las carpetas viajan por entorno porque el backend es otro proceso y no puede
    // preguntar a Tauri. Sin esto usaría sus valores por defecto, que en Windows
    // coinciden, pero si el usuario movió Documentos no.
    env: {
      TIENDA_DATA_DIR: rutas.data_dir,
      TIENDA_DOC_DIR: rutas.document_dir,
    },
  });

  const pendientes = new Map<string, Pendiente>();
  const diagnostico: string[] = [];
  let id = 0;

  // El mando se convierte en proceso al lanzarlo, y es el proceso —no el mando—
  // quien tiene la entrada estándar. La conexión solo se entrega después de
  // `spawn()` haber resuelto, así que para cuando alguien escriba, `hijo` ya
  // está puesto.
  let hijo: Child | null = null;

  const con: Conexion = {
    async escribir(linea) {
      if (hijo === null) throw new Error('el backend todavía no está lanzado');
      await hijo.write(`${linea}\n`);
    },
    siguienteId: () => ++id,
    pendientes,
  };

  // `stdout` es el protocolo. El plugin entrega una línea por evento, que es
  // justo lo que necesita un formato de una petición por línea.
  comando.stdout.on('data', (linea) => {
    const texto = String(linea).trim();
    if (texto !== '') recibir(texto, pendientes);
  });

  // `stderr` es para diagnóstico. El backend se escribe sus propios registros en
  // `errores.log`, así que aquí no se reenvía nada al archivo: se guarda lo último
  // para poder explicar una muerte y se enseña en la consola del webview, que en
  // desarrollo está y en la app se abre con las herramientas de desarrollo.
  comando.stderr.on('data', (linea) => {
    const texto = String(linea).trim();
    if (texto === '') return;
    diagnostico.push(texto);
    if (diagnostico.length > LINEAS_DIAGNOSTICO) diagnostico.shift();
    console.warn('[tienda-db]', texto);
  });

  comando.on('error', (mensaje) => {
    fallarTodos(pendientes, `No se pudo iniciar el backend: ${mensaje}`);
  });

  comando.on('close', (evento) => {
    const detalle = evento.code === null ? 'por señal' : `con código ${evento.code}`;
    const ultimo = diagnostico.slice(-5).join(' | ');
    fallarTodos(
      pendientes,
      `El backend se cerró ${detalle}.` + (ultimo === '' ? '' : ` Último mensaje: ${ultimo}`),
    );
    // Se suelta la conexión para que el backend se vuelva a lanzar en la
    // siguiente llamada. El POS se recupera solo de una caída en vez de quedar
    // muerto hasta que se reinicie la app, y no es un bucle: cada relanzamiento
    // lo provoca una acción del cajero, no un temporizador.
    conexion = null;
  });

  try {
    hijo = await comando.spawn();
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    throw new Error(
      `No se pudo lanzar «${PROGRAMA}». Suele significar que el backend no está compilado: ` +
        `en la PC de la tienda se genera con \`pnpm --filter @tienda/db build:sea\`. ` +
        `Detalle: ${detalle}`,
    );
  }

  return con;
}

function recibir(linea: string, pendientes: Map<string, Pendiente>): void {
  let envelope: { id?: unknown; result?: Sobre<unknown> };
  try {
    envelope = JSON.parse(linea) as { id?: unknown; result?: Sobre<unknown> };
  } catch {
    // Una línea que no es JSON no puede ser una respuesta. No es motivo para
    // tumbar la conexión: se ignora y sigue.
    return;
  }

  // Un sobre sin `id` es un error del transporte sin petición a la que
  // atribuírselo —cuerpo HTTP roto, lote mal formado—. No hay a quién rechazarle.
  if (envelope.id === null || envelope.id === undefined) return;

  const clave = String(envelope.id);
  const pendiente = pendientes.get(clave);
  if (!pendiente) return;

  pendientes.delete(clave);

  // El resultado va dentro de `result`, no en la raíz: es lo que devuelve
  // `packages/db` y lo que también vale para un backend que hable HTTP.
  const sobre = envelope.result;
  if (sobre === undefined || sobre === null) {
    pendiente.rechazar(new Error(`El backend no devolvió resultado para «${clave}».`));
    return;
  }

  if (sobre.ok) {
    pendiente.resolver(sobre.data);
  } else {
    pendiente.rechazar(new ErrorBackend(sobre.error.mensaje, sobre.error.codigo));
  }
}

function fallarTodos(pendientes: Map<string, Pendiente>, mensaje: string): void {
  // Se vacía antes de rechazar: `rechazar` puede disparar código que vuelva a
  // llamar, y con el mapa lleno se entraría en recursión.
  const enVuelo = [...pendientes.values()];
  pendientes.clear();
  for (const p of enVuelo) p.rechazar(new Error(mensaje));
}

/**
 * Confirma que el backend arrancó de verdad.
 *
 * Haber lanzado el proceso no es lo mismo que tener un backend: puede arrancar y
 * quedarse sin poder abrir la base, y eso solo se descubre preguntándole algo.
 * `estado_sistema` es la llamada indicada —no toca datos de negocio— y de paso
 * deja a la vista con qué versión del esquema se está hablando.
 */
async function confirmar(con: Conexion): Promise<Conexion> {
  await pedir(con, 'estado_sistema', {});
  return con;
}

/** Envía una petición y espera su respuesta. */
function pedir<T>(con: Conexion, metodo: string, params: unknown): Promise<T> {
  const id = con.siguienteId();
  const clave = String(id);

  return new Promise<T>((resolver, rechazar) => {
    // El temporizador se limpia al responder, salga bien o mal. Dejarlo vivo
    // retiene el `rechazar` de la promesa y la fila del mapa durante un minuto por
    // cada petición que sí se respondió.
    const reloj = setTimeout(() => {
      if (!con.pendientes.delete(clave)) return;
      rechazar(new Error(`El backend no respondió a «${metodo}» a tiempo.`));
    }, TIEMPO_LIMITE_MS);

    con.pendientes.set(clave, {
      resolver: (valor) => {
        clearTimeout(reloj);
        resolver(valor as T);
      },
      rechazar: (error) => {
        clearTimeout(reloj);
        rechazar(error);
      },
    });

    const peticion = JSON.stringify({ jsonrpc: '2.0', id, method: metodo, params });

    con.escribir(peticion).catch((e: unknown) => {
      if (!con.pendientes.delete(clave)) return;
      clearTimeout(reloj);
      const detalle = e instanceof Error ? e.message : String(e);
      rechazar(new Error(`No se pudo enviar «${metodo}» al backend: ${detalle}`));
    });
  });
}

/**
 * Llama a un procedure del backend y devuelve su `data`.
 *
 * Rejecta con `ErrorBackend` cuando el backend contesta `ok: false`, y con
 * `Error` si el problema es de transporte: no arrancó, se cerró, no contestó.
 */
export async function llamar<T>(metodo: string, params: unknown = {}): Promise<T> {
  const con = await (conexion ?? arrancar());
  return pedir<T>(con, metodo, params);
}

/** Estado del backend: esquema, rutas, versión de Node. Para diagnóstico. */
export function estadoSistema(): Promise<EstadoSistema> {
  return llamar<EstadoSistema>('estado_sistema');
}