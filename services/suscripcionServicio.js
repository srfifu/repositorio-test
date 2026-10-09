// backend/services/suscripcionServicio.js
import { obtenerPool } from "../config/conexion.js";

/* ============================================================
   SUSCRIPCIONES AUTOSHIP
   ============================================================
   REGLA: Un cliente solo puede tener UNA suscripción.
   Si ya existe, se actualiza (no se crea otra).
   ============================================================ */

/**
 * Obtiene la suscripción del cliente (o null si no tiene).
 */
export async function obtenerSuscripcion(usuarioId) {
  const pool = obtenerPool();
  const { rows } = await pool.query(
    `SELECT * FROM suscripciones WHERE usuario_id = $1 LIMIT 1`,
    [usuarioId]
  );
  return rows[0] || null;
}

/**
 * Verifica si un cliente PUEDE iniciar AutoShip.
 */
export async function puedeIniciarAutoShip(usuarioId) {
  const sub = await obtenerSuscripcion(usuarioId);
  if (!sub) return { puede: true, razon: null, suscripcion: null };
  if (sub.estado === "cancelled") return { puede: true, razon: null, suscripcion: sub };
  return {
    puede: false,
    razon: "Ya tenés una suscripción AutoShip activa.",
    suscripcion: sub,
  };
}

/**
 * Crea una suscripción (solo si no existe otra activa).
 */
export async function crearSuscripcion({
  usuarioId,
  vendedorId,
  plan,
  cajasPorMes,
  rosasPorMes,
  proximaFecha,
}) {
  const pool = obtenerPool();

  const existente = await obtenerSuscripcion(usuarioId);
  if (existente && existente.estado !== "cancelled") {
    const err = new Error(
      "Ya tenés una suscripción AutoShip activa. Podés editarla en vez de crear una nueva."
    );
    err.estado = 409;
    err.codigo = "SUSCRIPCION_YA_EXISTE";
    throw err;
  }

  // Si existe pero está cancelled, la resucitamos
  if (existente && existente.estado === "cancelled") {
    const fecha = proximaFecha || new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const { rows } = await pool.query(
      `UPDATE suscripciones
       SET estado = 'active',
           plan = $2,
           cajas_por_mes = $3,
           rosas_por_mes = $4,
           proxima_fecha = $5,
           vendedor_id = $6,
           actualizado_en = NOW()
       WHERE usuario_id = $1
       RETURNING *`,
      [
        usuarioId,
        JSON.stringify(plan || []),
        cajasPorMes,
        rosasPorMes,
        fecha,
        vendedorId,
      ]
    );
    return rows[0];
  }

  const fecha = proximaFecha || new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const { rows } = await pool.query(
    `INSERT INTO suscripciones (
      usuario_id, vendedor_id, estado,
      fecha_inicio, proxima_fecha,
      cajas_por_mes, rosas_por_mes,
      plan
    ) VALUES ($1, $2, 'active', CURRENT_DATE, $3, $4, $5, $6)
    RETURNING *`,
    [usuarioId, vendedorId, fecha, cajasPorMes, rosasPorMes, JSON.stringify(plan || [])]
  );
  return rows[0];
}

/**
 * Actualiza la suscripción existente.
 */
export async function actualizarSuscripcion(usuarioId, cambios, usuarioEditorId = null) {
  const pool = obtenerPool();

  const actual = await obtenerSuscripcion(usuarioId);
  if (!actual) {
    const err = new Error("No tenés suscripción AutoShip.");
    err.estado = 404;
    throw err;
  }

  const permitidos = ["plan", "cajas_por_mes", "rosas_por_mes", "proxima_fecha", "estado"];
  const campos = [];
  const valores = [];
  const diff = {};
  let i = 1;

  for (const k of permitidos) {
    if (cambios[k] !== undefined) {
      const valorAnterior = actual[k];
      const valorNuevo = k === "plan" ? JSON.stringify(cambios[k]) : cambios[k];

      if (JSON.stringify(valorAnterior) !== JSON.stringify(valorNuevo)) {
        campos.push(`${k} = $${i}`);
        valores.push(valorNuevo);
        diff[k] = { antes: valorAnterior, despues: cambios[k] };
        i++;
      }
    }
  }

  if (!campos.length) return actual;

  // Registrar el cambio en el historial
  const historial = Array.isArray(actual.cambios_historial) ? actual.cambios_historial : [];
  historial.push({
    fecha: new Date().toISOString(),
    campos: diff,
    usuario: usuarioEditorId,
  });

  campos.push(`cambios_historial = $${i}`);
  valores.push(JSON.stringify(historial));
  i++;

  valores.push(usuarioId);
  const { rows } = await pool.query(
    `UPDATE suscripciones
     SET ${campos.join(", ")}, actualizado_en = NOW()
     WHERE usuario_id = $${i}
     RETURNING *`,
    valores
  );
  return rows[0];
}

/**
 * Cambia el estado.
 */
