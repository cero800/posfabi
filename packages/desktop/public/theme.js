// Decide el tema antes de que se pinte la pantalla.
//
// ## Por qué este archivo y no un script en línea en `index.html`
//
// El CSP de `src-tauri/tauri.conf.json` es `script-src 'self' 'unsafe-eval'`, sin
// `'unsafe-inline'`: un `<script>` escrito dentro del HTML quedaría bloqueado en
// la versión compilada y el tema no se aplicaría hasta que React arrancara, que
// es justo lo que este archivo evita. Un `<script src="...">` sí pasa el CSP.
//
// ## Por qué un `<script>` normal y no `type="module"`
//
// Los módulos se ejecutan después de parsear el documento, así que el navegador
// ya pudo pintar antes. Un script clásico en el `<head>` bloquea el parseo y se
// ejecuta antes del primer pintado, que es lo que hace falta.
//
// ## Por qué está duplicado en `src/lib/tema.ts`
//
// Porque el módulo de tema es TypeScript, se importa en React y decide el tema en
// caliente; este decide el primer pintado y no puede esperar a un import.
// `src/lib/tema.test.ts` ejecuta este archivo y comprueba que decide igual que
// `tema.ts`. Si se cambia la clave o la regla hay que cambiar los dos.
//
// La regla, en una línea: oscuro si el usuario lo eligió, o si no eligió nada y el
// sistema lo pide.
(function () {
  try {
    var t = localStorage.getItem('tienda.tema');
    if (t !== 'light' && t !== 'dark' && t !== 'system') t = 'system';
    var d = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', d);
  } catch (e) {
    // `localStorage` bloqueado, o `matchMedia` sin implementar. Se deja el tema
    // como esté: la app funciona igual, solo que sin recordar la preferencia.
  }
})();