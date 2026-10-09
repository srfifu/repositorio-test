// backend/routes/vendedorDashboardRutas.js
import { Router } from "express";
import { requerirAutenticacion } from "imansi-auth-node";
import { obtenerPool } from "../config/conexion.js";
import {
  obtenerKpisVendedor,
  obtenerVentasPorDia,
  obtenerTopClientes,
  obtenerTopFrases,
  obtenerDistribucionPrograma,
  obtenerEstadoPedidos,
  obtenerResumenVendedor,
} from "../services/vendedorDashboardServicio.js";

const router = Router();

/* ============================================================
   Middleware: solo vendedor
   Intenta desde el token, si no, consulta la BD.
   ============================================================ */
async function requerirVendedor(req, res, next) {
  try {
    const roles = req.usuario?.roles || req.usuario?.rol || [];
    const arr = Array.isArray(roles) ? roles : [roles];
    const esVendedorToken = arr.some((r) => {
      const nombre = typeof r === "string" ? r : r?.nombre;
      return nombre === "vendedor";
    });

    if (esVendedorToken) return next();

    const usuarioId = req.usuario?.id || req.usuario?.usuarioId || req.usuario?.sub;
    if (!usuarioId) {
      return res.status(403).json({ mensaje: "No autorizado." });
    }

    const pool = obtenerPool();
    const { rows } = await pool.query(
      `SELECT 1
       FROM usuarios_roles ur
       JOIN roles r ON r.id = ur.rol_id
       WHERE ur.usuario_id = $1 AND r.nombre = 'vendedor'
       LIMIT 1`,
      [usuarioId]
    );

    if (!rows[0]) {
      return res.status(403).json({ mensaje: "Se requiere rol vendedor." });
    }

    next();
  } catch (e) {
    console.error("Error en requerirVendedor:", e);
    res.status(500).json({ mensaje: "Error verificando permisos." });
  }
}

/* Helper: extraer params comunes */
function extraerParams(req) {
  const {
    periodo = "30d",
    desde = null,
    hasta = null,
    limite = 5,
  } = req.query;
  return {
    periodo,
    desde: desde || null,
    hasta: hasta || null,
    limite: Number(limite) || 5,
  };
}

/* ============================================================
   GET /api/vendedor/dashboard/resumen
   ⭐ Endpoint principal — devuelve TODO en 1 request
   ============================================================ */
router.get("/dashboard/resumen", requerirAutenticacion(), requerirVendedor, async (req, res, next) => {
  try {
    const { periodo, desde, hasta } = extraerParams(req);
    const data = await obtenerResumenVendedor(req.usuario.id, periodo, desde, hasta);
    res.json(data);
  } catch (e) { next(e); }
});

/* ============================================================
   GET /api/vendedor/dashboard/kpis
   ============================================================ */
router.get("/dashboard/kpis", requerirAutenticacion(), requerirVendedor, async (req, res, next) => {
  try {
    const { periodo, desde, hasta } = extraerParams(req);
    const kpis = await obtenerKpisVendedor(req.usuario.id, periodo, desde, hasta);
    res.json({ kpis });
  } catch (e) { next(e); }
});

/* ============================================================
   GET /api/vendedor/dashboard/ventas-por-dia
   ============================================================ */
router.get("/dashboard/ventas-por-dia", requerirAutenticacion(), requerirVendedor, async (req, res, next) => {
  try {
    const { periodo, desde, hasta } = extraerParams(req);
    const data = await obtenerVentasPorDia(req.usuario.id, periodo, desde, hasta);
    res.json(data);
  } catch (e) { next(e); }
});

/* ============================================================
   GET /api/vendedor/dashboard/top-clientes
   ============================================================ */
router.get("/dashboard/top-clientes", requerirAutenticacion(), requerirVendedor, async (req, res, next) => {
  try {
    const { periodo, desde, hasta, limite } = extraerParams(req);
    const data = await obtenerTopClientes(req.usuario.id, periodo, limite, desde, hasta);
    res.json(data);
  } catch (e) { next(e); }
});

/* ============================================================
   GET /api/vendedor/dashboard/top-frases
   ============================================================ */
router.get("/dashboard/top-frases", requerirAutenticacion(), requerirVendedor, async (req, res, next) => {
  try {
    const { periodo, desde, hasta, limite } = extraerParams(req);
    const data = await obtenerTopFrases(req.usuario.id, periodo, limite, desde, hasta);
    res.json(data);
  } catch (e) { next(e); }
});

/* ============================================================
   GET /api/vendedor/dashboard/distribucion-programa
   ============================================================ */
router.get("/dashboard/distribucion-programa", requerirAutenticacion(), requerirVendedor, async (req, res, next) => {
  try {
    const { periodo, desde, hasta } = extraerParams(req);
    const data = await obtenerDistribucionPrograma(req.usuario.id, periodo, desde, hasta);
    res.json({ distribucion: data });
  } catch (e) { next(e); }
});

/* ============================================================
   GET /api/vendedor/dashboard/estado-pedidos
   ============================================================ */
router.get("/dashboard/estado-pedidos", requerirAutenticacion(), requerirVendedor, async (req, res, next) => {
  try {
    const { periodo, desde, hasta } = extraerParams(req);
    const data = await obtenerEstadoPedidos(req.usuario.id, periodo, desde, hasta);
    res.json({ estados: data });
  } catch (e) { next(e); }
});

export default router;