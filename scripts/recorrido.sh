#!/usr/bin/env bash
# Recorrido de negocio completo contra el backend por HTTP.
#
# No es un test: no falla si algo sale mal, imprime lo que responde. Sirve para
# ver de un vistazo qué hay que arreglar cuando se está moviendo un procedure de
# sitio, y para comprobar a mano que el backend sirve sin Tauri.
#
#   node packages/db/build/main.cjs --http --port 3111 &
#   TIENDA_DATA_DIR=... ./scripts/recorrido.sh http://127.0.0.1:3111

set -u
URL="${1:-http://127.0.0.1:3111}"
N=0
# Último cuerpo de respuesta, para no tener que repetir un id a mano en los
# pasos que dependen del id que acaba de devolver la llamada anterior.
RESPUESTA=''

llamar() {
  local method="$1" params="${2:-null}"
  N=$((N + 1))
  local id="$N"
  local cuerpo
  if [ "$params" = "null" ]; then
    cuerpo="{\"jsonrpc\":\"2.0\",\"id\":$id,\"method\":\"$method\"}"
  else
    cuerpo="{\"jsonrpc\":\"2.0\",\"id\":$id,\"method\":\"$method\",\"params\":$params}"
  fi
  RESPUESTA=$(curl -s -X POST "$URL/rpc" -H 'content-type: application/json' -d "$cuerpo")
  printf '%-28s %s\n' "$method" "$RESPUESTA"
}

# El id de la venta que devolvió la última `llamar crear_venta`.
id_venta() {
  printf '%s' "$RESPUESTA" | sed -n 's/^.*"data":{"id":\([0-9][0-9]*\).*$/\1/p'
}

echo "=== arranque ==="
llamar estado_sistema
llamar necesita_configuracion
llamar configurar_admin '{"admin":{"nombre":"Dueña","pin":"4321"}}'
llamar verificar_pin '{"usuario_id":1,"pin":"4321"}'
llamar verificar_pin '{"usuario_id":1,"pin":"0000"}'
llamar cambiar_pin '{"usuario_id":1,"pin_actual":"4321","pin_nuevo":"1234"}'

echo
echo "=== catálogo ==="
llamar crear_categoria '{"categoria":{"nombre":"Papelería","orden":1}}'
llamar crear_categoria '{"categoria":{"nombre":"Cuadernos","parent_id":1,"orden":2}}'
llamar listar_categorias
llamar crear_cliente '{"cliente":{"nombre":"Librería XYZ","documento":"J-31234567","dias_credito":30,"limite_credito":50000,"activo":true}}'
llamar actualizar_cliente '{"id":2,"cliente":{"nombre":"Librería XYZ S.A.","documento":"J-31234567","dias_credito":45,"limite_credito":80000,"activo":true}}'
llamar listar_clientes
llamar crear_producto '{"producto":{"nombre":"Cuaderno tapa dura","codigo":"CUA-001","categoria_id":2,"precio_base":350,"unidad_medida":"unidad","stock_minimo":3,"activo":true}}'
llamar crear_producto '{"producto":{"nombre":"Bolígrafo azul","codigo":"BOL-001","categoria_id":1,"precio_base":50,"unidad_medida":"unidad","activo":true}}'
llamar actualizar_producto '{"id":2,"producto":{"nombre":"Bolígrafo azul (recarga)","codigo":"BOL-001","categoria_id":1,"precio_base":60,"unidad_medida":"unidad","activo":true}}'
llamar obtener_producto '{"id":1}'
llamar listar_productos
llamar set_precio_cliente '{"precio":{"cliente_id":2,"producto_id":1,"precio_especial":300}}'
llamar listar_precios_cliente '{"cliente_id":2}'
llamar eliminar_precio_cliente '{"cliente_id":2,"producto_id":1}'
llamar actualizar_categoria '{"id":2,"categoria":{"nombre":"Cuadernos y cuadernos","parent_id":1,"orden":2}}'
echo "-- campos que no llegan: debe fallar con validacion, no con un error de SQLite --"
llamar crear_cliente '{"cliente":{"nombre":"Sin días","documento":"J-99999999","limite_credito":1000}}'
llamar crear_cliente '{"cliente":{"nombre":"Documento repetido","documento":"0","dias_credito":0,"limite_credito":0}}'

echo
echo "=== inventario ==="
llamar registrar_entrada_mercancia '{"entrada":{"producto_id":1,"cantidad":50,"costo_unitario":180,"operador_id":1,"fecha":"2026-09-29","proveedor":"Distribuidora","documento_ref":"F-001"}}'
llamar registrar_entrada_mercancia '{"entrada":{"producto_id":2,"cantidad":200,"costo_unitario":20,"operador_id":1,"fecha":"2026-09-29"}}'
llamar listar_stock
llamar registrar_ajuste '{"ajuste":{"producto_id":2,"cantidad_delta":-5,"motivo":"Hurto en mostrador","operador_id":1}}'
llamar registrar_merma '{"merma":{"producto_id":2,"cantidad":3,"motivo":"Mal impreso","operador_id":1}}'

