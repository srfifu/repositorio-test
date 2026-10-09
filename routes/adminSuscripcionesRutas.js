// backend/routes/adminSuscripcionesRutas.js
import { Router } from "express";
import { requerirAutenticacion } from "imansi-auth-node";
import { obtenerPool } from "../config/conexion.js";
import {
  listarSuscripcionesAdmin,
  obtenerSuscripcionAdmin,
  cambiarEstadoSuscripcionAdmin,
  saltarEnvioAdmin,
  listarVendedoresParaFiltro,
} from "../services/adminSuscripcionesServicio.js";

const router = Router();

/* ============================================================
   Middleware: solo admin
   Intenta desde el token, si no, consulta la BD.
   ============================================================ */
async function requerirAdmin(req, res, next) {
  try {
    const roles = req.usuario?.roles || req.usuario?.rol || [];
    const arr = Array.isArray(roles) ? roles : [roles];
    const esAdminToken = arr.some((r) => {
      const nombre = typeof r === "string" ? r : r?.nombre;
      return nombre === "admin";
    });

    if (esAdminToken) return next();

    const usuarioId = req.usuario?.id || req.usuario?.usuarioId || req.usuario?.sub;
    if (!usuarioId) {
      console.warn("[requerirAdmin suscripciones] No hay usuario en el token:", req.usuario);
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
      console.warn(`[requerirAdmin suscripciones] Usuario ${usuarioId} no es admin.`);
      return res.status(403).json({ mensaje: "Se requiere rol administrador." });
    }

    next();
  } catch (e) {
    console.error("Error en requerirAdmin:", e);
    res.status(500).json({ mensaje: "Error verificando permisos." });
  }
}

/* ============================================================
   GET /api/admin/suscripciones
   ============================================================ */
router.get("/suscripciones", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const {
      buscar = null,
      estado = null,
      vendedorId = null,
      desde = null,
      hasta = null,
      proximas = null,
      limite = 100,
      offset = 0,
    } = req.query;

    const resultado = await listarSuscripcionesAdmin({
      buscar: buscar || null,
      estado: estado || null,
      vendedorId: vendedorId || null,
      desde: desde || null,
      hasta: hasta || null,
      proximas: proximas != null ? Number(proximas) : null,
      limite: Math.min(Number(limite) || 100, 500),
      offset: Math.max(Number(offset) || 0, 0),
    });

    res.json(resultado);
  } catch (e) { next(e); }
});

/* ============================================================
   GET /api/admin/suscripciones/vendedores
   ⚠️ ANTES que /suscripciones/:id
   ============================================================ */
router.get("/suscripciones/vendedores", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const vendedores = await listarVendedoresParaFiltro();
    res.json({ vendedores });
  } catch (e) { next(e); }
});

/* ============================================================
   GET /api/admin/suscripciones/:id
   ============================================================ */
router.get("/suscripciones/:id", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const data = await obtenerSuscripcionAdmin(req.params.id);
    if (!data) return res.status(404).json({ mensaje: "Suscripción no encontrada." });
    res.json(data);
  } catch (e) { next(e); }
});

/* ============================================================
   POST /api/admin/suscripciones/:id/pausar
   ============================================================ */
router.post("/suscripciones/:id/pausar", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const actualizada = await cambiarEstadoSuscripcionAdmin(req.params.id, "paused");
    if (!actualizada) return res.status(404).json({ mensaje: "Suscripción no encontrada." });
    res.json({ ok: true, suscripcion: actualizada });
  } catch (e) { next(e); }
});

/* ============================================================
   POST /api/admin/suscripciones/:id/reactivar
   ============================================================ */
router.post("/suscripciones/:id/reactivar", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const actualizada = await cambiarEstadoSuscripcionAdmin(req.params.id, "active");
    if (!actualizada) return res.status(404).json({ mensaje: "Suscripción no encontrada." });
    res.json({ ok: true, suscripcion: actualizada });
  } catch (e) { next(e); }
});

/* ============================================================
   POST /api/admin/suscripciones/:id/cancelar
   ============================================================ */
router.post("/suscripciones/:id/cancelar", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const actualizada = await cambiarEstadoSuscripcionAdmin(req.params.id, "cancelled");
    if (!actualizada) return res.status(404).json({ mensaje: "Suscripción no encontrada." });
    res.json({ ok: true, suscripcion: actualizada });
  } catch (e) { next(e); }
});

/* ============================================================
   POST /api/admin/suscripciones/:id/saltar-envio
   ============================================================ */
router.post("/suscripciones/:id/saltar-envio", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const actualizada = await saltarEnvioAdmin(req.params.id);
    if (!actualizada) return res.status(404).json({ mensaje: "Suscripción no encontrada." });
    res.json({ ok: true, suscripcion: actualizada });
  } catch (e) { next(e); }
});

export default router;