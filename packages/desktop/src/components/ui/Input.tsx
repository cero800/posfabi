import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix' | 'suffix'> {
  label?: string;
  hint?: string;
  error?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
}

export function Input({ label, hint, error, prefix, suffix, id, className, ...rest }: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-foreground">
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        {prefix && (
          <span className="pointer-events-none absolute left-3 text-sm text-muted-foreground">{prefix}</span>
        )}
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground shadow-card transition',
            'placeholder:text-muted-foreground',
            'focus:outline-none focus:ring-2',
            prefix ? 'pl-8' : '',
            suffix ? 'pr-16' : '',
            // Con error gana el rojo: el anillo y el borde pasan a ser
            // destructivo, para que se vea qué campo hay que corregir.
            error
              ? 'border-destructive focus:border-destructive focus:ring-destructive/40'
              : 'border-input focus:border-primary focus:ring-primary/40',
            className,
          )}
          {...rest}
        />
        {suffix && <span className="pointer-events-none absolute right-3 text-sm text-muted-foreground">{suffix}</span>}
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="mt-1 text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}