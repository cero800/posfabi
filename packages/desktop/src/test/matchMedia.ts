// Stub de `matchMedia` para jsdom.
//
// Va en su propio archivo, y no dentro de `setup.ts`, porque `setupFiles` se
// ejecuta antes de cada test: un test que importara el helper desde `setup.ts`
// se traería también sus `afterEach` y registraría la limpieza dos veces. Aquí
// solo hay un stub y su función, sin efectos secundarios de vitest.

let sistemaOscuro = false;

/** Cambia lo que el stub dice que pide el sistema operativo. */
export function establecerTemaDelSistema(oscuro: boolean): void {
  sistemaOscuro = oscuro;
}

/** Vuelve al estado por defecto: el sistema pide tema claro. */
export function reiniciarTemaDelSistema(): void {
  sistemaOscuro = false;
}

/**
 * jsdom no implementa `matchMedia`, y `src/lib/tema.ts` lo consulta para saber
 * qué tema pide el sistema. Sin esto, los tests de la interfaz caerían con
 * «matchMedia is not a function» antes de llegar a comprobar nada.
 *
 * El stub es la versión mínima pero completa: `get matches` —la consulta
 * devuelve el valor vigente en cada lectura, que es como se comporta un
 * navegador—, `addEventListener` porque el módulo de tema se suscribe a los
 * cambios, y los métodos deprecados por si algo los usa.
 *
 * Solo se simula la consulta de tema oscuro. Cualquier otra se da por cierta,
 * que es lo que hace un navegador con una característica que no conoce.
 */
Object.defineProperty(globalThis, 'matchMedia', {
  writable: true,
  configurable: true,
  value: (consulta: string): MediaQueryList =>
    ({
      media: consulta,
      get matches() {
        return consulta.includes('prefers-color-scheme: dark') ? sistemaOscuro : true;
      },
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList,
});
