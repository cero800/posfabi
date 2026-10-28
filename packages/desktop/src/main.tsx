import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { iniciarRegistroErrores } from './services/logging';
import { iniciarTema } from './lib/tema';
import './index.css';

try {
  iniciarRegistroErrores();
} catch {
  // ignorar errores de registro en arranque
}
// `public/theme.js` ya aplicó el tema antes del primer pintado; esto es la red de
// seguridad para cuando ese script no pudo leer `localStorage`.
try {
  iniciarTema();
} catch {
  // ignorar errores de tema en arranque
}

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} else {
  document.body.innerHTML = '<div style="padding:20px;font-family:sans-serif">Error: no se encontró el elemento root</div>';
}