echo
echo "=== venta de contado ==="
llamar get_config '{"clave":"tasa_cambio"}'
llamar set_config '{"clave":"tasa_cambio","valor":"36.50"}'
llamar abrir_caja '{"caja":{"operador_id":1}}'
llamar caja_abierta
llamar crear_venta '{"venta":{"cliente_id":1,"tipo":"contado","descuento":0,"operador_id":1,"detalles":[{"producto_id":1,"cantidad":2}],"pagos":[{"monto":700,"tipo_pago":"efectivo","moneda":"usd"}]}}'
llamar crear_venta '{"venta":{"cliente_id":2,"tipo":"credito","descuento":0,"operador_id":1,"detalles":[{"producto_id":2,"cantidad":4}],"pagos":[]}}'
echo "-- venta que excede el stock (debe fallar con stock_insuficiente) --"
llamar crear_venta '{"venta":{"cliente_id":2,"tipo":"credito","descuento":0,"operador_id":1,"detalles":[{"producto_id":1,"cantidad":9999}],"pagos":[]}}'
echo "-- pago insuficiente --"
llamar crear_venta '{"venta":{"cliente_id":1,"tipo":"contado","descuento":0,"operador_id":1,"detalles":[{"producto_id":1,"cantidad":1}],"pagos":[{"monto":100,"tipo_pago":"efectivo","moneda":"usd"}]}}'
echo "-- sobrepago --"
llamar crear_venta '{"venta":{"cliente_id":1,"tipo":"contado","descuento":0,"operador_id":1,"detalles":[{"producto_id":1,"cantidad":1}],"pagos":[{"monto":5000,"tipo_pago":"efectivo","moneda":"usd"}]}}'
echo "-- pago móvil sin número de referencia --"
llamar crear_venta '{"venta":{"cliente_id":1,"tipo":"contado","descuento":0,"operador_id":1,"detalles":[{"producto_id":1,"cantidad":1}],"pagos":[{"monto":350,"tipo_pago":"pago_movil","moneda":"ves"}]}}'
echo "-- pago no efectivo en dólares (regla del negocio) --"
llamar crear_venta '{"venta":{"cliente_id":1,"tipo":"contado","descuento":0,"operador_id":1,"detalles":[{"producto_id":1,"cantidad":1}],"pagos":[{"monto":350,"tipo_pago":"punto","moneda":"usd"}]}}'
echo "-- venta a crédito del Mostrador (no se permite) --"
llamar crear_venta '{"venta":{"cliente_id":1,"tipo":"credito","descuento":0,"operador_id":1,"detalles":[{"producto_id":1,"cantidad":1}],"pagos":[]}}'
echo "-- fracción de un producto por unidad --"
llamar crear_venta '{"venta":{"cliente_id":1,"tipo":"contado","descuento":0,"operador_id":1,"detalles":[{"producto_id":1,"cantidad":1.5}],"pagos":[{"monto":525,"tipo_pago":"efectivo","moneda":"usd"}]}}'
echo "-- venta mixta en las dos monedas, con la tasa congelada --"
llamar crear_venta '{"venta":{"cliente_id":1,"tipo":"contado","descuento":0,"operador_id":1,"detalles":[{"producto_id":1,"cantidad":1}],"pagos":[{"monto":100,"tipo_pago":"efectivo","moneda":"usd"},{"monto":9125,"tipo_pago":"efectivo","moneda":"ves"}]}}'
llamar listar_ventas
llamar listar_ventas
llamar obtener_factura '{"venta_id":1}'
llamar obtener_datos_negocio
llamar listar_ventas

echo
echo "=== anulación: qué se puede anular y qué no ==="
echo "-- venta a crédito sin cobrar: se anula --"
llamar crear_venta '{"venta":{"cliente_id":2,"tipo":"credito","descuento":0,"operador_id":1,"detalles":[{"producto_id":1,"cantidad":1}],"pagos":[]}}'
ANULABLE=$(id_venta)
llamar anular_venta "{\"venta_id\":$ANULABLE,\"motivo\":\"Se cobró de más\",\"operador_id\":1}"
llamar anular_venta "{\"venta_id\":$ANULABLE,\"motivo\":\"otra vez\",\"operador_id\":1}"
echo "-- una venta de contado está cobrada por definición: se veta --"
llamar anular_venta '{"venta_id":1,"motivo":"Error de tecleo","operador_id":1}'
llamar anular_venta '{"venta_id":3,"motivo":"Error de tecleo","operador_id":1}'

