// backend/services/adminSuscripcionesServicio.js
import { obtenerPool } from "../config/conexion.js";

/* ============================================================
   ADMIN — SUSCRIPCIONES AUTOSHIP
   ============================================================
   Lista TODAS las suscripciones con filtros avanzados.
   Permite pausar/reactivar/cancelar/saltar envíos.
   ============================================================ */

/**
 * Lista todas las suscripciones con filtros + KPIs globales.
 */
export async function listarSuscripcionesAdmin(filtros = {}) {
  const pool = obtenerPool();
  const {
    buscar = null,
    estado = null,
    vendedorId = null,
    desde = null,
    hasta = null,
    proximas = null,   // días hasta el próximo envío
    limite = 100,
    offset = 0,
  } = filtros;

  const condiciones = ["1=1"];
  const valores = [];
  let i = 1;

  if (estado && estado !== "all") {
    if (estado === "paused") {
      // "paused" agrupa paused y paused_unpaid
      condiciones.push(`s.estado IN ('paused', 'paused_unpaid')`);
    } else {
      condiciones.push(`s.estado = $${i}`);
      valores.push(estado);
      i++;
    }
  }
  if (vendedorId) {
    condiciones.push(`s.vendedor_id = $${i}`);
    valores.push(vendedorId);
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
  const { rows: suscripciones } = await pool.query(
    `SELECT
       s.id,
       s.usuario_id,
       s.vendedor_id,
       s.estado,
       s.fecha_inicio,
       s.proxima_fecha,
       s.cajas_por_mes,
       s.rosas_por_mes,
       s.plan,
       s.actualizado_en,
       s.creado_en,
       u.correo          AS usuario_correo,
       u.nombre          AS usuario_nombre,
       ud.nombre_tienda  AS tienda_nombre,
       ud.telefono       AS tienda_telefono,
       v.correo          AS vendedor_correo,
       v.nombre          AS vendedor_nombre,
       vc.nombre_comercial AS vendedor_comercial,
       (SELECT p.numero FROM pedidos p
        WHERE p.usuario_id = s.usuario_id AND p.programa = 'autoship'
        ORDER BY p.creado_en DESC LIMIT 1) AS ultimo_pedido
     FROM suscripciones s
     LEFT JOIN usuarios u ON u.id = s.usuario_id
     LEFT JOIN usuarios_detalles ud ON ud.usuario_id = u.id
     LEFT JOIN usuarios v ON v.id = s.vendedor_id
     LEFT JOIN vendedores_config vc ON vc.usuario_id = v.id
     ${where}
     ORDER BY s.proxima_fecha ASC, s.creado_en DESC
     LIMIT $${i} OFFSET $${i + 1}`,
    valores
  );

  // KPIs globales
  const { rows: kpis } = await pool.query(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE estado = 'active')          AS activas,
       COUNT(*) FILTER (WHERE estado IN ('paused', 'paused_unpaid')) AS pausadas,
       COUNT(*) FILTER (WHERE estado = 'cancelled')       AS canceladas,
       COUNT(*) FILTER (WHERE estado = 'active'
         AND proxima_fecha <= (CURRENT_DATE + INTERVAL '7 days')) AS proximas_7d
     FROM suscripciones`
  );

  // MRR (ingreso mensual recurrente estimado)
  const { rows: mrrRows } = await pool.query(
    `SELECT
       COALESCE(SUM(s.cajas_por_mes * 6 * cp.autoship_precio_por_rosa), 0) AS mrr
     FROM suscripciones s
     CROSS JOIN LATERAL (
       SELECT autoship_precio_por_rosa
       FROM configuracion_precios
       WHERE activo = TRUE
       ORDER BY vigente_desde DESC
       LIMIT 1
     ) cp
     WHERE s.estado = 'active'`
  );

  return {
    suscripciones: suscripciones.map((s) => ({
      ...s,
      cajas_por_mes: Number(s.cajas_por_mes),
      rosas_por_mes: Number(s.rosas_por_mes),
      dias_hasta_proximo: s.proxima_fecha
        ? Math.ceil((new Date(s.proxima_fecha) - new Date()) / (1000 * 60 * 60 * 24))
        : null,
    })),
    kpis: {
      total: Number(kpis[0].total),
      activas: Number(kpis[0].activas),
      pausadas: Number(kpis[0].pausadas),
      canceladas: Number(kpis[0].canceladas),
      proximas7d: Number(kpis[0].proximas_7d),
      mrr: Number(mrrRows[0]?.mrr || 0),
    },
  };
}

/**
 * Detalle completo de una suscripción con plan + historial de cambios.
 */
export async function obtenerSuscripcionAdmin(suscripcionId) {
  const pool = obtenerPool();

  const { rows: suscripciones } = await pool.query(
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
       ud.pais           AS tienda_pais,
       v.correo          AS vendedor_correo,
       v.nombre          AS vendedor_nombre,
       vc.nombre_comercial AS vendedor_comercial
     FROM suscripciones s
     LEFT JOIN usuarios u ON u.id = s.usuario_id
     LEFT JOIN usuarios_detalles ud ON ud.usuario_id = u.id
     LEFT JOIN usuarios v ON v.id = s.vendedor_id
     LEFT JOIN vendedores_config vc ON vc.usuario_id = v.id
     WHERE s.id = $1
     LIMIT 1`,
    [suscripcionId]
  );
  if (!suscripciones[0]) return null;
  const suscripcion = suscripciones[0];

  // Últimos pedidos AutoShip del cliente
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

/**
 * Cambia el estado de una suscripción (admin).
 */
export async function cambiarEstadoSuscripcionAdmin(suscripcionId, nuevoEstado) {
  const pool = obtenerPool();
  const estadosValidos = ["active", "paused", "paused_unpaid", "cancelled"];
  if (!estadosValidos.includes(nuevoEstado)) {
    const err = new Error("Estado inválido.");
    err.estado = 400;
    throw err;
  }

  const { rows } = await pool.query(
    `UPDATE suscripciones
     SET estado = $2, actualizado_en = NOW()
     WHERE id = $1
     RETURNING *`,
    [suscripcionId, nuevoEstado]
  );
  return rows[0] || null;
}

/**
 * Salta el próximo envío de una suscripción (admin).
 */
export async function saltarEnvioAdmin(suscripcionId) {
  const pool = obtenerPool();

  const { rows: actual } = await pool.query(
    `SELECT proxima_fecha FROM suscripciones WHERE id = $1 LIMIT 1`,
    [suscripcionId]
  );
  if (!actual[0]) {
    const err = new Error("Suscripción no encontrada.");
    err.estado = 404;
    throw err;
  }

  const actualDate = new Date(actual[0].proxima_fecha);
  actualDate.setMonth(actualDate.getMonth() + 1);
  const nuevaFecha = actualDate.toISOString().slice(0, 10);

  const { rows } = await pool.query(
    `UPDATE suscripciones
     SET proxima_fecha = $2, actualizado_en = NOW()
     WHERE id = $1
     RETURNING *`,
    [suscripcionId, nuevaFecha]
  );
  return rows[0] || null;
}

/**
 * Lista de vendedores activos (para filtros).
 */
export async function listarVendedoresParaFiltro() {
  const pool = obtenerPool();
  const { rows } = await pool.query(
    `SELECT
       u.id,
       u.correo,
       u.nombre,
       vc.nombre_comercial
     FROM usuarios u
     INNER JOIN usuarios_roles ur ON ur.usuario_id = u.id
     INNER JOIN roles r ON r.id = ur.rol_id
     LEFT JOIN vendedores_config vc ON vc.usuario_id = u.id
     WHERE r.nombre = 'vendedor'
     ORDER BY u.nombre, u.correo`
  );
  return rows;
}