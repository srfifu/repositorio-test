// backend/routes/adminActividadRutas.js
import { Router } from "express";
import { requerirAutenticacion } from "imansi-auth-node";
import { obtenerPool } from "../config/conexion.js";
import { listarActividad, kpisActividad } from "../services/adminActividadServicio.js";

const router = Router();

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
      return res.status(403).json({ mensaje: "No autorizado." });
    }

    const pool = obtenerPool();
    const { rows } = await pool.query(
      `SELECT 1 FROM usuarios_roles ur
       JOIN roles r ON r.id = ur.rol_id
       WHERE ur.usuario_id = $1 AND r.nombre = 'admin' LIMIT 1`,
      [usuarioId]
    );
    if (!rows[0]) {
      return res.status(403).json({ mensaje: "Se requiere rol administrador." });
    }
    next();
  } catch (e) {
    console.error("Error en requerirAdmin (actividad):", e);
    res.status(500).json({ mensaje: "Error verificando permisos." });
  }
}

router.get("/actividad", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const {
      tipo = "all",
      desde = null,
      hasta = null,
      q = "",
      pagina = 1,
      porPagina = 25,
    } = req.query;

    const data = await listarActividad({
      tipo,
      desde: desde || null,
      hasta: hasta || null,
      q,
      pagina: Number(pagina) || 1,
      porPagina: Math.min(Number(porPagina) || 25, 100),
    });

    res.json(data);
  } catch (e) { next(e); }
});

router.get("/actividad/kpis", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const { desde = null, hasta = null } = req.query;
    const data = await kpisActividad({ desde: desde || null, hasta: hasta || null });
    res.json(data);
  } catch (e) { next(e); }
});

export default router;