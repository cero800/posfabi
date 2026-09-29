// Prueba del modo stdio: arranca el sidecar como proceso hijo y le habla
// JSON-RPC por un pipe, que es exactamente lo que hará el shell de Tauri.
//
//   TIENDA_DATA_DIR=/tmp/x node scripts/prueba-stdio.mjs [puerto]
//
// No es un test de vitest porque necesita el binario compilado y un proceso de
// verdad: lo que se comprueba aquí es que el empaquetado por `externalBin`
// tendrá un canal que funciona, no solo la función que lo implementa.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BINARIO = path.join(RAIZ, 'packages', 'db', 'build', 'main.cjs');

const hijo = spawn(process.execPath, [BINARIO], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
});

let pendiente = '';
let id = 0;

const espera = new Map();

hijo.stdout.setEncoding('utf8');
hijo.stdout.on('data', (trozo) => {
  pendiente += trozo;
  for (let corte = pendiente.indexOf('\n'); corte >= 0; corte = pendiente.indexOf('\n')) {
    const linea = pendiente.slice(0, corte);
    pendiente = pendiente.slice(corte + 1);
    if (linea.trim() === '') continue;
    const r = JSON.parse(linea);
    const fn = espera.get(r.id);
    if (fn !== undefined) {
      espera.delete(r.id);
      fn(r);
    } else {
      // Solo pasa con la línea corrupta: un `id: null` es la respuesta a algo
      // que no se puede emparejar con ninguna petición, y por eso lleva `null`
      // y no un número inventado.
      console.log(`  (respuesta sin emparejar: ${linea.slice(0, 72)}…)`);
    }
  }
});

const stderr = [];
hijo.stderr.setEncoding('utf8');
hijo.stderr.on('data', (t) => stderr.push(t));

/** Manda una petición y espera su respuesta por id. */
function llamar(method, params) {
  id += 1;
  const mio = id;
  const peticion = { jsonrpc: '2.0', id: mio, method };
  if (params !== undefined) peticion.params = params;
  return new Promise((cumplir, fallar) => {
    // Se guarda el id enviado en la respuesta: comparar contra el contador
    // global daria un falso positivo en cuanto se llamara a algo despues.
    espera.set(mio, (r) => cumplir({ ...r, enviado: mio }));
    hijo.stdin.write(JSON.stringify(peticion) + '\n', (e) => {
      if (e) fallar(e);
    });
    setTimeout(() => {
      if (espera.has(mio)) {
        espera.delete(mio);
        fallar(new Error(`${method}: sin respuesta en 5 s`));
      }
    }, 5000);
  });
}

function mostrar(etiqueta, r) {
  const s = r.result;
  const resumen = s.ok
    ? `ok ${JSON.stringify(s.data).slice(0, 70)}`
    : `ERROR [${s.error.codigo}] ${s.error.mensaje}`;
  console.log(`  ${etiqueta.padEnd(26)} ${resumen}`);
}

let fallos = 0;
function comprobar(etiqueta, condicion, detalle = '') {
  if (condicion) {
    console.log(`  ✓ ${etiqueta}`);
  } else {
    console.log(`  ✗ ${etiqueta} ${detalle}`);
    fallos += 1;
  }
}

