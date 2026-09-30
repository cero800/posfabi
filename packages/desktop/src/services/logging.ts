// Registro de errores del frontend en dos sitios: en memoria, para mostrarlos en
// pantalla (`OverlayErrores`), y en `errores.log`, dentro de la carpeta de datos
// de la app.
//
// ## Por qué no se registra a sí mismo
//
// Cuando algo falla en la interfaz, este módulo llama al backend para escribirlo
// en el archivo. Si esa llamada falla —porque el backend está caído, que es
// justo cuando más falta hace el registro— no se intenta volver a registrar
// nada: se traga el error en silencio. Un registro que al fallar dispara otro
// registro es un registro que tapa el problema que quería guardar.

import { useSyncExternalStore } from 'react';

import { llamar } from './backend';

export interface ErrorRegistro {
  id: number;
  hora: string;
  origen: string;
  texto: string;
}

let activo = false;
let siguienteId = 1;
let errores: ErrorRegistro[] = [];
const suscriptores = new Set<() => void>();

function notificar() {
  suscriptores.forEach((fn) => fn());
}

function agregarError(origen: string, error: unknown) {
  const texto = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  errores = [
    ...errores,
    { id: siguienteId++, hora: new Date().toLocaleString(), origen, texto },
  ];
  notificar();
  // Lo que se guarda en el archivo es el mensaje y el origen, no la pila entera:
  // en una app empaquetada y minificada la pila no dice gran cosa y ocupa más que
  // el error. En pantalla sí se muestra todo.
  llamar('log_error', { origen, mensaje: error instanceof Error ? error.message : texto }).catch(
    () => {
      /* si el backend no está, no hay dónde escribirlo */
    },
  );
}

export function iniciarRegistroErrores() {
  if (activo || typeof window === 'undefined') return;
  activo = true;

  window.addEventListener('error', (e) => {
    agregarError('window', e.error ?? e.message);
  });

  window.addEventListener('unhandledrejection', (e) => {
    agregarError('promesa', e.reason);
  });
}

export function useErrores(): ErrorRegistro[] {
  return useSyncExternalStore(
    (fn) => {
      suscriptores.add(fn);
      return () => suscriptores.delete(fn);
    },
    () => errores,
  );
}

export function reportarError(origen: string, error: unknown) {
  agregarError(origen, error);
}

export function trazar(origen: string, mensaje: string): void {
  llamar('log_evento', { origen, mensaje }).catch(() => {
    /* si el backend no está, no hay dónde escribirlo */
  });
}

export function limpiarErrores() {
  errores = [];
  notificar();
}