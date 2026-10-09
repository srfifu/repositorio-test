// backend/routes/pedidosClienteRutas.js
import { Router } from "express";
import { requerirAutenticacion } from "imansi-auth-node";
import {
  listarMisPedidos,
  obtenerMiPedido,
  listarPendientesDePago,
} from "../services/pedidosClienteServicio.js";

const router = Router();

/* ============================================================
   GET /api/mis-pedidos
   Lista los pedidos del cliente logueado con filtros y KPIs.
   Query: ?buscar=&estado=&programa=&desde=&hasta=&limite=&offset=
   ============================================================ */
router.get("/", requerirAutenticacion(), async (req, res, next) => {
  try {
    const {
      buscar = null,
      estado = null,
      programa = null,
      desde = null,
      hasta = null,
      limite = 50,
      offset = 0,
    } = req.query;

    const resultado = await listarMisPedidos(req.usuario.id, {
      buscar: buscar || null,
      estado: estado || null,
      programa: programa || null,
      desde: desde || null,
      hasta: hasta || null,
      limite: Math.min(Number(limite) || 50, 200),
      offset: Math.max(Number(offset) || 0, 0),
    });

    res.json(resultado);
  } catch (e) { next(e); }
});

/* ============================================================
   GET /api/mis-pedidos/pendientes
   Lista los pedidos pendientes de pago (para badge/alertas).
   ============================================================ */
router.get("/pendientes", requerirAutenticacion(), async (req, res, next) => {
  try {
    const pendientes = await listarPendientesDePago(req.usuario.id);
    res.json({ pendientes, total: pendientes.length });
  } catch (e) { next(e); }
});

/* ============================================================
   GET /api/mis-pedidos/:id
   Detalle de un pedido con items + imágenes.
   ============================================================ */
router.get("/:id", requerirAutenticacion(), async (req, res, next) => {
  try {
    const resultado = await obtenerMiPedido(req.usuario.id, req.params.id);
    if (!resultado) {
      return res.status(404).json({ mensaje: "Pedido no encontrado." });
    }
    res.json(resultado);
  } catch (e) { next(e); }
});

export default router;