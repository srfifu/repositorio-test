// backend/routes/usuariosRutas.js
import { Router } from "express";
import { requerirAutenticacion } from "imansi-auth-node";
import { requiereRol } from "../middleware/requiereRol.js";
import {
  listarUsuarios,
  obtenerUsuarioPorId,
  crearUsuario,
  editarUsuario,
  cambiarContrasena,
  asignarRol,
  quitarRol,
  asignarVendedorReferente,
  listarVendedores,
  estadisticasUsuarios,
} from "../services/usuariosService.js";

const router = Router();

/* ============================================================
   ⚠️ ORDEN IMPORTANTE:
   Las rutas ESPECÍFICAS van ANTES que las que usan :id
   ============================================================ */

/* ── GET /api/usuarios ─────────────────────────────────── */
router.get(
  "/",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const usuarios = await listarUsuarios({
        rol: req.query.rol || null,
        referidoPor: req.query.referidoPor || null,
        sinVendedor: req.query.sinVendedor === "true",
        buscar: req.query.buscar || null,
        limite: Math.min(Number(req.query.limite) || 200, 500),
      });
      res.json({ usuarios });
    } catch (e) { next(e); }
  }
);

/* ── GET /api/usuarios/stats ───────────────────────────── */
router.get(
  "/stats",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const stats = await estadisticasUsuarios();
      res.json({ stats });
    } catch (e) { next(e); }
  }
);

/* ── GET /api/usuarios/stats-clientes ──────────────────── */
router.get(
  "/stats-clientes",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const stats = await estadisticasUsuarios();
      // Mapeamos al formato que espera el frontend
      res.json({
        stats: {
          total_clientes: stats.clientes,
          con_vendedor: stats.con_vendedor ?? 0,
          sin_vendedor: stats.sin_vendedor,
          nuevos_mes: stats.nuevos_mes ?? 0,
        },
      });
    } catch (e) { next(e); }
  }
);

/* ── GET /api/usuarios/vendedores ──────────────────────── */
router.get(
  "/vendedores",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const vendedores = await listarVendedores({
        buscar: req.query.buscar || null,
        limite: Math.min(Number(req.query.limite) || 200, 500),
      });
      res.json({ vendedores });
    } catch (e) { next(e); }
  }
);

/* ── GET /api/usuarios/:id ─────────────────────────────── */
router.get(
  "/:id",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const usuario = await obtenerUsuarioPorId(req.params.id);
      if (!usuario) return res.status(404).json({ mensaje: "Usuario no encontrado." });
      res.json({ usuario });
    } catch (e) { next(e); }
  }
);

/* ── POST /api/usuarios ────────────────────────────────── */
router.post(
  "/",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const { correo, nombre, contrasena, rol, referidoPor } = req.body;
      if (!correo || !nombre || !contrasena) {
        return res.status(400).json({ mensaje: "Faltan campos: correo, nombre, contrasena." });
      }
      const usuario = await crearUsuario({
        correo,
        nombre,
        contrasena,
        rol: rol || "cliente",
        referidoPor: referidoPor || null,
        asignadoPor: req.usuario.id,
      });
      res.status(201).json({ ok: true, usuario });
    } catch (e) { next(e); }
  }
);

/* ── PATCH /api/usuarios/:id ───────────────────────────── */
router.patch(
  "/:id",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const cambios = {};
      if (req.body.nombre !== undefined) cambios.nombre = req.body.nombre;
      if (req.body.correo !== undefined) cambios.correo = req.body.correo;
      const usuario = await editarUsuario(req.params.id, cambios);
      if (!usuario) return res.status(404).json({ mensaje: "Usuario no encontrado." });
      res.json({ ok: true, usuario });
    } catch (e) { next(e); }
  }
);

/* ── PATCH /api/usuarios/:id/password ──────────────────── */
router.patch(
  "/:id/password",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const { contrasena } = req.body;
      if (!contrasena) return res.status(400).json({ mensaje: "Falta 'contrasena'." });
      const ok = await cambiarContrasena(req.params.id, contrasena);
      if (!ok) return res.status(404).json({ mensaje: "Usuario no encontrado." });
      res.json({ ok: true });
    } catch (e) { next(e); }
  }
);

/* ── POST /api/usuarios/:id/roles ──────────────────────── */
router.post(
  "/:id/roles",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const { rol } = req.body;
      if (!rol) return res.status(400).json({ mensaje: "Falta 'rol'." });
      const asignacion = await asignarRol(req.params.id, rol, req.usuario.id);
      if (!asignacion) return res.status(409).json({ mensaje: "El usuario ya tiene ese rol." });
      res.status(201).json({ ok: true, asignacion });
    } catch (e) { next(e); }
  }
);

/* ── DELETE /api/usuarios/:id/roles/:rol ───────────────── */
router.delete(
  "/:id/roles/:rol",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const ok = await quitarRol(req.params.id, req.params.rol);
      if (!ok) return res.status(404).json({ mensaje: "El usuario no tiene ese rol." });
      res.status(204).end();
    } catch (e) { next(e); }
  }
);

/* ── PATCH /api/usuarios/:id/referido ──────────────────── */
router.patch(
  "/:id/referido",
  requerirAutenticacion(),
  requiereRol("admin"),
  async (req, res, next) => {
    try {
      const { vendedorId } = req.body;
      await asignarVendedorReferente(req.params.id, vendedorId || null);
      res.json({ ok: true });
    } catch (e) { next(e); }
  }
);

export default router;