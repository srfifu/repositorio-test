// backend/services/disenoClienteServicio.js
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { obtenerPool } from "../config/conexion.js";

/* ============================================================
   DISEÑOS CUSTOM DEL CLIENTE
   ============================================================
   - Guarda el PNG generado en disco
   - Calcula design_sig (firma única)
   - Registra en disenos_pagados cuando se cobra
   ============================================================ */

const DISENOS_RAIZ = path.join(process.cwd(), "uploads", "disenos");

async function asegurarCarpeta(ruta) {
  await fs.mkdir(ruta, { recursive: true });
}

export function calcularFirma(contenido) {
  const json = JSON.stringify(contenido);
  return crypto.createHash("sha256").update(json).digest("hex").slice(0, 32);
}

/**
 * Guarda el PNG base64 en disco y devuelve { uuid, url, firma }.
 */
export async function guardarDiseno({
  base64,
  colorSlug,
  tipo,
  contenido,
  usuarioId,
}) {
  if (!base64 || typeof base64 !== "string") {
    throw Object.assign(new Error("Falta la imagen (base64)."), { estado: 400 });
  }
  if (!["texto", "foto"].includes(tipo)) {
    throw Object.assign(new Error("Tipo inválido."), { estado: 400 });
  }

  const uuid = crypto.randomUUID();
  const fecha = new Date().toISOString().slice(0, 10);
  const nombreArchivo = `${uuid}.png`;
  const rutaRel = path.join("disenos", fecha, nombreArchivo).replace(/\\/g, "/");
  const rutaAbs = path.join(DISENOS_RAIZ, fecha, nombreArchivo);

  await asegurarCarpeta(path.dirname(rutaAbs));

  const base64Limpio = base64.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Limpio, "base64");

  if (buffer.length > 5 * 1024 * 1024) {
    throw Object.assign(new Error("La imagen supera los 5 MB."), { estado: 400 });
  }

  await fs.writeFile(rutaAbs, buffer);

  const firma = calcularFirma({ colorSlug, tipo, contenido });

  return {
    uuid,
    url: `/api/build/diseno/${uuid}`,
    rutaRel,
    firma,
    bytes: buffer.length,
  };
}

/**
 * Registra el diseño como pagado (evita cobrar dos veces).
 */
export async function registrarDisenoPagado({
  usuarioId,
  firma,
  tipo,
  colorCodigo,
  contenido,
  precio,
  pedidoId = null,
}) {
  const pool = obtenerPool();
  const { rows } = await pool.query(
    `INSERT INTO disenos_pagados
       (usuario_id, firma, tipo, color_codigo, contenido, precio, pedido_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (usuario_id, firma) DO NOTHING
     RETURNING *`,
    [usuarioId, firma, tipo, colorCodigo, JSON.stringify(contenido), precio, pedidoId]
  );
  return rows[0] || null;
}

/**
 * Verifica si un cliente ya pagó un diseño con esa firma.
 */
export async function disenoYaPagado(usuarioId, firma) {
  const pool = obtenerPool();
  const { rows } = await pool.query(
    `SELECT id, precio FROM disenos_pagados
     WHERE usuario_id = $1 AND firma = $2
     LIMIT 1`,
    [usuarioId, firma]
  );
  return rows[0] || null;
}

/**
 * Obtiene la ruta absoluta de un diseño por UUID.
 */
export async function obtenerRutaDiseno(uuid) {
  const fecha = new Date().toISOString().slice(0, 10);
  const ruta = path.join(DISENOS_RAIZ, fecha, `${uuid}.png`);
  try {
    await fs.access(ruta);
    return ruta;
  } catch {
    return null;
  }
}