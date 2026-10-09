// backend/services/vendedorPedidosServicio.js
import { obtenerPool } from "../config/conexion.js";

/* ============================================================
   VENDEDOR — PEDIDOS Y SUSCRIPCIONES DE SUS CLIENTES
   ============================================================
   Solo muestra pedidos/suscripciones de los clientes que
   tienen al vendedor logueado como `referido_por`.
   ============================================================ */

const URL_BACKEND = process.env.URL_BACKEND || "http://localhost:3000";

function urlArchivo(uuid) {
  if (!uuid) return null;
  return `${URL_BACKEND}/api/library/file/${uuid}`;
}

/**
 * Lista los pedidos de los clientes del vendedor.
 */
export async function listarPedidosVendedor(vendedorId, filtros = {}) {
  const pool = obtenerPool();
  const {
    buscar = null,
    estado = null,
    programa = null,
    clienteId = null,
    desde = null,
    hasta = null,
    limite = 100,
    offset = 0,
  } = filtros;

  const condiciones = [`p.vendedor_id = $1`];
  const valores = [vendedorId];
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
  if (clienteId) {
    condiciones.push(`p.usuario_id = $${i}`);
    valores.push(clienteId);
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
      p.numero ILIKE $${i} OR
      p.qbo_invoice_number ILIKE $${i} OR
      u.correo ILIKE $${i} OR
      u.nombre ILIKE $${i} OR
      ud.nombre_tienda ILIKE $${i}
    )`);
    valores.push(`%${buscar}%`);
    i++;
  }

  const where = `WHERE ${condiciones.join(" AND ")}`;

  valores.push(limite, offset);
  const { rows } = await pool.query(
    `SELECT
       p.id, p.numero, p.programa, p.estado,
       p.cajas, p.rosas, p.precio_por_rosa,
       p.subtotal, p.impuesto, p.total, p.moneda,
       p.qbo_invoice_number, p.qbo_invoice_url,
       p.client_ref, p.pagado_en, p.creado_en,
       u.id            AS usuario_id,
       u.correo        AS usuario_correo,
       u.nombre        AS usuario_nombre,
       ud.nombre_tienda AS tienda_nombre,
       ud.telefono     AS tienda_telefono
     FROM pedidos p
     LEFT JOIN usuarios u ON u.id = p.usuario_id
     LEFT JOIN usuarios_detalles ud ON ud.usuario_id = u.id
     ${where}
     ORDER BY p.creado_en DESC
     LIMIT $${i} OFFSET $${i + 1}`,
    valores
  );

  return rows.map((p) => ({
    ...p,
    subtotal: Number(p.subtotal),
    impuesto: Number(p.impuesto),
    total: Number(p.total),
    precio_por_rosa: Number(p.precio_por_rosa),
    cajas: Number(p.cajas),
    rosas: Number(p.rosas),
  }));
}

/**
 * KPIs de los pedidos del vendedor.
 */
export async function kpisPedidosVendedor(vendedorId) {
  const pool = obtenerPool();
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE estado = 'awaiting_payment') AS pendientes,
       COUNT(*) FILTER (WHERE estado = 'paid')             AS pagados,
       COUNT(*) FILTER (WHERE estado = 'paused_unpaid')    AS pausados,
       COUNT(*) FILTER (WHERE estado = 'cancelled')        AS cancelados,
       COALESCE(SUM(total) FILTER (WHERE estado = 'paid'), 0) AS facturado,
       COALESCE(SUM(total) FILTER (WHERE estado = 'awaiting_payment'), 0) AS por_cobrar
     FROM pedidos
     WHERE vendedor_id = $1`,
    [vendedorId]
  );
  const k = rows[0] || {};
  return {
    total: Number(k.total || 0),
    pendientes: Number(k.pendientes || 0),
    pagados: Number(k.pagados || 0),
    pausados: Number(k.pausados || 0),
    cancelados: Number(k.cancelados || 0),
    facturado: Number(k.facturado || 0),
    porCobrar: Number(k.por_cobrar || 0),
  };
}

