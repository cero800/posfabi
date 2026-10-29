import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { iniciarRegistroErrores } from './services/logging';
import { iniciarTema } from './lib/tema';
import './index.css';

console.log('[main] iniciando...');

try {
  iniciarRegistroErrores();
  console.log('[main] iniciarRegistroErrores ok');
} catch (e) {
  console.error('[main] error iniciarRegistroErrores', e);
}
// `public/theme.js` ya aplicó el tema antes del primer pintado; esto es la red de
// seguridad para cuando ese script no pudo leer `localStorage`.
try {
  iniciarTema();
  console.log('[main] iniciarTema ok');
} catch (e) {
  console.error('[main] error iniciarTema', e);
}

const root = document.getElementById('root');
console.log('[main] root:', root);
if (root) {
  try {
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    console.log('[main] render llamado');
  } catch (e) {
    console.error('[main] error render', e);
    document.body.innerHTML = '<pre style="padding:20px;color:red">' + String(e) + '</pre>';
  }
} else {
  document.body.innerHTML = '<div style="padding:20px;font-family:sans-serif">Error: no se encontró el elemento root</div>';
}
