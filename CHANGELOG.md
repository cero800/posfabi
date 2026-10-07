# Changelog

Todos los cambios notables del proyecto se documentan aquí. Formato basado en
[Keep a Changelog](https://keepachangelog.com/es/1.1.0/).

## [Unreleased]

### Agregado

- **El backend pasó de Rust a TypeScript**: `packages/db` es ahora el negocio
  entero —esquema, ventas, pagos, caja, impresión, respaldos— escrito sobre
  `node:sqlite` y servido por JSON-RPC 2.0 (stdio NDJSON, con modo `--http`).
  Tauri se queda solo como carcasa: en `src-tauri/src` queda un comando,
  `rutas_app`.
- **Empaquetado con Node SEA**: el backend sale como un binario único
  (`binaries/tienda-db`, `externalBin` de Tauri), así que la PC de la tienda no
  necesita Node instalado.
- **Rediseño visual**: paleta blanca/azul/morada sobre tokens HSL, modo
  oscuro y claro con interruptor Sol/Luna persistente (por defecto respeta
  `prefers-color-scheme`), y componentes tokenizados.
- **Secciones del catálogo** en Venta: pestañas por sección y cabeceras dentro
  de «Todas»; con el buscador activo la lista se desagrupa.
- **Impresora térmica por USB y por red** (JetDirect, puerto 9100 por defecto),
  con destino configurable desde la app.
- Guardas de interfaz: `contraste.test.ts` (46 pruebas WCAG sobre los HSL en
  ambos modos) y `paleta.test.ts` (59 pruebas sobre la paleta y la zona
  imprimible).
- Seguridad: PIN numérico de 4 dígitos por operador al iniciar turno.
- Roles `admin`/`cajero`: la Configuración y las mermas/ajustes de inventario
  ahora son exclusivos del administrador.
- Cambio de PIN propio desde Configuración (admin).
- Copias de seguridad de la base de datos: copia automática diaria y copia
  manual, en `Documentos/tienda/backups`, con retención de las 30 más
  recientes.
- Registro de errores de la interfaz en `app_data/errores.log`.
- Exportación del Reporte del día a Excel
  (`Documentos/tienda/excel/reporte-AAAA-MM-DD.xlsx`).
- Política de seguridad de contenido (CSP) para la ventana de escritorio.
- CI en pull requests: typecheck, build, tests (db + desktop), ESLint,
  `cargo fmt`, `cargo clippy` y `cargo test`.
- Análisis estático de seguridad (CodeQL) y Dependabot.
- Plantillas de issues/PR, CONTRIBUTING, CHANGELOG y SECURITY.
- Flujo de releases: instaladores Linux (deb/rpm/AppImage) y Windows
  (NSIS/MSI) al etiquetar `v*`.

### Cambiado

- **Esquema v1 limpio** orientado a papelería y tienda general: se retira el
  código de la panadería y el paquete `packages/mobile`.
- **Identidad**: «Kalientico» pasa a «Tienda» (`com.tienda.pos`); las carpetas
  de facturas, Excel y respaldos pasan a `Documentos/tienda/`.
- Los datos de la panadería no se migran: esquema nuevo, sin semillas.
- Los wrappers `invoke()` de la interfaz pasan a un cliente RPC
  (`services/db.ts`); los 36 comandos Tauri dejan de existir.
- En builds de producción la base de datos ya no se recrea ante cambios de
  esquema (migración no destructiva).
- El bundle inicial bajó de ~625 KB a ~200 KB al cargar jsPDF/ExcelJS de forma
  diferida (lazy loading de páginas).

### Arreglado

- Varios avisos de ESLint/clippy (código sin usos, simplificaciones).

## [1.0.0] - 2026-09-05

### Agregado

- Guardado automático de cada factura en PDF
  (`Documentos/kalientico/facturas/factura-NNNN-AAAA-MM-DD.pdf`).
- Cobro y deuda con monto total fijo en US$ y Bs, válido para la nueva
  modalidad de precios (montos redondeados al céntimo).
- Barrido de precios especiales, número de caja y arqueo del código.
- Identidad visual en la barra lateral: «Kalientico».

### Cambiado

- La caja pasa a arqueo independiente por moneda (US$/Bs).

### Fijado

- Cierre de caja y reportes con la nueva moneda dual.