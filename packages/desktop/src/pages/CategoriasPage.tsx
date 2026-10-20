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
// ## Sin árbol en la interfaz
//
// La base y la API conservan `parent_id` (Papelería > Útiles > Cuadernos) y el
// backend sigue impidiendo los ciclos, pero esta pantalla ya no lo ofrece: en la
// práctica el catálogo de una tienda se agrupa en un nivel y la columna y el
// desplegable «Dentro de» eran un segundo camino para lo mismo que ya hacen las
// secciones de Venta. Toda categoría que se cree aquí queda de primer nivel.

import { useEffect, useState } from 'react';
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
import { Modal } from '../components/ui/Modal';
import { Table, THead, Th, Td } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { EmptyState, PageHeader } from '../components/ui/Page';
import { PageLoader } from '../components/ui/Spinner';

/** Lo que se escribe en el formulario, con los ids como texto. */
interface Formulario {
  nombre: string;
  orden: string;
}

const VACIO: Formulario = { nombre: '', orden: '0' };

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
      // El árbol de categorías queda fuera de la interfaz: toda categoría es de
      // primer nivel. `parent_id` se conserva en el tipo y en la base, se manda
      // en `null` al crear y se respeta el que ya tuviera al editar.
      parent_id: editando ? editando.parent_id : null,
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
                <Th className="text-right">Orden</Th>
                <Th className="text-right">Productos</Th>
                <Th className="text-right">Acciones</Th>
              </tr>
            </THead>
            <tbody>
              {categorias.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                  <Td className="font-medium text-foreground">{c.nombre}</Td>
                  <Td className="text-right">{c.orden}</Td>
                  <Td className="text-right">
                    {(c.productos ?? 0) > 0 ? (
                      <Badge tone="blue">{c.productos}</Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
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
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
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
            <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <Input
            label="Nombre *"
            value={form.nombre}
            onChange={(e) => setForm({ ...form, nombre: e.target.value })}
            placeholder="Cuadernos"
          />
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
