// Configuración del destino de impresión de la térmica.
//
// ## Por qué esto no es un campo de texto
//
// La versión anterior guardaba en `config.impresora_termica` una cadena suelta y
// preguntaba al cajero por ella. Eso era coherente con el backend original, que
// escribía a `/dev/usb/lp0` o a una cola CUPS, pero en Windows no hay ninguna de
// las dos: lo que hay es un socket (impresora de red) o una cola del spooler
// (impresora USB), y son cosas distintas que una cadena no distingue. Una
// cadena tampoco sabe decir cuál es el host y cuál el nombre de la cola, así que
// el error de esa confusión no aparecía hasta que alguien intentaba imprimir.
//
// El backend ya define el destino tipado (`DestinoImpresora` en `@tienda/core`)
// y valida al guardarlo y al leerlo. Este modal es la parte de la interfaz de
// eso: elige el tipo, rellena sus campos, y deja que el backend normalice.
//
// ## Los tres destinos
//
// - **Red.** Host y puerto. Es el que funciona con cualquier impresora que
//   hable JetDirect, sin instalar nada en la PC del POS.
// - **USB.** El nombre exacto de la cola de Windows. Requiere que la cola esté
//   instalada con el controlador "Texto sin formato"; por eso el backend marca
//   con un `*` las que no lo están y aquí se explica qué hacer con eso.
// - **Archivo.** Escribe el ticket a un archivo en vez de imprimirlo. Sirve
//   para probar el POS sin la impresora comprada y para tener una copia de lo
//   que salió cuando algo se ve mal en el papel.

import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, FileText, Network, Printer, Usb } from 'lucide-react';
import type { DestinoImpresora } from '@tienda/core';
import {
  configurarDestinoImpresora,
  listarImpresoras,
  obtenerDestinoImpresora,
  probarImpresora,
} from '../../services/db';
import { cn } from '../../lib/cn';
import { Button } from './Button';
import { Input } from './Input';
import { Modal } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  onGuardado: (destino: DestinoImpresora) => void;
}

type Mensaje = { tipo: 'ok' | 'error'; texto: string } | null;
type TipoDestino = DestinoImpresora['tipo'];

/** Los tres destinos, con su icono. */
const TIPOS: Array<{ tipo: TipoDestino; etiqueta: string; icono: ReactNode }> = [
  { tipo: 'usb', etiqueta: 'USB / local', icono: <Usb className="h-4 w-4" /> },
  { tipo: 'red', etiqueta: 'Red', icono: <Network className="h-4 w-4" /> },
  { tipo: 'archivo', etiqueta: 'Archivo', icono: <FileText className="h-4 w-4" /> },
];

/** Lo que se escribe en el formulario del destino. */
interface Formulario {
  host: string;
  puerto: string;
  impresora: string;
  ruta: string;
}

const VACIO: Formulario = { host: '', puerto: '', impresora: '', ruta: '' };

function aFormulario(destino: DestinoImpresora | null): Formulario {
  if (!destino) return VACIO;
  switch (destino.tipo) {
    case 'red':
      return { ...VACIO, host: destino.host, puerto: String(destino.puerto) };
    case 'usb':
      return { ...VACIO, impresora: destino.impresora };
    case 'archivo':
      return { ...VACIO, ruta: destino.ruta };
  }
}

/**
 * Convierte el formulario en destino, o `null` si falta lo imprescindible.
 *
 * El puerto vacío se resuelve a 9100 aquí y no en el backend porque
 * `DestinoImpresora` lo exige como número: mandar "vacío" no compila. No es el
 * backend el único que pone ese valor por defecto (también lo acepta al leer la
 * configuración), sino que el que decide es este: si el usuario no escribió un
 * puerto, es que quiere el de siempre.
 *
 * Lo que no se hace es inventar el host o el nombre de la cola: esos no tienen
 * valor por defecto, y mandarlos vacíos produciría un error de validación del
 * backend con un mensaje sobre formato cuando lo que pasa es que el cajero no
 * llenó el campo.
 */
