// backend/services/adminDashboardServicio.js
import { obtenerPool } from "../config/conexion.js";

/* ============================================================
   DASHBOARD ADMIN
   ============================================================
   Métricas GLOBALES de todo el sistema (no filtra por vendedor).
   Usa las mismas fórmulas que el dashboard del vendedor pero
   sin restricción de vendedor_id.
   ============================================================ */

/* ── Fechas en LOCAL TIME ────────────────────────────── */
function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function rangoFechas(periodo, desde, hasta) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  switch (periodo) {
    case "hoy":
      return { desde: toISO(hoy), hasta: toISO(hoy) };

    case "7d": {
      const d = new Date(hoy);
      d.setDate(d.getDate() - 6);
      return { desde: toISO(d), hasta: toISO(hoy) };
    }
    case "30d": {
      const d = new Date(hoy);
      d.setDate(d.getDate() - 29);
      return { desde: toISO(d), hasta: toISO(hoy) };
    }
    case "90d": {
      const d = new Date(hoy);
      d.setDate(d.getDate() - 89);
      return { desde: toISO(d), hasta: toISO(hoy) };
    }
    case "mes_actual": {
      const d = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      return { desde: toISO(d), hasta: toISO(hoy) };
    }
    case "mes_pasado": {
      const inicio = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
      const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
      return { desde: toISO(inicio), hasta: toISO(fin) };
    }
    case "1y": {
      const d = new Date(hoy);
      d.setDate(d.getDate() - 364);
      return { desde: toISO(d), hasta: toISO(hoy) };
    }
    case "todo":
      return { desde: null, hasta: null };
    case "custom":
      return { desde: desde || null, hasta: hasta || null };
    default: {
      const d = new Date(hoy);
      d.setDate(d.getDate() - 29);
      return { desde: toISO(d), hasta: toISO(hoy) };
    }
  }
}

/**
 * Calcula el período anterior (misma longitud, inmediatamente antes).
 */
function rangoAnterior(periodo, desde, hasta) {
  const rango = rangoFechas(periodo, desde, hasta);
  if (!rango.desde || !rango.hasta) return null;

  const d1 = new Date(rango.desde + "T00:00:00");
  const d2 = new Date(rango.hasta + "T00:00:00");
  const dias = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;

  const finAnt = new Date(d1);
  finAnt.setDate(finAnt.getDate() - 1);

  const iniAnt = new Date(finAnt);
  iniAnt.setDate(iniAnt.getDate() - (dias - 1));

  return { desde: toISO(iniAnt), hasta: toISO(finAnt) };
}

function construirFiltro(rango, alias = "p", offset = 1) {
  if (!rango || !rango.desde || !rango.hasta) {
    return { sql: "", params: [] };
  }
  return {
    sql: `AND ${alias}.creado_en >= $${offset}::date
          AND ${alias}.creado_en <= ($${offset + 1}::date + INTERVAL '1 day')`,
    params: [rango.desde, rango.hasta],
  };
}

/* ============================================================
   KPIs GENERALES (con comparación)
   ============================================================ */
