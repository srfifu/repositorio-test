// backend/services/facturasServicio.js
import { obtenerPool } from "../config/conexion.js";

/* ============================================================
   FACTURAS
   ============================================================
   Una factura = un pedido con datos de QuickBooks.
   Fuente: tabla `pedidos` (qbo_invoice_number, qbo_invoice_url, etc.)

   Estados posibles de un pedido:
   - awaiting_payment → factura generada, esperando pago
   - paid             → factura pagada
   - paused_unpaid    → factura vencida (>5 días sin pagar)
   - cancelled        → pedido cancelado
   ============================================================ */

const URL_BACKEND = process.env.URL_BACKEND || "http://localhost:3000";

/* ============================================================
   LISTADO PARA ADMIN — todas las facturas del sistema
   ============================================================ */
export async function listarFacturasAdmin(filtros = {}) {
  const pool = obtenerPool();
  const {
    buscar = null,
    estado = null,
    programa = null,
    desde = null,
    hasta = null,
    limite = 100,
    offset = 0,
  } = filtros;

  const condiciones = ["1=1"];
  const valores = [];
  let i = 1;

  if (estado && estado !== "all") {
    condiciones.push(`p.estado = $${i}`);
    valores.push(estado);
    i++;
  }
  if (programa && programa !== "all") {
    condiciones.push(`p.programa = $${i}`);
    valores.push(programa);
    i++;
  }
  if (desde) {
    condiciones.push(`p.creado_en >= $${i}`);
    valores.push(desde);
    i++;
  }
  if (hasta) {
    condiciones.push(`p.creado_en <= $${i}`);
    valores.push(hasta);
    i++;
  }
  if (buscar) {
    condiciones.push(`(
      p.numero ILIKE $${i}
      OR p.qbo_invoice_number ILIKE $${i}
      OR u.correo ILIKE $${i}
      OR u.nombre ILIKE $${i}
      OR ud.nombre_tienda ILIKE $${i}
    )`);
    valores.push(`%${buscar}%`);
    i++;
  }

  const where = `WHERE ${condiciones.join(" AND ")}`;

  // Query de facturas
  valores.push(limite, offset);
  const { rows: facturas } = await pool.query(
    `SELECT
       p.id,
       p.numero,
       p.programa,
       p.estado,
       p.cajas,
       p.rosas,
       p.total,
       p.moneda,
       p.qbo_invoice_id,
       p.qbo_invoice_number,
       p.qbo_invoice_url,
       p.qbo_enviada_en,
       p.pagado_en,
       p.creado_en,
       p.actualizado_en,
       u.id           AS usuario_id,
       u.correo       AS usuario_correo,
       u.nombre       AS usuario_nombre,
       ud.nombre_tienda AS tienda_nombre,
       ud.telefono    AS tienda_telefono,
       v.id           AS vendedor_id,
       v.correo       AS vendedor_correo,
       vc.nombre_comercial AS vendedor_comercial
     FROM pedidos p
     LEFT JOIN usuarios u ON u.id = p.usuario_id
     LEFT JOIN usuarios_detalles ud ON ud.usuario_id = u.id
     LEFT JOIN usuarios v ON v.id = p.vendedor_id
     LEFT JOIN vendedores_config vc ON vc.usuario_id = v.id
     ${where}
     ORDER BY p.creado_en DESC
     LIMIT $${i} OFFSET $${i + 1}`,
    valores
  );

  // KPIs globales (sin filtros)
  const { rows: kpis } = await pool.query(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE estado = 'awaiting_payment') AS pendientes,
       COUNT(*) FILTER (WHERE estado = 'paused_unpaid')    AS vencidas,
       COUNT(*) FILTER (WHERE estado = 'paid')             AS pagadas,
       COUNT(*) FILTER (WHERE estado = 'cancelled')        AS canceladas,
       COALESCE(SUM(total) FILTER (WHERE estado = 'paid'), 0) AS facturado
     FROM pedidos`
  );

  return {
    facturas: facturas.map((f) => ({
      ...f,
      total: Number(f.total),
      cajas: Number(f.cajas),
      rosas: Number(f.rosas),
    })),
    kpis: {
      total: Number(kpis[0].total),
      pendientes: Number(kpis[0].pendientes),
      vencidas: Number(kpis[0].vencidas),
      pagadas: Number(kpis[0].pagadas),
      canceladas: Number(kpis[0].canceladas),
      facturado: Number(kpis[0].facturado),
    },
  };
}

/* ============================================================
   DETALLE DE UNA FACTURA (admin)
   ============================================================ */
export async function obtenerFacturaAdmin(pedidoId) {
  const pool = obtenerPool();

  const { rows: pedidos } = await pool.query(
    `SELECT
       p.*,
       u.id           AS usuario_id,
       u.correo       AS usuario_correo,
       u.nombre       AS usuario_nombre,
       ud.nombre_tienda AS tienda_nombre,
       ud.telefono    AS tienda_telefono,
       ud.direccion   AS tienda_direccion,
       ud.ciudad      AS tienda_ciudad,
       ud.provincia   AS tienda_provincia,
       ud.codigo_postal AS tienda_codigo_postal,
       ud.pais        AS tienda_pais,
       v.id           AS vendedor_id,
       v.correo       AS vendedor_correo,
       vc.nombre_comercial AS vendedor_comercial
     FROM pedidos p
     LEFT JOIN usuarios u ON u.id = p.usuario_id
     LEFT JOIN usuarios_detalles ud ON ud.usuario_id = u.id
     LEFT JOIN usuarios v ON v.id = p.vendedor_id
     LEFT JOIN vendedores_config vc ON vc.usuario_id = v.id
     WHERE p.id = $1
     LIMIT 1`,
    [pedidoId]
  );
  if (!pedidos[0]) return null;
  const pedido = pedidos[0];

  // Items con imágenes
  const { rows: items } = await pool.query(
    `SELECT
       pi.id, pi.orden,
       pi.color_codigo, pi.color_nombre,
       pi.tipo_mensaje,
       pi.categoria_nombre, pi.frase_texto,
       pi.custom_mode, pi.custom_lines, pi.custom_font,
       pi.design_image_url, pi.design_sig,
       pi.recurring,
       pi.cajas, pi.rosas,
       pi.precio_por_rosa, pi.precio_personalizacion, pi.subtotal,
       cc.slug       AS color_slug,
       cc.hex        AS color_hex,
       cc.edge       AS color_edge,
       cc.ink        AS color_ink,
       (SELECT bi.uuid_archivo FROM biblioteca_imagenes bi
        WHERE bi.color_id = cc.id AND bi.tipo = 'boxphoto' AND bi.activo = TRUE
        LIMIT 1) AS boxphoto_uuid,
       (SELECT bi.uuid_archivo FROM biblioteca_imagenes bi
        WHERE bi.color_id = cc.id AND bi.tipo = 'rosephoto' AND bi.activo = TRUE
        LIMIT 1) AS rosephoto_uuid,
       (SELECT bi.uuid_archivo FROM biblioteca_imagenes bi
        WHERE bi.frase_id = pi.frase_id AND bi.color_id = cc.id
          AND bi.tipo = 'frasephoto' AND bi.activo = TRUE
        LIMIT 1) AS frasephoto_uuid
     FROM pedido_items pi
     LEFT JOIN catalogo_colores cc ON cc.codigo = pi.color_codigo
     WHERE pi.pedido_id = $1
     ORDER BY pi.orden ASC`,
    [pedidoId]
  );

  const urlArchivo = (uuid) => uuid ? `${URL_BACKEND}/api/library/file/${uuid}` : null;

  const itemsCompletos = items.map((it) => {
    let customLines = null;
    if (it.custom_lines) {
      try {
        customLines = typeof it.custom_lines === "string"
          ? JSON.parse(it.custom_lines)
          : it.custom_lines;
      } catch { customLines = null; }
    }

    return {
      id: it.id,
      orden: it.orden,
      color_codigo: it.color_codigo,
      color_nombre: it.color_nombre,
      color_slug: it.color_slug,
      color_hex: it.color_hex || "#f1ece6",
      color_edge: it.color_edge || "#d9d1c8",
      color_ink: it.color_ink || "#a8843f",
      tipo_mensaje: it.tipo_mensaje,
      categoria_nombre: it.categoria_nombre,
      frase_texto: it.frase_texto,
      custom_mode: it.custom_mode,
      custom_lines: customLines,
      custom_font: it.custom_font,
      design_image_url: it.design_image_url,
      design_sig: it.design_sig,
      recurring: it.recurring,
      cajas: Number(it.cajas),
      rosas: Number(it.rosas),
      precio_por_rosa: Number(it.precio_por_rosa),
      precio_personalizacion: Number(it.precio_personalizacion),
      subtotal: Number(it.subtotal),
      imagenes: {
        boxphoto: urlArchivo(it.boxphoto_uuid),
        rosephoto: urlArchivo(it.rosephoto_uuid),
        frasephoto: urlArchivo(it.frasephoto_uuid),
      },
    };
  });

  // Pagos asociados
  const { rows: pagos } = await pool.query(
    `SELECT
       id, proveedor, estado,
       monto, moneda, comision, monto_neto,
       proveedor_order_id, proveedor_capture_id,
       creado_en
     FROM pagos
     WHERE pedido_id = $1
     ORDER BY creado_en DESC`,
    [pedidoId]
  );

  return {
    factura: {
      ...pedido,
      total: Number(pedido.total),
      subtotal: Number(pedido.subtotal),
      impuesto: Number(pedido.impuesto),
      cajas: Number(pedido.cajas),
      rosas: Number(pedido.rosas),
      hasCustom: itemsCompletos.some((it) => it.tipo_mensaje === "custom"),
    },
    items: itemsCompletos,
    pagos: pagos.map((p) => ({
      ...p,
      monto: Number(p.monto),
      comision: Number(p.comision),
      monto_neto: Number(p.monto_neto),
    })),
  };
}

/* ============================================================
   LISTADO PARA CLIENTE — solo sus propias facturas
   ============================================================ */
export async function listarMisFacturas(usuarioId, filtros = {}) {
  const pool = obtenerPool();
  const {
    buscar = null,
    estado = null,
    programa = null,
    desde = null,
    hasta = null,
    limite = 100,
    offset = 0,
  } = filtros;

  const condiciones = ["p.usuario_id = $1"];
  const valores = [usuarioId];
  let i = 2;

  if (estado && estado !== "all") {
    condiciones.push(`p.estado = $${i}`);
    valores.push(estado);
    i++;
  }
  if (programa && programa !== "all") {
    condiciones.push(`p.programa = $${i}`);
    valores.push(programa);
    i++;
  }
  if (desde) {
    condiciones.push(`p.creado_en >= $${i}`);
    valores.push(desde);
    i++;
  }
  if (hasta) {
    condiciones.push(`p.creado_en <= $${i}`);
    valores.push(hasta);
    i++;
  }
  if (buscar) {
    condiciones.push(`(
      p.numero ILIKE $${i}
      OR p.qbo_invoice_number ILIKE $${i}
    )`);
    valores.push(`%${buscar}%`);
    i++;
  }

  const where = `WHERE ${condiciones.join(" AND ")}`;

  valores.push(limite, offset);
  const { rows: facturas } = await pool.query(
    `SELECT
       p.id,
       p.numero,
       p.programa,
       p.estado,
       p.cajas,
       p.rosas,
       p.total,
       p.moneda,
       p.qbo_invoice_number,
       p.qbo_invoice_url,
       p.qbo_enviada_en,
       p.pagado_en,
       p.creado_en
     FROM pedidos p
     ${where}
     ORDER BY p.creado_en DESC
     LIMIT $${i} OFFSET $${i + 1}`,
    valores
  );

  // KPIs del cliente
  const { rows: kpis } = await pool.query(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE estado = 'awaiting_payment') AS pendientes,
       COUNT(*) FILTER (WHERE estado = 'paused_unpaid')    AS vencidas,
       COUNT(*) FILTER (WHERE estado = 'paid')             AS pagadas,
       COALESCE(SUM(total) FILTER (WHERE estado = 'paid'), 0)    AS facturado,
       COALESCE(SUM(total) FILTER (WHERE estado = 'awaiting_payment'), 0) AS por_pagar
     FROM pedidos
     WHERE usuario_id = $1`,
    [usuarioId]
  );

  return {
    facturas: facturas.map((f) => ({
      ...f,
      total: Number(f.total),
      cajas: Number(f.cajas),
      rosas: Number(f.rosas),
    })),
    kpis: {
      total: Number(kpis[0].total),
      pendientes: Number(kpis[0].pendientes),
      vencidas: Number(kpis[0].vencidas),
      pagadas: Number(kpis[0].pagadas),
      facturado: Number(kpis[0].facturado),
      porPagar: Number(kpis[0].por_pagar),
    },
  };
}

/* ============================================================
   DETALLE DE UNA FACTURA PROPIA (cliente)
   ============================================================ */
export async function obtenerMiFactura(usuarioId, pedidoId) {
  const pool = obtenerPool();

  // Verificar propiedad
  const { rows: check } = await pool.query(
    `SELECT id FROM pedidos WHERE id = $1 AND usuario_id = $2 LIMIT 1`,
    [pedidoId, usuarioId]
  );
  if (!check[0]) return null;

  // Reutilizar la función de admin (ya trae todo)
  return obtenerFacturaAdmin(pedidoId);
}

/* ============================================================
   REENVIAR FACTURA POR EMAIL (QuickBooks)
   ============================================================ */
export async function marcarFacturaReenviada(pedidoId) {
  const pool = obtenerPool();
  await pool.query(
    `UPDATE pedidos
     SET qbo_enviada_en = NOW(),
         actualizado_en = NOW()
     WHERE id = $1`,
    [pedidoId]
  );
}