echo
echo "=== crédito y abono ==="
llamar estado_cuenta '{"cliente_id":2}'
llamar estado_cuenta_todos
# 8000 Bs = 219 centavos US$ con la tasa congelada de 36,50. Cabe en el saldo
# pendiente de 240 que tiene Librería XYZ, así que el abono entra y la cuenta se
# puede leer con un cliente que realmente debe algo.
llamar registrar_abono '{"abono":{"cliente_id":2,"operador_id":1,"pagos":[{"monto":8000,"tipo_pago":"efectivo","moneda":"ves"}]}}'
echo "-- con el abono encima, esa venta a crédito ya tiene dinero detrás --"
llamar estado_cuenta '{"cliente_id":2}'
llamar anular_venta '{"venta_id":2,"motivo":"El cliente ya abonó","operador_id":1}'
llamar historial_pagos '{"cliente_id":2}'
llamar listar_ventas_cliente '{"cliente_id":2}'
llamar detalle_venta '{"venta_id":2}'

echo
echo "=== devolución ==="
llamar registrar_devolucion '{"devolucion":{"cliente_id":2,"venta_id":2,"monto":240,"motivo":"Se devolvieron plumas","operador_id":1,"afecta_stock":true,"detalle":[{"producto_id":2,"cantidad":4,"precio_unitario":60}]}}'
llamar registrar_devolucion '{"devolucion":{"cliente_id":2,"venta_id":2,"monto":240,"motivo":"Pluma ajena","operador_id":1,"afecta_stock":true}}'
llamar listar_devoluciones '{"cliente_id":2}'
llamar listar_stock

echo
echo "=== factura, ticket e impresión ==="
llamar obtener_factura '{"ventaId":1}'
llamar configurar_destino_impresora '{"destino":{"tipo":"archivo","ruta":"/tmp/opencode/arranque6/ticket.bin"}}'
llamar obtener_destino_impresora
llamar imprimir_ticket '{"ticket":{"negocio_nombre":"Papelería Fabi","negocio_rif":"J-40123456-7","negocio_telefono":"0412-1234567","negocio_direccion":"Av. Principal, Caracas","numero_factura":1,"fecha":"2026-09-29","cliente":"Mostrador","cliente_documento":"0","subtotal":700,"descuento":0,"total":700,"tasa_cambio":36.5,"detalle":[{"producto":"Cuaderno tapa dura","cantidad":2,"subtotal":700}],"pagos":[{"tipo_pago":"efectivo","moneda":"usd","monto":700,"numero_referencia":null}],"devoluciones":[],"recordatorio":null}}'
llamar probar_impresora
llamar listar_impresoras
echo "-- ticket escrito a archivo --"
ls -l /tmp/opencode/arranque6/ticket.bin 2>/dev/null && head -c 200 /tmp/opencode/arranque6/ticket.bin | cat -v | head -8

echo
echo "=== caja ==="
llamar cerrar_caja '{"caja":{"caja_id":1,"operador_id":1,"tasa_cierre":36.5}}'
llamar listar_cajas
llamar resumen_dia '{"fecha":"2026-09-29"}'

echo
echo "=== respaldo y bitácora ==="
llamar crear_backup
llamar listar_backups
llamar hay_backup_hoy
llamar log_error '{"origen":"recorrido","mensaje":"mensaje de prueba\ncon salto de línea"}'
llamar log_evento '{"origen":"recorrido","mensaje":"cierre de caja ok"}'
echo "-- errores.log --"; cat /tmp/opencode/arranque6/datos/errores.log 2>/dev/null
echo "-- traza.log --"; tail -3 /tmp/opencode/arranque6/datos/traza.log 2>/dev/null

echo
echo "=== errores de protocolo ==="
llamar no_existe '{}'
llamar obtener_venta '{}'
llamar obtener_venta '{"venta_id":"siete"}'
llamar eliminar_precios_roto '{"cliente_id":1}'
echo "-- JSON roto por el cuerpo HTTP --"
curl -s -X POST "$URL/rpc" -H 'content-type: application/json' -d 'esto no es json'
echo
echo "-- método no permitido --"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' "$URL/rpc"
curl -s -X PUT "$URL/rpc" -d '{}'
echo
echo "-- lote --"
curl -s -X POST "$URL/rpc" -H 'content-type: application/json' \
  -d '[{"jsonrpc":"2.0","id":"a","method":"caja_abierta"},{"jsonrpc":"2.0","id":"b","method":"listar_categorias"}]'
echo
