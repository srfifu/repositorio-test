// backend/routes/adminPedidosRutas.js
import { Router } from "express";
import { requerirAutenticacion } from "imansi-auth-node";
import { obtenerPool } from "../config/conexion.js";
import {
  listarPedidosAdmin,
  obtenerPedidoAdmin,
  cambiarEstadoPedido,
  listarVendedoresParaFiltro,
} from "../services/adminPedidosServicio.js";

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
      console.warn("[requerirAdmin] No hay usuario en el token:", req.usuario);
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
      console.warn(`[requerirAdmin] Usuario ${usuarioId} no es admin.`);
      return res.status(403).json({ mensaje: "Se requiere rol administrador." });
    }

    next();
  } catch (e) {
    console.error("Error en requerirAdmin:", e);
    res.status(500).json({ mensaje: "Error verificando permisos." });
  }
}

/* ============================================================
   GET /api/admin/pedidos
   ============================================================ */
router.get("/pedidos", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const {
      buscar = null,
      estado = null,
      programa = null,
      vendedorId = null,
      clienteId = null,
      desde = null,
      hasta = null,
      conFactura = null,
      limite = 100,
      offset = 0,
    } = req.query;

    const resultado = await listarPedidosAdmin({
      buscar: buscar || null,
      estado: estado || null,
      programa: programa || null,
      vendedorId: vendedorId || null,
      clienteId: clienteId || null,
      desde: desde || null,
      hasta: hasta || null,
      conFactura: conFactura || null,
      limite: Math.min(Number(limite) || 100, 500),
      offset: Math.max(Number(offset) || 0, 0),
    });

    res.json(resultado);
  } catch (e) { next(e); }
});

/* ============================================================
   GET /api/admin/pedidos/vendedores
   ⚠️ ANTES que /pedidos/:id
   ============================================================ */
router.get("/pedidos/vendedores", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const vendedores = await listarVendedoresParaFiltro();
    res.json({ vendedores });
  } catch (e) { next(e); }
});

/* ============================================================
   GET /api/admin/pedidos/:id
   ============================================================ */
router.get("/pedidos/:id", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const data = await obtenerPedidoAdmin(req.params.id);
    if (!data) return res.status(404).json({ mensaje: "Pedido no encontrado." });
    res.json(data);
  } catch (e) { next(e); }
});

/* ============================================================
   PATCH /api/admin/pedidos/:id/estado
   Body: { estado }
   ============================================================ */
router.patch("/pedidos/:id/estado", requerirAutenticacion(), requerirAdmin, async (req, res, next) => {
  try {
    const { estado } = req.body;
    if (!estado) return res.status(400).json({ mensaje: "Falta 'estado'." });

    const actualizado = await cambiarEstadoPedido(req.params.id, estado);
    if (!actualizado) return res.status(404).json({ mensaje: "Pedido no encontrado." });

    res.json({ ok: true, pedido: actualizado });
  } catch (e) { next(e); }
});

export default router;