async function obtenerKpisDelRango(rango) {
  const pool = obtenerPool();
  const filtroP = construirFiltro(rango, "p", 1);

  // Pedidos
  const { rows: pedidosRows } = await pool.query(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE p.estado = 'paid')             AS paid,
       COUNT(*) FILTER (WHERE p.estado = 'awaiting_payment') AS awaiting_payment,
       COUNT(*) FILTER (WHERE p.estado = 'paused_unpaid')    AS paused_unpaid,
       COUNT(*) FILTER (WHERE p.estado = 'cancelled')        AS cancelled,
       COALESCE(SUM(p.cajas), 0) AS cajas,
       COALESCE(SUM(p.rosas), 0) AS rosas
     FROM pedidos p
     WHERE 1=1 ${filtroP.sql}`,
    filtroP.params
  );

  // Ingresos
  const { rows: ingresosRows } = await pool.query(
    `SELECT
       COALESCE(SUM(p.total), 0) AS total,
       COALESCE(SUM(p.total) FILTER (WHERE p.estado = 'paid'), 0) AS pagados,
       COALESCE(SUM(p.total) FILTER (WHERE p.estado IN ('awaiting_payment', 'paused_unpaid')), 0) AS pendientes
     FROM pedidos p
     WHERE p.estado != 'cancelled' ${filtroP.sql}`,
    filtroP.params
  );

  // Clientes nuevos en el período
  const filtroU = construirFiltro(rango, "u", 1);
  const { rows: clientesRows } = await pool.query(
    `SELECT COUNT(*) AS nuevos
     FROM usuarios u
     WHERE EXISTS (
       SELECT 1 FROM usuarios_roles ur
       JOIN roles r ON r.id = ur.rol_id
       WHERE ur.usuario_id = u.id AND r.nombre = 'cliente'
     ) ${filtroU.sql}`,
    filtroU.params
  );

  const p = pedidosRows[0] || {};
  const i = ingresosRows[0] || {};
  const c = clientesRows[0] || {};

  return {
    pedidos: {
      total: Number(p.total || 0),
      paid: Number(p.paid || 0),
      awaiting_payment: Number(p.awaiting_payment || 0),
      paused_unpaid: Number(p.paused_unpaid || 0),
      cancelled: Number(p.cancelled || 0),
      cajas: Number(p.cajas || 0),
      rosas: Number(p.rosas || 0),
    },
    ingresos: {
      total: Number(i.total || 0),
      pagados: Number(i.pagados || 0),
      pendientes: Number(i.pendientes || 0),
    },
    clientes: {
      nuevos: Number(c.nuevos || 0),
    },
  };
}

export async function obtenerKpisAdmin(periodo = "30d", desde = null, hasta = null) {
  const pool = obtenerPool();
  const rango = rangoFechas(periodo, desde, hasta);
  const rangoAnt = rangoAnterior(periodo, desde, hasta);

  const [actual, anterior] = await Promise.all([
    obtenerKpisDelRango(rango),
    rangoAnt ? obtenerKpisDelRango(rangoAnt) : Promise.resolve(null),
  ]);

  // Totales GLOBALES (no del período — para tarjetas fijas)
  const { rows: totales } = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM usuarios u
        WHERE EXISTS (SELECT 1 FROM usuarios_roles ur
          JOIN roles r ON r.id = ur.rol_id
          WHERE ur.usuario_id = u.id AND r.nombre = 'cliente')) AS clientes_total,

       (SELECT COUNT(DISTINCT u.id) FROM usuarios u
        JOIN usuarios_roles ur ON ur.usuario_id = u.id
        JOIN roles r ON r.id = ur.rol_id
        WHERE r.nombre = 'vendedor') AS vendedores_total,

       (SELECT COUNT(*) FROM suscripciones WHERE estado = 'active') AS subs_activas,

       (SELECT COUNT(*) FROM suscripciones WHERE estado IN ('paused', 'paused_unpaid')) AS subs_pausadas,

       (SELECT COALESCE(SUM(s.cajas_por_mes), 0) FROM suscripciones s WHERE s.estado = 'active') AS cajas_por_mes`
  );

  const t = totales[0] || {};

  // MRR estimado
  const { rows: mrrRows } = await pool.query(
    `SELECT
       COALESCE(SUM(s.cajas_por_mes * 6 * vc.venta_autoship_precio_por_rosa), 0) AS mrr
     FROM suscripciones s
     LEFT JOIN vendedores_config vc ON vc.usuario_id = s.vendedor_id
     WHERE s.estado = 'active'`
  );

  // Comparativa
  const diff = (cur, prev) => {
    if (prev == null || prev === 0) return null;
    return Math.round(((cur - prev) / prev) * 1000) / 10;
  };

  return {
    rango: { desde: rango.desde, hasta: rango.hasta, periodo },
    rango_anterior: rangoAnt,
    ingresos: {
      ...actual.ingresos,
      cambio: anterior ? diff(actual.ingresos.total, anterior.ingresos.total) : null,
    },
    pedidos: {
      ...actual.pedidos,
      cambio: anterior ? diff(actual.pedidos.total, anterior.pedidos.total) : null,
    },
    clientes: {
      total: Number(t.clientes_total || 0),
      nuevos: actual.clientes.nuevos,
      cambio: anterior ? diff(actual.clientes.nuevos, anterior.clientes.nuevos) : null,
    },
    vendedores: {
      total: Number(t.vendedores_total || 0),
    },
    suscripciones: {
      activas: Number(t.subs_activas || 0),
      pausadas: Number(t.subs_pausadas || 0),
      cajas_por_mes: Number(t.cajas_por_mes || 0),
      mrr: Number(mrrRows[0]?.mrr || 0),
    },
  };
}

/* ============================================================
   VENTAS POR DÍA
   ============================================================ */
