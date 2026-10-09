// backend/services/usuariosService.js
import bcrypt from "bcrypt";
import { obtenerPool } from "../config/conexion.js";

/* ============================================================
   HASH DE CONTRASEÑA
   ============================================================
   Usamos bcrypt. Formato: $2b$10$...
   Coincide con imansi-auth-node.
   ============================================================ */

const RONDAS = 10;

export async function hashContrasena(password) {
  return bcrypt.hash(password, RONDAS);
}

export async function verificarContrasena(password, almacenado) {
  if (!almacenado || typeof almacenado !== "string") return false;
  if (!almacenado.startsWith("$2b$") && !almacenado.startsWith("$2a$")) {
    return false;
  }
  try {
    return await bcrypt.compare(password, almacenado);
  } catch {
    return false;
  }
}

/* ============================================================
   Helpers
   ============================================================ */
function normalizarCorreo(correo) {
  return String(correo || "").trim().toLowerCase();
}

function validarCorreo(correo) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo);
}

/* ============================================================
   LISTAR USUARIOS (con filtros)
   ============================================================ */
export async function listarUsuarios({
  rol = null,
  referidoPor = null,
  sinVendedor = false,
  buscar = null,
  limite = 200,
} = {}) {
  const pool = obtenerPool();

  const condiciones = [];
  const valores = [];
  let i = 1;

  if (rol) {
    condiciones.push(`EXISTS (
      SELECT 1 FROM usuarios_roles ur2
      INNER JOIN roles r2 ON r2.id = ur2.rol_id
      WHERE ur2.usuario_id = u.id AND r2.nombre = $${i}
    )`);
    valores.push(rol);
    i++;
  }

  if (referidoPor) {
    condiciones.push(`u.referido_por = $${i}`);
    valores.push(referidoPor);
    i++;
  }

  if (sinVendedor) {
    condiciones.push(`u.referido_por IS NULL`);
  }

  if (buscar) {
    condiciones.push(`(
      u.correo ILIKE $${i} OR
      COALESCE(u.nombre, '') ILIKE $${i}
    )`);
    valores.push(`%${buscar}%`);
    i++;
  }

  valores.push(limite);
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  const { rows } = await pool.query(
    `SELECT
       u.id, u.correo, u.nombre, u.creado_en,
       u.referido_por,
       ref.correo AS referido_por_correo,
       ref.nombre AS referido_por_nombre,
       COALESCE(
         (SELECT STRING_AGG(r.nombre, ', ' ORDER BY r.nombre)
          FROM usuarios_roles ur
          INNER JOIN roles r ON r.id = ur.rol_id
          WHERE ur.usuario_id = u.id),
         ''
       ) AS roles,
       (SELECT COUNT(*) FROM usuarios c WHERE c.referido_por = u.id) AS clientes_referidos
     FROM usuarios u
     LEFT JOIN usuarios ref ON ref.id = u.referido_por
     ${where}
     ORDER BY u.creado_en DESC
     LIMIT $${i}`,
    valores
  );

  return rows.map((u) => ({
    ...u,
    roles: u.roles ? u.roles.split(", ") : [],
    es_vendedor: u.roles.includes("vendedor"),
  }));
}

/* ============================================================
   OBTENER USUARIO POR ID
   ============================================================ */
