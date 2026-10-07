# Contribuir

Gracias por colaborar con Tienda. Este documento describe el flujo y el
estándar de calidad del proyecto.

## Pila técnica

- Monorepo pnpm: `packages/core` (tipos y moneda compartidos), `packages/db`
  (el backend entero, en TypeScript sobre `node:sqlite`) y `packages/desktop`
  (interfaz Tauri 2 + React + Vite + Tailwind).
- Rust solo como carcasa: `src-tauri/src` resuelve carpetas (`rutas_app`) y
  lanza el sidecar. No hay lógica de negocio en Rust.
- Toda la comunicación pasa por JSON-RPC 2.0 — stdio (NDJSON) o `--http`.
- Pruebas: Vitest en `packages/db` y `packages/desktop`, `cargo test` en la
  carcasa.

## Flujo de trabajo

1. Crea una rama descriptiva: `fix/nombre`, `feat/nombre`.
2. Haz cambios pequeños y enfocados.
3. Cubre con pruebas cuando aplique.
4. Verifica en local antes del pull request:

   ```bash
   pnpm test               # db + desktop
   pnpm typecheck          # core + db + desktop
   pnpm --filter @tienda/desktop lint
   cd packages/desktop/src-tauri
   cargo fmt --all --check
   cargo clippy --all-targets -- -D warnings
   cargo test
   ```

5. Asegúrate de que el CI pase (corre las mismas comprobaciones).
6. Abre el pull request describiendo qué hace y cómo se probó.

## Estándares

- No introducir comentarios salvo que aporten contexto (el código debe ser
  autoexplicativo).
- Seguir los formatos de ESLint y `cargo fmt` del repo.
- Nunca subir datos de negocio, bases de datos reales ni secretos.
- Mantener `CHANGELOG.md` al día en `[Unreleased]`.