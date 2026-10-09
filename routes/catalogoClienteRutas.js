// backend/routes/catalogoClienteRutas.js
import { Router } from "express";
import { requerirAutenticacion } from "imansi-auth-node";
import {
  obtenerCatalogoParaCliente,
  debugCatalogo,
} from "../services/catalogoClienteServicio.js";

const router = Router();

/* ============================================================
   GET /api/catalogo/cliente
   Catálogo completo + precios del cliente logueado.
   ============================================================ */
router.get("/cliente", requerirAutenticacion(), async (req, res, next) => {
  try {
    const data = await obtenerCatalogoParaCliente(req.usuario.id);
    res.json(data);
  } catch (e) { next(e); }
});

/* ============================================================
   GET /api/catalogo/debug
   Resumen del catálogo para verificar imágenes cargadas.
   (solo admin o cualquier autenticado — usalo con cuidado)
   ============================================================ */
router.get("/debug", requerirAutenticacion(), async (req, res, next) => {
  try {
    const data = await debugCatalogo();
    res.json(data);
  } catch (e) { next(e); }
});

export default router;