// backend/routes/adminDashboardRutas.js
import { Router } from "express";
import { requerirAutenticacion } from "imansi-auth-node";
import { obtenerPool } from "../config/conexion.js";
import {
  obtenerKpisAdmin,
  obtenerVentasPorDiaAdmin,
  obtenerTopVendedores,
  obtenerTopClientesAdmin,
  obtenerTopFrasesAdmin,
  obtenerDistribucionProgramaAdmin,
  obtenerEstadoPedidosAdmin,
  obtenerSaludSistema,
  obtenerUltimosPedidos,
  obtenerResumenAdmin,
} from "../services/adminDashboardServicio.js";

const router = Router();

/* Middleware: solo admin */
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
    console.error("Error en requerirAdmin (dashboard):", e);
    res.status(500).json({ mensaje: "Error verificando permisos." });
  }
}

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

/* RESUMEN (todo en 1) */
router.get("/dashboard/resumen", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const { periodo, desde, hasta } = extraerParams(req);
    const data = await obtenerResumenAdmin(periodo, desde, hasta);
    res.json(data);
  } catch (e) { next(e); }
});

/* KPIs */
router.get("/dashboard/kpis", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const { periodo, desde, hasta } = extraerParams(req);
    const kpis = await obtenerKpisAdmin(periodo, desde, hasta);
    res.json({ kpis });
  } catch (e) { next(e); }
});

/* Ventas por día */
router.get("/dashboard/ventas-por-dia", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const { periodo, desde, hasta } = extraerParams(req);
    const data = await obtenerVentasPorDiaAdmin(periodo, desde, hasta);
    res.json(data);
  } catch (e) { next(e); }
});

/* Top vendedores */
router.get("/dashboard/top-vendedores", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const { periodo, desde, hasta, limite } = extraerParams(req);
    const data = await obtenerTopVendedores(periodo, limite, desde, hasta);
    res.json(data);
  } catch (e) { next(e); }
});

/* Top clientes */
router.get("/dashboard/top-clientes", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const { periodo, desde, hasta, limite } = extraerParams(req);
    const data = await obtenerTopClientesAdmin(periodo, limite, desde, hasta);
    res.json(data);
  } catch (e) { next(e); }
});

/* Top frases */
router.get("/dashboard/top-frases", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const { periodo, desde, hasta, limite } = extraerParams(req);
    const data = await obtenerTopFrasesAdmin(periodo, limite, desde, hasta);
    res.json(data);
  } catch (e) { next(e); }
});

/* Distribución programa */
router.get("/dashboard/distribucion-programa", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const { periodo, desde, hasta } = extraerParams(req);
    const data = await obtenerDistribucionProgramaAdmin(periodo, desde, hasta);
    res.json({ distribucion: data });
  } catch (e) { next(e); }
});

/* Estado pedidos */
router.get("/dashboard/estado-pedidos", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const { periodo, desde, hasta } = extraerParams(req);
    const data = await obtenerEstadoPedidosAdmin(periodo, desde, hasta);
    res.json({ estados: data });
  } catch (e) { next(e); }
});

/* Salud del sistema */
router.get("/dashboard/salud-sistema", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const data = await obtenerSaludSistema();
    res.json(data);
  } catch (e) { next(e); }
});

/* Últimos pedidos */
router.get("/dashboard/ultimos-pedidos", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const { limite } = extraerParams(req);
    const data = await obtenerUltimosPedidos(limite);
    res.json(data);
  } catch (e) { next(e); }
});

export default router;