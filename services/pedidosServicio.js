// backend/services/pedidosServicio.js
import { randomUUID } from "node:crypto";
import { obtenerPool } from "../config/conexion.js";

/* ============================================================
   PEDIDOS — crear + items + estados
   ============================================================ */

const ROSAS_POR_CAJA = 6;

/**
 * Crea un pedido + items desde el carrito.
 * @param {Object} opts
 * @param {string} opts.usuarioId
 * @param {string} opts.vendedorId - opcional (referido_por del cliente)
 * @param {string} opts.programa - "autoship" | "onetime"
 * @param {Array}  opts.rows - filas del carrito (del Build/Review)
 * @param {Object} opts.precio - { autoship, onetime, texto, foto }
 * @param {Object} opts.envio - datos del form
 * @param {Object} opts.facturacion - datos del form (opcional)
 * @param {string} opts.clientRef - idempotencia (UUID)
 * @returns {Promise<{ pedido: object, items: array, existia: boolean }>}
 */
export async function crearPedidoConItems({
  usuarioId,
  vendedorId,
  programa,
  rows,
  precio,
  envio,
  facturacion,
  clientRef,
}) {
  const pool = obtenerPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Idempotencia: si ya existe con ese client_ref, devolverlo
    const { rows: existente } = await client.query(
      `SELECT * FROM pedidos WHERE client_ref = $1 LIMIT 1`,
      [clientRef]
    );
    if (existente[0]) {
      const { rows: items } = await client.query(
        `SELECT * FROM pedido_items WHERE pedido_id = $1 ORDER BY orden`,
        [existente[0].id]
      );
      await client.query("ROLLBACK");
      return { pedido: existente[0], items, existia: true };
    }

    // 2. Calcular totales
    const cajas = rows.reduce((s, r) => s + (r.boxes || 0), 0);
    const rosas = cajas * ROSAS_POR_CAJA;
    const precioRosa =
      programa === "autoship" || cajas >= 17
        ? Number(precio.autoship)
        : Number(precio.onetime);

    // Personalizaciones únicas
    const disenosVistos = new Set();
    let fees = 0;
    rows.forEach((r) => {
      if (r.orderType === "custom" && r.designSig && !disenosVistos.has(r.designSig)) {
        disenosVistos.add(r.designSig);
        fees += r.customMode === "file" ? Number(precio.foto) : Number(precio.texto);
      }
    });

    const subtotal = Math.round((rosas * precioRosa + fees) * 100) / 100;

    // 3. Insertar pedido
    const { rows: nuevoPedido } = await client.query(
      `INSERT INTO pedidos (
        usuario_id, vendedor_id, programa,
        cajas, rosas, precio_por_rosa, subtotal, total, moneda,
        envio_nombre, envio_email, envio_telefono,
        envio_direccion, envio_ciudad, envio_provincia,
        envio_codigo_postal, envio_pais,
        fact_nombre, fact_email, fact_direccion,
        fact_ciudad, fact_provincia, fact_codigo_postal, fact_pais,
        estado, client_ref, metadata
      ) VALUES (
        $1, $2, $3,
        $4, $5, $6, $7, $7, 'USD',
        $8, $9, $10,
        $11, $12, $13,
        $14, $15,
        $16, $17, $18,
        $19, $20, $21, $22,
        'awaiting_payment', $23, $24
      ) RETURNING *`,
      [
        usuarioId, vendedorId, programa,
        cajas, rosas, precioRosa, subtotal,
        envio.nombre, envio.email, envio.telefono,
        envio.direccion, envio.ciudad, envio.provincia,
        envio.codigo_postal, envio.pais,
        facturacion?.nombre || envio.nombre,
        facturacion?.email || envio.email,
        facturacion?.direccion || envio.direccion,
        facturacion?.ciudad || envio.ciudad,
        facturacion?.provincia || envio.provincia,
        facturacion?.codigo_postal || envio.codigo_postal,
        facturacion?.pais || envio.pais,
        clientRef,
        JSON.stringify({ source: "checkout-web", rows: rows.length }),
      ]
    );
    const pedido = nuevoPedido[0];

    // 4. Insertar items
    const itemsInsertados = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const esCustom = r.orderType === "custom";
      const precioItem = r.boxes * ROSAS_POR_CAJA * precioRosa;
      let feeItem = 0;
      if (esCustom && r.designSig) {
        // Solo cobrar si es la primera vez (en este pedido)
        if (!itemsInsertados.some((x) => x.design_sig === r.designSig)) {
          feeItem = r.customMode === "file" ? Number(precio.foto) : Number(precio.texto);
        }
      }

      const { rows: itemRows } = await client.query(
        `INSERT INTO pedido_items (
          pedido_id, orden,
          color_codigo, color_nombre,
          tipo_mensaje,
          categoria_nombre, frase_texto,
          custom_mode, custom_lines, custom_font,
          design_image_url, design_sig,
          recurring,
          cajas, rosas,
          precio_por_rosa, precio_personalizacion, subtotal,
          metadata
        ) VALUES (
          $1, $2,
          $3, $4,
          $5,
          $6, $7,
          $8, $9, $10,
          $11, $12,
          $13,
          $14, $15,
          $16, $17, $18,
          $19
        ) RETURNING *`,
        [
          pedido.id, i + 1,
          r.color?.code || r.color || null,
          r.color?.nombre || null,
          esCustom ? "custom" : "standard",
          r.categoryNombre || null,
          r.phrase || null,
          esCustom ? (r.customMode || "phrase") : null,
          esCustom ? JSON.stringify(r.customLines || []) : null,
          esCustom ? r.customFont || "lora" : null,
          esCustom ? (r.designImage || null) : null,
          esCustom ? (r.designSig || null) : null,
          esCustom ? (r.recurring ?? null) : null,
          r.boxes,
          r.boxes * ROSAS_POR_CAJA,
          precioRosa,
          feeItem,
          Math.round((precioItem + feeItem) * 100) / 100,
          JSON.stringify({ originalRow: r.id }),
        ]
      );
      itemsInsertados.push(itemRows[0]);
    }

    await client.query("COMMIT");
    return { pedido, items: itemsInsertados, existia: false };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Obtiene un pedido + sus items.
 */
