import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

type Tone = 'green' | 'gray' | 'red' | 'amber' | 'blue';

// Los nombres de `tone` no cambian —los callers los usan— pero lo que hay debajo
// son tokens. Cada tono usa el color a plena intensidad para el texto y a un 10%
// para el fondo: un relleno de color fuerte con texto del mismo color no
// llega a 4.5:1, y el badge más pequeño del POS es de 12 px.
const toneClass: Record<Tone, string> = {
  green: 'bg-success/10 text-success ring-success/20',
  gray: 'bg-muted text-muted-foreground ring-border',
  red: 'bg-destructive/10 text-destructive ring-destructive/20',
  amber: 'bg-warning/10 text-warning ring-warning/20',
  blue: 'bg-primary/10 text-primary ring-primary/20',
};

export function Badge({ tone = 'gray', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        toneClass[tone],
      )}
    >
      {children}
    </span>
  );
}