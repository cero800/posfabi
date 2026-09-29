// Bundling del backend para el ejecutable único.
//
// Node SEA no empaqueta nada: se limita a inyectar un único script dentro de
// node.exe. Como `src/main.ts` importa `@tienda/core`, el ejecutable resultante
// no encontraría ese módulo en tiempo de ejecución. Por eso el punto de entrada
// que se empaqueta es el bundle de esbuild, que sí es autocontenido.
//
// La salida es CommonJS porque es el formato con mejor soporte en SEA.
//
// Uso:  node scripts/bundle.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRADA = path.join(RAIZ, 'src', 'main.ts');
const SALIDA_DIR = path.join(RAIZ, 'build');
const SALIDA = path.join(SALIDA_DIR, 'main.cjs');

const minificar = process.argv.includes('--minify');

fs.mkdirSync(SALIDA_DIR, { recursive: true });

await esbuild.build({
  entryPoints: [ENTRADA],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: SALIDA,
  minify: minificar,
  sourcemap: !minificar,
  // `node:sqlite` es un builtin: nunca debe intentar empaquetarlo.
  external: ['node:sqlite'],
  banner: {
    // SEA necesita un require shim cuando el bundle es CommonJS.
    js: 'const { createRequire } = require("node:module");',
  },
  logLevel: 'info',
});

const kb = (fs.statSync(SALIDA).size / 1024).toFixed(0);
process.stdout.write(`[bundle] ${path.relative(RAIZ, SALIDA)} (${kb} KB)\n`);
