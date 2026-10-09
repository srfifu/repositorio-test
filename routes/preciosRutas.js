// backend/routes/preciosRutas.js
import { Router } from "express";
import { requerirAutenticacion } from "imansi-auth-node";
import { requiereRol } from "../middleware/requiereRol.js";
import {
  obtenerPreciosVigentes,
  actualizarPreciosGlobales,
  obtenerPrecioParaUsuario,
  listarVendedoresConConfig,
  obtenerConfigVendedor,
  crearConfigVendedor,
  actualizarConfigVendedor,
  listarHistorial,
} from "../services/preciosService.js";

const router = Router();

/* ============================================================
   PRECIOS GLOBALES
   ============================================================ */

/**
 * GET /api/precios/globales
 * Precios vigentes globales (cualquier rol autenticado).
 */
router.get("/globales", requerirAutenticacion(), async (req, res, next) => {
  try {
    const precios = await obtenerPreciosVigentes();
    if (!precios) {
      return res.status(500).json({ mensaje: "No hay configuración de precios activa." });
    }
    res.json({ precios });
  } catch (e) { next(e); }
});

/**
 * PATCH /api/precios/globales
 * Actualiza precios globales (solo admin).
 */
router.patch(
  "/globales",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const resultado = await actualizarPreciosGlobales(req.body, req.usuario.id);
      if (resultado.sinCambios) {
        return res.json({ ok: true, mensaje: "Sin cambios.", precios: resultado.precios });
      }
      res.json({ ok: true, precios: resultado.precios, diff: resultado.diff });
    } catch (e) { next(e); }
  }
);

/* ============================================================
   PRECIO PARA UN USUARIO
   ============================================================ */

/**
 * GET /api/precios/mi-precio
 * Precio efectivo del usuario autenticado.
 */
router.get("/mi-precio", requerirAutenticacion(), async (req, res, next) => {
  try {
    const precio = await obtenerPrecioParaUsuario(req.usuario.id);
    if (!precio) {
      return res.status(500).json({ mensaje: "No se pudo calcular el precio." });
    }
    res.json({ precio });
  } catch (e) { next(e); }
});

/**
 * GET /api/precios/usuario/:id
 * Precio efectivo de un usuario específico (solo admin).
 */
router.get(
  "/usuario/:id",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const precio = await obtenerPrecioParaUsuario(req.params.id);
      res.json({ precio });
    } catch (e) { next(e); }
  }
);

/* ============================================================
   VENDEDORES
   ============================================================ */

/**
 * GET /api/precios/vendedores
 * Lista todos los vendedores + su config (solo admin).
 */
router.get(
  "/vendedores",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const vendedores = await listarVendedoresConConfig();
      res.json({ vendedores });
    } catch (e) { next(e); }
  }
);

/**
 * GET /api/precios/vendedores/mi-config
 * Mi config como vendedor.
 */
router.get(
  "/vendedores/mi-config",
  requerirAutenticacion(),
  requiereRol("vendedor", "admin"),
  async (req, res, next) => {
    try {
      const config = await obtenerConfigVendedor(req.usuario.id);
      res.json({ config });
    } catch (e) { next(e); }
  }
);

/**
 * PATCH /api/precios/vendedores/mi-config
 * Actualizar mi propia config (vendedor).
 * Solo puede editar los campos de VENTA (no costo ni límites).
 */
router.patch(
  "/vendedores/mi-config",
  requerirAutenticacion(),
  requiereRol("vendedor"),
  async (req, res, next) => {
    try {
      let config = await obtenerConfigVendedor(req.usuario.id);

      // Filtrar solo campos que el vendedor puede tocar
      const permitidosVendedor = [
        "venta_autoship_precio_por_rosa",
        "venta_onetime_precio_por_rosa",
        "venta_personalizacion_texto_precio",
        "venta_personalizacion_foto_precio",
        "nombre_comercial",
        "logo_url",
        "color_marca",
      ];
      const cambios = {};
      for (const k of permitidosVendedor) {
        if (req.body[k] !== undefined) cambios[k] = req.body[k];
      }

      if (!config) {
        // Crear config con valores por defecto
        config = await crearConfigVendedor({
          usuario_id: req.usuario.id,
          costo_autoship_precio_por_rosa: 4.50,
          costo_onetime_precio_por_rosa: 5.50,
          costo_personalizacion_texto_precio: 7.00,
          costo_personalizacion_foto_precio: 10.00,
          ...cambios,
        });
        return res.status(201).json({ ok: true, config });
      }

      const resultado = await actualizarConfigVendedor(req.usuario.id, cambios, req.usuario.id);
      if (resultado.sinCambios) {
        return res.json({ ok: true, mensaje: "Sin cambios.", config: resultado.config });
      }
      res.json({ ok: true, config: resultado.config, diff: resultado.diff });
    } catch (e) { next(e); }
  }
);

