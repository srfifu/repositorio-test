// backend/services/frasesService.js
import { obtenerPool } from "../config/conexion.js";

// ============================================================
// CATEGORÍAS
// ============================================================

export async function listarCategorias() {
  const pool = obtenerPool();
  const { rows } = await pool.query(`
    SELECT id, nombre_es, nombre_en, slug, orden, activo
    FROM catalogo_categorias
    WHERE activo = TRUE
    ORDER BY orden, nombre_es
  `);
  return rows;
}

export async function listarCategoriasConFrases() {
  const pool = obtenerPool();
  const { rows: categorias } = await pool.query(`
    SELECT id, nombre_es, nombre_en, slug, orden, activo
    FROM catalogo_categorias
    WHERE activo = TRUE
    ORDER BY orden, nombre_es
  `);

  const { rows: frases } = await pool.query(`
    SELECT
      f.id, f.categoria_id, f.texto, f.slug, f.orden, f.activo,
      bi.uuid_archivo AS imagen_uuid,
      bi.version      AS imagen_version
    FROM catalogo_frases f
    LEFT JOIN biblioteca_imagenes bi
      ON bi.frase_id = f.id AND bi.activo = TRUE AND bi.tipo = 'frasephoto'
    WHERE f.activo = TRUE
    ORDER BY f.orden, f.texto
  `);

  return categorias.map((c) => ({
    ...c,
    frases: frases.filter((f) => f.categoria_id === c.id),
  }));
}

export async function crearCategoria({ nombre_es, nombre_en, slug, orden }) {
  const pool = obtenerPool();
  const { rows } = await pool.query(
    `INSERT INTO catalogo_categorias (nombre_es, nombre_en, slug, orden)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [nombre_es, nombre_en, slug, orden ?? 0]
  );
  return rows[0];
}

export async function editarCategoria(id, cambios) {
  const pool = obtenerPool();
  const permitidos = ["nombre_es", "nombre_en", "slug", "orden"];
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
  if (!campos.length) return null;
  valores.push(id);
  const { rows } = await pool.query(
    `UPDATE catalogo_categorias
     SET ${campos.join(", ")}, actualizado_en = NOW()
     WHERE id = $${i}
     RETURNING *`,
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

// ============================================================
// FRASES
// ============================================================

export async function crearFrase({ categoria_id, texto, slug, orden }) {
  const pool = obtenerPool();
  const { rows } = await pool.query(
    `INSERT INTO catalogo_frases (categoria_id, texto, slug, orden)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [categoria_id, texto, slug, orden ?? 0]
  );
  return rows[0];
}

export async function editarFrase(id, cambios) {
  const pool = obtenerPool();
  const permitidos = ["texto", "slug", "orden", "categoria_id"];
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
  if (!campos.length) return null;
  valores.push(id);
  const { rows } = await pool.query(
    `UPDATE catalogo_frases
     SET ${campos.join(", ")}, actualizado_en = NOW()
     WHERE id = $${i}
     RETURNING *`,
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

// ============================================================
// SLUG helper
// ============================================================

export function slugify(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 150);
}