// backend/services/preciosService.js
import { obtenerPool } from "../config/conexion.js";

/* ============================================================
   PRECIOS GLOBALES
   ============================================================ */

export async function obtenerPreciosVigentes() {
  const pool = obtenerPool();
  const { rows } = await pool.query(
    `SELECT id,
            autoship_precio_por_rosa,
            onetime_precio_por_rosa,
            autoship_min_cajas,
            onetime_min_cajas,
            rosas_por_caja,
            personalizacion_texto_precio,
            personalizacion_foto_precio,
            vigente_desde,
            actualizado_en
     FROM configuracion_precios
     WHERE activo = TRUE
     ORDER BY vigente_desde DESC
     LIMIT 1`
  );
  return rows[0] || null;
}

export async function actualizarPreciosGlobales(cambios, usuarioId) {
  const pool = obtenerPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows: actualRows } = await client.query(
      `SELECT * FROM configuracion_precios WHERE activo = TRUE LIMIT 1`
    );
    if (!actualRows[0]) {
      throw Object.assign(new Error("No hay configuración de precios activa."), { estado: 500 });
    }
    const actual = actualRows[0];

    const permitidos = [
      "autoship_precio_por_rosa",
      "onetime_precio_por_rosa",
      "autoship_min_cajas",
      "onetime_min_cajas",
      "rosas_por_caja",
      "personalizacion_texto_precio",
      "personalizacion_foto_precio",
    ];

    const diff = {};
    for (const k of permitidos) {
      if (cambios[k] !== undefined && Number(cambios[k]) !== Number(actual[k])) {
        diff[k] = { antes: Number(actual[k]), despues: Number(cambios[k]) };
      }
    }

    if (Object.keys(diff).length === 0) {
      await client.query("ROLLBACK");
      return { sinCambios: true, precios: actual };
    }

    await client.query(
      `UPDATE configuracion_precios
       SET activo = FALSE, actualizado_en = NOW()
       WHERE id = $1`,
      [actual.id]
    );

    const { rows: nuevaRows } = await client.query(
      `INSERT INTO configuracion_precios (
        autoship_precio_por_rosa,
        onetime_precio_por_rosa,
        autoship_min_cajas,
        onetime_min_cajas,
        rosas_por_caja,
        personalizacion_texto_precio,
        personalizacion_foto_precio,
        activo
      ) VALUES ($1,$2,$3,$4,$5,$6,$7, TRUE)
      RETURNING *`,
      [
        cambios.autoship_precio_por_rosa ?? actual.autoship_precio_por_rosa,
        cambios.onetime_precio_por_rosa  ?? actual.onetime_precio_por_rosa,
        cambios.autoship_min_cajas       ?? actual.autoship_min_cajas,
        cambios.onetime_min_cajas        ?? actual.onetime_min_cajas,
        cambios.rosas_por_caja           ?? actual.rosas_por_caja,
        cambios.personalizacion_texto_precio ?? actual.personalizacion_texto_precio,
        cambios.personalizacion_foto_precio  ?? actual.personalizacion_foto_precio,
      ]
    );

    await client.query(
      `INSERT INTO precios_historial (tipo, referencia_id, usuario_id, cambios)
       VALUES ('global', $1, $2, $3)`,
      [nuevaRows[0].id, usuarioId, JSON.stringify(diff)]
    );

    await client.query("COMMIT");
    return { precios: nuevaRows[0], diff };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/* ============================================================
   PRECIO EFECTIVO PARA UN USUARIO
   ============================================================ */

export async function obtenerPrecioParaUsuario(usuarioId) {
  const pool = obtenerPool();
  const { rows } = await pool.query(
    `SELECT * FROM obtener_precio_para_usuario($1)`,
    [usuarioId]
  );
  return rows[0] || null;
}

/* ============================================================
   VENDEDORES CONFIG (costo + venta + límites)
   ============================================================ */

/**
 * Lista todos los vendedores con su config.
 * Incluye los que NO tienen config todavía.
 */
export async function listarVendedoresConConfig() {
  const pool = obtenerPool();
  const { rows } = await pool.query(`
    SELECT
      u.id            AS usuario_id,
      u.correo,
      u.nombre,
      vc.id           AS config_id,
      vc.costo_autoship_precio_por_rosa,
      vc.costo_onetime_precio_por_rosa,
      vc.costo_personalizacion_texto_precio,
      vc.costo_personalizacion_foto_precio,
      vc.venta_autoship_precio_por_rosa,
      vc.venta_onetime_precio_por_rosa,
      vc.venta_personalizacion_texto_precio,
      vc.venta_personalizacion_foto_precio,
      vc.max_autoship_precio_por_rosa,
      vc.max_onetime_precio_por_rosa,
      vc.max_personalizacion_texto_precio,
      vc.max_personalizacion_foto_precio,
      vc.min_sugerido_autoship_precio_por_rosa,
      vc.min_sugerido_onetime_precio_por_rosa,
      vc.nombre_comercial,
      vc.logo_url,
      vc.color_marca,
      vc.notas,
      vc.activo       AS config_activa,
      vc.creado_en    AS config_creada_en,
      vc.actualizado_en AS config_actualizada_en
    FROM usuarios u
    INNER JOIN usuarios_roles ur ON ur.usuario_id = u.id
    INNER JOIN roles r ON r.id = ur.rol_id
    LEFT JOIN vendedores_config vc ON vc.usuario_id = u.id
    WHERE r.nombre = 'vendedor'
    ORDER BY u.nombre, u.correo
  `);
  return rows;
}

