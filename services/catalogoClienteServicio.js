// backend/services/catalogoClienteServicio.js
import { obtenerPool } from "../config/conexion.js";

/* ====================================================================
   CATÁLOGO COMPLETO PARA EL CLIENTE
   ====================================================================
   Devuelve en 1 sola llamada:
   - Colores con URLs ABSOLUTAS de imágenes (boxphoto, customrose, rosephoto)
   - Categorías con frases + URLs de imágenes (frasephoto por color)
   - Print areas por color
   - Precios efectivos del cliente (según vendedor o global)
   ==================================================================== */

const URL_BACKEND = process.env.URL_BACKEND || "http://localhost:3000";

function urlAbsoluta(ruta) {
  if (!ruta) return null;
  if (ruta.startsWith("http")) return ruta;
  return `${URL_BACKEND}${ruta.startsWith("/") ? "" : "/"}${ruta}`;
}

function urlArchivo(uuid) {
  if (!uuid) return null;
  return urlAbsoluta(`/api/library/file/${uuid}`);
}

export async function obtenerCatalogoParaCliente(usuarioId) {
  const pool = obtenerPool();

  // ---------- 1. Colores activos ----------
  const { rows: colores } = await pool.query(`
    SELECT id, codigo, nombre, slug, hex, edge, ink, orden
    FROM catalogo_colores
    WHERE activo = TRUE
    ORDER BY orden, nombre
  `);

  // ---------- 2. Imágenes por color ----------
  const { rows: imagenesColor } = await pool.query(`
    SELECT bi.tipo, bi.color_id, bi.uuid_archivo, bi.version, bi.actualizado_en,
           co.slug AS color_slug
    FROM biblioteca_imagenes bi
    INNER JOIN catalogo_colores co ON co.id = bi.color_id
    WHERE bi.activo = TRUE
      AND bi.tipo IN ('boxphoto', 'customrose', 'rosephoto')
    ORDER BY bi.tipo
  `);

  // ---------- 3. Print areas ----------
  const { rows: printAreas } = await pool.query(`
    SELECT co.slug AS color_slug, pa.x, pa.y, pa.w, pa.h
    FROM print_areas pa
    INNER JOIN catalogo_colores co ON co.id = pa.color_id
    WHERE co.activo = TRUE
  `);

  // ---------- 4. Categorías ----------
  const { rows: categorias } = await pool.query(`
    SELECT id, nombre_es, nombre_en, slug, orden
    FROM catalogo_categorias
    WHERE activo = TRUE
    ORDER BY orden, nombre_es
  `);

  // ---------- 5. Frases con imágenes frasephoto ----------
  const { rows: frases } = await pool.query(`
    SELECT
      f.id, f.categoria_id, f.texto, f.slug, f.orden,
      bi.uuid_archivo AS imagen_uuid,
      bi.color_id     AS imagen_color_id,
      co.slug         AS imagen_color_slug,
      co.codigo       AS imagen_color_codigo
    FROM catalogo_frases f
    LEFT JOIN biblioteca_imagenes bi
      ON bi.frase_id = f.id AND bi.activo = TRUE AND bi.tipo = 'frasephoto'
    LEFT JOIN catalogo_colores co ON co.id = bi.color_id
    WHERE f.activo = TRUE
    ORDER BY f.orden, f.texto
  `);

  // ---------- 6. Precio del cliente ----------
  // ✅ Usa la función SQL que respeta al vendedor referente del cliente.
  const { rows: precioRows } = await pool.query(
    `SELECT * FROM obtener_precio_para_usuario($1)`,
    [usuarioId]
  );
  const precioRaw = precioRows[0] || null;

  // ✅ Normalizar al formato que espera el frontend
  const precio = precioRaw ? {
    autoship: Number(precioRaw.autoship_precio_por_rosa),
    onetime: Number(precioRaw.onetime_precio_por_rosa),
    texto: Number(precioRaw.personalizacion_texto_precio),
    foto: Number(precioRaw.personalizacion_foto_precio),
    tipo: precioRaw.tipo_precio,                    // 'vendedor' | 'global'
    vendedor_id: precioRaw.vendedor_id || null,     // (si la función lo devuelve)
    max_autoship: precioRaw.max_autoship_precio_por_rosa ?? null,
    max_onetime: precioRaw.max_onetime_precio_por_rosa ?? null,
    min_sugerido_autoship: precioRaw.min_sugerido_autoship_precio_por_rosa ?? null,
    min_sugerido_onetime: precioRaw.min_sugerido_onetime_precio_por_rosa ?? null,
  } : null;

  // ---------- 7. Armar estructura de colores ----------
  const colorMap = new Map();
  for (const c of colores) {
    colorMap.set(c.slug, {
      id: c.id,
      codigo: c.codigo,
      nombre: c.nombre,
      slug: c.slug,
      hex: c.hex,
      edge: c.edge,
      ink: c.ink,
      orden: c.orden,
      imagenes: {
        boxphoto: null,
        customrose: null,
        rosephoto: null,
      },
    });
  }

  for (const img of imagenesColor) {
    const color = colorMap.get(img.color_slug);
    if (!color) continue;
    color.imagenes[img.tipo] = {
      uuid: img.uuid_archivo,
      url: urlArchivo(img.uuid_archivo),
      version: img.version,
      actualizado_en: img.actualizado_en,
    };
  }

  // ---------- 8. Print areas como objeto ----------
  const areas = {};
  for (const pa of printAreas) {
    areas[pa.color_slug] = {
      x: Number(pa.x),
      y: Number(pa.y),
      w: Number(pa.w),
      h: Number(pa.h),
    };
  }

  // ---------- 9. Frases agrupadas por categoría ----------
  const frasesPorCategoria = new Map();
  for (const f of frases) {
    if (!frasesPorCategoria.has(f.categoria_id)) {
      frasesPorCategoria.set(f.categoria_id, new Map());
    }
    const mapaFrases = frasesPorCategoria.get(f.categoria_id);
    if (!mapaFrases.has(f.id)) {
      mapaFrases.set(f.id, {
        id: f.id,
        texto: f.texto,
        slug: f.slug,
        orden: f.orden,
        imagenes: [],
      });
    }
    if (f.imagen_uuid && f.imagen_color_slug) {
      mapaFrases.get(f.id).imagenes.push({
        color_id: f.imagen_color_id,
        color_slug: f.imagen_color_slug,
        color_codigo: f.imagen_color_codigo,
        uuid: f.imagen_uuid,
        url: urlArchivo(f.imagen_uuid),
      });
    }
  }

  const categoriasCompletas = categorias.map((c) => ({
    id: c.id,
    slug: c.slug,
    nombre_es: c.nombre_es,
    nombre_en: c.nombre_en,
    orden: c.orden,
    frases: Array.from(frasesPorCategoria.get(c.id)?.values() || []),
  }));

  // ---------- 10. Devolver ----------
  return {
    colores: Array.from(colorMap.values()),
    categorias: categoriasCompletas,
    printAreas: areas,
    precio,   // ✅ ya viene normalizado desde arriba
  };
}

