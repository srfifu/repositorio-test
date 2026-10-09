import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { obtenerPool } from "../config/conexion.js";
import {
  ROSAS_RAIZ,
  DIMENSIONES,
  fechaHoy,
  rutaAbsoluta,
  rutaRelativa,
  construirSlotId,
} from "../config/almacenamiento.js";

/* ============================================================
   Utilidades
   ============================================================ */

function hashSha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function asegurarCarpeta(ruta) {
  await fs.mkdir(ruta, { recursive: true });
}

async function procesarImagen(buffer) {
  const { data: bufferWebp, info } = await sharp(buffer)
    .webp({ quality: 90 })
    .toBuffer({ resolveWithObject: true });

  if (info.width < DIMENSIONES.minAncho || info.height < DIMENSIONES.minAlto) {
    const err = new Error(
      `La imagen debe ser al menos ${DIMENSIONES.minAncho}×${DIMENSIONES.minAlto}px.`
    );
    err.estado = 400;
    throw err;
  }
  if (info.width > DIMENSIONES.maxAncho || info.height > DIMENSIONES.maxAlto) {
    const err = new Error(
      `La imagen no puede superar ${DIMENSIONES.maxAncho}×${DIMENSIONES.maxAlto}px.`
    );
    err.estado = 400;
    throw err;
  }

  return { bufferWebp, info };
}

/* ============================================================
   SUBIR IMAGEN DE COLOR (boxphoto | customrose | rosephoto)
   ============================================================ */
export async function subirImagen({
  buffer,
  nombreOriginal,
  tipo,
  colorId,
  colorSlug,
  subidoPor,
}) {
  const pool = obtenerPool();
  const { bufferWebp, info } = await procesarImagen(buffer);

  const hash = hashSha256(bufferWebp);
  const uuidArchivo = crypto.randomUUID();
  const fecha = fechaHoy();
  const extension = "webp";

  const rutaRel = rutaRelativa(tipo, colorSlug, fecha, uuidArchivo, extension);
  const rutaAbs = rutaAbsoluta(tipo, colorSlug, fecha, uuidArchivo, extension);
  const slotId = construirSlotId(tipo, colorSlug);

  await asegurarCarpeta(path.dirname(rutaAbs));
  await fs.writeFile(rutaAbs, bufferWebp);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE biblioteca_imagenes
       SET activo = FALSE, actualizado_en = NOW()
       WHERE slot_id = $1 AND activo = TRUE`,
      [slotId]
    );

    const { rows: versionRows } = await client.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS siguiente
       FROM biblioteca_imagenes WHERE slot_id = $1`,
      [slotId]
    );
    const version = versionRows[0].siguiente;

    const { rows } = await client.query(
      `INSERT INTO biblioteca_imagenes
         (tipo, color_id, slot_id, ruta_relativa, uuid_archivo,
          nombre_original, mime_type, extension, ancho, alto,
          tamano_bytes, hash_sha256, version, subido_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        tipo, colorId, slotId, rutaRel, uuidArchivo,
        nombreOriginal, "image/webp", extension, info.width, info.height,
        bufferWebp.length, hash, version, subidoPor,
      ]
    );

    await client.query("COMMIT");
    return rows[0];
  } catch (e) {
    await client.query("ROLLBACK");
    try { await fs.unlink(rutaAbs); } catch { /* noop */ }
    throw e;
  } finally {
    client.release();
  }
}

/* ============================================================
   SUBIR IMAGEN DE FRASE (frasephoto)
   → Requiere fraseId + colorId
   → slot_id = sr-frasephoto-{fraseSlug}-{colorSlug}
   → ruta = rosas/frasephoto/{categoriaSlug}/{fraseSlug}/{colorSlug}/{fecha}/{uuid}.webp
   ============================================================ */
export async function subirImagenFrase({
  buffer,
  nombreOriginal,
  fraseId,
  fraseSlug,
  categoriaSlug,
  colorId,
  colorSlug,
  subidoPor,
}) {
  const pool = obtenerPool();
  const { bufferWebp, info } = await procesarImagen(buffer);

  const hash = hashSha256(bufferWebp);
  const uuidArchivo = crypto.randomUUID();
  const fecha = fechaHoy();
  const extension = "webp";

  const rutaRel = path
    .join(
      "rosas", "frasephoto",
      categoriaSlug, fraseSlug, colorSlug,
      fecha, `${uuidArchivo}.${extension}`
    )
    .replace(/\\/g, "/");

  const rutaAbs = path.join(
    ROSAS_RAIZ, "frasephoto",
    categoriaSlug, fraseSlug, colorSlug,
    fecha, `${uuidArchivo}.${extension}`
  );

  const slotId = `sr-frasephoto-${fraseSlug}-${colorSlug}`;

  await asegurarCarpeta(path.dirname(rutaAbs));
  await fs.writeFile(rutaAbs, bufferWebp);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE biblioteca_imagenes
       SET activo = FALSE, actualizado_en = NOW()
       WHERE slot_id = $1 AND activo = TRUE`,
      [slotId]
    );

    const { rows: versionRows } = await client.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS siguiente
       FROM biblioteca_imagenes WHERE slot_id = $1`,
      [slotId]
    );
    const version = versionRows[0].siguiente;

    const { rows } = await client.query(
      `INSERT INTO biblioteca_imagenes
         (tipo, color_id, frase_id, slot_id, ruta_relativa, uuid_archivo,
          nombre_original, mime_type, extension, ancho, alto,
          tamano_bytes, hash_sha256, version, subido_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        "frasephoto", colorId, fraseId, slotId, rutaRel, uuidArchivo,
        nombreOriginal, "image/webp", extension, info.width, info.height,
        bufferWebp.length, hash, version, subidoPor,
      ]
    );

    await client.query("COMMIT");
    return rows[0];
  } catch (e) {
    await client.query("ROLLBACK");
    try { await fs.unlink(rutaAbs); } catch { /* noop */ }
    throw e;
  } finally {
    client.release();
  }
}

