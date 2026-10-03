// Interruptor de tema claro/oscuro.
//
// ## Por qué un icono y no dos botones
//
// El plan inicial preveía tres estados (`light`, `dark`, `system`). Se quedó en dos
// porque en una pantalla de caja lo que se quiere es cambiar ya, no matizar la
// preferencia. Quien quiera volver a seguir al sistema lo hace desde el menú del
// sistema operativo, que es donde se cambia de verdad.
//
// ## Qué muestra el icono
//
// El icono es el del tema *actual*, no el del otro: un sol sobre fondo blanco se
// lee como "está soleado", no como "pulsa para oscurecer". El `aria-label` sí
// nombra la acción —"Cambiar a modo oscuro"— porque para un lector de pantalla
// un icono sin texto no dice nada.

import { Moon, Sun } from 'lucide-react';

import { useTema } from '../lib/tema';
import { Button } from './ui/Button';

export function TemaToggle() {
  const { efectivo, alternar } = useTema();
  const oscuro = efectivo === 'dark';

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={alternar}
      aria-label={oscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      title={oscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      // `aria-pressed` dice si el botón está "pulsado" ahora, que para este
      // control es literalmente si el modo oscuro está activo.
      aria-pressed={oscuro}
      className="text-muted-foreground hover:text-foreground"
    >
      {oscuro ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </Button>
  );
}