/* ====================================================================
   DEBUG
   ==================================================================== */
export async function debugCatalogo() {
  const pool = obtenerPool();

  const { rows: colores } = await pool.query(`
    SELECT c.id, c.codigo, c.slug,
      (SELECT COUNT(*) FROM biblioteca_imagenes bi
        WHERE bi.color_id = c.id AND bi.activo = TRUE
          AND bi.tipo IN ('boxphoto','customrose','rosephoto')) AS total_imagenes
    FROM catalogo_colores c
    WHERE c.activo = TRUE
    ORDER BY c.orden
  `);

  const { rows: imagenes } = await pool.query(`
    SELECT tipo, COUNT(*) AS total
    FROM biblioteca_imagenes
    WHERE activo = TRUE
    GROUP BY tipo
  `);

  const { rows: frases } = await pool.query(`
    SELECT f.id, f.texto, f.slug,
      (SELECT COUNT(*) FROM biblioteca_imagenes bi
        WHERE bi.frase_id = f.id AND bi.activo = TRUE
          AND bi.tipo = 'frasephoto') AS total_imagenes
    FROM catalogo_frases f
    WHERE f.activo = TRUE
    ORDER BY f.id
  `);

  return {
    colores: colores.map((c) => ({
      codigo: c.codigo,
      slug: c.slug,
      imagenes: Number(c.total_imagenes),
    })),
    imagenesPorTipo: imagenes.map((i) => ({
      tipo: i.tipo,
      total: Number(i.total),
    })),
    frases: frases.map((f) => ({
      texto: f.texto,
      slug: f.slug,
      imagenes: Number(f.total_imagenes),
    })),
  };
}