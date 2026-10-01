// Alta, renombrado y baja de las categorías del catálogo.
//
// ## Por qué existe esta página
//
// En el POS original no había categorías: los productos se buscaban por nombre
// o por código, y en una panadería el catálogo son veinte referencias. En una
// papelería son miles de artículos y el cajero no puede recorrerlos en busca de
// un cuaderno. Las categorías son lo que hace manejable el catálogo, y
// `StockItem` ya traía `categoria_nombre` desde el principio: nadie lo mostraba.
//
// ## Las categorías no se borran
//
// `eliminar_categoria` desactiva y descolga los productos, no borra la fila. Es
// a propósito —la tabla de ventas guarda qué categoría tenía cada producto el
// día que se vendió, y un `DELETE` se llevaría por delante esa historia—, pero
// en pantalla eso tiene que quedar dicho: el botón dice "Desactivar" y el
// diálogo avisa qué pasa con los productos que todavía cuelgan de ahí.
//
// ## El árbol
//
// `parent_id` permite anidar (Papelería > Útiles > Cuadernos) y el backend
// impide mover una categoría dentro de una de sus subcategorías. El formulario
// no ofrece los descendientes como padre, pero el backend lo vuelve a
// comprobar: un cliente puede estar desactualizado, o un `parent_id` puede venir
// de una base vieja. La defensa va en los dos lados y aquí solo se evita
// ofrecer la opción que ya se sabe inválida.

import { useEffect, useMemo, useState } from 'react';
import { FolderTree, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Categoria, CategoriaInput } from '@tienda/core';
import {
  actualizarCategoria,
  crearCategoria,
  eliminarCategoria,
  listarCategorias,
} from '../services/db';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { Table, THead, Th, Td } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { EmptyState, PageHeader } from '../components/ui/Page';
import { PageLoader } from '../components/ui/Spinner';

/** Lo que se escribe en el formulario, con los ids como texto. */
interface Formulario {
  nombre: string;
  parent_id: string;
  orden: string;
}

const VACIO: Formulario = { nombre: '', parent_id: '', orden: '0' };