export async function obtenerVentasPorDiaAdmin(periodo = "30d", desde = null, hasta = null) {
  const pool = obtenerPool();
  const rango = rangoFechas(periodo, desde, hasta);

  if (!rango.desde || !rango.hasta) {
    const d = new Date();
    d.setDate(d.getDate() - 89);
    rango.desde = toISO(d);
    rango.hasta = toISO(new Date());
  }

  const { rows } = await pool.query(
    `SELECT
       DATE(p.creado_en) AS fecha,
       COUNT(*) AS pedidos,
       COALESCE(SUM(p.total), 0) AS ingresos,
       COALESCE(SUM(p.total) FILTER (WHERE p.estado = 'paid'), 0) AS ingresos_pagados,
       COALESCE(SUM(p.cajas), 0) AS cajas,
       COALESCE(SUM(p.rosas), 0) AS rosas
     FROM pedidos p
     WHERE p.creado_en >= $1::date
       AND p.creado_en <= ($2::date + INTERVAL '1 day')
       AND p.estado != 'cancelled'
     GROUP BY DATE(p.creado_en)
     ORDER BY fecha ASC`,
    [rango.desde, rango.hasta]
  );

  // Rellenar días vacíos
  const mapa = new Map(
    rows.map((r) => {
      const f = r.fecha instanceof Date ? toISO(r.fecha) : String(r.fecha);
      return [f, r];
    })
  );

  const [y1, m1, d1] = rango.desde.split("-").map(Number);
  const [y2, m2, d2] = rango.hasta.split("-").map(Number);

  const cursor = new Date(y1, m1 - 1, d1);
  const fin = new Date(y2, m2 - 1, d2);

  const data = [];
  while (cursor <= fin) {
    const key = toISO(cursor);
    const r = mapa.get(key);
    data.push({
      fecha: key,
      pedidos: r ? Number(r.pedidos) : 0,
      ingresos: r ? Number(r.ingresos) : 0,
      ingresos_pagados: r ? Number(r.ingresos_pagados) : 0,
      cajas: r ? Number(r.cajas) : 0,
      rosas: r ? Number(r.rosas) : 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return { data, rango };
}

/* ============================================================
   TOP VENDEDORES
   ============================================================ */
export async function obtenerTopVendedores(periodo = "90d", limite = 5, desde = null, hasta = null) {
  const pool = obtenerPool();
  const rango = rangoFechas(periodo, desde, hasta);

  // ✅ FIX: offset=1 para que $1=desde y $2=hasta (no colisionen con LIMIT)
  const filtro = construirFiltro(rango, "p", 1);
  const limiteIdx = filtro.params.length + 1; // 3 si hay rango, 1 si no

  const { rows } = await pool.query(
    `SELECT
       u.id,
       u.correo,
       u.nombre,
       vc.nombre_comercial,
       COUNT(p.id) AS pedidos,
       COALESCE(SUM(p.total) FILTER (WHERE p.estado = 'paid'), 0) AS ingresos,
       COALESCE(SUM(p.cajas) FILTER (WHERE p.estado = 'paid'), 0) AS cajas,
       (SELECT COUNT(*) FROM usuarios c WHERE c.referido_por = u.id) AS clientes
     FROM usuarios u
     INNER JOIN usuarios_roles ur ON ur.usuario_id = u.id
     INNER JOIN roles r ON r.id = ur.rol_id
     LEFT JOIN vendedores_config vc ON vc.usuario_id = u.id
     LEFT JOIN pedidos p ON p.vendedor_id = u.id ${filtro.sql}
     WHERE r.nombre = 'vendedor'
     GROUP BY u.id, u.correo, u.nombre, vc.nombre_comercial
     ORDER BY ingresos DESC
     LIMIT $${limiteIdx}`,
    [...filtro.params, limite]
  );

  return {
    vendedores: rows.map((r) => ({
      id: r.id,
      correo: r.correo,
      nombre: r.nombre || r.correo,
      comercial: r.nombre_comercial,
      pedidos: Number(r.pedidos),
      ingresos: Number(r.ingresos),
      cajas: Number(r.cajas),
      clientes: Number(r.clientes),
    })),
  };
}

/* ============================================================
   TOP CLIENTES
   ============================================================ */
export async function obtenerTopClientesAdmin(periodo = "90d", limite = 5, desde = null, hasta = null) {
  const pool = obtenerPool();
  const rango = rangoFechas(periodo, desde, hasta);

  // ✅ FIX: offset=1
  const filtro = construirFiltro(rango, "p", 1);
  const limiteIdx = filtro.params.length + 1;

  const { rows } = await pool.query(
    `SELECT
       u.id,
       u.correo,
       u.nombre,
       ud.nombre_tienda,
       COUNT(p.id) AS pedidos,
       COALESCE(SUM(p.total) FILTER (WHERE p.estado = 'paid'), 0) AS ingresos,
       COALESCE(SUM(p.cajas) FILTER (WHERE p.estado = 'paid'), 0) AS cajas
     FROM pedidos p
     INNER JOIN usuarios u ON u.id = p.usuario_id
     LEFT JOIN usuarios_detalles ud ON ud.usuario_id = u.id
     WHERE p.estado = 'paid' ${filtro.sql}
     GROUP BY u.id, u.correo, u.nombre, ud.nombre_tienda
     ORDER BY ingresos DESC
     LIMIT $${limiteIdx}`,
    [...filtro.params, limite]
  );

  return {
    clientes: rows.map((r) => ({
      id: r.id,
      correo: r.correo,
      nombre: r.nombre || r.correo,
      tienda: r.nombre_tienda,
      pedidos: Number(r.pedidos),
      ingresos: Number(r.ingresos),
      cajas: Number(r.cajas),
    })),
  };
}

/* ============================================================
   TOP FRASES
   ============================================================ */
export async function obtenerTopFrasesAdmin(periodo = "90d", limite = 5, desde = null, hasta = null) {
  const pool = obtenerPool();
  const rango = rangoFechas(periodo, desde, hasta);

  // ✅ FIX: offset=1
  const filtro = construirFiltro(rango, "p", 1);
  const limiteIdx = filtro.params.length + 1;

  const { rows } = await pool.query(
    `SELECT
       pi.frase_texto,
       pi.categoria_nombre,
       COUNT(DISTINCT p.id) AS pedidos,
       COALESCE(SUM(pi.cajas), 0) AS cajas,
       COALESCE(SUM(pi.subtotal), 0) AS ingresos
     FROM pedido_items pi
     INNER JOIN pedidos p ON p.id = pi.pedido_id
     WHERE p.estado = 'paid'
       AND pi.tipo_mensaje = 'standard'
       AND pi.frase_texto IS NOT NULL
       ${filtro.sql}
     GROUP BY pi.frase_texto, pi.categoria_nombre
     ORDER BY cajas DESC
     LIMIT $${limiteIdx}`,
    [...filtro.params, limite]
  );

  return {
    frases: rows.map((r) => ({
      texto: r.frase_texto,
      categoria: r.categoria_nombre,
      pedidos: Number(r.pedidos),
      cajas: Number(r.cajas),
      ingresos: Number(r.ingresos),
    })),
  };
}

/* ============================================================
   DISTRIBUCIÓN POR PROGRAMA
   ============================================================ */
export async function obtenerDistribucionProgramaAdmin(periodo = "30d", desde = null, hasta = null) {
  const pool = obtenerPool();
  const rango = rangoFechas(periodo, desde, hasta);
  const filtro = construirFiltro(rango, "p", 1);

  const { rows } = await pool.query(
    `SELECT
       p.programa,
       COUNT(*) AS pedidos,
       COALESCE(SUM(p.total), 0) AS ingresos
     FROM pedidos p
     WHERE p.estado = 'paid' ${filtro.sql}
     GROUP BY p.programa`,
    filtro.params
  );

  const total = rows.reduce((s, r) => s + Number(r.pedidos), 0) || 1;
  const autoship = rows.find((r) => r.programa === "autoship") || {};
  const onetime = rows.find((r) => r.programa === "onetime") || {};

  return {
    autoship: {
      pedidos: Number(autoship.pedidos || 0),
      ingresos: Number(autoship.ingresos || 0),
      porcentaje: Math.round((Number(autoship.pedidos || 0) / total) * 1000) / 10,
    },
    onetime: {
      pedidos: Number(onetime.pedidos || 0),
      ingresos: Number(onetime.ingresos || 0),
      porcentaje: Math.round((Number(onetime.pedidos || 0) / total) * 1000) / 10,
    },
  };
}

/* ============================================================
   ESTADO DE PEDIDOS
   ============================================================ */
export async function obtenerEstadoPedidosAdmin(periodo = "30d", desde = null, hasta = null) {
  const pool = obtenerPool();
  const rango = rangoFechas(periodo, desde, hasta);
  const filtro = construirFiltro(rango, "p", 1);

  const { rows } = await pool.query(
    `SELECT
       p.estado,
       COUNT(*) AS count,
       COALESCE(SUM(p.total), 0) AS total
     FROM pedidos p
     WHERE 1=1 ${filtro.sql}
     GROUP BY p.estado`,
    filtro.params
  );

  const total = rows.reduce((s, r) => s + Number(r.count), 0) || 1;

  const resultado = {};
  for (const r of rows) {
    resultado[r.estado] = {
      count: Number(r.count),
      total: Number(r.total),
      porcentaje: Math.round((Number(r.count) / total) * 1000) / 10,
    };
  }
  ["awaiting_payment", "paid", "paused_unpaid", "cancelled"].forEach((k) => {
    if (!resultado[k]) resultado[k] = { count: 0, total: 0, porcentaje: 0 };
  });

  return resultado;
}

/* ============================================================
   SALUD DEL SISTEMA
   ============================================================ */
export async function obtenerSaludSistema() {
  const pool = obtenerPool();
  const checks = [];

  // 1. PostgreSQL
  try {
    const t0 = Date.now();
    await pool.query("SELECT 1");
    checks.push({ name: "PostgreSQL", tone: "ok", value: `${Date.now() - t0} ms` });
  } catch (e) {
    checks.push({ name: "PostgreSQL", tone: "error", value: "Error" });
  }

  // 2. PayPal (configurado)
  checks.push({
    name: "PayPal",
    tone: process.env.PAYPAL_CLIENT_ID ? "ok" : "warn",
    value: process.env.PAYPAL_ENV || "sandbox",
  });

  // 3. QuickBooks
  try {
    const { obtenerEstadoConexion } = await import("./quickbooksServicio.js");
    const estado = obtenerEstadoConexion();
    checks.push({
      name: "QuickBooks",
      tone: estado?.conectado ? "ok" : "warn",
      value: estado?.conectado ? "Conectado" : "Desconectado",
    });
  } catch {
    checks.push({ name: "QuickBooks", tone: "warn", value: "Sin datos" });
  }

  // 4. Últimos pagos
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total FROM pagos WHERE creado_en > NOW() - INTERVAL '24 hours'`
    );
    checks.push({
      name: "Pagos (24h)",
      tone: "ok",
      value: `${rows[0].total} pagos`,
    });
  } catch {
    checks.push({ name: "Pagos (24h)", tone: "warn", value: "—" });
  }

  // 5. Suscripciones que vencen en 7 días
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total FROM suscripciones
       WHERE estado = 'active'
         AND proxima_fecha <= CURRENT_DATE + INTERVAL '7 days'`
    );
    checks.push({
      name: "Renovaciones 7d",
      tone: rows[0].total > 0 ? "warn" : "ok",
      value: `${rows[0].total}`,
    });
  } catch {
    checks.push({ name: "Renovaciones 7d", tone: "warn", value: "—" });
  }

  return { checks };
}

/* ============================================================
   ÚLTIMOS PEDIDOS
   ============================================================ */
export async function obtenerUltimosPedidos(limite = 5) {
  const pool = obtenerPool();
  const { rows } = await pool.query(
    `SELECT
       p.id, p.numero, p.total, p.estado, p.creado_en,
       u.nombre AS cliente,
       ud.nombre_tienda AS tienda
     FROM pedidos p
     LEFT JOIN usuarios u ON u.id = p.usuario_id
     LEFT JOIN usuarios_detalles ud ON ud.usuario_id = u.id
     ORDER BY p.creado_en DESC
     LIMIT $1`,
    [limite]
  );

  return {
    pedidos: rows.map((r) => ({
      ...r,
      total: Number(r.total),
    })),
  };
}

/* ============================================================
   RESUMEN COMPLETO
   ============================================================ */
export async function obtenerResumenAdmin(periodo = "30d", desde = null, hasta = null) {
  const [
    kpis,
    ventas_por_dia,
    top_vendedores,
    top_clientes,
    top_frases,
    distribucion_programa,
    estado_pedidos,
    salud_sistema,
    ultimos_pedidos,
  ] = await Promise.all([
    obtenerKpisAdmin(periodo, desde, hasta),
    obtenerVentasPorDiaAdmin(periodo, desde, hasta),
    obtenerTopVendedores(periodo, 5, desde, hasta),
    obtenerTopClientesAdmin(periodo, 5, desde, hasta),
    obtenerTopFrasesAdmin(periodo, 5, desde, hasta),
    obtenerDistribucionProgramaAdmin(periodo, desde, hasta),
    obtenerEstadoPedidosAdmin(periodo, desde, hasta),
    obtenerSaludSistema(),
    obtenerUltimosPedidos(5),
  ]);

  return {
    kpis,
    ventas_por_dia: ventas_por_dia.data,
    top_vendedores: top_vendedores.vendedores,
    top_clientes: top_clientes.clientes,
    top_frases: top_frases.frases,
    distribucion_programa,
    estado_pedidos,
    salud_sistema: salud_sistema.checks,
    ultimos_pedidos: ultimos_pedidos.pedidos,
  };
}