/* ============================================================
   LISTAR SLOTS (colores + sus imágenes)
   ============================================================ */
export async function listarSlots() {
  const pool = obtenerPool();
  const { rows } = await pool.query(`
    SELECT c.id AS color_id, c.codigo, c.nombre, c.slug AS color_slug,
           c.hex, c.edge, c.ink, c.orden,
           bi.tipo, bi.slot_id, bi.uuid_archivo, bi.nombre_original,
           bi.ancho, bi.alto, bi.tamano_bytes, bi.version, bi.actualizado_en
    FROM catalogo_colores c
    LEFT JOIN biblioteca_imagenes bi
      ON bi.color_id = c.id AND bi.activo = TRUE AND bi.tipo != 'frasephoto'
    WHERE c.activo = TRUE
    ORDER BY c.orden, bi.tipo
  `);

  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.color_id)) {
      map.set(row.color_id, {
        color_id: row.color_id, codigo: row.codigo, nombre: row.nombre,
        slug: row.color_slug, hex: row.hex, edge: row.edge, ink: row.ink,
        orden: row.orden,
        imagenes: { boxphoto: null, customrose: null, rosephoto: null },
      });
    }
    if (row.tipo) {
      map.get(row.color_id).imagenes[row.tipo] = {
        slot_id: row.slot_id,
        uuid_archivo: row.uuid_archivo,
        nombre_original: row.nombre_original,
        ancho: row.ancho, alto: row.alto,
        tamano_bytes: row.tamano_bytes,
        version: row.version,
        actualizado_en: row.actualizado_en,
      };
    }
  }
  return Array.from(map.values());
}

/* ============================================================
   DESACTIVAR IMAGEN
   ============================================================ */
export async function desactivarImagen(slotId) {
  const pool = obtenerPool();
  const { rowCount } = await pool.query(
    `UPDATE biblioteca_imagenes
     SET activo = FALSE, actualizado_en = NOW()
     WHERE slot_id = $1 AND activo = TRUE`,
    [slotId]
  );
  return rowCount > 0;
}

/* ============================================================
   COLORS: crear / editar / desactivar
   ============================================================ */