/**
 * GET /api/precios/vendedores/:usuarioId/config
 * Config de un vendedor (solo admin).
 */
router.get(
  "/vendedores/:usuarioId/config",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const config = await obtenerConfigVendedor(req.params.usuarioId);
      res.json({ config });
    } catch (e) { next(e); }
  }
);

/**
 * PATCH /api/precios/vendedores/:usuarioId/config
 * Actualizar config de un vendedor (solo admin).
 * Puede editar costo, venta y límites.
 */
router.patch(
  "/vendedores/:usuarioId/config",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      let config = await obtenerConfigVendedor(req.params.usuarioId);

      if (!config) {
        // Crear con los datos que vengan
        config = await crearConfigVendedor({
          usuario_id: req.params.usuarioId,
          costo_autoship_precio_por_rosa: Number(req.body.costo_autoship_precio_por_rosa) || 4.50,
          costo_onetime_precio_por_rosa: Number(req.body.costo_onetime_precio_por_rosa) || 5.50,
          costo_personalizacion_texto_precio: Number(req.body.costo_personalizacion_texto_precio) || 7.00,
          costo_personalizacion_foto_precio: Number(req.body.costo_personalizacion_foto_precio) || 10.00,
          venta_autoship_precio_por_rosa: req.body.venta_autoship_precio_por_rosa ?? null,
          venta_onetime_precio_por_rosa: req.body.venta_onetime_precio_por_rosa ?? null,
          venta_personalizacion_texto_precio: req.body.venta_personalizacion_texto_precio ?? null,
          venta_personalizacion_foto_precio: req.body.venta_personalizacion_foto_precio ?? null,
          max_autoship_precio_por_rosa: req.body.max_autoship_precio_por_rosa ?? null,
          max_onetime_precio_por_rosa: req.body.max_onetime_precio_por_rosa ?? null,
          max_personalizacion_texto_precio: req.body.max_personalizacion_texto_precio ?? null,
          max_personalizacion_foto_precio: req.body.max_personalizacion_foto_precio ?? null,
          min_sugerido_autoship_precio_por_rosa: req.body.min_sugerido_autoship_precio_por_rosa ?? null,
          min_sugerido_onetime_precio_por_rosa: req.body.min_sugerido_onetime_precio_por_rosa ?? null,
          nombre_comercial: req.body.nombre_comercial || null,
          logo_url: req.body.logo_url || null,
          color_marca: req.body.color_marca || null,
          notas: req.body.notas || null,
        });
        return res.status(201).json({ ok: true, config });
      }

      const resultado = await actualizarConfigVendedor(req.params.usuarioId, req.body, req.usuario.id);
      if (resultado.sinCambios) {
        return res.json({ ok: true, mensaje: "Sin cambios.", config: resultado.config });
      }
      res.json({ ok: true, config: resultado.config, diff: resultado.diff });
    } catch (e) { next(e); }
  }
);

/* ============================================================
   HISTORIAL
   ============================================================ */

/**
 * GET /api/precios/historial
 * Historial de cambios (solo admin).
 * Query: ?limite=50&tipo=global|costo|venta
 */
router.get(
  "/historial",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const limite = Math.min(Number(req.query.limite) || 50, 200);
      const tipo = ["global", "costo", "venta"].includes(req.query.tipo)
        ? req.query.tipo
        : null;
      const historial = await listarHistorial({ limite, tipo });
      res.json({ historial });
    } catch (e) { next(e); }
  }
);

export default router;