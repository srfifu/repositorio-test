// backend/services/vendedorDashboardServicio.js
import { obtenerPool } from "../config/conexion.js";

/* ============================================================
   DASHBOARD DEL VENDEDOR
   ============================================================
   Todas las métricas son SOLO de los pedidos/suscripciones
   de los clientes referidos al vendedor logueado.

   Períodos soportados:
   - hoy          → hoy
   - 7d           → últimos 7 días
   - 30d          → últimos 30 días (default)
   - 90d          → últimos 90 días
   - mes_actual   → desde el 1° del mes
   - mes_pasado   → mes anterior completo
   - 1y           → últimos 365 días
   - todo         → sin filtro
   - custom       → requiere desde + hasta
   ============================================================ */

function rangoFechas(periodo, desde, hasta) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const toISO = (d) => d.toISOString().slice(0, 10);

  switch (periodo) {
    case "hoy":
      return { desde: toISO(hoy), hasta: toISO(hoy) };
    case "7d": {
      const d = new Date(hoy);
      d.setDate(d.getDate() - 7);
      return { desde: toISO(d), hasta: toISO(hoy) };
    }
    case "30d": {
      const d = new Date(hoy);
      d.setDate(d.getDate() - 30);
      return { desde: toISO(d), hasta: toISO(hoy) };
    }
    case "90d": {
      const d = new Date(hoy);
      d.setDate(d.getDate() - 90);
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
      d.setFullYear(d.getFullYear() - 1);
      return { desde: toISO(d), hasta: toISO(hoy) };
    }
    case "todo":
      return { desde: null, hasta: null };
    case "custom":
      return { desde: desde || null, hasta: hasta || null };
    default: {
      const d = new Date(hoy);
      d.setDate(d.getDate() - 30);
      return { desde: toISO(d), hasta: toISO(hoy) };
    }
  }
}

/* ============================================================
   KPIs GENERALES
   ============================================================ */