export async function obtenerPedido(pedidoId) {
  const pool = obtenerPool();
  const { rows: pedidos } = await pool.query(
    `SELECT * FROM pedidos WHERE id = $1 LIMIT 1`,
    [pedidoId]
  );
  if (!pedidos[0]) return null;
  const { rows: items } = await pool.query(
    `SELECT * FROM pedido_items WHERE pedido_id = $1 ORDER BY orden`,
    [pedidoId]
  );
  return { pedido: pedidos[0], items };
}

/**
 * Marca el pedido como pagado.
 */
export async function marcarPedidoPagado(pedidoId, { captureId, pagadoEn }) {
  const pool = obtenerPool();
  await pool.query(
    `UPDATE pedidos
     SET estado = 'paid', pagado_en = $2, actualizado_en = NOW()
     WHERE id = $1`,
    [pedidoId, pagadoEn || new Date()]
  );
  return obtenerPedido(pedidoId);
}

/**
 * Guarda los datos de factura de QuickBooks en el pedido.
 */
export async function guardarFacturaQuickBooks(pedidoId, { invoiceId, docNumber, invoiceUrl }) {
  const pool = obtenerPool();
  await pool.query(
    `UPDATE pedidos
     SET qbo_invoice_id = $2,
         qbo_invoice_number = $3,
         qbo_invoice_url = $4,
         qbo_enviada_en = NOW(),
         actualizado_en = NOW()
     WHERE id = $1`,
    [pedidoId, invoiceId, docNumber, invoiceUrl]
  );
}

/**
 * Registra un pago en la tabla pagos.
 */
export async function registrarPago({
  pedidoId, proveedor, proveedorOrderId, proveedorCaptureId,
  proveedorPayerId, monto, moneda, comision, montoNeto,
  estado, respuesta, metadata,
}) {
  const pool = obtenerPool();
  const { rows } = await pool.query(
    `INSERT INTO pagos (
      pedido_id, proveedor,
      proveedor_order_id, proveedor_capture_id, proveedor_payer_id,
      monto, moneda, comision, monto_neto,
      estado, respuesta, metadata
    ) VALUES (
      $1, $2,
      $3, $4, $5,
      $6, $7, $8, $9,
      $10, $11, $12
    ) RETURNING *`,
    [
      pedidoId, proveedor,
      proveedorOrderId || null, proveedorCaptureId || null, proveedorPayerId || null,
      monto, moneda || "USD", comision || 0, montoNeto || 0,
      estado || "completado",
      JSON.stringify(respuesta || {}),
      JSON.stringify(metadata || {}),
    ]
  );
  return rows[0];
}