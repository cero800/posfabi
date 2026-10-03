import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'md' | 'lg' | 'sm';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

// Los colores salen de tokens, no de la escala de Tailwind, para que el mismo
// botón se vea bien en claro y en oscuro sin duplicarse.
const variantClass: Record<Variant, string> = {
  // El azul es el primario de toda acción que se ejecuta. El morado queda
  // fuera a propósito: si también fuera primario, se pelearían.
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring',
  secondary:
    'bg-secondary text-secondary-foreground border border-border hover:bg-secondary/70 focus-visible:ring-ring',
  danger: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive',
  ghost: 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring',
};

const sizeClass: Record<Size, string> = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-base',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}