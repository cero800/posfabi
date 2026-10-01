// Esquema SQLite del POS de tienda general — versión 1.
//
// Se exporta como constante en vez de leerse de un archivo porque el backend se
// compila en un único ejecutable con Node SEA: importar un .sql obligaría a
// copiarlo aparte al empaquetar. Es el mismo criterio que usaba el original en
// Rust (pub const SCHEMA: &str).
//
// No hay migraciones anteriores que aplicar: esta es la primera versión del
// proyecto y arranca sobre una base nueva. Cada cambio futuro se resuelve con un
// ALTER TABLE no destructivo y un PRAGMA user_version incremental.

/**
 * ## Las fechas de negocio van en hora local, no en UTC
 *
 * Dos columnas del esquema se llenan solas —`pagos.fecha_pago` y
 * `devoluciones.fecha_devolucion`— y las dos usan
 * `DEFAULT (datetime('now','localtime'))` en vez del `CURRENT_TIMESTAMP` de
 * SQLite. La diferencia son las cuatro horas de la tarde, porque
 * `CURRENT_TIMESTAMP` es UTC: un pago hecho a las nueve de la noche en Caracas
 * quedaba con la fecha de mañana, no entraba en el resumen del día y —peor—
 * `efectivoDelDia` no lo contaba en el efectivo esperado del cierre, así que el
 * cierre de caja salía con un faltante exacto de lo cobrado en la tarde. Y como
 * la tienda se cierra de noche, no era un caso raro.
 *
 * Las demás fechas de negocio (`ventas.fecha`, `entradas_mercancia.fecha`,
 * `cajas.fecha`) no tienen valor por defecto a propósito: son `NOT NULL` y el
 * código las escribe siempre con `HOY_SQL` (ver `db.ts`). Así no hay dos caminos
 * que mantener parecidos ni una fila archivada en el día equivocado.
 *
 * Las columnas que no son fecha de negocio (`creado_en`, `actualizado_en`) sí
 * quedan en UTC: son marcas técnicas y no las lee ningún filtro por día.
 *
 * La fecha del *nombre* de los respaldos también es UTC, y por otro motivo
 * distinto —que el nombre ordene bien—, pero eso vive en `backup.ts`, no aquí.
 */

/** Versión actual del esquema (PRAGMA user_version). */
export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
-- ============================ CATÁLOGO ============================

-- Categorías jerárquicas (papelería > útiles escolares > cuadernos).
-- parent_id nulo = categoría raíz.
CREATE TABLE IF NOT EXISTS categorias (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre    TEXT    NOT NULL,
    parent_id INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
    orden     INTEGER NOT NULL DEFAULT 0,
    activo    INTEGER NOT NULL DEFAULT 1
);

-- No puede haber dos categorías con el mismo nombre entre hermanas.
CREATE UNIQUE INDEX IF NOT EXISTS idx_categorias_nombre_hermano
    ON categorias(nombre, IFNULL(parent_id, 0));

