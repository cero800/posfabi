import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import { reiniciarTemaDelSistema } from './matchMedia';

// El stub tiene que instalarse antes que cualquier test, y esto lo ejecuta
// vitest antes de todos ellos.
import './matchMedia';

afterEach(() => {
  cleanup();
  // El tema escribe una clase en `<html>` que sobrevive al `cleanup()`, y sin
  // limpiarla un test en oscuro dejaría en oscuro todos los siguientes.
  reiniciarTemaDelSistema();
  document.documentElement.classList.remove('dark');
});
