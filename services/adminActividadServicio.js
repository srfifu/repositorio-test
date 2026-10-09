// backend/services/adminActividadServicio.js
import { obtenerPool } from "../config/conexion.js";

/* ============================================================
   ACTIVIDAD / AUDITORÍA DEL SISTEMA
   ============================================================
   Feed unificado de eventos:
     - order    → pedidos creados
     - pay      → pagos registrados
     - design   → diseños custom guardados (pedido_items)
     - library  → frases / imágenes de biblioteca actualizadas
     - login    → logins (desde tabla auditoria)

   Paginado + filtros (tipo, fecha, búsqueda).
   ============================================================ */

const TIPOS_VALIDOS = new Set([
  "all", "order", "pay", "design", "library", "login",
]);

/* ── Bloque: PEDIDOS ─────────────────────────────────── */
function bloquePedidos() {
  return `
    SELECT
      'order-' || p.id                                  AS id,
      'order'                                           AS tipo,
      p.numero                                          AS titulo,
      COALESCE(ud.nombre_tienda, u.nombre, u.correo, '—')
        || ' · ' || COALESCE(p.cajas, 0) || ' cajas · $'
        || TO_CHAR(COALESCE(p.total, 0), 'FM999999990.00') AS meta,
      COALESCE(u.correo, '—')                           AS usuario,
      p.creado_en                                       AS fecha
    FROM pedidos p
    LEFT JOIN usuarios u          ON u.id = p.usuario_id
    LEFT JOIN usuarios_detalles ud ON ud.usuario_id = u.id
    WHERE p.creado_en >= $1::date
      AND p.creado_en <= ($2::date + INTERVAL '1 day')
  `;
}

/* ── Bloque: PAGOS ───────────────────────────────────── */
function bloquePagos() {
  return `
    SELECT
      'pay-' || pa.id                                   AS id,
      'pay'                                             AS tipo,
      'PAGO ' || UPPER(COALESCE(pa.proveedor, '—'))     AS titulo,
      COALESCE(p.numero, '—') || ' · $'
        || TO_CHAR(COALESCE(pa.monto, 0), 'FM999999990.00')
        || ' · ' || COALESCE(pa.estado, '—')            AS meta,
      COALESCE(u.correo, '—')                           AS usuario,
      pa.creado_en                                      AS fecha
    FROM pagos pa
    LEFT JOIN pedidos p  ON p.id = pa.pedido_id
    LEFT JOIN usuarios u ON u.id = p.usuario_id
    WHERE pa.creado_en >= $1::date
      AND pa.creado_en <= ($2::date + INTERVAL '1 day')
  `;
}

/* ── Bloque: DISEÑOS (pedido_items custom) ───────────── */
function bloqueDisenos() {
  return `
    SELECT
      'design-' || pi.id                                AS id,
      'design'                                          AS tipo,
      COALESCE(p.numero, 'DISEÑO')                      AS titulo,
      COALESCE(pi.tipo_mensaje, 'standard') || ' · '
        || COALESCE(pi.cajas, 0) || ' cajas · '
        || COALESCE(pi.custom_font, pi.color_nombre, '—') AS meta,
      COALESCE(u.correo, '—')                           AS usuario,
      pi.creado_en                                      AS fecha
    FROM pedido_items pi
    INNER JOIN pedidos p ON p.id = pi.pedido_id
    LEFT JOIN usuarios u ON u.id = p.usuario_id
    WHERE pi.creado_en >= $1::date
      AND pi.creado_en <= ($2::date + INTERVAL '1 day')
      AND pi.tipo_mensaje = 'custom'
  `;
}

/* ── Bloque: BIBLIOTECA (frases del catálogo) ────────── */
function bloqueBiblioteca() {
  return `
    SELECT
      'lib-' || f.id                                    AS id,
      'library'                                         AS tipo,
      'Biblioteca · ' || COALESCE(c.nombre_es, '—')     AS titulo,
      f.texto || ' (' || f.slug || ')'                  AS meta,
      '—'                                               AS usuario,
      f.actualizado_en                                  AS fecha
    FROM catalogo_frases f
    LEFT JOIN catalogo_categorias c ON c.id = f.categoria_id
    WHERE f.actualizado_en >= $1::date
      AND f.actualizado_en <= ($2::date + INTERVAL '1 day')
  `;
}

/* ── Bloque: LOGINS (tabla auditoria) ────────────────── */
function bloqueLogins() {
  return `
    SELECT
      'log-' || a.id                                    AS id,
      'login'                                           AS tipo,
      'Inicio de sesión'                                AS titulo,
      COALESCE(a.accion, 'login') || ' · '
        || COALESCE(a.ip, 'IP desconocida')             AS meta,
      COALESCE(u.correo, '—')                           AS usuario,
      a.creado_en                                       AS fecha
    FROM auditoria a
    LEFT JOIN usuarios u ON u.id = a.usuario_id
    WHERE a.creado_en >= $1::date
      AND a.creado_en <= ($2::date + INTERVAL '1 day')
      AND (a.accion ILIKE '%login%' OR a.accion ILIKE '%sesion%')
  `;
}

/* ── Bloque vacío (para tipos no pedidos) ────────────── */
function bloqueVacio(tipo) {
  return `
    SELECT
      NULL::text AS id,
      '${tipo}'  AS tipo,
      NULL::text AS titulo,
      NULL::text AS meta,
      NULL::text AS usuario,
      NULL::timestamptz AS fecha
    WHERE FALSE
  `;
}

