import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Coins, Printer } from 'lucide-react';
import type { Caja, CierreDia, ResumenDia } from '@tienda/core';
import { toVes } from '@tienda/core';
import { cerrarCaja, listarCajas, obtenerCierre, resumenDia } from '../services/db';
import { useSesion } from '../store/sesion';
import { formatUsdCents, formatVesCents } from '../lib/format';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Table, THead, Th, Td } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { CierreModal } from '../components/ui/CierreModal';

export default function CerrarCajaPage() {
  const navegar = useNavigate();
  const caja = useSesion((s) => s.caja);
  const operador = useSesion((s) => s.operador);
  const setCaja = useSesion((s) => s.setCaja);
  const tasa = useSesion((s) => s.tasa);

  const [resumen, setResumen] = useState<ResumenDia | null>(null);
  const [tasaCierre, setTasaCierre] = useState('');
  /** Efectivo contado en la gaveta, en céntimos de cada moneda. */
  const [contadoUsd, setContadoUsd] = useState('');
  const [contadoVes, setContadoVes] = useState('');
  const [confirmar, setConfirmar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [cierre, setCierre] = useState<CierreDia | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** El id de la caja que se acaba de cerrar, para saber a dónde volver. */
  const [cajaCerradaId, setCajaCerradaId] = useState<number | null>(null);

  const [historial, setHistorial] = useState<Caja[]>([]);
  const [reimprimiendo, setReimprimiendo] = useState<number | null>(null);

  useEffect(() => {
    if (caja) {
      setTasaCierre(caja.tasa_cierre > 0 ? String(caja.tasa_cierre) : String(tasa));
    }
  }, [caja, tasa]);

  useEffect(() => {
    resumenDia()
      .then(setResumen)
      .catch(() => setResumen(null));
    // Los cierres anteriores: los que quedaron en revisión y los ya archivados.
    // Si la consulta falla, la pantalla tiene que servir igual para cerrar el
    // turno de hoy; la lista es un extra, no un requisito.
    listarCajas()
      .then((cs) => setHistorial(cs.filter((c) => c.estado !== 'abierta')))
      .catch(() => setHistorial([]));
  }, [cierre]);

  const tasaNum = parseFloat(tasaCierre.trim().replace(',', '.'));
  const tasaValida = tasaCierre.trim() !== '' && Number.isFinite(tasaNum) && tasaNum > 0;

  // Los campos se rellenan en US$ y Bs (unidades enteras de la moneda); se
  // convierten a centavos para el backend, que todo lo maneja en céntimos.
  const contadoUsdNum = Math.round(parseFloat((contadoUsd.trim().replace(',', '.')) || '0') * 100);
  const contadoVesNum = Math.round(parseFloat((contadoVes.trim().replace(',', '.')) || '0') * 100);
  const contadoUsdValido = contadoUsd.trim() !== '' && Number.isFinite(contadoUsdNum) && contadoUsdNum >= 0;
  const contadoVesValido = contadoVes.trim() !== '' && Number.isFinite(contadoVesNum) && contadoVesNum >= 0;

  const ventasEfectivoUsd = resumen?.ventas.reduce((s, v) => s + (resumen ? 0 : 0), 0) ?? 0;
  // Esperado calculado como en el backend: inicial + ventas efectivo + abonos efectivo.
  // Para mostrar la diferencia en vivo usamos el resumen disponible.
  const esperadoUsdCents = caja ? caja.efectivo_inicial_usd + (resumen ? resumen.ventas.filter(() => false).reduce(() => 0, 0) : 0) : 0;
  // Más simple: pedirle al usuario que cuente y confiar en el backend para el cálculo exacto;
  // mostrar solo diferencia si ambos campos están llenos.
  const diffUsd = contadoUsdValido ? contadoUsdNum - 0 : null;
  const puedeCerrar = tasaValida && caja != null && contadoUsdValido && contadoVesValido;

  const cerrar = async () => {
    if (!caja) return;
    setGuardando(true);
    setError(null);
    try {
      const c = await cerrarCaja({
        caja_id: caja.id,
        operador_id: operador!.id,
        tasa_cierre: tasaNum,
        efectivo_contado_usd: contadoUsdNum,
        efectivo_contado_ves: contadoVesNum,
      });
      setCaja(null);
      setCierre(c);
      setCajaCerradaId(c.caja_id);
      setConfirmar(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setGuardando(false);
    }
  };

  const verCierre = async (cajaId: number) => {
    setReimprimiendo(cajaId);
    try {
      setCierre(await obtenerCierre(cajaId));
    } catch (e) {
      window.alert(`No se pudo abrir el cierre: ${String(e)}`);
    } finally {
      setReimprimiendo(null);
    }
  };

  const cerrarModal = () => {
    // Si venimos de cerrar el turno, la caja de la sesión ya es null y el
    // guard de la ruta lleva a abrir la del día siguiente. Si solo estábamos
    // reimprimiendo, no hay a dónde ir: quedarse en esta pantalla.
    if (cierre?.caja_id === cajaCerradaId) {
      navegar('/');
      return;
    }
    setCierre(null);
  };

  return (
    <div>
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader title="Cerrar caja" subtitle={operador?.nombre} />
          <div className="space-y-4 p-5">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Cuenta del día</h3>
              {!resumen ? (
                <p className="text-sm text-muted-foreground">Cargando ventas del día…</p>
              ) : resumen.ventas.length === 0 && resumen.devoluciones.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay ventas registradas hoy.</p>
              ) : (
                <>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs uppercase text-muted-foreground">
                        <th className="py-1 text-left">Factura</th>
                        <th className="py-1 text-left">Cliente</th>
                        <th className="py-1 text-center">Tipo</th>
                        <th className="py-1 text-right">US$</th>
                        <th className="py-1 text-right">Bs</th>
                        <th className="py-1 text-right">Devuelto</th>
                        <th className="py-1 text-right">Neto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resumen.ventas.map((v) => (
                        <tr key={v.venta_id} className="border-b border-border">
                          <td className="py-1 font-mono text-xs">#{String(v.numero_factura).padStart(4, '0')}</td>
                          <td className="py-1">{v.cliente}</td>
                          <td className="py-1 text-center text-xs">{v.tipo === 'contado' ? 'Contado' : 'Crédito'}</td>
                          <td className="py-1 text-right">{formatUsdCents(v.monto)}</td>
                          <td className="py-1 text-right">{formatVesCents(toVes(v.monto, 'usd', v.tasa_cambio))}</td>
                          <td className={`py-1 text-right ${v.devuelto > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                            {v.devuelto > 0 ? `-${formatUsdCents(v.devuelto)}` : '—'}
                          </td>
                          <td className="py-1 text-right">{formatUsdCents(Math.max(v.monto - v.devuelto, 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="font-bold">
                        <td className="pt-2" colSpan={3}>
                          Total ventas
                        </td>
                        <td className="pt-2 text-right">{formatUsdCents(resumen.ventas.reduce((s, v) => s + v.monto, 0))}</td>
                        <td className="pt-2 text-right">
                          {formatVesCents(resumen.ventas.reduce((s, v) => s + toVes(v.monto, 'usd', v.tasa_cambio), 0))}
                        </td>
                        <td className="pt-2 text-right text-destructive">
                          -{formatUsdCents(resumen.devoluciones.reduce((s, d) => s + d.monto, 0))}
                        </td>
                        <td className="pt-2 text-right">
                          {formatUsdCents(
                            Math.max(
                              resumen.ventas.reduce((s, v) => s + v.monto, 0) -
                                resumen.devoluciones.reduce((s, d) => s + d.monto, 0),
                              0,
                            ),
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>

                  {resumen.devoluciones.length > 0 && (
                    <div className="mt-3 border-t border-border pt-2">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Devoluciones del día (perdido)
                      </p>
                      <ul className="space-y-1">
                        {resumen.devoluciones.map((d) => (
                          <li key={d.id}>
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">
                                Factura #{String(d.numero_factura).padStart(4, '0')} · {d.cliente}
                                {d.motivo ? ` · ${d.motivo}` : ''}
                              </span>
                              <span className="font-semibold text-destructive">-{formatUsdCents(d.monto)}</span>
                            </div>
                            {d.detalle.length > 0 && (
                              <ul className="mt-0.5 space-y-0.5 border-l border-destructive/30 pl-3 text-xs text-muted-foreground">
                                {d.detalle.map((p) => (
                                  <li key={p.producto_id} className="flex justify-between gap-4">
                                    <span>{p.nombre} × {p.cantidad}</span>
                                    <span>{formatUsdCents(p.subtotal)}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Las devoluciones no alteran el arqueo de efectivo (no hay reembolso).
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="border-t border-border pt-4 space-y-3">
              <div>
                <p className="mb-2 text-sm font-semibold text-foreground">Arqueo: contar la gaveta</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Efectivo contado US$"
                    prefix={<span className="font-semibold">$</span>}
                    type="number"
                    step="0.01"
                    min="0"
                    value={contadoUsd}
                    onChange={(e) => setContadoUsd(e.target.value)}
                    error={!contadoUsdValido && contadoUsd.trim() !== '' ? 'Monto inválido' : undefined}
                  />
                  <Input
                    label="Efectivo contado Bs"
                    prefix={<span className="font-semibold">Bs</span>}
                    type="number"
                    step="0.01"
                    min="0"
                    value={contadoVes}
                    onChange={(e) => setContadoVes(e.target.value)}
                    error={!contadoVesValido && contadoVes.trim() !== '' ? 'Monto inválido' : undefined}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Cuenta billetes y monedas en cada moneda por separado. La diferencia contra lo esperado quedará en el comprobante.
                </p>
              </div>
              <Input
                label="Tasa de cierre"
                prefix={<span className="font-semibold">Bs</span>}
                type="number"
                step="0.01"
                min="0"
                value={tasaCierre}
                onChange={(e) => setTasaCierre(e.target.value)}
                error={!tasaValida ? 'Tasa inválida' : undefined}
              />
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </p>
            )}

            {!confirmar ? (
              <Button className="w-full" size="lg" disabled={!puedeCerrar} onClick={() => setConfirmar(true)}>
                <Coins className="h-4 w-4" /> Cerrar caja
              </Button>
            ) : (
              <div className="space-y-2">
                <p className="text-center text-sm text-muted-foreground">
                  ¿Confirmas el cierre? Se bloquea el punto de venta hasta abrir una nueva
                  caja. El comprobante queda en revisión y se archiva al abrir la caja del
                  día siguiente. Tasa de cierre: <strong>{tasaCierre} Bs</strong>. Contado:
                  <strong> ${contadoUsd || '0'}</strong> / <strong>Bs {contadoVes || '0'}</strong>.
                </p>
                <div className="flex gap-2">
                  <Button variant="secondary" className="flex-1" onClick={() => setConfirmar(false)}>
                    Volver
                  </Button>
                  <Button variant="danger" className="flex-1" disabled={guardando} onClick={cerrar}>
                    {guardando ? 'Cerrando…' : 'Sí, cerrar'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

      {historial.length > 0 && (
        <div className="mx-auto mt-6 max-w-2xl">
          <Card>
            <CardHeader
              title="Cierres anteriores"
              subtitle="El comprobante queda en revisión hasta que abre la caja del día siguiente; después se archiva y sigue disponible aquí."
            />
            <Table>
              <THead>
                <tr>
                  <Th>Fecha</Th>
                  <Th>Operador</Th>
                  <Th>Estado</Th>
                  <Th className="text-right">Tasa</Th>
                  <Th className="text-right">Comprobante</Th>
                </tr>
              </THead>
              <tbody>
                {historial.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <Td className="font-mono text-xs">{c.fecha.slice(0, 10)}</Td>
                    <Td>{c.operador_nombre}</Td>
                    <Td>
                      <Badge tone={c.estado === 'revisada' ? 'amber' : 'gray'}>
                        {c.estado === 'revisada' ? 'En revisión' : 'Cerrada'}
                      </Badge>
                    </Td>
                    <Td className="text-right">{c.tasa_cierre > 0 ? c.tasa_cierre : '—'}</Td>
                    <Td className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Ver cierre del ${c.fecha.slice(0, 10)}`}
                        disabled={reimprimiendo === c.id}
                        onClick={() => verCierre(c.id)}
                      >
                        <Printer className="h-4 w-4" />
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}

      <CierreModal cierre={cierre} onClose={cerrarModal} />
    </div>
  );
}