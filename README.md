# Tienda

> Sistema de punto de venta para papelería y tienda general: ventas en
> **US$ / Bs**, crédito con deudores, inventario, caja por moneda y reportes.
> Aplicación de escritorio donde **Tauri 2 es solo la carcasa** y todo el
> negocio —lógica, base de datos y reglas— está escrito en **TypeScript**.

## Funcionalidades

- **Venta (POS)**: catálogo agrupado por secciones con pestañas y buscador,
  carrito, cobro mixto US$/Bs con forma de pago, total fijo por moneda y
  generación de factura. IVA configurable por producto, **0 % por defecto**.
- **Impresión térmica**: por **USB** (spooler/`lp -o raw`) y por **red**
  (JetDirect, puerto 9100 por defecto), con destino configurable desde la app.
- **Factura en PDF**: cada venta guarda su PDF en
  `Documentos/tienda/facturas/`; el modal también imprime el papel.
- **Inventario**: entradas, salidas y ajustes; alertas de stock agotado.
- **Crédito**: deudores con estado de cuenta, abonos mixtos y pagos por moneda.
- **Caja por moneda**: apertura de turno y arqueo de efectivo US$ y Bs por
  separado, con diferencia derivada.
- **Reporte del día**: resumen de ventas y efectivo, exportable a Excel
  (`Documentos/tienda/excel/`).
- **Seguridad**: sesión con PIN de 4 dígitos y roles `admin` / `cajero`.
- **Copias de seguridad**: respaldo automático diario en
  `Documentos/tienda/backups/` (retención de las 30 más recientes) + copia
  manual.
- **Temas**: modo claro y oscuro con interruptor, que por defecto respeta
  `prefers-color-scheme` y después se queda en lo último elegido.

## Stack

| Pieza         | Tecnología                                                          |
| ------------- | ------------------------------------------------------------------- |
| Escritorio    | Tauri 2 · React 18 · TypeScript · Vite · Tailwind CSS               |
| Back end      | TypeScript en Node · `node:sqlite` (`DatabaseSync`) · 64 procedimientos |
| Transporte    | JSON-RPC 2.0 sobre stdio (NDJSON) · modo `--http --port` opcional   |
| Empaquetado   | Node SEA → sidecar `binaries/tienda-db` (`externalBin` de Tauri)    |
| Base de datos | SQLite, esquema versionado v1, 16 tablas                            |
| Rust          | Solo `rutas_app`: resuelve carpetas y arranca el sidecar            |
| Monorepo      | pnpm workspaces (`packages/*`)                                      |

## Por qué así

Antes el backend eran comandos de Rust con `rusqlite`. Se migró a TypeScript
entero porque el dominio —ventas, pagos, caja, factura— vive mucho mejor en un
lenguaje con un solo tipo de sistema y pruebas que corren en milisegundos.

Tauri se queda con lo único que hace él y nadie más puede hacer: abrir la
ventana y empaquetar. En `src-tauri/src` hay 153 líneas y **un** comando,
`rutas_app`, que resuelve `data_dir` y `document_dir` y se las pasa al sidecar
como variables de entorno. Todo lo demás habla JSON-RPC por stdin/stdout.

El sidecar es un ejecutable generado con Node SEA, así que **no hace falta
Node instalado en la PC de la tienda**.

## Estructura

```
posfabi/
├── packages/
│   ├── core/                  # @tienda/core — tipos de dominio y moneda
│   │   └── src/
│   │       ├── types/schema.ts    # tipos del dominio (fuente única)
│   │       └── lib/money.ts       # conversión US$ ⇄ Bs y clave de la tasa
│   ├── db/                    # @tienda/db — el backend entero
│   │   ├── src/
│   │   │   ├── main.ts            # CLI: stdio (JSON-RPC) o --http
│   │   │   ├── rpc.ts             # despachador JSON-RPC 2.0
│   │   │   ├── schema.ts          # esquema SQL v1 (16 tablas)
│   │   │   ├── procedimientos.ts  # registro de los 64 procedimientos |
│   │   │   ├── ventas.ts          # venta atómica y devoluciones
│   │   │   ├── pagos.ts           # pagos, abonos y crédito
│   │   │   ├── caja.ts            # arqueo de turno por moneda
│   │   │   ├── impresora.ts       # USB y red (JetDirect 9100)
│   │   │   ├── backup.ts          # respaldos diarios + retención
│   │   │   └── …                  # factura, resumen, config, seed…
│   │   └── scripts/
│   │       ├── bundle.mjs         # esbuild → build/main.cjs
│   │       └── build-sea.mjs      # Node SEA → binaries/tienda-db-<tripleta>
│   └── desktop/               # @tienda/desktop — la interfaz
│       ├── src/
│       │   ├── App.tsx            # rutas con lazy loading
│       │   ├── index.css          # tokens HSL (claro/oscuro)
│       │   ├── pages/             # 12 páginas (Venta, Productos…)
│       │   ├── pages/venta/       # secciones del catálogo, tarjetas, cobro
│       │   ├── components/ui/     # botones, inputs, modales tokenizados
│       │   ├── services/db.ts     # cliente RPC del sidecar
│       │   └── test/              # contraste.test.ts · paleta.test.ts
│       └── src-tauri/             # carcasa: main.rs + lib.rs (rutas_app)
└── scripts/                    # utilidades de repo
```

