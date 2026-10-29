#!/usr/bin/env node
// ⏱️ Script de demo: arranca backend HTTP + seeding temporal + frontend
// Uso (dev): node scripts/demo-server.mjs

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = new URL('.', import.meta.url).pathname;
console.log('⏱️  Demo server: modo HTTP + base temporal');
console.log('📁  Backend correrá en puerto 3001 con http://localhost:3001/rpc');
console.log('💡  El frontend debe conectarse a ese URL (usa backend-web.ts)');
console.log('');
console.log('Instrucciones para deploy en Vercel:');
console.log('1. pnpm --filter @tienda/desktop build');
console.log('2. cp scripts/demo-server.mjs .');
console.log('3. vercel deploy . --no-wait');
console.log('4. Configura variable VITE_BACKEND_URL=https://<tu-backend>.vercel.app');
console.log('');