export async function cambiarEstadoSuscripcion(usuarioId, nuevoEstado) {
  const estadosValidos = ["active", "paused_unpaid", "paused", "cancelled"];
  if (!estadosValidos.includes(nuevoEstado)) {
    const err = new Error("Estado inválido.");
    err.estado = 400;
    throw err;
  }
  return actualizarSuscripcion(usuarioId, { estado: nuevoEstado });
}

/**
 * Salta el próximo envío (mueve la próxima fecha un mes).
 */
export async function saltarProximoEnvio(usuarioId) {
  const actual = await obtenerSuscripcion(usuarioId);
  if (!actual) {
    const err = new Error("No tenés suscripción AutoShip.");
    err.estado = 404;
    throw err;
  }

  const actualDate = new Date(actual.proxima_fecha);
  actualDate.setMonth(actualDate.getMonth() + 1);
  const nuevaFecha = actualDate.toISOString().slice(0, 10);

  return actualizarSuscripcion(usuarioId, { proxima_fecha: nuevaFecha });
}

/**
 * Lista los pedidos AutoShip del cliente.
 */
export async function listarEnviosAutoShip(usuarioId, { limite = 50, offset = 0 } = {}) {
  const pool = obtenerPool();
  const { rows } = await pool.query(
    `SELECT
       p.id, p.numero, p.programa, p.estado,
       p.cajas, p.rosas, p.precio_por_rosa,
       p.subtotal, p.impuesto, p.total, p.moneda,
       p.qbo_invoice_number, p.qbo_invoice_url,
       p.client_ref, p.pagado_en, p.creado_en
     FROM pedidos p
     WHERE p.usuario_id = $1
       AND p.programa = 'autoship'
     ORDER BY p.creado_en DESC
     LIMIT $2 OFFSET $3`,
    [usuarioId, limite, offset]
  );

  return rows.map((p) => ({
    ...p,
    subtotal: Number(p.subtotal),
    impuesto: Number(p.impuesto),
    total: Number(p.total),
    precio_por_rosa: Number(p.precio_por_rosa),
  }));
}

/**
 * Crea o ACTUALIZA la suscripción AutoShip a partir de un pedido pagado.
 * Se llama desde /api/pagos/capturar cuando el programa es 'autoship'.
 *
 * ✅ FIX: Si ya existe suscripción activa, ACTUALIZA el plan en vez de ignorarlo.
 * ✅ Mantiene la proxima_fecha original (no reinicia el ciclo).
 */
export async function crearSuscripcionDesdePedido(pedidoId, usuarioId) {
  const pool = obtenerPool();

  // 1. Leer el pedido
  const { rows: pedidoRows } = await pool.query(
    `SELECT cajas, rosas, vendedor_id FROM pedidos WHERE id = $1`,
    [pedidoId]
  );
  if (!pedidoRows[0]) return { suscripcion: null, yaExistia: false };
  const p = pedidoRows[0];

  // 2. Leer los items para armar el plan actualizado
  const { rows: items } = await pool.query(
    `SELECT
       color_codigo, color_nombre, categoria_nombre, frase_texto,
       tipo_mensaje, custom_mode, custom_lines, custom_font,
       design_image_url, design_sig, recurring, cajas
     FROM pedido_items
     WHERE pedido_id = $1
     ORDER BY orden`,
    [pedidoId]
  );

  const plan = items.map((it) => {
    let customLines = null;
    if (it.custom_lines) {
      try {
        customLines = typeof it.custom_lines === "string"
          ? JSON.parse(it.custom_lines)
          : it.custom_lines;
      } catch { customLines = null; }
    }
    return {
      color: it.color_codigo,
      colorNombre: it.color_nombre,
      categoria: it.categoria_nombre,
      frase: it.frase_texto,
      tipo: it.tipo_mensaje,
      customMode: it.custom_mode,
      customLines,
      customFont: it.custom_font,
      designImage: it.design_image_url,
      designSig: it.design_sig,
      recurring: it.recurring,
      boxes: Number(it.cajas),
    };
  });

  // 3. Verificar si ya existe suscripción
  const existente = await obtenerSuscripcion(usuarioId);

  // ✅ SI YA EXISTE ACTIVA → ACTUALIZAR el plan (no crear otra)
  if (existente && existente.estado !== "cancelled") {
    const actualizada = await actualizarSuscripcion(usuarioId, {
      plan,
      cajas_por_mes: Number(p.cajas),
      rosas_por_mes: Number(p.rosas),
      // ⚠️ NO tocamos proxima_fecha: se mantiene la fecha original
      // para no reiniciar el ciclo de facturación
    }, usuarioId);

    return { suscripcion: actualizada, yaExistia: true, actualizada: true };
  }

  // 4. Si no existe (o estaba cancelada) → crear nueva
  const proxima = new Date();
  proxima.setMonth(proxima.getMonth() + 1);
  const proximaFecha = proxima.toISOString().slice(0, 10);

  const suscripcion = await crearSuscripcion({
    usuarioId,
    vendedorId: p.vendedor_id,
    plan,
    cajasPorMes: Number(p.cajas),
    rosasPorMes: Number(p.rosas),
    proximaFecha,
  });

  return { suscripcion, yaExistia: false, actualizada: false };
}