## Modelo de moneda dual (US$ / Bs)

- **Base**: precios y totales de venta siempre en **US$** (céntimos enteros).
- **Tasa**: clave global `tasa_cambio` en `config` (Bs por 1 US$), editable
  desde la app.
- **Snapshot**: cada venta, pago o cierre de caja congela la `tasa_cambio`
  vigente; el histórico queda fiel aunque la tasa cambie.
- **Cobros mixtos**: un cobro se compone de pagos en US$ y Bs; cada pago guarda
  su `moneda` y su `tasa_cambio`.
- **Caja por moneda**: arqueo con efectivo inicial/ventas/egresos/final y
  diferencia **por separado** en US$ y en Bs.
- Los montos decimales se manejan en **céntimos** de su moneda.

## Secciones del catálogo

Las secciones (papelería, bisutería, ropa, víveres…) son **categorías
jerárquicas que se crean a mano** desde la pantalla de Categorías; no hay
ninguna sembrada en `seed.ts`. En Venta aparecen como pestañas para saltar de
una a otra, y como cabeceras dentro de la lista «Todas». Con el buscador activo
la lista se desagrupa, porque agrupar y buscar a la vez solo estorba.

## Puesta en marcha

Requisitos: **Node.js ≥ 24** (`node:sqlite`), pnpm ≥ 10 (el monorepo se fija a
`pnpm@11.24.0` vía `packageManager`), Rust estable y las dependencias de
Tauri 2. En Windows, además, MSVC Build Tools.

```bash
pnpm install            # dependencias
pnpm build:core         # tipos compartidos (@tienda/core)

pnpm build:sea          # sidecar del backend — necesario para tauri:dev,
                        # y otra vez tras tocar packages/db

pnpm --filter @tienda/desktop tauri:dev   # app completa (ventana + sidecar)
```

Para trabajar solo en la interfaz, sin backend:

```bash
pnpm dev:desktop        # vite solo
```

## Tests y calidad

```bash
pnpm test               # 641 en packages/db + 334 en packages/desktop |
pnpm typecheck          # core + db + desktop
pnpm --filter @tienda/desktop lint

cd packages/desktop/src-tauri
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test              # las 3 pruebas de la carcasa
```

Dos de esas pruebas son **guardas**, no cobertura:

- `src/test/contraste.test.ts` (46) calcula el contraste WCAG de cada par de
  tokens sobre los HSL de `index.css`, en claro y en oscuro.
- `src/test/paleta.test.ts` (59) barre los ficheros de `src` y comprueba que
  fuera de la zona imprimible no haya escalas de Tailwind ni blanco, que
  dentro de ella sí haya papel y no haya tokens, que ninguna clase tenga
  doble opacidad, y que ningún ancho de anillo vaya sin color de anillo.

## Empaquetado

```bash
pnpm build:sea                                  # backend → SEA
pnpm --filter @tienda/desktop tauri:build       # instalador
```

`build:sea` construye el binario **de la máquina en la que corre** y lo escribe
en `src-tauri/binaries/<nombre>-<tripleta>` — `x86_64-pc-windows-msvc` en
Windows, `x86_64-unknown-linux-gnu` en Linux—. Ese nombre es literal: es el que
Tauri busca por `externalBin`. `binaries/` está en `.gitignore`, así que cada
build debe generarlo.

En Windows hace falta Node 24 o superior, Rust con MSVC Build Tools, y el
`.exe` del sidecar generado antes de lanzar `tauri build`.

## Releases

Al etiquetar una versión se crea un *draft release* con instaladores de
**Windows** (NSIS y MSI) y **Linux** (`.deb`, `.rpm` y AppImage):

```bash
git tag v1.0.0
git push origin v1.0.0
```

> Los binarios **no están firmados** todavía; ver [`SECURITY.md`](./SECURITY.md)
> para firmarlos antes de distribuir en producción.

## Seguridad

[`SECURITY.md`](./SECURITY.md) — CSP, dependencias, reporte de
vulnerabilidades y firma de binarios.

## Fe y paciencia

Cosas que se sabe que no están del todo y se dejan anotadas en vez de
disimuladas:

- `registrarDevolucion` y `anularVenta` no exigen caja abierta (herencia del
  backend anterior).
- Al cerrar caja, `efectivo_final` y `diferencia` salen hardcodeados en el
  camino de prueba; el cálculo real solo existe por moneda.
- Una venta de contado ya no se puede anular si tiene pagos registrados; el
  error `CODIGO_ERROR.venta_con_pagos` es intencional: no se puede anular una
  venta con dinero detrás.
- `README.md` y `CONTRIBUTING.md` describen el estado actual, no la historia;
  para ver lo que cambió, [`CHANGELOG.md`](./CHANGELOG.md).

## Licencia

MIT — ver [`LICENSE`](./LICENSE).