export async function obtenerKpisVendedor(vendedorId, periodo = "30d", desde = null, hasta = null) {
  const pool = obtenerPool();
  const rango = rangoFechas(periodo, desde, hasta);

  // Filtros dinámicos
  const filtroFecha = rango.desde
    ? `AND p.creado_en >= $2 AND p.creado_en <= ($3::date + INTERVAL '1 day')`
    : "";
  const params = rango.desde
    ? [vendedorId, rango.desde, rango.hasta]
    : [vendedorId];

  // ── CLIENTES ────────────────────────────────────────────
  const { rows: clientesRows } = await pool.query(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE u.creado_en >= $2::date
         AND u.creado_en <= ($3::date + INTERVAL '1 day')) AS nuevos_periodo
     FROM usuarios u
     WHERE u.referido_por = $1`,
    rango.desde
      ? [vendedorId, rango.desde, rango.hasta]
      : [vendedorId, "1970-01-01", "1970-01-01"]
  );

  const { rows: clientesAutoshipRows } = await pool.query(
    `SELECT COUNT(DISTINCT s.usuario_id) AS con_autoship
     FROM suscripciones s
     WHERE s.vendedor_id = $1 AND s.estado = 'active'`,
    [vendedorId]
  );

  // ── PEDIDOS ─────────────────────────────────────────────
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
     WHERE p.vendedor_id = $1 ${filtroFecha}`,
    params
  );

  // ── INGRESOS ────────────────────────────────────────────
  const { rows: ingresosRows } = await pool.query(
    `SELECT
       COALESCE(SUM(p.total), 0) AS total,
       COALESCE(SUM(p.total) FILTER (WHERE p.estado = 'paid'), 0) AS pagados,
       COALESCE(SUM(p.total) FILTER (WHERE p.estado IN ('awaiting_payment', 'paused_unpaid')), 0) AS pendientes
     FROM pedidos p
     WHERE p.vendedor_id = $1
       AND p.estado != 'cancelled'
       ${filtroFecha}`,
    params
  );

  // ── GANANCIA (venta - costo) ────────────────────────────
  // Costo depende del precio de compra del vendedor en vendedores_config
  const { rows: gananciaRows } = await pool.query(
    `SELECT
       COALESCE(SUM(p.rosas * vc.costo_autoship_precio_por_rosa), 0) AS costo_rosas,
       COALESCE(SUM(p.subtotal - (p.rosas * vc.costo_autoship_precio_por_rosa)), 0) AS ganancia
     FROM pedidos p
     INNER JOIN vendedores_config vc ON vc.usuario_id = p.vendedor_id
     WHERE p.vendedor_id = $1
       AND p.estado = 'paid'
       ${filtroFecha}`,
    params
  );

  // ── SUSCRIPCIONES ───────────────────────────────────────
  const { rows: subsRows } = await pool.query(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE s.estado = 'active')          AS activas,
       COUNT(*) FILTER (WHERE s.estado IN ('paused', 'paused_unpaid')) AS pausadas,
       COUNT(*) FILTER (WHERE s.estado = 'cancelled')       AS canceladas,
       COALESCE(SUM(s.cajas_por_mes) FILTER (WHERE s.estado = 'active'), 0) AS cajas_por_mes
     FROM suscripciones s
     WHERE s.vendedor_id = $1`,
    [vendedorId]
  );

  // MRR estimado
  const { rows: mrrRows } = await pool.query(
    `SELECT
       COALESCE(SUM(s.cajas_por_mes * 6 * vc.venta_autoship_precio_por_rosa), 0) AS mrr
     FROM suscripciones s
     INNER JOIN vendedores_config vc ON vc.usuario_id = s.vendedor_id
     WHERE s.vendedor_id = $1 AND s.estado = 'active'`,
    [vendedorId]
  );

  const c = clientesRows[0] || {};
  const ca = clientesAutoshipRows[0] || {};
  const p = pedidosRows[0] || {};
  const i = ingresosRows[0] || {};
  const g = gananciaRows[0] || {};
  const s = subsRows[0] || {};
  const m = mrrRows[0] || {};

  const totalPagado = Number(i.pagados);
  const gananciaTotal = Number(g.ganancia);
  const margen = totalPagado > 0 ? (gananciaTotal / totalPagado) * 100 : 0;

  return {
    rango: { desde: rango.desde, hasta: rango.hasta, periodo },
    clientes: {
      total: Number(c.total || 0),
      nuevos_periodo: Number(c.nuevos_periodo || 0),
      con_autoship: Number(ca.con_autoship || 0),
    },
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
      pagados: totalPagado,
      pendientes: Number(i.pendientes || 0),
    },
    ganancia: {
      total: gananciaTotal,
      costo: Number(g.costo_rosas || 0),
      margen: Math.round(margen * 10) / 10,
    },
    suscripciones: {
      total: Number(s.total || 0),
      activas: Number(s.activas || 0),
      pausadas: Number(s.pausadas || 0),
      canceladas: Number(s.canceladas || 0),
      cajas_por_mes: Number(s.cajas_por_mes || 0),
      mrr: Number(m.mrr || 0),
    },
  };
}

/* ============================================================
   VENTAS POR DÍA
   ============================================================ */
export async function obtenerVentasPorDia(vendedorId, periodo = "30d", desde = null, hasta = null) {
  const pool = obtenerPool();
  const rango = rangoFechas(periodo, desde, hasta);

  if (!rango.desde) {
    // Si es "todo", limitamos a últimos 90 días por performance
    const d = new Date();
    d.setDate(d.getDate() - 90);
    rango.desde = d.toISOString().slice(0, 10);
    rango.hasta = new Date().toISOString().slice(0, 10);
  }

  const { rows } = await pool.query(
    `SELECT
       DATE(p.creado_en) AS fecha,
       COUNT(*) AS pedidos,
       COALESCE(SUM(p.total), 0) AS ingresos,
       COALESCE(SUM(p.cajas), 0) AS cajas,
       COALESCE(SUM(p.rosas), 0) AS rosas
     FROM pedidos p
     WHERE p.vendedor_id = $1
       AND p.creado_en >= $2::date
       AND p.creado_en <= ($3::date + INTERVAL '1 day')
       AND p.estado != 'cancelled'
     GROUP BY DATE(p.creado_en)
     ORDER BY fecha ASC`,
    [vendedorId, rango.desde, rango.hasta]
  );

  // Rellenar días vacíos
  const mapa = new Map(rows.map((r) => [r.fecha.toISOString().slice(0, 10), r]));
  const resultado = [];
  const cursor = new Date(rango.desde);
  const fin = new Date(rango.hasta);

  while (cursor <= fin) {
    const key = cursor.toISOString().slice(0, 10);
    const r = mapa.get(key);
    resultado.push({
      fecha: key,
      pedidos: r ? Number(r.pedidos) : 0,
      ingresos: r ? Number(r.ingresos) : 0,
      cajas: r ? Number(r.cajas) : 0,
      rosas: r ? Number(r.rosas) : 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return { data: resultado, rango };
}

/* ============================================================
   TOP CLIENTES
   ============================================================ */
export async function obtenerTopClientes(vendedorId, periodo = "90d", limite = 5, desde = null, hasta = null) {
  const pool = obtenerPool();
  const rango = rangoFechas(periodo, desde, hasta);

  const filtroFecha = rango.desde
    ? `AND p.creado_en >= $2::date AND p.creado_en <= ($3::date + INTERVAL '1 day')`
    : "";
  const params = rango.desde
    ? [vendedorId, rango.desde, rango.hasta, limite]
    : [vendedorId, limite];

  const { rows } = await pool.query(
    `SELECT
       u.id,
       u.correo,
       u.nombre,
       ud.nombre_tienda,
       COUNT(p.id) AS pedidos,
       COALESCE(SUM(p.total), 0) AS ingresos,
       COALESCE(SUM(p.cajas), 0) AS cajas
     FROM pedidos p
     INNER JOIN usuarios u ON u.id = p.usuario_id
     LEFT JOIN usuarios_detalles ud ON ud.usuario_id = u.id
     WHERE p.vendedor_id = $1
       AND p.estado = 'paid'
       ${filtroFecha}
     GROUP BY u.id, u.correo, u.nombre, ud.nombre_tienda
     ORDER BY ingresos DESC
     LIMIT $${rango.desde ? "4" : "2"}`,
    params
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
export async function obtenerTopFrases(vendedorId, periodo = "90d", limite = 5, desde = null, hasta = null) {
  const pool = obtenerPool();
  const rango = rangoFechas(periodo, desde, hasta);

  const filtroFecha = rango.desde
    ? `AND p.creado_en >= $2::date AND p.creado_en <= ($3::date + INTERVAL '1 day')`
    : "";
  const params = rango.desde
    ? [vendedorId, rango.desde, rango.hasta, limite]
    : [vendedorId, limite];

  const { rows } = await pool.query(
    `SELECT
       pi.frase_texto,
       pi.categoria_nombre,
       COUNT(DISTINCT p.id) AS pedidos,
       COALESCE(SUM(pi.cajas), 0) AS cajas,
       COALESCE(SUM(pi.subtotal), 0) AS ingresos
     FROM pedido_items pi
     INNER JOIN pedidos p ON p.id = pi.pedido_id
     WHERE p.vendedor_id = $1
       AND p.estado = 'paid'
       AND pi.tipo_mensaje = 'standard'
       AND pi.frase_texto IS NOT NULL
       ${filtroFecha}
     GROUP BY pi.frase_texto, pi.categoria_nombre
     ORDER BY cajas DESC
     LIMIT $${rango.desde ? "4" : "2"}`,
    params
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
export async function obtenerDistribucionPrograma(vendedorId, periodo = "30d", desde = null, hasta = null) {
  const pool = obtenerPool();
  const rango = rangoFechas(periodo, desde, hasta);

  const filtroFecha = rango.desde
    ? `AND p.creado_en >= $2::date AND p.creado_en <= ($3::date + INTERVAL '1 day')`
    : "";
  const params = rango.desde
    ? [vendedorId, rango.desde, rango.hasta]
    : [vendedorId];

  const { rows } = await pool.query(
    `SELECT
       p.programa,
       COUNT(*) AS pedidos,
       COALESCE(SUM(p.total), 0) AS ingresos
     FROM pedidos p
     WHERE p.vendedor_id = $1
       AND p.estado = 'paid'
       ${filtroFecha}
     GROUP BY p.programa`,
    params
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
export async function obtenerEstadoPedidos(vendedorId, periodo = "30d", desde = null, hasta = null) {
  const pool = obtenerPool();
  const rango = rangoFechas(periodo, desde, hasta);

  const filtroFecha = rango.desde
    ? `AND p.creado_en >= $2::date AND p.creado_en <= ($3::date + INTERVAL '1 day')`
    : "";
  const params = rango.desde
    ? [vendedorId, rango.desde, rango.hasta]
    : [vendedorId];

  const { rows } = await pool.query(
    `SELECT
       p.estado,
       COUNT(*) AS count,
       COALESCE(SUM(p.total), 0) AS total
     FROM pedidos p
     WHERE p.vendedor_id = $1
       ${filtroFecha}
     GROUP BY p.estado`,
    params
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
  // Asegurar keys
  ["awaiting_payment", "paid", "paused_unpaid", "cancelled"].forEach((k) => {
    if (!resultado[k]) {
      resultado[k] = { count: 0, total: 0, porcentaje: 0 };
    }
  });

  return resultado;
}

/* ============================================================
   RESUMEN (todo en 1)
   ============================================================ */
export async function obtenerResumenVendedor(vendedorId, periodo = "30d", desde = null, hasta = null) {
  const [kpis, ventas_por_dia, top_clientes, top_frases, distribucion_programa, estado_pedidos] =
    await Promise.all([
      obtenerKpisVendedor(vendedorId, periodo, desde, hasta),
      obtenerVentasPorDia(vendedorId, periodo, desde, hasta),
      obtenerTopClientes(vendedorId, periodo, 5, desde, hasta),
      obtenerTopFrases(vendedorId, periodo, 5, desde, hasta),
      obtenerDistribucionPrograma(vendedorId, periodo, desde, hasta),
      obtenerEstadoPedidos(vendedorId, periodo, desde, hasta),
    ]);

  return {
    kpis,
    ventas_por_dia: ventas_por_dia.data,
    top_clientes: top_clientes.clientes,
    top_frases: top_frases.frases,
    distribucion_programa,
    estado_pedidos,
  };
}