function aDestino(tipo: TipoDestino, form: Formulario): DestinoImpresora | null {
  switch (tipo) {
    case 'red': {
      if (form.host.trim() === '') return null;
      const puerto = form.puerto.trim();
      return { tipo: 'red', host: form.host.trim(), puerto: puerto === '' ? 9100 : Number(puerto) };
    }
    case 'usb':
      return form.impresora.trim() === '' ? null : { tipo: 'usb', impresora: form.impresora.trim() };
    case 'archivo':
      return form.ruta.trim() === '' ? null : { tipo: 'archivo', ruta: form.ruta.trim() };
  }
}

export function ConfigurarImpresoraModal({ open, onClose, onGuardado }: Props) {
  const [tipo, setTipo] = useState<TipoDestino>('usb');
  const [form, setForm] = useState<Formulario>(VACIO);
  const [candidatas, setCandidatas] = useState<string[]>([]);
  const [cargando, setCargando] = useState(false);
  const [probando, setProbando] = useState(false);
  const [mensaje, setMensaje] = useState<Mensaje>(null);

  useEffect(() => {
    if (!open) return;
    setMensaje(null);
    setCargando(true);
    // Las dos llamadas por separado y no en un `Promise.all`: si el destino
    // guardado está corrupto, `obtenerDestinoImpresora` falla —a propósito, para
    // que el cajero lo vuelva a configurar en vez de seguir con algo roto— y
    // con `Promise.all` se perdería también la lista de impresoras, que es justo
    // lo que se necesita para arreglarlo.
    obtenerDestinoImpresora()
      .then((destino) => {
        if (destino) {
          setTipo(destino.tipo);
          setForm(aFormulario(destino));
        } else {
          setTipo('usb');
          setForm(VACIO);
        }
      })
      .catch((e) => setMensaje({ tipo: 'error', texto: String(e) }));
    listarImpresoras()
      .then((lista) => setCandidatas(lista))
      .catch(() => setCandidatas([]))
      .finally(() => setCargando(false));
  }, [open]);

  /** El destino del formulario, o `null` si todavía no se puede construir. */
  const destino = aDestino(tipo, form);

  const probar = async () => {
    // Se prueba lo que se está a punto de guardar, no lo que había guardado
    // antes: la forma de fallar de "probar con una impresora e imprimir con
    // otra" es un clásico de esta pantalla.
    if (!destino) {
      setMensaje({ tipo: 'error', texto: 'Completa el destino antes de probar.' });
      return;
    }
    setProbando(true);
    setMensaje(null);
    try {
      await configurarDestinoImpresora(destino);
      await probarImpresora();
      setMensaje({ tipo: 'ok', texto: 'Prueba enviada correctamente a la impresora.' });
    } catch (e) {
      setMensaje({ tipo: 'error', texto: String(e) });
    } finally {
      setProbando(false);
    }
  };

  const guardar = async () => {
    if (!destino) {
      setMensaje({ tipo: 'error', texto: 'Completa el destino antes de guardar.' });
      return;
    }
    try {
      const guardado = await configurarDestinoImpresora(destino);
      onGuardado(guardado);
      onClose();
    } catch (e) {
      setMensaje({ tipo: 'error', texto: String(e) });
    }
  };

  return (
    <Modal
      open={open}
      title="Configurar impresora térmica"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="secondary" onClick={probar} disabled={probando || !destino}>
            {probando ? 'Probando…' : 'Probar impresión'}
          </Button>
          <Button onClick={guardar}>Guardar</Button>
        </>
      }
    >
      <div className="space-y-4">
        {mensaje && (
          <p
            role="alert"
            className={`rounded-lg p-3 text-sm ${mensaje.tipo === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}
          >
            {mensaje.texto}
          </p>
        )}

        <div>
          <p className="mb-1 text-xs font-medium text-gray-500">¿Cómo está conectada?</p>
          <div className="grid grid-cols-3 gap-2">
            {TIPOS.map((t) => (
              <button
                key={t.tipo}
                type="button"
                onClick={() => setTipo(t.tipo)}
                aria-pressed={tipo === t.tipo}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm',
                  tipo === t.tipo
                    ? 'border-emerald-500 bg-emerald-50 font-medium text-emerald-800'
                    : 'border-gray-200 text-gray-700 hover:bg-gray-50',
                )}
              >
                {t.icono}
                {t.etiqueta}
              </button>
            ))}
          </div>
        </div>

        {tipo === 'usb' && (
          <div>
            <p className="mb-1 text-xs font-medium text-gray-500">Impresoras detectadas</p>
            {cargando ? (
              <p className="text-sm text-gray-400">Buscando…</p>
            ) : candidatas.length === 0 ? (
              <p className="text-sm text-gray-500">
                No se detectaron impresoras. Conecta la térmica, o agrégala en Configuración de Windows, y vuelve a
                intentar. También puedes escribir el nombre a mano.
              </p>
            ) : (
              <ul className="space-y-1">
                {candidatas.map((c) => (
                  <li key={c}>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, impresora: quitarMarca(c) })}
                      className={cn(
                        'w-full rounded-lg border px-3 py-2 text-left text-sm',
                        form.impresora === quitarMarca(c)
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                          : 'border-gray-200 text-gray-700 hover:bg-gray-50',
                      )}
                    >
                      {c}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2">
              <Input
                label="Nombre de la impresora"
                value={form.impresora}
                onChange={(e) => setForm({ ...form, impresora: e.target.value })}
                placeholder="EPSON TM-T20III"
              />
            </div>
            {candidatas.some((c) => c.includes('*')) && (
              <p className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Las marcadas con «*» están instaladas con el controlador de la marca o con uno de PDF. Con esos
                  controladores el spooler convierte el texto en imagen y el ticket sale sin negritas, sin doble tamaño
                  y sin corte. Para que funcione, quite la impresora en Configuración de Windows y vuelva a instalarla
                  con el controlador <strong>«Generic / Text Only»</strong> (Texto sin formato).
                </span>
              </p>
            )}
          </div>
        )}

        {tipo === 'red' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Input
                label="Dirección de la impresora *"
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
                placeholder="192.168.1.50"
                hint="La IP o el nombre que tiene en la red de la tienda"
              />
            </div>
            <Input
              label="Puerto"
              inputMode="numeric"
              value={form.puerto}
              onChange={(e) => setForm({ ...form, puerto: e.target.value })}
              placeholder="9100"
              hint="Déjalo vacío si es 9100"
            />
          </div>
        )}

        {tipo === 'archivo' && (
          <div>
            <Input
              label="Ruta del archivo *"
              value={form.ruta}
              onChange={(e) => setForm({ ...form, ruta: e.target.value })}
              placeholder="C:\Users\POS\ticket.txt"
              hint="Cada ticket se escribe en esa ruta. Sirve para probar sin impresora y para revisar lo que salió."
            />
            <p className="mt-2 flex items-start gap-2 rounded-lg bg-blue-50 p-3 text-xs text-blue-800">
              <FileText className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Con esta opción no sale papel. El ticket se guarda como texto con los comandos de la impresora
                metidos dentro, que es como se revisa un ticket sin ver el papel.
              </span>
            </p>
          </div>
        )}

        {tipo === 'usb' && (
          <p className="flex items-start gap-2 text-xs text-gray-500">
            <Printer className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Se escriben bytes ESC/POS a la cola de Windows. Antes de dar esto por bueno, pulse «Probar impresión»:
              es la única forma de saber que el controlador es el correcto.
            </span>
          </p>
        )}
      </div>
    </Modal>
  );
}

/**
 * Quita la marca de "no apto para texto sin formato" del final del nombre.
 *
 * El backend la pone para que el cajero vea por qué esa impresora no va a
 * funcionar, pero la marca no es parte del nombre de la cola: mandarla a
 * `copy /b` es mandar a una cola que no existe, y el error que sale de ahí
 * ("no se encontró el archivo") no explica nada.
 */
export function quitarMarca(nombre: string): string {
  return nombre.endsWith(' *') ? nombre.slice(0, -2) : nombre;
}