CREATE TABLE IF NOT EXISTS clientes (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    documento      TEXT    NOT NULL,   -- cédula, RIF o NIT
    nombre         TEXT    NOT NULL,
    razon_social   TEXT,
    telefono       TEXT,
    email          TEXT,
    direccion      TEXT,
    dias_credito   INTEGER NOT NULL DEFAULT 0,   -- 0 = pago de contado
    limite_credito INTEGER NOT NULL DEFAULT 0,   -- centavos US$; 0 = sin límite
    es_mostrador   INTEGER NOT NULL DEFAULT 0,   -- 1 = Mostrador; no admite crédito
    activo         INTEGER NOT NULL DEFAULT 1,
    creado_en      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- El borrado de clientes y productos es lógico (activo = 0), porque el
-- historial de ventas los referencia para siempre. Por eso los UNIQUE solo
-- abarcan los activos: si no, desactivar "V-1" dejaría ese documento
-- bloqueado y no se podría volver a dar de alta el mismo cliente.
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_documento
    ON clientes(documento)
    WHERE activo = 1;

CREATE TABLE IF NOT EXISTS productos (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo              TEXT    NOT NULL,
    codigo_barras       TEXT,
    nombre              TEXT    NOT NULL,
    descripcion         TEXT,
    categoria_id        INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
    unidad_medida       TEXT    NOT NULL DEFAULT 'unidad',
    precio_base         INTEGER NOT NULL DEFAULT 0,  -- centavos US$
    impuesto_porcentaje REAL    NOT NULL DEFAULT 0,  -- 0..100
    stock_minimo        REAL    NOT NULL DEFAULT 0,  -- alerta de reorden
    activo              INTEGER NOT NULL DEFAULT 1,
    creado_en           DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_productos_codigo
    ON productos(codigo)
    WHERE activo = 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_productos_codigo_barras
    ON productos(codigo_barras)
    WHERE activo = 1 AND codigo_barras IS NOT NULL AND codigo_barras <> '';

CREATE INDEX IF NOT EXISTS idx_productos_categoria ON productos(categoria_id);

-- Precio especial negociado con un cliente. Tiene prioridad sobre precio_base.
CREATE TABLE IF NOT EXISTS precios_cliente (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id      INTEGER NOT NULL,
    producto_id     INTEGER NOT NULL,
    precio_especial INTEGER NOT NULL,   -- centavos US$
    actualizado_en  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cliente_id)  REFERENCES clientes(id)  ON DELETE CASCADE,
    FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE,
    UNIQUE(cliente_id, producto_id)
);

-- ============================ INVENTARIO ============================

CREATE TABLE IF NOT EXISTS stock (
    producto_id         INTEGER PRIMARY KEY,
    cantidad_disponible REAL    NOT NULL DEFAULT 0,
    FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE
);

-- Libro de movimientos. tipo: entrada_mercancia | salida_venta | merma |
-- ajuste | devolucion. cantidad va con signo: entrada (+), salida (−).
CREATE TABLE IF NOT EXISTS movimientos_inventario (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id INTEGER NOT NULL,
    tipo        TEXT    NOT NULL,
    cantidad    REAL    NOT NULL,
    motivo      TEXT,
    venta_id    INTEGER,
    operador_id INTEGER,
    fecha       DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (producto_id) REFERENCES productos(id),
    FOREIGN KEY (venta_id)    REFERENCES ventas(id)    ON DELETE SET NULL
);

-- Recepción de mercadería del proveedor: suma stock y deja traza del costo.
CREATE TABLE IF NOT EXISTS entradas_mercancia (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha          DATE    NOT NULL,
    producto_id    INTEGER NOT NULL,
    cantidad       REAL    NOT NULL,
    costo_unitario INTEGER NOT NULL DEFAULT 0,  -- centavos US$
    proveedor      TEXT,
    documento_ref  TEXT,                        -- número de la factura de compra
    operador_id    INTEGER,
    creado_en      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (producto_id) REFERENCES productos(id)
);

-- ============================ VENTAS ============================

-- tipo: contado | credito     estado: entregada | anulada
-- subtotal/descuento/impuesto/total SIEMPRE en centavos de US$ (moneda base).
-- tasa_cambio es el snapshot de Bs por 1 US$ al momento de la venta, para
-- poder mostrar el equivalente en Bs aunque la tasa cambie después.
CREATE TABLE IF NOT EXISTS ventas (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id     INTEGER NOT NULL,
    numero_factura INTEGER NOT NULL UNIQUE,
    tipo           TEXT    NOT NULL,
    estado         TEXT    NOT NULL DEFAULT 'entregada',
    fecha          DATE    NOT NULL,
    subtotal       INTEGER NOT NULL DEFAULT 0,  -- centavos US$
    descuento      INTEGER NOT NULL DEFAULT 0,  -- centavos US$
    impuesto       INTEGER NOT NULL DEFAULT 0,  -- centavos US$
    total          INTEGER NOT NULL DEFAULT 0,  -- centavos US$
    moneda         TEXT    NOT NULL DEFAULT 'usd',
    tasa_cambio    REAL    NOT NULL DEFAULT 1,  -- Bs por 1 US$ (snapshot)
    anulada_motivo TEXT,
    operador_id    INTEGER,
    creado_en      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);

CREATE TABLE IF NOT EXISTS detalle_ventas (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    venta_id        INTEGER NOT NULL,
    producto_id     INTEGER NOT NULL,
    cantidad        REAL    NOT NULL,
    precio_unitario INTEGER NOT NULL,  -- centavos US$
    subtotal        INTEGER NOT NULL,  -- centavos US$
    FOREIGN KEY (venta_id)    REFERENCES ventas(id)    ON DELETE CASCADE,
    FOREIGN KEY (producto_id) REFERENCES productos(id)
);

-- ============================ PAGOS ============================

-- tipo_pago: efectivo | pago_movil | punto | biopago
-- venta_id nulo = abono a cuenta, sin factura específica.
-- monto está en céntimos de LA MONEDA DEL PAGO; con moneda + tasa_cambio
-- (snapshot del pago) se convierte a US$, lo que permite cobrar una venta con
-- varias líneas de pago en distintas monedas.
CREATE TABLE IF NOT EXISTS pagos (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id        INTEGER NOT NULL,
    venta_id          INTEGER,
    monto             INTEGER NOT NULL,  -- centavos de la moneda del pago
    tipo_pago         TEXT    NOT NULL DEFAULT 'efectivo',
    moneda            TEXT    NOT NULL DEFAULT 'usd',  -- usd | ves
    tasa_cambio       REAL    NOT NULL DEFAULT 1,      -- Bs por 1 US$ (snapshot)
    numero_referencia TEXT,
    operador_id       INTEGER,
    fecha_pago        DATETIME DEFAULT (datetime('now','localtime')),
    observaciones     TEXT,
    creado_en         DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id),
    FOREIGN KEY (venta_id)   REFERENCES ventas(id)   ON DELETE SET NULL
);

