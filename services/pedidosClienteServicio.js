// backend/services/pedidosClienteServicio.js
import { obtenerPool } from "../config/conexion.js";

/* ============================================================
   PEDIDOS DEL CLIENTE
   ============================================================
   Solo muestra pedidos del usuario logueado (rol cliente).
   Incluye:
   - Resumen del pedido (cabecera)
   - Items con imágenes de frase/color
   - Total y estado
   ============================================================ */

const URL_BACKEND = process.env.URL_BACKEND || "http://localhost:3000";

function urlArchivo(uuid) {
  if (!uuid) return null;
  return `${URL_BACKEND}/api/library/file/${uuid}`;
}

/**
 * Lista los pedidos del cliente con KPIs.
 * @param {string} usuarioId
 * @param {Object} filtros - { buscar, estado, programa, desde, hasta, limite, offset }
 */
export async function listarMisPedidos(usuarioId, filtros = {}) {
  const pool = obtenerPool();
  const {
    buscar = null,
    estado = null,
    programa = null,
    desde = null,
    hasta = null,
    limite = 50,
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
      p.numero ILIKE $${i} OR
      p.client_ref ILIKE $${i} OR
      p.envio_nombre ILIKE $${i} OR
      p.envio_email ILIKE $${i}
    )`);
    valores.push(`%${buscar}%`);
    i++;
  }

  const where = `WHERE ${condiciones.join(" AND ")}`;
  valores.push(limite, offset);

  const { rows: pedidos } = await pool.query(
    `SELECT
       p.id, p.numero, p.programa, p.estado,
       p.cajas, p.rosas, p.precio_por_rosa,
       p.subtotal, p.impuesto, p.total, p.moneda,
       p.envio_nombre, p.envio_email,
       p.qbo_invoice_number, p.qbo_invoice_url,
       p.client_ref,
       p.pagado_en, p.creado_en, p.actualizado_en
     FROM pedidos p
     ${where}
     ORDER BY p.creado_en DESC
     LIMIT $${i} OFFSET $${i + 1}`,
    valores
  );

  // KPIs
  const { rows: kpis } = await pool.query(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE estado = 'awaiting_payment') AS pendientes,
       COUNT(*) FILTER (WHERE estado = 'paid') AS pagados,
       COUNT(*) FILTER (WHERE estado = 'paused_unpaid') AS pausados,
       COALESCE(SUM(total) FILTER (WHERE estado = 'paid'), 0) AS facturado
     FROM pedidos
     WHERE usuario_id = $1`,
    [usuarioId]
  );

  return {
    pedidos: pedidos.map((p) => ({
      ...p,
      subtotal: Number(p.subtotal),
      impuesto: Number(p.impuesto),
      total: Number(p.total),
      precio_por_rosa: Number(p.precio_por_rosa),
    })),
    kpis: {
      total: Number(kpis[0].total),
      pendientes: Number(kpis[0].pendientes),
      pagados: Number(kpis[0].pagados),
      pausados: Number(kpis[0].pausados),
      facturado: Number(kpis[0].facturado),
    },
  };
}

/**
 * Obtiene un pedido con sus items + imágenes de las frases.
 */
export async function obtenerMiPedido(usuarioId, pedidoId) {
  const pool = obtenerPool();

  // 1. Pedido (solo del usuario logueado)
  const { rows: pedidos } = await pool.query(
    `SELECT
       p.*,
       v.correo AS vendedor_correo,
       v.nombre AS vendedor_nombre,
       vc.nombre_comercial AS vendedor_comercial
     FROM pedidos p
     LEFT JOIN usuarios v ON v.id = p.vendedor_id
     LEFT JOIN vendedores_config vc ON vc.usuario_id = p.vendedor_id
     WHERE p.id = $1 AND p.usuario_id = $2
     LIMIT 1`,
    [pedidoId, usuarioId]
  );
  if (!pedidos[0]) return null;

  const pedido = pedidos[0];

  // 2. Items con joins a catálogo para traer colores/categorías/frases
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
       -- Datos del color (para obtener la imagen de la rosa)
       cc.slug       AS color_slug,
       cc.hex        AS color_hex,
       cc.edge       AS color_edge,
       cc.ink        AS color_ink,
       -- Imagen de la caja del color
       (SELECT bi.uuid_archivo FROM biblioteca_imagenes bi
        WHERE bi.color_id = cc.id AND bi.tipo = 'boxphoto' AND bi.activo = TRUE
        LIMIT 1) AS boxphoto_uuid,
       -- Imagen de la rosa del color
       (SELECT bi.uuid_archivo FROM biblioteca_imagenes bi
        WHERE bi.color_id = cc.id AND bi.tipo = 'rosephoto' AND bi.activo = TRUE
        LIMIT 1) AS rosephoto_uuid,
       -- Imagen de la frase (frasephoto) para el color elegido
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
      // Imágenes ya resueltas
      imagenes: {
        boxphoto: urlArchivo(it.boxphoto_uuid),
        rosephoto: urlArchivo(it.rosephoto_uuid),
        frasephoto: urlArchivo(it.frasephoto_uuid),
      },
    };
  });

  return {
    pedido: {
      ...pedido,
      subtotal: Number(pedido.subtotal),
      impuesto: Number(pedido.impuesto),
      total: Number(pedido.total),
      precio_por_rosa: Number(pedido.precio_por_rosa),
      hasCustom: itemsCompletos.some((it) => it.tipo_mensaje === "custom"),
    },
    items: itemsCompletos,
  };
}

/**
 * Devuelve los pedidos del cliente que están pendientes de pago.
 */
export async function listarPendientesDePago(usuarioId) {
  const pool = obtenerPool();
  const { rows } = await pool.query(
    `SELECT id, numero, total, moneda, qbo_invoice_url, creado_en
     FROM pedidos
     WHERE usuario_id = $1
       AND estado IN ('awaiting_payment', 'paused_unpaid')
     ORDER BY creado_en DESC`,
    [usuarioId]
  );
  return rows.map((r) => ({
    ...r,
    total: Number(r.total),
  }));
}