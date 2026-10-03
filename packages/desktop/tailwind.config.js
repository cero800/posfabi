/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // Los colores salen de variables CSS, no de la escala de Tailwind. Así el
      // cambio de tema es una clase `.dark` en `<html>` y no 372 clases
      // reescritas a mano: el código sigue diciendo `bg-primary` en los dos modos.
      colors: {
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        success: {
          DEFAULT: 'hsl(var(--success) / <alpha-value>)',
          foreground: 'hsl(var(--success-foreground) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning) / <alpha-value>)',
          foreground: 'hsl(var(--warning-foreground) / <alpha-value>)',
        },
      },
      borderRadius: {
        // 0.5rem–0.75rem: suave pero no redondo de más. Un POS se usa con el dedo
        // encima, y un radio mayor de 12px empieza a comerse el texto en pantalla
        // pequeña.
        card: '0.75rem',
      },
      boxShadow: {
        // Sombras muy suaves, y teñidas con el color de la sombra en vez de usar
        // el negro puro de Tailwind: un negro al 5% sobre blanco se ve sucio,
        // mientras que el mismo negro teñido de azul parece que viene de la luz
        // de la pantalla. En modo oscuro el negro puro es el único que funciona,
        // y por eso el color sale del token `--shadow`.
        card: '0 1px 2px 0 hsl(var(--shadow) / 0.05), 0 1px 3px 0 hsl(var(--shadow) / 0.06)',
        pop: '0 10px 30px -12px hsl(var(--shadow) / 0.35)',
      },
    },
  },
  plugins: [],
};