-- ============================ DEVOLUCIONES ============================

-- Ajuste que resta del total facturado de un cliente. No modifica la factura
-- original ni el efectivo de la caja; solo ajusta el estado de cuenta.
-- afecta_stock = 1 cuando la mercadería vuelve al inventario (el caso normal
-- en una tienda); = 0 cuando es un ajuste de cuentas por mercadería dañada o
-- perdida.
CREATE TABLE IF NOT EXISTS devoluciones (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id       INTEGER NOT NULL,
    venta_id         INTEGER NOT NULL,
    monto            INTEGER NOT NULL,  -- centavos US$
    motivo           TEXT,
    afecta_stock     INTEGER NOT NULL DEFAULT 1,
    operador_id      INTEGER,
    fecha_devolucion DATETIME DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (cliente_id) REFERENCES clientes(id),
    FOREIGN KEY (venta_id)   REFERENCES ventas(id)  ON DELETE SET NULL
);

-- Qué productos y cantidades se devolvieron en cada ajuste.
-- subtotal = redondeo(cantidad * precio_unitario); la suma debe igualar al
-- monto de la devolución.
CREATE TABLE IF NOT EXISTS detalle_devoluciones (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    devolucion_id   INTEGER NOT NULL,
    producto_id     INTEGER NOT NULL,
    cantidad        REAL    NOT NULL,
    precio_unitario INTEGER NOT NULL,  -- centavos US$
    subtotal        INTEGER NOT NULL,  -- centavos US$
    FOREIGN KEY (devolucion_id) REFERENCES devoluciones(id) ON DELETE CASCADE,
    FOREIGN KEY (producto_id)   REFERENCES productos(id)
);

-- ============================ OPERACIÓN ============================

