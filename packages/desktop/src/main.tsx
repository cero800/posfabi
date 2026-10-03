import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { iniciarRegistroErrores } from './services/logging';
import { iniciarTema } from './lib/tema';
import './index.css';

iniciarRegistroErrores();
// `public/theme.js` ya aplicó el tema antes del primer pintado; esto es la red de
// seguridad para cuando ese script no pudo leer `localStorage`.
iniciarTema();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
