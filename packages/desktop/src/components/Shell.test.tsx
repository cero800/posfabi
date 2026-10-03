import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSesion } from '../store/sesion';
import { cambiarTema, iniciarTema, CLAVE_TEMA } from '../lib/tema';
import { establecerTemaDelSistema } from '../test/matchMedia';
import Shell from './Shell';

// La Shell llama a `obtenerDatosNegocio` al montar y a `trazar` en cada cambio de
// ruta. Las dos van al backend, que en un test no existe.
vi.mock('../services/db', () => ({
  obtenerDatosNegocio: vi.fn().mockResolvedValue({ nombre: 'Papelería Don Carlos' }),
}));
vi.mock('../services/logging', () => ({
  trazar: vi.fn(),
  reportarError: vi.fn(),
  useErrores: () => [],
  limpiarErrores: vi.fn(),
  iniciarRegistroErrores: vi.fn(),
}));

const estaOscuro = () => document.documentElement.classList.contains('dark');

beforeEach(() => {
  // Orden importante: `cambiarTema` guarda en `localStorage`, así que el borrado
  // va después. Queda como una instalación nueva, sin tema elegido.
  cambiarTema('system');
  localStorage.removeItem(CLAVE_TEMA);
  document.documentElement.classList.remove('dark');
  useSesion.setState({
    tasa: 36.85,
    operador: { id: 1, nombre: 'Ana', rol: 'admin', activo: true },
    caja: { id: 7, fecha: '2026-09-04', operador_id: 1, operador_nombre: 'Ana', tasa_cierre: 36.85, estado: 'abierta' },
  } as never);
});

function montarShell() {
  return render(
    <MemoryRouter initialEntries={['/venta']}>
      <Shell />
    </MemoryRouter>,
  );
}

describe('el interruptor de tema', () => {
  it('está en la barra superior y arranca en claro', async () => {
    montarShell();
    const boton = await screen.findByRole('button', { name: 'Cambiar a modo oscuro' });
    expect(boton).toHaveAttribute('aria-pressed', 'false');
    expect(estaOscuro()).toBe(false);
  });

  it('al pulsarlo pone la pantalla en oscuro y lo recuerda', async () => {
    const user = userEvent.setup();
    montarShell();

    await user.click(await screen.findByRole('button', { name: 'Cambiar a modo oscuro' }));

    expect(estaOscuro()).toBe(true);
    expect(localStorage.getItem(CLAVE_TEMA)).toBe('dark');
    // El botón cambia de nombre: ahora ofrece volver a claro.
    expect(screen.getByRole('button', { name: 'Cambiar a modo claro' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('vuelve a claro con un segundo clic', async () => {
    const user = userEvent.setup();
    montarShell();

    await user.click(await screen.findByRole('button', { name: 'Cambiar a modo oscuro' }));
    await user.click(screen.getByRole('button', { name: 'Cambiar a modo claro' }));

    expect(estaOscuro()).toBe(false);
    expect(localStorage.getItem(CLAVE_TEMA)).toBe('light');
  });

  it('con el sistema en oscuro, el interruptor aparece apagado y al pulsarlo aclara', async () => {
    // El caso que confunde: si la pantalla ya está oscura porque el sistema lo
    // pidió, el botón tiene que ofrecer el cambio a claro, no quedarse gris.
    establecerTemaDelSistema(true);
    cambiarTema('system');
    iniciarTema();

    const user = userEvent.setup();
    montarShell();

    const boton = await screen.findByRole('button', { name: 'Cambiar a modo claro' });
    expect(boton).toHaveAttribute('aria-pressed', 'true');
    expect(estaOscuro()).toBe(true);

    await user.click(boton);
    expect(estaOscuro()).toBe(false);
  });
});