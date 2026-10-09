// backend/services/avatarService.js
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { obtenerPool } from "../config/conexion.js";
import { ALMACENAMIENTO_RAIZ } from "../config/almacenamiento.js";

// ============================================================
// Configuración
// ============================================================
const AVATARES_RAIZ = path.join(ALMACENAMIENTO_RAIZ, "avatares");

const DIMENSIONES = {
  minAncho: 100,
  minAlto: 100,
  maxAncho: 2000,
  maxAlto: 2000,
  tamanoFinal: 400,
};

// ============================================================
// Utilidades
// ============================================================
async function asegurarCarpeta(ruta) {
  await fs.mkdir(ruta, { recursive: true });
}

function hashSha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Devuelve la URL PÚBLICA completa del avatar.
 * El frontend no tiene que prepend nada.
 */
function urlPublica(uuid) {
  const base = (process.env.URL_BACKEND || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/api/mi-perfil/avatar/${uuid}`;
}

// ============================================================
// SUBIR / REEMPLAZAR avatar
// ============================================================
export async function subirAvatar(usuarioId, buffer) {
  const pool = obtenerPool();

  // ── 1. Procesar con sharp ──────────────────────────────
  const imagen = sharp(buffer).rotate();
  const metadata = await imagen.metadata();

  if (metadata.width < DIMENSIONES.minAncho || metadata.height < DIMENSIONES.minAlto) {
    const err = new Error(`La imagen debe ser al menos ${DIMENSIONES.minAncho}×${DIMENSIONES.minAlto}px.`);
    err.estado = 400;
    throw err;
  }
  if (metadata.width > DIMENSIONES.maxAncho || metadata.height > DIMENSIONES.maxAlto) {
    const err = new Error(`La imagen no puede superar ${DIMENSIONES.maxAncho}×${DIMENSIONES.maxAlto}px.`);
    err.estado = 400;
    throw err;
  }

  const bufferWebp = await imagen
    .resize(DIMENSIONES.tamanoFinal, DIMENSIONES.tamanoFinal, {
      fit: "cover",
      position: "center",
    })
    .webp({ quality: 90 })
    .toBuffer();

  const info = await sharp(bufferWebp).metadata();

  // ── 2. Ruta del archivo ────────────────────────────────
  const uuidArchivo = crypto.randomUUID();
  const fecha = new Date().toISOString().slice(0, 10);

  const rutaAbs = path.join(AVATARES_RAIZ, usuarioId, fecha, `${uuidArchivo}.webp`);
  const rutaRel = path
    .join("avatares", usuarioId, fecha, `${uuidArchivo}.webp`)
    .replace(/\\/g, "/");

  await asegurarCarpeta(path.dirname(rutaAbs));
  await fs.writeFile(rutaAbs, bufferWebp);

  const hash = hashSha256(bufferWebp);

  // ── 3. Guardar URL ABSOLUTA en la BD ───────────────────
  const urlAbsoluta = urlPublica(uuidArchivo);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: actualRows } = await client.query(
      `SELECT avatar_url FROM usuarios_detalles WHERE usuario_id = $1`,
      [usuarioId]
    );
    const avatarViejo = actualRows[0]?.avatar_url || null;

    // Guardamos la URL absoluta
    const { rows } = await client.query(
      `UPDATE usuarios_detalles
       SET avatar_url = $1, actualizado_en = NOW()
       WHERE usuario_id = $2
       RETURNING *`,
      [urlAbsoluta, usuarioId]
    );

    await client.query("COMMIT");

    // Borrar el avatar viejo del disco
    if (avatarViejo) {
      const uuidViejo = avatarViejo.split("/").pop();
      if (uuidViejo) {
        try {
          const carpeta = path.join(AVATARES_RAIZ, usuarioId);
          const fechas = await fs.readdir(carpeta).catch(() => []);
          for (const f of fechas) {
            const ruta = path.join(carpeta, f, `${uuidViejo}.webp`);
            try {
              await fs.access(ruta);
              await fs.unlink(ruta);
              break;
            } catch { /* no existe */ }
          }
        } catch { /* noop */ }
      }
    }

    return {
      avatar_url: rows[0].avatar_url, // URL absoluta
      ruta_absoluta: rutaAbs,
      ruta_relativa: rutaRel,
      uuid: uuidArchivo,
      ancho: info.width,
      alto: info.height,
      tamano: bufferWebp.length,
      hash,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    try { await fs.unlink(rutaAbs); } catch { /* noop */ }
    throw e;
  } finally {
    client.release();
  }
}

// ============================================================
// ELIMINAR avatar
// ============================================================
export async function eliminarAvatar(usuarioId) {
  const pool = obtenerPool();

  const { rows } = await pool.query(
    `SELECT avatar_url FROM usuarios_detalles WHERE usuario_id = $1`,
    [usuarioId]
  );
  const avatarViejo = rows[0]?.avatar_url;
  if (!avatarViejo) return false;

  await pool.query(
    `UPDATE usuarios_detalles SET avatar_url = NULL, actualizado_en = NOW()
     WHERE usuario_id = $1`,
    [usuarioId]
  );

  const uuidViejo = avatarViejo.split("/").pop();
  if (uuidViejo) {
    try {
      const carpeta = path.join(AVATARES_RAIZ, usuarioId);
      const fechas = await fs.readdir(carpeta).catch(() => []);
      for (const f of fechas) {
        const ruta = path.join(carpeta, f, `${uuidViejo}.webp`);
        try {
          await fs.access(ruta);
          await fs.unlink(ruta);
          break;
        } catch { /* no existe */ }
      }
    } catch { /* noop */ }
  }

  return true;
}

// ============================================================
// OBTENER ruta del archivo a servir
// ============================================================
export async function obtenerRutaAvatar(usuarioId, uuid) {
  const carpeta = path.join(AVATARES_RAIZ, usuarioId);
  try {
    const fechas = await fs.readdir(carpeta);
    for (const f of fechas) {
      const ruta = path.join(carpeta, f, `${uuid}.webp`);
      try {
        await fs.access(ruta);
        return ruta;
      } catch { /* no existe */ }
    }
  } catch { /* no existe la carpeta */ }
  return null;
}

/* ============================================================
   SUBIR AVATAR (admin — para cualquier usuario)
   ============================================================ */
export async function subirAvatarAdmin(usuarioId, buffer) {
  // Reutilizamos la lógica de subirAvatar, pero el usuarioId
  // es el del usuario objetivo (no el admin logueado).
  return subirAvatar(usuarioId, buffer);
}

/* ============================================================
   ELIMINAR AVATAR (admin — para cualquier usuario)
   ============================================================ */
export async function eliminarAvatarAdmin(usuarioId) {
  return eliminarAvatar(usuarioId);
}