#!/usr/bin/env node
// 🎬 Demo UI: muestra cómo usar backend-web.ts en modo HTTP

import { estadoSistema, venta, seedReset } from './packages/desktop/src/services/backend-web.ts';

// UI simple
const app = document.createElement('div');
app.style.padding = '1rem';
app.style.fontFamily = 'system-ui, sans-serif';
document.body.appendChild(app);

// Botón para reiniciar demo
const resetBtn = document.createElement('button');
resetBtn.textContent = 'Reiniciar demo';
resetBtn.style.padding = '0.5rem 1rem';
resetBtn.style.fontSize = '1rem';
resetBtn.style.marginBottom = '1rem';
app.appendChild(resetBtn);

resetBtn.addEventListener('click', async () => {
  try {
    await seedReset();
    alert('Demo reiniciada. Base de datos limpiada y semillada.');
  } catch (e) {
    console.error(e);
    alert('Error al reiniciar demo');
  }
});

// Botón para registrar compra demo
const compraBtn = document.createElement('button');
compraBtn.textContent = 'Registrar compra demo';
compraBtn.style.padding = '0.5rem 1rem';
compraBtn.style.fontSize = '1rem';
app.appendChild(compraBtn);

compraBtn.addEventListener('click', async () => {
  try {
    // Simulamos una venta: 2 productos de $5 cada uno
    const p = {
      items: [
        { productId: 'p1', cantidad: 2, precio_usd: 5000 },
        { productId: 'p2', cantidad: 1, precio_usd: 3000 },
      ],
      moneda: 'USD',
      efectivo_usd: 10000,
      efectivo_bs: 0,
    };
    const respuesta = await venta(p);
    console.log('Compra realizada:', respuesta);
    alert('Compra demo registrada. Ver consola para detalles.');
  } catch (e) {
    console.error(e);
    alert(`Error: ${e instanceof ErrorBackend ? e.message : 'Error desconocido'}`);
  }
});

// Mostrar estado del sistema
const estadoBtn = document.createElement('button');
estadoBtn.textContent = 'Ver estado';
estadoBtn.style.padding = '0.5rem 1rem';
estadoBtn.style.marginBottom = '1rem';
app.appendChild(estadoBtn);

estadoBtn.addEventListener('click', async () => {
  try {
    const estado = await estadoSistema();
    console.log('Estado del sistema:', estado);
    alert(`Estado: v${estado.version_esquema}, base: ${estado.base}`);
  } catch (e) {
    console.error(e);
    alert('Error al obtener estado');
  }
});

console.log('🚀 Demo UI cargada. Haz clic en los botones para probar.');