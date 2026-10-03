// Modo claro y oscuro.
//
// ## Dónde vive la decisión
//
// El tema no se decide en cada componente: se decide una vez y se aplica con una
// clase `.dark` en `<html>`. Quien decide es este módulo y quien lee es Tailwind,
// a través de las variables CSS de `index.css`. Aquí solo vive lo que tiene
// estado —qué tema está activo y cómo se cambia—; los colores viven en el CSS.
//
// ## Por qué sin dependencias
//
// React ya trae `useSyncExternalStore`, que es exactamente lo que hace falta
// para un valor global fuera de React. Añadir Zustand o un Context por un
// booleano y una función sería más peso que el problema. Es el mismo patrón que
// ya usa `services/logging.ts` con la lista de errores.
//
// ## El parpadeo del primer pintado
//
// Este módulo corre después de que el navegador ya pintó la pantalla en claro. Si
// el tema elegido fuera oscuro, el usuario vería un fogonazo blanco antes de que
// se aplicara la clase. Por eso `public/theme.js` decide la clase antes de que
// cargue la app. Son dos copias de la misma regla y no pueden desviarse:
// `tema.test.ts` ejecuta ese archivo y comprueba que decide igual que este módulo.

import { useSyncExternalStore } from 'react';

/** Los tres estados posibles. `system` sigue al del sistema operativo. */
export type Tema = 'light' | 'dark' | 'system';

/** La clave de `localStorage`. La comparte `public/theme.js`. */
export const CLAVE_TEMA = 'tienda.tema';

/** La consulta de medios que pregunta al sistema por su tema. */
export const CONSULTA_OSCURO = '(prefers-color-scheme: dark)';

function prefiereOscuro(): boolean {
  return globalThis.matchMedia?.(CONSULTA_OSCURO).matches ?? false;
}

/**
 * El tema con el que hay que pintar ahora mismo.
 *
 * `system` se resuelve al valor que pida el sistema operativo, no a sí mismo: la
 * clase `.dark` tiene que decidir una cosa, y "lo que eligió el usuario" no sirve
 * para pintar.
 */
export function temaEfectivo(elegido: Tema): 'light' | 'dark' {
  if (elegido === 'system') return prefiereOscuro() ? 'dark' : 'light';
  return elegido;
}

function aplicar(elegido: Tema): void {
  document.documentElement.classList.toggle('dark', temaEfectivo(elegido) === 'dark');
}

function leer(): Tema {
  try {
    const guardado = localStorage.getItem(CLAVE_TEMA);
    // Un valor que no sea uno de los tres —porque alguien editó `localStorage` a
    // mano, o porque quedó de una versión anterior— no puede dejar el POS sin
    // tema: se cae a `system`, que siempre funciona.
    if (guardado === 'light' || guardado === 'dark' || guardado === 'system') return guardado;
  } catch {
    // `localStorage` lanza en el modo privado de algunos navegadores. Sin memoria
    // persistente el tema no se recuerda, pero el POS tiene que funcionar igual.
  }
  return 'system';
}

function guardar(elegido: Tema): void {
  try {
    localStorage.setItem(CLAVE_TEMA, elegido);
  } catch {
    /* sin memoria persistente: el tema dura lo que la sesión, que es aceptable */
  }
}

// Suscriptores de `useSyncExternalStore`, en un `Set` porque pueden ser varias
// pantallas montadas a la vez.
const suscriptores = new Set<() => void>();

function avisar(): void {
  suscriptores.forEach((fn) => fn());
}

/** El tema elegido, tal cual, sin resolver `system`. */
let elegido: Tema = leer();

/**
 * El valor del snapshot.
 *
 * Devuelve un primitivo, no un objeto: `useSyncExternalStore` compara el valor
 * con `Object.is` en cada render, y si devolviera un objeto nuevo cada vez
 * entraría en bucle.
 */
function valorActual(): 'light' | 'dark' {
  return temaEfectivo(elegido);
}

function suscribir(fn: () => void): () => void {
  suscriptores.add(fn);
  return () => {
    suscriptores.delete(fn);
  };
}

// Con el tema en `system` hay que reaccionar a que el sistema cambie de tema
// mientras la app está abierta; con un tema elegido a mano no, porque manda el
// usuario. El listener se registra una vez al cargar el módulo —no uno por
// consulta a `valorActual`, que se llama en cada render— y no se quita nunca:
// este módulo vive toda la vida de la aplicación.
globalThis.matchMedia?.(CONSULTA_OSCURO)?.addEventListener?.('change', () => {
  if (elegido === 'system') avisar();
});

/**
 * Aplica el tema guardado. Se llama una vez al arrancar.
 *
 * Vuelve a leer `localStorage` en vez de fiarse de lo que se leyó al cargar el
 * módulo: entre esos dos momentos puede haber escrito el usuario, y sobre todo
 * `public/theme.js` acaba de correr y es quien tiene la última palabra.
 *
 * Además es la red de seguridad para cuando ese script falló —`localStorage`
 * bloqueado— y la pantalla se quedó en claro.
 */
export function iniciarTema(): void {
  elegido = leer();
  aplicar(elegido);
}

/** Cambia el tema y lo recuerda. */
export function cambiarTema(nuevo: Tema): void {
  elegido = nuevo;
  guardar(nuevo);
  aplicar(nuevo);
  avisar();
}

/**
 * Alterna entre claro y oscuro.
 *
 * Es un interruptor de dos estados y no un selector de tres porque en una
 * pantalla de caja el objetivo es cambiar rápido. Si estaba en `system` —el
 * estado inicial— alterna al contrario del sistema, que es lo que quiere quien
 * pulsa: "quiero el otro". A partir de ahí ya no vuelve a `system` por su cuenta;
 * para eso está `cambiarTema`.
 */
export function alternarTema(): void {
  cambiarTema(temaEfectivo(elegido) === 'dark' ? 'light' : 'dark');
}

/** El tema con el que se está pintando, y cómo alternarlo. */
export function useTema(): { efectivo: 'light' | 'dark'; alternar: () => void } {
  const efectivo = useSyncExternalStore(suscribir, valorActual, valorActual);
  return { efectivo, alternar: alternarTema };
}