// backend/routes/facturasRutas.js
import { Router } from "express";
import { requerirAutenticacion } from "imansi-auth-node";
import { obtenerPool } from "../config/conexion.js";
import {
  listarFacturasAdmin,
  obtenerFacturaAdmin,
  listarMisFacturas,
  obtenerMiFactura,
  marcarFacturaReenviada,
} from "../services/facturasServicio.js";

const router = Router();

/* ============================================================
   Middleware: solo admin
   Intenta desde el token, si no, consulta la BD.
   ============================================================ */
async function requerirAdmin(req, res, next) {
  try {
    // 1. Intentar detectar desde el token
    const roles = req.usuario?.roles || req.usuario?.rol || [];
    const arr = Array.isArray(roles) ? roles : [roles];
    const esAdminToken = arr.some((r) => {
      const nombre = typeof r === "string" ? r : r?.nombre;
      return nombre === "admin";
    });

    if (esAdminToken) return next();

    // 2. Fallback: consultar la BD
    const usuarioId = req.usuario?.id || req.usuario?.usuarioId || req.usuario?.sub;
    if (!usuarioId) {
      console.warn("[requerirAdmin facturas] No hay usuario en el token:", req.usuario);
      return res.status(403).json({ mensaje: "No autorizado." });
    }

    const pool = obtenerPool();
    const { rows } = await pool.query(
      `SELECT 1
       FROM usuarios_roles ur
       JOIN roles r ON r.id = ur.rol_id
       WHERE ur.usuario_id = $1 AND r.nombre = 'admin'
       LIMIT 1`,
      [usuarioId]
    );

    if (!rows[0]) {
      console.warn(`[requerirAdmin facturas] Usuario ${usuarioId} no es admin.`);
      return res.status(403).json({ mensaje: "Se requiere rol administrador." });
    }

    next();
  } catch (e) {
    console.error("Error en requerirAdmin:", e);
    res.status(500).json({ mensaje: "Error verificando permisos." });
  }
}

/* ============================================================
   RUTAS CLIENTE — /api/mis-facturas/*
   ============================================================ */

/* GET /api/mis-facturas */
router.get("/mis-facturas", requerirAutenticacion(), async (req, res, next) => {
  try {
    const {
      buscar = null,
      estado = null,
      programa = null,
      desde = null,
      hasta = null,
      limite = 100,
      offset = 0,
    } = req.query;

    const resultado = await listarMisFacturas(req.usuario.id, {
      buscar: buscar || null,
      estado: estado || null,
      programa: programa || null,
      desde: desde || null,
      hasta: hasta || null,
      limite: Math.min(Number(limite) || 100, 500),
      offset: Math.max(Number(offset) || 0, 0),
    });

    res.json(resultado);
  } catch (e) { next(e); }
});

/* GET /api/mis-facturas/:id */
router.get("/mis-facturas/:id", requerirAutenticacion(), async (req, res, next) => {
  try {
    const data = await obtenerMiFactura(req.usuario.id, req.params.id);
    if (!data) return res.status(404).json({ mensaje: "Factura no encontrada." });
    res.json(data);
  } catch (e) { next(e); }
});

/* ============================================================
   RUTAS ADMIN — /api/admin/facturas/*
   ============================================================ */

/* GET /api/admin/facturas */
router.get("/admin/facturas", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const {
      buscar = null,
      estado = null,
      programa = null,
      desde = null,
      hasta = null,
      limite = 100,
      offset = 0,
    } = req.query;

    const resultado = await listarFacturasAdmin({
      buscar: buscar || null,
      estado: estado || null,
      programa: programa || null,
      desde: desde || null,
      hasta: hasta || null,
      limite: Math.min(Number(limite) || 100, 500),
      offset: Math.max(Number(offset) || 0, 0),
    });

    res.json(resultado);
  } catch (e) { next(e); }
});

/* GET /api/admin/facturas/:id */
router.get("/admin/facturas/:id", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const data = await obtenerFacturaAdmin(req.params.id);
    if (!data) return res.status(404).json({ mensaje: "Factura no encontrada." });
    res.json(data);
  } catch (e) { next(e); }
});

/* POST /api/admin/facturas/:id/reenviar */
router.post("/admin/facturas/:id/reenviar", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const data = await obtenerFacturaAdmin(req.params.id);
    if (!data) return res.status(404).json({ mensaje: "Factura no encontrada." });

    // TODO: integración real con QuickBooks para reenviar
    await marcarFacturaReenviada(req.params.id);

    res.json({
      ok: true,
      mensaje: "Factura reenviada. QuickBooks la enviará por email.",
    });
  } catch (e) { next(e); }
});

export default router;