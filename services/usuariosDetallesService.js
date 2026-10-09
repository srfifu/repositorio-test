// backend/services/usuariosDetallesService.js
import { obtenerPool } from "../config/conexion.js";

/* ============================================================
   OBTENER DETALLE (lo crea si no existe)
   ============================================================ */
export async function obtenerDetalle(usuarioId) {
  const pool = obtenerPool();

  // 1. Intentar obtener
  const { rows } = await pool.query(
    `SELECT * FROM usuarios_detalles WHERE usuario_id = $1`,
    [usuarioId]
  );
  if (rows[0]) return rows[0];

  // 2. Si no existe, crearlo
  const { rows: nuevo } = await pool.query(
    `INSERT INTO usuarios_detalles (usuario_id, nombre)
     SELECT $1, u.nombre FROM usuarios u WHERE u.id = $1
     ON CONFLICT (usuario_id) DO UPDATE SET actualizado_en = NOW()
     RETURNING *`,
    [usuarioId]
  );
  return nuevo[0] || null;
}

/* ============================================================
   ACTUALIZAR DETALLE (todos los campos editables)
   ============================================================ */
export async function actualizarDetalle(usuarioId, cambios) {
  const pool = obtenerPool();

  const permitidos = [
    "nombre", "apellido",
    "nombre_tienda", "contacto", "sitio_web", "tax_id",
    "telefono",
    "direccion", "ciudad", "provincia", "codigo_postal", "pais",
    "avatar_url",
  ];

  // Asegurar que exista la fila
  await obtenerDetalle(usuarioId);

  const campos = [];
  const valores = [];
  let i = 1;

  for (const k of permitidos) {
    if (cambios[k] !== undefined) {
      campos.push(`${k} = $${i}`);
      valores.push(cambios[k] === "" ? null : cambios[k]);
      i++;
    }
  }

  if (!campos.length) return obtenerDetalle(usuarioId);

  valores.push(usuarioId);
  const { rows } = await pool.query(
    `UPDATE usuarios_detalles
     SET ${campos.join(", ")}, actualizado_en = NOW()
     WHERE usuario_id = $${i}
     RETURNING *`,
    valores
  );
  return rows[0];
}

/* ============================================================
   ACTUALIZAR PREFERENCIAS
   ============================================================ */
export async function actualizarPreferencias(usuarioId, cambios) {
  const pool = obtenerPool();
  const permitidos = ["idioma", "zona_horaria", "formato_fecha", "moneda"];

  await obtenerDetalle(usuarioId);

  const campos = [];
  const valores = [];
  let i = 1;
  for (const k of permitidos) {
    if (cambios[k] !== undefined) {
      campos.push(`${k} = $${i}`);
      valores.push(cambios[k]);
      i++;
    }
  }
  if (!campos.length) return obtenerDetalle(usuarioId);

  valores.push(usuarioId);
  const { rows } = await pool.query(
    `UPDATE usuarios_detalles
     SET ${campos.join(", ")}, actualizado_en = NOW()
     WHERE usuario_id = $${i}
     RETURNING *`,
    valores
  );
  return rows[0];
}

/* ============================================================
   ACTUALIZAR NOTIFICACIONES
   ============================================================ */
export async function actualizarNotificaciones(usuarioId, cambios) {
  const pool = obtenerPool();
  const permitidos = [
    "notif_autoship", "notif_factura", "notif_diseno",
    "notif_pedido", "notif_marketing",
    "canal_email", "canal_whatsapp", "canal_sms",
  ];

  await obtenerDetalle(usuarioId);

  const campos = [];
  const valores = [];
  let i = 1;
  for (const k of permitidos) {
    if (cambios[k] !== undefined) {
      campos.push(`${k} = $${i}`);
      valores.push(Boolean(cambios[k]));
      i++;
    }
  }
  if (!campos.length) return obtenerDetalle(usuarioId);

  valores.push(usuarioId);
  const { rows } = await pool.query(
    `UPDATE usuarios_detalles
     SET ${campos.join(", ")}, actualizado_en = NOW()
     WHERE usuario_id = $${i}
     RETURNING *`,
    valores
  );
  return rows[0];
}

/* ============================================================
   OBTENER PERFIL COMPLETO (usuario + detalle + roles)
   ============================================================ */
export async function obtenerPerfilCompleto(usuarioId) {
  const pool = obtenerPool();

  const { rows: usuarioRows } = await pool.query(
    `SELECT
       u.id, u.correo, u.nombre, u.creado_en, u.dos_factores_activo,
       u.correo_verificado, u.referido_por,
       ref.correo AS referido_por_correo,
       ref.nombre AS referido_por_nombre,
       COALESCE(
         (SELECT STRING_AGG(r.nombre, ', ' ORDER BY r.nombre)
          FROM usuarios_roles ur
          INNER JOIN roles r ON r.id = ur.rol_id
          WHERE ur.usuario_id = u.id),
         ''
       ) AS roles
     FROM usuarios u
     LEFT JOIN usuarios ref ON ref.id = u.referido_por
     WHERE u.id = $1`,
    [usuarioId]
  );
  if (!usuarioRows[0]) return null;

  const usuario = usuarioRows[0];
  const detalle = await obtenerDetalle(usuarioId);

  return {
    ...usuario,
    roles: usuario.roles ? usuario.roles.split(", ") : [],
    detalle,
  };
}