export async function obtenerUsuarioPorId(id) {
  const pool = obtenerPool();
  const { rows } = await pool.query(
    `SELECT
       u.id, u.correo, u.nombre, u.creado_en, u.actualizado_en,
       u.dos_factores_activo, u.correo_verificado, u.referido_por,
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
    [id]
  );
  if (!rows[0]) return null;
  return {
    ...rows[0],
    roles: rows[0].roles ? rows[0].roles.split(", ") : [],
  };
}

/* ============================================================
   CREAR USUARIO (con rol específico)
   ============================================================ */
export async function crearUsuario({
  correo,
  nombre,
  contrasena,
  rol = "cliente",
  referidoPor = null,
  asignadoPor = null,
}) {
  const pool = obtenerPool();
  const correoLimpio = normalizarCorreo(correo);

  if (!validarCorreo(correoLimpio)) {
    throw Object.assign(new Error("Correo inválido."), { estado: 400 });
  }
  if (!nombre || !nombre.trim()) {
    throw Object.assign(new Error("El nombre es obligatorio."), { estado: 400 });
  }
  if (!contrasena || contrasena.length < 6) {
    throw Object.assign(new Error("La contraseña debe tener al menos 6 caracteres."), { estado: 400 });
  }

  const rolesValidos = ["admin", "vendedor", "cliente"];
  if (!rolesValidos.includes(rol)) {
    throw Object.assign(new Error("Rol inválido."), { estado: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Verificar que no exista
    const { rows: existe } = await client.query(
      `SELECT id FROM usuarios WHERE correo = $1`,
      [correoLimpio]
    );
    if (existe[0]) {
      throw Object.assign(new Error("Ya existe un usuario con ese correo."), { estado: 409 });
    }

    // 2. Crear usuario
    const hash = await hashContrasena(contrasena);
    const { rows: nuevoUsuario } = await client.query(
      `INSERT INTO usuarios
         (correo, nombre, contrasena_hash, correo_verificado, referido_por)
       VALUES ($1, $2, $3, TRUE, $4)
       RETURNING id, correo, nombre, creado_en, referido_por`,
      [correoLimpio, nombre.trim(), hash, referidoPor]
    );
    const usuario = nuevoUsuario[0];

    // 3. El trigger ya asignó el rol 'cliente'.
    //    Si el rol es otro, borramos 'cliente' y asignamos solo el nuevo.
    if (rol !== "cliente") {
      // 3a. Quitar el rol 'cliente' que puso el trigger
      await client.query(
        `DELETE FROM usuarios_roles
         WHERE usuario_id = $1
           AND rol_id = (SELECT id FROM roles WHERE nombre = 'cliente')`,
        [usuario.id]
      );

      // 3b. Asignar el rol solicitado
      await client.query(
        `INSERT INTO usuarios_roles (usuario_id, rol_id, asignado_por)
         SELECT $1, id, $2 FROM roles WHERE nombre = $3
         ON CONFLICT (usuario_id, rol_id) DO NOTHING`,
        [usuario.id, asignadoPor, rol]
      );
    }

    await client.query("COMMIT");
    return usuario;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/* ============================================================
   CREAR VENDEDOR
   ============================================================
   ✅ FIX: Si ya existe una config previa (de un vendedor que fue
   dado de baja), la REACTIVA automáticamente con sus precios
   anteriores intactos.
   ============================================================ */
export async function crearVendedor({
  correo,
  nombre,
  contrasena,
  nombreComercial = null,
  asignadoPor = null,
}) {
  const usuario = await crearUsuario({
    correo,
    nombre,
    contrasena,
    rol: "vendedor",
    referidoPor: null,
    asignadoPor,
  });

  const pool = obtenerPool();
  await pool.query(
    `INSERT INTO vendedores_config (usuario_id, nombre_comercial, activo)
     VALUES ($1, $2, TRUE)
     ON CONFLICT (usuario_id) DO UPDATE
       SET activo = TRUE,
           nombre_comercial = COALESCE(EXCLUDED.nombre_comercial, vendedores_config.nombre_comercial),
           actualizado_en = NOW()`,
    [usuario.id, nombreComercial]
  );

  return obtenerUsuarioPorId(usuario.id);
}

/* ============================================================
   PROMOVER USUARIO A VENDEDOR
   ============================================================
   ✅ FIX: Si el usuario ya tenía config de vendedor (dada de baja),
   la REACTIVA con sus precios anteriores.
   ============================================================ */
export async function promoverAVendedor(usuarioId, asignadoPor = null) {
  const pool = obtenerPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const { rows: usuarioRows } = await client.query(
      `SELECT id FROM usuarios WHERE id = $1`,
      [usuarioId]
    );
    if (!usuarioRows[0]) {
      throw Object.assign(new Error("Usuario no encontrado."), { estado: 404 });
    }

    const { rows: yaEs } = await client.query(
      `SELECT 1 FROM usuarios_roles ur
       INNER JOIN roles r ON r.id = ur.rol_id
       WHERE ur.usuario_id = $1 AND r.nombre = 'vendedor'`,
      [usuarioId]
    );
    if (yaEs[0]) {
      await client.query("ROLLBACK");
      throw Object.assign(new Error("El usuario ya es vendedor."), { estado: 409 });
    }

    // 1. Quitar el rol 'cliente' (para que quede SOLO con vendedor)
    await client.query(
      `DELETE FROM usuarios_roles
       WHERE usuario_id = $1
         AND rol_id = (SELECT id FROM roles WHERE nombre = 'cliente')`,
      [usuarioId]
    );

    // 2. Asignar el rol 'vendedor'
    await client.query(
      `INSERT INTO usuarios_roles (usuario_id, rol_id, asignado_por)
       SELECT $1, id, $2 FROM roles WHERE nombre = 'vendedor'
       ON CONFLICT (usuario_id, rol_id) DO NOTHING`,
      [usuarioId, asignadoPor]
    );

    // 3. ✅ Reactivar la config existente (o crearla si no existe)
    await client.query(
      `INSERT INTO vendedores_config (usuario_id, activo)
       VALUES ($1, TRUE)
       ON CONFLICT (usuario_id) DO UPDATE
         SET activo = TRUE, actualizado_en = NOW()`,
      [usuarioId]
    );

    await client.query("COMMIT");
    return obtenerUsuarioPorId(usuarioId);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/* ============================================================
   DESACTIVAR VENDEDOR (quitar rol)
   ============================================================
   Convierte a un vendedor en cliente:
   - Quita el rol 'vendedor'
   - Asegura que tenga el rol 'cliente'
   - Desactiva la config (pero NO la borra: los precios quedan
     guardados para cuando lo reactiven).
   ============================================================ */
export async function quitarRolVendedor(usuarioId, asignadoPor = null) {
  const pool = obtenerPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Quitar el rol 'vendedor'
    const { rowCount } = await client.query(
      `DELETE FROM usuarios_roles
       WHERE usuario_id = $1
         AND rol_id = (SELECT id FROM roles WHERE nombre = 'vendedor')`,
      [usuarioId]
    );

    // 2. Asegurar que tenga el rol 'cliente'
    await client.query(
      `INSERT INTO usuarios_roles (usuario_id, rol_id, asignado_por)
       SELECT $1, id, $2 FROM roles WHERE nombre = 'cliente'
       ON CONFLICT (usuario_id, rol_id) DO NOTHING`,
      [usuarioId, asignadoPor]
    );

    // 3. Quitar cualquier otro rol que no sea 'cliente' (limpieza)
    await client.query(
      `DELETE FROM usuarios_roles
       WHERE usuario_id = $1
         AND rol_id NOT IN (SELECT id FROM roles WHERE nombre = 'cliente')`,
      [usuarioId]
    );

    // 4. Desactivar la configuración del vendedor
    await client.query(
      `UPDATE vendedores_config
       SET activo = FALSE, actualizado_en = NOW()
       WHERE usuario_id = $1`,
      [usuarioId]
    );

    await client.query("COMMIT");
    return rowCount > 0;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/* ============================================================
   ASIGNAR / QUITAR ROL
   ============================================================ */
export async function asignarRol(usuarioId, nombreRol, asignadoPor = null) {
  const pool = obtenerPool();
  const { rows } = await pool.query(
    `INSERT INTO usuarios_roles (usuario_id, rol_id, asignado_por)
     SELECT $1, id, $2 FROM roles WHERE nombre = $3
     ON CONFLICT (usuario_id, rol_id) DO NOTHING
     RETURNING *`,
    [usuarioId, asignadoPor, nombreRol]
  );
  return rows[0] || null;
}

export async function quitarRol(usuarioId, nombreRol) {
  const pool = obtenerPool();
  const { rowCount } = await pool.query(
    `DELETE FROM usuarios_roles
     WHERE usuario_id = $1
       AND rol_id = (SELECT id FROM roles WHERE nombre = $2)`,
    [usuarioId, nombreRol]
  );
  return rowCount > 0;
}

/* ============================================================
   ASIGNAR VENDEDOR REFERENTE
   ============================================================ */
export async function asignarVendedorReferente(usuarioId, vendedorId) {
  const pool = obtenerPool();

  if (!vendedorId) {
    const { rowCount } = await pool.query(
      `UPDATE usuarios SET referido_por = NULL, actualizado_en = NOW() WHERE id = $1`,
      [usuarioId]
    );
    return rowCount > 0;
  }

  const { rows: vendedorRows } = await pool.query(
    `SELECT 1 FROM usuarios_roles ur
     INNER JOIN roles r ON r.id = ur.rol_id
     WHERE ur.usuario_id = $1 AND r.nombre = 'vendedor'`,
    [vendedorId]
  );
  if (!vendedorRows[0]) {
    throw Object.assign(new Error("El vendedor no existe o no tiene ese rol."), { estado: 404 });
  }

  const { rowCount } = await pool.query(
    `UPDATE usuarios SET referido_por = $1, actualizado_en = NOW() WHERE id = $2`,
    [vendedorId, usuarioId]
  );
  return rowCount > 0;
}

/* ============================================================
   CAMBIAR CONTRASEÑA
   ============================================================ */
export async function cambiarContrasena(usuarioId, nuevaContrasena) {
  if (!nuevaContrasena || nuevaContrasena.length < 6) {
    throw Object.assign(new Error("La contraseña debe tener al menos 6 caracteres."), { estado: 400 });
  }
  const pool = obtenerPool();
  const hash = await hashContrasena(nuevaContrasena);
  const { rowCount } = await pool.query(
    `UPDATE usuarios SET contrasena_hash = $1, actualizado_en = NOW() WHERE id = $2`,
    [hash, usuarioId]
  );
  return rowCount > 0;
}

/* ============================================================
   EDITAR USUARIO (nombre, correo)
   ============================================================ */
export async function editarUsuario(usuarioId, cambios) {
  const pool = obtenerPool();
  const permitidos = ["nombre", "correo"];
  const campos = [];
  const valores = [];
  let i = 1;

  for (const k of permitidos) {
    if (cambios[k] !== undefined) {
      let v = cambios[k];
      if (k === "correo") {
        v = normalizarCorreo(v);
        if (!validarCorreo(v)) {
          throw Object.assign(new Error("Correo inválido."), { estado: 400 });
        }
      }
      if (k === "nombre") {
        v = String(v).trim();
        if (!v) throw Object.assign(new Error("El nombre no puede estar vacío."), { estado: 400 });
      }
      campos.push(`${k} = $${i}`);
      valores.push(v);
      i++;
    }
  }
  if (!campos.length) return null;

  valores.push(usuarioId);
  try {
    const { rows } = await pool.query(
      `UPDATE usuarios
       SET ${campos.join(", ")}, actualizado_en = NOW()
       WHERE id = $${i}
       RETURNING id, correo, nombre, creado_en, referido_por`,
      valores
    );
    return rows[0] || null;
  } catch (e) {
    if (e.code === "23505") {
      throw Object.assign(new Error("Ya existe un usuario con ese correo."), { estado: 409 });
    }
    throw e;
  }
}

/* ============================================================
   LISTAR VENDEDORES
   ============================================================ */
export async function listarVendedores({ buscar = null, limite = 200 } = {}) {
  const pool = obtenerPool();
  const valores = [];
  let where = "WHERE r.nombre = 'vendedor'";
  let i = 1;

  if (buscar) {
    where += ` AND (u.correo ILIKE $${i} OR COALESCE(u.nombre, '') ILIKE $${i})`;
    valores.push(`%${buscar}%`);
    i++;
  }
  valores.push(limite);

  const { rows } = await pool.query(
    `SELECT DISTINCT
       u.id, u.correo, u.nombre, u.creado_en, u.actualizado_en,
       vc.id AS config_id,
       vc.nombre_comercial,
       vc.costo_autoship_precio_por_rosa,
       vc.costo_onetime_precio_por_rosa,
       vc.venta_autoship_precio_por_rosa,
       vc.venta_onetime_precio_por_rosa,
       vc.activo AS config_activa,
       (SELECT COUNT(*) FROM usuarios c WHERE c.referido_por = u.id) AS clientes_referidos
     FROM usuarios u
     INNER JOIN usuarios_roles ur ON ur.usuario_id = u.id
     INNER JOIN roles r ON r.id = ur.rol_id
     LEFT JOIN vendedores_config vc ON vc.usuario_id = u.id
     ${where}
     ORDER BY u.creado_en DESC
     LIMIT $${i}`,
    valores
  );
  return rows;
}

/* ============================================================
   BUSCAR USUARIOS PARA PROMOVER
   ============================================================ */
export async function buscarUsuariosParaPromover({ buscar = null, limite = 50 } = {}) {
  const pool = obtenerPool();
  const valores = [];
  let i = 1;

  let where = `WHERE NOT EXISTS (
    SELECT 1 FROM usuarios_roles ur
    INNER JOIN roles r ON r.id = ur.rol_id
    WHERE ur.usuario_id = u.id
      AND r.nombre IN ('vendedor', 'admin')
  )`;

  if (buscar) {
    where += ` AND (u.correo ILIKE $${i} OR COALESCE(u.nombre, '') ILIKE $${i})`;
    valores.push(`%${buscar}%`);
    i++;
  }
  valores.push(limite);

  const { rows } = await pool.query(
    `SELECT
       u.id, u.correo, u.nombre, u.creado_en,
       COALESCE(
         (SELECT STRING_AGG(r.nombre, ', ' ORDER BY r.nombre)
          FROM usuarios_roles ur
          INNER JOIN roles r ON r.id = ur.rol_id
          WHERE ur.usuario_id = u.id),
         ''
       ) AS roles
     FROM usuarios u
     ${where}
     ORDER BY u.creado_en DESC
     LIMIT $${i}`,
    valores
  );
  return rows.map((u) => ({ ...u, roles: u.roles ? u.roles.split(", ") : [] }));
}

/* ============================================================
   ESTADÍSTICAS BÁSICAS
   ============================================================ */
export async function estadisticasUsuarios() {
  const pool = obtenerPool();
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM usuarios) AS total,

      (SELECT COUNT(DISTINCT ur.usuario_id)
       FROM usuarios_roles ur
       INNER JOIN roles r ON r.id = ur.rol_id
       WHERE r.nombre = 'admin') AS admins,

      (SELECT COUNT(DISTINCT ur.usuario_id)
       FROM usuarios_roles ur
       INNER JOIN roles r ON r.id = ur.rol_id
       WHERE r.nombre = 'vendedor') AS vendedores,

      (SELECT COUNT(DISTINCT ur.usuario_id)
       FROM usuarios_roles ur
       INNER JOIN roles r ON r.id = ur.rol_id
       WHERE r.nombre = 'cliente'
         AND ur.usuario_id NOT IN (
           SELECT ur2.usuario_id
           FROM usuarios_roles ur2
           INNER JOIN roles r2 ON r2.id = ur2.rol_id
           WHERE r2.nombre IN ('vendedor', 'admin')
         )) AS clientes,

      (SELECT COUNT(DISTINCT ur.usuario_id)
       FROM usuarios_roles ur
       INNER JOIN roles r ON r.id = ur.rol_id
       INNER JOIN usuarios u ON u.id = ur.usuario_id
       WHERE r.nombre = 'cliente'
         AND u.referido_por IS NULL
         AND ur.usuario_id NOT IN (
           SELECT ur2.usuario_id
           FROM usuarios_roles ur2
           INNER JOIN roles r2 ON r2.id = ur2.rol_id
           WHERE r2.nombre IN ('vendedor', 'admin')
         )) AS sin_vendedor,

      (SELECT COUNT(DISTINCT ur.usuario_id)
       FROM usuarios_roles ur
       INNER JOIN roles r ON r.id = ur.rol_id
       INNER JOIN usuarios u ON u.id = ur.usuario_id
       WHERE r.nombre = 'cliente'
         AND u.referido_por IS NOT NULL
         AND ur.usuario_id NOT IN (
           SELECT ur2.usuario_id
           FROM usuarios_roles ur2
           INNER JOIN roles r2 ON r2.id = ur2.rol_id
           WHERE r2.nombre IN ('vendedor', 'admin')
         )) AS con_vendedor
  `);
  return rows[0];
}