console.log('esperando a que el backend arranque…');
try {
  const arranque = await llamar('estado_sistema');
  const d = arranque.result.data;
  console.log(
    `  esquema v${d.version_esquema} · ${d.procedures} procedures · ` +
      `pid ${d.pid} · base ${d.base}\n`,
  );

  console.log('recorrido por el pipe:');
  mostrar('estado_sistema', arranque);
  mostrar('listar_clientes', await llamar('listar_clientes'));
  mostrar('crear_cliente', await llamar('crear_cliente', {
    cliente: { nombre: 'Cliente por Pipe', documento: 'J-76543210', dias_credito: 15, limite_credito: 5000, activo: true },
  }));
  const producto = await llamar('crear_producto', {
    producto: { codigo: 'PIPE-1', nombre: 'Prueba por pipe', unidad_medida: 'unidad', precio_base: 250, activo: true },
  });
  mostrar('crear_producto', producto);
  const pid = producto.result.data;
  mostrar('registrar_entrada', await llamar('registrar_entrada_mercancia', {
    entrada: { producto_id: pid, cantidad: 5, costo_unitario: 120, operador_id: 1, fecha: '2026-01-15' },
  }));
  mostrar('crear_venta (sin caja)', await llamar('crear_venta', {
    venta: {
      cliente_id: 1, tipo: 'contado', descuento: 0, operador_id: 1,
      detalles: [{ producto_id: pid, cantidad: 1 }],
      pagos: [{ monto: 250, tipo_pago: 'efectivo', moneda: 'usd' }],
    },
  }));
  mostrar('abrir_caja', await llamar('abrir_caja', { caja: { operador_id: 1 } }));
  mostrar('crear_venta', await llamar('crear_venta', {
    venta: {
      cliente_id: 1, tipo: 'contado', descuento: 0, operador_id: 1,
      detalles: [{ producto_id: pid, cantidad: 1 }],
      pagos: [{ monto: 250, tipo_pago: 'efectivo', moneda: 'usd' }],
    },
  }));
  mostrar('crear_venta (sin stock)', await llamar('crear_venta', {
    venta: {
      cliente_id: 1, tipo: 'contado', descuento: 0, operador_id: 1,
      detalles: [{ producto_id: pid, cantidad: 999 }],
      pagos: [{ monto: 250, tipo_pago: 'efectivo', moneda: 'usd' }],
    },
  }));
  mostrar('no_existe', await llamar('no_existe'));
  mostrar('obtener_venta (sin id)', await llamar('obtener_venta'));

  console.log('\ncomprobaciones:');
  const creado = await llamar('listar_clientes');
  comprobar(
    'el cliente creado por el pipe está en la base',
    creado.result.ok && creado.result.data.some((c) => c.documento === 'J-76543210'),
  );
  const venta = await llamar('listar_ventas');
  comprobar('la venta quedó registrada', venta.result.ok && venta.result.data.length === 1);
  comprobar('el total de la venta es el esperado', venta.result.data[0]?.total === 250);
  const stock = await llamar('listar_stock');
  comprobar(
    'el stock bajó lo vendido',
    stock.result.data.find((s) => s.producto_id === pid)?.cantidad_disponible === 4,
  );
  // Cada respuesta vuelve con el mismo id que se mandó. Sin esto, un cliente que
  // espera varias cosas a la vez empareja la respuesta equivocada.
  comprobar('el id de la respuesta vuelve intacto', venta.id === venta.enviado,
    `(enviado ${venta.enviado}, recibido ${venta.id})`);

  // Una línea que no es JSON, seguida de una válida: el proceso tiene que
  // seguir respondiendo. Es el caso de una escritura a medias.
  hijo.stdin.write('esto no es json\n');
  const despues = await llamar('listar_categorias');
  comprobar('sigue respondiendo tras una línea corrupta', despues.result.ok);
} catch (e) {
  console.log(`  ✗ excepción: ${e.message}`);
  fallos += 1;
}

console.log('\nlo que salió por stderr:');
for (const linea of stderr.join('').split('\n')) {
  if (linea.trim() !== '') console.log(`  | ${linea}`);
}

// Cerrar: el proceso tiene que irse solo cuando el shell cierra su lado del pipe,
// que es lo que pasa al cerrar la ventana de la app.
hijo.stdin.end();
const salio = await Promise.race([
  new Promise((c) => hijo.once('exit', (codigo) => c(codigo))),
  new Promise((c) => setTimeout(() => c('tiempo agotado'), 3000)),
]);
comprobar('el proceso se cierra cuando el shell cierra el pipe', salio !== 'tiempo agotado', `(${salio})`);
comprobar('sale con código 0', salio === 0, `(${salio})`);

console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