export default function CategoriasPage() {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [modal, setModal] = useState(false);
  const [editando, setEditando] = useState<Categoria | null>(null);
  const [form, setForm] = useState<Formulario>(VACIO);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = () => listarCategorias().then(setCategorias).finally(() => setCargando(false));
  useEffect(() => {
    cargar();
  }, []);

  /**
   * Los descendientes de una categoría, para no ofrecerlos como padre.
   *
   * El subárbol se sube con `parent_id` en vez de con una consulta recursiva
   * porque el backend devuelve una lista plana y sin hijos: `hijas` existe en el
   * tipo pero `listarCategorias` no la llena. Con `parent_id` alcanza para saber
   * si un padre es descendiente, y son dos niveles como los que tiene un catálogo
   * de verdad.
   */
  const descendientesDe = useMemo(() => {
    const porId = new Map(categorias.map((c) => [c.id, c]));
    return (raiz: number): Set<number> => {
      const abajo = new Set<number>();
      for (const c of categorias) {
        let padre = c.parent_id;
        // Tope de 32 como el del backend: un ciclo grabado a mano en la base
        // no puede dejar este `for` colgado.
        for (let nivel = 0; nivel < 32 && padre != null; nivel += 1) {
          if (padre === raiz) {
            abajo.add(c.id);
            break;
          }
          padre = porId.get(padre)?.parent_id ?? null;
        }
      }
      return abajo;
    };
  }, [categorias]);

  const padreDe = useMemo(() => {
    const porId = new Map(categorias.map((c) => [c.id, c]));
    return (c: Categoria): Categoria | null => {
      let actual: number | null = c.parent_id;
      for (let nivel = 0; nivel < 32 && actual != null; nivel += 1) {
        const encontrado = porId.get(actual);
        if (!encontrado) return null;
        if (encontrado.parent_id == null) return encontrado;
        actual = encontrado.parent_id;
      }
      return null;
    };
  }, [categorias]);

  const abrirNuevo = () => {
    setEditando(null);
    setForm(VACIO);
    setError(null);
    setModal(true);
  };

  const abrirEdicion = (c: Categoria) => {
    setEditando(c);
    setForm({
      nombre: c.nombre,
      parent_id: c.parent_id == null ? '' : String(c.parent_id),
      orden: String(c.orden),
    });
    setError(null);
    setModal(true);
  };

  const guardar = async () => {
    if (!form.nombre.trim()) {
      setError('El nombre es obligatorio');
      return;
    }
    const orden = Number(form.orden);
    if (!Number.isInteger(orden)) {
      setError('El orden debe ser un número entero');
      return;
    }
    const entrada: CategoriaInput = {
      nombre: form.nombre.trim(),
      parent_id: form.parent_id === '' ? null : Number(form.parent_id),
      orden,
    };
    setGuardando(true);
    setError(null);
    try {
      if (editando) {
        // El objeto completo, no un parche: `actualizar_categoria` escribe
        // `parent_id` y `orden` siempre, así que omitirlos los pondría en cero.
        await actualizarCategoria(editando.id, { ...entrada, activo: editando.activo });
      } else {
        await crearCategoria(entrada);
      }
      setModal(false);
      cargar();
    } catch (e) {
      setError(String(e));
    } finally {
      setGuardando(false);
    }
  };

  const desactivar = async (c: Categoria) => {
    const conProductos = c.productos ?? 0;
    const aviso =
      conProductos > 0
        ? `¿Desactivar "${c.nombre}"?\n\n` +
          `${conProductos} producto(s) quedarán sin categoría, no se borran. ` +
          'Puede volver a activarla después.'
        : `¿Desactivar "${c.nombre}"?`;
    if (!window.confirm(aviso)) return;
    try {
      await eliminarCategoria(c.id);
      cargar();
    } catch (e) {
      window.alert(String(e));
    }
  };

  if (cargando) return <PageLoader />;

  // Los padres posibles: todos menos la categoría editada y sus descendientes.
  const descendientes = editando ? descendientesDe(editando.id) : new Set<number>();
  const padresPosibles = categorias.filter((c) => c.id !== editando?.id && !descendientes.has(c.id));

  return (
    <div>
      <PageHeader
        title="Categorías"
        subtitle="Sirven para agrupar el catálogo y filtrar la venta"
        actions={
          <Button onClick={abrirNuevo}>
            <Plus className="h-4 w-4" /> Nueva categoría
          </Button>
        }
      />

      {categorias.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderTree className="h-8 w-8" />}
            message="Sin categorías. Crea la primera para agrupar el catálogo."
          />
        </Card>
      ) : (
        <Card>
          <Table>
            <THead>
              <tr>
                <Th>Nombre</Th>
                <Th>Dentro de</Th>
                <Th className="text-right">Orden</Th>
                <Th className="text-right">Productos</Th>
                <Th className="text-right">Acciones</Th>
              </tr>
            </THead>
            <tbody>
              {categorias.map((c) => {
                const padre = padreDe(c);
                return (
                  <tr key={c.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                    <Td className="font-medium text-gray-900">{c.nombre}</Td>
                    <Td className="text-gray-500">{padre?.nombre ?? '—'}</Td>
                    <Td className="text-right">{c.orden}</Td>
                    <Td className="text-right">
                      {(c.productos ?? 0) > 0 ? (
                        <Badge tone="blue">{c.productos}</Badge>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" aria-label={`Editar ${c.nombre}`} onClick={() => abrirEdicion(c)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Desactivar ${c.nombre}`}
                          onClick={() => desactivar(c)}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}

      <Modal
        open={modal}
        title={editando ? 'Editar categoría' : 'Nueva categoría'}
        onClose={() => setModal(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(false)}>
              Cancelar
            </Button>
            <Button onClick={guardar} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}
          <Input
            label="Nombre *"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            placeholder="Cuadernos"
          />
          <Select
            label="Dentro de"
            value={form.parent_id}
            onChange={(e) => setForm({ ...form, parent_id: e.target.value })}
            hint="Déjalo en «— Ninguna —» para que sea una categoría de primer nivel"
          >
            <option value="">— Ninguna —</option>
            {padresPosibles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </Select>
          <Input
            label="Orden"
            type="number"
            value={form.orden}
            onChange={(e) => setForm({ ...form, orden: e.target.value })}
            hint="Menor número sale primero en la lista"
          />
        </div>
      </Modal>
    </div>
  );
}