-- rol: admin | cajero
CREATE TABLE IF NOT EXISTS usuarios (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre    TEXT NOT NULL,
    rol       TEXT NOT NULL DEFAULT 'cajero',
    pin       TEXT,   -- PIN numérico de 4 dígitos
    activo    INTEGER NOT NULL DEFAULT 1,
    creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- estado: abierta | cerrada
-- Arqueo POR MONEDA: la caja controla efectivo US$ y Bs por separado.
-- efectivo_esperado = inicial + ventas + abonos - egresos - devoluciones;
-- diferencia = final - esperado. Todo calculado por moneda en cerrar_caja.
CREATE TABLE IF NOT EXISTS cajas (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha                 DATE    NOT NULL,
    operador_id           INTEGER NOT NULL,
    efectivo_inicial_usd  INTEGER NOT NULL DEFAULT 0,
    efectivo_inicial_ves  INTEGER NOT NULL DEFAULT 0,
    efectivo_ventas_usd   INTEGER NOT NULL DEFAULT 0,
    efectivo_ventas_ves   INTEGER NOT NULL DEFAULT 0,
    efectivo_egresos_usd  INTEGER NOT NULL DEFAULT 0,
    efectivo_egresos_ves  INTEGER NOT NULL DEFAULT 0,
    efectivo_final_usd    INTEGER NOT NULL DEFAULT 0,
    efectivo_final_ves    INTEGER NOT NULL DEFAULT 0,
    efectivo_esperado_usd INTEGER NOT NULL DEFAULT 0,
    efectivo_esperado_ves INTEGER NOT NULL DEFAULT 0,
    diferencia_usd        INTEGER NOT NULL DEFAULT 0,
    diferencia_ves        INTEGER NOT NULL DEFAULT 0,
    tasa_cierre           REAL    NOT NULL DEFAULT 0,  -- snapshot al cerrar
    estado                TEXT    NOT NULL DEFAULT 'abierta',
    creado_en             DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (operador_id) REFERENCES usuarios(id)
);

-- Desglose por método de pago y moneda al cerrar el turno. El arqueo de cajas
-- solo cubre el efectivo (es lo que el cajero cuenta con la mano); esta tabla
-- deja constancia de cómo entró el resto del dinero del día.
CREATE TABLE IF NOT EXISTS cierre_caja_pagos (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    caja_id   INTEGER NOT NULL,
    tipo_pago TEXT    NOT NULL,
    moneda    TEXT    NOT NULL,
    monto     INTEGER NOT NULL,   -- centavos de esa moneda
    FOREIGN KEY (caja_id) REFERENCES cajas(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS config (
    clave TEXT PRIMARY KEY,
    valor TEXT
);

-- ============================ ÍNDICES ============================

CREATE INDEX IF NOT EXISTS idx_precios_cliente    ON precios_cliente(cliente_id, producto_id);
CREATE INDEX IF NOT EXISTS idx_mov_prod          ON movimientos_inventario(producto_id);
CREATE INDEX IF NOT EXISTS idx_mov_fecha         ON movimientos_inventario(fecha);
CREATE INDEX IF NOT EXISTS idx_ventas_cliente    ON ventas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_ventas_fecha      ON ventas(fecha);
CREATE INDEX IF NOT EXISTS idx_detalle_venta     ON detalle_ventas(venta_id);
CREATE INDEX IF NOT EXISTS idx_pagos_cliente     ON pagos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pagos_venta       ON pagos(venta_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_cli  ON devoluciones(cliente_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_ven  ON devoluciones(venta_id);
CREATE INDEX IF NOT EXISTS idx_detalle_devol     ON detalle_devoluciones(devolucion_id);
CREATE INDEX IF NOT EXISTS idx_entradas_prod     ON entradas_mercancia(producto_id);
CREATE INDEX IF NOT EXISTS idx_entradas_fecha    ON entradas_mercancia(fecha);
CREATE INDEX IF NOT EXISTS idx_cajas_fecha       ON cajas(fecha);
CREATE INDEX IF NOT EXISTS idx_cierre_pagos_caja ON cierre_caja_pagos(caja_id);
`;
