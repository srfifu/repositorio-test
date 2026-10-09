// backend/routes/vendedorPedidosRutas.js
import { Router } from "express";
import { requerirAutenticacion } from "imansi-auth-node";
import { obtenerPool } from "../config/conexion.js";
import {
  listarPedidosVendedor,
  kpisPedidosVendedor,
  obtenerPedidoVendedor,
  listarSuscripcionesVendedor,
  kpisSuscripcionesVendedor,
  obtenerSuscripcionVendedor,
} from "../services/vendedorPedidosServicio.js";

const router = Router();

/* ============================================================
   Middleware: solo vendedor
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

/* ============================================================
   PEDIDOS
   ============================================================ */

/* GET /api/vendedor/pedidos/kpis */
router.get("/pedidos/kpis", requerirAutenticacion(), requerirVendedor, async (req, res, next) => {
  try {
    const kpis = await kpisPedidosVendedor(req.usuario.id);
    res.json({ kpis });
  } catch (e) { next(e); }
});

/* GET /api/vendedor/pedidos */
router.get("/pedidos", requerirAutenticacion(), requerirVendedor, async (req, res, next) => {
  try {
    const {
      buscar = null,
      estado = null,
      programa = null,
      clienteId = null,
      desde = null,
      hasta = null,
      limite = 100,
      offset = 0,
    } = req.query;

    const pedidos = await listarPedidosVendedor(req.usuario.id, {
      buscar: buscar || null,
      estado: estado || null,
      programa: programa || null,
      clienteId: clienteId || null,
      desde: desde || null,
      hasta: hasta || null,
      limite: Math.min(Number(limite) || 100, 500),
      offset: Math.max(Number(offset) || 0, 0),
    });

    res.json({ pedidos });
  } catch (e) { next(e); }
});

/* GET /api/vendedor/pedidos/:id */
router.get("/pedidos/:id", requerirAutenticacion(), requerirVendedor, async (req, res, next) => {
  try {
    const data = await obtenerPedidoVendedor(req.usuario.id, req.params.id);
    if (!data) return res.status(404).json({ mensaje: "Pedido no encontrado." });
    res.json(data);
  } catch (e) { next(e); }
});

/* ============================================================
   SUSCRIPCIONES
   ============================================================ */

/* GET /api/vendedor/suscripciones/kpis */
router.get("/suscripciones/kpis", requerirAutenticacion(), requerirVendedor, async (req, res, next) => {
  try {
    const kpis = await kpisSuscripcionesVendedor(req.usuario.id);
    res.json({ kpis });
  } catch (e) { next(e); }
});

/* GET /api/vendedor/suscripciones */
router.get("/suscripciones", requerirAutenticacion(), requerirVendedor, async (req, res, next) => {
  try {
    const {
      buscar = null,
      estado = null,
      clienteId = null,
      desde = null,
      hasta = null,
      proximas = null,
      limite = 100,
      offset = 0,
    } = req.query;

    const suscripciones = await listarSuscripcionesVendedor(req.usuario.id, {
      buscar: buscar || null,
      estado: estado || null,
      clienteId: clienteId || null,
      desde: desde || null,
      hasta: hasta || null,
      proximas: proximas != null ? Number(proximas) : null,
      limite: Math.min(Number(limite) || 100, 500),
      offset: Math.max(Number(offset) || 0, 0),
    });

    res.json({ suscripciones });
  } catch (e) { next(e); }
});

/* GET /api/vendedor/suscripciones/:id */
router.get("/suscripciones/:id", requerirAutenticacion(), requerirVendedor, async (req, res, next) => {
  try {
    const data = await obtenerSuscripcionVendedor(req.usuario.id, req.params.id);
    if (!data) return res.status(404).json({ mensaje: "Suscripción no encontrada." });
    res.json(data);
  } catch (e) { next(e); }
});

export default router;