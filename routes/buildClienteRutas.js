// backend/routes/buildClienteRutas.js
import { Router } from "express";
import fs from "node:fs";
import { requerirAutenticacion } from "imansi-auth-node";
import {
  guardarDiseno,
  registrarDisenoPagado,
  disenoYaPagado,
  obtenerRutaDiseno,
} from "../services/disenoClienteServicio.js";

const router = Router();

/**
 * POST /api/build/diseno
 * Guarda un diseño custom (PNG base64) y devuelve { uuid, url, firma }.
 */
router.post("/diseno", requerirAutenticacion(), async (req, res, next) => {
  try {
    const { base64, colorSlug, tipo, contenido } = req.body;
    if (!colorSlug) {
      return res.status(400).json({ mensaje: "Falta 'colorSlug'." });
    }
    const diseno = await guardarDiseno({
      base64,
      colorSlug,
      tipo,
      contenido: contenido || {},
      usuarioId: req.usuario.id,
    });

    // Verificar si ya estaba pagado
    const yaPagado = await disenoYaPagado(req.usuario.id, diseno.firma);

    res.status(201).json({
      ok: true,
      diseno: {
        uuid: diseno.uuid,
        url: diseno.url,
        firma: diseno.firma,
        yaPagado: Boolean(yaPagado),
      },
    });
  } catch (e) { next(e); }
});

/**
 * GET /api/build/diseno/:uuid
 * Devuelve el PNG generado.
 */
router.get("/diseno/:uuid", requerirAutenticacion(), async (req, res, next) => {
  try {
    const ruta = await obtenerRutaDiseno(req.params.uuid);
    if (!ruta) {
      return res.status(404).json({ mensaje: "Diseño no encontrado." });
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=86400");
    fs.createReadStream(ruta).pipe(res);
  } catch (e) { next(e); }
});

/**
 * POST /api/build/diseno/pagar
 * Registra un diseño como pagado (lo llama el backend al confirmar el pedido).
 */
router.post("/diseno/pagar", requerirAutenticacion(), async (req, res, next) => {
  try {
    const { firma, tipo, colorCodigo, contenido, precio, pedidoId } = req.body;
    if (!firma || !tipo) {
      return res.status(400).json({ mensaje: "Faltan firma o tipo." });
    }
    const registro = await registrarDisenoPagado({
      usuarioId: req.usuario.id,
      firma, tipo, colorCodigo, contenido, precio, pedidoId,
    });
    res.json({ ok: true, registro });
  } catch (e) { next(e); }
});

export default router;