/**
 * Detalle completo de un pedido (verificando propiedad).
 */
export async function obtenerPedidoVendedor(vendedorId, pedidoId) {
  const pool = obtenerPool();

  const { rows: pedidos } = await pool.query(
    `SELECT
       p.*,
       u.id            AS usuario_id,
       u.correo        AS usuario_correo,
       u.nombre        AS usuario_nombre,
       ud.nombre_tienda AS tienda_nombre,
       ud.telefono     AS tienda_telefono,
       ud.direccion    AS tienda_direccion,
       ud.ciudad       AS tienda_ciudad,
       ud.provincia    AS tienda_provincia,
       ud.codigo_postal AS tienda_codigo_postal,
       ud.pais         AS tienda_pais
     FROM pedidos p
     LEFT JOIN usuarios u ON u.id = p.usuario_id
     LEFT JOIN usuarios_detalles ud ON ud.usuario_id = u.id
     WHERE p.id = $1 AND p.vendedor_id = $2
     LIMIT 1`,
    [pedidoId, vendedorId]
  );
  if (!pedidos[0]) return null;
  const pedido = pedidos[0];

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

  const { rows: pagos } = await pool.query(
    `SELECT
       id, proveedor, estado, monto, moneda, comision, monto_neto,
       proveedor_order_id, proveedor_capture_id, creado_en
     FROM pagos
     WHERE pedido_id = $1
     ORDER BY creado_en DESC`,
    [pedidoId]
  );

  return {
    pedido: {
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

/**
 * Lista las suscripciones de los clientes del vendedor.
 */
export async function listarSuscripcionesVendedor(vendedorId, filtros = {}) {
  const pool = obtenerPool();
  const {
    buscar = null,
    estado = null,
    clienteId = null,
    desde = null,
    hasta = null,
    proximas = null,
    limite = 100,
    offset = 0,
  } = filtros;

  const condiciones = [`s.vendedor_id = $1`];
  const valores = [vendedorId];
  let i = 2;

  if (estado && estado !== "all") {
    if (estado === "paused") {
      condiciones.push(`s.estado IN ('paused', 'paused_unpaid')`);
    } else {
      condiciones.push(`s.estado = $${i}`);
      valores.push(estado);
      i++;
    }
  }
  if (clienteId) {
    condiciones.push(`s.usuario_id = $${i}`);
    valores.push(clienteId);
    i++;
  }
  if (desde) {
    condiciones.push(`s.proxima_fecha >= $${i}`);
    valores.push(desde);
    i++;
  }
  if (hasta) {
    condiciones.push(`s.proxima_fecha <= $${i}`);
    valores.push(hasta);
    i++;
  }
  if (proximas != null) {
    const dias = Number(proximas);
    if (!Number.isNaN(dias)) {
      condiciones.push(`s.proxima_fecha <= (CURRENT_DATE + INTERVAL '${dias} days')`);
    }
  }
  if (buscar) {
    condiciones.push(`(
      u.correo ILIKE $${i} OR
      u.nombre ILIKE $${i} OR
      ud.nombre_tienda ILIKE $${i}
    )`);
    valores.push(`%${buscar}%`);
    i++;
  }

  const where = `WHERE ${condiciones.join(" AND ")}`;

  valores.push(limite, offset);
  const { rows } = await pool.query(
    `SELECT
       s.id, s.usuario_id, s.estado,
       s.fecha_inicio, s.proxima_fecha,
       s.cajas_por_mes, s.rosas_por_mes,
       s.plan, s.actualizado_en, s.creado_en,
       u.correo          AS usuario_correo,
       u.nombre          AS usuario_nombre,
       ud.nombre_tienda  AS tienda_nombre,
       ud.telefono       AS tienda_telefono,
       (SELECT p.numero FROM pedidos p
        WHERE p.usuario_id = s.usuario_id AND p.programa = 'autoship'
        ORDER BY p.creado_en DESC LIMIT 1) AS ultimo_pedido
     FROM suscripciones s
     LEFT JOIN usuarios u ON u.id = s.usuario_id
     LEFT JOIN usuarios_detalles ud ON ud.usuario_id = u.id
     ${where}
     ORDER BY s.proxima_fecha ASC, s.creado_en DESC
     LIMIT $${i} OFFSET $${i + 1}`,
    valores
  );

  return rows.map((s) => ({
    ...s,
    cajas_por_mes: Number(s.cajas_por_mes),
    rosas_por_mes: Number(s.rosas_por_mes),
    dias_hasta_proximo: s.proxima_fecha
      ? Math.ceil((new Date(s.proxima_fecha) - new Date()) / (1000 * 60 * 60 * 24))
      : null,
  }));
}

/**
 * KPIs de las suscripciones del vendedor.
 */
export async function kpisSuscripcionesVendedor(vendedorId) {
  const pool = obtenerPool();
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE estado = 'active')          AS activas,
       COUNT(*) FILTER (WHERE estado IN ('paused', 'paused_unpaid')) AS pausadas,
       COUNT(*) FILTER (WHERE estado = 'cancelled')       AS canceladas,
       COUNT(*) FILTER (WHERE estado = 'active'
         AND proxima_fecha <= (CURRENT_DATE + INTERVAL '7 days')) AS proximas_7d,
       COALESCE(SUM(cajas_por_mes) FILTER (WHERE estado = 'active'), 0) AS cajas_activas
     FROM suscripciones
     WHERE vendedor_id = $1`,
    [vendedorId]
  );
  const k = rows[0] || {};
  return {
    total: Number(k.total || 0),
    activas: Number(k.activas || 0),
    pausadas: Number(k.pausadas || 0),
    canceladas: Number(k.canceladas || 0),
    proximas7d: Number(k.proximas_7d || 0),
    cajasActivas: Number(k.cajas_activas || 0),
  };
}

/**
 * Detalle de una suscripción (verificando propiedad).
 */
export async function obtenerSuscripcionVendedor(vendedorId, suscripcionId) {
  const pool = obtenerPool();

  const { rows: subs } = await pool.query(
    `SELECT
       s.*,
       u.correo          AS usuario_correo,
       u.nombre          AS usuario_nombre,
       ud.nombre_tienda  AS tienda_nombre,
       ud.telefono       AS tienda_telefono,
       ud.direccion      AS tienda_direccion,
       ud.ciudad         AS tienda_ciudad,
       ud.provincia      AS tienda_provincia,
       ud.codigo_postal  AS tienda_codigo_postal,
       ud.pais           AS tienda_pais
     FROM suscripciones s
     LEFT JOIN usuarios u ON u.id = s.usuario_id
     LEFT JOIN usuarios_detalles ud ON ud.usuario_id = u.id
     WHERE s.id = $1 AND s.vendedor_id = $2
     LIMIT 1`,
    [suscripcionId, vendedorId]
  );
  if (!subs[0]) return null;
  const suscripcion = subs[0];

  const { rows: envios } = await pool.query(
    `SELECT
       p.id, p.numero, p.estado, p.cajas, p.rosas, p.total, p.moneda,
       p.qbo_invoice_number, p.qbo_invoice_url,
       p.pagado_en, p.creado_en
     FROM pedidos p
     WHERE p.usuario_id = $1 AND p.programa = 'autoship'
     ORDER BY p.creado_en DESC
     LIMIT 20`,
    [suscripcion.usuario_id]
  );

  return {
    suscripcion: {
      ...suscripcion,
      cajas_por_mes: Number(suscripcion.cajas_por_mes),
      rosas_por_mes: Number(suscripcion.rosas_por_mes),
      cambios_historial: Array.isArray(suscripcion.cambios_historial)
        ? suscripcion.cambios_historial
        : [],
    },
    envios: envios.map((e) => ({
      ...e,
      cajas: Number(e.cajas),
      rosas: Number(e.rosas),
      total: Number(e.total),
    })),
  };
}