function construirUnion(tipo) {
  const pedidos  = (tipo === "all" || tipo === "order")   ? bloquePedidos()    : bloqueVacio("order");
  const pagos    = (tipo === "all" || tipo === "pay")     ? bloquePagos()      : bloqueVacio("pay");
  const disenos  = (tipo === "all" || tipo === "design")  ? bloqueDisenos()    : bloqueVacio("design");
  const biblio   = (tipo === "all" || tipo === "library") ? bloqueBiblioteca() : bloqueVacio("library");
  const logins   = (tipo === "all" || tipo === "login")   ? bloqueLogins()     : bloqueVacio("login");

  return [pedidos, pagos, disenos, biblio, logins].join(" UNION ALL ");
}

/* ── Helper: fechas por defecto ──────────────────────── */
function rangoPorDefecto(desde, hasta) {
  const toISO = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };
  if (desde && hasta) return { desde, hasta };

  const hoy = new Date();
  const hace30 = new Date();
  hace30.setDate(hace30.getDate() - 29);
  return {
    desde: desde || toISO(hace30),
    hasta: hasta || toISO(hoy),
  };
}

/* ============================================================
   LISTAR ACTIVIDAD PAGINADA
   ============================================================ */
export async function listarActividad({
  tipo = "all",
  desde = null,
  hasta = null,
  q = "",
  pagina = 1,
  porPagina = 25,
} = {}) {
  const pool = obtenerPool();
  const tipoFinal = TIPOS_VALIDOS.has(tipo) ? tipo : "all";
  const rango = rangoPorDefecto(desde, hasta);

  const union = construirUnion(tipoFinal);

  const qTrim = String(q || "").trim().toLowerCase();
  const filtroQ = qTrim
    ? `WHERE (LOWER(COALESCE(act.titulo, ''))  LIKE $5
             OR LOWER(COALESCE(act.meta, ''))    LIKE $5
             OR LOWER(COALESCE(act.usuario, '')) LIKE $5)`
    : "";

  const offset = (Number(pagina) - 1) * Number(porPagina);

  /* Total con búsqueda */
  const paramsTotal = qTrim
    ? [rango.desde, rango.hasta, `%${qTrim}%`]
    : [rango.desde, rango.hasta];
  const sqlTotal = `
    SELECT COUNT(*) AS total
    FROM (${union}) AS act
    ${qTrim
      ? `WHERE (LOWER(COALESCE(act.titulo, ''))  LIKE $3
             OR LOWER(COALESCE(act.meta, ''))    LIKE $3
             OR LOWER(COALESCE(act.usuario, '')) LIKE $3)`
      : ""
    }
  `;
  const { rows: totalRows } = await pool.query(sqlTotal, paramsTotal);
  const total = Number(totalRows[0]?.total || 0);

  /* Página */
  const params = qTrim
    ? [rango.desde, rango.hasta, Number(porPagina), offset, `%${qTrim}%`]
    : [rango.desde, rango.hasta, Number(porPagina), offset];

  const sql = `
    SELECT *
    FROM (${union}) AS act
    ${qTrim
      ? `WHERE (LOWER(COALESCE(act.titulo, ''))  LIKE $5
             OR LOWER(COALESCE(act.meta, ''))    LIKE $5
             OR LOWER(COALESCE(act.usuario, '')) LIKE $5)`
      : ""
    }
    ORDER BY act.fecha DESC NULLS LAST
    LIMIT $3 OFFSET $4
  `;
  const { rows } = await pool.query(sql, params);

  return {
    rango: { desde: rango.desde, hasta: rango.hasta, tipo: tipoFinal },
    pagina: Number(pagina),
    porPagina: Number(porPagina),
    total,
    total_paginas: Math.max(1, Math.ceil(total / Number(porPagina))),
    eventos: rows.map((r) => ({
      id: r.id,
      tipo: r.tipo,
      titulo: r.titulo || "—",
      meta: r.meta || "",
      usuario: r.usuario || "—",
      fecha: r.fecha,
    })),
  };
}

/* ============================================================
   KPIs DE ACTIVIDAD (para las tabs)
   ============================================================ */
export async function kpisActividad({ desde = null, hasta = null } = {}) {
  const pool = obtenerPool();
  const rango = rangoPorDefecto(desde, hasta);

  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM pedidos
        WHERE creado_en >= $1::date
          AND creado_en <= ($2::date + INTERVAL '1 day')) AS order_count,

       (SELECT COUNT(*) FROM pagos
        WHERE creado_en >= $1::date
          AND creado_en <= ($2::date + INTERVAL '1 day')) AS pay_count,

       (SELECT COUNT(*) FROM pedido_items pi
        INNER JOIN pedidos p ON p.id = pi.pedido_id
        WHERE pi.tipo_mensaje = 'custom'
          AND pi.creado_en >= $1::date
          AND pi.creado_en <= ($2::date + INTERVAL '1 day')) AS design_count,

       (SELECT COUNT(*) FROM catalogo_frases
        WHERE actualizado_en >= $1::date
          AND actualizado_en <= ($2::date + INTERVAL '1 day')) AS library_count,

       (SELECT COUNT(*) FROM auditoria
        WHERE creado_en >= $1::date
          AND creado_en <= ($2::date + INTERVAL '1 day')
          AND (accion ILIKE '%login%' OR accion ILIKE '%sesion%')) AS login_count`,
    [rango.desde, rango.hasta]
  );

  const r = rows[0] || {};
  const order   = Number(r.order_count   || 0);
  const pay     = Number(r.pay_count     || 0);
  const design  = Number(r.design_count  || 0);
  const library = Number(r.library_count || 0);
  const login   = Number(r.login_count   || 0);

  return {
    rango,
    total: order + pay + design + library + login,
    order,
    pay,
    design,
    library,
    login,
  };
}