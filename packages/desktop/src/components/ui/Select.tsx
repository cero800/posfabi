import { useId } from 'react';
import type { SelectHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
}

export function Select({ label, hint, id, className, children, ...rest }: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={selectId} className="mb-1 block text-sm font-medium text-foreground">
          {label}
        </label>
      )}
      <select
        id={selectId}
        className={cn(
          'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-card transition',
          'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40',
          // El navegador solo atenúa un `<select>` si no le tocan los colores, y
          // aquí sí: `bg-background` y `text-foreground` se los quitan, así que un
          // deshabilitado salía con el mismo aspecto que uno activo.
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}