export async function obtenerConfigVendedor(usuarioId) {
  const pool = obtenerPool();
  const { rows } = await pool.query(
    `SELECT * FROM vendedores_config WHERE usuario_id = $1 LIMIT 1`,
    [usuarioId]
  );
  return rows[0] || null;
}

export async function crearConfigVendedor(datos) {
  const pool = obtenerPool();
  const {
    usuario_id,
    costo_autoship_precio_por_rosa,
    costo_onetime_precio_por_rosa,
    costo_personalizacion_texto_precio,
    costo_personalizacion_foto_precio,
    venta_autoship_precio_por_rosa = null,
    venta_onetime_precio_por_rosa = null,
    venta_personalizacion_texto_precio = null,
    venta_personalizacion_foto_precio = null,
    max_autoship_precio_por_rosa = null,
    max_onetime_precio_por_rosa = null,
    max_personalizacion_texto_precio = null,
    max_personalizacion_foto_precio = null,
    min_sugerido_autoship_precio_por_rosa = null,
    min_sugerido_onetime_precio_por_rosa = null,
    nombre_comercial = null,
    logo_url = null,
    color_marca = null,
    notas = null,
  } = datos;

  const { rows } = await pool.query(
    `INSERT INTO vendedores_config (
      usuario_id,
      costo_autoship_precio_por_rosa, costo_onetime_precio_por_rosa,
      costo_personalizacion_texto_precio, costo_personalizacion_foto_precio,
      venta_autoship_precio_por_rosa, venta_onetime_precio_por_rosa,
      venta_personalizacion_texto_precio, venta_personalizacion_foto_precio,
      max_autoship_precio_por_rosa, max_onetime_precio_por_rosa,
      max_personalizacion_texto_precio, max_personalizacion_foto_precio,
      min_sugerido_autoship_precio_por_rosa, min_sugerido_onetime_precio_por_rosa,
      nombre_comercial, logo_url, color_marca, notas
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
    ) RETURNING *`,
    [
      usuario_id,
      costo_autoship_precio_por_rosa, costo_onetime_precio_por_rosa,
      costo_personalizacion_texto_precio, costo_personalizacion_foto_precio,
      venta_autoship_precio_por_rosa, venta_onetime_precio_por_rosa,
      venta_personalizacion_texto_precio, venta_personalizacion_foto_precio,
      max_autoship_precio_por_rosa, max_onetime_precio_por_rosa,
      max_personalizacion_texto_precio, max_personalizacion_foto_precio,
      min_sugerido_autoship_precio_por_rosa, min_sugerido_onetime_precio_por_rosa,
      nombre_comercial, logo_url, color_marca, notas,
    ]
  );
  return rows[0];
}

export async function actualizarConfigVendedor(usuarioId, cambios, adminId = null) {
  const pool = obtenerPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows: actualRows } = await client.query(
      `SELECT * FROM vendedores_config WHERE usuario_id = $1`,
      [usuarioId]
    );
    if (!actualRows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    const actual = actualRows[0];

    const permitidos = [
      "costo_autoship_precio_por_rosa",
      "costo_onetime_precio_por_rosa",
      "costo_personalizacion_texto_precio",
      "costo_personalizacion_foto_precio",
      "venta_autoship_precio_por_rosa",
      "venta_onetime_precio_por_rosa",
      "venta_personalizacion_texto_precio",
      "venta_personalizacion_foto_precio",
      "max_autoship_precio_por_rosa",
      "max_onetime_precio_por_rosa",
      "max_personalizacion_texto_precio",
      "max_personalizacion_foto_precio",
      "min_sugerido_autoship_precio_por_rosa",
      "min_sugerido_onetime_precio_por_rosa",
      "nombre_comercial",
      "logo_url",
      "color_marca",
      "notas",
    ];

    const campos = [];
    const valores = [];
    const diff = {};
    let i = 1;

    for (const k of permitidos) {
      if (cambios[k] !== undefined && cambios[k] !== actual[k]) {
        campos.push(`${k} = $${i}`);
        valores.push(cambios[k]);
        diff[k] = { antes: actual[k], despues: cambios[k] };
        i++;
      }
    }

    if (!campos.length) {
      await client.query("ROLLBACK");
      return { sinCambios: true, config: actual };
    }

    valores.push(usuarioId);
    const { rows } = await client.query(
      `UPDATE vendedores_config
       SET ${campos.join(", ")}, actualizado_en = NOW()
       WHERE usuario_id = $${i}
       RETURNING *`,
      valores
    );

    if (adminId) {
      await client.query(
        `INSERT INTO precios_historial (tipo, referencia_id, usuario_id, cambios)
         VALUES ('costo', $1, $2, $3)`,
        [rows[0].id, adminId, JSON.stringify(diff)]
      );
    }

    await client.query("COMMIT");
    return { config: rows[0], diff };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/* ============================================================
   HISTORIAL
   ============================================================ */

export async function listarHistorial({ limite = 50, tipo = null } = {}) {
  const pool = obtenerPool();
  const params = [limite];
  let where = "";
  if (tipo) {
    where = "WHERE ph.tipo = $2";
    params.push(tipo);
  }

  const { rows } = await pool.query(
    `SELECT
       ph.id, ph.tipo, ph.referencia_id, ph.cambios, ph.notas, ph.creado_en,
       u.correo AS usuario_correo,
       u.nombre AS usuario_nombre
     FROM precios_historial ph
     LEFT JOIN usuarios u ON u.id = ph.usuario_id
     ${where}
     ORDER BY ph.creado_en DESC
     LIMIT $1`,
    params
  );
  return rows;
}