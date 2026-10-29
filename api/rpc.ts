import { DatabaseSync } from 'node:sqlite';

export default async function handler(req: Request): Promise<Response> {
  const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json; charset=utf-8' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: cors });

  try {
    const body = await req.json();
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('CREATE TABLE IF NOT EXISTS productos (id INTEGER PRIMARY KEY, nombre TEXT, precio INTEGER)');
    db.exec('CREATE TABLE IF NOT EXISTS ventas (id INTEGER PRIMARY KEY, total INTEGER)');
    // Seed básico para demo
    db.prepare('INSERT INTO productos (nombre, precio) VALUES (?, ?)').run('Papel A4', 500);
    db.prepare('INSERT INTO productos (nombre, precio) VALUES (?, ?)').run('Lápiz', 150);

    const method = (body && typeof body === 'object' && body.method) ? String(body.method) : '';

    if (method === 'venta') {
      const params = (body && body.params) || {};
      const items = params.items || [{ cantidad: 1, precio_usd: 500 }];
      const total = items.reduce((s: number, i: unknown) => {
        const item = i as { cantidad?: number; precio_usd?: number };
        return s + (item.precio_usd || 500) * (item.cantidad || 1);
      }, 0);
      db.prepare('INSERT INTO ventas (total) VALUES (?)').run(total);
      const result = { venta_id: db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id || null, result: { ok: true, data: { venta_id: result.id, total: total, pdf_base64: 'JVBERi0xLjQK...' } } }), { status: 200, headers: cors });
    }

    if (method === 'listar_productos') {
      const rows = db.prepare('SELECT * FROM productos').all() as Array<{ id: number; nombre: string; precio: number }>;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id || null, result: { ok: true, data: rows } }), { status: 200, headers: cors });
    }

    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id || null, result: { ok: false, error: { mensaje: 'Método ' + method + ' no soportado en demo' } } }), { status: 200, headers: cors });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 200, headers: cors });
  }
}
