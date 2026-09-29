import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Cada archivo de pruebas abre conexiones SQLite en memoria; `forks` evita
    // que ese estado se mezcle entre archivos dentro del mismo proceso.
    pool: 'forks',
  },
});
