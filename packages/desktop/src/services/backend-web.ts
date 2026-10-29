// Cliente web del backend (demo) — habla HTTP al modo `--http` del backend.
// Reemplaza `packages/desktop/src/services/backend.ts` en modo demo.

let URL = 'http://localhost:3001';
try {
  if (typeof (globalThis as any).import !== 'undefined' && (globalThis as any).import.meta?.env?.VITE_BACKEND_URL) {
    URL = (globalThis as any).import.meta.env.VITE_BACKEND_URL;
  } else if (typeof process !== 'undefined' && process.env.VITE_BACKEND_URL) {
    URL = process.env.VITE_BACKEND_URL;
  }
} catch { /* ignore */ }

export class ErrorBackend extends Error {
  constructor(readonly mensaje: string, readonly codigo?: string) {
    super(mensaje);
    this.name = 'ErrorBackend';
  }
}

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

async function rpc(method: string, params = {}): Promise<unknown> {
  const res = await fetch(`${URL}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const result = Array.isArray(json) ? json[0]?.result : json.result;
  if (!result || typeof result !== 'object') throw new Error('Respuesta mal formada');
  const sobre = result as { ok: boolean; data?: unknown; error?: { mensaje: string; codigo?: string } };
  if (sobre.ok) return sobre.data;
  throw new ErrorBackend(sobre.error?.mensaje ?? 'Error del backend', sobre.error?.codigo);
}

export const estadoSistema = () => rpc('estado_sistema', {}) as Promise<EstadoSistema>;
export const venta = (p: Record<string, unknown> | undefined) => (rpc('venta', p ?? {}) as Promise<unknown>);
export const seedReset = () => rpc('seed_reset', {});