export async function crearColor({ codigo, nombre, slug, hex, edge, ink, orden }) {
  const pool = obtenerPool();
  const { rows } = await pool.query(
    `INSERT INTO catalogo_colores (codigo, nombre, slug, hex, edge, ink, orden)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [codigo, nombre, slug, hex, edge, ink, orden ?? 0]
  );
  return rows[0];
}

export async function editarColor(id, cambios) {
  const pool = obtenerPool();
  const permitidos = ["codigo", "nombre", "slug", "hex", "edge", "ink", "orden"];
  const campos = [], valores = [];
  let i = 1;
  for (const k of permitidos) {
    if (cambios[k] !== undefined) {
      campos.push(`${k} = $${i}`);
      valores.push(cambios[k]);
      i++;
    }
  }
  if (!campos.length) return null;
  valores.push(id);
  const { rows } = await pool.query(
    `UPDATE catalogo_colores SET ${campos.join(", ")}, actualizado_en = NOW()
     WHERE id = $${i} RETURNING *`,
    valores
  );
  return rows[0] || null;
}

export async function desactivarColor(id) {
  const pool = obtenerPool();
  const { rowCount } = await pool.query(
    `UPDATE catalogo_colores SET activo = FALSE, actualizado_en = NOW() WHERE id = $1`,
    [id]
  );
  return rowCount > 0;
}

/* ============================================================
   CATEGORÍAS + FRASES + IMÁGENES POR COLOR
   ============================================================ */
export async function listarCategoriasConFrases() {
  const pool = obtenerPool();

  // 1. Categorías
  const { rows: categorias } = await pool.query(`
    SELECT id, nombre_es, nombre_en, slug, orden, activo
    FROM catalogo_categorias
    WHERE activo = TRUE
    ORDER BY orden, nombre_es
  `);

  // 2. Colores activos (para que el frontend sepa qué tabs mostrar)
  const { rows: colores } = await pool.query(`
    SELECT id, codigo, nombre, slug, hex, edge, ink, orden
    FROM catalogo_colores
    WHERE activo = TRUE
    ORDER BY orden
  `);

  // 3. Frases
  const { rows: frases } = await pool.query(`
    SELECT id, categoria_id, texto, slug, orden, activo
    FROM catalogo_frases
    WHERE activo = TRUE
    ORDER BY orden, texto
  `);

  // 4. Imágenes activas de tipo frasephoto, agrupadas por frase
  const { rows: imagenes } = await pool.query(`
    SELECT
      bi.frase_id,
      bi.color_id,
      bi.uuid_archivo,
      bi.version,
      bi.actualizado_en,
      co.codigo AS color_codigo,
      co.slug   AS color_slug
    FROM biblioteca_imagenes bi
    INNER JOIN catalogo_colores co ON co.id = bi.color_id
    WHERE bi.tipo = 'frasephoto' AND bi.activo = TRUE
  `);

  // Agrupar imágenes por frase_id
  const imagenesPorFrase = new Map();
  for (const img of imagenes) {
    if (!imagenesPorFrase.has(img.frase_id)) imagenesPorFrase.set(img.frase_id, []);
    imagenesPorFrase.get(img.frase_id).push({
      color_id: img.color_id,
      color_codigo: img.color_codigo,
      color_slug: img.color_slug,
      uuid_archivo: img.uuid_archivo,
      version: img.version,
      actualizado_en: img.actualizado_en,
    });
  }

  // Devolver categorías con sus frases, y cada frase con sus imágenes
  return categorias.map((c) => ({
    ...c,
    frases: frases
      .filter((f) => f.categoria_id === c.id)
      .map((f) => ({
        ...f,
        imagenes: imagenesPorFrase.get(f.id) || [],
      })),
  })).map((c) => ({ ...c, colores }));
}

/* ============================================================
   Categorías CRUD
   ============================================================ */
export async function crearCategoria({ nombre_es, nombre_en, slug, orden }) {
  const pool = obtenerPool();
  const { rows } = await pool.query(
    `INSERT INTO catalogo_categorias (nombre_es, nombre_en, slug, orden)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [nombre_es, nombre_en, slug, orden ?? 0]
  );
  return rows[0];
}

export async function editarCategoria(id, cambios) {
  const pool = obtenerPool();
  const permitidos = ["nombre_es", "nombre_en", "slug", "orden"];
  const campos = [], valores = [];
  let i = 1;
  for (const k of permitidos) {
    if (cambios[k] !== undefined) {
      campos.push(`${k} = $${i}`);
      valores.push(cambios[k]);
      i++;
    }
  }
  if (!campos.length) return null;
  valores.push(id);
  const { rows } = await pool.query(
    `UPDATE catalogo_categorias SET ${campos.join(", ")}, actualizado_en = NOW()
     WHERE id = $${i} RETURNING *`,
    valores
  );
  return rows[0] || null;
}

export async function desactivarCategoria(id) {
  const pool = obtenerPool();
  const { rowCount } = await pool.query(
    `UPDATE catalogo_categorias SET activo = FALSE, actualizado_en = NOW() WHERE id = $1`,
    [id]
  );
  return rowCount > 0;
}

/* ============================================================
   Frases CRUD
   ============================================================ */
export async function crearFrase({ categoria_id, texto, slug, orden }) {
  const pool = obtenerPool();
  const { rows } = await pool.query(
    `INSERT INTO catalogo_frases (categoria_id, texto, slug, orden)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [categoria_id, texto, slug, orden ?? 0]
  );
  return rows[0];
}

export async function editarFrase(id, cambios) {
  const pool = obtenerPool();
  const permitidos = ["texto", "slug", "orden", "categoria_id"];
  const campos = [], valores = [];
  let i = 1;
  for (const k of permitidos) {
    if (cambios[k] !== undefined) {
      campos.push(`${k} = $${i}`);
      valores.push(cambios[k]);
      i++;
    }
  }
  if (!campos.length) return null;
  valores.push(id);
  const { rows } = await pool.query(
    `UPDATE catalogo_frases SET ${campos.join(", ")}, actualizado_en = NOW()
     WHERE id = $${i} RETURNING *`,
    valores
  );
  return rows[0] || null;
}

export async function desactivarFrase(id) {
  const pool = obtenerPool();
  const { rowCount } = await pool.query(
    `UPDATE catalogo_frases SET activo = FALSE, actualizado_en = NOW() WHERE id = $1`,
    [id]
  );
  return rowCount > 0;
}

/* ============================================================
   Slug helper
   ============================================================ */
export function slugify(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 150);
}

/* ============================================================
   PRINT AREAS
   ============================================================ */
export async function guardarPrintArea(colorId, { x, y, w, h }) {
  const pool = obtenerPool();
  const { rows } = await pool.query(
    `INSERT INTO print_areas (color_id, x, y, w, h)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (color_id)
     DO UPDATE SET x=EXCLUDED.x, y=EXCLUDED.y, w=EXCLUDED.w, h=EXCLUDED.h,
                   actualizado_en = NOW()
     RETURNING *`,
    [colorId, x, y, w, h]
  );
  return rows[0];
}

export async function listarPrintAreas() {
  const pool = obtenerPool();
  const { rows } = await pool.query(`
    SELECT c.codigo, c.slug AS color_slug, pa.x, pa.y, pa.w, pa.h
    FROM print_areas pa
    INNER JOIN catalogo_colores c ON c.id = pa.color_id
    WHERE c.activo = TRUE
  `);
  const mapa = {};
  for (const r of rows) {
    mapa[r.color_slug] = {
      x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h),
    };
  }
  return mapa;
}

export async function obtenerImagenPorUuid(uuidArchivo) {
  const pool = obtenerPool();
  const { rows } = await pool.query(
    `SELECT id, tipo, color_id, frase_id, ruta_relativa, uuid_archivo,
            extension, mime_type, activo
     FROM biblioteca_imagenes
     WHERE uuid_archivo = $1 LIMIT 1`,
    [uuidArchivo]
  );
  return rows[0] || null;
}